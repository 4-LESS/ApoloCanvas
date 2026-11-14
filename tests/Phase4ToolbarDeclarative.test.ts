import test from 'node:test';
import assert from 'node:assert/strict';
import { Toolbar, TOOLBAR_PRIORITIES } from '../src/ui/Toolbar.ts';
import { LassoMenu } from '../src/ui/LassoMenu.ts';
import type { ToolbarOptions } from '../src/ui/Toolbar.ts';
import type { ToolbarSlot, ToolType, ShapeType } from '../src/core/types.ts';
import { createToolbarOptions as createDefaultOptions, installDom } from './helpers/mockDom.ts';

function ensureDomEnvironment(): void {
    installDom({ defaultRect: 'offset' });
    (global as any).window.innerWidth = 1280;
    (global as any).window.innerHeight = 800;
    (global as any).ResizeObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
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
    let colorChanged: string | null = null;
    let paletteUpdated: { toolKey: string; slotIndex: number; color: string; opacity: number } | null = null;
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
        onChangeColor: (c) => { colorChanged = c; },
        onUpdatePaletteColor: (k, idx, col, op) => { paletteUpdated = { toolKey: k, slotIndex: idx, color: col, opacity: op }; },
        onSelectThickness: (preset) => { thicknessSelected = preset; },
        onToggleSnapGrid: () => { snapGridToggled = true; },
        onToggleMoreMenu: () => { moreMenuToggled = true; },
    });

    const toolbar = new Toolbar(options, (document as any).body);

    await t.test('Toolbar renders with role="toolbar" without a hover-triggering label', () => {
        assert.equal(toolbar.container.getAttribute('role'), 'toolbar');
        assert.equal(toolbar.container.hasAttribute('aria-label'), false);
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

    await t.test('Core tools (pen, highlighter, eraser, lasso, shape) and trigger attributes', () => {
        const tools: ToolType[] = ['pen', 'highlighter', 'eraser', 'lasso', 'shape'];
        for (const tool of tools) {
            const btn = toolbar.getToolButton(tool);
            assert.ok(btn, `Button for ${tool} exists`);
            assert.equal(btn?.getAttribute('data-apolo-popover-trigger'), 'true');
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
        const chips = toolbar.container.querySelectorAll<HTMLButtonElement>('.apolo-fav-chip');
        assert.equal(chips.length, 4);

        chips[1].click();
        assert.equal(favoriteSelected, 1);
        assert.ok(colorChanged, 'onChangeColor was called');

        // Active index 1 is highlighted
        toolbar.setFavorites(options.favorites, 1);
        assert.equal(chips[1].classList.contains('is-active'), true);
        assert.equal(chips[0].classList.contains('is-active'), false);

        // 2nd tap on already active slot toggles ColorPickerPopover
        assert.equal(toolbar.colorPickerPopover.isOpen(), false);
        chips[1].click();
        assert.equal(toolbar.colorPickerPopover.isOpen(), true);

        // Close popover
        toolbar.colorPickerPopover.close();
        assert.equal(toolbar.colorPickerPopover.isOpen(), false);
    });

    await t.test('Quick color bar is strictly for colors: setToolPalettes updates palette and colors are accessible per tool', () => {
        const customPalettes = {
            pen: { colors: ['#111111', '#222222', '#333333', '#444444'], opacities: [100, 100, 100, 100] },
            highlighter: { colors: ['#FFFF00', '#00FF00', '#00FFFF', '#FF00FF'], opacities: [75, 75, 75, 75] },
            shape: { colors: ['#AA0000', '#00AA00', '#0000AA', '#AAAA00'], opacities: [100, 100, 100, 100] },
        };
        toolbar.setToolPalettes(customPalettes);
        const retrieved = toolbar.getToolPalettes();
        assert.deepEqual(retrieved.pen.colors, customPalettes.pen.colors);
        assert.deepEqual(retrieved.highlighter.colors, customPalettes.highlighter.colors);
        assert.deepEqual(retrieved.shape.colors, customPalettes.shape.colors);

        // Switching tools updates the visible palette without losing tool identity
        toolbar.setTool('highlighter');
        const hlChips = toolbar.container.querySelectorAll<HTMLButtonElement>('.apolo-fav-chip');
        const hlDot = hlChips[0].querySelector('.apolo-color-dot') as HTMLElement;
        assert.ok(hlDot.style.backgroundColor === '#FFFF00' || hlDot.style.backgroundColor === 'rgb(255, 255, 0)');

        toolbar.setTool('pen');
        const penDot = hlChips[0].querySelector('.apolo-color-dot') as HTMLElement;
        assert.ok(penDot.style.backgroundColor === '#111111' || penDot.style.backgroundColor === 'rgb(17, 17, 17)');
    });

    await t.test('Thickness trigger button and line preview respond to tools and radius', () => {
        const thickBtn = toolbar.container.querySelector('.apolo-thickness-trigger-btn');
        assert.ok(thickBtn, 'Thickness trigger button exists');
        assert.equal(thickBtn?.getAttribute('data-apolo-popover-trigger'), 'true');

        const preview = thickBtn?.querySelector('.apolo-thickness-line-preview') as HTMLElement;
        assert.ok(preview, 'Line preview element exists');

        // With eraser active, thickness button adapts to eraser mode
        toolbar.setTool('eraser');
        toolbar.setThicknessValues(2, 8);
        assert.equal(thickBtn?.classList.contains('is-eraser'), true);

        // With lasso active, thickness button is dimmed
        toolbar.setTool('lasso');
        assert.equal(thickBtn?.classList.contains('is-dimmed'), true);

        // Restore pen tool
        toolbar.setTool('pen');
        toolbar.setWidth(4);
        assert.equal(preview.style.height, '4px');
    });

    await t.test('Magnetic Grid toggle (and More Menu ⋯ button is removed)', () => {
        const gridBtn = toolbar.container.querySelector('.apolo-grid-btn');
        assert.ok(gridBtn);
        assert.equal(gridBtn?.classList.contains('is-active'), false);

        gridBtn?.click();
        assert.equal(snapGridToggled, true);

        toolbar.setSnapGrid(true);
        assert.equal(gridBtn?.classList.contains('is-active'), true);

        // More Menu button was removed as redundant
        const moreBtn = toolbar.container.querySelector('.apolo-more-btn');
        assert.equal(moreBtn, null, 'More button is removed');
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
        // With the single-thickness trigger, the toolbar footprint is smaller.
        // At innerWidth = 820px, availableSpace = 788px. SnapGrid overflows, thickness fits.
        (global as any).window.innerWidth = 820;
        toolbar.recalculateLayout();

        assert.equal(toolbar.isItemOverflowed('snapGrid'), true, 'snapGrid overflows first');
        assert.equal(toolbar.isItemOverflowed('thickness'), false, 'thickness still fits');
        assert.equal(toolbar.isItemOverflowed('favorites'), false, 'favorites still fits');

        const gridBtn = toolbar.container.querySelector('.apolo-grid-btn');
        assert.equal(gridBtn?.style.display, 'none');
        assert.equal(gridBtn?.classList.contains('is-overflowed'), true);
    });

    await t.test('Step 2: Priority 20 (thickness) overflows second when width drops further', () => {
        // The single-thickness trigger reduces the footprint enough that 800px is still enough
        // to keep favorites visible while thickness is the next item to hide.
        (global as any).window.innerWidth = 800;
        toolbar.recalculateLayout();

        assert.equal(toolbar.isItemOverflowed('snapGrid'), true);
        assert.equal(toolbar.isItemOverflowed('thickness'), true, 'thickness overflows second');
        assert.equal(toolbar.isItemOverflowed('favorites'), false, 'favorites still fits');

        const thickGroup = toolbar.container.querySelector('.apolo-thickness-group');
        assert.equal(thickGroup?.style.display, 'none');
        assert.equal(thickGroup?.classList.contains('is-overflowed'), true);
    });

    await t.test('Step 3: Priority 30 (favorites) overflows third when width drops very narrow', () => {
        // Once the lower-priority controls are hidden, favorites is the final item to overflow.
        (global as any).window.innerWidth = 650;
        toolbar.recalculateLayout();

        assert.equal(toolbar.isItemOverflowed('snapGrid'), true);
        assert.equal(toolbar.isItemOverflowed('thickness'), true);
        assert.equal(toolbar.isItemOverflowed('favorites'), true, 'favorites overflows third');

        const favGroup = toolbar.container.querySelector('.apolo-favs-group');
        assert.equal(favGroup?.style.display, 'none');
        assert.equal(favGroup?.classList.contains('is-overflowed'), true);

        // Core tools, keyboard mode, insertCanvas, history, grip NEVER overflow!
        assert.ok(toolbar.getToolButton('pen')?.style.display !== 'none');
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
        assert.equal(bc.y, 800 - bc.height - 56); // reserved bottom space
    });

    await t.test('Mid Left (ml) and Mid Right (mr) are vertical and vertically centered', () => {
        const grip = toolbar.container.querySelector('.apolo-toolbar-grip');
        toolbar.setSlot('ml');
        assert.equal(toolbar.container.classList.contains('is-vertical'), true);
        assert.equal(toolbar.container.classList.contains('is-flipping-orientation'), true);
        assert.equal(toolbar.container.querySelector('.apolo-toolbar-grip'), grip, 'Orientation changes preserve the grip DOM node');

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
        assert.equal(toolbar.container.querySelector('.apolo-toolbar-grip'), grip, 'Switching back preserves the grip DOM node');
    });

    await t.test('Switching between vertical and horizontal slots stays within viewport bounds', () => {
        for (const slot of ['mr', 'br', 'mr', 'br'] as const) {
            toolbar.setSlot(slot);
            const dimensions = toolbar.getDimensions(slot);
            const left = Number.parseFloat(toolbar.container.style.left);
            const top = Number.parseFloat(toolbar.container.style.top);

            assert.ok(left + dimensions.width <= window.innerWidth - 8, `${slot} toolbar must fit within the right viewport edge`);
            assert.ok(top + dimensions.height <= window.innerHeight - 8, `${slot} toolbar must fit within the bottom viewport edge`);
        }
    });

    await t.test('Dragging into a side snap zone switches orientation before pointerup', () => {
        toolbar.setSlot('br');
        const grip = toolbar.container.querySelector('.apolo-toolbar-grip');
        assert.ok(grip);
        grip.dispatchEvent({
            type: 'pointerdown',
            pointerId: 77,
            clientX: 20,
            clientY: 10,
            currentTarget: grip,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        const zones = (toolbar as any).dotsContainer.children as any[];
        assert.deepEqual(zones.map(zone => zone.dataset.slot), ['tc', 'bc', 'ml', 'mr']);
        assert.ok(zones.every(zone => zone.classList.contains('apolo-snap-zone')));

        (window as any).dispatchEvent({
            type: 'pointermove',
            pointerId: 77,
            clientX: 1240,
            clientY: 400,
            preventDefault: () => {},
        });

        assert.equal(toolbar.container.classList.contains('is-vertical'), true);

        (window as any).dispatchEvent({
            type: 'pointerup',
            pointerId: 77,
            clientX: 1240,
            clientY: 400,
        });
        assert.equal(changedSlot, 'mr');
    });

    await t.test('Vertical bottom-tip contact locks the preview to bc until reverse movement', () => {
        toolbar.setSlot('mr');
        const dimensions = toolbar.getDimensions();
        const left = Number.parseFloat(toolbar.container.style.left);
        const top = Number.parseFloat(toolbar.container.style.top);
        (toolbar.container as any).getBoundingClientRect = () => ({
            left,
            top,
            right: left + dimensions.width,
            bottom: top + dimensions.height,
            width: dimensions.width,
            height: dimensions.height,
        });

        const grip = toolbar.container.querySelector('.apolo-toolbar-grip');
        assert.ok(grip);
        const pointerStartX = left + 4;
        const pointerStartY = top + 8;
        const edgePointerX = pointerStartX + (window.innerWidth - dimensions.width) / 2 - left;
        const edgePointerY = pointerStartY + window.innerHeight - dimensions.height - 8 - top;
        grip.dispatchEvent({
            type: 'pointerdown',
            pointerId: 78,
            clientX: pointerStartX,
            clientY: pointerStartY,
            currentTarget: grip,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        (window as any).dispatchEvent({
            type: 'pointermove',
            pointerId: 78,
            clientX: edgePointerX,
            clientY: edgePointerY,
            preventDefault: () => {},
        });

        assert.equal(toolbar.getSlot(), 'bc');
        assert.equal(toolbar.container.classList.contains('is-vertical'), false);
        assert.equal(toolbar.container.classList.contains('is-snap-locked'), true);
        assert.equal(toolbar.container.classList.contains('is-dragging'), false);
        assert.match(toolbar.container.style.transition, /left 0\.24s/);
        const dockedTop = Number.parseFloat(toolbar.container.style.top);
        assert.ok(dockedTop > 650, 'Horizontal preview remains docked to the bottom edge');

        (window as any).dispatchEvent({
            type: 'pointermove',
            pointerId: 78,
            clientX: edgePointerX + 1,
            clientY: edgePointerY + 1,
            preventDefault: () => {},
        });
        assert.equal(Number.parseFloat(toolbar.container.style.top), dockedTop, 'Holding near bc keeps the preview docked');
        assert.equal((toolbar as any).lockedSnap?.slot, 'bc');

        (window as any).dispatchEvent({
            type: 'pointermove',
            pointerId: 78,
            clientX: edgePointerX + 1,
            clientY: edgePointerY - 45,
            preventDefault: () => {},
        });
        assert.equal((toolbar as any).lockedSnap, null, 'Reverse movement past the unlock delta releases the edge lock');
        assert.equal(toolbar.container.classList.contains('is-dragging'), true);
        assert.equal(toolbar.container.classList.contains('is-snap-locked'), false);
        assert.match(toolbar.container.style.transition, /left 0\.16s/);

        (window as any).dispatchEvent({ type: 'pointerup', pointerId: 78, clientX: edgePointerX + 1, clientY: edgePointerY - 45 });
        assert.equal(toolbar.container.classList.contains('is-dragging'), false);
        assert.equal(toolbar.container.classList.contains('is-snap-locked'), false);
    });

    await t.test('Horizontal right-tip contact locks the preview to mr until reverse movement', () => {
        toolbar.setSlot('tc');
        const dimensions = toolbar.getDimensions();
        const left = Number.parseFloat(toolbar.container.style.left);
        const top = Number.parseFloat(toolbar.container.style.top);
        (toolbar.container as any).getBoundingClientRect = () => ({
            left,
            top,
            right: left + dimensions.width,
            bottom: top + dimensions.height,
            width: dimensions.width,
            height: dimensions.height,
        });

        const grip = toolbar.container.querySelector('.apolo-toolbar-grip');
        assert.ok(grip);
        const pointerStartX = left + 8;
        const pointerStartY = top + 8;
        const edgePointerX = pointerStartX + window.innerWidth - 8 - left - dimensions.width;
        const edgePointerY = pointerStartY + (window.innerHeight - dimensions.height) / 2 - top;
        grip.dispatchEvent({
            type: 'pointerdown',
            pointerId: 79,
            clientX: pointerStartX,
            clientY: pointerStartY,
            currentTarget: grip,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        (window as any).dispatchEvent({
            type: 'pointermove',
            pointerId: 79,
            clientX: edgePointerX,
            clientY: edgePointerY,
            preventDefault: () => {},
        });

        assert.equal(toolbar.getSlot(), 'mr');
        assert.equal(toolbar.container.classList.contains('is-vertical'), true);
        const dockedLeft = Number.parseFloat(toolbar.container.style.left);
        assert.ok(dockedLeft > 1100, 'Vertical preview remains docked to the right edge');

        (window as any).dispatchEvent({
            type: 'pointermove',
            pointerId: 79,
            clientX: edgePointerX + 1,
            clientY: edgePointerY + 1,
            preventDefault: () => {},
        });
        assert.equal(Number.parseFloat(toolbar.container.style.left), dockedLeft, 'Holding near mr keeps the preview docked');
        assert.equal((toolbar as any).lockedSnap?.slot, 'mr');

        (window as any).dispatchEvent({
            type: 'pointermove',
            pointerId: 79,
            clientX: edgePointerX - 45,
            clientY: edgePointerY + 1,
            preventDefault: () => {},
        });
        assert.equal((toolbar as any).lockedSnap, null, 'Reverse movement past the unlock delta releases the edge lock');

        (window as any).dispatchEvent({ type: 'pointerup', pointerId: 79, clientX: edgePointerX - 45, clientY: edgePointerY + 1 });
    });

    await t.test('Legacy corner slots normalize to their cardinal edges', () => {
        toolbar.setSlot('tr');
        assert.equal(toolbar.getSlot(), 'tc');
        toolbar.setSlot('bl');
        assert.equal(toolbar.getSlot(), 'bc');
    });

    await t.test('Slot coordinates use the active view-content bounds', () => {
        const previousQuerySelector = (document as any).querySelector;
        const viewContent = (document as any).createElement('div');
        viewContent.className = 'view-content';
        viewContent.getBoundingClientRect = () => ({
            left: 200,
            top: 80,
            right: 900,
            bottom: 720,
            width: 700,
            height: 640,
        });
        (document as any).querySelector = (selector: string) =>
            selector === '.workspace-leaf.mod-active .view-content' ? viewContent : null;

        try {
            const topLeft = toolbar.getSlotCoordinates('tl');
            const bottomRight = toolbar.getSlotCoordinates('br');
            assert.equal(topLeft.x, 216);
            assert.equal(topLeft.y, 96);
            assert.ok(toolbar.getDimensions('br').width <= 668);
            assert.ok(bottomRight.x >= 208);
            assert.ok(bottomRight.x + bottomRight.width <= 892);
            assert.ok(bottomRight.y + bottomRight.height <= 712);
        } finally {
            (document as any).querySelector = previousQuerySelector;
        }
    });

    toolbar.destroy();
});

test('LassoMenu: Modernized UI with icons, grouped dividers, and clean anchor formatting', async (t) => {
    ensureDomEnvironment();

    let copied = false;
    let deleted = false;
    let linked = false;

    const lasso = new LassoMenu(
        {
            onCopy: () => { copied = true; },
            onPaste: () => {},
            onLink: () => { linked = true; },
            onBringToFront: () => {},
            onSendToBack: () => {},
            onDelete: () => { deleted = true; },
            onApplyColor: () => {},
            onApplyWidth: () => {},
            onApplyPattern: () => {},
            onOpenLinkedNote: () => {},
            onUnlink: () => {},
            onDeselect: () => {},
        },
        (document as any).body,
    );

    await t.test('Renders action buttons with SVG icons, dividers, and proper aria-labels', () => {
        lasso.setSelection(
            [{ id: 's1', type: 'stroke', points: [], color: '#000', width: 2 } as any],
            { minX: 100, minY: 100, maxX: 300, maxY: 300 },
            'lines:0',
            1.0,
            0,
            0,
        );

        assert.equal(lasso.isOpen(), true);
        const floatingMenu = lasso.container.children[1];

        // Check that copy button is first and clickable
        const copyBtn = floatingMenu.children[0];
        assert.equal(copyBtn.getAttribute('aria-label'), 'Copiar');
        copyBtn.dispatchEvent({ type: 'click' });
        assert.equal(copied, true);

        // Check dividers exist between action groups
        const dividers = Array.from(floatingMenu.children).filter((c: any) =>
            c.classList?.contains('apolo-selection-divider')
        );
        assert.equal(dividers.length, 3, 'Expect exactly 3 dividers separating 4 action groups');

        // Check anchor pill has formatted text
        const anchorPill = lasso.container.children[0];
        assert.ok(anchorPill.textContent.includes('Línea 1'), 'lines:0 formatted as Línea 1');
    });

    await t.test('Formats space anchors as Espacio', () => {
        lasso.setSelection(
            [{ id: 's1', type: 'stroke', points: [], color: '#000', width: 2 } as any],
            { minX: 100, minY: 100, maxX: 300, maxY: 300 },
            'space:abc1234',
            1.0,
            0,
            0,
        );
        const anchorPill = lasso.container.children[0];
        assert.ok(anchorPill.textContent.includes('Espacio'), 'space:abc1234 formatted as Espacio');
    });

    lasso.hide();
    assert.equal(lasso.isOpen(), false);
    lasso.destroy();
});
