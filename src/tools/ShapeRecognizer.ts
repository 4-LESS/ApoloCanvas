import type { Point, ShapeType } from '../core/types.ts';

/**
 * Freehand shape recognition ("hold-to-snap").
 *
 * Pure geometric heuristics, no ML/OCR dependency:
 *  - open strokes: straightness ratio D / L + perpendicular deviation (line), or a long straight
 *    shaft ending in a short sharp V / hook reversal (arrow);
 *  - closed strokes: Ramer–Douglas–Peucker corner extraction (triangle / rectangle / diamond)
 *    and the normalized radial RMSE against the bounding ellipse (ellipse).
 * Recognized geometry is regularized: near-square rectangles / near-circular ellipses snap to 1:1
 * and near-cardinal / diagonal lines snap to exact 0° / 45° / 90° / 135° / 180°.
 */

export interface RecognizedShape {
    type: ShapeType;
    start: Point;
    end: Point;
    /** 0..1; shapes below MIN_RECOGNITION_CONFIDENCE are never returned. */
    confidence: number;
    /** True when the aspect ratio was snapped to an exact square / circle. */
    regularize: boolean;
    /** Free (non-isosceles) triangles keep their drawn vertices. */
    vertices?: Point[];
}

export const HOLD_TO_SNAP_DWELL_MS = 360;
export const HOLD_TO_SNAP_MOVE_TOLERANCE_PX = 4;
export const MIN_RECOGNITION_CONFIDENCE = 0.72;

const MIN_SHAPE_SIZE = 12;
const LINE_MIN_STRAIGHTNESS = 0.88;
const CLOSED_GAP_MIN = 24;
const CLOSED_GAP_PERIMETER_RATIO = 0.18;
const RECT_ANGLE_TOLERANCE_DEG = 28;
const DIAMOND_ANGLE_TOLERANCE_DEG = 18;
const ELLIPSE_MAX_RMSE = 0.16;
const SQUARE_ASPECT_TOLERANCE = 0.14;
const ANGLE_SNAP_TOLERANCE_DEG = 6;
/** Interior angles above this are considered "straight" and dropped from the RDP corner list. */
const STRAIGHT_VERTEX_DEG = 155;

export class ShapeRecognizer {
    private readonly dwellMs: number;
    private readonly minConfidence: number;

    constructor(dwellMs = HOLD_TO_SNAP_DWELL_MS, minConfidence = MIN_RECOGNITION_CONFIDENCE) {
        this.dwellMs = dwellMs;
        this.minConfidence = minConfidence;
    }

    /**
     * Release-time recognition: only fires when the stylus rested at the end of the stroke
     * for at least the dwell time (releasedAt - lastMotionAt >= dwellMs).
     */
    recognize(points: readonly Point[], releasedAt: number, lastMotionAt = points[points.length - 1]?.time ?? releasedAt): RecognizedShape | null {
        if (releasedAt - lastMotionAt < this.dwellMs) return null;
        return this.classify(points);
    }

    /** Classifies a freehand stroke regardless of timing (used by the live dwell timer). */
    classify(rawPoints: readonly Point[]): RecognizedShape | null {
        const points = dedupe(rawPoints);
        if (points.length < 3) return null;
        const box = bounds(points);
        const width = box.maxX - box.minX;
        const height = box.maxY - box.minY;
        if (Math.max(width, height) < MIN_SHAPE_SIZE) return null;

        const first = points[0];
        const last = points[points.length - 1];
        const pathLength = length(points);
        if (pathLength <= 0) return null;
        const gap = distance(first, last);

        const candidates: RecognizedShape[] = [];
        const isClosed = gap <= Math.max(CLOSED_GAP_MIN, CLOSED_GAP_PERIMETER_RATIO * pathLength);

        if (isClosed) {
            const closedShape = classifyClosed(points, box, gap, pathLength);
            if (closedShape) candidates.push(closedShape);
        } else {
            // A confident arrow wins over the line reading of the same stroke (its head would
            // otherwise only count as a small deviation from the chord)
            const arrow = classifyArrow(points, box);
            if (arrow && arrow.confidence >= this.minConfidence) return arrow;
            const line = classifyLine(points, first, last, pathLength);
            if (line) candidates.push(line);
        }

        let best: RecognizedShape | null = null;
        for (const candidate of candidates) {
            if (candidate.confidence >= this.minConfidence && (!best || candidate.confidence > best.confidence)) {
                best = candidate;
            }
        }
        return best;
    }
}

// ---------------------------------------------------------------------------
// Open strokes
// ---------------------------------------------------------------------------

function classifyLine(points: Point[], first: Point, last: Point, pathLength: number): RecognizedShape | null {
    const chord = distance(first, last);
    if (chord < MIN_SHAPE_SIZE) return null;
    const straightness = chord / pathLength;
    if (straightness < LINE_MIN_STRAIGHTNESS) return null;

    let maxDeviation = 0;
    for (const p of points) {
        maxDeviation = Math.max(maxDeviation, perpendicularDistance(p, first, last));
    }
    const allowedDeviation = Math.max(4, chord * 0.06);
    if (maxDeviation > allowedDeviation * 1.5) return null;

    const straightScore = (straightness - LINE_MIN_STRAIGHTNESS) / (1 - LINE_MIN_STRAIGHTNESS);
    const deviationPenalty = Math.min(1, maxDeviation / (allowedDeviation * 1.5));
    const confidence = clamp01(0.72 + 0.28 * straightScore - 0.12 * deviationPenalty);
    return {
        type: 'line',
        start: { x: first.x, y: first.y },
        end: snapAngle(first, last),
        confidence,
        regularize: false,
    };
}

/**
 * Single-stroke arrow: a dominant straight shaft (first RDP segment) followed by a short head
 * whose first turn is a sharp reversal (> 110°) and that stays close to the tip.
 */
function classifyArrow(points: Point[], box: Box): RecognizedShape | null {
    const diag = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
    const simplified = rdp(points, Math.max(3, diag * 0.04));
    if (simplified.length < 3) return null;

    const tail = simplified[0];
    const tip = simplified[1];
    const shaft = distance(tail, tip);
    if (shaft < MIN_SHAPE_SIZE * 2) return null;

    let headLength = 0;
    let headReach = 0;
    for (let i = 2; i < simplified.length; i++) {
        headLength += distance(simplified[i - 1], simplified[i]);
        headReach = Math.max(headReach, distance(tip, simplified[i]));
        if (distance(simplified[i - 1], simplified[i]) > shaft * 0.5) return null;
    }
    const total = shaft + headLength;
    if (shaft / total < 0.55) return null;
    if (headLength < Math.max(8, shaft * 0.08)) return null;
    if (headReach > shaft * 0.45) return null;

    const shaftDir = Math.atan2(tip.y - tail.y, tip.x - tail.x);
    const barb = simplified[2];
    const barbDir = Math.atan2(barb.y - tip.y, barb.x - tip.x);
    const turn = Math.abs(normalizeAngle(barbDir - shaftDir)) * 180 / Math.PI;
    if (turn < 110) return null;

    const shaftScore = Math.min(1, (shaft / total - 0.55) / 0.3);
    const turnScore = Math.min(1, (turn - 110) / 40);
    return {
        type: 'arrow',
        start: { x: tail.x, y: tail.y },
        end: snapAngle(tail, tip),
        confidence: clamp01(0.74 + 0.13 * shaftScore + 0.13 * turnScore),
        regularize: false,
    };
}

// ---------------------------------------------------------------------------
// Closed strokes
// ---------------------------------------------------------------------------

function classifyClosed(points: Point[], box: Box, gap: number, pathLength: number): RecognizedShape | null {
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    if (Math.min(width, height) < MIN_SHAPE_SIZE * 0.5) return null;

    const corners = closedCorners(points, box);
    const ellipseRmse = radialRmse(points, box);
    const closureScore = 1 - Math.min(1, gap / Math.max(CLOSED_GAP_MIN, CLOSED_GAP_PERIMETER_RATIO * pathLength));

    if (corners.length === 3) {
        const perimeter = length([...corners, corners[0]]);
        const shortest = Math.min(distance(corners[0], corners[1]), distance(corners[1], corners[2]), distance(corners[2], corners[0]));
        if (shortest >= perimeter * 0.12) {
            return buildTriangle(corners, box, 0.8 + 0.2 * closureScore);
        }
    }

    if (corners.length === 4) {
        const diamondDev = diamondDeviation(corners, box);
        if (diamondDev <= DIAMOND_ANGLE_TOLERANCE_DEG) {
            return buildBoxShape('diamond', box, 1 - 0.28 * (diamondDev / DIAMOND_ANGLE_TOLERANCE_DEG));
        }
        const angleDev = maxRightAngleDeviation(corners);
        if (angleDev <= RECT_ANGLE_TOLERANCE_DEG && ellipseRmse > 0.08) {
            return buildBoxShape('rectangle', box, 1 - 0.28 * (angleDev / RECT_ANGLE_TOLERANCE_DEG));
        }
    }

    const hasSharpCorner = corners.length <= 4 && corners.some((_, i) => interiorAngleDeg(corners, i) < 120);
    if (ellipseRmse <= ELLIPSE_MAX_RMSE && !hasSharpCorner) {
        return buildBoxShape('ellipse', box, 1 - 0.28 * (ellipseRmse / ELLIPSE_MAX_RMSE));
    }
    return null;
}

function buildBoxShape(type: ShapeType, box: Box, confidence: number): RecognizedShape {
    let { minX, minY, maxX, maxY } = box;
    const w = maxX - minX;
    const h = maxY - minY;
    const regularize = Math.abs(w - h) / Math.max(w, h) <= SQUARE_ASPECT_TOLERANCE;
    if (regularize) {
        const s = (w + h) / 2;
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        minX = cx - s / 2;
        maxX = cx + s / 2;
        minY = cy - s / 2;
        maxY = cy + s / 2;
    }
    return {
        type,
        start: { x: minX, y: minY },
        end: { x: maxX, y: maxY },
        confidence: clamp01(confidence),
        regularize,
    };
}

/** Upright isosceles triangles map onto the bounding-box form; any other triangle keeps its vertices. */
function buildTriangle(corners: Point[], box: Box, confidence: number): RecognizedShape {
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    const tolX = w * 0.12;
    const tolY = h * 0.12;
    const sorted = [...corners].sort((a, b) => a.y - b.y);
    const apex = sorted[0];
    const base = sorted.slice(1).sort((a, b) => a.x - b.x);
    const isUpright = Math.abs(apex.x - (box.minX + w / 2)) <= tolX &&
        Math.abs(apex.y - box.minY) <= tolY &&
        Math.abs(base[0].x - box.minX) <= tolX && Math.abs(base[0].y - box.maxY) <= tolY &&
        Math.abs(base[1].x - box.maxX) <= tolX && Math.abs(base[1].y - box.maxY) <= tolY;

    const result: RecognizedShape = {
        type: 'triangle',
        start: { x: box.minX, y: box.minY },
        end: { x: box.maxX, y: box.maxY },
        confidence: clamp01(confidence),
        regularize: false,
    };
    if (!isUpright) {
        // Same vertex order as the plugin: [top, right, left]
        result.vertices = [apex, base[1], base[0]].map(p => ({ x: p.x, y: p.y }));
    }
    return result;
}

/** RDP corners of a closed stroke, starting from the point farthest from the first sample. */
function closedCorners(points: Point[], box: Box): Point[] {
    const diag = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
    const epsilon = Math.max(4, diag * 0.06);
    let farIdx = 0;
    let farDist = -1;
    for (let i = 0; i < points.length; i++) {
        const d = distance(points[0], points[i]);
        if (d > farDist) {
            farDist = d;
            farIdx = i;
        }
    }
    const firstHalf = rdp(points.slice(0, farIdx + 1), epsilon);
    const secondHalf = rdp([...points.slice(farIdx), points[0]], epsilon);
    let corners = [...firstHalf.slice(0, -1), ...secondHalf.slice(0, -1)];

    // Drop near-straight vertices (e.g. the arbitrary start point in the middle of an edge)
    let changed = true;
    while (changed && corners.length > 3) {
        changed = false;
        for (let i = 0; i < corners.length; i++) {
            if (interiorAngleDeg(corners, i) > STRAIGHT_VERTEX_DEG) {
                corners = corners.filter((_, j) => j !== i);
                changed = true;
                break;
            }
        }
    }
    // Merge corners closer than the RDP tolerance
    const merged: Point[] = [];
    for (const c of corners) {
        if (merged.length === 0 || distance(merged[merged.length - 1], c) > epsilon) merged.push(c);
    }
    if (merged.length > 1 && distance(merged[0], merged[merged.length - 1]) <= epsilon) merged.pop();
    return merged;
}

function radialRmse(points: Point[], box: Box): number {
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const a = Math.max(1e-6, (box.maxX - box.minX) / 2);
    const b = Math.max(1e-6, (box.maxY - box.minY) / 2);
    let sum = 0;
    for (const p of points) {
        const r = Math.hypot((p.x - cx) / a, (p.y - cy) / b);
        sum += (r - 1) ** 2;
    }
    return Math.sqrt(sum / points.length);
}

function maxRightAngleDeviation(corners: Point[]): number {
    let worst = 0;
    for (let i = 0; i < corners.length; i++) {
        worst = Math.max(worst, Math.abs(interiorAngleDeg(corners, i) - 90));
    }
    return worst;
}

/** Largest angular offset (degrees) between each vertex (seen from the box center) and its nearest cardinal direction. */
function diamondDeviation(corners: Point[], box: Box): number {
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const w = Math.max(1e-6, box.maxX - box.minX);
    const h = Math.max(1e-6, box.maxY - box.minY);
    const used = new Set<number>();
    let worst = 0;
    for (const c of corners) {
        // Normalize by the box so tall / wide diamonds are judged like square ones
        const angle = Math.atan2((c.y - cy) / h, (c.x - cx) / w) * 180 / Math.PI;
        const cardinal = Math.round(angle / 90);
        const slot = ((cardinal % 4) + 4) % 4;
        if (used.has(slot)) return Number.POSITIVE_INFINITY;
        used.add(slot);
        worst = Math.max(worst, Math.abs(angle - cardinal * 90));
    }
    return worst;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

interface Box { minX: number; minY: number; maxX: number; maxY: number }

function snapAngle(origin: Point, point: Point): Point {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const r = Math.hypot(dx, dy);
    if (r < 1e-6) return { x: point.x, y: point.y };
    const deg = Math.atan2(dy, dx) * 180 / Math.PI;
    const snapped = Math.round(deg / 45) * 45;
    if (Math.abs(deg - snapped) > ANGLE_SNAP_TOLERANCE_DEG) return { x: point.x, y: point.y };
    const rad = snapped * Math.PI / 180;
    return { x: origin.x + r * Math.cos(rad), y: origin.y + r * Math.sin(rad) };
}

/** Interior angle (degrees) at vertex i of a closed polygon. */
function interiorAngleDeg(poly: Point[], i: number): number {
    const prev = poly[(i - 1 + poly.length) % poly.length];
    const cur = poly[i];
    const next = poly[(i + 1) % poly.length];
    const a1 = Math.atan2(prev.y - cur.y, prev.x - cur.x);
    const a2 = Math.atan2(next.y - cur.y, next.x - cur.x);
    return Math.abs(normalizeAngle(a1 - a2)) * 180 / Math.PI;
}

function normalizeAngle(rad: number): number {
    let a = rad;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

function rdp(points: Point[], epsilon: number): Point[] {
    if (points.length < 3) return points.slice();
    const first = points[0];
    const last = points[points.length - 1];
    let index = -1;
    let maxDist = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const d = perpendicularDistance(points[i], first, last);
        if (d > maxDist) {
            maxDist = d;
            index = i;
        }
    }
    if (maxDist <= epsilon || index < 0) return [first, last];
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return distance(p, a);
    return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

function dedupe(points: readonly Point[]): Point[] {
    const out: Point[] = [];
    for (const p of points) {
        if (out.length === 0 || distance(out[out.length - 1], p) >= 1) out.push(p);
    }
    return out;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }

function length(points: readonly Point[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
    return total;
}

function bounds(points: readonly Point[]): Box {
    let minX = points[0].x; let maxX = minX; let minY = points[0].y; let maxY = minY;
    for (let i = 1; i < points.length; i++) {
        const point = points[i];
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    }
    return { minX, minY, maxX, maxY };
}
