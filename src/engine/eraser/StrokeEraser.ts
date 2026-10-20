import type { BoundingBox, CanvasElement, Point, ShapeElement, StrokeElement } from '../../core/types.ts';

/**
 * Calculates squared distance from a point to a 2D line segment.
 */
export function distToSegmentSquared(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
        const ex = px - x1;
        const ey = py - y1;
        return ex * ex + ey * ey;
    }
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const ex = px - projX;
    const ey = py - projY;
    return ex * ex + ey * ey;
}

/**
 * Checks whether two 2D line segments intersect.
 */
function segmentsIntersect(
    x1: number, y1: number, x2: number, y2: number,
    x3: number, y3: number, x4: number, y4: number,
): boolean {
    const ccw = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
        (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);
    return (
        ccw(x1, y1, x3, y3, x4, y4) !== ccw(x2, y2, x3, y3, x4, y4) &&
        ccw(x1, y1, x2, y2, x3, y3) !== ccw(x1, y1, x2, y2, x4, y4)
    );
}

/**
 * Calculates minimum squared distance between two 2D line segments.
 */
export function minDistanceBetweenSegmentsSquared(
    x1: number, y1: number, x2: number, y2: number,
    x3: number, y3: number, x4: number, y4: number,
): number {
    if (segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4)) {
        return 0;
    }
    const d1 = distToSegmentSquared(x1, y1, x3, y3, x4, y4);
    const d2 = distToSegmentSquared(x2, y2, x3, y3, x4, y4);
    const d3 = distToSegmentSquared(x3, y3, x1, y1, x2, y2);
    const d4 = distToSegmentSquared(x4, y4, x1, y1, x2, y2);
    return Math.min(d1, d2, d3, d4);
}

/**
 * Determines whether an eraser path collides with a StrokeElement.
 * Highly robust: tests segment-to-segment distance so rapid swipes and taps
 * never miss strokes.
 */
export function strokeHitDoc(
    stroke: StrokeElement,
    eraser: Point[],
    radius: number,
    contentLeft: number,
    contentWidth: number,
    blockTop: number,
): boolean {
    if (eraser.length === 0 || stroke.points.length < 4) return false;

    const effectiveRadius = radius + (stroke.style.width || 2) / 2;
    const effectiveRadiusSq = effectiveRadius * effectiveRadius;

    // Fast bounding box rejection check
    let eMinX = eraser[0].x;
    let eMaxX = eraser[0].x;
    let eMinY = eraser[0].y;
    let eMaxY = eraser[0].y;
    for (let i = 1; i < eraser.length; i++) {
        const ep = eraser[i];
        if (ep.x < eMinX) eMinX = ep.x;
        if (ep.x > eMaxX) eMaxX = ep.x;
        if (ep.y < eMinY) eMinY = ep.y;
        if (ep.y > eMaxY) eMaxY = ep.y;
    }

    const sMinX = contentLeft + stroke.bounds.minX * contentWidth;
    const sMaxX = contentLeft + stroke.bounds.maxX * contentWidth;
    const sMinY = blockTop + stroke.bounds.minY * contentWidth;
    const sMaxY = blockTop + stroke.bounds.maxY * contentWidth;

    if (
        eMaxX + effectiveRadius < sMinX ||
        eMinX - effectiveRadius > sMaxX ||
        eMaxY + effectiveRadius < sMinY ||
        eMinY - effectiveRadius > sMaxY
    ) {
        return false;
    }

    const pts = stroke.points;
    const numStrokePoints = pts.length / 4;

    // If single point stroke (dot/period)
    if (numStrokePoints === 1) {
        const sx = contentLeft + pts[0] * contentWidth;
        const sy = blockTop + pts[1] * contentWidth;
        for (let j = 0; j < eraser.length; j++) {
            const ep = eraser[j];
            if (j === 0) {
                const dx = sx - ep.x;
                const dy = sy - ep.y;
                if (dx * dx + dy * dy <= effectiveRadiusSq) return true;
            } else {
                const prev = eraser[j - 1];
                if (distToSegmentSquared(sx, sy, prev.x, prev.y, ep.x, ep.y) <= effectiveRadiusSq) {
                    return true;
                }
            }
        }
        return false;
    }

    // Polyline stroke: test each stroke segment against eraser points & segments
    for (let i = 1; i < numStrokePoints; i++) {
        const off0 = (i - 1) * 4;
        const off1 = i * 4;
        const sx0 = contentLeft + pts[off0] * contentWidth;
        const sy0 = blockTop + pts[off0 + 1] * contentWidth;
        const sx1 = contentLeft + pts[off1] * contentWidth;
        const sy1 = blockTop + pts[off1 + 1] * contentWidth;

        for (let j = 0; j < eraser.length; j++) {
            const ep = eraser[j];
            // Point to stroke segment
            if (distToSegmentSquared(ep.x, ep.y, sx0, sy0, sx1, sy1) <= effectiveRadiusSq) {
                return true;
            }

            // Eraser segment to stroke segment
            if (j > 0) {
                const prev = eraser[j - 1];
                if (minDistanceBetweenSegmentsSquared(sx0, sy0, sx1, sy1, prev.x, prev.y, ep.x, ep.y) <= effectiveRadiusSq) {
                    return true;
                }
            }
        }
    }

    return false;
}

/**
 * Determines whether an eraser path collides with a ShapeElement.
 */
export function shapeHitDoc(
    shape: ShapeElement,
    eraser: Point[],
    radius: number,
    contentLeft: number,
    contentWidth: number,
    blockTop: number,
): boolean {
    if (eraser.length === 0) return false;

    const startX = contentLeft + shape.startX * contentWidth;
    const startY = blockTop + shape.startY * contentWidth;
    const endX = contentLeft + shape.endX * contentWidth;
    const endY = blockTop + shape.endY * contentWidth;

    const effectiveRadius = radius + (shape.style.width || 2) / 2;
    const effectiveRadiusSq = effectiveRadius * effectiveRadius;

    // Line and arrow: test against the central line segment
    if (shape.shapeType === 'line' || shape.shapeType === 'arrow') {
        for (let j = 0; j < eraser.length; j++) {
            const ep = eraser[j];
            if (distToSegmentSquared(ep.x, ep.y, startX, startY, endX, endY) <= effectiveRadiusSq) {
                return true;
            }
            if (j > 0) {
                const prev = eraser[j - 1];
                if (minDistanceBetweenSegmentsSquared(startX, startY, endX, endY, prev.x, prev.y, ep.x, ep.y) <= effectiveRadiusSq) {
                    return true;
                }
            }
        }
        return false;
    }

    // Rect, Ellipse, Triangle: test perimeter segments and inside bounds
    const rxMin = Math.min(startX, endX);
    const rxMax = Math.max(startX, endX);
    const ryMin = Math.min(startY, endY);
    const ryMax = Math.max(startY, endY);

    for (let j = 0; j < eraser.length; j++) {
        const ep = eraser[j];
        if (ep.x >= rxMin - effectiveRadius && ep.x <= rxMax + effectiveRadius &&
            ep.y >= ryMin - effectiveRadius && ep.y <= ryMax + effectiveRadius) {
            return true;
        }
    }

    return false;
}

/**
 * Splits a stroke element into sub-stroke fragments around eraser intersection boundaries.
 * Used for Reticle / path-splitting mode.
 */
export function splitStrokeDoc(
    stroke: StrokeElement,
    eraser: Point[],
    radius: number,
    contentLeft: number,
    contentWidth: number,
    blockTop: number,
    uuidGenerator: () => string,
): StrokeElement[] | null {
    let hit = false;
    let part: number[] = [];
    const fragments: StrokeElement[] = [];

    const flush = (): void => {
        if (part.length >= 8) {
            let minU = Number.POSITIVE_INFINITY;
            let maxU = Number.NEGATIVE_INFINITY;
            let minV = Number.POSITIVE_INFINITY;
            let maxV = Number.NEGATIVE_INFINITY;
            for (let i = 0; i < part.length; i += 4) {
                const u = part[i];
                const v = part[i + 1];
                if (u < minU) minU = u;
                if (u > maxU) maxU = u;
                if (v < minV) minV = v;
                if (v > maxV) maxV = v;
            }
            fragments.push({
                ...stroke,
                id: uuidGenerator(),
                points: part,
                zIndex: stroke.zIndex,
                bounds: { minX: minU, maxX: maxU, minY: minV, maxY: maxV },
            });
        }
        part = [];
    };

    for (let i = 0; i < stroke.points.length; i += 4) {
        const u = stroke.points[i];
        const v = stroke.points[i + 1];
        const p = stroke.points[i + 2];
        const t = stroke.points[i + 3];
        const x = contentLeft + u * contentWidth;
        const y = blockTop + v * contentWidth;

        let pointErased = false;
        for (let j = 0; j < eraser.length; j++) {
            const ep = eraser[j];
            if (j === 0) {
                const dx = x - ep.x;
                const dy = y - ep.y;
                if (dx * dx + dy * dy <= radius * radius) {
                    pointErased = true;
                    break;
                }
            } else {
                const prev = eraser[j - 1];
                if (distToSegmentSquared(x, y, prev.x, prev.y, ep.x, ep.y) <= radius * radius) {
                    pointErased = true;
                    break;
                }
            }
        }

        if (pointErased) {
            hit = true;
            flush();
        } else {
            part.push(u, v, p, t);
        }
    }

    if (hit) {
        flush();
        return fragments;
    }
    return null;
}
