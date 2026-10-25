import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    cloneColorCarousels,
    DEFAULT_WORKSPACE_COLOR_CAROUSELS,
    DEFAULT_WORKSPACE_TOOL_STATE,
    cloneWorkspaceToolState,
    mergeWorkspaceToolState,
    type WorkspaceColorCarousels,
    type WorkspaceToolState,
    type ColorCarouselProfile,
} from '../src/core/types.ts';

describe('Color Carousels, Profiles & Independent History', () => {
    test('1. DEFAULT_WORKSPACE_COLOR_CAROUSELS has 4 independent contexts with curated slots', () => {
        const c = DEFAULT_WORKSPACE_COLOR_CAROUSELS;
        assert.ok(c.pen, 'Pen carousel context must exist');
        assert.ok(c.highlighter, 'Highlighter carousel context must exist');
        assert.ok(c.shapeStroke, 'ShapeStroke carousel context must exist');
        assert.ok(c.shapeFill, 'ShapeFill carousel context must exist');
        assert.ok(Array.isArray(c.globalProfiles), 'globalProfiles must be initialized array');

        // All have at most 6 recent colors
        assert.equal(c.pen.recentColors.length, 6);
        assert.equal(c.highlighter.recentColors.length, 6);
        assert.equal(c.shapeStroke.recentColors.length, 6);
        assert.equal(c.shapeFill.recentColors.length, 6);

        // Highlighter recent colors have appropriate opacity
        assert.equal(c.highlighter.recentColors[0].opacity, 75);

        // All contexts have profiles
        assert.ok(c.pen.profiles.length >= 3);
        assert.ok(c.shapeStroke.profiles.length >= 2);
        assert.ok(c.shapeFill.profiles.length >= 1);
    });

    test('2. cloneColorCarousels creates deep copy without mutating original', () => {
        const original = cloneColorCarousels();
        const copy = cloneColorCarousels(original);

        assert.notEqual(copy, original);
        assert.notEqual(copy.pen, original.pen);
        assert.notEqual(copy.pen.recentColors, original.pen.recentColors);
        assert.notEqual(copy.pen.profiles, original.pen.profiles);
        assert.notEqual(copy.globalProfiles, original.globalProfiles);

        // Mutating copy does not affect original
        const initialPenLen = original.pen.recentColors.length;
        copy.pen.recentColors.push({ color: '#123456', opacity: 80 });
        assert.equal(original.pen.recentColors.length, initialPenLen);
        assert.equal(copy.pen.recentColors.length, initialPenLen + 1);

        const initialFillProfilesLen = original.shapeFill.profiles.length;
        copy.shapeFill.profiles.push({
            id: 'custom-profile',
            name: 'Custom',
            slots: [{ color: '#AABBCC', opacity: 30 }],
        });
        assert.equal(original.shapeFill.profiles.length, initialFillProfilesLen);
        assert.equal(copy.shapeFill.profiles.length, initialFillProfilesLen + 1);
    });

    test('3. WorkspaceToolState persistence round-trip preserves colorCarousels intact', () => {
        const state: WorkspaceToolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
        assert.ok(state.colorCarousels, 'colorCarousels must exist on tool state');

        // Modify pen history, global profiles, and shape profiles
        state.colorCarousels.pen.recentColors[0] = { color: '#00FF00', opacity: 90 };
        state.colorCarousels.globalProfiles = [
            {
                id: 'global-brand-palette',
                name: 'Brand Global',
                slots: [
                    { color: '#FF0055', opacity: 100 },
                    { color: '#00DDAA', opacity: 50 },
                ],
            },
        ];
        state.colorCarousels.shapeStroke.profiles.push({
            id: 'custom-shape-palette',
            name: 'Mi Paleta',
            slots: [
                { color: '#111111', opacity: 100 },
                { color: '#222222', opacity: 75 },
                { color: '#333333', opacity: 50 },
                { color: '#444444', opacity: 25 },
                { color: '#555555', opacity: 10 },
                { color: '#666666', opacity: 5 },
            ],
        });

        // Clone and merge round-trip
        const cloned = cloneWorkspaceToolState(state);
        assert.equal(cloned.colorCarousels?.pen.recentColors[0].color, '#00FF00');
        assert.equal(cloned.colorCarousels?.pen.recentColors[0].opacity, 90);
        assert.equal(cloned.colorCarousels?.globalProfiles?.length, 1);
        assert.equal(cloned.colorCarousels?.globalProfiles?.[0].id, 'global-brand-palette');
        assert.equal(cloned.colorCarousels?.shapeStroke.profiles.length, state.colorCarousels.shapeStroke.profiles.length);

        const merged = mergeWorkspaceToolState(cloned);
        assert.equal(merged.colorCarousels?.pen.recentColors[0].color, '#00FF00');
        assert.equal(merged.colorCarousels?.pen.recentColors[0].opacity, 90);
        assert.equal(merged.colorCarousels?.globalProfiles?.[0].name, 'Brand Global');
        assert.equal(merged.colorCarousels?.globalProfiles?.[0].slots[1].opacity, 50);
        assert.equal(merged.colorCarousels?.shapeStroke.profiles.at(-1)?.id, 'custom-shape-palette');
        assert.equal(merged.colorCarousels?.shapeStroke.profiles.at(-1)?.slots[1].opacity, 75);
    });

    test('4. Independent histories do not bleed into each other', () => {
        const carousels = cloneColorCarousels();

        // Push color to pen
        carousels.pen.recentColors.unshift({ color: '#FF0000', opacity: 100 });
        // Push color to highlighter
        carousels.highlighter.recentColors.unshift({ color: '#FFFF00', opacity: 40 });
        // Push color to shapeStroke
        carousels.shapeStroke.recentColors.unshift({ color: '#0000FF', opacity: 100 });
        // Push color to shapeFill
        carousels.shapeFill.recentColors.unshift({ color: '#FF00FF', opacity: 20 });

        assert.equal(carousels.pen.recentColors[0].color, '#FF0000');
        assert.equal(carousels.highlighter.recentColors[0].color, '#FFFF00');
        assert.equal(carousels.highlighter.recentColors[0].opacity, 40);
        assert.equal(carousels.shapeStroke.recentColors[0].color, '#0000FF');
        assert.equal(carousels.shapeFill.recentColors[0].color, '#FF00FF');
        assert.equal(carousels.shapeFill.recentColors[0].opacity, 20);
    });

    test('5. Incremental profile color addition starts with 1 color and adds color by color', () => {
        const carousels = cloneColorCarousels();

        // New profile created with single color
        const newProfile: ColorCarouselProfile = {
            id: 'pen-custom-profile-1',
            name: 'Paleta Nueva',
            slots: [{ color: '#FF5722', opacity: 100 }],
        };
        carousels.pen.profiles.push(newProfile);

        assert.equal(newProfile.slots.length, 1);
        assert.equal(newProfile.slots[0].color, '#FF5722');

        // Adding 2nd color incrementally
        newProfile.slots.push({ color: '#4CAF50', opacity: 80 });
        assert.equal(newProfile.slots.length, 2);
        assert.equal(newProfile.slots[1].color, '#4CAF50');
        assert.equal(newProfile.slots[1].opacity, 80);

        // Cloned and persisted without data loss
        const cloned = cloneColorCarousels(carousels);
        const clonedProfile = cloned.pen.profiles.find(p => p.id === 'pen-custom-profile-1');
        assert.ok(clonedProfile);
        assert.equal(clonedProfile.slots.length, 2);
        assert.equal(clonedProfile.slots[0].color, '#FF5722');
        assert.equal(clonedProfile.slots[1].color, '#4CAF50');
    });

    test('6. Moving palette between tool-specific and global scope', () => {
        const carousels = cloneColorCarousels();
        const profile: ColorCarouselProfile = {
            id: 'palette-test-move',
            name: 'Paleta Movil',
            slots: [{ color: '#9C27B0', opacity: 100 }],
        };

        // Initially in pen profiles
        carousels.pen.profiles.push(profile);
        assert.ok(carousels.pen.profiles.some(p => p.id === 'palette-test-move'));
        assert.ok(!carousels.globalProfiles?.some(p => p.id === 'palette-test-move'));

        // Move to global
        const idx = carousels.pen.profiles.findIndex(p => p.id === 'palette-test-move');
        const [moved] = carousels.pen.profiles.splice(idx, 1);
        carousels.globalProfiles = carousels.globalProfiles ?? [];
        carousels.globalProfiles.push(moved);

        assert.ok(!carousels.pen.profiles.some(p => p.id === 'palette-test-move'));
        assert.ok(carousels.globalProfiles.some(p => p.id === 'palette-test-move'));

        // Move from global to shapeFill
        const gIdx = carousels.globalProfiles.findIndex(p => p.id === 'palette-test-move');
        const [moved2] = carousels.globalProfiles.splice(gIdx, 1);
        carousels.shapeFill.profiles.push(moved2);

        assert.ok(!carousels.globalProfiles.some(p => p.id === 'palette-test-move'));
        assert.ok(carousels.shapeFill.profiles.some(p => p.id === 'palette-test-move'));
    });

    test('7. Empty profiles with no colors are pruned automatically', () => {
        const carousels = cloneColorCarousels();

        // Add empty profile to pen
        carousels.pen.profiles.push({
            id: 'empty-pen-profile',
            name: 'Vacia',
            slots: [],
        });

        // Add empty profile to global
        carousels.globalProfiles = [
            {
                id: 'empty-global-profile',
                name: 'Global Vacia',
                slots: [],
            },
        ];

        // Cloning automatically prunes profiles without colors
        const cloned = cloneColorCarousels(carousels);
        assert.ok(!cloned.pen.profiles.some(p => p.id === 'empty-pen-profile'));
        assert.ok(!cloned.globalProfiles?.some(p => p.id === 'empty-global-profile'));
    });
});
