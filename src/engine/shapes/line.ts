/**
 * src/engine/shapes/line.ts
 *
 * 'line' shape plugin.
 */

import type { BoundingBox } from '../../core/types.ts';
import type { ShapePlugin, ShapeRenderGeometry, ShapeStyleConfig, ShapeSvgOutput } from './types.ts';
import {
    distToSegmentSquared,
    getStrokeDashArray,
    getSvgStrokeAttributes,
    regularizeLinearGeometry,
} from './common.ts';

export const lineShapePlugin: ShapePlugin = {
    id: 'line',
    name: 'Línea',
    isClosed: false,
    iconSvgPaths: ['M 5 19 L 19 5'],

    normalizeGeometry(geom: ShapeRenderGeometry): ShapeRenderGeometry {
        return geom.regularize ? regularizeLinearGeometry(geom) : { ...geom };
    },

    renderCanvas(ctx: CanvasRenderingContext2D, geom: ShapeRenderGeometry, style: ShapeStyleConfig): void {
        const norm = this.normalizeGeometry(geom);
        const strokeWidth = style.strokeWidth ?? 3;
        const strokeColor = style.strokeColor || '#1F4FD8';
        const strokeOpacity = style.strokeOpacity !== undefined ? style.strokeOpacity : 1;
        const pattern = style.strokePattern || 'solid';

        ctx.save();
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
        ctx.moveTo(norm.x0, norm.y0);
        ctx.lineTo(norm.x1, norm.y1);
        ctx.stroke();

        ctx.restore();
    },

    renderSvg(geom: ShapeRenderGeometry, style: ShapeStyleConfig): ShapeSvgOutput {
        const norm = this.normalizeGeometry(geom);
        const strokeAttrs = getSvgStrokeAttributes(style);
        return {
            defs: {},
            body: `<path d="M ${norm.x0} ${norm.y0} L ${norm.x1} ${norm.y1}" ${strokeAttrs} fill="none"/>`,
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
        const d2 = distToSegmentSquared(point.x, point.y, norm.x0, norm.y0, norm.x1, norm.y1);
        return d2 <= tolerance * tolerance;
    },
};
