import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { ShapeElement, StrokeElement } from '../src/core/types.ts';
import { splitShapeDoc, shapeToBoundaryPaths, deCasteljau, extractCubicSubcurve } from '../src/engine/eraser/ShapeEraser.ts';
import { createCustomShapePlugin, registerShapePlugin } from '../src/engine/shapes/index.ts';
import { CanvasController } from '../src/engine/CanvasController.ts';
import { setupMockDom } from './helpers/mockDom.ts';

describe('Shape Eraser Reticle Slicing & Bezier Preservation', () => {
    let nextId = 1;
    const uuid = () => `slice-${nextId++}`;
    const contentLeft = 0;
    const contentWidth = 1000;
    const blockTop = 0;

    test('deCasteljau divides cubic Bezier into exact halves at t = 0.5', () => {
        const p0 = { x: 0, y: 0 };
        const p1 = { x: 0, y: 100 };
        const p2 = { x: 100, y: 100 };
        const p3 = { x: 100, y: 0 };

        const { left, right } = deCasteljau(p0, p1, p2, p3, 0.5);

        // Point at t = 0.5 for this symmetric arch is at x = 50, y = 75
        assert.equal(left.p3.x, 50);
        assert.equal(left.p3.y, 75);
        assert.equal(right.p0.x, 50);
        assert.equal(right.p0.y, 75);
    });

    test('extractCubicSubcurve extracts exact arbitrary parameter intervals', () => {
        const p0 = { x: 0, y: 0 };
        const p1 = { x: 0, y: 100 };
        const p2 = { x: 100, y: 100 };
        const p3 = { x: 100, y: 0 };

        const sub = extractCubicSubcurve(p0, p1, p2, p3, 0.25, 0.75);
        // Start of subcurve matches curve at t = 0.25
        assert.ok(Math.abs(sub.p0.x - 15.625) < 1e-3);
        assert.ok(Math.abs(sub.p0.y - 56.25) < 1e-3);
        // End of subcurve matches curve at t = 0.75
        assert.ok(Math.abs(sub.p3.x - 84.375) < 1e-3);
        assert.ok(Math.abs(sub.p3.y - 56.25) < 1e-3);
    });

    test('reticle eraser cuts straight line into two independent line fragments', () => {
        // Horizontal line from x=100 to x=300 at y=100 (in normalized coords: 0.1 to 0.3)
        const line: ShapeElement = {
            id: 'line-1',
            type: 'shape',
            shapeType: 'line',
            startX: 0.1,
            startY: 0.1,
            endX: 0.3,
            endY: 0.1,
            style: { width: 2, color: '#000000' },
            bounds: { minX: 0.1, minY: 0.1, maxX: 0.3, maxY: 0.1 },
        };

        // Eraser hits at world x = 200 (normalized u = 0.2), y = 100 with radius 15
        const eraserPoints = [{ x: 200, y: 100 }];
        const radius = 15;

        const fragments = splitShapeDoc(line, eraserPoints, radius, contentLeft, contentWidth, blockTop, uuid);
        assert.ok(fragments !== null, 'Shape was hit and sliced');
        assert.equal(fragments.length, 2, 'Slices into exactly 2 fragments');

        // Fragment 1: from x=100 up to x ~ 185
        const f1 = fragments[0];
        assert.equal(f1.shapeType, 'line');
        assert.equal(Math.round(f1.startX * contentWidth), 100);
        assert.ok(f1.endX * contentWidth <= 186);
        assert.equal(f1.fillEnabled, false);

        // Fragment 2: from x ~ 215 up to x = 300
        const f2 = fragments[1];
        assert.equal(f2.shapeType, 'line');
        assert.ok(f2.startX * contentWidth >= 214);
        assert.equal(Math.round(f2.endX * contentWidth), 300);
        assert.equal(f2.fillEnabled, false);
    });

    test('reticle eraser cutting curved Bezier path preserves exact cubic tangents on both pieces', () => {
        // Curved arch from (100, 200) to (300, 200) with Bezier peak at y=100
        const curvedLine: ShapeElement = {
            id: 'curve-1',
            type: 'shape',
            shapeType: 'line',
            startX: 0.1,
            startY: 0.2,
            endX: 0.3,
            endY: 0.2,
            pathNodes: [
                { x: 0.1, y: 0.2, nodeKind: 'smooth', handleOut: { x: 0.1, y: 0.1 } },
                { x: 0.3, y: 0.2, nodeKind: 'smooth', handleIn: { x: 0.3, y: 0.1 } },
            ],
            style: { width: 2, color: '#000000' },
            bounds: { minX: 0.1, minY: 0.1, maxX: 0.3, maxY: 0.2 },
        };

        // Cut at top peak around x = 200, y = 125 with radius 12
        const eraserPoints = [{ x: 200, y: 125 }];
        const radius = 12;

        const fragments = splitShapeDoc(curvedLine, eraserPoints, radius, contentLeft, contentWidth, blockTop, uuid);
        assert.ok(fragments !== null, 'Curve was cut');
        assert.equal(fragments.length, 2, 'Produces two curved pieces');

        // Both fragments retain their pathNodes with Bezier tangents!
        const [c1, c2] = fragments;
        assert.ok(c1.pathNodes && c1.pathNodes.length >= 2);
        assert.ok(c2.pathNodes && c2.pathNodes.length >= 2);

        // c1 start node retains initial handleOut
        assert.ok(c1.pathNodes[0].handleOut !== undefined, 'c1 start node keeps handleOut');
        // c1 cut end has handleIn
        assert.ok(c1.pathNodes[c1.pathNodes.length - 1].handleIn !== undefined, 'c1 cut end has handleIn');

        // c2 cut start has handleOut
        assert.ok(c2.pathNodes[0].handleOut !== undefined, 'c2 cut start has handleOut');
        // c2 end node retains final handleIn
        assert.ok(c2.pathNodes[c2.pathNodes.length - 1].handleIn !== undefined, 'c2 end node keeps handleIn');
    });

    test('reticle eraser cuts filled rectangle into an open un-filled Bezier path', () => {
        // Rectangle from (100, 100) to (300, 200) with red solid fill
        const rect: ShapeElement = {
            id: 'rect-1',
            type: 'shape',
            shapeType: 'rectangle',
            startX: 0.1,
            startY: 0.1,
            endX: 0.3,
            endY: 0.2,
            fillEnabled: true,
            fillColor: '#FF0000',
            fillPattern: 'hachure',
            fillDensity: 3,
            style: { width: 2, color: '#000000' },
            bounds: { minX: 0.1, minY: 0.1, maxX: 0.3, maxY: 0.2 },
        };

        // Cut through the top edge at x = 200, y = 100 with radius 15
        const eraserPoints = [{ x: 200, y: 100 }];
        const radius = 15;

        const fragments = splitShapeDoc(rect, eraserPoints, radius, contentLeft, contentWidth, blockTop, uuid);
        assert.ok(fragments !== null, 'Rectangle was cut');
        assert.equal(fragments.length, 1, 'Cutting one edge turns closed rectangle into ONE continuous open path');

        const openPath = fragments[0];
        // 1. Converted to open line
        assert.equal(openPath.shapeType, 'line');
        // 2. Fill is strictly removed
        assert.equal(openPath.fillEnabled, false);
        assert.equal(openPath.fillColor, undefined);
        assert.equal(openPath.fillPattern, undefined);

        // 3. Shape remains a multi-segment path with corners
        assert.ok(openPath.pathNodes && openPath.pathNodes.length >= 4);
        // Start and end are on the top edge (cut boundaries)
        assert.ok(Math.abs(openPath.pathNodes[0].y * contentWidth - 100) < 1);
        assert.ok(Math.abs(openPath.pathNodes[openPath.pathNodes.length - 1].y * contentWidth - 100) < 1);
    });

    test('reticle eraser cutting across filled ellipse splits into two un-filled curved arcs', () => {
        // Ellipse centered at (200, 200) with rx = 80, ry = 60 (x in [120, 280], y in [140, 260])
        const ellipse: ShapeElement = {
            id: 'ellipse-1',
            type: 'shape',
            shapeType: 'ellipse',
            startX: 0.12,
            startY: 0.14,
            endX: 0.28,
            endY: 0.26,
            fillEnabled: true,
            fillColor: '#00FF00',
            fillPattern: 'dots',
            style: { width: 2, color: '#000000' },
            bounds: { minX: 0.12, minY: 0.14, maxX: 0.28, maxY: 0.26 },
        };

        // Vertical eraser swipe down the center from y=120 to y=280 at x=200, cutting top and bottom edges
        const eraserPoints = [
            { x: 200, y: 120 },
            { x: 200, y: 280 },
        ];
        const radius = 12;

        const fragments = splitShapeDoc(ellipse, eraserPoints, radius, contentLeft, contentWidth, blockTop, uuid);
        assert.ok(fragments !== null, 'Ellipse was cut');
        assert.equal(fragments.length, 2, 'Cutting through top and bottom produces TWO open curved arcs');

        for (const arc of fragments) {
            // Fill is removed
            assert.equal(arc.fillEnabled, false);
            assert.equal(arc.fillColor, undefined);
            // Converted to open line path
            assert.equal(arc.shapeType, 'line');
            // Retains smooth cubic Bezier nodes
            assert.ok(arc.pathNodes && arc.pathNodes.length >= 2);
            const hasBezier = arc.pathNodes.some(n => n.handleIn || n.handleOut);
            assert.ok(hasBezier, 'Arc retains cubic Bezier curvature');
        }
    });

    test('reticle eraser cutting cylinder preserves exact 3D curves and does NOT turn into a square', () => {
        // Cylinder from (100, 100) to (300, 400) in world coordinates (normalized 0.1 to 0.3, 0.1 to 0.4)
        const cylinder: ShapeElement = {
            id: 'cyl-1',
            type: 'shape',
            shapeType: 'cylinder',
            startX: 0.1,
            startY: 0.1,
            endX: 0.3,
            endY: 0.4,
            shapeParams: { capRatio: 0.22 },
            fillEnabled: true,
            fillColor: '#0088FF',
            fillPattern: 'hachure',
            style: { width: 2, color: '#000000' },
            bounds: { minX: 0.1, minY: 0.1, maxX: 0.3, maxY: 0.4 },
        };

        // Cut through the left wall of the cylinder at x = 100, y = 250 with radius 15
        const eraserPoints = [{ x: 100, y: 250 }];
        const radius = 15;

        const fragments = splitShapeDoc(cylinder, eraserPoints, radius, contentLeft, contentWidth, blockTop, uuid);
        assert.ok(fragments !== null, 'Cylinder was cut');
        assert.ok(fragments.length >= 1, 'Produces sliced cylinder fragments');

        // Verify fill is removed
        for (const frag of fragments) {
            assert.equal(frag.fillEnabled, false, 'Fill is strictly disabled');
            assert.equal(frag.fillColor, undefined);
            assert.equal(frag.shapeType, 'line', 'Converted to editable open Bezier line path');
        }

        // Verify that it retained the curved caps and did NOT degrade into a 4-corner square
        const mainFrag = fragments.find(f => f.pathNodes && f.pathNodes.length > 4);
        assert.ok(mainFrag !== undefined, 'Main cylinder fragment exists');
        const hasCubicCurves = mainFrag.pathNodes!.some(n => n.handleIn || n.handleOut);
        assert.ok(hasCubicCurves, 'Cylinder retains 3D curved top cap and bottom base Bezier handles');

        // Check node count: an un-degraded sliced cylinder silhouette has at least 6 nodes, not a 4-node square
        assert.ok(mainFrag.pathNodes!.length >= 6, `Main fragment has ${mainFrag.pathNodes!.length} nodes (NOT a 4-node square)`);
    });

    test('distant eraser gesture returns null leaving shape untouched', () => {
        const rect: ShapeElement = {
            id: 'rect-miss',
            type: 'shape',
            shapeType: 'rectangle',
            startX: 0.1,
            startY: 0.1,
            endX: 0.3,
            endY: 0.3,
            style: { width: 2, color: '#000000' },
            bounds: { minX: 0.1, minY: 0.1, maxX: 0.3, maxY: 0.3 },
        };

        // Eraser gesture at x = 800, y = 800 (far away)
        const eraserPoints = [{ x: 800, y: 800 }];
        const radius = 15;

        const fragments = splitShapeDoc(rect, eraserPoints, radius, contentLeft, contentWidth, blockTop, uuid);
        assert.equal(fragments, null, 'Miss returns null');
    });

    test('rounded rectangle respects cornerRadius cubic arcs when sliced and tested at cut corner', () => {
        const roundedRect: ShapeElement = {
            id: 'rect-rounded',
            type: 'shape',
            shapeType: 'rectangle',
            startX: 0.1, // x = 100
            startY: 0.1, // y = 100
            endX: 0.3,   // x = 300 (W = 200)
            endY: 0.3,   // y = 300 (H = 200)
            cornerRadius: 48,
            style: { width: 2, color: '#000000' },
            bounds: { minX: 0.1, minY: 0.1, maxX: 0.3, maxY: 0.3 },
        };

        // Outside the rounded arc but inside sharp bounding corner (102, 102) must NOT falsely slice
        const cornerMiss = splitShapeDoc(roundedRect, [{ x: 102, y: 102 }], 5, contentLeft, contentWidth, blockTop, uuid);
        assert.equal(cornerMiss, null, 'Eraser inside trimmed corner void must not hit rounded rectangle');

        // Slicing the top straight edge preserves cubic handles on rounded corners
        const sliced = splitShapeDoc(roundedRect, [{ x: 200, y: 100 }], 12, contentLeft, contentWidth, blockTop, uuid);
        assert.ok(sliced && sliced.length >= 1, 'Rounded rectangle must slice on its top edge');
        const hasCurves = sliced![0].pathNodes!.some(n => Boolean(n.handleIn || n.handleOut));
        assert.ok(hasCurves, 'Sliced rounded rectangle must retain corner Bezier handles');
    });

    test('custom shape plugin subpaths drive shapeToBoundaryPaths instead of 4-corner fallback', () => {
        const pentagonId = 'custom-pentagon-test' as any;
        registerShapePlugin(createCustomShapePlugin({
            id: pentagonId,
            name: 'Pentágono Curvo',
            commands: [
                { type: 'M', args: [0.5, 0] },
                { type: 'L', args: [1, 0.4] },
                { type: 'L', args: [0.8, 1] },
                { type: 'L', args: [0.2, 1] },
                { type: 'Q', args: [0, 0.5, 0, 0.4] },
                { type: 'Z', args: [] },
            ],
        }));

        const customShape: ShapeElement = {
            id: 'custom-1',
            type: 'shape',
            shapeType: pentagonId,
            startX: 0.1,
            startY: 0.1,
            endX: 0.3,
            endY: 0.3,
            style: { width: 2, color: '#1F4FD8' },
            bounds: { minX: 0.1, minY: 0.1, maxX: 0.3, maxY: 0.3 },
        };

        const paths = shapeToBoundaryPaths(customShape, contentLeft, blockTop, contentWidth);
        assert.equal(paths.length, 1);
        assert.equal(paths[0].nodes.length, 5, 'Must extract all 5 custom contour vertices instead of 4-corner fallback');
        assert.ok(paths[0].nodes.some(n => Boolean(n.handleIn || n.handleOut)), 'Quadratic segment must elevate to cubic Bezier handles');
    });

    test('CanvasController eraser.onlyHighlighter erases highlighters while preserving pen strokes and shapes', () => {
        const { env, teardown } = setupMockDom();
        try {
            const scroller = env.mockDocument.createElement('div');
            scroller.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 } as DOMRect);

            const penStroke: StrokeElement = {
                id: 'pen-1',
                type: 'stroke',
                timestamp: 1,
                zIndex: 0,
                blockId: 'line:0',
                anchorText: '',
                points: [0.1, 0.1, 0.5, 1, 0.3, 0.1, 0.5, 2],
                style: { color: '#111827', width: 3, opacity: 1, pattern: 'solid', isHighlighter: false },
                bounds: { minX: 0.1, maxX: 0.3, minY: 0.1, maxY: 0.1 },
            };
            const hlStroke: StrokeElement = {
                id: 'hl-1',
                type: 'stroke',
                timestamp: 2,
                zIndex: 1,
                blockId: 'line:0',
                anchorText: '',
                points: [0.1, 0.1, 0.5, 3, 0.3, 0.1, 0.5, 4],
                style: { color: '#F5C400', width: 16, opacity: 0.4, pattern: 'solid', profile: 'hlr', isHighlighter: true },
                bounds: { minX: 0.1, maxX: 0.3, minY: 0.1, maxY: 0.1 },
            };
            const rectShape: ShapeElement = {
                id: 'shape-1',
                type: 'shape',
                shapeType: 'rectangle',
                timestamp: 3,
                zIndex: 2,
                blockId: 'line:0',
                startX: 0.1,
                startY: 0.08,
                endX: 0.3,
                endY: 0.12,
                style: { color: '#1F4FD8', width: 3, opacity: 1, pattern: 'solid' },
                bounds: { minX: 0.1, minY: 0.08, maxX: 0.3, maxY: 0.12 },
            };

            const docModel = { id: 'doc-hl', version: 2, elements: [penStroke, hlStroke, rectShape], blocks: {} } as any;
            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                { path: 'hl.md', basename: 'hl' } as any,
                'hl.md',
                { flush: async () => {}, enqueue: () => {} } as any,
                {
                    palmRejectionCooldownMs: 400,
                    autoSaveDebounceMs: 500,
                    defaultPenColor: '#1F4FD8',
                    defaultPenWidth: 3,
                    enabled: true,
                    enableMouseDrawing: false,
                    shapeRecognition: false,
                    straightenLines: false,
                    app: { metadataCache: { getFileCache: () => null }, vault: { cachedRead: async () => '' } } as any,
                },
            );

            const nextToolState = controller.getToolState();
            nextToolState.eraser.onlyHighlighter = true;
            nextToolState.activeTool = 'eraser';
            controller.applyWorkspaceToolState(nextToolState);
            const changed = (controller as any).eraseAtPoints([{ x: 160, y: 80 }]);
            assert.equal(changed, true);
            assert.deepEqual(docModel.elements.map((e: any) => e.id), ['pen-1', 'shape-1']);
            controller.destroy();
        } finally {
            teardown();
        }
    });
});
