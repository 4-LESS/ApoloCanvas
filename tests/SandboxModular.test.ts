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

    it('pens export renderPen/renderCanvas function and execute without error via dynamic folder scan', async () => {
        const pensDir = path.join(sandboxDir, 'pens');
        const jsFiles = fs.readdirSync(pensDir).filter(f => f.endsWith('.js'));
        assert.ok(jsFiles.length >= 6, 'sandbox/pens must contain pen modules');

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
            setLineDash: () => {},
            createPattern: () => null,
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

        let testedPenCount = 0;
        for (const file of jsFiles) {
            const penId = file.slice(0, -3);
            const penModule = await import(`../sandbox/pens/${file}`);
            const renderFn = penModule.renderCanvas || penModule.renderPen;
            if (typeof renderFn !== 'function') {
                // Helper module like pencil-common.js
                continue;
            }
            testedPenCount++;

            // Execute single point
            assert.doesNotThrow(() => {
                renderFn(mockCtx, [testPoints[0]], testStyle);
            }, `Single point rendering in ${penId} should not throw`);

            // Execute continuous points
            assert.doesNotThrow(() => {
                renderFn(mockCtx, testPoints, testStyle);
            }, `Continuous points rendering in ${penId} should not throw`);
        }
        assert.ok(testedPenCount >= 6, 'At least 6 executable pen modules must be auto-discovered');

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

    it('pencil delegates to Vector Sketch O(1) engine (2 fills + 1 filament stroke)', async () => {
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
            closePath: () => {},
            setLineDash: () => {},
            arc: (...args: any[]) => recordedArcs.push(args),
            fill: (rule?: string) => recordedFills.push(rule),
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

        assert.strictEqual(recordedFills.length, 2, 'pencil must execute 2 nonzero ribbon fills (coarse + core)');
        assert.strictEqual(recordedStrokes.length, 1, 'pencil must execute 1 dry edge filament stroke');
    });

    it('SVG companion export includes deduplicated Vector Sketch pattern defs and O(1) WeakMap memoization', async () => {
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
            {
                id: 'el-2',
                type: 'stroke',
                timestamp: Date.now() + 1,
                zIndex: 2,
                blockId: 'block-1',
                anchorText: 'test',
                points: [0.5, 0.2, 0.5, 0, 0.6, 0.4, 0.6, 50, 0.7, 0.6, 0.5, 100],
                bounds: { minX: 0.5, maxX: 0.7, minY: 0.2, maxY: 0.6 },
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

        assert.ok(svgOutput.includes('<defs>'), 'SVG output must include a root <defs> block');
        assert.ok(svgOutput.includes('id="apolo-sketch-coarse-2b2b2b-'), 'SVG defs must define apolo-sketch-coarse pattern');
        assert.ok(svgOutput.includes('id="apolo-sketch-core-2b2b2b-'), 'SVG defs must define apolo-sketch-core pattern');
        assert.ok(svgOutput.includes('patternUnits="userSpaceOnUse"'), 'Pattern defs must use patternUnits="userSpaceOnUse"');
        assert.ok(!svgOutput.includes('feTurbulence'), 'SVG must not include legacy feTurbulence filter');
        assert.strictEqual(
            svgOutput.split('id="apolo-sketch-coarse-2b2b2b-').length - 1,
            1,
            'Shared pattern defs must be deduplicated across multiple strokes of the same color'
        );

        const cachedOutput = renderBoxSvg('box-1', elements, 800, 280);
        assert.strictEqual(cachedOutput, svgOutput, 'Memoized SVG output must be identical on subsequent calls');
    });

    it('pencil-sketch (Lápiz 8) renders long strokes in O(1) draw calls (2 fills + 1 stroke) and matches SVG without heavy filters', async () => {
        const sketchMod = await import('../sandbox/pens/pencil-sketch.js');
        assert.strictEqual(sketchMod.id, 'pencil-sketch');

        let fillCalls = 0;
        let strokeCalls = 0;
        const mockCtx: any = {
            save: () => {},
            restore: () => {},
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            arc: () => {},
            closePath: () => {},
            setLineDash: () => {},
            createPattern: () => null,
            fill: () => { fillCalls++; },
            stroke: () => { strokeCalls++; },
            lineWidth: 1,
            globalAlpha: 1,
            strokeStyle: '#000',
            fillStyle: '#000',
        };

        // Generate a 500-point long stroke
        const longPoints = [];
        for (let i = 0; i < 500; i++) {
            longPoints.push({
                x: i * 2.5,
                y: Math.sin(i * 0.08) * 30 + 100,
                pressure: 0.25 + 0.65 * Math.sin((i / 500) * Math.PI),
            });
        }

        sketchMod.renderCanvas(mockCtx, longPoints, { width: 28, color: '#2b2b2b', opacity: 0.9 });
        assert.strictEqual(fillCalls, 2, 'Long stroke must execute exactly 2 fill calls (outer porous ribbon + inner core ribbon)');
        assert.strictEqual(strokeCalls, 1, 'Long stroke must execute exactly 1 stroke call (batched edge filaments)');

        const svgOut = sketchMod.renderSvg(longPoints, { width: 28, color: '#2b2b2b', opacity: 0.9 });
        assert.ok(svgOut.body.includes('fill-rule="nonzero"'), 'SVG output must use nonzero ribbon fills');
        assert.ok(svgOut.body.includes('stroke-dasharray='), 'SVG output must include dry edge filaments');
        assert.ok(!svgOut.body.includes('feTurbulence'), 'SVG output must not rely on slow feTurbulence filters');
    });

    it('calli-v2 renders stable 2D chisel hull parallel to nib angle and updates SVG when points array grows in-place', async () => {
        const calliV2Mod = await import('../sandbox/pens/calli-v2.js');
        assert.strictEqual(calliV2Mod.id, 'calli-v2');
        assert.strictEqual(calliV2Mod.incrementalBake, true);

        const style = { width: 12, color: '#1e1e1e', opacity: 1.0, tiltAngle: Math.PI / 2 }; // 90 deg vertical nib
        const activePoints = [{ x: 100, y: 50, pressure: 0.5 }];

        // 1. Simulate pointerdown (1 point)
        const svg1 = calliV2Mod.renderSvg(activePoints, style);
        const len1 = svg1.body.length;

        // 2. Simulate pointermove mutating the same array in-place along the 90 deg nib direction (vertical line)
        for (let i = 1; i <= 25; i++) {
            activePoints.push({ x: 100 + (i % 2 === 0 ? 0.05 : -0.05), y: 50 + i * 8, pressure: 0.5 });
        }

        const svg2 = calliV2Mod.renderSvg(activePoints, style);
        assert.ok(svg2.body.length > len1 * 5, 'SVG must include the full grown vector path, not just the initial point');
    });

    it('benchmarks average FPS of all pens reaching 50,000 points in a single stroke', async () => {
        const pensDir = path.join(sandboxDir, 'pens');
        const jsFiles = fs.readdirSync(pensDir).filter(f => f.endsWith('.js'));

        const createBenchCtx = () => ({
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
            setLineDash: () => {},
            createPattern: () => ({}),
            clearRect: () => {},
            fillRect: () => {},
            drawImage: () => {},
            setTransform: () => {},
            createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
            putImageData: () => {},
            lineWidth: 1,
            globalAlpha: 1,
            strokeStyle: '#000',
            fillStyle: '#000',
            lineCap: 'round',
            lineJoin: 'round',
            canvas: { width: 1200, height: 800, id: 'drawingCanvas' },
        });

        const prevDoc = globalThis.document;
        const prevPath2D = (globalThis as any).Path2D;
        (globalThis as any).document = {
            createElement: () => {
                const c = createBenchCtx();
                return {
                    width: 1200,
                    height: 800,
                    id: 'drawingCanvas',
                    style: {},
                    getContext: () => c,
                    toDataURL: () => 'data:image/png;base64,AA==',
                };
            },
            documentElement: { style: {} },
            body: { style: {} },
            head: {},
        };
        if (typeof (globalThis as any).Path2D === 'undefined') {
            (globalThis as any).Path2D = class {
                moveTo() {}
                lineTo() {}
                closePath() {}
            };
        }

        try {
            const totalPoints = 50000;
            const rows = 25;
            const ptsPerRow = totalPoints / rows;
            const allPts = new Array(totalPoints);
            let idx = 0;
            for (let r = 0; r < rows; r++) {
                const rowY = 70 + (r / (rows - 1)) * 660;
                const dir = r % 2 === 0 ? 1 : -1;
                for (let j = 0; j < ptsPerRow; j++) {
                    const u = j / (ptsPerRow - 1);
                    const baseT = dir === 1 ? u : 1 - u;
                    allPts[idx++] = {
                        x: 55 + baseT * 1090 + Math.cos(j * 0.35) * 2.2,
                        y: rowY + Math.sin(j * 0.28 + r) * 6.5,
                        pressure: 0.25 + 0.65 * (0.5 + 0.5 * Math.sin(j * 0.04 + r * 0.7)),
                        time: idx * 4,
                    };
                }
            }

            const ctx: any = createBenchCtx();
            const results: Array<{ id: string; name: string; avgFps: number; avgMs: number; msAt50k: number; score: number }> = [];

            for (const file of jsFiles) {
                const mod = await import(`../sandbox/pens/${file}`);
                const renderFn = mod.renderCanvas || mod.renderPen;
                if (typeof renderFn !== 'function') continue;

                const penId = mod.id || file.slice(0, -3);
                const strokeId = `test50k_${penId}`;
                const style = { width: 4, color: '#2b2b2b', opacity: 1.0, strokeId };

                const milestones = [10000, 25000, 50000];
                const burstFrames = 5;
                const ptsPerBurstFrame = 12;
                const livePoints: any[] = [];
                const milestoneMs: Array<{ count: number; ms: number }> = [];
                let cumulativeMs = 0;
                let abortedEarly = false;

                for (let mIdx = 0; mIdx < milestones.length; mIdx++) {
                    const targetCount = milestones[mIdx];
                    const warmTarget = Math.max(0, targetCount - burstFrames * ptsPerBurstFrame);

                    while (livePoints.length < warmTarget) {
                        const nextBatch = Math.min(warmTarget, livePoints.length + 64);
                        while (livePoints.length < nextBatch) {
                            livePoints.push(allPts[livePoints.length]);
                        }
                        if (
                            mod.incrementalBake ||
                            penId === 'calli' ||
                            penId === 'fountain-v2' ||
                            penId === 'pencil' ||
                            penId === 'pencil-sketch' ||
                            penId === 'pencil-atlasv2' ||
                            penId === 'pencil-atlasv4' ||
                            penId === 'pencil-atlasClaude'
                        ) {
                            renderFn(ctx, livePoints, style);
                        }
                    }

                    let burstSumMs = 0;
                    for (let b = 0; b < burstFrames; b++) {
                        const stepTarget = Math.min(targetCount, livePoints.length + ptsPerBurstFrame);
                        while (livePoints.length < stepTarget) {
                            livePoints.push(allPts[livePoints.length]);
                        }
                        const t0 = performance.now();
                        renderFn(ctx, livePoints, style);
                        const dt = performance.now() - t0;
                        burstSumMs += dt;
                        cumulativeMs += dt;
                    }

                    const avgBurstMs = burstSumMs / burstFrames;
                    milestoneMs.push({ count: targetCount, ms: avgBurstMs });
                    if ((avgBurstMs > 45 || cumulativeMs > 240) && mIdx < milestones.length - 1) {
                        abortedEarly = true;
                        break;
                    }
                }

                let msAt50k = milestoneMs[milestoneMs.length - 1].ms;
                let avgMs = 0;
                if (!abortedEarly) {
                    avgMs = milestoneMs.reduce((acc, f) => acc + f.ms, 0) / milestoneMs.length;
                } else {
                    const last = milestoneMs[milestoneMs.length - 1];
                    msAt50k = last.ms * (totalPoints / last.count);
                    avgMs = msAt50k * 0.55;
                }

                const effectiveFrameMs = Math.max(8.33, avgMs * 0.45 + msAt50k * 0.55);
                const avgFps = Math.max(1, Math.min(120, Math.round(1000 / effectiveFrameMs)));
                const fpsRatio = Math.min(1, avgFps / 120);
                const tailPenalty = Math.max(0, 1 - Math.max(0, msAt50k - 2.5) / 65);
                const score = Math.max(1, Math.min(100, Math.round(fpsRatio * 70 + tailPenalty * 30)));

                if (typeof mod.releasePencilStroke === 'function') {
                    mod.releasePencilStroke(strokeId);
                    mod.releasePencilStroke(livePoints);
                }

                results.push({
                    id: penId,
                    name: mod.name || penId,
                    avgFps,
                    avgMs,
                    msAt50k,
                    score,
                });
            }

            results.sort((a, b) => b.score - a.score || a.avgMs - b.avgMs);
            console.log('\n=== BENCHMARK 50.000 PUNTOS EN UN TRAZO ===');
            for (const r of results) {
                console.log(
                    `${r.name.padEnd(38)} | ${String(r.avgFps).padStart(3)} FPS prom. | avg: ${r.avgMs.toFixed(2).padStart(6)} ms | @50k: ${r.msAt50k.toFixed(2).padStart(6)} ms | Score: ${r.score}/100`
                );
            }

            assert.ok(results.length >= 10, 'All executable pens must be benchmarked at 50,000 points');
            const sketchRes = results.find(r => r.id === 'pencil-sketch');
            assert.ok(sketchRes && sketchRes.avgFps >= 60, 'pencil-sketch must sustain >= 60 FPS average up to 50,000 points');
            const fountainV2Res = results.find(r => r.id === 'fountain-v2');
            assert.ok(fountainV2Res && fountainV2Res.avgFps >= 60, 'fountain-v2 must sustain >= 60 FPS average up to 50,000 points');
            const calliV2Res = results.find(r => r.id === 'calli-v2');
            assert.ok(calliV2Res && calliV2Res.avgFps >= 60, 'calli-v2 must sustain >= 60 FPS average up to 50,000 points');
        } finally {
            globalThis.document = prevDoc;
            (globalThis as any).Path2D = prevPath2D;
        }
    });
});
