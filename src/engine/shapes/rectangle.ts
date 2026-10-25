/**
 * src/engine/shapes/rectangle.ts
 *
 * 'rectangle' shape plugin with fill pattern support, 1:1 regularization
 * and an interactive corner radius ('radius' handle).
 */

import type { BoundingBox } from '../../core/types.ts';
import type { ShapeHandle, ShapePlugin, ShapePoint, ShapeRenderGeometry, ShapeSnapPort, ShapeStyleConfig, ShapeSvgOutput } from './types.ts';
import {
    applyCanvasFill,
    getStrokeDashArray,
    getSvgFillAttributes,
    getSvgStrokeAttributes,
    pointInBox,
    regularizeClosedGeometry,
} from './common.ts';
import { boxCornerHandles, boxSnapPorts, getGeometryBox, resizeBoxByHandle, rotationHandle, rotateHandles, applyRotationDrag, rotatedBoxBounds, rotatePoint } from './handles.ts';

/** Distance between the top-left corner and the radius handle when the radius is 0. */
export const RADIUS_HANDLE_INSET = 10;

export function clampCornerRadius(radius: number | undefined, width: number, height: number): number {
    if (!radius || radius <= 0) return 0;
    return Math.min(radius, Math.min(width, height) / 2);
}

function traceRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    if (r <= 0) {
        ctx.rect(x, y, w, h);
        return;
    }
    const roundRect = (ctx as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect;
    if (typeof roundRect === 'function') {
        roundRect.call(ctx, x, y, w, h, r);
        return;
    }
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

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
        const radius = clampCornerRadius(norm.cornerRadius, width, height);

        const strokeWidth = style.strokeWidth ?? 3;
        const strokeColor = style.strokeColor || '#1F4FD8';
        const strokeOpacity = style.strokeOpacity !== undefined ? style.strokeOpacity : 1;
        const pattern = style.strokePattern || 'solid';

        ctx.save();

        // 1. Fill if enabled
        if (style.fillEnabled && width > 0 && height > 0) {
            ctx.beginPath();
            traceRect(ctx, x, y, width, height, radius);
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
        traceRect(ctx, x, y, width, height, radius);
        ctx.stroke();

        ctx.restore();
    },

    renderSvg(geom: ShapeRenderGeometry, style: ShapeStyleConfig): ShapeSvgOutput {
        const norm = this.normalizeGeometry(geom);
        const x = Math.min(norm.x0, norm.x1);
        const y = Math.min(norm.y0, norm.y1);
        const width = Math.abs(norm.x1 - norm.x0);
        const height = Math.abs(norm.y1 - norm.y0);
        const radius = clampCornerRadius(norm.cornerRadius, width, height);
        const radiusAttr = radius > 0 ? ` rx="${radius}" ry="${radius}"` : '';

        const strokeAttrs = getSvgStrokeAttributes(style);
        const { fillAttr, defs } = getSvgFillAttributes(style);

        return {
            defs: defs ?? {},
            body: `<rect x="${x}" y="${y}" width="${width}" height="${height}"${radiusAttr} ${strokeAttrs} ${fillAttr}/>`,
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
        let p = point;
        if (norm.rotation) {
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            p = rotatePoint(point.x, point.y, cx, cy, -norm.rotation);
        }
        return pointInBox(p.x, p.y, minX, minY, maxX, maxY, tolerance);
    },

    getControlHandles(geom: ShapeRenderGeometry): ShapeHandle[] {
        const norm = this.normalizeGeometry(geom);
        const { minX, minY, maxX, maxY } = getGeometryBox(norm);
        const radius = clampCornerRadius(norm.cornerRadius, maxX - minX, maxY - minY);
        const inset = radius + RADIUS_HANDLE_INSET;
        const handles: ShapeHandle[] = [
            ...boxCornerHandles(norm),
            rotationHandle(norm),
            { id: 'radius', kind: 'radius', x: minX + inset, y: minY + inset },
        ];
        if (norm.rotation) {
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
        if (handleId === 'radius') {
            const { minX, minY, maxX, maxY } = getGeometryBox(norm);
            const diagonal = ((newPoint.x - minX) + (newPoint.y - minY)) / 2;
            const radius = clampCornerRadius(diagonal - RADIUS_HANDLE_INSET, maxX - minX, maxY - minY);
            const next: ShapeRenderGeometry = { ...norm };
            if (radius > 0) next.cornerRadius = radius;
            else delete next.cornerRadius;
            return next;
        }
        return resizeBoxByHandle(norm, handleId, newPoint, reg);
    },

    getSnapPorts(geom: ShapeRenderGeometry): ShapeSnapPort[] {
        return boxSnapPorts(this.normalizeGeometry(geom));
    },
};
