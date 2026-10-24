/**
 * End-to-end coverage of the 4-stage Shapes Suite:
 *  1. Paginated shapes estuche, 3-control property bar, dynamic toolbar icon, multi-face 3D fills
 *  2. Editable parametric shapes (corner radius, curved arrows, free triangle vertices) + reactive styling
 *  3. Freehand recognition with hold-to-snap conversion into parametric ShapeElements
 *  4. Magnetic auto-connect bindings that follow moved / resized / erased shapes
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyGeometryToShapeElement,
    clearDanglingBindings,
    findNearestSnapPort,
    followBoundConnectors,
    getShapePlugin,
    sanitizeLoadedShapeElement,
    shapeElementToGeometry,
    type ConnectorGeometryAdapter,
    type ShapeRenderGeometry,
} from '../src/engine/shapes/index.ts';
import {
    cloneElements,
    cloneWorkspaceToolState,
    DEFAULT_WORKSPACE_TOOL_STATE,
    type CanvasElement,
    type PageDocument,
    type ShapeElement,
    type WorkspaceToolState,
} from '../src/core/types.ts';
import { CanvasController } from '../src/engine/CanvasController.ts';
import { ShapeRecognizer, MIN_RECOGNITION_CONFIDENCE } from '../src/tools/ShapeRecognizer.ts';
import { renderElement } from '../src/io/PersistenceQueue.ts';
import { createShapePreview } from '../src/ui/favorites/FavoritesDrawer.ts';
import { createMockEnvironment } from './helpers/mockDom.ts';

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function createMockWindow(mockDocument: any): any {
    return {
        document: mockDocument,
        innerWidth: 1024,
        innerHeight: 768,
        visualViewport: null,
        devicePixelRatio: 1,
        addEventListener: () => {},
        removeEventListener: () => {},
        setTimeout: (fn: Function, ms: number) => setTimeout(fn, ms),
        clearTimeout: (id: any) => clearTimeout(id),
        requestAnimationFrame: (cb: Function) => setTimeout(cb, 0),
        cancelAnimationFrame: (id: any) => clearTimeout(id),
    };
}

function installDom(): any {
    const mockDocument = createMockEnvironment();
    (globalThis as any).document = mockDocument;
    (globalThis as any).window = createMockWindow(mockDocument);
    return mockDocument;
}

/** Content column at x = 100, width 800, top 0 → normalized u = (docX - 100) / 800, v = docY / 800. */
const CONTENT_LEFT = 100;
const CONTENT_WIDTH = 800;

function createController(configure: (state: WorkspaceToolState) => void, extraOptions: Record<string, unknown> = {}) {
    const mockDocument = installDom();
    const scroller = mockDocument.createElement('div');
    scroller.getBoundingClientRect = () => ({ top: 0, left: 0, width: 1000, height: 1000, bottom: 1000, right: 1000 });
    const contentEl = mockDocument.createElement('div');
    contentEl.className = 'cm-content';
    contentEl.offsetWidth = CONTENT_WIDTH;
    contentEl.getBoundingClientRect = () => ({
        top: 0, left: CONTENT_LEFT, width: CONTENT_WIDTH, height: 2000, bottom: 2000, right: CONTENT_LEFT + CONTENT_WIDTH,
    });
    scroller.appendChild(contentEl);

    const docModel: PageDocument = {
        schemaVersion: 1,
        version: 1,
        id: 'suite-page',
        notePath: 'suite.md',
        elements: [],
        createdAt: 1000,
        updatedAt: 1000,
    };
    const persistence = { flush: async () => {}, enqueue: () => {}, loadDocumentForNote: async () => docModel } as any;
    const toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
    configure(toolState);

    const controller = new CanvasController(
        scroller as any,
        undefined,
        docModel,
        { path: 'suite.md' } as any,
        'suite.md',
        persistence,
        { toolState, enableMouseDrawing: true, ...extraOptions } as any,
    );
    return { controller, canvas: (controller as any).canvas, internals: controller as any };
}

let clock = 10_000;

function pointer(canvas: any, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, timeStamp = (clock += 16)): void {
    canvas.dispatchEvent({
        type,
        pointerId: 1,
        pointerType: 'pen',
        clientX: x,
        clientY: y,
        buttons: type === 'pointerup' ? 0 : 1,
        button: 0,
        pressure: type === 'pointerup' ? 0 : 0.5,
        shiftKey: false,
        timeStamp,
        preventDefault: () => {},
        stopPropagation: () => {},
    });
}

function dragGesture(canvas: any, from: [number, number], to: [number, number], steps = 4): void {
    pointer(canvas, 'pointerdown', from[0], from[1]);
    for (let i = 1; i <= steps; i++) {
        pointer(canvas, 'pointermove', from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    }
    pointer(canvas, 'pointerup', to[0], to[1]);
}

function tapGesture(canvas: any, at: [number, number]): void {
    pointer(canvas, 'pointerdown', at[0], at[1]);
    pointer(canvas, 'pointerup', at[0], at[1]);
}

const u = (docX: number) => (docX - CONTENT_LEFT) / CONTENT_WIDTH;
const v = (docY: number) => docY / CONTENT_WIDTH;
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

function shapes(controller: CanvasController): ShapeElement[] {
    return controller.getDocument().elements.filter((el): el is ShapeElement => el.type === 'shape');
}

/** Identity anchor (origin 0, scale 1) adapter for pure connector tests. */
const identityAdapter: ConnectorGeometryAdapter = {
    getGeometry: (el) => shapeElementToGeometry(el, 0, 0, 1),
    setGeometry: (el, geom) => applyGeometryToShapeElement(el, geom, 0, 0, 1),
};

function makeShape(id: string, shapeType: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<ShapeElement> = {}): ShapeElement {
    return {
        id,
        type: 'shape',
        shapeType,
        timestamp: 0,
        zIndex: 0,
        blockId: 'line:0',
        startX: x0,
        startY: y0,
        endX: x1,
        endY: y1,
        style: { color: '#111111', width: 2, pattern: 'solid', opacity: 1 },
        bounds: { minX: Math.min(x0, x1), minY: Math.min(y0, y1), maxX: Math.max(x0, x1), maxY: Math.max(y0, y1) },
        ...extra,
    };
}

// ---------------------------------------------------------------------------

describe('Shapes Suite (Stages 1–4)', () => {
    const saved: Record<string, any> = {};

    beforeEach(() => {
        for (const key of ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'ResizeObserver']) {
            saved[key] = (globalThis as any)[key];
        }
        (globalThis as any).getComputedStyle = () => ({ position: 'relative', overflow: 'auto', userSelect: 'none' });
        (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
        (globalThis as any).requestAnimationFrame = (cb: Function) => setTimeout(cb, 0);
        (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
    });

    afterEach(() => {
        for (const [key, value] of Object.entries(saved)) {
            (globalThis as any)[key] = value;
        }
    });

    // =======================================================================
    // Stage 1
    // =======================================================================
    describe('Stage 1 — Shapes estuche, toolbar icon & multi-face 3D fills', () => {
        test('carousel shows base shapes on page 1 and diamond / hexagon / cylinder on page 2', async () => {
            installDom();
            const { ToolEstuche } = await import('../src/ui/ToolEstuche.ts');
            const selected: string[] = [];
            const estuche = new ToolEstuche(
                {
                    tool: 'shape', slot: 'tc', color: '#2f6bff', width: 3, profileId: 'fountain', smoothing: 0.5,
                    pressureSensitivity: 0.5, favorites: [], eraserMode: 'whole', eraserRadius: 15, scribbleToErase: false,
                    lassoMode: 'free', shapeType: 'cylinder', snapGrid: false,
                },
                {
                    onSelectProfile: () => {}, onChangeColor: () => {}, onChangeWidth: () => {}, onChangeSmoothing: () => {},
                    onChangePressure: () => {}, onUseFavorite: () => {}, onSaveFavorite: () => {}, onSelectEraserMode: () => {},
                    onChangeEraserRadius: () => {}, onToggleScribble: () => {}, onSelectLassoMode: () => {},
                    onSelectShapeType: (s) => { selected.push(s); }, onToggleSnapGrid: () => {},
                },
                (globalThis as any).document.body,
            );
            estuche.open(undefined, (globalThis as any).document.createElement('button'));

            const pages = estuche.container.querySelectorAll('.shape-page');
            assert.equal(pages.length, 2);
            assert.deepEqual(pages[0].querySelectorAll('.shape-btn').map((b: any) => b.getAttribute('data-s')), ['line', 'arrow', 'rect', 'ellipse', 'triangle']);
            assert.deepEqual(pages[1].querySelectorAll('.shape-btn').map((b: any) => b.getAttribute('data-s')), ['diamond', 'hexagon', 'cylinder']);
            assert.equal(pages[1].querySelectorAll('.shape-slot-empty').length, 2, 'Partial pages keep the 5-column grid');

            // The armed extended shape is the only active button and its page is the active pager dot
            const active = estuche.container.querySelectorAll('.shape-btn.is-active');
            assert.equal(active.length, 1);
            assert.equal(active[0].getAttribute('data-s'), 'cylinder');
            const dots = estuche.container.querySelector('.shape-pager').querySelectorAll('.dot');
            assert.ok(dots[1].classList.contains('is-active'));
            assert.ok(estuche.container.querySelector('.shape-pager-next').disabled, 'Last page disables the next arrow');

            pages[0].querySelectorAll('.shape-btn')[1].click();
            assert.deepEqual(selected, ['arrow']);
            estuche.destroy();
        });

        test('prop bar toggles the line tray, the 5-column fill tray and the 1:1 state', async () => {
            installDom();
            const { ToolEstuche } = await import('../src/ui/ToolEstuche.ts');
            const calls: Record<string, unknown[]> = { pattern: [], fill: [], fillPattern: [], regularize: [], fillOpacity: [] };
            const estuche = new ToolEstuche(
                {
                    tool: 'shape', slot: 'tc', color: '#2f6bff', width: 3, profileId: 'fountain', smoothing: 0.5,
                    pressureSensitivity: 0.5, favorites: [], eraserMode: 'whole', eraserRadius: 15, scribbleToErase: false,
                    lassoMode: 'free', shapeType: 'ellipse', snapGrid: false, fillEnabled: true, fillPattern: 'solid', fillOpacity: 0.4,
                },
                {
                    onSelectProfile: () => {}, onChangeColor: () => {}, onChangeWidth: () => {}, onChangeSmoothing: () => {},
                    onChangePressure: () => {}, onUseFavorite: () => {}, onSaveFavorite: () => {}, onSelectEraserMode: () => {},
                    onChangeEraserRadius: () => {}, onToggleScribble: () => {}, onSelectLassoMode: () => {},
                    onSelectShapeType: () => {}, onToggleSnapGrid: () => {},
                    onChangeLineStyle: (p) => calls.pattern.push(p),
                    onToggleFillEnabled: (f) => calls.fill.push(f),
                    onChangeFillPattern: (p) => calls.fillPattern.push(p),
                    onToggleRegularize: (r) => calls.regularize.push(r),
                    onChangeFillOpacity: (o) => calls.fillOpacity.push(o),
                },
                (globalThis as any).document.body,
            );
            estuche.open(undefined, (globalThis as any).document.createElement('button'));

            const bar = estuche.container.querySelector('.prop-bar');
            const tray = estuche.container.querySelector('.context-tray');
            const [lineBtn, fillBtn, ratioBtn] = bar.querySelectorAll('.prop-btn');

            // Fill pip reflects the active fill color
            assert.equal(fillBtn.querySelector('.fill-color-pip').hidden, false);

            lineBtn.click();
            assert.equal(tray.hidden, false);
            estuche.container.querySelector('[data-t="line"]').querySelectorAll('.line-chip')[2].click();
            assert.deepEqual(calls.pattern, ['dotted']);
            assert.equal(tray.hidden, true, 'Line tray auto-closes after a pick');

            fillBtn.click();
            const fillTray = estuche.container.querySelector('[data-t="fill"]');
            assert.ok(fillTray.classList.contains('is-open'));
            const chips = fillTray.querySelector('.tray-fill-grid').querySelectorAll('.fill-chip');
            assert.equal(chips.length, 5);
            assert.ok(chips[1].classList.contains('is-active'), 'Solid chip active');
            assert.equal(fillTray.querySelector('.fill-detail').hidden, false, 'Opacity + colors visible while fill is on');
            chips[3].click();
            assert.deepEqual(calls.fillPattern, ['cross-hatch']);
            chips[0].click();
            assert.deepEqual(calls.fill, [true, false]);
            assert.equal(fillTray.querySelector('.fill-detail').hidden, true, 'Off hides the secondary row');
            assert.equal(fillBtn.querySelector('.fill-color-pip').hidden, true);

            ratioBtn.click();
            assert.deepEqual(calls.regularize, [true]);
            assert.ok(ratioBtn.classList.contains('is-on'));
            estuche.destroy();
        });

        test('toolbar shape button shows the icon of the armed shape plugin', async () => {
            installDom();
            const { Toolbar } = await import('../src/ui/Toolbar.ts');
            const toolbar = new Toolbar({
                slot: 'tc', penEnabled: true, activeTool: 'shape', activeShape: 'rectangle', activeColor: '#000',
                activeWidth: 2, activeProfileId: 'fountain', activeFavoriteIndex: 0, favorites: [], snapGrid: false,
                canUndo: false, canRedo: false, eraserRadius: 15,
                onSlotChange: () => {}, onToggleKeyboardMode: () => {}, onSelectTool: () => {}, onToggleEstuche: () => {},
                onUndo: () => {}, onRedo: () => {}, onSelectFavorite: () => {}, onChangeColor: () => {},
                onToggleSnapGrid: () => {}, onInsertCanvas: () => {},
            } as any, (globalThis as any).document.body);

            toolbar.setShape('cylinder');
            const wrap = toolbar.getToolButton('shape')!.querySelector('.apolo-tool-icon-wrap') as any;
            assert.equal(wrap.getAttribute('data-shape'), 'cylinder');
            const d = wrap.querySelector('path').getAttribute('d');
            assert.equal(d, getShapePlugin('cylinder').iconSvgPaths.join(' '));

            toolbar.setTool('shape', 'diamond');
            assert.equal(wrap.querySelector('path').getAttribute('d'), getShapePlugin('diamond').iconSvgPaths.join(' '));
        });

        test('cylinder emits perpendicular, contrasting face fills in Canvas 2D and SVG', () => {
            const cylinder = getShapePlugin('cylinder');
            const geom: ShapeRenderGeometry = { x0: 0, y0: 0, x1: 200, y1: 300 };

            for (const pattern of ['hachure', 'cross-hatch', 'dots'] as const) {
                const svg = cylinder.renderSvg(geom, { fillEnabled: true, fillColor: '#FF5722', fillPattern: pattern, fillOpacity: 0.5 });
                const ids = Object.keys(svg.defs ?? {});
                assert.ok(ids.some(id => id.includes(`apolo-fill-${pattern}`) && !id.includes('-rot')), `${pattern}: body tile`);
                assert.ok(ids.some(id => id.includes(`apolo-fill-${pattern}`) && id.includes('-rot90')), `${pattern}: perpendicular cap tile`);
            }

            const solid = cylinder.renderSvg(geom, { fillEnabled: true, fillColor: '#2F6BFF', fillPattern: 'solid', fillOpacity: 0.5 });
            const faceOpacities = solid.body.split('\n')
                .filter(line => line.includes('stroke="none"'))
                .map(line => Number(/fill-opacity="([\d.]+)"/.exec(line)![1]));
            assert.deepEqual(faceOpacities, [0.5, 0.36], 'Body 1.0x and top cap 0.72x opacity');

            const alphas: number[] = [];
            const ctx: any = {
                save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, closePath() {}, stroke() {},
                setLineDash() {}, createPattern: () => null,
                fill() { alphas.push(this.globalAlpha); },
            };
            cylinder.renderCanvas(ctx, geom, { fillEnabled: true, fillColor: '#2F6BFF', fillPattern: 'solid', fillOpacity: 0.5 });
            assert.equal(alphas.length, 2);
            assert.ok(near(alphas[0], 0.5) && near(alphas[1], 0.36), `Canvas face alphas ${alphas}`);
        });

        test('shape favorite previews render patterned fills through the plugin renderer', () => {
            installDom();
            const preview = createShapePreview({
                id: 'fav', tool: 'shape', shapeType: 'rectangle', color: '#2f6bff', width: 3, opacity: 1, pattern: 'solid',
                createdAt: 0, fillEnabled: true, fillPattern: 'hachure', fillColor: '#ff0000', fillOpacity: 0.4,
            } as any) as any;
            assert.ok(preview.querySelector('pattern'), 'hachure tile emitted into <defs>');
            assert.equal(preview.getAttribute('viewBox'), '0 0 64 64');
        });
    });

    // =======================================================================
    // Stage 2
    // =======================================================================
    describe('Stage 2 — Editable parametric shapes', () => {
        test('rectangle radius handle sets cornerRadius (clamped) and renders rx / ry', () => {
            const rect = getShapePlugin('rectangle');
            const geom: ShapeRenderGeometry = { x0: 100, y0: 100, x1: 300, y1: 200 };
            const handles = rect.getControlHandles(geom);
            assert.deepEqual(handles.map(h => h.id), ['nw', 'ne', 'se', 'sw', 'radius']);
            assert.equal(handles.find(h => h.id === 'radius')!.kind, 'radius');

            const rounded = rect.applyHandleDrag(geom, 'radius', { x: 140, y: 140 });
            assert.equal(rounded.cornerRadius, 30);
            assert.ok(rect.renderSvg(rounded, {}).body.includes('rx="30" ry="30"'));

            const clamped = rect.applyHandleDrag(geom, 'radius', { x: 400, y: 400 });
            assert.equal(clamped.cornerRadius, 50, 'Radius never exceeds min(w, h) / 2');

            const resized = rect.applyHandleDrag(rounded, 'se', { x: 360, y: 260 });
            assert.deepEqual([resized.x0, resized.y0, resized.x1, resized.y1], [100, 100, 360, 260]);
            assert.equal(resized.cornerRadius, 30, 'Resizing keeps the corner radius');
        });

        test('arrow curve handle bends it into a quadratic Bezier with a tangent-aligned head', () => {
            const arrow = getShapePlugin('arrow');
            const straight: ShapeRenderGeometry = { x0: 0, y0: 0, x1: 200, y1: 0 };
            const curved = arrow.applyHandleDrag(straight, 'curve', { x: 100, y: 50 });
            assert.deepEqual(curved.controlPoint, { x: 100, y: 100 });
            const curveHandle = arrow.getControlHandles(curved).find(h => h.id === 'curve')!;
            assert.deepEqual([curveHandle.x, curveHandle.y], [100, 50], 'Handle sits on the curve at t = 0.5');

            const body = arrow.renderSvg(curved, {}).body;
            assert.ok(body.includes('Q 100 100 200 0'), 'SVG uses a quadratic segment');
            // Tangent at the tip points from the control point (100,100) to (200,0): head barbs sit below-left of the tip
            const barbs = [...body.matchAll(/M ([\d.-]+) ([\d.-]+) L 200 0 L ([\d.-]+) ([\d.-]+)/g)][0];
            assert.ok(Number(barbs[2]) > 0 && Number(barbs[4]) > 0, 'Arrowhead follows the curve derivative');

            assert.ok(arrow.hitTest(curved, { x: 100, y: 50 }, 3));
            assert.ok(!arrow.hitTest(curved, { x: 100, y: 0 }, 3), 'The straight chord is no longer hit');

            const straightened = arrow.applyHandleDrag(curved, 'curve', { x: 101, y: 1 });
            assert.equal(straightened.controlPoint, undefined, 'Dragging back onto the chord straightens it');
        });

        test('triangle vertices can be dragged independently', () => {
            const tri = getShapePlugin('triangle');
            const geom: ShapeRenderGeometry = { x0: 0, y0: 0, x1: 100, y1: 100 };
            assert.deepEqual(tri.getControlHandles(geom).map(h => h.id), ['v0', 'v1', 'v2', 'nw', 'ne', 'se', 'sw']);

            const free = tri.applyHandleDrag(geom, 'v1', { x: 150, y: 80 });
            assert.deepEqual(free.vertices, [{ x: 50, y: 0 }, { x: 150, y: 80 }, { x: 0, y: 100 }]);
            assert.deepEqual(tri.getControlHandles(free).map(h => h.id), ['v0', 'v1', 'v2'], 'Detached triangles only expose vertices');
            const again = tri.applyHandleDrag(free, 'v0', { x: -20, y: -10 });
            assert.deepEqual(again.vertices![0], { x: -20, y: -10 });
            assert.deepEqual(again.vertices![1], { x: 150, y: 80 });
        });

        test('ellipse exposes corner + cardinal handles and honors 1:1 regularize', () => {
            const ellipse = getShapePlugin('ellipse');
            const geom: ShapeRenderGeometry = { x0: 0, y0: 0, x1: 100, y1: 60 };
            assert.deepEqual(ellipse.getControlHandles(geom).map(h => h.id), ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w']);
            const circle = ellipse.applyHandleDrag(geom, 'se', { x: 140, y: 90 }, true);
            assert.equal(Math.abs(circle.x1 - circle.x0), Math.abs(circle.y1 - circle.y0));
            const east = ellipse.applyHandleDrag(geom, 'e', { x: 160, y: 999 });
            assert.deepEqual([Math.min(east.x0, east.x1), Math.max(east.x0, east.x1), Math.min(east.y0, east.y1), Math.max(east.y0, east.y1)], [0, 160, 0, 60]);
        });

        test('dragging a handle of the selected shape edits it live and records one undo step', () => {
            const { controller, canvas, internals } = createController(state => {
                state.activeTool = 'shape';
                state.shape.shapeType = 'rectangle';
                state.shape.regularize = false;
            });
            dragGesture(canvas, [200, 100], [400, 250]);
            const [rect] = shapes(controller);
            assert.ok(rect);

            tapGesture(canvas, [300, 180]);
            assert.deepEqual(internals.selection.map((el: CanvasElement) => el.id), [rect.id], 'Tap selects the shape');
            const historyBefore = internals.history.length;

            // Radius handle sits 10px inside the top-left corner
            dragGesture(canvas, [210, 110], [230, 130]);
            assert.ok(near(rect.cornerRadius!, 20 / CONTENT_WIDTH), `cornerRadius ${rect.cornerRadius}`);
            assert.equal(internals.history.length, historyBefore + 1, 'One snapshot per handle drag');

            controller.undo();
            const restored = shapes(controller)[0];
            assert.equal(restored.cornerRadius, undefined, 'Undo restores the square corners');
            controller.destroy();
        });

        test('style changes while a shape is selected update it in place', () => {
            const { controller, canvas, internals } = createController(state => {
                state.activeTool = 'shape';
                state.shape.shapeType = 'ellipse';
            });
            dragGesture(canvas, [200, 100], [400, 250]);
            tapGesture(canvas, [300, 175]);
            const ellipse = shapes(controller)[0];
            assert.equal(internals.selection[0], ellipse);

            controller.setInkColor('#E53935');
            controller.setWidth(7);
            const callbacks = internals.estuche.callbacks;
            callbacks.onChangeFillPattern('dots');
            callbacks.onChangeFillColor('#26A69A');
            callbacks.onChangeFillOpacity(0.6);
            callbacks.onChangeLineStyle('dashed');

            assert.equal(ellipse.style.color, '#E53935');
            assert.equal(ellipse.style.width, 7);
            assert.equal(ellipse.style.pattern, 'dashed');
            assert.equal(ellipse.fillEnabled, true);
            assert.equal(ellipse.fillPattern, 'dots');
            assert.equal(ellipse.fillColor, '#26A69A');
            assert.equal(ellipse.fillOpacity, 0.6);

            // Without a selection the same edits only configure the tool
            tapGesture(canvas, [800, 900]);
            assert.equal(internals.selection.length, 0);
            controller.setInkColor('#000000');
            assert.equal(ellipse.style.color, '#E53935');
            controller.destroy();
        });

        test('parametric fields round-trip through clone, SVG export and load sanitization', () => {
            const arrow = makeShape('a', 'arrow', 0, 0, 0.25, 0, {
                controlPoint: { x: 0.125, y: 0.125 },
                startBinding: { elementId: 'r', portId: 'e' },
            });
            const rect = makeShape('r', 'rectangle', 0.5, 0.5, 0.75, 0.625, { cornerRadius: 0.02 });
            const [arrowCopy, rectCopy] = cloneElements([arrow, rect]) as ShapeElement[];
            assert.notEqual(arrowCopy.controlPoint, arrow.controlPoint, 'Control point is deep-cloned');
            assert.notEqual(arrowCopy.startBinding, arrow.startBinding, 'Binding is deep-cloned');
            assert.deepEqual(arrowCopy, arrow);
            assert.deepEqual(rectCopy, rect);

            assert.ok(renderElement(arrow, 800).includes('Q 100 100 200 0'));
            assert.ok(renderElement(rect, 800).includes('rx="16"'));

            const fromDisk = JSON.parse(JSON.stringify({ ...arrow, controlPoint: { x: 'bad' }, endBinding: 42 })) as ShapeElement;
            sanitizeLoadedShapeElement(fromDisk);
            assert.equal(fromDisk.controlPoint, undefined);
            assert.equal(fromDisk.endBinding, null);
            assert.deepEqual(fromDisk.startBinding, { elementId: 'r', portId: 'e' });
        });
    });

    // =======================================================================
    // Stage 3
    // =======================================================================
    describe('Stage 3 — Freehand recognition & hold-to-snap', () => {
        const segment = (a: [number, number], b: [number, number], n = 20) =>
            Array.from({ length: n }, (_, i) => ({ x: a[0] + ((b[0] - a[0]) * i) / n, y: a[1] + ((b[1] - a[1]) * i) / n }));
        const polygon = (pts: Array<[number, number]>) => {
            const out = pts.flatMap((p, i) => segment(p, pts[(i + 1) % pts.length]));
            out.push({ x: pts[0][0], y: pts[0][1] });
            return out;
        };
        const oval = (cx: number, cy: number, a: number, b: number) =>
            Array.from({ length: 61 }, (_, i) => ({ x: cx + a * Math.cos((i / 60) * Math.PI * 2), y: cy + b * Math.sin((i / 60) * Math.PI * 2) }));
        const recognizer = new ShapeRecognizer();

        test('classifies lines (with angle snapping) and single-stroke arrows', () => {
            const line = recognizer.classify(segment([0, 0], [200, 10], 30).concat({ x: 200, y: 10 }))!;
            assert.equal(line.type, 'line');
            assert.ok(near(line.end.y, line.start.y, 1e-9), 'Within ±6° of 0° snaps to horizontal');
            assert.ok(line.confidence >= MIN_RECOGNITION_CONFIDENCE);

            const arrow = recognizer.classify([
                ...segment([0, 100], [200, 100], 40),
                ...segment([200, 100], [176, 82], 8),
                ...segment([176, 82], [200, 100], 8),
                ...segment([200, 100], [176, 118], 8),
            ])!;
            assert.equal(arrow.type, 'arrow');
            assert.deepEqual([arrow.start.x, arrow.end.x], [0, 200]);

            assert.equal(recognizer.classify(Array.from({ length: 40 }, (_, i) => ({ x: i * 5, y: Math.sin(i / 6) * 30 }))), null, 'Wavy strokes stay freehand');
        });

        test('classifies rectangles / squares, ellipses / circles, triangles and diamonds', () => {
            const rect = recognizer.classify(polygon([[0, 0], [200, 0], [200, 120], [0, 120]]))!;
            assert.equal(rect.type, 'rectangle');
            assert.equal(rect.regularize, false);

            const square = recognizer.classify(polygon([[0, 0], [150, 0], [150, 140], [0, 140]]))!;
            assert.equal(square.type, 'rectangle');
            assert.equal(square.regularize, true);
            assert.ok(near(square.end.x - square.start.x, square.end.y - square.start.y), 'Near-square snaps to 1:1');

            const ellipse = recognizer.classify(oval(100, 100, 120, 70))!;
            assert.equal(ellipse.type, 'ellipse');
            assert.equal(ellipse.regularize, false);
            const circle = recognizer.classify(oval(100, 100, 80, 74))!;
            assert.equal(circle.type, 'ellipse');
            assert.equal(circle.regularize, true);

            const upright = recognizer.classify(polygon([[100, 0], [200, 160], [0, 160]]))!;
            assert.equal(upright.type, 'triangle');
            assert.equal(upright.vertices, undefined, 'Upright isosceles maps onto the box form');
            const right = recognizer.classify(polygon([[0, 0], [200, 160], [0, 160]]))!;
            assert.equal(right.type, 'triangle');
            assert.equal(right.vertices?.length, 3, 'Other triangles keep their vertices');

            const diamond = recognizer.classify(polygon([[100, 0], [200, 80], [100, 160], [0, 80]]))!;
            assert.equal(diamond.type, 'diamond');
        });

        test('release-time recognition requires a stationary dwell', () => {
            const pts = polygon([[0, 0], [200, 0], [200, 120], [0, 120]]).map((p, i) => ({ ...p, time: i * 10 }));
            const lastMotion = pts[pts.length - 1].time!;
            assert.equal(recognizer.recognize(pts, lastMotion + 100), null);
            assert.equal(recognizer.recognize(pts, lastMotion + 400)?.type, 'rectangle');
        });

        test('holding the pen still converts the stroke into an editable ShapeElement', async () => {
            const { controller, canvas, internals } = createController(state => {
                state.activeTool = 'pen';
                state.pen.color = '#E53935';
                state.pen.width = 4;
                state.pen.straightenLines = false;
            }, { shapeRecognition: true });

            const corners: Array<[number, number]> = [[200, 100], [500, 100], [500, 300], [200, 300], [200, 100]];
            pointer(canvas, 'pointerdown', 200, 100);
            for (let i = 1; i < corners.length; i++) {
                const [ax, ay] = corners[i - 1];
                const [bx, by] = corners[i];
                for (let s = 1; s <= 10; s++) {
                    pointer(canvas, 'pointermove', ax + ((bx - ax) * s) / 10, ay + ((by - ay) * s) / 10);
                }
            }
            const lastMove = clock;

            // Live dwell (360ms) shows a snap preview while the stylus is held
            await new Promise(resolve => setTimeout(resolve, 420));
            assert.equal(internals.snapPreview?.type, 'rectangle', 'Snap preview armed after the dwell');

            pointer(canvas, 'pointerup', 200, 100, lastMove + 450);
            const elements = controller.getDocument().elements;
            assert.equal(elements.length, 1);
            const shape = elements[0] as ShapeElement;
            assert.equal(shape.type, 'shape', 'Freehand stroke became a parametric shape');
            assert.equal(shape.shapeType, 'rectangle');
            assert.equal(shape.style.color, '#E53935', 'Inherits the pen color');
            assert.equal(shape.style.width, 4, 'Inherits the pen width');
            assert.equal(shape.fillEnabled, false);
            assert.ok(getShapePlugin(shape.shapeType).getControlHandles(shapeElementToGeometry(shape, 0, 0, 1)).length > 0);
            assert.equal(internals.snapPreview, null);
            controller.destroy();
        });

        test('a quick stroke without a dwell stays freehand ink', () => {
            const { controller, canvas } = createController(state => {
                state.activeTool = 'pen';
                state.pen.straightenLines = false;
            }, { shapeRecognition: true });
            pointer(canvas, 'pointerdown', 200, 100);
            for (let i = 1; i <= 10; i++) pointer(canvas, 'pointermove', 200 + i * 30, 100);
            pointer(canvas, 'pointerup', 500, 100, clock + 10);
            assert.equal(controller.getDocument().elements[0]?.type, 'stroke');
            controller.destroy();
        });
    });

    // =======================================================================
    // Stage 4
    // =======================================================================
    describe('Stage 4 — Magnetic auto-connect', () => {
        test('plugins expose cardinal, vertex and endpoint snap ports', () => {
            const box: ShapeRenderGeometry = { x0: 0, y0: 0, x1: 100, y1: 50 };
            for (const id of ['rectangle', 'ellipse', 'diamond', 'hexagon', 'cylinder']) {
                assert.deepEqual(getShapePlugin(id).getSnapPorts(box).map(p => p.id), ['n', 'e', 's', 'w', 'center'], id);
            }
            assert.deepEqual(getShapePlugin('rectangle').getSnapPorts(box).find(p => p.id === 'e'), { id: 'e', x: 100, y: 25 });
            assert.deepEqual(getShapePlugin('triangle').getSnapPorts(box).map(p => p.id), ['v0', 'v1', 'v2', 'e', 's', 'w']);
            assert.deepEqual(getShapePlugin('arrow').getSnapPorts(box).map(p => p.id), ['start', 'end']);
        });

        test('pure helpers: nearest port, follow on move, dangling cleanup', () => {
            const rect = makeShape('r', 'rectangle', 100, 100, 300, 200);
            const arrow = makeShape('a', 'arrow', 300, 150, 500, 150, { startBinding: { elementId: 'r', portId: 'e' } });
            const elements: CanvasElement[] = [rect, arrow];

            const hit = findNearestSnapPort(elements, { x: 310, y: 155 }, 14, identityAdapter);
            assert.deepEqual(hit, { elementId: 'r', portId: 'e', x: 300, y: 150 });
            assert.equal(findNearestSnapPort(elements, { x: 330, y: 150 }, 14, identityAdapter), null, 'Outside the 14px radius');

            rect.startX += 50; rect.endX += 50; rect.startY += 20; rect.endY += 20;
            const updated = followBoundConnectors(elements, new Set(['r']), identityAdapter);
            assert.deepEqual(updated, [arrow]);
            assert.deepEqual([arrow.startX, arrow.startY, arrow.endX, arrow.endY], [350, 170, 500, 150]);

            elements.splice(0, 1);
            assert.equal(clearDanglingBindings(elements), true);
            assert.equal(arrow.startBinding, null);
            assert.doesNotThrow(() => followBoundConnectors(elements, new Set(['r']), identityAdapter));
        });

        test('arrow drawn near a rectangle port snaps, binds and follows translate / resize / erase', () => {
            const { controller, canvas, internals } = createController(state => {
                state.activeTool = 'shape';
                state.shape.shapeType = 'rectangle';
                state.shape.regularize = false;
            });

            // Rectangle (200,100)-(400,250): east port at (400,175)
            dragGesture(canvas, [200, 100], [400, 250]);
            const rect = shapes(controller)[0];

            internals.estuche.callbacks.onSelectShapeType('arrow');
            dragGesture(canvas, [408, 180], [650, 175]);
            const arrow = shapes(controller).find(s => s.shapeType === 'arrow')!;
            assert.ok(arrow, 'Arrow committed');
            assert.ok(near(arrow.startX, u(400)) && near(arrow.startY, v(175)), 'Start snapped to the east port');
            assert.deepEqual(arrow.startBinding, { elementId: rect.id, portId: 'e' });
            assert.ok(!arrow.endBinding, 'Free end stays unbound');

            // Translate the rectangle with the lasso: the arrow tail follows
            controller.setTool('lasso');
            tapGesture(canvas, [300, 180]);
            assert.deepEqual(internals.selection.map((el: CanvasElement) => el.id), [rect.id]);
            dragGesture(canvas, [300, 180], [350, 230], 1);
            assert.ok(near(rect.startX, u(250)) && near(rect.startY, v(150)), 'Rectangle moved by (50, 50)');
            assert.ok(near(arrow.startX, u(450), 1e-4) && near(arrow.startY, v(225), 1e-4), 'Arrow start followed the east port');
            assert.ok(near(arrow.endX, u(650), 1e-4), 'Free end untouched');

            // Resize via the south-east handle (450,300) → (550,350): east port moves to (550,250)
            dragGesture(canvas, [450, 300], [550, 350], 2);
            assert.ok(near(arrow.startX, u(550), 1e-4) && near(arrow.startY, v(250), 1e-4), 'Arrow start followed the resize');

            // Undo the resize restores both shapes together
            controller.undo();
            const rectAfterUndo = shapes(controller).find(s => s.id === rect.id)!;
            const arrowAfterUndo = shapes(controller).find(s => s.id === arrow.id)!;
            assert.ok(near(rectAfterUndo.endX, u(450), 1e-4));
            assert.ok(near(arrowAfterUndo.startX, u(450), 1e-4));

            // Erasing the rectangle clears the dangling binding without crashing
            internals.eraseAtPoints([{ x: 330, y: 220 }]);
            const survivor = shapes(controller).find(s => s.id === arrow.id)!;
            assert.ok(survivor, 'Connector survives');
            assert.equal(shapes(controller).some(s => s.id === rect.id), false);
            assert.equal(survivor.startBinding, null);
            controller.destroy();
        });

        test('dragging a bound endpoint away from the port releases the binding', () => {
            const { controller, canvas, internals } = createController(state => {
                state.activeTool = 'shape';
                state.shape.shapeType = 'rectangle';
            });
            dragGesture(canvas, [200, 100], [400, 250]);
            internals.estuche.callbacks.onSelectShapeType('arrow');
            dragGesture(canvas, [650, 175], [404, 172]);
            const arrow = shapes(controller).find(s => s.shapeType === 'arrow')!;
            assert.equal(arrow.endBinding?.portId, 'e', 'End snapped to the east port');

            // Select the arrow and pull its end handle 100px away
            tapGesture(canvas, [520, 175]);
            assert.equal(internals.selection[0], arrow);
            dragGesture(canvas, [400, 175], [400, 75], 2);
            assert.equal(arrow.endBinding, null);
            assert.ok(near(arrow.endY, v(75), 1e-4));
            controller.destroy();
        });
    });
});
