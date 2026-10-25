import type { Point, ShapeElement, ShapePathNode } from '../../core/types.ts';
import { shapeElementToGeometry } from '../shapes/element.ts';
import { getLinearPathNodes, rotatePoint } from '../shapes/handles.ts';
import type { ShapePoint, ShapeRenderGeometry } from '../shapes/types.ts';
import { distToSegmentSquared } from './StrokeEraser.ts';

interface Subsegment {
    p0: ShapePoint;
    p1?: ShapePoint;
    p2?: ShapePoint;
    p3: ShapePoint;
    isCubic: boolean;
    startsAtNode: boolean;
    endsAtNode: boolean;
    segIdx: number;
}

/**
 * Evaluates a cubic Bezier curve at parameter t in [0, 1].
 */
export function evalCubicBezier(p0: ShapePoint, p1: ShapePoint, p2: ShapePoint, p3: ShapePoint, t: number): ShapePoint {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return {
        x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
        y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
    };
}

/**
 * Splits a cubic Bezier curve into two subcurves at parameter t using De Casteljau's algorithm.
 */
export function deCasteljau(
    p0: ShapePoint,
    p1: ShapePoint,
    p2: ShapePoint,
    p3: ShapePoint,
    t: number
): {
    left: { p0: ShapePoint; p1: ShapePoint; p2: ShapePoint; p3: ShapePoint };
    right: { p0: ShapePoint; p1: ShapePoint; p2: ShapePoint; p3: ShapePoint };
} {
    const q0 = { x: (1 - t) * p0.x + t * p1.x, y: (1 - t) * p0.y + t * p1.y };
    const q1 = { x: (1 - t) * p1.x + t * p2.x, y: (1 - t) * p1.y + t * p2.y };
    const q2 = { x: (1 - t) * p2.x + t * p3.x, y: (1 - t) * p2.y + t * p3.y };

    const r0 = { x: (1 - t) * q0.x + t * q1.x, y: (1 - t) * q0.y + t * q1.y };
    const r1 = { x: (1 - t) * q1.x + t * q2.x, y: (1 - t) * q1.y + t * q2.y };

    const pt = { x: (1 - t) * r0.x + t * r1.x, y: (1 - t) * r0.y + t * r1.y };

    return {
        left: { p0, p1: q0, p2: r0, p3: pt },
        right: { p0: pt, p1: r1, p2: q2, p3 }
    };
}

/**
 * Extracts a subcurve of a cubic Bezier curve between parameters [t0, t1].
 */
export function extractCubicSubcurve(
    p0: ShapePoint,
    p1: ShapePoint,
    p2: ShapePoint,
    p3: ShapePoint,
    t0: number,
    t1: number
): { p0: ShapePoint; p1: ShapePoint; p2: ShapePoint; p3: ShapePoint } {
    let right: { p0: ShapePoint; p1: ShapePoint; p2: ShapePoint; p3: ShapePoint };
    if (t0 > 1e-4) {
        right = deCasteljau(p0, p1, p2, p3, t0).right;
    } else {
        right = { p0, p1, p2, p3 };
    }
    if (t1 < 1 - 1e-4) {
        const adj = (t1 - t0) / Math.max(1e-4, 1 - t0);
        return deCasteljau(right.p0, right.p1, right.p2, right.p3, Math.max(0, Math.min(1, adj))).left;
    }
    return right;
}

/**
 * Tests whether a point falls within the envelope of an eraser gesture.
 */
export function isPointInsideEraser(
    pt: ShapePoint,
    eraser: Point[],
    effRadiusSq: number
): boolean {
    for (let j = 0; j < eraser.length; j++) {
        const ep = eraser[j];
        if (j === 0) {
            const dx = pt.x - ep.x;
            const dy = pt.y - ep.y;
            if (dx * dx + dy * dy <= effRadiusSq) return true;
        } else {
            const prev = eraser[j - 1];
            if (distToSegmentSquared(pt.x, pt.y, prev.x, prev.y, ep.x, ep.y) <= effRadiusSq) return true;
        }
    }
    return false;
}

/**
 * Decomposes any ShapeElement into world-coordinate boundary path nodes,
 * supporting closed 2D shapes (rectangles, ellipses, polygons), open linear paths,
 * and multi-path 3D shapes like cylinders (silhouette + front rim arc).
 */
export function shapeToBoundaryPaths(
    shape: ShapeElement,
    contentLeft: number,
    blockTop: number,
    contentWidth: number
): Array<{ isClosed: boolean; nodes: ShapePathNode[] }> {
    const geom = shapeElementToGeometry(shape, contentLeft, blockTop, contentWidth);

    if (shape.shapeType === 'line' || shape.shapeType === 'arrow') {
        return [{ isClosed: false, nodes: getLinearPathNodes(geom) }];
    }

    const minX = Math.min(geom.x0, geom.x1);
    const maxX = Math.max(geom.x0, geom.x1);
    const minY = Math.min(geom.y0, geom.y1);
    const maxY = Math.max(geom.y0, geom.y1);
    const W = maxX - minX;
    const H = maxY - minY;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rot = geom.rotation ?? 0;

    const toWorld = (u: number, v: number): ShapePoint => {
        const rx = minX + u * W;
        const ry = minY + v * H;
        return rot !== 0 ? rotatePoint(rx, ry, cx, cy, rot) : { x: rx, y: ry };
    };

    if (shape.shapeType === 'cylinder') {
        const c = Math.max(0.08, Math.min(0.48, geom.shapeParams?.capRatio ?? 0.22));
        const k = 0.55228475;
        const c_top = +(c * (1 - k)).toFixed(3);
        const c_bot = +(c * (1 + k)).toFixed(3);
        const c2 = +(2 * c).toFixed(3);
        const x_k0 = +(0.5 * (1 - k)).toFixed(3);
        const x_k1 = +(0.5 * (1 + k)).toFixed(3);
        const y_low_mid = +(1 - c).toFixed(3);
        const y_low_ctrl = +(1 - c + k * c).toFixed(3);

        // Path 1: Outer 3D Silhouette (closed loop with curved top cap, bottom base, and straight vertical sides)
        const silhouetteNodes: ShapePathNode[] = [
            { ...toWorld(0, c), handleIn: toWorld(0, c_top), nodeKind: 'smooth' },
            { ...toWorld(0, y_low_mid), handleOut: toWorld(0, y_low_ctrl), nodeKind: 'smooth' },
            { ...toWorld(0.5, 1), handleIn: toWorld(x_k0, 1), handleOut: toWorld(x_k1, 1), nodeKind: 'smooth' },
            { ...toWorld(1, y_low_mid), handleIn: toWorld(1, y_low_ctrl), nodeKind: 'smooth' },
            { ...toWorld(1, c), handleOut: toWorld(1, c_top), nodeKind: 'smooth' },
            { ...toWorld(0.5, 0), handleIn: toWorld(x_k1, 0), handleOut: toWorld(x_k0, 0), nodeKind: 'smooth' },
        ];

        // Path 2: Front Top Rim Arc (open curved seam across the front)
        const frontRimNodes: ShapePathNode[] = [
            { ...toWorld(0, c), handleOut: toWorld(0, c_bot), nodeKind: 'smooth' },
            { ...toWorld(0.5, c2), handleIn: toWorld(x_k0, c2), handleOut: toWorld(x_k1, c2), nodeKind: 'smooth' },
            { ...toWorld(1, c), handleIn: toWorld(1, c_bot), nodeKind: 'smooth' },
        ];

        return [
            { isClosed: true, nodes: silhouetteNodes },
            { isClosed: false, nodes: frontRimNodes },
        ];
    }

    if (shape.shapeType === 'rectangle') {
        const rawCorners = [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY },
        ];
        const corners = rot !== 0
            ? rawCorners.map(p => rotatePoint(p.x, p.y, cx, cy, rot))
            : rawCorners;
        return [{
            isClosed: true,
            nodes: corners.map(c => ({ x: c.x, y: c.y, nodeKind: 'sharp' as const })),
        }];
    }

    if (shape.shapeType === 'ellipse') {
        const rx = Math.abs(geom.x1 - geom.x0) / 2;
        const ry = Math.abs(geom.y1 - geom.y0) / 2;
        const k = 0.5522847498307936;
        const kx = k * rx;
        const ky = k * ry;

        const rawNodes: ShapePathNode[] = [
            { x: cx, y: cy - ry, handleIn: { x: cx - kx, y: cy - ry }, handleOut: { x: cx + kx, y: cy - ry }, nodeKind: 'smooth' },
            { x: cx + rx, y: cy, handleIn: { x: cx + rx, y: cy - ky }, handleOut: { x: cx + rx, y: cy + ky }, nodeKind: 'smooth' },
            { x: cx, y: cy + ry, handleIn: { x: cx + kx, y: cy + ry }, handleOut: { x: cx - kx, y: cy + ry }, nodeKind: 'smooth' },
            { x: cx - rx, y: cy, handleIn: { x: cx - rx, y: cy + ky }, handleOut: { x: cx - rx, y: cy - ky }, nodeKind: 'smooth' },
        ];
        const nodes = rot !== 0
            ? rawNodes.map(n => ({
                x: rotatePoint(n.x, n.y, cx, cy, rot).x,
                y: rotatePoint(n.x, n.y, cx, cy, rot).y,
                handleIn: n.handleIn ? rotatePoint(n.handleIn.x, n.handleIn.y, cx, cy, rot) : undefined,
                handleOut: n.handleOut ? rotatePoint(n.handleOut.x, n.handleOut.y, cx, cy, rot) : undefined,
                nodeKind: 'smooth' as const,
            }))
            : rawNodes;
        return [{ isClosed: true, nodes }];
    }

    if (shape.shapeType === 'triangle') {
        const rawVertices = [
            { x: cx, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY },
        ];
        const vertices = rot !== 0
            ? rawVertices.map(p => rotatePoint(p.x, p.y, cx, cy, rot))
            : rawVertices;
        return [{
            isClosed: true,
            nodes: vertices.map(v => ({ x: v.x, y: v.y, nodeKind: 'sharp' as const })),
        }];
    }

    if (shape.shapeType === 'diamond') {
        const rawPts = [
            { x: cx, y: minY },
            { x: maxX, y: cy },
            { x: cx, y: maxY },
            { x: minX, y: cy },
        ];
        const pts = rot !== 0
            ? rawPts.map(p => rotatePoint(p.x, p.y, cx, cy, rot))
            : rawPts;
        return [{
            isClosed: true,
            nodes: pts.map(p => ({ x: p.x, y: p.y, nodeKind: 'sharp' as const })),
        }];
    }

    if (shape.shapeType === 'hexagon') {
        const bevel = W * (geom.shapeParams?.bevelRatio ?? 0.25);
        const rawPts = [
            { x: minX + bevel, y: minY },
            { x: maxX - bevel, y: minY },
            { x: maxX, y: cy },
            { x: maxX - bevel, y: maxY },
            { x: minX + bevel, y: maxY },
            { x: minX, y: cy },
        ];
        const pts = rot !== 0
            ? rawPts.map(p => rotatePoint(p.x, p.y, cx, cy, rot))
            : rawPts;
        return [{
            isClosed: true,
            nodes: pts.map(p => ({ x: p.x, y: p.y, nodeKind: 'sharp' as const })),
        }];
    }

    // Default fallback: 4 corners bounding box
    const rawCorners = [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
    ];
    const corners = rot !== 0
        ? rawCorners.map(p => rotatePoint(p.x, p.y, cx, cy, rot))
        : rawCorners;
    return [{
        isClosed: true,
        nodes: corners.map(c => ({ x: c.x, y: c.y, nodeKind: 'sharp' as const })),
    }];
}

/**
 * Splits a ShapeElement when cut by an eraser gesture in reticle mode:
 * 1. Elements with fill lose their fill (fillEnabled = false).
 * 2. Cut boundaries are neatly sliced using De Casteljau subdivision, preserving Bezier curves.
 * 3. The resulting fragments remain fully editable Stage 5 multi-segment Bezier paths.
 *
 * Returns:
 * - `ShapeElement[]`: fragments resulting from the cut (or `[]` if entirely erased).
 * - `null`: if the eraser did not collide with the shape.
 */
export function splitShapeDoc(
    shape: ShapeElement,
    eraser: Point[],
    radius: number,
    contentLeft: number,
    contentWidth: number,
    blockTop: number,
    uuidGenerator: () => string
): ShapeElement[] | null {
    if (eraser.length === 0) return null;

    const paths = shapeToBoundaryPaths(shape, contentLeft, blockTop, contentWidth);
    if (paths.length === 0) return null;

    const effRadius = radius + (shape.style.width || 2) / 2;
    const effRadiusSq = effRadius * effRadius;

    let anyHit = false;
    const allChains: Subsegment[][] = [];

    for (const { isClosed, nodes } of paths) {
        if (nodes.length < 2) continue;
        const segmentCount = isClosed ? nodes.length : nodes.length - 1;
        const subsegments: Subsegment[] = [];

        for (let segIdx = 0; segIdx < segmentCount; segIdx++) {
            const A = nodes[segIdx];
            const B = nodes[(segIdx + 1) % nodes.length];
            const isCubic = Boolean(A.handleOut || B.handleIn);

            const P0 = { x: A.x, y: A.y };
            const P1 = A.handleOut ?? { x: A.x + (B.x - A.x) / 3, y: A.y + (B.y - A.y) / 3 };
            const P2 = B.handleIn ?? { x: A.x + (2 * (B.x - A.x)) / 3, y: A.y + (2 * (B.y - A.y)) / 3 };
            const P3 = { x: B.x, y: B.y };

            const sampleCount = isCubic ? 32 : 16;
            const erasedSamples: boolean[] = [];

            for (let m = 0; m <= sampleCount; m++) {
                const t = m / sampleCount;
                const pt = isCubic
                    ? evalCubicBezier(P0, P1, P2, P3, t)
                    : { x: (1 - t) * P0.x + t * P3.x, y: (1 - t) * P0.y + t * P3.y };
                const isErased = isPointInsideEraser(pt, eraser, effRadiusSq);
                erasedSamples.push(isErased);
                if (isErased) anyHit = true;
            }

            // Identify kept parameter intervals [t0, t1]
            let inRun = false;
            let t0 = 0;

            for (let m = 0; m <= sampleCount; m++) {
                const isErased = erasedSamples[m];
                if (!isErased) {
                    if (!inRun) {
                        inRun = true;
                        // Refine entry boundary with binary search
                        if (m > 0 && erasedSamples[m - 1]) {
                            let low = (m - 1) / sampleCount;
                            let high = m / sampleCount;
                            for (let k = 0; k < 5; k++) {
                                const mid = (low + high) / 2;
                                const pt = isCubic
                                    ? evalCubicBezier(P0, P1, P2, P3, mid)
                                    : { x: (1 - mid) * P0.x + mid * P3.x, y: (1 - mid) * P0.y + mid * P3.y };
                                if (isPointInsideEraser(pt, eraser, effRadiusSq)) low = mid;
                                else high = mid;
                            }
                            t0 = high;
                        } else {
                            t0 = 0;
                        }
                    }
                } else {
                    if (inRun) {
                        inRun = false;
                        // Refine exit boundary with binary search
                        let low = (m - 1) / sampleCount;
                        let high = m / sampleCount;
                        for (let k = 0; k < 5; k++) {
                            const mid = (low + high) / 2;
                            const pt = isCubic
                                ? evalCubicBezier(P0, P1, P2, P3, mid)
                                : { x: (1 - mid) * P0.x + mid * P3.x, y: (1 - mid) * P0.y + mid * P3.y };
                            if (isPointInsideEraser(pt, eraser, effRadiusSq)) high = mid;
                            else low = mid;
                        }
                        const t1 = low;

                        if (t1 - t0 > 1e-4) {
                            if (isCubic) {
                                const sub = extractCubicSubcurve(P0, P1, P2, P3, t0, t1);
                                subsegments.push({
                                    p0: sub.p0,
                                    p1: sub.p1,
                                    p2: sub.p2,
                                    p3: sub.p3,
                                    isCubic: true,
                                    startsAtNode: t0 <= 1e-4,
                                    endsAtNode: t1 >= 1 - 1e-4,
                                    segIdx,
                                });
                            } else {
                                subsegments.push({
                                    p0: { x: (1 - t0) * P0.x + t0 * P3.x, y: (1 - t0) * P0.y + t0 * P3.y },
                                    p3: { x: (1 - t1) * P0.x + t1 * P3.x, y: (1 - t1) * P0.y + t1 * P3.y },
                                    isCubic: false,
                                    startsAtNode: t0 <= 1e-4,
                                    endsAtNode: t1 >= 1 - 1e-4,
                                    segIdx,
                                });
                            }
                        }
                    }
                }
            }

            if (inRun) {
                const t1 = 1;
                if (t1 - t0 > 1e-4) {
                    if (isCubic) {
                        const sub = extractCubicSubcurve(P0, P1, P2, P3, t0, t1);
                        subsegments.push({
                            p0: sub.p0,
                            p1: sub.p1,
                            p2: sub.p2,
                            p3: sub.p3,
                            isCubic: true,
                            startsAtNode: t0 <= 1e-4,
                            endsAtNode: true,
                            segIdx,
                        });
                    } else {
                        subsegments.push({
                            p0: { x: (1 - t0) * P0.x + t0 * P3.x, y: (1 - t0) * P0.y + t0 * P3.y },
                            p3: { x: (1 - t1) * P0.x + t1 * P3.x, y: (1 - t1) * P0.y + t1 * P3.y },
                            isCubic: false,
                            startsAtNode: t0 <= 1e-4,
                            endsAtNode: true,
                            segIdx,
                        });
                    }
                }
            }
        }

        // Assemble continuous subsegment chains for this path
        const pathChains: Subsegment[][] = [];
        let currentChain: Subsegment[] = [];

        for (let s = 0; s < subsegments.length; s++) {
            const sub = subsegments[s];
            if (currentChain.length === 0) {
                currentChain.push(sub);
            } else {
                const prev = currentChain[currentChain.length - 1];
                const isContinuation = prev.endsAtNode && sub.startsAtNode && sub.segIdx === prev.segIdx + 1;
                if (isContinuation) {
                    currentChain.push(sub);
                } else {
                    pathChains.push(currentChain);
                    currentChain = [sub];
                }
            }
        }
        if (currentChain.length > 0) {
            pathChains.push(currentChain);
        }

        // For closed paths: check if last chain wraps around to first chain
        if (isClosed && pathChains.length > 1) {
            const firstChain = pathChains[0];
            const lastChain = pathChains[pathChains.length - 1];
            const lastSub = lastChain[lastChain.length - 1];
            const firstSub = firstChain[0];
            if (lastSub.endsAtNode && firstSub.startsAtNode && lastSub.segIdx === segmentCount - 1 && firstSub.segIdx === 0) {
                pathChains.pop();
                firstChain.unshift(...lastChain);
            }
        }

        for (const chain of pathChains) {
            allChains.push(chain);
        }
    }

    if (!anyHit) return null;
    if (allChains.length === 0) return []; // Entire shape erased

    // Convert all chains into ShapeElement fragments
    const toU = (x: number) => (x - contentLeft) / contentWidth;
    const toV = (y: number) => (y - blockTop) / contentWidth;
    const fragments: ShapeElement[] = [];

    for (let c = 0; c < allChains.length; c++) {
        const chain = allChains[c];
        if (chain.length === 0) continue;

        const pathNodes: ShapePathNode[] = [];

        // First node
        const first = chain[0];
        pathNodes.push({
            x: toU(first.p0.x),
            y: toV(first.p0.y),
            handleOut: first.isCubic && first.p1 ? { x: toU(first.p1.x), y: toV(first.p1.y) } : undefined,
            nodeKind: first.isCubic ? 'smooth' : 'sharp',
        });

        // Junction nodes
        for (let i = 0; i < chain.length - 1; i++) {
            const curr = chain[i];
            const next = chain[i + 1];
            const jx = toU(curr.p3.x);
            const jy = toV(curr.p3.y);
            const hIn = curr.isCubic && curr.p2 ? { x: toU(curr.p2.x), y: toV(curr.p2.y) } : undefined;
            const hOut = next.isCubic && next.p1 ? { x: toU(next.p1.x), y: toV(next.p1.y) } : undefined;
            pathNodes.push({
                x: jx,
                y: jy,
                handleIn: hIn,
                handleOut: hOut,
                nodeKind: (hIn || hOut) ? 'smooth' : 'sharp',
            });
        }

        // Final node
        const last = chain[chain.length - 1];
        pathNodes.push({
            x: toU(last.p3.x),
            y: toV(last.p3.y),
            handleIn: last.isCubic && last.p2 ? { x: toU(last.p2.x), y: toV(last.p2.y) } : undefined,
            nodeKind: last.isCubic ? 'smooth' : 'sharp',
        });

        // Drop tiny sub-pixel crumbs (< 3px arc length)
        let totalLenPx = 0;
        for (let i = 0; i < pathNodes.length - 1; i++) {
            const dx = (pathNodes[i + 1].x - pathNodes[i].x) * contentWidth;
            const dy = (pathNodes[i + 1].y - pathNodes[i].y) * contentWidth;
            totalLenPx += Math.hypot(dx, dy);
        }
        if (totalLenPx < 3) continue;

        const xs = pathNodes.map(n => n.x);
        const ys = pathNodes.map(n => n.y);
        const isLastChain = c === allChains.length - 1;

        const frag: ShapeElement = {
            ...shape,
            id: uuidGenerator(),
            shapeType: (shape.shapeType === 'arrow' && isLastChain) ? 'arrow' : 'line',
            startX: pathNodes[0].x,
            startY: pathNodes[0].y,
            endX: pathNodes[pathNodes.length - 1].x,
            endY: pathNodes[pathNodes.length - 1].y,
            pathNodes,
            fillEnabled: false, // Fill is strictly removed on cut
            style: {
                ...shape.style,
            },
            bounds: {
                minX: Math.min(...xs),
                maxX: Math.max(...xs),
                minY: Math.min(...ys),
                maxY: Math.max(...ys),
            },
        };
        delete frag.fillColor;
        delete frag.fillOpacity;
        delete frag.fillPattern;
        delete frag.fillDensity;
        delete frag.rotation;
        delete frag.cornerRadius;
        delete frag.controlPoint;
        delete frag.vertices;
        delete frag.shapeParams;
        delete frag.startBinding;
        delete frag.endBinding;

        fragments.push(frag);
    }

    return fragments;
}
