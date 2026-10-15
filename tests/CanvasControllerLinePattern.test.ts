import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawPatternedStrokePath, getSolidProfileSegmentStyle } from '../src/engine/PatternedStrokeRenderer.ts';

test('solid profiles apply distinct width, opacity, direction, and grain dynamics', () => {
    const baseWidth = 4;
    const baseOpacity = 0.8;
    const ballLight = getSolidProfileSegmentStyle('ball', baseWidth, 0, baseOpacity, 0, 0, 10, 0, 0);
    const ballHeavy = getSolidProfileSegmentStyle('ball', baseWidth, 1, baseOpacity, 0, 0, 10, 0, 0);
    assert.equal(ballLight.width, baseWidth * 0.95);
    assert.equal(ballHeavy.width, baseWidth * 1.05);
    assert.equal(ballLight.opacity, 0.98 * baseOpacity);
    assert.equal(ballLight.lineCap, 'round');

    const fountainLight = getSolidProfileSegmentStyle('fountain', baseWidth, 0, baseOpacity, 0, 0, 10, 0, 0);
    const fountainMiddle = getSolidProfileSegmentStyle('fountain', baseWidth, 0.5, baseOpacity, 0, 0, 10, 0, 0);
    const fountainHeavy = getSolidProfileSegmentStyle('fountain', baseWidth, 1, baseOpacity, 0, 0, 10, 0, 0);
    assert.equal(fountainLight.width, baseWidth * 0.45);
    assert.equal(fountainMiddle.width, baseWidth * 0.9);
    assert.equal(fountainHeavy.width, baseWidth * 1.35);

    const calliDiagonal = getSolidProfileSegmentStyle('calli', baseWidth, 0.5, baseOpacity, 0, 0, 10, 10, 0);
    const calliHorizontal = getSolidProfileSegmentStyle('calli', baseWidth, 0.5, baseOpacity, 0, 0, 10, 0, 0);
    assert.ok(Math.abs(calliDiagonal.width - baseWidth * 0.3) < 1e-9);
    assert.ok(calliHorizontal.width > calliDiagonal.width);
    assert.equal(calliDiagonal.lineCap, 'butt');

    const pencilLight = getSolidProfileSegmentStyle('pencil', baseWidth, 0, baseOpacity, 0, 0, 10, 0, 0);
    const pencilHeavy = getSolidProfileSegmentStyle('pencil', baseWidth, 1, baseOpacity, 0, 0, 10, 0, 0);
    const pencilGrain = getSolidProfileSegmentStyle('pencil', baseWidth, 0, baseOpacity, 0, 0, 5, 5, 1);
    assert.equal(pencilLight.opacity, 0.38 * baseOpacity);
    assert.equal(pencilHeavy.opacity, 0.86 * baseOpacity);
    assert.notEqual(pencilLight.width, pencilGrain.width);
    assert.ok(pencilGrain.width >= baseWidth * 0.97 && pencilGrain.width <= baseWidth * 1.03);
});

test('live dashed pointer drag redraws one continuous path before pointerup', () => {
    const points: number[] = [];
    const strokes: Array<{
        dash: number[];
        points: Array<[number, number]>;
        lineCap: string;
        lineWidth: number;
        strokeStyle: string;
        globalAlpha: number;
    }> = [];
    const dashHistory: number[][] = [];
    let currentDash: number[] = [];
    let currentPoints: Array<[number, number]> = [];
    let currentLineCap = '';
    let currentLineWidth = 0;
    let currentStrokeStyle = '';
    let currentGlobalAlpha = 1;

    const context = {
        save: () => undefined,
        restore: () => undefined,
        beginPath: () => { currentPoints = []; },
        moveTo: (x: number, y: number) => { currentPoints.push([x, y]); },
        lineTo: (x: number, y: number) => { currentPoints.push([x, y]); },
        stroke: () => strokes.push({
            dash: [...currentDash],
            points: [...currentPoints],
            lineCap: currentLineCap,
            lineWidth: currentLineWidth,
            strokeStyle: currentStrokeStyle,
            globalAlpha: currentGlobalAlpha,
        }),
        fill: () => undefined,
        arc: () => undefined,
        clip: () => undefined,
        rect: () => undefined,
        setLineDash: (dash: number[]) => {
            currentDash = [...dash];
            dashHistory.push([...dash]);
        },
        set strokeStyle(value: string) { currentStrokeStyle = value; },
        set lineWidth(value: number) { currentLineWidth = value; },
        set lineCap(value: string) { currentLineCap = value; },
        set lineJoin(_value: string) {},
        set globalAlpha(value: number) { currentGlobalAlpha = value; },
        set fillStyle(_value: string) {},
    } as unknown as CanvasRenderingContext2D;

    const style = {
        color: '#1F4FD8',
        width: 3,
        opacity: 0.8,
        pattern: 'dashed' as const,
        lineCap: 'round' as const,
        profile: 'ball' as const,
    };
    const renderFrame = () => drawPatternedStrokePath(context, points, 0, 1, 0, style);
    const pointerDown = (x: number, y: number) => {
        points.push(x, y, 0.5, 1);
        renderFrame();
    };
    const pointerMove = (x: number, y: number, time: number) => {
        points.push(x, y, 0.5, time);
        const previousStrokeCount = strokes.length;
        renderFrame();
        assert.equal(strokes.length - previousStrokeCount, 1, 'each pointermove should stroke the active path once');
        assert.deepEqual(currentDash, [], 'dash state should be reset after drawing each frame');
    };

    pointerDown(1, 10);
    const frameResults: typeof strokes = [];
    pointerMove(3, 10, 2);
    frameResults.push(strokes[strokes.length - 1]);
    pointerMove(5, 11, 3);
    frameResults.push(strokes[strokes.length - 1]);
    pointerMove(7, 11, 4);
    frameResults.push(strokes[strokes.length - 1]);

    assert.deepEqual(frameResults.map(frame => frame.points.length), [2, 3, 4]);
    assert.ok(frameResults.every(frame => JSON.stringify(frame.dash) === JSON.stringify([9, 6])));
    assert.ok(frameResults.every(frame => frame.lineCap === 'butt'));
    assert.ok(frameResults.every(frame => frame.lineWidth === 3));
    assert.ok(frameResults.every(frame => frame.strokeStyle === '#1F4FD8'));
    assert.ok(frameResults.every(frame => frame.globalAlpha === 0.8));
    assert.ok(dashHistory.some(dash => JSON.stringify(dash) === JSON.stringify([9, 6])));
    assert.deepEqual(dashHistory.slice(-2), [[9, 6], []]);
});