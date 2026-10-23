import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CanvasController, type CanvasControllerOptions } from '../src/engine/CanvasController.ts';
import {
    DEFAULT_WORKSPACE_TOOL_STATE,
    cloneWorkspaceToolState,
} from '../src/core/types.ts';

function createMockContext() {
    return {
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        quadraticCurveTo: () => {},
        arc: () => {},
        ellipse: () => {},
        roundRect: () => {},
        rect: () => {},
        fill: () => {},
        stroke: () => {},
        clearRect: () => {},
        drawImage: () => {},
        setLineDash: () => {},
        createPattern: () => null,
        translate: () => {},
        scale: () => {},
        transform: () => {},
        setTransform: () => {},
        resetTransform: () => {},
        clip: () => {},
        closePath: () => {},
        lineWidth: 1,
        strokeStyle: '#000',
        fillStyle: '#000',
        globalAlpha: 1,
        lineCap: 'round',
        lineJoin: 'round',
        globalCompositeOperation: 'source-over',
    };
}

function createMockEnvironment() {
    const listeners = new Map<string, Array<{ listener: Function; options?: any }>>();
    const mockWindow: any = {
        innerWidth: 1024,
        innerHeight: 768,
        visualViewport: null,
        devicePixelRatio: 1,
        addEventListener: (event: string, listener: Function, options?: any) => {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event)!.push({ listener, options });
        },
        removeEventListener: (event: string, listener: Function) => {
            const list = listeners.get(event);
            if (list) {
                const idx = list.findIndex(item => item.listener === listener);
                if (idx !== -1) list.splice(idx, 1);
            }
        },
        dispatch: (event: string, evObj: any) => {
            const list = listeners.get(event) || [];
            for (const item of [...list]) {
                item.listener(evObj);
            }
        },
        setTimeout: (fn: Function, ms: number) => setTimeout(fn, ms),
        clearTimeout: (id: any) => clearTimeout(id),
        requestAnimationFrame: (cb: Function) => setTimeout(cb, 0),
        cancelAnimationFrame: (id: any) => clearTimeout(id),
    };

    const createElement = (tag: string) => {
        const children: any[] = [];
        const attributes = new Map<string, string>();
        const elementListeners = new Map<string, Array<{ fn: Function; options?: any }>>();
        const mockCtx = createMockContext();
        const styleObj: any = {
            display: '',
            zIndex: '',
            position: 'relative',
            left: '0px',
            top: '0px',
            width: '800px',
            height: '600px',
            cursor: 'default',
            overflow: 'auto',
            userSelect: 'none',
            transform: '',
            transformOrigin: '',
            setProperty: (k: string, v: string) => { styleObj[k] = v; },
            getPropertyValue: (k: string) => styleObj[k] ?? '',
        };
        const el: any = {
            tagName: tag.toUpperCase(),
            style: styleObj,
            dataset: {},
            hidden: false,
            className: '',
            children,
            width: 800,
            height: 600,
            clientWidth: 800,
            clientHeight: 600,
            scrollWidth: 800,
            scrollHeight: 600,
            scrollLeft: 0,
            scrollTop: 0,
            isConnected: true,
            getContext: () => mockCtx,
            toDataURL: () => 'data:image/png;base64,',
            focus: () => {},
            blur: () => {},
            setPointerCapture: () => {},
            releasePointerCapture: () => {},
            hasPointerCapture: () => false,
            classList: {
                add: (...items: string[]) => {
                    const set = new Set(el.className.split(/\s+/).filter(Boolean));
                    for (const item of items) set.add(item);
                    el.className = [...set].join(' ');
                },
                remove: (...items: string[]) => {
                    const set = new Set(el.className.split(/\s+/).filter(Boolean));
                    for (const item of items) set.delete(item);
                    el.className = [...set].join(' ');
                },
                contains: (c: string) => el.className.split(/\s+/).filter(Boolean).includes(c),
                toggle: (c: string, force?: boolean) => {
                    const set = new Set(el.className.split(/\s+/).filter(Boolean));
                    const next = force !== undefined ? force : !set.has(c);
                    if (next) set.add(c); else set.delete(c);
                    el.className = [...set].join(' ');
                    return next;
                },
            },
            setAttribute: (k: string, v: string) => { attributes.set(k, String(v)); },
            getAttribute: (k: string) => attributes.get(k) ?? null,
            hasAttribute: (k: string) => attributes.has(k),
            removeAttribute: (k: string) => { attributes.delete(k); },
            appendChild: (child: any) => { children.push(child); child.parentElement = el; return child; },
            append: (...args: any[]) => { children.push(...args); for (const c of args) if (c && typeof c === 'object') c.parentElement = el; },
            replaceChildren: (...args: any[]) => { children.length = 0; children.push(...args); for (const c of args) if (c && typeof c === 'object') c.parentElement = el; },
            remove: () => {
                if (el.parentElement?.children) {
                    const idx = el.parentElement.children.indexOf(el);
                    if (idx !== -1) el.parentElement.children.splice(idx, 1);
                }
            },
            contains: (target: any) => target === el || children.some(c => c === target || c?.contains?.(target)),
            addEventListener: (event: string, fn: Function, options?: any) => {
                if (!elementListeners.has(event)) elementListeners.set(event, []);
                elementListeners.get(event)!.push({ fn, options });
            },
            removeEventListener: (event: string, fn: Function) => {
                const list = elementListeners.get(event);
                if (list) {
                    const idx = list.findIndex(item => item.fn === fn);
                    if (idx !== -1) list.splice(idx, 1);
                }
            },
            dispatchEvent: (evObj: any) => {
                const list = elementListeners.get(evObj.type) || [];
                for (const item of [...list]) {
                    item.fn(evObj);
                }
                return true;
            },
            closest: () => null,
            getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
            querySelector: () => null,
            querySelectorAll: () => [],
        };
        return el;
    };

    const mockDocument: any = {
        body: createElement('body'),
        createElement,
        createElementNS: (_ns: string, tag: string) => createElement(tag),
        elementsFromPoint: () => [],
    };

    return { mockWindow, mockDocument };
}

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
    let mockEnv: ReturnType<typeof createMockEnvironment>;
    let origWindow: any;
    let origDocument: any;
    let origComputedStyle: any;
    let origResizeObserver: any;
    let origRAF: any;
    let origCAF: any;

    beforeEach(() => {
        mockEnv = createMockEnvironment();
        origWindow = (globalThis as any).window;
        origDocument = (globalThis as any).document;
        origComputedStyle = (globalThis as any).getComputedStyle;
        origResizeObserver = (globalThis as any).ResizeObserver;
        origRAF = (globalThis as any).requestAnimationFrame;
        origCAF = (globalThis as any).cancelAnimationFrame;

        (globalThis as any).window = mockEnv.mockWindow;
        (globalThis as any).document = mockEnv.mockDocument;
        (globalThis as any).getComputedStyle = () => ({
            position: 'relative',
            overflow: 'auto',
            userSelect: 'none',
        });
        (globalThis as any).ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
        (globalThis as any).requestAnimationFrame = (cb: Function) => setTimeout(cb, 0);
        (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
    });

    afterEach(() => {
        (globalThis as any).window = origWindow;
        (globalThis as any).document = origDocument;
        (globalThis as any).getComputedStyle = origComputedStyle;
        (globalThis as any).ResizeObserver = origResizeObserver;
        (globalThis as any).requestAnimationFrame = origRAF;
        (globalThis as any).cancelAnimationFrame = origCAF;
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
