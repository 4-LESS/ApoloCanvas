/**
 * src/engine/shapes/custom.ts
 *
 * Factory to turn normalized [0..1] SVG/polygon definitions into a full ShapePlugin.
 * Includes built-in 'diamond', 'hexagon', and 'cylinder' plugins.
 */

import type { BoundingBox } from '../../core/types.ts';
import type {
    CustomPathSegment,
    CustomShapeDefinition,
    CustomShapeSubpath,
    ShapeHandle,
    ShapePlugin,
    ShapePoint,
    ShapeRenderGeometry,
    ShapeSnapPort,
    ShapeStyleConfig,
    ShapeSvgOutput,
} from './types.ts';
import {
    applyLinearHandleDrag,
    boxCornerHandles,
    boxEdgeHandles,
    boxSnapPorts,
    linearControlHandles,
    linearSnapPorts,
    resizeBoxByHandle,
} from './handles.ts';
import {
    applyCanvasFill,
    getStrokeDashArray,
    getSvgFillAttributes,
    getSvgStrokeAttributes,
    pointInBox,
    pointInPolygon,
    regularizeClosedGeometry,
    regularizeLinearGeometry,
} from './common.ts';

function buildSubpaths(def: CustomShapeDefinition): CustomShapeSubpath[] {
    if (def.subpaths && def.subpaths.length > 0) {
        return def.subpaths;
    }

    if (def.polygon && def.polygon.length >= 3) {
        const commands: CustomPathSegment[] = [];
        commands.push({ type: 'M', args: [def.polygon[0][0], def.polygon[0][1]] });
        for (let i = 1; i < def.polygon.length; i++) {
            commands.push({ type: 'L', args: [def.polygon[i][0], def.polygon[i][1]] });
        }
        commands.push({ type: 'Z', args: [] });
        return [{ commands, isClosed: true, isFilled: true, isStroked: true }];
    }

    if (def.commands && def.commands.length > 0) {
        return [{ commands: def.commands, isClosed: def.isClosed !== false, isFilled: true, isStroked: true }];
    }

    return [];
}

function renderCommandsToCanvas(
    ctx: CanvasRenderingContext2D,
    commands: CustomPathSegment[],
    minX: number,
    minY: number,
    w: number,
    h: number,
): void {
    for (const cmd of commands) {
        switch (cmd.type) {
            case 'M':
                ctx.moveTo(minX + cmd.args[0] * w, minY + cmd.args[1] * h);
                break;
            case 'L':
                ctx.lineTo(minX + cmd.args[0] * w, minY + cmd.args[1] * h);
                break;
            case 'C':
                ctx.bezierCurveTo(
                    minX + cmd.args[0] * w,
                    minY + cmd.args[1] * h,
                    minX + cmd.args[2] * w,
                    minY + cmd.args[3] * h,
                    minX + cmd.args[4] * w,
                    minY + cmd.args[5] * h,
                );
                break;
            case 'Q':
                ctx.quadraticCurveTo(
                    minX + cmd.args[0] * w,
                    minY + cmd.args[1] * h,
                    minX + cmd.args[2] * w,
                    minY + cmd.args[3] * h,
                );
                break;
            case 'Z':
                ctx.closePath();
                break;
        }
    }
}

function renderCommandsToSvgPath(
    commands: CustomPathSegment[],
    minX: number,
    minY: number,
    w: number,
    h: number,
): string {
    const parts: string[] = [];
    for (const cmd of commands) {
        switch (cmd.type) {
            case 'M':
                parts.push(`M ${minX + cmd.args[0] * w} ${minY + cmd.args[1] * h}`);
                break;
            case 'L':
                parts.push(`L ${minX + cmd.args[0] * w} ${minY + cmd.args[1] * h}`);
                break;
            case 'C':
                parts.push(
                    `C ${minX + cmd.args[0] * w} ${minY + cmd.args[1] * h} ` +
                    `${minX + cmd.args[2] * w} ${minY + cmd.args[3] * h} ` +
                    `${minX + cmd.args[4] * w} ${minY + cmd.args[5] * h}`,
                );
                break;
            case 'Q':
                parts.push(
                    `Q ${minX + cmd.args[0] * w} ${minY + cmd.args[1] * h} ` +
                    `${minX + cmd.args[2] * w} ${minY + cmd.args[3] * h}`,
                );
                break;
            case 'Z':
                parts.push('Z');
                break;
        }
    }
    return parts.join(' ');
}

export function createCustomShapePlugin(def: CustomShapeDefinition): ShapePlugin {
    const isClosed = def.isClosed !== undefined ? def.isClosed : true;
    const subpaths = buildSubpaths(def);

    return {
        id: def.id,
        name: def.name,
        isClosed,
        iconSvgPaths: def.iconSvgPaths ?? [],

        normalizeGeometry(geom: ShapeRenderGeometry): ShapeRenderGeometry {
            if (!geom.regularize) return { ...geom };
            return isClosed ? regularizeClosedGeometry(geom) : regularizeLinearGeometry(geom);
        },

        renderCanvas(ctx: CanvasRenderingContext2D, geom: ShapeRenderGeometry, style: ShapeStyleConfig): void {
            const norm = this.normalizeGeometry(geom);
            const minX = Math.min(norm.x0, norm.x1);
            const minY = Math.min(norm.y0, norm.y1);
            const w = Math.abs(norm.x1 - norm.x0);
            const h = Math.abs(norm.y1 - norm.y0);

            const strokeWidth = style.strokeWidth ?? 3;
            const strokeColor = style.strokeColor || '#1F4FD8';
            const strokeOpacity = style.strokeOpacity !== undefined ? style.strokeOpacity : 1;
            const pattern = style.strokePattern || 'solid';

            ctx.save();

            // 1. Fill phase (for closed subpaths with isFilled !== false)
            if (isClosed && style.fillEnabled && w > 0 && h > 0) {
                const fillSubpaths = subpaths.filter(sp => sp.isFilled !== false);
                for (const sp of fillSubpaths) {
                    ctx.beginPath();
                    renderCommandsToCanvas(ctx, sp.commands, minX, minY, w, h);
                    applyCanvasFill(ctx, style, undefined, sp.fillOptions);
                }
            }

            // 2. Stroke phase
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeWidth;
            ctx.globalAlpha = strokeOpacity;
            ctx.lineCap = pattern === 'dashed' ? 'butt' : 'round';
            ctx.lineJoin = 'round';

            const dashes = getStrokeDashArray(pattern, strokeWidth);
            if (ctx.setLineDash) {
                ctx.setLineDash(dashes);
            }

            const strokeSubpaths = subpaths.filter(sp => sp.isStroked !== false);
            ctx.beginPath();
            for (const sp of strokeSubpaths) {
                renderCommandsToCanvas(ctx, sp.commands, minX, minY, w, h);
            }
            ctx.stroke();

            ctx.restore();
        },

        renderSvg(geom: ShapeRenderGeometry, style: ShapeStyleConfig): ShapeSvgOutput {
            const norm = this.normalizeGeometry(geom);
            const minX = Math.min(norm.x0, norm.x1);
            const minY = Math.min(norm.y0, norm.y1);
            const w = Math.abs(norm.x1 - norm.x0);
            const h = Math.abs(norm.y1 - norm.y0);

            const strokeAttrs = getSvgStrokeAttributes(style);

            const fillSubpaths = subpaths.filter(sp => sp.isFilled !== false);
            const strokeSubpaths = subpaths.filter(sp => sp.isStroked !== false);

            const bodies: string[] = [];
            const allDefs: Record<string, string> = {};

            // If filled and separate from stroke or unified
            if (isClosed && style.fillEnabled && fillSubpaths.length > 0) {
                for (const sp of fillSubpaths) {
                    const { fillAttr, defs } = getSvgFillAttributes(style, sp.fillOptions);
                    if (defs) {
                        Object.assign(allDefs, defs);
                    }
                    const fillD = renderCommandsToSvgPath(sp.commands, minX, minY, w, h);
                    bodies.push(`<path d="${fillD}" stroke="none" ${fillAttr}/>`);
                }
            }

            const strokeD = strokeSubpaths
                .map(sp => renderCommandsToSvgPath(sp.commands, minX, minY, w, h))
                .join(' ');
            bodies.push(`<path d="${strokeD}" ${strokeAttrs} fill="none"/>`);

            return {
                defs: allDefs,
                body: bodies.join('\n'),
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
            const w = maxX - minX;
            const h = maxY - minY;

            if (def.polygon && def.polygon.length >= 3) {
                const mapped: Array<[number, number]> = def.polygon.map(([u, v]) => [
                    minX + u * w,
                    minY + v * h,
                ]);
                if (pointInPolygon(point.x, point.y, mapped)) {
                    return true;
                }
            }

            return pointInBox(point.x, point.y, minX, minY, maxX, maxY, tolerance);
        },

        getControlHandles(geom: ShapeRenderGeometry): ShapeHandle[] {
            const norm = this.normalizeGeometry(geom);
            return isClosed
                ? [...boxCornerHandles(norm), ...boxEdgeHandles(norm)]
                : linearControlHandles(norm).filter(h => h.kind === 'endpoint');
        },

        applyHandleDrag(geom: ShapeRenderGeometry, handleId: string, newPoint: ShapePoint, regularize?: boolean): ShapeRenderGeometry {
            const norm = this.normalizeGeometry(geom);
            const reg = regularize ?? geom.regularize;
            return isClosed
                ? resizeBoxByHandle(norm, handleId, newPoint, reg)
                : applyLinearHandleDrag(norm, handleId, newPoint, reg);
        },

        getSnapPorts(geom: ShapeRenderGeometry): ShapeSnapPort[] {
            const norm = this.normalizeGeometry(geom);
            return isClosed ? boxSnapPorts(norm) : linearSnapPorts(norm);
        },
    };
}

export const diamondShapePlugin: ShapePlugin = createCustomShapePlugin({
    id: 'diamond',
    name: 'Diamante',
    isClosed: true,
    polygon: [
        [0.5, 0],
        [1, 0.5],
        [0.5, 1],
        [0, 0.5],
    ],
    iconSvgPaths: ['M 12 2 L 22 12 L 12 22 L 2 12 Z'],
});

export const hexagonShapePlugin: ShapePlugin = createCustomShapePlugin({
    id: 'hexagon',
    name: 'Hexágono',
    isClosed: true,
    polygon: [
        [0.25, 0],
        [0.75, 0],
        [1, 0.5],
        [0.75, 1],
        [0.25, 1],
        [0, 0.5],
    ],
    iconSvgPaths: ['M 6 3 H 18 L 23 12 L 18 21 H 6 L 1 12 Z'],
});

export const cylinderShapePlugin: ShapePlugin = createCustomShapePlugin({
    id: 'cylinder',
    name: 'Cilindro',
    isClosed: true,
    subpaths: [
        // Face 1: Cylinder Lateral Body (Fill only, non-overlapping with top cap)
        {
            commands: [
                { type: 'M', args: [0, 0.2] },
                { type: 'C', args: [0, 0.31, 0.22, 0.4, 0.5, 0.4] },
                { type: 'C', args: [0.78, 0.4, 1, 0.31, 1, 0.2] },
                { type: 'L', args: [1, 0.8] },
                { type: 'C', args: [1, 0.91, 0.78, 1, 0.5, 1] },
                { type: 'C', args: [0.22, 1, 0, 0.91, 0, 0.8] },
                { type: 'Z', args: [] },
            ],
            isClosed: true,
            isFilled: true,
            isStroked: false,
            fillOptions: {
                patternAngleOffsetDeg: 0,
                opacityMultiplier: 1.0,
            },
        },
        // Face 2: Top Elliptical Cap (Fill only, non-overlapping)
        {
            commands: [
                { type: 'M', args: [0, 0.2] },
                { type: 'C', args: [0, 0.09, 0.22, 0, 0.5, 0] },
                { type: 'C', args: [0.78, 0, 1, 0.09, 1, 0.2] },
                { type: 'C', args: [1, 0.31, 0.78, 0.4, 0.5, 0.4] },
                { type: 'C', args: [0.22, 0.4, 0, 0.31, 0, 0.2] },
                { type: 'Z', args: [] },
            ],
            isClosed: true,
            isFilled: true,
            isStroked: false,
            fillOptions: {
                patternAngleOffsetDeg: 90,
                opacityMultiplier: 0.72,
            },
        },
        // Outer Boundary Silhouette Stroke
        {
            commands: [
                { type: 'M', args: [0, 0.2] },
                { type: 'L', args: [0, 0.8] },
                { type: 'C', args: [0, 0.91, 0.22, 1, 0.5, 1] },
                { type: 'C', args: [0.78, 1, 1, 0.91, 1, 0.8] },
                { type: 'L', args: [1, 0.2] },
                { type: 'C', args: [1, 0.09, 0.78, 0, 0.5, 0] },
                { type: 'C', args: [0.22, 0, 0, 0.09, 0, 0.2] },
                { type: 'Z', args: [] },
            ],
            isClosed: true,
            isFilled: false,
            isStroked: true,
        },
        // Front Top Rim Arc Stroke (interior 3D seam drawn on top of both fills)
        {
            commands: [
                { type: 'M', args: [0, 0.2] },
                { type: 'C', args: [0, 0.31, 0.22, 0.4, 0.5, 0.4] },
                { type: 'C', args: [0.78, 0.4, 1, 0.31, 1, 0.2] },
            ],
            isClosed: false,
            isFilled: false,
            isStroked: true,
        },
    ],
    iconSvgPaths: [
        'M 4 6 C 4 3.8 7.6 2 12 2 S 20 3.8 20 6 V 18 C 20 20.2 16.4 22 12 22 S 4 20.2 4 18 Z',
        'M 4 6 C 4 8.2 7.6 10 12 10 S 20 8.2 20 6',
    ],
});
