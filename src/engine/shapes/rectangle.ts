/**
 * src/engine/shapes/rectangle.ts
 *
 * 'rectangle' shape plugin with fill pattern support and 1:1 regularization.
 */

import type { BoundingBox } from '../../core/types.ts';
import type { ShapePlugin, ShapeRenderGeometry, ShapeStyleConfig, ShapeSvgOutput } from './types.ts';
import {
    applyCanvasFill,
    getStrokeDashArray,
    getSvgFillAttributes,
    getSvgStrokeAttributes,
    pointInBox,
    regularizeClosedGeometry,
} from './common.ts';

export const rectangleShapePlugin: ShapePlugin = {
    id: 'rectangle',
    name: 'Rectángulo',
    isClosed: true,
    iconSvgPaths: ['M 4 6 H 20 V 18 H 4 Z'],

    normalizeGeometry(geom: ShapeRenderGeometry): ShapeRenderGeometry {
        return geom.regularize ? regularizeClosedGeometry(geom) : { ...geom };
    },

    renderCanvas(ctx: CanvasRenderingContext2D, geom: ShapeRenderGeometry, style: ShapeStyleConfig): void {
        const norm = this.normalizeGeometry(geom);
        const x = Math.min(norm.x0, norm.x1);
        const y = Math.min(norm.y0, norm.y1);
        const width = Math.abs(norm.x1 - norm.x0);
        const height = Math.abs(norm.y1 - norm.y0);

        const strokeWidth = style.strokeWidth ?? 3;
        const strokeColor = style.strokeColor || '#1F4FD8';
        const strokeOpacity = style.strokeOpacity !== undefined ? style.strokeOpacity : 1;
        const pattern = style.strokePattern || 'solid';

        ctx.save();

        // 1. Fill if enabled
        if (style.fillEnabled && width > 0 && height > 0) {
            ctx.beginPath();
            ctx.rect(x, y, width, height);
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
        ctx.rect(x, y, width, height);
        ctx.stroke();

        ctx.restore();
    },

    renderSvg(geom: ShapeRenderGeometry, style: ShapeStyleConfig): ShapeSvgOutput {
        const norm = this.normalizeGeometry(geom);
        const x = Math.min(norm.x0, norm.x1);
        const y = Math.min(norm.y0, norm.y1);
        const width = Math.abs(norm.x1 - norm.x0);
        const height = Math.abs(norm.y1 - norm.y0);

        const strokeAttrs = getSvgStrokeAttributes(style);
        const { fillAttr, defs } = getSvgFillAttributes(style);

        return {
            defs: defs ?? {},
            body: `<rect x="${x}" y="${y}" width="${width}" height="${height}" ${strokeAttrs} ${fillAttr}/>`,
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
        const minX = Math.min(norm.x0, norm.x1);
        const maxX = Math.max(norm.x0, norm.x1);
        const minY = Math.min(norm.y0, norm.y1);
        const maxY = Math.max(norm.y0, norm.y1);
        return pointInBox(point.x, point.y, minX, minY, maxX, maxY, tolerance);
    },
};
