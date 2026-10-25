/**
 * src/engine/shapes/arrow.ts
 *
 * 'arrow' shape plugin with an arrowhead aligned to the path tangent at the tip,
 * supporting straight lines, quadratic curves, and multi-segment cubic Bezier paths.
 */

import type { BoundingBox } from '../../core/types.ts';
import type { ShapeHandle, ShapePlugin, ShapePoint, ShapeRenderGeometry, ShapeSnapPort, ShapeStyleConfig, ShapeSvgOutput } from './types.ts';
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
    linearSnapPorts,
} from './handles.ts';
import { linearSvgPathData, traceLinearPath } from './line.ts';

function computeArrowHead(norm: ShapeRenderGeometry, headLength = 12): {
    ax1: number;
    ay1: number;
    ax2: number;
    ay2: number;
    tipX: number;
    tipY: number;
} {
    const theta = getEndTangentAngle(norm);
    const alpha = Math.PI / 6; // 30 degrees
    const lastNode = norm.pathNodes && norm.pathNodes.length >= 2
        ? norm.pathNodes[norm.pathNodes.length - 1]
        : { x: norm.x1, y: norm.y1 };
    const tipX = lastNode.x;
    const tipY = lastNode.y;

    const ax1 = tipX - headLength * Math.cos(theta - alpha);
    const ay1 = tipY - headLength * Math.sin(theta - alpha);
    const ax2 = tipX - headLength * Math.cos(theta + alpha);
    const ay2 = tipY - headLength * Math.sin(theta + alpha);

    return { ax1, ay1, ax2, ay2, tipX, tipY };
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

        const { ax1, ay1, ax2, ay2, tipX, tipY } = computeArrowHead(norm);

        ctx.beginPath();
        traceLinearPath(ctx, norm);
        ctx.stroke();

        // Arrow head is always drawn with solid lines
        if (ctx.setLineDash && dashes.length > 0) {
            ctx.setLineDash([]);
        }
        ctx.beginPath();
        ctx.moveTo(ax1, ay1);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(ax2, ay2);
        ctx.stroke();

        ctx.restore();
    },

    renderSvg(geom: ShapeRenderGeometry, style: ShapeStyleConfig): ShapeSvgOutput {
        const norm = this.normalizeGeometry(geom);
        const strokeAttrs = getSvgStrokeAttributes(style);
        const { ax1, ay1, ax2, ay2, tipX, tipY } = computeArrowHead(norm);

        return {
            defs: {},
            body: `<path d="${linearSvgPathData(norm)} M ${ax1} ${ay1} L ${tipX} ${tipY} L ${ax2} ${ay2}" ${strokeAttrs} fill="none"/>`,
        };
    },

    computeBounds(geom: ShapeRenderGeometry, strokeWidth: number): BoundingBox {
        const norm = this.normalizeGeometry(geom);
        const halfWidth = (strokeWidth || 3) / 2;
        const { ax1, ay1, ax2, ay2, tipX, tipY } = computeArrowHead(norm);
        const path = linearPathBounds(norm);

        return {
            minX: Math.min(path.minX, ax1, ax2, tipX) - halfWidth,
            maxX: Math.max(path.maxX, ax1, ax2, tipX) + halfWidth,
            minY: Math.min(path.minY, ay1, ay2, tipY) - halfWidth,
            maxY: Math.max(path.maxY, ay1, ay2, tipY) + halfWidth,
        };
    },

    hitTest(geom: ShapeRenderGeometry, point: { x: number; y: number }, tolerance: number): boolean {
        const norm = this.normalizeGeometry(geom);
        if (linearPathHit(norm, point, tolerance)) {
            return true;
        }
        const tol2 = tolerance * tolerance;
        const { ax1, ay1, ax2, ay2, tipX, tipY } = computeArrowHead(norm);
        if (distToSegmentSquared(point.x, point.y, ax1, ay1, tipX, tipY) <= tol2) {
            return true;
        }
        if (distToSegmentSquared(point.x, point.y, ax2, ay2, tipX, tipY) <= tol2) {
            return true;
        }
        return false;
    },

    getControlHandles(geom: ShapeRenderGeometry): ShapeHandle[] {
        return linearControlHandles(this.normalizeGeometry(geom));
    },

    applyHandleDrag(geom: ShapeRenderGeometry, handleId: string, newPoint: ShapePoint, regularize?: boolean): ShapeRenderGeometry {
        const reg = regularize !== undefined ? regularize : Boolean(geom.regularize);
        return applyLinearHandleDrag(this.normalizeGeometry({ ...geom, regularize: reg }), handleId, newPoint, reg);
    },

    getSnapPorts(geom: ShapeRenderGeometry): ShapeSnapPort[] {
        return linearSnapPorts(this.normalizeGeometry(geom));
    },
};
