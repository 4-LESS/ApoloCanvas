/**
 * src/engine/shapes/arrow.ts
 *
 * 'arrow' shape plugin with an arrowhead aligned to the path tangent at (x1, y1),
 * so curved arrows (quadratic Bezier) point along the curve derivative.
 */

import type { BoundingBox } from '../../core/types.ts';
import type { ShapeHandle, ShapePlugin, ShapePoint, ShapeRenderGeometry, ShapeStyleConfig, ShapeSvgOutput } from './types.ts';
import {
    distToSegmentSquared,
    getStrokeDashArray,
    getSvgStrokeAttributes,
    regularizeLinearGeometry,
} from './common.ts';
import {
    applyLinearHandleDrag,
    getEndTangentAngle,
    linearControlHandles,
    linearPathBounds,
    linearPathHit,
} from './handles.ts';
import { linearSvgPathData, traceLinearPath } from './line.ts';

function computeArrowHead(norm: ShapeRenderGeometry, headLength = 12): { ax1: number; ay1: number; ax2: number; ay2: number } {
    const theta = getEndTangentAngle(norm);
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
        traceLinearPath(ctx, norm);
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
            body: `<path d="${linearSvgPathData(norm)} M ${ax1} ${ay1} L ${norm.x1} ${norm.y1} L ${ax2} ${ay2}" ${strokeAttrs} fill="none"/>`,
        };
    },

    computeBounds(geom: ShapeRenderGeometry, strokeWidth: number): BoundingBox {
        const norm = this.normalizeGeometry(geom);
        const halfWidth = (strokeWidth || 3) / 2;
        const { ax1, ay1, ax2, ay2 } = computeArrowHead(norm);
        const path = linearPathBounds(norm);

        return {
            minX: Math.min(path.minX, ax1, ax2) - halfWidth,
            maxX: Math.max(path.maxX, ax1, ax2) + halfWidth,
            minY: Math.min(path.minY, ay1, ay2) - halfWidth,
            maxY: Math.max(path.maxY, ay1, ay2) + halfWidth,
        };
    },

    hitTest(geom: ShapeRenderGeometry, point: { x: number; y: number }, tolerance: number): boolean {
        const norm = this.normalizeGeometry(geom);
        if (linearPathHit(norm, point, tolerance)) {
            return true;
        }
        const tol2 = tolerance * tolerance;
        const { ax1, ay1, ax2, ay2 } = computeArrowHead(norm);
        if (distToSegmentSquared(point.x, point.y, ax1, ay1, norm.x1, norm.y1) <= tol2) {
            return true;
        }
        if (distToSegmentSquared(point.x, point.y, ax2, ay2, norm.x1, norm.y1) <= tol2) {
            return true;
        }
        return false;
    },

    getControlHandles(geom: ShapeRenderGeometry): ShapeHandle[] {
        return linearControlHandles(this.normalizeGeometry(geom));
    },

    applyHandleDrag(geom: ShapeRenderGeometry, handleId: string, newPoint: ShapePoint, regularize?: boolean): ShapeRenderGeometry {
        return applyLinearHandleDrag(this.normalizeGeometry(geom), handleId, newPoint, regularize ?? geom.regularize);
    },
};
