import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyStrokePattern,
    buildCalligraphicChiselPath,
    drawPatternedStrokePath,
    drawSolidProfileStrokePath,
    filterRedundantPoints,
    renderContinuousSolidStroke,
    resetCalliCacheForTesting,
    resetGraphitePatternCacheForTesting,
    smoothCalligraphyPoints,
} from '../src/engine/PatternedStrokeRenderer.ts';

function createRecordingContext(pattern: CanvasPattern | null = null) {
    const strokes: Array<{ lineWidth: number; globalAlpha: number; lineCap: string; strokeStyle: unknown; dash: number[] }> = [];
    const fills: Array<{ globalAlpha: number; fillStyle: unknown; rule?: string }> = [];
    const fillRects: Array<{ x: number; y: number; w: number; h: number; globalAlpha: number; fillStyle: unknown }> = [];
    const arcs: number[][] = [];
    const commands: string[] = [];
    const dashCalls: number[][] = [];
    let lineWidth = 1;
    let globalAlpha = 1;
    let lineCap = 'butt';
    let strokeStyle: unknown = '#000000';
    let fillStyle: unknown = '#000000';
    let globalCompositeOperation = 'source-over';
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
        ellipse: (...values: unknown[]) => { commands.push('ellipse'); },
        stroke: () => strokes.push({ lineWidth, globalAlpha, lineCap, strokeStyle, dash: [...dash] }),
        fill: (rule?: string) => fills.push({ globalAlpha, fillStyle, rule }),
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
        set globalCompositeOperation(value: string) { globalCompositeOperation = value; },
        get globalCompositeOperation() { return globalCompositeOperation; },
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
    assert.equal(calli.fills.length, 1, 'calligraphy swept quad hull uses single unified fill');
    assert.equal(calli.fills[0].rule, 'nonzero', 'calligraphy uses nonzero winding rule to prevent self-intersection inversions');
    assert.equal(calli.strokes.length, 0, 'calligraphy does not draw secondary stroke lines');
    assert.ok(calli.commands.filter(c => c === 'closePath').length > 0, 'swept quads are closed');

    const pencil = createRecordingContext();
    drawSolidProfileStrokePath(pencil.context, solidPoints, 0, 100, 0, { ...baseStyle, profile: 'pencil' });
    assert.equal(pencil.strokes.length, 3, 'pencil renders 3 continuous stroke passes (halo, body, core)');
    assert.equal(pencil.fills.length, 0, 'continuous pencil stroke uses stroke passes without per-point particle fills');
    assert.equal(pencil.arcs.length, 0, 'pencil uses continuous path rather than per-point arc loops');
    assert.equal(pencil.strokes[0].lineCap, 'round');
    assert.equal(pencil.strokes[1].lineCap, 'round');
    assert.equal(pencil.strokes[2].lineCap, 'round');
    // Verify decreasing width and increasing alpha across the 3 passes
    assert.ok(pencil.strokes[0].lineWidth > pencil.strokes[1].lineWidth, 'Pass 1 is wider than Pass 2');
    assert.ok(pencil.strokes[1].lineWidth > pencil.strokes[2].lineWidth, 'Pass 2 is wider than Pass 3');
    assert.ok(pencil.strokes[0].globalAlpha < pencil.strokes[1].globalAlpha, 'Pass 1 alpha is softer than Pass 2');
    assert.ok(pencil.strokes[1].globalAlpha < pencil.strokes[2].globalAlpha, 'Pass 2 alpha is softer than Pass 3');
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

test('renderContinuousSolidStroke handles calli single point touches with stamped chisel rect', () => {
    const recording = createRecordingContext();
    renderContinuousSolidStroke(recording.context, [{ x: 50, y: 50 }], {
        color: '#00ff00',
        width: 8,
        opacity: 1.0,
        profile: 'calli',
    });
    assert.equal(recording.fills.length, 1, 'calli single point touch fills chisel stamped rect');
    assert.equal(recording.fills[0].rule, 'nonzero');
    assert.ok(recording.commands.includes('closePath'));
});

test('buildCalligraphicChiselPath generates valid SVG path and positive winding quads', () => {
    const chisel = buildCalligraphicChiselPath([
        { x: 10, y: 10 },
        { x: 20, y: 30 },
        { x: 50, y: 50 },
    ], 6);
    const svgD = chisel.toSvgPathD();
    assert.ok(svgD.startsWith('M'), 'SVG path starts with M');
    assert.ok(svgD.includes('Z'), 'SVG path contains closed Z segments');
});

test('filterRedundantPoints filters sub-1.8px jitter while preserving first and last point', () => {
    const raw = [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 }, // < 1.8px -> filtered
        { x: 1.0, y: 0.8 }, // < 1.8px -> filtered
        { x: 3.0, y: 4.0 }, // > 1.8px -> kept
        { x: 3.2, y: 4.1 }, // < 1.8px -> filtered
        { x: 10, y: 10 },   // kept (last point always kept)
    ];
    const filtered = filterRedundantPoints(raw);
    assert.equal(filtered.length, 3);
    assert.deepEqual(filtered[0], { x: 0, y: 0 });
    assert.deepEqual(filtered[filtered.length - 1], { x: 10, y: 10 });
});

test('smoothCalligraphyPoints adapts subdivision between sharp turns and gentle runs', () => {
    // Gentle run
    const gentle = [
        { x: 0, y: 0 },
        { x: 2, y: 2 },
        { x: 4, y: 4 },
    ];
    const smoothedGentle = smoothCalligraphyPoints(gentle);
    assert.ok(smoothedGentle.length <= 4, 'gentle runs should produce minimal subdivision points');

    // Sharp turn
    const sharp = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
    ];
    const smoothedSharp = smoothCalligraphyPoints(sharp);
    assert.ok(smoothedSharp.length > smoothedGentle.length, 'sharp turns trigger 4x subdivision for smoothness');
});

test('buildCalligraphicChiselPath groups segments into Monotone Ribbon Strips and hits WeakMap cache', () => {
    // Create a 100-point smooth S-curve
    const rawPoints: { x: number; y: number }[] = [];
    for (let i = 0; i < 100; i++) {
        const t = (i / 99) * Math.PI * 2;
        rawPoints.push({ x: 50 + Math.cos(t) * 40, y: 50 + Math.sin(t * 2) * 30 });
    }

    const chisel1 = buildCalligraphicChiselPath(rawPoints, 5);
    // With Monotone Ribbon Strips, strips should be grouped into few continuous polygons (< 15) instead of 100+ individual quads
    assert.ok((chisel1 as any).strips.length < 15, `Monotone ribbon strips must be < 15, got ${(chisel1 as any).strips.length}`);

    // WeakMap cache hit check
    const chisel2 = buildCalligraphicChiselPath(rawPoints, 5);
    assert.equal(chisel1.toSvgPathD(), chisel2.toSvgPathD(), 'cached SVG path matches identical input');
});

test('renderContinuousSolidStroke manages live prefix window for long calli strokes (>120 points)', () => {
    resetCalliCacheForTesting();
    const recording = createRecordingContext();
    const longPoints: { x: number; y: number }[] = [];
    for (let i = 0; i < 150; i++) {
        longPoints.push({ x: i * 2, y: Math.sin(i * 0.1) * 20 + 50 });
    }

    // Render long calli stroke (opacity 1.0)
    renderContinuousSolidStroke(recording.context, longPoints, {
        color: '#ff0000',
        width: 6,
        opacity: 1.0,
        profile: 'calli',
    });

    // Should have filled both the cached prefix and live tail with nonzero rule
    assert.ok(recording.fills.length >= 2, 'long live stroke splits into prefix and tail fills');
    assert.ok(recording.fills.every(f => f.rule === 'nonzero'), 'all calli fills must enforce nonzero winding');

    resetCalliCacheForTesting();
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