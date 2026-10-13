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

function createMockEnvironment() {
    const listeners = new Map<string, Array<{ listener: Function; options?: any }>>();
    const mockWindow = {
        innerWidth: 1024,
        innerHeight: 768,
        visualViewport: null,
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
    };

    const createElement = (tag: string) => {
        const children: any[] = [];
        const classes = new Set<string>();
        const attributes = new Map<string, string>();
        const elementListeners = new Map<string, Function[]>();
        const styleObj: any = {
            display: '',
            zIndex: '',
            position: '',
            left: '',
            top: '',
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
            classList: {
                add: (c: string) => { classes.add(c); el.className = [...classes].join(' '); },
                remove: (c: string) => { classes.delete(c); el.className = [...classes].join(' '); },
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
            getBoundingClientRect: () => ({ left: 100, top: 100, right: 200, bottom: 144, width: 100, height: 44 }),
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

describe('Fase 2: UI Kit Primitives & Popover System', () => {
    test('Icon: createSvgIcon creates pure DOM SVG elements with correct attributes and zero innerHTML', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevDoc = (globalThis as any).document;
        (globalThis as any).document = mockDocument;

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
            (globalThis as any).document = prevDoc;
        }
    });

    test('IconButton: renders 44px touch target, sets ARIA attributes and handles keyboard activation', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevDoc = (globalThis as any).document;
        (globalThis as any).document = mockDocument;

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
            (globalThis as any).document = prevDoc;
        }
    });

    test('SegmentedControl: provides radiogroup semantics and toggles active item', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevDoc = (globalThis as any).document;
        (globalThis as any).document = mockDocument;

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
            (globalThis as any).document = prevDoc;
        }
    });

    test('ColorSwatchRow: sets radiogroup semantics and double ring active states', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevDoc = (globalThis as any).document;
        (globalThis as any).document = mockDocument;

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
            (globalThis as any).document = prevDoc;
        }
    });

    test('SliderRow: updates value in-place without touching DOM structure or range input', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevDoc = (globalThis as any).document;
        (globalThis as any).document = mockDocument;

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
            (globalThis as any).document = prevDoc;
        }
    });

    test('ToggleRow: sets switch semantics and updates checked state', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevDoc = (globalThis as any).document;
        (globalThis as any).document = mockDocument;

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
            (globalThis as any).document = prevDoc;
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

        // 4. Test applyPopoverPosition
        const { mockDocument } = createMockEnvironment();
        const testEl = mockDocument.createElement('div');
        applyPopoverPosition(testEl as any, pos1);
        assert.strictEqual(testEl.style.position, 'fixed');
        assert.strictEqual(testEl.style.left, `${pos1.left}px`);
        assert.strictEqual(testEl.style.top, `${pos1.top}px`);
    });

    test('PopoverShell & PopoverController: manages stacking, trigger immunity and outside dismissal', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevWin = (globalThis as any).window;
        const prevDoc = (globalThis as any).document;
        (globalThis as any).window = mockWindow;
        (globalThis as any).document = mockDocument;

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

            // Click outside shell1 dismisses it
            const outsideEl = mockDocument.createElement('div');
            mockWindow.dispatch('pointerdown', {
                target: outsideEl,
            });
            assert.strictEqual(shell1.isOpen(), false, 'Outside click must dismiss popover');
            assert.strictEqual(controller.isAnyOpen(), false);

            controller.destroy();
            shell1.destroy();
            shell2.destroy();
        } finally {
            (globalThis as any).window = prevWin;
            (globalThis as any).document = prevDoc;
        }
    });
});
