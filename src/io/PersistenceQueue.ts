import type { App, TFile } from 'obsidian';
import type {
    BoxAccentColor,
    BoxBgTheme,
    BoxGridStyle,
    BoxMetadata,
    CanvasElement,
    LayoutHint,
    PageDocument,
    Point,
    StrokeElement,
} from '../core/types.ts';
import { BoxRegistry } from '../core/BoxRegistry.ts';
import { normalizeBoxId, parseApoloSpaceBlock, parseApoloSpaceHtml } from '../editor/ApoloSpaceExtension.ts';
import { getPenPlugin, type PenSvgOutput } from '../engine/pens/index.ts';
import {
    clearDanglingBindings,
    getShapePlugin,
    sanitizeLoadedShapeElement,
    shapeElementStyle,
    shapeElementToGeometry,
} from '../engine/shapes/index.ts';
import { createSvgFromMarkup, isDarkTheme } from '../ui/theme.ts';
import {
    createApnoteManifest,
    deleteNoteSatellites,
    discoverBoxSvgPaths,
    ensureNoMediaFile,
    getApnoteTriggerPath,
    getBoxSvgPath,
    getGlobalInkPath,
    getLegacyDotBoxSvgPath,
    isSatelliteFile,
    normalizeVaultNotePath,
    parseApnoteManifest,
    parseSatelliteFilename,
    registerKnownApnote,
    resolveMdFromTrigger,
    sanitizeBoxId,
    serializeApnoteManifest,
    splitNotePath,
    syncAtomicRename,
} from './ApnoteBundle.ts';

export {
    getApnoteTriggerPath,
    getBoxSvgPath,
    getGlobalInkPath,
    isSatelliteFile,
    normalizeVaultNotePath,
    resolveMdFromTrigger,
    sanitizeBoxId,
};

/** Feeds a string into a running 32-bit FNV-1a accumulator. */
function fnv1aUpdate(hash: number, input: string): number {
    let h = hash;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

export interface BoxRecord {
    boxId: string;
    height: number;
    lastTop?: number;
    gridVisible?: boolean;
    gridStyle?: BoxGridStyle;
    gridDensity?: number;
    snapToGrid?: boolean;
    bgTheme?: BoxBgTheme;
    customBgColor?: string;
    accentColor?: BoxAccentColor;
    borderOutline?: boolean;
    updatedAt: number;
    elements: CanvasElement[];
}

export interface NoteRecord {
    notePath: string;
    updatedAt: number;
    elements: CanvasElement[];
    layoutHint?: LayoutHint;
}

function escapeRegExpLiteral(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ensures every `apolo-space` block in `markdown` has an adjacent standard Obsidian embed
 * `![[.<BaseName>.<safeBoxId>.svg]]` for native rendering when the plugin is disabled,
 * and removes stale or duplicate fallback embeds for deleted boxes.
 */
export function syncMarkdownFallbackEmbeds(
    markdown: string,
    baseName: string,
    activeBoxIds?: ReadonlySet<string>,
): string {
    if (!markdown || !baseName) return markdown;
    const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
    const lines = markdown.split(/\r?\n/);
    const escapedBase = escapeRegExpLiteral(baseName);
    const anyBoxEmbedRegex = new RegExp(
        `^\\s*!\\[\\[\\.?${escapedBase}\\.([A-Za-z0-9_-]+)\\.svg(?:\\|[^\\]]*)?\\]\\]\\s*$`,
    );

    const activeSafeIds = new Set<string>();
    if (activeBoxIds) {
        for (const id of activeBoxIds) {
            activeSafeIds.add(sanitizeBoxId(id));
        }
    }

    // Pre-scan all box IDs present in markdown blocks
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*```apolo-space\b/i.test(line)) {
            let end = i + 1;
            const body: string[] = [];
            while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) {
                body.push(lines[end]);
                end++;
            }
            const parsed = parseApoloSpaceBlock(body.join('\n'));
            if (parsed.id) activeSafeIds.add(sanitizeBoxId(parsed.id));
            i = end;
            continue;
        }
        if (line.includes('data-apolo-space')) {
            const parsed = parseApoloSpaceHtml(line);
            if (parsed?.id) activeSafeIds.add(sanitizeBoxId(parsed.id));
        }
    }

    const out: string[] = [];
    const emittedEmbeds = new Set<string>();
    let inOtherCodeBlock = false;
    let otherFence = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (inOtherCodeBlock) {
            out.push(line);
            if (new RegExp(`^\\s*${escapeRegExpLiteral(otherFence)}\\s*$`).test(line)) {
                inOtherCodeBlock = false;
                otherFence = '';
            }
            continue;
        }

        if (/^\s*```apolo-space\b/i.test(line)) {
            const body: string[] = [];
            out.push(line);
            let j = i + 1;
            while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) {
                body.push(lines[j]);
                out.push(lines[j]);
                j++;
            }
            if (j < lines.length) {
                out.push(lines[j]);
            }
            const parsed = parseApoloSpaceBlock(body.join('\n'));
            if (parsed.id) {
                const safeId = sanitizeBoxId(parsed.id);
                const expectedEmbed = `![[${baseName}.${safeId}.svg]]`;
                out.push(expectedEmbed);
                emittedEmbeds.add(safeId);
                if (j + 1 < lines.length) {
                    const nextMatch = lines[j + 1].match(anyBoxEmbedRegex);
                    if (nextMatch && nextMatch[1] === safeId) {
                        j++;
                    }
                }
            }
            i = j;
            continue;
        }

        const otherFenceMatch = line.match(/^\s*(```|~~~)/);
        if (otherFenceMatch) {
            inOtherCodeBlock = true;
            otherFence = otherFenceMatch[1];
            out.push(line);
            continue;
        }

        if (line.includes('data-apolo-space')) {
            const parsed = parseApoloSpaceHtml(line);
            out.push(line);
            if (parsed?.id) {
                const safeId = sanitizeBoxId(parsed.id);
                const expectedEmbed = `![[${baseName}.${safeId}.svg]]`;
                out.push(expectedEmbed);
                emittedEmbeds.add(safeId);
                if (i + 1 < lines.length) {
                    const nextMatch = lines[i + 1].match(anyBoxEmbedRegex);
                    if (nextMatch && nextMatch[1] === safeId) {
                        i++;
                    }
                }
            }
            continue;
        }

        const embedMatch = line.match(anyBoxEmbedRegex);
        if (embedMatch) {
            const embedSafeId = embedMatch[1];
            if (!activeSafeIds.has(embedSafeId) || emittedEmbeds.has(embedSafeId)) {
                // Drop stale or duplicate fallback embed line
                continue;
            }
        }

        out.push(line);
    }

    return out.join(eol);
}

/** Extracts box IDs referenced in markdown `apolo-space` HTML divs and codeblocks. */
function scanMarkdownBoxIds(content: string): Set<string> {
    const boxIds = new Set<string>();
    const htmlDivRegex = /<div\s+[^>]*data-apolo-space(?:-id)?=(?:"[^"]+"|'[^']+'|[^\s>]+)[^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = htmlDivRegex.exec(content)) !== null) {
        const parsed = parseApoloSpaceHtml(`${match[0]}</div>`);
        if (parsed?.id) {
            boxIds.add(parsed.id);
        }
    }
    const attrFallbackRegex = /data-apolo-space(?:-id)?=["']([^"']+)["']/gi;
    while ((match = attrFallbackRegex.exec(content)) !== null) {
        const norm = normalizeBoxId(match[1]);
        if (norm) {
            boxIds.add(norm);
        }
    }
    const codeRegex = /```apolo-space\b([\s\S]*?)```/gi;
    while ((match = codeRegex.exec(content)) !== null) {
        const parsed = parseApoloSpaceBlock(match[1]);
        if (parsed?.id) {
            boxIds.add(parsed.id);
        }
    }
    return boxIds;
}

/** Debounced, serialized vault writes using note-local `.apnote` manifests and colocated satellites. */
export class PersistenceQueue {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private pending: { document: PageDocument; file: TFile; pageId: string } | null = null;
    private chain: Promise<void> = Promise.resolve();
    private debounceMs: number;
    private companionSvgEnabled = true;
    private readonly app: App;
    private readonly onError?: (error: unknown) => void;
    private readonly cacheByPageId = new Map<string, PageDocument>();

    constructor(app: App, debounceMs = 500, onError?: (error: unknown) => void) {
        this.app = app;
        this.debounceMs = debounceMs;
        this.onError = onError;
    }

    setDebounceMs(value: number): void { this.debounceMs = Math.max(50, value); }
    setCompanionSvgEnabled(value: boolean): void { this.companionSvgEnabled = value; }
    isCompanionSvgEnabled(): boolean { return this.companionSvgEnabled; }

    /** Returns the latest in-memory document state for a page, eliminating race conditions on tab switch. */
    getDocument(pageId: string): PageDocument | null {
        const cached = this.cacheByPageId.get(pageId);
        if (cached) {
            return JSON.parse(JSON.stringify(cached)) as PageDocument;
        }
        if (this.pending && this.pending.pageId === pageId) {
            return JSON.parse(JSON.stringify(this.pending.document)) as PageDocument;
        }
        return null;
    }

    enqueue(document: PageDocument, file: TFile, pageId: string): void {
        const copy = JSON.parse(JSON.stringify(document)) as PageDocument;
        this.cacheByPageId.set(pageId, copy);
        this.cacheByPageId.set(file.path, copy);
        this.pending = { document: copy, file, pageId };
        if (this.timer !== null) globalThis.clearTimeout(this.timer);
        this.timer = globalThis.setTimeout(() => {
            this.timer = null;
            this.flushSave().catch((error: unknown) => {
                console.error('[ApoloCanvas] Save failed:', error);
                this.onError?.(error);
            });
        }, this.debounceMs);
    }

    async flush(): Promise<void> {
        return this.flushSave();
    }

    /** Immediately writes pending note-local satellites (`.global.json`, `.<boxId>.svg`, `.apnote`) and fallback embeds. */
    async flushSave(): Promise<void> {
        if (this.timer !== null) {
            globalThis.clearTimeout(this.timer);
            this.timer = null;
        }
        const batch = this.pending;
        this.pending = null;
        if (!batch) return this.chain;
        this.chain = this.chain
            .catch(() => undefined)
            .then(() => this.persist(batch.document, batch.file, batch.pageId));
        return this.chain;
    }

    /** Loads global ink from `.<BaseName>.global.json` and per-box elements from `.<BaseName>.<boxId>.svg`. */
    async loadDocumentForNote(fileOrPath: TFile | string): Promise<PageDocument> {
        return this.loadNoteInk(fileOrPath);
    }

    /** Loads global ink from `.<BaseName>.global.json` and per-box elements from `.<BaseName>.<boxId>.svg`. */
    async loadNoteInk(fileOrPath: TFile | string): Promise<PageDocument> {
        const filePath = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
        const file = typeof fileOrPath === 'string'
            ? ((this.app.vault.getAbstractFileByPath?.(filePath) as TFile | null) ?? ({ path: filePath } as TFile))
            : fileOrPath;

        // 1. Check in-memory cache first to guarantee zero data loss on rapid tab switching
        const inMemory = this.getDocument(filePath);
        if (inMemory) {
            inMemory.notePath = filePath;
            return inMemory;
        }

        const adapter = this.app.vault.adapter;
        const split = splitNotePath(filePath);

        let content = '';
        try {
            content = await this.app.vault.read(file);
        } catch {
            try {
                if (await adapter.exists(split.mdPath)) {
                    content = await adapter.read(split.mdPath);
                }
            } catch {
                content = '';
            }
        }

        // 2. Scan box IDs present in the note (HTML blocks and codeblocks)
        const boxIds = scanMarkdownBoxIds(content);

        // 3. Load global freehand ink from <dir>/.<BaseName>.global.json
        const globalFile = getGlobalInkPath(filePath);
        let freehandElements: CanvasElement[] = [];
        let layoutHint: LayoutHint | undefined = undefined;

        if (await adapter.exists(globalFile)) {
            try {
                const noteData = JSON.parse(await adapter.read(globalFile)) as NoteRecord;
                freehandElements = noteData.elements || [];
                layoutHint = noteData.layoutHint;

                // Silently clean up orphaned strokes older than 30 days
                const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
                const checkTime = Date.now();
                freehandElements = freehandElements.filter(el => {
                    if (el.blockId && el.blockId.startsWith('space:')) {
                        const bId = normalizeBoxId(el.blockId.slice(6));
                        if (!boxIds.has(bId)) {
                            const age = checkTime - (el.timestamp || 0);
                            if (age > THIRTY_DAYS_MS) {
                                return false;
                            }
                        }
                    }
                    return true;
                });
            } catch (err) {
                console.error(`[ApoloCanvas] Could not read global ink for ${filePath}:`, err);
            }
        }

        // 4. Load boxes from <dir>/<BaseName>.<boxId>.svg (migrating legacy dot-prefixed files on read)
        const boxElements: CanvasElement[] = [];
        const boxesMeta: Record<string, BoxMetadata> = {};

        for (const boxId of boxIds) {
            const boxSvgFile = getBoxSvgPath(filePath, boxId);
            const legacyDotSvgFile = getLegacyDotBoxSvgPath(filePath, boxId);
            const hasPrimary = await adapter.exists(boxSvgFile);
            const sourceSvgFile = hasPrimary
                ? boxSvgFile
                : ((await adapter.exists(legacyDotSvgFile)) ? legacyDotSvgFile : null);
            if (sourceSvgFile) {
                try {
                    const rawSvg = await adapter.read(sourceSvgFile);
                    if (!hasPrimary && sourceSvgFile === legacyDotSvgFile) {
                        try {
                            await this.writeIndexedFile(boxSvgFile, rawSvg);
                            await adapter.remove(legacyDotSvgFile);
                        } catch {
                            // Best-effort auto-migration of legacy dotfile
                        }
                    }
                    const boxData = parseBoxSvg(rawSvg, boxId);
                    if (!boxData) continue;

                    boxesMeta[boxId] = {
                        height: boxData.height,
                        lastTop: boxData.lastTop,
                        gridVisible: boxData.gridVisible,
                        gridStyle: boxData.gridStyle,
                        gridDensity: boxData.gridDensity,
                        snapToGrid: boxData.snapToGrid,
                        bgTheme: boxData.bgTheme,
                        customBgColor: boxData.customBgColor,
                        accentColor: boxData.accentColor,
                        borderOutline: boxData.borderOutline,
                    };
                    BoxRegistry.setHeight(boxId, boxData.height);
                    if (boxData.gridVisible !== undefined) BoxRegistry.setGridVisible(boxId, boxData.gridVisible);
                    if (boxData.gridStyle) BoxRegistry.setGridStyle(boxId, boxData.gridStyle);
                    if (boxData.gridDensity) BoxRegistry.setGridDensity(boxId, boxData.gridDensity);
                    if (boxData.snapToGrid !== undefined) BoxRegistry.setSnapActive(boxId, boxData.snapToGrid);
                    if (boxData.bgTheme) BoxRegistry.setBgTheme(boxId, boxData.bgTheme);
                    if (boxData.customBgColor !== undefined) BoxRegistry.setCustomBgColor(boxId, boxData.customBgColor);
                    if (boxData.accentColor) BoxRegistry.setAccentColor(boxId, boxData.accentColor);
                    if (boxData.borderOutline !== undefined) BoxRegistry.setBorderOutline(boxId, boxData.borderOutline);
                    if (boxData.elements) {
                        boxElements.push(...boxData.elements);
                    }
                } catch (err) {
                    console.error(`[ApoloCanvas] Could not read box SVG ${boxSvgFile}:`, err);
                }
            }
        }

        const elements = [...freehandElements, ...boxElements];
        for (const el of elements) {
            if (el.type === 'shape') sanitizeLoadedShapeElement(el);
        }
        // Connectors whose target shape was not loaded must not dangle
        clearDanglingBindings(elements);

        if (await adapter.exists(split.apnotePath)) {
            registerKnownApnote(split.apnotePath);
        }

        const now = Date.now();
        const doc: PageDocument = {
            schemaVersion: 1,
            version: 1,
            id: filePath,
            notePath: filePath,
            elements,
            boxes: boxesMeta,
            layoutHint,
            createdAt: now,
            updatedAt: now,
        };
        this.cacheByPageId.set(filePath, doc);
        return doc;
    }

    /** Discharges pending writes immediately and synchronizes all note-local satellites on rename/move. */
    async onFileRenamed(oldPath: string, newFileOrPath: TFile | string): Promise<void> {
        const newPath = typeof newFileOrPath === 'string' ? newFileOrPath : newFileOrPath.path;
        const oldSplit = splitNotePath(oldPath);
        const newSplit = splitNotePath(newPath);

        const cachedKeys = Array.from(this.cacheByPageId.keys());
        for (const key of cachedKeys) {
            const doc = this.cacheByPageId.get(key);
            if (!doc) continue;
            if (doc.notePath === oldSplit.mdPath || doc.notePath === oldPath) {
                doc.notePath = newSplit.mdPath;
                doc.id = newSplit.mdPath;
                this.cacheByPageId.delete(key);
                this.cacheByPageId.set(newSplit.mdPath, doc);
            }
        }

        if (this.pending && (this.pending.file.path === oldPath || this.pending.file.path === oldSplit.mdPath)) {
            const fallbackFile = typeof newFileOrPath === 'string'
                ? ({ path: newSplit.mdPath } as TFile)
                : newFileOrPath;
            const targetMdFile = (this.app.vault.getAbstractFileByPath?.(newSplit.mdPath) as TFile | null) ?? fallbackFile;
            this.pending.file = targetMdFile;
            this.pending.pageId = newSplit.mdPath;
            this.pending.document.notePath = newSplit.mdPath;
            this.pending.document.id = newSplit.mdPath;
        }

        try {
            await syncAtomicRename(this.app.vault, oldPath, newPath);
        } catch (err) {
            console.warn('[ApoloCanvas] Could not synchronize satellite rename:', err);
        }

        await this.flushSave();
    }

    /** Cleans up all note-local satellites when a note or `.apnote` file is deleted. */
    async onFileDeleted(deletedPath: string): Promise<void> {
        const split = splitNotePath(deletedPath);
        this.cacheByPageId.delete(deletedPath);
        this.cacheByPageId.delete(split.mdPath);
        try {
            await deleteNoteSatellites(this.app.vault, deletedPath);
        } catch (e) {
            console.warn('[ApoloCanvas] Could not remove deleted note satellites:', e);
        }
    }

    private async persist(document: PageDocument, file: TFile, _pageId: string): Promise<void> {
        const adapter = this.app.vault.adapter;
        const split = splitNotePath(file.path);

        // 1. Ensure <dir>/.nomedia exists
        await ensureNoMediaFile(this.app.vault, split.dir);

        // 2. Read current markdown & inspect existing satellites on disk
        let currentMd: string | null = null;
        try {
            currentMd = await this.app.vault.read(file);
        } catch {
            try {
                if (await adapter.exists(split.mdPath)) {
                    currentMd = await adapter.read(split.mdPath);
                }
            } catch {
                currentMd = null;
            }
        }
        const markdownBoxIds = currentMd !== null ? scanMarkdownBoxIds(currentMd) : new Set<string>();

        const existingSvgPaths = await discoverBoxSvgPaths(this.app.vault, split.mdPath);
        const existingSvgSafeIds = new Set<string>();
        for (const svgPath of existingSvgPaths) {
            const parsed = parseSatelliteFilename(svgPath);
            if (parsed?.boxId) existingSvgSafeIds.add(parsed.boxId);
        }

        const prevManifestCanvases = new Set<string>();
        if (await adapter.exists(split.apnotePath)) {
            try {
                const manifest = parseApnoteManifest(await adapter.read(split.apnotePath));
                if (manifest) {
                    for (const id of manifest.canvases) prevManifestCanvases.add(id);
                }
            } catch {
                // Ignore unreadable manifest
            }
        }

        // 3. Partition elements into global freehand annotations vs per-box elements
        const freehandElements: CanvasElement[] = [];
        const boxElementsMap = new Map<string, CanvasElement[]>();
        const docBoxIds = new Set<string>();

        if (document.boxes) {
            for (const rawBoxId of Object.keys(document.boxes)) {
                const boxId = normalizeBoxId(rawBoxId) || rawBoxId;
                if (boxId) {
                    docBoxIds.add(boxId);
                    boxElementsMap.set(boxId, []);
                }
            }
        }

        for (const mdBoxId of markdownBoxIds) {
            if (!boxElementsMap.has(mdBoxId)) {
                boxElementsMap.set(mdBoxId, []);
            }
        }

        for (const el of document.elements) {
            if (el.blockId && el.blockId.startsWith('space:')) {
                const rawBoxId = el.blockId.slice(6);
                const boxId = normalizeBoxId(rawBoxId) || rawBoxId;
                if (boxId) {
                    let list = boxElementsMap.get(boxId);
                    if (!list) {
                        list = [];
                        boxElementsMap.set(boxId, list);
                    }
                    list.push(el);
                }
            } else {
                freehandElements.push(el);
            }
        }

        // Determine active boxes (drop boxes that existed on disk and were removed from the note)
        const activeBoxes = new Map<string, CanvasElement[]>();
        const activeSafeIds = new Set<string>();

        for (const [boxId, els] of boxElementsMap.entries()) {
            const safeId = sanitizeBoxId(boxId);
            const wasPersistedBefore = existingSvgSafeIds.has(safeId) || prevManifestCanvases.has(boxId);
            const presentInMarkdown = markdownBoxIds.has(boxId);
            const presentInDocBoxes = docBoxIds.has(boxId);

            if (currentMd !== null && wasPersistedBefore && !presentInMarkdown) {
                continue;
            }
            if (!presentInMarkdown && !presentInDocBoxes) {
                continue;
            }
            activeBoxes.set(boxId, els);
            activeSafeIds.add(safeId);
        }

        // 4. Write global ink to <dir>/.<BaseName>.global.json
        const noteRecord: NoteRecord = {
            notePath: split.mdPath,
            updatedAt: Date.now(),
            elements: freehandElements,
            layoutHint: document.layoutHint,
        };
        await adapter.write(getGlobalInkPath(split.mdPath), JSON.stringify(noteRecord));

        // 5. Render and write each active box as standalone <dir>/<BaseName>.<boxId>.svg
        for (const [boxId, elements] of activeBoxes.entries()) {
            const meta = document.boxes?.[boxId];
            const boxH = meta?.height ?? BoxRegistry.getHeight(boxId) ?? 280;
            const renderMeta: BoxSvgRenderMeta = {
                height: boxH,
                lastTop: meta?.lastTop,
                gridVisible: meta?.gridVisible ?? BoxRegistry.isGridVisible(boxId),
                gridStyle: meta?.gridStyle ?? BoxRegistry.getGridStyle(boxId),
                gridDensity: meta?.gridDensity ?? BoxRegistry.getGridDensity(boxId),
                snapToGrid: meta?.snapToGrid ?? BoxRegistry.isSnapActive(boxId),
                bgTheme: meta?.bgTheme ?? BoxRegistry.getBgTheme(boxId),
                customBgColor: meta?.customBgColor ?? BoxRegistry.getCustomBgColor(boxId),
                accentColor: meta?.accentColor ?? BoxRegistry.getAccentColor(boxId),
                borderOutline: meta?.borderOutline ?? BoxRegistry.isBorderOutline(boxId),
            };
            const boxSvgPath = getBoxSvgPath(split.mdPath, boxId);
            const boxSvgContent = renderBoxSvg(boxId, elements, 800, boxH, renderMeta);
            await this.writeIndexedFile(boxSvgPath, boxSvgContent);
            const legacyDotPath = getLegacyDotBoxSvgPath(split.mdPath, boxId);
            if (legacyDotPath !== boxSvgPath && (await adapter.exists(legacyDotPath))) {
                try {
                    await adapter.remove(legacyDotPath);
                } catch {
                    // Best-effort cleanup of superseded legacy dotfile
                }
            }
        }

        // 6. Delete stale <BaseName>.<oldBoxId>.svg or legacy dot-prefixed files for removed boxes
        for (const oldSvgPath of existingSvgPaths) {
            const parsed = parseSatelliteFilename(oldSvgPath);
            const fileName = oldSvgPath.slice(oldSvgPath.lastIndexOf('/') + 1);
            const isLegacyDot = fileName.startsWith('.');
            if (parsed?.boxId && (!activeSafeIds.has(parsed.boxId) || isLegacyDot)) {
                try {
                    if (await adapter.exists(oldSvgPath)) {
                        await adapter.remove(oldSvgPath);
                    }
                } catch (err) {
                    console.warn(`[ApoloCanvas] Could not delete stale box SVG "${oldSvgPath}":`, err);
                }
            }
        }

        // 7. Write/update <dir>/<BaseName>.apnote trigger manifest
        const manifest = createApnoteManifest(split.mdPath, activeBoxes.keys());
        await this.writeIndexedFile(split.apnotePath, serializeApnoteManifest(manifest));
        registerKnownApnote(split.apnotePath);

        // 8. Sync native plugin-disabled fallback embeds ![[<BaseName>.<boxId>.svg]] inside <BaseName>.md
        if (currentMd !== null && (markdownBoxIds.size > 0 || existingSvgPaths.length > 0)) {
            const updatedMd = syncMarkdownFallbackEmbeds(
                currentMd,
                split.baseName,
                new Set(activeBoxes.keys()),
            );
            if (updatedMd !== currentMd) {
                try {
                    if (typeof this.app.vault.modify === 'function') {
                        await this.app.vault.modify(file, updatedMd);
                    } else {
                        await adapter.write(split.mdPath, updatedMd);
                    }
                } catch {
                    await adapter.write(split.mdPath, updatedMd);
                }
            }
        }
    }

    /** Writes a non-dot satellite/trigger file through Vault APIs so Obsidian indexes it immediately. */
    private async writeIndexedFile(path: string, content: string): Promise<void> {
        const existing = this.app.vault.getAbstractFileByPath?.(path);
        if (existing && typeof this.app.vault.modify === 'function') {
            try {
                await this.app.vault.modify(existing as TFile, content);
                return;
            } catch {
                // Fall through to adapter.write
            }
        }
        if (!existing && typeof (this.app.vault as { create?: (p: string, d: string) => Promise<unknown> }).create === 'function') {
            try {
                await (this.app.vault as { create: (p: string, d: string) => Promise<unknown> }).create(path, content);
                return;
            } catch {
                // Fall through to adapter.write
            }
        }
        await this.app.vault.adapter.write(path, content);
    }
}

export interface BoxSvgRenderMeta {
    height?: number;
    lastTop?: number;
    gridVisible?: boolean;
    gridStyle?: string;
    gridDensity?: number;
    snapToGrid?: boolean;
    bgTheme?: string;
    customBgColor?: string;
    accentColor?: BoxAccentColor;
    borderOutline?: boolean;
    /** When true, `'default'` background stays transparent so the host CSS box theme renders natively. */
    omitDefaultBg?: boolean;
    /** Explicit theme polarity override for standalone SVG export when no DOM theme class is present. */
    isDarkTheme?: boolean;
}

function resolveRenderBoxDarkTheme(meta?: BoxSvgRenderMeta): boolean {
    if (meta?.isDarkTheme !== undefined) return meta.isDarkTheme;
    if (typeof document !== 'undefined' && document?.body?.classList) {
        if (document.body.classList.contains('theme-light')) return false;
        if (isDarkTheme()) return true;
    }
    return true;
}

function stripTransientElementProps(elements: readonly CanvasElement[]): CanvasElement[] {
    return elements.map((el) => {
        if (el.type === 'stroke' && 'cacheCanvas' in el && el.cacheCanvas !== undefined) {
            const { cacheCanvas: _dropped, ...rest } = el;
            return rest as StrokeElement;
        }
        return el;
    });
}

export function renderBoxSvg(
    boxId: string,
    elements: CanvasElement[],
    width = 800,
    height = 280,
    meta?: BoxSvgRenderMeta,
): string {
    const scale = width;
    let gridDef = '';
    const gridStyle = meta?.gridStyle ?? BoxRegistry.getGridStyle(boxId);
    const density = meta?.gridDensity ?? BoxRegistry.getGridDensity(boxId) ?? 32;
    const step = Math.round((width / density) * 100) / 100;
    const safeBoxId = sanitizeBoxId(boxId);

    const bgTheme = meta?.bgTheme ?? BoxRegistry.getBgTheme(boxId);
    const customBg = meta?.customBgColor ?? BoxRegistry.getCustomBgColor(boxId);
    const isDark = resolveRenderBoxDarkTheme(meta);
    let bgFill = 'transparent';
    if (customBg) {
        bgFill = customBg;
    } else if (bgTheme === 'pitch-black') {
        bgFill = '#000000';
    } else if (bgTheme === 'graphite') {
        bgFill = '#27272a';
    } else if (bgTheme === 'default' && !meta?.omitDefaultBg) {
        bgFill = isDark ? '#1f1f21' : '#f4f5f8';
    }
    const bgRect = bgFill !== 'transparent' ? `<rect width="100%" height="100%" fill="${escapeXml(bgFill)}"/>` : '';

    if (gridStyle === 'dots') {
        gridDef = `<pattern id="apolo-grid-${safeBoxId}" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><circle cx="${step / 2}" cy="${step / 2}" r="1.5" fill="rgba(128,128,128,0.3)"/></pattern><rect width="100%" height="100%" fill="url(#apolo-grid-${safeBoxId})"/>`;
    } else if (gridStyle === 'grid') {
        gridDef = `<pattern id="apolo-grid-${safeBoxId}" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><path d="M ${step} 0 L 0 0 0 ${step}" fill="none" stroke="rgba(128,128,128,0.2)" stroke-width="1"/></pattern><rect width="100%" height="100%" fill="url(#apolo-grid-${safeBoxId})"/>`;
    } else if (gridStyle === 'ruled') {
        gridDef = `<pattern id="apolo-grid-${safeBoxId}" width="100%" height="${step}" patternUnits="userSpaceOnUse"><line x1="0" y1="${step}" x2="100%" y2="${step}" stroke="rgba(128,128,128,0.2)" stroke-width="1"/></pattern><rect width="100%" height="100%" fill="url(#apolo-grid-${safeBoxId})"/>`;
    }

    const { defsMarkup, contentMarkup } = collectDefsAndRenderElements(elements, scale);
    const defsTag = defsMarkup ? `<defs>${defsMarkup}</defs>` : '<defs/>';

    let recordAttr = '';
    if (!meta?.omitDefaultBg) {
        const recordPayload = {
            boxId,
            height,
            ...(meta?.lastTop !== undefined ? { lastTop: meta.lastTop } : {}),
            gridVisible: meta?.gridVisible ?? BoxRegistry.isGridVisible(boxId),
            gridStyle,
            gridDensity: density,
            snapToGrid: meta?.snapToGrid ?? BoxRegistry.isSnapActive(boxId),
            bgTheme,
            ...(customBg ? { customBgColor: customBg } : {}),
            accentColor: meta?.accentColor ?? BoxRegistry.getAccentColor(boxId),
            borderOutline: meta?.borderOutline ?? BoxRegistry.isBorderOutline(boxId),
            elements: stripTransientElementProps(elements),
        };
        recordAttr = ` data-apolo-box-record="${escapeXml(JSON.stringify(recordPayload))}"`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"${recordAttr}>${defsTag}${bgRect}${gridDef}<g fill="none" stroke-linecap="round" stroke-linejoin="round">${contentMarkup}</g></svg>`;
}

/** Parses embedded box metadata and parametric element payloads from a standalone `.<BaseName>.<boxId>.svg` file. */
export function parseBoxSvg(svgContent: string, fallbackBoxId?: string): BoxRecord | null {
    if (!svgContent) return null;
    const attrMatch = svgContent.match(/\bdata-apolo-box-record=(?:"([^"]*)"|'([^']*)')/i);
    if (!attrMatch) return null;

    const encoded = attrMatch[1] ?? attrMatch[2] ?? '';
    if (!encoded) return null;

    try {
        const jsonStr = unescapeXml(encoded);
        const parsed = JSON.parse(jsonStr) as Partial<BoxRecord>;
        if (!parsed || typeof parsed !== 'object') return null;

        const rawElements = Array.isArray(parsed.elements) ? parsed.elements : [];
        const elements: CanvasElement[] = [];
        for (const el of rawElements) {
            if (!el || typeof el !== 'object') continue;
            if (el.type === 'shape') {
                sanitizeLoadedShapeElement(el);
            }
            elements.push(el);
        }

        const height = typeof parsed.height === 'number' && Number.isFinite(parsed.height) ? parsed.height : 280;
        return {
            boxId: typeof parsed.boxId === 'string' && parsed.boxId ? parsed.boxId : (fallbackBoxId ?? ''),
            height,
            lastTop: typeof parsed.lastTop === 'number' ? parsed.lastTop : undefined,
            gridVisible: typeof parsed.gridVisible === 'boolean' ? parsed.gridVisible : undefined,
            gridStyle: parsed.gridStyle,
            gridDensity: typeof parsed.gridDensity === 'number' ? parsed.gridDensity : undefined,
            snapToGrid: typeof parsed.snapToGrid === 'boolean' ? parsed.snapToGrid : undefined,
            bgTheme: parsed.bgTheme,
            customBgColor: typeof parsed.customBgColor === 'string' ? parsed.customBgColor : undefined,
            accentColor: parsed.accentColor,
            borderOutline: typeof parsed.borderOutline === 'boolean' ? parsed.borderOutline : undefined,
            updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
            elements,
        };
    } catch (err) {
        console.warn('[ApoloCanvas] Failed to parse embedded box record from SVG:', err);
        return null;
    }
}

/**
 * Computes a deterministic cache key covering container geometry, box styling, theme polarity,
 * and every element's style, geometry, and stroke/shape payload.
 */
export function computeBoxPreviewSvgHash(
    boxId: string,
    elements: readonly CanvasElement[],
    width: number,
    height: number,
    meta?: BoxSvgRenderMeta,
): string {
    const gridStyle = meta?.gridStyle ?? BoxRegistry.getGridStyle(boxId);
    const density = meta?.gridDensity ?? BoxRegistry.getGridDensity(boxId) ?? 32;
    const bgTheme = meta?.bgTheme ?? BoxRegistry.getBgTheme(boxId);
    const customBg = meta?.customBgColor ?? BoxRegistry.getCustomBgColor(boxId);
    const isDark = resolveRenderBoxDarkTheme(meta);

    let hash = 0x811c9dc5;
    hash = fnv1aUpdate(
        hash,
        `${boxId}|${width}x${height}|${gridStyle}|${density}|${bgTheme}|${customBg ?? ''}|${meta?.omitDefaultBg ? 1 : 0}|${isDark ? 'd' : 'l'}|${elements.length}`,
    );

    for (const el of elements) {
        const s = el.style;
        hash = fnv1aUpdate(
            hash,
            `|${el.id}:${el.type}:${el.zIndex}:${s.color}:${s.width}:${s.opacity}:${s.pattern}:${s.profile ?? ''}:${s.isHighlighter ? 1 : 0}`,
        );
        hash = fnv1aUpdate(hash, `:${el.bounds.minX},${el.bounds.minY},${el.bounds.maxX},${el.bounds.maxY}`);
        if (el.type === 'stroke') {
            const pts = el.points;
            const len = pts.length;
            const mid = Math.floor(len / 4) * 4;
            hash = fnv1aUpdate(
                hash,
                `:${len}:${pts[0] ?? ''},${pts[1] ?? ''},${pts[mid] ?? ''},${pts[mid + 1] ?? ''},${pts[len - 4] ?? ''},${pts[len - 3] ?? ''}`,
            );
        } else {
            hash = fnv1aUpdate(
                hash,
                `:${el.shapeType}:${el.startX},${el.startY},${el.endX},${el.endY}:${el.rotation ?? 0}:${el.cornerRadius ?? 0}:${el.regularize ? 1 : 0}:${el.fillEnabled ? 1 : 0}:${el.fillColor ?? ''}:${el.fillOpacity ?? ''}:${el.fillPattern ?? ''}:${el.fillDensity ?? ''}:${JSON.stringify(el.shapeParams ?? null)}:${JSON.stringify(el.controlPoint ?? null)}:${JSON.stringify(el.vertices ?? null)}:${el.startBinding?.elementId ?? ''}:${el.endBinding?.elementId ?? ''}:${el.pathNodes?.length ?? 0}`,
            );
            if (el.pathNodes && el.pathNodes.length > 0) {
                for (const n of el.pathNodes) {
                    hash = fnv1aUpdate(hash, `;${n.x},${n.y},${n.handleIn?.x ?? ''},${n.handleIn?.y ?? ''},${n.handleOut?.x ?? ''},${n.handleOut?.y ?? ''}`);
                }
            }
        }
    }

    return `${elements.length}:${width}:${height}:${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Renders or updates the inline `.apolo-box-preview-svg` wrapper inside a Reading View space box.
 */
export function syncBoxPreviewSvg(
    boxEl: HTMLElement,
    boxId: string,
    boxElements: CanvasElement[],
    width: number,
    height: number,
    meta?: BoxSvgRenderMeta,
): void {
    let previewSvgWrap = boxEl.querySelector<HTMLElement>('.apolo-box-preview-svg');
    if (boxElements.length === 0) {
        if (previewSvgWrap) previewSvgWrap.remove();
        return;
    }
    if (!previewSvgWrap) {
        previewSvgWrap = document.createElement('div');
        previewSvgWrap.className = 'apolo-box-preview-svg';
        boxEl.appendChild(previewSvgWrap);
    }
    const targetW = Math.max(1, Math.round(width || 800));
    const effectiveMeta: BoxSvgRenderMeta = { ...meta, omitDefaultBg: true };
    const svgHash = computeBoxPreviewSvgHash(boxId, boxElements, targetW, height, effectiveMeta);
    if (previewSvgWrap.dataset.apoloSvgHash !== svgHash || previewSvgWrap.children.length === 0) {
        const svgMarkup = renderBoxSvg(boxId, boxElements, targetW, height, effectiveMeta);
        const parsedSvg = createSvgFromMarkup(svgMarkup);
        previewSvgWrap.replaceChildren(parsedSvg);
        previewSvgWrap.dataset.apoloSvgHash = svgHash;
    }
}

export function renderSvg(document: PageDocument): string {
    const scale = 800;
    let minX = 0; let minY = 0; let maxX = 800; let maxY = 600;
    if (document.elements.length) {
        minX = document.elements[0].bounds.minX * scale; minY = document.elements[0].bounds.minY * scale;
        maxX = document.elements[0].bounds.maxX * scale; maxY = document.elements[0].bounds.maxY * scale;
        for (const element of document.elements) {
            minX = Math.min(minX, element.bounds.minX * scale); minY = Math.min(minY, element.bounds.minY * scale);
            maxX = Math.max(maxX, element.bounds.maxX * scale); maxY = Math.max(maxY, element.bounds.maxY * scale);
        }
    }
    const padding = 16;
    const { defsMarkup, contentMarkup } = collectDefsAndRenderElements(document.elements, scale);
    const defsTag = defsMarkup ? `<defs>${defsMarkup}</defs>` : '';
    const width = Math.max(1, maxX - minX + padding * 2);
    const height = Math.max(1, maxY - minY + padding * 2);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - padding} ${minY - padding} ${width} ${height}" width="${width}" height="${height}">${defsTag}<g fill="none" stroke-linecap="round" stroke-linejoin="round">${contentMarkup}</g></svg>`;
}

interface CachedStrokeSvg {
    profile: string;
    color: string;
    width: number;
    opacity: number;
    contentWidth: number;
    anchorOffsetY: number;
    pointLength: number;
    firstX: number;
    firstY: number;
    out: PenSvgOutput;
}

const strokeSvgWeakCache = new WeakMap<StrokeElement, CachedStrokeSvg>();
const strokeSvgIdCache = new Map<string, CachedStrokeSvg>();

function getOrRenderSolidStrokeSvg(
    el: StrokeElement,
    contentWidth: number,
    anchorOffsetY = 0,
): PenSvgOutput {
    const data = el.points;
    if (data.length < 4) return { defs: {}, body: '' };

    const profile = el.style.profile ?? 'ball';
    const color = escapeXml(el.style.color || '#1e1e1e');
    const width = el.style.width || 3;
    const opacity = el.style.opacity !== undefined ? el.style.opacity : 1;
    const firstX = data[0];
    const firstY = data[1];

    const matchesCache = (hit: CachedStrokeSvg | undefined): hit is CachedStrokeSvg =>
        Boolean(
            hit &&
            hit.profile === profile &&
            hit.color === color &&
            hit.width === width &&
            hit.opacity === opacity &&
            Math.abs(hit.contentWidth - contentWidth) < 1e-3 &&
            Math.abs(hit.anchorOffsetY - anchorOffsetY) < 1e-3 &&
            hit.pointLength === data.length &&
            hit.firstX === firstX &&
            hit.firstY === firstY,
        );

    const weakHit = strokeSvgWeakCache.get(el);
    if (matchesCache(weakHit)) {
        return weakHit.out;
    }

    if (el.id) {
        const idHit = strokeSvgIdCache.get(el.id);
        if (matchesCache(idHit)) {
            strokeSvgWeakCache.set(el, idHit);
            return idHit.out;
        }
    }

    const pixelPoints: Point[] = [];
    for (let i = 0; i < data.length; i += 4) {
        pixelPoints.push({
            x: data[i] * contentWidth,
            y: data[i + 1] * contentWidth + anchorOffsetY,
            pressure: data[i + 2],
            time: data[i + 3],
        });
    }

    const out = getPenPlugin(profile).renderSvg(pixelPoints, {
        ...el.style,
        color,
        width,
        opacity,
    });

    const entry: CachedStrokeSvg = {
        profile,
        color,
        width,
        opacity,
        contentWidth,
        anchorOffsetY,
        pointLength: data.length,
        firstX,
        firstY,
        out,
    };

    strokeSvgWeakCache.set(el, entry);
    if (el.id) {
        if (strokeSvgIdCache.size > 2000) {
            strokeSvgIdCache.clear();
        }
        strokeSvgIdCache.set(el.id, entry);
    }
    return out;
}

function collectDefsAndRenderElements(
    elements: readonly CanvasElement[],
    scale: number,
): { defsMarkup: string; contentMarkup: string } {
    const defsMap = new Map<string, string>();
    const bodies: string[] = [];

    for (const el of elements) {
        const { defs, body } = renderElementWithDefs(el, scale, 0);
        if (defs) {
            if (typeof defs === 'string') {
                if (!defsMap.has(defs)) defsMap.set(defs, defs);
            } else {
                for (const [k, v] of Object.entries(defs)) {
                    if (v && !defsMap.has(k)) {
                        defsMap.set(k, v);
                    }
                }
            }
        }
        if (body) {
            bodies.push(body);
        }
    }

    return {
        defsMarkup: Array.from(defsMap.values()).join(''),
        contentMarkup: bodies.join('\n'),
    };
}

function isHighlighterStroke(el: StrokeElement): boolean {
    if (el.style.isHighlighter) return true;
    if (el.style.profile === 'hlr' || el.style.profile === 'hlf') return true;
    return false;
}

function renderElementWithDefs(element: CanvasElement, scale = 800, anchorOffsetY = 0): PenSvgOutput {
    const strokeWidth = element.style.width;
    const pattern = element.style.pattern;
    const lineCap = pattern === 'dashed' ? 'butt' : pattern === 'dotted' ? 'round' : element.style.lineCap ?? 'round';
    const dashArray = pattern === 'dashed'
        ? `${Math.max(6, strokeWidth * 3)} ${Math.max(4, strokeWidth * 2)}`
        : pattern === 'dotted'
            ? `0.5 ${Math.round(Math.max(4, strokeWidth * 2.2) * 10) / 10}`
            : '';
    const dash = dashArray ? ` stroke-dasharray="${dashArray}"` : '';
    const style = `stroke="${escapeXml(element.style.color)}" opacity="${element.style.opacity}" stroke-linecap="${lineCap}" stroke-linejoin="round"${dash}`;

    if (element.type === 'stroke') {
        const points = element.points;
        if (points.length < 4) return { defs: {}, body: '' };

        if (pattern === 'solid' && !isHighlighterStroke(element)) {
            return getOrRenderSolidStrokeSvg(element, scale, anchorOffsetY);
        }

        if (points.length === 4) {
            return {
                defs: {},
                body: `<circle cx="${points[0] * scale}" cy="${points[1] * scale + anchorOffsetY}" r="${element.style.width / 2}" fill="${escapeXml(element.style.color)}" opacity="${element.style.opacity}"/>`,
            };
        }

        let path = `M ${points[0] * scale} ${points[1] * scale + anchorOffsetY}`;
        for (let i = 4; i < points.length; i += 4) {
            path += ` L ${points[i] * scale} ${points[i + 1] * scale + anchorOffsetY}`;
        }
        return {
            defs: {},
            body: `<path d="${path}" ${style} stroke-width="${element.style.width}"/>`,
        };
    }

    const plugin = getShapePlugin(element.shapeType);
    const geom = shapeElementToGeometry(element, 0, anchorOffsetY, scale);
    const rotDeg = geom.rotation ? (geom.rotation * 180 / Math.PI) : 0;
    const svgOut = plugin.renderSvg(geom, {
        ...shapeElementStyle(element),
        ...(rotDeg !== 0 ? { shapeRotationDeg: rotDeg } as any : {}),
    });
    if (geom.rotation) {
        const norm = plugin.normalizeGeometry(geom);
        const cx = (norm.x0 + norm.x1) / 2;
        const cy = (norm.y0 + norm.y1) / 2;
        const deg = (geom.rotation * 180 / Math.PI).toFixed(2);
        return {
            defs: svgOut.defs,
            body: `<g transform="rotate(${deg} ${cx.toFixed(1)} ${cy.toFixed(1)})">\n  ${svgOut.body}\n</g>`,
        };
    }
    return svgOut;
}

export function renderElement(element: CanvasElement, scale = 800): string {
    return renderElementWithDefs(element, scale, 0).body;
}

function escapeXml(value: string): string {
    return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ?? character);
}

function unescapeXml(value: string): string {
    return value
        .replace(/&apos;|&#39;/g, "'")
        .replace(/&quot;|&#34;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');
}
