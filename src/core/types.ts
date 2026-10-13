/**
 * Core type definitions for Apolo Canvas 2.0.
 */

export interface Point {
    x: number;
    y: number;
    pressure?: number;
    time?: number;
}

export interface BoundingBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export type StrokePattern = 'solid' | 'dashed' | 'dotted';

export interface StrokeStyle {
    color: string;
    width: number;
    pattern: StrokePattern;
    opacity: number;
    lineCap?: 'round' | 'square' | 'butt';
    profile?: PenProfileId;
    isHighlighter?: boolean;
}

export type ShapeType = 'line' | 'arrow' | 'rect' | 'rounded-rect' | 'ellipse' | 'triangle';

export type ToolType = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'shape' | 'link';

export type ToolbarSlot = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';

export type PenProfileId = 'fountain' | 'calli' | 'ball' | 'pencil' | 'hlr' | 'hlf';

export interface PenProfile {
    id: PenProfileId;
    name: string;
    wm: number;
    op: number;
    cap: 'round' | 'square' | 'butt';
    dash: string;
}

export interface PenFavorite {
    profile: PenProfileId;
    color: string;
    width: number;
}

export type EraserMode = 'whole' | 'reticle';

export type LassoMode = 'free' | 'rect';

export type ThicknessPreset = 'fine' | 'medium' | 'thick';

export interface InkElementBase {
    id: string;
    timestamp: number;
    blockId: string;        // Markdown block/paragraph anchor ID in CodeMirror (e.g. line:N)
    anchorText?: string;    // Source line fingerprint used to keep ink with edited text
    url?: string;           // Obsidian WikiLink (e.g. [[Note#Heading]]) or URL
    zIndex: number;
}

export interface StrokeElement extends InkElementBase {
    type: 'stroke';
    points: number[];       // Interleaved: [u0, v0, p0, t0, u1, v1, p1, t1, ...] normalized by column width
    style: StrokeStyle;
    bounds: BoundingBox;    // Normalized bounds: minU, minV, maxU, maxV
}

export interface ShapeElement extends InkElementBase {
    type: 'shape';
    shapeType: ShapeType;
    startX: number;         // u0 normalized by column width
    startY: number;         // v0 normalized by column width
    endX: number;           // u1 normalized by column width
    endY: number;           // v1 normalized by column width
    style: StrokeStyle;
    fillColor?: string;
    rotation?: number;      // Radians
    bounds: BoundingBox;    // Normalized bounds: minU, minV, maxU, maxV
}

export type CanvasElement = StrokeElement | ShapeElement;

export type BoxGridStyle = 'dots' | 'grid' | 'ruled' | 'none';
export type BoxBgTheme = 'default' | 'pitch-black' | 'graphite' | 'transparent';
export type BoxAccentColor = 'purple' | 'blue' | 'emerald' | 'amber' | 'coral' | 'neutral' | 'none';

export interface BoxMetadata {
    height: number;
    lastTop?: number;
    gridVisible?: boolean;
    gridStyle?: BoxGridStyle;
    gridDensity?: number; // e.g. 16, 24, 32, 40
    snapToGrid?: boolean;
    bgTheme?: BoxBgTheme;
    customBgColor?: string;
    accentColor?: BoxAccentColor;
    borderOutline?: boolean;
}

export interface LayoutHint {
    contentWidth: number;
    contentLeft: number;
    updatedAt: number;
    anchorTops?: Record<string, number>;
}

export interface PageDocument {
    schemaVersion: 1;
    version: number;
    id: string;             // apolo-page-id UUID
    notePath: string;       // Vault path of parent note
    elements: CanvasElement[];
    boxes?: Record<string, BoxMetadata>;  // Source of truth for box heights and properties
    layoutHint?: LayoutHint;              // Layout snapshot for offline SVG export
    createdAt: number;
    updatedAt: number;
}

/** High-performance element cloning for fast undo/redo and persistence snapshots. */
export function cloneElements(elements: readonly CanvasElement[]): CanvasElement[] {
    return elements.map(el => {
        if (el.type === 'stroke') {
            return {
                ...el,
                points: el.points.slice(),
                style: { ...el.style },
                bounds: { ...el.bounds },
            };
        } else {
            return {
                ...el,
                style: { ...el.style },
                bounds: { ...el.bounds },
            };
        }
    });
}
