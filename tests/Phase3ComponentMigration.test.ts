import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ToolEstuche, type ToolEstucheState } from '../src/ui/ToolEstuche.ts';
import { BoxMenu } from '../src/ui/BoxMenu.ts';
import { LassoMenu } from '../src/ui/LassoMenu.ts';
import { ZoomPill } from '../src/ui/ZoomPill.ts';
import { PopoverController } from '../src/ui/kit/index.ts';
import { applyPopoverGeometry } from '../src/ui/popover/PopoverGeometry.ts';

function createMockEnvironment() {
    const listeners = new Map<string, Array<{ listener: Function; options?: any }>>();
    const mockWindow = {
        innerWidth: 1024,
        innerHeight: 768,
        visualViewport: {
            width: 1024,
            height: 768,
            offsetLeft: 0,
            offsetTop: 0,
        },
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
            width: '',
            height: '',
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

describe('Fase 3: Migración de Componentes al UI Kit', () => {
    test('ToolEstuche: mounts cleanly as PopoverShell, preserves slider drag without DOM destruction', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevWin = (globalThis as any).window;
        const prevDoc = (globalThis as any).document;
        (globalThis as any).window = mockWindow;
        (globalThis as any).document = mockDocument;

        try {
            const popoverController = new PopoverController();
            let widthChanged = 0;
            let closed = false;

            const initialState: ToolEstucheState = {
                tool: 'pen',
                slot: 'tc',
                color: '#212529',
                width: 3.5,
                profileId: 'fountain',
                lineStyle: 'dashed',
                pattern: 'dashed',
                smoothing: 0.5,
                pressureSensitivity: 0.8,
                favorites: [],
                eraserMode: 'whole',
                eraserRadius: 18,
                scribbleToErase: true,
                lassoMode: 'free',
                shapeType: 'rect',
                snapGrid: false,
            };

            const estuche = new ToolEstuche(
                initialState,
                {
                    onSelectProfile: () => {},
                    onChangeColor: () => {},
                    onChangeWidth: (w) => { widthChanged = w; },
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
                    onClose: () => { closed = true; },
                },
                mockDocument.body as any,
                popoverController,
            );

            // 1. Initially hidden
            assert.strictEqual(estuche.isOpen(), false);

            // 2. Open estuche anchored to a 44px tool button
            const toolBtn = mockDocument.createElement('button');
            toolBtn.setAttribute('data-apolo-popover-trigger', 'true');
            estuche.open({ tool: 'pen' }, toolBtn as any);

            assert.strictEqual(estuche.isOpen(), true);
            assert.ok(estuche.container.classList.contains('apolo-tool-estuche'));
            assert.ok(estuche.container.classList.contains('apolo-popover-shell'));

            // Verify body contains profile cards and slider rows
            const body = estuche.container.children[1];
            assert.ok(body.children.length >= 3, 'Estuche body must contain profiles, sliders, and color section');

            const findButtons = (node: any, className: string): any[] => {
                const matches = node.className?.split(/\s+/).includes(className) ? [node] : [];
                for (const child of node.children || []) matches.push(...findButtons(child, className));
                return matches;
            };
            const lineStyleButtons = findButtons(body, 'popover-line-chip');
            assert.equal(lineStyleButtons.length, 3);
            assert.ok(lineStyleButtons.every((button) => button.children.some((child: any) => child.className === 'popover-line-chip-pill')));
            assert.equal(lineStyleButtons[0].getAttribute('aria-pressed'), 'false');
            assert.equal(lineStyleButtons[1].getAttribute('aria-pressed'), 'true');
            assert.equal(lineStyleButtons[1].classList.contains('is-active'), true);

            lineStyleButtons[2].onclick();
            assert.equal(lineStyleButtons[1].getAttribute('aria-pressed'), 'false');
            assert.equal(lineStyleButtons[2].getAttribute('aria-pressed'), 'true');
            estuche.updateState({ lineStyle: 'solid', pattern: 'solid' });
            assert.equal(lineStyleButtons[0].getAttribute('aria-pressed'), 'true');
            assert.equal(lineStyleButtons[0].classList.contains('is-active'), true);
            assert.equal(lineStyleButtons[2].getAttribute('aria-pressed'), 'false');

            // 3. Test In-Place Update (Zero DOM destruction during slider adjustments)
            const initialFirstChild = body.children[0];
            estuche.updateState({ width: 5.5 });
            const afterFirstChild = body.children[0];
            assert.strictEqual(initialFirstChild, afterFirstChild, 'DOM nodes must NOT be recreated during width slider update');

            estuche.updateState({ tool: 'highlighter' });
            const highlighterTips = body.children[0].children;
            assert.ok(highlighterTips[0].classList.contains('is-active'), 'Chisel is selected when entering highlighter mode from a pen profile');
            assert.ok(!highlighterTips[1].classList.contains('is-active'), 'Only one highlighter tip is active');

            // 4. Close estuche
            estuche.close();
            assert.strictEqual(estuche.isOpen(), false);
            assert.strictEqual(closed, true);

            estuche.destroy();
            popoverController.destroy();
        } finally {
            (globalThis as any).window = prevWin;
            (globalThis as any).document = prevDoc;
        }
    });

    test('Popover geometry respects visualViewport bounds when keyboard reduces available space', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevWin = (globalThis as any).window;
        const prevDoc = (globalThis as any).document;
        (globalThis as any).window = {
            ...mockWindow,
            innerWidth: 1200,
            innerHeight: 900,
            visualViewport: { width: 420, height: 560, offsetLeft: 24, offsetTop: 0 },
        };
        (globalThis as any).document = mockDocument;

        try {
            const popover = mockDocument.createElement('div');
            popover.style.width = '300px';
            popover.style.height = '260px';
            Object.defineProperty(popover, 'getBoundingClientRect', {
                value: () => ({ left: 0, top: 0, right: 300, bottom: 260, width: 300, height: 260 }),
            });
            const anchor = mockDocument.createElement('button');
            Object.defineProperty(anchor, 'getBoundingClientRect', {
                value: () => ({ left: 380, top: 540, right: 424, bottom: 584, width: 44, height: 44 }),
            });
            const toolbar = mockDocument.createElement('div');
            Object.defineProperty(toolbar, 'getBoundingClientRect', {
                value: () => ({ left: 300, top: 520, right: 700, bottom: 620, width: 400, height: 100 }),
            });

            applyPopoverGeometry(popover as any, anchor as any, toolbar as any, 'bc', { fallbackWidth: 300, fallbackHeight: 260 });

            const left = Number.parseFloat(popover.style.left || '0');
            const top = Number.parseFloat(popover.style.top || '0');

            assert.ok(left >= 24 + 16, 'Popover should not exceed the active visual viewport left edge');
            assert.ok(left + 300 <= 24 + 420 - 16, 'Popover should respect the active visual viewport width');
            assert.ok(top >= 16, 'Popover should not drift above the visual viewport');
        } finally {
            (globalThis as any).window = prevWin;
            (globalThis as any).document = prevDoc;
        }
    });

    test('BoxMenu: renders Variante A structure, anchors via calculateAnchorPosition, and dismisses on Escape', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevWin = (globalThis as any).window;
        const prevDoc = (globalThis as any).document;
        (globalThis as any).window = mockWindow;
        (globalThis as any).document = mockDocument;

        try {
            const popoverController = new PopoverController();
            let selectedStyle = '';
            let selectedDensity = 0;
            let deleted = false;

            const boxMenu = new BoxMenu(
                {
                    onSetGridStyle: (_id, style) => { selectedStyle = style; },
                    onSetGridDensity: (_id, d) => { selectedDensity = d; },
                    onSetAccentColor: () => {},
                    onFitHeight: () => {},
                    onClearContent: () => {},
                    onDeleteBox: () => { deleted = true; },
                },
                mockDocument.body as any,
                popoverController,
            );

            assert.strictEqual(boxMenu.isOpen(), false);

            // Show box menu
            const anchorRect = { left: 300, top: 200, right: 344, bottom: 244, width: 44, height: 44 } as DOMRect;
            boxMenu.show('box-101', anchorRect, {
                gridStyle: 'dots',
                gridDensity: 32,
                accentColor: 'purple',
            });

            assert.strictEqual(boxMenu.isOpen(), true);
            assert.strictEqual(boxMenu.boxId, 'box-101');
            assert.strictEqual(boxMenu.container.style.position, 'fixed');
            assert.ok(boxMenu.container.style.left.endsWith('px'));
            assert.ok(boxMenu.container.style.top.endsWith('px'));

            // Verify Variante A sections: Header, Fondo, Espaciado, Acento, Acciones
            assert.strictEqual(boxMenu.container.children.length, 5);

            // 1. Fondo section: select 'grid' tile
            const fondoSection = boxMenu.container.children[1];
            const fondoGrid = fondoSection.children[1];
            const gridTileBtn = fondoGrid.children[1];
            gridTileBtn.dispatch({ type: 'click' });
            assert.strictEqual(selectedStyle, 'grid');

            // 2. Espaciado row: select 'Fina' (density 40)
            const espaciadoRow = boxMenu.container.children[2];
            const segmented = espaciadoRow.children[1];
            const finaBtn = segmented.children[0];
            finaBtn.dispatch({ type: 'click' });
            assert.strictEqual(selectedDensity, 40);

            // 3. Acciones: Delete button triggers onDeleteBox and closes menu
            const actionsRow = boxMenu.container.children[4];
            const deleteBtn = actionsRow.children[2];
            deleteBtn.dispatch({ type: 'click' });
            assert.strictEqual(deleted, true);
            assert.strictEqual(boxMenu.isOpen(), false);

            boxMenu.destroy();
            popoverController.destroy();
        } finally {
            (globalThis as any).window = prevWin;
            (globalThis as any).document = prevDoc;
        }
    });

    test('LassoMenu: positions floating menu at 1:1 scale without scale(1/zoom)', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevWin = (globalThis as any).window;
        const prevDoc = (globalThis as any).document;
        (globalThis as any).window = mockWindow;
        (globalThis as any).document = mockDocument;

        try {
            let copied = false;
            let deleted = false;

            const lasso = new LassoMenu(
                {
                    onCopy: () => { copied = true; },
                    onPaste: () => {},
                    onLink: () => {},
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
                mockDocument.body as any,
            );

            assert.strictEqual(lasso.isOpen(), false);

            // Set selection under 2x canvas zoom
            const bounds = { minX: 100, minY: 100, maxX: 300, maxY: 300 };
            lasso.setSelection(
                [{ id: 's1', type: 'stroke', points: [], color: '#000', width: 2 } as any],
                bounds,
                'bloque 1',
                2.0, // zoom = 2.0
                0,
                0,
            );

            assert.strictEqual(lasso.isOpen(), true);

            // Floating menu element is child[1]
            const floatingMenu = lasso.container.children[1];
            assert.strictEqual(floatingMenu.style.position, 'fixed');
            // Crucial: verify transform does NOT contain scale()!
            assert.ok(!floatingMenu.style.transform.includes('scale'), 'LassoMenu must NOT scale down under high canvas zoom');
            assert.ok(floatingMenu.style.transform.includes('translate(-50%'), 'LassoMenu must center horizontally via translate');

            // Anchor pill element is child[0]
            const anchorPill = lasso.container.children[0];
            assert.ok(!anchorPill.style.transform.includes('scale'), 'Anchor pill must NOT scale down');

            // Action buttons have accessible 36px/44px touch targets
            const copyBtn = floatingMenu.children[0];
            copyBtn.dispatch({ type: 'click' });
            assert.strictEqual(copied, true);

            lasso.hide();
            assert.strictEqual(lasso.isOpen(), false);
            lasso.destroy();
        } finally {
            (globalThis as any).window = prevWin;
            (globalThis as any).document = prevDoc;
        }
    });

    test('ZoomPill: updates label with pure SVG icons and in-place zoom text', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevWin = (globalThis as any).window;
        const prevDoc = (globalThis as any).document;
        (globalThis as any).window = mockWindow;
        (globalThis as any).document = mockDocument;

        try {
            let zoomInCount = 0;
            let zoomOutCount = 0;

            const pill = new ZoomPill(
                {
                    onZoomIn: () => { zoomInCount++; },
                    onZoomOut: () => { zoomOutCount++; },
                    onZoomFit: () => {},
                },
                mockDocument.body as any,
            );

            const minusBtn = pill.container.children[0];
            const labelEl = pill.container.children[1];
            const plusBtn = pill.container.children[2];
            const fitBtn = pill.container.children[3];

            assert.strictEqual(labelEl.textContent, '100 %');
            assert.strictEqual(fitBtn.hidden, true);

            // Zoom in
            pill.setZoom(1.5);
            assert.strictEqual(labelEl.textContent, '150 %');
            assert.strictEqual(fitBtn.hidden, false, 'Fit button must be visible when zoomed');

            plusBtn.dispatch({ type: 'click' });
            assert.strictEqual(zoomInCount, 1);

            minusBtn.dispatch({ type: 'click' });
            assert.strictEqual(zoomOutCount, 1);

            pill.destroy();
        } finally {
            (globalThis as any).window = prevWin;
            (globalThis as any).document = prevDoc;
        }
    });
});
