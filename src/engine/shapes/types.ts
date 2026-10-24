/**
 * src/engine/shapes/types.ts
 *
 * Core type definitions for the modular shape engine of Apolo Canvas 2.0.
 */

import type { BoundingBox, ShapeFillPattern, ShapeType, StrokePattern } from '../../core/types.ts';

export interface ShapeSvgOutput {
    defs?: Record<string, string>;
    body: string;
}

export interface ShapePoint {
    x: number;
    y: number;
}

export interface ShapeRenderGeometry {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    regularize?: boolean;
    /** Rectangle corner radius in the same space as x0..y1. */
    cornerRadius?: number;
    /** Quadratic Bezier control point for curved lines / arrows. */
    controlPoint?: ShapePoint;
    /** Independent vertex overrides (e.g. a free triangle). */
    vertices?: ShapePoint[];
}

export type ShapeHandleKind = 'endpoint' | 'corner' | 'curve' | 'radius' | 'vertex';

export interface ShapeHandle {
    readonly id: string;
    readonly kind: ShapeHandleKind;
    readonly x: number;
    readonly y: number;
}

/** Magnetic connection port (see ShapePortId in core/types.ts). */
export interface ShapeSnapPort {
    readonly id: string;
    readonly x: number;
    readonly y: number;
}

export interface ShapeStyleConfig {
    strokeColor?: string;
    strokeWidth?: number;
    strokePattern?: StrokePattern;
    strokeOpacity?: number;
    fillEnabled?: boolean;
    fillColor?: string;
    fillOpacity?: number;
    fillPattern?: ShapeFillPattern;
    fillDensity?: number;
}

export interface ShapePlugin {
    readonly id: ShapeType;
    readonly name: string;
    readonly isClosed: boolean; // true for rectangle, ellipse, triangle, diamond, etc.; false for line, arrow
    readonly iconSvgPaths: readonly string[]; // Normalized 24x24 icon paths for UI buttons
    normalizeGeometry(geom: ShapeRenderGeometry): ShapeRenderGeometry;
    renderCanvas(ctx: CanvasRenderingContext2D, geom: ShapeRenderGeometry, style: ShapeStyleConfig): void;
    renderSvg(geom: ShapeRenderGeometry, style: ShapeStyleConfig): ShapeSvgOutput;
    computeBounds(geom: ShapeRenderGeometry, strokeWidth: number): BoundingBox;
    hitTest(geom: ShapeRenderGeometry, point: { x: number; y: number }, tolerance: number): boolean;
    /** Editable control handles of the rendered (normalized) geometry. */
    getControlHandles(geom: ShapeRenderGeometry): ShapeHandle[];
    /** Returns the geometry produced by dragging `handleId` to `newPoint`; `geom` itself is not mutated. */
    applyHandleDrag(geom: ShapeRenderGeometry, handleId: string, newPoint: ShapePoint, regularize?: boolean): ShapeRenderGeometry;
    /** Ports where connector endpoints can magnetically attach. */
    getSnapPorts(geom: ShapeRenderGeometry): ShapeSnapPort[];
}

export type NormalizedPoint = [number, number];

export interface ShapeFaceFillOptions {
    /** Rotation offset in degrees for pattern fills ('hachure', 'cross-hatch', 'dots'), e.g. 0 for body, 90 for top cap */
    readonly patternAngleOffsetDeg?: number;
    /** Multiplier applied to base fillOpacity (e.g. 0.72 on top cap for natural 3D shading contrast in 'solid' mode) */
    readonly opacityMultiplier?: number;
}

export interface CustomPathSegment {
    type: 'M' | 'L' | 'C' | 'Q' | 'Z';
    args: number[]; // normalized [0..1] coordinates
}

export interface CustomShapeSubpath {
    commands: CustomPathSegment[];
    isClosed?: boolean;
    isFilled?: boolean;
    isStroked?: boolean;
    fillOptions?: ShapeFaceFillOptions;
}

export interface CustomShapeDefinition {
    id: ShapeType;
    name: string;
    isClosed?: boolean;
    iconSvgPaths?: readonly string[];
    polygon?: NormalizedPoint[];
    commands?: CustomPathSegment[];
    subpaths?: CustomShapeSubpath[];
}
