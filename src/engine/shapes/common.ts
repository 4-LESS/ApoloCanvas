/**
 * src/engine/shapes/common.ts
 *
 * Geometric regularization ("Formas perfectas"), stroke dash helpers,
 * hit-testing utilities, and Canvas 2D / SVG fill pattern generators.
 */

import type { ShapeFillPattern, StrokePattern } from '../../core/types.ts';
import type { ShapeFaceFillOptions, ShapeRenderGeometry, ShapeStyleConfig } from './types.ts';

/**
 * Closed shape regularization: preserves aspect ratio 1:1.
 * Computes s = max(|dx|, |dy|) and preserves quadrant direction so
 * rectangles become exact squares and ellipses become true circles.
 */
export function regularizeClosedGeometry(geom: ShapeRenderGeometry): ShapeRenderGeometry {
    const dx = geom.x1 - geom.x0;
    const dy = geom.y1 - geom.y0;
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    const signX = dx < 0 ? -1 : 1;
    const signY = dy < 0 ? -1 : 1;
    return {
        ...geom,
        x1: geom.x0 + signX * s,
        y1: geom.y0 + signY * s,
    };
}

/**
 * Linear shape regularization: snaps the chord angle to the nearest 45 degree increment
 * (pi / 4 rad) while preserving the total chord length.
 */
export function regularizeLinearGeometry(geom: ShapeRenderGeometry): ShapeRenderGeometry {
    const dx = geom.x1 - geom.x0;
    const dy = geom.y1 - geom.y0;
    const r = Math.hypot(dx, dy);
    if (r < 1e-6) {
        return { ...geom };
    }
    const theta = Math.atan2(dy, dx);
    const step = Math.PI / 4; // 45 degrees
    const snappedTheta = Math.round(theta / step) * step;
    return {
        ...geom,
        x1: geom.x0 + r * Math.cos(snappedTheta),
        y1: geom.y0 + r * Math.sin(snappedTheta),
    };
}

/**
 * Calculates dash pattern array for Canvas and SVG.
 */
export function getStrokeDashArray(pattern?: StrokePattern, width: number = 2): number[] {
    if (pattern === 'dashed') {
        return [Math.max(6, width * 3), Math.max(4, width * 2)];
    }
    if (pattern === 'dotted') {
        return [0.5, Math.round(Math.max(4, width * 2.2) * 10) / 10];
    }
    return [];
}

/**
 * Escapes XML/SVG special characters safely.
 */
export function escapeXml(value: string): string {
    return value.replace(/[&<>"']/g, char => {
        switch (char) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&apos;';
            default: return char;
        }
    });
}

/**
 * Builds SVG attribute string for stroke styling.
 */
export function getSvgStrokeAttributes(style: ShapeStyleConfig): string {
    const strokeWidth = style.strokeWidth ?? 3;
    const strokeColor = style.strokeColor || '#1F4FD8';
    const strokeOpacity = style.strokeOpacity !== undefined ? style.strokeOpacity : 1;
    const pattern = style.strokePattern || 'solid';
    const lineCap = pattern === 'dashed' ? 'butt' : pattern === 'dotted' ? 'round' : 'round';
    const dashes = getStrokeDashArray(pattern, strokeWidth);
    const dashAttr = dashes.length > 0 ? ` stroke-dasharray="${dashes.join(' ')}"` : '';

    return `stroke="${escapeXml(strokeColor)}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}" stroke-linecap="${lineCap}" stroke-linejoin="round"${dashAttr}`;
}

export const BASE_FILL_SPACING = 8;
export const DENSITY_MULTIPLIERS = [2.0, 1.5, 1.0, 0.75, 0.5] as const;

export function getFillPatternSpacing(density: number = 3): number {
    const clampedDensity = Math.max(1, Math.min(5, Math.round(density)));
    const multiplier = DENSITY_MULTIPLIERS[clampedDensity - 1] ?? 1.0;
    return Math.round(BASE_FILL_SPACING * multiplier * 10) / 10;
}

const canvasPatternCache = new Map<string, CanvasPattern | null>();

/**
 * Creates or retrieves a cached offscreen CanvasPattern for fill patterns.
 * Gracefully falls back to null in headless test environments.
 * Supports patternAngleOffsetDeg (e.g. 0° body vs 90° top cap) and fillDensity (1..5).
 */
export function getCanvasPattern(
    ctx: CanvasRenderingContext2D,
    fillColor: string,
    pattern: ShapeFillPattern,
    angleOffsetDeg = 0,
    density = 3,
): CanvasPattern | null {
    if (pattern === 'solid') {
        return null;
    }

    const normAngle = ((Math.round(angleOffsetDeg) % 360) + 360) % 360;
    const clampedDensity = Math.max(1, Math.min(5, Math.round(density)));
    const cacheKey = `${pattern}:${fillColor}:${normAngle}:dens${clampedDensity}`;
    if (canvasPatternCache.has(cacheKey)) {
        return canvasPatternCache.get(cacheKey) ?? null;
    }

    try {
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
            canvasPatternCache.set(cacheKey, null);
            return null;
        }

        const s = getFillPatternSpacing(clampedDensity);
        const tile = document.createElement('canvas');
        tile.width = s;
        tile.height = s;
        const tctx = tile.getContext('2d');
        if (!tctx) {
            canvasPatternCache.set(cacheKey, null);
            return null;
        }

        tctx.strokeStyle = fillColor;
        tctx.fillStyle = fillColor;

        const lineW = Math.max(1, Math.round(s * 0.15 * 10) / 10);
        const dotR = Math.max(1, Math.round(s * 0.15 * 10) / 10);

        if (pattern === 'hachure') {
            tctx.lineWidth = lineW;
            tctx.beginPath();
            if (normAngle === 90 || normAngle === 270) {
                // Perpendicular diagonal lines (-45 deg instead of +45 deg)
                tctx.moveTo(0, 0);
                tctx.lineTo(s, s);
                tctx.moveTo(-1, s - 1);
                tctx.lineTo(1, s + 1);
                tctx.moveTo(s - 1, -1);
                tctx.lineTo(s + 1, 1);
            } else {
                // Standard 45 deg diagonal lines
                tctx.moveTo(0, s);
                tctx.lineTo(s, 0);
                tctx.moveTo(-1, 1);
                tctx.lineTo(1, -1);
                tctx.moveTo(s - 1, s + 1);
                tctx.lineTo(s + 1, s - 1);
            }
            tctx.stroke();
        } else if (pattern === 'cross-hatch') {
            tctx.lineWidth = lineW;
            tctx.beginPath();
            if (normAngle === 90 || normAngle === 270) {
                // Horizontal + vertical cross-hatch to contrast with 45/-45 diagonal
                tctx.moveTo(0, s / 2);
                tctx.lineTo(s, s / 2);
                tctx.moveTo(s / 2, 0);
                tctx.lineTo(s / 2, s);
            } else {
                // Diagonal cross-hatch (+45 and -45)
                tctx.moveTo(0, s);
                tctx.lineTo(s, 0);
                tctx.moveTo(-1, 1);
                tctx.lineTo(1, -1);
                tctx.moveTo(s - 1, s + 1);
                tctx.lineTo(s + 1, s - 1);
                tctx.moveTo(0, 0);
                tctx.lineTo(s, s);
            }
            tctx.stroke();
        } else if (pattern === 'dots') {
            tctx.beginPath();
            if (normAngle === 90 || normAngle === 270) {
                // Phase-shifted stipple dots (shifted by half-period)
                tctx.arc(0, 0, dotR, 0, Math.PI * 2);
                tctx.arc(s, 0, dotR, 0, Math.PI * 2);
                tctx.arc(0, s, dotR, 0, Math.PI * 2);
                tctx.arc(s, s, dotR, 0, Math.PI * 2);
            } else {
                // Centered stipple dot
                tctx.arc(s / 2, s / 2, dotR, 0, Math.PI * 2);
            }
            tctx.fill();
        }

        const created = ctx.createPattern ? ctx.createPattern(tile, 'repeat') : null;
        canvasPatternCache.set(cacheKey, created);
        return created;
    } catch {
        canvasPatternCache.set(cacheKey, null);
        return null;
    }
}

/**
 * Applies fill styling and fill operation to the current canvas path.
 * Supports optional ShapeFaceFillOptions for multi-face 3D contrast.
 */
export function applyCanvasFill(
    ctx: CanvasRenderingContext2D,
    style: ShapeStyleConfig,
    fillPathFn?: () => void,
    faceOptions?: ShapeFaceFillOptions,
): void {
    if (!style.fillEnabled) {
        return;
    }

    const fillColor = style.fillColor || style.strokeColor || '#1F4FD8';
    const fillPattern = style.fillPattern || 'solid';
    const density = style.fillDensity ?? 3;
    const baseOpacity = style.fillOpacity !== undefined ? style.fillOpacity : 0.2;
    const opacityMultiplier = faceOptions?.opacityMultiplier !== undefined ? faceOptions.opacityMultiplier : 1;
    const effectiveOpacity = Math.max(0.05, Math.min(1, baseOpacity * opacityMultiplier));
    const angleOffset = faceOptions?.patternAngleOffsetDeg ?? 0;

    ctx.save();
    ctx.globalAlpha = effectiveOpacity * (style.strokeOpacity ?? 1);

    const pattern = getCanvasPattern(ctx, fillColor, fillPattern, angleOffset, density);
    ctx.fillStyle = pattern ?? fillColor;

    if (fillPathFn) {
        fillPathFn();
    } else {
        ctx.fill();
    }

    ctx.restore();
}

/**
 * Generates SVG fill attributes and required <pattern> defs.
 * Supports optional ShapeFaceFillOptions for multi-face 3D pattern rotation and opacity shading.
 */
export function getSvgFillAttributes(
    style: ShapeStyleConfig,
    faceOptions?: ShapeFaceFillOptions,
): { fillAttr: string; defs?: Record<string, string> } {
    if (!style.fillEnabled) {
        return { fillAttr: 'fill="none"' };
    }

    const fillColor = style.fillColor || style.strokeColor || '#1F4FD8';
    const fillPattern = style.fillPattern || 'solid';
    const density = style.fillDensity ?? 3;
    const s = getFillPatternSpacing(density);
    const lineW = Math.max(1, Math.round(s * 0.15 * 10) / 10);
    const dotR = Math.max(1, Math.round(s * 0.15 * 10) / 10);
    const baseOpacity = style.fillOpacity !== undefined ? style.fillOpacity : 0.2;
    const opacityMultiplier = faceOptions?.opacityMultiplier !== undefined ? faceOptions.opacityMultiplier : 1;
    const effectiveOpacity = Math.max(0.05, Math.min(1, baseOpacity * opacityMultiplier));
    const angleOffset = faceOptions?.patternAngleOffsetDeg ?? 0;
    const normAngle = ((Math.round(angleOffset) % 360) + 360) % 360;
    const cleanColor = fillColor.replace(/[^a-zA-Z0-9]/g, '');

    if (fillPattern === 'solid') {
        return {
            fillAttr: `fill="${escapeXml(fillColor)}" fill-opacity="${effectiveOpacity}"`,
        };
    }

    const rotSuffix = normAngle !== 0 ? `-rot${normAngle}` : '';
    const patternId = `apolo-fill-${fillPattern}-${cleanColor}${rotSuffix}-d${density}`;
    let patternSvg = '';

    if (fillPattern === 'hachure') {
        const totalRot = 45 + normAngle;
        patternSvg = `<pattern id="${patternId}" width="${s}" height="${s}" patternUnits="userSpaceOnUse" patternTransform="rotate(${totalRot})"><line x1="0" y1="0" x2="0" y2="${s}" stroke="${escapeXml(fillColor)}" stroke-width="${lineW}"/></pattern>`;
    } else if (fillPattern === 'cross-hatch') {
        const totalRot = 45 + normAngle;
        patternSvg = `<pattern id="${patternId}" width="${s}" height="${s}" patternUnits="userSpaceOnUse" patternTransform="rotate(${totalRot})"><line x1="0" y1="0" x2="0" y2="${s}" stroke="${escapeXml(fillColor)}" stroke-width="${lineW}"/><line x1="0" y1="0" x2="${s}" y2="0" stroke="${escapeXml(fillColor)}" stroke-width="${lineW}"/></pattern>`;
    } else if (fillPattern === 'dots') {
        const transformAttr = normAngle !== 0 ? ` patternTransform="rotate(${normAngle})"` : '';
        patternSvg = `<pattern id="${patternId}" width="${s}" height="${s}" patternUnits="userSpaceOnUse"${transformAttr}><circle cx="${s / 2}" cy="${s / 2}" r="${dotR}" fill="${escapeXml(fillColor)}"/></pattern>`;
    }

    return {
        fillAttr: `fill="url(#${patternId})" fill-opacity="${effectiveOpacity}"`,
        defs: { [patternId]: patternSvg },
    };
}

/**
 * Calculates squared distance from point (px, py) to line segment (x0, y0)-(x1, y1).
 */
export function distToSegmentSquared(
    px: number,
    py: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
): number {
    const l2 = (x1 - x0) ** 2 + (y1 - y0) ** 2;
    if (l2 === 0) return (px - x0) ** 2 + (py - y0) ** 2;
    let t = ((px - x0) * (x1 - x0) + (py - y0) * (y1 - y0)) / l2;
    t = Math.max(0, Math.min(1, t));
    return (px - (x0 + t * (x1 - x0))) ** 2 + (py - (y0 + t * (y1 - y0))) ** 2;
}

/**
 * Point-in-polygon ray casting algorithm.
 */
export function pointInPolygon(
    px: number,
    py: number,
    polygon: Array<[number, number]>,
): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0];
        const yi = polygon[i][1];
        const xj = polygon[j][0];
        const yj = polygon[j][1];
        const intersect = ((yi > py) !== (yj > py)) &&
            (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * Point inside axis-aligned bounding box test with tolerance.
 */
export function pointInBox(
    px: number,
    py: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    tolerance: number,
): boolean {
    return (
        px >= minX - tolerance &&
        px <= maxX + tolerance &&
        py >= minY - tolerance &&
        py <= maxY + tolerance
    );
}
