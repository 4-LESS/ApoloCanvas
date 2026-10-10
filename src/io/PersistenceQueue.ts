import { App, TFile } from 'obsidian';
import { CanvasElement, PageDocument, ShapeElement } from '../core/types';

/** Debounced, serialized vault writes with a native SVG/Markdown graph companion. */
export class PersistenceQueue {
    private timer: number | null = null;
    private pending: { document: PageDocument; file: TFile; pageId: string } | null = null;
    private chain: Promise<void> = Promise.resolve();
    private debounceMs: number;
    private companionSvgEnabled = true;
    private readonly onError?: (error: unknown) => void;

    constructor(private readonly app: App, debounceMs = 500, onError?: (error: unknown) => void) {
        this.debounceMs = debounceMs;
        this.onError = onError;
    }

    setDebounceMs(value: number): void { this.debounceMs = Math.max(50, value); }
    setCompanionSvgEnabled(value: boolean): void { this.companionSvgEnabled = value; }

    enqueue(document: PageDocument, file: TFile, pageId: string): void {
        this.pending = { document: JSON.parse(JSON.stringify(document)) as PageDocument, file, pageId };
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

    private async persist(document: PageDocument, file: TFile, pageId: string): Promise<void> {
        const adapter = this.app.vault.adapter;
        const folder = '.apolocanvas/data';
        await ensureDirectory(adapter, '.apolocanvas');
        await ensureDirectory(adapter, folder);
        await adapter.write(`${folder}/${pageId}.json`, JSON.stringify(document));

        if (this.companionSvgEnabled) {
            const svgPath = companionPath(file.path);
            await ensureDirectory(adapter, svgPath.slice(0, svgPath.lastIndexOf('/')));
            await adapter.write(svgPath, renderSvg(document));
            await this.cleanLegacyMarker(file, pageId);
        }
    }

    private async cleanLegacyMarker(file: TFile, _pageId: string): Promise<void> {
        try {
            const content = await this.app.vault.read(file);
            if (/<!--\s*apolo-canvas:start/i.test(content)) {
                const cleaned = content.replace(/<!--\s*apolo-canvas:start:[^>]*-->[\s\S]*?<!--\s*apolo-canvas:end:[^>]*-->\n?/gi, '').trimEnd() + '\n';
                if (cleaned !== content) {
                    await this.app.vault.modify(file, cleaned);
                }
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

function companionPath(notePath: string): string {
    const slash = notePath.lastIndexOf('/');
    const folder = slash >= 0 ? notePath.slice(0, slash) : '';
    const basename = (slash >= 0 ? notePath.slice(slash + 1) : notePath).replace(/\.md$/i, '').replace(/[\\/:*?"<>|]/g, '-');
    return `${folder ? `${folder}/` : ''}assets/ink/${basename}.ink.svg`;
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

