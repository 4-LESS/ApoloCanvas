/**
 * src/engine/shapes/handles.ts
 *
 * Shared control-handle geometry for parametric shape editing:
 * bounding-box resize handles (corners + cardinal edges) and multi-segment
 * straight/curved Bezier (Affinity / Fusion 360 style) helpers for lines / arrows.
 */

import type { BoundingBox, ShapePathNode } from '../../core/types.ts';
import type { ShapeHandle, ShapePoint, ShapeRenderGeometry, ShapeSnapPort } from './types.ts';
import { distToSegmentSquared } from './common.ts';

export const BOX_CORNER_HANDLE_IDS = ['nw', 'ne', 'se', 'sw'] as const;
export const BOX_EDGE_HANDLE_IDS = ['n', 'e', 's', 'w'] as const;

/** Below this distance (geometry units) a dragged curve handle snaps the line back to straight. */
const STRAIGHTEN_SNAP_DISTANCE = 4;
const CURVE_SAMPLE_SEGMENTS = 24;

export function getGeometryBox(geom: ShapeRenderGeometry): BoundingBox {
    return {
        minX: Math.min(geom.x0, geom.x1),
        minY: Math.min(geom.y0, geom.y1),
        maxX: Math.max(geom.x0, geom.x1),
        maxY: Math.max(geom.y0, geom.y1),
    };
}

export function rotatePoint(x: number, y: number, cx: number, cy: number, angleRad: number): { x: number; y: number } {
    if (!angleRad) return { x, y };
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const dx = x - cx;
    const dy = y - cy;
    return {
        x: cx + dx * cos - dy * sin,
        y: cy + dx * sin + dy * cos,
    };
}

export function rotationHandle(geom: ShapeRenderGeometry, offset = 24): ShapeHandle {
    const { minX, minY, maxX } = getGeometryBox(geom);
    const midX = (minX + maxX) / 2;
    return {
        id: 'rotate',
        kind: 'rotate',
        x: midX,
        y: minY - offset,
    };
}

export function rotateHandles(handles: ShapeHandle[], cx: number, cy: number, angleRad: number): ShapeHandle[] {
    if (!angleRad) return handles;
    return handles.map(h => {
        const p = rotatePoint(h.x, h.y, cx, cy, angleRad);
        return { ...h, x: p.x, y: p.y };
    });
}

export function applyRotationDrag(
    geom: ShapeRenderGeometry,
    target: ShapePoint,
    regularize = false,
): ShapeRenderGeometry {
    const { minX, minY, maxX, maxY } = getGeometryBox(geom);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    let angle = Math.atan2(target.y - cy, target.x - cx) + Math.PI / 2;
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;

    // Cardinal magnetic snap: within +/- 3 deg (0.0523 rad)
    const cardinalSnap = 3 * (Math.PI / 180);
    const cardinals = [0, Math.PI / 2, Math.PI, -Math.PI / 2, -Math.PI];
    for (const card of cardinals) {
        if (Math.abs(angle - card) < cardinalSnap) {
            angle = card;
            break;
        }
    }

    // Regularize snaps to 15 deg (PI / 12)
    if (regularize) {
        const step = Math.PI / 12;
        angle = Math.round(angle / step) * step;
    }

    if (Math.abs(angle) < 0.0001) angle = 0;
    return { ...geom, rotation: angle };
}

export function rotatedBoxBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    rotation: number | undefined,
    halfWidth: number,
): BoundingBox {
    if (!rotation) {
        return {
            minX: minX - halfWidth,
            maxX: maxX + halfWidth,
            minY: minY - halfWidth,
            maxY: maxY + halfWidth,
        };
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const corners = [
        rotatePoint(minX, minY, cx, cy, rotation),
        rotatePoint(maxX, minY, cx, cy, rotation),
        rotatePoint(maxX, maxY, cx, cy, rotation),
        rotatePoint(minX, maxY, cx, cy, rotation),
    ];
    let rMinX = Infinity, rMaxX = -Infinity, rMinY = Infinity, rMaxY = -Infinity;
    for (const p of corners) {
        if (p.x < rMinX) rMinX = p.x;
        if (p.x > rMaxX) rMaxX = p.x;
        if (p.y < rMinY) rMinY = p.y;
        if (p.y > rMaxY) rMaxY = p.y;
    }
    return {
        minX: rMinX - halfWidth,
        maxX: rMaxX + halfWidth,
        minY: rMinY - halfWidth,
        maxY: rMaxY + halfWidth,
    };
}
export function boxControlHandles(geom: ShapeRenderGeometry): ShapeHandle[] {
    const handles: ShapeHandle[] = [
        ...boxCornerHandles(geom),
        ...boxEdgeHandles(geom),
        rotationHandle(geom),
    ];
    if (geom.rotation) {
        const { minX, minY, maxX, maxY } = getGeometryBox(geom);
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        return rotateHandles(handles, midX, midY, geom.rotation);
    }
    return handles;
}

export function boxCornerHandles(geom: ShapeRenderGeometry): ShapeHandle[] {
    const { minX, minY, maxX, maxY } = getGeometryBox(geom);
    return [
        { id: 'nw', kind: 'corner', x: minX, y: minY },
        { id: 'ne', kind: 'corner', x: maxX, y: minY },
        { id: 'se', kind: 'corner', x: maxX, y: maxY },
        { id: 'sw', kind: 'corner', x: minX, y: maxY },
    ];
}

export function boxEdgeHandles(geom: ShapeRenderGeometry): ShapeHandle[] {
    const { minX, minY, maxX, maxY } = getGeometryBox(geom);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    return [
        { id: 'n', kind: 'corner', x: midX, y: minY },
        { id: 'e', kind: 'corner', x: maxX, y: midY },
        { id: 's', kind: 'corner', x: midX, y: maxY },
        { id: 'w', kind: 'corner', x: minX, y: midY },
    ];
}

export function isBoxHandleId(handleId: string): boolean {
    return (BOX_CORNER_HANDLE_IDS as readonly string[]).includes(handleId) ||
        (BOX_EDGE_HANDLE_IDS as readonly string[]).includes(handleId);
}

/**
 * Resizes the bounding box of `geom` by dragging one of its corner / edge handles.
 * The opposite corner (or edge) stays anchored. With `regularize`, the result keeps
 * `height = width * aspect` (1 for squares / circles, sqrt(3)/2 for equilateral triangles),
 * anchored at x0/y0 so that normalizeGeometry() leaves it untouched.
 */
export function resizeBoxByHandle(
    geom: ShapeRenderGeometry,
    handleId: string,
    point: ShapePoint,
    regularize = false,
    aspect = 1,
): ShapeRenderGeometry {
    const minX = Math.min(geom.x0, geom.x1);
    const maxX = Math.max(geom.x0, geom.x1);
    const minY = Math.min(geom.y0, geom.y1);
    const maxY = Math.max(geom.y0, geom.y1);
    const rot = geom.rotation || 0;

    // Rotated box resize: keeps the opposite anchor corner/edge 100% invariant in world coordinates
    if (Math.abs(rot) > 1e-4) {
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        let unrotAnchorX = cx;
        let unrotAnchorY = cy;
        let signX = 1;
        let signY = 1;

        if (handleId === 'se') { unrotAnchorX = minX; unrotAnchorY = minY; signX = 1; signY = 1; }
        else if (handleId === 'nw') { unrotAnchorX = maxX; unrotAnchorY = maxY; signX = -1; signY = -1; }
        else if (handleId === 'ne') { unrotAnchorX = minX; unrotAnchorY = maxY; signX = 1; signY = -1; }
        else if (handleId === 'sw') { unrotAnchorX = maxX; unrotAnchorY = minY; signX = -1; signY = 1; }
        else if (handleId === 'e') { unrotAnchorX = minX; unrotAnchorY = cy; signX = 1; signY = 0; }
        else if (handleId === 'w') { unrotAnchorX = maxX; unrotAnchorY = cy; signX = -1; signY = 0; }
        else if (handleId === 's') { unrotAnchorX = cx; unrotAnchorY = minY; signX = 0; signY = 1; }
        else if (handleId === 'n') { unrotAnchorX = cx; unrotAnchorY = maxY; signX = 0; signY = -1; }
        else return { ...geom };

        const worldAnchor = rotatePoint(unrotAnchorX, unrotAnchorY, cx, cy, rot);
        const dWorldX = point.x - worldAnchor.x;
        const dWorldY = point.y - worldAnchor.y;
        const dLocal = rotatePoint(dWorldX, dWorldY, 0, 0, -rot);

        let w = maxX - minX;
        let h = maxY - minY;

        if (signX !== 0) w = Math.max(8, dLocal.x * signX);
        if (signY !== 0) h = Math.max(8, dLocal.y * signY);

        if (regularize) {
            if (signX !== 0 && signY !== 0) {
                const size = Math.max(w, h / aspect);
                w = size;
                h = size * aspect;
            } else if (signX !== 0) {
                h = w * aspect;
            } else if (signY !== 0) {
                w = h / aspect;
            }
        }

        const localCenterOffsetX = signX !== 0 ? (w / 2) * signX : 0;
        const localCenterOffsetY = signY !== 0 ? (h / 2) * signY : 0;

        const newWorldCenter = rotatePoint(
            worldAnchor.x + localCenterOffsetX,
            worldAnchor.y + localCenterOffsetY,
            worldAnchor.x,
            worldAnchor.y,
            rot
        );

        const x0 = newWorldCenter.x - w / 2;
        const x1 = newWorldCenter.x + w / 2;
        const y0 = newWorldCenter.y - h / 2;
        const y1 = newWorldCenter.y + h / 2;

        return { ...geom, x0, y0, x1, y1, regularize };
    }

    if ((BOX_CORNER_HANDLE_IDS as readonly string[]).includes(handleId)) {
        const anchorX = handleId === 'nw' || handleId === 'sw' ? maxX : minX;
        const anchorY = handleId === 'nw' || handleId === 'ne' ? maxY : minY;
        let dx = point.x - anchorX;
        let dy = point.y - anchorY;
        if (regularize) {
            const w = Math.max(Math.abs(dx), Math.abs(dy) / aspect);
            dx = (dx < 0 ? -1 : 1) * w;
            dy = (dy < 0 ? -1 : 1) * w * aspect;
        }
        return { ...geom, x0: anchorX, y0: anchorY, x1: anchorX + dx, y1: anchorY + dy, regularize };
    }

    let nextMinX = minX;
    let nextMaxX = maxX;
    let nextMinY = minY;
    let nextMaxY = maxY;

    if (handleId === 'n') nextMinY = point.y;
    else if (handleId === 's') nextMaxY = point.y;
    else if (handleId === 'e') nextMaxX = point.x;
    else if (handleId === 'w') nextMinX = point.x;
    else return { ...geom };

    if (regularize) {
        if (handleId === 'n' || handleId === 's') {
            const h = Math.abs(nextMaxY - nextMinY);
            const w = h / aspect;
            const cx = (nextMinX + nextMaxX) / 2;
            nextMinX = cx - w / 2;
            nextMaxX = cx + w / 2;
        } else {
            const w = Math.abs(nextMaxX - nextMinX);
            const h = w * aspect;
            const cy = (nextMinY + nextMaxY) / 2;
            nextMinY = cy - h / 2;
            nextMaxY = cy + h / 2;
        }
    }

    const x0 = handleId === 'w' ? nextMaxX : nextMinX;
    const x1 = handleId === 'w' ? nextMinX : nextMaxX;
    const y0 = handleId === 'n' ? nextMaxY : nextMinY;
    const y1 = handleId === 'n' ? nextMinY : nextMaxY;
    return { ...geom, x0, y0, x1, y1, regularize };
}

/**
 * Cardinal perimeter midpoints ('n', 'e', 's', 'w') plus 'center'. The bounding-box midpoints
 * lie on the outline of every built-in closed shape (rectangle, ellipse, diamond, hexagon, cylinder).
 */
export function boxSnapPorts(geom: ShapeRenderGeometry): ShapeSnapPort[] {
    const { minX, minY, maxX, maxY } = getGeometryBox(geom);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const ports: ShapeSnapPort[] = [
        { id: 'n', x: midX, y: minY },
        { id: 'e', x: maxX, y: midY },
        { id: 's', x: midX, y: maxY },
        { id: 'w', x: minX, y: midY },
        { id: 'center', x: midX, y: midY },
    ];
    if (geom.rotation) {
        return ports.map(p => {
            const rot = rotatePoint(p.x, p.y, midX, midY, geom.rotation!);
            return { id: p.id, x: rot.x, y: rot.y };
        });
    }
    return ports;
}

export function linearSnapPorts(geom: ShapeRenderGeometry): ShapeSnapPort[] {
    if (geom.pathNodes && geom.pathNodes.length >= 2) {
        const first = geom.pathNodes[0];
        const last = geom.pathNodes[geom.pathNodes.length - 1];
        return [
            { id: 'start', x: first.x, y: first.y },
            { id: 'end', x: last.x, y: last.y },
        ];
    }
    return [
        { id: 'start', x: geom.x0, y: geom.y0 },
        { id: 'end', x: geom.x1, y: geom.y1 },
    ];
}

// ---------------------------------------------------------------------------
// Multi-Segment Bezier & Quadratic Path Helpers (lines & arrows)
// ---------------------------------------------------------------------------

export function quadraticPoint(p0: ShapePoint, c: ShapePoint, p1: ShapePoint, t: number): ShapePoint {
    const mt = 1 - t;
    return {
        x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
        y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
    };
}

export function cubicPoint(p0: ShapePoint, cp1: ShapePoint, cp2: ShapePoint, p1: ShapePoint, t: number): ShapePoint {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return {
        x: mt2 * mt * p0.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t2 * t * p1.x,
        y: mt2 * mt * p0.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t2 * t * p1.y,
    };
}

/** Extracts normalized multi-segment path nodes from `geom`, synthesizing from legacy (x0..x1, controlPoint) if missing. */
export function getLinearPathNodes(geom: ShapeRenderGeometry): ShapePathNode[] {
    if (geom.pathNodes && geom.pathNodes.length >= 2) {
        return geom.pathNodes.map(n => ({
            x: n.x,
            y: n.y,
            handleIn: n.handleIn ? { x: n.handleIn.x, y: n.handleIn.y } : undefined,
            handleOut: n.handleOut ? { x: n.handleOut.x, y: n.handleOut.y } : undefined,
            nodeKind: n.nodeKind || (n.handleIn || n.handleOut ? 'smooth' : 'sharp'),
        }));
    }
    const p0: ShapePathNode = { x: geom.x0, y: geom.y0, nodeKind: 'sharp' };
    const p1: ShapePathNode = { x: geom.x1, y: geom.y1, nodeKind: 'sharp' };
    if (geom.controlPoint) {
        const Q = geom.controlPoint;
        p0.handleOut = { x: p0.x + (2 / 3) * (Q.x - p0.x), y: p0.y + (2 / 3) * (Q.y - p0.y) };
        p1.handleIn = { x: p1.x + (2 / 3) * (Q.x - p1.x), y: p1.y + (2 / 3) * (Q.y - p1.y) };
        p0.nodeKind = 'smooth';
        p1.nodeKind = 'smooth';
    }
    return [p0, p1];
}

/** Evaluates the midpoint of a single segment between node A and node B. */
export function getSegmentMidpoint(p0: ShapePathNode, p1: ShapePathNode): ShapePoint {
    if (!p0.handleOut && !p1.handleIn) {
        return { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    }
    const cp1 = p0.handleOut ?? { x: p0.x, y: p0.y };
    const cp2 = p1.handleIn ?? { x: p1.x, y: p1.y };
    return cubicPoint(p0, cp1, cp2, p1, 0.5);
}

/** Legacy curve handle point: B(0.5) of segment 0. */
export function getCurveHandlePoint(geom: ShapeRenderGeometry): ShapePoint {
    const nodes = getLinearPathNodes(geom);
    return getSegmentMidpoint(nodes[0], nodes[1]);
}

/** Polyline approximation of the linear shape (supporting straight, quadratic, and cubic segments). */
export function sampleLinearPath(geom: ShapeRenderGeometry, segmentsPerCurve = CURVE_SAMPLE_SEGMENTS): ShapePoint[] {
    const nodes = getLinearPathNodes(geom);
    if (nodes.length < 2) {
        return [{ x: geom.x0, y: geom.y0 }, { x: geom.x1, y: geom.y1 }];
    }

    const pts: ShapePoint[] = [{ x: nodes[0].x, y: nodes[0].y }];
    for (let i = 0; i < nodes.length - 1; i++) {
        const p0 = nodes[i];
        const p1 = nodes[i + 1];
        if (!p0.handleOut && !p1.handleIn) {
            pts.push({ x: p1.x, y: p1.y });
        } else {
            const cp1 = p0.handleOut ?? { x: p0.x, y: p0.y };
            const cp2 = p1.handleIn ?? { x: p1.x, y: p1.y };
            for (let j = 1; j <= segmentsPerCurve; j++) {
                pts.push(cubicPoint(p0, cp1, cp2, p1, j / segmentsPerCurve));
            }
        }
    }
    return pts;
}

/** Unit-free tangent direction at the end of the path (used to align arrowheads). */
export function getEndTangentAngle(geom: ShapeRenderGeometry): number {
    const nodes = getLinearPathNodes(geom);
    if (nodes.length < 2) {
        return Math.atan2(geom.y1 - geom.y0, geom.x1 - geom.x0);
    }
    const last = nodes[nodes.length - 1];
    const prev = nodes[nodes.length - 2];

    if (last.handleIn && Math.hypot(last.x - last.handleIn.x, last.y - last.handleIn.y) > 1e-4) {
        return Math.atan2(last.y - last.handleIn.y, last.x - last.handleIn.x);
    }
    if (prev.handleOut && Math.hypot(last.x - prev.handleOut.x, last.y - prev.handleOut.y) > 1e-4) {
        return Math.atan2(last.y - prev.handleOut.y, last.x - prev.handleOut.x);
    }
    return Math.atan2(last.y - prev.y, last.x - prev.x);
}

export function linearPathHit(geom: ShapeRenderGeometry, point: ShapePoint, tolerance: number): boolean {
    const pts = sampleLinearPath(geom);
    const tol2 = tolerance * tolerance;
    for (let i = 1; i < pts.length; i++) {
        if (distToSegmentSquared(point.x, point.y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= tol2) {
            return true;
        }
    }
    return false;
}

/** Emits anchor nodes, segment midpoint curve handles, and cubic tangent handles. */
export function linearControlHandles(geom: ShapeRenderGeometry): ShapeHandle[] {
    const nodes = getLinearPathNodes(geom);
    const handles: ShapeHandle[] = [];

    // 1. Anchor nodes
    for (let i = 0; i < nodes.length; i++) {
        const isEnd = i === 0 || i === nodes.length - 1;
        const id = i === 0 ? 'start' : i === nodes.length - 1 ? 'end' : `node-${i}`;
        handles.push({
            id,
            kind: isEnd ? 'endpoint' : 'vertex',
            x: nodes[i].x,
            y: nodes[i].y,
        });
    }

    // 2. Segment midpoint handles (suggestion at center)
    for (let i = 0; i < nodes.length - 1; i++) {
        const mid = getSegmentMidpoint(nodes[i], nodes[i + 1]);
        handles.push({
            id: `seg-mid-${i}`,
            kind: 'segment-mid',
            x: mid.x,
            y: mid.y,
        });
    }

    // Legacy 'curve' handle for 2-node shapes for backward compatibility
    if (!geom.pathNodes) {
        const mid = geom.controlPoint
            ? { x: (geom.x0 + 2 * geom.controlPoint.x + geom.x1) / 4, y: (geom.y0 + 2 * geom.controlPoint.y + geom.y1) / 4 }
            : { x: (geom.x0 + geom.x1) / 2, y: (geom.y0 + geom.y1) / 2 };
        handles.push({ id: 'curve', kind: 'curve', x: mid.x, y: mid.y });
    }

    // 3. Tangent control handles for each segment (start, end, and intermediate)
    // The start and end points must also be control handles (tangents appear to modify)
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (i > 0) {
            // Incoming control handle (into node i from segment i-1)
            const prev = nodes[i - 1];
            const inPt = n.handleIn ?? {
                x: prev.x + (2 * (n.x - prev.x)) / 3,
                y: prev.y + (2 * (n.y - prev.y)) / 3,
            };
            handles.push({
                id: `bezier-in-${i}`,
                kind: 'bezier-in',
                x: inPt.x,
                y: inPt.y,
            });
        }
        if (i < nodes.length - 1) {
            // Outgoing control handle (out from node i into segment i)
            const next = nodes[i + 1];
            const outPt = n.handleOut ?? {
                x: n.x + (next.x - n.x) / 3,
                y: n.y + (next.y - n.y) / 3,
            };
            handles.push({
                id: `bezier-out-${i}`,
                kind: 'bezier-out',
                x: outPt.x,
                y: outPt.y,
            });
        }
    }

    return handles;
}

/**
 * Snaps point around origin to 15-degree increments with cardinal/diagonal magnetic locking
 * and orthogonal (dx = 0 or dy = 0) precision alignment.
 */
export function snapAngleOrOrthogonal(
    origin: ShapePoint,
    point: ShapePoint,
    stepAngle = Math.PI / 12,
    orthoThreshold = 8
): ShapePoint {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const r = Math.hypot(dx, dy);
    if (r < 1e-6) return { ...point };

    // 1. Magnetic orthogonal lock: exact horizontal (dy = 0) and vertical (dx = 0)
    if (Math.abs(dy) <= orthoThreshold) {
        return { x: point.x, y: origin.y };
    }
    if (Math.abs(dx) <= orthoThreshold) {
        return { x: origin.x, y: point.y };
    }

    // 2. Cardinal / diagonal lock (0, 45, 90, 135, 180...)
    const angle = Math.atan2(dy, dx);
    const cardinals = [
        0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI,
        -Math.PI, -(3 * Math.PI) / 4, -Math.PI / 2, -Math.PI / 4,
    ];
    for (const ca of cardinals) {
        if (Math.abs(angle - ca) <= (5 * Math.PI) / 180) {
            return { x: origin.x + r * Math.cos(ca), y: origin.y + r * Math.sin(ca) };
        }
    }

    // 3. Step snapping (15 degrees)
    const theta = Math.round(angle / stepAngle) * stepAngle;
    return { x: origin.x + r * Math.cos(theta), y: origin.y + r * Math.sin(theta) };
}

function snapAround(origin: ShapePoint, point: ShapePoint): ShapePoint {
    return snapAngleOrOrthogonal(origin, point, Math.PI / 12, 8);
}

/**
 * Drags a linear-shape handle:
 * - 'curve' / 'seg-mid-i': bends segment i into a cubic Bezier passing through `point`,
 *   or snaps to straight if within 4px of the straight chord.
 * - 'bezier-in-i' / 'bezier-out-i': adjusts tangent control points with smooth/symmetric mirroring.
 * - 'start' / 'end' / 'node-i': moves anchor node along with its tangent handles.
 */
export function applyLinearHandleDrag(
    geom: ShapeRenderGeometry,
    handleId: string,
    point: ShapePoint,
    regularize = false,
): ShapeRenderGeometry {
    // Segment sliding (Tinkercad / Lucidchart style)
    if (handleId.startsWith('seg-slide-')) {
        const segIdx = parseInt(handleId.slice('seg-slide-'.length), 10);
        return slideLinearSegment(geom, isNaN(segIdx) ? 0 : segIdx, point);
    }

    // Legacy 2-node line / arrow support (single quadratic controlPoint)
    if (!geom.pathNodes && !handleId.startsWith('bezier-in-') && !handleId.startsWith('bezier-out-')) {
        if (handleId === 'curve') {
            const mid = { x: (geom.x0 + geom.x1) / 2, y: (geom.y0 + geom.y1) / 2 };
            const dist = Math.hypot(point.x - mid.x, point.y - mid.y);
            const next: ShapeRenderGeometry = { ...geom, regularize };
            if (dist <= STRAIGHTEN_SNAP_DISTANCE) {
                delete next.controlPoint;
            } else {
                next.controlPoint = {
                    x: 2 * point.x - mid.x,
                    y: 2 * point.y - mid.y,
                };
            }
            return next;
        }
        if (handleId === 'start' || handleId === 'end') {
            let target = { x: point.x, y: point.y };
            if (regularize) {
                const anchor = handleId === 'start' ? { x: geom.x1, y: geom.y1 } : { x: geom.x0, y: geom.y0 };
                target = snapAround(anchor, point);
            }
            return {
                ...geom,
                x0: handleId === 'start' ? target.x : geom.x0,
                y0: handleId === 'start' ? target.y : geom.y0,
                x1: handleId === 'end' ? target.x : geom.x1,
                y1: handleId === 'end' ? target.y : geom.y1,
                regularize,
            };
        }
    }

    const nodes = getLinearPathNodes(geom);

    // Midpoint bend handle ('curve' or 'seg-mid-i')
    if (handleId === 'curve' || handleId.startsWith('seg-mid-')) {
        const segIdx = handleId === 'curve' ? 0 : parseInt(handleId.replace('seg-mid-', ''), 10);
        if (segIdx < 0 || segIdx >= nodes.length - 1) return { ...geom };

        const p0 = nodes[segIdx];
        const p1 = nodes[segIdx + 1];
        const midChord = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        const distToChord = Math.sqrt(distToSegmentSquared(point.x, point.y, p0.x, p0.y, p1.x, p1.y));

        if (distToChord <= STRAIGHTEN_SNAP_DISTANCE) {
            delete p0.handleOut;
            delete p1.handleIn;
        } else {
            const dx = point.x - midChord.x;
            const dy = point.y - midChord.y;
            p0.handleOut = {
                x: p0.x + (p1.x - p0.x) / 3 + (4 / 3) * dx,
                y: p0.y + (p1.y - p0.y) / 3 + (4 / 3) * dy,
            };
            p1.handleIn = {
                x: p1.x - (p1.x - p0.x) / 3 + (4 / 3) * dx,
                y: p1.y - (p1.y - p0.y) / 3 + (4 / 3) * dy,
            };
        }

        const next: ShapeRenderGeometry = {
            ...geom,
            pathNodes: nodes,
            x0: nodes[0].x,
            y0: nodes[0].y,
            x1: nodes[nodes.length - 1].x,
            y1: nodes[nodes.length - 1].y,
            regularize,
        };
        delete next.controlPoint;
        return next;
    }

    // Cubic incoming tangent handle
    if (handleId.startsWith('bezier-in-')) {
        const idx = parseInt(handleId.replace('bezier-in-', ''), 10);
        if (idx < 0 || idx >= nodes.length) return { ...geom };
        const node = nodes[idx];
        let p = { ...point };
        if (regularize) {
            p = snapAngleOrOrthogonal(node, point);
        }
        node.handleIn = { x: p.x, y: p.y };
        const vx = p.x - node.x;
        const vy = p.y - node.y;

        if (node.nodeKind === 'symmetric') {
            node.handleOut = { x: node.x - vx, y: node.y - vy };
        } else if (node.nodeKind === 'smooth' && node.handleOut) {
            const outLen = Math.hypot(node.handleOut.x - node.x, node.handleOut.y - node.y);
            const inLen = Math.hypot(vx, vy);
            if (inLen > 1e-6 && outLen > 1e-6) {
                node.handleOut = {
                    x: node.x - (vx / inLen) * outLen,
                    y: node.y - (vy / inLen) * outLen,
                };
            }
        }

        const next: ShapeRenderGeometry = { ...geom, pathNodes: nodes, regularize };
        delete next.controlPoint;
        return next;
    }

    // Cubic outgoing tangent handle
    if (handleId.startsWith('bezier-out-')) {
        const idx = parseInt(handleId.replace('bezier-out-', ''), 10);
        if (idx < 0 || idx >= nodes.length) return { ...geom };
        const node = nodes[idx];
        let p = { ...point };
        if (regularize) {
            p = snapAngleOrOrthogonal(node, point);
        }
        node.handleOut = { x: p.x, y: p.y };
        const vx = p.x - node.x;
        const vy = p.y - node.y;

        if (node.nodeKind === 'symmetric') {
            node.handleIn = { x: node.x - vx, y: node.y - vy };
        } else if (node.nodeKind === 'smooth' && node.handleIn) {
            const inLen = Math.hypot(node.handleIn.x - node.x, node.handleIn.y - node.y);
            const outLen = Math.hypot(vx, vy);
            if (outLen > 1e-6 && inLen > 1e-6) {
                node.handleIn = {
                    x: node.x - (vx / outLen) * inLen,
                    y: node.y - (vy / outLen) * inLen,
                };
            }
        }

        const next: ShapeRenderGeometry = { ...geom, pathNodes: nodes, regularize };
        delete next.controlPoint;
        return next;
    }

    // Anchor node movement ('start', 'end', or 'node-i')
    const nodeIdx = handleId === 'start' ? 0 : handleId === 'end' ? nodes.length - 1 : parseInt(handleId.replace('node-', ''), 10);
    if (isNaN(nodeIdx) || nodeIdx < 0 || nodeIdx >= nodes.length) {
        return { ...geom };
    }

    const cur = nodes[nodeIdx];
    let target = { x: point.x, y: point.y };
    if (regularize) {
        const ref = nodeIdx > 0 ? nodes[nodeIdx - 1] : nodes[1] ?? cur;
        target = snapAngleOrOrthogonal(ref, point);
        if (nodeIdx < nodes.length - 1 && nodeIdx > 0) {
            const nextNode = nodes[nodeIdx + 1];
            if (Math.abs(target.x - nextNode.x) <= 8) target.x = nextNode.x;
            if (Math.abs(target.y - nextNode.y) <= 8) target.y = nextNode.y;
        }
    }

    const dx = target.x - cur.x;
    const dy = target.y - cur.y;
    cur.x = target.x;
    cur.y = target.y;

    if (cur.handleIn) {
        cur.handleIn.x += dx;
        cur.handleIn.y += dy;
    }
    if (cur.handleOut) {
        cur.handleOut.x += dx;
        cur.handleOut.y += dy;
    }

    const next: ShapeRenderGeometry = {
        ...geom,
        pathNodes: nodes,
        x0: nodes[0].x,
        y0: nodes[0].y,
        x1: nodes[nodes.length - 1].x,
        y1: nodes[nodes.length - 1].y,
        regularize,
    };
    delete next.controlPoint;
    return next;
}

/**
 * Toggles an anchor node or segment between 90-degree orthogonal/sharp and curved.
 * Single click/tap on a node toggles it between sharp (orthogonal 90 deg corner) and smooth Bezier.
 */
export function toggleNodeOrSegmentOrthogonal(
    geom: ShapeRenderGeometry,
    handleId: string
): ShapeRenderGeometry {
    const nodes = getLinearPathNodes(geom);
    const nodeIdx = handleId === 'start' ? 0 : handleId === 'end' ? nodes.length - 1 : parseInt(handleId.replace('node-', ''), 10);

    if (!isNaN(nodeIdx) && nodeIdx >= 0 && nodeIdx < nodes.length) {
        const cur = nodes[nodeIdx];
        const isCurved = cur.nodeKind === 'smooth' || Boolean(cur.handleIn || cur.handleOut);

        if (isCurved) {
            // Switch to 90 degrees / sharp
            cur.nodeKind = 'sharp';
            delete cur.handleIn;
            delete cur.handleOut;

            // If it's an intermediate node, align to orthogonal 90-degree corner relative to adjacent nodes
            if (nodeIdx > 0 && nodeIdx < nodes.length - 1) {
                const prev = nodes[nodeIdx - 1];
                const next = nodes[nodeIdx + 1];
                delete prev.handleOut;
                delete next.handleIn;

                // Two orthogonal corner configurations:
                const opt1 = { x: prev.x, y: next.y };
                const opt2 = { x: next.x, y: prev.y };
                const d1 = Math.hypot(cur.x - opt1.x, cur.y - opt1.y);
                const d2 = Math.hypot(cur.x - opt2.x, cur.y - opt2.y);
                const best = d1 <= d2 ? opt1 : opt2;
                cur.x = best.x;
                cur.y = best.y;
            }
        } else {
            // Switch to curved (smooth Bezier)
            cur.nodeKind = 'smooth';
            if (nodeIdx > 0 && nodeIdx < nodes.length - 1) {
                const prev = nodes[nodeIdx - 1];
                const next = nodes[nodeIdx + 1];
                const vx = next.x - prev.x;
                const vy = next.y - prev.y;
                const len = Math.hypot(vx, vy);
                if (len > 1e-4) {
                    const dIn = Math.hypot(cur.x - prev.x, cur.y - prev.y) / 3;
                    const dOut = Math.hypot(next.x - cur.x, next.y - cur.y) / 3;
                    cur.handleIn = { x: cur.x - (vx / len) * dIn, y: cur.y - (vy / len) * dIn };
                    cur.handleOut = { x: cur.x + (vx / len) * dOut, y: cur.y + (vy / len) * dOut };
                }
            } else if (nodeIdx === 0 && nodes.length > 1) {
                const next = nodes[1];
                const vx = next.x - cur.x;
                const vy = next.y - cur.y;
                const len = Math.hypot(vx, vy);
                if (len > 1e-4) {
                    cur.handleOut = { x: cur.x + vx / 3, y: cur.y + vy / 3 };
                }
            } else if (nodeIdx === nodes.length - 1 && nodes.length > 1) {
                const prev = nodes[nodes.length - 2];
                const vx = cur.x - prev.x;
                const vy = cur.y - prev.y;
                const len = Math.hypot(vx, vy);
                if (len > 1e-4) {
                    cur.handleIn = { x: cur.x - vx / 3, y: cur.y - vy / 3 };
                }
            }
        }

        const res: ShapeRenderGeometry = {
            ...geom,
            pathNodes: nodes,
            x0: nodes[0].x,
            y0: nodes[0].y,
            x1: nodes[nodes.length - 1].x,
            y1: nodes[nodes.length - 1].y,
        };
        delete res.controlPoint;
        return res;
    }

    if (handleId === 'curve' || handleId.startsWith('seg-mid-')) {
        const segIdx = handleId === 'curve' ? 0 : parseInt(handleId.replace('seg-mid-', ''), 10);
        if (segIdx >= 0 && segIdx < nodes.length - 1) {
            const p0 = nodes[segIdx];
            const p1 = nodes[segIdx + 1];
            const isCurved = Boolean(p0.handleOut || p1.handleIn);
            if (isCurved) {
                return straightenLinearSegment(geom, segIdx);
            } else {
                const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
                const dx = p1.x - p0.x;
                const dy = p1.y - p0.y;
                const len = Math.hypot(dx, dy);
                const perpX = len > 1e-4 ? (-dy / len) * (len * 0.25) : 0;
                const perpY = len > 1e-4 ? (dx / len) * (len * 0.25) : 0;
                return applyLinearHandleDrag(geom, `seg-mid-${segIdx}`, { x: mid.x + perpX, y: mid.y + perpY });
            }
        }
    }

    return { ...geom };
}

/**
 * Inserts a new anchor node at the closest position along the linear path to `point`.
 * Allows generating points anywhere along the line or curve, not just at the center suggestion.
 */
export function insertLinearNodeAtPoint(
    geom: ShapeRenderGeometry,
    point: ShapePoint
): { geom: ShapeRenderGeometry; handleId: string } | null {
    const nodes = getLinearPathNodes(geom);
    if (nodes.length < 2) return null;

    let bestDistSq = Infinity;
    let bestSeg = -1;
    let bestT = 0.5;

    const SAMPLES = 24;
    for (let i = 0; i < nodes.length - 1; i++) {
        const p0 = nodes[i];
        const p1 = nodes[i + 1];
        const cp1 = p0.handleOut;
        const cp2 = p1.handleIn;

        for (let s = 1; s < SAMPLES; s++) {
            const t = s / SAMPLES;
            const pt = (!cp1 && !cp2)
                ? { x: p0.x + t * (p1.x - p0.x), y: p0.y + t * (p1.y - p0.y) }
                : cubicPoint(p0, cp1 ?? p0, cp2 ?? p1, p1, t);
            const d2 = (pt.x - point.x) ** 2 + (pt.y - point.y) ** 2;
            if (d2 < bestDistSq) {
                bestDistSq = d2;
                bestSeg = i;
                bestT = t;
            }
        }
    }

    if (bestSeg === -1) return null;

    const p0 = nodes[bestSeg];
    const p1 = nodes[bestSeg + 1];
    const cp1 = p0.handleOut;
    const cp2 = p1.handleIn;
    let t = bestT;
    for (let iter = 0; iter < 5; iter++) {
        const dt = 0.01;
        const tMinus = Math.max(0.01, t - dt);
        const tPlus = Math.min(0.99, t + dt);
        const ptMinus = (!cp1 && !cp2) ? { x: p0.x + tMinus * (p1.x - p0.x), y: p0.y + tMinus * (p1.y - p0.y) } : cubicPoint(p0, cp1 ?? p0, cp2 ?? p1, p1, tMinus);
        const ptPlus = (!cp1 && !cp2) ? { x: p0.x + tPlus * (p1.x - p0.x), y: p0.y + tPlus * (p1.y - p0.y) } : cubicPoint(p0, cp1 ?? p0, cp2 ?? p1, p1, tPlus);
        const dMinus = (ptMinus.x - point.x) ** 2 + (ptMinus.y - point.y) ** 2;
        const dPlus = (ptPlus.x - point.x) ** 2 + (ptPlus.y - point.y) ** 2;
        if (dMinus < bestDistSq) { bestDistSq = dMinus; t = tMinus; }
        else if (dPlus < bestDistSq) { bestDistSq = dPlus; t = tPlus; }
    }

    if (!p0.handleOut && !p1.handleIn) {
        const splitPt = { x: p0.x + t * (p1.x - p0.x), y: p0.y + t * (p1.y - p0.y) };
        const newNode: ShapePathNode = {
            x: splitPt.x,
            y: splitPt.y,
            nodeKind: 'sharp',
        };
        nodes.splice(bestSeg + 1, 0, newNode);
    } else {
        const c1 = p0.handleOut ?? { x: p0.x, y: p0.y };
        const c2 = p1.handleIn ?? { x: p1.x, y: p1.y };

        const q0 = { x: (1 - t) * p0.x + t * c1.x, y: (1 - t) * p0.y + t * c1.y };
        const q1 = { x: (1 - t) * c1.x + t * c2.x, y: (1 - t) * c1.y + t * c2.y };
        const q2 = { x: (1 - t) * c2.x + t * p1.x, y: (1 - t) * c2.y + t * p1.y };

        const r0 = { x: (1 - t) * q0.x + t * q1.x, y: (1 - t) * q0.y + t * q1.y };
        const r1 = { x: (1 - t) * q1.x + t * q2.x, y: (1 - t) * q1.y + t * q2.y };

        const midPoint = { x: (1 - t) * r0.x + t * r1.x, y: (1 - t) * r0.y + t * r1.y };

        p0.handleOut = q0;
        p1.handleIn = q2;

        const newNode: ShapePathNode = {
            x: midPoint.x,
            y: midPoint.y,
            handleIn: r0,
            handleOut: r1,
            nodeKind: 'smooth',
        };
        nodes.splice(bestSeg + 1, 0, newNode);
    }

    const nextGeom: ShapeRenderGeometry = {
        ...geom,
        pathNodes: nodes,
        x0: nodes[0].x,
        y0: nodes[0].y,
        x1: nodes[nodes.length - 1].x,
        y1: nodes[nodes.length - 1].y,
    };
    delete nextGeom.controlPoint;
    const handleId = `node-${bestSeg + 1}`;
    return { geom: nextGeom, handleId };
}
export function splitLinearSegment(geom: ShapeRenderGeometry, segmentIndex: number): ShapeRenderGeometry {
    const nodes = getLinearPathNodes(geom);
    if (segmentIndex < 0 || segmentIndex >= nodes.length - 1) return { ...geom };

    const p0 = nodes[segmentIndex];
    const p1 = nodes[segmentIndex + 1];

    if (!p0.handleOut && !p1.handleIn) {
        // Straight line split
        const mid: ShapePathNode = {
            x: (p0.x + p1.x) / 2,
            y: (p0.y + p1.y) / 2,
            nodeKind: 'smooth',
        };
        nodes.splice(segmentIndex + 1, 0, mid);
    } else {
        // de Casteljau split at t = 0.5
        const cp1 = p0.handleOut ?? { x: p0.x, y: p0.y };
        const cp2 = p1.handleIn ?? { x: p1.x, y: p1.y };

        const q0 = { x: (p0.x + cp1.x) / 2, y: (p0.y + cp1.y) / 2 };
        const q1 = { x: (cp1.x + cp2.x) / 2, y: (cp1.y + cp2.y) / 2 };
        const q2 = { x: (cp2.x + p1.x) / 2, y: (cp2.y + p1.y) / 2 };

        const r0 = { x: (q0.x + q1.x) / 2, y: (q0.y + q1.y) / 2 };
        const r1 = { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 };

        const midPoint = { x: (r0.x + r1.x) / 2, y: (r0.y + r1.y) / 2 };

        p0.handleOut = q0;
        p1.handleIn = q2;

        const midNode: ShapePathNode = {
            x: midPoint.x,
            y: midPoint.y,
            handleIn: r0,
            handleOut: r1,
            nodeKind: 'smooth',
        };
        nodes.splice(segmentIndex + 1, 0, midNode);
    }

    const next: ShapeRenderGeometry = {
        ...geom,
        pathNodes: nodes,
        x0: nodes[0].x,
        y0: nodes[0].y,
        x1: nodes[nodes.length - 1].x,
        y1: nodes[nodes.length - 1].y,
    };
    delete next.controlPoint;
    return next;
}

/** Resets a segment to a 100% straight line by dropping tangent control handles on both sides. */
export function straightenLinearSegment(geom: ShapeRenderGeometry, segmentIndex: number): ShapeRenderGeometry {
    const nodes = getLinearPathNodes(geom);
    if (segmentIndex < 0 || segmentIndex >= nodes.length - 1) return { ...geom };
    delete nodes[segmentIndex].handleOut;
    delete nodes[segmentIndex + 1].handleIn;
    const next: ShapeRenderGeometry = { ...geom, pathNodes: nodes };
    delete next.controlPoint;
    return next;
}

/** Toggles an anchor node's continuity mode between 'sharp' (corner cusp) and 'smooth'. */
export function toggleLinearNodeKind(geom: ShapeRenderGeometry, nodeIndex: number): ShapeRenderGeometry {
    const nodes = getLinearPathNodes(geom);
    if (nodeIndex < 0 || nodeIndex >= nodes.length) return { ...geom };
    const node = nodes[nodeIndex];
    node.nodeKind = node.nodeKind === 'sharp' ? 'smooth' : 'sharp';

    if (node.nodeKind === 'smooth' && node.handleIn && node.handleOut) {
        // Collinearly align handleOut opposite to handleIn
        const inVx = node.handleIn.x - node.x;
        const inVy = node.handleIn.y - node.y;
        const inLen = Math.hypot(inVx, inVy);
        const outLen = Math.hypot(node.handleOut.x - node.x, node.handleOut.y - node.y);
        if (inLen > 1e-6 && outLen > 1e-6) {
            node.handleOut = {
                x: node.x - (inVx / inLen) * outLen,
                y: node.y - (inVy / inLen) * outLen,
            };
        }
    }

    const next: ShapeRenderGeometry = { ...geom, pathNodes: nodes };
    delete next.controlPoint;
    return next;
}
/** Tight bounds of a quadratic / cubic / multi-segment linear shape. */
export function linearPathBounds(geom: ShapeRenderGeometry): BoundingBox {
    const pts = sampleLinearPath(geom, 16);
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
    };
}

/**
 * Finds the index of the segment on a linear path closest to the given point.
 */
export function findClosestLinearSegment(geom: ShapeRenderGeometry, point: ShapePoint): number {
    const nodes = getLinearPathNodes(geom);
    if (nodes.length < 2) return 0;
    let bestDistSq = Infinity;
    let bestSeg = 0;
    for (let i = 0; i < nodes.length - 1; i++) {
        const p0 = nodes[i];
        const p1 = nodes[i + 1];
        const d2 = distToSegmentSquared(point.x, point.y, p0.x, p0.y, p1.x, p1.y);
        if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestSeg = i;
        }
    }
    return bestSeg;
}

/**
 * Slides a linear path segment in parallel (Tinkercad / Lucidchart style).
 * If the path is a 2-node chord, splits it into 3 orthogonal segments (4 nodes)
 * with a sliding middle bus trace.
 * If the path already has orthogonal segments, slides the segment parallel to itself,
 * preserving 90-degree corners.
 */
export function slideLinearSegment(
    geom: ShapeRenderGeometry,
    segIdx: number,
    point: ShapePoint,
): ShapeRenderGeometry {
    const nodes = getLinearPathNodes(geom);
    if (nodes.length < 2) return geom;

    const p0 = nodes[0];
    const p1 = nodes[nodes.length - 1];

    // Case 1: Simple 2-node line -> converts into a clean 3-segment orthogonal U-step (4 nodes)
    // Never generates slanted / half-inclination arms; all angles are strictly 90 degrees.
    if (nodes.length === 2) {
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const isHorizontal = Math.abs(dx) >= Math.abs(dy);

        if (isHorizontal) {
            // Horizontal line dragged vertically:
            // Node 0: (x0, y0) [fixed anchor]
            // Node 1: (x0, point.y) [90-deg vertical drop/rise from start]
            // Node 2: (x1, point.y) [full horizontal span at point.y]
            // Node 3: (x1, y1) [90-deg vertical drop/rise to end anchor]
            const newNodes: ShapePathNode[] = [
                { x: p0.x, y: p0.y, nodeKind: 'sharp' },
                { x: p0.x, y: point.y, nodeKind: 'sharp' },
                { x: p1.x, y: point.y, nodeKind: 'sharp' },
                { x: p1.x, y: p1.y, nodeKind: 'sharp' },
            ];
            return {
                ...geom,
                x0: p0.x,
                y0: p0.y,
                x1: p1.x,
                y1: p1.y,
                pathNodes: newNodes,
            };
        } else {
            // Vertical line dragged horizontally:
            // Node 0: (x0, y0) [fixed anchor]
            // Node 1: (point.x, y0) [90-deg horizontal span from start]
            // Node 2: (point.x, y1) [full vertical span at point.x]
            // Node 3: (x1, y1) [90-deg horizontal span to end anchor]
            const newNodes: ShapePathNode[] = [
                { x: p0.x, y: p0.y, nodeKind: 'sharp' },
                { x: point.x, y: p0.y, nodeKind: 'sharp' },
                { x: point.x, y: p1.y, nodeKind: 'sharp' },
                { x: p1.x, y: p1.y, nodeKind: 'sharp' },
            ];
            return {
                ...geom,
                x0: p0.x,
                y0: p0.y,
                x1: p1.x,
                y1: p1.y,
                pathNodes: newNodes,
            };
        }
    }

    // Case 2: Multi-segment path
    // Terminal anchors (nodes[0] and nodes[last]) are strictly invariant and never moved.
    const safeIdx = Math.max(0, Math.min(segIdx, nodes.length - 2));
    const nextNodes = nodes.map(n => ({ ...n, nodeKind: 'sharp' as const }));

    const isFirstSeg = safeIdx === 0;
    const isLastSeg = safeIdx === nextNodes.length - 2;

    const nA = nextNodes[safeIdx];
    const nB = nextNodes[safeIdx + 1];
    const isHorizontal = Math.abs(nA.y - nB.y) <= Math.abs(nA.x - nB.x);

    if (isFirstSeg && nextNodes.length >= 4) {
        // Dragging first segment: preserve anchor node 0 stationary, slide corner node 1
        if (isHorizontal) {
            nextNodes[1].y = point.y;
            if (nextNodes.length > 2) nextNodes[2].y = point.y;
        } else {
            nextNodes[1].x = point.x;
            if (nextNodes.length > 2) nextNodes[2].x = point.x;
        }
    } else if (isLastSeg && nextNodes.length >= 4) {
        // Dragging last segment: preserve end anchor stationary, slide preceding corner
        const lastCornerIdx = nextNodes.length - 2;
        if (isHorizontal) {
            nextNodes[lastCornerIdx].y = point.y;
            if (lastCornerIdx - 1 > 0) nextNodes[lastCornerIdx - 1].y = point.y;
        } else {
            nextNodes[lastCornerIdx].x = point.x;
            if (lastCornerIdx - 1 > 0) nextNodes[lastCornerIdx - 1].x = point.x;
        }
    } else {
        // Middle segment: slide both corners in parallel without touching terminal anchors
        if (isHorizontal) {
            nA.y = point.y;
            nB.y = point.y;
        } else {
            nA.x = point.x;
            nB.x = point.x;
        }
    }

    // Ensure start and end anchors remain 100% stationary
    nextNodes[0].x = nodes[0].x;
    nextNodes[0].y = nodes[0].y;
    nextNodes[nextNodes.length - 1].x = nodes[nodes.length - 1].x;
    nextNodes[nextNodes.length - 1].y = nodes[nodes.length - 1].y;

    // Clear any bezier tangent handles so segments stay crisp, straight, and strictly 90 degrees
    for (const n of nextNodes) {
        delete n.handleIn;
        delete n.handleOut;
    }

    return {
        ...geom,
        x0: nextNodes[0].x,
        y0: nextNodes[0].y,
        x1: nextNodes[nextNodes.length - 1].x,
        y1: nextNodes[nextNodes.length - 1].y,
        pathNodes: nextNodes,
    };
}
