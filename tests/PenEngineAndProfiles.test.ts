import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ToolEstuche, type ToolEstucheState } from '../src/ui/ToolEstuche.ts';
import { PopoverController } from '../src/ui/kit/index.ts';
import {
    computeStraightLinePoints,
    snapLineAngle,
    renderContinuousSolidStroke,
} from '../src/engine/PatternedStrokeRenderer.ts';
import { getPenPlugin } from '../src/engine/pens/index.ts';
import type { PenProfileId, Point, StrokeStyle } from '../src/core/types.ts';

function createMockEnvironment() {
    const listeners = new Map<string, Array<{ listener: Function; options?: any }>>();
    const mockWindow = {
        innerWidth: 1024,
        innerHeight: 768,
        visualViewport: null,
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
    };

    const createElement = (tag: string) => {
        const children: any[] = [];
        const classes = new Set<string>();
        const attributes = new Map<string, string>();
        const elementListeners = new Map<string, Function[]>();
        const styleObj: any = {
            display: '',
            zIndex: '',
            position: '',
            left: '',
            top: '',
            width: '',
            height: '',
            transform: '',
            transformOrigin: '',
            setProperty: (k: string, v: string) => { styleObj[k] = v; },
            getPropertyValue: (k: string) => styleObj[k] ?? '',
        };
        const el: any = {
            tagName: tag.toUpperCase(),
            style: styleObj,
            dataset: {},
            hidden: false,
            className: '',
            children,
            title: '',
            type: '',
            value: '',
            classList: {
                add: (...items: string[]) => {
                    const set = new Set(el.className.split(/\s+/).filter(Boolean));
                    for (const item of items) set.add(item);
                    el.className = [...set].join(' ');
                },
                remove: (...items: string[]) => {
                    const set = new Set(el.className.split(/\s+/).filter(Boolean));
                    for (const item of items) set.delete(item);
                    el.className = [...set].join(' ');
                },
                contains: (c: string) => el.className.split(/\s+/).filter(Boolean).includes(c),
                toggle: (c: string, force?: boolean) => {
                    const set = new Set(el.className.split(/\s+/).filter(Boolean));
                    const next = force !== undefined ? force : !set.has(c);
                    if (next) set.add(c); else set.delete(c);
                    el.className = [...set].join(' ');
                    return next;
                },
            },
            setAttribute: (k: string, v: string) => { attributes.set(k, String(v)); },
            getAttribute: (k: string) => attributes.get(k) ?? null,
            hasAttribute: (k: string) => attributes.has(k),
            removeAttribute: (k: string) => { attributes.delete(k); },
            appendChild: (child: any) => { children.push(child); child.parentElement = el; return child; },
            append: (...args: any[]) => { children.push(...args); for (const c of args) if (c) c.parentElement = el; },
            replaceChildren: (...args: any[]) => { children.length = 0; children.push(...args); for (const c of args) if (c) c.parentElement = el; },
            remove: () => {
                if (el.parentElement?.children) {
                    const idx = el.parentElement.children.indexOf(el);
                    if (idx !== -1) el.parentElement.children.splice(idx, 1);
                }
            },
            contains: (target: any) => target === el || children.some(c => c === target || c?.contains?.(target)),
            addEventListener: (type: string, fn: Function) => {
                if (!elementListeners.has(type)) elementListeners.set(type, []);
                elementListeners.get(type)!.push(fn);
            },
            removeEventListener: (type: string, fn: Function) => {
                const list = elementListeners.get(type);
                if (list) {
                    const idx = list.indexOf(fn);
                    if (idx !== -1) list.splice(idx, 1);
                }
            },
            dispatch: (ev: any) => {
                const list = elementListeners.get(ev.type) || [];
                for (const fn of list) fn(ev);
                return true;
            },
            closest: (sel: string) => {
                if (sel.includes('data-apolo-popover-trigger') && attributes.has('data-apolo-popover-trigger')) {
                    return el;
                }
                return null;
            },
            getBoundingClientRect: () => ({ left: 200, top: 100, right: 244, bottom: 144, width: 44, height: 44 }),
            querySelectorAll: (sel: string) => {
                const matches: any[] = [];
                const check = (node: any) => {
                    if (sel.includes('button') && node.tagName === 'BUTTON') matches.push(node);
                    for (const c of node.children || []) check(c);
                };
                check(el);
                return matches;
            },
        };
        return el;
    };

    const mockDocument = {
        body: createElement('body'),
        createElement,
        createElementNS: (_ns: string, tag: string) => createElement(tag),
        elementsFromPoint: () => [],
    };

    return { mockWindow, mockDocument };
}

describe('Pen Engine, Profiles & Ruler Mode with Magnetic Snapping', () => {

    test('Pen estuche displays fountain, calli, ball, pencil profiles and not hlr', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevWin = (globalThis as any).window;
        const prevDoc = (globalThis as any).document;
        (globalThis as any).window = mockWindow;
        (globalThis as any).document = mockDocument;

        try {
            const popoverController = new PopoverController();
            let selectedProfile: PenProfileId | null = null;

            const initialState: ToolEstucheState = {
                tool: 'pen',
                slot: 'tc',
                color: '#1F4FD8',
                width: 3,
                profileId: 'fountain',
                lineStyle: 'solid',
                pattern: 'solid',
                smoothing: 0.5,
                pressureSensitivity: 0.8,
                favorites: [],
                eraserMode: 'whole',
                eraserRadius: 18,
                scribbleToErase: true,
                lassoMode: 'free',
                shapeType: 'rect',
                snapGrid: false,
                straightenLines: false,
            };

            const estuche = new ToolEstuche(
                initialState,
                {
                    onSelectProfile: (pid) => { selectedProfile = pid; },
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
                    onSelectShapeType: () => {},
                    onToggleSnapGrid: () => {},
                    onClose: () => {},
                },
                mockDocument.body as any,
                popoverController,
            );

            const toolBtn = mockDocument.createElement('button');
            toolBtn.setAttribute('data-apolo-popover-trigger', 'true');
            estuche.open({ tool: 'pen' }, toolBtn as any);

            assert.strictEqual(estuche.isOpen(), true);

            // Verify body contains the tools row
            const body = estuche.container.children[1];
            const toolsRow = body.children[0];
            assert.strictEqual(toolsRow.className, 'popover-tools-selector');

            // Find all tool buttons in the pen selector
            const toolButtons = toolsRow.children;
            assert.strictEqual(toolButtons.length, 4, 'Pen selector must offer exactly 4 pen profiles');

            const buttonTitles = toolButtons.map((b: any) => b.title);
            assert.deepStrictEqual(
                buttonTitles,
                ['Estilográfica', 'Caligráfica', 'Bolígrafo', 'Lápiz de mina'],
                'Profiles must be fountain, calli, ball, and pencil in order'
            );

            // Assert 'hlr' or highlighter tip is NOT present in pen content
            for (const b of toolButtons) {
                assert.notStrictEqual(b.title, 'Biselado', 'Highlighter chisel should not be in pen estuche');
                assert.notStrictEqual(b.title, 'Redondo', 'Highlighter round should not be in pen estuche');
                assert.ok(!b.title.toLowerCase().includes('resaltador'), 'No highlighter profile in pen estuche');
            }

            // Click Bolígrafo (index 2)
            toolButtons[2].onclick();
            assert.strictEqual(selectedProfile, 'ball', 'Clicking Bolígrafo must emit ball profile id');
            assert.strictEqual(toolButtons[2].classList.contains('is-active'), true);
            assert.strictEqual(toolButtons[0].classList.contains('is-active'), false);

            // Click Caligráfica (index 1)
            toolButtons[1].onclick();
            assert.strictEqual(selectedProfile, 'calli', 'Clicking Caligráfica must emit calli profile id');

            // Click Lápiz de mina (index 3)
            toolButtons[3].onclick();
            assert.strictEqual(selectedProfile, 'pencil', 'Clicking Lápiz must emit pencil profile id');

            // Click Estilográfica (index 0)
            toolButtons[0].onclick();
            assert.strictEqual(selectedProfile, 'fountain', 'Clicking Estilográfica must emit fountain profile id');

            estuche.close();
            estuche.destroy();
            popoverController.destroy();
        } finally {
            (globalThis as any).window = prevWin;
            (globalThis as any).document = prevDoc;
        }
    });

    test('Selecting dashed or dotted in ToolEstuche updates StrokeStyle pattern', () => {
        const { mockWindow, mockDocument } = createMockEnvironment();
        const prevWin = (globalThis as any).window;
        const prevDoc = (globalThis as any).document;
        (globalThis as any).window = mockWindow;
        (globalThis as any).document = mockDocument;

        try {
            const popoverController = new PopoverController();
            let selectedPattern: string | null = null;
            let straightenToggled: boolean | null = null;

            const currentStyle: StrokeStyle = {
                color: '#1F4FD8',
                width: 3,
                opacity: 1,
                pattern: 'solid',
                lineCap: 'round',
            };

            const initialState: ToolEstucheState = {
                tool: 'pen',
                slot: 'tc',
                color: currentStyle.color,
                width: currentStyle.width,
                profileId: 'fountain',
                lineStyle: 'solid',
                pattern: 'solid',
                smoothing: 0.5,
                pressureSensitivity: 0.8,
                favorites: [],
                eraserMode: 'whole',
                eraserRadius: 18,
                scribbleToErase: true,
                lassoMode: 'free',
                shapeType: 'rect',
                snapGrid: false,
                straightenLines: false,
            };

            const estuche = new ToolEstuche(
                initialState,
                {
                    onSelectProfile: () => {},
                    onChangeColor: () => {},
                    onChangeWidth: () => {},
                    onChangeSmoothing: () => {},
                    onChangePressure: () => {},
                    onChangeLineStyle: (pattern) => {
                        selectedPattern = pattern;
                        currentStyle.pattern = pattern;
                    },
                    onToggleStraighten: (enabled) => {
                        straightenToggled = enabled;
                    },
                    onUseFavorite: () => {},
                    onSaveFavorite: () => {},
                    onSelectEraserMode: () => {},
                    onChangeEraserRadius: () => {},
                    onToggleScribble: () => {},
                    onSelectLassoMode: () => {},
                    onSelectShapeType: () => {},
                    onToggleSnapGrid: () => {},
                    onClose: () => {},
                },
                mockDocument.body as any,
                popoverController,
            );

            const toolBtn = mockDocument.createElement('button');
            toolBtn.setAttribute('data-apolo-popover-trigger', 'true');
            estuche.open({ tool: 'pen' }, toolBtn as any);

            const findButtons = (node: any, className: string): any[] => {
                const matches = node.className?.split(/\s+/).includes(className) ? [node] : [];
                for (const child of node.children || []) matches.push(...findButtons(child, className));
                return matches;
            };

            const body = estuche.container.children[1];
            const lineStyleButtons = findButtons(body, 'popover-line-chip');
            assert.strictEqual(lineStyleButtons.length, 3, 'Should render solid, dashed, and dotted chips');

            // Initial: solid is active
            assert.strictEqual(lineStyleButtons[0].getAttribute('aria-pressed'), 'true');
            assert.strictEqual(currentStyle.pattern, 'solid');

            // Select dashed (index 1)
            lineStyleButtons[1].onclick();
            assert.strictEqual(selectedPattern, 'dashed');
            assert.strictEqual(currentStyle.pattern, 'dashed');
            assert.strictEqual(lineStyleButtons[1].getAttribute('aria-pressed'), 'true');
            assert.strictEqual(lineStyleButtons[0].getAttribute('aria-pressed'), 'false');

            // Select dotted (index 2)
            lineStyleButtons[2].onclick();
            assert.strictEqual(selectedPattern, 'dotted');
            assert.strictEqual(currentStyle.pattern, 'dotted');
            assert.strictEqual(lineStyleButtons[2].getAttribute('aria-pressed'), 'true');
            assert.strictEqual(lineStyleButtons[1].getAttribute('aria-pressed'), 'false');

            // Verify Straighten switch works in estuche
            const switchBtns = findButtons(body, 'popover-switch');
            assert.ok(switchBtns.length >= 1, 'Straighten switch toggle button must exist');
            switchBtns[0].onclick();
            assert.strictEqual(straightenToggled, true, 'Clicking straighten switch must emit true');

            estuche.close();
            estuche.destroy();
            popoverController.destroy();
        } finally {
            (globalThis as any).window = prevWin;
            (globalThis as any).document = prevDoc;
        }
    });

    test('snapLineAngle correctly snaps cardinal and intermediate angles within magnetic tolerance', () => {
        // Cardinals: 0, 90, 180, 270 (tolerance 6.0 deg)
        assert.strictEqual(snapLineAngle(0), 0);
        assert.strictEqual(snapLineAngle(3), 0, '3 deg snaps to 0');
        assert.strictEqual(snapLineAngle(5.9), 0, '5.9 deg snaps to 0');
        assert.strictEqual(snapLineAngle(357), 0, '357 (-3) deg snaps to 0');
        assert.strictEqual(snapLineAngle(354.1), 0, '354.1 deg snaps to 0');
        assert.strictEqual(snapLineAngle(86), 90, '86 deg snaps to 90');
        assert.strictEqual(snapLineAngle(94), 90, '94 deg snaps to 90');
        assert.strictEqual(snapLineAngle(176), 180, '176 deg snaps to 180');
        assert.strictEqual(snapLineAngle(185), 180, '185 deg snaps to 180');
        assert.strictEqual(snapLineAngle(268), 270, '268 deg snaps to 270');
        assert.strictEqual(snapLineAngle(275), 270, '275 deg snaps to 270');

        // Cardinals boundary (> 6.0 deg does not snap to cardinal)
        assert.strictEqual(snapLineAngle(7), 7, '7 deg exceeds 6 deg threshold');
        assert.strictEqual(snapLineAngle(83), 83, '83 deg exceeds 6 deg threshold');

        // Intermediate angles (30, 45, 60, 120, 135, 150, 210, 225, 240, 300, 315, 330) (tolerance 3.5 deg)
        assert.strictEqual(snapLineAngle(43), 45, '43 deg snaps to 45');
        assert.strictEqual(snapLineAngle(47), 45, '47 deg snaps to 45');
        assert.strictEqual(snapLineAngle(29), 30, '29 deg snaps to 30');
        assert.strictEqual(snapLineAngle(32), 30, '32 deg snaps to 30');
        assert.strictEqual(snapLineAngle(62), 60, '62 deg snaps to 60');
        assert.strictEqual(snapLineAngle(136), 135, '136 deg snaps to 135');
        assert.strictEqual(snapLineAngle(224), 225, '224 deg snaps to 225');
        assert.strictEqual(snapLineAngle(314), 315, '314 deg snaps to 315');

        // Intermediate boundary (> 3.5 deg retains raw angle)
        assert.strictEqual(snapLineAngle(40), 40, '40 deg retains raw angle');
        assert.strictEqual(snapLineAngle(50), 50, '50 deg retains raw angle');
    });

    test('Straight-line mode produces 100% collinear points from curved pointer inputs with angle snapping', () => {
        const startPoint: Point = { x: 100, y: 100, pressure: 0.3, time: 1000 };

        // Test 1: Pointer coordinates dragging at ~3 degrees (e.g. dx=200, dy=10.48 -> 3.0 deg)
        const rad3 = 3 * Math.PI / 180;
        const currentPt3: Point = {
            x: startPoint.x + 200 * Math.cos(rad3),
            y: startPoint.y + 200 * Math.sin(rad3),
            pressure: 0.8,
            time: 1500,
        };

        const result3 = computeStraightLinePoints(startPoint, currentPt3, 1.0);
        assert.strictEqual(result3.snappedDeg, 0, 'Angle ~3 deg must snap to 0 deg');
        assert.ok(Math.abs(result3.end.y - startPoint.y) < 1e-4, 'End point y must be identical to start y when snapped to 0');
        assert.strictEqual(result3.points[0].x, startPoint.x);
        assert.strictEqual(result3.points[0].y, startPoint.y);

        // Mathematical Collinearity Test on all generated points:
        // Cross product: (y_i - y_0)*(x_N - x_0) - (x_i - x_0)*(y_N - y_0) === 0
        const end3 = result3.end;
        for (const pt of result3.points) {
            const cross = Math.abs((pt.y - startPoint.y) * (end3.x - startPoint.x) - (pt.x - startPoint.x) * (end3.y - startPoint.y));
            assert.ok(cross < 1e-4, `Point (${pt.x}, ${pt.y}) must be perfectly collinear (cross: ${cross})`);
        }

        // Test 2: Pointer dragging at ~86 degrees (e.g. dx=200*cos(86°), dy=200*sin(86°) -> snaps to 90°)
        const rad86 = 86 * Math.PI / 180;
        const currentPt86: Point = {
            x: startPoint.x + 250 * Math.cos(rad86),
            y: startPoint.y + 250 * Math.sin(rad86),
            pressure: 0.7,
            time: 1600,
        };

        const result86 = computeStraightLinePoints(startPoint, currentPt86, 1.0);
        assert.strictEqual(result86.snappedDeg, 90, 'Angle ~86 deg must snap to 90 deg');
        assert.ok(Math.abs(result86.end.x - startPoint.x) < 1e-4, 'End point x must equal start x when snapped to 90');
        const end86 = result86.end;
        for (const pt of result86.points) {
            const cross = Math.abs((pt.y - startPoint.y) * (end86.x - startPoint.x) - (pt.x - startPoint.x) * (end86.y - startPoint.y));
            assert.ok(cross < 1e-4, `Point must be collinear for 90 deg snap (cross: ${cross})`);
        }

        // Test 3: Pointer dragging at ~43 degrees (snaps to 45°)
        const rad43 = 43 * Math.PI / 180;
        const currentPt43: Point = {
            x: startPoint.x + 180 * Math.cos(rad43),
            y: startPoint.y + 180 * Math.sin(rad43),
            pressure: 0.6,
            time: 1400,
        };

        const result43 = computeStraightLinePoints(startPoint, currentPt43, 1.0);
        assert.strictEqual(result43.snappedDeg, 45, 'Angle ~43 deg must snap to 45 deg');
        const dx45 = result43.end.x - startPoint.x;
        const dy45 = result43.end.y - startPoint.y;
        assert.ok(Math.abs(dx45 - dy45) < 1e-4, 'At 45 deg, dx and dy must be equal');
        const end43 = result43.end;
        for (const pt of result43.points) {
            const cross = Math.abs((pt.y - startPoint.y) * (end43.x - startPoint.x) - (pt.x - startPoint.x) * (end43.y - startPoint.y));
            assert.ok(cross < 1e-4, `Point must be collinear for 45 deg snap (cross: ${cross})`);
        }

        // Test 4: Pressure and Time linear interpolation
        assert.strictEqual(result43.points[0].pressure, startPoint.pressure);
        assert.strictEqual(result43.points[result43.points.length - 1].pressure, currentPt43.pressure);
        assert.strictEqual(result43.points[0].time, startPoint.time);
        assert.strictEqual(result43.points[result43.points.length - 1].time, currentPt43.time);
    });

    test('All 4 pen profiles render collinear straight-line points cleanly on canvas and SVG', () => {
        const startPoint: Point = { x: 50, y: 50, pressure: 0.4, time: 100 };
        const currentPoint: Point = { x: 300, y: 53, pressure: 0.8, time: 300 }; // ~0.7 deg, snaps to 0

        const { points } = computeStraightLinePoints(startPoint, currentPoint, 1.0);
        assert.ok(points.length >= 2, 'Collinear points count must be at least 2');

        const mockCtx: any = {
            save: () => {},
            restore: () => {},
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            quadraticCurveTo: () => {},
            arc: () => {},
            ellipse: () => {},
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

        const profiles: PenProfileId[] = ['ball', 'fountain', 'calli', 'pencil'];

        for (const pid of profiles) {
            const plugin = getPenPlugin(pid);
            const style: StrokeStyle = {
                color: '#1F4FD8',
                width: 3.5,
                opacity: 0.9,
                pattern: 'solid',
                profile: pid,
            };

            // Canvas rendering
            assert.doesNotThrow(() => {
                plugin.renderCanvas(mockCtx, points, style);
            }, `renderCanvas for ${pid} must execute without error on collinear points`);

            // Continuous solid stroke wrapper
            assert.doesNotThrow(() => {
                renderContinuousSolidStroke(mockCtx, points, style);
            }, `renderContinuousSolidStroke for ${pid} must execute without error`);

            // SVG generation
            assert.doesNotThrow(() => {
                const svg = plugin.renderSvg(points, style);
                assert.ok(svg.body.length > 0, `SVG body for ${pid} must be non-empty`);
                assert.ok(svg.body.includes('<path') || svg.body.includes('<circle'), `SVG body must contain valid elements for ${pid}`);
            }, `renderSvg for ${pid} must return valid SVG on collinear points`);
        }
    });
});
