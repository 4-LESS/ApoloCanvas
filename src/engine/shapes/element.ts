/**
 * src/engine/shapes/element.ts
 *
 * Conversions between normalized ShapeElement data (column-width units relative to
 * an anchor origin) and ShapeRenderGeometry in document / export space.
 */

import type { NormalizedShapePoint, ShapeElement } from '../../core/types.ts';
import type { ShapeRenderGeometry, ShapeStyleConfig } from './types.ts';
import { getShapePlugin } from './index.ts';
import { linearPathBounds } from './handles.ts';

/** Builds the render geometry of `element` for an anchor at (originX, originY) and column width `scale`. */
export function shapeElementToGeometry(
    element: ShapeElement,
    originX: number,
    originY: number,
    scale: number,
): ShapeRenderGeometry {
    const geom: ShapeRenderGeometry = {
        x0: originX + element.startX * scale,
        y0: originY + element.startY * scale,
        x1: originX + element.endX * scale,
        y1: originY + element.endY * scale,
        regularize: element.regularize,
    };
    if (element.cornerRadius !== undefined && element.cornerRadius > 0) {
        geom.cornerRadius = element.cornerRadius * scale;
    }
    if (element.controlPoint) {
        geom.controlPoint = {
            x: originX + element.controlPoint.x * scale,
            y: originY + element.controlPoint.y * scale,
        };
    }
    if (element.vertices && element.vertices.length > 0) {
        geom.vertices = element.vertices.map(v => ({ x: originX + v.x * scale, y: originY + v.y * scale }));
    }
    return geom;
}

/**
 * Writes `geom` back into `element` (normalized), replacing parametric fields with fresh
 * objects so history snapshots never share mutable state, and refreshes `bounds`.
 */
export function applyGeometryToShapeElement(
    element: ShapeElement,
    geom: ShapeRenderGeometry,
    originX: number,
    originY: number,
    scale: number,
): void {
    const safeScale = scale || 1;
    const toU = (x: number) => (x - originX) / safeScale;
    const toV = (y: number) => (y - originY) / safeScale;

    element.startX = toU(geom.x0);
    element.startY = toV(geom.y0);
    element.endX = toU(geom.x1);
    element.endY = toV(geom.y1);

    if (geom.cornerRadius !== undefined && geom.cornerRadius > 0) {
        element.cornerRadius = geom.cornerRadius / safeScale;
    } else {
        delete element.cornerRadius;
    }
    if (geom.controlPoint) {
        element.controlPoint = { x: toU(geom.controlPoint.x), y: toV(geom.controlPoint.y) };
    } else {
        delete element.controlPoint;
    }
    if (geom.vertices && geom.vertices.length > 0) {
        element.vertices = geom.vertices.map(v => ({ x: toU(v.x), y: toV(v.y) }));
        // Detached vertices are never re-regularized
        element.regularize = false;
    } else {
        delete element.vertices;
    }

    refreshShapeElementBounds(element);
}

/**
 * Recomputes normalized `bounds` from the element's own points (endpoints, vertices,
 * curve extrema). Pixel-sized decorations such as arrowheads are left to computeBounds().
 */
export function refreshShapeElementBounds(element: ShapeElement): void {
    const geom = getShapePlugin(element.shapeType).normalizeGeometry(shapeElementToGeometry(element, 0, 0, 1));
    const xs = [geom.x0, geom.x1];
    const ys = [geom.y0, geom.y1];
    if (geom.vertices) {
        for (const v of geom.vertices) {
            xs.push(v.x);
            ys.push(v.y);
        }
    }
    if (geom.controlPoint) {
        const curve = linearPathBounds(geom);
        xs.push(curve.minX, curve.maxX);
        ys.push(curve.minY, curve.maxY);
    }
    element.bounds = {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
    };
}

/** Applies `map` to every normalized point of the element (start, end, control point, vertices). */
export function mapShapeElementPoints(
    element: ShapeElement,
    map: (u: number, v: number) => NormalizedShapePoint,
    radiusScale = 1,
): void {
    const start = map(element.startX, element.startY);
    const end = map(element.endX, element.endY);
    element.startX = start.x;
    element.startY = start.y;
    element.endX = end.x;
    element.endY = end.y;
    if (element.controlPoint) {
        element.controlPoint = map(element.controlPoint.x, element.controlPoint.y);
    }
    if (element.vertices) {
        element.vertices = element.vertices.map(v => map(v.x, v.y));
    }
    if (element.cornerRadius !== undefined) {
        element.cornerRadius *= radiusScale;
    }
    refreshShapeElementBounds(element);
}

/**
 * Validates parametric / binding fields of a ShapeElement read from disk, dropping malformed
 * values instead of letting them reach the renderer.
 */
export function sanitizeLoadedShapeElement(element: ShapeElement): void {
    const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
    const isPoint = (p: unknown): boolean =>
        Boolean(p) && isFiniteNumber((p as NormalizedShapePoint).x) && isFiniteNumber((p as NormalizedShapePoint).y);
    const isBinding = (b: unknown): boolean =>
        Boolean(b) && typeof (b as { elementId?: unknown }).elementId === 'string' && typeof (b as { portId?: unknown }).portId === 'string';

    if (element.cornerRadius !== undefined && !(isFiniteNumber(element.cornerRadius) && element.cornerRadius >= 0)) {
        delete element.cornerRadius;
    }
    if (element.controlPoint !== undefined && !isPoint(element.controlPoint)) {
        delete element.controlPoint;
    }
    if (element.vertices !== undefined && !(Array.isArray(element.vertices) && element.vertices.length === 3 && element.vertices.every(isPoint))) {
        delete element.vertices;
    }
    if (element.startBinding !== undefined && element.startBinding !== null && !isBinding(element.startBinding)) {
        element.startBinding = null;
    }
    if (element.endBinding !== undefined && element.endBinding !== null && !isBinding(element.endBinding)) {
        element.endBinding = null;
    }
}

/** Render style of a ShapeElement, with optional overrides (e.g. link halo). */
export function shapeElementStyle(element: ShapeElement, override?: Partial<ShapeStyleConfig>): ShapeStyleConfig {
    return {
        strokeColor: element.style.color,
        strokeWidth: element.style.width,
        strokePattern: element.style.pattern,
        strokeOpacity: element.style.opacity,
        fillEnabled: element.fillEnabled,
        fillColor: element.fillColor,
        fillOpacity: element.fillOpacity,
        fillPattern: element.fillPattern,
        fillDensity: element.fillDensity,
        ...override,
    };
}
