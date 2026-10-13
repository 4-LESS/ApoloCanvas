export interface PopoverInstance {
    readonly container: HTMLElement;
    hide: () => void;
    isOpen: () => boolean;
}

interface ActivePopoverEntry {
    popover: PopoverInstance;
    triggerEl?: HTMLElement | null;
}

/**
 * PopoverController: Centralized manager for floating popover layers.
 *
 * Implements Architecture Rule 4:
 * "Un único juego de listeners globales (clic afuera, Escape, pila de capas abiertas)...
 *  Los disparadores se marcan con un atributo data-apolo-popover-trigger en lugar de buscar clases."
 */
export class PopoverController {
    private stack: ActivePopoverEntry[] = [];
    private isListening = false;

    constructor() {
        this.bindGlobalListeners();
    }

    private bindGlobalListeners(): void {
        if (typeof window === 'undefined' || this.isListening) return;
        window.addEventListener('pointerdown', this.onWindowPointerDown, { capture: true });
        window.addEventListener('keydown', this.onWindowKeyDown);
        this.isListening = true;
    }

    private unbindGlobalListeners(): void {
        if (typeof window === 'undefined' || !this.isListening) return;
        window.removeEventListener('pointerdown', this.onWindowPointerDown, { capture: true });
        window.removeEventListener('keydown', this.onWindowKeyDown);
        this.isListening = false;
    }

    private readonly onWindowPointerDown = (event: PointerEvent): void => {
        if (this.stack.length === 0) return;

        const target = event.target as Node | null;
        if (!target) return;

        // Iterate top-down through open popovers
        for (let i = this.stack.length - 1; i >= 0; i--) {
            const entry = this.stack[i];
            if (!entry.popover.isOpen()) {
                this.stack.splice(i, 1);
                continue;
            }

            // If click is inside popover container, don't dismiss it
            if (entry.popover.container.contains(target)) {
                return;
            }

            // If click is on the trigger that opened this popover, let the trigger handle toggle
            if (entry.triggerEl && (entry.triggerEl === target || entry.triggerEl.contains(target))) {
                return;
            }

            // If clicked on an element explicitly marked as a popover trigger, avoid dismiss race
            if (target && typeof (target as any).closest === 'function') {
                const trigger = (target as any).closest('[data-apolo-popover-trigger="true"]');
                if (trigger && trigger === entry.triggerEl) {
                    return;
                }
            }

            // Outside click: dismiss this popover
            entry.popover.hide();
            this.stack.splice(i, 1);
        }
    };

    private readonly onWindowKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && this.stack.length > 0) {
            const top = this.stack.pop();
            if (top && top.popover.isOpen()) {
                event.preventDefault();
                event.stopPropagation();
                top.popover.hide();
            }
        }
    };

    /**
     * Opens or registers a popover into the stack.
     */
    open(popover: PopoverInstance, triggerEl?: HTMLElement | null): void {
        // If already in stack, remove prior entry
        this.stack = this.stack.filter(e => e.popover !== popover);
        this.stack.push({ popover, triggerEl });
    }

    /**
     * Closes a specific popover and removes it from the active stack.
     */
    close(popover: PopoverInstance): void {
        const idx = this.stack.findIndex(e => e.popover === popover);
        if (idx !== -1) {
            this.stack.splice(idx, 1);
        }
        if (popover.isOpen()) {
            popover.hide();
        }
    }

    /**
     * Closes all currently open popovers in the stack.
     */
    closeAll(): void {
        while (this.stack.length > 0) {
            const entry = this.stack.pop();
            if (entry?.popover.isOpen()) {
                entry.popover.hide();
            }
        }
    }

    isOpen(popover: PopoverInstance): boolean {
        return popover.isOpen();
    }

    isAnyOpen(): boolean {
        return this.stack.some(e => e.popover.isOpen());
    }

    destroy(): void {
        this.closeAll();
        this.unbindGlobalListeners();
    }
}
