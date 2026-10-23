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

        test('regularizeLinearGeometry snaps 13 degree angle to 15 degrees preserving total chord length', () => {
            const chordLength = 100;
            const deg13Rad = (13 * Math.PI) / 180;
            const x0 = 50;
            const y0 = 50;
            const x1 = x0 + chordLength * Math.cos(deg13Rad);
            const y1 = y0 + chordLength * Math.sin(deg13Rad);

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
            const expected15DegRad = (15 * Math.PI) / 180;
            assert.ok(Math.abs(resultingAngle - expected15DegRad) < 1e-4, 'Angle should snap to exactly 15 degrees');

            // Verify line and arrow plugins invoke this
            const lineNorm = lineShapePlugin.normalizeGeometry(input);
            assert.deepStrictEqual(lineNorm, regularized);

            const arrowNorm = arrowShapePlugin.normalizeGeometry(input);
            assert.deepStrictEqual(arrowNorm, regularized);
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
            assert.ok(hachureSvg.body.includes('fill="url(#apolo-fill-hachure-3b82f6)"'));
            assert.ok(hachureSvg.defs);
            assert.ok(hachureSvg.defs['apolo-fill-hachure-3b82f6'].includes('patternTransform="rotate(45)"'));

            // 3. Cross-hatch (crossed lines)
            const crossHatchSvg = ellipseShapePlugin.renderSvg(geom, {
                strokeColor: '#000',
                strokeWidth: 2,
                fillEnabled: true,
                fillColor: '#f59e0b',
                fillOpacity: 0.4,
                fillPattern: 'cross-hatch',
            });
            assert.ok(crossHatchSvg.body.includes('fill="url(#apolo-fill-cross-hatch-f59e0b)"'));
            assert.ok(crossHatchSvg.defs);
            assert.ok(crossHatchSvg.defs['apolo-fill-cross-hatch-f59e0b'].includes('line x1="0" y1="0" x2="8" y2="0"'));

            // 4. Dots (stipple dot matrix)
            const dotsSvg = triangleShapePlugin.renderSvg(geom, {
                strokeColor: '#000',
                strokeWidth: 2,
                fillEnabled: true,
                fillColor: '#8b5cf6',
                fillOpacity: 0.6,
                fillPattern: 'dots',
            });
            assert.ok(dotsSvg.body.includes('fill="url(#apolo-fill-dots-8b5cf6)"'));
            assert.ok(dotsSvg.defs);
            assert.ok(dotsSvg.defs['apolo-fill-dots-8b5cf6'].includes('circle cx="4" cy="4" r="1.2"'));
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
            assert.ok(svgString.includes('id="apolo-fill-hachure-3b82f6"'));

            // Deduplication verification: pattern ID should only appear once inside <defs>
            const defsMatch = svgString.match(/<defs>([\s\S]*?)<\/defs>/);
            assert.ok(defsMatch);
            const occurrences = (defsMatch[1].match(/id="apolo-fill-hachure-3b82f6"/g) || []).length;
            assert.strictEqual(occurrences, 1, 'Defs should deduplicate patterns with identical id');

            // Single element render
            const singleSvg = renderElement(element1, 800);
            assert.ok(singleSvg.includes('<rect'));
            assert.ok(singleSvg.includes('fill="url(#apolo-fill-hachure-3b82f6)"'));
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

            // Verify base shape buttons
            const baseSelector = estuche.container.querySelector('.shape-grid-selector');
            assert.ok(baseSelector, 'Must render .shape-grid-selector');
            const baseButtons = baseSelector.children;
            assert.strictEqual(baseButtons.length, 5, 'Must render 5 base shape buttons');

            // Verify custom shapes row exists because diamond, hexagon, cylinder are registered
            const customRow = estuche.container.querySelector('.shape-custom-row');
            assert.ok(customRow, 'Must render custom shapes row');
            const customContainer = customRow.querySelector('.shape-custom-items');
            assert.ok(customContainer, 'Must render .shape-custom-items');
            const customItems = customContainer.children;
            assert.ok(customItems.length >= 1, 'Must render custom shape items in the row');

            // Click custom shape (e.g. first custom button)
            (customItems[0] as HTMLElement).click();
            assert.ok(selectedShape, 'Selecting custom shape button triggers onSelectShapeType');

            // Verify "Formas perfectas (1:1)" switch replaces snapGrid
            const regularizeToggle = Array.from(estuche.container.querySelectorAll('.toggle-label'))
                .find((el) => el.textContent?.includes('Formas perfectas'));
            assert.ok(regularizeToggle, 'Must render "Formas perfectas (1:1)" toggle label');

            const regSwitch = (regularizeToggle.parentElement?.querySelector('.popover-switch')) as HTMLElement;
            assert.ok(regSwitch, 'Must render switch for regularize');
            regSwitch.click();
            assert.strictEqual(toggledRegularize, true, 'Clicking regularize switch triggers onToggleRegularize');

            // Verify Fill toggle row
            const fillToggle = Array.from(estuche.container.querySelectorAll('.toggle-label'))
                .find((el) => el.textContent === 'Relleno');
            assert.ok(fillToggle, 'Must render "Relleno" toggle label');

            const fillSw = (fillToggle.parentElement?.querySelector('.popover-switch')) as HTMLElement;
            assert.ok(fillSw, 'Must render switch for fill');
            fillSw.click();
            assert.strictEqual(toggledFill, true, 'Clicking fill switch triggers onToggleFillEnabled');

            // Verify 4 fill pattern chips
            const fillSubpanel = estuche.container.querySelector('.shape-fill-subpanel');
            assert.ok(fillSubpanel, 'Must render .shape-fill-subpanel');
            const patternGroup = fillSubpanel.querySelector('.line-grid');
            assert.ok(patternGroup, 'Must render pattern group');
            const patternChips = patternGroup.children;
            assert.strictEqual(patternChips.length, 4, 'Must render 4 fill pattern chips');

            // Click hachure pattern chip
            (patternChips[1] as HTMLElement).click();
            assert.strictEqual(changedFillPattern, 'hachure', 'Clicking second pattern chip selects hachure');

            // Verify fill color swatches
            const fillColorRow = fillSubpanel.querySelector('.swatch-row');
            assert.ok(fillColorRow, 'Must render fillColorRow');
            const fillSwatches = fillColorRow.querySelectorAll('.swatch');
            assert.ok(fillSwatches.length >= 4, 'Must render fill color swatches');
            (fillSwatches[0] as HTMLElement).click();
            assert.ok(changedFillColor, 'Clicking fill swatch triggers onChangeFillColor');

            estuche.destroy();
        });
    });
});
