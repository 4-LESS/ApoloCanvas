import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
    FavoritesDrawer,
    type FavoritesDrawerCallbacks,
} from '../src/ui/favorites/FavoritesDrawer.ts';
import {
    createFavoritePreset,
    toggleFavoritePreset,
    getActiveStrokeProfile,
    getActiveShapeProfile,
    syncLegacyFavoritesSlice,
    findMatchingProfile,
    switchStrokeProfile,
    switchShapeProfile,
    createStrokeProfile,
    createShapeProfile,
    renameStrokeProfile,
    deleteStrokeProfile,
    renameShapeProfile,
    deleteShapeProfile,
    renameFavoritePreset,
} from '../src/ui/favorites/FavoritesStore.ts';
import {
    ToolEstuche,
    type ToolEstucheState,
    type ToolEstucheCallbacks,
} from '../src/ui/ToolEstuche.ts';
import {
    DEFAULT_WORKSPACE_TOOL_STATE,
    DEFAULT_STROKE_FAVORITE_PROFILES,
    DEFAULT_SHAPE_FAVORITE_PROFILES,
    cloneWorkspaceToolState,
    mergeWorkspaceToolState,
    type PenFavoritePreset,
    type HighlighterFavoritePreset,
    type ShapeFavoritePreset,
    type WorkspaceToolState,
} from '../src/core/types.ts';

function createMockEnvironment() {
    const createElement = (tag: string) => {
        const children: any[] = [];
        const classes = new Set<string>();
        const attributes = new Map<string, string>();
        const elementListeners = new Map<string, Function[]>();
        const styleObj: any = {
            display: '',
            zIndex: '',
            position: '',
            top: '',
            left: '',
            right: '',
            bottom: '',
            transform: '',
            setProperty: (k: string, v: string) => { styleObj[k] = v; },
            getPropertyValue: (k: string) => styleObj[k] ?? '',
        };

        const matchesSelector = (node: any, sel: string): boolean => {
            if (!node || typeof node !== 'object') return false;
            const notMatch = sel.match(/^([a-zA-Z0-9_.-]+)?:not\((.+)\)$/);
            if (notMatch) {
                const baseSel = notMatch[1];
                const negatedSel = notMatch[2];
                if (baseSel && !matchesSelector(node, baseSel)) return false;
                return !matchesSelector(node, negatedSel);
            }
            if (sel.startsWith('.')) {
                const targetClasses = sel.slice(1).split('.');
                return targetClasses.every(cls => Boolean(node.classList?.contains(cls) || node.className?.split(/\s+/).includes(cls)));
            }
            if (sel.startsWith('#')) {
                return node.id === sel.slice(1);
            }
            if (sel.startsWith('[') && sel.endsWith(']')) {
                const inner = sel.slice(1, -1);
                const eqIdx = inner.indexOf('=');
                if (eqIdx !== -1) {
                    const attr = inner.slice(0, eqIdx);
                    const val = inner.slice(eqIdx + 1).replace(/^["']|["']$/g, '');
                    return node.getAttribute(attr) === val || node.dataset?.[attr.replace('data-', '')] === val;
                }
                return node.hasAttribute(inner);
            }
            if (sel.toLowerCase() === node.tagName?.toLowerCase()) {
                return true;
            }
            return false;
        };

        const el: any = {
            tagName: tag.toUpperCase(),
            style: styleObj,
            dataset: {},
            hidden: false,
            get className(): string {
                return [...classes].join(' ');
            },
            set className(v: string) {
                classes.clear();
                for (const c of String(v).split(/\s+/).filter(Boolean)) classes.add(c);
            },
            children,
            title: '',
            type: '',
            value: '',
            disabled: false,
            maxLength: 24,
            placeholder: '',
            focus: () => {},
            get textContent(): string {
                return children.map(c => typeof c === 'string' ? c : (c?.textContent ?? '')).join('');
            },
            set textContent(v: string) {
                children.length = 0;
                if (v !== '') children.push(String(v));
            },
            classList: {
                add: (...cs: string[]) => {
                    for (const c of cs) {
                        for (const item of c.split(/\s+/).filter(Boolean)) classes.add(item);
                    }
                    el.className = [...classes].join(' ');
                },
                remove: (...cs: string[]) => {
                    for (const c of cs) {
                        for (const item of c.split(/\s+/).filter(Boolean)) classes.delete(item);
                    }
                    el.className = [...classes].join(' ');
                },
                contains: (c: string) => classes.has(c) || el.className.split(/\s+/).filter(Boolean).includes(c),
                toggle: (c: string, force?: boolean) => {
                    const next = force !== undefined ? force : !classes.has(c);
                    if (next) classes.add(c); else classes.delete(c);
                    el.className = [...classes].join(' ');
                    return next;
                },
            },
            setAttribute: (k: string, v: string) => {
                attributes.set(k, String(v));
                if (k.startsWith('data-')) {
                    const dataKey = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
                    el.dataset[dataKey] = String(v);
                }
            },
            getAttribute: (k: string) => attributes.get(k) ?? null,
            hasAttribute: (k: string) => attributes.has(k),
            removeAttribute: (k: string) => {
                attributes.delete(k);
                if (k.startsWith('data-')) {
                    const dataKey = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
                    delete el.dataset[dataKey];
                }
            },
            appendChild: (child: any) => {
                if (child !== null && child !== undefined) {
                    children.push(child);
                    if (typeof child === 'object') child.parentElement = el;
                }
                return child;
            },
            append: (...args: any[]) => {
                for (const c of args) {
                    if (c !== null && c !== undefined) {
                        children.push(c);
                        if (typeof c === 'object') c.parentElement = el;
                    }
                }
            },
            replaceChildren: (...args: any[]) => {
                children.length = 0;
                for (const c of args) {
                    if (c !== null && c !== undefined) {
                        children.push(c);
                        if (typeof c === 'object') c.parentElement = el;
                    }
                }
            },
            remove: () => {
                if (el.parentElement?.children) {
                    const idx = el.parentElement.children.indexOf(el);
                    if (idx !== -1) el.parentElement.children.splice(idx, 1);
                }
            },
            contains: (target: any) => target === el || children.some(c => c === target || c?.contains?.(target)),
            querySelector: (sel: string): any => {
                const findIn = (node: any): any => {
                    if (!node || typeof node !== 'object') return null;
                    if (matchesSelector(node, sel)) return node;
                    for (const child of node.children || []) {
                        const res = findIn(child);
                        if (res) return res;
                    }
                    return null;
                };
                for (const child of children) {
                    const res = findIn(child);
                    if (res) return res;
                }
                return null;
            },
            querySelectorAll: (sel: string): any[] => {
                const results: any[] = [];
                const collect = (node: any) => {
                    if (!node || typeof node !== 'object') return;
                    if (matchesSelector(node, sel)) results.push(node);
                    for (const child of node.children || []) collect(child);
                };
                for (const child of children) collect(child);
                return results;
            },
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
            dispatchPointerEvent: (type: string, eventInit: { clientX: number; clientY: number }) => {
                const listeners = elementListeners.get(type) || [];
                const event = {
                    ...eventInit,
                    target: el,
                    currentTarget: el,
                    stopPropagation: () => {},
                    preventDefault: () => {},
                };
                for (const listener of listeners) {
                    listener(event);
                }
            },
            getBoundingClientRect: () => ({
                top: 100,
                bottom: 200,
                left: 100,
                right: 300,
                width: 200,
                height: 100,
            }),
            offsetWidth: 280,
            offsetHeight: 320,
            onclick: null as any,
            onkeydown: null as any,
        };
        return el;
    };

    const mockDocument: any = {
        body: createElement('body'),
        createElement,
        createElementNS: (_ns: string, tag: string) => createElement(tag),
        addEventListener: () => {},
        removeEventListener: () => {},
    };

    return mockDocument;
}

describe('Phase 5: Independent Favorite Profiles for Strokes & Shapes', () => {
    let prevDoc: any;
    let prevWindow: any;

    beforeEach(() => {
        prevDoc = (globalThis as any).document;
        prevWindow = (globalThis as any).window;
        const mockDoc = createMockEnvironment();
        (globalThis as any).document = mockDoc;
        (globalThis as any).window = {
            document: mockDoc,
            innerWidth: 1024,
            innerHeight: 768,
            addEventListener: () => {},
            removeEventListener: () => {},
            setTimeout: (fn: Function) => fn(),
            clearTimeout: () => {},
        };
    });

    afterEach(() => {
        (globalThis as any).document = prevDoc;
        (globalThis as any).window = prevWindow;
    });

    // =========================================================================
    // 1. Decoupled Profile Data Model
    // =========================================================================
    describe('1. Decoupled Profile Data Model & Switching Behavior', () => {
        test('initializes with independent default stroke and shape profiles', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);

            assert.strictEqual(state.strokeFavoriteProfiles.length, 3);
            assert.deepStrictEqual(
                state.strokeFavoriteProfiles.map(p => p.id),
                ['notes', 'academic', 'engineering'],
            );
            assert.strictEqual(state.activeStrokeProfileId, 'notes');

            assert.strictEqual(state.shapeFavoriteProfiles.length, 3);
            assert.deepStrictEqual(
                state.shapeFavoriteProfiles.map(p => p.id),
                ['general', 'diagrams', 'engineering'],
            );
            assert.strictEqual(state.activeShapeProfileId, 'general');
            assert.strictEqual(state.syncFavoriteProfiles, false);
        });

        test('presets added to a stroke profile do NOT cross into other profiles or shapes', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);

            const penPreset = createFavoritePreset({
                tool: 'pen',
                profileId: 'calli',
                color: '#ef4444',
                width: 5,
            }) as PenFavoritePreset;

            const notesProfile = getActiveStrokeProfile(state);
            notesProfile.pen.push(penPreset);
            syncLegacyFavoritesSlice(state);

            assert.strictEqual(state.favorites.pen.length, 1);
            assert.strictEqual(state.favorites.pen[0].id, penPreset.id);

            // Switch to academic profile
            switchStrokeProfile(state, 'academic');
            assert.strictEqual(state.activeStrokeProfileId, 'academic');
            assert.strictEqual(state.favorites.pen.length, 0, 'Academic profile must be empty');

            // Switch back to notes profile
            switchStrokeProfile(state, 'notes');
            assert.strictEqual(state.activeStrokeProfileId, 'notes');
            assert.strictEqual(state.favorites.pen.length, 1, 'Notes profile retains its presets');

            // Shape profiles remain empty
            const shapeProfile = getActiveShapeProfile(state);
            assert.strictEqual(shapeProfile.shape.length, 0);
            assert.strictEqual(state.favorites.shape.length, 0);
        });

        test('switching profiles in pen updates activeStrokeProfileId without changing activeShapeProfileId when syncFavoriteProfiles is false (default)', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            assert.strictEqual(state.syncFavoriteProfiles, false);
            assert.strictEqual(state.activeStrokeProfileId, 'notes');
            assert.strictEqual(state.activeShapeProfileId, 'general');

            // Switch stroke profile to 'engineering'
            switchStrokeProfile(state, 'engineering');
            assert.strictEqual(state.activeStrokeProfileId, 'engineering');
            assert.strictEqual(state.activeShapeProfileId, 'general', 'activeShapeProfileId must remain untouched');

            // Switch shape profile to 'diagrams'
            switchShapeProfile(state, 'diagrams');
            assert.strictEqual(state.activeShapeProfileId, 'diagrams');
            assert.strictEqual(state.activeStrokeProfileId, 'engineering', 'activeStrokeProfileId must remain untouched');
        });

        test('enabling syncFavoriteProfiles = true synchronizes profile switching between stroke and shape profiles', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            state.syncFavoriteProfiles = true;

            // 1. Switch stroke profile to 'engineering': matches shape profile 'engineering' by ID
            switchStrokeProfile(state, 'engineering');
            assert.strictEqual(state.activeStrokeProfileId, 'engineering');
            assert.strictEqual(state.activeShapeProfileId, 'engineering', 'Shape profile must synchronize to engineering by ID');

            // 2. Switch stroke profile to 'academic' (index 1): matches shape profile 'diagrams' (index 1 fallback)
            switchStrokeProfile(state, 'academic');
            assert.strictEqual(state.activeStrokeProfileId, 'academic');
            assert.strictEqual(state.activeShapeProfileId, 'diagrams', 'Shape profile must synchronize by index fallback');

            // 3. Switch shape profile to 'general' (index 0): matches stroke profile 'notes' (index 0 fallback)
            switchShapeProfile(state, 'general');
            assert.strictEqual(state.activeShapeProfileId, 'general');
            assert.strictEqual(state.activeStrokeProfileId, 'notes', 'Stroke profile must synchronize to notes');
        });

        test('creating a profile in stroke domain creates independent profile or syncs when enabled', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);

            // Sync false: only creates in stroke domain
            state.syncFavoriteProfiles = false;
            const newStroke = createStrokeProfile(state, 'Arquitectura');
            assert.strictEqual(state.strokeFavoriteProfiles.length, 4);
            assert.strictEqual(state.activeStrokeProfileId, newStroke.id);
            assert.strictEqual(state.shapeFavoriteProfiles.length, 3, 'Shape profiles should NOT increase');
            assert.strictEqual(state.activeShapeProfileId, 'general');

            // Sync true: creates in both domains
            state.syncFavoriteProfiles = true;
            const syncedProfile = createStrokeProfile(state, 'Química');
            assert.strictEqual(state.strokeFavoriteProfiles.length, 5);
            assert.strictEqual(state.shapeFavoriteProfiles.length, 4, 'Shape profiles should also receive new profile');
            assert.strictEqual(state.activeStrokeProfileId, syncedProfile.id);
            assert.strictEqual(state.activeShapeProfileId, syncedProfile.id);
        });
    });

    // =========================================================================
    // 2. FavoritesDrawer Header, Navigation & Sync Toggle
    // =========================================================================
    describe('2. FavoritesDrawer Clean UI & ToolEstuche Header Profile Integration', () => {
        test('FavoritesDrawer does NOT render redundant sub-header bar or sync button', () => {
            const profiles = [
                { id: 'notes', name: 'Notas' },
                { id: 'academic', name: 'Académico' },
            ];

            const drawer = new FavoritesDrawer(
                {
                    onSelectFavorite: () => {},
                    onDeleteFavorite: () => {},
                    onReorderFavorite: () => {},
                },
                'pen',
                [],
                null,
                undefined,
                profiles,
                'notes',
                false,
            );

            assert.strictEqual(drawer.el.querySelector('.apolo-profile-header'), null, 'Sub-header bar must be removed');
            assert.strictEqual(drawer.el.querySelector('.apolo-profile-sync-btn'), null, 'Sync toggle button must be removed from drawer');
            assert.ok(drawer.el.querySelector('.apolo-favorites-empty'), 'Empty state should render directly');
        });

        test('ToolEstuche renders active profile name in main header title and pagination dots', () => {
            let switchedProfileId = '';
            const profiles = [
                { id: 'notes', name: 'Notas', pen: [], highlighter: [] },
                { id: 'academic', name: 'Académico', pen: [], highlighter: [] },
            ];

            const root = document.createElement('div');
            const estuche = new ToolEstuche(
                {
                    tool: 'pen',
                    slot: 'tc',
                    color: '#000',
                    width: 2,
                    profileId: 'ball',
                    smoothing: 0.5,
                    pressureSensitivity: 0.7,
                    showingFavorites: true,
                    strokeFavoriteProfiles: profiles,
                    activeStrokeProfileId: 'notes',
                },
                {
                    onSelectProfile: () => {},
                    onChangeColor: () => {},
                    onChangeWidth: () => {},
                    onChangeSmoothing: () => {},
                    onChangePressure: () => {},
                    onUseFavorite: () => {},
                    onSaveFavorite: () => {},
                    onSelectEraserMode: () => {},
                    onChangeEraserRadius: () => {},
                    onToggleScribble: () => {},
                    onSelectLassoMode: () => {},
                    onSelectShapeType: () => {},
                    onToggleSnapGrid: () => {},
                    onSwitchProfile: (id) => { switchedProfileId = id; },
                },
                root,
            );
            estuche.open();

            // Header title reflects active profile name 'Notas'
            const titleEl = root.querySelector('.popover-title');
            assert.ok(titleEl);
            assert.strictEqual(titleEl.textContent, 'Notas');

            // Minimalist dots indicator in header (.apolo-kit-dots-indicator inside .popover-title-wrap)
            const titleWrap = root.querySelector('.popover-title-wrap');
            assert.ok(titleWrap, '.popover-title-wrap container must exist');
            const dotsIndicator = root.querySelector('.apolo-kit-dots-indicator');
            assert.ok(dotsIndicator, '.apolo-kit-dots-indicator must be rendered under title');

            // Pagination dots rendered in header area (profile dots + add-dot indicator)
            const dots = root.querySelectorAll('.popover-header-dot:not(.is-add-dot)');
            assert.strictEqual(dots.length, 2);
            assert.ok(dots[0].classList.contains('is-active'));
            assert.ok(dots[0].classList.contains('apolo-kit-dot'));
            assert.strictEqual((dots[0] as HTMLElement).title, 'Notas');
            assert.ok(!dots[1].classList.contains('is-active'));
            assert.ok(dots[1].classList.contains('apolo-kit-dot'));
            assert.strictEqual((dots[1] as HTMLElement).title, 'Académico');

            // Add profile dot indicator at the end
            const addDot = root.querySelector('.popover-header-dot.is-add-dot');
            assert.ok(addDot, 'Add profile dot indicator must exist');

            // Navigation chevrons flanking the dots
            const prevBtn = root.querySelector('.apolo-kit-nav-prev');
            assert.ok(prevBtn, 'Previous profile chevron must exist');
            const nextBtn = root.querySelector('.apolo-kit-nav-next');
            assert.ok(nextBtn, 'Next profile chevron must exist');

            // Click dot 1 to switch to 'academic'
            dots[1].onclick?.({ stopPropagation: () => {} } as any);
            assert.strictEqual(switchedProfileId, 'academic');
            assert.strictEqual(titleEl.textContent, 'Académico');
            const updatedDots = root.querySelectorAll('.popover-header-dot:not(.is-add-dot)');
            assert.ok(!updatedDots[0].classList.contains('is-active'));
            assert.ok(updatedDots[1].classList.contains('is-active'));

            estuche.destroy();
        });

        test('FavoritesDrawer can render .apolo-kit-dots-indicator with onSelectProfile callback', () => {
            let selectedProfile = '';
            const profiles = [
                { id: 'p1', name: 'Kit 1' },
                { id: 'p2', name: 'Kit 2' },
                { id: 'p3', name: 'Kit 3' },
            ];

            const drawer = new FavoritesDrawer(
                {
                    onSelectFavorite: () => {},
                    onDeleteFavorite: () => {},
                    onReorderFavorite: () => {},
                    onSelectProfile: (id) => { selectedProfile = id; },
                },
                'pen',
                [],
                null,
                undefined,
                profiles,
                'p1',
                false,
                true, // showDotsIndicator
            );

            const indicator = drawer.el.querySelector('.apolo-kit-dots-indicator');
            assert.ok(indicator, 'FavoritesDrawer with showDotsIndicator must render .apolo-kit-dots-indicator');
            const dots = indicator.querySelectorAll('.apolo-kit-dot:not(.is-add-dot)');
            assert.strictEqual(dots.length, 3);
            assert.ok(dots[0].classList.contains('is-active'));
            assert.strictEqual((dots[0] as HTMLElement).title, 'Kit 1');
            assert.strictEqual((dots[1] as HTMLElement).title, 'Kit 2');

            // Add dot indicator at the end
            const addDot = indicator.querySelector('.apolo-kit-dot.is-add-dot');
            assert.ok(addDot, 'Add profile dot indicator must exist');

            // Click dot 2 switches to 'p2'
            (dots[1] as HTMLElement).onclick?.({ stopPropagation: () => {} } as any);
            assert.strictEqual(selectedProfile, 'p2');

            drawer.destroy();
        });
    });

    // =========================================================================
    // 3. Horizontal Swipe Gestures & Overswipe Creation
    // =========================================================================
    describe('3. Horizontal Swipe Gestures & Overswipe Creation', () => {
        test('horizontal swipe navigates between profiles (swipe left -> next, swipe right -> previous)', () => {
            const profiles = [
                { id: 'p1', name: 'Uno' },
                { id: 'p2', name: 'Dos' },
                { id: 'p3', name: 'Tres' },
            ];

            let activeId = 'p2';
            const drawer = new FavoritesDrawer(
                {
                    onSelectFavorite: () => {},
                    onDeleteFavorite: () => {},
                    onReorderFavorite: () => {},
                    onSwitchProfile: (id) => {
                        activeId = id;
                        drawer.updateState({ activeProfileId: id });
                    },
                },
                'pen',
                [],
                null,
                undefined,
                profiles,
                'p2',
            );

            // 1. Swipe Left (dx = -60): Next profile (p2 -> p3)
            drawer.handleHorizontalSwipe(-60);
            assert.strictEqual(activeId, 'p3');

            // 2. Swipe Right (dx = +70): Previous profile (p3 -> p2)
            drawer.handleHorizontalSwipe(70);
            assert.strictEqual(activeId, 'p2');

            // 3. Swipe Right (dx = +50): Previous profile (p2 -> p1)
            drawer.handleHorizontalSwipe(50);
            assert.strictEqual(activeId, 'p1');
        });

        test('pointer gesture event dispatch triggers horizontal swipe when dx >= 44 and dx > dy * 1.4', () => {
            const profiles = [
                { id: 'p1', name: 'Uno' },
                { id: 'p2', name: 'Dos' },
            ];

            let activeId = 'p1';
            const drawer = new FavoritesDrawer(
                {
                    onSelectFavorite: () => {},
                    onDeleteFavorite: () => {},
                    onReorderFavorite: () => {},
                    onSwitchProfile: (id) => {
                        activeId = id;
                        drawer.updateState({ activeProfileId: id });
                    },
                },
                'pen',
                [],
                null,
                undefined,
                profiles,
                'p1',
            );

            const el = drawer.el as any;

            // Insufficient swipe (dx = -20) -> should NOT trigger
            el.dispatchPointerEvent('pointerdown', { clientX: 100, clientY: 100 });
            el.dispatchPointerEvent('pointerup', { clientX: 80, clientY: 100 });
            assert.strictEqual(activeId, 'p1');

            // Mostly vertical gesture (dx = -50, dy = 60) -> should NOT trigger
            el.dispatchPointerEvent('pointerdown', { clientX: 100, clientY: 100 });
            el.dispatchPointerEvent('pointerup', { clientX: 50, clientY: 160 });
            assert.strictEqual(activeId, 'p1');

            // Valid horizontal swipe left (dx = -55, dy = 5) -> triggers next profile p1 -> p2
            el.dispatchPointerEvent('pointerdown', { clientX: 100, clientY: 100 });
            el.dispatchPointerEvent('pointerup', { clientX: 45, clientY: 105 });
            assert.strictEqual(activeId, 'p2');
        });

        test('overswipe beyond boundary opens "Nuevo perfil" inline creation form', () => {
            const profiles = [
                { id: 'p1', name: 'Uno' },
                { id: 'p2', name: 'Dos' },
            ];

            const drawer = new FavoritesDrawer(
                {
                    onSelectFavorite: () => {},
                    onDeleteFavorite: () => {},
                    onReorderFavorite: () => {},
                },
                'pen',
                [],
                null,
                undefined,
                profiles,
                'p2', // at last profile
            );

            // Initially not showing create form
            assert.strictEqual(drawer.el.querySelector('.apolo-profile-create-form'), null);

            // Overswipe left (dx < 0) on last profile -> opens create form
            drawer.handleHorizontalSwipe(-50);
            const form = drawer.el.querySelector('.apolo-profile-create-form');
            assert.ok(form, 'Create form must open on overswipe beyond edge');

            const input = form.querySelector('.apolo-profile-name-input');
            assert.ok(input);
            const createBtn = form.querySelector('.apolo-profile-create-btn');
            assert.ok(createBtn);
            const cancelBtn = form.querySelector('.apolo-profile-cancel-btn');
            assert.ok(cancelBtn);

            // Cancel button closes create form
            cancelBtn.onclick({ stopPropagation: () => {} });
            assert.strictEqual(drawer.el.querySelector('.apolo-profile-create-form'), null);
        });

        test('overswiping boundary opens create form and submitting creates new independent profile', () => {
            let createdName = '';
            const profiles = [
                { id: 'p1', name: 'Uno' },
            ];

            const drawer = new FavoritesDrawer(
                {
                    onSelectFavorite: () => {},
                    onDeleteFavorite: () => {},
                    onReorderFavorite: () => {},
                    onCreateProfile: (name) => {
                        createdName = name;
                    },
                },
                'pen',
                [],
                null,
                undefined,
                profiles,
                'p1',
            );

            // Overswipe beyond boundary to trigger create form
            drawer.handleHorizontalSwipe(-50);

            const form = drawer.el.querySelector('.apolo-profile-create-form');
            assert.ok(form);

            const input = form.querySelector('.apolo-profile-name-input') as any;
            assert.ok(input);
            input.value = 'Matemáticas';

            const createBtn = form.querySelector('.apolo-profile-create-btn');
            assert.ok(createBtn);
            createBtn.onclick({ stopPropagation: () => {} });

            assert.strictEqual(createdName, 'Matemáticas');
            assert.strictEqual(drawer.el.querySelector('.apolo-profile-create-form'), null);
        });
    });

    // =========================================================================
    // 4. Persistence Across Reloads
    // =========================================================================
    describe('4. Persistence Across Reloads', () => {
        test('survives WorkspaceToolState serialization and hydration with independent profiles and sync flag', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);

            // Customize state
            state.activeStrokeProfileId = 'academic';
            state.activeShapeProfileId = 'diagrams';
            state.syncFavoriteProfiles = true;

            const p1 = createFavoritePreset({ tool: 'pen', profileId: 'calli', color: '#111', width: 4 }) as PenFavoritePreset;
            state.strokeFavoriteProfiles[1].pen.push(p1); // into academic

            const s1 = createFavoritePreset({ tool: 'shape', shapeType: 'triangle', color: '#222', width: 2 }) as ShapeFavoritePreset;
            state.shapeFavoriteProfiles[1].shape.push(s1); // into diagrams

            syncLegacyFavoritesSlice(state);

            // Serialize & deserialize
            const serialized = JSON.stringify(state);
            const deserialized = JSON.parse(serialized);
            const hydrated = mergeWorkspaceToolState(deserialized);

            assert.strictEqual(hydrated.activeStrokeProfileId, 'academic');
            assert.strictEqual(hydrated.activeShapeProfileId, 'diagrams');
            assert.strictEqual(hydrated.syncFavoriteProfiles, true);

            assert.strictEqual(hydrated.strokeFavoriteProfiles.length, 3);
            assert.strictEqual(hydrated.shapeFavoriteProfiles.length, 3);

            assert.strictEqual(hydrated.strokeFavoriteProfiles[1].pen.length, 1);
            assert.strictEqual(hydrated.strokeFavoriteProfiles[1].pen[0].id, p1.id);

            assert.strictEqual(hydrated.shapeFavoriteProfiles[1].shape.length, 1);
            assert.strictEqual(hydrated.shapeFavoriteProfiles[1].shape[0].id, s1.id);

            // Legacy slice correctly resolved
            assert.strictEqual(hydrated.favorites.pen.length, 1);
            assert.strictEqual(hydrated.favorites.pen[0].id, p1.id);
            assert.strictEqual(hydrated.favorites.shape.length, 1);
            assert.strictEqual(hydrated.favorites.shape[0].id, s1.id);
        });
    });

    // =========================================================================
    // 5. Profile & Preset Management (Rename, Delete, Create)
    // =========================================================================
    describe('5. Profile & Preset Management', () => {
        test('renameStrokeProfile and renameShapeProfile update profile name and sync when enabled', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            state.syncFavoriteProfiles = true;

            assert.strictEqual(state.strokeFavoriteProfiles[0].name, 'Notas');
            assert.strictEqual(state.shapeFavoriteProfiles[0].name, 'General');

            renameStrokeProfile(state, 'notes', 'Borrador Rápido');
            assert.strictEqual(state.strokeFavoriteProfiles[0].name, 'Borrador Rápido');

            renameShapeProfile(state, 'general', 'Figuras');
            assert.strictEqual(state.shapeFavoriteProfiles[0].name, 'Figuras');
        });

        test('deleteStrokeProfile and deleteShapeProfile remove profile and prevent deleting last profile', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            assert.strictEqual(state.strokeFavoriteProfiles.length, 3);

            // Delete academic profile
            const deleted = deleteStrokeProfile(state, 'academic');
            assert.strictEqual(deleted, true);
            assert.strictEqual(state.strokeFavoriteProfiles.length, 2);
            assert.ok(!state.strokeFavoriteProfiles.some(p => p.id === 'academic'));

            // Delete engineering profile
            deleteStrokeProfile(state, 'engineering');
            assert.strictEqual(state.strokeFavoriteProfiles.length, 1);

            // Attempt to delete last remaining profile should fail
            const cannotDeleteLast = deleteStrokeProfile(state, 'notes');
            assert.strictEqual(cannotDeleteLast, false);
            assert.strictEqual(state.strokeFavoriteProfiles.length, 1);

            // Same for shapes
            assert.strictEqual(state.shapeFavoriteProfiles.length, 3);
            deleteShapeProfile(state, 'diagrams');
            deleteShapeProfile(state, 'engineering');
            assert.strictEqual(state.shapeFavoriteProfiles.length, 1);
            const cannotDeleteLastShape = deleteShapeProfile(state, 'general');
            assert.strictEqual(cannotDeleteLastShape, false);
            assert.strictEqual(state.shapeFavoriteProfiles.length, 1);
        });

        test('renameFavoritePreset updates preset name in active profile', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const p1 = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#111', width: 3 });
            state.strokeFavoriteProfiles[0].pen.push(p1);

            const renamed = renameFavoritePreset(state, 'pen', p1.id, 'Mi Pluma Favorita');
            assert.strictEqual(renamed, true);
            assert.strictEqual(state.strokeFavoriteProfiles[0].pen[0].name, 'Mi Pluma Favorita');

            // Renaming to empty string clears the custom name
            renameFavoritePreset(state, 'pen', p1.id, '');
            assert.strictEqual(state.strokeFavoriteProfiles[0].pen[0].name, undefined);
        });
    });
});
