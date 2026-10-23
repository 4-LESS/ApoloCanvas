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
 * Robustly checks if an event represents an intentional stylus barrel button press.
 *
 * Rules:
 * 1. Strictly rejects non-pen pointers (mouse, touch). Mouse right-clicks (button 2) NEVER count.
 * 2. W3C Standard stylus barrel: button === 5 or buttons bitmask 32 (0x20).
 * 3. Android / Samsung WebView / DeX barrel: button === 2 or buttons bitmask 2 (0x02).
 */
export function isStylusBarrelButton(event: PointerEvent | MouseEvent): boolean {
    // If pointerType is present and not 'pen', strictly ignore
    if ('pointerType' in event && (event as PointerEvent).pointerType && (event as PointerEvent).pointerType !== 'pen') {
        return false;
    }

    const button = typeof event.button === 'number' ? event.button : -1;
    const buttons = typeof event.buttons === 'number' ? event.buttons : 0;

    const isW3C = button === 5 || (buttons & 32) !== 0;
    const isAndroid = button === 2 || (buttons & 2) !== 0;

    return isW3C || isAndroid;
}

/**
 * Checks if a stylus hover event carries an Android WebView hover-barrel signal.
 * Android WebViews frequently report barrel hover with buttons === 1 or 32 at pressure === 0.
 */
export function isStylusHoverBarrel(event: PointerEvent): boolean {
    if (event.pointerType !== 'pen') return false;
    const isZeroPressure = event.pressure === 0 || event.pressure === undefined;
    if (!isZeroPressure) return false;

    return (event.buttons & 32) !== 0 || (event.buttons & 2) !== 0 || event.buttons === 1;
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
