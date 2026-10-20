import type {
    FavoritableTool,
    BaseFavoritePreset,
    PenFavoritePreset,
    HighlighterFavoritePreset,
    ShapeFavoritePreset,
    StrokePattern,
    ShapeType,
    PenProfileId,
    ToolFavoritePreset,
} from '../../core/types.ts';

export type {
    FavoritableTool,
    BaseFavoritePreset,
    PenFavoritePreset,
    HighlighterFavoritePreset,
    ShapeFavoritePreset,
    ToolFavoritePreset,
};

export const MAX_FAVORITES_PER_TOOL = 24;

export type ToggleFavoriteResult<T extends ToolFavoritePreset = ToolFavoritePreset> =
    | { updatedList: T[]; added: false; removedId: string }
    | { updatedList: T[]; added: false; removedId?: undefined }
    | { updatedList: T[]; added: true; preset: T };

/**
 * Normalizes an opacity value into 0..1 rounded to two decimal places.
 * Handles both 0..1 scale and 0..100 percentage scale.
 */
function normalizeOpacity(raw: number | undefined, tool?: FavoritableTool): number {
    if (raw === undefined || !Number.isFinite(Number(raw))) {
        return tool === 'highlighter' ? 0.75 : 1;
    }
    const num = Number(raw);
    const inZeroToOne = num > 1 ? num / 100 : Math.max(0, num);
    return Math.round(inZeroToOne * 100) / 100;
}

/**
 * Normalizes width to one decimal place to eliminate floating point jitter.
 */
function normalizeWidth(raw: number | undefined, tool?: FavoritableTool): number {
    if (raw === undefined || !Number.isFinite(Number(raw))) {
        return tool === 'highlighter' ? 20 : 3;
    }
    return Math.round(Number(raw) * 10) / 10;
}

/**
 * Generates a unique favorite preset identifier.
 */
function generatePresetId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `fav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Infers the tool ('pen' | 'highlighter' | 'shape') from a preset or tool slice.
 */
export function inferTool(slice: any, fallbackTool?: FavoritableTool): FavoritableTool {
    if (slice?.tool === 'pen' || slice?.tool === 'highlighter' || slice?.tool === 'shape') {
        return slice.tool;
    }
    if (fallbackTool) {
        return fallbackTool;
    }
    if (slice?.shapeType !== undefined) {
        return 'shape';
    }
    if (slice?.profileId === 'hlf' || slice?.profileId === 'hlr') {
        return 'highlighter';
    }
    return 'pen';
}

/**
 * Computes a deterministic string fingerprint for a favorite preset or tool slice.
 * Normalizes color (lowercase trim), rounded width, rounded opacity, profileId/shapeType,
 * pattern (solid/dashed/dotted), and straightenLines/fillEnabled.
 */
export function computeFavoriteFingerprint(presetOrState: any): string {
    if (!presetOrState || typeof presetOrState !== 'object') {
        return '';
    }
    const tool = inferTool(presetOrState);
    const color = (presetOrState.color ?? '').trim().toLowerCase();
    const width = normalizeWidth(presetOrState.width, tool);
    const opacity = normalizeOpacity(presetOrState.opacity, tool);
    const pattern = presetOrState.pattern || 'solid';

    if (tool === 'pen') {
        const profileId = presetOrState.profileId || 'fountain';
        const straighten = Boolean(presetOrState.straightenLines);
        return `pen|${profileId}|${color}|${width}|${opacity}|${pattern}|straighten:${straighten}`;
    }

    if (tool === 'highlighter') {
        const profileId = presetOrState.profileId === 'hlf' ? 'hlf' : 'hlr';
        const straighten = Boolean(presetOrState.straightenLines);
        return `highlighter|${profileId}|${color}|${width}|${opacity}|${pattern}|straighten:${straighten}`;
    }

    // shape
    const shapeType = presetOrState.shapeType || 'rect';
    const fillEnabled = Boolean(presetOrState.fillEnabled);
    const fillColor = fillEnabled ? (presetOrState.fillColor ?? '').trim().toLowerCase() : '';
    const fillOpacity = fillEnabled ? normalizeOpacity(presetOrState.fillOpacity, 'shape') : 0;
    return `shape|${shapeType}|${color}|${width}|${opacity}|${pattern}|fill:${fillEnabled}|${fillColor}|${fillOpacity}`;
}

/**
 * Creates a strongly-typed favorite preset from a tool slice or existing preset definition.
 */
export function createFavoritePreset(slice: any, toolOverride?: FavoritableTool): ToolFavoritePreset {
    const tool = toolOverride || inferTool(slice);
    const id = typeof slice?.id === 'string' && slice.id.trim().length > 0
        ? slice.id
        : generatePresetId();
    const createdAt = typeof slice?.createdAt === 'number' && slice.createdAt > 0
        ? slice.createdAt
        : Date.now();
    const color = (slice?.color ?? (tool === 'highlighter' ? '#FDD835' : '#1F4FD8')).trim();
    const width = Number.isFinite(Number(slice?.width))
        ? Number(slice.width)
        : (tool === 'highlighter' ? 20 : 3);
    const opacity = slice?.opacity !== undefined
        ? Number(slice.opacity)
        : (tool === 'highlighter' ? 0.75 : 1);
    const pattern: StrokePattern = slice?.pattern || 'solid';

    const base: BaseFavoritePreset = {
        id,
        tool,
        color,
        width,
        opacity,
        pattern,
        createdAt,
    };

    if (tool === 'pen') {
        const penPreset: PenFavoritePreset = {
            ...base,
            tool: 'pen',
            profileId: (slice?.profileId as PenProfileId) || 'fountain',
            smoothing: slice?.smoothing !== undefined ? Number(slice.smoothing) : undefined,
            straightenLines: slice?.straightenLines !== undefined ? Boolean(slice.straightenLines) : undefined,
        };
        return penPreset;
    }

    if (tool === 'highlighter') {
        const hlPreset: HighlighterFavoritePreset = {
            ...base,
            tool: 'highlighter',
            profileId: slice?.profileId === 'hlf' ? 'hlf' : 'hlr',
            straightenLines: slice?.straightenLines !== undefined ? Boolean(slice.straightenLines) : undefined,
        };
        return hlPreset;
    }

    const shapePreset: ShapeFavoritePreset = {
        ...base,
        tool: 'shape',
        shapeType: (slice?.shapeType as ShapeType) || 'rect',
        fillEnabled: slice?.fillEnabled !== undefined ? Boolean(slice.fillEnabled) : undefined,
        fillColor: slice?.fillColor !== undefined ? String(slice.fillColor) : undefined,
        fillOpacity: slice?.fillOpacity !== undefined ? Number(slice.fillOpacity) : undefined,
    };
    return shapePreset;
}

/**
 * Returns the matching preset if the current active tool configuration is already saved.
 */
export function findMatchingFavorite<T extends ToolFavoritePreset = ToolFavoritePreset>(
    list: readonly T[],
    currentSlice: any,
): T | undefined {
    if (!Array.isArray(list) || !currentSlice) return undefined;
    const tool = inferTool(currentSlice, list[0]?.tool);
    const targetFp = computeFavoriteFingerprint({ ...currentSlice, tool });
    return list.find(preset => computeFavoriteFingerprint(preset) === targetFp);
}

/**
 * Toggles a favorite preset:
 * - If a preset with the same fingerprint exists, removes it and returns `{ updatedList, added: false, removedId }`.
 * - Otherwise appends a new preset (max 24 presets per tool) and returns `{ updatedList, added: true, preset }`.
 */
export function toggleFavoritePreset<T extends ToolFavoritePreset = ToolFavoritePreset>(
    list: readonly T[],
    currentSlice: any,
): ToggleFavoriteResult<T> {
    const safeList = Array.isArray(list) ? list : [];
    const tool = inferTool(currentSlice, safeList[0]?.tool);
    const targetFp = computeFavoriteFingerprint({ ...currentSlice, tool });
    const existing = safeList.find(preset => computeFavoriteFingerprint(preset) === targetFp);

    if (existing) {
        return {
            updatedList: safeList.filter(item => item.id !== existing.id),
            added: false,
            removedId: existing.id,
        };
    }

    if (safeList.length >= MAX_FAVORITES_PER_TOOL) {
        return {
            updatedList: [...safeList],
            added: false,
        };
    }

    const preset = createFavoritePreset(currentSlice, tool) as T;
    return {
        updatedList: [...safeList, preset],
        added: true,
        preset,
    };
}

/**
 * Removes a favorite preset by ID, returning a new array without mutating the input list.
 */
export function removeFavoriteById<T extends ToolFavoritePreset = ToolFavoritePreset>(
    list: readonly T[],
    id: string,
): T[] {
    if (!Array.isArray(list)) return [];
    return list.filter(item => item.id !== id);
}

/**
 * Reorders a preset from one index to another, returning a new array without mutating the input list.
 */
export function reorderFavorites<T extends ToolFavoritePreset = ToolFavoritePreset>(
    list: readonly T[],
    fromIndex: number,
    toIndex: number,
): T[] {
    if (!Array.isArray(list)) return [];
    const len = list.length;
    if (
        fromIndex < 0 ||
        fromIndex >= len ||
        toIndex < 0 ||
        toIndex >= len ||
        fromIndex === toIndex ||
        !Number.isInteger(fromIndex) ||
        !Number.isInteger(toIndex)
    ) {
        return [...list];
    }
    const next = [...list];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
}
