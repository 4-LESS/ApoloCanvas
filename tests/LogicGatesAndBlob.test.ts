import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    SHAPE_REGISTRY,
    getShapePlugin,
    findNearestSnapPort,
    followBoundConnectors,
    autoAlignConnectorTangents,
    getPortNormal,
    shapeElementToGeometry,
    applyGeometryToShapeElement,
    fitClosedBlobPathNodes,
    getClosedPathBounds,
    buildBlobGeometryFromPoints,
    boxSnapPorts,
    type ShapeRenderGeometry,
    type ShapeStyleConfig,
} from '../src/engine/shapes/index.ts';
import {
    type CanvasElement,
    type ShapeElement,
    type WorkspaceToolState,
} from '../src/core/types.ts';
import { splitShapeDoc } from '../src/engine/eraser/ShapeEraser.ts';
import { renderElement } from '../src/io/PersistenceQueue.ts';
import { createShapePreview } from '../src/ui/favorites/FavoritesDrawer.ts';
import {
    assertNear as near,
    CONTENT_WIDTH,
    createMockCanvasCtx,
    createTestController,
    createTestEstuche,
    createTestToolbar,
    identityAdapter,
    makeShape,
    pointer,
    setupMockDom,
} from './helpers/mockDom.ts';

const LOGIC_GATE_IDS = [
    'gate-and',
    'gate-or',
    'gate-not',
    'gate-nand',
    'gate-nor',
    'gate-xor',
    'gate-xnor',
] as const;

const createController = (configure: (state: WorkspaceToolState) => void) =>
    createTestController(configure, { notePath: 'logic-blob.md' });

describe('Logic gates & closed fillable freeform blob shape', () => {
    let dom: ReturnType<typeof setupMockDom>;

    beforeEach(() => {
        dom = setupMockDom();
    });

    afterEach(() => {
        dom.teardown();
    });

    test('logic gates: registry, category, aliases and icon paths', () => {
        for (const id of LOGIC_GATE_IDS) {
            const plugin = SHAPE_REGISTRY[id];
            assert.ok(plugin, `${id} registered`);
            assert.equal(getShapePlugin(id), plugin);
            assert.equal(plugin.category, 'electrical-logic');
            assert.equal(plugin.isClosed, true);
            assert.ok(plugin.iconSvgPaths.length > 0);
        }

        assert.equal(getShapePlugin('and').id, 'gate-and');
        assert.equal(getShapePlugin('or').id, 'gate-or');
        assert.equal(getShapePlugin('not').id, 'gate-not');
        assert.equal(getShapePlugin('inverter').id, 'gate-not');
        assert.equal(getShapePlugin('nand').id, 'gate-nand');
        assert.equal(getShapePlugin('nor').id, 'gate-nor');
        assert.equal(getShapePlugin('xor').id, 'gate-xor');
        assert.equal(getShapePlugin('xnor').id, 'gate-xnor');
    });

    test('logic gates: terminal snap ports & outward normals across normal, inverted and rotated boxes', () => {
        const box: ShapeRenderGeometry = { x0: 100, y0: 200, x1: 200, y1: 300 };
        const invertedBox: ShapeRenderGeometry = { x0: 200, y0: 300, x1: 100, y1: 200 };

        assert.deepEqual(getShapePlugin('gate-not').getSnapPorts(box), [
            { id: 'in', x: 100, y: 250, nx: -1, ny: 0 },
            { id: 'out', x: 200, y: 250, nx: 1, ny: 0 },
        ]);
        assert.deepEqual(getShapePlugin('gate-not').getSnapPorts(invertedBox), getShapePlugin('gate-not').getSnapPorts(box));

        for (const id of ['gate-and', 'gate-or', 'gate-nand', 'gate-nor', 'gate-xor', 'gate-xnor']) {
            const ports = getShapePlugin(id).getSnapPorts(box);
            assert.deepEqual(ports, [
                { id: 'in1', x: 100, y: 230, nx: -1, ny: 0 },
                { id: 'in2', x: 100, y: 270, nx: -1, ny: 0 },
                { id: 'out', x: 200, y: 250, nx: 1, ny: 0 },
            ], `${id} terminal ports`);
            assert.deepEqual(getShapePlugin(id).getSnapPorts(invertedBox), ports, `${id} inverted box ports`);
        }

        // Rotation 90° clockwise around (150, 250): in1 local (-50, -20) -> (+20, -50) => (170, 200), normal (0, -1)
        const andRot90 = getShapePlugin('gate-and').getSnapPorts({ ...box, rotation: Math.PI / 2 });
        const in1_90 = andRot90.find(p => p.id === 'in1')!;
        const in2_90 = andRot90.find(p => p.id === 'in2')!;
        const out_90 = andRot90.find(p => p.id === 'out')!;
        near(in1_90.x, 170); near(in1_90.y, 200); near(in1_90.nx!, 0); near(in1_90.ny!, -1);
        near(in2_90.x, 130); near(in2_90.y, 200); near(in2_90.nx!, 0); near(in2_90.ny!, -1);
        near(out_90.x, 150); near(out_90.y, 300); near(out_90.nx!, 0); near(out_90.ny!, 1);

        // Rotation 180° around (150, 250) swaps left/right normals
        const notRot180 = getShapePlugin('gate-not').getSnapPorts({ ...box, rotation: Math.PI });
        const in180 = notRot180.find(p => p.id === 'in')!;
        const out180 = notRot180.find(p => p.id === 'out')!;
        near(in180.x, 200); near(in180.y, 250); near(in180.nx!, 1); near(in180.ny!, 0);
        near(out180.x, 100); near(out180.y, 250); near(out180.nx!, -1); near(out180.ny!, 0);

        const nIn = getPortNormal('in', Math.PI / 2);
        const nOut = getPortNormal('out', Math.PI);
        near(nIn.nx, 0); near(nIn.ny, -1);
        near(nOut.nx, -1); near(nOut.ny, 0);
    });

    test('logic gates: magnetic connector binding, followBoundConnectors and autoAlignConnectorTangents', () => {
        const andGate = makeShape('g-and', 'gate-and', 100, 100, 220, 180);
        const notGate = makeShape('g-not', 'gate-not', 320, 100, 420, 180);
        const wire = makeShape('w-logic', 'line', 220, 140, 320, 140, {
            startBinding: { elementId: 'g-and', portId: 'out' },
            endBinding: { elementId: 'g-not', portId: 'in' },
        });
        const elements: CanvasElement[] = [andGate, notGate, wire];

        const hit = findNearestSnapPort(elements, { x: 222, y: 138 }, 14, identityAdapter);
        assert.equal(hit?.elementId, 'g-and');
        assert.equal(hit?.portId, 'out');

        const hitIn2 = findNearestSnapPort(elements, { x: 98, y: 158 }, 14, identityAdapter);
        assert.equal(hitIn2?.elementId, 'g-and');
        assert.equal(hitIn2?.portId, 'in2');

        // Rotate AND gate 90 degrees -> 'out' moves from (220, 140) to (160, 200)
        andGate.rotation = Math.PI / 2;
        const moved = followBoundConnectors(elements, new Set(['g-and']), identityAdapter);
        assert.deepEqual(moved, [wire]);
        near(wire.startX, 160);
        near(wire.startY, 200);
        near(wire.endX, 320);
        near(wire.endY, 140);

        const aligned = autoAlignConnectorTangents(
            {
                x0: wire.startX,
                y0: wire.startY,
                x1: wire.endX,
                y1: wire.endY,
                pathNodes: [
                    { x: wire.startX, y: wire.startY, nodeKind: 'smooth' },
                    { x: wire.endX, y: wire.endY, nodeKind: 'smooth' },
                ],
            },
            wire,
            elements,
            identityAdapter,
        );
        // Rotated AND 'out' exits downward (+Y); unrotated NOT 'in' receives from the left (-X -> handleIn shifts left)
        assert.ok(aligned.pathNodes![0].handleOut!.y > wire.startY, 'AND out tangent follows +Y after 90° rotation');
        assert.ok(aligned.pathNodes![1].handleIn!.x < wire.endX, 'NOT in tangent arrives along -X');
    });

    test('logic gates: fill paints only the chamber while leaving inversion bubbles hollow, and supports reticle slicing', () => {
        const geom: ShapeRenderGeometry = { x0: 0, y0: 0, x1: 120, y1: 80 };
        const styleWithFill: ShapeStyleConfig = {
            strokeColor: '#111827',
            strokeWidth: 2,
            strokeOpacity: 1,
            fillEnabled: true,
            fillColor: '#2F6BFF',
            fillPattern: 'solid',
            fillOpacity: 0.45,
        };

        for (const id of LOGIC_GATE_IDS) {
            const plugin = getShapePlugin(id);
            const canvasMock = createMockCanvasCtx();
            plugin.renderCanvas(canvasMock.ctx, geom, styleWithFill);
            assert.equal(canvasMock.fills.length, 1, `${id} fills exactly one chamber on canvas`);
            assert.ok(canvasMock.strokes.length >= 1, `${id} strokes chamber + leads (+ bubble)`);

            const svg = plugin.renderSvg(geom, styleWithFill);
            const bodyFillMatches = svg.body.match(/fill="#2F6BFF"/g) ?? [];
            assert.equal(bodyFillMatches.length, 1, `${id} SVG fills only the body chamber`);
        }

        // Inverting gates keep the negation bubble explicitly unfilled
        for (const id of ['gate-not', 'gate-nand', 'gate-nor', 'gate-xnor']) {
            const svg = getShapePlugin(id).renderSvg(geom, styleWithFill);
            assert.ok(svg.body.includes('fill="none"'), `${id} keeps bubble/leads unfilled`);
        }

        let seq = 0;
        const uuid = () => `gate-frag-${++seq}`;
        // u=0.18 -> x=127 hits the left vertical wall of gate-and's chamber
        const andFrags = splitShapeDoc(makeShape('slice-and', 'gate-and', 0.1, 0.2, 0.25, 0.3), [{ x: 127, y: 250 }], 16, 0, 1000, 0, uuid);
        assert.ok(andFrags && andFrags.length >= 1, 'gate-and splits cleanly with reticle eraser');
        for (const frag of andFrags) {
            assert.equal(frag.shapeType, 'line');
            assert.ok((frag.pathNodes?.length ?? 0) >= 2);
        }

        // u=0.20 -> x=130 hits gate-not input lead + left base of the triangle
        const notFrags = splitShapeDoc(makeShape('slice-not', 'gate-not', 0.1, 0.2, 0.25, 0.3), [{ x: 130, y: 250 }], 16, 0, 1000, 0, uuid);
        assert.ok(notFrags && notFrags.length >= 1, 'gate-not splits cleanly with reticle eraser');
    });

    test('blob: freehand contour fitting auto-closes smoothly, computes exact Bezier bounds and handles degenerate input', () => {
        const openArc = [
            { x: 120, y: 100 },
            { x: 180, y: 90 },
            { x: 240, y: 120 },
            { x: 250, y: 180 },
            { x: 210, y: 230 },
            { x: 140, y: 225 },
            { x: 100, y: 170 },
        ];
        const fitted = fitClosedBlobPathNodes(openArc);
        assert.ok(fitted.length >= 4);
        assert.ok(fitted.some(n => n.handleOut && n.handleIn), 'Produces smooth cubic handles');

        const blobGeom = buildBlobGeometryFromPoints(openArc);
        const exactBounds = getClosedPathBounds(blobGeom.pathNodes!);
        near(blobGeom.x0, exactBounds.minX);
        near(blobGeom.y0, exactBounds.minY);
        near(blobGeom.x1, exactBounds.maxX);
        near(blobGeom.y1, exactBounds.maxY);

        const plugin = getShapePlugin('blob');
        assert.equal(plugin.category, 'geometric');
        assert.equal(plugin.isClosed, true);

        const mockCtx = createMockCanvasCtx();
        plugin.renderCanvas(mockCtx.ctx, blobGeom, {
            strokeColor: '#1F4FD8',
            strokeWidth: 3,
            strokeOpacity: 1,
            fillEnabled: false,
        });
        assert.ok(mockCtx.closedCount >= 1, 'Canvas stroke closes the blob loop');
        assert.equal(mockCtx.strokes.length, 1);

        const svg = plugin.renderSvg(blobGeom, { strokeColor: '#1F4FD8', strokeWidth: 3 });
        assert.ok(svg.body.trim().startsWith('<path d="M '));
        assert.ok(svg.body.includes('C '), 'Blob SVG uses cubic Bezier curves');
        assert.ok(svg.body.includes(' Z"'), 'Blob SVG path explicitly closes with Z');

        // Collinear/short strokes still yield a valid closed fallback shape
        const tiny = buildBlobGeometryFromPoints([{ x: 10, y: 20 }, { x: 12, y: 20 }]);
        assert.ok((tiny.pathNodes?.length ?? 0) >= 4);
        assert.ok(tiny.x1 > tiny.x0 && tiny.y1 > tiny.y0);
    });

    test('blob: hitTest (interior + rotated), all fill patterns, resize/flip/rotate/snapPorts and eraser slicing', () => {
        const plugin = getShapePlugin('blob');
        const geom = buildBlobGeometryFromPoints([
            { x: 100, y: 100 },
            { x: 240, y: 100 },
            { x: 250, y: 200 },
            { x: 100, y: 210 },
        ]);

        // Unrotated interior & exterior hitTest
        assert.equal(plugin.hitTest(geom, { x: 175, y: 155 }, 6), true, 'Hits blob interior even when fill is off');
        assert.equal(plugin.hitTest(geom, { x: 400, y: 400 }, 6), false, 'Misses far outside blob');

        // Wide oblong blob rotated 90 degrees -> tall vertical blob
        const wideGeom = buildBlobGeometryFromPoints([
            { x: 100, y: 140 },
            { x: 300, y: 140 },
            { x: 300, y: 180 },
            { x: 100, y: 180 },
        ]);
        const cx = (wideGeom.x0 + wideGeom.x1) / 2;
        const cy = (wideGeom.y0 + wideGeom.y1) / 2;
        const rot90: ShapeRenderGeometry = { ...wideGeom, rotation: Math.PI / 2 };
        assert.equal(plugin.hitTest(rot90, { x: cx, y: cy + 60 }, 4), true, 'Rotated blob hits rotated vertical lobe');
        assert.equal(plugin.hitTest(rot90, { x: cx + 70, y: cy }, 4), false, 'Rotated blob misses old horizontal lobe');

        // Fills: solid, hachure, cross-hatch, dots
        for (const fillPattern of ['solid', 'hachure', 'cross-hatch', 'dots'] as const) {
            const style: ShapeStyleConfig = {
                strokeColor: '#0F172A',
                strokeWidth: 2,
                strokeOpacity: 1,
                fillEnabled: true,
                fillColor: '#10B981',
                fillPattern,
                fillOpacity: 0.5,
                fillDensity: 0.6,
            };
            const c = createMockCanvasCtx();
            plugin.renderCanvas(c.ctx, geom, style);
            assert.ok(c.fills.length >= 1, `Canvas renders ${fillPattern} fill`);
            assert.ok(c.strokes.length >= 1, `Canvas draws contour for ${fillPattern}`);

            const s = plugin.renderSvg(geom, style);
            assert.equal(s.body.includes('fill="none"'), false, `SVG emits fill for ${fillPattern}`);
            if (fillPattern === 'solid') {
                assert.ok(s.body.includes('fill="#10B981"'));
            } else {
                assert.ok(Object.keys(s.defs).length >= 1 && s.body.includes('url(#'), `SVG ${fillPattern} emits pattern def`);
            }
        }

        // Resize, flipped drag, 1:1 regularize, rotation & boxSnapPorts
        const enlarged = plugin.applyHandleDrag(geom, 'se', { x: 360, y: 310 }, false);
        assert.ok(enlarged.x1 > geom.x1 && enlarged.y1 > geom.y1);
        assert.ok((enlarged.pathNodes?.length ?? 0) === geom.pathNodes!.length);

        const flipped = plugin.applyHandleDrag(geom, 'se', { x: 40, y: 50 }, false);
        assert.ok(flipped.x0 < geom.x0 && flipped.y0 < geom.y0);
        assert.ok((flipped.pathNodes?.length ?? 0) === geom.pathNodes!.length);

        const squared = plugin.applyHandleDrag(geom, 'se', { x: 360, y: 260 }, true);
        near(squared.x1 - squared.x0, squared.y1 - squared.y0, 1);

        const rotated = plugin.applyHandleDrag(geom, 'rotate', { x: (geom.x0 + geom.x1) / 2 + 100, y: (geom.y0 + geom.y1) / 2 }, false);
        assert.ok(Math.abs(rotated.rotation ?? 0) > 0.1);

        assert.deepEqual(plugin.getSnapPorts(geom), boxSnapPorts(geom));

        // Reticle eraser splitShapeDoc on closed blob
        const normGeom = buildBlobGeometryFromPoints([
            { x: 100, y: 100 },
            { x: 250, y: 100 },
            { x: 250, y: 250 },
            { x: 100, y: 250 },
        ]);
        const blobEl = makeShape(
            'blob-slice',
            'blob',
            normGeom.x0 / 1000,
            normGeom.y0 / 1000,
            normGeom.x1 / 1000,
            normGeom.y1 / 1000,
            {
                pathNodes: normGeom.pathNodes!.map(n => ({
                    x: n.x / 1000,
                    y: n.y / 1000,
                    ...(n.handleIn ? { handleIn: { x: n.handleIn.x / 1000, y: n.handleIn.y / 1000 } } : {}),
                    ...(n.handleOut ? { handleOut: { x: n.handleOut.x / 1000, y: n.handleOut.y / 1000 } } : {}),
                    nodeKind: n.nodeKind,
                })),
            },
        );
        let fragIdx = 0;
        const frags = splitShapeDoc(blobEl, [{ x: 250, y: 175 }], 22, 0, 1000, 0, () => `b-frag-${++fragIdx}`);
        assert.ok(frags && frags.length >= 1, 'Closed blob slices cleanly with reticle eraser');
        for (const f of frags) {
            assert.equal(f.shapeType, 'line');
            assert.ok((f.pathNodes?.length ?? 0) >= 2);
        }
    });

    test('CanvasController end-to-end: blob closed loop finishing on start point, tap select, live paintActive, reactive fill & SVG export', () => {
        const { controller, canvas, internals } = createController(state => {
            state.activeTool = 'shape';
            state.shape.shapeType = 'blob';
            state.shape.color = '#1F4FD8';
            state.shape.fillEnabled = false;
        });

        // Draw an organic loop that returns right back to the starting point (250, 120)
        pointer(canvas, 'pointerdown', 250, 120);
        const loopPts: Array<[number, number]> = [
            [320, 115],
            [370, 165],
            [355, 235],
            [275, 250],
            [210, 200],
            [220, 135],
            [250.5, 120.5],
        ];
        for (const [x, y] of loopPts) {
            pointer(canvas, 'pointermove', x, y);
        }

        // Exercise live preview path while active points exist
        const liveMock = createMockCanvasCtx();
        internals.context = liveMock.ctx;
        assert.doesNotThrow(() => internals.paintActive());
        assert.equal(liveMock.strokes.length, 1, 'paintActive renders live blob contour');
        assert.ok(liveMock.closedCount >= 1, 'paintActive renders closed blob contour');

        pointer(canvas, 'pointerup', 250.5, 120.5);

        const created = controller.getDocument().elements.filter((el): el is ShapeElement => el.type === 'shape');
        assert.equal(created.length, 1, 'Closed freehand loop returning to start is NOT treated as a tap');
        const blob = created[0];
        assert.equal(blob.shapeType, 'blob');
        assert.equal(blob.regularize, false);
        assert.ok((blob.pathNodes?.length ?? 0) >= 4, 'Persists fitted pathNodes on ShapeElement');
        assert.ok(blob.endX - blob.startX > 0.12 && blob.endY - blob.startY > 0.10, 'Stores full loop bounding box');

        // A true stationary tap inside the blob selects it instead of creating a second shape
        pointer(canvas, 'pointerdown', 290, 180);
        pointer(canvas, 'pointerup', 290.5, 180.5);
        assert.equal(controller.getDocument().elements.length, 1);
        assert.deepEqual(internals.selection.map((el: CanvasElement) => el.id), [blob.id], 'Stationary tap selects the blob');

        // Reactive property bar fill change updates selected blob & renders closed SVG with fill
        internals.estuche.callbacks.onChangeFillPattern('hachure');
        internals.estuche.callbacks.onChangeFillColor('#E11D48');
        assert.equal(blob.fillEnabled, true);
        assert.equal(blob.fillPattern, 'hachure');
        assert.equal(blob.fillColor, '#E11D48');

        const svgOut = renderElement(blob, CONTENT_WIDTH);
        assert.ok(svgOut.includes('<path d="M ') && svgOut.includes(' Z"'));
        assert.ok(svgOut.includes('url(#'), 'SVG export emits hachure pattern fill reference');

        controller.destroy();
    });

    test('UI integrates Puertas lógicas pages (5-6), blob on page 2, Toolbar & FavoritesDrawer preview', () => {
        const selected: string[] = [];
        const { estuche } = createTestEstuche(
            { tool: 'shape', smoothing: 0.5, eraserRadius: 15, lassoMode: 'free', shapeType: 'gate-and' },
            { onSelectShapeType: (s) => { selected.push(s); } },
            (globalThis as any).document.body,
        );
        estuche.open(undefined, (globalThis as any).document.createElement('button'));

        const pages = estuche.container.querySelectorAll('.shape-page');
        assert.equal(pages.length, 6);
        assert.deepEqual(
            pages[1].querySelectorAll('.shape-btn').map((b: any) => b.getAttribute('data-s')),
            ['diamond', 'hexagon', 'cylinder', 'blob'],
        );
        assert.deepEqual(
            pages[4].querySelectorAll('.shape-btn').map((b: any) => b.getAttribute('data-s')),
            ['gate-and', 'gate-or', 'gate-not', 'gate-nand', 'gate-nor'],
        );
        assert.deepEqual(
            pages[5].querySelectorAll('.shape-btn').map((b: any) => b.getAttribute('data-s')),
            ['gate-xor', 'gate-xnor'],
        );

        const dots = estuche.container.querySelector('.shape-pager').querySelectorAll('.dot');
        assert.ok(dots[4].classList.contains('is-active'), 'Opens directly to the active logic gate page');
        assert.equal((estuche as any).isActiveShapeClosed(), true, 'Logic gate allows fill controls');

        pages[1].querySelectorAll('.shape-btn')[3].click();
        assert.deepEqual(selected, ['blob']);
        assert.equal((estuche as any).isActiveShapeClosed(), true, 'Blob allows fill controls');
        estuche.destroy();

        const { toolbar } = createTestToolbar({
            activeTool: 'shape',
            activeShape: 'gate-nand',
            activeColor: '#000',
            activeWidth: 2,
            favorites: [],
            eraserRadius: 15,
        });
        const wrap = toolbar.getToolButton('shape')!.querySelector('.apolo-tool-icon-wrap') as any;
        assert.equal(wrap.getAttribute('data-shape'), 'gate-nand');
        assert.equal(wrap.querySelector('path').getAttribute('d'), getShapePlugin('gate-nand').iconSvgPaths.join(' '));

        toolbar.setShape('blob');
        assert.equal(wrap.getAttribute('data-shape'), 'blob');
        assert.equal(wrap.querySelector('path').getAttribute('d'), getShapePlugin('blob').iconSvgPaths.join(' '));

        const previewGate = createShapePreview({
            id: 'fav-gate',
            tool: 'shape',
            shapeType: 'gate-xnor',
            color: '#111111',
            width: 2,
            opacity: 1,
            pattern: 'solid',
            createdAt: 0,
        } as any) as any;
        assert.equal(previewGate.getAttribute('viewBox'), '0 0 64 64');
        assert.ok(previewGate.querySelectorAll('path').length >= 1);

        const previewBlob = createShapePreview({
            id: 'fav-blob',
            tool: 'shape',
            shapeType: 'blob',
            color: '#111111',
            width: 2,
            opacity: 1,
            pattern: 'solid',
            createdAt: 0,
        } as any) as any;
        assert.equal(previewBlob.getAttribute('viewBox'), '0 0 64 64');
        assert.ok(previewBlob.querySelectorAll('path').length >= 1);
    });
});
