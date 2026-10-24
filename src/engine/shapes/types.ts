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

export interface ShapeRenderGeometry {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    regularize?: boolean;
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
