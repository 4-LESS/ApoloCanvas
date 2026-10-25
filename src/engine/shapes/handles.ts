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

/**
 * Cardinal perimeter midpoints ('n', 'e', 's', 'w') plus 'center'. The bounding-box midpoints
 * lie on the outline of every built-in closed shape (rectangle, ellipse, diamond, hexagon, cylinder).
 */
export function boxSnapPorts(geom: ShapeRenderGeometry): ShapeSnapPort[] {
    const { minX, minY, maxX, maxY } = getGeometryBox(geom);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    return [
        { id: 'n', x: midX, y: minY },
        { id: 'e', x: maxX, y: midY },
        { id: 's', x: midX, y: maxY },
        { id: 'w', x: minX, y: midY },
        { id: 'center', x: midX, y: midY },
    ];
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
    if (!geom.pathNodes) {
        const handles: ShapeHandle[] = [
            { id: 'start', kind: 'endpoint', x: geom.x0, y: geom.y0 },
            { id: 'end', kind: 'endpoint', x: geom.x1, y: geom.y1 },
        ];
        const mid = geom.controlPoint
            ? { x: (geom.x0 + 2 * geom.controlPoint.x + geom.x1) / 4, y: (geom.y0 + 2 * geom.controlPoint.y + geom.y1) / 4 }
            : { x: (geom.x0 + geom.x1) / 2, y: (geom.y0 + geom.y1) / 2 };
        handles.push({ id: 'curve', kind: 'curve', x: mid.x, y: mid.y });
        return handles;
    }

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

    // 2. Segment midpoint handles (Affinity push-pull curve bend)
    for (let i = 0; i < nodes.length - 1; i++) {
        const mid = getSegmentMidpoint(nodes[i], nodes[i + 1]);
        handles.push({
            id: `seg-mid-${i}`,
            kind: 'segment-mid',
            x: mid.x,
            y: mid.y,
        });
    }

    // 3. Tangent handles for curved segments
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.handleIn) {
            handles.push({
                id: `bezier-in-${i}`,
                kind: 'bezier-in',
                x: n.handleIn.x,
                y: n.handleIn.y,
            });
        }
        if (n.handleOut) {
            handles.push({
                id: `bezier-out-${i}`,
                kind: 'bezier-out',
                x: n.handleOut.x,
                y: n.handleOut.y,
            });
        }
    }

    return handles;
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
    // Legacy 2-node line / arrow support (single quadratic controlPoint)
    if (!geom.pathNodes) {
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
        node.handleIn = { x: point.x, y: point.y };
        const vx = point.x - node.x;
        const vy = point.y - node.y;

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
        node.handleOut = { x: point.x, y: point.y };
        const vx = point.x - node.x;
        const vy = point.y - node.y;

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
    if (regularize && (nodeIdx === 0 || nodeIdx === nodes.length - 1)) {
        const fixed = nodeIdx === 0 ? nodes[nodes.length - 1] : nodes[0];
        target = snapAround(fixed, point);
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

/** Inserts a new anchor node at t = 0.5 of segmentIndex, splitting it into two independent segments. */
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
