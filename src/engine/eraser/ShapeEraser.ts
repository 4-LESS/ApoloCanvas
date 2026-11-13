import type { Point, ShapeElement, ShapePathNode } from '../../core/types.ts';
import { getShapePlugin } from '../shapes/index.ts';
import { shapeElementToGeometry } from '../shapes/element.ts';
import { cubicPoint as evalCubicBezier, deCasteljau, getLinearPathNodes, rotatePoint } from '../shapes/handles.ts';
import { clampCornerRadius } from '../shapes/rectangle.ts';
import type { CustomPathSegment, ShapePoint } from '../shapes/types.ts';
import { distToSegmentSquared } from './StrokeEraser.ts';

export { evalCubicBezier, deCasteljau };

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

    if (shape.shapeType === 'rectangle') {
        const radius = clampCornerRadius(geom.cornerRadius ?? shape.cornerRadius, W, H);
        if (radius > 0.5) {
            const k = 0.55228475;
            const kr = k * radius;
            const rawNodes: ShapePathNode[] = [
                { x: minX + radius, y: minY, handleIn: { x: minX + radius - kr, y: minY }, nodeKind: 'smooth' },
                { x: maxX - radius, y: minY, handleOut: { x: maxX - radius + kr, y: minY }, nodeKind: 'smooth' },
                { x: maxX, y: minY + radius, handleIn: { x: maxX, y: minY + radius - kr }, nodeKind: 'smooth' },
                { x: maxX, y: maxY - radius, handleOut: { x: maxX, y: maxY - radius + kr }, nodeKind: 'smooth' },
                { x: maxX - radius, y: maxY, handleIn: { x: maxX - radius + kr, y: maxY }, nodeKind: 'smooth' },
                { x: minX + radius, y: maxY, handleOut: { x: minX + radius - kr, y: maxY }, nodeKind: 'smooth' },
                { x: minX, y: maxY - radius, handleIn: { x: minX, y: maxY - radius + kr }, nodeKind: 'smooth' },
                { x: minX, y: minY + radius, handleOut: { x: minX, y: minY + radius - kr }, nodeKind: 'smooth' },
            ];
            // Coalesce zero-length straight edges (pill/circular rounded rect when 2*r == width or height)
            const compact: ShapePathNode[] = [];
            for (const node of rawNodes) {
                const prev = compact[compact.length - 1];
                if (
                    prev
                    && !prev.handleOut
                    && !node.handleIn
                    && Math.hypot(node.x - prev.x, node.y - prev.y) < 1e-3
                ) {
                    prev.handleOut = node.handleOut;
                } else {
                    compact.push(node);
                }
            }
            const nodes = rot !== 0 ? compact.map(n => rotatePathNode(n, cx, cy, rot)) : compact;
            return [{ isClosed: true, nodes }];
        }

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
            ? rawNodes.map(n => rotatePathNode(n, cx, cy, rot))
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

    // Custom/plugin shapes exposing normalized subpaths (covers diamond, hexagon, cylinder, gates, electrical, etc.)
    const plugin = getShapePlugin(shape.shapeType);
    if (typeof plugin.getBoundarySubpaths === 'function') {
        const subpaths = plugin.getBoundarySubpaths(geom).filter(sp => sp.isStroked !== false);
        const pluginPaths: Array<{ isClosed: boolean; nodes: ShapePathNode[] }> = [];
        for (const sp of subpaths) {
            const defaultClosed = sp.isClosed !== false && plugin.isClosed !== false;
            pluginPaths.push(...customCommandsToBoundaryPaths(sp.commands, toWorld, defaultClosed));
        }
        if (pluginPaths.length > 0) {
            return pluginPaths;
        }
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

function rotatePathNode(n: ShapePathNode, cx: number, cy: number, rot: number): ShapePathNode {
    const pt = rotatePoint(n.x, n.y, cx, cy, rot);
    return {
        x: pt.x,
        y: pt.y,
        handleIn: n.handleIn ? rotatePoint(n.handleIn.x, n.handleIn.y, cx, cy, rot) : undefined,
        handleOut: n.handleOut ? rotatePoint(n.handleOut.x, n.handleOut.y, cx, cy, rot) : undefined,
        nodeKind: n.nodeKind,
    };
}

function customCommandsToBoundaryPaths(
    commands: CustomPathSegment[],
    toWorld: (u: number, v: number) => ShapePoint,
    defaultClosed: boolean,
): Array<{ isClosed: boolean; nodes: ShapePathNode[] }> {
    const out: Array<{ isClosed: boolean; nodes: ShapePathNode[] }> = [];
    let currentNodes: ShapePathNode[] = [];
    let currentClosed = false;
    let curU = 0;
    let curV = 0;
    let startU = 0;
    let startV = 0;

    const flushSubpath = () => {
        if (currentNodes.length >= 2) {
            if (currentClosed && currentNodes.length >= 3) {
                const first = currentNodes[0];
                const last = currentNodes[currentNodes.length - 1];
                if (Math.hypot(last.x - first.x, last.y - first.y) < 0.5) {
                    if (last.handleIn && !first.handleIn) {
                        first.handleIn = last.handleIn;
                        if (last.nodeKind === 'smooth') {
                            first.nodeKind = 'smooth';
                        }
                    }
                    currentNodes.pop();
                }
            }
            if (currentNodes.length >= 2) {
                out.push({ isClosed: currentClosed, nodes: currentNodes });
            }
        }
        currentNodes = [];
        currentClosed = false;
    };

    for (const cmd of commands) {
        switch (cmd.type) {
            case 'M':
                flushSubpath();
                curU = cmd.args[0];
                curV = cmd.args[1];
                startU = curU;
                startV = curV;
                currentNodes.push({ ...toWorld(curU, curV), nodeKind: 'sharp' });
                break;
            case 'L':
                curU = cmd.args[0];
                curV = cmd.args[1];
                currentNodes.push({ ...toWorld(curU, curV), nodeKind: 'sharp' });
                break;
            case 'C': {
                const [u1, v1, u2, v2, u3, v3] = cmd.args;
                if (currentNodes.length > 0) {
                    currentNodes[currentNodes.length - 1].handleOut = toWorld(u1, v1);
                }
                curU = u3;
                curV = v3;
                currentNodes.push({ ...toWorld(u3, v3), handleIn: toWorld(u2, v2), nodeKind: 'smooth' });
                break;
            }
            case 'Q': {
                const [uc, vc, u2, v2] = cmd.args;
                const c1u = curU + (2 / 3) * (uc - curU);
                const c1v = curV + (2 / 3) * (vc - curV);
                const c2u = u2 + (2 / 3) * (uc - u2);
                const c2v = v2 + (2 / 3) * (vc - v2);
                if (currentNodes.length > 0) {
                    currentNodes[currentNodes.length - 1].handleOut = toWorld(c1u, c1v);
                }
                curU = u2;
                curV = v2;
                currentNodes.push({ ...toWorld(u2, v2), handleIn: toWorld(c2u, c2v), nodeKind: 'smooth' });
                break;
            }
            case 'Z':
                currentClosed = true;
                curU = startU;
                curV = startV;
                flushSubpath();
                break;
        }
    }

    if (currentNodes.length >= 2) {
        currentClosed = currentClosed || defaultClosed;
        flushSubpath();
    }
    return out;
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

            const evalSegPoint = (t: number): ShapePoint =>
                isCubic
                    ? evalCubicBezier(P0, P1, P2, P3, t)
                    : { x: (1 - t) * P0.x + t * P3.x, y: (1 - t) * P0.y + t * P3.y };

            const refineBoundary = (low: number, high: number, entry: boolean): number => {
                for (let k = 0; k < 5; k++) {
                    const mid = (low + high) / 2;
                    const inside = isPointInsideEraser(evalSegPoint(mid), eraser, effRadiusSq);
                    if (entry ? inside : !inside) low = mid;
                    else high = mid;
                }
                return entry ? high : low;
            };

            const pushSubsegment = (startT: number, endT: number) => {
                if (endT - startT <= 1e-4) return;
                const base = { startsAtNode: startT <= 1e-4, endsAtNode: endT >= 1 - 1e-4, segIdx };
                if (isCubic) {
                    const sub = extractCubicSubcurve(P0, P1, P2, P3, startT, endT);
                    subsegments.push({ p0: sub.p0, p1: sub.p1, p2: sub.p2, p3: sub.p3, isCubic: true, ...base });
                } else {
                    subsegments.push({ p0: evalSegPoint(startT), p3: evalSegPoint(endT), isCubic: false, ...base });
                }
            };

            for (let m = 0; m <= sampleCount; m++) {
                const isErased = isPointInsideEraser(evalSegPoint(m / sampleCount), eraser, effRadiusSq);
                erasedSamples.push(isErased);
                if (isErased) anyHit = true;
            }

            // Identify kept parameter intervals [t0, t1]
            let inRun = false;
            let t0 = 0;

            for (let m = 0; m <= sampleCount; m++) {
                if (!erasedSamples[m]) {
                    if (!inRun) {
                        inRun = true;
                        t0 = m > 0 && erasedSamples[m - 1]
                            ? refineBoundary((m - 1) / sampleCount, m / sampleCount, true)
                            : 0;
                    }
                } else if (inRun) {
                    inRun = false;
                    pushSubsegment(t0, refineBoundary((m - 1) / sampleCount, m / sampleCount, false));
                }
            }

            if (inRun) {
                pushSubsegment(t0, 1);
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
