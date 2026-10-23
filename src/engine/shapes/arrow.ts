/**
 * src/engine/shapes/arrow.ts
 *
 * 'arrow' shape plugin with dynamic angle-aligned arrowhead.
 */

import type { BoundingBox } from '../../core/types.ts';
import type { ShapePlugin, ShapeRenderGeometry, ShapeStyleConfig, ShapeSvgOutput } from './types.ts';
import {
    distToSegmentSquared,
    getStrokeDashArray,
    getSvgStrokeAttributes,
    regularizeLinearGeometry,
} from './common.ts';

function computeArrowHead(norm: ShapeRenderGeometry, headLength = 12): { ax1: number; ay1: number; ax2: number; ay2: number } {
    const dx = norm.x1 - norm.x0;
    const dy = norm.y1 - norm.y0;
    const theta = Math.atan2(dy, dx);
    const alpha = Math.PI / 6; // 30 degrees

    const ax1 = norm.x1 - headLength * Math.cos(theta - alpha);
    const ay1 = norm.y1 - headLength * Math.sin(theta - alpha);
    const ax2 = norm.x1 - headLength * Math.cos(theta + alpha);
    const ay2 = norm.y1 - headLength * Math.sin(theta + alpha);

    return { ax1, ay1, ax2, ay2 };
}

export const arrowShapePlugin: ShapePlugin = {
    id: 'arrow',
    name: 'Flecha',
    isClosed: false,
    iconSvgPaths: ['M 5 19 L 19 5 M 10 5 L 19 5 L 19 14'],

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

        const { ax1, ay1, ax2, ay2 } = computeArrowHead(norm);

        ctx.beginPath();
        ctx.moveTo(norm.x0, norm.y0);
        ctx.lineTo(norm.x1, norm.y1);
        ctx.stroke();

        // Arrow head is always drawn with solid lines
        if (ctx.setLineDash && dashes.length > 0) {
            ctx.setLineDash([]);
        }
        ctx.beginPath();
        ctx.moveTo(ax1, ay1);
        ctx.lineTo(norm.x1, norm.y1);
        ctx.lineTo(ax2, ay2);
        ctx.stroke();

        ctx.restore();
    },

    renderSvg(geom: ShapeRenderGeometry, style: ShapeStyleConfig): ShapeSvgOutput {
        const norm = this.normalizeGeometry(geom);
        const strokeAttrs = getSvgStrokeAttributes(style);
        const { ax1, ay1, ax2, ay2 } = computeArrowHead(norm);

        return {
            defs: {},
            body: `<path d="M ${norm.x0} ${norm.y0} L ${norm.x1} ${norm.y1} M ${ax1} ${ay1} L ${norm.x1} ${norm.y1} L ${ax2} ${ay2}" ${strokeAttrs} fill="none"/>`,
        };
    },

    computeBounds(geom: ShapeRenderGeometry, strokeWidth: number): BoundingBox {
        const norm = this.normalizeGeometry(geom);
        const halfWidth = (strokeWidth || 3) / 2;
        const { ax1, ay1, ax2, ay2 } = computeArrowHead(norm);

        const allX = [norm.x0, norm.x1, ax1, ax2];
        const allY = [norm.y0, norm.y1, ay1, ay2];

        return {
            minX: Math.min(...allX) - halfWidth,
            maxX: Math.max(...allX) + halfWidth,
            minY: Math.min(...allY) - halfWidth,
            maxY: Math.max(...allY) + halfWidth,
        };
    },

    hitTest(geom: ShapeRenderGeometry, point: { x: number; y: number }, tolerance: number): boolean {
        const norm = this.normalizeGeometry(geom);
        const tol2 = tolerance * tolerance;
        if (distToSegmentSquared(point.x, point.y, norm.x0, norm.y0, norm.x1, norm.y1) <= tol2) {
            return true;
        }
        const { ax1, ay1, ax2, ay2 } = computeArrowHead(norm);
        if (distToSegmentSquared(point.x, point.y, ax1, ay1, norm.x1, norm.y1) <= tol2) {
            return true;
        }
        if (distToSegmentSquared(point.x, point.y, ax2, ay2, norm.x1, norm.y1) <= tol2) {
            return true;
        }
        return false;
    },
};
