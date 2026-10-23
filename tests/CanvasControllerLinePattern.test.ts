import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyStrokePattern,
    bakeLiveStrokeSegment,
    drawPatternedStrokePath,
    drawSolidProfileStrokePath,
    getOrCreateStrokeSprite,
    type LiveBakeState,
    renderContinuousSolidStroke,
    resetCalliCacheForTesting,
    resetGraphitePatternCacheForTesting,
} from '../src/engine/PatternedStrokeRenderer.ts';
import { getPenPlugin, PEN_REGISTRY } from '../src/engine/pens/index.ts';
import type { StrokeCache, StrokeElement } from '../src/core/types.ts';

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

test('solid profiles delegate to modular pen engines (ball, fountain, calli, pencil)', () => {
    const baseStyle = { color: '#222222', width: 4, opacity: 0.8, pattern: 'solid' as const };

    assert.ok('ball' in PEN_REGISTRY);
    assert.ok('fountain' in PEN_REGISTRY);
    assert.ok('calli' in PEN_REGISTRY);
    assert.ok('pencil' in PEN_REGISTRY);
    assert.equal(getPenPlugin('ball').id, 'ball');
    assert.equal(getPenPlugin('fountain').id, 'fountain');
    assert.equal(getPenPlugin('calli').id, 'calli');
    assert.equal(getPenPlugin('pencil').id, 'pencil');

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
    assert.ok(fountain.fills.length >= 1, 'fountain v2 uses tangential capsule fills');
    assert.ok(fountain.fills.every(f => f.rule === 'nonzero'), 'fountain v2 enforces nonzero winding');
    assert.equal(fountain.strokes.length, 0, 'fountain v2 uses filled capsule geometry');
    assert.ok(fountain.commands.includes('closePath'), 'fountain v2 closes capsule trapezoids');

    const calli = createRecordingContext();
    drawSolidProfileStrokePath(calli.context, solidPoints, 0, 100, 0, { ...baseStyle, profile: 'calli' });
    assert.equal(calli.fills.length, 1, 'calligraphy swept quad hull uses single unified fill');
    assert.equal(calli.fills[0].rule, 'nonzero', 'calligraphy uses nonzero winding rule to prevent self-intersection inversions');
    assert.equal(calli.strokes.length, 0, 'calligraphy does not draw secondary stroke lines');
    assert.ok(calli.commands.filter(c => c === 'closePath').length > 0, 'swept quads are closed');

    const pencil = createRecordingContext();
    drawSolidProfileStrokePath(pencil.context, solidPoints, 0, 100, 0, { ...baseStyle, profile: 'pencil' });
    assert.equal(pencil.fills.length, 2, 'pencil vector sketch renders 2 nonzero ribbon fills (outer porous + inner core)');
    assert.ok(pencil.fills.every(f => f.rule === 'nonzero'), 'pencil fills enforce nonzero winding');
    assert.equal(pencil.strokes.length, 1, 'pencil vector sketch renders 1 batched dry edge filament stroke');
    assert.deepEqual(pencil.dashCalls[pencil.dashCalls.length - 1], [], 'pencil always resets setLineDash([])');
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

test('renderContinuousSolidStroke batches long calli strokes (>120 points) with nonzero winding', () => {
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

    // Should have filled batches of 48 convex hulls with nonzero rule
    assert.ok(recording.fills.length >= 2, 'long calli stroke batches hulls into bounded fill calls');
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

test('modular pen plugins return distinct SVG geometry and cache via WeakMap', () => {
    const samplePoints = [
        { x: 10, y: 15, pressure: 0.4, time: 0 },
        { x: 35, y: 40, pressure: 0.7, time: 16 },
        { x: 70, y: 55, pressure: 0.8, time: 32 },
        { x: 110, y: 30, pressure: 0.5, time: 48 },
    ];
    const style = { color: '#1F4FD8', width: 4, opacity: 0.9, pattern: 'solid' as const };

    const ballSvg = getPenPlugin('ball').renderSvg(samplePoints, style);
    const fountainSvg = getPenPlugin('fountain').renderSvg(samplePoints, style);
    const calliSvg = getPenPlugin('calli').renderSvg(samplePoints, style);
    const pencilSvg = getPenPlugin('pencil').renderSvg(samplePoints, style);

    // 1. Ballpoint: single quadratic spline stroke path
    assert.ok(ballSvg.body.includes('stroke="#1F4FD8"'));
    assert.ok(ballSvg.body.includes('Q'), 'ballpoint SVG uses quadratic midpoint curve');

    // 2. Fountain v2: clockwise tangential capsule polygon hull
    assert.ok(fountainSvg.body.includes('fill="#1F4FD8"'));
    assert.ok(fountainSvg.body.includes('fill-rule="nonzero"'));
    assert.notEqual(fountainSvg.body, ballSvg.body);

    // 3. Calli v2: 4-corner 2D chisel hull
    assert.ok(calliSvg.body.includes('fill="#1F4FD8"'));
    assert.ok(calliSvg.body.includes('fill-rule="nonzero"'));
    assert.notEqual(calliSvg.body, fountainSvg.body);

    // 4. Pencil Vector Sketch: pattern defs + dual-pass ribbons + dry edge filaments
    const pencilDefs = typeof pencilSvg.defs === 'object' ? Object.values(pencilSvg.defs).join('') : (pencilSvg.defs ?? '');
    assert.ok(pencilDefs.includes('<pattern id="apolo-sketch-coarse-1F4FD8-'), 'pencil SVG defines coarse grain pattern');
    assert.ok(pencilDefs.includes('<pattern id="apolo-sketch-core-1F4FD8-'), 'pencil SVG defines core grain pattern');
    assert.ok(pencilDefs.includes('<image href="data:image/png;base64,'), 'pencil SVG pattern embeds PNG data URL');
    assert.ok(pencilSvg.body.includes('fill-rule="nonzero"'), 'pencil SVG uses nonzero ribbon fills');
    assert.ok(pencilSvg.body.includes('stroke-dasharray='), 'pencil SVG includes dry edge filaments');
    assert.ok(!pencilSvg.body.includes('feTurbulence'), 'pencil SVG does not use feTurbulence');

    // 5. WeakMap memoization: repeated call with identical array & style returns cached object reference
    const calliSvgCached = getPenPlugin('calli').renderSvg(samplePoints, style);
    assert.strictEqual(calliSvgCached, calliSvg, 'WeakMap cache returns exact cached PenSvgOutput reference');

    // 6. WeakMap invalidation when width or points length changes
    const calliSvgWider = getPenPlugin('calli').renderSvg(samplePoints, { ...style, width: 8 });
    assert.notStrictEqual(calliSvgWider, calliSvg, 'Cache invalidates when width changes');
});

test('renderSegment incrementally bakes delta slices across all 4 solid pen profiles', () => {
    const profiles = ['ball', 'fountain', 'calli', 'pencil'] as const;
    for (const profileId of profiles) {
        const plugin = getPenPlugin(profileId);
        assert.equal(typeof plugin.renderSegment, 'function', `${profileId} must implement renderSegment`);

        const rec = createRecordingContext();
        const segState: Record<string, unknown> = {};
        const pts = [
            { x: 10, y: 10, pressure: 0.4, time: 0 },
            { x: 25, y: 20, pressure: 0.6, time: 16 },
        ];
        const style = { color: '#222222', width: 4, opacity: 1, pattern: 'solid' as const, profile: profileId };

        plugin.renderSegment!(rec.context, pts, 0, style, segState);
        const initialOps = rec.strokes.length + rec.fills.length;
        assert.ok(initialOps >= 1, `${profileId} first delta slice must emit draw operations`);

        // Grow stroke in-place and bake next slice from index 2
        pts.push(
            { x: 45, y: 35, pressure: 0.7, time: 32 },
            { x: 70, y: 50, pressure: 0.5, time: 48 },
        );
        plugin.renderSegment!(rec.context, pts, 2, style, segState);
        const afterOps = rec.strokes.length + rec.fills.length;
        assert.ok(afterOps > initialOps, `${profileId} second delta slice must emit incremental draw operations`);
    }
});

test('bakeLiveStrokeSegment (paintActive) incrementally bakes new points and resets on zoom/style change', () => {
    const prevDoc = globalThis.document;
    let clearCount = 0;
    let drawImageCount = 0;
    let lastDrawImageAlpha = 0;

    const createMockCtx = () => ({
        save: () => undefined,
        restore: () => undefined,
        setTransform: () => undefined,
        clearRect: () => { clearCount++; },
        beginPath: () => undefined,
        moveTo: () => undefined,
        lineTo: () => undefined,
        quadraticCurveTo: () => undefined,
        closePath: () => undefined,
        arc: () => undefined,
        rect: () => undefined,
        clip: () => undefined,
        fill: () => undefined,
        stroke: () => undefined,
        setLineDash: () => undefined,
        createPattern: () => null,
        drawImage: () => {
            drawImageCount++;
            lastDrawImageAlpha = mainCtx.globalAlpha;
        },
        lineWidth: 1,
        globalAlpha: 1,
        lineCap: 'round',
        lineJoin: 'round',
        strokeStyle: '#000',
        fillStyle: '#000',
    });

    const mainCtx: any = createMockCtx();
    (globalThis as any).document = {
        createElement: () => ({
            width: 800,
            height: 600,
            getContext: () => createMockCtx(),
        }),
    };

    try {
        const state: LiveBakeState = {
            liveBakeCanvas: null,
            liveBakeCtx: null,
            liveBakedIndex: 0,
            liveBakeSegState: {},
            liveBakeZoom: -1,
            liveBakeScrollLeft: -1,
            liveBakeScrollTop: -1,
            liveBakeStyleKey: '',
        };
        const style = { color: '#1F4FD8', width: 4, opacity: 0.65, pattern: 'solid' as const, profile: 'fountain' as const };
        const run = [
            { x: 10, y: 10, pressure: 0.5, time: 0 },
            { x: 30, y: 25, pressure: 0.6, time: 16 },
        ];

        // Frame 1: initial 2 points
        const ok1 = bakeLiveStrokeSegment(state, mainCtx, run, style, 'fountain', 800, 600, 1.0, 0, 0, 2);
        assert.equal(ok1, true);
        assert.equal(state.liveBakedIndex, 2);
        assert.equal(clearCount, 1, 'initial frame clears offscreen bake buffer once');
        assert.equal(drawImageCount, 1);
        assert.equal(lastDrawImageAlpha, 0.65, 'blits offscreen bake buffer using stroke opacity');

        // Frame 2: add 2 more points at same zoom/scroll/style -> incremental bake without clearing buffer
        run.push(
            { x: 55, y: 40, pressure: 0.7, time: 32 },
            { x: 80, y: 60, pressure: 0.5, time: 48 },
        );
        const ok2 = bakeLiveStrokeSegment(state, mainCtx, run, style, 'fountain', 800, 600, 1.0, 0, 0, 2);
        assert.equal(ok2, true);
        assert.equal(state.liveBakedIndex, 4, 'liveBakedIndex advances to 4');
        assert.equal(clearCount, 1, 'incremental frame must NOT clear offscreen buffer');
        assert.equal(drawImageCount, 2);

        // Frame 3: zoom changes mid-stroke -> resets buffer and re-bakes
        const ok3 = bakeLiveStrokeSegment(state, mainCtx, run, style, 'fountain', 800, 600, 1.5, 0, 0, 2);
        assert.equal(ok3, true);
        assert.equal(clearCount, 2, 'zoom change clears and resets live bake buffer');
        assert.equal(state.liveBakeZoom, 1.5);
    } finally {
        globalThis.document = prevDoc;
    }
});

test('getOrCreateStrokeSprite (paintElement) reuses cached sprite in O(1) and invalidates on zoom or style change', () => {
    const prevDoc = globalThis.document;
    let createdCanvases = 0;

    (globalThis as any).document = {
        createElement: () => {
            createdCanvases++;
            const rec = createRecordingContext();
            (rec.context as any).setTransform = () => undefined;
            return {
                width: 0,
                height: 0,
                getContext: () => rec.context,
            };
        },
    };

    try {
        const strokeCache: StrokeCache = new Map();
        const geom = { originX: 0, scaleWidth: 800, originY: 100 };
        const strokeEl: StrokeElement = {
            id: 'stroke-cache-1',
            type: 'stroke',
            timestamp: 1000,
            zIndex: 1,
            blockId: 'line:1',
            points: [0.1, 0.1, 0.5, 0, 0.3, 0.25, 0.6, 16, 0.5, 0.4, 0.5, 32],
            bounds: { minX: 0.1, maxX: 0.5, minY: 0.1, maxY: 0.4 },
            style: { color: '#1F4FD8', width: 4, opacity: 0.9, pattern: 'solid', profile: 'calli' },
        };

        // 1. First call creates sprite
        const sprite1 = getOrCreateStrokeSprite(strokeEl, strokeCache, geom, 1.0, 2);
        assert.ok(sprite1, 'must return offscreen sprite canvas');
        assert.equal(createdCanvases, 1);

        // 2. Second call with identical zoom/style reuses exact sprite in O(1)
        const sprite2 = getOrCreateStrokeSprite(strokeEl, strokeCache, geom, 1.0, 2);
        assert.strictEqual(sprite2, sprite1, 'must reuse cached sprite without recreating');
        assert.equal(createdCanvases, 1);

        // 3. Zoom change invalidates cache and creates crisp Hi-DPI sprite at new scale
        const spriteZoomed = getOrCreateStrokeSprite(strokeEl, strokeCache, geom, 2.0, 2);
        assert.notStrictEqual(spriteZoomed, sprite1, 'zoom change must invalidate sprite cache');
        assert.equal(createdCanvases, 2);
        assert.ok(spriteZoomed!.width > sprite1!.width, 'zoomed sprite has higher physical pixel resolution');

        // 4. Style change (color / profile) invalidates cache
        strokeEl.style = { ...strokeEl.style, color: '#D9480F', profile: 'fountain' };
        const spriteStyled = getOrCreateStrokeSprite(strokeEl, strokeCache, geom, 2.0, 2);
        assert.notStrictEqual(spriteStyled, spriteZoomed, 'style/profile change must invalidate sprite cache');
        assert.equal(createdCanvases, 3);
    } finally {
        globalThis.document = prevDoc;
    }
});
