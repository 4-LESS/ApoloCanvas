import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawPatternedStrokePath } from '../src/engine/PatternedStrokeRenderer.ts';

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