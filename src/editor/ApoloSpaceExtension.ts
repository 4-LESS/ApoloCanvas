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
        div.className = 'apolo-space-block apolo-space-widget';
        div.dataset.apoloSpaceId = this.id;
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

function parseApoloSpaceBlock(text: string): { height: number; id: string } {
    const heightMatch = text.match(/height:\s*(\d+)/i);
    const height = heightMatch ? Math.max(20, Math.min(2000, parseInt(heightMatch[1], 10))) : 200;
    const idMatch = text.match(/id:\s*([^\s\n\r]+)/i);
    const id = idMatch ? idMatch[1] : '';
    return { height, id };
}

function buildApoloSpaceDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc;
    const text = doc.toString();

    // Regex to match ```apolo-space ... ``` blocks
    const regex = /```apolo-space\b([\s\S]*?)```/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        const from = match.index;
        const to = from + match[0].length;
        const { height, id } = parseApoloSpaceBlock(match[1]);

        builder.add(
            from,
            to,
            Decoration.replace({
                widget: new ApoloSpaceWidget(height, id),
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
