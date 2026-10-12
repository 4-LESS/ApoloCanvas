import { type Extension, RangeSetBuilder, StateEffect, StateField, type EditorState } from '@codemirror/state';
import {
    Decoration,
    type DecorationSet,
    EditorView,
    ViewPlugin,
    type ViewUpdate,
    WidgetType,
} from '@codemirror/view';

import { BoxRegistry } from '../core/BoxRegistry.ts';
export { BoxRegistry };

export const boxRegistryUpdateEffect = StateEffect.define<void>();

declare const require: ((id: string) => any) | undefined;

export interface BoxWidgetSnapshot {
    height: number;
    gridVisible: boolean;
    gridStyle: string;
    bgTheme: string;
    customBgColor?: string;
    accentColor: string;
    gridDensity: number;
    borderOutline: boolean;
    snapActive: boolean;
}

export class ApoloSpaceWidget extends WidgetType {
    readonly height: number;
    readonly id: string;
    readonly snapshot: BoxWidgetSnapshot;

    constructor(height: number, id: string, snapshot?: BoxWidgetSnapshot) {
        super();
        this.height = height;
        this.id = id;
        const sidecarHeight = BoxRegistry.getHeight(id);
        this.snapshot = snapshot ?? {
            height: Math.max(120, sidecarHeight ?? height),
            gridVisible: BoxRegistry.isGridVisible(id),
            gridStyle: BoxRegistry.getGridStyle(id),
            bgTheme: BoxRegistry.getBgTheme(id),
            customBgColor: BoxRegistry.getCustomBgColor(id),
            accentColor: BoxRegistry.getAccentColor(id),
            gridDensity: BoxRegistry.getGridDensity(id),
            borderOutline: BoxRegistry.isBorderOutline(id),
            snapActive: BoxRegistry.isSnapActive(id),
        };
    }

    get estimatedHeight(): number {
        return Math.max(120, BoxRegistry.getHeight(this.id) ?? this.snapshot.height);
    }

    toDOM(): HTMLElement {
        const sidecarHeight = BoxRegistry.getHeight(this.id);
        const effectiveHeight = Math.max(120, sidecarHeight ?? this.snapshot.height);

        const div = document.createElement('div');
        div.className = 'apolo-space-block apolo-space-widget apolo-space';
        div.dataset.apoloSpaceId = this.id;
        div.dataset.apoloSpace = this.id;
        div.dataset.apoloHeight = String(effectiveHeight);
        div.dataset.apoloGrid = (BoxRegistry.isGridVisible(this.id) ?? this.snapshot.gridVisible) ? 'true' : 'false';
        div.dataset.apoloGridStyle = BoxRegistry.getGridStyle(this.id) ?? this.snapshot.gridStyle;
        div.dataset.apoloBgTheme = BoxRegistry.getBgTheme(this.id) ?? this.snapshot.bgTheme;
        div.dataset.apoloAccent = BoxRegistry.getAccentColor(this.id) ?? this.snapshot.accentColor;
        div.dataset.apoloBorder = (BoxRegistry.isBorderOutline(this.id) ?? this.snapshot.borderOutline) ? 'true' : 'false';
        div.dataset.apoloSnap = (BoxRegistry.isSnapActive(this.id) ?? this.snapshot.snapActive) ? 'true' : 'false';
        const customBg = BoxRegistry.getCustomBgColor(this.id) ?? this.snapshot.customBgColor;
        if (customBg) {
            div.style.setProperty('background-color', customBg, 'important');
        }
        div.style.setProperty('height', `${effectiveHeight}px`, 'important');
        div.style.setProperty('min-height', `${effectiveHeight}px`, 'important');
        div.style.setProperty('width', '100%', 'important');
        div.style.setProperty('display', 'block', 'important');
        div.style.setProperty('user-select', 'none', 'important');

        // Subtle top-left 3-dots button for space settings
        const optionsBtn = document.createElement('button');
        optionsBtn.className = 'apolo-box-options-btn';
        optionsBtn.type = 'button';
        optionsBtn.dataset.apoloBoxId = this.id;
        optionsBtn.setAttribute('aria-label', 'Opciones del espacio');
        const dotsSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        dotsSvg.setAttribute('viewBox', '0 0 24 24');
        dotsSvg.setAttribute('width', '16');
        dotsSvg.setAttribute('height', '16');
        dotsSvg.setAttribute('fill', 'none');
        dotsSvg.setAttribute('stroke', 'currentColor');
        dotsSvg.setAttribute('stroke-width', '2');
        dotsSvg.setAttribute('stroke-linecap', 'round');
        dotsSvg.setAttribute('stroke-linejoin', 'round');
        dotsSvg.innerHTML = '<circle cx="12" cy="12" r="1.5"></circle><circle cx="19" cy="12" r="1.5"></circle><circle cx="5" cy="12" r="1.5"></circle>';
        optionsBtn.appendChild(dotsSvg);
        div.appendChild(optionsBtn);

        // 44px touch-target bottom resize handle (strictly for vertical dragging)
        const handle = document.createElement('div');
        handle.className = 'apolo-box-handle';
        handle.dataset.apoloHandleId = this.id;
        handle.setAttribute('role', 'button');
        handle.setAttribute('aria-label', 'Redimensionar caja de dibujo');

        const bar = document.createElement('div');
        bar.className = 'apolo-box-handle-bar';

        handle.appendChild(bar);
        div.appendChild(handle);

        return div;
    }

    updateDOM(dom: HTMLElement): boolean {
        const sidecarHeight = BoxRegistry.getHeight(this.id);
        const effectiveHeight = Math.max(120, sidecarHeight ?? this.snapshot.height);
        dom.style.setProperty('height', `${effectiveHeight}px`, 'important');
        dom.style.setProperty('min-height', `${effectiveHeight}px`, 'important');
        dom.dataset.apoloHeight = String(effectiveHeight);
        dom.dataset.apoloGrid = (BoxRegistry.isGridVisible(this.id) ?? this.snapshot.gridVisible) ? 'true' : 'false';
        dom.dataset.apoloGridStyle = BoxRegistry.getGridStyle(this.id) ?? this.snapshot.gridStyle;
        dom.dataset.apoloBgTheme = BoxRegistry.getBgTheme(this.id) ?? this.snapshot.bgTheme;
        dom.dataset.apoloAccent = BoxRegistry.getAccentColor(this.id) ?? this.snapshot.accentColor;
        dom.dataset.apoloBorder = (BoxRegistry.isBorderOutline(this.id) ?? this.snapshot.borderOutline) ? 'true' : 'false';
        dom.dataset.apoloSnap = (BoxRegistry.isSnapActive(this.id) ?? this.snapshot.snapActive) ? 'true' : 'false';
        const customBg = BoxRegistry.getCustomBgColor(this.id) ?? this.snapshot.customBgColor;
        if (customBg) {
            dom.style.setProperty('background-color', customBg, 'important');
        } else {
            dom.style.removeProperty('background-color');
        }
        return true;
    }

    ignoreEvent(): boolean {
        return true;
    }

    eq(other: ApoloSpaceWidget): boolean {
        return (
            this.id === other.id &&
            this.snapshot.height === other.snapshot.height &&
            this.snapshot.gridVisible === other.snapshot.gridVisible &&
            this.snapshot.gridStyle === other.snapshot.gridStyle &&
            this.snapshot.bgTheme === other.snapshot.bgTheme &&
            this.snapshot.customBgColor === other.snapshot.customBgColor &&
            this.snapshot.accentColor === other.snapshot.accentColor &&
            this.snapshot.gridDensity === other.snapshot.gridDensity &&
            this.snapshot.borderOutline === other.snapshot.borderOutline &&
            this.snapshot.snapActive === other.snapshot.snapActive
        );
    }
}

export function parseApoloSpaceHtml(html: string): { height: number; id: string } | null {
    const idMatch = html.match(/data-apolo-space(?:-id)?=["']([^"']+)["']/i);
    if (!idMatch) return null;
    const id = idMatch[1];
    const dataHMatch = html.match(/data-h=["'](\d+)["']/i);
    const styleHMatch = html.match(/height:\s*(\d+)px/i);
    let height = 240;
    if (dataHMatch) {
        height = parseInt(dataHMatch[1], 10);
    } else if (styleHMatch) {
        height = parseInt(styleHMatch[1], 10);
    }
    return { height: Math.max(20, Math.min(3000, height)), id };
}

export function parseApoloSpaceBlock(text: string): { height: number; id: string } {
    const heightMatch = text.match(/height:\s*(\d+)/i);
    const height = heightMatch ? Math.max(20, Math.min(3000, parseInt(heightMatch[1], 10))) : 200;
    const idMatch = text.match(/id:\s*([^\s\n\r"']+)/i);
    const id = idMatch ? idMatch[1] : '';
    return { height, id };
}

export interface SpaceMutation {
    id: string;
    height?: number;
    isNew?: boolean;
    remove?: boolean;
    targetLine?: number;
    type?: 'insert' | 'update' | 'delete';
}

export function applySpaceMutationToMarkdown(content: string, mutation: SpaceMutation): string {
    const isRemove = !!mutation.remove || mutation.type === 'delete';
    const isNew = !!mutation.isNew || mutation.type === 'insert';
    const height = mutation.height ?? 240;

    if (isRemove) {
        // Remove <div ... data-apolo-space="id" ...></div>
        const divRegex = new RegExp(`[\\r\\n]*<div\\s+[^>]*data-apolo-space(?:-id)?=["']${mutation.id}["'][^>]*><\\/div>`, 'gi');
        let res = content.replace(divRegex, '');
        // Also remove codeblock if present
        const codeBlockRegex = new RegExp(`[\\r\\n]*\`\`\`apolo-space[\\s\\S]*?id:\\s*${mutation.id}[\\s\\S]*?\`\`\``, 'gi');
        res = res.replace(codeBlockRegex, '');
        return res;
    }

    if (!isNew) {
        // Update existing block
        // 1. Try HTML div with data-h
        const dataHRegex = new RegExp(`(<div\\s+[^>]*data-apolo-space(?:-id)?=["']${mutation.id}["'][^>]*data-h=["'])\\d+(["'][^>]*><\\/div>)`, 'i');
        if (dataHRegex.test(content)) {
            return content.replace(dataHRegex, `$1${height}$2`);
        }
        // 2. Try HTML div with style height
        const divRegex = new RegExp(`(<div\\s+[^>]*data-apolo-space(?:-id)?=["']${mutation.id}["'][^>]*style=["'][^"']*height:\\s*)\\d+px([^"']*["'][^>]*><\\/div>)`, 'i');
        if (divRegex.test(content)) {
            return content.replace(divRegex, `$1${height}px$2`);
        }
        const generalDiv = new RegExp(`<div\\s+[^>]*data-apolo-space(?:-id)?=["']${mutation.id}["'][^>]*><\\/div>`, 'i');
        if (generalDiv.test(content)) {
            return content.replace(generalDiv, `<div data-apolo-space="${mutation.id}" data-h="${height}"></div>`);
        }
        // 2. Try codeblock
        const codeBlockRegex = new RegExp(`\`\`\`apolo-space([\\s\\S]*?id:\\s*${mutation.id}[\\s\\S]*?)\`\`\``, 'i');
        if (codeBlockRegex.test(content)) {
            return content.replace(codeBlockRegex, `\`\`\`apolo-space\nheight: ${height}\nid: ${mutation.id}\n\`\`\``);
        }
        return content;
    } else {
        // Insert new block as <div class="apolo-space" data-apolo-space="..." style="height:...px;"></div>
        const divTag = `<div class="apolo-space" data-apolo-space="${mutation.id}" style="height:${height}px;"></div>`;
        const lines = content.split('\n');
        const targetLine = Math.max(0, Math.min(lines.length, (mutation.targetLine ?? lines.length) + 1));
        if (targetLine < lines.length && lines[targetLine].trim() === '') {
            lines[targetLine] = divTag;
        } else {
            lines.splice(targetLine, 0, divTag);
        }
        return lines.join('\n');
    }
}

interface SpaceDecorationItem {
    from: number;
    to: number;
    height: number;
    id: string;
}

function isLivePreview(state: EditorState): boolean {
    try {
        // Safely access obsidian in runtime without breaking Node test runner
        const obs = typeof require === 'function' ? (require('obsidian') as { editorLivePreviewField?: any } | undefined) : null;
        if (obs?.editorLivePreviewField) {
            const lp = state.field(obs.editorLivePreviewField, false);
            return lp === undefined ? true : Boolean(lp);
        }
    } catch {
        // Fallback for tests or environments without obsidian runtime
    }
    return true;
}

function buildApoloSpaceDecorations(state: EditorState): DecorationSet {
    if (!isLivePreview(state)) {
        return Decoration.none;
    }

    const builder = new RangeSetBuilder<Decoration>();
    const doc = state.doc;
    const text = doc.toString();
    const items: SpaceDecorationItem[] = [];
    const seenIds = new Set<string>();

    // 1. Match HTML div blocks: <div class="apolo-space" data-apolo-space="..." style="height:...px;"></div>
    const htmlRegex = /<div\s+[^>]*data-apolo-space(?:-id)?=["'][^"']+["'][^>]*>\s*<\/div>/gi;
    let match: RegExpExecArray | null;
    while ((match = htmlRegex.exec(text)) !== null) {
        const parsed = parseApoloSpaceHtml(match[0]);
        if (parsed && parsed.id && !seenIds.has(parsed.id)) {
            seenIds.add(parsed.id);
            const line = doc.lineAt(match.index);
            items.push({
                from: line.from,
                to: line.to,
                height: parsed.height,
                id: parsed.id,
            });
        }
    }

    // 2. Match ```apolo-space ... ``` codeblocks (backward compatibility)
    const codeRegex = /```apolo-space\b([\s\S]*?)```/gi;
    while ((match = codeRegex.exec(text)) !== null) {
        const parsed = parseApoloSpaceBlock(match[1]);
        if (parsed && parsed.id && !seenIds.has(parsed.id)) {
            seenIds.add(parsed.id);
            const startLine = doc.lineAt(match.index);
            const endLine = doc.lineAt(match.index + match[0].length);
            items.push({
                from: startLine.from,
                to: endLine.to,
                height: parsed.height,
                id: parsed.id,
            });
        }
    }

    // Sort items monotonically by start position as required by RangeSetBuilder
    items.sort((a, b) => a.from - b.from);

    for (const item of items) {
        if (item.from <= item.to) {
            builder.add(
                item.from,
                item.to,
                Decoration.replace({
                    widget: new ApoloSpaceWidget(item.height, item.id),
                    block: true,
                }),
            );
        } else {
            console.warn('[ApoloCanvas] Skipping malformed space block range:', item);
        }
    }

    return builder.finish();
}

export const apoloSpaceField = StateField.define<DecorationSet>({
    create(state: EditorState): DecorationSet {
        return buildApoloSpaceDecorations(state);
    },
    update(decorations: DecorationSet, tr): DecorationSet {
        const hasBoxEffect = tr.effects.some((e) => e.is(boxRegistryUpdateEffect));
        if (tr.docChanged || tr.reconfigured || (tr as any).viewportChanged || hasBoxEffect) {
            return buildApoloSpaceDecorations(tr.state);
        }
        return decorations.map(tr.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
});

export const apoloSpaceSyncPlugin = ViewPlugin.fromClass(
    class {
        private view: EditorView;
        private unsubscribe: (() => void) | null = null;
        private lastViewportFrom = -1;
        private lastViewportTo = -1;
        private scheduledDispatch = false;

        constructor(view: EditorView) {
            this.view = view;
            this.unsubscribe = BoxRegistry.onChange(() => {
                this.requestSync();
            });
        }

        update(update: ViewUpdate): void {
            if (update.viewportChanged) {
                const vp = update.view.viewport;
                if (vp.from !== this.lastViewportFrom || vp.to !== this.lastViewportTo) {
                    this.lastViewportFrom = vp.from;
                    this.lastViewportTo = vp.to;
                    this.requestSync();
                }
            }
        }

        private requestSync(): void {
            if (this.scheduledDispatch) return;
            this.scheduledDispatch = true;
            queueMicrotask(() => {
                this.scheduledDispatch = false;
                if (this.view.dom.isConnected) {
                    this.view.dispatch({
                        effects: boxRegistryUpdateEffect.of(),
                    });
                }
            });
        }

        destroy(): void {
            if (this.unsubscribe) {
                this.unsubscribe();
                this.unsubscribe = null;
            }
        }
    },
);

export const apoloSpaceExtension: Extension = [apoloSpaceField, apoloSpaceSyncPlugin];
