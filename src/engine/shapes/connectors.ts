/**
 * src/engine/shapes/connectors.ts
 *
 * Magnetic auto-connect: lines / arrows whose endpoints are glued to the ports of other shapes
 * (ShapeElement.startBinding / endBinding) and follow them when those shapes move or reshape.
 * Connectors keep their direct or quadratic-curved port-to-port path (no obstacle routing).
 */

import type { CanvasElement, ShapeConnectorBinding, ShapeElement } from '../../core/types.ts';
import type { ShapePoint, ShapeRenderGeometry } from './types.ts';
import { getShapePlugin } from './index.ts';
import { applyLinearHandleDrag } from './handles.ts';

/** Screen-space distance within which a connector endpoint snaps to a port. */
export const MAGNETIC_SNAP_RADIUS_PX = 14;

export type ConnectorEnd = 'start' | 'end';

export interface SnapPortHit {
    elementId: string;
    portId: string;
    x: number;
    y: number;
}

/** Maps ShapeElements to / from document-space geometry (anchor-aware, supplied by the caller). */
export interface ConnectorGeometryAdapter {
    getGeometry(element: ShapeElement): ShapeRenderGeometry;
    setGeometry(element: ShapeElement, geom: ShapeRenderGeometry): void;
}

export function isConnectorShape(element: CanvasElement): element is ShapeElement {
    return element.type === 'shape' && !getShapePlugin(element.shapeType).isClosed;
}

export function getBinding(connector: ShapeElement, end: ConnectorEnd): ShapeConnectorBinding | null {
    return (end === 'start' ? connector.startBinding : connector.endBinding) ?? null;
}

export function setBinding(connector: ShapeElement, end: ConnectorEnd, binding: ShapeConnectorBinding | null): void {
    if (end === 'start') connector.startBinding = binding;
    else connector.endBinding = binding;
}

/** Nearest port of a closed shape within `radius` of `point` (document space). */
export function findNearestSnapPort(
    elements: readonly CanvasElement[],
    point: ShapePoint,
    radius: number,
    adapter: Pick<ConnectorGeometryAdapter, 'getGeometry'>,
    excludeId?: string,
): SnapPortHit | null {
    let best: SnapPortHit | null = null;
    let bestDistance = radius;
    for (const element of elements) {
        if (element.type !== 'shape' || element.id === excludeId) continue;
        const plugin = getShapePlugin(element.shapeType);
        if (!plugin.isClosed) continue;
        for (const port of plugin.getSnapPorts(adapter.getGeometry(element))) {
            const distance = Math.hypot(port.x - point.x, port.y - point.y);
            if (distance <= bestDistance) {
                bestDistance = distance;
                best = { elementId: element.id, portId: port.id, x: port.x, y: port.y };
            }
        }
    }
    return best;
}

/** Current document position of a bound port, or null when the target or port no longer exists. */
export function resolveBindingPoint(
    elements: readonly CanvasElement[],
    binding: ShapeConnectorBinding,
    adapter: Pick<ConnectorGeometryAdapter, 'getGeometry'>,
): ShapePoint | null {
    const target = elements.find(el => el.id === binding.elementId);
    if (!target || target.type !== 'shape') return null;
    const port = getShapePlugin(target.shapeType)
        .getSnapPorts(adapter.getGeometry(target))
        .find(p => p.id === binding.portId);
    return port ? { x: port.x, y: port.y } : null;
}

/**
 * Re-glues every connector endpoint bound to one of `changedIds` onto its port's new position.
 * Dangling bindings (deleted target / unknown port) are cleared. Returns the connectors updated.
 */
export function followBoundConnectors(
    elements: readonly CanvasElement[],
    changedIds: ReadonlySet<string>,
    adapter: ConnectorGeometryAdapter,
): ShapeElement[] {
    const updated: ShapeElement[] = [];
    for (const element of elements) {
        if (!isConnectorShape(element)) continue;
        let geom: ShapeRenderGeometry | null = null;
        for (const end of ['start', 'end'] as const) {
            const binding = getBinding(element, end);
            if (!binding || !changedIds.has(binding.elementId)) continue;
            const point = resolveBindingPoint(elements, binding, adapter);
            if (!point) {
                setBinding(element, end, null);
                continue;
            }
            const current = geom ?? getShapePlugin(element.shapeType).normalizeGeometry(adapter.getGeometry(element));
            geom = applyLinearHandleDrag(current, end, point, false);
        }
        if (geom) {
            element.regularize = false;
            adapter.setGeometry(element, geom);
            updated.push(element);
        }
    }
    return updated;
}

/** Clears bindings that point at elements no longer in `elements`. Returns true if anything changed. */
export function clearDanglingBindings(elements: readonly CanvasElement[]): boolean {
    const ids = new Set(elements.map(el => el.id));
    let changed = false;
    for (const element of elements) {
        if (element.type !== 'shape') continue;
        for (const end of ['start', 'end'] as const) {
            const binding = getBinding(element, end);
            if (binding && !ids.has(binding.elementId)) {
                setBinding(element, end, null);
                changed = true;
            }
        }
    }
    return changed;
}

/**
 * Connectors moved on their own (without their target) leave the port, so their bindings
 * to targets outside `movedIds` are released.
 */
export function releaseDetachedBindings(moved: readonly CanvasElement[]): void {
    const movedIds = new Set(moved.map(el => el.id));
    for (const element of moved) {
        if (element.type !== 'shape') continue;
        for (const end of ['start', 'end'] as const) {
            const binding = getBinding(element, end);
            if (binding && !movedIds.has(binding.elementId)) setBinding(element, end, null);
        }
    }
}
