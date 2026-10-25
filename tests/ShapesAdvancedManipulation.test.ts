import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    getShapePlugin,
    applyLinearHandleDrag,
    splitLinearSegment,
    straightenLinearSegment,
    toggleLinearNodeKind,
    toggleNodeOrSegmentOrthogonal,
    insertLinearNodeAtPoint,
    snapAngleOrOrthogonal,
    getLinearPathNodes,
    linearControlHandles,
    applyRotationDrag,
    rotatePoint,
    boxSnapPorts,
    computeSmartAlignmentGuides,
    getSvgFillAttributes,
    type ShapeRenderGeometry,
    type ShapePathNode,
} from '../src/engine/shapes/index.ts';
import { renderElement } from '../src/io/PersistenceQueue.ts';
import type { ShapeElement } from '../src/core/types.ts';

describe('Stage 5 — Advanced Shape Manipulation (Affinity / CAD Vectors)', () => {

    // =======================================================================
    // 1. Multi-Segment Straight/Curved Bezier Paths (line & arrow)
    // =======================================================================
    describe('1. Multi-Segment Straight/Curved Bezier Paths', () => {
        test('multi-segment path with mixed straight and cubic Bezier segments renders properly', () => {
            const line = getShapePlugin('line');
            const geom: ShapeRenderGeometry = {
                x0: 0,
                y0: 0,
                x1: 300,
                y1: 100,
                pathNodes: [
                    { x: 0, y: 0, nodeKind: 'sharp' },
                    {
                        x: 100,
                        y: 50,
                        nodeKind: 'smooth',
                        handleIn: { x: 80, y: 40 },
                        handleOut: { x: 120, y: 60 },
                    },
                    { x: 300, y: 100, nodeKind: 'sharp' },
                ],
            };

            const handles = line.getControlHandles(geom);
            const ids = handles.map(h => h.id);
            assert.ok(ids.includes('start'), 'Contains start anchor node');
            assert.ok(ids.includes('node-1'), 'Contains intermediate node-1 anchor');
            assert.ok(ids.includes('end'), 'Contains end anchor node');
            assert.ok(ids.includes('seg-mid-0'), 'Contains midpoint handle for segment 0');
            assert.ok(ids.includes('seg-mid-1'), 'Contains midpoint handle for segment 1');
            assert.ok(ids.includes('bezier-in-1'), 'Contains cubic tangent handleIn for node-1');
            assert.ok(ids.includes('bezier-out-1'), 'Contains cubic tangent handleOut for node-1');

            const svg = line.renderSvg(geom, { strokeColor: '#FF0000', strokeWidth: 2 }).body;
            assert.ok(svg.includes('C'), 'Curved segment uses cubic Bezier C command');
        });

        test('push-pull midpoint bend handle curves a straight segment', () => {
            const line = getShapePlugin('line');
            const geom: ShapeRenderGeometry = {
                x0: 0,
                y0: 0,
                x1: 200,
                y1: 0,
                pathNodes: [
                    { x: 0, y: 0, nodeKind: 'smooth' },
                    { x: 100, y: 0, nodeKind: 'smooth' },
                    { x: 200, y: 0, nodeKind: 'smooth' },
                ],
            };

            // Bend segment 0 by dragging seg-mid-0 to (50, 40)
            const bent = line.applyHandleDrag(geom, 'seg-mid-0', { x: 50, y: 40 });
            const n0 = bent.pathNodes![0];
            const n1 = bent.pathNodes![1];
            assert.ok(n0.handleOut !== undefined, 'Node 0 gets handleOut');
            assert.ok(n1.handleIn !== undefined, 'Node 1 gets handleIn');

            // Dragging close to the straight chord (within 4px) snaps straight
            const straightened = line.applyHandleDrag(bent, 'seg-mid-0', { x: 50, y: 1 });
            assert.equal(straightened.pathNodes![0].handleOut, undefined, 'Snaps straight: handleOut cleared');
            assert.equal(straightened.pathNodes![1].handleIn, undefined, 'Snaps straight: handleIn cleared');
        });

        test('splitLinearSegment splits a segment by inserting an intermediate node', () => {
            const geom: ShapeRenderGeometry = {
                x0: 0,
                y0: 0,
                x1: 200,
                y1: 0,
                pathNodes: [
                    { x: 0, y: 0, nodeKind: 'sharp' },
                    { x: 200, y: 0, nodeKind: 'sharp' },
                ],
            };

            const split = splitLinearSegment(geom, 0);
            assert.equal(split.pathNodes?.length, 3, 'Path now has 3 nodes');
            assert.equal(split.pathNodes[1].x, 100, 'Middle node inserted at midpoint x');
            assert.equal(split.pathNodes[1].y, 0, 'Middle node inserted at midpoint y');
        });

        test('toggleLinearNodeKind toggles node continuity between sharp and smooth', () => {
            const geom: ShapeRenderGeometry = {
                x0: 0,
                y0: 0,
                x1: 200,
                y1: 0,
                pathNodes: [
                    { x: 0, y: 0, nodeKind: 'sharp' },
                    { x: 100, y: 0, nodeKind: 'sharp' },
                    { x: 200, y: 0, nodeKind: 'sharp' },
                ],
            };

            const toggled = toggleLinearNodeKind(geom, 1);
            assert.equal(toggled.pathNodes![1].nodeKind, 'smooth', 'Toggles sharp to smooth');

            const toggledBack = toggleLinearNodeKind(toggled, 1);
            assert.equal(toggledBack.pathNodes![1].nodeKind, 'sharp', 'Toggles smooth to sharp');
        });

        
        test('start and end points expose control handles bezier-out-0 and bezier-in-last to modify curve directly', () => {
            const line = getShapePlugin('line');
            const geom: ShapeRenderGeometry = {
                x0: 0,
                y0: 0,
                x1: 200,
                y1: 0,
                pathNodes: [
                    { x: 0, y: 0, nodeKind: 'sharp' },
                    { x: 200, y: 0, nodeKind: 'sharp' },
                ],
            };

            const handles = line.getControlHandles(geom);
            const ids = handles.map(h => h.id);
            assert.ok(ids.includes('bezier-out-0'), 'Start point exposes outgoing control handle');
            assert.ok(ids.includes('bezier-in-1'), 'End point exposes incoming control handle');

            // Dragging start control handle curves the path from the start point
            const curvedFromStart = line.applyHandleDrag(geom, 'bezier-out-0', { x: 50, y: 50 });
            assert.deepEqual(curvedFromStart.pathNodes![0].handleOut, { x: 50, y: 50 });

            // Dragging end control handle curves the path into the end point
            const curvedFromEnd = line.applyHandleDrag(curvedFromStart, 'bezier-in-1', { x: 150, y: 50 });
            assert.deepEqual(curvedFromEnd.pathNodes![1].handleIn, { x: 150, y: 50 });
        });

        test('toggleNodeOrSegmentOrthogonal toggles between 90-degree orthogonal corner and curved Bezier on click', () => {
            const geom: ShapeRenderGeometry = {
                x0: 0,
                y0: 0,
                x1: 200,
                y1: 200,
                pathNodes: [
                    { x: 0, y: 0, nodeKind: 'sharp' },
                    { x: 100, y: 150, nodeKind: 'smooth', handleIn: { x: 80, y: 130 }, handleOut: { x: 120, y: 170 } },
                    { x: 200, y: 200, nodeKind: 'sharp' },
                ],
            };

            // Clicking curved node-1 toggles it to 90-degree sharp corner
            const sharp90 = toggleNodeOrSegmentOrthogonal(geom, 'node-1');
            assert.equal(sharp90.pathNodes![1].nodeKind, 'sharp');
            assert.equal(sharp90.pathNodes![1].handleIn, undefined);
            assert.equal(sharp90.pathNodes![1].handleOut, undefined);
            // The orthogonal alignment puts node-1 at either (0, 200) or (200, 0)
            const n1 = sharp90.pathNodes![1];
            assert.ok((n1.x === 0 && n1.y === 200) || (n1.x === 200 && n1.y === 0));

            // Clicking again toggles back to smooth curved Bezier
            const curvedBack = toggleNodeOrSegmentOrthogonal(sharp90, 'node-1');
            assert.equal(curvedBack.pathNodes![1].nodeKind, 'smooth');
            assert.ok(curvedBack.pathNodes![1].handleIn !== undefined);
            assert.ok(curvedBack.pathNodes![1].handleOut !== undefined);
        });

        test('snapAngleOrOrthogonal provides 15-degree increments and magnetic orthogonal locks when regularize/Shift is active', () => {
            const origin = { x: 100, y: 100 };

            // Near horizontal (dy = 4px <= 8px): locks to exact horizontal dy = 0
            const snapHoriz = snapAngleOrOrthogonal(origin, { x: 200, y: 104 });
            assert.equal(snapHoriz.y, 100, 'Magnetic orthogonal lock to dy = 0');

            // Near vertical (dx = 5px <= 8px): locks to exact vertical dx = 0
            const snapVert = snapAngleOrOrthogonal(origin, { x: 105, y: 250 });
            assert.equal(snapVert.x, 100, 'Magnetic orthogonal lock to dx = 0');

            // 15-degree step snap (PI / 12)
            const point14deg = { x: 100 + 100 * Math.cos((14 * Math.PI) / 180), y: 100 + 100 * Math.sin((14 * Math.PI) / 180) };
            const snapped15 = snapAngleOrOrthogonal(origin, point14deg);
            const snappedAngleDeg = Math.round((Math.atan2(snapped15.y - origin.y, snapped15.x - origin.x) * 180) / Math.PI);
            assert.equal(snappedAngleDeg, 15, 'Snaps to 15 degrees increment');
        });

        test('insertLinearNodeAtPoint allows creating new points anywhere along the line, not just at the center suggestion', () => {
            const geom: ShapeRenderGeometry = {
                x0: 0,
                y0: 0,
                x1: 300,
                y1: 0,
                pathNodes: [
                    { x: 0, y: 0, nodeKind: 'sharp' },
                    { x: 300, y: 0, nodeKind: 'sharp' },
                ],
            };

            // Click at x = 75 (25% along the segment, far from center x = 150)
            const result = insertLinearNodeAtPoint(geom, { x: 75, y: 0 });
            assert.ok(result !== null, 'Point successfully inserted');
            assert.equal(result.geom.pathNodes?.length, 3, 'Path now has 3 nodes');
            assert.equal(result.handleId, 'node-1', 'Returns handleId for new node');
            assert.ok(Math.abs(result.geom.pathNodes![1].x - 75) < 5, 'New node is inserted at 25% (x ~ 75), not center');
        });

        test('arrowhead follows cubic curve terminal tangent', () => {
            const arrow = getShapePlugin('arrow');
            const geom: ShapeRenderGeometry = {
                x0: 0,
                y0: 0,
                x1: 200,
                y1: 0,
                pathNodes: [
                    { x: 0, y: 0, handleOut: { x: 50, y: 80 } },
                    { x: 200, y: 0, handleIn: { x: 150, y: 80 } },
                ],
            };

            const svg = arrow.renderSvg(geom, { strokeWidth: 3 }).body;
            assert.ok(svg.includes('L 200 0'), 'Arrowhead touches the tip at (200, 0)');
            // Arrowhead barbs sit above the tip because tangent approaches downwards
            const barbMatches = [...svg.matchAll(/M ([\d.-]+) ([\d.-]+) L 200 0 L ([\d.-]+) ([\d.-]+)/g)];
            assert.ok(barbMatches.length > 0, 'Renders arrowhead polygon path');
        });
    });

    // =======================================================================
    // 2. Free Rotation Handle & Snapping Engine
    // =======================================================================
    describe('2. Free Rotation Handle & Snapping Engine', () => {
        test('closed shapes expose rotate handle at minY - 24', () => {
            const rect = getShapePlugin('rectangle');
            const geom: ShapeRenderGeometry = { x0: 100, y0: 100, x1: 300, y1: 200 };
            const handles = rect.getControlHandles(geom);
            const rotHandle = handles.find(h => h.id === 'rotate');
            assert.ok(rotHandle !== undefined, 'Rotate handle is present');
            assert.equal(rotHandle.kind, 'rotate');
            assert.equal(rotHandle.x, 200, 'Rotate handle sits horizontally at center');
            assert.equal(rotHandle.y, 76, 'Rotate handle sits 24px above top edge');
        });

        test('cardinal magnetic snap locks within +/- 3 degrees of 0, 90, 180, 270', () => {
            const geom: ShapeRenderGeometry = { x0: 0, y0: 0, x1: 100, y1: 100 };
            // Center is (50, 50). Top is (50, -24).
            // Small offset 2 degrees clockwise from top (angle = 2 deg)
            const target2Deg = rotatePoint(50, -24, 50, 50, 2 * Math.PI / 180);
            const snapped0 = applyRotationDrag(geom, target2Deg);
            assert.equal(snapped0.rotation, 0, 'Snaps to cardinal 0 degrees');

            // 91 degrees clockwise (within 1 deg of 90)
            const target91Deg = rotatePoint(50, -24, 50, 50, 91 * Math.PI / 180);
            const snapped90 = applyRotationDrag(geom, target91Deg);
            assert.equal(Number(snapped90.rotation?.toFixed(4)), Number((Math.PI / 2).toFixed(4)), 'Snaps to cardinal 90 degrees');
        });

        
        test('regularize deactivates on drag when Formas Perfectas is off and Shift is not pressed', () => {
            const rect = getShapePlugin('rectangle');
            // Shape originally created with regularize: true (a square)
            const squareGeom: ShapeRenderGeometry = { x0: 0, y0: 0, x1: 100, y1: 100, regularize: true };

            // When regularize is explicitly false (button off and no Shift):
            // dragging 'se' handle to (200, 150) should freely produce a non-square 200x150 rectangle, NOT locked to 1:1!
            const freeRect = rect.applyHandleDrag(squareGeom, 'se', { x: 200, y: 150 }, false);
            assert.equal(freeRect.x1, 200);
            assert.equal(freeRect.y1, 150);
            assert.equal(Math.abs(freeRect.x1 - freeRect.x0), 200);
            assert.equal(Math.abs(freeRect.y1 - freeRect.y0), 150);
            assert.equal(freeRect.regularize, false, 'Attribute regularize is cleared to false');

            // Similarly for ellipse
            const ellipse = getShapePlugin('ellipse');
            const circleGeom: ShapeRenderGeometry = { x0: 0, y0: 0, x1: 100, y1: 100, regularize: true };
            const freeEllipse = ellipse.applyHandleDrag(circleGeom, 'se', { x: 250, y: 120 }, false);
            assert.equal(freeEllipse.x1, 250);
            assert.equal(freeEllipse.y1, 120);
            assert.equal(freeEllipse.regularize, false, 'Attribute regularize on ellipse is cleared to false');
        });

        test('regularize snaps rotation to 15-degree increments (PI / 12)', () => {
            const geom: ShapeRenderGeometry = { x0: 0, y0: 0, x1: 100, y1: 100 };
            // Drag to 38 degrees
            const target38Deg = rotatePoint(50, -24, 50, 50, 38 * Math.PI / 180);
            const snapped45 = applyRotationDrag(geom, target38Deg, true);
            const expected45 = 45 * Math.PI / 180;
            assert.equal(Number(snapped45.rotation?.toFixed(4)), Number(expected45.toFixed(4)), 'Snaps 38 deg to 45 deg with regularize');
        });

        test('rotated shapes rotate their snap ports around shape center', () => {
            const geom: ShapeRenderGeometry = { x0: 0, y0: 0, x1: 100, y1: 100, rotation: Math.PI / 2 };
            const ports = boxSnapPorts(geom);
            const northPort = ports.find(p => p.id === 'n')!;
            // Unrotated 'n' is at (50, 0). Rotated 90 deg clockwise around (50, 50) moves it to (100, 50)!
            assert.equal(Math.round(northPort.x), 100, 'Rotated north port is at east edge');
            assert.equal(Math.round(northPort.y), 50, 'Rotated north port is at middle Y');
        });

        test('SVG export wraps rotated shapes in <g transform="rotate(deg cx cy)">', () => {
            const element: ShapeElement = {
                id: 'rect-rot-1',
                type: 'shape',
                shapeType: 'rectangle',
                blockId: 'block-1',
                startX: 100,
                startY: 100,
                endX: 300,
                endY: 200,
                rotation: Math.PI / 2, // 90 degrees
                style: { width: 2, color: '#000000' },
                bounds: { minX: 100, minY: 100, maxX: 300, maxY: 200 },
            };

            const svg = renderElement(element, 1);
            assert.ok(svg.includes('<g transform="rotate(90.00'), 'Includes rotate transform in SVG group');
        });

        test('hit-testing inverse rotates the test point', () => {
            const rect = getShapePlugin('rectangle');
            // 200x50 horizontal rect, rotated 90 deg to vertical
            const geom: ShapeRenderGeometry = { x0: 0, y0: 75, x1: 200, y1: 125, rotation: Math.PI / 2 };
            // Unrotated rect is around center (100, 100).
            // Rotated rect is 50 wide x 200 high, covering x in [75, 125], y in [0, 200].
            assert.ok(rect.hitTest(geom, { x: 100, y: 150 }, 5), 'Point in rotated vertical rectangle is hit');
            assert.ok(!rect.hitTest(geom, { x: 180, y: 100 }, 5), 'Old horizontal edge point is NOT hit');
        });

        test('rotated box resize keeps opposite anchor stationary in world coordinates (zero translation drift)', () => {
            const rect = getShapePlugin('rectangle');
            // Rotated 30 degrees around center
            const rot = 30 * Math.PI / 180;
            const geom: ShapeRenderGeometry = { x0: 100, y0: 100, x1: 300, y1: 200, rotation: rot };
            const cx = 200;
            const cy = 150;

            // 1. Test corner resize: handle 'se' (anchor is 'nw' corner at unrotated (100, 100))
            const worldAnchorNW = rotatePoint(100, 100, cx, cy, rot);
            const resizedSE = rect.applyHandleDrag(geom, 'se', { x: 350, y: 250 }, false);
            const newCxSE = (resizedSE.x0 + resizedSE.x1) / 2;
            const newCySE = (resizedSE.y0 + resizedSE.y1) / 2;
            const newWorldAnchorNW = rotatePoint(
                Math.min(resizedSE.x0, resizedSE.x1),
                Math.min(resizedSE.y0, resizedSE.y1),
                newCxSE,
                newCySE,
                rot
            );
            const driftNW = Math.hypot(worldAnchorNW.x - newWorldAnchorNW.x, worldAnchorNW.y - newWorldAnchorNW.y);
            assert.ok(driftNW < 1e-4, `Opposite anchor NW stayed strictly invariant (drift = ${driftNW})`);

            // 2. Test corner resize: handle 'nw' (anchor is 'se' corner at unrotated (300, 200))
            const worldAnchorSE = rotatePoint(300, 200, cx, cy, rot);
            const resizedNW = rect.applyHandleDrag(geom, 'nw', { x: 50, y: 50 }, false);
            const newCxNW = (resizedNW.x0 + resizedNW.x1) / 2;
            const newCyNW = (resizedNW.y0 + resizedNW.y1) / 2;
            const newWorldAnchorSE = rotatePoint(
                Math.max(resizedNW.x0, resizedNW.x1),
                Math.max(resizedNW.y0, resizedNW.y1),
                newCxNW,
                newCyNW,
                rot
            );
            const driftSE = Math.hypot(worldAnchorSE.x - newWorldAnchorSE.x, worldAnchorSE.y - newWorldAnchorSE.y);
            assert.ok(driftSE < 1e-4, `Opposite anchor SE stayed strictly invariant (drift = ${driftSE})`);

            // 3. Test edge resize: handle 'e' (anchor is west edge at unrotated x=100, y=cy)
            const worldAnchorW = rotatePoint(100, cy, cx, cy, rot);
            const resizedE = rect.applyHandleDrag(geom, 'e', { x: 380, y: 150 }, false);
            const newCxE = (resizedE.x0 + resizedE.x1) / 2;
            const newCyE = (resizedE.y0 + resizedE.y1) / 2;
            const newWorldAnchorW = rotatePoint(
                Math.min(resizedE.x0, resizedE.x1),
                newCyE,
                newCxE,
                newCyE,
                rot
            );
            const driftW = Math.hypot(worldAnchorW.x - newWorldAnchorW.x, worldAnchorW.y - newWorldAnchorW.y);
            assert.ok(driftW < 1e-4, `Opposite edge W stayed strictly invariant (drift = ${driftW})`);
        });

        test('rotation stem line connects directly from rotated shape top edge to rotation handle', () => {
            const rect = getShapePlugin('rectangle');
            const rot = 45 * Math.PI / 180;
            const geom: ShapeRenderGeometry = { x0: 100, y0: 100, x1: 300, y1: 200, rotation: rot };
            const handles = rect.getControlHandles(geom);
            const rotHandle = handles.find(h => h.kind === 'rotate')!;
            assert.ok(rotHandle !== undefined, 'Rotation handle exists');

            const cx = 200;
            const cy = 150;
            const midX = 200;
            const minY = 100;
            // The top-center edge point rotated by 45 degrees
            const stemStart = rotatePoint(midX, minY, cx, cy, rot);

            // Vector from stemStart to rotHandle should have length 24px and angle matching the shape's orientation
            const stemLength = Math.hypot(rotHandle.x - stemStart.x, rotHandle.y - stemStart.y);
            assert.ok(Math.abs(stemLength - 24) < 1e-4, `Stem length is exactly 24px (got ${stemLength})`);

            // Both points lie along the rotated upward normal (-90 deg from horizontal + rot)
            const expectedRotHandle = rotatePoint(midX, minY - 24, cx, cy, rot);
            assert.ok(Math.hypot(rotHandle.x - expectedRotHandle.x, rotHandle.y - expectedRotHandle.y) < 1e-4);
        });

        test('pattern fills counter-rotate to maintain global orientation in SVG and Canvas', () => {
            // Test SVG output counter-rotates the pattern so lines maintain global angle
            const style = {
                fillEnabled: true,
                fillPattern: 'hachure' as const,
                fillColor: '#FF0000',
                fillDensity: 3,
            };

            // Unrotated: 45 degree hatch
            const unrotSvg = getSvgFillAttributes(style);
            assert.ok(unrotSvg.defs && unrotSvg.defs['apolo-fill-hachure-FF0000-d3']);
            assert.ok(unrotSvg.defs['apolo-fill-hachure-FF0000-d3'].includes('patternTransform="rotate(45)"'));

            // Shape rotated by 30 degrees: pattern is counter-rotated by 30 deg (net angle 45 - 30 = 15 deg in local coordinates)
            // When the shape's <g> rotates by +30 deg, world angle is 15 + 30 = 45 deg (globally constant!)
            const rot30Svg = getSvgFillAttributes(style, { shapeRotationDeg: 30 });
            const patternDefKey = Object.keys(rot30Svg.defs!)[0];
            assert.ok(rot30Svg.defs![patternDefKey].includes('patternTransform="rotate(15)"'));

            // Similarly for cross-hatch
            const crossStyle = { ...style, fillPattern: 'cross-hatch' as const };
            const rot45Cross = getSvgFillAttributes(crossStyle, { shapeRotationDeg: 45 });
            const crossKey = Object.keys(rot45Cross.defs!)[0];
            // 45 - 45 = 0 degrees in patternTransform
            assert.ok(rot45Cross.defs![crossKey].includes('patternTransform="rotate(0)"'));
        });
    });

    // =======================================================================
    // 3. 3D & Custom Parametric Handles (cylinder & hexagon)
    // =======================================================================
    describe('3. 3D & Custom Parametric Handles', () => {
        test('cylinder exposes param-cap handle and vertical drag adjusts capRatio in [0.08, 0.48]', () => {
            const cyl = getShapePlugin('cylinder');
            const geom: ShapeRenderGeometry = { x0: 100, y0: 100, x1: 200, y1: 300 };
            const handles = cyl.getControlHandles(geom);
            const capHandle = handles.find(h => h.id === 'param-cap');
            assert.ok(capHandle !== undefined, 'Cylinder exposes param-cap handle');
            assert.equal(capHandle.kind, 'param');

            // Drag cap handle downwards to deepen top ellipse
            const updated = cyl.applyHandleDrag(geom, 'param-cap', { x: 150, y: 220 });
            assert.ok(updated.shapeParams?.capRatio !== undefined, 'shapeParams.capRatio is set');
            assert.ok(updated.shapeParams.capRatio >= 0.08 && updated.shapeParams.capRatio <= 0.48, 'capRatio clamped to valid range');

            // Drag beyond limits is clamped
            const clampedHigh = cyl.applyHandleDrag(geom, 'param-cap', { x: 150, y: 600 });
            assert.equal(clampedHigh.shapeParams?.capRatio, 0.48, 'Clamped to 0.48 upper bound');
            const clampedLow = cyl.applyHandleDrag(geom, 'param-cap', { x: 150, y: 100 });
            assert.equal(clampedLow.shapeParams?.capRatio, 0.08, 'Clamped to 0.08 lower bound');
        });

        test('hexagon exposes param-bevel handle and horizontal drag adjusts bevelRatio in [0.08, 0.50]', () => {
            const hex = getShapePlugin('hexagon');
            const geom: ShapeRenderGeometry = { x0: 0, y0: 0, x1: 200, y1: 100 };
            const handles = hex.getControlHandles(geom);
            const bevelHandle = handles.find(h => h.id === 'param-bevel');
            assert.ok(bevelHandle !== undefined, 'Hexagon exposes param-bevel handle');
            assert.equal(bevelHandle.kind, 'param');

            // Drag bevel handle to 35%
            const updated = hex.applyHandleDrag(geom, 'param-bevel', { x: 70, y: 0 });
            assert.equal(updated.shapeParams?.bevelRatio, 0.35, 'Sets bevelRatio to 0.35');

            // Drag beyond limits is clamped
            const clampedHigh = hex.applyHandleDrag(geom, 'param-bevel', { x: 180, y: 0 });
            assert.equal(clampedHigh.shapeParams?.bevelRatio, 0.50, 'Clamped to 0.50 upper bound');
            const clampedLow = hex.applyHandleDrag(geom, 'param-bevel', { x: 2, y: 0 });
            assert.equal(clampedLow.shapeParams?.bevelRatio, 0.08, 'Clamped to 0.08 lower bound');
        });
    });

    // =======================================================================
    // 4. Smart Alignment Snap Guides
    // =======================================================================
    describe('4. Smart Alignment Snap Guides', () => {
        test('computeSmartAlignmentGuides detects min, center, and max alignments on X and Y', () => {
            // Target shape at (200, 100) to (300, 200), center is (250, 150)
            const otherBounds = [
                { minX: 200, minY: 100, maxX: 300, maxY: 200 },
            ];

            // Dragging shape at (198, 300) to (298, 400): minX is within 2px of other minX (200)
            const activeBounds = { minX: 198, minY: 300, maxX: 298, maxY: 400 };
            const tolerance = 5;

            const res = computeSmartAlignmentGuides(activeBounds, otherBounds, tolerance);
            assert.equal(res.deltaX, 2, 'Snaps +2px on X axis to match left edge at 200');
            assert.equal(res.guides.length, 1, 'Emits 1 alignment guide');
            assert.equal(res.guides[0].axis, 'x');
            assert.equal(res.guides[0].position, 200);
        });

        test('smart guides ignore shapes beyond tolerance distance', () => {
            const otherBounds = [
                { minX: 200, minY: 100, maxX: 300, maxY: 200 },
            ];
            // Dragging shape at (130, 320) to (180, 380): min diff is 20px, tolerance is 5px
            const activeBounds = { minX: 130, minY: 320, maxX: 180, maxY: 380 };
            const res = computeSmartAlignmentGuides(activeBounds, otherBounds, 5);
            assert.equal(res.deltaX, 0, 'No snap offset');
            assert.equal(res.guides.length, 0, 'No guides emitted');
        });
    });
});
