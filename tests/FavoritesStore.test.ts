import test, { describe } from 'node:test';
import assert from 'node:assert';
import {
    computeFavoriteFingerprint,
    findMatchingFavorite,
    toggleFavoritePreset,
    removeFavoriteById,
    reorderFavorites,
    createFavoritePreset,
    MAX_FAVORITES_PER_TOOL,
} from '../src/ui/favorites/FavoritesStore.ts';
import {
    DEFAULT_WORKSPACE_TOOL_STATE,
    cloneWorkspaceToolState,
    mergeWorkspaceToolState,
    type PenFavoritePreset,
    type HighlighterFavoritePreset,
    type ShapeFavoritePreset,
    type WorkspaceToolState,
} from '../src/core/types.ts';

describe('Favorites Data Model, Fingerprinting & Store Helpers', () => {
    describe('1. computeFavoriteFingerprint', () => {
        test('normalizes color case and whitespace', () => {
            const fp1 = computeFavoriteFingerprint({
                tool: 'pen',
                profileId: 'fountain',
                color: '  #1F4FD8  ',
                width: 3,
                opacity: 1,
                pattern: 'solid',
                straightenLines: false,
            });
            const fp2 = computeFavoriteFingerprint({
                tool: 'pen',
                profileId: 'fountain',
                color: '#1f4fd8',
                width: 3,
                opacity: 1,
                pattern: 'solid',
                straightenLines: false,
            });
            assert.strictEqual(fp1, fp2);
        });

        test('normalizes rounded width and floating point variance', () => {
            const fp1 = computeFavoriteFingerprint({
                tool: 'pen',
                profileId: 'pencil',
                color: '#10b981',
                width: 5.5,
                opacity: 1,
            });
            const fp2 = computeFavoriteFingerprint({
                tool: 'pen',
                profileId: 'pencil',
                color: '#10b981',
                width: 5.50000000002,
                opacity: 1,
            });
            assert.strictEqual(fp1, fp2);
        });

        test('normalizes opacity across 0..1 scale and 0..100 percentage scale', () => {
            const fpRatio = computeFavoriteFingerprint({
                tool: 'highlighter',
                profileId: 'hlr',
                color: '#fdd835',
                width: 20,
                opacity: 0.75,
            });
            const fpPercent = computeFavoriteFingerprint({
                tool: 'highlighter',
                profileId: 'hlr',
                color: '#fdd835',
                width: 20,
                opacity: 75,
            });
            assert.strictEqual(fpRatio, fpPercent);
        });

        test('differentiates pen profiles, patterns, and straightenLines', () => {
            const fpBase = computeFavoriteFingerprint({
                tool: 'pen',
                profileId: 'fountain',
                color: '#1f4fd8',
                width: 3,
                opacity: 1,
                pattern: 'solid',
                straightenLines: false,
            });
            const fpBall = computeFavoriteFingerprint({
                tool: 'pen',
                profileId: 'ball',
                color: '#1f4fd8',
                width: 3,
                opacity: 1,
                pattern: 'solid',
                straightenLines: false,
            });
            const fpDashed = computeFavoriteFingerprint({
                tool: 'pen',
                profileId: 'fountain',
                color: '#1f4fd8',
                width: 3,
                opacity: 1,
                pattern: 'dashed',
                straightenLines: false,
            });
            const fpStraight = computeFavoriteFingerprint({
                tool: 'pen',
                profileId: 'fountain',
                color: '#1f4fd8',
                width: 3,
                opacity: 1,
                pattern: 'solid',
                straightenLines: true,
            });

            assert.notStrictEqual(fpBase, fpBall);
            assert.notStrictEqual(fpBase, fpDashed);
            assert.notStrictEqual(fpBase, fpStraight);
        });

        test('handles shape tool with fillEnabled, fillColor, and fillOpacity', () => {
            const fpNoFill = computeFavoriteFingerprint({
                tool: 'shape',
                shapeType: 'rect',
                color: '#2f6bff',
                width: 3,
                opacity: 1,
                pattern: 'solid',
                fillEnabled: false,
            });
            const fpFill = computeFavoriteFingerprint({
                tool: 'shape',
                shapeType: 'rect',
                color: '#2f6bff',
                width: 3,
                opacity: 1,
                pattern: 'solid',
                fillEnabled: true,
                fillColor: '#ffa726',
                fillOpacity: 0.5,
            });
            const fpFillPercent = computeFavoriteFingerprint({
                tool: 'shape',
                shapeType: 'rect',
                color: ' #2F6BFF ',
                width: 3,
                opacity: 100,
                pattern: 'solid',
                fillEnabled: true,
                fillColor: '#FFA726',
                fillOpacity: 50,
            });

            assert.notStrictEqual(fpNoFill, fpFill);
            assert.strictEqual(fpFill, fpFillPercent);
        });

        test('infers tool from slice characteristics when tool property is omitted', () => {
            const penSlice = {
                profileId: 'fountain',
                color: '#1f4fd8',
                width: 3,
                opacity: 1,
                pattern: 'solid' as const,
                straightenLines: false,
            };
            const hlSlice = {
                profileId: 'hlf',
                color: '#fdd835',
                width: 20,
                opacity: 0.75,
                pattern: 'solid' as const,
                straightenLines: false,
            };
            const shapeSlice = {
                shapeType: 'ellipse' as const,
                color: '#10b981',
                width: 2,
                opacity: 1,
                pattern: 'dashed' as const,
                fillEnabled: false,
            };

            assert.ok(computeFavoriteFingerprint(penSlice).startsWith('pen|'));
            assert.ok(computeFavoriteFingerprint(hlSlice).startsWith('highlighter|'));
            assert.ok(computeFavoriteFingerprint(shapeSlice).startsWith('shape|'));
        });
    });

    describe('2. findMatchingFavorite', () => {
        test('matches active tool slice to existing favorite preset in list', () => {
            const preset: PenFavoritePreset = {
                id: 'fav-pen-1',
                tool: 'pen',
                profileId: 'calli',
                color: '#6c3fd1',
                width: 4,
                opacity: 1,
                pattern: 'solid',
                straightenLines: false,
                createdAt: 1000,
            };
            const list = [preset];

            const sliceMatching = {
                profileId: 'calli',
                color: '#6C3FD1',
                width: 4,
                opacity: 1,
                smoothing: 0.6,
                pattern: 'solid' as const,
                straightenLines: false,
            };

            const sliceDifferent = {
                profileId: 'calli',
                color: '#6C3FD1',
                width: 2,
                opacity: 1,
                smoothing: 0.6,
                pattern: 'solid' as const,
                straightenLines: false,
            };

            const found = findMatchingFavorite(list, sliceMatching);
            assert.strictEqual(found?.id, 'fav-pen-1');

            const notFound = findMatchingFavorite(list, sliceDifferent);
            assert.strictEqual(notFound, undefined);
        });
    });

    describe('3. toggleFavoritePreset', () => {
        test('appends new preset when not present, assigning id, tool, and createdAt', () => {
            const list: PenFavoritePreset[] = [];
            const slice = {
                profileId: 'fountain' as const,
                color: '#1F4FD8',
                width: 3,
                opacity: 1,
                pattern: 'solid' as const,
                straightenLines: false,
            };

            const res = toggleFavoritePreset(list, slice);
            assert.strictEqual(res.added, true);
            if (res.added) {
                assert.strictEqual(res.updatedList.length, 1);
                assert.strictEqual(res.preset.tool, 'pen');
                assert.strictEqual(res.preset.profileId, 'fountain');
                assert.strictEqual(res.preset.color, '#1F4FD8');
                assert.strictEqual(res.preset.width, 3);
                assert.ok(typeof res.preset.id === 'string' && res.preset.id.length > 0);
                assert.ok(typeof res.preset.createdAt === 'number' && res.preset.createdAt > 0);
            }
        });

        test('removes existing preset with matching fingerprint', () => {
            const existing = createFavoritePreset({
                tool: 'highlighter',
                profileId: 'hlr',
                color: '#FDD835',
                width: 20,
                opacity: 0.75,
                pattern: 'solid',
            }) as HighlighterFavoritePreset;

            const list: HighlighterFavoritePreset[] = [existing];
            const currentSlice = {
                profileId: 'hlr',
                color: '#fdd835',
                width: 20,
                opacity: 75,
                pattern: 'solid' as const,
                straightenLines: false,
            };

            const res = toggleFavoritePreset(list, currentSlice);
            assert.strictEqual(res.added, false);
            assert.strictEqual(res.removedId, existing.id);
            assert.strictEqual(res.updatedList.length, 0);
        });

        test(`enforces cap of max ${MAX_FAVORITES_PER_TOOL} presets per tool`, () => {
            let list: PenFavoritePreset[] = [];
            for (let i = 0; i < MAX_FAVORITES_PER_TOOL; i++) {
                const res = toggleFavoritePreset(list, {
                    tool: 'pen',
                    profileId: 'fountain',
                    color: `#${i.toString(16).padStart(6, '0')}`,
                    width: 3,
                    opacity: 1,
                });
                assert.strictEqual(res.added, true);
                list = res.updatedList as PenFavoritePreset[];
            }

            assert.strictEqual(list.length, MAX_FAVORITES_PER_TOOL);

            // 25th attempt with novel preset must not be added
            const overflowAttempt = toggleFavoritePreset(list, {
                tool: 'pen',
                profileId: 'pencil',
                color: '#ffffff',
                width: 8,
                opacity: 1,
            });
            assert.strictEqual(overflowAttempt.added, false);
            assert.strictEqual(overflowAttempt.updatedList.length, MAX_FAVORITES_PER_TOOL);

            // Toggling an existing one from the 24 still removes it properly
            const removeAttempt = toggleFavoritePreset(list, list[0]);
            assert.strictEqual(removeAttempt.added, false);
            assert.strictEqual(removeAttempt.removedId, list[0].id);
            assert.strictEqual(removeAttempt.updatedList.length, MAX_FAVORITES_PER_TOOL - 1);
        });
    });

    describe('4. removeFavoriteById and reorderFavorites', () => {
        test('removeFavoriteById returns a new list without target id', () => {
            const p1 = createFavoritePreset({ tool: 'pen', color: '#111111', width: 2, profileId: 'ball' });
            const p2 = createFavoritePreset({ tool: 'pen', color: '#222222', width: 3, profileId: 'fountain' });
            const list = [p1, p2];

            const updated = removeFavoriteById(list, p1.id);
            assert.strictEqual(updated.length, 1);
            assert.strictEqual(updated[0].id, p2.id);
            assert.strictEqual(list.length, 2, 'Original array must remain immutable');
        });

        test('reorderFavorites correctly shifts elements within array bounds', () => {
            const p1 = createFavoritePreset({ tool: 'shape', color: '#111111', shapeType: 'rect' });
            const p2 = createFavoritePreset({ tool: 'shape', color: '#222222', shapeType: 'ellipse' });
            const p3 = createFavoritePreset({ tool: 'shape', color: '#333333', shapeType: 'triangle' });
            const list = [p1, p2, p3];

            // Move first item to the end
            const reordered = reorderFavorites(list, 0, 2);
            assert.deepStrictEqual(
                reordered.map(x => x.id),
                [p2.id, p3.id, p1.id],
            );
            assert.strictEqual(list[0].id, p1.id, 'Original array must remain immutable');

            // Out-of-bounds indices return a clone of the list unchanged
            const invalidReorder = reorderFavorites(list, -1, 5);
            assert.deepStrictEqual(invalidReorder.map(x => x.id), list.map(x => x.id));
        });
    });

    describe('5. WorkspaceToolState Integration & Hydration', () => {
        test('DEFAULT_WORKSPACE_TOOL_STATE initializes empty favorites arrays', () => {
            assert.ok(DEFAULT_WORKSPACE_TOOL_STATE.favorites);
            assert.deepStrictEqual(DEFAULT_WORKSPACE_TOOL_STATE.favorites.pen, []);
            assert.deepStrictEqual(DEFAULT_WORKSPACE_TOOL_STATE.favorites.highlighter, []);
            assert.deepStrictEqual(DEFAULT_WORKSPACE_TOOL_STATE.favorites.shape, []);
        });

        test('cloneWorkspaceToolState deeply clones favorites arrays', () => {
            const state: WorkspaceToolState = {
                ...DEFAULT_WORKSPACE_TOOL_STATE,
                favorites: {
                    pen: [createFavoritePreset({ tool: 'pen', color: '#1f4fd8', width: 3 }) as PenFavoritePreset],
                    highlighter: [createFavoritePreset({ tool: 'highlighter', color: '#fdd835', width: 20 }) as HighlighterFavoritePreset],
                    shape: [createFavoritePreset({ tool: 'shape', color: '#2f6bff', shapeType: 'rect' }) as ShapeFavoritePreset],
                },
            };

            const cloned = cloneWorkspaceToolState(state);
            assert.notStrictEqual(cloned.favorites, state.favorites);
            assert.notStrictEqual(cloned.favorites.pen, state.favorites.pen);
            assert.notStrictEqual(cloned.favorites.pen[0], state.favorites.pen[0]);
            assert.strictEqual(cloned.favorites.pen[0].color, '#1f4fd8');
        });

        test('mergeWorkspaceToolState safely hydrates legacy data missing favorites', () => {
            const legacySaved = {
                activeTool: 'pen' as const,
                pen: {
                    profileId: 'pencil' as const,
                    color: '#10B981',
                    width: 5,
                    opacity: 1,
                    smoothing: 0.6,
                    pattern: 'solid' as const,
                    straightenLines: false,
                    activeSlotIndex: 0,
                    palette: { colors: ['#10B981'], opacities: [100] },
                },
                // favorites is intentionally absent (legacy payload)
            };

            const merged = mergeWorkspaceToolState(legacySaved as any);
            assert.ok(merged.favorites, 'favorites must be defined');
            assert.deepStrictEqual(merged.favorites.pen, []);
            assert.deepStrictEqual(merged.favorites.highlighter, []);
            assert.deepStrictEqual(merged.favorites.shape, []);
        });

        test('mergeWorkspaceToolState preserves valid existing favorites', () => {
            const penFav = createFavoritePreset({ tool: 'pen', color: '#1f4fd8', width: 3 }) as PenFavoritePreset;
            const savedWithFavorites = {
                ...DEFAULT_WORKSPACE_TOOL_STATE,
                favorites: {
                    pen: [penFav],
                    highlighter: [],
                    shape: [],
                },
            };

            const merged = mergeWorkspaceToolState(savedWithFavorites);
            assert.strictEqual(merged.favorites.pen.length, 1);
            assert.strictEqual(merged.favorites.pen[0].id, penFav.id);
        });
    });
});
