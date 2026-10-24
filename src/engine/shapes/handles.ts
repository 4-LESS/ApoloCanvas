/**
 * src/engine/shapes/handles.ts
 *
 * Shared control-handle geometry for parametric shape editing:
 * bounding-box resize handles (corners + cardinal edges) and quadratic Bezier
 * helpers for curved lines / arrows.
 */

import type { BoundingBox } from '../../core/types.ts';
import type { ShapeHandle, ShapePoint, ShapeRenderGeometry } from './types.ts';
import { distToSegmentSquared } from './common.ts';

export const BOX_CORNER_HANDLE_IDS = ['nw', 'ne', 'se', 'sw'] as const;
export const BOX_EDGE_HANDLE_IDS = ['n', 'e', 's', 'w'] as const;

/** Below this distance (geometry units) a dragged curve handle snaps the line back to straight. */
const STRAIGHTEN_SNAP_DISTANCE = 3;
const CURVE_SAMPLE_SEGMENTS = 24;

export function getGeometryBox(geom: ShapeRenderGeometry): BoundingBox {
    return {
        minX: Math.min(geom.x0, geom.x1),
        minY: Math.min(geom.y0, geom.y1),
        maxX: Math.max(geom.x0, geom.x1),
        maxY: Math.max(geom.y0, geom.y1),
    };
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
    let { minX, minY, maxX, maxY } = getGeometryBox(geom);

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

    if (handleId === 'n') minY = point.y;
    else if (handleId === 's') maxY = point.y;
    else if (handleId === 'e') maxX = point.x;
    else if (handleId === 'w') minX = point.x;
    else return { ...geom };

    if (regularize) {
        if (handleId === 'n' || handleId === 's') {
            const h = Math.abs(maxY - minY);
            const w = h / aspect;
            const cx = (minX + maxX) / 2;
            minX = cx - w / 2;
            maxX = cx + w / 2;
        } else {
            const w = Math.abs(maxX - minX);
            const h = w * aspect;
            const cy = (minY + maxY) / 2;
            minY = cy - h / 2;
            maxY = cy + h / 2;
        }
    }

    // Anchor x0/y0 at the edge that did not move so regularized output survives normalizeGeometry().
    const x0 = handleId === 'w' ? maxX : minX;
    const x1 = handleId === 'w' ? minX : maxX;
    const y0 = handleId === 'n' ? maxY : minY;
    const y1 = handleId === 'n' ? minY : maxY;
    return { ...geom, x0, y0, x1, y1, regularize };
}

// ---------------------------------------------------------------------------
// Quadratic Bezier helpers (curved 'line' / 'arrow')
// ---------------------------------------------------------------------------

export function quadraticPoint(p0: ShapePoint, c: ShapePoint, p1: ShapePoint, t: number): ShapePoint {
    const mt = 1 - t;
    return {
        x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
        y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
    };
}

/** Point where the 'curve' handle sits: B(0.5) of the Bezier, or the chord midpoint when straight. */
export function getCurveHandlePoint(geom: ShapeRenderGeometry): ShapePoint {
    const p0 = { x: geom.x0, y: geom.y0 };
    const p1 = { x: geom.x1, y: geom.y1 };
    if (!geom.controlPoint) {
        return { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    }
    return quadraticPoint(p0, geom.controlPoint, p1, 0.5);
}

/** Polyline approximation of the (possibly curved) linear shape. */
export function sampleLinearPath(geom: ShapeRenderGeometry, segments = CURVE_SAMPLE_SEGMENTS): ShapePoint[] {
    const p0 = { x: geom.x0, y: geom.y0 };
    const p1 = { x: geom.x1, y: geom.y1 };
    if (!geom.controlPoint) return [p0, p1];
    const pts: ShapePoint[] = [];
    for (let i = 0; i <= segments; i++) {
        pts.push(quadraticPoint(p0, geom.controlPoint, p1, i / segments));
    }
    return pts;
}

/** Unit-free tangent direction at the end of the path (used to align the arrowhead). */
export function getEndTangentAngle(geom: ShapeRenderGeometry): number {
    const c = geom.controlPoint;
    if (c && Math.hypot(geom.x1 - c.x, geom.y1 - c.y) > 1e-6) {
        return Math.atan2(geom.y1 - c.y, geom.x1 - c.x);
    }
    return Math.atan2(geom.y1 - geom.y0, geom.x1 - geom.x0);
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

export function linearControlHandles(geom: ShapeRenderGeometry): ShapeHandle[] {
    const curve = getCurveHandlePoint(geom);
    return [
        { id: 'start', kind: 'endpoint', x: geom.x0, y: geom.y0 },
        { id: 'end', kind: 'endpoint', x: geom.x1, y: geom.y1 },
        { id: 'curve', kind: 'curve', x: curve.x, y: curve.y },
    ];
}

function snapAround(origin: ShapePoint, point: ShapePoint): ShapePoint {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const r = Math.hypot(dx, dy);
    if (r < 1e-6) return { ...point };
    const step = Math.PI / 4;
    const theta = Math.round(Math.atan2(dy, dx) / step) * step;
    return { x: origin.x + r * Math.cos(theta), y: origin.y + r * Math.sin(theta) };
}

/**
 * Drags a linear-shape handle. 'start' / 'end' move an endpoint (snapping the chord to 45°
 * when regularized) and shift the control point by half the delta so the bend is preserved;
 * 'curve' bends the path so that B(0.5) passes through the pointer.
 */
export function applyLinearHandleDrag(
    geom: ShapeRenderGeometry,
    handleId: string,
    point: ShapePoint,
    regularize = false,
): ShapeRenderGeometry {
    if (handleId === 'curve') {
        const mid = { x: (geom.x0 + geom.x1) / 2, y: (geom.y0 + geom.y1) / 2 };
        const next: ShapeRenderGeometry = { ...geom, regularize };
        if (Math.hypot(point.x - mid.x, point.y - mid.y) <= STRAIGHTEN_SNAP_DISTANCE) {
            delete next.controlPoint;
        } else {
            next.controlPoint = { x: 2 * point.x - mid.x, y: 2 * point.y - mid.y };
        }
        return next;
    }

    if (handleId !== 'start' && handleId !== 'end') return { ...geom };

    const moving = handleId === 'start' ? { x: geom.x0, y: geom.y0 } : { x: geom.x1, y: geom.y1 };
    const fixed = handleId === 'start' ? { x: geom.x1, y: geom.y1 } : { x: geom.x0, y: geom.y0 };
    const target = regularize ? snapAround(fixed, point) : { x: point.x, y: point.y };
    const next: ShapeRenderGeometry = { ...geom, regularize };
    if (handleId === 'start') {
        next.x0 = target.x;
        next.y0 = target.y;
    } else {
        next.x1 = target.x;
        next.y1 = target.y;
    }
    if (geom.controlPoint) {
        next.controlPoint = {
            x: geom.controlPoint.x + (target.x - moving.x) / 2,
            y: geom.controlPoint.y + (target.y - moving.y) / 2,
        };
    }
    return next;
}

/** Tight bounds of a quadratic Bezier (endpoints + interior extrema). */
export function linearPathBounds(geom: ShapeRenderGeometry): BoundingBox {
    const xs = [geom.x0, geom.x1];
    const ys = [geom.y0, geom.y1];
    const c = geom.controlPoint;
    if (c) {
        const p0 = { x: geom.x0, y: geom.y0 };
        const p1 = { x: geom.x1, y: geom.y1 };
        const denomX = geom.x0 - 2 * c.x + geom.x1;
        const denomY = geom.y0 - 2 * c.y + geom.y1;
        if (Math.abs(denomX) > 1e-9) {
            const t = (geom.x0 - c.x) / denomX;
            if (t > 0 && t < 1) xs.push(quadraticPoint(p0, c, p1, t).x);
        }
        if (Math.abs(denomY) > 1e-9) {
            const t = (geom.y0 - c.y) / denomY;
            if (t > 0 && t < 1) ys.push(quadraticPoint(p0, c, p1, t).y);
        }
    }
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
