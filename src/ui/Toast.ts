/**
 * Toast component for brief non-intrusive action confirmations.
 * (Copiado, Enlazado, Forma reconocida, Garabato detectado, Espacio insertado).
 */
export class Toast {
    private readonly element = document.createElement('div');
    private hideTimer: number | null = null;

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

        if (this.hideTimer !== null) {
            window.clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }

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
        if (this.hideTimer !== null) {
            window.clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        this.element.classList.remove('is-visible');
        window.setTimeout(() => {
            if (!this.element.classList.contains('is-visible')) {
                this.element.hidden = true;
            }
        }, 250);
    }

    destroy(): void {
        if (this.hideTimer !== null) {
            window.clearTimeout(this.hideTimer);
        }
        this.element.remove();
    }
}
