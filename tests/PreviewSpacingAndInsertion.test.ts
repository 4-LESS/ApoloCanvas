import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CanvasController, type CanvasControllerOptions } from '../src/engine/CanvasController.ts';
import { createControllerOptions as createBaseOptions, setupMockDom, type MockEnvironment } from './helpers/mockDom.ts';

function setMockLineRange(el: any, start: number, end: number): void {
    el.dataset.apoloLineStart = String(start);
    el.dataset.apoloLineEnd = String(end);
    el.setAttribute('data-apolo-line-start', String(start));
    el.setAttribute('data-apolo-line-end', String(end));
}

function mountPreviewController(
    scroller: any,
    notePath: string,
    overrides: Partial<CanvasControllerOptions> = {},
    extra: { editor?: any; docModel?: any } = {},
): CanvasController {
    const file = { path: notePath, basename: notePath.replace(/\.md$/, '') } as any;
    const doc = extra.docModel ?? ({ id: notePath, version: 2, elements: [], blocks: {} } as any);
    const persistence = { flush: async () => {}, enqueue: () => {}, saveDocument: async () => {} } as any;
    return new CanvasController(scroller as any, extra.editor, doc, file, notePath, persistence, createBaseOptions(overrides));
}

describe('Fase 3 - Spacing & Reading View Coherence', () => {
    let mockEnv: MockEnvironment;
    let cleanup: () => void;

    beforeEach(() => {
        const { env, teardown } = setupMockDom();
        mockEnv = env;
        cleanup = teardown;
    });

    afterEach(() => {
        cleanup?.();
    });

    test('insertCanvas pads blank lines below freehand ink in an empty note', async () => {
        const scroller = mockEnv.mockDocument.createElement('div');
        scroller.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 } as DOMRect);
        Object.defineProperty(scroller, 'clientWidth', { value: 800, configurable: true });
        Object.defineProperty(scroller, 'scrollHeight', { value: 600, configurable: true });

        let docMarkdown = '';
        const mockEditor = {
            getValue: () => docMarkdown,
            setValue: (v: string) => { docMarkdown = v; },
            getCursor: () => ({ line: 0, ch: 0 }),
            setCursor: () => {},
            lineCount: () => docMarkdown.split('\n').length,
        } as any;

        const docModel = {
            id: 'note-ink-empty',
            version: 2,
            elements: [
                {
                    id: 'stroke-jukebox',
                    type: 'stroke',
                    blockId: 'line:0',
                    anchorText: '',
                    style: { color: '#000000', width: 2, opacity: 1, pattern: 'solid' },
                    bounds: { minX: 0.1, maxX: 0.5, minY: 0.05, maxY: 0.4 }, // bottom ~ 0.4 * 800 = 320px
                    points: [{ x: 0.1, y: 0.05 }, { x: 0.5, y: 0.4 }],
                    createdAt: 1,
                },
            ],
            blocks: {},
        } as any;

        const controller = mountPreviewController(scroller, 'jukebox.md', {}, { editor: mockEditor, docModel });

        await controller.insertCanvas(280);
        const lines = docMarkdown.split('\n');
        const divIdx = lines.findIndex(l => l.includes('data-apolo-space='));
        assert.ok(divIdx >= 13, `Canvas must be padded below freehand ink (expected line >= 13, got ${divIdx})`);
        assert.ok(lines.slice(0, divIdx).every(l => l === ''), 'Lines above canvas must remain blank');
        controller.destroy();
    });

    test('syncPreviewSpacing preserves > 1 leading blank lines when no preceding section exists', async () => {
        const scroller = mockEnv.mockDocument.createElement('div');
        scroller.className = 'markdown-preview-view';

        const spaceDiv = mockEnv.mockDocument.createElement('div');
        spaceDiv.className = 'apolo-space-block';
        spaceDiv.style.marginTop = '';
        setMockLineRange(spaceDiv, 12, 12);
        scroller.appendChild(spaceDiv);

        const markdownSource = `${'\n'.repeat(12)}<div data-apolo-space="c_1" data-h="280"></div>\n`;
        const controller = mountPreviewController(scroller, 'jukebox.md', {
            readonly: true,
            app: {
                metadataCache: {
                    getFileCache: () => ({
                        sections: [{ type: 'html', position: { start: { line: 12, col: 0, offset: 12 }, end: { line: 12, col: 46, offset: 58 } } }],
                    }),
                },
                vault: { cachedRead: async () => markdownSource },
            } as any,
        });

        controller.syncPreviewSpacing();
        assert.equal(spaceDiv.style.marginTop, `${12 * 24}px`, 'Must preserve all 12 leading blank lines as marginTop');
        await new Promise(r => setTimeout(r, 10));
        assert.equal(spaceDiv.style.marginTop, `${12 * 24}px`, 'Async cachedRead must confirm 12 * 24px marginTop');
        controller.destroy();
    });

    test('syncPreviewSpacing does not apply bogus marginTop when a preceding section is virtualized', () => {
        const scroller = mockEnv.mockDocument.createElement('div');
        scroller.className = 'markdown-preview-view';

        const spaceDiv = mockEnv.mockDocument.createElement('div');
        spaceDiv.className = 'apolo-space-block';
        spaceDiv.style.marginTop = '';
        setMockLineRange(spaceDiv, 12, 12);
        scroller.appendChild(spaceDiv);

        const controller = mountPreviewController(scroller, 'virt.md', {
            readonly: true,
            app: {
                metadataCache: {
                    getFileCache: () => ({
                        sections: [
                            { type: 'paragraph', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 5, col: 10, offset: 80 } } },
                            { type: 'html', position: { start: { line: 12, col: 0, offset: 90 }, end: { line: 12, col: 46, offset: 136 } } },
                        ],
                    }),
                },
                vault: { cachedRead: async () => 'Text above\n\n\n\n\n\n\n\n\n\n\n\n<div data-apolo-space="c_1"></div>' },
            } as any,
        });

        controller.syncPreviewSpacing();
        assert.equal(spaceDiv.style.marginTop, '', 'Virtualized preceding section must NOT get bogus leading blank-line marginTop');
        controller.destroy();
    });

    test('syncPreviewSpacing applies inter-block blank lines even across empty DOM spacer wrappers', () => {
        const scroller = mockEnv.mockDocument.createElement('div');
        scroller.className = 'markdown-preview-view';

        const pEl = mockEnv.mockDocument.createElement('p');
        setMockLineRange(pEl, 0, 0);
        const emptyWrapper = mockEnv.mockDocument.createElement('div');
        const spaceDiv = mockEnv.mockDocument.createElement('div');
        setMockLineRange(spaceDiv, 6, 6);

        scroller.appendChild(pEl);
        scroller.appendChild(emptyWrapper);
        scroller.appendChild(spaceDiv);

        const controller = mountPreviewController(scroller, 'gap.md', {
            readonly: true,
            app: {
                metadataCache: {
                    getFileCache: () => ({
                        sections: [
                            { type: 'paragraph', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 5, offset: 5 } } },
                            { type: 'html', position: { start: { line: 6, col: 0, offset: 12 }, end: { line: 6, col: 36, offset: 48 } } },
                        ],
                    }),
                },
                vault: { cachedRead: async () => 'Hello\n\n\n\n\n\n<div data-apolo-space="c_1"></div>' },
            } as any,
        });

        controller.syncPreviewSpacing();
        assert.equal(spaceDiv.style.marginTop, `${5 * 24}px`, 'Must preserve 5 blank lines between paragraph and canvas');
        controller.destroy();
    });

    test('Reading mode getBlockTop clamps line:0 fallback below inline-title', () => {
        const scroller = mockEnv.mockDocument.createElement('div');
        scroller.className = 'markdown-preview-view';
        scroller.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 } as DOMRect);

        const inlineTitle = mockEnv.mockDocument.createElement('div');
        inlineTitle.className = 'inline-title';
        inlineTitle.textContent = 'Diagrama Jukebox';
        inlineTitle.getBoundingClientRect = () => ({ left: 40, top: 20, width: 400, height: 60, right: 440, bottom: 80 } as DOMRect);
        scroller.appendChild(inlineTitle);

        const spaceDiv = mockEnv.mockDocument.createElement('div');
        setMockLineRange(spaceDiv, 12, 12);
        // Suppose spaceDiv sits at y = 100 (before spacing settles)
        spaceDiv.getBoundingClientRect = () => ({ left: 40, top: 100, width: 700, height: 280, right: 740, bottom: 380 } as DOMRect);
        scroller.appendChild(spaceDiv);

        const controller = mountPreviewController(scroller, 'title.md', { readonly: true });

        const top = (controller as any).getBlockTop('line:0', '');
        assert.ok(top >= 80, `line:0 blockTop in Reading Mode must stay below inline-title bottom (80px), got ${top}`);
        controller.destroy();
    });
});
