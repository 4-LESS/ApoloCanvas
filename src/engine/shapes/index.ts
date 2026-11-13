/**
 * src/engine/shapes/index.ts
 *
 * Central registry and public API for modular shape plugins in Apolo Canvas 2.0.
 */

import type { ShapeType } from '../../core/types.ts';
import type { ShapePlugin } from './types.ts';
import { lineShapePlugin } from './line.ts';
import { arrowShapePlugin } from './arrow.ts';
import { rectangleShapePlugin } from './rectangle.ts';
import { ellipseShapePlugin } from './ellipse.ts';
import { triangleShapePlugin } from './triangle.ts';
import {
    cylinderShapePlugin,
    diamondShapePlugin,
    hexagonShapePlugin,
} from './custom.ts';
import { blobShapePlugin } from './blob.ts';
import {
    capacitorShapePlugin,
    groundShapePlugin,
    powerSourceShapePlugin,
    resistorShapePlugin,
    transistorMosfetShapePlugin,
    transistorNpnShapePlugin,
    transistorPnpShapePlugin,
} from './electrical.ts';
import {
    gateAndShapePlugin,
    gateNandShapePlugin,
    gateNorShapePlugin,
    gateNotShapePlugin,
    gateOrShapePlugin,
    gateXnorShapePlugin,
    gateXorShapePlugin,
} from './logic.ts';

export * from './types.ts';
export * from './common.ts';
export * from './custom.ts';
export * from './blob.ts';
export * from './electrical.ts';
export * from './logic.ts';
export * from './handles.ts';
export * from './element.ts';
export * from './connectors.ts';
export * from './guides.ts';
export {
    lineShapePlugin,
    arrowShapePlugin,
    rectangleShapePlugin,
    ellipseShapePlugin,
    triangleShapePlugin,
    diamondShapePlugin,
    hexagonShapePlugin,
    cylinderShapePlugin,
    blobShapePlugin,
    resistorShapePlugin,
    capacitorShapePlugin,
    powerSourceShapePlugin,
    groundShapePlugin,
    transistorNpnShapePlugin,
    transistorPnpShapePlugin,
    transistorMosfetShapePlugin,
    gateAndShapePlugin,
    gateOrShapePlugin,
    gateNotShapePlugin,
    gateNandShapePlugin,
    gateNorShapePlugin,
    gateXorShapePlugin,
    gateXnorShapePlugin,
};

export const SHAPE_REGISTRY: Record<string, ShapePlugin> = {
    line: lineShapePlugin,
    arrow: arrowShapePlugin,
    rectangle: rectangleShapePlugin,
    rect: rectangleShapePlugin, // Legacy alias
    'rounded-rect': rectangleShapePlugin, // Legacy alias
    ellipse: ellipseShapePlugin,
    circle: ellipseShapePlugin, // UI alias
    triangle: triangleShapePlugin,
    diamond: diamondShapePlugin,
    hexagon: hexagonShapePlugin,
    cylinder: cylinderShapePlugin,
    blob: blobShapePlugin,
    resistor: resistorShapePlugin,
    capacitor: capacitorShapePlugin,
    'power-source': powerSourceShapePlugin,
    'voltage-source': powerSourceShapePlugin, // Alias
    ground: groundShapePlugin,
    'transistor-npn': transistorNpnShapePlugin,
    npn: transistorNpnShapePlugin, // Alias
    'transistor-pnp': transistorPnpShapePlugin,
    pnp: transistorPnpShapePlugin, // Alias
    'transistor-mosfet': transistorMosfetShapePlugin,
    mosfet: transistorMosfetShapePlugin, // Alias
    'gate-and': gateAndShapePlugin,
    and: gateAndShapePlugin, // Alias
    'gate-or': gateOrShapePlugin,
    or: gateOrShapePlugin, // Alias
    'gate-not': gateNotShapePlugin,
    not: gateNotShapePlugin, // Alias
    inverter: gateNotShapePlugin, // Alias
    'gate-nand': gateNandShapePlugin,
    nand: gateNandShapePlugin, // Alias
    'gate-nor': gateNorShapePlugin,
    nor: gateNorShapePlugin, // Alias
    'gate-xor': gateXorShapePlugin,
    xor: gateXorShapePlugin, // Alias
    'gate-xnor': gateXnorShapePlugin,
    xnor: gateXnorShapePlugin, // Alias
};

/**
 * Registers a new shape plugin into the runtime shape registry.
 */
export function registerShapePlugin(plugin: ShapePlugin): void {
    SHAPE_REGISTRY[plugin.id] = plugin;
}

/**
 * Resolves a ShapePlugin for the given shapeType, falling back to 'rectangle' if unmapped.
 */
export function getShapePlugin(shapeType?: ShapeType | string): ShapePlugin {
    if (shapeType && shapeType in SHAPE_REGISTRY) {
        return SHAPE_REGISTRY[shapeType];
    }
    return rectangleShapePlugin;
}

/**
 * Returns a list of unique registered shape plugins.
 */
export function listShapePlugins(): ShapePlugin[] {
    const seen = new Set<ShapePlugin>();
    const list: ShapePlugin[] = [];
    for (const plugin of Object.values(SHAPE_REGISTRY)) {
        if (!seen.has(plugin)) {
            seen.add(plugin);
            list.push(plugin);
        }
    }
    return list;
}
