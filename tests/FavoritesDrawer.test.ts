import test, { describe } from 'node:test';
import assert from 'node:assert';
import {
    FavoritesDrawer,
    createShapePreview,
    getPresetLabel,
    type FavoritesDrawerCallbacks,
} from '../src/ui/favorites/FavoritesDrawer.ts';
import {
    createFavoritePreset,
} from '../src/ui/favorites/FavoritesStore.ts';
import {
    createStrokeWavePreview,
    PEN_PROFILES,
} from '../src/ui/theme.ts';
import type {
    PenFavoritePreset,
    HighlighterFavoritePreset,
    ShapeFavoritePreset,
    ToolFavoritePreset,
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
            onclick: null as any,
            onkeydown: null as any,
        };
        return el;
    };

    const mockDocument: any = {
        body: createElement('body'),
        createElement,
        createElementNS: (_ns: string, tag: string) => createElement(tag),
    };

    return mockDocument;
}

describe('FavoritesDrawer UI Component & SVG Previews', () => {
    let prevDoc: any;

    test('beforeAll', () => {
        prevDoc = (globalThis as any).document;
        (globalThis as any).document = createMockEnvironment();
    });

    test('1. createStrokeWavePreview supports modern preset signature and legacy signature', () => {
        // Modern call: (color, width, profileId, opacity, pattern)
        const modernWave = createStrokeWavePreview('#1F4FD8', 3, 'fountain', 1, 'dashed');
        assert.ok(modernWave);
        assert.strictEqual(modernWave.getAttribute('width'), '150');
        assert.strictEqual(modernWave.getAttribute('height'), '40');
        const modernPath = modernWave.querySelector('path');
        assert.ok(modernPath);
        assert.ok(modernPath.getAttribute('stroke-dasharray')?.length > 0);
        assert.strictEqual(modernPath.getAttribute('stroke-linecap'), 'butt');

        // Dotted wave
        const dottedWave = createStrokeWavePreview('#FDD835', 20, 'hlr', 0.75, 'dotted');
        const dottedPath = dottedWave.querySelector('path');
        assert.ok(dottedPath);
        assert.ok(dottedPath.getAttribute('stroke-dasharray')?.startsWith('0.1 '));
        assert.strictEqual(dottedPath.getAttribute('stroke-linecap'), 'round');

        // Legacy call: (profile, baseWidth, color)
        const legacyWave = createStrokeWavePreview(PEN_PROFILES.pencil, 2, '#111827');
        const legacyPath = legacyWave.querySelector('path');
        assert.ok(legacyPath);
        assert.strictEqual(legacyPath.getAttribute('stroke-opacity'), String(PEN_PROFILES.pencil.op));
    });

    test('2. createShapePreview renders valid inline SVG for all shape types', () => {
        const shapes = ['rect', 'rounded-rect', 'ellipse', 'triangle', 'line', 'arrow'] as const;

        for (const shapeType of shapes) {
            const preset: ShapeFavoritePreset = {
                id: `shape-${shapeType}`,
                tool: 'shape',
                shapeType,
                color: '#2F6BFF',
                width: 4,
                opacity: 1,
                pattern: 'dashed',
                fillEnabled: true,
                fillColor: '#FFA726',
                fillOpacity: 0.5,
                createdAt: 1000,
            };

            const svg = createShapePreview(preset, 140, 36);
            assert.ok(svg);
            assert.strictEqual(svg.getAttribute('width'), '140');
            assert.strictEqual(svg.getAttribute('height'), '36');

            if (shapeType === 'rect' || shapeType === 'rounded-rect') {
                const rect = svg.querySelector('rect');
                assert.ok(rect, `Expected rect element for ${shapeType}`);
                assert.strictEqual(rect.getAttribute('fill-opacity'), '0.5');
            } else if (shapeType === 'ellipse') {
                const ellipse = svg.querySelector('ellipse');
                assert.ok(ellipse, 'Expected ellipse element');
            } else if (shapeType === 'triangle') {
                const poly = svg.querySelector('polygon');
                assert.ok(poly, 'Expected polygon element for triangle');
            } else if (shapeType === 'line' || shapeType === 'arrow') {
                const line = svg.querySelector('line');
                assert.ok(line, `Expected line element for ${shapeType}`);
            }
        }
    });

    test('3. FavoritesDrawer empty state renders when favorites is empty', () => {
        const callbacks: FavoritesDrawerCallbacks = {
            onSelectFavorite: () => {},
            onDeleteFavorite: () => {},
            onReorderFavorite: () => {},
        };

        const drawer = new FavoritesDrawer(callbacks, 'pen', []);
        assert.ok(drawer.el.classList.contains('apolo-favorites-drawer'));

        const empty = drawer.el.querySelector('.apolo-favorites-empty');
        assert.ok(empty, 'Empty container must be rendered');

        const text = drawer.el.querySelector('.apolo-favorites-empty-text');
        assert.ok(text);
        assert.strictEqual(
            text.textContent,
            'No hay favoritos guardados. Toca ☆ arriba para guardar la configuración actual.',
        );
    });

    test('4. FavoritesDrawer renders cards with preview, active indicator, and metadata', () => {
        const p1 = createFavoritePreset({
            tool: 'pen',
            profileId: 'fountain',
            color: '#1F4FD8',
            width: 3,
            opacity: 1,
            pattern: 'solid',
        }) as PenFavoritePreset;

        const p2 = createFavoritePreset({
            tool: 'pen',
            profileId: 'pencil',
            color: '#10B981',
            width: 5,
            opacity: 0.8,
            pattern: 'dashed',
        }) as PenFavoritePreset;

        const activeSlice = {
            profileId: 'fountain',
            color: '#1f4fd8',
            width: 3,
            opacity: 1,
            pattern: 'solid',
            straightenLines: false,
        };

        const callbacks: FavoritesDrawerCallbacks = {
            onSelectFavorite: () => {},
            onDeleteFavorite: () => {},
            onReorderFavorite: () => {},
        };

        const drawer = new FavoritesDrawer(callbacks, 'pen', [p1, p2], activeSlice);

        const cards = drawer.el.querySelectorAll('.apolo-favorite-card');
        assert.strictEqual(cards.length, 2);

        // First card should be active because p1 matches activeSlice
        assert.ok(cards[0].classList.contains('is-active'), 'First card should be marked .is-active');
        assert.ok(!cards[1].classList.contains('is-active'), 'Second card should not be active');

        // Check preview area exists
        const preview0 = cards[0].querySelector('.apolo-favorite-preview');
        assert.ok(preview0);
        assert.ok(preview0.querySelector('svg'), 'Preview must contain rendered SVG wave');

        // Check metadata label
        const meta1 = cards[1].querySelector('.apolo-favorite-meta');
        assert.ok(meta1);
        const label1 = cards[1].querySelector('.apolo-favorite-label');
        assert.strictEqual(label1.textContent, 'Lápiz');
        const thickness1 = cards[1].querySelector('.apolo-favorite-thickness');
        assert.strictEqual(thickness1.textContent, '5px');
        const patternBadge = cards[1].querySelector('.apolo-favorite-pattern-badge');
        assert.strictEqual(patternBadge.textContent, 'Rayas');
    });

    test('5. FavoritesDrawer handles user interactions (select, delete, reorder)', () => {
        const p1 = createFavoritePreset({ tool: 'shape', shapeType: 'rect', color: '#111', width: 2 }) as ShapeFavoritePreset;
        const p2 = createFavoritePreset({ tool: 'shape', shapeType: 'ellipse', color: '#222', width: 4 }) as ShapeFavoritePreset;

        let selectedPreset: ToolFavoritePreset | null = null;
        let deletedId: string | null = null;
        let reorderArgs: [number, number] | null = null;

        const callbacks: FavoritesDrawerCallbacks = {
            onSelectFavorite: (p) => { selectedPreset = p; },
            onDeleteFavorite: (id) => { deletedId = id; },
            onReorderFavorite: (from, to) => { reorderArgs = [from, to]; },
        };

        const drawer = new FavoritesDrawer(callbacks, 'shape', [p1, p2]);
        const cards = drawer.el.querySelectorAll('.apolo-favorite-card');
        assert.strictEqual(cards.length, 2);

        // Click on card 0
        cards[0].onclick();
        assert.strictEqual(selectedPreset?.id, p1.id);

        // Delete button on card 1
        const deleteBtn1 = cards[1].querySelector('.apolo-favorite-delete-btn');
        assert.ok(deleteBtn1);
        let propagationStopped = false;
        deleteBtn1.onclick({
            stopPropagation: () => { propagationStopped = true; },
        });
        assert.strictEqual(deletedId, p2.id);
        assert.strictEqual(propagationStopped, true);

        // Reorder: down button on card 0
        const downBtn0 = cards[0].querySelector('.apolo-favorite-reorder-down');
        assert.ok(downBtn0);
        propagationStopped = false;
        downBtn0.onclick({
            stopPropagation: () => { propagationStopped = true; },
        });
        assert.deepStrictEqual(reorderArgs, [0, 1]);
        assert.strictEqual(propagationStopped, true);

        // Reorder: up button on card 1
        const upBtn1 = cards[1].querySelector('.apolo-favorite-reorder-up');
        assert.ok(upBtn1);
        propagationStopped = false;
        upBtn1.onclick({
            stopPropagation: () => { propagationStopped = true; },
        });
        assert.deepStrictEqual(reorderArgs, [1, 0]);
        assert.strictEqual(propagationStopped, true);
    });

    test('6. FavoritesDrawer updates dynamically via update() and updateState()', () => {
        const callbacks: FavoritesDrawerCallbacks = {
            onSelectFavorite: () => {},
            onDeleteFavorite: () => {},
            onReorderFavorite: () => {},
        };

        const drawer = new FavoritesDrawer(callbacks, 'pen', []);
        assert.ok(drawer.el.querySelector('.apolo-favorites-empty'));

        const p1 = createFavoritePreset({ tool: 'highlighter', profileId: 'hlr', color: '#FDD835', width: 20 }) as HighlighterFavoritePreset;
        drawer.update('highlighter', [p1], { profileId: 'hlr', color: '#FDD835', width: 20 });

        assert.ok(!drawer.el.querySelector('.apolo-favorites-empty'));
        const cards = drawer.el.querySelectorAll('.apolo-favorite-card');
        assert.strictEqual(cards.length, 1);
        assert.ok(cards[0].classList.contains('is-active'));

        // Update state to empty
        drawer.updateState({ favorites: [] });
        assert.ok(drawer.el.querySelector('.apolo-favorites-empty'));
    });

    test('afterAll', () => {
        (globalThis as any).document = prevDoc;
    });
});
