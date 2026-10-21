import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { ToolEstuche, type ToolEstucheState, type ToolEstucheCallbacks } from '../src/ui/ToolEstuche.ts';
import {
    createFavoritePreset,
    toggleFavoritePreset,
    removeFavoriteById,
    reorderFavorites,
    findMatchingFavorite,
    type ToolFavoritePreset,
    type PenFavoritePreset,
    type HighlighterFavoritePreset,
    type ShapeFavoritePreset,
} from '../src/ui/favorites/FavoritesStore.ts';
import {
    DEFAULT_WORKSPACE_TOOL_STATE,
    cloneWorkspaceToolState,
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
            textContent: '',
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
            querySelector: (sel: string): any => {
                const findIn = (node: any): any => {
                    if (!node) return null;
                    if (sel.startsWith('.') && node.classList?.contains(sel.slice(1))) return node;
                    if (sel.startsWith('#') && node.id === sel.slice(1)) return node;
                    if (sel.toLowerCase() === node.tagName?.toLowerCase()) return node;
                    for (const child of node.children || []) {
                        const res = findIn(child);
                        if (res) return res;
                    }
                    return null;
                };
                return findIn(el);
            },
            querySelectorAll: (sel: string): any[] => {
                const results: any[] = [];
                const collect = (node: any) => {
                    if (!node) return;
                    if (sel.startsWith('.') && node.classList?.contains(sel.slice(1))) results.push(node);
                    else if (sel.toLowerCase() === node.tagName?.toLowerCase()) results.push(node);
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
        removeEventListener: () => {},
        addEventListener: () => {},
    };

    return mockDocument;
}

describe('ToolEstuche Favorites Integration (Task 3 of 4)', () => {
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

    function createTestEstuche(initialOverrides?: Partial<ToolEstucheState>, callbackOverrides?: Partial<ToolEstucheCallbacks>) {
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
            onUseFavorite: () => {},
            onSaveFavorite: () => {},
            onSelectEraserMode: () => {},
            onChangeEraserRadius: () => {},
            onToggleScribble: () => {},
            onSelectLassoMode: () => {},
            onSelectShapeType: () => {},
            onToggleSnapGrid: () => {},
            onToggleStraighten: () => {},
            onClose: () => {},
            ...callbackOverrides,
        };

        const estuche = new ToolEstuche(state, callbacks, root);
        return { estuche, root };
    }

    test('1. Star button visually reflects isCurrentFavorite state (inactive when false, active when true)', () => {
        const { estuche, root } = createTestEstuche({ isCurrentFavorite: false });
        estuche.open();

        const starBtn = root.querySelector('.popover-star-btn');
        assert.ok(starBtn, 'Star button should be present in header');
        assert.strictEqual(starBtn.classList.contains('is-active'), false, 'Should not be active when isCurrentFavorite is false');
        assert.strictEqual(starBtn.classList.contains('is-fav-saved'), false);
        assert.strictEqual(starBtn.getAttribute('aria-pressed'), 'false');

        // Update state in-place to true
        estuche.updateState({ isCurrentFavorite: true });
        assert.strictEqual(starBtn.classList.contains('is-active'), true, 'Should be active when isCurrentFavorite becomes true');
        assert.strictEqual(starBtn.classList.contains('is-fav-saved'), true);
        assert.strictEqual(starBtn.getAttribute('aria-pressed'), 'true');

        // Update back to false
        estuche.updateState({ isCurrentFavorite: false });
        assert.strictEqual(starBtn.classList.contains('is-active'), false);
        assert.strictEqual(starBtn.getAttribute('aria-pressed'), 'false');
    });

    test('2. Clicking star button triggers onToggleFavorite callback', () => {
        let toggleCalls = 0;
        const { estuche, root } = createTestEstuche(
            { isCurrentFavorite: false },
            {
                onToggleFavorite: () => {
                    toggleCalls++;
                },
            },
        );
        estuche.open();

        const starBtn = root.querySelector('.popover-star-btn');
        assert.ok(starBtn);
        starBtn.onclick();
        assert.strictEqual(toggleCalls, 1, 'Clicking star button should trigger onToggleFavorite');
    });

    test('3. Star button falls back to legacy onSaveFavorite when onToggleFavorite is omitted', () => {
        let legacySaveIndex = -1;
        const { estuche, root } = createTestEstuche(
            { isCurrentFavorite: false },
            {
                onSaveFavorite: (index) => {
                    legacySaveIndex = index;
                },
            },
        );
        estuche.open();

        const starBtn = root.querySelector('.popover-star-btn');
        starBtn.onclick();
        assert.strictEqual(legacySaveIndex, 0, 'Should fall back to onSaveFavorite(0)');
    });

    test('4. Bookmark button shows numeric badge when favorites count > 0', () => {
        const fav1 = createFavoritePreset({ tool: 'pen', color: '#1F4FD8', width: 3 });
        const fav2 = createFavoritePreset({ tool: 'pen', color: '#E53935', width: 2 });
        const { estuche, root } = createTestEstuche({ favorites: [fav1, fav2] });
        estuche.open();

        const favsBtn = root.querySelector('.popover-favs-btn');
        assert.ok(favsBtn, 'Bookmark button should exist');
        const badge = favsBtn.querySelector('.popover-favs-badge');
        assert.ok(badge, 'Badge element should be present');
        assert.strictEqual(badge.textContent, '2', 'Badge text should reflect favorites length');

        // Update favorites list to empty in place
        estuche.updateState({ favorites: [] });
        const badgeAfter = favsBtn.querySelector('.popover-favs-badge');
        assert.strictEqual(badgeAfter, null, 'Badge should be removed when count reaches 0');
    });

    test('5. Clicking bookmark button toggles between tool controls and FavoritesDrawer view', () => {
        const fav1 = createFavoritePreset({ tool: 'pen', color: '#1F4FD8', width: 3 });
        const { estuche, root } = createTestEstuche({ favorites: [fav1], showingFavorites: false });
        estuche.open();

        const favsBtn = root.querySelector('.popover-favs-btn');
        const titleEl = root.querySelector('.popover-title');
        assert.strictEqual(titleEl.textContent, 'Estuche de plumas');
        assert.strictEqual(root.querySelector('.apolo-favorites-drawer'), null, 'Drawer should not be rendered initially');

        // Click bookmark button -> Open drawer
        favsBtn.onclick();
        assert.strictEqual(estuche.isShowingFavorites(), true);
        const titleInDrawer = root.querySelector('.popover-title');
        assert.strictEqual(titleInDrawer.textContent, 'Notas');
        assert.ok(root.querySelector('.apolo-favorites-drawer'), 'FavoritesDrawer should be rendered');

        // Click bookmark button again -> Close drawer, back to Pluma controls
        const favsBtn2 = root.querySelector('.popover-favs-btn');
        favsBtn2.onclick();
        assert.strictEqual(estuche.isShowingFavorites(), false);
        const titleAfter = root.querySelector('.popover-title');
        assert.strictEqual(titleAfter.textContent, 'Estuche de plumas');
        assert.strictEqual(root.querySelector('.apolo-favorites-drawer'), null);
    });

    test('6. Switching tools resets showingFavorites to false', () => {
        const fav = createFavoritePreset({ tool: 'pen', color: '#1F4FD8', width: 3 });
        const { estuche, root } = createTestEstuche({ favorites: [fav] });
        estuche.open();

        // Open favorites drawer
        estuche.setShowingFavorites(true);
        assert.strictEqual(estuche.isShowingFavorites(), true);

        // Switch tool to highlighter
        estuche.open({ tool: 'highlighter' });
        assert.strictEqual(estuche.isShowingFavorites(), false, 'Changing tool should reset showingFavorites to false');
        const title = root.querySelector('.popover-title');
        assert.strictEqual(title.textContent, 'Estuche de marcadores');
    });

    test('7. End-to-end preset toggle, apply, and remove with WorkspaceToolState', () => {
        const toolState: WorkspaceToolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
        assert.strictEqual(toolState.favorites.pen.length, 0);

        // 1. Current slice is not yet favorited
        let isFav = Boolean(findMatchingFavorite(toolState.favorites.pen, toolState.pen));
        assert.strictEqual(isFav, false);

        // 2. Toggle favorite -> Added
        const addResult = toggleFavoritePreset(toolState.favorites.pen, { tool: 'pen', ...toolState.pen });
        assert.strictEqual(addResult.added, true);
        toolState.favorites.pen = addResult.updatedList;
        assert.strictEqual(toolState.favorites.pen.length, 1);

        // 3. Current slice now matches saved preset
        isFav = Boolean(findMatchingFavorite(toolState.favorites.pen, toolState.pen));
        assert.strictEqual(isFav, true);

        // 4. User tweaks width away from 3 -> Star un-highlights
        const modifiedPen = { ...toolState.pen, width: 6.5 };
        const isFavModified = Boolean(findMatchingFavorite(toolState.favorites.pen, modifiedPen));
        assert.strictEqual(isFavModified, false, 'Tweaking width should un-highlight star');

        // 5. User changes back to 3 -> Star re-highlights
        const restoredPen = { ...toolState.pen, width: 3 };
        const isFavRestored = Boolean(findMatchingFavorite(toolState.favorites.pen, restoredPen));
        assert.strictEqual(isFavRestored, true, 'Restoring width should re-highlight star');

        // 6. Delete favorite preset
        const presetId = toolState.favorites.pen[0].id;
        toolState.favorites.pen = removeFavoriteById(toolState.favorites.pen, presetId);
        assert.strictEqual(toolState.favorites.pen.length, 0);
        assert.strictEqual(Boolean(findMatchingFavorite(toolState.favorites.pen, toolState.pen)), false);
    });

    test('8. FavoritesDrawer callbacks trigger onApplyFavorite, onDeleteFavorite, and onReorderFavorites', () => {
        const fav1 = createFavoritePreset({ tool: 'pen', color: '#1F4FD8', width: 3 });
        const fav2 = createFavoritePreset({ tool: 'pen', color: '#E53935', width: 5 });

        let appliedPreset: ToolFavoritePreset | null = null;
        let deletedId: string | null = null;
        let reorderParams: [number, number] | null = null;

        const { estuche, root } = createTestEstuche(
            {
                favorites: [fav1, fav2],
                showingFavorites: true,
            },
            {
                onApplyFavorite: (preset) => { appliedPreset = preset; },
                onDeleteFavorite: (id) => { deletedId = id; },
                onReorderFavorites: (from, to) => { reorderParams = [from, to]; },
            },
        );
        estuche.open();

        const cards = root.querySelectorAll('.apolo-favorite-card');
        assert.strictEqual(cards.length, 2, 'Should render 2 favorite cards');

        // 1. Click card to apply
        cards[1].onclick();
        assert.ok(appliedPreset);
        assert.strictEqual((appliedPreset as any).id, fav2.id);

        // 2. Click delete button on card
        const delBtn = cards[0].querySelector('.apolo-favorite-delete-btn');
        assert.ok(delBtn);
        delBtn.onclick({ stopPropagation: () => {} });
        assert.strictEqual(deletedId, fav1.id);

        // 3. Click down button on first card
        const downBtn = cards[0].querySelector('.apolo-favorite-reorder-down');
        assert.ok(downBtn);
        downBtn.onclick({ stopPropagation: () => {} });
        assert.deepStrictEqual(reorderParams, [0, 1]);
    });
});
