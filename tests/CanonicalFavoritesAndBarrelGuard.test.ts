import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_WORKSPACE_TOOL_STATE,
    cloneWorkspaceToolState,
    mergeWorkspaceToolState,
    attachFavoritesProjection,
    type WorkspaceToolState,
    type PenFavoritePreset,
    type HighlighterFavoritePreset,
    type ShapeFavoritePreset,
} from '../src/core/types.ts';
import {
    createFavoritePreset,
    getActiveStrokeProfile,
    getActiveShapeProfile,
    switchStrokeProfile,
    setCanonicalFavorites,
} from '../src/ui/favorites/FavoritesStore.ts';
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
        setTimeout: (fn: Function, ms: number) => setTimeout(fn, ms),
        clearTimeout: (id: any) => clearTimeout(id),
        requestAnimationFrame: (cb: Function) => setTimeout(cb, 0),
        cancelAnimationFrame: (id: any) => clearTimeout(id),
    };

    const createElement = (tag: string) => {
        const children: any[] = [];
        const attributes = new Map<string, string>();
        const elementListeners = new Map<string, Array<{ fn: Function; options?: any }>>();
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
            setProperty: (k: string, v: string) => { styleObj[k] = v; },
            getPropertyValue: (k: string) => styleObj[k] ?? '',
        };

        const classListSet = new Set<string>();
        const el: any = {
            tagName: tag.toUpperCase(),
            style: styleObj,
            dataset: {},
            children,
            childNodes: children,
            parentElement: null,
            parentNode: null,
            clientWidth: 800,
            clientHeight: 600,
            offsetWidth: 800,
            offsetHeight: 600,
            scrollLeft: 0,
            scrollTop: 0,
            scrollWidth: 800,
            scrollHeight: 600,
            classList: {
                add: (cls: string) => classListSet.add(cls),
                remove: (cls: string) => classListSet.delete(cls),
                contains: (cls: string) => classListSet.has(cls),
                toggle: (cls: string, force?: boolean) => {
                    if (force !== undefined) {
                        if (force) classListSet.add(cls);
                        else classListSet.delete(cls);
                        return force;
                    }
                    if (classListSet.has(cls)) {
                        classListSet.delete(cls);
                        return false;
                    }
                    classListSet.add(cls);
                    return true;
                },
            },
            appendChild: (child: any) => {
                child.parentElement = el;
                child.parentNode = el;
                children.push(child);
                return child;
            },
            append: (...args: any[]) => {
                for (const child of args) {
                    if (child && typeof child === 'object') {
                        child.parentElement = el;
                        child.parentNode = el;
                    }
                    children.push(child);
                }
            },
            replaceChildren: (...args: any[]) => {
                children.length = 0;
                for (const child of args) {
                    if (child && typeof child === 'object') {
                        child.parentElement = el;
                        child.parentNode = el;
                    }
                    children.push(child);
                }
            },
            remove: () => {
                if (el.parentElement?.children) {
                    const idx = el.parentElement.children.indexOf(el);
                    if (idx !== -1) el.parentElement.children.splice(idx, 1);
                }
            },
            removeChild: (child: any) => {
                const idx = children.indexOf(child);
                if (idx !== -1) {
                    children.splice(idx, 1);
                    child.parentElement = null;
                    child.parentNode = null;
                }
                return child;
            },
            insertBefore: (newNode: any, referenceNode: any) => {
                const idx = children.indexOf(referenceNode);
                if (idx !== -1) {
                    children.splice(idx, 0, newNode);
                } else {
                    children.push(newNode);
                }
                newNode.parentElement = el;
                newNode.parentNode = el;
                return newNode;
            },
            addEventListener: (type: string, fn: Function, options?: any) => {
                if (!elementListeners.has(type)) elementListeners.set(type, []);
                elementListeners.get(type)!.push({ fn, options });
            },
            removeEventListener: (type: string, fn: Function) => {
                const list = elementListeners.get(type);
                if (list) {
                    const idx = list.findIndex(item => item.fn === fn);
                    if (idx !== -1) list.splice(idx, 1);
                }
            },
            dispatchEvent: (ev: any) => {
                ev.target = el;
                ev.currentTarget = el;
                const list = elementListeners.get(ev.type) || [];
                for (const item of [...list]) {
                    item.fn(ev);
                }
                return !ev.defaultPrevented;
            },
            closest: (_sel: string): any => null,
            setAttribute: (k: string, v: string) => attributes.set(k, v),
            getAttribute: (k: string) => attributes.get(k) || null,
            removeAttribute: (k: string) => attributes.delete(k),
            hasAttribute: (k: string) => attributes.has(k),
            getBoundingClientRect: () => ({
                left: 0,
                top: 0,
                right: 800,
                bottom: 600,
                width: 800,
                height: 600,
                x: 0,
                y: 0,
            }),
            setPointerCapture: () => {},
            releasePointerCapture: () => {},
            hasPointerCapture: () => false,
            focus: () => {},
            blur: () => {},
            contains: (target: any) => {
                let curr = target;
                while (curr) {
                    if (curr === el) return true;
                    curr = curr.parentElement;
                }
                return false;
            },
            querySelector: (sel: string) => {
                if (sel === 'canvas') return children.find(c => c.tagName === 'CANVAS') || null;
                return null;
            },
            querySelectorAll: () => [],
        };

        if (tag.toLowerCase() === 'canvas') {
            el.getContext = () => createMockContext();
            el.width = 800;
            el.height = 600;
        }

        return el;
    };

    const mockDocument: any = {
        createElement,
        createElementNS: (_ns: string, tag: string) => createElement(tag),
        body: createElement('body'),
        addEventListener: (event: string, listener: Function) => mockWindow.addEventListener(event, listener),
        removeEventListener: (event: string, listener: Function) => mockWindow.removeEventListener(event, listener),
        elementsFromPoint: () => [],
    };

    return { mockWindow, mockDocument };
}

describe('Canonical Profile Store & Stylus Barrel Guard Narrowing', () => {
    let mockEnv: ReturnType<typeof createMockEnvironment>;
    let originalWindow: any;
    let originalDocument: any;
    let originalRAF: any;
    let originalCAF: any;
    let originalComputedStyle: any;
    let originalResizeObserver: any;

    beforeEach(() => {
        mockEnv = createMockEnvironment();
        originalWindow = (globalThis as any).window;
        originalDocument = (globalThis as any).document;
        originalRAF = (globalThis as any).requestAnimationFrame;
        originalCAF = (globalThis as any).cancelAnimationFrame;
        originalComputedStyle = (globalThis as any).getComputedStyle;
        originalResizeObserver = (globalThis as any).ResizeObserver;

        (globalThis as any).window = mockEnv.mockWindow;
        (globalThis as any).document = mockEnv.mockDocument;
        (globalThis as any).requestAnimationFrame = (cb: Function) => setTimeout(cb, 0);
        (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
        (globalThis as any).getComputedStyle = () => ({ position: 'relative', overflow: 'auto', userSelect: 'none' });
        (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    });

    afterEach(() => {
        (globalThis as any).window = originalWindow;
        (globalThis as any).document = originalDocument;
        (globalThis as any).requestAnimationFrame = originalRAF;
        (globalThis as any).cancelAnimationFrame = originalCAF;
        (globalThis as any).getComputedStyle = originalComputedStyle;
        (globalThis as any).ResizeObserver = originalResizeObserver;
    });

    describe('1. Single Source of Truth: Canonical Profile Store & Live Projection', () => {
        test('state.favorites dynamically reflects active profile without duplicating data', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const notesPen = createFavoritePreset({ tool: 'pen', profileId: 'ball', color: '#1F4FD8', width: 2 }) as PenFavoritePreset;
            const academicPen = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#E53935', width: 5 }) as PenFavoritePreset;

            // Set presets on Notes profile
            setCanonicalFavorites(state, 'pen', [notesPen]);
            assert.strictEqual(state.favorites.pen.length, 1);
            assert.strictEqual(state.favorites.pen[0].color, '#1F4FD8');

            // Switch to Academic profile
            switchStrokeProfile(state, 'academic');
            assert.strictEqual(state.activeStrokeProfileId, 'academic');
            // Academic begins empty; projection immediately reflects 0 items
            assert.strictEqual(state.favorites.pen.length, 0);

            // Add preset to Academic
            setCanonicalFavorites(state, 'pen', [academicPen]);
            assert.strictEqual(state.favorites.pen.length, 1);
            assert.strictEqual(state.favorites.pen[0].color, '#E53935');

            // Switch back to Notes; projection automatically reflects Notes preset
            switchStrokeProfile(state, 'notes');
            assert.strictEqual(state.activeStrokeProfileId, 'notes');
            assert.strictEqual(state.favorites.pen.length, 1);
            assert.strictEqual(state.favorites.pen[0].color, '#1F4FD8');
        });

        test('Direct push and array mutation on state.favorites directly modifies the active canonical profile', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const preset = createFavoritePreset({ tool: 'pen', profileId: 'pencil', color: '#10B981', width: 3 }) as PenFavoritePreset;

            // Mutate via legacy projection push
            state.favorites.pen.push(preset);

            // Canonical profile must have received the preset
            const activeProfile = getActiveStrokeProfile(state);
            assert.strictEqual(activeProfile.pen.length, 1);
            assert.strictEqual(activeProfile.pen[0].id, preset.id);

            // Mutate via legacy projection assignment
            state.favorites.pen = [];
            assert.strictEqual(activeProfile.pen.length, 0);
            assert.strictEqual(state.favorites.pen.length, 0);
        });

        test('mergeWorkspaceToolState strictly ignores saved.favorites when canonical profiles are present', () => {
            const savedWithProfiles = {
                activeStrokeProfileId: 'notes',
                strokeFavoriteProfiles: [
                    {
                        id: 'notes',
                        name: 'Notas',
                        pen: [createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#AABBCC', width: 4 }) as PenFavoritePreset],
                        highlighter: [],
                    },
                ],
                // Conflicting/stale legacy favorites slice that should be completely ignored
                favorites: {
                    pen: [createFavoritePreset({ tool: 'pen', profileId: 'ball', color: '#000000', width: 1 }) as PenFavoritePreset],
                    highlighter: [],
                    shape: [],
                },
            };

            const merged = mergeWorkspaceToolState(savedWithProfiles);
            // Canonical profile must win over stale saved.favorites
            assert.strictEqual(merged.strokeFavoriteProfiles[0].pen[0].color, '#AABBCC');
            assert.strictEqual(merged.favorites.pen[0].color, '#AABBCC');
        });

        test('mergeWorkspaceToolState migrates saved.favorites for pre-profile legacy payloads', () => {
            const legacyPayload = {
                favorites: {
                    pen: [createFavoritePreset({ tool: 'pen', profileId: 'ball', color: '#123456', width: 3 }) as PenFavoritePreset],
                    highlighter: [],
                    shape: [],
                },
            };

            const merged = mergeWorkspaceToolState(legacyPayload);
            // Legacy favorites slice migrated into default active profile
            assert.strictEqual(merged.strokeFavoriteProfiles[0].pen.length, 1);
            assert.strictEqual(merged.strokeFavoriteProfiles[0].pen[0].color, '#123456');
            assert.strictEqual(merged.favorites.pen[0].color, '#123456');
        });
    });

    describe('2. Narrowed Stylus Barrel Button Guard & Stroke Cancellation', () => {
        function setupCanvasController() {
            const scroller = mockEnv.mockDocument.createElement('div');
            const docModel = { id: 'test-page', elements: [], blocks: {}, version: 2 } as any;
            const mockFile = { path: 'test.md', basename: 'test' } as any;
            const mockPersistence = { flush: async () => {}, enqueue: () => {}, loadDocumentForNote: async () => docModel } as any;

            const toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const eventBus = new EngineEventBus();

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
            return { controller, canvas, eventBus };
        }

        test('Normal pen tap (<180ms) with synthetic contextmenu does NOT abort or cancel active stroke', () => {
            const { controller, canvas } = setupCanvasController();

            // 1. Normal pen tip down (buttons: 1, button: 0)
            canvas.dispatchEvent({
                type: 'pointerdown',
                pointerType: 'pen',
                button: 0,
                buttons: 1,
                pressure: 0.5,
                clientX: 200,
                clientY: 200,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            assert.strictEqual(controller.isDrawing, true, 'Stroke must be active after pointerdown');
            const initialPoints = (controller as any).points.size;
            assert.ok(initialPoints > 0, 'Initial points must be recorded');

            // 2. Immediate synthetic contextmenu (e.g. quick tap firing contextmenu on Android)
            let cmPrevented = false;
            let cmStopped = false;
            canvas.dispatchEvent({
                type: 'contextmenu',
                pointerType: 'pen',
                button: 0,
                buttons: 1,
                clientX: 200,
                clientY: 200,
                preventDefault: () => { cmPrevented = true; },
                stopPropagation: () => { cmStopped = true; },
                stopImmediatePropagation: () => { cmStopped = true; },
            });

            assert.strictEqual(cmPrevented, true, 'Contextmenu must be prevented');
            assert.strictEqual(cmStopped, true, 'Contextmenu propagation must be stopped');
            // Crucial: Stroke must NOT be cancelled because barrel button was never confirmed!
            assert.strictEqual(controller.isDrawing, true, 'Normal tap must preserve active stroke');
            assert.strictEqual((controller as any).points.size, initialPoints, 'Points must remain intact');
            assert.strictEqual((controller as any).penBarrelPressed, false, 'penBarrelPressed must remain false');

            controller.destroy();
        });

        test('Confirmed barrel button on pointerdown followed by contextmenu cancels nascent stroke', () => {
            const { controller, canvas } = setupCanvasController();

            // 1. Stylus pointerdown with physical barrel button (Android button: 2, buttons: 2)
            canvas.dispatchEvent({
                type: 'pointerdown',
                pointerType: 'pen',
                button: 2,
                buttons: 2,
                pressure: 0.5,
                clientX: 200,
                clientY: 200,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // penBarrelPressed is latched to true
            assert.strictEqual((controller as any).penBarrelPressed, true, 'penBarrelPressed latched on barrel pointerdown');

            // 2. Synthetic contextmenu arrives
            canvas.dispatchEvent({
                type: 'contextmenu',
                pointerType: 'pen',
                button: 2,
                buttons: 2,
                clientX: 200,
                clientY: 200,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // Confirmed barrel: nascent stroke is cancelled
            assert.strictEqual(controller.isDrawing, false, 'Nascent stroke cancelled on confirmed barrel');
            assert.strictEqual((controller as any).penBarrelPressed, true, 'penBarrelPressed remains true');

            controller.destroy();
        });

        test('Subsequent pen tip touch without barrel resets penBarrelPressed and draws cleanly', () => {
            const { controller, canvas } = setupCanvasController();

            // 1. Hover-barrel latches penBarrelPressed
            (controller as any).penBarrelPressed = true;

            // 2. Normal pen pointerdown arrives with tip only (button: 0, buttons: 1)
            canvas.dispatchEvent({
                type: 'pointerdown',
                pointerType: 'pen',
                button: 0,
                buttons: 1,
                pressure: 0.5,
                clientX: 250,
                clientY: 250,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // penBarrelPressed must be reset to false immediately
            assert.strictEqual((controller as any).penBarrelPressed, false, 'penBarrelPressed reset on normal pen tip touch');

            // 3. Synthetic contextmenu without barrel does NOT cancel the new stroke
            canvas.dispatchEvent({
                type: 'contextmenu',
                pointerType: 'pen',
                button: 0,
                buttons: 1,
                clientX: 250,
                clientY: 250,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            assert.strictEqual(controller.isDrawing, true, 'New stroke is preserved intact');

            controller.destroy();
        });

        test('Stylus stroke with deliberate movement (>8px) is NOT aborted on stray contextmenu even if barrel signal occurs', () => {
            const { controller, canvas } = setupCanvasController();

            // 1. Normal pen tip down
            canvas.dispatchEvent({
                type: 'pointerdown',
                pointerType: 'pen',
                button: 0,
                buttons: 1,
                pressure: 0.5,
                clientX: 100,
                clientY: 100,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // 2. Movement across 20px (deliberate movement)
            canvas.dispatchEvent({
                type: 'pointermove',
                pointerType: 'pen',
                button: 0,
                buttons: 1,
                pressure: 0.6,
                clientX: 120,
                clientY: 100,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // 3. Stray contextmenu with barrel button while in motion
            canvas.dispatchEvent({
                type: 'contextmenu',
                pointerType: 'pen',
                button: 2,
                buttons: 2,
                clientX: 120,
                clientY: 100,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // Crucial: Stroke must NOT be cancelled because deliberate movement (>8px) was already in progress
            assert.strictEqual(controller.isDrawing, true, 'Moving stroke must not be aborted on contextmenu');

            controller.destroy();
        });
    });
});
