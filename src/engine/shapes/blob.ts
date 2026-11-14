/**
 * src/engine/shapes/blob.ts
 *
 * Freeform closed 'blob' shape plugin:
 * - Follows the user's stylus trajectory faithfully via lightweight RDP simplification
 *   and loop-safe cyclic Catmull-Rom -> cubic Bezier fitting.
 * - Always produces a closed loop (`closePath` / `Z`) that supports solid and patterned
 *   shape fills (`solid`, `hachure`, `cross-hatch`, `dots`).
 * - Supports selection/hit-testing (interior + perimeter), bounding-box resize (with affine
 *   node scaling + optional 1:1 regularization), rotation, magnetic snap ports, SVG export,
 *   and reticle eraser slicing via `getBoundarySubpaths`.
 */

import type { BoundingBox, ShapePathNode } from '../../core/types.ts';
import type {
    CustomPathSegment,
    CustomShapeSubpath,
    ShapeFaceFillOptions,
    ShapeHandle,
    ShapePlugin,
    ShapePoint,
    ShapeRenderGeometry,
    ShapeSnapPort,
    ShapeStyleConfig,
    ShapeSvgOutput,
} from './types.ts';
import {
    applyCanvasFill,
    distToSegmentSquared,
    getStrokeDashArray,
    getSvgFillAttributes,
    getSvgStrokeAttributes,
    pointInPolygon,
    regularizeClosedGeometry,
} from './common.ts';
import {
    applyRotationDrag,
    boxControlHandles,
    boxSnapPorts,
    cubicPoint,
    getGeometryBox,
    resizeBoxByHandle,
    rotatePoint,
    rotatedBoxBounds,
} from './handles.ts';

function perpendicularSimplify(points: readonly ShapePoint[], epsilon: number): ShapePoint[] {
    if (points.length <= 2) return points.map(p => ({ x: p.x, y: p.y }));
    const epsSq = epsilon * epsilon;
    const first = points[0];
    const last = points[points.length - 1];
    let maxDistSq = -1;
    let index = 0;

    for (let i = 1; i < points.length - 1; i++) {
        const dSq = distToSegmentSquared(points[i].x, points[i].y, first.x, first.y, last.x, last.y);
        if (dSq > maxDistSq) {
            maxDistSq = dSq;
            index = i;
        }
    }

    if (maxDistSq > epsSq) {
        const left = perpendicularSimplify(points.slice(0, index + 1), epsilon);
        const right = perpendicularSimplify(points.slice(index), epsilon);
        return [...left.slice(0, -1), ...right];
    }
    return [{ x: first.x, y: first.y }, { x: last.x, y: last.y }];
}

/** Canonical 4-node asymmetric organic blob fitted inside normalized [0..1] box coordinates. */
function makeDefaultBlobNodes(minX: number, minY: number, width: number, height: number): ShapePathNode[] {
    const k = 0.28;
    const kx = width * k;
    const ky = height * k;
    const top: ShapePathNode = {
        x: minX + width * 0.42,
        y: minY + height * 0.04,
        handleIn: { x: minX + width * 0.42 - kx * 0.85, y: minY + height * 0.04 },
        handleOut: { x: minX + width * 0.42 + kx * 1.15, y: minY - height * 0.02 },
        nodeKind: 'smooth',
    };
    const right: ShapePathNode = {
        x: minX + width * 0.96,
        y: minY + height * 0.48,
        handleIn: { x: minX + width * 1.0, y: minY + height * 0.48 - ky * 0.95 },
        handleOut: { x: minX + width * 0.92, y: minY + height * 0.48 + ky * 0.7 },
        nodeKind: 'smooth',
    };
    const bottom: ShapePathNode = {
        x: minX + width * 0.62,
        y: minY + height * 0.96,
        handleIn: { x: minX + width * 0.62 + kx * 0.95, y: minY + height * 0.96 },
        handleOut: { x: minX + width * 0.62 - kx * 1.15, y: minY + height * 1.02 },
        nodeKind: 'smooth',
    };
    const left: ShapePathNode = {
        x: minX + width * 0.04,
        y: minY + height * 0.56,
        handleIn: { x: minX + width * 0.02, y: minY + height * 0.56 + ky * 1.0 },
        handleOut: { x: minX + width * 0.06, y: minY + height * 0.56 - ky * 0.9 },
        nodeKind: 'smooth',
    };
    return [top, right, bottom, left];
}

/**
 * Fits a smooth, loop-safe cyclic cubic Bezier contour to a freehand stylus trajectory.
 * Falls back cleanly to a canonical organic blob inside the stroke's bounding box when
 * fewer than 3 non-collinear vertices exist (e.g., straight 2-point drag).
 */
export function fitClosedBlobPathNodes(rawPoints: readonly ShapePoint[]): ShapePathNode[] {
    if (rawPoints.length < 2) return [];

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of rawPoints) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }

    const rawW = maxX - minX;
    const rawH = maxY - minY;
    const diag = Math.hypot(rawW, rawH);
    if (diag < 1) {
        return makeDefaultBlobNodes(minX - 4, minY - 4, 8, 8);
    }

    const minStep = Math.max(2, Math.min(8, diag * 0.015));
    const deduped: ShapePoint[] = [{ x: rawPoints[0].x, y: rawPoints[0].y }];
    for (let i = 1; i < rawPoints.length; i++) {
        const prev = deduped[deduped.length - 1];
        const curr = rawPoints[i];
        if (Math.hypot(curr.x - prev.x, curr.y - prev.y) >= minStep) {
            deduped.push({ x: curr.x, y: curr.y });
        }
    }

    if (deduped.length > 3) {
        const first = deduped[0];
        const last = deduped[deduped.length - 1];
        if (Math.hypot(last.x - first.x, last.y - first.y) < minStep * 1.6) {
            deduped.pop();
        }
    }

    const epsilon = Math.max(1.2, Math.min(4.0, diag * 0.008));
    const simplified = perpendicularSimplify(deduped, epsilon);

    if (simplified.length < 3) {
        const w = rawW >= 4 ? rawW : 8;
        const h = rawH >= 4 ? rawH : 8;
        const bx = rawW >= 4 ? minX : (minX + maxX) / 2 - 4;
        const by = rawH >= 4 ? minY : (minY + maxY) / 2 - 4;
        return makeDefaultBlobNodes(bx, by, w, h);
    }

    const n = simplified.length;
    const nodes: ShapePathNode[] = [];
    for (let i = 0; i < n; i++) {
        const prev = simplified[(i - 1 + n) % n];
        const curr = simplified[i];
        const next = simplified[(i + 1) % n];

        const d1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
        const d2 = Math.hypot(next.x - curr.x, next.y - curr.y);
        const vx = next.x - prev.x;
        const vy = next.y - prev.y;
        const vLen = Math.hypot(vx, vy);

        if (d1 < 1e-4 || d2 < 1e-4 || vLen < 1e-4) {
            nodes.push({ x: curr.x, y: curr.y, nodeKind: 'sharp' });
            continue;
        }

        const cosTheta = ((curr.x - prev.x) * (next.x - curr.x) + (curr.y - prev.y) * (next.y - curr.y)) / (d1 * d2);
        const angleDamp = cosTheta < -0.5 ? Math.max(0, (1 + cosTheta) * 2) : 1;
        const baseLen = (vLen / 6) * angleDamp;
        const asymCap = 1.5 * Math.min(d1, d2);
        const outLen = Math.min(baseLen, 0.36 * d2, asymCap);
        const inLen = Math.min(baseLen, 0.36 * d1, asymCap);

        const ux = vx / vLen;
        const uy = vy / vLen;

        nodes.push({
            x: curr.x,
            y: curr.y,
            handleIn: inLen > 0.25 ? { x: curr.x - ux * inLen, y: curr.y - uy * inLen } : undefined,
            handleOut: outLen > 0.25 ? { x: curr.x + ux * outLen, y: curr.y + uy * outLen } : undefined,
            nodeKind: angleDamp > 0.2 ? 'smooth' : 'sharp',
        });
    }
    return nodes;
}

function collectAxisExtrema(
    p0: number,
    p1: number,
    p2: number,
    p3: number,
    update: (val: number) => void,
): void {
    update(p0);
    update(p3);
    const v0 = p1 - p0;
    const v1 = p2 - p1;
    const v2 = p3 - p2;
    const a = v0 - 2 * v1 + v2;
    const b = v1 - v0;
    const c = v0;

    const evalAt = (t: number) => {
        if (t > 1e-6 && t < 1 - 1e-6) {
            const mt = 1 - t;
            const mt2 = mt * mt;
            const t2 = t * t;
            update(mt2 * mt * p0 + 3 * mt2 * t * p1 + 3 * mt * t2 * p2 + t2 * t * p3);
        }
    };

    if (Math.abs(a) < 1e-9) {
        if (Math.abs(b) > 1e-9) {
            evalAt(-c / (2 * b));
        }
        return;
    }

    const disc = b * b - a * c;
    if (disc >= 0) {
        const sqrtD = Math.sqrt(disc);
        evalAt((-b + sqrtD) / a);
        evalAt((-b - sqrtD) / a);
    }
}

/** Exact analytical bounding box of a closed cyclic cubic Bezier contour. */
export function getClosedPathBounds(nodes: readonly ShapePathNode[]): BoundingBox {
    if (nodes.length === 0) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const pushX = (x: number) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
    };
    const pushY = (y: number) => {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    };

    const n = nodes.length;
    for (let i = 0; i < n; i++) {
        const a = nodes[i];
        const b = nodes[(i + 1) % n];
        const cp1 = a.handleOut ?? { x: a.x, y: a.y };
        const cp2 = b.handleIn ?? { x: b.x, y: b.y };
        collectAxisExtrema(a.x, cp1.x, cp2.x, b.x, pushX);
        collectAxisExtrema(a.y, cp1.y, cp2.y, b.y, pushY);
    }

    return { minX, minY, maxX, maxY };
}

/** Builds a normalized Blob geometry from a raw trajectory of points. */
export function buildBlobGeometryFromPoints(points: readonly ShapePoint[]): ShapeRenderGeometry {
    const pathNodes = fitClosedBlobPathNodes(points);
    if (pathNodes.length < 2) {
        const p = points[0] ?? { x: 0, y: 0 };
        return { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    }
    const bounds = getClosedPathBounds(pathNodes);
    return {
        x0: bounds.minX,
        y0: bounds.minY,
        x1: bounds.maxX,
        y1: bounds.maxY,
        pathNodes,
    };
}

function getBlobNodes(norm: ShapeRenderGeometry): ShapePathNode[] {
    if (norm.pathNodes && norm.pathNodes.length >= 2) {
        return norm.pathNodes;
    }
    const box = getGeometryBox(norm);
    const w = Math.max(1e-6, box.maxX - box.minX);
    const h = Math.max(1e-6, box.maxY - box.minY);
    return makeDefaultBlobNodes(box.minX, box.minY, w, h);
}

function traceClosedNodes(ctx: CanvasRenderingContext2D, nodes: readonly ShapePathNode[]): void {
    if (nodes.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
        const a = nodes[i];
        const b = nodes[(i + 1) % n];
        if (!a.handleOut && !b.handleIn) {
            ctx.lineTo(b.x, b.y);
        } else {
            const cp1 = a.handleOut ?? { x: a.x, y: a.y };
            const cp2 = b.handleIn ?? { x: b.x, y: b.y };
            ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, b.x, b.y);
        }
    }
    ctx.closePath();
}

function closedNodesToSvgPath(nodes: readonly ShapePathNode[]): string {
    if (nodes.length < 2) return '';
    const cmds: string[] = [`M ${nodes[0].x} ${nodes[0].y}`];
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
        const a = nodes[i];
        const b = nodes[(i + 1) % n];
        if (!a.handleOut && !b.handleIn) {
            cmds.push(`L ${b.x} ${b.y}`);
        } else {
            const cp1 = a.handleOut ?? { x: a.x, y: a.y };
            const cp2 = b.handleIn ?? { x: b.x, y: b.y };
            cmds.push(`C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${b.x} ${b.y}`);
        }
    }
    cmds.push('Z');
    return cmds.join(' ');
}

function sampleClosedNodes(nodes: readonly ShapePathNode[], stepsPerCurve = 16): Array<[number, number]> {
    if (nodes.length < 2) return [];
    const pts: Array<[number, number]> = [[nodes[0].x, nodes[0].y]];
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
        const a = nodes[i];
        const b = nodes[(i + 1) % n];
        if (!a.handleOut && !b.handleIn) {
            pts.push([b.x, b.y]);
        } else {
            const cp1 = a.handleOut ?? { x: a.x, y: a.y };
            const cp2 = b.handleIn ?? { x: b.x, y: b.y };
            for (let s = 1; s <= stepsPerCurve; s++) {
                const pt = cubicPoint(a, cp1, cp2, b, s / stepsPerCurve);
                pts.push([pt.x, pt.y]);
            }
        }
    }
    return pts;
}

export const blobShapePlugin: ShapePlugin = {
    id: 'blob',
    name: 'Blob',
    isClosed: true,
    category: 'geometric',
    iconSvgPaths: [
        'M 8 4 C 14 2, 21 5, 20 11 C 19 16, 22 19, 16 21 C 10 22, 4 19, 4 13 C 4 8, 5 5, 8 4 Z',
    ],

    normalizeGeometry(geom: ShapeRenderGeometry): ShapeRenderGeometry {
        if (geom.pathNodes && geom.pathNodes.length >= 2) {
            const bounds = getClosedPathBounds(geom.pathNodes);
            return {
                ...geom,
                x0: bounds.minX,
                y0: bounds.minY,
                x1: bounds.maxX,
                y1: bounds.maxY,
            };
        }
        return geom.regularize ? regularizeClosedGeometry(geom) : { ...geom };
    },

    renderCanvas(ctx: CanvasRenderingContext2D, geom: ShapeRenderGeometry, style: ShapeStyleConfig): void {
        const norm = this.normalizeGeometry(geom);
        const nodes = getBlobNodes(norm);
        if (nodes.length < 2) return;

        const strokeWidth = style.strokeWidth ?? 3;
        const strokeColor = style.strokeColor || '#1F4FD8';
        const strokeOpacity = style.strokeOpacity !== undefined ? style.strokeOpacity : 1;
        const pattern = style.strokePattern || 'solid';
        const shapeRotDeg = (style as { shapeRotationDeg?: number }).shapeRotationDeg;
        const faceOptions: ShapeFaceFillOptions | undefined =
            shapeRotDeg !== undefined ? { shapeRotationDeg: shapeRotDeg } : undefined;

        ctx.save();

        if (style.fillEnabled) {
            traceClosedNodes(ctx, nodes);
            applyCanvasFill(ctx, style, undefined, faceOptions);
        }

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.globalAlpha = strokeOpacity;
        ctx.lineCap = pattern === 'dashed' ? 'butt' : 'round';
        ctx.lineJoin = 'round';
        if (ctx.setLineDash) {
            ctx.setLineDash(getStrokeDashArray(pattern, strokeWidth));
        }

        traceClosedNodes(ctx, nodes);
        ctx.stroke();

        ctx.restore();
    },

    renderSvg(geom: ShapeRenderGeometry, style: ShapeStyleConfig): ShapeSvgOutput {
        const norm = this.normalizeGeometry(geom);
        const nodes = getBlobNodes(norm);
        const d = closedNodesToSvgPath(nodes);
        const strokeAttrs = getSvgStrokeAttributes(style);
        const shapeRotDeg = (style as { shapeRotationDeg?: number }).shapeRotationDeg;
        const faceOptions: ShapeFaceFillOptions | undefined =
            shapeRotDeg !== undefined ? { shapeRotationDeg: shapeRotDeg } : undefined;
        const { fillAttr, defs } = getSvgFillAttributes(style, faceOptions);

        return {
            defs: defs ?? {},
            body: `<path d="${d}" ${strokeAttrs} ${fillAttr}/>`,
        };
    },

    computeBounds(geom: ShapeRenderGeometry, strokeWidth: number): BoundingBox {
        const norm = this.normalizeGeometry(geom);
        const box = getGeometryBox(norm);
        return rotatedBoxBounds(box.minX, box.minY, box.maxX, box.maxY, norm.rotation, (strokeWidth || 3) / 2);
    },

    hitTest(geom: ShapeRenderGeometry, point: { x: number; y: number }, tolerance: number): boolean {
        const norm = this.normalizeGeometry(geom);
        const box = getGeometryBox(norm);
        let p = point;
        if (norm.rotation) {
            const cx = (box.minX + box.maxX) / 2;
            const cy = (box.minY + box.maxY) / 2;
            p = rotatePoint(point.x, point.y, cx, cy, -norm.rotation);
        }

        const poly = sampleClosedNodes(getBlobNodes(norm));
        if (poly.length >= 3 && pointInPolygon(p.x, p.y, poly)) {
            return true;
        }
        const tol2 = tolerance * tolerance;
        for (let i = 1; i < poly.length; i++) {
            if (distToSegmentSquared(p.x, p.y, poly[i - 1][0], poly[i - 1][1], poly[i][0], poly[i][1]) <= tol2) {
                return true;
            }
        }
        return false;
    },

    getControlHandles(geom: ShapeRenderGeometry): ShapeHandle[] {
        return boxControlHandles(this.normalizeGeometry(geom));
    },

    applyHandleDrag(geom: ShapeRenderGeometry, handleId: string, newPoint: ShapePoint, regularize?: boolean): ShapeRenderGeometry {
        const reg = regularize !== undefined ? regularize : Boolean(geom.regularize);
        const norm = this.normalizeGeometry({ ...geom, regularize: reg });
        if (handleId === 'rotate') {
            return applyRotationDrag(norm, newPoint, reg);
        }

        const oldBox = getGeometryBox(norm);
        const resized = resizeBoxByHandle(norm, handleId, newPoint, reg);

        if (!norm.pathNodes || norm.pathNodes.length < 2) {
            return resized;
        }

        const rot = norm.rotation || 0;
        const isRotated = Math.abs(rot) > 1e-4;
        const westAnchored = !isRotated && (handleId === 'nw' || handleId === 'sw' || handleId === 'w');
        const northAnchored = !isRotated && (handleId === 'nw' || handleId === 'ne' || handleId === 'n');

        const targetLeft = westAnchored ? resized.x1 : resized.x0;
        const targetRight = westAnchored ? resized.x0 : resized.x1;
        const targetTop = northAnchored ? resized.y1 : resized.y0;
        const targetBottom = northAnchored ? resized.y0 : resized.y1;

        const oldW = oldBox.maxX - oldBox.minX;
        const oldH = oldBox.maxY - oldBox.minY;
        const mapPt = (pt: ShapePoint): ShapePoint => {
            const u = oldW > 1e-6 ? (pt.x - oldBox.minX) / oldW : 0.5;
            const v = oldH > 1e-6 ? (pt.y - oldBox.minY) / oldH : 0.5;
            return {
                x: targetLeft + u * (targetRight - targetLeft),
                y: targetTop + v * (targetBottom - targetTop),
            };
        };

        const scaledNodes = norm.pathNodes.map(n => ({
            ...mapPt(n),
            handleIn: n.handleIn ? mapPt(n.handleIn) : undefined,
            handleOut: n.handleOut ? mapPt(n.handleOut) : undefined,
            nodeKind: n.nodeKind,
        }));
        const nextBounds = getClosedPathBounds(scaledNodes);
        return {
            ...resized,
            x0: nextBounds.minX,
            y0: nextBounds.minY,
            x1: nextBounds.maxX,
            y1: nextBounds.maxY,
            pathNodes: scaledNodes,
        };
    },

    getSnapPorts(geom: ShapeRenderGeometry): ShapeSnapPort[] {
        return boxSnapPorts(this.normalizeGeometry(geom));
    },

    getBoundarySubpaths(geom: ShapeRenderGeometry): CustomShapeSubpath[] {
        const norm = this.normalizeGeometry(geom);
        const nodes = getBlobNodes(norm);
        if (nodes.length < 2) return [];
        const box = getGeometryBox(norm);
        const w = Math.max(1e-6, box.maxX - box.minX);
        const h = Math.max(1e-6, box.maxY - box.minY);
        const toU = (x: number) => (x - box.minX) / w;
        const toV = (y: number) => (y - box.minY) / h;

        const commands: CustomPathSegment[] = [{ type: 'M', args: [toU(nodes[0].x), toV(nodes[0].y)] }];
        const n = nodes.length;
        for (let i = 0; i < n; i++) {
            const a = nodes[i];
            const b = nodes[(i + 1) % n];
            const cp1 = a.handleOut ?? { x: a.x, y: a.y };
            const cp2 = b.handleIn ?? { x: b.x, y: b.y };
            commands.push({
                type: 'C',
                args: [toU(cp1.x), toV(cp1.y), toU(cp2.x), toV(cp2.y), toU(b.x), toV(b.y)],
            });
        }
        commands.push({ type: 'Z', args: [] });
        return [{ commands, isClosed: true, isFilled: true, isStroked: true }];
    },
};
