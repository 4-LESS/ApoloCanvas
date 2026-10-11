import { RangeSetBuilder } from '@codemirror/state';
import {
    Decoration,
    DecorationSet,
    EditorView,
    ViewPlugin,
    ViewUpdate,
    WidgetType,
} from '@codemirror/view';

export class ApoloSpaceWidget extends WidgetType {
    constructor(readonly height: number, readonly id: string) {
        super();
    }

    toDOM(): HTMLElement {
        const div = document.createElement('div');
        div.className = 'apolo-space-block apolo-space-widget apolo-space';
        div.dataset.apoloSpaceId = this.id;
        div.dataset.apoloSpace = this.id;
        div.dataset.apoloHeight = String(this.height);
        div.style.height = `${this.height}px`;
        div.style.width = '100%';
        div.style.display = 'block';
        div.style.userSelect = 'none';
        div.style.pointerEvents = 'none';
        return div;
    }

    eq(other: ApoloSpaceWidget): boolean {
        return this.height === other.height && this.id === other.id;
    }
}

export function parseApoloSpaceHtml(html: string): { height: number; id: string } | null {
    const idMatch = html.match(/data-apolo-space(?:-id)?=["']([^"']+)["']/i);
    const heightMatch = html.match(/height:\s*(\d+)px/i);
    if (!idMatch && !heightMatch) return null;
    const id = idMatch ? idMatch[1] : `space-${Date.now()}`;
    const height = heightMatch ? Math.max(20, Math.min(3000, parseInt(heightMatch[1], 10))) : 200;
    return { height, id };
}

export function parseApoloSpaceBlock(text: string): { height: number; id: string } {
    const heightMatch = text.match(/height:\s*(\d+)/i);
    const height = heightMatch ? Math.max(20, Math.min(3000, parseInt(heightMatch[1], 10))) : 200;
    const idMatch = text.match(/id:\s*([^\s\n\r"']+)/i);
    const id = idMatch ? idMatch[1] : '';
    return { height, id };
}

interface SpaceDecorationItem {
    from: number;
    to: number;
    height: number;
    id: string;
}

function buildApoloSpaceDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc;
    const text = doc.toString();
    const items: SpaceDecorationItem[] = [];

    // 1. Match HTML div blocks: <div class="apolo-space" data-apolo-space="..." style="height:...px;"></div>
    const htmlRegex = /<div\s+[^>]*data-apolo-space(?:-id)?=["'][^"']+["'][^>]*>\s*<\/div>/gi;
    let match: RegExpExecArray | null;
    while ((match = htmlRegex.exec(text)) !== null) {
        const parsed = parseApoloSpaceHtml(match[0]);
        if (parsed) {
            items.push({
                from: match.index,
                to: match.index + match[0].length,
                height: parsed.height,
                id: parsed.id,
            });
        }
    }

    // 2. Match ```apolo-space ... ``` codeblocks (backward compatibility)
    const codeRegex = /```apolo-space\b([\s\S]*?)```/gi;
    while ((match = codeRegex.exec(text)) !== null) {
        const parsed = parseApoloSpaceBlock(match[1]);
        items.push({
            from: match.index,
            to: match.index + match[0].length,
            height: parsed.height,
            id: parsed.id,
        });
    }

    // Sort items monotonically by start position as required by RangeSetBuilder
    items.sort((a, b) => a.from - b.from);

    for (const item of items) {
        builder.add(
            item.from,
            item.to,
            Decoration.replace({
                widget: new ApoloSpaceWidget(item.height, item.id),
                block: true,
            }),
        );
    }

    return builder.finish();
}

export const apoloSpaceExtension = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = buildApoloSpaceDecorations(view);
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = buildApoloSpaceDecorations(update.view);
            }
        }
    },
    {
        decorations: v => v.decorations,
    },
);
