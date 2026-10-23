import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_WORKSPACE_TOOL_STATE,
    cloneWorkspaceToolState,
    mergeWorkspaceToolState,
    hydrateFromSavedState,
    normalizeProfiles,
    migrateLegacyFavorites,
    syncLegacyFavoritesSlice,
    getLegacySnapshot,
    attachFavoritesProjection,
    type WorkspaceToolState,
    type PenFavoritePreset,
    type HighlighterFavoritePreset,
    type ShapeFavoritePreset,
} from '../src/core/types.ts';
import {
    createFavoritePreset,
    getActiveStrokeProfile,
    getActiveShapeProfile,
    setActiveStrokeProfile,
    setActiveShapeProfile,
    switchStrokeProfile,
    setCanonicalFavorites,
    getCanonicalFavorites,
    createStrokeProfile,
    deleteStrokeProfile,
    renameStrokeProfile,
} from '../src/ui/favorites/FavoritesStore.ts';
import { isConfirmedBarrelPress, isStylusBarrelButton } from '../src/engine/input/StylusCapabilities.ts';
import { CanvasController } from '../src/engine/CanvasController.ts';
import { EngineEventBus } from '../src/core/events.ts';

import { setupMockDom, type MockEnvironment } from './helpers/mockDom.ts';

describe('Canonical Profile Store & Stylus Barrel Guard Narrowing', () => {
    let mockEnv: MockEnvironment;
    let cleanup: () => void;

    beforeEach(() => {
        const { env, teardown } = setupMockDom();
        mockEnv = env;
        cleanup = teardown;
    });

    afterEach(() => {
        cleanup?.();
    });

    describe('1. Single Source of Truth: Canonical Profile Store & Live Projection', () => {
        test('state.favorites dynamically reflects active profile without duplicating data', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const notesPen = createFavoritePreset({ tool: 'pen', profileId: 'ball', color: '#1F4FD8', width: 2 }) as PenFavoritePreset;
            const academicPen = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#E53935', width: 5 }) as PenFavoritePreset;

            // Set presets on Notes profile
            setCanonicalFavorites(state, 'pen', [notesPen]);
            assert.strictEqual(state.favorites.pen.length, 1);
            assert.strictEqual(state.favorites.pen[0].color, '#1F4FD8');

            // Switch to Academic profile
            switchStrokeProfile(state, 'academic');
            assert.strictEqual(state.activeStrokeProfileId, 'academic');
            // Academic begins empty; projection immediately reflects 0 items
            assert.strictEqual(state.favorites.pen.length, 0);

            // Add preset to Academic
            setCanonicalFavorites(state, 'pen', [academicPen]);
            assert.strictEqual(state.favorites.pen.length, 1);
            assert.strictEqual(state.favorites.pen[0].color, '#E53935');

            // Switch back to Notes; projection automatically reflects Notes preset
            switchStrokeProfile(state, 'notes');
            assert.strictEqual(state.activeStrokeProfileId, 'notes');
            assert.strictEqual(state.favorites.pen.length, 1);
            assert.strictEqual(state.favorites.pen[0].color, '#1F4FD8');
        });

        test('state.favorites is strictly read-only and frozen: direct array mutation is blocked at runtime', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const preset = createFavoritePreset({ tool: 'pen', profileId: 'pencil', color: '#10B981', width: 3 }) as PenFavoritePreset;

            // Snapshot and its arrays are frozen
            assert.strictEqual(Object.isFrozen(state.favorites), true);
            assert.strictEqual(Object.isFrozen(state.favorites.pen), true);
            assert.strictEqual(Object.isFrozen(state.favorites.highlighter), true);
            assert.strictEqual(Object.isFrozen(state.favorites.shape), true);

            // Direct mutation throws at runtime
            assert.throws(() => {
                (state.favorites.pen as any).push(preset);
            }, TypeError);

            // Mutations must use canonical store APIs
            setCanonicalFavorites(state, 'pen', [preset]);
            assert.strictEqual(state.favorites.pen.length, 1);
            assert.strictEqual(state.favorites.pen[0].id, preset.id);
            assert.strictEqual(getActiveStrokeProfile(state).pen[0].id, preset.id);

            // Clearing canonical favorites updates active profile and legacy projection immediately
            setCanonicalFavorites(state, 'pen', []);
            assert.strictEqual(getActiveStrokeProfile(state).pen.length, 0);
            assert.strictEqual(state.favorites.pen.length, 0);
        });

        test('Invariants are path-independent: legacy payload assigned to favorites setter self-heals canonical profiles', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const penPreset = createFavoritePreset({ tool: 'pen', profileId: 'ball', color: '#336699', width: 2 }) as PenFavoritePreset;

            // External caller bypasses canonical store and assigns to state.favorites
            (state as any).favorites = { pen: [penPreset], highlighter: [], shape: [] };

            // Self-healing automatically populates the canonical active profile
            assert.strictEqual(getActiveStrokeProfile(state).pen.length, 1);
            assert.strictEqual(getActiveStrokeProfile(state).pen[0].color, '#336699');
            assert.strictEqual(state.favorites.pen.length, 1);
            assert.strictEqual(state.favorites.pen[0].color, '#336699');
        });

        test('mergeWorkspaceToolState strictly ignores saved.favorites when canonical profiles are present', () => {
            const savedWithProfiles = {
                activeStrokeProfileId: 'notes',
                strokeFavoriteProfiles: [
                    {
                        id: 'notes',
                        name: 'Notas',
                        pen: [createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#AABBCC', width: 4 }) as PenFavoritePreset],
                        highlighter: [],
                    },
                ],
                // Conflicting/stale legacy favorites slice that should be completely ignored
                favorites: {
                    pen: [createFavoritePreset({ tool: 'pen', profileId: 'ball', color: '#000000', width: 1 }) as PenFavoritePreset],
                    highlighter: [],
                    shape: [],
                },
            };

            const merged = mergeWorkspaceToolState(savedWithProfiles);
            // Canonical profile must win over stale saved.favorites
            assert.strictEqual(merged.strokeFavoriteProfiles[0].pen[0].color, '#AABBCC');
            assert.strictEqual(merged.favorites.pen[0].color, '#AABBCC');
        });

        test('mergeWorkspaceToolState migrates saved.favorites for pre-profile legacy payloads', () => {
            const legacyPayload = {
                favorites: {
                    pen: [createFavoritePreset({ tool: 'pen', profileId: 'ball', color: '#123456', width: 3 }) as PenFavoritePreset],
                    highlighter: [],
                    shape: [],
                },
            };

            const merged = mergeWorkspaceToolState(legacyPayload);
            // Legacy favorites slice migrated into default active profile
            assert.strictEqual(merged.strokeFavoriteProfiles[0].pen.length, 1);
            assert.strictEqual(merged.strokeFavoriteProfiles[0].pen[0].color, '#123456');
            assert.strictEqual(merged.favorites.pen[0].color, '#123456');
        });
        test('prefers profile arrays as source of truth after hydration', () => {
            const p1 = createFavoritePreset({ tool: 'pen', profileId: 'ball', color: '#111', width: 2 }) as PenFavoritePreset;
            const p2 = createFavoritePreset({ tool: 'pen', profileId: 'pencil', color: '#222', width: 4 }) as PenFavoritePreset;
            const legacyFav = createFavoritePreset({ tool: 'pen', profileId: 'fountain', color: '#999', width: 3 }) as PenFavoritePreset;

            const state = mergeWorkspaceToolState({
                strokeFavoriteProfiles: [
                    { id: 'a', name: 'A', pen: [p1], highlighter: [] },
                    { id: 'b', name: 'B', pen: [p2], highlighter: [] },
                ],
                activeStrokeProfileId: 'b',
                favorites: {
                    pen: [legacyFav],
                    highlighter: [],
                    shape: [],
                },
            });

            assert.strictEqual(getCanonicalFavorites(state, 'pen').length, 1);
            assert.strictEqual(getCanonicalFavorites(state, 'pen')[0].id, p2.id);
            assert.strictEqual(state.favorites.pen.length, 1);
            assert.strictEqual(state.favorites.pen[0].id, p2.id);
        });

        test('syncFavoriteProfiles synchronizes profile switching between stroke and shape', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            state.syncFavoriteProfiles = true;

            // Create a matching profile in stroke
            const newStroke = createStrokeProfile(state, 'Synced Test');
            assert.strictEqual(state.activeStrokeProfileId, newStroke.id);
            assert.strictEqual(state.activeShapeProfileId, newStroke.id);

            // Switch to notes
            setActiveStrokeProfile(state, 'notes');
            assert.strictEqual(state.activeStrokeProfileId, 'notes');
            assert.strictEqual(state.activeShapeProfileId, 'general');

            // Switch to Synced Test via shape
            setActiveShapeProfile(state, newStroke.id);
            assert.strictEqual(state.activeShapeProfileId, newStroke.id);
            assert.strictEqual(state.activeStrokeProfileId, newStroke.id);
        });

        test('deleting active profile cleanly shifts to remaining profile and updates snapshot', () => {
            const state = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const extra = createStrokeProfile(state, 'Extra');
            const extraPreset = createFavoritePreset({ tool: 'pen', profileId: 'calli', color: '#888', width: 4 }) as PenFavoritePreset;
            setCanonicalFavorites(state, 'pen', [extraPreset]);

            assert.strictEqual(state.activeStrokeProfileId, extra.id);
            assert.strictEqual(state.favorites.pen.length, 1);

            // Delete the active profile
            const deleted = deleteStrokeProfile(state, extra.id);
            assert.strictEqual(deleted, true);
            // Must have shifted to first remaining profile
            assert.strictEqual(state.activeStrokeProfileId, 'notes');
            assert.strictEqual(state.favorites.pen.length, 0);
        });

        test('isConfirmedBarrelPress strictly validates live stylus barrel input and rejects ordinary moves', () => {
            // 1. Ordinary pen move: pressure 0.5, buttons 1, button 0 -> false
            const ordinaryMove = {
                pointerType: 'pen',
                pressure: 0.5,
                buttons: 1,
                button: 0,
                isPrimary: true,
            } as PointerEvent;
            assert.strictEqual(isConfirmedBarrelPress(ordinaryMove), false, 'Ordinary pen move must NOT be barrel press');

            // 2. Explicit barrel button: pressure 0.5, buttons 4, button 2 -> true
            const explicitBarrel4 = {
                pointerType: 'pen',
                pressure: 0.5,
                buttons: 4,
                button: 2,
                isPrimary: true,
            } as PointerEvent;
            assert.strictEqual(isConfirmedBarrelPress(explicitBarrel4), true, 'buttons: 4, button: 2 must be barrel press');

            // 3. Android barrel button: pressure 0.6, buttons 2, button 2 -> true
            const explicitBarrel2 = {
                pointerType: 'pen',
                pressure: 0.6,
                buttons: 2,
                button: 2,
                isPrimary: true,
            } as PointerEvent;
            assert.strictEqual(isConfirmedBarrelPress(explicitBarrel2), true, 'buttons: 2, button: 2 must be barrel press');

            // 4. W3C barrel button: pressure 0.5, buttons 32, button 5 -> true
            const explicitBarrelW3C = {
                pointerType: 'pen',
                pressure: 0.5,
                buttons: 32,
                button: 5,
                isPrimary: true,
            } as PointerEvent;
            assert.strictEqual(isConfirmedBarrelPress(explicitBarrelW3C), true, 'buttons: 32, button: 5 must be barrel press');

            // 5. Mouse right-click must NEVER be barrel press
            const mouseRight = {
                pointerType: 'mouse',
                pressure: 0.5,
                buttons: 2,
                button: 2,
                isPrimary: true,
            } as PointerEvent;
            assert.strictEqual(isConfirmedBarrelPress(mouseRight), false, 'Mouse right-click must NOT be barrel press');

            // 6. Touch must NEVER be barrel press
            const touch = {
                pointerType: 'touch',
                pressure: 1.0,
                buttons: 1,
                button: 0,
                isPrimary: true,
            } as PointerEvent;
            assert.strictEqual(isConfirmedBarrelPress(touch), false, 'Touch must NOT be barrel press');
        });
    });

    describe('2. Narrowed Stylus Barrel Button Guard & Stroke Cancellation', () => {
        function setupCanvasController() {
            const scroller = mockEnv.mockDocument.createElement('div');
            const docModel = { id: 'test-page', elements: [], blocks: {}, version: 2 } as any;
            const mockFile = { path: 'test.md', basename: 'test' } as any;
            const mockPersistence = { flush: async () => {}, enqueue: () => {}, loadDocumentForNote: async () => docModel } as any;

            const toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            const eventBus = new EngineEventBus();

            const controller = new CanvasController(
                scroller as any,
                undefined,
                docModel,
                mockFile,
                'test.md',
                mockPersistence,
                { toolState, eventBus },
            );

            const canvas = (controller as any).canvas;
            return { controller, canvas, eventBus };
        }

        test('Normal pen tap (<180ms) with synthetic contextmenu does NOT abort or cancel active stroke', () => {
            const { controller, canvas } = setupCanvasController();

            // 1. Normal pen tip down (buttons: 1, button: 0)
            canvas.dispatchEvent({
                type: 'pointerdown',
                pointerType: 'pen',
                button: 0,
                buttons: 1,
                pressure: 0.5,
                clientX: 200,
                clientY: 200,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            assert.strictEqual(controller.isDrawing, true, 'Stroke must be active after pointerdown');
            const initialPoints = (controller as any).points.size;
            assert.ok(initialPoints > 0, 'Initial points must be recorded');

            // 2. Immediate synthetic contextmenu (e.g. quick tap firing contextmenu on Android)
            let cmPrevented = false;
            let cmStopped = false;
            canvas.dispatchEvent({
                type: 'contextmenu',
                pointerType: 'pen',
                button: 0,
                buttons: 1,
                clientX: 200,
                clientY: 200,
                preventDefault: () => { cmPrevented = true; },
                stopPropagation: () => { cmStopped = true; },
                stopImmediatePropagation: () => { cmStopped = true; },
            });

            assert.strictEqual(cmPrevented, true, 'Contextmenu must be prevented');
            assert.strictEqual(cmStopped, true, 'Contextmenu propagation must be stopped');
            // Crucial: Stroke must NOT be cancelled because barrel button was never confirmed!
            assert.strictEqual(controller.isDrawing, true, 'Normal tap must preserve active stroke');
            assert.strictEqual((controller as any).points.size, initialPoints, 'Points must remain intact');
            assert.strictEqual((controller as any).penBarrelPressed, false, 'penBarrelPressed must remain false');

            controller.destroy();
        });

        test('Confirmed barrel button on pointerdown followed by contextmenu cancels nascent stroke', () => {
            const { controller, canvas } = setupCanvasController();

            // 1. Stylus pointerdown with physical barrel button (Android button: 2, buttons: 2)
            canvas.dispatchEvent({
                type: 'pointerdown',
                pointerType: 'pen',
                button: 2,
                buttons: 2,
                pressure: 0.5,
                clientX: 200,
                clientY: 200,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // penBarrelPressed is latched to true
            assert.strictEqual((controller as any).penBarrelPressed, true, 'penBarrelPressed latched on barrel pointerdown');

            // 2. Synthetic contextmenu arrives
            canvas.dispatchEvent({
                type: 'contextmenu',
                pointerType: 'pen',
                button: 2,
                buttons: 2,
                clientX: 200,
                clientY: 200,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // Confirmed barrel: nascent stroke is cancelled
            assert.strictEqual(controller.isDrawing, false, 'Nascent stroke cancelled on confirmed barrel');
            assert.strictEqual((controller as any).penBarrelPressed, true, 'penBarrelPressed remains true');

            controller.destroy();
        });

        test('Subsequent pen tip touch without barrel resets penBarrelPressed and draws cleanly', () => {
            const { controller, canvas } = setupCanvasController();

            // 1. Hover-barrel latches penBarrelPressed
            (controller as any).penBarrelPressed = true;

            // 2. Normal pen pointerdown arrives with tip only (button: 0, buttons: 1)
            canvas.dispatchEvent({
                type: 'pointerdown',
                pointerType: 'pen',
                button: 0,
                buttons: 1,
                pressure: 0.5,
                clientX: 250,
                clientY: 250,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // penBarrelPressed must be reset to false immediately
            assert.strictEqual((controller as any).penBarrelPressed, false, 'penBarrelPressed reset on normal pen tip touch');

            // 3. Synthetic contextmenu without barrel does NOT cancel the new stroke
            canvas.dispatchEvent({
                type: 'contextmenu',
                pointerType: 'pen',
                button: 0,
                buttons: 1,
                clientX: 250,
                clientY: 250,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            assert.strictEqual(controller.isDrawing, true, 'New stroke is preserved intact');

            controller.destroy();
        });

        test('Stylus stroke with deliberate movement (>8px) is NOT aborted on stray contextmenu even if barrel signal occurs', () => {
            const { controller, canvas } = setupCanvasController();

            // 1. Normal pen tip down
            canvas.dispatchEvent({
                type: 'pointerdown',
                pointerType: 'pen',
                button: 0,
                buttons: 1,
                pressure: 0.5,
                clientX: 100,
                clientY: 100,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // 2. Movement across 20px (deliberate movement)
            canvas.dispatchEvent({
                type: 'pointermove',
                pointerType: 'pen',
                button: 0,
                buttons: 1,
                pressure: 0.6,
                clientX: 120,
                clientY: 100,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // 3. Stray contextmenu with barrel button while in motion
            canvas.dispatchEvent({
                type: 'contextmenu',
                pointerType: 'pen',
                button: 2,
                buttons: 2,
                clientX: 120,
                clientY: 100,
                preventDefault: () => {},
                stopPropagation: () => {},
            });

            // Crucial: Stroke must NOT be cancelled because deliberate movement (>8px) was already in progress
            assert.strictEqual(controller.isDrawing, true, 'Moving stroke must not be aborted on contextmenu');

            controller.destroy();
        });
    });
});
