import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    SHAPE_REGISTRY,
    getShapePlugin,
    registerShapePlugin,
    listShapePlugins,
    createCustomShapePlugin,
    regularizeClosedGeometry,
    regularizeLinearGeometry,
    getSvgFillAttributes,
    getSvgStrokeAttributes,
    lineShapePlugin,
    arrowShapePlugin,
    rectangleShapePlugin,
    ellipseShapePlugin,
    triangleShapePlugin,
    diamondShapePlugin,
    hexagonShapePlugin,
    cylinderShapePlugin,
    type ShapeRenderGeometry,
    type ShapeStyleConfig,
} from '../src/engine/shapes/index.ts';
import {
    cloneWorkspaceToolState,
    DEFAULT_WORKSPACE_TOOL_STATE,
    type PageDocument,
    type ShapeElement,
} from '../src/core/types.ts';
import { CanvasController } from '../src/engine/CanvasController.ts';
import { renderElement, renderSvg, renderBoxSvg } from '../src/io/PersistenceQueue.ts';
import { createMockEnvironment } from './helpers/mockDom.ts';

function createMockEngineEnv() {
    const mockDocument = createMockEnvironment();
    const listeners = new Map<string, Array<{ listener: Function; options?: any }>>();
    const mockWindow: any = {
        innerWidth: 1024,
        innerHeight: 768,
        visualViewport: null,
        devicePixelRatio: 1,
        addEventListener: (event: string, listener: Function, options?: any) => {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event)!.push({ listener, options });
        },
        removeEventListener: (event: string, listener: Function) => {
            const list = listeners.get(event);
            if (list) {
                const idx = list.findIndex(item => item.listener === listener);
                if (idx !== -1) list.splice(idx, 1);
            }
        },
        dispatch: (event: string, evObj: any) => {
            const list = listeners.get(event) || [];
            for (const item of [...list]) {
                item.listener(evObj);
            }
        },
        setTimeout: (fn: Function, ms: number) => setTimeout(fn, ms),
        clearTimeout: (id: any) => clearTimeout(id),
        requestAnimationFrame: (cb: Function) => setTimeout(cb, 16),
        cancelAnimationFrame: (id: any) => clearTimeout(id),
    };
    return { mockWindow, mockDocument };
}

describe('PR #1 Modular Shape Architecture & Real-Time Rendering Engine', () => {
    let originalWindow: any;
    let originalDocument: any;
    let originalRAF: any;
    let originalCAF: any;
    let originalComputedStyle: any;
    let originalResizeObserver: any;

    beforeEach(() => {
        originalWindow = (globalThis as any).window;
        originalDocument = (globalThis as any).document;
        originalRAF = (globalThis as any).requestAnimationFrame;
        originalCAF = (globalThis as any).cancelAnimationFrame;
        originalComputedStyle = (globalThis as any).getComputedStyle;
        originalResizeObserver = (globalThis as any).ResizeObserver;

        (globalThis as any).getComputedStyle = () => ({ position: 'relative', overflow: 'auto', userSelect: 'none' });
        (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
        (globalThis as any).requestAnimationFrame = (cb: Function) => setTimeout(cb, 0);
        (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
    });

    afterEach(() => {
        (globalThis as any).window = originalWindow;
        (globalThis as any).document = originalDocument;
        (globalThis as any).requestAnimationFrame = originalRAF;
        (globalThis as any).cancelAnimationFrame = originalCAF;
        (globalThis as any).getComputedStyle = originalComputedStyle;
        (globalThis as any).ResizeObserver = originalResizeObserver;
    });

    describe('1. Shape Registry & Custom Shape API', () => {
        test('resolves all 8 built-in shapes from SHAPE_REGISTRY and getShapePlugin', () => {
            const expectedShapes = [
                'line',
                'arrow',
                'rectangle',
                'ellipse',
                'triangle',
                'diamond',
                'hexagon',
                'cylinder',
            ];

            for (const id of expectedShapes) {
                const plugin = getShapePlugin(id);
                assert.ok(plugin, `Plugin for ${id} should exist`);
                assert.strictEqual(plugin.id, id);
                assert.ok(typeof plugin.name === 'string' && plugin.name.length > 0);
                assert.ok(Array.isArray(plugin.iconSvgPaths) && plugin.iconSvgPaths.length > 0);
            }

            // Legacy & UI aliases
            assert.strictEqual(getShapePlugin('rect').id, 'rectangle');
            assert.strictEqual(getShapePlugin('rounded-rect').id, 'rectangle');
            assert.strictEqual(getShapePlugin('circle').id, 'ellipse');

            // Fallback for unknown shape
            assert.strictEqual(getShapePlugin('non-existent-shape').id, 'rectangle');
        });

        test('listShapePlugins returns unique plugins', () => {
            const list = listShapePlugins();
            assert.ok(list.length >= 8);
            const ids = list.map(p => p.id);
            const uniqueIds = new Set(ids);
            assert.strictEqual(ids.length, uniqueIds.size);
        });

        test('registers and renders an extensible custom shape plugin', () => {
            // Define a 5-pointed star custom shape
            const starPoints: Array<[number, number]> = [
                [0.5, 0.0],
                [0.62, 0.38],
                [1.0, 0.38],
                [0.69, 0.62],
                [0.81, 1.0],
                [0.5, 0.77],
                [0.19, 1.0],
                [0.31, 0.62],
                [0.0, 0.38],
                [0.38, 0.38],
            ];

            const starPlugin = createCustomShapePlugin({
                id: 'custom-star',
                name: 'Estrella',
                isClosed: true,
                polygon: starPoints,
                iconSvgPaths: ['M 12 2 L 15 9 L 22 9 L 16 14 L 18 21 L 12 17 L 6 21 L 8 14 L 2 9 L 9 9 Z'],
            });

            registerShapePlugin(starPlugin);
            assert.strictEqual(getShapePlugin('custom-star'), starPlugin);

            // Test SVG rendering
            const svgOut = starPlugin.renderSvg(
                { x0: 0, y0: 0, x1: 100, y1: 100 },
                { strokeColor: '#ff0000', strokeWidth: 2, fillEnabled: true, fillColor: '#ffff00', fillPattern: 'solid' },
            );
            assert.ok(svgOut.body.includes('<path d="M 50 0'));
            assert.ok(svgOut.body.includes('stroke="#ff0000"'));

            // Test hit-testing
            assert.strictEqual(starPlugin.hitTest({ x0: 0, y0: 0, x1: 100, y1: 100 }, { x: 50, y: 50 }, 5), true);
            assert.strictEqual(starPlugin.hitTest({ x0: 0, y0: 0, x1: 100, y1: 100 }, { x: 500, y: 500 }, 5), false);
        });
    });

    describe('2. "Perfect Shapes" (regularize) Geometry Math', () => {
        test('regularizeClosedGeometry normalizes rectangle / ellipse drag (10, 10) -> (110, 60) to exact 100x100 square / circle', () => {
            const input: ShapeRenderGeometry = {
                x0: 10,
                y0: 10,
                x1: 110,
                y1: 60,
                regularize: true,
            };

            const regularized = regularizeClosedGeometry(input);
            assert.strictEqual(regularized.x0, 10);
            assert.strictEqual(regularized.y0, 10);
            assert.strictEqual(regularized.x1, 110);
            assert.strictEqual(regularized.y1, 110);

            const width = Math.abs(regularized.x1 - regularized.x0);
            const height = Math.abs(regularized.y1 - regularized.y0);
            assert.strictEqual(width, 100);
            assert.strictEqual(height, 100);

            // Verify rectangle and ellipse plugins invoke this
            const rectNorm = rectangleShapePlugin.normalizeGeometry(input);
            assert.deepStrictEqual(rectNorm, regularized);

            const ellipseNorm = ellipseShapePlugin.normalizeGeometry(input);
            assert.deepStrictEqual(ellipseNorm, regularized);
        });

        test('regularizeClosedGeometry preserves direction in negative quadrant', () => {
            const input: ShapeRenderGeometry = {
                x0: 100,
                y0: 100,
                x1: 20,
                y1: 70,
                regularize: true,
            };

            const regularized = regularizeClosedGeometry(input);
            // dx = -80, dy = -30 -> s = 80 -> x1' = 100 - 80 = 20, y1' = 100 - 80 = 20
            assert.strictEqual(regularized.x1, 20);
            assert.strictEqual(regularized.y1, 20);
        });

        test('regularizeLinearGeometry snaps 40 degree angle to 45 degrees preserving total chord length', () => {
            const chordLength = 100;
            const deg40Rad = (40 * Math.PI) / 180;
            const x0 = 50;
            const y0 = 50;
            const x1 = x0 + chordLength * Math.cos(deg40Rad);
            const y1 = y0 + chordLength * Math.sin(deg40Rad);

            const input: ShapeRenderGeometry = {
                x0,
                y0,
                x1,
                y1,
                regularize: true,
            };

            const regularized = regularizeLinearGeometry(input);
            const resultingR = Math.hypot(regularized.x1 - regularized.x0, regularized.y1 - regularized.y0);
            assert.ok(Math.abs(resultingR - chordLength) < 1e-4, 'Chord length must be preserved');

            const resultingAngle = Math.atan2(regularized.y1 - regularized.y0, regularized.x1 - regularized.x0);
            const expected45DegRad = Math.PI / 4; // 45 degrees
            assert.ok(Math.abs(resultingAngle - expected45DegRad) < 1e-4, 'Angle should snap to exactly 45 degrees');

            // Verify line and arrow plugins invoke this
            const lineNorm = lineShapePlugin.normalizeGeometry(input);
            assert.deepStrictEqual(lineNorm, regularized);

            const arrowNorm = arrowShapePlugin.normalizeGeometry(input);
            assert.deepStrictEqual(arrowNorm, regularized);
        });

        test('triangle regularization produces an equilateral triangle (H = W * sqrt(3)/2)', () => {
            const input: ShapeRenderGeometry = {
                x0: 0,
                y0: 0,
                x1: 100,
                y1: 100,
                regularize: true,
            };
            const norm = triangleShapePlugin.normalizeGeometry(input);
            const width = Math.abs(norm.x1 - norm.x0);
            const height = Math.abs(norm.y1 - norm.y0);
            assert.strictEqual(width, 100);
            assert.ok(Math.abs(height - 100 * (Math.sqrt(3) / 2)) < 1e-4, 'Height must be W * sqrt(3)/2');
        });
    });

    describe('3. Fill Patterns Engine & SVG Persistence Parity', () => {
        test('open shapes (line, arrow) ignore fillEnabled and emit fill="none" with no defs', () => {
            const geom: ShapeRenderGeometry = { x0: 0, y0: 0, x1: 100, y1: 100 };
            const styleWithFill: ShapeStyleConfig = {
                strokeColor: '#000000',
                strokeWidth: 2,
                fillEnabled: true,
                fillColor: '#ff0000',
                fillPattern: 'cross-hatch',
            };

            const lineSvg = lineShapePlugin.renderSvg(geom, styleWithFill);
            assert.ok(lineSvg.body.includes('fill="none"'));
            assert.deepStrictEqual(lineSvg.defs, {});

            const arrowSvg = arrowShapePlugin.renderSvg(geom, styleWithFill);
            assert.ok(arrowSvg.body.includes('fill="none"'));
            assert.deepStrictEqual(arrowSvg.defs, {});
        });

        test('closed shapes emit correct pattern defs for solid, hachure, cross-hatch, and dots', () => {
            const geom: ShapeRenderGeometry = { x0: 10, y0: 10, x1: 90, y1: 90 };

            // 1. Solid
            const solidSvg = rectangleShapePlugin.renderSvg(geom, {
                strokeColor: '#000',
                strokeWidth: 2,
                fillEnabled: true,
                fillColor: '#10b981',
                fillOpacity: 0.35,
                fillPattern: 'solid',
            });
            assert.ok(solidSvg.body.includes('fill="#10b981"'));
            assert.ok(solidSvg.body.includes('fill-opacity="0.35"'));
            assert.deepStrictEqual(solidSvg.defs, {});

            // 2. Hachure (45 deg diagonal lines)
            const hachureSvg = rectangleShapePlugin.renderSvg(geom, {
                strokeColor: '#000',
                strokeWidth: 2,
                fillEnabled: true,
                fillColor: '#3b82f6',
                fillOpacity: 0.5,
                fillPattern: 'hachure',
            });
            assert.ok(hachureSvg.body.includes('fill="url(#apolo-fill-hachure-3b82f6-d3)"'));
            assert.ok(hachureSvg.defs);
            assert.ok(hachureSvg.defs['apolo-fill-hachure-3b82f6-d3'].includes('patternTransform="rotate(45)"'));

            // 3. Cross-hatch (crossed lines)
            const crossHatchSvg = ellipseShapePlugin.renderSvg(geom, {
                strokeColor: '#000',
                strokeWidth: 2,
                fillEnabled: true,
                fillColor: '#f59e0b',
                fillOpacity: 0.4,
                fillPattern: 'cross-hatch',
            });
            assert.ok(crossHatchSvg.body.includes('fill="url(#apolo-fill-cross-hatch-f59e0b-d3)"'));
            assert.ok(crossHatchSvg.defs);
            assert.ok(crossHatchSvg.defs['apolo-fill-cross-hatch-f59e0b-d3'].includes('line x1="0" y1="0" x2="8" y2="0"'));

            // 4. Dots (stipple dot matrix)
            const dotsSvg = triangleShapePlugin.renderSvg(geom, {
                strokeColor: '#000',
                strokeWidth: 2,
                fillEnabled: true,
                fillColor: '#8b5cf6',
                fillOpacity: 0.6,
                fillPattern: 'dots',
            });
            assert.ok(dotsSvg.body.includes('fill="url(#apolo-fill-dots-8b5cf6-d3)"'));
            assert.ok(dotsSvg.defs);
            assert.ok(dotsSvg.defs['apolo-fill-dots-8b5cf6-d3'].includes('circle cx="4" cy="4" r="1.2"'));
        });

        test('PersistenceQueue renders and deduplicates pattern defs in renderSvg and renderBoxSvg', () => {
            const element1: ShapeElement = {
                id: 's1',
                type: 'shape',
                shapeType: 'rectangle',
                startX: 0.1,
                startY: 0.1,
                endX: 0.4,
                endY: 0.4,
                style: { color: '#000', width: 2, pattern: 'solid', opacity: 1 },
                fillEnabled: true,
                fillColor: '#3b82f6',
                fillPattern: 'hachure',
                bounds: { minX: 0.1, minY: 0.1, maxX: 0.4, maxY: 0.4 },
                zIndex: 0,
                timestamp: 1,
                blockId: 'b1',
            };

            const element2: ShapeElement = {
                id: 's2',
                type: 'shape',
                shapeType: 'ellipse',
                startX: 0.5,
                startY: 0.1,
                endX: 0.8,
                endY: 0.4,
                style: { color: '#000', width: 2, pattern: 'solid', opacity: 1 },
                fillEnabled: true,
                fillColor: '#3b82f6', // Same pattern & color: should deduplicate in defs
                fillPattern: 'hachure',
                bounds: { minX: 0.5, minY: 0.1, maxX: 0.8, maxY: 0.4 },
                zIndex: 1,
                timestamp: 2,
                blockId: 'b1',
            };

            const doc: PageDocument = {
                schemaVersion: 1,
                version: 1,
                id: 'page-1',
                notePath: 'note.md',
                elements: [element1, element2],
                createdAt: 1,
                updatedAt: 1,
            };

            const svgString = renderSvg(doc);
            assert.ok(svgString.includes('<defs>'));
            assert.ok(svgString.includes('id="apolo-fill-hachure-3b82f6-d3"'));

            // Deduplication verification: pattern ID should only appear once inside <defs>
            const defsMatch = svgString.match(/<defs>([\s\S]*?)<\/defs>/);
            assert.ok(defsMatch);
            const occurrences = (defsMatch[1].match(/id="apolo-fill-hachure-3b82f6-d3"/g) || []).length;
            assert.strictEqual(occurrences, 1, 'Defs should deduplicate patterns with identical id');

            // Single element render
            const singleSvg = renderElement(element1, 800);
            assert.ok(singleSvg.includes('<rect'));
            assert.ok(singleSvg.includes('fill="url(#apolo-fill-hachure-3b82f6-d3)"'));
        });
    });

    describe('4. Real-Time paintActive Preview & Pointer Drag Workflow', () => {
        test('pointerdown -> pointermove updates live elastic preview and pointerup commits matching coordinates', () => {
            const { mockWindow, mockDocument } = createMockEngineEnv();
            (globalThis as any).window = mockWindow;
            (globalThis as any).document = mockDocument;

            const scroller = mockDocument.createElement('div');
            scroller.getBoundingClientRect = () => ({
                top: 0,
                left: 0,
                width: 1000,
                height: 1000,
                bottom: 1000,
                right: 1000,
            });

            const contentEl = mockDocument.createElement('div');
            contentEl.className = 'cm-content';
            contentEl.offsetWidth = 800;
            contentEl.getBoundingClientRect = () => ({
                top: 0,
                left: 100,
                width: 800,
                height: 2000,
                bottom: 2000,
                right: 900,
            });
            scroller.appendChild(contentEl);

            const docModel: PageDocument = {
                schemaVersion: 1,
                version: 1,
                id: 'test-page',
                notePath: 'test.md',
                elements: [],
                createdAt: 1000,
                updatedAt: 1000,
            };

            const mockPersistence = {
                flush: async () => {},
                enqueue: () => {},
                loadDocumentForNote: async () => docModel,
            } as any;

            const toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            toolState.activeTool = 'shape';
            toolState.shape.shapeType = 'rectangle';
            toolState.shape.regularize = false;
            toolState.shape.fillEnabled = true;
            toolState.shape.fillColor = '#ffa726';
            toolState.shape.fillPattern = 'hachure';

            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                { path: 'test.md' } as any,
                'test.md',
                mockPersistence,
                { toolState, enableMouseDrawing: true },
            );

            // 1. Verify initial active tool
            assert.strictEqual(controller.getToolState().activeTool, 'shape');

            const canvas = (controller as any).canvas;
            assert.ok(canvas);

            // 2. Simulate pointerdown at (100, 100)
            canvas.dispatchEvent({
                type: 'pointerdown',
                pointerId: 1,
                pointerType: 'pen',
                clientX: 200, // screen x: 100 + contentLeft
                clientY: 100,
                buttons: 1,
                button: 0,
                pressure: 0.5,
                shiftKey: false,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // 3. Simulate pointermove to (300, 250)
            canvas.dispatchEvent({
                type: 'pointermove',
                pointerId: 1,
                pointerType: 'pen',
                clientX: 400,
                clientY: 250,
                buttons: 1,
                pressure: 0.5,
                shiftKey: false,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // Wet active canvas points should be populated
            const activePoints = (controller as any).points;
            assert.ok(activePoints.size > 0);

            // 4. Simulate pointerup to commit
            canvas.dispatchEvent({
                type: 'pointerup',
                pointerId: 1,
                pointerType: 'pen',
                clientX: 400,
                clientY: 250,
                buttons: 0,
                button: 0,
                pressure: 0,
                shiftKey: false,
                timeStamp: performance.now(),
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // 5. Verify element committed to document with matching shape properties
            const elements = controller.getDocument().elements;
            assert.strictEqual(elements.length, 1);
            const committed = elements[0] as ShapeElement;
            assert.strictEqual(committed.type, 'shape');
            assert.strictEqual(committed.shapeType, 'rectangle');
            assert.strictEqual(committed.fillEnabled, true);
            assert.strictEqual(committed.fillColor, '#ffa726');
            assert.strictEqual(committed.fillPattern, 'hachure');
            assert.strictEqual(committed.regularize, false);

            controller.destroy();
        });

        test('Shift key during pointer drag forces regularize: true on committed shape', () => {
            const { mockWindow, mockDocument } = createMockEngineEnv();
            (globalThis as any).window = mockWindow;
            (globalThis as any).document = mockDocument;

            const scroller = mockDocument.createElement('div');
            scroller.getBoundingClientRect = () => ({
                top: 0,
                left: 0,
                width: 1000,
                height: 1000,
                bottom: 1000,
                right: 1000,
            });

            const contentEl = mockDocument.createElement('div');
            contentEl.className = 'cm-content';
            contentEl.offsetWidth = 800;
            contentEl.getBoundingClientRect = () => ({
                top: 0,
                left: 100,
                width: 800,
                height: 2000,
                bottom: 2000,
                right: 900,
            });
            scroller.appendChild(contentEl);

            const docModel: PageDocument = {
                schemaVersion: 1,
                version: 1,
                id: 'test-page-shift',
                notePath: 'test.md',
                elements: [],
                createdAt: 1000,
                updatedAt: 1000,
            };

            const mockPersistence = {
                flush: async () => {},
                enqueue: () => {},
                loadDocumentForNote: async () => docModel,
            } as any;

            const toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            toolState.activeTool = 'shape';
            toolState.shape.shapeType = 'rectangle';
            toolState.shape.regularize = false; // Regularize is OFF in settings

            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                { path: 'test.md' } as any,
                'test.md',
                mockPersistence,
                { toolState, enableMouseDrawing: true },
            );

            const canvas = (controller as any).canvas;

            // Start drag
            canvas.dispatchEvent({
                type: 'pointerdown',
                pointerId: 1,
                pointerType: 'pen',
                clientX: 200,
                clientY: 100,
                buttons: 1,
                button: 0,
                pressure: 0.5,
                shiftKey: true, // Shift pressed!
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // Move drag
            canvas.dispatchEvent({
                type: 'pointermove',
                pointerId: 1,
                pointerType: 'pen',
                clientX: 300, // dx = 100
                clientY: 150, // dy = 50 -> with Shift, should regularize to 100x100!
                buttons: 1,
                pressure: 0.5,
                shiftKey: true,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // Release drag
            canvas.dispatchEvent({
                type: 'pointerup',
                pointerId: 1,
                pointerType: 'pen',
                clientX: 300,
                clientY: 150,
                buttons: 0,
                button: 0,
                pressure: 0,
                shiftKey: true,
                timeStamp: performance.now(),
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            const elements = controller.getDocument().elements;
            assert.strictEqual(elements.length, 1);
            const committed = elements[0] as ShapeElement;
            assert.strictEqual(committed.regularize, true);

            // Check that width and height in normalized bounds are equal (1:1 square)
            const normW = Math.abs(committed.endX - committed.startX);
            const normH = Math.abs(committed.endY - committed.startY);
            assert.ok(Math.abs(normW - normH) < 1e-4, `Expected 1:1 aspect ratio, got W=${normW}, H=${normH}`);

            controller.destroy();
        });
    });

    describe('5. ToolEstuche Shapes UI Controls & Accessibility', () => {
        test('renders base shapes and custom shapes row with pagination', async () => {
            const { mockWindow, mockDocument } = createMockEngineEnv();
            (globalThis as any).window = mockWindow;
            (globalThis as any).document = mockDocument;

            const { ToolEstuche } = await import('../src/ui/ToolEstuche.ts');
            const root = mockDocument.createElement('div');
            mockDocument.body.appendChild(root);

            let selectedShape: string | undefined;
            let toggledRegularize: boolean | undefined;
            let toggledFill: boolean | undefined;
            let changedFillPattern: string | undefined;
            let changedFillColor: string | undefined;

            const estuche = new ToolEstuche(
                {
                    tool: 'shape',
                    slot: 'bottom',
                    color: '#111827',
                    width: 2,
                    profileId: 'fountain',
                    smoothing: 0.5,
                    pressureSensitivity: 0.5,
                    favorites: [],
                    eraserMode: 'whole',
                    eraserRadius: 15,
                    scribbleToErase: false,
                    lassoMode: 'free',
                    shapeType: 'rectangle',
                    snapGrid: false,
                    regularize: false,
                    fillEnabled: false,
                    fillColor: '#1F4FD8',
                    fillPattern: 'solid',
                },
                {
                    onSelectProfile: () => {},
                    onChangeColor: () => {},
                    onChangeWidth: () => {},
                    onChangeSmoothing: () => {},
                    onChangePressure: () => {},
                    onUseFavorite: () => {},
                    onSaveFavorite: () => {},
                    onSelectEraserMode: () => {},
                    onChangeEraserRadius: () => {},
                    onToggleScribble: () => {},
                    onSelectLassoMode: () => {},
                    onSelectShapeType: (s) => { selectedShape = s; },
                    onToggleSnapGrid: () => {},
                    onToggleRegularize: (reg) => { toggledRegularize = reg; },
                    onToggleFillEnabled: (fe) => { toggledFill = fe; },
                    onChangeFillPattern: (fp) => { changedFillPattern = fp; },
                    onChangeFillColor: (fc) => { changedFillColor = fc; },
                },
                root as any,
            );

            estuche.open(undefined, mockDocument.createElement('button') as any);

            // Pointer tap (bypasses the 400ms click de-duplication of bindTapOrClick)
            const tap = (el: any) => {
                const ev = (type: string) => ({ type, button: 0, pointerType: 'pen', clientX: 1, clientY: 1, preventDefault: () => {}, stopPropagation: () => {} });
                el.dispatchEvent(ev('pointerdown'));
                el.dispatchEvent(ev('pointerup'));
            };

            // 1. Verify paginated 5-column carousel: page 1 = base shapes, page 2 = extended shapes
            const car = estuche.container.querySelector('.shape-carousel');
            assert.ok(car, 'Must render .shape-carousel');

            const baseSelector = estuche.container.querySelector('.shape-grid-selector');
            assert.ok(baseSelector, 'Must render .shape-grid-selector');
            const baseButtons = baseSelector.querySelectorAll('.shape-btn');
            assert.strictEqual(baseButtons.length, 5, 'Must render 5 base shape buttons');

            const pages = car.querySelectorAll('.shape-page');
            assert.ok(pages.length >= 2, 'Must have at least 2 pages for base and custom shapes');
            const customPageButtons = pages[1].querySelectorAll('.shape-btn');
            const customTypes = customPageButtons.map((b: any) => b.getAttribute('data-s'));
            assert.deepStrictEqual(customTypes.slice(0, 3), ['diamond', 'hexagon', 'cylinder'], 'Page 2 holds the extended shapes');

            const activeButtons = car.querySelectorAll('.shape-btn.is-active');
            assert.strictEqual(activeButtons.length, 1, 'Only the active shape is highlighted');
            assert.strictEqual(activeButtons[0].getAttribute('data-s'), 'rect');
            assert.strictEqual(activeButtons[0].getAttribute('aria-pressed'), 'true');

            // Pager: arrows + dots synced with the page index
            const pager = estuche.container.querySelector('.shape-pager');
            assert.ok(pager, 'Must render .shape-pager when there is more than one page');
            assert.strictEqual(pager.querySelectorAll('.dot').length, pages.length, 'One dot per page');
            const nextArrow = pager.querySelector('.shape-pager-next') as HTMLElement;
            nextArrow.click();
            const activeDot = estuche.container.querySelector('.shape-pager').querySelectorAll('.dot')[1];
            assert.ok(activeDot.classList.contains('is-active'), 'Next arrow activates the second page dot');

            // Click custom shape (first custom button on page 2)
            (customPageButtons[0] as HTMLElement).click();
            assert.strictEqual(selectedShape, 'diamond', 'Selecting custom shape button triggers onSelectShapeType');
            assert.ok(customPageButtons[0].classList.contains('is-active'));
            assert.ok(!baseButtons[2].classList.contains('is-active'), 'Previous shape is no longer active');

            // 2. Verify Thickness Slider (1-12)
            const slider = estuche.container.querySelector('.sl:not(.sm)');
            assert.ok(slider, 'Must render thickness slider .sl');
            const track = slider.querySelector('.trk');
            assert.ok(track, 'Must render slider track .trk');

            // 3. Verify 3-control property bar [Línea ▾] [Relleno ▾] [1:1]
            const bar = estuche.container.querySelector('.prop-bar');
            assert.ok(bar, 'Must render .prop-bar');
            assert.strictEqual(bar.querySelectorAll('.prop-btn').length, 3, 'Property bar has exactly 3 controls');

            const tray = estuche.container.querySelector('.context-tray') as HTMLElement;
            assert.ok(tray, 'Must render .context-tray');
            assert.strictEqual(tray.hidden, true, 'Context tray is hidden while both trays are closed');

            // 3.1 1:1 Toggle
            const ratioBtn = bar.querySelector('.prop-btn.is-toggle') as HTMLElement;
            assert.ok(ratioBtn, 'Must render 1:1 toggle .prop-btn.is-toggle');
            ratioBtn.click();
            assert.strictEqual(toggledRegularize, true, 'Clicking 1:1 toggle triggers onToggleRegularize');
            assert.ok(ratioBtn.classList.contains('is-on'), '1:1 toggle has class .is-on when active');

            // 3.2 Línea Tray
            const lineBtn = bar.querySelector('[data-tb="line"]') as HTMLElement;
            assert.ok(lineBtn, 'Must render line button');
            const lineTray = estuche.container.querySelector('[data-t="line"]') as HTMLElement;
            assert.ok(lineTray, 'Must render line tray');

            lineBtn.click();
            assert.ok(lineTray.classList.contains('is-open'), 'Line tray opens on click');
            assert.strictEqual(tray.hidden, false, 'Context tray becomes visible');
            const lineOptions = lineTray.querySelectorAll('.line-chip');
            assert.strictEqual(lineOptions.length, 3, 'Line tray has 3 options (solid, dashed, dotted)');
            (lineOptions[1] as HTMLElement).click();
            assert.ok(!lineTray.classList.contains('is-open'), 'Selecting a line pattern auto-closes the tray');
            assert.strictEqual(tray.hidden, true, 'Context tray hides again');

            // 3.3 Relleno Tray
            const fillBtn = bar.querySelector('[data-tb="fill"]') as HTMLElement;
            assert.ok(fillBtn, 'Must render fill button');
            assert.ok((fillBtn.getAttribute('aria-label') || fillBtn.title || '').includes('Relleno'), 'Fill trigger is accessible with "Relleno" tooltip');
            const fillTray = estuche.container.querySelector('[data-t="fill"]') as HTMLElement;
            assert.ok(fillTray, 'Must render fill tray');

            // Open line tray then fill tray (accordion behavior)
            tap(lineBtn);
            fillBtn.click();
            assert.ok(fillTray.classList.contains('is-open'), 'Fill tray opens on click');
            assert.ok(!lineTray.classList.contains('is-open'), 'Line tray closes when fill tray opens (accordion)');

            // 5 fill mode chips in a single row
            const fillGrid = fillTray.querySelector('.tray-fill-grid');
            assert.ok(fillGrid, 'Must render .tray-fill-grid');
            const patternChips = fillGrid.querySelectorAll('.fill-chip');
            assert.strictEqual(patternChips.length, 5, 'Must render 5 fill mode chips');
            assert.deepStrictEqual(
                patternChips.map((c: any) => c.getAttribute('data-fill')),
                ['off', 'solid', 'hachure', 'cross-hatch', 'dots'],
            );

            // Fill detail (opacity + colors) hidden while fill is off
            const detail = fillTray.querySelector('.fill-detail') as HTMLElement;
            assert.strictEqual(detail.hidden, true, 'Fill detail row hidden while fill is off');
            assert.strictEqual(fillBtn.classList.contains('has-fill'), false, 'Fill trigger has-fill is false while fill is off');


            // Click hachure pattern chip (index 2)
            (patternChips[2] as HTMLElement).click();
            assert.strictEqual(changedFillPattern, 'hachure', 'Clicking hachure pattern chip selects hachure');
            assert.strictEqual(toggledFill, true, 'Selecting a pattern enables fill');
            assert.strictEqual(detail.hidden, false, 'Fill detail row shown once fill is enabled');
            assert.strictEqual(fillBtn.classList.contains('has-fill'), true, 'Fill trigger has-fill is true once fill is enabled');

            // Density slider shown for hachure, fill opacity slider present
            const dens = fillTray.querySelector('.fill-density') as HTMLElement;
            assert.ok(dens?.classList.contains('is-shown'), 'Density slider is shown for hachure');
            assert.strictEqual(fillTray.querySelector('.fill-opacity-row'), null, 'Fill opacity slider is omitted from fill tray');

            // Subordinate fill color swatches (scoped inside the fill tray)
            const subFillRow = fillTray.querySelector('.fill-swatch-row');
            assert.ok(subFillRow, 'Must render fill color row .fill-swatch-row');
            const fillSwatches = subFillRow.querySelectorAll('.fill-swatch:not(.fill-swatch-add)');
            assert.ok(fillSwatches.length >= 4, 'Must render fill color swatches');
            (fillSwatches[0] as HTMLElement).click();
            assert.ok(changedFillColor, 'Clicking fill swatch triggers onChangeFillColor');

            // Open shapes disable the fill trigger and close the fill tray
            const lineShapeBtn = baseButtons[0] as HTMLElement;
            lineShapeBtn.click();
            assert.strictEqual(selectedShape, 'line');
            assert.ok(fillBtn.classList.contains('is-disabled'), 'Fill trigger is disabled for open shapes');
            assert.ok(!fillTray.classList.contains('is-open'), 'Fill tray closes when an open shape is armed');
            tap(fillBtn);
            assert.ok(!fillTray.classList.contains('is-open'), 'Disabled fill trigger does not open the tray');

            estuche.destroy();
        });
    });


    describe('6. Multi-Face Fill Definitions & Pattern Orientation Contrast for 3D Shapes', () => {
        test('cylinder with fillEnabled: true and fillPattern: "hachure" renders two distinct face fills with contrasting pattern orientations', () => {
            const cylinderPlugin = getShapePlugin('cylinder');
            assert.ok(cylinderPlugin);

            const geom: ShapeRenderGeometry = { x0: 50, y0: 50, x1: 250, y1: 350 };
            const style: ShapeStyleConfig = {
                strokeColor: '#1F4FD8',
                strokeWidth: 2,
                fillEnabled: true,
                fillColor: '#FF5722',
                fillPattern: 'hachure',
                fillOpacity: 0.5,
            };

            // Test SVG output
            const svgOutput = cylinderPlugin.renderSvg(geom, style);
            assert.ok(svgOutput.defs, 'Must contain defs');

            // Should have both base 0 deg hachure and 90 deg rotated hachure defs
            const defKeys = Object.keys(svgOutput.defs);
            const hasBaseHachure = defKeys.some(k => k.includes('apolo-fill-hachure') && !k.includes('-rot'));
            const hasRot90Hachure = defKeys.some(k => k.includes('apolo-fill-hachure') && k.includes('-rot90'));

            assert.strictEqual(hasBaseHachure, true, 'Must include base hachure def');
            assert.strictEqual(hasRot90Hachure, true, 'Must include rot90 hachure def for top cap');

            // Must render two separate <path stroke="none" fill="url(#...)"/> elements in body
            const bodyPaths = svgOutput.body.split('\n');
            const fillPaths = bodyPaths.filter(p => p.startsWith('<path') && p.includes('stroke="none"'));
            assert.strictEqual(fillPaths.length, 2, 'Cylinder must have 2 non-overlapping fill faces');

            // One face uses base pattern and one uses rot90 pattern
            assert.ok(fillPaths.some(p => p.includes('apolo-fill-hachure') && !p.includes('-rot90')));
            assert.ok(fillPaths.some(p => p.includes('-rot90')));

            // Test Canvas 2D calls
            const fillOperations: any[] = [];
            const mockCtx: any = {
                save: () => {},
                restore: () => {},
                beginPath: () => {},
                moveTo: () => {},
                lineTo: () => {},
                bezierCurveTo: () => {},
                closePath: () => {},
                fill: () => {
                    fillOperations.push({ fillStyle: mockCtx.fillStyle, globalAlpha: mockCtx.globalAlpha });
                },
                stroke: () => {},
                createPattern: (canvas: any, repetition: string) => ({ canvas, repetition }),
            };

            cylinderPlugin.renderCanvas(mockCtx, geom, style);
            assert.strictEqual(fillOperations.length, 2, 'Must perform 2 fill passes on Canvas 2D for the two faces');
        });

        test('cylinder with fillEnabled: true and fillPattern: "solid" applies contrasted fill-opacity on top cap vs body', () => {
            const cylinderPlugin = getShapePlugin('cylinder');

            const geom: ShapeRenderGeometry = { x0: 50, y0: 50, x1: 250, y1: 350 };
            const style: ShapeStyleConfig = {
                strokeColor: '#1F4FD8',
                strokeWidth: 2,
                fillEnabled: true,
                fillColor: '#2F6BFF',
                fillPattern: 'solid',
                fillOpacity: 0.5,
            };

            const svgOutput = cylinderPlugin.renderSvg(geom, style);
            const bodyPaths = svgOutput.body.split('\n');
            const fillPaths = bodyPaths.filter(p => p.startsWith('<path') && p.includes('stroke="none"'));
            assert.strictEqual(fillPaths.length, 2);

            // Face 1 (body): opacity = 0.5 * 1.0 = 0.5
            // Face 2 (top cap): opacity = 0.5 * 0.72 = 0.36
            assert.ok(fillPaths.some(p => p.includes('fill-opacity="0.5"')), 'Body face must have 0.5 fill-opacity');
            assert.ok(fillPaths.some(p => p.includes('fill-opacity="0.36"')), 'Top cap face must have 0.36 fill-opacity');

            // Test Canvas 2D globalAlpha
            const alphas: number[] = [];
            const mockCtx: any = {
                save: () => {},
                restore: () => {},
                beginPath: () => {},
                moveTo: () => {},
                lineTo: () => {},
                bezierCurveTo: () => {},
                closePath: () => {},
                fill: () => {
                    alphas.push(mockCtx.globalAlpha);
                },
                stroke: () => {},
            };

            cylinderPlugin.renderCanvas(mockCtx, geom, style);
            assert.strictEqual(alphas.length, 2);
            assert.strictEqual(alphas[0], 0.5);
            assert.strictEqual(alphas[1], 0.36);
        });

        test('FavoritesDrawer createShapePreview renders cylinder with two-face fill', async () => {
            const { mockWindow, mockDocument } = createMockEngineEnv();
            (globalThis as any).window = mockWindow;
            (globalThis as any).document = mockDocument;

            const { createShapePreview } = await import('../src/ui/favorites/FavoritesDrawer.ts');
            const previewSvg = createShapePreview({
                id: 'fav-cylinder-1',
                name: 'Cilindro fav',
                tool: 'shape',
                shapeType: 'cylinder',
                color: '#2F6BFF',
                width: 3,
                fillEnabled: true,
                fillColor: '#FFA726',
                fillPattern: 'hachure',
                fillOpacity: 0.4,
            });

            assert.ok(previewSvg, 'Must produce SVG preview');
            const paths = previewSvg.querySelectorAll('path');
            assert.ok(paths.length >= 2, 'Must render cylinder paths in SVG preview');
            const defs = previewSvg.querySelector('defs');
            assert.ok(defs, 'Must contain defs for pattern preview');
        });
    });
});
