import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    createFavoritePreset,
    getNextFavoritePreset,
    getActiveStrokeProfile,
    getActiveShapeProfile,
    switchStrokeProfile,
    switchShapeProfile,
    type PenFavoritePreset,
    type HighlighterFavoritePreset,
    type ShapeFavoritePreset,
    type ToolFavoritePreset,
} from '../src/ui/favorites/FavoritesStore.ts';
import {
    cloneWorkspaceToolState,
    DEFAULT_WORKSPACE_TOOL_STATE,
    DEFAULT_STROKE_FAVORITE_PROFILES,
    DEFAULT_SHAPE_FAVORITE_PROFILES,
    type WorkspaceToolState,
} from '../src/core/types.ts';
import { ToolEstuche } from '../src/ui/ToolEstuche.ts';
import { Toolbar } from '../src/ui/Toolbar.ts';
import { CanvasController } from '../src/engine/CanvasController.ts';
import { EngineEventBus } from '../src/core/events.ts';

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
        requestAnimationFrame: (cb: Function) => setTimeout(cb, 16),
        cancelAnimationFrame: (id: any) => clearTimeout(id),
    };

    const createElement = (tag: string) => {
        const children: any[] = [];
        const classes = new Set<string>();
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
            title: '',
            type: '',
            value: '',
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
                let stoppedImmediate = false;
                const origStopImmediate = evObj.stopImmediatePropagation;
                evObj.stopImmediatePropagation = () => {
                    stoppedImmediate = true;
                    if (origStopImmediate) origStopImmediate();
                };
                const list = elementListeners.get(evObj.type) || [];
                for (const item of [...list]) {
                    if (stoppedImmediate) break;
                    item.fn(evObj);
                }
                return !evObj.defaultPrevented;
            },
            click: () => {
                const ev = {
                    type: 'click',
                    target: el,
                    currentTarget: el,
                    defaultPrevented: false,
                    preventDefault: () => { ev.defaultPrevented = true; },
                    stopPropagation: () => {},
                    stopImmediatePropagation: () => {},
                };
                if (typeof el.onclick === 'function') el.onclick(ev);
                el.dispatchEvent(ev);
            },
            getBoundingClientRect: () => ({
                top: 0,
                left: 0,
                bottom: 600,
                right: 800,
                width: 800,
                height: 600,
                x: 0,
                y: 0,
                toJSON: () => {},
            }),
            querySelector: (sel: string): any => {
                const find = (node: any): any => {
                    for (const child of node.children) {
                        if (!child || typeof child !== 'object') continue;
                        if (sel.startsWith('.') && child.classList?.contains(sel.slice(1))) return child;
                        if (sel.startsWith('#') && child.id === sel.slice(1)) return child;
                        if (sel.includes('[data-') && child.hasAttribute?.(sel.replace(/[[\]]/g, '').split('=')[0])) return child;
                        if (child.tagName?.toLowerCase() === sel.toLowerCase()) return child;
                        const nested = find(child);
                        if (nested) return nested;
                    }
                    return null;
                };
                return find(el);
            },
            querySelectorAll: (sel: string): any[] => {
                const results: any[] = [];
                const search = (node: any) => {
                    for (const child of node.children) {
                        if (!child || typeof child !== 'object') continue;
                        if (sel.startsWith('.') && child.classList?.contains(sel.slice(1))) results.push(child);
                        else if (child.tagName?.toLowerCase() === sel.toLowerCase()) results.push(child);
                        search(child);
                    }
                };
                search(el);
                return results;
            },
            contains: (child: any): boolean => {
                if (child === el) return true;
                const check = (node: any): boolean => {
                    for (const c of node.children) {
                        if (c === child || check(c)) return true;
                    }
                    return false;
                };
                return check(el);
            },
            closest: (_sel: string): any => null,
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

describe('Phase 6: 1-Action S-Pen & Toolbar Quick-Cycle Within Active Tool Profile', () => {
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
        (globalThis as any).getComputedStyle = () => ({ position: 'relative', overflow: 'auto', userSelect: 'none' });
        (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
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

    describe('1. getNextFavoritePreset logic', () => {
        test('returns null for empty or invalid lists', () => {
            assert.strictEqual(getNextFavoritePreset([], { tool: 'pen', profileId: 'ball', color: '#111', width: 2 }), null);
            assert.strictEqual(getNextFavoritePreset(null as any, { tool: 'pen' }), null);
        });

        test('cycles linearly and wraps around to index 0 on last preset', () => {
            const fav1 = createFavoritePreset({ tool: 'pen', profileId: 'ball', color: '#111111', width: 2 }) as PenFavoritePreset;
            const fav2 = createFavoritePreset({ tool: 'pen', profileId: 'calli', color: '#222222', width: 4 }) as PenFavoritePreset;
            const fav3 = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#333333', width: 6 }) as PenFavoritePreset;
            const list = [fav1, fav2, fav3];

            // 1. Current matches fav1 -> returns fav2 (index 1)
            const r1 = getNextFavoritePreset(list, { tool: 'pen', profileId: 'ball', color: '#111111', width: 2 });
            assert.ok(r1);
            assert.strictEqual(r1.index, 1);
            assert.strictEqual(r1.preset.id, fav2.id);

            // 2. Current matches fav2 -> returns fav3 (index 2)
            const r2 = getNextFavoritePreset(list, { tool: 'pen', profileId: 'calli', color: '#222222', width: 4 });
            assert.ok(r2);
            assert.strictEqual(r2.index, 2);
            assert.strictEqual(r2.preset.id, fav3.id);

            // 3. Current matches fav3 (last) -> wraps around to fav1 (index 0)
            const r3 = getNextFavoritePreset(list, { tool: 'pen', profileId: 'fountain', color: '#333333', width: 6 });
            assert.ok(r3);
            assert.strictEqual(r3.index, 0);
            assert.strictEqual(r3.preset.id, fav1.id);

            // 4. Current matches none -> defaults to index 0
            const rNone = getNextFavoritePreset(list, { tool: 'pen', profileId: 'pencil', color: '#999999', width: 10 });
            assert.ok(rNone);
            assert.strictEqual(rNone.index, 0);
            assert.strictEqual(rNone.preset.id, fav1.id);
        });
    });

    describe('2. Tool Domain Profile Isolation in Quick-Cycling', () => {
        test('quick-cycling in pen cycles only through active stroke profile pen presets and never touches shape', () => {
            const scroller = mockEnv.mockDocument.createElement('div');
            const docModel = { id: 'test-page', elements: [], blocks: {}, version: 2 } as any;
            const mockFile = { path: 'test.md', basename: 'test' } as any;
            const mockPersistence = {
                flush: async () => {},
                enqueue: () => {},
                loadDocumentForNote: async () => docModel,
            } as any;

            const toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const strokeProf = getActiveStrokeProfile(toolState);
            const p1 = createFavoritePreset({ tool: 'pen', profileId: 'ball', color: '#111111', width: 2 }) as PenFavoritePreset;
            const p2 = createFavoritePreset({ tool: 'pen', profileId: 'calli', color: '#222222', width: 5 }) as PenFavoritePreset;
            strokeProf.pen = [p1, p2];

            const shapeProf = getActiveShapeProfile(toolState);
            const s1 = createFavoritePreset({ tool: 'shape', shapeType: 'rectangle', color: '#00ff00', width: 4 }) as ShapeFavoritePreset;
            shapeProf.shape = [s1];

            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                mockFile,
                'test.md',
                mockPersistence,
                { toolState },
            );

            // Initial state is pen with default style
            assert.strictEqual(controller.getToolState().activeTool, 'pen');

            // Quick-cycle 1 -> applies p1 (index 0)
            const cycled1 = controller.cycleActiveToolFavorite();
            assert.strictEqual(cycled1, true);
            assert.strictEqual(controller.getToolState().pen.color, '#111111');
            assert.strictEqual(controller.getToolState().pen.width, 2);
            assert.strictEqual(controller.getToolState().pen.profileId, 'ball');

            // Quick-cycle 2 -> applies p2 (index 1)
            const cycled2 = controller.cycleActiveToolFavorite();
            assert.strictEqual(cycled2, true);
            assert.strictEqual(controller.getToolState().pen.color, '#222222');
            assert.strictEqual(controller.getToolState().pen.width, 5);
            assert.strictEqual(controller.getToolState().pen.profileId, 'calli');

            // Shape favorites remain untouched
            assert.strictEqual(getActiveShapeProfile(controller.getToolState()).shape.length, 1);
            assert.strictEqual(getActiveShapeProfile(controller.getToolState()).shape[0].id, s1.id);

            // Switch to shape tool
            controller.setTool('shape');
            assert.strictEqual(controller.getToolState().activeTool, 'shape');

            // Quick-cycle in shape -> applies s1
            const cycledShape = controller.cycleActiveToolFavorite();
            assert.strictEqual(cycledShape, true);
            assert.strictEqual(controller.getToolState().shape.shapeType, 'rectangle');
            assert.strictEqual(controller.getToolState().shape.color, '#00ff00');
            assert.strictEqual(controller.getToolState().shape.width, 4);

            // Pen state remains untouched at p2
            assert.strictEqual(controller.getToolState().pen.profileId, 'calli');
            assert.strictEqual(controller.getToolState().pen.color, '#222222');

            controller.destroy();
        });

        test('cycleActiveToolProfile cycles stroke profiles for pen/highlighter and shape profiles for shape', () => {
            const scroller = mockEnv.mockDocument.createElement('div');
            const docModel = { id: 'test-page', elements: [], blocks: {}, version: 2 } as any;
            const mockFile = { path: 'test.md', basename: 'test' } as any;
            const mockPersistence = { flush: async () => {}, enqueue: () => {}, loadDocumentForNote: async () => docModel } as any;

            const toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                mockFile,
                'test.md',
                mockPersistence,
                { toolState },
            );

            // 1. Initial stroke profile is 'notes'
            assert.strictEqual(controller.getToolState().activeStrokeProfileId, 'notes');

            // Cycle stroke profile -> 'academic'
            controller.cycleActiveToolProfile();
            assert.strictEqual(controller.getToolState().activeStrokeProfileId, 'academic');

            // Cycle stroke profile -> 'engineering'
            controller.cycleActiveToolProfile();
            assert.strictEqual(controller.getToolState().activeStrokeProfileId, 'engineering');

            // Cycle stroke profile -> wraps to 'notes'
            controller.cycleActiveToolProfile();
            assert.strictEqual(controller.getToolState().activeStrokeProfileId, 'notes');

            // 2. Switch to shape
            controller.setTool('shape');
            assert.strictEqual(controller.getToolState().activeShapeProfileId, 'general');

            // Cycle shape profile -> 'diagrams'
            controller.cycleActiveToolProfile();
            assert.strictEqual(controller.getToolState().activeShapeProfileId, 'diagrams');

            // Cycle shape profile -> 'engineering'
            controller.cycleActiveToolProfile();
            assert.strictEqual(controller.getToolState().activeShapeProfileId, 'engineering');

            // Cycle shape profile -> wraps to 'general'
            controller.cycleActiveToolProfile();
            assert.strictEqual(controller.getToolState().activeShapeProfileId, 'general');

            controller.destroy();
        });
    });

    describe('3. S-Pen Barrel Button Pointer Event Handling', () => {
        test('pointerdown with pen and button=2 on canvas prevents drawing and does NOT cycle favorites (reserved for eraser)', () => {
            const scroller = mockEnv.mockDocument.createElement('div');
            const docModel = { id: 'test-page', elements: [], blocks: {}, version: 2 } as any;
            const mockFile = { path: 'test.md', basename: 'test' } as any;
            const mockPersistence = { flush: async () => {}, enqueue: () => {}, loadDocumentForNote: async () => docModel } as any;

            const toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const strokeProf = getActiveStrokeProfile(toolState);
            const p1 = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#0000ff', width: 3 }) as PenFavoritePreset;
            const p2 = createFavoritePreset({ tool: 'pen', profileId: 'pencil', color: '#ff0000', width: 6 }) as PenFavoritePreset;
            strokeProf.pen = [p1, p2];

            const eventBus = new EngineEventBus();
            let cycleEventFired = false;
            eventBus.on('favorites:cycle', () => { cycleEventFired = true; });

            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                mockFile,
                'test.md',
                mockPersistence,
                { toolState, eventBus },
            );

            const canvas = (controller as any).canvas;
            assert.ok(canvas);

            let prevented = false;
            let stopped = false;
            const barrelEvent = {
                type: 'pointerdown',
                pointerType: 'pen',
                button: 2,
                buttons: 32,
                clientX: 100,
                clientY: 100,
                preventDefault: () => { prevented = true; },
                stopPropagation: () => { stopped = true; },
                stopImmediatePropagation: () => { stopped = true; },
            };

            canvas.dispatchEvent(barrelEvent);

            assert.strictEqual(prevented, true, 'Default action must be prevented');
            assert.strictEqual(stopped, true, 'Propagation must be stopped to avoid drawing');
            assert.strictEqual(cycleEventFired, false, 'Canvas barrel button must NOT cycle favorites (reserved for eraser)');
            assert.strictEqual(controller.isDrawing, false);

            controller.destroy();
        });

        test('pointerdown with pen and button=2 does NOT cycle favorites when mid-stroke', () => {
            const scroller = mockEnv.mockDocument.createElement('div');
            const docModel = { id: 'test-page', elements: [], blocks: {}, version: 2 } as any;
            const mockFile = { path: 'test.md', basename: 'test' } as any;
            const mockPersistence = { flush: async () => {}, enqueue: () => {}, loadDocumentForNote: async () => docModel } as any;

            const toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const strokeProf = getActiveStrokeProfile(toolState);
            const p1 = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#0000ff', width: 3 }) as PenFavoritePreset;
            strokeProf.pen = [p1];

            const eventBus = new EngineEventBus();
            let cycleEventFired = false;
            eventBus.on('favorites:cycle', () => { cycleEventFired = true; });

            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                mockFile,
                'test.md',
                mockPersistence,
                { toolState, eventBus },
            );

            // Simulate mid-stroke
            (controller as any).activeStart = { x: 50, y: 50, pressure: 0.5, time: 100 };

            const canvas = (controller as any).canvas;
            const barrelEvent = {
                type: 'pointerdown',
                pointerType: 'pen',
                button: 2,
                buttons: 32,
                clientX: 100,
                clientY: 100,
                preventDefault: () => {},
                stopPropagation: () => {},
            };

            canvas.dispatchEvent(barrelEvent);

            assert.strictEqual(cycleEventFired, false, 'Barrel button mid-stroke must not trigger quick-cycling');

            controller.destroy();
        });

        test('S-Pen barrel button over toolbar pen button opens favorites drawer directly (contextmenu, pointerdown barrel, and hover barrel)', async () => {
            const scroller = mockEnv.mockDocument.createElement('div');
            const docModel = { id: 'test-page', elements: [], blocks: {}, version: 2 } as any;
            const mockFile = { path: 'test.md', basename: 'test' } as any;
            const mockPersistence = { flush: async () => {}, enqueue: () => {}, loadDocumentForNote: async () => docModel } as any;

            const toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const strokeProf = getActiveStrokeProfile(toolState);
            const p1 = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#0000ff', width: 3 }) as PenFavoritePreset;
            const p2 = createFavoritePreset({ tool: 'pen', profileId: 'pencil', color: '#ff0000', width: 6 }) as PenFavoritePreset;
            strokeProf.pen = [p1, p2];

            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                mockFile,
                'test.md',
                mockPersistence,
                { toolState },
            );

            const toolbar = (controller as any).toolbar as Toolbar;
            assert.ok(toolbar, 'Toolbar must be initialized');
            const penBtn = toolbar.getToolButton('pen');
            assert.ok(penBtn, 'Pen button must exist');

            const estuche = (controller as any).estuche as ToolEstuche;
            assert.ok(estuche, 'ToolEstuche must exist');
            assert.strictEqual(estuche.isOpen(), false, 'Estuche must initially be closed');

            // 1. contextmenu event on pen button (S-Pen button tap on Android WebView)
            let cmPrevented = false;
            let cmStopped = false;
            penBtn.dispatchEvent({
                type: 'contextmenu',
                pointerType: '',
                button: -1,
                buttons: 0,
                clientX: 200,
                clientY: 10,
                preventDefault: () => { cmPrevented = true; },
                stopPropagation: () => { cmStopped = true; },
            });

            assert.strictEqual(cmPrevented, true, 'contextmenu on pen button must be prevented');
            assert.strictEqual(cmStopped, true, 'contextmenu on pen button must stop propagation');
            assert.strictEqual(estuche.isOpen(), true, 'Estuche must be opened');
            assert.strictEqual(estuche.isShowingFavorites(), true, 'Estuche must open directly showing favorites drawer');

            // Toggle closed
            toolbar.closeAllPopovers();
            estuche.close();
            assert.strictEqual(estuche.isOpen(), false);

            // Wait for 300ms debounce
            await new Promise((resolve) => setTimeout(resolve, 320));

            // 2. pointerdown with barrel button (button: 5, buttons: 32)
            let pdPrevented = false;
            let pdStopped = false;
            penBtn.dispatchEvent({
                type: 'pointerdown',
                pointerType: 'pen',
                button: 5,
                buttons: 32,
                pressure: 0.7,
                clientX: 200,
                clientY: 10,
                preventDefault: () => { pdPrevented = true; },
                stopPropagation: () => { pdStopped = true; },
            });

            assert.strictEqual(pdPrevented, true, 'pointerdown barrel press must be prevented');
            assert.strictEqual(pdStopped, true, 'pointerdown barrel press must stop propagation');
            assert.strictEqual(estuche.isOpen(), true, 'Estuche must be opened via barrel pointerdown');
            assert.strictEqual(estuche.isShowingFavorites(), true, 'Must show favorites drawer');

            estuche.close();
            controller.destroy();
        });

        test('S-Pen barrel button on canvas is reserved for eraser toggle: hover and contact do NOT cycle favorites and do NOT create strokes', () => {
            const scroller = mockEnv.mockDocument.createElement('div');
            const docModel = { id: 'test-page', elements: [], blocks: {}, version: 2 } as any;
            const mockFile = { path: 'test.md', basename: 'test' } as any;
            const mockPersistence = { flush: async () => {}, enqueue: () => {}, loadDocumentForNote: async () => docModel } as any;

            const toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const strokeProf = getActiveStrokeProfile(toolState);
            const p1 = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#0000ff', width: 3 }) as PenFavoritePreset;
            const p2 = createFavoritePreset({ tool: 'pen', profileId: 'pencil', color: '#ff0000', width: 6 }) as PenFavoritePreset;
            strokeProf.pen = [p1, p2];

            const eventBus = new EngineEventBus();
            let cycleCount = 0;
            eventBus.on('favorites:cycle', () => { cycleCount++; });

            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                mockFile,
                'test.md',
                mockPersistence,
                { toolState, eventBus },
            );

            const canvas = (controller as any).canvas;
            assert.ok(canvas);

            // 1. Hover move on canvas with barrel button
            let prevented = false;
            let stopped = false;
            canvas.dispatchEvent({
                type: 'pointermove',
                pointerType: 'pen',
                buttons: 32,
                button: -1,
                pressure: 0,
                clientX: 100,
                clientY: 100,
                preventDefault: () => { prevented = true; },
                stopPropagation: () => { stopped = true; },
                stopImmediatePropagation: () => { stopped = true; },
            });

            assert.strictEqual(prevented, true, 'Hover barrel press must prevent default');
            assert.strictEqual(stopped, true, 'Hover barrel press must stop propagation');
            assert.strictEqual(cycleCount, 0, 'Canvas hover barrel must NOT cycle favorites (reserved for eraser)');
            assert.strictEqual((controller as any).penBarrelPressed, true);

            // 2. Touch down on canvas with barrel button
            let touchPrevented = false;
            canvas.dispatchEvent({
                type: 'pointerdown',
                pointerType: 'pen',
                button: 5,
                buttons: 32,
                pressure: 0.75,
                clientX: 150,
                clientY: 150,
                preventDefault: () => { touchPrevented = true; },
                stopPropagation: () => {},
                stopImmediatePropagation: () => {},
            });

            assert.strictEqual(touchPrevented, true, 'Touch with barrel button must prevent default');
            assert.strictEqual(cycleCount, 0, 'Touching canvas with barrel button must NOT cycle favorites');
            assert.strictEqual(controller.isDrawing, false, 'Controller must not begin drawing');
            assert.strictEqual(docModel.elements.length, 0, 'Zero ink elements created in document');

            controller.destroy();
        });

        test('contextmenu event on canvas is prevented without cycling favorites', () => {
            const scroller = mockEnv.mockDocument.createElement('div');
            const docModel = { id: 'test-page', elements: [], blocks: {}, version: 2 } as any;
            const mockFile = { path: 'test.md', basename: 'test' } as any;
            const mockPersistence = { flush: async () => {}, enqueue: () => {}, loadDocumentForNote: async () => docModel } as any;

            const eventBus = new EngineEventBus();
            let cycleCount = 0;
            eventBus.on('favorites:cycle', () => { cycleCount++; });

            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                mockFile,
                'test.md',
                mockPersistence,
                { eventBus },
            );

            const canvas = (controller as any).canvas;
            let prevented = false;
            let stopped = false;
            canvas.dispatchEvent({
                type: 'contextmenu',
                preventDefault: () => { prevented = true; },
                stopPropagation: () => { stopped = true; },
                stopImmediatePropagation: () => { stopped = true; },
            });

            assert.strictEqual(prevented, true, 'contextmenu must be prevented');
            assert.strictEqual(stopped, true, 'contextmenu must stop propagation');
            assert.strictEqual(cycleCount, 0, 'Canvas contextmenu must not trigger favorites:cycle');

            controller.destroy();
        });

        test('Android WebView Hover Barrel Press on canvas updates debug HUD but does NOT cycle favorites', async () => {
            const scroller = mockEnv.mockDocument.createElement('div');
            const docModel = { id: 'test-page', elements: [], blocks: {}, version: 2 } as any;
            const mockFile = { path: 'test.md', basename: 'test' } as any;
            const mockPersistence = { flush: async () => {}, enqueue: () => {}, loadDocumentForNote: async () => docModel } as any;

            const toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const strokeProf = getActiveStrokeProfile(toolState);
            const p1 = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#0000ff', width: 3 }) as PenFavoritePreset;
            const p2 = createFavoritePreset({ tool: 'pen', profileId: 'pencil', color: '#ff0000', width: 6 }) as PenFavoritePreset;
            strokeProf.pen = [p1, p2];

            const eventBus = new EngineEventBus();
            let cycleCount = 0;
            eventBus.on('favorites:cycle', () => { cycleCount++; });

            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                mockFile,
                'test.md',
                mockPersistence,
                { toolState, eventBus },
            );

            const canvas = (controller as any).canvas;

            // Hovering over screen with stylus barrel button pressed (e.g. W3C buttons: 32 or Android buttons: 2)
            let prevented = false;
            let stopped = false;
            canvas.dispatchEvent({
                type: 'pointermove',
                pointerType: 'pen',
                buttons: 32,
                button: -1,
                pressure: 0,
                clientX: 200,
                clientY: 200,
                preventDefault: () => { prevented = true; },
                stopPropagation: () => { stopped = true; },
                stopImmediatePropagation: () => { stopped = true; },
            });

            assert.strictEqual(cycleCount, 0, 'Canvas hover with barrel button must NOT trigger cycle (reserved for eraser)');
            assert.strictEqual(prevented, true, 'Default action must be prevented');
            assert.strictEqual(stopped, true, 'Propagation must be stopped');
            assert.strictEqual((controller as any).penBarrelPressed, true, 'Latch must be set to true');

            // Release button in hover
            canvas.dispatchEvent({
                type: 'pointermove',
                pointerType: 'pen',
                buttons: 0,
                button: -1,
                pressure: 0,
                clientX: 210,
                clientY: 210,
                preventDefault: () => {},
                stopPropagation: () => {},
                stopImmediatePropagation: () => {},
            });
            assert.strictEqual((controller as any).penBarrelPressed, false, 'Latch must be reset when buttons=0');

            controller.destroy();
        });

        test('Instant S-Pen Barrel Tap vs. Long-Press Hold: contextmenu after >180ms stationary hold ignores long-press and preserves stroke', () => {
            const scroller = mockEnv.mockDocument.createElement('div');
            const docModel = { id: 'test-page', elements: [], blocks: {}, version: 2 } as any;
            const mockFile = { path: 'test.md', basename: 'test' } as any;
            const mockPersistence = { flush: async () => {}, enqueue: () => {}, loadDocumentForNote: async () => docModel } as any;

            const toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const strokeProf = getActiveStrokeProfile(toolState);
            const p1 = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#0000ff', width: 3 }) as PenFavoritePreset;
            const p2 = createFavoritePreset({ tool: 'pen', profileId: 'pencil', color: '#ff0000', width: 6 }) as PenFavoritePreset;
            strokeProf.pen = [p1, p2];

            const eventBus = new EngineEventBus();
            let cycleCount = 0;
            eventBus.on('favorites:cycle', () => { cycleCount++; });

            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                mockFile,
                'test.md',
                mockPersistence,
                { toolState, eventBus },
            );

            const canvas = (controller as any).canvas;

            // Step 1: Pointer down starts drawing at t0
            canvas.dispatchEvent({
                type: 'pointerdown',
                pointerType: 'pen',
                button: 0,
                buttons: 1,
                pressure: 0.6,
                clientX: 150,
                clientY: 150,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            assert.strictEqual(controller.isDrawing, true, 'Stroke is active');
            const activePointsCount = (controller as any).points.size;
            assert.ok(activePointsCount > 0, 'Points recorded for stroke');

            // Simulate holding stylus stationary on screen for 500ms (>180ms)
            const simulatedDownTime = performance.now() - 500;
            (controller as any).lastPointerDownTime = simulatedDownTime;
            if ((controller as any).input) {
                ((controller as any).input as any).lastPointerDownTime = simulatedDownTime;
            }

            // Step 2: Native Android long-press fires contextmenu
            let cmPrevented = false;
            let cmStopped = false;
            canvas.dispatchEvent({
                type: 'contextmenu',
                pointerType: '',
                button: -1,
                buttons: 0,
                clientX: 150,
                clientY: 150,
                preventDefault: () => { cmPrevented = true; },
                stopPropagation: () => { cmStopped = true; },
                stopImmediatePropagation: () => { cmStopped = true; },
            });

            assert.strictEqual(cmPrevented, true, 'Native contextmenu must be prevented');
            assert.strictEqual(cmStopped, true, 'Propagation must be stopped');
            assert.strictEqual(cycleCount, 0, 'Long-press hold must NOT cycle favorites');
            assert.strictEqual(controller.isDrawing, true, 'Long-press hold must NOT cancel active stroke');
            assert.strictEqual((controller as any).points.size, activePointsCount, 'Active points must remain intact');

            controller.destroy();
        });

        test('Hover Exit Cleanup: pointerleave while penBarrelPressed is true resets latch so next hover press works cleanly', async () => {
            const scroller = mockEnv.mockDocument.createElement('div');
            const docModel = { id: 'test-page', elements: [], blocks: {}, version: 2 } as any;
            const mockFile = { path: 'test.md', basename: 'test' } as any;
            const mockPersistence = { flush: async () => {}, enqueue: () => {}, loadDocumentForNote: async () => docModel } as any;

            const toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const strokeProf = getActiveStrokeProfile(toolState);
            const p1 = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#0000ff', width: 3 }) as PenFavoritePreset;
            const p2 = createFavoritePreset({ tool: 'pen', profileId: 'pencil', color: '#ff0000', width: 6 }) as PenFavoritePreset;
            strokeProf.pen = [p1, p2];

            const eventBus = new EngineEventBus();
            let cycleCount = 0;
            eventBus.on('favorites:cycle', () => { cycleCount++; });

            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                mockFile,
                'test.md',
                mockPersistence,
                { toolState, eventBus },
            );

            const canvas = (controller as any).canvas;

            // 1. Press barrel button while hovering (buttons: 32 or 2)
            canvas.dispatchEvent({
                type: 'pointermove',
                pointerType: 'pen',
                buttons: 32,
                button: -1,
                pressure: 0,
                clientX: 100,
                clientY: 100,
                preventDefault: () => {},
                stopPropagation: () => {},
            });
            assert.strictEqual((controller as any).penBarrelPressed, true, 'Hover button must set penBarrelPressed latch');

            // 2. S-Pen pulled out of hover range while button is still pressed
            canvas.dispatchEvent({
                type: 'pointerleave',
                pointerType: 'pen',
                clientX: -50,
                clientY: -50,
            });
            assert.strictEqual((controller as any).penBarrelPressed, false, 'pointerleave must reset penBarrelPressed');
            assert.strictEqual((controller as any).isPenTipDown, false, 'pointerleave must reset isPenTipDown');

            // Wait > 250ms debounce
            await new Promise((resolve) => setTimeout(resolve, 260));

            // 3. S-Pen re-enters hover range with button pressed: latch reactivates
            canvas.dispatchEvent({
                type: 'pointermove',
                pointerType: 'pen',
                buttons: 32,
                button: -1,
                pressure: 0,
                clientX: 100,
                clientY: 100,
                preventDefault: () => {},
                stopPropagation: () => {},
            });
            assert.strictEqual((controller as any).penBarrelPressed, true, 'Re-entering hover with button pressed must set latch');

            controller.destroy();
        });

        test('On-Screen S-Pen Diagnostic HUD can be toggled and records telemetry lines with pure DOM', () => {
            const scroller = mockEnv.mockDocument.createElement('div');
            const docModel = { id: 'test-page', elements: [], blocks: {}, version: 2 } as any;
            const mockFile = { path: 'test.md', basename: 'test' } as any;
            const mockPersistence = { flush: async () => {}, enqueue: () => {}, loadDocumentForNote: async () => docModel } as any;

            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                mockFile,
                'test.md',
                mockPersistence,
                { showSpenDebugHud: true },
            );

            const uiRoot = (controller as any).uiRoot as HTMLElement;
            const hudEl = uiRoot.querySelector('.apolo-spen-debug-hud');
            assert.ok(hudEl, 'Debug HUD element must be mounted when showSpenDebugHud is true');

            const canvas = (controller as any).canvas;
            canvas.dispatchEvent({
                type: 'pointermove',
                pointerType: 'pen',
                button: -1,
                buttons: 1,
                pressure: 0.45,
                clientX: 50,
                clientY: 50,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            assert.match(hudEl.textContent || '', /\[pointermove.*ptr=pen btn=-1 btns=1 p=0\.45/);

            // Toggle off
            controller.setSpenDebugHud(false);
            assert.strictEqual(uiRoot.querySelector('.apolo-spen-debug-hud'), null, 'HUD should be removed when disabled');

            controller.destroy();
        });
    });

    describe('4. ToolEstuche Auto-Close on Preset Card Selection', () => {
        test('tapping a favorite card in FavoritesDrawer applies preset and closes ToolEstuche', () => {
            const penFav: PenFavoritePreset = {
                id: 'fav-autoclose',
                tool: 'pen',
                profileId: 'calli',
                color: '#3b82f6',
                width: 5,
                opacity: 100,
                pattern: 'solid',
                createdAt: Date.now(),
            };

            let appliedPreset: ToolFavoritePreset | null = null;
            const root = mockEnv.mockDocument.createElement('div');

            const estuche = new ToolEstuche(
                {
                    tool: 'pen',
                    slot: 'tc',
                    color: '#000',
                    width: 2,
                    profileId: 'ball',
                    smoothing: 0.5,
                    pressureSensitivity: 0.7,
                    favorites: [penFav],
                    showingFavorites: true,
                },
                {
                    onApplyFavorite: (preset) => {
                        appliedPreset = preset;
                    },
                },
                root,
            );

            estuche.open();
            assert.strictEqual(estuche.isOpen(), true);

            const card = root.querySelector('.apolo-favorite-card');
            assert.ok(card, 'Card must be rendered');

            card.click();

            assert.ok(appliedPreset);
            assert.strictEqual((appliedPreset as PenFavoritePreset).id, 'fav-autoclose');
            assert.strictEqual(estuche.isOpen(), false, 'ToolEstuche must close upon card selection');

            estuche.destroy();
        });
    });

    describe('5. Toolbar Double-Tap Detection and Favorite Cycling', () => {
        test('double tap (<280ms) on active tool invokes onCycleFavorite and keeps estuche closed', async () => {
            let cycledTool: string | null = null;
            let estucheOpened: string | null = null;

            const toolbar = new Toolbar({
                slot: 'tc',
                penEnabled: true,
                activeTool: 'pen',
                activeShape: 'rectangle',
                activeColor: '#000',
                activeWidth: 2,
                activeProfileId: 'ball',
                activeFavoriteIndex: 0,
                favorites: [],
                snapGrid: false,
                canUndo: false,
                canRedo: false,
                eraserRadius: 20,
                onSlotChange: () => {},
                onToggleKeyboardMode: () => {},
                onSelectTool: () => {},
                onToggleEstuche: (tool) => { estucheOpened = tool; },
                onCycleFavorite: (tool) => { cycledTool = tool; },
                onUndo: () => {},
                onRedo: () => {},
                onSelectFavorite: () => {},
                onSelectThickness: () => {},
                onToggleSnapGrid: () => {},
            });

            const penBtn = toolbar.getToolButton('pen');
            assert.ok(penBtn);

            // First tap: starts debounce timer for estuche
            penBtn.click();
            assert.strictEqual(cycledTool, null);
            assert.strictEqual(estucheOpened, null);

            // Second tap within 100ms: double-tap detected!
            penBtn.click();
            assert.strictEqual(cycledTool, 'pen', 'Double tap must invoke onCycleFavorite');
            assert.strictEqual(estucheOpened, null, 'Estuche must NOT open on double-tap');

            // Wait 300ms to verify pending estuche timer was cancelled
            await new Promise((resolve) => setTimeout(resolve, 320));
            assert.strictEqual(estucheOpened, null, 'Estuche must remain closed after timeout');

            toolbar.destroy();
        });

        test('single tap on active tool after 280ms opens estuche', async () => {
            let cycledTool: string | null = null;
            let estucheOpened: string | null = null;

            const toolbar = new Toolbar({
                slot: 'tc',
                penEnabled: true,
                activeTool: 'pen',
                activeShape: 'rectangle',
                activeColor: '#000',
                activeWidth: 2,
                activeProfileId: 'ball',
                activeFavoriteIndex: 0,
                favorites: [],
                snapGrid: false,
                canUndo: false,
                canRedo: false,
                eraserRadius: 20,
                onSlotChange: () => {},
                onToggleKeyboardMode: () => {},
                onSelectTool: () => {},
                onToggleEstuche: (tool) => { estucheOpened = tool; },
                onCycleFavorite: (tool) => { cycledTool = tool; },
                onUndo: () => {},
                onRedo: () => {},
                onSelectFavorite: () => {},
                onSelectThickness: () => {},
                onToggleSnapGrid: () => {},
            });

            const penBtn = toolbar.getToolButton('pen');
            assert.ok(penBtn);

            penBtn.click();
            assert.strictEqual(cycledTool, null);
            assert.strictEqual(estucheOpened, null);

            // Wait 300ms for debounce timer
            await new Promise((resolve) => setTimeout(resolve, 320));
            assert.strictEqual(estucheOpened, 'pen', 'Single tap must open estuche after debounce');
            assert.strictEqual(cycledTool, null);

            toolbar.destroy();
        });
    });
});
