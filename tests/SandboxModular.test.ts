import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Sandbox Modular Canvas Architecture', () => {
    const sandboxDir = path.resolve('sandbox');

    it('sandbox folder structure matches exact requirements', () => {
        assert.ok(fs.existsSync(path.join(sandboxDir, 'index.html')), 'sandbox/index.html must exist');
        assert.ok(fs.existsSync(path.join(sandboxDir, 'engines', 'default-engine.js')), 'engines/default-engine.js must exist');
        assert.ok(fs.existsSync(path.join(sandboxDir, 'engines', 'optimized-engine.js')), 'engines/optimized-engine.js must exist');
        assert.ok(fs.existsSync(path.join(sandboxDir, 'pens', 'ball.js')), 'pens/ball.js must exist');
        assert.ok(fs.existsSync(path.join(sandboxDir, 'pens', 'fountain.js')), 'pens/fountain.js must exist');
        assert.ok(fs.existsSync(path.join(sandboxDir, 'pens', 'calli.js')), 'pens/calli.js must exist');
        assert.ok(fs.existsSync(path.join(sandboxDir, 'pens', 'pencil.js')), 'pens/pencil.js must exist');
        assert.ok(fs.existsSync(path.join(sandboxDir, 'pens', 'pencil-simple.js')), 'pens/pencil-simple.js must exist');
    });

    it('pens export renderPen function and execute without error', async () => {
        const pens = ['ball', 'fountain', 'calli', 'pencil', 'pencil-simple', 'pencil-atlas'];
        
        // Mock CanvasRenderingContext2D
        const mockCtx: any = {
            save: () => {},
            restore: () => {},
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            quadraticCurveTo: () => {},
            arc: () => {},
            fill: () => {},
            stroke: () => {},
            closePath: () => {},
            lineWidth: 1,
            strokeStyle: '#000',
            fillStyle: '#000',
            globalAlpha: 1,
            lineCap: 'round',
            lineJoin: 'round',
        };

        const testPoints = [
            { x: 10, y: 10, pressure: 0.3 },
            { x: 30, y: 35, pressure: 0.6 },
            { x: 60, y: 80, pressure: 0.8 },
            { x: 100, y: 120, pressure: 0.5 },
        ];

        const testStyle = {
            width: 4,
            opacity: 0.9,
            color: '#2563eb',
            smoothing: 0.5,
            tiltAngle: -Math.PI / 4,
        };

        for (const penId of pens) {
            const penModule = await import(`../sandbox/pens/${penId}.js`);
            assert.strictEqual(typeof penModule.renderPen, 'function', `${penId}.js must export renderPen`);

            // Execute single point
            assert.doesNotThrow(() => {
                penModule.renderPen(mockCtx, [testPoints[0]], testStyle);
            }, `Single point rendering in ${penId} should not throw`);

            // Execute continuous points
            assert.doesNotThrow(() => {
                penModule.renderPen(mockCtx, testPoints, testStyle);
            }, `Continuous points rendering in ${penId} should not throw`);
        }

        const calliMod = await import('../sandbox/pens/calli.js');
        assert.strictEqual(typeof calliMod.renderSvg, 'function');
        const svg = calliMod.renderSvg(testPoints, testStyle);
        assert.ok(svg.body.includes('fill-rule="nonzero"'), 'calli SVG includes fill-rule nonzero');
        assert.ok(svg.body.startsWith('<path d="M'), 'calli SVG is a closed vector path');
    });

    it('engines export SandboxEngine class complying with the engine contract', async () => {
        const defaultEngineMod = await import('../sandbox/engines/default-engine.js');
        const optimizedEngineMod = await import('../sandbox/engines/optimized-engine.js');

        assert.ok(defaultEngineMod.SandboxEngine, 'default-engine.js must export SandboxEngine');
        assert.ok(optimizedEngineMod.SandboxEngine, 'optimized-engine.js must export SandboxEngine');

        // Create mock canvas and ctx
        const createMockCanvas = () => {
            const mockCtx: any = {
                save: () => {},
                restore: () => {},
                beginPath: () => {},
                moveTo: () => {},
                lineTo: () => {},
                quadraticCurveTo: () => {},
                arc: () => {},
                fill: () => {},
                stroke: () => {},
                closePath: () => {},
                clearRect: () => {},
                drawImage: () => {},
                setTransform: () => {},
                lineWidth: 1,
                strokeStyle: '#000',
                fillStyle: '#000',
                globalAlpha: 1,
                lineCap: 'round',
                lineJoin: 'round',
            };
            const mockCanvas: any = {
                width: 800,
                height: 600,
                style: {},
                getContext: () => mockCtx,
                getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
                setPointerCapture: () => {},
                releasePointerCapture: () => {},
                hasPointerCapture: () => false,
            };
            return { mockCanvas, mockCtx };
        };

        // Test DefaultEngine
        const d = createMockCanvas();
        let statsReceived = false;
        const defaultEngine = new defaultEngineMod.SandboxEngine(d.mockCanvas, d.mockCtx, {
            getPenRenderer: () => () => {},
            getStyle: () => ({ width: 4, opacity: 1, color: '#000', smoothing: 0.5 }),
            onStats: () => { statsReceived = true; },
        });

        assert.strictEqual(typeof defaultEngine.handlePointerDown, 'function');
        assert.strictEqual(typeof defaultEngine.handlePointerMove, 'function');
        assert.strictEqual(typeof defaultEngine.handlePointerUp, 'function');
        assert.strictEqual(typeof defaultEngine.clear, 'function');

        defaultEngine.handlePointerDown({ clientX: 50, clientY: 50, pressure: 0.5, pointerType: 'pen' });
        defaultEngine.handlePointerMove({ clientX: 70, clientY: 80, pressure: 0.6, pointerType: 'pen' });
        defaultEngine.handlePointerUp({ clientX: 90, clientY: 100, pressure: 0.5, pointerType: 'pen' });

        assert.strictEqual(defaultEngine.getStrokes().length, 1, 'Default engine should record stroke on pointer up');
        assert.ok(statsReceived, 'Default engine should report benchmark stats');

        // Test OptimizedEngine
        // In Node environment, document might not be present or complete unless mocked
        if (typeof globalThis.document === 'undefined' || !(globalThis.document as any).documentElement) {
            const mockDoc = {
                createElement: (tag?: string) => {
                    const canvasObj = createMockCanvas().mockCanvas;
                    (canvasObj as any).style = {};
                    return canvasObj;
                },
                documentElement: { style: {} },
                body: { style: {} },
                head: {},
            };
            globalThis.document = mockDoc as any;
        }

        const opt = createMockCanvas();
        let optStatsReceived = false;
        const optEngine = new optimizedEngineMod.SandboxEngine(opt.mockCanvas, opt.mockCtx, {
            getPenRenderer: () => () => {},
            getStyle: () => ({ width: 4, opacity: 1, color: '#000', smoothing: 0.5 }),
            onStats: () => { optStatsReceived = true; },
        });

        optEngine.handlePointerDown({ clientX: 50, clientY: 50, pressure: 0.5, pointerType: 'pen' });
        optEngine.handlePointerMove({ clientX: 70, clientY: 80, pressure: 0.6, pointerType: 'pen' });
        optEngine.handlePointerUp({ clientX: 90, clientY: 100, pressure: 0.5, pointerType: 'pen' });

        assert.strictEqual(optEngine.getStrokes().length, 1, 'Optimized engine should record stroke on pointer up');
        assert.ok(optStatsReceived, 'Optimized engine should report benchmark stats');
    });

    it('pencil renders 3 continuous passes on canvas without per-point arc loops', async () => {
        const { renderContinuousSolidStroke, resetGraphitePatternCacheForTesting } = await import('../src/engine/PatternedStrokeRenderer.ts');
        resetGraphitePatternCacheForTesting();

        const recordedStrokes: Array<{ lineWidth: number; globalAlpha: number; lineCap: string }> = [];
        const recordedArcs: any[] = [];
        const recordedFills: any[] = [];

        const mockContext: any = {
            save: () => {},
            restore: () => {},
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            quadraticCurveTo: () => {},
            arc: (...args: any[]) => recordedArcs.push(args),
            fill: () => recordedFills.push(true),
            stroke: () => {
                recordedStrokes.push({
                    lineWidth: mockContext.lineWidth,
                    globalAlpha: mockContext.globalAlpha,
                    lineCap: mockContext.lineCap,
                });
            },
            createPattern: () => null,
            lineWidth: 1,
            globalAlpha: 1,
            lineCap: 'round',
            lineJoin: 'round',
            strokeStyle: '#000',
            fillStyle: '#000',
        };

        const points = [
            { x: 10, y: 10, pressure: 0.5 },
            { x: 20, y: 25, pressure: 0.6 },
            { x: 40, y: 50, pressure: 0.7 },
            { x: 70, y: 80, pressure: 0.5 },
        ];

        renderContinuousSolidStroke(mockContext, points, {
            color: '#2b2b2b',
            width: 5,
            opacity: 0.8,
            profile: 'pencil',
        });

        // Must execute exactly 3 continuous passes
        assert.strictEqual(recordedStrokes.length, 3, 'pencil must render 3 continuous stroke passes');
        assert.strictEqual(recordedArcs.length, 0, 'pencil must not use per-point arc() particle loops');
        assert.strictEqual(recordedFills.length, 0, 'pencil must not use fill() on continuous paths');

        // Verify decreasing width and increasing alpha (Pass 1 halo, Pass 2 body, Pass 3 core)
        assert.ok(recordedStrokes[0].lineWidth > recordedStrokes[1].lineWidth, 'Pass 1 is wider than Pass 2');
        assert.ok(recordedStrokes[1].lineWidth > recordedStrokes[2].lineWidth, 'Pass 2 is wider than Pass 3');
        assert.ok(recordedStrokes[0].globalAlpha < recordedStrokes[1].globalAlpha, 'Pass 1 is softer than Pass 2');
        assert.ok(recordedStrokes[1].globalAlpha < recordedStrokes[2].globalAlpha, 'Pass 2 is softer than Pass 3');
    });

    it('SVG companion export includes userSpaceOnUse apolo-pencil-grain filter when pencil stroke is present', async () => {
        const { renderBoxSvg } = await import('../src/io/PersistenceQueue.ts');

        const elements: any[] = [
            {
                id: 'el-1',
                type: 'stroke',
                timestamp: Date.now(),
                zIndex: 1,
                blockId: 'block-1',
                anchorText: 'test',
                points: [0.1, 0.1, 0.5, 0, 0.2, 0.3, 0.6, 50, 0.4, 0.5, 0.5, 100],
                bounds: { minX: 0.1, maxX: 0.4, minY: 0.1, maxY: 0.5 },
                style: {
                    color: '#2b2b2b',
                    width: 4,
                    opacity: 0.85,
                    profile: 'pencil',
                    pattern: 'solid',
                },
            },
        ];

        const svgOutput = renderBoxSvg('box-1', elements, 800, 280);

        assert.ok(svgOutput.includes('id="apolo-pencil-grain"'), 'SVG defs must define apolo-pencil-grain');
        assert.ok(svgOutput.includes('filterUnits="userSpaceOnUse"'), 'Filter must use filterUnits="userSpaceOnUse"');
        assert.ok(svgOutput.includes('feTurbulence'), 'Filter must include feTurbulence');
        assert.ok(svgOutput.includes('feColorMatrix'), 'Filter must include feColorMatrix');
        assert.ok(svgOutput.includes('feDisplacementMap'), 'Filter must include feDisplacementMap');
        assert.ok(svgOutput.includes('filter="url(#apolo-pencil-grain)"'), 'Pencil stroke must reference apolo-pencil-grain filter');
    });
});
