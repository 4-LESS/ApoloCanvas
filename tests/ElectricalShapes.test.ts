import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    SHAPE_REGISTRY,
    getShapePlugin,
    findNearestSnapPort,
    followBoundConnectors,
    autoAlignConnectorTangents,
    type ShapeRenderGeometry,
    type ShapeStyleConfig,
} from '../src/engine/shapes/index.ts';
import {
    type CanvasElement,
    type ShapeElement,
} from '../src/core/types.ts';
import { splitShapeDoc } from '../src/engine/eraser/ShapeEraser.ts';
import { createShapePreview } from '../src/ui/favorites/FavoritesDrawer.ts';
import {
    assertNear as near,
    createMockCanvasCtx,
    createTestEstuche,
    createTestToolbar,
    identityAdapter,
    makeShape,
    setupMockDom,
} from './helpers/mockDom.ts';

const ELECTRICAL_IDS = [
    'resistor',
    'capacitor',
    'power-source',
    'ground',
    'transistor-npn',
    'transistor-pnp',
    'transistor-mosfet',
] as const;

describe('Electrical diagram shapes & terminal snap ports', () => {
    let dom: ReturnType<typeof setupMockDom>;

    beforeEach(() => {
        dom = setupMockDom();
    });

    afterEach(() => {
        dom.teardown();
    });

    test('registry exposes all 7 electrical components, metadata and aliases', () => {
        for (const id of ELECTRICAL_IDS) {
            const plugin = SHAPE_REGISTRY[id];
            assert.ok(plugin, `${id} registered in SHAPE_REGISTRY`);
            assert.equal(getShapePlugin(id), plugin);
            assert.equal(plugin.isClosed, true, `${id} behaves as a connectable component`);
            assert.ok(plugin.iconSvgPaths.length > 0, `${id} has toolbar/estuche icon paths`);
        }

        for (const id of ['resistor', 'capacitor', 'power-source', 'ground']) {
            assert.equal(getShapePlugin(id).category, 'electrical-basic');
        }
        for (const id of ['transistor-npn', 'transistor-pnp', 'transistor-mosfet']) {
            assert.equal(getShapePlugin(id).category, 'electrical-transistor');
        }

        assert.equal(getShapePlugin('voltage-source').id, 'power-source');
        assert.equal(getShapePlugin('npn').id, 'transistor-npn');
        assert.equal(getShapePlugin('pnp').id, 'transistor-pnp');
        assert.equal(getShapePlugin('mosfet').id, 'transistor-mosfet');
    });

    test('snap ports map to exact terminal coordinates and outward normals, invariant to inverted drag', () => {
        const normalBox: ShapeRenderGeometry = { x0: 100, y0: 200, x1: 200, y1: 250 };
        const invertedBox: ShapeRenderGeometry = { x0: 200, y0: 250, x1: 100, y1: 200 };

        assert.deepEqual(getShapePlugin('resistor').getSnapPorts(normalBox), [
            { id: 'w', x: 100, y: 225, nx: -1, ny: 0 },
            { id: 'e', x: 200, y: 225, nx: 1, ny: 0 },
        ]);
        assert.deepEqual(getShapePlugin('resistor').getSnapPorts(invertedBox), getShapePlugin('resistor').getSnapPorts(normalBox));

        assert.deepEqual(getShapePlugin('capacitor').getSnapPorts(normalBox), [
            { id: 'w', x: 100, y: 225, nx: -1, ny: 0 },
            { id: 'e', x: 200, y: 225, nx: 1, ny: 0 },
        ]);

        assert.deepEqual(getShapePlugin('power-source').getSnapPorts(normalBox), [
            { id: 'n', x: 150, y: 200, nx: 0, ny: -1 },
            { id: 's', x: 150, y: 250, nx: 0, ny: 1 },
        ]);

        assert.deepEqual(getShapePlugin('ground').getSnapPorts(normalBox), [
            { id: 'n', x: 150, y: 200, nx: 0, ny: -1 },
        ]);

        assert.deepEqual(getShapePlugin('transistor-npn').getSnapPorts(normalBox), [
            { id: 'base', x: 100, y: 225, nx: -1, ny: 0 },
            { id: 'collector', x: 170, y: 200, nx: 0, ny: -1 },
            { id: 'emitter', x: 170, y: 250, nx: 0, ny: 1 },
        ]);

        assert.deepEqual(getShapePlugin('transistor-pnp').getSnapPorts(normalBox), [
            { id: 'base', x: 100, y: 225, nx: -1, ny: 0 },
            { id: 'emitter', x: 170, y: 200, nx: 0, ny: -1 },
            { id: 'collector', x: 170, y: 250, nx: 0, ny: 1 },
        ]);

        assert.deepEqual(getShapePlugin('transistor-mosfet').getSnapPorts(normalBox), [
            { id: 'gate', x: 100, y: 234, nx: -1, ny: 0 },
            { id: 'drain', x: 172, y: 200, nx: 0, ny: -1 },
            { id: 'source', x: 172, y: 250, nx: 0, ny: 1 },
        ]);
    });

    test('snap ports and outward normals rotate accurately at 90 and 180 degrees', () => {
        const resRot90 = getShapePlugin('resistor').getSnapPorts({
            x0: 100,
            y0: 200,
            x1: 200,
            y1: 240,
            rotation: Math.PI / 2,
        });
        const w90 = resRot90.find(p => p.id === 'w')!;
        const e90 = resRot90.find(p => p.id === 'e')!;
        near(w90.x, 150); near(w90.y, 170);
        near(w90.nx!, 0); near(w90.ny!, -1);
        near(e90.x, 150); near(e90.y, 270);
        near(e90.nx!, 0); near(e90.ny!, 1);

        const gndRot180 = getShapePlugin('ground').getSnapPorts({
            x0: 100,
            y0: 200,
            x1: 200,
            y1: 260,
            rotation: Math.PI,
        });
        near(gndRot180[0].x, 150);
        near(gndRot180[0].y, 260);
        near(gndRot180[0].nx!, 0);
        near(gndRot180[0].ny!, 1);

        const npnRot90 = getShapePlugin('transistor-npn').getSnapPorts({
            x0: 100,
            y0: 200,
            x1: 200,
            y1: 300,
            rotation: Math.PI / 2,
        });
        const base = npnRot90.find(p => p.id === 'base')!;
        const collector = npnRot90.find(p => p.id === 'collector')!;
        const emitter = npnRot90.find(p => p.id === 'emitter')!;
        near(base.x, 150); near(base.y, 200); near(base.nx!, 0); near(base.ny!, -1);
        near(collector.x, 200); near(collector.y, 270); near(collector.nx!, 1); near(collector.ny!, 0);
        near(emitter.x, 100); near(emitter.y, 270); near(emitter.nx!, -1); near(emitter.ny!, 0);
    });

    test('connectors bind to terminal snap ports, follow move/rotate and distinguish NPN vs PNP tangents', () => {
        const res = makeShape('r1', 'resistor', 100, 100, 200, 140);
        const npn = makeShape('q1', 'transistor-npn', 300, 100, 400, 200);
        const pnp = makeShape('q2', 'transistor-pnp', 500, 100, 600, 200);
        const wireRtoNpn = makeShape('w1', 'line', 200, 120, 300, 150, {
            startBinding: { elementId: 'r1', portId: 'e' },
            endBinding: { elementId: 'q1', portId: 'base' },
        });
        const elements: CanvasElement[] = [res, npn, pnp, wireRtoNpn];

        const hitGate = findNearestSnapPort(elements, { x: 304, y: 147 }, 14, identityAdapter);
        assert.equal(hitGate?.elementId, 'q1');
        assert.equal(hitGate?.portId, 'base');

        // Moving and rotating resistor moves wire start to its rotated 'e' terminal
        res.startX = 120;
        res.endX = 220;
        res.rotation = Math.PI / 2;
        const updated = followBoundConnectors(elements, new Set(['r1']), identityAdapter);
        assert.deepEqual(updated, [wireRtoNpn]);
        // Rotated resistor center = (170, 120); e port was (+50, 0) -> (0, +50) -> (170, 170)
        near(wireRtoNpn.startX, 170);
        near(wireRtoNpn.startY, 170);
        near(wireRtoNpn.endX, 300);
        near(wireRtoNpn.endY, 150);

        // NPN has 'emitter' at the bottom (normal 0, +1); PNP has 'emitter' at the top (normal 0, -1)
        const npnEmitterWire = makeShape('w-npn', 'line', 370, 200, 470, 300, {
            startBinding: { elementId: 'q1', portId: 'emitter' },
        });
        const pnpEmitterWire = makeShape('w-pnp', 'line', 570, 100, 670, 20, {
            startBinding: { elementId: 'q2', portId: 'emitter' },
        });
        const all = [npn, pnp, npnEmitterWire, pnpEmitterWire];

        const npnAligned = autoAlignConnectorTangents(
            {
                x0: 370,
                y0: 200,
                x1: 470,
                y1: 300,
                pathNodes: [
                    { x: 370, y: 200, nodeKind: 'smooth' },
                    { x: 470, y: 300, nodeKind: 'smooth' },
                ],
            },
            npnEmitterWire,
            all,
            identityAdapter,
        );
        const pnpAligned = autoAlignConnectorTangents(
            {
                x0: 570,
                y0: 100,
                x1: 670,
                y1: 20,
                pathNodes: [
                    { x: 570, y: 100, nodeKind: 'smooth' },
                    { x: 670, y: 20, nodeKind: 'smooth' },
                ],
            },
            pnpEmitterWire,
            all,
            identityAdapter,
        );

        assert.ok(npnAligned.pathNodes![0].handleOut!.y > 200, 'NPN emitter tangent exits downward (+Y)');
        near(npnAligned.pathNodes![0].handleOut!.x, 370);
        assert.ok(pnpAligned.pathNodes![0].handleOut!.y < 100, 'PNP emitter tangent exits upward (-Y)');
        near(pnpAligned.pathNodes![0].handleOut!.x, 570);
    });

    test('rendering preserves stroke-only symbols while filling transistor arrows with stroke color', () => {
        const geom: ShapeRenderGeometry = { x0: 0, y0: 0, x1: 120, y1: 80 };
        const styleWithFill: ShapeStyleConfig = {
            strokeColor: '#E11D48',
            strokeWidth: 2,
            strokeOpacity: 1,
            fillEnabled: true,
            fillColor: '#2F6BFF',
            fillPattern: 'solid',
            fillOpacity: 0.5,
        };
        const styleNoFill: ShapeStyleConfig = {
            strokeColor: '#E11D48',
            strokeWidth: 2,
            strokeOpacity: 1,
            fillEnabled: false,
        };

        for (const id of ['resistor', 'capacitor', 'ground']) {
            const plugin = getShapePlugin(id);
            const { ctx, strokes, fills } = createMockCanvasCtx();
            plugin.renderCanvas(ctx, geom, styleWithFill);
            assert.ok(strokes.length >= 1, `${id} draws stroke`);
            assert.equal(fills.length, 0, `${id} ignores body fill`);

            const svg = plugin.renderSvg(geom, styleWithFill);
            assert.equal(svg.body.includes('#2F6BFF'), false, `${id} SVG does not emit body fill`);
        }

        // Power source allows body fill on its circle only when fillEnabled is true
        const pwr = getShapePlugin('power-source');
        const pwrNoFillCtx = createMockCanvasCtx();
        pwr.renderCanvas(pwrNoFillCtx.ctx, geom, styleNoFill);
        assert.equal(pwrNoFillCtx.fills.length, 0);

        const pwrFillCtx = createMockCanvasCtx();
        pwr.renderCanvas(pwrFillCtx.ctx, geom, styleWithFill);
        assert.equal(pwrFillCtx.fills.length, 1);

        // Transistors always fill their arrowhead with the stroke color even when fillEnabled is false
        for (const id of ['transistor-npn', 'transistor-pnp', 'transistor-mosfet']) {
            const plugin = getShapePlugin(id);
            const { ctx, fills } = createMockCanvasCtx();
            plugin.renderCanvas(ctx, geom, styleNoFill);
            assert.ok(fills.length >= 1, `${id} canvas draws solid arrow`);
            assert.ok(fills.some(f => f.style === '#E11D48'), `${id} canvas arrow uses stroke color`);

            const svg = plugin.renderSvg(geom, styleNoFill);
            assert.ok(svg.body.includes('fill="#E11D48"'), `${id} SVG arrow fills with stroke color`);
            assert.ok(svg.body.includes('stroke="none"'), `${id} SVG arrow omits duplicate stroke`);
        }
    });

    test('reticle eraser splitShapeDoc slices resistor and transistor-npn into editable open segments', () => {
        let counter = 0;
        const uuid = () => `frag-${++counter}`;

        const resistor = makeShape('r-slice', 'resistor', 0.1, 0.2, 0.3, 0.25);
        const resistorFrags = splitShapeDoc(resistor, [{ x: 200, y: 225 }], 15, 0, 1000, 0, uuid);
        assert.ok(resistorFrags !== null && resistorFrags.length >= 2, 'Resistor split into open line fragments');
        for (const frag of resistorFrags) {
            assert.equal(frag.shapeType, 'line');
            assert.ok((frag.pathNodes?.length ?? 0) >= 2);
        }

        const transistor = makeShape('t-slice', 'transistor-npn', 0.1, 0.1, 0.3, 0.3);
        const transistorFrags = splitShapeDoc(transistor, [{ x: 180, y: 200 }], 16, 0, 1000, 0, uuid);
        assert.ok(transistorFrags !== null && transistorFrags.length >= 1, 'Transistor NPN split by reticle eraser');
        for (const frag of transistorFrags) {
            assert.equal(frag.shapeType, 'line');
            assert.ok((frag.pathNodes?.length ?? 0) >= 2);
        }
    });

    test('UI integrates electrical pages in ToolEstuche, Toolbar icon and FavoritesDrawer preview', () => {
        const selected: string[] = [];
        const { estuche } = createTestEstuche(
            { tool: 'shape', smoothing: 0.5, eraserRadius: 15, lassoMode: 'free', shapeType: 'transistor-npn' },
            { onSelectShapeType: (s) => { selected.push(s); } },
            (globalThis as any).document.body,
        );
        estuche.open(undefined, (globalThis as any).document.createElement('button'));

        const pages = estuche.container.querySelectorAll('.shape-page');
        assert.equal(pages.length, 6);
        assert.deepEqual(
            pages[2].querySelectorAll('.shape-btn').map((b: any) => b.getAttribute('data-s')),
            ['resistor', 'capacitor', 'power-source', 'ground'],
        );
        assert.deepEqual(
            pages[3].querySelectorAll('.shape-btn').map((b: any) => b.getAttribute('data-s')),
            ['transistor-npn', 'transistor-pnp', 'transistor-mosfet'],
        );

        const dots = estuche.container.querySelector('.shape-pager').querySelectorAll('.dot');
        assert.ok(dots[3].classList.contains('is-active'), 'Opens directly to the active transistor page');

        pages[2].querySelectorAll('.shape-btn')[0].click();
        assert.deepEqual(selected, ['resistor']);
        estuche.destroy();

        const { toolbar } = createTestToolbar({
            activeTool: 'shape',
            activeShape: 'resistor',
            activeColor: '#000',
            activeWidth: 2,
            favorites: [],
            eraserRadius: 15,
        });
        const wrap = toolbar.getToolButton('shape')!.querySelector('.apolo-tool-icon-wrap') as any;
        assert.equal(wrap.getAttribute('data-shape'), 'resistor');
        assert.equal(wrap.querySelector('path').getAttribute('d'), getShapePlugin('resistor').iconSvgPaths.join(' '));

        toolbar.setShape('transistor-mosfet');
        assert.equal(wrap.getAttribute('data-shape'), 'transistor-mosfet');
        assert.equal(wrap.querySelector('path').getAttribute('d'), getShapePlugin('transistor-mosfet').iconSvgPaths.join(' '));

        const preview = createShapePreview({
            id: 'fav-elec',
            tool: 'shape',
            shapeType: 'transistor-npn',
            color: '#111111',
            width: 2,
            opacity: 1,
            pattern: 'solid',
            createdAt: 0,
        } as any) as any;
        assert.equal(preview.getAttribute('viewBox'), '0 0 64 64');
        assert.ok(preview.querySelectorAll('path').length >= 1);
    });
});
