import type { Point } from '../../core/types.ts';

export interface InputManagerOptions {
    palmRejectionCooldownMs?: number;
    /** Enables primary-button mouse strokes for desktop and trackpad users. Defaults to true. */
    enableMouseDrawing?: boolean;
    /** Returns false to deactivate drawing input (e.g. in forbidden zones or UI overlays). */
    shouldAcceptPointer?: (event: PointerEvent) => boolean;
    onStrokeStart?: (pt: Point, isBarrel: boolean, rawEvent: PointerEvent) => void;
    /** Points are reused on the next move event. Copy them if they must outlive this callback. */
    onStrokeMove?: (points: Point[], isBarrel: boolean, rawEvent: PointerEvent) => void;
    onStrokeEnd?: (pt: Point, isBarrel: boolean, rawEvent: PointerEvent) => void;
    onStrokeCancel?: () => void;
    onNonDrawingPointerDown?: (event: PointerEvent) => void;
    onHover?: (event: PointerEvent) => void;
    onPointerLeave?: (event: PointerEvent) => void;
    /** Notified whenever an S-Pen contact or hover event occurs to immediately cancel 1-finger touches. */
    onPenHoverOrContact?: (event: PointerEvent) => void;
}

/** Captures S-Pen input while allowing ordinary multi-touch navigation. */
export class InputManager {
    private cooldownMs: number;
    private readonly mouseDrawingEnabled: boolean;

    public setPalmRejectionCooldown(ms: number): void {
        this.cooldownMs = Math.max(0, ms);
    }

    public getPalmRejectionCooldown(): number {
        return this.cooldownMs;
    }
    private lastPenContactAt = Number.NEGATIVE_INFINITY;
    private isPenHovering = false;
    private activeDrawingPointerId: number | null = null;
    private activeDrawingPointerType: 'pen' | 'mouse' | null = null;
    private activeBarrel = false;
    private readonly previousTouchAction: string;
    private readonly previousUserSelect: string;
    private readonly pointPool: Point[] = [];
    private readonly moveBatch: Point[] = [];
    private readonly rejectedPointerIds = new Set<number>();
    private resetPenHoverTimeout: number | null = null;
    private disposed = false;

    private markPenHover(): void {
        this.isPenHovering = true;
        if (this.resetPenHoverTimeout !== null) {
            clearTimeout(this.resetPenHoverTimeout);
        }
        this.resetPenHoverTimeout = setTimeout(() => {
            this.isPenHovering = false;
            this.resetPenHoverTimeout = null;
        }, this.cooldownMs) as unknown as number;
    }

    private clearPenHover(): void {
        this.isPenHovering = false;
        if (this.resetPenHoverTimeout !== null) {
            clearTimeout(this.resetPenHoverTimeout);
            this.resetPenHoverTimeout = null;
        }
    }

    private readonly target: HTMLElement;
    private readonly options: InputManagerOptions;

    constructor(target: HTMLElement, options: InputManagerOptions = {}) {
        this.target = target;
        this.options = options;
        this.cooldownMs = options.palmRejectionCooldownMs ?? 400;
        this.mouseDrawingEnabled = options.enableMouseDrawing ?? true;
        for (let i = 0; i < 256; i++) {
            const point: Point = { x: 0, y: 0, pressure: 0, time: 0 };
            this.pointPool.push(point);
            this.moveBatch.push(point);
        }
        this.moveBatch.length = 0;
        this.previousTouchAction = target.style.touchAction;
        this.previousUserSelect = target.style.userSelect;
        target.style.touchAction = 'none';
        target.style.userSelect = 'none';
        target.addEventListener('pointerdown', this.handleDown, { passive: false });
        target.addEventListener('pointermove', this.handleMove, { passive: false });
        target.addEventListener('pointerup', this.handleUp, { passive: false });
        target.addEventListener('pointercancel', this.handleCancel, { passive: false });
        target.addEventListener('pointerenter', this.handleEnter);
        target.addEventListener('pointerover', this.handleOver);
        target.addEventListener('pointerout', this.handleOut);
        target.addEventListener('pointerleave', this.handleLeave);
        target.addEventListener('contextmenu', this.handleContextMenu, { passive: false });
    }

    /** True while an S-Pen stroke is active. Kept for touch-gesture callers. */
    get hasActivePenStroke(): boolean { return this.activeDrawingPointerType === 'pen'; }

    /** True while either an S-Pen or an accepted primary mouse stroke is active. */
    get hasActiveStroke(): boolean { return this.activeDrawingPointerId !== null; }

    /** True while S-Pen is touching, hovering or within palm rejection cooldown. */
    get isPenActive(): boolean { return this.hasActivePenStroke || this.isPenHovering || this.isPalmRejected(); }

    shouldRejectTouch(): boolean { return this.isPalmRejected() || this.hasActivePenStroke; }

    destroy(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.clearPenHover();
        this.rejectedPointerIds.clear();
        this.target.removeEventListener('pointerdown', this.handleDown);
        this.target.removeEventListener('pointermove', this.handleMove);
        this.target.removeEventListener('pointerup', this.handleUp);
        this.target.removeEventListener('pointercancel', this.handleCancel);
        this.target.removeEventListener('pointerenter', this.handleEnter);
        this.target.removeEventListener('pointerover', this.handleOver);
        this.target.removeEventListener('pointerout', this.handleOut);
        this.target.removeEventListener('pointerleave', this.handleLeave);
        this.target.removeEventListener('contextmenu', this.handleContextMenu);
        this.target.style.touchAction = this.previousTouchAction;
        this.target.style.userSelect = this.previousUserSelect;
    }

    private readonly handleDown = (event: PointerEvent): void => {
        if (event.pointerType === 'pen') {
            this.lastPenContactAt = Date.now();
            this.markPenHover();
            this.options.onPenHoverOrContact?.(event);
        }

        if (this.isDrawingStart(event)) {
            if (this.options.shouldAcceptPointer && !this.options.shouldAcceptPointer(event)) {
                // Drawing input is deactivated: suppress canvas draw and let the pointer event pass through to Obsidian / UI
                event.preventDefault();
                event.stopPropagation();
                this.rejectedPointerIds.add(event.pointerId);
                this.passThroughPointerEvent(event);
                return;
            }
            this.stopDrawingEvent(event);
            if (this.activeDrawingPointerId !== null) return;
            this.activeDrawingPointerId = event.pointerId;
            this.activeDrawingPointerType = event.pointerType === 'pen' ? 'pen' : 'mouse';
            this.activeBarrel = this.isBarrel(event);
            this.capture(event);
            this.options.onStrokeStart?.(this.toPoint(event), this.activeBarrel, event);
            return;
        }

        if (event.pointerType === 'touch' && this.isPalmRejected()) {
            event.preventDefault();
            return;
        }

        if (event.pointerType === 'mouse' && event.button === 0) {
            this.options.onNonDrawingPointerDown?.(event);
        }
    };

    private readonly handleMove = (event: PointerEvent): void => {
        if (this.rejectedPointerIds.has(event.pointerId)) {
            return;
        }

        if (event.pointerType === 'pen') {
            this.lastPenContactAt = Date.now(); // Also records hover, as required for palm gating.
            this.markPenHover();
            this.options.onPenHoverOrContact?.(event);
        }

        if (this.isDrawingMove(event)) {
            if (this.activeDrawingPointerId !== event.pointerId) return;
            if (this.options.shouldAcceptPointer && !this.options.shouldAcceptPointer(event)) {
                return;
            }
            this.stopDrawingEvent(event);
            this.activeBarrel = this.isBarrel(event);

            // Do not create a fallback array here: this path runs for every input sample.
            const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null;
            const hasCoalesced = coalesced !== null && coalesced.length > 0;
            const bounds = this.target.getBoundingClientRect();
            const sampleCount = hasCoalesced ? coalesced.length : 1;
            for (let start = 0; start < sampleCount; start += this.pointPool.length) {
                const count = Math.min(this.pointPool.length, sampleCount - start);
                this.moveBatch.length = count;
                for (let i = 0; i < count; i++) {
                    const point = this.pointPool[i];
                    this.fillPoint(hasCoalesced ? coalesced[start + i] : event, bounds, point);
                    this.moveBatch[i] = point;
                }
                this.options.onStrokeMove?.(this.moveBatch, this.activeBarrel, event);
            }
            return;
        }

        if (event.pointerType !== 'touch') {
            if (!this.options.shouldAcceptPointer || this.options.shouldAcceptPointer(event)) {
                this.options.onHover?.(event);
            }
        }

        if (event.pointerType === 'touch' && this.isPalmRejected()) {
            event.preventDefault();
        }
    };

    private readonly handleEnter = (event: PointerEvent): void => {
        if (event.pointerType === 'pen') {
            this.lastPenContactAt = Date.now();
            this.markPenHover();
            this.options.onPenHoverOrContact?.(event);
        }
    };

    private readonly handleOver = (event: PointerEvent): void => {
        if (event.pointerType === 'pen') {
            this.lastPenContactAt = Date.now();
            this.markPenHover();
            this.options.onPenHoverOrContact?.(event);
        }
    };

    private readonly handleOut = (event: PointerEvent): void => {
        if (event.pointerType === 'pen') {
            this.clearPenHover();
        }
    };

    private readonly handleLeave = (event: PointerEvent): void => {
        if (event.pointerType === 'pen') {
            this.clearPenHover();
        }
        this.options.onPointerLeave?.(event);
    };

    private passThroughPointerEvent(event: PointerEvent): void {
        if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return;
        const elements = document.elementsFromPoint(event.clientX, event.clientY);
        const underlying = elements.find(el =>
            el !== this.target &&
            !this.target.contains(el) &&
            !el.classList?.contains('apolo-canvas-surface') &&
            !el.classList?.contains('apolo-canvas-layer')
        );
        const isHtmlEl = typeof HTMLElement !== 'undefined'
            ? underlying instanceof HTMLElement
            : Boolean(underlying && typeof (underlying as any).dispatchEvent === 'function');

        if (isHtmlEl && underlying) {
            const createEvent = (type: string): Event => {
                const buttonsVal = type === 'pointerup' ? 0 : event.buttons;
                if (typeof PointerEvent !== 'undefined') {
                    try {
                        return new PointerEvent(type, {
                            clientX: event.clientX,
                            clientY: event.clientY,
                            screenX: event.screenX,
                            screenY: event.screenY,
                            button: event.button,
                            buttons: buttonsVal,
                            pointerId: event.pointerId,
                            pointerType: event.pointerType,
                            isPrimary: event.isPrimary,
                            bubbles: true,
                            cancelable: true,
                        });
                    } catch {
                        // Fallback if PointerEvent constructor fails with non-standard options
                    }
                }
                const ce = new CustomEvent(type, { bubbles: true, cancelable: true });
                Object.assign(ce, {
                    clientX: event.clientX,
                    clientY: event.clientY,
                    screenX: event.screenX,
                    screenY: event.screenY,
                    button: event.button,
                    buttons: buttonsVal,
                    pointerId: event.pointerId,
                    pointerType: event.pointerType,
                    isPrimary: event.isPrimary,
                });
                return ce;
            };

            underlying.dispatchEvent(createEvent('pointerdown'));

            const scheduleRelease = typeof requestAnimationFrame === 'function'
                ? requestAnimationFrame
                : (cb: () => void) => setTimeout(cb, 0);

            scheduleRelease(() => {
                underlying.dispatchEvent(createEvent('pointerup'));

                if (event.button === 0) {
                    const clickable = typeof (underlying as any).closest === 'function'
                        ? ((underlying as any).closest('button, a, input, [role="button"], .clickable-icon') ?? underlying)
                        : underlying;
                    if (clickable && typeof (clickable as any).click === 'function') {
                        (clickable as any).click();
                    }
                }
            });
        }
    }

    private readonly handleUp = (event: PointerEvent): void => {
        if (this.rejectedPointerIds.has(event.pointerId)) {
            this.rejectedPointerIds.delete(event.pointerId);
            return;
        }
        if (!this.isDrawingEnd(event) || this.activeDrawingPointerId !== event.pointerId) return;
        this.stopDrawingEvent(event);
        this.options.onStrokeEnd?.(this.toPoint(event), this.activeBarrel || this.isBarrel(event), event);
        this.release(event);
        this.activeDrawingPointerId = null;
        this.activeDrawingPointerType = null;
        this.activeBarrel = false;
        if (event.pointerType === 'pen') this.lastPenContactAt = Date.now();
    };

    private readonly handleCancel = (event: PointerEvent): void => {
        if (this.rejectedPointerIds.has(event.pointerId)) {
            this.rejectedPointerIds.delete(event.pointerId);
            return;
        }
        if (!this.isDrawingEnd(event) || this.activeDrawingPointerId !== event.pointerId) return;
        this.stopDrawingEvent(event);
        this.release(event);
        this.activeDrawingPointerId = null;
        this.activeDrawingPointerType = null;
        this.activeBarrel = false;
        if (event.pointerType === 'pen') this.lastPenContactAt = Date.now();
        this.options.onStrokeCancel?.();
    };

    private readonly handleContextMenu = (event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
    };

    private stopDrawingEvent(event: PointerEvent): void {
        event.preventDefault();
        event.stopPropagation();
    }

    private isDrawingStart(event: PointerEvent): boolean {
        return event.pointerType === 'pen' || (this.isPrimaryMouse(event) && event.button === 0);
    }

    private isDrawingMove(event: PointerEvent): boolean {
        return event.pointerType === 'pen' || this.isPrimaryMouse(event);
    }

    private isDrawingEnd(event: PointerEvent): boolean {
        return event.pointerType === 'pen' || this.isPrimaryMouse(event);
    }

    private isPrimaryMouse(event: PointerEvent): boolean {
        return this.mouseDrawingEnabled && event.pointerType === 'mouse' && event.isPrimary;
    }

    private isPalmRejected(): boolean {
        return this.isPenHovering || (Date.now() - this.lastPenContactAt < this.cooldownMs);
    }

    private isBarrel(event: PointerEvent): boolean {
        return (event.buttons & 2) !== 0 || event.button === 2;
    }

    private fillPoint(event: PointerEvent, bounds: DOMRect, point: Point): void {
        point.x = event.clientX - bounds.left;
        point.y = event.clientY - bounds.top;
        point.pressure = event.pointerType === 'mouse' && event.pressure === 0 ? 0.5 : event.pressure;
        point.time = event.timeStamp;
    }

    private toPoint(event: PointerEvent): Point {
        const bounds = this.target.getBoundingClientRect();
        const point: Point = { x: 0, y: 0, pressure: 0, time: 0 };
        this.fillPoint(event, bounds, point);
        return point;
    }

    private capture(event: PointerEvent): void {
        try { this.target.setPointerCapture(event.pointerId); } catch { /* Pointer may already have left the target. */ }
    }

    private release(event: PointerEvent): void {
        try {
            if (this.target.hasPointerCapture(event.pointerId)) this.target.releasePointerCapture(event.pointerId);
        } catch { /* Capture can be lost before pointerup/cancel is delivered. */ }
    }
}
