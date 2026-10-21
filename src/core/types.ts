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

export type FavoritableTool = 'pen' | 'highlighter' | 'shape';

export interface BaseFavoritePreset {
    id: string;
    tool: FavoritableTool;
    name?: string;
    color: string;
    width: number;
    opacity: number; // normalized 0..1 or 10..100 matching WorkspaceToolState convention
    pattern: StrokePattern;
    createdAt: number;
}

export interface PenFavoritePreset extends BaseFavoritePreset {
    tool: 'pen';
    profileId: PenProfileId;
    smoothing?: number;
    straightenLines?: boolean;
}

export interface HighlighterFavoritePreset extends BaseFavoritePreset {
    tool: 'highlighter';
    profileId: 'hlf' | 'hlr';
    straightenLines?: boolean;
}

export interface ShapeFavoritePreset extends BaseFavoritePreset {
    tool: 'shape';
    shapeType: ShapeType;
    fillEnabled?: boolean;
    fillColor?: string;
    fillOpacity?: number;
}

export type ToolFavoritePreset =
    | PenFavoritePreset
    | HighlighterFavoritePreset
    | ShapeFavoritePreset;

export interface StrokeFavoriteProfile {
    id: string;
    name: string;
    pen: PenFavoritePreset[];
    highlighter: HighlighterFavoritePreset[];
}

export interface ShapeFavoriteProfile {
    id: string;
    name: string;
    shape: ShapeFavoritePreset[];
}

export type EraserMode = 'whole' | 'reticle';

export type LassoMode = 'free' | 'rect';

export type ThicknessPreset = 'fine' | 'medium' | 'thick';

export interface WorkspaceToolState {
    penEnabled: boolean;
    activeTool: ToolType;
    snapGrid: boolean;
    pen: {
        profileId: PenProfileId; // 'fountain' | 'calli' | 'ball' | 'pencil'
        color: string;
        width: number;
        opacity: number;
        smoothing: number;
        pattern: StrokePattern;
        straightenLines: boolean;
        activeSlotIndex: number;
        palette: { colors: string[]; opacities: number[] };
    };
    highlighter: {
        profileId: 'hlf' | 'hlr';
        color: string;
        width: number;
        opacity: number;
        pattern: StrokePattern;
        straightenLines: boolean;
        activeSlotIndex: number;
        palette: { colors: string[]; opacities: number[] };
    };
    shape: {
        shapeType: ShapeType;
        color: string;
        width: number;
        opacity: number;
        pattern: StrokePattern;
        fillEnabled?: boolean;
        fillColor?: string;
        fillOpacity?: number;
        activeSlotIndex: number;
        palette: { colors: string[]; opacities: number[] };
    };
    eraser: {
        mode: EraserMode;
        radius: number;
        onlyHighlighter: boolean;
        scribbleToErase: boolean;
    };
    lasso: {
        mode: LassoMode;
    };
    favorites: {
        pen: PenFavoritePreset[];
        highlighter: HighlighterFavoritePreset[];
        shape: ShapeFavoritePreset[];
    };
    strokeFavoriteProfiles: StrokeFavoriteProfile[];
    activeStrokeProfileId: string;
    shapeFavoriteProfiles: ShapeFavoriteProfile[];
    activeShapeProfileId: string;
    syncFavoriteProfiles: boolean;
}

export const DEFAULT_STROKE_FAVORITE_PROFILES: StrokeFavoriteProfile[] = [
    { id: 'notes', name: 'Notas', pen: [], highlighter: [] },
    { id: 'academic', name: 'Académico', pen: [], highlighter: [] },
    { id: 'engineering', name: 'Ingeniería', pen: [], highlighter: [] },
];

export const DEFAULT_SHAPE_FAVORITE_PROFILES: ShapeFavoriteProfile[] = [
    { id: 'general', name: 'General', shape: [] },
    { id: 'diagrams', name: 'Diagramas', shape: [] },
    { id: 'engineering', name: 'Ingeniería', shape: [] },
];

export const DEFAULT_WORKSPACE_TOOL_STATE: WorkspaceToolState = {
    penEnabled: true,
    activeTool: 'pen',
    snapGrid: false,
    pen: {
        profileId: 'fountain',
        color: '#1F4FD8',
        width: 3,
        opacity: 1,
        smoothing: 0.6,
        pattern: 'solid',
        straightenLines: false,
        activeSlotIndex: 0,
        palette: {
            colors: ['#E53935', '#1F4FD8', '#10B981', '#111827'],
            opacities: [100, 100, 100, 100],
        },
    },
    highlighter: {
        profileId: 'hlr',
        color: '#FDD835',
        width: 20,
        opacity: 0.75,
        pattern: 'solid',
        straightenLines: false,
        activeSlotIndex: 1,
        palette: {
            colors: ['#1E88E5', '#FDD835', '#43A047', '#00ACC1'],
            opacities: [75, 75, 75, 75],
        },
    },
    shape: {
        shapeType: 'rect',
        color: '#2F6BFF',
        width: 3,
        opacity: 1,
        pattern: 'solid',
        fillEnabled: false,
        fillColor: '',
        fillOpacity: 1,
        activeSlotIndex: 0,
        palette: {
            colors: ['#2F6BFF', '#111827', '#FFA726', '#10B981'],
            opacities: [100, 100, 100, 100],
        },
    },
    eraser: {
        mode: 'whole',
        radius: 18,
        onlyHighlighter: false,
        scribbleToErase: true,
    },
    lasso: {
        mode: 'free',
    },
    favorites: {
        pen: [],
        highlighter: [],
        shape: [],
    },
    strokeFavoriteProfiles: [
        { id: 'notes', name: 'Notas', pen: [], highlighter: [] },
        { id: 'academic', name: 'Académico', pen: [], highlighter: [] },
        { id: 'engineering', name: 'Ingeniería', pen: [], highlighter: [] },
    ],
    activeStrokeProfileId: 'notes',
    shapeFavoriteProfiles: [
        { id: 'general', name: 'General', shape: [] },
        { id: 'diagrams', name: 'Diagramas', shape: [] },
        { id: 'engineering', name: 'Ingeniería', shape: [] },
    ],
    activeShapeProfileId: 'general',
    syncFavoriteProfiles: false,
};

export function cloneWorkspaceToolState(state: WorkspaceToolState): WorkspaceToolState {
    const strokeProfiles: StrokeFavoriteProfile[] = Array.isArray(state.strokeFavoriteProfiles) && state.strokeFavoriteProfiles.length > 0
        ? state.strokeFavoriteProfiles.map(sp => ({
            id: sp.id,
            name: sp.name,
            pen: Array.isArray(sp.pen) ? sp.pen.map(p => ({ ...p })) : [],
            highlighter: Array.isArray(sp.highlighter) ? sp.highlighter.map(h => ({ ...h })) : [],
        }))
        : DEFAULT_STROKE_FAVORITE_PROFILES.map(sp => ({ ...sp, pen: [], highlighter: [] }));

    const activeStrokeId = state.activeStrokeProfileId && strokeProfiles.some(p => p.id === state.activeStrokeProfileId)
        ? state.activeStrokeProfileId
        : strokeProfiles[0].id;

    const shapeProfiles: ShapeFavoriteProfile[] = Array.isArray(state.shapeFavoriteProfiles) && state.shapeFavoriteProfiles.length > 0
        ? state.shapeFavoriteProfiles.map(shp => ({
            id: shp.id,
            name: shp.name,
            shape: Array.isArray(shp.shape) ? shp.shape.map(s => ({ ...s })) : [],
        }))
        : DEFAULT_SHAPE_FAVORITE_PROFILES.map(shp => ({ ...shp, shape: [] }));

    const activeShapeId = state.activeShapeProfileId && shapeProfiles.some(p => p.id === state.activeShapeProfileId)
        ? state.activeShapeProfileId
        : shapeProfiles[0].id;

    const activeStroke = strokeProfiles.find(p => p.id === activeStrokeId) || strokeProfiles[0];
    const activeShape = shapeProfiles.find(p => p.id === activeShapeId) || shapeProfiles[0];

    // Mirror any directly set legacy favorites if active profile was empty
    if (Array.isArray(state.favorites?.pen) && state.favorites.pen.length > 0 && activeStroke.pen.length === 0) {
        activeStroke.pen = state.favorites.pen.map(p => ({ ...p }));
    }
    if (Array.isArray(state.favorites?.highlighter) && state.favorites.highlighter.length > 0 && activeStroke.highlighter.length === 0) {
        activeStroke.highlighter = state.favorites.highlighter.map(h => ({ ...h }));
    }
    if (Array.isArray(state.favorites?.shape) && state.favorites.shape.length > 0 && activeShape.shape.length === 0) {
        activeShape.shape = state.favorites.shape.map(s => ({ ...s }));
    }

    return {
        penEnabled: state.penEnabled,
        activeTool: state.activeTool,
        snapGrid: state.snapGrid,
        pen: {
            profileId: state.pen.profileId,
            color: state.pen.color,
            width: state.pen.width,
            opacity: state.pen.opacity,
            smoothing: state.pen.smoothing,
            pattern: state.pen.pattern,
            straightenLines: state.pen.straightenLines,
            activeSlotIndex: state.pen.activeSlotIndex,
            palette: {
                colors: [...state.pen.palette.colors],
                opacities: [...state.pen.palette.opacities],
            },
        },
        highlighter: {
            profileId: state.highlighter.profileId,
            color: state.highlighter.color,
            width: state.highlighter.width,
            opacity: state.highlighter.opacity,
            pattern: state.highlighter.pattern,
            straightenLines: state.highlighter.straightenLines,
            activeSlotIndex: state.highlighter.activeSlotIndex,
            palette: {
                colors: [...state.highlighter.palette.colors],
                opacities: [...state.highlighter.palette.opacities],
            },
        },
        shape: {
            shapeType: state.shape.shapeType,
            color: state.shape.color,
            width: state.shape.width,
            opacity: state.shape.opacity,
            pattern: state.shape.pattern,
            fillEnabled: state.shape.fillEnabled,
            fillColor: state.shape.fillColor,
            fillOpacity: state.shape.fillOpacity,
            activeSlotIndex: state.shape.activeSlotIndex,
            palette: {
                colors: [...state.shape.palette.colors],
                opacities: [...state.shape.palette.opacities],
            },
        },
        eraser: {
            mode: state.eraser.mode,
            radius: state.eraser.radius,
            onlyHighlighter: state.eraser.onlyHighlighter,
            scribbleToErase: state.eraser.scribbleToErase,
        },
        lasso: {
            mode: state.lasso.mode,
        },
        favorites: {
            pen: activeStroke.pen.map(p => ({ ...p })),
            highlighter: activeStroke.highlighter.map(h => ({ ...h })),
            shape: activeShape.shape.map(s => ({ ...s })),
        },
        strokeFavoriteProfiles: strokeProfiles,
        activeStrokeProfileId: activeStrokeId,
        shapeFavoriteProfiles: shapeProfiles,
        activeShapeProfileId: activeShapeId,
        syncFavoriteProfiles: Boolean(state.syncFavoriteProfiles),
    };
}

export function mergeWorkspaceToolState(
    saved?: Partial<WorkspaceToolState> | null,
    fallback: WorkspaceToolState = DEFAULT_WORKSPACE_TOOL_STATE,
): WorkspaceToolState {
    if (!saved) return cloneWorkspaceToolState(fallback);

    // Hydrate stroke profiles
    const strokeProfiles: StrokeFavoriteProfile[] = Array.isArray(saved.strokeFavoriteProfiles) && saved.strokeFavoriteProfiles.length > 0
        ? saved.strokeFavoriteProfiles.map(sp => ({
            id: sp.id,
            name: sp.name,
            pen: Array.isArray(sp.pen) ? sp.pen.map(p => ({ ...p })) : [],
            highlighter: Array.isArray(sp.highlighter) ? sp.highlighter.map(h => ({ ...h })) : [],
        }))
        : (Array.isArray(fallback.strokeFavoriteProfiles) && fallback.strokeFavoriteProfiles.length > 0
            ? fallback.strokeFavoriteProfiles.map(sp => ({
                id: sp.id,
                name: sp.name,
                pen: Array.isArray(sp.pen) ? sp.pen.map(p => ({ ...p })) : [],
                highlighter: Array.isArray(sp.highlighter) ? sp.highlighter.map(h => ({ ...h })) : [],
            }))
            : DEFAULT_STROKE_FAVORITE_PROFILES.map(sp => ({ ...sp, pen: [], highlighter: [] })));

    const activeStrokeId = saved.activeStrokeProfileId && strokeProfiles.some(p => p.id === saved.activeStrokeProfileId)
        ? saved.activeStrokeProfileId
        : (fallback.activeStrokeProfileId && strokeProfiles.some(p => p.id === fallback.activeStrokeProfileId)
            ? fallback.activeStrokeProfileId
            : strokeProfiles[0].id);

    // Hydrate shape profiles
    const shapeProfiles: ShapeFavoriteProfile[] = Array.isArray(saved.shapeFavoriteProfiles) && saved.shapeFavoriteProfiles.length > 0
        ? saved.shapeFavoriteProfiles.map(shp => ({
            id: shp.id,
            name: shp.name,
            shape: Array.isArray(shp.shape) ? shp.shape.map(s => ({ ...s })) : [],
        }))
        : (Array.isArray(fallback.shapeFavoriteProfiles) && fallback.shapeFavoriteProfiles.length > 0
            ? fallback.shapeFavoriteProfiles.map(shp => ({
                id: shp.id,
                name: shp.name,
                shape: Array.isArray(shp.shape) ? shp.shape.map(s => ({ ...s })) : [],
            }))
            : DEFAULT_SHAPE_FAVORITE_PROFILES.map(shp => ({ ...shp, shape: [] })));

    const activeShapeId = saved.activeShapeProfileId && shapeProfiles.some(p => p.id === saved.activeShapeProfileId)
        ? saved.activeShapeProfileId
        : (fallback.activeShapeProfileId && shapeProfiles.some(p => p.id === fallback.activeShapeProfileId)
            ? fallback.activeShapeProfileId
            : shapeProfiles[0].id);

    const activeStroke = strokeProfiles.find(p => p.id === activeStrokeId) || strokeProfiles[0];
    const activeShape = shapeProfiles.find(p => p.id === activeShapeId) || shapeProfiles[0];

    // Legacy migration: if saved.favorites has presets but active profile is empty
    if (Array.isArray(saved.favorites?.pen) && saved.favorites.pen.length > 0 && activeStroke.pen.length === 0) {
        activeStroke.pen = saved.favorites.pen.map(p => ({ ...p }));
    }
    if (Array.isArray(saved.favorites?.highlighter) && saved.favorites.highlighter.length > 0 && activeStroke.highlighter.length === 0) {
        activeStroke.highlighter = saved.favorites.highlighter.map(h => ({ ...h }));
    }
    if (Array.isArray(saved.favorites?.shape) && saved.favorites.shape.length > 0 && activeShape.shape.length === 0) {
        activeShape.shape = saved.favorites.shape.map(s => ({ ...s }));
    }

    return {
        penEnabled: saved.penEnabled ?? fallback.penEnabled,
        activeTool: saved.activeTool ?? fallback.activeTool,
        snapGrid: saved.snapGrid ?? fallback.snapGrid,
        pen: {
            profileId: saved.pen?.profileId ?? fallback.pen.profileId,
            color: saved.pen?.color ?? fallback.pen.color,
            width: saved.pen?.width ?? fallback.pen.width,
            opacity: saved.pen?.opacity ?? fallback.pen.opacity,
            smoothing: saved.pen?.smoothing ?? fallback.pen.smoothing,
            pattern: saved.pen?.pattern ?? fallback.pen.pattern,
            straightenLines: saved.pen?.straightenLines ?? fallback.pen.straightenLines,
            activeSlotIndex: saved.pen?.activeSlotIndex ?? fallback.pen.activeSlotIndex,
            palette: {
                colors: saved.pen?.palette?.colors?.length === 4
                    ? [...saved.pen.palette.colors]
                    : [...fallback.pen.palette.colors],
                opacities: saved.pen?.palette?.opacities?.length === 4
                    ? [...saved.pen.palette.opacities]
                    : [...fallback.pen.palette.opacities],
            },
        },
        highlighter: {
            profileId: (saved.highlighter?.profileId === 'hlf' ? 'hlf' : 'hlr') as 'hlf' | 'hlr',
            color: saved.highlighter?.color ?? fallback.highlighter.color,
            width: saved.highlighter?.width ?? fallback.highlighter.width,
            opacity: saved.highlighter?.opacity ?? fallback.highlighter.opacity,
            pattern: saved.highlighter?.pattern ?? fallback.highlighter.pattern,
            straightenLines: saved.highlighter?.straightenLines ?? fallback.highlighter.straightenLines,
            activeSlotIndex: saved.highlighter?.activeSlotIndex ?? fallback.highlighter.activeSlotIndex,
            palette: {
                colors: saved.highlighter?.palette?.colors?.length === 4
                    ? [...saved.highlighter.palette.colors]
                    : [...fallback.highlighter.palette.colors],
                opacities: saved.highlighter?.palette?.opacities?.length === 4
                    ? [...saved.highlighter.palette.opacities]
                    : [...fallback.highlighter.palette.opacities],
            },
        },
        shape: {
            shapeType: saved.shape?.shapeType ?? fallback.shape.shapeType,
            color: saved.shape?.color ?? fallback.shape.color,
            width: saved.shape?.width ?? fallback.shape.width,
            opacity: saved.shape?.opacity ?? fallback.shape.opacity,
            pattern: saved.shape?.pattern ?? fallback.shape.pattern,
            fillEnabled: saved.shape?.fillEnabled ?? fallback.shape.fillEnabled,
            fillColor: saved.shape?.fillColor ?? fallback.shape.fillColor,
            fillOpacity: saved.shape?.fillOpacity ?? fallback.shape.fillOpacity,
            activeSlotIndex: saved.shape?.activeSlotIndex ?? fallback.shape.activeSlotIndex,
            palette: {
                colors: saved.shape?.palette?.colors?.length === 4
                    ? [...saved.shape.palette.colors]
                    : [...fallback.shape.palette.colors],
                opacities: saved.shape?.palette?.opacities?.length === 4
                    ? [...saved.shape.palette.opacities]
                    : [...fallback.shape.palette.opacities],
            },
        },
        eraser: {
            mode: saved.eraser?.mode ?? fallback.eraser.mode,
            radius: saved.eraser?.radius ?? fallback.eraser.radius,
            onlyHighlighter: saved.eraser?.onlyHighlighter ?? fallback.eraser.onlyHighlighter,
            scribbleToErase: saved.eraser?.scribbleToErase ?? fallback.eraser.scribbleToErase,
        },
        lasso: {
            mode: saved.lasso?.mode ?? fallback.lasso.mode,
        },
        favorites: {
            pen: activeStroke.pen.map(p => ({ ...p })),
            highlighter: activeStroke.highlighter.map(h => ({ ...h })),
            shape: activeShape.shape.map(s => ({ ...s })),
        },
        strokeFavoriteProfiles: strokeProfiles,
        activeStrokeProfileId: activeStrokeId,
        shapeFavoriteProfiles: shapeProfiles,
        activeShapeProfileId: activeShapeId,
        syncFavoriteProfiles: Boolean(saved.syncFavoriteProfiles ?? fallback.syncFavoriteProfiles ?? false),
    };
}

export interface InkElementBase {
    id: string;
    timestamp: number;
    blockId: string;        // Markdown block/paragraph anchor ID in CodeMirror (e.g. line:N)
    anchorText?: string;    // Source line fingerprint used to keep ink with edited text
    url?: string;           // Obsidian WikiLink (e.g. [[Note#Heading]]) or URL
    zIndex: number;
}

export type StrokeCache = Map<string, HTMLCanvasElement>;

export interface StrokeElement extends InkElementBase {
    type: 'stroke';
    points: number[];       // Interleaved: [u0, v0, p0, t0, u1, v1, p1, t1, ...] normalized by column width
    style: StrokeStyle;
    bounds: BoundingBox;    // Normalized bounds: minU, minV, maxU, maxV
    cacheCanvas?: HTMLCanvasElement;
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
