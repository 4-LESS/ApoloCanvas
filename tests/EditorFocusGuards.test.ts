import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CanvasController, type CanvasControllerOptions } from '../src/engine/CanvasController.ts';
import {
    DEFAULT_WORKSPACE_TOOL_STATE,
    cloneWorkspaceToolState,
} from '../src/core/types.ts';

import { setupMockDom, type MockEnvironment } from './helpers/mockDom.ts';

function createControllerOptions(overrides: Partial<CanvasControllerOptions> = {}): CanvasControllerOptions {
    return {
        palmRejectionCooldownMs: 400,
        autoSaveDebounceMs: 500,
        defaultPenColor: '#1F4FD8',
        defaultPenWidth: 3,
        enabled: true,
        enableMouseDrawing: false,
        shapeRecognition: false,
        straightenLines: false,
        app: {} as any,
        ...overrides,
    };
}

describe('Editor Focus & Virtual Keyboard Guards in Drawing Mode', () => {
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

    test('Drawing mode (penEnabled === true) suppresses editor focus on double-click and touch tap', () => {
        const scroller = mockEnv.mockDocument.createElement('div');
        const docModel = { id: 'test-page', elements: [], blocks: {}, version: 2 } as any;
        const mockFile = { path: 'test.md', basename: 'test' } as any;
        const mockPersistence = {
            flush: async () => {},
            enqueue: () => {},
            loadDocumentForNote: async () => docModel,
        } as any;

        let editorFocusCalls = 0;
        const mockEditor = {
            focus: () => { editorFocusCalls++; },
            getLine: () => 'Sample text line in note',
            setCursor: () => {},
            posAtCoords: () => ({ line: 0, ch: 5 }),
        } as any;

        const controller = new CanvasController(
            scroller as any,
            mockEditor,
            docModel,
            mockFile,
            'test.md',
            mockPersistence,
            createControllerOptions({
                toolState: cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE),
            }),
        );

        // Ensure pen is enabled (drawing mode)
        controller.setPenEnabled(true);
        editorFocusCalls = 0; // reset counter after setPenEnabled

        const canvas = (controller as any).canvas;
        assert.ok(canvas);

        // 1. Double-click in drawing mode should be prevented and NOT focus the editor
        let dblClickPrevented = false;
        let dblClickStopped = false;
        canvas.dispatchEvent({
            type: 'dblclick',
            clientX: 200,
            clientY: 200,
            preventDefault: () => { dblClickPrevented = true; },
            stopPropagation: () => { dblClickStopped = true; },
        });

        assert.strictEqual(dblClickPrevented, true, 'Double-click in drawing mode must call preventDefault()');
        assert.strictEqual(dblClickStopped, true, 'Double-click in drawing mode must call stopPropagation()');
        assert.strictEqual(editorFocusCalls, 0, 'editor.focus() must NOT be called on double click in drawing mode');

        // 2. Single finger touch tap in drawing mode should NOT focus editor
        let tapPrevented = false;
        canvas.dispatchEvent({
            type: 'pointerdown',
            pointerId: 10,
            pointerType: 'touch',
            clientX: 200,
            clientY: 200,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        canvas.dispatchEvent({
            type: 'pointerup',
            pointerId: 10,
            pointerType: 'touch',
            clientX: 202,
            clientY: 202,
            preventDefault: () => { tapPrevented = true; },
            stopPropagation: () => {},
        });

        assert.strictEqual(tapPrevented, true, 'Touch tap in drawing mode must call preventDefault()');
        assert.strictEqual(editorFocusCalls, 0, 'editor.focus() must NOT be called on touch tap in drawing mode');

        // 3. Rapid double-tap with finger in drawing mode should call preventDefault() on down
        let doubleTapDownPrevented = false;
        canvas.dispatchEvent({
            type: 'pointerdown',
            pointerId: 11,
            pointerType: 'touch',
            clientX: 203,
            clientY: 201,
            preventDefault: () => { doubleTapDownPrevented = true; },
            stopPropagation: () => {},
        });

        assert.strictEqual(doubleTapDownPrevented, true, 'Rapid second touch tap must call preventDefault()');
        assert.strictEqual(editorFocusCalls, 0, 'editor.focus() must NOT be called during rapid double tap in drawing mode');

        // 4. Switch to text/keyboard mode (penEnabled === false)
        controller.setPenEnabled(false);
        // setPenEnabled(false) focuses editor once to allow immediate typing
        assert.strictEqual(editorFocusCalls, 1, 'setPenEnabled(false) explicitly focuses editor for typing');

        // 5. In keyboard mode, double-click DOES focus editor
        canvas.dispatchEvent({
            type: 'dblclick',
            clientX: 200,
            clientY: 200,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        assert.strictEqual(editorFocusCalls, 2, 'In keyboard mode, double-click focuses the editor at coordinates');

        controller.destroy();
    });
});
