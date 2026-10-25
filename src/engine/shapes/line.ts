/**
 * src/engine/shapes/line.ts
 *
 * 'line' shape plugin (straight, quadratic-curved, or multi-segment cubic Bezier path).
 */

import type { BoundingBox } from '../../core/types.ts';
import type { ShapeHandle, ShapePlugin, ShapePoint, ShapeRenderGeometry, ShapeSnapPort, ShapeStyleConfig, ShapeSvgOutput } from './types.ts';
import {
    getStrokeDashArray,
    getSvgStrokeAttributes,
    regularizeLinearGeometry,
} from './common.ts';
import {
    applyLinearHandleDrag,
    linearControlHandles,
    linearPathBounds,
    linearPathHit,
    linearSnapPorts,
} from './handles.ts';

export function traceLinearPath(ctx: CanvasRenderingContext2D, norm: ShapeRenderGeometry): void {
    if (norm.pathNodes && norm.pathNodes.length >= 2) {
        const nodes = norm.pathNodes;
        ctx.moveTo(nodes[0].x, nodes[0].y);
        for (let i = 0; i < nodes.length - 1; i++) {
            const p0 = nodes[i];
            const p1 = nodes[i + 1];
            if (!p0.handleOut && !p1.handleIn) {
                ctx.lineTo(p1.x, p1.y);
            } else {
                const cp1 = p0.handleOut ?? { x: p0.x, y: p0.y };
                const cp2 = p1.handleIn ?? { x: p1.x, y: p1.y };
                ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p1.x, p1.y);
            }
        }
        return;
    }

    ctx.moveTo(norm.x0, norm.y0);
    if (norm.controlPoint && typeof ctx.quadraticCurveTo === 'function') {
        ctx.quadraticCurveTo(norm.controlPoint.x, norm.controlPoint.y, norm.x1, norm.y1);
    } else {
        ctx.lineTo(norm.x1, norm.y1);
    }
}

export function linearSvgPathData(norm: ShapeRenderGeometry): string {
    if (norm.pathNodes && norm.pathNodes.length >= 2) {
        const nodes = norm.pathNodes;
        const commands: string[] = [`M ${nodes[0].x} ${nodes[0].y}`];
        for (let i = 0; i < nodes.length - 1; i++) {
            const p0 = nodes[i];
            const p1 = nodes[i + 1];
            if (!p0.handleOut && !p1.handleIn) {
                commands.push(`L ${p1.x} ${p1.y}`);
            } else {
                const cp1 = p0.handleOut ?? { x: p0.x, y: p0.y };
                const cp2 = p1.handleIn ?? { x: p1.x, y: p1.y };
                commands.push(`C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${p1.x} ${p1.y}`);
            }
        }
        return commands.join(' ');
    }

    if (norm.controlPoint) {
        return `M ${norm.x0} ${norm.y0} Q ${norm.controlPoint.x} ${norm.controlPoint.y} ${norm.x1} ${norm.y1}`;
    }
    return `M ${norm.x0} ${norm.y0} L ${norm.x1} ${norm.y1}`;
}

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
        traceLinearPath(ctx, norm);
        ctx.stroke();

        ctx.restore();
    },

    renderSvg(geom: ShapeRenderGeometry, style: ShapeStyleConfig): ShapeSvgOutput {
        const norm = this.normalizeGeometry(geom);
        const strokeAttrs = getSvgStrokeAttributes(style);
        return {
            defs: {},
            body: `<path d="${linearSvgPathData(norm)}" ${strokeAttrs} fill="none"/>`,
        };
    },

    computeBounds(geom: ShapeRenderGeometry, strokeWidth: number): BoundingBox {
        const norm = this.normalizeGeometry(geom);
        const halfWidth = (strokeWidth || 3) / 2;
        const box = linearPathBounds(norm);
        return {
            minX: box.minX - halfWidth,
            maxX: box.maxX + halfWidth,
            minY: box.minY - halfWidth,
            maxY: box.maxY + halfWidth,
        };
    },

    hitTest(geom: ShapeRenderGeometry, point: { x: number; y: number }, tolerance: number): boolean {
        return linearPathHit(this.normalizeGeometry(geom), point, tolerance);
    },

    getControlHandles(geom: ShapeRenderGeometry): ShapeHandle[] {
        return linearControlHandles(this.normalizeGeometry(geom));
    },

    applyHandleDrag(geom: ShapeRenderGeometry, handleId: string, newPoint: ShapePoint, regularize?: boolean): ShapeRenderGeometry {
        return applyLinearHandleDrag(this.normalizeGeometry(geom), handleId, newPoint, regularize ?? geom.regularize);
    },

    getSnapPorts(geom: ShapeRenderGeometry): ShapeSnapPort[] {
        return linearSnapPorts(this.normalizeGeometry(geom));
    },
};
