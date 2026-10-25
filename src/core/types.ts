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

export type BuiltInShapeType = 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'cylinder';
export type ShapeType = BuiltInShapeType | (string & {});
export type ShapeFillPattern = 'solid' | 'hachure' | 'cross-hatch' | 'dots';

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
    regularize?: boolean;
    fillEnabled?: boolean;
    fillColor?: string;
    fillOpacity?: number;
    fillPattern?: ShapeFillPattern;
    fillDensity?: number;
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
        regularize?: boolean;
        fillEnabled?: boolean;
        fillColor?: string;
        fillOpacity?: number;
        fillPattern?: ShapeFillPattern;
        fillDensity?: number;
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
    readonly favorites: LegacyFavoriteSnapshot;
    strokeFavoriteProfiles: StrokeFavoriteProfile[];
    activeStrokeProfileId: string;
    shapeFavoriteProfiles: ShapeFavoriteProfile[];
    activeShapeProfileId: string;
    syncFavoriteProfiles: boolean;
    colorCarousels?: WorkspaceColorCarousels;
}

export interface ColorProfileSlot {
    color: string;
    opacity: number; // 0..100
}

export interface ColorCarouselProfile {
    id: string;
    name?: string;
    slots: ColorProfileSlot[];
}

export interface ColorCarouselContextState {
    recentColors: ColorProfileSlot[];
    profiles: ColorCarouselProfile[];
}

export interface WorkspaceColorCarousels {
    pen: ColorCarouselContextState;
    highlighter: ColorCarouselContextState;
    shapeStroke: ColorCarouselContextState;
    shapeFill: ColorCarouselContextState;
    globalProfiles?: ColorCarouselProfile[];
}

export const DEFAULT_WORKSPACE_COLOR_CAROUSELS: WorkspaceColorCarousels = {
    globalProfiles: [],
    pen: {
        recentColors: [
            { color: '#E53935', opacity: 100 },
            { color: '#FFA726', opacity: 100 },
            { color: '#FFEE58', opacity: 100 },
            { color: '#26A69A', opacity: 100 },
            { color: '#1E88E5', opacity: 100 },
            { color: '#7E57C2', opacity: 100 },
        ],
        profiles: [
            {
                id: 'pen-profile-1',
                name: 'Primarios',
                slots: [
                    { color: '#E53935', opacity: 100 },
                    { color: '#FFA726', opacity: 100 },
                    { color: '#FFEE58', opacity: 100 },
                    { color: '#26A69A', opacity: 100 },
                    { color: '#1E88E5', opacity: 100 },
                    { color: '#7E57C2', opacity: 100 },
                ],
            },
            {
                id: 'pen-profile-2',
                name: 'Intensos',
                slots: [
                    { color: '#D32F2F', opacity: 100 },
                    { color: '#C2185B', opacity: 100 },
                    { color: '#7B1FA2', opacity: 100 },
                    { color: '#512DA8', opacity: 100 },
                    { color: '#1976D2', opacity: 100 },
                    { color: '#0097A7', opacity: 100 },
                ],
            },
            {
                id: 'pen-profile-3',
                name: 'Monocromo',
                slots: [
                    { color: '#212121', opacity: 100 },
                    { color: '#424242', opacity: 100 },
                    { color: '#616161', opacity: 100 },
                    { color: '#9E9E9E', opacity: 100 },
                    { color: '#E0E0E0', opacity: 100 },
                    { color: '#FFFFFF', opacity: 100 },
                ],
            },
        ],
    },
    highlighter: {
        recentColors: [
            { color: '#FDD835', opacity: 75 },
            { color: '#43A047', opacity: 75 },
            { color: '#00ACC1', opacity: 75 },
            { color: '#1E88E5', opacity: 75 },
            { color: '#8E24AA', opacity: 75 },
            { color: '#E91E63', opacity: 75 },
        ],
        profiles: [
            {
                id: 'hl-profile-1',
                name: 'Neón',
                slots: [
                    { color: '#FDD835', opacity: 75 },
                    { color: '#43A047', opacity: 75 },
                    { color: '#00ACC1', opacity: 75 },
                    { color: '#1E88E5', opacity: 75 },
                    { color: '#8E24AA', opacity: 75 },
                    { color: '#E91E63', opacity: 75 },
                ],
            },
            {
                id: 'hl-profile-2',
                name: 'Suaves',
                slots: [
                    { color: '#FFEE58', opacity: 75 },
                    { color: '#66BB6A', opacity: 75 },
                    { color: '#26C6DA', opacity: 75 },
                    { color: '#42A5F5', opacity: 75 },
                    { color: '#AB47BC', opacity: 75 },
                    { color: '#EC407A', opacity: 75 },
                ],
            },
            {
                id: 'hl-profile-3',
                name: 'Pasteles',
                slots: [
                    { color: '#FFF59D', opacity: 75 },
                    { color: '#A5D6A7', opacity: 75 },
                    { color: '#80DEEA', opacity: 75 },
                    { color: '#90CAF9', opacity: 75 },
                    { color: '#CE93D8', opacity: 75 },
                    { color: '#F48FB1', opacity: 75 },
                ],
            },
        ],
    },
    shapeStroke: {
        recentColors: [
            { color: '#E53935', opacity: 100 },
            { color: '#FFA726', opacity: 100 },
            { color: '#FFEE58', opacity: 100 },
            { color: '#26A69A', opacity: 100 },
            { color: '#1E88E5', opacity: 100 },
            { color: '#7E57C2', opacity: 100 },
        ],
        profiles: [
            {
                id: 'shape-stroke-1',
                name: 'Básicos',
                slots: [
                    { color: '#E53935', opacity: 100 },
                    { color: '#FFA726', opacity: 100 },
                    { color: '#FFEE58', opacity: 100 },
                    { color: '#26A69A', opacity: 100 },
                    { color: '#1E88E5', opacity: 100 },
                    { color: '#7E57C2', opacity: 100 },
                ],
            },
            {
                id: 'shape-stroke-2',
                name: 'Profundos',
                slots: [
                    { color: '#D32F2F', opacity: 100 },
                    { color: '#C2185B', opacity: 100 },
                    { color: '#7B1FA2', opacity: 100 },
                    { color: '#512DA8', opacity: 100 },
                    { color: '#1976D2', opacity: 100 },
                    { color: '#0097A7', opacity: 100 },
                ],
            },
            {
                id: 'shape-stroke-3',
                name: 'Monocromo',
                slots: [
                    { color: '#212121', opacity: 100 },
                    { color: '#424242', opacity: 100 },
                    { color: '#616161', opacity: 100 },
                    { color: '#9E9E9E', opacity: 100 },
                    { color: '#E0E0E0', opacity: 100 },
                    { color: '#FFFFFF', opacity: 100 },
                ],
            },
        ],
    },
    shapeFill: {
        recentColors: [
            { color: '#E53935', opacity: 50 },
            { color: '#FFA726', opacity: 50 },
            { color: '#FFEE58', opacity: 50 },
            { color: '#26A69A', opacity: 50 },
            { color: '#1E88E5', opacity: 50 },
            { color: '#7E57C2', opacity: 50 },
        ],
        profiles: [
            {
                id: 'shape-fill-1',
                name: 'Translúcidos',
                slots: [
                    { color: '#E53935', opacity: 50 },
                    { color: '#FFA726', opacity: 50 },
                    { color: '#FFEE58', opacity: 50 },
                    { color: '#26A69A', opacity: 50 },
                    { color: '#1E88E5', opacity: 50 },
                    { color: '#7E57C2', opacity: 50 },
                ],
            },
            {
                id: 'shape-fill-2',
                name: 'Suaves',
                slots: [
                    { color: '#FFCDD2', opacity: 30 },
                    { color: '#F8BBD0', opacity: 30 },
                    { color: '#E1BEE7', opacity: 30 },
                    { color: '#D1C4E9', opacity: 30 },
                    { color: '#BBDEFB', opacity: 30 },
                    { color: '#B2EBF2', opacity: 30 },
                ],
            },
            {
                id: 'shape-fill-3',
                name: 'Intensos',
                slots: [
                    { color: '#D32F2F', opacity: 70 },
                    { color: '#C2185B', opacity: 70 },
                    { color: '#7B1FA2', opacity: 70 },
                    { color: '#512DA8', opacity: 70 },
                    { color: '#1976D2', opacity: 70 },
                    { color: '#0097A7', opacity: 70 },
                ],
            },
        ],
    },
};

export function cloneColorCarousels(source?: WorkspaceColorCarousels): WorkspaceColorCarousels {
    const src = source ?? DEFAULT_WORKSPACE_COLOR_CAROUSELS;
    const cloneProfile = (p: ColorCarouselProfile): ColorCarouselProfile => ({
        id: p.id,
        name: p.name,
        slots: (p.slots ?? []).map(s => ({ color: s.color, opacity: s.opacity })),
    });
    const cloneContext = (ctx?: ColorCarouselContextState, fallbackCtx?: ColorCarouselContextState): ColorCarouselContextState => {
        const c = ctx ?? fallbackCtx ?? { recentColors: [], profiles: [] };
        return {
            recentColors: (c.recentColors ?? []).map(s => ({ color: s.color, opacity: s.opacity })),
            profiles: (c.profiles ?? []).filter(p => p.slots && p.slots.length > 0).map(cloneProfile),
        };
    };
    return {
        pen: cloneContext(src.pen, DEFAULT_WORKSPACE_COLOR_CAROUSELS.pen),
        highlighter: cloneContext(src.highlighter, DEFAULT_WORKSPACE_COLOR_CAROUSELS.highlighter),
        shapeStroke: cloneContext(src.shapeStroke, DEFAULT_WORKSPACE_COLOR_CAROUSELS.shapeStroke),
        shapeFill: cloneContext(src.shapeFill, DEFAULT_WORKSPACE_COLOR_CAROUSELS.shapeFill),
        globalProfiles: (src.globalProfiles ?? []).filter(p => p.slots && p.slots.length > 0).map(cloneProfile),
    };
}

export type FavoriteTool = 'pen' | 'highlighter' | 'shape';

export interface FavoriteState {
    stroke: {
        activeProfileId: string;
        profiles: StrokeFavoriteProfile[];
    };
    shape: {
        activeProfileId: string;
        profiles: ShapeFavoriteProfile[];
    };
}

export interface LegacyFavoriteSnapshot {
    readonly pen: readonly PenFavoritePreset[];
    readonly highlighter: readonly HighlighterFavoritePreset[];
    readonly shape: readonly ShapeFavoritePreset[];
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

export function getActiveStrokeList(state: {
    strokeFavoriteProfiles?: StrokeFavoriteProfile[];
    activeStrokeProfileId?: string;
}): StrokeFavoriteProfile {
    const profiles = Array.isArray(state.strokeFavoriteProfiles) && state.strokeFavoriteProfiles.length > 0
        ? state.strokeFavoriteProfiles
        : DEFAULT_STROKE_FAVORITE_PROFILES;
    const found = profiles.find(p => p.id === state.activeStrokeProfileId);
    return found ?? profiles[0] ?? DEFAULT_STROKE_FAVORITE_PROFILES[0];
}

export function getActiveShapeList(state: {
    shapeFavoriteProfiles?: ShapeFavoriteProfile[];
    activeShapeProfileId?: string;
}): ShapeFavoriteProfile {
    const profiles = Array.isArray(state.shapeFavoriteProfiles) && state.shapeFavoriteProfiles.length > 0
        ? state.shapeFavoriteProfiles
        : DEFAULT_SHAPE_FAVORITE_PROFILES;
    const found = profiles.find(p => p.id === state.activeShapeProfileId);
    return found ?? profiles[0] ?? DEFAULT_SHAPE_FAVORITE_PROFILES[0];
}

/**
 * Builds a derived snapshot-only projection of favorites from the canonical active profiles.
 * The returned object and its inner arrays are deeply frozen to guarantee runtime immutability.
 */
export function getLegacySnapshot(state: {
    strokeFavoriteProfiles?: StrokeFavoriteProfile[];
    activeStrokeProfileId?: string;
    shapeFavoriteProfiles?: ShapeFavoriteProfile[];
    activeShapeProfileId?: string;
    favorites?: any;
}): LegacyFavoriteSnapshot {
    const stroke = getActiveStrokeList(state);
    const shape = getActiveShapeList(state);
    return Object.freeze({
        pen: Object.freeze(Array.isArray(stroke.pen) ? [...stroke.pen] : []),
        highlighter: Object.freeze(Array.isArray(stroke.highlighter) ? [...stroke.highlighter] : []),
        shape: Object.freeze(Array.isArray(shape.shape) ? [...shape.shape] : []),
    });
}

/**
 * Attaches the dynamic read-only getter and self-healing setter for legacy `state.favorites`.
 * This prevents stale projections, path dependencies, and direct array bypass.
 */
export function attachFavoritesProjection(state: WorkspaceToolState): WorkspaceToolState {
    Object.defineProperty(state, 'favorites', {
        get() {
            return getLegacySnapshot(this);
        },
        set(legacyPayload: any) {
            if (legacyPayload && typeof legacyPayload === 'object') {
                const stroke = getActiveStrokeList(this);
                const shape = getActiveShapeList(this);
                if (Array.isArray(legacyPayload.pen)) {
                    stroke.pen = legacyPayload.pen.map((p: any) => ({ ...p }));
                }
                if (Array.isArray(legacyPayload.highlighter)) {
                    stroke.highlighter = legacyPayload.highlighter.map((h: any) => ({ ...h }));
                }
                if (Array.isArray(legacyPayload.shape)) {
                    shape.shape = legacyPayload.shape.map((s: any) => ({ ...s }));
                }
            }
        },
        enumerable: true,
        configurable: true,
    });
    return state;
}

/**
 * Synchronizes the legacy `state.favorites` snapshot projection from the canonical profile trees.
 */
export function syncLegacyFavoritesSlice(state: WorkspaceToolState): void {
    attachFavoritesProjection(state);
}

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
        regularize: false,
        fillEnabled: false,
        fillColor: '',
        fillOpacity: 0.2,
        fillPattern: 'solid',
        fillDensity: 3,
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
    favorites: Object.freeze({
        pen: Object.freeze([]),
        highlighter: Object.freeze([]),
        shape: Object.freeze([]),
    }),
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
    colorCarousels: cloneColorCarousels(DEFAULT_WORKSPACE_COLOR_CAROUSELS),
};
syncLegacyFavoritesSlice(DEFAULT_WORKSPACE_TOOL_STATE);

/**
 * Normalizes and clones stroke and shape profiles from a saved payload or fallback.
 */
export function normalizeProfiles(
    saved?: Partial<WorkspaceToolState> | null,
    fallback: WorkspaceToolState = DEFAULT_WORKSPACE_TOOL_STATE,
): {
    strokeProfiles: StrokeFavoriteProfile[];
    activeStrokeId: string;
    shapeProfiles: ShapeFavoriteProfile[];
    activeShapeId: string;
} {
    const hasSavedStroke = Array.isArray(saved?.strokeFavoriteProfiles) && saved!.strokeFavoriteProfiles.length > 0;
    const strokeProfiles: StrokeFavoriteProfile[] = hasSavedStroke
        ? saved!.strokeFavoriteProfiles!.map(sp => ({
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

    const activeStrokeId = saved?.activeStrokeProfileId && strokeProfiles.some(p => p.id === saved.activeStrokeProfileId)
        ? saved.activeStrokeProfileId
        : (fallback.activeStrokeProfileId && strokeProfiles.some(p => p.id === fallback.activeStrokeProfileId)
            ? fallback.activeStrokeProfileId
            : strokeProfiles[0].id);

    const hasSavedShape = Array.isArray(saved?.shapeFavoriteProfiles) && saved!.shapeFavoriteProfiles.length > 0;
    const shapeProfiles: ShapeFavoriteProfile[] = hasSavedShape
        ? saved!.shapeFavoriteProfiles!.map(shp => ({
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

    const activeShapeId = saved?.activeShapeProfileId && shapeProfiles.some(p => p.id === saved.activeShapeProfileId)
        ? saved.activeShapeProfileId
        : (fallback.activeShapeProfileId && shapeProfiles.some(p => p.id === fallback.activeShapeProfileId)
            ? fallback.activeShapeProfileId
            : shapeProfiles[0].id);

    return { strokeProfiles, activeStrokeId, shapeProfiles, activeShapeId };
}

/**
 * One-way migration: if canonical profile trees are empty and legacy flat favorites exist,
 * populates the active profile from the legacy favorites once, then re-derives the snapshot.
 */
export function migrateLegacyFavorites(state: WorkspaceToolState): WorkspaceToolState {
    const stroke = state.strokeFavoriteProfiles ?? [];
    const shape = state.shapeFavoriteProfiles ?? [];

    const strokeEmpty = stroke.every(p => p.pen.length === 0 && p.highlighter.length === 0);
    const shapeEmpty = shape.every(p => p.shape.length === 0);

    const activeStroke = stroke.find(p => p.id === state.activeStrokeProfileId) ?? stroke[0];
    const activeShape = shape.find(p => p.id === state.activeShapeProfileId) ?? shape[0];

    if (strokeEmpty && activeStroke && Array.isArray(state.favorites?.pen) && state.favorites.pen.length > 0) {
        activeStroke.pen = state.favorites.pen.map(p => ({ ...p }));
    }

    if (strokeEmpty && activeStroke && Array.isArray(state.favorites?.highlighter) && state.favorites.highlighter.length > 0) {
        activeStroke.highlighter = state.favorites.highlighter.map(h => ({ ...h }));
    }

    if (shapeEmpty && activeShape && Array.isArray(state.favorites?.shape) && state.favorites.shape.length > 0) {
        activeShape.shape = state.favorites.shape.map(s => ({ ...s }));
    }

    // Only after migration, re-derive legacy snapshot from canonical profiles
    syncLegacyFavoritesSlice(state);

    return state;
}

/**
 * Hydrates WorkspaceToolState from a saved persistence snapshot.
 */
export function hydrateFromSavedState(
    saved?: Partial<WorkspaceToolState> | null,
    fallback: WorkspaceToolState = DEFAULT_WORKSPACE_TOOL_STATE,
): WorkspaceToolState {
    if (!saved) return cloneWorkspaceToolState(fallback);

    const { strokeProfiles, activeStrokeId, shapeProfiles, activeShapeId } = normalizeProfiles(saved, fallback);

    const hydrated: WorkspaceToolState = {
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
            regularize: saved.shape?.regularize ?? fallback.shape.regularize ?? false,
            fillEnabled: saved.shape?.fillEnabled ?? fallback.shape.fillEnabled,
            fillColor: saved.shape?.fillColor ?? fallback.shape.fillColor,
            fillOpacity: saved.shape?.fillOpacity ?? fallback.shape.fillOpacity,
            fillPattern: saved.shape?.fillPattern ?? fallback.shape.fillPattern ?? 'solid',
            fillDensity: saved.shape?.fillDensity ?? fallback.shape.fillDensity ?? 3,
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
        favorites: Object.freeze({
            pen: Object.freeze([]),
            highlighter: Object.freeze([]),
            shape: Object.freeze([]),
        }),
        strokeFavoriteProfiles: strokeProfiles,
        activeStrokeProfileId: activeStrokeId,
        shapeFavoriteProfiles: shapeProfiles,
        activeShapeProfileId: activeShapeId,
        syncFavoriteProfiles: Boolean(saved.syncFavoriteProfiles ?? fallback.syncFavoriteProfiles ?? false),
        colorCarousels: cloneColorCarousels(saved.colorCarousels ?? fallback.colorCarousels),
    };

    // Attach dynamic read-only getter and self-healing setter projection
    attachFavoritesProjection(hydrated);

    // Run explicit one-way migration if legacy flat favorites exist and profiles are empty
    if (saved?.favorites && typeof saved.favorites === 'object') {
        const strokeEmpty = strokeProfiles.every(p => p.pen.length === 0 && p.highlighter.length === 0);
        const shapeEmpty = shapeProfiles.every(p => p.shape.length === 0);
        const activeStroke = strokeProfiles.find(p => p.id === activeStrokeId) ?? strokeProfiles[0];
        const activeShape = shapeProfiles.find(p => p.id === activeShapeId) ?? shapeProfiles[0];
        if (strokeEmpty && activeStroke && Array.isArray((saved.favorites as any).pen) && (saved.favorites as any).pen.length > 0) {
            activeStroke.pen = (saved.favorites as any).pen.map((p: any) => ({ ...p }));
        }
        if (strokeEmpty && activeStroke && Array.isArray((saved.favorites as any).highlighter) && (saved.favorites as any).highlighter.length > 0) {
            activeStroke.highlighter = (saved.favorites as any).highlighter.map((h: any) => ({ ...h }));
        }
        if (shapeEmpty && activeShape && Array.isArray((saved.favorites as any).shape) && (saved.favorites as any).shape.length > 0) {
            activeShape.shape = (saved.favorites as any).shape.map((s: any) => ({ ...s }));
        }
    }

    return hydrated;
}

export function mergeWorkspaceToolState(
    saved?: Partial<WorkspaceToolState> | null,
    fallback: WorkspaceToolState = DEFAULT_WORKSPACE_TOOL_STATE,
): WorkspaceToolState {
    return hydrateFromSavedState(saved, fallback);
}

export function cloneWorkspaceToolState(state: WorkspaceToolState): WorkspaceToolState {
    const { strokeProfiles, activeStrokeId, shapeProfiles, activeShapeId } = normalizeProfiles(state);

    const cloned: WorkspaceToolState = {
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
            regularize: state.shape.regularize,
            fillEnabled: state.shape.fillEnabled,
            fillColor: state.shape.fillColor,
            fillOpacity: state.shape.fillOpacity,
            fillPattern: state.shape.fillPattern,
            fillDensity: state.shape.fillDensity ?? 3,
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
        favorites: Object.freeze({
            pen: Object.freeze([]),
            highlighter: Object.freeze([]),
            shape: Object.freeze([]),
        }),
        strokeFavoriteProfiles: strokeProfiles,
        activeStrokeProfileId: activeStrokeId,
        shapeFavoriteProfiles: shapeProfiles,
        activeShapeProfileId: activeShapeId,
        syncFavoriteProfiles: Boolean(state.syncFavoriteProfiles),
        colorCarousels: cloneColorCarousels(state.colorCarousels),
    };

    // Attach dynamic read-only getter and self-healing setter projection
    attachFavoritesProjection(cloned);

    // If cloned state has legacy favorites but empty profiles, migrate once
    if (state.favorites && typeof state.favorites === 'object') {
        const strokeEmpty = strokeProfiles.every(p => p.pen.length === 0 && p.highlighter.length === 0);
        const shapeEmpty = shapeProfiles.every(p => p.shape.length === 0);
        const activeStroke = strokeProfiles.find(p => p.id === activeStrokeId) ?? strokeProfiles[0];
        const activeShape = shapeProfiles.find(p => p.id === activeShapeId) ?? shapeProfiles[0];
        if (strokeEmpty && activeStroke && Array.isArray(state.favorites.pen) && state.favorites.pen.length > 0) {
            activeStroke.pen = state.favorites.pen.map(p => ({ ...p }));
        }
        if (strokeEmpty && activeStroke && Array.isArray(state.favorites.highlighter) && state.favorites.highlighter.length > 0) {
            activeStroke.highlighter = state.favorites.highlighter.map(h => ({ ...h }));
        }
        if (shapeEmpty && activeShape && Array.isArray(state.favorites.shape) && state.favorites.shape.length > 0) {
            activeShape.shape = state.favorites.shape.map(s => ({ ...s }));
        }
    }

    return cloned;
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
    fillEnabled?: boolean;
    fillOpacity?: number;
    fillPattern?: ShapeFillPattern;
    fillDensity?: number;
    regularize?: boolean;
    rotation?: number;      // Radians
    // Parametric edits (all normalized by column width, like startX..endY)
    cornerRadius?: number;  // Rectangle corner radius, 0..min(w, h) / 2
    controlPoint?: NormalizedShapePoint; // Quadratic Bezier control point for curved 'line' / 'arrow'
    vertices?: NormalizedShapePoint[];   // Independent vertex overrides (e.g. 3 detached triangle vertices)
    // Magnetic auto-connect ('line' / 'arrow' only): endpoint glued to a port of another shape
    startBinding?: ShapeConnectorBinding | null;
    endBinding?: ShapeConnectorBinding | null;
    bounds: BoundingBox;    // Normalized bounds: minU, minV, maxU, maxV
}

export interface NormalizedShapePoint {
    x: number;
    y: number;
}

/** Magnetic snap ports exposed by shapes ('start' / 'end' for linear shapes). */
export type ShapePortId = 'n' | 's' | 'e' | 'w' | 'center' | 'v0' | 'v1' | 'v2' | 'start' | 'end';

export interface ShapeConnectorBinding {
    elementId: string;
    portId: string;
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
            const shape: ShapeElement = {
                ...el,
                style: { ...el.style },
                bounds: { ...el.bounds },
            };
            if (el.controlPoint) shape.controlPoint = { ...el.controlPoint };
            if (el.vertices) shape.vertices = el.vertices.map(v => ({ ...v }));
            if (el.startBinding) shape.startBinding = { ...el.startBinding };
            if (el.endBinding) shape.endBinding = { ...el.endBinding };
            return shape;
        }
    });
}
