/**
 * src/engine/shapes/triangle.ts
 *
 * 'triangle' shape plugin with fill pattern support and 1:1 regularization.
 */

import type { BoundingBox } from '../../core/types.ts';
import type { ShapePlugin, ShapeRenderGeometry, ShapeStyleConfig, ShapeSvgOutput } from './types.ts';
import {
    applyCanvasFill,
    distToSegmentSquared,
    getStrokeDashArray,
    getSvgFillAttributes,
    getSvgStrokeAttributes,
    pointInPolygon,
    regularizeClosedGeometry,
} from './common.ts';

function getTriangleVertices(norm: ShapeRenderGeometry): Array<[number, number]> {
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

export const triangleShapePlugin: ShapePlugin = {
    id: 'triangle',
    name: 'Triángulo',
    isClosed: true,
    iconSvgPaths: ['M 12 4 L 21 20 H 3 Z'],

    normalizeGeometry(geom: ShapeRenderGeometry): ShapeRenderGeometry {
        return geom.regularize ? regularizeClosedGeometry(geom) : { ...geom };
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
        return {
            minX: Math.min(norm.x0, norm.x1) - halfWidth,
            maxX: Math.max(norm.x0, norm.x1) + halfWidth,
            minY: Math.min(norm.y0, norm.y1) - halfWidth,
            maxY: Math.max(norm.y0, norm.y1) + halfWidth,
        };
    },

    hitTest(geom: ShapeRenderGeometry, point: { x: number; y: number }, tolerance: number): boolean {
        const norm = this.normalizeGeometry(geom);
        const vertices = getTriangleVertices(norm);
        if (pointInPolygon(point.x, point.y, vertices)) {
            return true;
        }

        const tol2 = tolerance * tolerance;
        if (
            distToSegmentSquared(point.x, point.y, vertices[0][0], vertices[0][1], vertices[1][0], vertices[1][1]) <= tol2 ||
            distToSegmentSquared(point.x, point.y, vertices[1][0], vertices[1][1], vertices[2][0], vertices[2][1]) <= tol2 ||
            distToSegmentSquared(point.x, point.y, vertices[2][0], vertices[2][1], vertices[0][0], vertices[0][1]) <= tol2
        ) {
            return true;
        }

        return false;
    },
};
