import type { Point } from '../../core/types.ts';
import { isStylusBarrelButton, hasDeliberateStylusMovement } from './StylusCapabilities.ts';

export interface InputManagerOptions {
    palmRejectionCooldownMs?: number;
    /** Enables primary-button mouse strokes for desktop and trackpad users. Defaults to true. */
    enableMouseDrawing?: boolean;
    /**
     * Controls whether `onStrokeStart`, `onStrokeMove`, and `onStrokeEnd` yield frozen,
     * immutable `Point` snapshots (`Object.freeze`) in a fresh batch array so retained
     * references are never mutated by subsequent move events.
     * Defaults to `true` unless `poolPoints: true` is set.
     */
    immutablePoints?: boolean;
    /**
     * Opt-in zero-allocation mode that reuses pre-allocated `Point` instances and a shared
     * `moveBatch` array across `onStrokeMove` callbacks.
     * WARNING: When `poolPoints` is `true` (or `immutablePoints` is `false`), points passed
     * to `onStrokeMove` are ephemeral and mutated on the next move batch; consumers MUST
     * copy point coordinates synchronously inside `onStrokeMove` if they retain them.
     * Defaults to `false`.
     */
    poolPoints?: boolean;
    /** Returns false to deactivate drawing input (e.g. in forbidden zones or UI overlays). */
    shouldAcceptPointer?: (event: PointerEvent) => boolean;
    onStrokeStart?: (pt: Point, isBarrel: boolean, rawEvent: PointerEvent) => void;
    /**
     * Called for each batch of movement samples.
     * By default (`immutablePoints: true`), both the batch array and each `Point` object
     * are frozen snapshots safe to retain. If `poolPoints: true` (or `immutablePoints: false`)
     * is configured, points are ephemeral pooled objects reused on the next move event and
     * must be copied by the consumer (e.g. via `InputManager.clonePoints(points)`).
     */
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
    private readonly useImmutablePoints: boolean;

    /** Creates independent, frozen copies of a point batch (useful when `poolPoints: true`). */
    public static clonePoints(points: readonly Point[]): Point[] {
        const copy = new Array<Point>(points.length);
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            copy[i] = Object.freeze({ x: p.x, y: p.y, pressure: p.pressure, time: p.time });
        }
        return copy;
    }

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
    private lastPointerDownTime = 0;
    private pointerDownStartPos: { x: number; y: number } | null = null;
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
        this.useImmutablePoints = options.immutablePoints !== undefined
            ? options.immutablePoints
            : !(options.poolPoints ?? false);
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

    isPointerRejected(pointerId: number): boolean {
        return this.rejectedPointerIds.has(pointerId);
    }

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

        this.lastPointerDownTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.pointerDownStartPos = { x: event.clientX, y: event.clientY };

        if (this.isDrawingStart(event)) {
            if (this.options.shouldAcceptPointer && !this.options.shouldAcceptPointer(event)) {
                // Drawing input is rejected: suppress canvas draw and block propagation.
                // Never synthesize or forward pointer/click events to underlying DOM elements.
                event.preventDefault();
                event.stopPropagation();
                this.rejectedPointerIds.add(event.pointerId);
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

        if (event.pointerType === 'touch' && this.shouldRejectTouch()) {
            event.preventDefault();
            event.stopPropagation();
            this.rejectedPointerIds.add(event.pointerId);
            return;
        }

        if (event.pointerType === 'mouse' && event.button === 0) {
            if (this.shouldRejectTouch() || (this.options.shouldAcceptPointer && !this.options.shouldAcceptPointer(event))) {
                event.preventDefault();
                event.stopPropagation();
                this.rejectedPointerIds.add(event.pointerId);
                return;
            }
            this.options.onNonDrawingPointerDown?.(event);
        }
    };

    private readonly handleMove = (event: PointerEvent): void => {
        if (this.rejectedPointerIds.has(event.pointerId)) {
            event.preventDefault();
            event.stopPropagation();
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

            const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null;
            const hasCoalesced = coalesced !== null && coalesced.length > 0;
            const bounds = this.target.getBoundingClientRect();
            const sampleCount = hasCoalesced ? coalesced.length : 1;

            if (this.useImmutablePoints) {
                const batch = new Array<Point>(sampleCount);
                for (let i = 0; i < sampleCount; i++) {
                    const point: Point = { x: 0, y: 0, pressure: 0, time: 0 };
                    this.fillPoint(hasCoalesced ? coalesced[i] : event, bounds, point);
                    batch[i] = Object.freeze(point);
                }
                this.options.onStrokeMove?.(Object.freeze(batch) as unknown as Point[], this.activeBarrel, event);
                return;
            }

            // Pooled mode: reuse pre-allocated Point instances and moveBatch array in 256-sample chunks.
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

        if (event.pointerType === 'touch' && this.shouldRejectTouch()) {
            event.preventDefault();
            event.stopPropagation();
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

    private readonly handleUp = (event: PointerEvent): void => {
        if (this.rejectedPointerIds.has(event.pointerId)) {
            this.rejectedPointerIds.delete(event.pointerId);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.pointerType === 'touch' && this.shouldRejectTouch()) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (!this.isDrawingEnd(event) || this.activeDrawingPointerId !== event.pointerId) return;
        this.stopDrawingEvent(event);
        this.options.onStrokeEnd?.(this.toPoint(event), this.activeBarrel || this.isBarrel(event), event);
        this.release(event);
        this.activeDrawingPointerId = null;
        this.activeDrawingPointerType = null;
        this.activeBarrel = false;
        this.lastPointerDownTime = 0;
        this.pointerDownStartPos = null;
        if (event.pointerType === 'pen') this.lastPenContactAt = Date.now();
    };

    private readonly handleCancel = (event: PointerEvent): void => {
        if (this.rejectedPointerIds.has(event.pointerId)) {
            this.rejectedPointerIds.delete(event.pointerId);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.pointerType === 'touch' && this.shouldRejectTouch()) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (!this.isDrawingEnd(event) || this.activeDrawingPointerId !== event.pointerId) return;
        this.stopDrawingEvent(event);
        this.release(event);
        this.activeDrawingPointerId = null;
        this.activeDrawingPointerType = null;
        this.activeBarrel = false;
        this.lastPointerDownTime = 0;
        this.pointerDownStartPos = null;
        if (event.pointerType === 'pen') this.lastPenContactAt = Date.now();
        this.options.onStrokeCancel?.();
    };

    public cancelActiveDrawing(): void {
        if (this.activeDrawingPointerId !== null) {
            this.activeDrawingPointerId = null;
            this.activeDrawingPointerType = null;
            this.activeBarrel = false;
            this.lastPointerDownTime = 0;
            this.pointerDownStartPos = null;
            this.options.onStrokeCancel?.();
        }
    }

    private readonly handleContextMenu = (event: MouseEvent): void => {
        event.preventDefault?.();
        event.stopPropagation?.();

        // Strictly reject non-pen pointers (mouse, touch)
        if ('pointerType' in event && (event as any).pointerType && (event as any).pointerType !== 'pen') {
            return;
        }

        // Only confirmed physical barrel button signals are allowed to cancel active drawing
        const isConfirmedBarrel = this.activeBarrel || isStylusBarrelButton(event as any);
        if (!isConfirmedBarrel) {
            return;
        }

        // If the stylus has already demonstrated deliberate drawing movement (>8px from pointerdown),
        // do NOT abort or discard the stroke on stray contextmenu signals.
        const hasMoved = hasDeliberateStylusMovement(
            this.pointerDownStartPos,
            { x: event.clientX, y: event.clientY },
            8,
        );
        if (hasMoved) {
            return;
        }

        if (this.activeDrawingPointerId !== null) {
            this.cancelActiveDrawing();
        }
    };

    private stopDrawingEvent(event: PointerEvent): void {
        event.preventDefault?.();
        event.stopPropagation?.();
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

    isPalmRejected(): boolean {
        return this.isPenHovering || (Date.now() - this.lastPenContactAt < this.cooldownMs);
    }

    private isBarrel(event: PointerEvent): boolean {
        return isStylusBarrelButton(event);
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
        return this.useImmutablePoints ? Object.freeze(point) : point;
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
