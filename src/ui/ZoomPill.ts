export interface ZoomPillCallbacks {
    onZoomIn: () => void;
    onZoomOut: () => void;
    onZoomFit: () => void;
}

export class ZoomPill {
    readonly container: HTMLElement;
    private zoom = 1;
    private readonly labelEl: HTMLElement;
    private readonly fitBtn: HTMLButtonElement;
    private callbacks: ZoomPillCallbacks;

    constructor(callbacks: ZoomPillCallbacks, parent: HTMLElement = document.body) {
        this.callbacks = callbacks;

        this.container = document.createElement('div');
        this.container.className = 'apolo-zoom-pill';
        this.container.setAttribute('role', 'toolbar');
        this.container.setAttribute('aria-label', 'Control de zoom');

        // Minus button
        const minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.className = 'apolo-zoom-btn';
        minusBtn.textContent = '−';
        minusBtn.setAttribute('aria-label', 'Alejar zoom');
        minusBtn.addEventListener('click', () => this.callbacks.onZoomOut());

        // Zoom percentage label
        this.labelEl = document.createElement('span');
        this.labelEl.className = 'apolo-zoom-label';
        this.labelEl.textContent = '100 %';

        // Plus button
        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.className = 'apolo-zoom-btn';
        plusBtn.textContent = '+';
        plusBtn.setAttribute('aria-label', 'Acercar zoom');
        plusBtn.addEventListener('click', () => this.callbacks.onZoomIn());

        // Fit button (visible when zoom > 1)
        this.fitBtn = document.createElement('button');
        this.fitBtn.type = 'button';
        this.fitBtn.className = 'apolo-zoom-fit-btn';
        this.fitBtn.textContent = 'Ajustar';
        this.fitBtn.setAttribute('aria-label', 'Ajustar al ancho de la página (100 %)');
        this.fitBtn.hidden = true;
        this.fitBtn.addEventListener('click', () => this.callbacks.onZoomFit());

        this.container.append(minusBtn, this.labelEl, plusBtn, this.fitBtn);
        parent.appendChild(this.container);
    }

    setZoom(zoom: number): void {
        this.zoom = zoom;
        this.labelEl.textContent = `${Math.round(zoom * 100)} %`;
        this.fitBtn.hidden = Math.abs(zoom - 1) < 0.05;
    }

    setVisible(visible: boolean): void {
        this.container.hidden = !visible;
    }

    destroy(): void {
        this.container.remove();
    }
}
