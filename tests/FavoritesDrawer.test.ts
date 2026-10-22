import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
    FavoritesDrawer,
    createShapePreview,
    getPresetLabel,
    getPresetIcon,
    getPresetTooltip,
    type FavoritesDrawerCallbacks,
} from '../src/ui/favorites/FavoritesDrawer.ts';
import {
    createFavoritePreset,
    computeFavoriteFingerprint,
    findMatchingFavorite,
    toggleFavoritePreset,
    removeFavoriteById,
    reorderFavorites,
    MAX_FAVORITES_PER_TOOL,
} from '../src/ui/favorites/FavoritesStore.ts';
import {
    ToolEstuche,
    type ToolEstucheState,
    type ToolEstucheCallbacks,
} from '../src/ui/ToolEstuche.ts';
import {
    createStrokeWavePreview,
    PEN_PROFILES,
    ICONS,
} from '../src/ui/theme.ts';
import {
    DEFAULT_WORKSPACE_TOOL_STATE,
    cloneWorkspaceToolState,
    mergeWorkspaceToolState,
    type PenFavoritePreset,
    type HighlighterFavoritePreset,
    type ShapeFavoritePreset,
    type ToolFavoritePreset,
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
            if (sel.includes(',')) {
                return sel.split(',').some(s => matchesSelector(node, s.trim()));
            }
            if (/^[a-zA-Z0-9]+(\.[a-zA-Z0-9_-]+)+$/.test(sel)) {
                const [tagPart, ...classParts] = sel.split('.');
                if (tagPart.toLowerCase() !== node.tagName?.toLowerCase()) return false;
                return classParts.every(cls => Boolean(node.classList?.contains(cls) || node.className?.split(/\s+/).includes(cls)));
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

describe('FavoritesDrawer & Transversal Favorites System (Task 4 of 4)', () => {
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
    // 1. Fingerprint & Toggle Logic (FavoritesStore)
    // =========================================================================
    describe('1. Fingerprint & Toggle Logic (FavoritesStore)', () => {
        test('saving a pen preset marks isCurrentFavorite = true', () => {
            const penSlice = {
                profileId: 'calli' as const,
                color: '#ff0000',
                width: 6,
                opacity: 1,
                pattern: 'dashed' as const,
                straightenLines: true,
            };

            const initialList: PenFavoritePreset[] = [];
            const { updatedList, added, preset } = toggleFavoritePreset(initialList, penSlice);
            assert.strictEqual(added, true);
            assert.strictEqual(updatedList.length, 1);
            assert.strictEqual(preset?.tool, 'pen');
            assert.strictEqual(preset?.profileId, 'calli');
            assert.strictEqual(preset?.width, 6);
            assert.strictEqual(preset?.pattern, 'dashed');
            assert.strictEqual(preset?.straightenLines, true);

            const match = findMatchingFavorite(updatedList, penSlice, 'pen');
            assert.ok(match, 'Matching preset should be found');
            const isCurrentFavorite = Boolean(match);
            assert.strictEqual(isCurrentFavorite, true);
        });

        test('changing width from 6 to 8 or pattern from dashed to solid changes fingerprint and sets isCurrentFavorite = false', () => {
            const penSlice = {
                profileId: 'calli' as const,
                color: '#ff0000',
                width: 6,
                opacity: 1,
                pattern: 'dashed' as const,
                straightenLines: true,
            };

            const { updatedList: list } = toggleFavoritePreset([], penSlice);
            assert.strictEqual(list.length, 1);

            // Change width to 8
            const changedWidthSlice = { ...penSlice, width: 8 };
            assert.strictEqual(
                Boolean(findMatchingFavorite(list, changedWidthSlice, 'pen')),
                false,
                'isCurrentFavorite should become false when width changes',
            );

            // Change pattern to solid
            const changedPatternSlice = { ...penSlice, pattern: 'solid' as const };
            assert.strictEqual(
                Boolean(findMatchingFavorite(list, changedPatternSlice, 'pen')),
                false,
                'isCurrentFavorite should become false when pattern changes',
            );

            // Change straightenLines to false
            const changedStraightenSlice = { ...penSlice, straightenLines: false };
            assert.strictEqual(
                Boolean(findMatchingFavorite(list, changedStraightenSlice, 'pen')),
                false,
                'isCurrentFavorite should become false when straightenLines changes',
            );
        });

        test('clicking star again while isCurrentFavorite === true removes matching preset without duplicate', () => {
            const penSlice = {
                profileId: 'calli' as const,
                color: '#ff0000',
                width: 6,
                opacity: 1,
                pattern: 'dashed' as const,
                straightenLines: true,
            };

            // First toggle: saves preset
            const res1 = toggleFavoritePreset([], penSlice);
            assert.strictEqual(res1.added, true);
            assert.strictEqual(res1.updatedList.length, 1);
            assert.strictEqual(Boolean(findMatchingFavorite(res1.updatedList, penSlice, 'pen')), true);

            // Second toggle: removes preset
            const res2 = toggleFavoritePreset(res1.updatedList, penSlice);
            assert.strictEqual(res2.added, false);
            assert.strictEqual(res2.updatedList.length, 0);
            assert.strictEqual(Boolean(findMatchingFavorite(res2.updatedList, penSlice, 'pen')), false);
        });

        test('enforces MAX_FAVORITES_PER_TOOL limit and prevents duplicates', () => {
            let list: PenFavoritePreset[] = [];
            for (let i = 1; i <= MAX_FAVORITES_PER_TOOL + 10; i++) {
                const res = toggleFavoritePreset(list, {
                    profileId: 'ball',
                    color: `#${i.toString(16).padStart(6, '0')}`,
                    width: i,
                    opacity: 1,
                    pattern: 'solid',
                });
                list = res.updatedList as PenFavoritePreset[];
            }
            assert.strictEqual(list.length, MAX_FAVORITES_PER_TOOL);
        });
    });

    // =========================================================================
    // 2. Transversal Tool Isolation (pen, highlighter, shape)
    // =========================================================================
    describe('2. Transversal Tool Isolation (pen, highlighter, shape)', () => {
        test('favorites saved in pen do not leak into highlighter or shape', () => {
            const state: WorkspaceToolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);

            const penPreset = createFavoritePreset({
                tool: 'pen',
                profileId: 'calli',
                color: '#ff0000',
                width: 6,
                pattern: 'dashed',
            }) as PenFavoritePreset;
            state.favorites.pen.push(penPreset);

            const hlPreset = createFavoritePreset({
                tool: 'highlighter',
                profileId: 'hlf',
                color: '#fdd835',
                width: 24,
            }) as HighlighterFavoritePreset;
            state.favorites.highlighter.push(hlPreset);

            const shapePreset = createFavoritePreset({
                tool: 'shape',
                shapeType: 'rounded-rect',
                color: '#10b981',
                width: 4,
                fillEnabled: true,
            }) as ShapeFavoritePreset;
            state.favorites.shape.push(shapePreset);

            assert.strictEqual(state.favorites.pen.length, 1);
            assert.strictEqual(state.favorites.highlighter.length, 1);
            assert.strictEqual(state.favorites.shape.length, 1);

            assert.strictEqual(state.favorites.pen[0].id, penPreset.id);
            assert.strictEqual(state.favorites.highlighter[0].id, hlPreset.id);
            assert.strictEqual(state.favorites.shape[0].id, shapePreset.id);

            // Removing from pen does not affect highlighter or shape
            state.favorites.pen = removeFavoriteById(state.favorites.pen, penPreset.id);
            assert.strictEqual(state.favorites.pen.length, 0);
            assert.strictEqual(state.favorites.highlighter.length, 1);
            assert.strictEqual(state.favorites.shape.length, 1);
        });

        test('each tool renders its own presets in FavoritesDrawer', () => {
            const penPreset = createFavoritePreset({
                tool: 'pen',
                profileId: 'fountain',
                color: '#1F4FD8',
                width: 3,
            }) as PenFavoritePreset;

            const hlPreset = createFavoritePreset({
                tool: 'highlighter',
                profileId: 'hlr',
                color: '#FDD835',
                width: 20,
            }) as HighlighterFavoritePreset;

            const shapePreset = createFavoritePreset({
                tool: 'shape',
                shapeType: 'triangle',
                color: '#EF4444',
                width: 5,
            }) as ShapeFavoritePreset;

            const callbacks: FavoritesDrawerCallbacks = {
                onSelectFavorite: () => {},
                onDeleteFavorite: () => {},
                onReorderFavorite: () => {},
            };

            // 1. Pen drawer
            const penDrawer = new FavoritesDrawer(callbacks, 'pen', [penPreset]);
            const penCards = penDrawer.el.querySelectorAll('.apolo-favorite-card');
            assert.strictEqual(penCards.length, 1);
            assert.strictEqual(penCards[0].dataset.presetId, penPreset.id);

            // 2. Highlighter drawer
            const hlDrawer = new FavoritesDrawer(callbacks, 'highlighter', [hlPreset]);
            const hlCards = hlDrawer.el.querySelectorAll('.apolo-favorite-card');
            assert.strictEqual(hlCards.length, 1);
            assert.strictEqual(hlCards[0].dataset.presetId, hlPreset.id);

            // 3. Shape drawer
            const shapeDrawer = new FavoritesDrawer(callbacks, 'shape', [shapePreset]);
            const shapeCards = shapeDrawer.el.querySelectorAll('.apolo-favorite-card');
            assert.strictEqual(shapeCards.length, 1);
            assert.strictEqual(shapeCards[0].dataset.presetId, shapePreset.id);

            // 4. Switching drawer via update()
            penDrawer.update('highlighter', [hlPreset]);
            const switchedCards = penDrawer.el.querySelectorAll('.apolo-favorite-card');
            assert.strictEqual(switchedCards.length, 1);
            assert.strictEqual(switchedCards[0].dataset.presetId, hlPreset.id);
        });
    });

    // =========================================================================
    // 3. UI Interaction in ToolEstuche & FavoritesDrawer
    // =========================================================================
    describe('3. UI Interaction in ToolEstuche & FavoritesDrawer', () => {
        function createEstucheHelper(initialOverrides?: Partial<ToolEstucheState>, callbackOverrides?: Partial<ToolEstucheCallbacks>) {
            const root = (globalThis as any).document.createElement('div');
            const state: ToolEstucheState = {
                tool: 'pen',
                slot: 'tc',
                color: '#1F4FD8',
                width: 3,
                profileId: 'fountain',
                smoothing: 0.6,
                pressureSensitivity: 0.5,
                opacity: 1,
                lineStyle: 'solid',
                pattern: 'solid',
                straightenLines: false,
                favorites: [],
                eraserMode: 'whole',
                eraserRadius: 20,
                scribbleToErase: false,
                lassoMode: 'freeform',
                shapeType: 'rect',
                snapGrid: false,
                isCurrentFavorite: false,
                showingFavorites: false,
                ...initialOverrides,
            };

            const callbacks: ToolEstucheCallbacks = {
                onSelectProfile: () => {},
                onChangeColor: () => {},
                onChangeWidth: () => {},
                onChangeSmoothing: () => {},
                onChangePressure: () => {},
                onChangeLineStyle: () => {},
                onClose: () => {},
                ...callbackOverrides,
            };

            const estuche = new ToolEstuche(state, callbacks, root);
            return { estuche, root };
        }

        test('clicking bookmark button toggles between controls and FavoritesDrawer view with SVG previews', () => {
            const penFav = createFavoritePreset({
                tool: 'pen',
                profileId: 'fountain',
                color: '#1F4FD8',
                width: 3,
                pattern: 'solid',
            });

            const { estuche, root } = createEstucheHelper({
                favorites: [penFav],
                showingFavorites: false,
            });
            estuche.open();

            const favsBtn = root.querySelector('.popover-favs-btn');
            assert.ok(favsBtn, 'Bookmark toggle button must exist');

            // Initially showing controls, drawer is not in DOM
            assert.strictEqual(root.querySelector('.apolo-favorites-drawer'), null);

            // Click bookmark button -> opens drawer
            favsBtn.onclick();
            const drawer = root.querySelector('.apolo-favorites-drawer');
            assert.ok(drawer, 'FavoritesDrawer must be rendered when bookmark is toggled');

            const card = drawer.querySelector('.apolo-favorite-card');
            assert.ok(card, 'Card must be rendered');
            const preview = card.querySelector('.apolo-favorite-preview');
            assert.ok(preview, 'Visual preview container must exist');
            assert.ok(preview.querySelector('svg'), 'SVG preview must be present inside preview container');

            // Click back button -> toggles back to controls
            const backBtn = (root.querySelector('.popover-back-btn') ?? root.querySelector('.popover-favs-btn')) as HTMLElement;
            backBtn.onclick();
            assert.strictEqual(root.querySelector('.apolo-favorites-drawer'), null);
        });

        test('header persists .hd-bookmark-btn, starBtn, and closeBtn with non-empty SVG children in tool view and favorites view', () => {
            const penFav = createFavoritePreset({
                tool: 'pen',
                profileId: 'fountain',
                color: '#1F4FD8',
                width: 3,
            });

            const { estuche, root } = createEstucheHelper({
                favorites: [penFav],
                showingFavorites: false,
            });
            estuche.open();

            // 1. Tool view (showingFavorites === false)
            const bookmarkBtnTool = root.querySelector('button.hd-bookmark-btn') as HTMLButtonElement | null;
            assert.ok(bookmarkBtnTool, '.hd-bookmark-btn must exist in tool view');
            const bookmarkSvgTool = bookmarkBtnTool.querySelector('svg');
            assert.ok(bookmarkSvgTool, 'Bookmark button must have an <svg> child in tool view');
            assert.ok(bookmarkSvgTool.children.length > 0, 'Bookmark <svg> must have child elements in tool view');

            const starBtnTool = root.querySelector('button.popover-star-btn') as HTMLButtonElement | null;
            assert.ok(starBtnTool, '.popover-star-btn must exist in tool view');
            const starSvgTool = starBtnTool.querySelector('svg');
            assert.ok(starSvgTool, 'Star button must have an <svg> child in tool view');
            assert.ok(starSvgTool.children.length > 0, 'Star <svg> must have child elements in tool view');

            const closeBtnTool = root.querySelector('button.popover-close-btn, button.popover-close') as HTMLButtonElement | null;
            assert.ok(closeBtnTool, '.popover-close-btn must exist in tool view');
            const closeSvgTool = closeBtnTool.querySelector('svg');
            assert.ok(closeSvgTool, 'Close button must have an <svg> child in tool view');
            assert.ok(closeSvgTool.children.length > 0, 'Close <svg> must have child elements in tool view');

            // 2. Switch to Favorites view (showingFavorites === true)
            bookmarkBtnTool.onclick?.({} as any);
            assert.strictEqual(estuche.isShowingFavorites(), true, 'Must transition to favorites view');

            const bookmarkBtnFav = root.querySelector('button.hd-bookmark-btn') as HTMLButtonElement | null;
            assert.ok(bookmarkBtnFav, '.hd-bookmark-btn must persist in favorites view');
            assert.ok(bookmarkBtnFav.classList.contains('is-active'), '.hd-bookmark-btn must have .is-active in favorites view');
            const bookmarkSvgFav = bookmarkBtnFav.querySelector('svg');
            assert.ok(bookmarkSvgFav, 'Bookmark button must have an <svg> child in favorites view');
            assert.ok(bookmarkSvgFav.children.length > 0, 'Bookmark <svg> must have child elements in favorites view');

            const starBtnFav = root.querySelector('button.popover-star-btn') as HTMLButtonElement | null;
            assert.ok(starBtnFav, '.popover-star-btn must persist in favorites view');
            const starSvgFav = starBtnFav.querySelector('svg');
            assert.ok(starSvgFav, 'Star button must have an <svg> child in favorites view');
            assert.ok(starSvgFav.children.length > 0, 'Star <svg> must have child elements in favorites view');

            const closeBtnFav = root.querySelector('button.popover-close-btn, button.popover-close') as HTMLButtonElement | null;
            assert.ok(closeBtnFav, '.popover-close-btn must persist in favorites view');
            const closeSvgFav = closeBtnFav.querySelector('svg');
            assert.ok(closeSvgFav, 'Close button must have an <svg> child in favorites view');
            assert.ok(closeSvgFav.children.length > 0, 'Close <svg> must have child elements in favorites view');

            // 3. Header layout retains 3 columns
            const hd = root.querySelector('.hd') as HTMLElement | null;
            assert.ok(hd, '.hd header must exist');
            assert.ok(hd.querySelector('.hd-left'), '.hd-left column must exist');
            assert.ok(hd.querySelector('.hd-center'), '.hd-center column must exist');
            assert.ok(hd.querySelector('.hd-right'), '.hd-right column must exist');
        });

        test('clicking card invokes onApplyFavorite and restores exact preset parameters', () => {
            const penFav: PenFavoritePreset = {
                id: 'fav-calli-test',
                tool: 'pen',
                profileId: 'calli',
                color: '#e11d48',
                width: 6,
                opacity: 0.9,
                pattern: 'dashed',
                straightenLines: true,
                createdAt: 1000,
            };

            let applied: ToolFavoritePreset | null = null;
            const { estuche, root } = createEstucheHelper(
                {
                    favorites: [penFav],
                    showingFavorites: true,
                },
                {
                    onApplyFavorite: (preset) => { applied = preset; },
                },
            );
            estuche.open();

            const card = root.querySelector('.apolo-favorite-card');
            assert.ok(card);
            card.onclick();

            assert.ok(applied);
            assert.strictEqual((applied as PenFavoritePreset).profileId, 'calli');
            assert.strictEqual((applied as PenFavoritePreset).color, '#e11d48');
            assert.strictEqual((applied as PenFavoritePreset).width, 6);
            assert.strictEqual((applied as PenFavoritePreset).opacity, 0.9);
            assert.strictEqual((applied as PenFavoritePreset).pattern, 'dashed');
            assert.strictEqual((applied as PenFavoritePreset).straightenLines, true);
        });

        test('clicking delete button on card removes preset without applying it', () => {
            const fav1 = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#111', width: 2 });
            const fav2 = createFavoritePreset({ tool: 'pen', profileId: 'ball', color: '#222', width: 4 });

            let appliedCount = 0;
            let deletedId: string | null = null;

            const { estuche, root } = createEstucheHelper(
                {
                    favorites: [fav1, fav2],
                    showingFavorites: true,
                },
                {
                    onApplyFavorite: () => { appliedCount++; },
                    onDeleteFavorite: (id) => { deletedId = id; },
                },
            );
            estuche.open();

            const cards = root.querySelectorAll('.apolo-favorite-card');
            assert.strictEqual(cards.length, 2);

            const deleteBtn = cards[0].querySelector('.apolo-favorite-delete-btn');
            assert.ok(deleteBtn);

            let propagationStopped = false;
            deleteBtn.onclick({
                stopPropagation: () => { propagationStopped = true; },
            });

            assert.strictEqual(deletedId, fav1.id);
            assert.strictEqual(propagationStopped, true);
            assert.strictEqual(appliedCount, 0, 'Deleting a preset must NOT trigger onApplyFavorite');
        });

        test('reordering favorites swaps positions and triggers onReorderFavorite', () => {
            const fav1 = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#111', width: 2 });
            const fav2 = createFavoritePreset({ tool: 'pen', profileId: 'ball', color: '#222', width: 4 });

            let reordered: [number, number] | null = null;
            const { estuche, root } = createEstucheHelper(
                {
                    favorites: [fav1, fav2],
                    showingFavorites: true,
                },
                {
                    onReorderFavorites: (from, to) => { reordered = [from, to]; },
                },
            );
            estuche.open();

            const cards = root.querySelectorAll('.apolo-favorite-card');
            const handle = cards[0].querySelector('.apolo-favorite-drag-handle');
            assert.ok(handle, 'Card must have drag handle');

            cards[1].ondrop?.({
                preventDefault: () => {},
                dataTransfer: { getData: () => '0' },
            } as any);
            assert.deepStrictEqual(reordered, [0, 1]);

            // Reorder store helper test
            const reorderedList = reorderFavorites([fav1, fav2], 0, 1);
            assert.strictEqual(reorderedList[0].id, fav2.id);
            assert.strictEqual(reorderedList[1].id, fav1.id);
        });

        test('drawer cards do not render rename menu, dragging handle reorders or deletes', () => {
            const fav1 = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#111', width: 2 });
            let deletedId: string | null = null;
            const { estuche, root } = createEstucheHelper(
                {
                    favorites: [fav1],
                    showingFavorites: true,
                },
                {
                    onDeleteFavorite: (id) => { deletedId = id; },
                },
            );
            estuche.open();

            const card = root.querySelector('.apolo-favorite-card') as HTMLElement;
            const handle = card.querySelector('.apolo-favorite-drag-handle') as HTMLElement;
            assert.ok(handle, 'Card must have drag handle');
            assert.strictEqual(card.querySelector('.apolo-card-menu'), null, 'Rename menu must be removed from drawer card');

            // Handle is rendered clean without extra menu
            assert.ok(card.querySelector('.apolo-favorite-delete-btn'));
        });
    });

    // =========================================================================
    // 4. Persistence Across Reloads
    // =========================================================================
    describe('4. Persistence Across Reloads', () => {
        test('saved favorites survive WorkspaceToolState serialization and hydration', () => {
            const state: WorkspaceToolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);

            state.favorites.pen.push(createFavoritePreset({
                tool: 'pen',
                profileId: 'calli',
                color: '#2563eb',
                width: 5,
                pattern: 'dashed',
                straightenLines: true,
            }) as PenFavoritePreset);

            state.favorites.highlighter.push(createFavoritePreset({
                tool: 'highlighter',
                profileId: 'hlr',
                color: '#facc15',
                width: 22,
            }) as HighlighterFavoritePreset);

            state.favorites.shape.push(createFavoritePreset({
                tool: 'shape',
                shapeType: 'ellipse',
                color: '#10b981',
                width: 3,
                fillEnabled: true,
                fillColor: '#6ee7b7',
                fillOpacity: 0.4,
            }) as ShapeFavoritePreset);

            // Simulate saving to Obsidian data store (JSON stringify)
            const serialized = JSON.stringify(state);
            assert.ok(serialized.length > 0);

            // Simulate reload from disk (JSON parse)
            const parsed = JSON.parse(serialized);

            // Hydrate through mergeWorkspaceToolState
            const hydrated = mergeWorkspaceToolState(parsed);

            assert.strictEqual(hydrated.favorites.pen.length, 1);
            assert.strictEqual(hydrated.favorites.highlighter.length, 1);
            assert.strictEqual(hydrated.favorites.shape.length, 1);

            assert.strictEqual(hydrated.favorites.pen[0].id, state.favorites.pen[0].id);
            assert.strictEqual(hydrated.favorites.pen[0].color, state.favorites.pen[0].color);
            assert.strictEqual(hydrated.favorites.pen[0].width, state.favorites.pen[0].width);
            assert.strictEqual(hydrated.favorites.pen[0].profileId, state.favorites.pen[0].profileId);
            assert.strictEqual(hydrated.favorites.pen[0].pattern, state.favorites.pen[0].pattern);
            assert.strictEqual(hydrated.favorites.pen[0].straightenLines, state.favorites.pen[0].straightenLines);

            assert.strictEqual(hydrated.favorites.highlighter[0].id, state.favorites.highlighter[0].id);
            assert.strictEqual(hydrated.favorites.highlighter[0].width, state.favorites.highlighter[0].width);
            assert.strictEqual(hydrated.favorites.highlighter[0].profileId, state.favorites.highlighter[0].profileId);

            assert.strictEqual(hydrated.favorites.shape[0].id, state.favorites.shape[0].id);
            assert.strictEqual(hydrated.favorites.shape[0].shapeType, state.favorites.shape[0].shapeType);
            assert.strictEqual(hydrated.favorites.shape[0].fillEnabled, state.favorites.shape[0].fillEnabled);
        });

        test('mergeWorkspaceToolState safely initializes favorites when missing in legacy data', () => {
            const legacyData = {
                activeTool: 'pen',
                pen: { color: '#000000', width: 2 },
            };

            const hydrated = mergeWorkspaceToolState(legacyData as any);
            assert.ok(hydrated.favorites, 'favorites object must be initialized');
            assert.deepStrictEqual(hydrated.favorites.pen, []);
            assert.deepStrictEqual(hydrated.favorites.highlighter, []);
            assert.deepStrictEqual(hydrated.favorites.shape, []);
        });

        test('mergeWorkspaceToolState handles null, undefined, or empty saved state gracefully', () => {
            const hydratedNull = mergeWorkspaceToolState(null);
            assert.deepStrictEqual(hydratedNull.favorites, { pen: [], highlighter: [], shape: [] });

            const hydratedUndefined = mergeWorkspaceToolState(undefined);
            assert.deepStrictEqual(hydratedUndefined.favorites, { pen: [], highlighter: [], shape: [] });
        });
    });

    // =========================================================================
    // 5. SVG Wave & Shape Previews & Card Structure
    // =========================================================================
    describe('5. SVG Wave & Shape Previews & Card Structure', () => {
        test('createStrokeWavePreview creates responsive SVG with correct dasharray and cap', () => {
            const solidWave = createStrokeWavePreview('#1F4FD8', 3, 'fountain', 1, 'solid');
            assert.ok(solidWave);
            assert.strictEqual(solidWave.getAttribute('width'), '150');
            assert.strictEqual(solidWave.getAttribute('height'), '40');
            const solidPath = solidWave.querySelector('path');
            assert.ok(solidPath);
            assert.strictEqual(solidPath.getAttribute('stroke-linecap'), 'round');

            const dashedWave = createStrokeWavePreview('#1F4FD8', 4, 'ball', 1, 'dashed');
            const dashedPath = dashedWave.querySelector('path');
            assert.ok(dashedPath);
            assert.strictEqual(dashedPath.getAttribute('stroke-linecap'), 'butt');
            assert.ok(dashedPath.getAttribute('stroke-dasharray')?.length > 0);

            const dottedWave = createStrokeWavePreview('#10b981', 4, 'pencil', 1, 'dotted');
            const dottedPath = dottedWave.querySelector('path');
            assert.ok(dottedPath);
            assert.strictEqual(dottedPath.getAttribute('stroke-linecap'), 'round');
            assert.ok(dottedPath.getAttribute('stroke-dasharray')?.startsWith('0.1 '));
        });

        test('createShapePreview renders all shape types accurately', () => {
            const shapeTypes = ['rect', 'rounded-rect', 'ellipse', 'triangle', 'line', 'arrow'] as const;

            for (const shapeType of shapeTypes) {
                const preset: ShapeFavoritePreset = {
                    id: `s-${shapeType}`,
                    tool: 'shape',
                    shapeType,
                    color: '#3B82F6',
                    width: 3,
                    opacity: 1,
                    pattern: 'dashed',
                    fillEnabled: true,
                    fillColor: '#93C5FD',
                    fillOpacity: 0.5,
                    createdAt: Date.now(),
                };

                const svg = createShapePreview(preset, 140, 36);
                assert.ok(svg);
                assert.strictEqual(svg.getAttribute('width'), '140');
                assert.strictEqual(svg.getAttribute('height'), '36');

                if (shapeType === 'rect' || shapeType === 'rounded-rect') {
                    assert.ok(svg.querySelector('rect'));
                } else if (shapeType === 'ellipse') {
                    assert.ok(svg.querySelector('ellipse'));
                } else if (shapeType === 'triangle') {
                    assert.ok(svg.querySelector('polygon'));
                } else if (shapeType === 'line' || shapeType === 'arrow') {
                    assert.ok(svg.querySelector('line'));
                }
            }
        });

        test('FavoritesDrawer empty state renders star icon and helper text', () => {
            const callbacks: FavoritesDrawerCallbacks = {
                onSelectFavorite: () => {},
                onDeleteFavorite: () => {},
                onReorderFavorite: () => {},
            };

            const drawer = new FavoritesDrawer(callbacks, 'pen', []);
            const empty = drawer.el.querySelector('.apolo-favorites-empty');
            assert.ok(empty, 'Empty state container should exist');

            const text = drawer.el.querySelector('.apolo-favorites-empty-text');
            assert.ok(text);
            assert.ok(text.textContent.includes('Toca'));
            assert.ok(text.textContent.includes('para guardar el trazo actual'));
        });

        test('FavoritesDrawer cards render glyph, preview, size dot, and tooltip', () => {
            const p1 = createFavoritePreset({
                tool: 'pen',
                profileId: 'fountain',
                color: '#1F4FD8',
                width: 3,
                pattern: 'solid',
            }) as PenFavoritePreset;

            const callbacks: FavoritesDrawerCallbacks = {
                onSelectFavorite: () => {},
                onDeleteFavorite: () => {},
                onReorderFavorite: () => {},
            };

            const drawer = new FavoritesDrawer(callbacks, 'pen', [p1]);
            const card = drawer.el.querySelector('.apolo-favorite-card');
            assert.ok(card);

            // Glyph
            const glyph = card.querySelector('.apolo-favorite-glyph');
            assert.ok(glyph);
            assert.ok(glyph.querySelector('svg'));

            // Preview
            const preview = card.querySelector('.apolo-favorite-preview');
            assert.ok(preview);
            assert.ok(preview.querySelector('svg'));

            // Size dot removed per design requirement
            const size = card.querySelector('.apolo-favorite-size');
            assert.strictEqual(size, null, 'Thickness dot must be removed');
            const handle = card.querySelector('.apolo-favorite-drag-handle');
            assert.ok(handle, 'Drag handle must exist');

            // Tooltip and aria-label
            const expectedTooltip = getPresetTooltip(p1);
            assert.strictEqual(card.getAttribute('aria-label'), expectedTooltip);
            assert.strictEqual(card.title, expectedTooltip);
        });
    });
});
