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
        const car = estuche.container.querySelector('.car') as HTMLElement;
        assert.ok(car, 'Shapes carousel should exist');
        const pager = estuche.container.querySelector('.pager') as HTMLElement;
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
        const ratioBtn = estuche.container.querySelector('button[data-tb="ratio"], button.pb.tg') as HTMLElement;
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
        assert.ok(lineTray.classList.contains('open'), 'Line tray should be open after stylus tap');

        // 5. Select dashed line style chip with stylus tap
        const dashedChip = lineTray.querySelectorAll('button.cc')[1] as HTMLElement;
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
        assert.ok(fillTray.classList.contains('open'), 'Fill tray should be open after stylus tap');

        const hachureChip = fillTray.querySelectorAll('button.cc')[2] as HTMLElement;
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

        estuche.destroy();
    });
});
