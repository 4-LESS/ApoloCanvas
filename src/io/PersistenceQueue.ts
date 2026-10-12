import type { App, TFile } from 'obsidian';
import type { BoxAccentColor, BoxBgTheme, BoxGridStyle, BoxMetadata, CanvasElement, LayoutHint, PageDocument, ShapeElement } from '../core/types.ts';
import { BoxRegistry } from '../core/BoxRegistry.ts';

export function notePathToKey(notePath: string): string {
    let hex = '';
    for (let i = 0; i < notePath.length; i++) {
        hex += notePath.charCodeAt(i).toString(16).padStart(4, '0');
    }
    return hex;
}

export function keyToNotePath(key: string): string {
    let result = '';
    for (let i = 0; i < key.length; i += 4) {
        result += String.fromCharCode(parseInt(key.slice(i, i + 4), 16));
    }
    return result;
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
    private timer: number | null = null;
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
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
            this.timer = null;
            this.flush().catch((error: unknown) => {
                console.error('[ApoloCanvas] Save failed:', error);
                this.onError?.(error);
            });
        }, this.debounceMs);
    }

    async flush(): Promise<void> {
        if (this.timer !== null) { window.clearTimeout(this.timer); this.timer = null; }
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

        // 2. Scan box IDs present in the note
        const boxIds = new Set<string>();
        const boxRegex = /data-apolo-space(?:-id)?=["']([^"']+)["']/gi;
        let match: RegExpExecArray | null;
        while ((match = boxRegex.exec(content)) !== null) {
            boxIds.add(match[1]);
        }

        // 3. Load freehand ink
        const noteKey = notePathToKey(file.path);
        const noteFile = `.apolocanvas/notes/${noteKey}.json`;
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
                        const bId = el.blockId.slice(6);
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

        // 4. Load boxes
        const boxElements: CanvasElement[] = [];
        const boxesMeta: Record<string, BoxMetadata> = {};

        for (const boxId of boxIds) {
            const boxFile = `.apolocanvas/boxes/${boxId}.json`;
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

        const now = Date.now();
        const doc: PageDocument = {
            schemaVersion: 1,
            version: 1,
            id: file.path,
            notePath: file.path,
            elements: [...freehandElements, ...boxElements],
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
        const oldNoteFile = `.apolocanvas/notes/${notePathToKey(oldPath)}.json`;
        const newNoteFile = `.apolocanvas/notes/${notePathToKey(newFile.path)}.json`;
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
        const noteFile = `.apolocanvas/notes/${notePathToKey(deletedPath)}.json`;
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
            for (const boxId of Object.keys(document.boxes)) {
                boxElementsMap.set(boxId, []);
            }
        }

        for (const el of document.elements) {
            if (el.blockId && el.blockId.startsWith('space:')) {
                const boxId = el.blockId.slice(6);
                let list = boxElementsMap.get(boxId);
                if (!list) {
                    list = [];
                    boxElementsMap.set(boxId, list);
                }
                list.push(el);
            } else {
                freehandElements.push(el);
            }
        }

        // 1. Save freehand ink for this note by note path
        const noteKey = notePathToKey(file.path);
        const noteRecord: NoteRecord = {
            notePath: file.path,
            updatedAt: Date.now(),
            elements: freehandElements,
            layoutHint: document.layoutHint,
        };
        await adapter.write(`.apolocanvas/notes/${noteKey}.json`, JSON.stringify(noteRecord));

        // 2. Save each box by boxId
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
            await adapter.write(`.apolocanvas/boxes/${boxId}.json`, JSON.stringify(boxRecord));
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
    const parts = path.split('/');
    let current = '';
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!(await adapter.exists(current))) await adapter.mkdir(current);
    }
}

export function companionPath(notePath: string): string {
    const slash = notePath.lastIndexOf('/');
    const folder = slash >= 0 ? notePath.slice(0, slash) : '';
    const basename = (slash >= 0 ? notePath.slice(slash + 1) : notePath).replace(/\.md$/i, '').replace(/[\\/:*?"<>|]/g, '-');
    return `${folder ? `${folder}/` : ''}assets/ink/${basename}.ink.svg`;
}

export function boxCompanionPath(notePath: string, boxId: string): string {
    const slash = notePath.lastIndexOf('/');
    const folder = slash >= 0 ? notePath.slice(0, slash) : '';
    const basename = (slash >= 0 ? notePath.slice(slash + 1) : notePath).replace(/\.md$/i, '').replace(/[\\/:*?"<>|]/g, '-');
    return `${folder ? `${folder}/` : ''}assets/ink/${basename}.${boxId}.ink.svg`;
}

export function renderBoxSvg(
    boxId: string,
    elements: CanvasElement[],
    width = 800,
    height = 280,
    meta?: { height?: number; gridStyle?: string; gridDensity?: number; bgTheme?: string; customBgColor?: string },
): string {
    const scale = width;
    let gridDef = '';
    const gridStyle = meta?.gridStyle ?? BoxRegistry.getGridStyle(boxId);
    const density = meta?.gridDensity ?? BoxRegistry.getGridDensity(boxId) ?? 32;
    const step = Math.round((width / density) * 100) / 100;

    const bgTheme = meta?.bgTheme ?? BoxRegistry.getBgTheme(boxId);
    const customBg = meta?.customBgColor ?? BoxRegistry.getCustomBgColor(boxId);
    let bgFill = 'transparent';
    if (customBg) {
        bgFill = customBg;
    } else if (bgTheme === 'pitch-black') {
        bgFill = '#000000';
    } else if (bgTheme === 'graphite') {
        bgFill = '#27272a';
    } else if (bgTheme === 'default') {
        bgFill = '#1f1f21';
    }
    const bgRect = bgFill !== 'transparent' ? `<rect width="100%" height="100%" fill="${bgFill}"/>` : '';

    if (gridStyle === 'dots') {
        gridDef = `<pattern id="apolo-grid-${boxId}" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><circle cx="${step / 2}" cy="${step / 2}" r="1.5" fill="rgba(128,128,128,0.3)"/></pattern><rect width="100%" height="100%" fill="url(#apolo-grid-${boxId})"/>`;
    } else if (gridStyle === 'grid') {
        gridDef = `<pattern id="apolo-grid-${boxId}" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><path d="M ${step} 0 L 0 0 0 ${step}" fill="none" stroke="rgba(128,128,128,0.2)" stroke-width="1"/></pattern><rect width="100%" height="100%" fill="url(#apolo-grid-${boxId})"/>`;
    } else if (gridStyle === 'ruled') {
        gridDef = `<pattern id="apolo-grid-${boxId}" width="100%" height="${step}" patternUnits="userSpaceOnUse"><line x1="0" y1="${step}" x2="100%" y2="${step}" stroke="rgba(128,128,128,0.2)" stroke-width="1"/></pattern><rect width="100%" height="100%" fill="url(#apolo-grid-${boxId})"/>`;
    }

    const content = elements.map(el => renderElement(el, scale)).join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><defs/>${bgRect}${gridDef}<g fill="none" stroke-linecap="round" stroke-linejoin="round">${content}</g></svg>`;
}

function vaultRelativeLink(notePath: string, assetPath: string): string {
    const noteFolder = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
    const prefix = noteFolder ? `${noteFolder}/` : '';
    return assetPath.startsWith(prefix) ? assetPath.slice(prefix.length) : assetPath;
}

function renderSvg(document: PageDocument): string {
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
    const content = document.elements.map(el => renderElement(el, scale)).join('\n');
    const width = Math.max(1, maxX - minX + padding * 2);
    const height = Math.max(1, maxY - minY + padding * 2);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - padding} ${minY - padding} ${width} ${height}" width="${width}" height="${height}"><g fill="none" stroke-linecap="round" stroke-linejoin="round">${content}</g></svg>`;
}

function renderElement(element: CanvasElement, scale = 800): string {
    const style = `stroke="${escapeXml(element.style.color)}" opacity="${element.style.opacity}" stroke-linecap="${element.style.lineCap ?? 'round'}" stroke-linejoin="round"`;
    if (element.type === 'stroke') {
        const points = element.points;
        if (points.length < 4) return '';
        const dash = element.style.pattern === 'dashed' ? ' stroke-dasharray="8 6"' : element.style.pattern === 'dotted' ? ' stroke-dasharray="1 5"' : '';
        if (points.length === 4) return `<circle cx="${points[0] * scale}" cy="${points[1] * scale}" r="${element.style.width * pressureScale(points[2]) / 2}" fill="${escapeXml(element.style.color)}" opacity="${element.style.opacity}"/>`;
        if (element.style.pattern !== 'solid') {
            let path = `M ${points[0] * scale} ${points[1] * scale}`;
            for (let i = 4; i < points.length; i += 4) path += ` L ${points[i] * scale} ${points[i + 1] * scale}`;
            return `<path d="${path}" ${style} stroke-width="${element.style.width}"${dash}/>`;
        }
        let paths = '';
        for (let i = 4; i < points.length; i += 4) {
            const width = element.style.width * pressureScale((points[i - 2] + points[i + 2]) / 2);
            paths += `<path d="M ${points[i - 4] * scale} ${points[i - 3] * scale} L ${points[i] * scale} ${points[i + 1] * scale}" ${style} stroke-width="${width}"${dash}/>`;
        }
        return paths;
    }
    const startX = element.startX * scale;
    const startY = element.startY * scale;
    const endX = element.endX * scale;
    const endY = element.endY * scale;
    const x = Math.min(startX, endX); const y = Math.min(startY, endY);
    const width = Math.abs(endX - startX); const height = Math.abs(endY - startY);
    const fill = element.fillColor ? ` fill="${escapeXml(element.fillColor)}"` : '';
    const shape: ShapeElement = element;
    switch (shape.shapeType) {
        case 'line': return `<path d="M ${startX} ${startY} L ${endX} ${endY}" ${style}/>`;
        case 'arrow': return `<path d="M ${startX} ${startY} L ${endX} ${endY} M ${endX - 10} ${endY - 5} L ${endX} ${endY} L ${endX - 5} ${endY - 10}" ${style}/>`;
        case 'ellipse': return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" ${style}${fill}/>`;
        case 'triangle': return `<path d="M ${x + width / 2} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z" ${style}${fill}/>`;
        case 'rounded-rect': return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" ${style}${fill}/>`;
        default: return `<rect x="${x}" y="${y}" width="${width}" height="${height}" ${style}${fill}/>`;
    }
}

function escapeXml(value: string): string {
    return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ?? character);
}

function pressureScale(pressure: number): number { return 0.18 + Math.max(0, Math.min(1, pressure)) * 1.42; }

