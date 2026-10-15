import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyStrokePattern,
    drawPatternedStrokePath,
    drawSolidProfileStrokePath,
    renderContinuousSolidStroke,
    resetGraphitePatternCacheForTesting,
} from '../src/engine/PatternedStrokeRenderer.ts';

function createRecordingContext(pattern: CanvasPattern | null = null) {
    const strokes: Array<{ lineWidth: number; globalAlpha: number; lineCap: string; strokeStyle: unknown; dash: number[] }> = [];
    const fills: Array<{ globalAlpha: number; fillStyle: unknown }> = [];
    const fillRects: Array<{ x: number; y: number; w: number; h: number; globalAlpha: number; fillStyle: unknown }> = [];
    const arcs: number[][] = [];
    const commands: string[] = [];
    const dashCalls: number[][] = [];
    let lineWidth = 1;
    let globalAlpha = 1;
    let lineCap = 'butt';
    let strokeStyle: unknown = '#000000';
    let fillStyle: unknown = '#000000';
    let dash: number[] = [];
    let patternCalls = 0;

    const context = {
        save: () => undefined,
        restore: () => undefined,
        translate: () => undefined,
        beginPath: () => { commands.push('beginPath'); },
        moveTo: () => { commands.push('moveTo'); },
        lineTo: () => { commands.push('lineTo'); },
        quadraticCurveTo: () => { commands.push('quadraticCurveTo'); },
        closePath: () => { commands.push('closePath'); },
        arc: (...values: number[]) => { arcs.push(values); commands.push('arc'); },
        stroke: () => strokes.push({ lineWidth, globalAlpha, lineCap, strokeStyle, dash: [...dash] }),
        fill: () => fills.push({ globalAlpha, fillStyle }),
        fillRect: (x: number, y: number, w: number, h: number) => {
            fillRects.push({ x, y, w, h, globalAlpha, fillStyle });
        },
        setLineDash: (value: number[]) => {
            dash = [...value];
            dashCalls.push([...value]);
        },
        createPattern: () => {
            patternCalls++;
            return pattern;
        },
        set lineWidth(value: number) { lineWidth = value; },
        set globalAlpha(value: number) { globalAlpha = value; },
        set lineCap(value: string) { lineCap = value; },
        set lineJoin(_value: string) {},
        set lineDashOffset(_value: number) {},
        set strokeStyle(value: unknown) { strokeStyle = value; },
        set fillStyle(value: unknown) { fillStyle = value; },
    } as unknown as CanvasRenderingContext2D;

    return { context, strokes, fills, fillRects, arcs, commands, dashCalls, get patternCalls() { return patternCalls; } };
}

const solidPoints = [0.1, 0.5, 0.9, 0, 0.4, 0.5, 0.6, 100, 0.8, 0.25, 0.5, 200];

test('solid profiles use continuous paths, ribbon fills, fixed-nib quads, and dual-layer soft graphite with scatter', () => {
    const baseStyle = { color: '#222222', width: 4, opacity: 0.8, pattern: 'solid' as const };

    const ball = createRecordingContext();
    drawSolidProfileStrokePath(ball.context, solidPoints, 0, 100, 0, { ...baseStyle, profile: 'ball' });
    assert.equal(ball.strokes.length, 1, 'ball uses one continuous stroke');
    assert.equal(ball.fills.length, 0);
    assert.equal(ball.strokes[0].lineWidth, 3.6);
    assert.equal(ball.strokes[0].lineCap, 'round');
    assert.equal(ball.strokes[0].globalAlpha, baseStyle.opacity);
    assert.ok(ball.commands.includes('quadraticCurveTo'));

    const fountain = createRecordingContext();
    drawSolidProfileStrokePath(fountain.context, solidPoints, 0, 100, 0, { ...baseStyle, profile: 'fountain' });
    assert.equal(fountain.strokes.length, 1, 'fountain uses one continuous stroke');
    assert.equal(fountain.fills.length, 0);
    assert.equal(fountain.strokes[0].lineWidth, 4);
    assert.equal(fountain.strokes[0].lineCap, 'round');
    assert.ok(fountain.commands.includes('quadraticCurveTo'), 'fountain path is smoothed');

    const calli = createRecordingContext();
    drawSolidProfileStrokePath(calli.context, solidPoints, 0, 100, 0, { ...baseStyle, profile: 'calli' });
    assert.equal(calli.fills.length, 1, 'nib quad polygon is filled');
    assert.equal(calli.strokes.length, 1, 'calligraphy uses one central spine stroke');
    assert.equal(calli.commands.filter(command => command === 'closePath').length, 1);
    assert.equal(calli.strokes[0].lineCap, 'butt');
    assert.equal(calli.strokes[0].lineWidth, 1);

    const pencil = createRecordingContext();
    drawSolidProfileStrokePath(pencil.context, solidPoints, 0, 100, 0, { ...baseStyle, profile: 'pencil' });
    drawSolidProfileStrokePath(pencil.context, solidPoints, 0, 100, 0, { ...baseStyle, profile: 'pencil' });
    assert.equal(pencil.strokes.length, 4, 'each pencil render uses soft diffuse base and dense core pass');
    assert.equal(pencil.strokes[0].lineWidth, baseStyle.width * 1.1);
    assert.equal(pencil.strokes[1].lineWidth, baseStyle.width * 0.65);
    assert.equal(pencil.strokes[0].globalAlpha, baseStyle.opacity * 0.45);
    assert.equal(pencil.strokes[1].globalAlpha, baseStyle.opacity * 0.85);
    assert.ok(pencil.fillRects.length > 0, 'micro-particle scatter layer was rendered');
    assert.equal(pencil.fillRects[0].w, 1.2);
    assert.equal(pencil.fillRects[0].h, 1.2);
    assert.equal(pencil.fillRects[0].globalAlpha, baseStyle.opacity * 0.30);
});

test('renderContinuousSolidStroke handles single point touches with arc and fill', () => {
    const recording = createRecordingContext();
    renderContinuousSolidStroke(recording.context, [{ x: 50, y: 50 }], {
        color: '#ff0000',
        width: 6,
        opacity: 0.9,
        profile: 'ball',
    });
    assert.equal(recording.fills.length, 1);
    assert.equal(recording.arcs.length, 1);
    assert.deepEqual(recording.arcs[0], [50, 50, 3, 0, Math.PI * 2]);
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