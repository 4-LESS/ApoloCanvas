/**
 * src/engine/shapes/guides.ts
 *
 * Smart alignment snap guides: computes live alignment guides (min, center, max)
 * on X and Y axes between the dragged shape/selection and other shapes on the canvas,
 * and Fusion 360-style point/height alignment guides for lines, vertices, and transformations.
 */

import type { ShapeRenderGeometry } from './types.ts';
import { rotatePoint } from './handles.ts';

export interface AlignmentGuide {
    axis: 'x' | 'y';
    /** Position in document coordinates where the guide line lies */
    position: number;
    /** Start coordinate along the perpendicular axis */
    from: number;
    /** End coordinate along the perpendicular axis */
    to: number;
    /** Optional reference point where the alignment originates */
    refPoint?: { x: number; y: number };
}

export interface SnapTargetBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface SmartGuideResult {
    deltaX: number;
    deltaY: number;
    guides: AlignmentGuide[];
}

export interface ReferencePoint {
    x: number;
    y: number;
}

export interface PointAlignmentResult {
    snappedPoint: { x: number; y: number };
    deltaX: number;
    deltaY: number;
    guides: AlignmentGuide[];
}

/**
 * Computes smart alignment guides and snap offsets between bounding boxes.
 *
 * @param activeBounds Bounding box of the element(s) currently being moved/dragged
 * @param otherBounds Array of bounding boxes of static shapes on the canvas
 * @param toleranceDoc Snap distance threshold in document coordinates (typically 5 / zoom)
 */
export function computeSmartAlignmentGuides(
    activeBounds: SnapTargetBounds,
    otherBounds: readonly SnapTargetBounds[],
    toleranceDoc: number,
): SmartGuideResult {
    let deltaX = 0;
    let deltaY = 0;
    let bestDistX = toleranceDoc + 0.0001;
    let bestDistY = toleranceDoc + 0.0001;
    const guides: AlignmentGuide[] = [];

    const activeCenterX = (activeBounds.minX + activeBounds.maxX) / 2;
    const activeCenterY = (activeBounds.minY + activeBounds.maxY) / 2;

    const activeXPoints = [activeBounds.minX, activeCenterX, activeBounds.maxX];
    const activeYPoints = [activeBounds.minY, activeCenterY, activeBounds.maxY];

    let snapMatchX: { pos: number; fromY: number; toY: number } | null = null;
    let snapMatchY: { pos: number; fromX: number; toX: number } | null = null;

    for (const ob of otherBounds) {
        const obCenterX = (ob.minX + ob.maxX) / 2;
        const obCenterY = (ob.minY + ob.maxY) / 2;
        const obXPoints = [ob.minX, obCenterX, ob.maxX];
        const obYPoints = [ob.minY, obCenterY, ob.maxY];

        // Check X alignments
        for (const ax of activeXPoints) {
            for (const ox of obXPoints) {
                const diff = ox - ax;
                if (Math.abs(diff) <= toleranceDoc && Math.abs(diff) < bestDistX) {
                    bestDistX = Math.abs(diff);
                    deltaX = diff;
                    snapMatchX = {
                        pos: ox,
                        fromY: Math.min(activeBounds.minY, ob.minY) - 15,
                        toY: Math.max(activeBounds.maxY, ob.maxY) + 15,
                    };
                }
            }
        }

        // Check Y alignments
        for (const ay of activeYPoints) {
            for (const oy of obYPoints) {
                const diff = oy - ay;
                if (Math.abs(diff) <= toleranceDoc && Math.abs(diff) < bestDistY) {
                    bestDistY = Math.abs(diff);
                    deltaY = diff;
                    snapMatchY = {
                        pos: oy,
                        fromX: Math.min(activeBounds.minX, ob.minX) - 15,
                        toX: Math.max(activeBounds.maxX, ob.maxX) + 15,
                    };
                }
            }
        }
    }

    if (snapMatchX) {
        guides.push({
            axis: 'x',
            position: snapMatchX.pos,
            from: snapMatchX.fromY,
            to: snapMatchX.toY,
        });
    }
    if (snapMatchY) {
        guides.push({
            axis: 'y',
            position: snapMatchY.pos,
            from: snapMatchY.fromX,
            to: snapMatchY.toX,
        });
    }

    return {
        deltaX,
        deltaY,
        guides,
    };
}

/**
 * Computes Fusion 360-style CAD alignment guides for a single point (such as an endpoint,
 * vertex, or transform handle) against reference points from other elements.
 * Aligns horizontally ("a la altura") to refPoint.y, and vertically to refPoint.x.
 */
export function computePointAlignmentGuides(
    point: { x: number; y: number },
    referencePoints: readonly ReferencePoint[],
    toleranceDoc: number,
    extensionMargin = 40,
): PointAlignmentResult {
    let deltaX = 0;
    let deltaY = 0;
    let bestDistX = toleranceDoc + 0.0001;
    let bestDistY = toleranceDoc + 0.0001;
    const guides: AlignmentGuide[] = [];

    let matchX: { pos: number; fromY: number; toY: number; ref: ReferencePoint } | null = null;
    let matchY: { pos: number; fromX: number; toX: number; ref: ReferencePoint } | null = null;

    for (const ref of referencePoints) {
        // Horizontal alignment: "a la altura" (same Y coordinate)
        const diffY = ref.y - point.y;
        if (Math.abs(diffY) <= toleranceDoc && Math.abs(diffY) < bestDistY) {
            bestDistY = Math.abs(diffY);
            deltaY = diffY;
            matchY = {
                pos: ref.y,
                fromX: Math.min(point.x, ref.x) - extensionMargin,
                toX: Math.max(point.x, ref.x) + extensionMargin,
                ref,
            };
        }

        // Vertical alignment: same X coordinate
        const diffX = ref.x - point.x;
        if (Math.abs(diffX) <= toleranceDoc && Math.abs(diffX) < bestDistX) {
            bestDistX = Math.abs(diffX);
            deltaX = diffX;
            matchX = {
                pos: ref.x,
                fromY: Math.min(point.y, ref.y) - extensionMargin,
                toY: Math.max(point.y, ref.y) + extensionMargin,
                ref,
            };
        }
    }

    if (matchX) {
        guides.push({
            axis: 'x',
            position: matchX.pos,
            from: matchX.fromY,
            to: matchX.toY,
            refPoint: matchX.ref,
        });
    }
    if (matchY) {
        guides.push({
            axis: 'y',
            position: matchY.pos,
            from: matchY.fromX,
            to: matchY.toX,
            refPoint: matchY.ref,
        });
    }

    return {
        snappedPoint: { x: point.x + deltaX, y: point.y + deltaY },
        deltaX,
        deltaY,
        guides,
    };
}

/**
 * Extracts key alignment reference points from a shape's document geometry.
 * Correctly accounts for rotation, linear nodes, and polygon vertices.
 */
export function getShapeKeyPoints(geom: ShapeRenderGeometry): ReferencePoint[] {
    const points: ReferencePoint[] = [];
    const minX = Math.min(geom.x0, geom.x1);
    const maxX = Math.max(geom.x0, geom.x1);
    const minY = Math.min(geom.y0, geom.y1);
    const maxY = Math.max(geom.y0, geom.y1);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rot = geom.rotation ?? 0;

    // Linear shapes: line & arrow with pathNodes
    if (geom.pathNodes && geom.pathNodes.length > 0) {
        for (const n of geom.pathNodes) {
            points.push({ x: n.x, y: n.y });
        }
        return points;
    }

    // Polygon shapes with independent vertices (e.g. triangle)
    if (geom.vertices && geom.vertices.length > 0) {
        for (const v of geom.vertices) {
            points.push(rot !== 0 ? rotatePoint(v.x, v.y, cx, cy, rot) : { x: v.x, y: v.y });
        }
        points.push({ x: cx, y: cy });
        return points;
    }

    // Default box-based shapes (rectangle, ellipse, diamond, hexagon, cylinder, simple 2-node line)
    const corners = [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
        { x: cx, y: cy },
        { x: cx, y: minY },
        { x: cx, y: maxY },
        { x: minX, y: cy },
        { x: maxX, y: cy },
    ];

    for (const p of corners) {
        points.push(rot !== 0 ? rotatePoint(p.x, p.y, cx, cy, rot) : p);
    }

    return points;
}
