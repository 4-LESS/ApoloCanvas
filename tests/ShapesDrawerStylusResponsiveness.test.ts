import { test, describe } from 'node:test';
import assert from 'node:assert';
import { setupMockDom } from './helpers/mockDom.ts';
import { bindTapOrClick } from '../src/ui/theme.ts';
import { ToolEstuche } from '../src/ui/ToolEstuche.ts';
import { SliderControl } from '../src/ui/kit/SliderControl.ts';

describe('Shapes Drawer Stylus Responsiveness & Tap/Click Normalization', () => {
    test('bindTapOrClick executes on stylus pointerup without requiring synthetic click', () => {
        setupMockDom();
        const btn = document.createElement('button');
        let callCount = 0;

        bindTapOrClick(btn, () => {
            callCount++;
        });

        // 1. Simulate Stylus contact: pointerdown followed by pointerup with slight jitter (1px)
        btn.dispatchEvent({
            type: 'pointerdown',
            pointerType: 'pen',
            button: 0,
            clientX: 100,
            clientY: 200,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        btn.dispatchEvent({
            type: 'pointerup',
            pointerType: 'pen',
            button: 0,
            clientX: 101,
            clientY: 200,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        assert.strictEqual(callCount, 1, 'Action should fire on stylus pointerup');

        // 2. Simulate subsequent synthetic click event emitted by browser
        btn.dispatchEvent({
            type: 'click',
            clientX: 101,
            clientY: 200,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        assert.strictEqual(callCount, 1, 'Action should NOT fire twice for deduplicated click');
    });

    test('bindTapOrClick ignores stylus pointerup if intentional swipe/drag exceeds slop threshold', () => {
        setupMockDom();
        const btn = document.createElement('button');
        let callCount = 0;

        bindTapOrClick(btn, () => {
            callCount++;
        });

        btn.dispatchEvent({
            type: 'pointerdown',
            pointerType: 'pen',
            button: 0,
            clientX: 50,
            clientY: 50,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        // Moved 40px away (scroll / drag)
        btn.dispatchEvent({
            type: 'pointerup',
            pointerType: 'pen',
            button: 0,
            clientX: 90,
            clientY: 50,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        assert.strictEqual(callCount, 0, 'Swipe/drag should be rejected as a tap');
    });

    test('bindTapOrClick works for direct desktop click events', () => {
        setupMockDom();
        const btn = document.createElement('button');
        let callCount = 0;

        bindTapOrClick(btn, () => {
            callCount++;
        });

        btn.click();
        assert.strictEqual(callCount, 1, 'Direct click should execute');
    });

    test('SliderControl minus and plus buttons respond to stylus pointer taps', () => {
        setupMockDom();
        let changedVal = 0;
        const slider = new SliderControl({
            min: 1,
            max: 10,
            step: 1,
            value: 5,
            onChange: (val) => {
                changedVal = val;
            },
        });

        const stepButtons = slider.element.querySelectorAll('button.st') as HTMLElement[];
        assert.strictEqual(stepButtons.length, 2, 'Minus and plus step buttons should exist');
        const minusBtn = stepButtons[0];
        const plusBtn = stepButtons[1];
        assert.ok(plusBtn, 'Plus button should exist');
        assert.strictEqual(plusBtn.style.touchAction, 'manipulation');

        // Simulate Stylus tap on plus button
        plusBtn.dispatchEvent({
            type: 'pointerdown',
            pointerType: 'pen',
            button: 0,
            clientX: 10,
            clientY: 10,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        plusBtn.dispatchEvent({
            type: 'pointerup',
            pointerType: 'pen',
            button: 0,
            clientX: 11,
            clientY: 10,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        assert.strictEqual(slider.getValue(), 6, 'Slider value should increment to 6');
        assert.strictEqual(changedVal, 6);

        assert.ok(minusBtn, 'Minus button should exist');
        assert.strictEqual(minusBtn.style.touchAction, 'manipulation');

        minusBtn.dispatchEvent({
            type: 'pointerdown',
            pointerType: 'pen',
            button: 0,
            clientX: 5,
            clientY: 5,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        minusBtn.dispatchEvent({
            type: 'pointerup',
            pointerType: 'pen',
            button: 0,
            clientX: 5,
            clientY: 6,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        assert.strictEqual(slider.getValue(), 5, 'Slider value should decrement to 5');
    });

    test('ToolEstuche shapes drawer buttons and controls respond to stylus taps', () => {
        setupMockDom();
        const parent = document.createElement('div');
        let selectedShape = '';
        let regularizeState = false;
        let selectedLineStyle = '';
        let fillPatternState = '';

        const estuche = new ToolEstuche(
            {
                tool: 'shape',
                slot: 'top',
                color: '#2f6bff',
                width: 2,
                profileId: 'pen-round' as any,
                smoothing: 0.5,
                pressureSensitivity: 0.5,
                shapeType: 'rect',
                regularize: false,
                lineStyle: 'solid',
                pattern: 'solid',
                fillEnabled: false,
            },
            {
                onSelectProfile: () => {},
                onChangeColor: () => {},
                onChangeWidth: () => {},
                onChangeSmoothing: () => {},
                onChangePressure: () => {},
                onSelectEraserMode: () => {},
                onChangeEraserRadius: () => {},
                onSelectLassoMode: () => {},
                onSelectShapeType: (st) => {
                    selectedShape = st;
                },
                onToggleRegularize: (enabled) => {
                    regularizeState = enabled;
                },
                onChangeLineStyle: (pat) => {
                    selectedLineStyle = pat;
                },
                onChangeFillPattern: (pat) => {
                    fillPatternState = pat;
                },
            },
            parent
        );

        estuche.open();

        // 1. Verify shapes carousel and pager exist
        const car = estuche.container.querySelector('.shape-carousel') as HTMLElement;
        assert.ok(car, 'Shapes carousel should exist');
        const pager = estuche.container.querySelector('.shape-pager') as HTMLElement;
        assert.ok(pager, 'Pager should exist for multi-page shapes');

        // 2. Select shape with stylus tap (e.g. circle / ellipse)
        const ellipseBtn = estuche.container.querySelector('button[data-s="ellipse"]') as HTMLElement;
        assert.ok(ellipseBtn, 'Ellipse shape button should exist');
        assert.strictEqual(ellipseBtn.style.touchAction, 'manipulation');

        ellipseBtn.dispatchEvent({
            type: 'pointerdown',
            pointerType: 'pen',
            button: 0,
            clientX: 20,
            clientY: 20,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        ellipseBtn.dispatchEvent({
            type: 'pointerup',
            pointerType: 'pen',
            button: 0,
            clientX: 21,
            clientY: 20,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        assert.strictEqual(selectedShape, 'ellipse', 'Stylus tap should select ellipse shape');

        // 3. Toggle 1:1 perfect ratio button with stylus tap
        const ratioBtn = estuche.container.querySelector('button[data-tb="ratio"]') as HTMLElement;
        assert.ok(ratioBtn, 'Ratio 1:1 button should exist');
        assert.strictEqual(ratioBtn.style.touchAction, 'manipulation');

        ratioBtn.dispatchEvent({
            type: 'pointerdown',
            pointerType: 'pen',
            button: 0,
            clientX: 30,
            clientY: 30,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        ratioBtn.dispatchEvent({
            type: 'pointerup',
            pointerType: 'pen',
            button: 0,
            clientX: 30,
            clientY: 31,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        assert.strictEqual(regularizeState, true, 'Stylus tap should toggle regularize 1:1');

        // 4. Open line drawer with stylus tap on lineBtn
        const lineBtn = estuche.container.querySelector('button[data-tb="line"]') as HTMLElement;
        assert.ok(lineBtn, 'Line drawer button should exist');

        lineBtn.dispatchEvent({
            type: 'pointerdown',
            pointerType: 'pen',
            button: 0,
            clientX: 40,
            clientY: 40,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        lineBtn.dispatchEvent({
            type: 'pointerup',
            pointerType: 'pen',
            button: 0,
            clientX: 41,
            clientY: 40,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        const lineTray = estuche.container.querySelector('[data-t="line"]') as HTMLElement;
        assert.ok(lineTray, 'Line tray should exist');
        assert.ok(lineTray.classList.contains('is-open'), 'Line tray should be open after stylus tap');
        assert.strictEqual(lineTray.hidden, false, 'Open line tray is visible');

        // 5. Select dashed line style chip with stylus tap
        const dashedChip = lineTray.querySelectorAll('button.line-chip')[1] as HTMLElement;
        assert.ok(dashedChip, 'Dashed line chip should exist');

        dashedChip.dispatchEvent({
            type: 'pointerdown',
            pointerType: 'pen',
            button: 0,
            clientX: 50,
            clientY: 50,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        dashedChip.dispatchEvent({
            type: 'pointerup',
            pointerType: 'pen',
            button: 0,
            clientX: 50,
            clientY: 50,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        assert.strictEqual(selectedLineStyle, 'dashed', 'Stylus tap should select dashed line style');

        // 6. Open fill drawer and select hachure pattern with stylus tap
        const fillBtn = estuche.container.querySelector('button[data-tb="fill"]') as HTMLElement;
        assert.ok(fillBtn, 'Fill drawer button should exist');

        fillBtn.dispatchEvent({
            type: 'pointerdown',
            pointerType: 'pen',
            button: 0,
            clientX: 60,
            clientY: 60,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        fillBtn.dispatchEvent({
            type: 'pointerup',
            pointerType: 'pen',
            button: 0,
            clientX: 60,
            clientY: 60,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        const fillTray = estuche.container.querySelector('[data-t="fill"]') as HTMLElement;
        assert.ok(fillTray, 'Fill tray should exist');
        assert.ok(fillTray.classList.contains('is-open'), 'Fill tray should be open after stylus tap');

        const hachureChip = fillTray.querySelectorAll('button.fill-chip')[2] as HTMLElement;
        assert.ok(hachureChip, 'Hachure fill chip should exist');

        hachureChip.dispatchEvent({
            type: 'pointerdown',
            pointerType: 'pen',
            button: 0,
            clientX: 70,
            clientY: 70,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        hachureChip.dispatchEvent({
            type: 'pointerup',
            pointerType: 'pen',
            button: 0,
            clientX: 70,
            clientY: 71,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        assert.strictEqual(fillPatternState, 'hachure', 'Stylus tap should select hachure pattern');

        // 7. Verify width slider is attached directly to body and NOT nested in .slider-row
        const widthSliderEl = estuche.container.querySelector('.sl.shape-width-row') as HTMLElement;
        assert.ok(widthSliderEl, 'Width slider with .shape-width-row class should exist');
        assert.strictEqual(
            widthSliderEl.parentElement?.classList.contains('apolo-popover-body'),
            true,
            'Width slider must be a direct child of bodyEl, not cramped into .slider-row'
        );
        assert.strictEqual(
            estuche.container.querySelector('.slider-row.shape-width-row'),
            null,
            '.slider-row wrapper must not exist around width slider'
        );

        estuche.destroy();
    });

    test('SliderControl step percentage correctly covers entire track across fractional steps (1–12, step 0.5)', () => {
        setupMockDom();
        const slider = new SliderControl({
            min: 1,
            max: 12,
            step: 0.5,
            value: 1,
        });

        const thumb = slider.element.querySelector('.th') as HTMLElement;
        assert.ok(thumb, 'Thumb must exist');

        // At min (1): ~2.17% (first cell center)
        const leftMin = parseFloat(thumb.style.left);
        assert.ok(leftMin >= 0 && leftMin < 5, `Min value thumb should be near 2%, got ${leftMin}%`);

        // At midpoint (6.5): 50%
        slider.setValue(6.5, false);
        const leftMid = parseFloat(thumb.style.left);
        assert.strictEqual(Math.round(leftMid), 50, `Mid value thumb should be 50%, got ${leftMid}%`);

        // At max (12): ~97.8% (last cell center, NOT stuck at 50%)
        slider.setValue(12, false);
        const leftMax = parseFloat(thumb.style.left);
        assert.ok(leftMax > 90, `Max value thumb should be near 98%, got ${leftMax}%`);
    });

    test('Shape carousel distinguishes horizontal swipe from tap on shapes', () => {
        setupMockDom();
        const parent = document.createElement('div');
        let selectedShape = '';

        const estuche = new ToolEstuche(
            {
                tool: 'shape',
                slot: 'top',
                color: '#2f6bff',
                width: 2,
                shapeType: 'rect',
            },
            {
                onSelectProfile: () => {},
                onChangeColor: () => {},
                onChangeWidth: () => {},
                onChangeSmoothing: () => {},
                onChangePressure: () => {},
                onSelectEraserMode: () => {},
                onChangeEraserRadius: () => {},
                onSelectLassoMode: () => {},
                onSelectShapeType: (st) => {
                    selectedShape = st;
                },
            },
            parent
        );
        estuche.open();

        const arrowBtn = estuche.container.querySelector('button[data-s="arrow"]') as HTMLElement;
        assert.ok(arrowBtn, 'Arrow button should exist');

        // 1. Simulate horizontal swipe across the arrow button (>24px)
        arrowBtn.dispatchEvent({
            type: 'pointerdown',
            pointerType: 'pen',
            button: 0,
            clientX: 100,
            clientY: 50,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        arrowBtn.dispatchEvent({
            type: 'pointermove',
            pointerType: 'pen',
            clientX: 60, // 40px drag
            clientY: 50,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        arrowBtn.dispatchEvent({
            type: 'pointerup',
            pointerType: 'pen',
            button: 0,
            clientX: 60,
            clientY: 50,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        assert.strictEqual(selectedShape, '', 'Horizontal swipe should NOT trigger shape selection');

        // 2. Simulate clean tap on the arrow button (1px jitter)
        arrowBtn.dispatchEvent({
            type: 'pointerdown',
            pointerType: 'pen',
            button: 0,
            clientX: 100,
            clientY: 50,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        arrowBtn.dispatchEvent({
            type: 'pointerup',
            pointerType: 'pen',
            button: 0,
            clientX: 101,
            clientY: 51,
            preventDefault: () => {},
            stopPropagation: () => {},
        });

        assert.strictEqual(selectedShape, 'arrow', 'Clean stylus tap should select arrow shape');

        estuche.destroy();
    });

    test('Vertical positioning anchors lower-half elements to bottom, extending upwards towards center without jumping', () => {
        setupMockDom();
        (globalThis as any).window = {
            innerWidth: 1280,
            innerHeight: 800,
            visualViewport: {
                width: 1280,
                height: 800,
                offsetLeft: 0,
                offsetTop: 0,
            },
        };

        const anchor = document.createElement('button');
        anchor.getBoundingClientRect = () => ({
            top: 540,
            bottom: 580,
            left: 20,
            right: 60,
            width: 40,
            height: 40,
        } as any);

        const estuche = new ToolEstuche(
            {
                tool: 'shape',
                shapeType: 'rectangle',
                color: '#2f6bff',
                width: 3,
                slot: 'ml',
            },
            {
                onSelectShapeType: () => {},
                onChangeWidth: () => {},
                onChangeSmoothing: () => {},
                onChangePressure: () => {},
                onUseFavorite: () => {},
                onSaveFavorite: () => {},
                onSelectEraserMode: () => {},
                onChangeEraserRadius: () => {},
                onToggleScribble: () => {},
                onSelectLassoMode: () => {},
                onToggleSnapGrid: () => {},
            }
        );

        // Mock base closed dimensions for container
        estuche.container.getBoundingClientRect = () => ({
            top: 0,
            bottom: 352,
            left: 0,
            right: 330,
            width: 330,
            height: 352,
        } as any);

        estuche.open(undefined, anchor);

        // In lower half of screen (anchorCenterY = 560 >= vpCenterY = 400):
        // Global rule: anchors to bottom, top is 'auto'
        assert.strictEqual(estuche.container.style.top, 'auto', 'Top is auto when bottom-anchored');
        const initialBottom = parseFloat(estuche.container.style.bottom);
        assert.ok(!isNaN(initialBottom), 'Bottom coordinate must be set');
        assert.ok(initialBottom >= 16, 'Bottom coordinate respects viewport margin');

        // Tap Relleno button to expand tray
        const tap = (el: any) => {
            const ev = (type: string) => ({ type, button: 0, pointerType: 'pen', clientX: 1, clientY: 1, preventDefault: () => {}, stopPropagation: () => {} });
            el.dispatchEvent(ev('pointerdown'));
            el.dispatchEvent(ev('pointerup'));
        };

        const fillBtn = estuche.container.querySelector('button[data-tb="fill"]') as HTMLElement;
        assert.ok(fillBtn, 'Fill trigger button must exist');
        tap(fillBtn);

        // The bottom remains 100% stationary! No jumpiness; element extends upwards towards center.
        const openBottom = parseFloat(estuche.container.style.bottom);
        assert.strictEqual(openBottom, initialBottom, 'Bottom coordinate remains 100% stationary so elements expand upwards towards center without jumping');

        // Verify context-tray has inner wrapper for smooth CSS grid animation
        const contextTray = estuche.container.querySelector('.context-tray') as HTMLElement;
        assert.ok(contextTray, 'Context tray must exist');
        assert.ok(contextTray.classList.contains('is-open'), 'Context tray has .is-open class');
        const trayInner = contextTray.querySelector('.context-tray-inner');
        assert.ok(trayInner, 'Context tray must wrap contents in .context-tray-inner for 0fr->1fr accordion');

        // Close tray: bottom still remains 100% stationary
        tap(fillBtn);
        const closedBottom = parseFloat(estuche.container.style.bottom);
        assert.strictEqual(closedBottom, initialBottom, 'Bottom coordinate remains stationary when collapsing');

        estuche.destroy();
    });

    test('Vertical positioning anchors upper-half elements to top, extending downwards towards center', () => {
        setupMockDom();
        (globalThis as any).window = {
            innerWidth: 1280,
            innerHeight: 800,
            visualViewport: {
                width: 1280,
                height: 800,
                offsetLeft: 0,
                offsetTop: 0,
            },
        };

        // Anchor near top of viewport: Y = 100 (in 800px viewport, 100 < 400)
        const anchor = document.createElement('button');
        anchor.getBoundingClientRect = () => ({
            top: 80,
            bottom: 120,
            left: 20,
            right: 60,
            width: 40,
            height: 40,
        } as any);

        const estuche = new ToolEstuche(
            {
                tool: 'shape',
                shapeType: 'rectangle',
                color: '#2f6bff',
                width: 3,
                slot: 'ml',
            },
            {
                onSelectShapeType: () => {},
                onChangeWidth: () => {},
                onChangeSmoothing: () => {},
                onChangePressure: () => {},
                onUseFavorite: () => {},
                onSaveFavorite: () => {},
                onSelectEraserMode: () => {},
                onChangeEraserRadius: () => {},
                onToggleScribble: () => {},
                onSelectLassoMode: () => {},
                onToggleSnapGrid: () => {},
            }
        );

        estuche.container.getBoundingClientRect = () => ({
            top: 0,
            bottom: 352,
            left: 0,
            right: 330,
            width: 330,
            height: 352,
        } as any);

        estuche.open(undefined, anchor);

        // In upper half: global rule anchors to top, bottom is 'auto'
        assert.strictEqual(estuche.container.style.bottom, 'auto', 'Bottom is auto when top-anchored');
        const initialTop = parseFloat(estuche.container.style.top);
        assert.ok(!isNaN(initialTop), 'Top coordinate must be set');
        assert.ok(initialTop >= 16, 'Top coordinate respects viewport margin');

        estuche.destroy();
    });

    test('Constrained viewport sets maxHeight and overflow-y: auto on vertical drawer', () => {
        setupMockDom();
        // Constrained viewport: only 420px height
        (globalThis as any).window = {
            innerWidth: 800,
            innerHeight: 420,
            visualViewport: {
                width: 800,
                height: 420,
                offsetLeft: 0,
                offsetTop: 0,
            },
            clearTimeout: () => {},
            setTimeout: (fn: Function) => fn(),
        };

        const anchor = document.createElement('button');
        anchor.getBoundingClientRect = () => ({
            top: 200,
            bottom: 240,
            left: 20,
            right: 60,
            width: 40,
            height: 40,
        } as any);

        const estuche = new ToolEstuche(
            {
                tool: 'shape',
                shapeType: 'rectangle',
                color: '#2f6bff',
                width: 3,
                slot: 'ml',
            },
            {
                onSelectShapeType: () => {},
                onChangeWidth: () => {},
                onChangeSmoothing: () => {},
                onChangePressure: () => {},
                onUseFavorite: () => {},
                onSaveFavorite: () => {},
                onSelectEraserMode: () => {},
                onChangeEraserRadius: () => {},
                onToggleScribble: () => {},
                onSelectLassoMode: () => {},
                onToggleSnapGrid: () => {},
            }
        );

        estuche.open(undefined, anchor);

        const fillBtn = estuche.container.querySelector('button[data-tb="fill"]') as HTMLElement;
        fillBtn.click();

        // When target height (530px) exceeds available height (420 - 32 = 388px):
        assert.ok(estuche.container.style.maxHeight !== '', 'maxHeight must be set when viewport height is constrained');
        assert.strictEqual(estuche.container.style.overflowY, 'auto', 'overflowY must be auto when viewport height is constrained');

        estuche.destroy();
    });
});
