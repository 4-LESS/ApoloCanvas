import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CanvasController, type CanvasControllerOptions } from '../src/engine/CanvasController.ts';
import {
    type WorkspaceToolState,
    DEFAULT_WORKSPACE_TOOL_STATE,
    cloneWorkspaceToolState,
    mergeWorkspaceToolState,
} from '../src/core/types.ts';
import {
    setCanonicalFavorites,
    getCanonicalFavorites,
    switchStrokeProfile,
    createFavoritePreset,
} from '../src/ui/favorites/FavoritesStore.ts';

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
    const mockWindow = {
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
        const elementListeners = new Map<string, Function[]>();
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
            append: (...args: any[]) => { children.push(...args); for (const c of args) if (c) c.parentElement = el; },
            replaceChildren: (...args: any[]) => { children.length = 0; children.push(...args); for (const c of args) if (c) c.parentElement = el; },
            remove: () => {
                if (el.parentElement?.children) {
                    const idx = el.parentElement.children.indexOf(el);
                    if (idx !== -1) el.parentElement.children.splice(idx, 1);
                }
            },
            contains: (target: any) => target === el || children.some(c => c === target || c?.contains?.(target)),
            addEventListener: (type: string, fn: Function) => {
                if (!elementListeners.has(type)) elementListeners.set(type, []);
                elementListeners.get(type)!.push(fn);
            },
            removeEventListener: (type: string, fn: Function) => {
                const list = elementListeners.get(type);
                if (list) {
                    const idx = list.indexOf(fn);
                    if (idx !== -1) list.splice(idx, 1);
                }
            },
            dispatch: (ev: any) => {
                const list = elementListeners.get(ev.type) || [];
                for (const fn of list) fn(ev);
                return true;
            },
            closest: (sel: string) => {
                if (sel.includes('data-apolo-popover-trigger') && attributes.has('data-apolo-popover-trigger')) {
                    return el;
                }
                return null;
            },
            getBoundingClientRect: () => ({ left: 200, top: 100, right: 244, bottom: 144, width: 44, height: 44 }),
            querySelector: () => null,
            querySelectorAll: (sel: string) => {
                const matches: any[] = [];
                const check = (node: any) => {
                    if (sel.includes('button') && node.tagName === 'BUTTON') matches.push(node);
                    for (const c of node.children || []) check(c);
                };
                check(el);
                return matches;
            },
        };
        return el;
    };

    const mockDocument = {
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

describe('Absolute Tool State Persistence & Per-Tool Memory Across Mode Switches', () => {

    test('1. Per-Tool Isolation: Customizing pen, switching to highlighter, and switching back restores all pen properties intact without bleeding', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevWin = (globalThis as any).window;
        const prevDoc = (globalThis as any).document;
        const prevGetComputedStyle = (globalThis as any).getComputedStyle;
        const prevResizeObserver = (globalThis as any).ResizeObserver;
        const prevRAF = (globalThis as any).requestAnimationFrame;
        const prevCAF = (globalThis as any).cancelAnimationFrame;

        (globalThis as any).window = mockWindow;
        (globalThis as any).document = mockDocument;
        (globalThis as any).getComputedStyle = () => ({ position: 'relative', overflow: 'auto', userSelect: 'none' });
        (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
        (globalThis as any).requestAnimationFrame = (cb: Function) => setTimeout(cb, 0);
        (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);

        try {
            const scroller = mockDocument.createElement('div');
            const docModel = { id: 'test-page', elements: [], blocks: {}, version: 2 } as any;
            const mockFile = { path: 'test.md', basename: 'test' } as any;
            const mockPersistence = {
                flush: async () => {},
                enqueue: () => {},
                loadDocumentForNote: async () => docModel,
            } as any;

            let lastNotifiedState: WorkspaceToolState | null = null;
            const options = createControllerOptions({
                toolState: cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE),
                onToolStateChange: (state) => {
                    lastNotifiedState = cloneWorkspaceToolState(state);
                },
            });

            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                mockFile,
                'test.md',
                mockPersistence,
                options,
            );

            // Verify initial tool is pen
            assert.strictEqual(controller.getToolState().activeTool, 'pen');

            // 1. Customize pen properties: profileId='calli', color='#E53935' (red), width=7, pattern='dashed', straightenLines=true
            (controller as any).applyPenProfile('calli');
            controller.setInkColor('#E53935');
            controller.setWidth(7);
            (controller as any).estuche?.callbacks?.onChangeLineStyle?.('dashed');
            // If estuche wasn't directly called, we can set pattern or call through estuche callback:
            if (controller.getToolState().pen.pattern !== 'dashed') {
                const state = controller.getToolState();
                state.pen.pattern = 'dashed';
                controller.applyWorkspaceToolState(state);
            }
            controller.setStraightenLines(true);

            // Assert pen slice in controller matches customizations
            const penState = controller.getToolState().pen;
            assert.strictEqual(penState.profileId, 'calli', 'Pen profile should be calli');
            assert.strictEqual(penState.color, '#E53935', 'Pen color should be red #E53935');
            assert.strictEqual(penState.width, 7, 'Pen width should be 7');
            assert.strictEqual(penState.pattern, 'dashed', 'Pen pattern should be dashed');
            assert.strictEqual(penState.straightenLines, true, 'Pen straightenLines should be true');

            // 2. Switch to highlighter tool
            controller.setTool('highlighter');
            assert.strictEqual(controller.getToolState().activeTool, 'highlighter');

            // Verify highlighter did NOT bleed from pen's customizations
            const hlInitialState = controller.getToolState().highlighter;
            assert.strictEqual(hlInitialState.profileId, 'hlr', 'Highlighter profile should retain hlr');
            assert.strictEqual(hlInitialState.color, '#FDD835', 'Highlighter color should retain default yellow');
            assert.strictEqual(hlInitialState.width, 20, 'Highlighter width should retain 20, NOT bleed 7 from pen');
            assert.strictEqual(hlInitialState.pattern, 'solid', 'Highlighter pattern should be solid, NOT bleed dashed from pen');
            assert.strictEqual(hlInitialState.straightenLines, false, 'Highlighter straightenLines should be false, NOT bleed true from pen');

            // Customize highlighter to width 30
            controller.setWidth(30);
            assert.strictEqual(controller.getToolState().highlighter.width, 30, 'Highlighter width updated to 30');

            // 3. Switch back to pen
            controller.setTool('pen');
            assert.strictEqual(controller.getToolState().activeTool, 'pen');

            // Verify all of pen's customized properties are completely preserved and restored intact!
            const restoredPenState = controller.getToolState().pen;
            assert.strictEqual(restoredPenState.profileId, 'calli', 'Pen profile restored to calli');
            assert.strictEqual(restoredPenState.color, '#E53935', 'Pen color restored to red #E53935');
            assert.strictEqual(restoredPenState.width, 7, 'Pen width restored to 7, NOT overwritten by highlighter width 30 or reset to 3.2');
            assert.strictEqual(restoredPenState.pattern, 'dashed', 'Pen pattern restored to dashed');
            assert.strictEqual(restoredPenState.straightenLines, true, 'Pen straightenLines restored to true');

            // Verify internal active style in controller also reflects the restored pen slice
            assert.strictEqual((controller as any).penProfileId, 'calli');
            assert.strictEqual((controller as any).style.color, '#E53935');
            assert.strictEqual((controller as any).style.width, 7);
            assert.strictEqual((controller as any).style.pattern, 'dashed');
            assert.strictEqual(controller.getStraightenLines(), true);

            // Clean up
            controller.destroy();
        } finally {
            (globalThis as any).window = prevWin;
            (globalThis as any).document = prevDoc;
            (globalThis as any).getComputedStyle = prevGetComputedStyle;
            (globalThis as any).ResizeObserver = prevResizeObserver;
            (globalThis as any).requestAnimationFrame = prevRAF;
            (globalThis as any).cancelAnimationFrame = prevCAF;
        }
    });

    test('2. Mode Switch Resilience: Transition from Reading View to Editing View hydrates from WorkspaceToolState without resetting to default fountain/blue', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevWin = (globalThis as any).window;
        const prevDoc = (globalThis as any).document;
        const prevGetComputedStyle = (globalThis as any).getComputedStyle;
        const prevResizeObserver = (globalThis as any).ResizeObserver;
        const prevRAF = (globalThis as any).requestAnimationFrame;
        const prevCAF = (globalThis as any).cancelAnimationFrame;

        (globalThis as any).window = mockWindow;
        (globalThis as any).document = mockDocument;
        (globalThis as any).getComputedStyle = () => ({ position: 'relative', overflow: 'auto', userSelect: 'none' });
        (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
        (globalThis as any).requestAnimationFrame = (cb: Function) => setTimeout(cb, 0);
        (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);

        try {
            const docModel = { id: 'test-page-2', elements: [], blocks: {}, version: 2 } as any;
            const mockFile = { path: 'notes/demo.md', basename: 'demo' } as any;
            const mockPersistence = {
                flush: async () => {},
                enqueue: () => {},
                loadDocumentForNote: async () => docModel,
            } as any;

            // Prepare a customized WorkspaceToolState saved in plugin
            const savedPluginToolState: WorkspaceToolState = {
                ...DEFAULT_WORKSPACE_TOOL_STATE,
                activeTool: 'pen',
                penEnabled: true,
                snapGrid: true,
                pen: {
                    profileId: 'pencil',
                    color: '#10B981', // green
                    width: 5.5,
                    opacity: 0.85,
                    smoothing: 0.8,
                    pattern: 'dotted',
                    straightenLines: true,
                    activeSlotIndex: 2,
                    palette: {
                        colors: ['#E53935', '#1F4FD8', '#10B981', '#111827'],
                        opacities: [100, 100, 100, 100],
                    },
                },
                highlighter: {
                    profileId: 'hlf',
                    color: '#00ACC1',
                    width: 28,
                    opacity: 0.7,
                    pattern: 'solid',
                    straightenLines: false,
                    activeSlotIndex: 3,
                    palette: {
                        colors: ['#1E88E5', '#FDD835', '#43A047', '#00ACC1'],
                        opacities: [75, 75, 75, 75],
                    },
                },
            };

            // 1. Simulate Reading View mounting (readonly: true)
            const readingScroller = mockDocument.createElement('div');
            readingScroller.className = 'markdown-preview-view';
            const readingOptions = createControllerOptions({
                readonly: true,
                toolState: savedPluginToolState,
            });

            const readingController = new CanvasController(
                readingScroller as any,
                undefined,
                docModel,
                mockFile,
                'notes/demo.md',
                mockPersistence,
                readingOptions,
            );

            // Verify Reading Controller holds the customized tool state
            assert.strictEqual(readingController.getToolState().pen.profileId, 'pencil');
            assert.strictEqual(readingController.getToolState().pen.color, '#10B981');
            assert.strictEqual(readingController.getToolState().pen.width, 5.5);
            assert.strictEqual(readingController.getToolState().pen.pattern, 'dotted');
            assert.strictEqual(readingController.getToolState().pen.straightenLines, true);
            readingController.destroy();

            // 2. Simulate User toggling back to Editing Mode / Live Preview (readonly: false)
            // A brand new CanvasController is mounted onto the CodeMirror scroller
            const editingScroller = mockDocument.createElement('div');
            editingScroller.className = 'cm-scroller';
            let pluginSavedState: WorkspaceToolState = cloneWorkspaceToolState(savedPluginToolState);

            const editingOptions = createControllerOptions({
                readonly: false,
                toolState: pluginSavedState,
                onToolStateChange: (updated) => {
                    pluginSavedState = cloneWorkspaceToolState(updated);
                },
            });

            const editingController = new CanvasController(
                editingScroller as any,
                undefined,
                docModel,
                mockFile,
                'notes/demo.md',
                mockPersistence,
                editingOptions,
            );

            // 3. Verify Editing Controller is immediately hydrated from WorkspaceToolState
            // It MUST NOT fall back to 'fountain' or '#1F4FD8' or width 3!
            const currentToolState = editingController.getToolState();
            assert.strictEqual(currentToolState.activeTool, 'pen');
            assert.strictEqual(currentToolState.pen.profileId, 'pencil', 'Must preserve pencil profile across mode switches');
            assert.strictEqual(currentToolState.pen.color, '#10B981', 'Must preserve green color across mode switches');
            assert.strictEqual(currentToolState.pen.width, 5.5, 'Must preserve width 5.5 across mode switches');
            assert.strictEqual(currentToolState.pen.pattern, 'dotted', 'Must preserve dotted pattern across mode switches');
            assert.strictEqual(currentToolState.pen.straightenLines, true, 'Must preserve straightenLines across mode switches');
            assert.strictEqual(currentToolState.highlighter.width, 28, 'Must preserve highlighter width across mode switches');

            // Verify UI components (Toolbar and ToolEstuche) also match the hydrated state
            assert.strictEqual((editingController as any).penProfileId, 'pencil');
            assert.strictEqual((editingController as any).style.color, '#10B981');
            assert.strictEqual((editingController as any).style.width, 5.5);
            assert.strictEqual((editingController as any).style.pattern, 'dotted');
            assert.strictEqual(editingController.getStraightenLines(), true);

            editingController.destroy();
        } finally {
            (globalThis as any).window = prevWin;
            (globalThis as any).document = prevDoc;
            (globalThis as any).getComputedStyle = prevGetComputedStyle;
            (globalThis as any).ResizeObserver = prevResizeObserver;
            (globalThis as any).requestAnimationFrame = prevRAF;
            (globalThis as any).cancelAnimationFrame = prevCAF;
        }
    });

    test('3. mergeWorkspaceToolState correctly handles partial and legacy saved state', () => {
        // Empty saved data returns default
        const mergedDefault = mergeWorkspaceToolState(null);
        assert.deepStrictEqual(mergedDefault, DEFAULT_WORKSPACE_TOOL_STATE);

        // Partial saved data preserves existing fields and fills missing
        const partial = {
            activeTool: 'highlighter' as const,
            pen: {
                profileId: 'ball' as const,
                color: '#D9480F',
                width: 4,
                opacity: 1,
                smoothing: 0.5,
                pattern: 'solid' as const,
                straightenLines: false,
                activeSlotIndex: 1,
                palette: {
                    colors: ['#E53935', '#D9480F', '#10B981', '#111827'],
                    opacities: [100, 100, 100, 100],
                },
            },
        };

        const merged = mergeWorkspaceToolState(partial);
        assert.strictEqual(merged.activeTool, 'highlighter');
        assert.strictEqual(merged.pen.profileId, 'ball');
        assert.strictEqual(merged.pen.color, '#D9480F');
        assert.strictEqual(merged.pen.width, 4);
        assert.strictEqual(merged.highlighter.profileId, 'hlr');
        assert.strictEqual(merged.eraser.mode, 'whole');
        assert.strictEqual(merged.lasso.mode, 'free');
    });

    test('4. Persistence Round-Trip: Profile trees and derived legacy favorites projection serialize and deserialize identically', () => {
        const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
        const p1 = createFavoritePreset({ tool: 'pen', profileId: 'ball', color: '#1F4FD8', width: 3 });
        const p2 = createFavoritePreset({ tool: 'pen', profileId: 'pencil', color: '#10B981', width: 5 });
        setCanonicalFavorites(state, 'pen', [p1, p2]);

        // Verify canonical and legacy projection match before persistence
        assert.strictEqual(state.favorites.pen.length, 2);
        assert.strictEqual(state.strokeFavoriteProfiles[0].pen.length, 2);
        assert.strictEqual(state.favorites.pen[0].color, '#1F4FD8');

        // Simulate Obsidian settings persistence roundtrip (JSON stringify -> parse)
        const serialized = JSON.stringify(state);
        const parsed = JSON.parse(serialized);
        const hydrated = mergeWorkspaceToolState(parsed);

        // Verify hydrated state restores profiles and projection
        assert.strictEqual(hydrated.activeStrokeProfileId, 'notes');
        assert.strictEqual(hydrated.strokeFavoriteProfiles[0].pen.length, 2);
        assert.strictEqual(hydrated.strokeFavoriteProfiles[0].pen[0].color, '#1F4FD8');
        assert.strictEqual(hydrated.favorites.pen.length, 2);
        assert.strictEqual(hydrated.favorites.pen[0].color, '#1F4FD8');
    });

    test('5. Profile Switch & Mutation: Switching profiles updates legacy favorites projection without dropping data', () => {
        const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
        const notePreset = createFavoritePreset({ tool: 'pen', profileId: 'ball', color: '#000000', width: 2 });
        setCanonicalFavorites(state, 'pen', [notePreset]);

        // Switch to 'academic' profile
        switchStrokeProfile(state, 'academic');
        assert.strictEqual(state.activeStrokeProfileId, 'academic');
        // 'academic' starts empty
        assert.strictEqual(state.favorites.pen.length, 0);

        // Add academic preset
        const academicPreset = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#FF0000', width: 4 });
        setCanonicalFavorites(state, 'pen', [academicPreset]);
        assert.strictEqual(state.favorites.pen.length, 1);
        assert.strictEqual(state.favorites.pen[0].color, '#FF0000');

        // Switch back to 'notes': original notePreset is preserved, and projection reflects notes
        switchStrokeProfile(state, 'notes');
        assert.strictEqual(state.activeStrokeProfileId, 'notes');
        assert.strictEqual(state.favorites.pen.length, 1);
        assert.strictEqual(state.favorites.pen[0].color, '#000000');

        // Switch back to 'academic': academicPreset is preserved
        switchStrokeProfile(state, 'academic');
        assert.strictEqual(state.activeStrokeProfileId, 'academic');
        assert.strictEqual(state.favorites.pen.length, 1);
        assert.strictEqual(state.favorites.pen[0].color, '#FF0000');
    });
});
