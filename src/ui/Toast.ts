/**
 * Toast component for brief non-intrusive action confirmations.
 * (Copiado, Enlazado, Forma reconocida, Garabato detectado, Espacio insertado).
 */
export class Toast {
    private readonly element = document.createElement('div');
    private hideTimer: number | null = null;
    private transitionTimer: number | null = null;

    constructor(parent: HTMLElement = document.body) {
        this.element.className = 'apolo-toast';
        this.element.setAttribute('role', 'status');
        this.element.setAttribute('aria-live', 'polite');
        this.element.hidden = true;
        parent.appendChild(this.element);
    }

    show(message: string, durationMs = 2600): void {
        if (!message) {
            this.hide();
            return;
        }

        this.clearTimers();

        this.element.textContent = message;
        this.element.hidden = false;
        // Trigger reflow for smooth CSS transition
        void this.element.offsetHeight;
        this.element.classList.add('is-visible');

        this.hideTimer = window.setTimeout(() => {
            this.hide();
        }, durationMs);
    }

    hide(): void {
        this.clearHideTimer();
        this.element.classList.remove('is-visible');
        this.transitionTimer = window.setTimeout(() => {
            if (!this.element.classList.contains('is-visible')) {
                this.element.hidden = true;
            }
            this.transitionTimer = null;
        }, 250);
    }

    destroy(): void {
        this.clearTimers();
        this.element.remove();
    }

    private clearHideTimer(): void {
        if (this.hideTimer !== null) {
            window.clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
    }

    private clearTimers(): void {
        this.clearHideTimer();
        if (this.transitionTimer !== null) {
            window.clearTimeout(this.transitionTimer);
            this.transitionTimer = null;
        }
    }
}
