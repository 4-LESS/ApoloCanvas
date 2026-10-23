import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Toolbar } from '../src/ui/Toolbar.ts';
import { ToolEstuche } from '../src/ui/ToolEstuche.ts';
import { DEFAULT_WORKSPACE_TOOL_STATE, cloneWorkspaceToolState } from '../src/core/types.ts';

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
            getContext: () => ({
                save: () => {},
                restore: () => {},
                beginPath: () => {},
                moveTo: () => {},
                lineTo: () => {},
                stroke: () => {},
                fill: () => {},
                clearRect: () => {},
                arc: () => {},
                setLineDash: () => {},
            }),
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
            replaceChildren: (...args: any[]) => {
                for (const c of children) {
                    if (c && typeof c === 'object') c.parentElement = null;
                }
                children.length = 0;
                children.push(...args);
                for (const c of args) if (c && typeof c === 'object') c.parentElement = el;
            },
            remove: () => {
                if (el.parentElement?.children) {
                    const idx = el.parentElement.children.indexOf(el);
                    if (idx !== -1) el.parentElement.children.splice(idx, 1);
                }
                el.parentElement = null;
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

describe('Toolbar Barrel Button Latching & FavoritesDrawer Lifecycle Teardown', () => {
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

    test('1. Toolbar S-Pen Hover-Barrel: latched edge-triggering prevents repeated toggles on pointermove', async () => {
        let toggleFavoritesCount = 0;
        let lastToggledTool: string | null = null;

        const toolbar = new Toolbar({
            slot: 'tc',
            penEnabled: true,
            activeTool: 'pen',
            activeShape: 'rectangle',
            activeColor: '#1F4FD8',
            activeWidth: 3,
            activeProfileId: 'fountain',
            activeFavoriteIndex: 0,
            favorites: [],
            snapGrid: false,
            canUndo: false,
            canRedo: false,
            eraserRadius: 20,
            onSlotChange: () => {},
            onToggleKeyboardMode: () => {},
            onSelectTool: () => {},
            onToggleEstuche: () => {},
            onToggleEstucheFavorites: (tool) => {
                toggleFavoritesCount++;
                lastToggledTool = tool;
            },
            onCycleFavorite: () => {},
            onUndo: () => {},
            onRedo: () => {},
            onSelectFavorite: () => {},
            onSelectThickness: () => {},
            onToggleSnapGrid: () => {},
        });

        const penBtn = toolbar.getToolButton('pen');
        assert.ok(penBtn, 'Pen button must exist on toolbar');

        // Initial state: 0 toggles
        assert.strictEqual(toggleFavoritesCount, 0);

        // A. Primary tip contact at pressure 0 (buttons: 1) must be REJECTED (no toggle)
        penBtn.dispatchEvent({
            type: 'pointermove',
            pointerType: 'pen',
            pressure: 0,
            buttons: 1,
            clientX: 100,
            clientY: 50,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        assert.strictEqual(toggleFavoritesCount, 0, 'buttons: 1 must NEVER trigger hover-barrel toggle');

        // B. First intentional hover-barrel event (buttons: 32 / W3C or buttons: 2 / Android)
        penBtn.dispatchEvent({
            type: 'pointermove',
            pointerType: 'pen',
            pressure: 0,
            buttons: 32,
            clientX: 100,
            clientY: 50,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        assert.strictEqual(toggleFavoritesCount, 1, 'First hover-barrel event triggers toggle');
        assert.strictEqual(lastToggledTool, 'pen');

        // C. Continuous pointermove events while the barrel button is held down must NOT trigger repeated toggles
        for (let i = 0; i < 15; i++) {
            penBtn.dispatchEvent({
                type: 'pointermove',
                pointerType: 'pen',
                pressure: 0,
                buttons: 32,
                clientX: 100 + i,
                clientY: 50 + i,
                preventDefault: () => {},
                stopPropagation: () => {},
            });
        }
        assert.strictEqual(toggleFavoritesCount, 1, 'Latched state must prevent repeated toggling on subsequent pointermove events');

        // D. Button is released in hover (buttons: 0): latch must be reset
        penBtn.dispatchEvent({
            type: 'pointermove',
            pointerType: 'pen',
            pressure: 0,
            buttons: 0,
            clientX: 120,
            clientY: 60,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        assert.strictEqual(toggleFavoritesCount, 1, 'Releasing barrel does not toggle');

        // Wait for debounce cooldown (> 300ms)
        await new Promise((r) => setTimeout(r, 320));

        // E. Next intentional hover-barrel press fires cleanly
        penBtn.dispatchEvent({
            type: 'pointermove',
            pointerType: 'pen',
            pressure: 0,
            buttons: 2, // Android secondary button bitmask
            clientX: 120,
            clientY: 60,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        assert.strictEqual(toggleFavoritesCount, 2, 'New press after release and cooldown triggers second toggle cleanly');

        toolbar.destroy();
    });

    test('2. ToolEstuche: FavoritesDrawer previous instances are strictly destroyed before re-render or close', () => {
        const estuche = new ToolEstuche(
            {
                tool: 'pen',
                width: 3,
                color: '#1F4FD8',
                eraserMode: 'whole',
                lassoMode: 'freeform',
                showingFavorites: false,
                favorites: [],
                strokeFavoriteProfiles: cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE).strokeFavoriteProfiles,
                activeStrokeProfileId: 'notes',
            },
            {
                onApplyFavorite: () => {},
                onDeleteFavorite: () => {},
                onReorderFavorites: () => {},
                onRenameFavorite: () => {},
                onClose: () => {},
            },
        );

        // Open estuche showing favorites
        estuche.open(mockEnv.mockDocument.body);
        estuche.setShowingFavorites(true);

        const drawer1 = (estuche as any).favoritesDrawer;
        assert.ok(drawer1, 'FavoritesDrawer instance #1 must be created');

        let drawer1Destroyed = false;
        const origDestroy1 = drawer1.destroy.bind(drawer1);
        drawer1.destroy = () => {
            drawer1Destroyed = true;
            origDestroy1();
        };

        // Switch to regular tool view
        estuche.setShowingFavorites(false);
        assert.strictEqual(drawer1Destroyed, true, 'Drawer #1 must be destroyed when switching away from favorites');
        assert.strictEqual((estuche as any).favoritesDrawer, undefined, 'Reference must be cleared');

        // Re-open favorites view: creates fresh Drawer #2
        estuche.setShowingFavorites(true);
        const drawer2 = (estuche as any).favoritesDrawer;
        assert.ok(drawer2, 'FavoritesDrawer instance #2 must be created');
        assert.notStrictEqual(drawer2, drawer1, 'Drawer #2 must be a distinct instance');

        let drawer2Destroyed = false;
        const origDestroy2 = drawer2.destroy.bind(drawer2);
        drawer2.destroy = () => {
            drawer2Destroyed = true;
            origDestroy2();
        };

        // Close estuche: drawer #2 must be destroyed
        estuche.close();
        assert.strictEqual(drawer2Destroyed, true, 'Drawer #2 must be destroyed on estuche close');
        assert.strictEqual((estuche as any).favoritesDrawer, undefined, 'Reference must be cleared');

        estuche.destroy();
    });
});
