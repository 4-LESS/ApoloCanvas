import { Point, ShapeType } from '../core/types';

export interface RecognizedShape {
    type: ShapeType;
    start: Point;
    end: Point;
}

/** Recognizes deliberate straight and closed geometry after a stationary hold. */
export class ShapeRecognizer {
    constructor(private readonly dwellMs = 300, private readonly tolerance = 0.16) {}

    recognize(points: readonly Point[], releasedAt: number, lastMotionAt = points[points.length - 1]?.time ?? releasedAt): RecognizedShape | null {
        if (points.length < 3) return null;
        const first = points[0];
        const last = points[points.length - 1];
        if (releasedAt - lastMotionAt < this.dwellMs) return null;
        const box = bounds(points);
        const width = box.maxX - box.minX;
        const height = box.maxY - box.minY;
        if (width < 12 && height < 12) return null;
        const direct = distance(first, last);
        const pathLength = length(points);
        const straightness = pathLength > 0 ? direct / pathLength : 0;
        if (straightness > 0.94) return { type: 'line', start: first, end: last };
        if (direct < Math.max(width, height) * 0.22) {
            const ratio = Math.min(width, height) / Math.max(width, height);
            const pointsCount = simplifiedCornerCount(points, box);
            if (pointsCount <= 3) return { type: 'triangle', start: { x: box.minX, y: box.minY }, end: { x: box.maxX, y: box.maxY } };
            if (pointsCount <= 4 && ratio > 0.65) return { type: 'ellipse', start: { x: box.minX, y: box.minY }, end: { x: box.maxX, y: box.maxY } };
            if (pointsCount <= 4) return { type: 'rect', start: { x: box.minX, y: box.minY }, end: { x: box.maxX, y: box.maxY } };
        }
        if (straightness > 0.72 && points.length > 12) return { type: 'arrow', start: first, end: last };
        return null;
    }
}

function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function length(points: readonly Point[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
    return total;
}
function bounds(points: readonly Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = points[0].x; let maxX = minX; let minY = points[0].y; let maxY = minY;
    for (let i = 1; i < points.length; i++) {
        const point = points[i];
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    }
    return { minX, minY, maxX, maxY };
}
function simplifiedCornerCount(points: readonly Point[], box: { minX: number; minY: number; maxX: number; maxY: number }): number {
    const threshold = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.18;
    let corners = 0;
    let previousAngle = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const a = points[i - 1]; const b = points[i]; const c = points[i + 1];
        if (distance(a, b) < threshold * 0.3 || distance(b, c) < threshold * 0.3) continue;
        const angle = Math.atan2(c.y - b.y, c.x - b.x);
        let delta = Math.abs(angle - previousAngle);
        if (delta > Math.PI) delta = Math.PI * 2 - delta;
        if (corners === 0 || delta > Math.PI * 0.45) { corners++; previousAngle = angle; }
    }
    return corners;
}
