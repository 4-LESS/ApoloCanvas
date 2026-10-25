/**
 * src/engine/shapes/element.ts
 *
 * Conversions between normalized ShapeElement data (column-width units relative to
 * an anchor origin) and ShapeRenderGeometry in document / export space.
 */

import type { NormalizedShapePoint, ShapeElement, ShapePathNode } from '../../core/types.ts';
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
    if (element.rotation !== undefined) {
        geom.rotation = element.rotation;
    }
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
    if (element.shapeParams) {
        geom.shapeParams = { ...element.shapeParams };
    }
    if (element.pathNodes && element.pathNodes.length >= 2) {
        geom.pathNodes = element.pathNodes.map(n => ({
            x: originX + n.x * scale,
            y: originY + n.y * scale,
            handleIn: n.handleIn ? { x: originX + n.handleIn.x * scale, y: originY + n.handleIn.y * scale } : undefined,
            handleOut: n.handleOut ? { x: originX + n.handleOut.x * scale, y: originY + n.handleOut.y * scale } : undefined,
            nodeKind: n.nodeKind,
        }));
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

    if (geom.rotation !== undefined && Number.isFinite(geom.rotation)) {
        element.rotation = geom.rotation;
    } else {
        delete element.rotation;
    }

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
    if (geom.shapeParams) {
        element.shapeParams = { ...geom.shapeParams };
    } else {
        delete element.shapeParams;
    }
    if (geom.pathNodes && geom.pathNodes.length >= 2) {
        element.pathNodes = geom.pathNodes.map(n => ({
            x: toU(n.x),
            y: toV(n.y),
            handleIn: n.handleIn ? { x: toU(n.handleIn.x), y: toV(n.handleIn.y) } : undefined,
            handleOut: n.handleOut ? { x: toU(n.handleOut.x), y: toV(n.handleOut.y) } : undefined,
            nodeKind: n.nodeKind,
        }));
        element.startX = element.pathNodes[0].x;
        element.startY = element.pathNodes[0].y;
        element.endX = element.pathNodes[element.pathNodes.length - 1].x;
        element.endY = element.pathNodes[element.pathNodes.length - 1].y;
    } else {
        delete element.pathNodes;
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
    if (geom.controlPoint || geom.pathNodes) {
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

/** Applies `map` to every normalized point of the element (start, end, control point, vertices, pathNodes). */
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
    if (element.pathNodes) {
        element.pathNodes = element.pathNodes.map(n => {
            const pt = map(n.x, n.y);
            const inPt = n.handleIn ? map(n.handleIn.x, n.handleIn.y) : undefined;
            const outPt = n.handleOut ? map(n.handleOut.x, n.handleOut.y) : undefined;
            return {
                x: pt.x,
                y: pt.y,
                handleIn: inPt,
                handleOut: outPt,
                nodeKind: n.nodeKind,
            };
        });
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

    if (element.rotation !== undefined && !isFiniteNumber(element.rotation)) {
        delete element.rotation;
    }
    if (element.cornerRadius !== undefined && !(isFiniteNumber(element.cornerRadius) && element.cornerRadius >= 0)) {
        delete element.cornerRadius;
    }
    if (element.controlPoint !== undefined && !isPoint(element.controlPoint)) {
        delete element.controlPoint;
    }
    if (element.vertices !== undefined && !(Array.isArray(element.vertices) && element.vertices.length === 3 && element.vertices.every(isPoint))) {
        delete element.vertices;
    }
    if (element.pathNodes !== undefined) {
        if (!Array.isArray(element.pathNodes) || element.pathNodes.length < 2 || !element.pathNodes.every(isPoint)) {
            delete element.pathNodes;
        }
    }
    if (element.shapeParams !== undefined) {
        if (typeof element.shapeParams !== 'object' || element.shapeParams === null) {
            delete element.shapeParams;
        }
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
