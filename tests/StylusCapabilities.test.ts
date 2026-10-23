import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    isStylusPointer,
    isStylusBarrelButton,
    isStylusHoverBarrel,
    hasDeliberateStylusMovement,
} from '../src/engine/input/StylusCapabilities.ts';

describe('StylusCapabilities - Strict Stylus & S-Pen Hardening', () => {
    test('isStylusPointer strictly requires pointerType === "pen"', () => {
        assert.strictEqual(isStylusPointer({ pointerType: 'pen' } as any), true);
        assert.strictEqual(isStylusPointer({ pointerType: 'mouse' } as any), false);
        assert.strictEqual(isStylusPointer({ pointerType: 'touch' } as any), false);
        assert.strictEqual(isStylusPointer({} as any), false);
    });

    test('isStylusBarrelButton rejects mouse and touch right-clicks', () => {
        // Mouse right click (button 2, buttons 2) must NEVER be considered a stylus barrel
        const mouseRightClick = { pointerType: 'mouse', button: 2, buttons: 2 } as any;
        assert.strictEqual(isStylusBarrelButton(mouseRightClick), false);

        // Touch event with button 2
        const touchEvent = { pointerType: 'touch', button: 2, buttons: 2 } as any;
        assert.strictEqual(isStylusBarrelButton(touchEvent), false);
    });

    test('isStylusBarrelButton detects W3C standard barrel button', () => {
        // W3C button === 5
        assert.strictEqual(isStylusBarrelButton({ pointerType: 'pen', button: 5, buttons: 32 } as any), true);
        // W3C buttons bitmask 32 (0x20)
        assert.strictEqual(isStylusBarrelButton({ pointerType: 'pen', button: 0, buttons: 32 } as any), true);
    });

    test('isStylusBarrelButton detects Android WebView / Samsung DeX barrel button', () => {
        // Android button === 2
        assert.strictEqual(isStylusBarrelButton({ pointerType: 'pen', button: 2, buttons: 2 } as any), true);
        // Android buttons bitmask 2
        assert.strictEqual(isStylusBarrelButton({ pointerType: 'pen', button: -1, buttons: 2 } as any), true);
    });

    test('isStylusHoverBarrel strictly detects valid barrel bitmasks and rejects tip button', () => {
        // Primary tip button (buttons === 1) must NEVER be treated as hover barrel
        assert.strictEqual(isStylusHoverBarrel({ pointerType: 'pen', pressure: 0, buttons: 1 } as any), false);
        // W3C barrel / eraser button (buttons & 32)
        assert.strictEqual(isStylusHoverBarrel({ pointerType: 'pen', pressure: 0, buttons: 32 } as any), true);
        // Android / Samsung DeX secondary barrel button (buttons & 2)
        assert.strictEqual(isStylusHoverBarrel({ pointerType: 'pen', pressure: 0, buttons: 2 } as any), true);
        // Event with button: 2 or button: 5
        assert.strictEqual(isStylusHoverBarrel({ pointerType: 'pen', pressure: 0, button: 2, buttons: 0 } as any), true);
        assert.strictEqual(isStylusHoverBarrel({ pointerType: 'pen', pressure: 0, button: 5, buttons: 0 } as any), true);
        // Pen touching canvas with active pressure (> 0) is NOT a hover barrel
        assert.strictEqual(isStylusHoverBarrel({ pointerType: 'pen', pressure: 0.5, buttons: 32 } as any), false);
        // Mouse hover is NOT a stylus hover barrel
        assert.strictEqual(isStylusHoverBarrel({ pointerType: 'mouse', pressure: 0, buttons: 32 } as any), false);
    });

    test('hasDeliberateStylusMovement correctly discriminates stationary taps from drawing strokes', () => {
        const start = { x: 100, y: 100 };
        // Jitter / stationary tap within 8px
        assert.strictEqual(hasDeliberateStylusMovement(start, { x: 102, y: 103 }, 8), false);
        assert.strictEqual(hasDeliberateStylusMovement(start, { x: 105, y: 105 }, 8), false);

        // Deliberate stroke (> 8px)
        assert.strictEqual(hasDeliberateStylusMovement(start, { x: 100, y: 110 }, 8), true); // 10px dy
        assert.strictEqual(hasDeliberateStylusMovement(start, { x: 115, y: 100 }, 8), true); // 15px dx
        assert.strictEqual(hasDeliberateStylusMovement(null, { x: 115, y: 100 }, 8), false);
    });
});
