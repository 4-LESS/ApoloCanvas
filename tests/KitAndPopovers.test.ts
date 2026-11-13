import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    createSvgIcon,
    IconButton,
    SegmentedControl,
    ColorSwatchRow,
    SliderRow,
    ToggleRow,
    OptionCard,
    createSectionLabel,
    ActionRow,
    calculateAnchorPosition,
    applyPopoverPosition,
    PopoverShell,
    PopoverController,
    type IconName,
} from '../src/ui/kit/index.ts';
import { createMockWindowAndDoc, setupMockDom } from './helpers/mockDom.ts';

const KIT_DOM_OPTS = {
    defaultRect: { left: 100, top: 100, right: 200, bottom: 144, width: 100, height: 44 },
};

describe('Fase 2: UI Kit Primitives & Popover System', () => {
    test('Icon: createSvgIcon creates pure DOM SVG elements with correct attributes and zero innerHTML', () => {
        const { mockDoc: mockDocument, teardown } = setupMockDom(KIT_DOM_OPTS);

        try {
            const iconsToTest: IconName[] = [
                'pen', 'highlighter', 'eraser', 'lasso', 'shapes', 'line',
                'insertCanvas', 'undo', 'redo', 'grid', 'snap', 'close',
                'compress', 'trash', 'dragGrip', 'plus', 'minus', 'dots'
            ];

            for (const name of iconsToTest) {
                const svg = createSvgIcon(name, { size: 24 });
                assert.ok(svg, `createSvgIcon for ${name} must return an element`);
                assert.strictEqual(svg.getAttribute('aria-hidden'), 'true');
                assert.strictEqual(svg.getAttribute('viewBox'), '0 0 24 24');
                assert.strictEqual(svg.getAttribute('width'), '24');
                assert.strictEqual(svg.getAttribute('height'), '24');
                assert.ok(svg.children.length > 0, `Icon ${name} should have children created via DOM`);
            }
        } finally {
            teardown();
        }
    });

    test('IconButton: renders 44px touch target, sets ARIA attributes and handles keyboard activation', () => {
        const { mockDoc: mockDocument, teardown } = setupMockDom(KIT_DOM_OPTS);

        try {
            let clicked = false;
            const btn = new IconButton({
                icon: 'pen',
                label: 'Pluma estilográfica',
                active: false,
                triggerForPopover: true,
                onClick: () => { clicked = true; },
            });

            assert.strictEqual(btn.element.getAttribute('aria-label'), 'Pluma estilográfica');
            assert.strictEqual(btn.element.getAttribute('aria-pressed'), 'false');
            assert.strictEqual(btn.element.getAttribute('data-apolo-popover-trigger'), 'true');
            assert.ok(btn.element.classList.contains('apolo-icon-btn'));

            // Toggle active
            btn.setActive(true);
            assert.strictEqual(btn.element.getAttribute('aria-pressed'), 'true');
            assert.ok(btn.element.classList.contains('is-active'));

            // Click activation
            btn.element.dispatch({ type: 'click' });
            assert.strictEqual(clicked, true);

            // Keyboard Space activation
            clicked = false;
            btn.element.dispatch({ type: 'keydown', key: ' ' });
            assert.strictEqual(clicked, true);
        } finally {
            teardown();
        }
    });

    test('SegmentedControl: provides radiogroup semantics and toggles active item', () => {
        const { mockDoc: mockDocument, teardown } = setupMockDom(KIT_DOM_OPTS);

        try {
            let selected = 'normal';
            const seg = new SegmentedControl({
                label: 'Espaciado',
                items: [
                    { id: 'fine', label: 'Fina' },
                    { id: 'normal', label: 'Normal' },
                    { id: 'wide', label: 'Amplia' },
                ],
                value: 'normal',
                onChange: (v) => { selected = v; },
            });

            assert.strictEqual(seg.element.getAttribute('role'), 'radiogroup');
            assert.strictEqual(seg.element.getAttribute('aria-label'), 'Espaciado');
            assert.strictEqual(seg.element.children.length, 3);

            const normalBtn = seg.element.children[1];
            assert.strictEqual(normalBtn.getAttribute('aria-checked'), 'true');
            assert.ok(normalBtn.classList.contains('is-active'));

            // Change to fine
            seg.setValue('fine');
            assert.strictEqual(seg.getValue(), 'fine');
            const fineBtn = seg.element.children[0];
            assert.strictEqual(fineBtn.getAttribute('aria-checked'), 'true');
            assert.strictEqual(normalBtn.getAttribute('aria-checked'), 'false');
        } finally {
            teardown();
        }
    });

    test('ColorSwatchRow: sets radiogroup semantics and double ring active states', () => {
        const { mockDoc: mockDocument, teardown } = setupMockDom(KIT_DOM_OPTS);

        try {
            let selectedColor = '#1F4FD8';
            const swatchRow = new ColorSwatchRow({
                label: 'Color de trazo',
                swatches: [
                    { id: 'blue', color: '#1F4FD8', label: 'Azul tinta' },
                    { id: 'purple', color: '#6C3FD1', label: 'Morado enlace' },
                ],
                value: '#1F4FD8',
                allowCustomColor: true,
                onChange: (col) => { selectedColor = col; },
            });

            assert.strictEqual(swatchRow.element.getAttribute('role'), 'radiogroup');
            assert.strictEqual(swatchRow.element.children.length, 3); // 2 swatches + 1 add button

            const blueBtn = swatchRow.element.children[0];
            assert.strictEqual(blueBtn.getAttribute('aria-checked'), 'true');

            // Select purple
            swatchRow.setColor('#6C3FD1');
            assert.strictEqual(swatchRow.getColor(), '#6c3fd1');
            const purpleBtn = swatchRow.element.children[1];
            assert.strictEqual(purpleBtn.getAttribute('aria-checked'), 'true');
            assert.strictEqual(blueBtn.getAttribute('aria-checked'), 'false');
        } finally {
            teardown();
        }
    });

    test('SliderRow: updates value in-place without touching DOM structure or range input', () => {
        const { mockDoc: mockDocument, teardown } = setupMockDom(KIT_DOM_OPTS);

        try {
            let reportedVal = 2.5;
            const slider = new SliderRow({
                label: 'Grosor',
                min: 0.5,
                max: 12,
                step: 0.5,
                value: 2.5,
                unit: 'px',
                onInput: (v) => { reportedVal = v; },
            });

            const header = slider.element.children[0];
            const valEl = header.children[1];
            const inputEl = slider.element.children[1];

            assert.strictEqual(valEl.textContent, '2.5 px');
            assert.strictEqual(inputEl.tagName, 'INPUT');

            // Simulate drag: input event modifies value text in place
            inputEl.value = '5';
            inputEl.dispatch({ type: 'input' });
            assert.strictEqual(valEl.textContent, '5 px');
            assert.strictEqual(reportedVal, 5);

            // Structure is preserved
            assert.strictEqual(slider.element.children[1], inputEl, 'Input node must NEVER be replaced during dragging');
        } finally {
            teardown();
        }
    });

    test('ToggleRow: sets switch semantics and updates checked state', () => {
        const { mockDoc: mockDocument, teardown } = setupMockDom(KIT_DOM_OPTS);

        try {
            let state = false;
            const toggle = new ToggleRow({
                label: 'Solo lápiz',
                description: 'Rechazo de palma táctil',
                checked: false,
                onChange: (v) => { state = v; },
            });

            const switchBtn = toggle.element.children[1];
            assert.strictEqual(switchBtn.getAttribute('role'), 'switch');
            assert.strictEqual(switchBtn.getAttribute('aria-checked'), 'false');

            switchBtn.dispatch({ type: 'click' });
            assert.strictEqual(state, true);
            assert.strictEqual(toggle.getChecked(), true);
            assert.strictEqual(switchBtn.getAttribute('aria-checked'), 'true');
        } finally {
            teardown();
        }
    });

    test('AnchorPositioning: flips vertically and horizontally when space is constrained', () => {
        const vp = { width: 1024, height: 768 };

        // 1. Placed bottom with sufficient space
        const pos1 = calculateAnchorPosition({
            anchorRect: { left: 400, top: 50, right: 444, bottom: 94, width: 44, height: 44 },
            popoverSize: { width: 300, height: 200 },
            preferredPlacement: 'bottom',
        });
        assert.strictEqual(pos1.placement, 'bottom');
        assert.strictEqual(pos1.top, 94 + 8); // bottom + offset

        // 2. Placed bottom near screen bottom: must flip to top
        const pos2 = calculateAnchorPosition({
            anchorRect: { left: 400, top: 650, right: 444, bottom: 694, width: 44, height: 44 },
            popoverSize: { width: 300, height: 200 },
            preferredPlacement: 'bottom',
        });
        assert.strictEqual(pos2.placement, 'top', 'Must flip to top when constrained at viewport bottom');
        assert.strictEqual(pos2.top, 650 - 8 - 200); // top - offset - height

        // 3. Clamped horizontally within safe margin
        const pos3 = calculateAnchorPosition({
            anchorRect: { left: 5, top: 100, right: 49, bottom: 144, width: 44, height: 44 },
            popoverSize: { width: 400, height: 200 },
            padding: 12,
        });
        assert.ok(pos3.left >= 12, 'Left must be clamped to safe viewport padding');

        // 4. A right-corner trigger right-aligns its popover and clamps at the viewport edge
        const pos4 = calculateAnchorPosition({
            anchorRect: { left: 990, top: 100, right: 1018, bottom: 128, width: 28, height: 28 },
            popoverSize: { width: 288, height: 200 },
            preferredPlacement: 'bottom',
            horizontalAlignment: 'right',
        });
        assert.strictEqual(pos4.placement, 'bottom');
        assert.strictEqual(pos4.left, 724, 'Right-aligned popover should clamp to the viewport padding');
        assert.ok(pos4.left + 288 <= 1024 - 12, 'Popover must not overflow the viewport right edge');

        // 5. Test applyPopoverPosition
        const { mockDocument } = createMockWindowAndDoc(KIT_DOM_OPTS);
        const testEl = mockDocument.createElement('div');
        applyPopoverPosition(testEl as any, pos1);
        assert.strictEqual(testEl.style.position, 'fixed');
        assert.strictEqual(testEl.style.left, `${pos1.left}px`);
        assert.strictEqual(testEl.style.top, `${pos1.top}px`);
    });

    test('PopoverShell & PopoverController: manages stacking, trigger immunity and outside dismissal', () => {
        const { mockDoc: mockDocument, mockWindow, teardown } = setupMockDom(KIT_DOM_OPTS);

        try {
            const controller = new PopoverController();

            let closed1 = false;
            const shell1 = new PopoverShell({
                title: 'Estuche de pluma',
                icon: 'pen',
                onClose: () => { closed1 = true; shell1.hide(); },
            });

            let closed2 = false;
            const shell2 = new PopoverShell({
                title: 'Menú de opciones',
                onClose: () => { closed2 = true; shell2.hide(); },
            });

            const trigger1 = mockDocument.createElement('button');
            trigger1.setAttribute('data-apolo-popover-trigger', 'true');

            // Open popover 1
            shell1.show();
            controller.open(shell1, trigger1 as any);
            assert.strictEqual(controller.isOpen(shell1), true);
            assert.strictEqual(controller.isAnyOpen(), true);

            // Open popover 2 on top
            shell2.show();
            controller.open(shell2, null);
            assert.strictEqual(controller.isOpen(shell2), true);

            // Escape key closes topmost popover (shell2)
            mockWindow.dispatch('keydown', {
                key: 'Escape',
                preventDefault: () => {},
                stopPropagation: () => {},
            });
            assert.strictEqual(shell2.isOpen(), false, 'Top popover must close on Escape');
            assert.strictEqual(shell1.isOpen(), true, 'Bottom popover remains open');

            // Click on trigger1 does NOT close shell1
            mockWindow.dispatch('pointerdown', {
                target: trigger1,
            });
            assert.strictEqual(shell1.isOpen(), true, 'Clicking trigger element must not dismiss popover');

            // Secondary pointer (isPrimary: false, e.g. pinch gesture / palm contact) does NOT dismiss popover
            const outsideEl = mockDocument.createElement('div');
            mockWindow.dispatch('pointerdown', {
                target: outsideEl,
                isPrimary: false,
            });
            assert.strictEqual(shell1.isOpen(), true, 'Non-primary pointerdown (palm/pinch) must not dismiss popover');

            // Primary click outside shell1 dismisses it
            mockWindow.dispatch('pointerdown', {
                target: outsideEl,
                isPrimary: true,
            });
            assert.strictEqual(shell1.isOpen(), false, 'Primary outside click must dismiss popover');
            assert.strictEqual(controller.isAnyOpen(), false);

            controller.destroy();
            shell1.destroy();
            shell2.destroy();
        } finally {
            teardown();
        }
    });

    test('AnchorPositioning: Galaxy Tab S10 landscape viewport simulation with visualViewport and virtual keyboard', () => {
        const { mockWindow, teardown } = setupMockDom(KIT_DOM_OPTS);

        try {
            // Galaxy Tab S10 standard landscape CSS viewport
            mockWindow.innerWidth = 1133;
            mockWindow.innerHeight = 755;
            mockWindow.visualViewport = {
                width: 1133,
                height: 755,
                offsetLeft: 0,
                offsetTop: 0,
            } as any;

            // 1. Bottom toolbar in landscape: anchor near screen bottom (top: 700, height: 44)
            // Popover: width 320, height: 240. Preferred placement: bottom.
            const bottomPos = calculateAnchorPosition({
                anchorRect: { left: 500, top: 700, right: 544, bottom: 744, width: 44, height: 44 },
                popoverSize: { width: 320, height: 240 },
                preferredPlacement: 'bottom',
                offset: 8,
                padding: 12,
            });
            // There are only 11px below (755 - 744), so it MUST flip to top
            assert.strictEqual(bottomPos.placement, 'top', 'Must flip to top when anchored at tablet bottom edge');
            assert.strictEqual(bottomPos.top, 700 - 8 - 240); // 452
            // Horizontally centered on anchor (500 + 22 - 160 = 362)
            assert.strictEqual(bottomPos.left, 362);

            // 2. Right-side docked toolbar (Galaxy Tab S10 side palette): anchor near right edge
            // anchor at left: 1080, width: 44, right: 1124. Popover width: 280.
            const sidePos = calculateAnchorPosition({
                anchorRect: { left: 1080, top: 300, right: 1124, bottom: 344, width: 44, height: 44 },
                popoverSize: { width: 280, height: 200 },
                preferredPlacement: 'right',
                offset: 8,
                padding: 12,
            });
            // Only 9px to the right of anchor (1133 - 1124), must flip to left
            assert.strictEqual(sidePos.placement, 'left', 'Must flip to left when anchored near right bezel');
            assert.strictEqual(sidePos.left, 1080 - 8 - 280); // 792

            // 3. Samsung Virtual Keyboard open: visualViewport shrinks to height: 380
            mockWindow.visualViewport = {
                width: 1133,
                height: 380,
                offsetLeft: 0,
                offsetTop: 0,
            } as any;

            // Anchor at top: 320, height: 44, bottom: 364
            const keyboardPos = calculateAnchorPosition({
                anchorRect: { left: 500, top: 320, right: 544, bottom: 364, width: 44, height: 44 },
                popoverSize: { width: 320, height: 220 },
                preferredPlacement: 'bottom',
                offset: 8,
                padding: 12,
            });
            // In visual viewport, space below is 380 - (364 + 8) = 8px < 220px. Must flip to top!
            assert.strictEqual(keyboardPos.placement, 'top', 'Must flip to top above virtual keyboard');
            // Clamped within visualViewport safe area (maxTop: 380 - 220 - 12 = 148, calculated: 320 - 8 - 220 = 92)
            assert.strictEqual(keyboardPos.top, 92);
            assert.ok(keyboardPos.top >= 12, 'Top must respect visualViewport padding');
            assert.ok(keyboardPos.top + 220 <= 380 - 12, 'Popover must fit within visible visualViewport with keyboard');

            // 4. Clamping against left tablet bezel (left: 4px)
            const edgePos = calculateAnchorPosition({
                anchorRect: { left: 4, top: 50, right: 48, bottom: 94, width: 44, height: 44 },
                popoverSize: { width: 300, height: 180 },
                preferredPlacement: 'bottom',
                offset: 8,
                padding: 12,
            });
            assert.strictEqual(edgePos.left, 12, 'Left must be clamped to safe area padding 12px from bezel');
        } finally {
            teardown();
        }
    });
});
