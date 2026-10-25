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
    rotationHandle,
    rotateHandles,
    applyRotationDrag,
    rotatedBoxBounds,
    rotatePoint,
    getGeometryBox,
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

function getDefinitionPolygon(def: CustomShapeDefinition, geom: ShapeRenderGeometry): Array<[number, number]> | undefined {
    if (typeof def.polygon === 'function') {
        return (def.polygon as any)(geom);
    }
    return def.polygon;
}

function getDefinitionSubpaths(def: CustomShapeDefinition, geom: ShapeRenderGeometry): CustomShapeSubpath[] {
    if (typeof def.subpaths === 'function') {
        return def.subpaths(geom);
    }
    if (def.subpaths && def.subpaths.length > 0) {
        return def.subpaths;
    }

    const poly = getDefinitionPolygon(def, geom);
    if (poly && poly.length >= 3) {
        const commands: CustomPathSegment[] = [];
        commands.push({ type: 'M', args: [poly[0][0], poly[0][1]] });
        for (let i = 1; i < poly.length; i++) {
            commands.push({ type: 'L', args: [poly[i][0], poly[i][1]] });
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
            const subpaths: CustomShapeSubpath[] = getDefinitionSubpaths(def, norm);
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
            const subpaths: CustomShapeSubpath[] = getDefinitionSubpaths(def, norm);
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
            const minX = Math.min(norm.x0, norm.x1);
            const maxX = Math.max(norm.x0, norm.x1);
            const minY = Math.min(norm.y0, norm.y1);
            const maxY = Math.max(norm.y0, norm.y1);
            return isClosed
                ? rotatedBoxBounds(minX, minY, maxX, maxY, norm.rotation, halfWidth)
                : {
                    minX: minX - halfWidth,
                    maxX: maxX + halfWidth,
                    minY: minY - halfWidth,
                    maxY: maxY + halfWidth,
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
            let p = point;
            if (isClosed && norm.rotation) {
                const cx = (minX + maxX) / 2;
                const cy = (minY + maxY) / 2;
                p = rotatePoint(point.x, point.y, cx, cy, -norm.rotation);
            }

            const poly = getDefinitionPolygon(def, norm);
            if (poly && poly.length >= 3) {
                const mapped: Array<[number, number]> = poly.map(([u, v]: [number, number]) => [
                    minX + u * w,
                    minY + v * h,
                ]);
                if (pointInPolygon(p.x, p.y, mapped)) {
                    return true;
                }
            }

            return pointInBox(p.x, p.y, minX, minY, maxX, maxY, tolerance);
        },

        getControlHandles(geom: ShapeRenderGeometry): ShapeHandle[] {
            const norm = this.normalizeGeometry(geom);
            if (!isClosed) {
                return linearControlHandles(norm).filter(h => h.kind === 'endpoint');
            }
            const extra = def.extraControlHandles ? def.extraControlHandles(norm) : [];
            const handles: ShapeHandle[] = [
                ...boxCornerHandles(norm),
                ...boxEdgeHandles(norm),
                rotationHandle(norm),
                ...extra,
            ];
            if (norm.rotation) {
                const cx = (norm.x0 + norm.x1) / 2;
                const cy = (norm.y0 + norm.y1) / 2;
                return rotateHandles(handles, cx, cy, norm.rotation);
            }
            return handles;
        },

        applyHandleDrag(geom: ShapeRenderGeometry, handleId: string, newPoint: ShapePoint, regularize?: boolean): ShapeRenderGeometry {
            const reg = regularize !== undefined ? regularize : Boolean(geom.regularize);
            const norm = this.normalizeGeometry({ ...geom, regularize: reg });
            if (def.applyParamDrag) {
                const handled = def.applyParamDrag(norm, handleId, newPoint);
                if (handled) return handled;
            }
            if (isClosed && handleId === 'rotate') {
                return applyRotationDrag(norm, newPoint, reg);
            }
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
    polygon: (geom: ShapeRenderGeometry) => {
        const b = Math.max(0.08, Math.min(0.50, geom.shapeParams?.bevelRatio ?? 0.25));
        return [
            [b, 0],
            [1 - b, 0],
            [1, 0.5],
            [1 - b, 1],
            [b, 1],
            [0, 0.5],
        ];
    },
    extraControlHandles: (geom: ShapeRenderGeometry) => {
        const { minX, minY, maxX } = getGeometryBox(geom);
        const w = maxX - minX;
        const b = Math.max(0.08, Math.min(0.50, geom.shapeParams?.bevelRatio ?? 0.25));
        return [
            { id: 'param-bevel', kind: 'param', x: minX + w * b, y: minY },
        ];
    },
    applyParamDrag: (geom: ShapeRenderGeometry, handleId: string, point: ShapePoint) => {
        if (handleId === 'param-bevel') {
            const { minX, maxX } = getGeometryBox(geom);
            const w = maxX - minX;
            if (w <= 0) return { ...geom };
            const b = Math.max(0.08, Math.min(0.50, (point.x - minX) / w));
            return {
                ...geom,
                shapeParams: { ...geom.shapeParams, bevelRatio: Number(b.toFixed(3)) },
            };
        }
        return null;
    },
    iconSvgPaths: ['M 6 3 H 18 L 23 12 L 18 21 H 6 L 1 12 Z'],
});

export const cylinderShapePlugin: ShapePlugin = createCustomShapePlugin({
    id: 'cylinder',
    name: 'Cilindro',
    isClosed: true,
    subpaths: (geom: ShapeRenderGeometry) => {
        const c = Math.max(0.08, Math.min(0.48, geom.shapeParams?.capRatio ?? 0.22));
        const k = 0.55228475;
        const c_top = Number((c * (1 - k)).toFixed(3));
        const c_bot = Number((c * (1 + k)).toFixed(3));
        const c2 = Number((2 * c).toFixed(3));
        const x_k0 = Number((0.5 * (1 - k)).toFixed(3));
        const x_k1 = Number((0.5 * (1 + k)).toFixed(3));
        const y_low_mid = Number((1 - c).toFixed(3));
        const y_low_ctrl = Number((1 - c + k * c).toFixed(3));

        return [
            // Face 1: Cylinder Lateral Body (Fill only, non-overlapping with top cap)
            {
                commands: [
                    { type: 'M', args: [0, c] },
                    { type: 'C', args: [0, c_bot, x_k0, c2, 0.5, c2] },
                    { type: 'C', args: [x_k1, c2, 1, c_bot, 1, c] },
                    { type: 'L', args: [1, y_low_mid] },
                    { type: 'C', args: [1, y_low_ctrl, x_k1, 1, 0.5, 1] },
                    { type: 'C', args: [x_k0, 1, 0, y_low_ctrl, 0, y_low_mid] },
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
                    { type: 'M', args: [0, c] },
                    { type: 'C', args: [0, c_top, x_k0, 0, 0.5, 0] },
                    { type: 'C', args: [x_k1, 0, 1, c_top, 1, c] },
                    { type: 'C', args: [1, c_bot, x_k1, c2, 0.5, c2] },
                    { type: 'C', args: [x_k0, c2, 0, c_bot, 0, c] },
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
                    { type: 'M', args: [0, c] },
                    { type: 'L', args: [0, y_low_mid] },
                    { type: 'C', args: [0, y_low_ctrl, x_k0, 1, 0.5, 1] },
                    { type: 'C', args: [x_k1, 1, 1, y_low_ctrl, 1, y_low_mid] },
                    { type: 'L', args: [1, c] },
                    { type: 'C', args: [1, c_top, x_k1, 0, 0.5, 0] },
                    { type: 'C', args: [x_k0, 0, 0, c_top, 0, c] },
                    { type: 'Z', args: [] },
                ],
                isClosed: true,
                isFilled: false,
                isStroked: true,
            },
            // Front Top Rim Arc Stroke (interior 3D seam drawn on top of both fills)
            {
                commands: [
                    { type: 'M', args: [0, c] },
                    { type: 'C', args: [0, c_bot, x_k0, c2, 0.5, c2] },
                    { type: 'C', args: [x_k1, c2, 1, c_bot, 1, c] },
                ],
                isClosed: false,
                isFilled: false,
                isStroked: true,
            },
        ];
    },
    extraControlHandles: (geom: ShapeRenderGeometry) => {
        const { minX, minY, maxX, maxY } = getGeometryBox(geom);
        const cx = (minX + maxX) / 2;
        const h = maxY - minY;
        const c = Math.max(0.08, Math.min(0.48, geom.shapeParams?.capRatio ?? 0.22));
        return [
            { id: 'param-cap', kind: 'param', x: cx, y: minY + 2 * c * h },
        ];
    },
    applyParamDrag: (geom: ShapeRenderGeometry, handleId: string, point: ShapePoint) => {
        if (handleId === 'param-cap') {
            const { minY, maxY } = getGeometryBox(geom);
            const h = maxY - minY;
            if (h <= 0) return { ...geom };
            const c = Math.max(0.08, Math.min(0.48, (point.y - minY) / (2 * h)));
            return {
                ...geom,
                shapeParams: { ...geom.shapeParams, capRatio: Number(c.toFixed(3)) },
            };
        }
        return null;
    },
    iconSvgPaths: [
        'M 4 6 C 4 3.8 7.6 2 12 2 S 20 3.8 20 6 V 18 C 20 20.2 16.4 22 12 22 S 4 20.2 4 18 Z',
        'M 4 6 C 4 8.2 7.6 10 12 10 S 20 8.2 20 6',
    ],
});
