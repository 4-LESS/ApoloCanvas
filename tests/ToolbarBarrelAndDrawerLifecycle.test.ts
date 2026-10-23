import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Toolbar } from '../src/ui/Toolbar.ts';
import { ToolEstuche } from '../src/ui/ToolEstuche.ts';
import { DEFAULT_WORKSPACE_TOOL_STATE, cloneWorkspaceToolState } from '../src/core/types.ts';

import { setupMockDom, type MockEnvironment } from './helpers/mockDom.ts';

describe('Toolbar Barrel Button Latching & FavoritesDrawer Lifecycle Teardown', () => {
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

    test('1. Toolbar S-Pen Hover-Barrel: latched edge-triggering prevents repeated toggles on pointermove', async () => {
        let toggleFavoritesCount = 0;
        let lastToggledTool: string | null = null;

        const toolbar = new Toolbar({
            slot: 'tc',
            penEnabled: true,
            activeTool: 'pen',
            activeShape: 'rectangle',
            activeColor: '#1F4FD8',
            activeWidth: 3,
            activeProfileId: 'fountain',
            activeFavoriteIndex: 0,
            favorites: [],
            snapGrid: false,
            canUndo: false,
            canRedo: false,
            eraserRadius: 20,
            onSlotChange: () => {},
            onToggleKeyboardMode: () => {},
            onSelectTool: () => {},
            onToggleEstuche: () => {},
            onToggleEstucheFavorites: (tool) => {
                toggleFavoritesCount++;
                lastToggledTool = tool;
            },
            onCycleFavorite: () => {},
            onUndo: () => {},
            onRedo: () => {},
            onSelectFavorite: () => {},
            onSelectThickness: () => {},
            onToggleSnapGrid: () => {},
        });

        const penBtn = toolbar.getToolButton('pen');
        assert.ok(penBtn, 'Pen button must exist on toolbar');

        // Initial state: 0 toggles
        assert.strictEqual(toggleFavoritesCount, 0);

        // A. Primary tip contact at pressure 0 (buttons: 1) must be REJECTED (no toggle)
        penBtn.dispatchEvent({
            type: 'pointermove',
            pointerType: 'pen',
            pressure: 0,
            buttons: 1,
            clientX: 100,
            clientY: 50,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        assert.strictEqual(toggleFavoritesCount, 0, 'buttons: 1 must NEVER trigger hover-barrel toggle');

        // B. First intentional hover-barrel event (buttons: 32 / W3C or buttons: 2 / Android)
        penBtn.dispatchEvent({
            type: 'pointermove',
            pointerType: 'pen',
            pressure: 0,
            buttons: 32,
            clientX: 100,
            clientY: 50,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        assert.strictEqual(toggleFavoritesCount, 1, 'First hover-barrel event triggers toggle');
        assert.strictEqual(lastToggledTool, 'pen');

        // C. Continuous pointermove events while the barrel button is held down must NOT trigger repeated toggles
        for (let i = 0; i < 15; i++) {
            penBtn.dispatchEvent({
                type: 'pointermove',
                pointerType: 'pen',
                pressure: 0,
                buttons: 32,
                clientX: 100 + i,
                clientY: 50 + i,
                preventDefault: () => {},
                stopPropagation: () => {},
            });
        }
        assert.strictEqual(toggleFavoritesCount, 1, 'Latched state must prevent repeated toggling on subsequent pointermove events');

        // D. Button is released in hover (buttons: 0): latch must be reset
        penBtn.dispatchEvent({
            type: 'pointermove',
            pointerType: 'pen',
            pressure: 0,
            buttons: 0,
            clientX: 120,
            clientY: 60,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        assert.strictEqual(toggleFavoritesCount, 1, 'Releasing barrel does not toggle');

        // Wait for debounce cooldown (> 300ms)
        await new Promise((r) => setTimeout(r, 320));

        // E. Next intentional hover-barrel press fires cleanly
        penBtn.dispatchEvent({
            type: 'pointermove',
            pointerType: 'pen',
            pressure: 0,
            buttons: 2, // Android secondary button bitmask
            clientX: 120,
            clientY: 60,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
        assert.strictEqual(toggleFavoritesCount, 2, 'New press after release and cooldown triggers second toggle cleanly');

        toolbar.destroy();
    });

    test('2. ToolEstuche: FavoritesDrawer previous instances are strictly destroyed before re-render or close', () => {
        const estuche = new ToolEstuche(
            {
                tool: 'pen',
                width: 3,
                color: '#1F4FD8',
                eraserMode: 'whole',
                lassoMode: 'freeform',
                showingFavorites: false,
                favorites: [],
                strokeFavoriteProfiles: cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE).strokeFavoriteProfiles,
                activeStrokeProfileId: 'notes',
            },
            {
                onApplyFavorite: () => {},
                onDeleteFavorite: () => {},
                onReorderFavorites: () => {},
                onRenameFavorite: () => {},
                onClose: () => {},
            },
        );

        // Open estuche showing favorites
        estuche.open(mockEnv.mockDocument.body);
        estuche.setShowingFavorites(true);

        const drawer1 = (estuche as any).favoritesDrawer;
        assert.ok(drawer1, 'FavoritesDrawer instance #1 must be created');

        let drawer1Destroyed = false;
        const origDestroy1 = drawer1.destroy.bind(drawer1);
        drawer1.destroy = () => {
            drawer1Destroyed = true;
            origDestroy1();
        };

        // Switch to regular tool view
        estuche.setShowingFavorites(false);
        assert.strictEqual(drawer1Destroyed, true, 'Drawer #1 must be destroyed when switching away from favorites');
        assert.strictEqual((estuche as any).favoritesDrawer, undefined, 'Reference must be cleared');

        // Re-open favorites view: creates fresh Drawer #2
        estuche.setShowingFavorites(true);
        const drawer2 = (estuche as any).favoritesDrawer;
        assert.ok(drawer2, 'FavoritesDrawer instance #2 must be created');
        assert.notStrictEqual(drawer2, drawer1, 'Drawer #2 must be a distinct instance');

        let drawer2Destroyed = false;
        const origDestroy2 = drawer2.destroy.bind(drawer2);
        drawer2.destroy = () => {
            drawer2Destroyed = true;
            origDestroy2();
        };

        // Close estuche: drawer #2 must be destroyed
        estuche.close();
        assert.strictEqual(drawer2Destroyed, true, 'Drawer #2 must be destroyed on estuche close');
        assert.strictEqual((estuche as any).favoritesDrawer, undefined, 'Reference must be cleared');

        estuche.destroy();
    });
});
