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
    StrokeFavoriteProfile,
    ShapeFavoriteProfile,
    WorkspaceToolState,
} from '../../core/types.ts';
import {
    DEFAULT_STROKE_FAVORITE_PROFILES,
    DEFAULT_SHAPE_FAVORITE_PROFILES,
} from '../../core/types.ts';

export type {
    FavoritableTool,
    BaseFavoritePreset,
    PenFavoritePreset,
    HighlighterFavoritePreset,
    ShapeFavoritePreset,
    ToolFavoritePreset,
    StrokeFavoriteProfile,
    ShapeFavoriteProfile,
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
 * Finds the next favorite preset to cycle to from the given current configuration slice.
 * If current slice matches a preset at index i, returns preset at (i + 1) % len.
 * If current slice does not match any preset, returns preset at index 0.
 * Returns null if the list is empty.
 */
export function getNextFavoritePreset<T extends ToolFavoritePreset = ToolFavoritePreset>(
    list: readonly T[],
    currentSlice: any,
): { preset: T; index: number } | null {
    if (!Array.isArray(list) || list.length === 0) return null;
    const tool = inferTool(currentSlice, list[0]?.tool);
    const targetFp = computeFavoriteFingerprint({ ...currentSlice, tool });
    const currIdx = list.findIndex(preset => computeFavoriteFingerprint(preset) === targetFp);

    const nextIdx = currIdx !== -1 ? (currIdx + 1) % list.length : 0;
    return {
        preset: list[nextIdx],
        index: nextIdx,
    };
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

/**
 * Returns the currently active stroke favorite profile (pen + highlighter),
 * guaranteeing a safe fallback if uninitialized.
 */
export function getActiveStrokeProfile(state: WorkspaceToolState): StrokeFavoriteProfile {
    if (!Array.isArray(state.strokeFavoriteProfiles) || state.strokeFavoriteProfiles.length === 0) {
        state.strokeFavoriteProfiles = DEFAULT_STROKE_FAVORITE_PROFILES.map(p => ({
            id: p.id,
            name: p.name,
            pen: [],
            highlighter: [],
        }));
    }
    const found = state.strokeFavoriteProfiles.find(p => p.id === state.activeStrokeProfileId);
    if (found) return found;
    state.activeStrokeProfileId = state.strokeFavoriteProfiles[0].id;
    return state.strokeFavoriteProfiles[0];
}

/**
 * Returns the currently active shape favorite profile (shapes),
 * guaranteeing a safe fallback if uninitialized.
 */
export function getActiveShapeProfile(state: WorkspaceToolState): ShapeFavoriteProfile {
    if (!Array.isArray(state.shapeFavoriteProfiles) || state.shapeFavoriteProfiles.length === 0) {
        state.shapeFavoriteProfiles = DEFAULT_SHAPE_FAVORITE_PROFILES.map(p => ({
            id: p.id,
            name: p.name,
            shape: [],
        }));
    }
    const found = state.shapeFavoriteProfiles.find(p => p.id === state.activeShapeProfileId);
    if (found) return found;
    state.activeShapeProfileId = state.shapeFavoriteProfiles[0].id;
    return state.shapeFavoriteProfiles[0];
}

/**
 * Synchronizes the legacy `state.favorites` slice with the currently active profiles.
 */
export function syncLegacyFavoritesSlice(state: WorkspaceToolState): void {
    const stroke = getActiveStrokeProfile(state);
    const shape = getActiveShapeProfile(state);
    state.favorites = {
        pen: stroke.pen,
        highlighter: stroke.highlighter,
        shape: shape.shape,
    };
}

/**
 * Resolves a matching profile across domains by ID, normalized name, or fallback index.
 */
export function findMatchingProfile<T extends { id: string; name: string }>(
    profiles: readonly T[],
    targetId: string,
    targetName?: string,
    fallbackIndex?: number,
): T | undefined {
    if (!Array.isArray(profiles) || profiles.length === 0) return undefined;
    const byId = profiles.find(p => p.id === targetId);
    if (byId) return byId;
    if (targetName) {
        const norm = targetName.trim().toLowerCase();
        const byName = profiles.find(p => p.name.trim().toLowerCase() === norm);
        if (byName) return byName;
    }
    if (fallbackIndex !== undefined && fallbackIndex >= 0 && fallbackIndex < profiles.length) {
        return profiles[fallbackIndex];
    }
    return undefined;
}

/**
 * Switches the active stroke profile (pen + highlighter).
 * If `syncFavoriteProfiles === true`, also updates `activeShapeProfileId`.
 */
export function switchStrokeProfile(state: WorkspaceToolState, profileId: string): void {
    if (!Array.isArray(state.strokeFavoriteProfiles)) return;
    const strokeIdx = state.strokeFavoriteProfiles.findIndex(p => p.id === profileId);
    if (strokeIdx === -1) return;
    const targetStroke = state.strokeFavoriteProfiles[strokeIdx];
    state.activeStrokeProfileId = profileId;

    if (state.syncFavoriteProfiles) {
        const matchingShape = findMatchingProfile(
            state.shapeFavoriteProfiles,
            targetStroke.id,
            targetStroke.name,
            strokeIdx,
        );
        if (matchingShape) {
            state.activeShapeProfileId = matchingShape.id;
        }
    }
    syncLegacyFavoritesSlice(state);
}

/**
 * Switches the active shape profile (shapes).
 * If `syncFavoriteProfiles === true`, also updates `activeStrokeProfileId`.
 */
export function switchShapeProfile(state: WorkspaceToolState, profileId: string): void {
    if (!Array.isArray(state.shapeFavoriteProfiles)) return;
    const shapeIdx = state.shapeFavoriteProfiles.findIndex(p => p.id === profileId);
    if (shapeIdx === -1) return;
    const targetShape = state.shapeFavoriteProfiles[shapeIdx];
    state.activeShapeProfileId = profileId;

    if (state.syncFavoriteProfiles) {
        const matchingStroke = findMatchingProfile(
            state.strokeFavoriteProfiles,
            targetShape.id,
            targetShape.name,
            shapeIdx,
        );
        if (matchingStroke) {
            state.activeStrokeProfileId = matchingStroke.id;
        }
    }
    syncLegacyFavoritesSlice(state);
}

/**
 * Creates a new stroke favorite profile and selects it.
 * If `syncFavoriteProfiles === true`, also creates and selects a matching shape profile.
 */
export function createStrokeProfile(state: WorkspaceToolState, rawName: string): StrokeFavoriteProfile {
    const name = (rawName || '').trim().slice(0, 24) || 'Nuevo perfil';
    const id = `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newProfile: StrokeFavoriteProfile = {
        id,
        name,
        pen: [],
        highlighter: [],
    };
    if (!Array.isArray(state.strokeFavoriteProfiles)) {
        state.strokeFavoriteProfiles = [];
    }
    state.strokeFavoriteProfiles.push(newProfile);
    state.activeStrokeProfileId = id;

    if (state.syncFavoriteProfiles) {
        if (!Array.isArray(state.shapeFavoriteProfiles)) {
            state.shapeFavoriteProfiles = [];
        }
        if (!state.shapeFavoriteProfiles.some(p => p.id === id)) {
            state.shapeFavoriteProfiles.push({
                id,
                name,
                shape: [],
            });
            state.activeShapeProfileId = id;
        }
    }
    syncLegacyFavoritesSlice(state);
    return newProfile;
}

/**
 * Creates a new shape favorite profile and selects it.
 * If `syncFavoriteProfiles === true`, also creates and selects a matching stroke profile.
 */
export function createShapeProfile(state: WorkspaceToolState, rawName: string): ShapeFavoriteProfile {
    const name = (rawName || '').trim().slice(0, 24) || 'Nuevo perfil';
    const id = `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newProfile: ShapeFavoriteProfile = {
        id,
        name,
        shape: [],
    };
    if (!Array.isArray(state.shapeFavoriteProfiles)) {
        state.shapeFavoriteProfiles = [];
    }
    state.shapeFavoriteProfiles.push(newProfile);
    state.activeShapeProfileId = id;

    if (state.syncFavoriteProfiles) {
        if (!Array.isArray(state.strokeFavoriteProfiles)) {
            state.strokeFavoriteProfiles = [];
        }
        if (!state.strokeFavoriteProfiles.some(p => p.id === id)) {
            state.strokeFavoriteProfiles.push({
                id,
                name,
                pen: [],
                highlighter: [],
            });
            state.activeStrokeProfileId = id;
        }
    }
    syncLegacyFavoritesSlice(state);
    return newProfile;
}
