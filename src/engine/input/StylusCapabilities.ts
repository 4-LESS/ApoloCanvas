/**
 * Stylus & S-Pen Hardware Detection and Interaction Utilities.
 *
 * Provides strict discrimination between stylus drawing strokes, barrel button actions,
 * and mouse / touch interactions across desktop browsers, Android WebViews, and Samsung DeX.
 */

/**
 * Returns true if the event originated strictly from an active or hovering stylus/pen device.
 * Excludes mouse, touch, and synthetic non-pen pointer events.
 */
export function isStylusPointer(event: UIEvent | PointerEvent | MouseEvent): boolean {
    if ('pointerType' in event && typeof (event as PointerEvent).pointerType === 'string') {
        return (event as PointerEvent).pointerType === 'pen';
    }
    return false;
}

/**
 * Explicit stylus barrel detection predicate with strict event gating.
 *
 * Rules:
 * 1. Strictly requires pointerType to be 'pen'. Mouse and touch are 100% rejected.
 * 2. Matches confirmed hardware barrel signals:
 *    - Android / Samsung DeX: button === 2 or buttons & 2 (0x02) / buttons & 4 (0x04)
 *    - W3C Standard: button === 5 or buttons & 32 (0x20)
 * 3. Confirms live contact interaction (pressure > 0 and isPrimary !== false),
 *    preventing accidental hover or uncontacted movement from being treated as barrel press.
 */
export function isConfirmedBarrelPress(event: PointerEvent): boolean {
    if (event.pointerType !== 'pen') return false;

    const button = typeof event.button === 'number' ? event.button : -1;
    const buttons = typeof event.buttons === 'number' ? event.buttons : 0;

    const isExplicitBarrel = button === 2 || button === 5 || (buttons & 2) !== 0 || (buttons & 4) !== 0 || (buttons & 32) !== 0;
    const isLiveInteraction = (typeof event.pressure === 'number' ? event.pressure > 0 : true) && (event.isPrimary !== false);

    return isExplicitBarrel && isLiveInteraction;
}

/**
 * Robustly checks if an event represents an intentional stylus barrel button press.
 *
 * Rules:
 * 1. Strictly rejects non-pen pointers (mouse, touch). Mouse right-clicks (button 2) NEVER count.
 * 2. W3C Standard stylus barrel: button === 5 or buttons bitmask 32 (0x20).
 * 3. Android / Samsung WebView / DeX barrel: button === 2 or buttons bitmask 2 (0x02) / bitmask 4 (0x04).
 */
export function isStylusBarrelButton(event: PointerEvent | MouseEvent): boolean {
    if (!('pointerType' in event) || (event as PointerEvent).pointerType !== 'pen') {
        return false;
    }

    const button = typeof event.button === 'number' ? event.button : -1;
    const buttons = typeof (event as any).buttons === 'number' ? (event as any).buttons : 0;

    return button === 2 || button === 5 || (buttons & 2) !== 0 || (buttons & 4) !== 0 || (buttons & 32) !== 0;
}

/**
 * Checks if a stylus hover event carries an authentic stylus barrel button signal.
 *
 * Requirements:
 * 1. Must be strictly a pen device (pointerType === 'pen').
 * 2. Must be hovering with zero or undefined contact pressure (pressure === 0).
 * 3. Primary tip contact (buttons === 1) is STRICTLY REJECTED: zero-pressure tip touches
 *    must never be falsely recognized as a barrel button press.
 * 4. Must match W3C standard barrel/eraser (bit 5 / 32) or Android/DeX secondary button
 *    (bit 1 / 2, button 2, or button 5).
 */
export function isStylusHoverBarrel(event: PointerEvent): boolean {
    if (event.pointerType !== 'pen') return false;
    const isZeroPressure = event.pressure === 0 || event.pressure === undefined;
    if (!isZeroPressure) return false;

    // Primary tip button (buttons === 1) is NEVER a barrel press
    if (event.buttons === 1) return false;

    const button = typeof event.button === 'number' ? event.button : -1;
    const buttons = typeof event.buttons === 'number' ? event.buttons : 0;

    return (buttons & 32) !== 0 || (buttons & 2) !== 0 || button === 2 || button === 5;
}

/**
 * Evaluates whether a stylus stroke has demonstrated deliberate drawing movement
 * exceeding the jitter / stationary threshold (default 8px).
 *
 * When deliberate movement has already occurred, stray contextmenu signals or button
 * vibrations must NEVER abort the active drawing stroke.
 */
export function hasDeliberateStylusMovement(
    startPos: { x: number; y: number } | null,
    currentPos: { x: number; y: number },
    threshold = 8,
): boolean {
    if (!startPos) return false;
    return Math.hypot(currentPos.x - startPos.x, currentPos.y - startPos.y) > threshold;
}
