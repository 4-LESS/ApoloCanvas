/**
 * src/engine/shapes/triangle.ts
 *
 * 'triangle' shape plugin with fill pattern support, 1:1 (equilateral) regularization
 * and 3 independently draggable vertices ('v0', 'v1', 'v2').
 */

import type { BoundingBox } from '../../core/types.ts';
import type { ShapeHandle, ShapePlugin, ShapePoint, ShapeRenderGeometry, ShapeSnapPort, ShapeStyleConfig, ShapeSvgOutput } from './types.ts';
import {
    applyCanvasFill,
    distToSegmentSquared,
    getStrokeDashArray,
    getSvgFillAttributes,
    getSvgStrokeAttributes,
    pointInPolygon,
} from './common.ts';
import { boxCornerHandles, isBoxHandleId, resizeBoxByHandle, rotationHandle, rotateHandles, applyRotationDrag, rotatedBoxBounds, rotatePoint } from './handles.ts';

const EQUILATERAL_ASPECT = Math.sqrt(3) / 2;

function hasDetachedVertices(geom: ShapeRenderGeometry): boolean {
    return Array.isArray(geom.vertices) && geom.vertices.length === 3;
}

/** Vertices in order [top/v0, right/v1, left/v2], from the detached overrides or the bounding box. */
export function getTriangleVertices(norm: ShapeRenderGeometry): Array<[number, number]> {
    if (hasDetachedVertices(norm)) {
        return norm.vertices!.map(v => [v.x, v.y] as [number, number]);
    }
    const minX = Math.min(norm.x0, norm.x1);
    const maxX = Math.max(norm.x0, norm.x1);
    const minY = Math.min(norm.y0, norm.y1);
    const maxY = Math.max(norm.y0, norm.y1);
    const midX = (minX + maxX) / 2;

    return [
        [midX, minY],
        [maxX, maxY],
        [minX, maxY],
    ];
}

function withVertices(geom: ShapeRenderGeometry, vertices: ShapePoint[]): ShapeRenderGeometry {
    const xs = vertices.map(v => v.x);
    const ys = vertices.map(v => v.y);
    return {
        ...geom,
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys),
        regularize: false,
        vertices: vertices.map(v => ({ x: v.x, y: v.y })),
    };
}

export const triangleShapePlugin: ShapePlugin = {
    id: 'triangle',
    name: 'Triángulo',
    isClosed: true,
    iconSvgPaths: ['M 12 4 L 21 20 H 3 Z'],

    normalizeGeometry(geom: ShapeRenderGeometry): ShapeRenderGeometry {
        if (!geom.regularize || hasDetachedVertices(geom)) {
            return { ...geom };
        }
        const dx = geom.x1 - geom.x0;
        const dy = geom.y1 - geom.y0;
        const s = Math.max(Math.abs(dx), Math.abs(dy));
        const signX = dx < 0 ? -1 : 1;
        const signY = dy < 0 ? -1 : 1;
        const w = s;
        const h = s * EQUILATERAL_ASPECT;
        return {
            ...geom,
            x1: geom.x0 + signX * w,
            y1: geom.y0 + signY * h,
        };
    },

    renderCanvas(ctx: CanvasRenderingContext2D, geom: ShapeRenderGeometry, style: ShapeStyleConfig): void {
        const norm = this.normalizeGeometry(geom);
        const [top, right, left] = getTriangleVertices(norm);

        const strokeWidth = style.strokeWidth ?? 3;
        const strokeColor = style.strokeColor || '#1F4FD8';
        const strokeOpacity = style.strokeOpacity !== undefined ? style.strokeOpacity : 1;
        const pattern = style.strokePattern || 'solid';

        ctx.save();

        // 1. Fill if enabled
        if (style.fillEnabled) {
            ctx.beginPath();
            ctx.moveTo(top[0], top[1]);
            ctx.lineTo(right[0], right[1]);
            ctx.lineTo(left[0], left[1]);
            ctx.closePath();
            applyCanvasFill(ctx, style);
        }

        // 2. Stroke
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.globalAlpha = strokeOpacity;
        ctx.lineCap = pattern === 'dashed' ? 'butt' : 'round';
        ctx.lineJoin = 'round';

        const dashes = getStrokeDashArray(pattern, strokeWidth);
        if (ctx.setLineDash) {
            ctx.setLineDash(dashes);
        }

        ctx.beginPath();
        ctx.moveTo(top[0], top[1]);
        ctx.lineTo(right[0], right[1]);
        ctx.lineTo(left[0], left[1]);
        ctx.closePath();
        ctx.stroke();

        ctx.restore();
    },

    renderSvg(geom: ShapeRenderGeometry, style: ShapeStyleConfig): ShapeSvgOutput {
        const norm = this.normalizeGeometry(geom);
        const [top, right, left] = getTriangleVertices(norm);

        const strokeAttrs = getSvgStrokeAttributes(style);
        const { fillAttr, defs } = getSvgFillAttributes(style);

        const d = `M ${top[0]} ${top[1]} L ${right[0]} ${right[1]} L ${left[0]} ${left[1]} Z`;

        return {
            defs: defs ?? {},
            body: `<path d="${d}" ${strokeAttrs} ${fillAttr}/>`,
        };
    },

    computeBounds(geom: ShapeRenderGeometry, strokeWidth: number): BoundingBox {
        const norm = this.normalizeGeometry(geom);
        const halfWidth = (strokeWidth || 3) / 2;
        const vertices = getTriangleVertices(norm);
        const xs = vertices.map(v => v[0]);
        const ys = vertices.map(v => v[1]);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return rotatedBoxBounds(minX, minY, maxX, maxY, norm.rotation, halfWidth);
    },

    hitTest(geom: ShapeRenderGeometry, point: { x: number; y: number }, tolerance: number): boolean {
        const norm = this.normalizeGeometry(geom);
        let p = point;
        if (norm.rotation) {
            const cx = (norm.x0 + norm.x1) / 2;
            const cy = (norm.y0 + norm.y1) / 2;
            p = rotatePoint(point.x, point.y, cx, cy, -norm.rotation);
        }
        const vertices = getTriangleVertices(norm);
        if (pointInPolygon(p.x, p.y, vertices)) {
            return true;
        }

        const tol2 = tolerance * tolerance;
        if (
            distToSegmentSquared(p.x, p.y, vertices[0][0], vertices[0][1], vertices[1][0], vertices[1][1]) <= tol2 ||
            distToSegmentSquared(p.x, p.y, vertices[1][0], vertices[1][1], vertices[2][0], vertices[2][1]) <= tol2 ||
            distToSegmentSquared(p.x, p.y, vertices[2][0], vertices[2][1], vertices[0][0], vertices[0][1]) <= tol2
        ) {
            return true;
        }

        return false;
    },

    getControlHandles(geom: ShapeRenderGeometry): ShapeHandle[] {
        const norm = this.normalizeGeometry(geom);
        const vertexHandles: ShapeHandle[] = getTriangleVertices(norm).map(([x, y], i) => ({
            id: `v${i}`,
            kind: 'vertex',
            x,
            y,
        }));
        const handles: ShapeHandle[] = hasDetachedVertices(norm) ? vertexHandles
            : [...vertexHandles, ...boxCornerHandles(norm), rotationHandle(norm)];
        if (norm.rotation) {
            const cx = (norm.x0 + norm.x1) / 2;
            const cy = (norm.y0 + norm.y1) / 2;
            return rotateHandles(handles, cx, cy, norm.rotation);
        }
        return handles;
    },

    applyHandleDrag(geom: ShapeRenderGeometry, handleId: string, newPoint: ShapePoint, regularize?: boolean): ShapeRenderGeometry {
        const reg = regularize !== undefined ? regularize : Boolean(geom.regularize);
        const norm = this.normalizeGeometry({ ...geom, regularize: reg });
        if (handleId === 'rotate') {
            return applyRotationDrag(norm, newPoint, reg);
        }
        const vertexIndex = handleId === 'v0' ? 0 : handleId === 'v1' ? 1 : handleId === 'v2' ? 2 : -1;
        if (vertexIndex >= 0) {
            const vertices = getTriangleVertices(norm).map(([x, y]) => ({ x, y }));
            vertices[vertexIndex] = { x: newPoint.x, y: newPoint.y };
            return withVertices(norm, vertices);
        }
        if (isBoxHandleId(handleId) && !hasDetachedVertices(norm)) {
            return resizeBoxByHandle(norm, handleId, newPoint, reg, EQUILATERAL_ASPECT);
        }
        return { ...norm };
    },

    /** Vertices 'v0' (top), 'v1' (right), 'v2' (left) and edge midpoints 'e' (v0–v1), 's' (v1–v2), 'w' (v2–v0). */
    getSnapPorts(geom: ShapeRenderGeometry): ShapeSnapPort[] {
        const norm = this.normalizeGeometry(geom);
        const [v0, v1, v2] = getTriangleVertices(norm);
        const mid = (a: [number, number], b: [number, number]) => ({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 });
        const ports: ShapeSnapPort[] = [
            { id: 'v0', x: v0[0], y: v0[1] },
            { id: 'v1', x: v1[0], y: v1[1] },
            { id: 'v2', x: v2[0], y: v2[1] },
            { id: 'e', ...mid(v0, v1) },
            { id: 's', ...mid(v1, v2) },
            { id: 'w', ...mid(v2, v0) },
        ];
        if (norm.rotation) {
            const cx = (norm.x0 + norm.x1) / 2;
            const cy = (norm.y0 + norm.y1) / 2;
            return ports.map(p => {
                const rot = rotatePoint(p.x, p.y, cx, cy, norm.rotation!);
                return { id: p.id, x: rot.x, y: rot.y };
            });
        }
        return ports;
    },
};
