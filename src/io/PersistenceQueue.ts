import type { App, TFile } from 'obsidian';
import type { BoxAccentColor, BoxBgTheme, BoxGridStyle, BoxMetadata, CanvasElement, LayoutHint, PageDocument, Point, StrokeElement } from '../core/types.ts';
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

const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const STRICT_SAFE_BOX_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Feeds a string into a running 32-bit FNV-1a accumulator. */
function fnv1aUpdate(hash: number, input: string): number {
    let h = hash;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Computes a deterministic 8-hex-character 32-bit FNV-1a hash for collision-free ID disambiguation. */
function fnv1aHex(input: string): string {
    return fnv1aUpdate(0x811c9dc5, input).toString(16).padStart(8, '0');
}

/**
 * Normalizes a vault-relative note path by converting backslashes to forward slashes,
 * stripping control characters, and removing empty, `.` or `..` traversal segments.
 */
export function normalizeVaultNotePath(notePath: string): string {
    const cleaned = (notePath ?? '').replace(/[\x00-\x1f\x7f]/g, '').replace(/\\/g, '/');
    const segments: string[] = [];
    for (const rawSeg of cleaned.split('/')) {
        const seg = rawSeg.trim();
        if (!seg || seg === '.' || seg === '..') continue;
        segments.push(seg);
    }
    return segments.join('/');
}

/**
 * Converts a user-supplied box ID into a strict, cross-platform filesystem-safe identifier
 * matching `/^[a-zA-Z0-9_-]{1,64}$/` and guaranteed not to be a Windows reserved device name
 * or contain path separators / traversal sequences.
 * Clean alphanumeric IDs (`box-abc`, `b1`, `c_123456`) are preserved as-is; any ID containing
 * special characters, dots, slashes, spaces, reserved names, or excessive length is converted
 * into `<safe-slug>_<8char-fnv1a-hash>`.
 */
export function sanitizeBoxId(rawId: string): string {
    const trimmed = (rawId ?? '').trim();
    const normalized = normalizeBoxId(trimmed);
    if (
        normalized.length > 0 &&
        normalized === trimmed &&
        STRICT_SAFE_BOX_ID_RE.test(normalized) &&
        !WINDOWS_RESERVED_NAME_RE.test(normalized)
    ) {
        return normalized;
    }

    const source = normalized || trimmed;
    let slug = source
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '')
        .slice(0, 32)
        .replace(/[-_]+$/g, '');

    if (!slug || WINDOWS_RESERVED_NAME_RE.test(slug)) {
        slug = 'box';
    }

    const hash = fnv1aHex(source || 'empty');
    return `${slug}_${hash}`;
}

/** Resolves the sanitized vault storage path `.apolocanvas/boxes/<safeId>.json` for a box ID. */
export function boxStoragePath(boxId: string): string {
    return `.apolocanvas/boxes/${sanitizeBoxId(boxId)}.json`;
}

export function notePathToKey(notePath: string): string {
    const normalized = normalizeVaultNotePath(notePath);
    let hex = '';
    for (let i = 0; i < normalized.length; i++) {
        hex += normalized.charCodeAt(i).toString(16).padStart(4, '0');
    }
    if (!hex) return '0000';
    // Cap filename length well below the 255-byte filesystem limit on all platforms
    if (hex.length > 160) {
        return `${hex.slice(0, 144)}_${fnv1aHex(normalized)}`;
    }
    return hex;
}

export function keyToNotePath(key: string): string {
    const hexPart = key.includes('_') ? key.slice(0, key.indexOf('_')) : key;
    let result = '';
    for (let i = 0; i + 4 <= hexPart.length; i += 4) {
        result += String.fromCharCode(parseInt(hexPart.slice(i, i + 4), 16));
    }
    return result;
}

/** Resolves the sanitized vault storage path `.apolocanvas/notes/<noteKey>.json` for a note path. */
export function noteStoragePath(notePath: string): string {
    return `.apolocanvas/notes/${notePathToKey(notePath)}.json`;
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

/** Debounced, serialized vault writes with box-by-box and note-level persistence without frontmatter pollution. */
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
            this.flush().catch((error: unknown) => {
                console.error('[ApoloCanvas] Save failed:', error);
                this.onError?.(error);
            });
        }, this.debounceMs);
    }

    async flush(): Promise<void> {
        if (this.timer !== null) { globalThis.clearTimeout(this.timer); this.timer = null; }
        const batch = this.pending;
        this.pending = null;
        if (!batch) return this.chain;
        this.chain = this.chain.catch(() => undefined).then(() => this.persist(batch.document, batch.file, batch.pageId));
        return this.chain;
    }

    /** Loads document without modifying frontmatter: freehand ink by note path and boxes by boxId. */
    async loadDocumentForNote(file: TFile): Promise<PageDocument> {
        // 1. Check in-memory cache first to guarantee zero data loss on rapid tab switching
        const inMemory = this.getDocument(file.path);
        if (inMemory) {
            inMemory.notePath = file.path;
            return inMemory;
        }

        const adapter = this.app.vault.adapter;
        let content = '';
        try {
            content = await this.app.vault.read(file);
        } catch {
            content = '';
        }

        // 2. Scan box IDs present in the note (HTML blocks and codeblocks), normalizing each ID
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

        // 3. Load freehand ink
        const noteFile = noteStoragePath(file.path);
        let freehandElements: CanvasElement[] = [];
        let layoutHint: LayoutHint | undefined = undefined;

        if (await adapter.exists(noteFile)) {
            try {
                const noteData = JSON.parse(await adapter.read(noteFile)) as NoteRecord;
                freehandElements = noteData.elements || [];
                layoutHint = noteData.layoutHint;

                // Silently clean up orphaned strokes older than 30 days without intrusive notifications
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
                console.error(`[ApoloCanvas] Could not read freehand ink for ${file.path}:`, err);
            }
        }

        // 4. Load boxes using sanitized filesystem paths
        const boxElements: CanvasElement[] = [];
        const boxesMeta: Record<string, BoxMetadata> = {};

        for (const boxId of boxIds) {
            const boxFile = boxStoragePath(boxId);
            if (await adapter.exists(boxFile)) {
                try {
                    const boxData = JSON.parse(await adapter.read(boxFile)) as BoxRecord;
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
                    console.error(`[ApoloCanvas] Could not read box ${boxId}:`, err);
                }
            }
        }

        const elements = [...freehandElements, ...boxElements];
        for (const el of elements) {
            if (el.type === 'shape') sanitizeLoadedShapeElement(el);
        }
        // Connectors whose target shape was not loaded (e.g. an orphaned box) must not dangle
        clearDanglingBindings(elements);

        const now = Date.now();
        const doc: PageDocument = {
            schemaVersion: 1,
            version: 1,
            id: file.path,
            notePath: file.path,
            elements,
            boxes: boxesMeta,
            layoutHint,
            createdAt: now,
            updatedAt: now,
        };
        this.cacheByPageId.set(file.path, doc);
        return doc;
    }

    /** Discharges pending writes immediately and updates file paths when a note is renamed. */
    async onFileRenamed(oldPath: string, newFile: TFile): Promise<void> {
        for (const doc of this.cacheByPageId.values()) {
            if (doc.notePath === oldPath) {
                doc.notePath = newFile.path;
                doc.id = newFile.path;
            }
        }
        if (this.pending && this.pending.file.path === oldPath) {
            this.pending.file = newFile;
            this.pending.document.notePath = newFile.path;
            this.pending.document.id = newFile.path;
        }

        const adapter = this.app.vault.adapter;
        const oldNoteFile = noteStoragePath(oldPath);
        const newNoteFile = noteStoragePath(newFile.path);
        try {
            if (await adapter.exists(oldNoteFile)) {
                await ensureDirectory(adapter, '.apolocanvas/notes');
                await adapter.rename(oldNoteFile, newNoteFile);
            }
        } catch (e) {
            console.warn('[ApoloCanvas] Could not rename note storage:', e);
        }

        if (this.companionSvgEnabled) {
            const oldSvg = companionPath(oldPath);
            const newSvg = companionPath(newFile.path);
            try {
                if (await adapter.exists(oldSvg)) {
                    await ensureDirectory(adapter, newSvg.slice(0, newSvg.lastIndexOf('/')));
                    await adapter.rename(oldSvg, newSvg);
                }
            } catch (err) {
                console.warn('[ApoloCanvas] Could not rename companion SVG:', err);
            }
        }

        await this.flush();
    }

    /** Cleans up note storage when a file is deleted. Boxes are kept for 30 days as orphans. */
    async onFileDeleted(deletedPath: string): Promise<void> {
        this.cacheByPageId.delete(deletedPath);
        const adapter = this.app.vault.adapter;
        const noteFile = noteStoragePath(deletedPath);
        try {
            if (await adapter.exists(noteFile)) {
                await adapter.remove(noteFile);
            }
        } catch (e) {
            console.warn('[ApoloCanvas] Could not remove deleted note storage:', e);
        }
    }

    private async persist(document: PageDocument, file: TFile, pageId: string): Promise<void> {
        const adapter = this.app.vault.adapter;
        await ensureDirectory(adapter, '.apolocanvas');
        await ensureDirectory(adapter, '.apolocanvas/boxes');
        await ensureDirectory(adapter, '.apolocanvas/notes');

        // Split elements into boxes and freehand
        const freehandElements: CanvasElement[] = [];
        const boxElementsMap = new Map<string, CanvasElement[]>();

        if (document.boxes) {
            for (const rawBoxId of Object.keys(document.boxes)) {
                const boxId = normalizeBoxId(rawBoxId) || rawBoxId;
                if (boxId) {
                    boxElementsMap.set(boxId, []);
                }
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

        // 1. Save freehand ink for this note by note path
        const noteRecord: NoteRecord = {
            notePath: file.path,
            updatedAt: Date.now(),
            elements: freehandElements,
            layoutHint: document.layoutHint,
        };
        await adapter.write(noteStoragePath(file.path), JSON.stringify(noteRecord));

        // 2. Save each box by sanitized boxId path
        for (const [boxId, elements] of boxElementsMap.entries()) {
            const meta = document.boxes?.[boxId];
            const boxRecord: BoxRecord = {
                boxId,
                height: meta?.height ?? 280,
                lastTop: meta?.lastTop,
                gridVisible: meta?.gridVisible ?? BoxRegistry.isGridVisible(boxId),
                gridStyle: meta?.gridStyle ?? BoxRegistry.getGridStyle(boxId),
                gridDensity: meta?.gridDensity ?? BoxRegistry.getGridDensity(boxId),
                snapToGrid: meta?.snapToGrid ?? BoxRegistry.isSnapActive(boxId),
                bgTheme: meta?.bgTheme ?? BoxRegistry.getBgTheme(boxId),
                customBgColor: meta?.customBgColor ?? BoxRegistry.getCustomBgColor(boxId),
                accentColor: meta?.accentColor ?? BoxRegistry.getAccentColor(boxId),
                borderOutline: meta?.borderOutline ?? BoxRegistry.isBorderOutline(boxId),
                updatedAt: Date.now(),
                elements,
            };
            await adapter.write(boxStoragePath(boxId), JSON.stringify(boxRecord));
        }

        // 3. Companion SVG if enabled
        if (this.companionSvgEnabled) {
            const svgPath = companionPath(file.path);
            const folder = svgPath.slice(0, svgPath.lastIndexOf('/'));
            await ensureDirectory(adapter, folder);
            await adapter.write(svgPath, renderSvg(document));

            // Export standalone companion SVG for each box
            for (const [boxId, elements] of boxElementsMap.entries()) {
                const boxMeta = document.boxes?.[boxId];
                const boxH = boxMeta?.height ?? 280;
                const boxSvgPath = boxCompanionPath(file.path, boxId);
                const boxSvgContent = renderBoxSvg(boxId, elements, 800, boxH, boxMeta);
                await adapter.write(boxSvgPath, boxSvgContent);
            }

            await this.cleanLegacyMarker(file, pageId);
        }
    }

    private async cleanLegacyMarker(file: TFile, _pageId: string): Promise<void> {
        try {
            const content = await this.app.vault.read(file);
            let cleaned = content;
            if (/<!--\s*apolo-canvas:start/i.test(cleaned)) {
                cleaned = cleaned.replace(/<!--\s*apolo-canvas:start:[^>]*-->[\s\S]*?<!--\s*apolo-canvas:end:[^>]*-->\n?/gi, '').trimEnd() + '\n';
            }
            if (/^---\n[\s\S]*?apolo-page-id:[\s\S]*?---\n/m.test(cleaned)) {
                cleaned = cleaned.replace(/^(\s*apolo-page-id:\s*[^\n\r]*\n)/m, '');
            }
            if (cleaned !== content) {
                await this.app.vault.modify(file, cleaned);
            }
        } catch {
            // Non-critical cleanup
        }
    }
}

async function ensureDirectory(adapter: App['vault']['adapter'], path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!(await adapter.exists(current))) await adapter.mkdir(current);
    }
}

function sanitizePathSegment(segment: string, fallback = 'note'): string {
    let clean = segment
        .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '-')
        .replace(/^\.+|\.+$/g, '')
        .trim();
    if (!clean || clean === '.' || clean === '..' || WINDOWS_RESERVED_NAME_RE.test(clean)) {
        clean = clean ? `_${clean}` : fallback;
    }
    if (clean.length > 120) {
        clean = `${clean.slice(0, 100)}_${fnv1aHex(segment)}`;
    }
    return clean;
}

function resolveSafeNoteCompanionParts(notePath: string): { folder: string; basename: string } {
    const normalized = normalizeVaultNotePath(notePath);
    const segments = normalized ? normalized.split('/') : [];
    const rawFile = segments.pop() ?? 'note';
    const safeFolders = segments.map(seg => sanitizePathSegment(seg, 'folder'));
    const folder = safeFolders.join('/');
    const rawBasename = rawFile.replace(/\.md$/i, '');
    const basename = sanitizePathSegment(rawBasename, 'note');
    return { folder, basename };
}

export function companionPath(notePath: string): string {
    const { folder, basename } = resolveSafeNoteCompanionParts(notePath);
    return `${folder ? `${folder}/` : ''}assets/ink/${basename}.ink.svg`;
}

export function boxCompanionPath(notePath: string, boxId: string): string {
    const { folder, basename } = resolveSafeNoteCompanionParts(notePath);
    const safeBoxId = sanitizeBoxId(boxId);
    return `${folder ? `${folder}/` : ''}assets/ink/${basename}.${safeBoxId}.ink.svg`;
}

export interface BoxSvgRenderMeta {
    height?: number;
    gridStyle?: string;
    gridDensity?: number;
    bgTheme?: string;
    customBgColor?: string;
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
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${defsTag}${bgRect}${gridDef}<g fill="none" stroke-linecap="round" stroke-linejoin="round">${contentMarkup}</g></svg>`;
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

