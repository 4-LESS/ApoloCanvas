import test from 'node:test';
import assert from 'node:assert/strict';
import { Toolbar, TOOLBAR_PRIORITIES } from '../src/ui/Toolbar.ts';
import type { ToolbarOptions } from '../src/ui/Toolbar.ts';
import type { ToolbarSlot, ToolType, ShapeType } from '../src/core/types.ts';

function createMockElement(tag: string): any {
    const children: any[] = [];
    const attributes = new Map<string, string>();
    const listeners = new Map<string, Function[]>();
    const styleObj: any = {
        display: '',
        left: '',
        top: '',
        width: '',
        height: '',
        maxWidth: '',
        maxHeight: '',
        transform: '',
        transition: '',
        background: '',
        border: '',
        setProperty: (k: string, v: string) => { styleObj[k] = v; },
        getPropertyValue: (k: string) => styleObj[k] ?? '',
    };

    const el: any = {
        tagName: tag.toUpperCase(),
        style: styleObj,
        dataset: {},
        hidden: false,
        disabled: false,
        title: '',
        type: 'button',
        className: '',
        children,
        parentElement: null,
        offsetWidth: 0,
        offsetHeight: 0,
        scrollWidth: 0,
        scrollHeight: 0,
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
        appendChild: (child: any) => {
            children.push(child);
            child.parentElement = el;
            return child;
        },
        append: (...args: any[]) => {
            for (const c of args) {
                if (c) {
                    children.push(c);
                    c.parentElement = el;
                }
            }
        },
        replaceChildren: (...args: any[]) => {
            children.length = 0;
            for (const c of args) {
                if (c) {
                    children.push(c);
                    c.parentElement = el;
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
        addEventListener: (type: string, fn: Function) => {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type)!.push(fn);
        },
        removeEventListener: (type: string, fn: Function) => {
            const list = listeners.get(type);
            if (list) {
                const idx = list.indexOf(fn);
                if (idx !== -1) list.splice(idx, 1);
            }
        },
        dispatchEvent: (ev: any) => {
            const list = listeners.get(ev.type) || [];
            for (const fn of [...list]) fn(ev);
            return true;
        },
        click: () => {
            const list = listeners.get('click') || [];
            const ev = {
                type: 'click',
                target: el,
                currentTarget: el,
                preventDefault: () => {},
                stopPropagation: () => {},
            };
            for (const fn of [...list]) fn(ev);
        },
        querySelector: (selector: string): any => {
            const matches = el.querySelectorAll(selector);
            return matches.length > 0 ? matches[0] : null;
        },
        querySelectorAll: (selector: string): any[] => {
            const results: any[] = [];
            const traverse = (node: any) => {
                for (const child of node.children) {
                    if (matchesSelector(child, selector)) {
                        results.push(child);
                    }
                    traverse(child);
                }
            };
            traverse(el);
            return results;
        },
        getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            width: el.offsetWidth || 0,
            height: el.offsetHeight || 0,
        }),
    };

    return el;
}

function matchesSelector(node: any, selector: string): boolean {
    if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        return node.classList?.contains(cls) ?? false;
    }
    if (selector.startsWith('button[')) {
        const match = selector.match(/button\[([a-zA-Z-]+)\^="([^"]+)"\]/);
        if (match) {
            const [_, attr, prefix] = match;
            const val = node.getAttribute(attr);
            return typeof val === 'string' && val.startsWith(prefix);
        }
    }
    if (selector.startsWith('[')) {
        const match = selector.match(/\[([a-zA-Z-]+)="([^"]+)"\]/);
        if (match) {
            const [_, attr, val] = match;
            return node.getAttribute(attr) === val;
        }
    }
    if (selector === 'button') {
        return node.tagName === 'BUTTON';
    }
    if (selector === 'span') {
        return node.tagName === 'SPAN';
    }
    if (selector === 'svg') {
        return node.tagName === 'SVG';
    }
    return false;
}

function ensureDomEnvironment(): void {
    const listeners = new Map<string, Array<{ listener: Function; options?: any }>>();
    const bodyEl = createMockElement('body');

    (global as any).window = {
        innerWidth: 1280,
        innerHeight: 800,
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
    };

    (global as any).document = {
        body: bodyEl,
        documentElement: createMockElement('html'),
        createElement: (tag: string) => createMockElement(tag),
        createElementNS: (ns: string, tag: string) => createMockElement(tag),
    };

    (global as any).ResizeObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
    };
}

function createDefaultOptions(overrides: Partial<ToolbarOptions> = {}): ToolbarOptions {
    return {
        slot: 'tc',
        penEnabled: true,
        activeTool: 'pen',
        activeShape: 'rect',
        activeColor: '#000000',
        activeWidth: 3,
        activeProfileId: 'fountain',
        activeFavoriteIndex: 0,
        favorites: [
            { color: '#000000', width: 2, profileId: 'fountain' },
            { color: '#e03131', width: 3, profileId: 'ball' },
            { color: '#2f9e44', width: 4, profileId: 'fountain' },
            { color: '#1971c2', width: 5, profileId: 'calli' },
        ],
        snapGrid: false,
        canUndo: false,
        canRedo: false,
        eraserRadius: 16,
        eraserMode: 'whole',
        onSlotChange: () => {},
        onToggleKeyboardMode: () => {},
        onSelectTool: () => {},
        onToggleEstuche: () => {},
        onUndo: () => {},
        onRedo: () => {},
        onSelectFavorite: () => {},
        onSelectThickness: () => {},
        onToggleSnapGrid: () => {},
        onToggleMoreMenu: () => {},
        onInsertCanvas: () => {},
        ...overrides,
    };
}

test('Fase 4: Declarative Toolbar Item Order & Structure', async (t) => {
    ensureDomEnvironment();

    let keyboardToggled = false;
    let selectedTool: ToolType | null = null;
    let estucheToggled: ToolType | null = null;
    let canvasInserted = false;
    let undoTriggered = false;
    let redoTriggered = false;
    let favoriteSelected: number | null = null;
    let thicknessSelected: string | null = null;
    let snapGridToggled = false;
    let moreMenuToggled = false;

    const options = createDefaultOptions({
        onToggleKeyboardMode: () => { keyboardToggled = true; },
        onSelectTool: (tool) => { selectedTool = tool; },
        onToggleEstuche: (tool) => { estucheToggled = tool; },
        onInsertCanvas: () => { canvasInserted = true; },
        onUndo: () => { undoTriggered = true; },
        onRedo: () => { redoTriggered = true; },
        onSelectFavorite: (idx) => { favoriteSelected = idx; },
        onSelectThickness: (preset) => { thicknessSelected = preset; },
        onToggleSnapGrid: () => { snapGridToggled = true; },
        onToggleMoreMenu: () => { moreMenuToggled = true; },
    });

    const toolbar = new Toolbar(options, (document as any).body);

    await t.test('Toolbar renders with role="toolbar" and aria-label', () => {
        assert.equal(toolbar.container.getAttribute('role'), 'toolbar');
        assert.equal(toolbar.container.getAttribute('aria-label'), 'Herramientas Apolo Canvas');
        assert.ok(toolbar.container.classList.contains('apolo-canvas-toolbar'));
    });

    await t.test('Modo teclado (Stylus as cursor) has inverted logic & amber highlight when pen is disabled', () => {
        const kbBtn = toolbar.container.querySelector('.apolo-btn-keyboard');
        assert.ok(kbBtn, 'Keyboard button exists');

        // Initially penEnabled: true -> kbBtn is not active
        assert.equal(kbBtn?.classList.contains('is-active'), false);
        assert.equal(kbBtn?.getAttribute('aria-pressed'), 'false');

        // When penEnabled: false -> stylus acts as cursor -> kbBtn is active (amber warning)
        toolbar.setPenEnabled(false);
        assert.equal(kbBtn?.classList.contains('is-active'), true);
        assert.equal(kbBtn?.getAttribute('aria-pressed'), 'true');

        // Click triggers onToggleKeyboardMode
        kbBtn?.click();
        assert.equal(keyboardToggled, true);

        // Restore pen
        toolbar.setPenEnabled(true);
        assert.equal(kbBtn?.classList.contains('is-active'), false);
    });

    await t.test('Core tools (pen, highlighter, eraser, lasso, shape) and estuche corner triggers', () => {
        const tools: ToolType[] = ['pen', 'highlighter', 'eraser', 'lasso', 'shape'];
        for (const tool of tools) {
            const btn = toolbar.getToolButton(tool);
            assert.ok(btn, `Button for ${tool} exists`);
            assert.equal(btn?.getAttribute('data-apolo-popover-trigger'), 'true');

            const triangle = btn?.querySelector('.apolo-tool-triangle');
            assert.ok(triangle, `Triangle trigger for ${tool} exists`);
            assert.equal(triangle?.getAttribute('data-apolo-popover-trigger'), 'true');
        }
    });

    await t.test('Selecting an inactive tool vs second tap on active tool (including eraser estuche)', () => {
        selectedTool = null;
        estucheToggled = null;

        // 1. Tapping an inactive tool ('highlighter') selects it
        const hlrBtn = toolbar.getToolButton('highlighter')!;
        hlrBtn.click();
        assert.equal(selectedTool, 'highlighter');
        assert.equal(estucheToggled, null);

        // 2. Set active tool to 'eraser'
        toolbar.setTool('eraser');
        assert.equal(toolbar.getToolButton('eraser')?.classList.contains('is-active'), true);

        // 3. Second tap on active eraser must toggle its estuche!
        const eraserBtn = toolbar.getToolButton('eraser')!;
        eraserBtn.click();
        assert.equal(estucheToggled, 'eraser', 'Second tap on eraser toggles eraser estuche');

        // 4. Clicking the corner triangle on eraser directly also toggles estuche
        estucheToggled = null;
        const eraserTriangle = eraserBtn.querySelector('.apolo-tool-triangle')!;
        eraserTriangle.click();
        assert.equal(estucheToggled, 'eraser');
    });

    await t.test('Shape tool dynamically reflects active shape icon', () => {
        toolbar.setTool('shape', 'ellipse');
        const shapeBtn = toolbar.getToolButton('shape')!;
        assert.ok(shapeBtn.classList.contains('is-active'));

        // Changing shape updates the SVG container
        toolbar.setShape('triangle');
        const svg = shapeBtn.querySelector('svg');
        assert.ok(svg, 'Shape icon SVG rendered');
    });

    await t.test('Action "Insertar canvas" is instant one-tap (not a tool mode)', () => {
        const insertBtn = toolbar.container.querySelector('.apolo-insert-canvas-btn');
        assert.ok(insertBtn, 'Insert canvas button exists');
        assert.equal(insertBtn?.getAttribute('aria-label'), 'Insertar canvas');

        insertBtn?.click();
        assert.equal(canvasInserted, true);
    });

    await t.test('History (undo, redo) zero-latency buttons and disabled states', () => {
        const undoBtn = toolbar.container.querySelector('button[aria-label^="Deshacer"]');
        const redoBtn = toolbar.container.querySelector('button[aria-label^="Rehacer"]');
        assert.ok(undoBtn && redoBtn);

        // Initially disabled
        assert.equal(undoBtn?.disabled, true);
        assert.equal(undoBtn?.classList.contains('is-disabled'), true);
        assert.equal(redoBtn?.disabled, true);

        // Enable undo
        toolbar.setHistory(true, false);
        assert.equal(undoBtn?.disabled, false);
        assert.equal(undoBtn?.classList.contains('is-disabled'), false);
        assert.equal(redoBtn?.disabled, true);

        // Click undo
        undoBtn?.click();
        assert.equal(undoTriggered, true);

        // Enable redo
        toolbar.setHistory(true, true);
        assert.equal(redoBtn?.disabled, false);
        redoBtn?.click();
        assert.equal(redoTriggered, true);
    });

    await t.test('4 Favorites chips render with ink colors and highlight active favorite', () => {
        toolbar.setTool('pen');
        const chips = toolbar.container.querySelectorAll('.apolo-fav-chip');
        assert.equal(chips.length, 4);

        chips[1].click();
        assert.equal(favoriteSelected, 1);

        // Active index 1 is highlighted
        toolbar.setFavorites(options.favorites, 1);
        assert.equal(chips[1].classList.contains('is-active'), true);
        assert.equal(chips[0].classList.contains('is-active'), false);
    });

    await t.test('Thickness presets (fine, medium, thick) respond to tools and radius', () => {
        const thickBtns = toolbar.container.querySelectorAll('.apolo-thickness-btn');
        assert.equal(thickBtns.length, 3);

        thickBtns[0].click();
        assert.equal(thicknessSelected, 'fine');

        // With eraser active, thickness buttons adapt to eraser mode
        toolbar.setTool('eraser');
        toolbar.setThicknessValues(2, 8); // radius 8 is fine
        assert.equal(thickBtns[0].classList.contains('is-eraser'), true);
        assert.equal(thickBtns[0].classList.contains('is-active'), true);

        // With lasso active, thickness buttons are dimmed
        toolbar.setTool('lasso');
        assert.equal(thickBtns[0].classList.contains('is-dimmed'), true);
    });

    await t.test('Magnetic Grid toggle and More Menu ⋯ button', () => {
        const gridBtn = toolbar.container.querySelector('.apolo-grid-btn');
        assert.ok(gridBtn);
        assert.equal(gridBtn?.classList.contains('is-active'), false);

        gridBtn?.click();
        assert.equal(snapGridToggled, true);

        toolbar.setSnapGrid(true);
        assert.equal(gridBtn?.classList.contains('is-active'), true);

        const moreBtn = toolbar.container.querySelector('.apolo-more-btn');
        assert.ok(moreBtn);
        assert.equal(moreBtn?.getAttribute('data-apolo-popover-trigger'), 'true');
        moreBtn?.click();
        assert.equal(moreMenuToggled, true);
    });

    toolbar.destroy();
});

test('Fase 4: Responsive Overflow Prioritization (10: snapGrid -> 20: thickness -> 30: favorites)', async (t) => {
    ensureDomEnvironment();

    const options = createDefaultOptions();
    const toolbar = new Toolbar(options, (document as any).body);

    await t.test('All items are visible on spacious viewport (e.g. 1280px landscape)', () => {
        (global as any).window.innerWidth = 1280;
        (global as any).window.innerHeight = 800;

        toolbar.recalculateLayout();

        assert.equal(toolbar.isItemOverflowed('snapGrid'), false);
        assert.equal(toolbar.isItemOverflowed('thickness'), false);
        assert.equal(toolbar.isItemOverflowed('favorites'), false);
        assert.deepEqual(toolbar.getOverflowedItems(), []);
    });

    await t.test('Step 1: Priority 10 (snapGrid) overflows first when width is constrained', () => {
        // Full width is ~874px. Without snapGrid is ~830px.
        // At innerWidth = 880px, availableSpace = 848px. SnapGrid overflows, thickness fits.
        (global as any).window.innerWidth = 880;
        toolbar.recalculateLayout();

        assert.equal(toolbar.isItemOverflowed('snapGrid'), true, 'snapGrid overflows first');
        assert.equal(toolbar.isItemOverflowed('thickness'), false, 'thickness still fits');
        assert.equal(toolbar.isItemOverflowed('favorites'), false, 'favorites still fits');

        const gridBtn = toolbar.container.querySelector('.apolo-grid-btn');
        assert.equal(gridBtn?.style.display, 'none');
        assert.equal(gridBtn?.classList.contains('is-overflowed'), true);
    });

    await t.test('Step 2: Priority 20 (thickness) overflows second when width drops further', () => {
        // Without snapGrid is ~830px. Without thickness is ~705px.
        // At innerWidth = 780px, availableSpace = 748px. Thickness overflows, favorites fits.
        (global as any).window.innerWidth = 780;
        toolbar.recalculateLayout();

        assert.equal(toolbar.isItemOverflowed('snapGrid'), true);
        assert.equal(toolbar.isItemOverflowed('thickness'), true, 'thickness overflows second');
        assert.equal(toolbar.isItemOverflowed('favorites'), false, 'favorites still fits');

        const thickGroup = toolbar.container.querySelector('.apolo-thickness-group');
        assert.equal(thickGroup?.style.display, 'none');
        assert.equal(thickGroup?.classList.contains('is-overflowed'), true);
    });

    await t.test('Step 3: Priority 30 (favorites) overflows third when width drops very narrow', () => {
        // If available width is 508px, favorites overflows.
        (global as any).window.innerWidth = 540;
        toolbar.recalculateLayout();

        assert.equal(toolbar.isItemOverflowed('snapGrid'), true);
        assert.equal(toolbar.isItemOverflowed('thickness'), true);
        assert.equal(toolbar.isItemOverflowed('favorites'), true, 'favorites overflows third');

        const favGroup = toolbar.container.querySelector('.apolo-favs-group');
        assert.equal(favGroup?.style.display, 'none');
        assert.equal(favGroup?.classList.contains('is-overflowed'), true);

        // Core tools, keyboard mode, insertCanvas, history, grip, more NEVER overflow!
        assert.ok(toolbar.getToolButton('pen')?.style.display !== 'none');
        assert.ok(toolbar.container.querySelector('.apolo-more-btn')?.style.display !== 'none');
    });

    await t.test('Dividers adapt dynamically with no consecutive or trailing dividers', () => {
        const visibleDividers = Array.from(toolbar.container.querySelectorAll('.apolo-toolbar-divider'))
            .filter(d => d.style.display !== 'none');

        assert.ok(visibleDividers.length > 0, 'Some dividers remain visible');
        const children = Array.from(toolbar.container.children) as any[];
        for (let i = 0; i < children.length; i++) {
            if (children[i].classList.contains('apolo-toolbar-divider') && children[i].style.display !== 'none') {
                const next = children[i + 1];
                assert.ok(next && !next.classList.contains('apolo-toolbar-divider'), 'No two dividers adjacent');
            }
        }
    });

    await t.test('Restoring spacious width restores all items', () => {
        (global as any).window.innerWidth = 1280;
        toolbar.recalculateLayout();

        assert.deepEqual(toolbar.getOverflowedItems(), []);
        assert.equal(toolbar.container.querySelector('.apolo-grid-btn')?.style.display, '');
        assert.equal(toolbar.container.querySelector('.apolo-thickness-group')?.style.display, '');
        assert.equal(toolbar.container.querySelector('.apolo-favs-group')?.style.display, '');
    });

    toolbar.destroy();
});

test('Fase 4: 8 Docking Slots & Natural Dimensions', async (t) => {
    ensureDomEnvironment();

    (global as any).window.innerWidth = 1280;
    (global as any).window.innerHeight = 800;

    const slots: ToolbarSlot[] = ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'];
    let changedSlot: ToolbarSlot | null = null;

    const toolbar = new Toolbar(
        createDefaultOptions({
            slot: 'tc',
            onSlotChange: (slot) => { changedSlot = slot; },
        }),
        (document as any).body,
    );

    await t.test('Coordinates calculated properly for all 8 slots', () => {
        for (const s of slots) {
            const coords = toolbar.getSlotCoordinates(s);
            assert.ok(coords.x >= 8, `${s} x is within bounds`);
            assert.ok(coords.y >= 8, `${s} y is within bounds`);
            assert.ok(coords.width > 0, `${s} width > 0`);
            assert.ok(coords.height > 0, `${s} height > 0`);
        }
    });

    await t.test('Top Center (tc) and Bottom Center (bc) are horizontally centered', () => {
        const tc = toolbar.getSlotCoordinates('tc');
        const bc = toolbar.getSlotCoordinates('bc');

        const expectedCenterX = Math.round((1280 - tc.width) / 2);
        assert.equal(tc.x, expectedCenterX);
        assert.equal(bc.x, expectedCenterX);
        assert.equal(tc.y, 56); // margin top
        assert.equal(bc.y, 800 - bc.height - 36); // margin bottom
    });

    await t.test('Mid Left (ml) and Mid Right (mr) are vertical and vertically centered', () => {
        toolbar.setSlot('ml');
        assert.equal(toolbar.container.classList.contains('is-vertical'), true);

        const ml = toolbar.getSlotCoordinates('ml');
        assert.equal(ml.width, 58);
        assert.equal(ml.x, 16);
        const expectedCenterY = Math.round((800 - ml.height) / 2);
        assert.equal(ml.y, expectedCenterY);

        toolbar.setSlot('mr');
        assert.equal(toolbar.container.classList.contains('is-vertical'), true);
        const mr = toolbar.getSlotCoordinates('mr');
        assert.equal(mr.width, 58);
        assert.equal(mr.x, 1280 - 58 - 16);
        assert.equal(mr.y, expectedCenterY);

        // Switch back to horizontal
        toolbar.setSlot('tc');
        assert.equal(toolbar.container.classList.contains('is-vertical'), false);
    });

    toolbar.destroy();
});
