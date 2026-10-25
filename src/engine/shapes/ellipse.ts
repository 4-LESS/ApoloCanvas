/**
 * src/engine/shapes/ellipse.ts
 *
 * 'ellipse' shape plugin with fill pattern support and 1:1 circle regularization.
 */

import type { BoundingBox } from '../../core/types.ts';
import type { ShapeHandle, ShapePlugin, ShapePoint, ShapeRenderGeometry, ShapeSnapPort, ShapeStyleConfig, ShapeSvgOutput } from './types.ts';
import {
    applyCanvasFill,
    getStrokeDashArray,
    getSvgFillAttributes,
    getSvgStrokeAttributes,
    regularizeClosedGeometry,
} from './common.ts';
import { getGeometryBox, boxCornerHandles, boxEdgeHandles, boxSnapPorts, resizeBoxByHandle, rotationHandle, rotateHandles, applyRotationDrag, rotatedBoxBounds, rotatePoint } from './handles.ts';

export const ellipseShapePlugin: ShapePlugin = {
    id: 'ellipse',
    name: 'Elipse',
    isClosed: true,
    iconSvgPaths: ['M 21 12 A 9 9 0 1 0 3 12 A 9 9 0 1 0 21 12 Z'],

    normalizeGeometry(geom: ShapeRenderGeometry): ShapeRenderGeometry {
        return geom.regularize ? regularizeClosedGeometry(geom) : { ...geom };
    },

    renderCanvas(ctx: CanvasRenderingContext2D, geom: ShapeRenderGeometry, style: ShapeStyleConfig): void {
        const norm = this.normalizeGeometry(geom);
        const cx = (norm.x0 + norm.x1) / 2;
        const cy = (norm.y0 + norm.y1) / 2;
        const rx = Math.max(0.1, Math.abs(norm.x1 - norm.x0) / 2);
        const ry = Math.max(0.1, Math.abs(norm.y1 - norm.y0) / 2);

        const strokeWidth = style.strokeWidth ?? 3;
        const strokeColor = style.strokeColor || '#1F4FD8';
        const strokeOpacity = style.strokeOpacity !== undefined ? style.strokeOpacity : 1;
        const pattern = style.strokePattern || 'solid';

        ctx.save();

        // 1. Fill if enabled
        if (style.fillEnabled && rx > 0 && ry > 0) {
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
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
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
    },

    renderSvg(geom: ShapeRenderGeometry, style: ShapeStyleConfig): ShapeSvgOutput {
        const norm = this.normalizeGeometry(geom);
        const cx = (norm.x0 + norm.x1) / 2;
        const cy = (norm.y0 + norm.y1) / 2;
        const rx = Math.max(0.1, Math.abs(norm.x1 - norm.x0) / 2);
        const ry = Math.max(0.1, Math.abs(norm.y1 - norm.y0) / 2);

        const strokeAttrs = getSvgStrokeAttributes(style);
        const { fillAttr, defs } = getSvgFillAttributes(style);

        return {
            defs: defs ?? {},
            body: `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${strokeAttrs} ${fillAttr}/>`,
        };
    },

    computeBounds(geom: ShapeRenderGeometry, strokeWidth: number): BoundingBox {
        const norm = this.normalizeGeometry(geom);
        const halfWidth = (strokeWidth || 3) / 2;
        const minX = Math.min(norm.x0, norm.x1);
        const maxX = Math.max(norm.x0, norm.x1);
        const minY = Math.min(norm.y0, norm.y1);
        const maxY = Math.max(norm.y0, norm.y1);
        return rotatedBoxBounds(minX, minY, maxX, maxY, norm.rotation, halfWidth);
    },

    hitTest(geom: ShapeRenderGeometry, point: { x: number; y: number }, tolerance: number): boolean {
        const norm = this.normalizeGeometry(geom);
        const minX = Math.min(norm.x0, norm.x1);
        const maxX = Math.max(norm.x0, norm.x1);
        const minY = Math.min(norm.y0, norm.y1);
        const maxY = Math.max(norm.y0, norm.y1);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        let p = point;
        if (norm.rotation) {
            p = rotatePoint(point.x, point.y, cx, cy, -norm.rotation);
        }
        const rx = Math.max(0.1, Math.abs(maxX - minX) / 2) + tolerance;
        const ry = Math.max(0.1, Math.abs(maxY - minY) / 2) + tolerance;
        const eq = ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2;
        return eq <= 1;
    },

    getControlHandles(geom: ShapeRenderGeometry): ShapeHandle[] {
        const norm = this.normalizeGeometry(geom);
        const handles: ShapeHandle[] = [
            ...boxCornerHandles(norm),
            ...boxEdgeHandles(norm),
            rotationHandle(norm),
        ];
        if (norm.rotation) {
            const { minX, minY, maxX, maxY } = getGeometryBox(norm);
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
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
        return resizeBoxByHandle(norm, handleId, newPoint, reg);
    },

    getSnapPorts(geom: ShapeRenderGeometry): ShapeSnapPort[] {
        return boxSnapPorts(this.normalizeGeometry(geom));
    },
};
