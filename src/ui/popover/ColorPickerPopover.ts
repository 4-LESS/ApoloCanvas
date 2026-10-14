import type { ToolbarSlot } from '../../core/types.ts';
import { ICONS, createSvg } from '../theme.ts';
import { applyPopoverGeometry } from './PopoverGeometry.ts';

export type ColorPickerConfirmCallback = (
    color: string,
    opacity: number,
    slotIndex: number | null
) => void;

export class ColorPickerPopover {
    readonly el: HTMLElement;
    private openState = false;
    private currentSlotIndex: number | null = null;
    private originalColor = '#FCFCFC';
    private currentColor = '#FCFCFC';
    private currentOpacity = 100;
    private originalOpacity = 100;
    private currentTab: 'samples' | 'spectrum' = 'samples';
    private onConfirmCallback: ColorPickerConfirmCallback | null = null;

    private readonly quickPalette = ['#E53935', '#FB8C00', '#2979FF', '#FFFFFF', '#FF6D00'];
    private gridEl?: HTMLElement;
    private readoutRow?: HTMLElement;

    private currentAnchor: HTMLElement | null = null;
    private currentSlot: ToolbarSlot = 'tc';
    private currentToolbar: HTMLElement | null = null;

    constructor(parent: HTMLElement = document.body) {
        this.el = document.createElement('div');
        this.el.className = 'color-picker-popover';
        this.el.hidden = true;
        this.el.style.display = 'none';
        this.el.setAttribute('role', 'dialog');
        this.el.setAttribute('aria-label', 'Selector de color');
        this.el.addEventListener('pointerdown', (e) => e.stopPropagation());

        parent.appendChild(this.el);
    }

    isOpen(): boolean {
        return this.openState;
    }

    getCurrentSlotIndex(): number | null {
        return this.currentSlotIndex;
    }

    open(
        anchorEl: HTMLElement,
        slot: ToolbarSlot,
        toolbarEl: HTMLElement,
        initialColor: string,
        onConfirm: ColorPickerConfirmCallback,
        slotIndex: number | null = null,
        initialOpacity = 100
    ): void {
        this.openState = true;
        this.el.hidden = false;
        this.el.style.display = 'flex';
        this.currentAnchor = anchorEl;
        this.currentSlot = slot;
        this.currentToolbar = toolbarEl;
        this.currentSlotIndex = slotIndex;
        this.originalColor = initialColor || '#FCFCFC';
        this.currentColor = this.originalColor;
        this.originalOpacity = Math.max(0, Math.min(100, Number(initialOpacity) || 0));
        this.currentOpacity = this.originalOpacity;
        this.onConfirmCallback = onConfirm;

        this.render();
        this.reposition(anchorEl, slot, toolbarEl);
        this.triggerAnimation();
    }

    close(): void {
        if (!this.openState) return;
        this.openState = false;
        this.el.hidden = true;
        this.el.style.display = 'none';
        this.el.classList.remove('apolo-popover-animated');
    }

    reposition(anchorEl = this.currentAnchor, slot = this.currentSlot, toolbarEl = this.currentToolbar): void {
        if (!this.openState || !anchorEl) return;
        this.currentAnchor = anchorEl;
        this.currentSlot = slot;
        this.currentToolbar = toolbarEl;
        applyPopoverGeometry(this.el, anchorEl, toolbarEl, slot, { fallbackWidth: 326, fallbackHeight: 460 });
    }

    private triggerAnimation(): void {
        this.el.classList.remove('apolo-popover-animated');
        void this.el.offsetWidth;
        this.el.classList.add('apolo-popover-animated');
    }

    private hexToRgb(hex: string): { r: number; g: number; b: number } {
        let clean = hex.replace('#', '');
        if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('');
        const num = parseInt(clean, 16);
        if (isNaN(num)) return { r: 255, g: 255, b: 255 };
        return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }

    private rgbToHex(r: number, g: number, b: number): string {
        return (
            '#' +
            [r, g, b]
                .map((x) => {
                    const hex = Math.round(x).toString(16);
                    return hex.length === 1 ? '0' + hex : hex;
                })
                .join('')
                .toUpperCase()
        );
    }

    private hslToHex(h: number, s: number, l: number): string {
        l /= 100;
        const a = (s * Math.min(l, 1 - l)) / 100;
        const f = (n: number) => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color)
                .toString(16)
                .padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
    }

    private render(): void {
        this.el.replaceChildren();

        // 1. Tabs
        const tabsRow = document.createElement('div');
        tabsRow.className = 'color-picker-tabs';

        const samplesBtn = document.createElement('button');
        samplesBtn.type = 'button';
        samplesBtn.className = `color-picker-tab-btn ${this.currentTab === 'samples' ? 'is-active' : ''}`;
        samplesBtn.textContent = 'Muestras';
        samplesBtn.onclick = () => {
            this.currentTab = 'samples';
            this.render();
        };

        const spectrumBtn = document.createElement('button');
        spectrumBtn.type = 'button';
        spectrumBtn.className = `color-picker-tab-btn ${this.currentTab === 'spectrum' ? 'is-active' : ''}`;
        spectrumBtn.textContent = 'Espectro';
        spectrumBtn.onclick = () => {
            this.currentTab = 'spectrum';
            this.render();
        };

        tabsRow.append(samplesBtn, spectrumBtn);
        this.el.appendChild(tabsRow);

        // 2. Body based on active tab
        if (this.currentTab === 'samples') {
            this.renderSwatchesGrid();
        } else {
            this.renderSpectrumCanvas();
        }

        // 3. Readout row (Dual preview + RGB values)
        this.readoutRow = document.createElement('div');
        this.readoutRow.className = 'color-readout-row';
        this.updateReadoutVisual();
        this.el.appendChild(this.readoutRow);

        // 4. Transparency / Opacity Slider
        const opacityWrap = document.createElement('div');
        opacityWrap.className = 'popover-slider-section color-opacity-section';
        const opacityHeader = document.createElement('div');
        opacityHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
        const opacityLabel = document.createElement('span');
        opacityLabel.className = 'popover-slider-label';
        opacityLabel.textContent = 'Transparencia';
        const opacityValue = document.createElement('span');
        opacityValue.className = 'popover-slider-label';
        opacityValue.textContent = `${100 - this.currentOpacity}%`;
        opacityHeader.append(opacityLabel, opacityValue);

        const opacityInput = document.createElement('input');
        opacityInput.type = 'range';
        opacityInput.min = '0';
        opacityInput.max = '100';
        opacityInput.step = '1';
        opacityInput.value = String(100 - this.currentOpacity);
        opacityInput.setAttribute('aria-label', 'Transparencia del color');
        opacityInput.style.cssText = 'width:100%;cursor:pointer;';
        opacityInput.oninput = () => {
            this.currentOpacity = 100 - Number(opacityInput.value);
            opacityValue.textContent = `${opacityInput.value}%`;
            this.updateReadoutVisual();
        };
        opacityWrap.append(opacityHeader, opacityInput);
        this.el.appendChild(opacityWrap);

        const divider = document.createElement('div');
        divider.className = 'eraser-divider';
        this.el.appendChild(divider);

        // 5. Quick Palette Circles & Eyedropper
        const quickRow = document.createElement('div');
        quickRow.className = 'color-quick-row';

        this.quickPalette.forEach((col) => {
            const cBtn = document.createElement('button');
            cBtn.type = 'button';
            cBtn.className = 'color-quick-circle';
            cBtn.style.setProperty('--quick-color', col);
            cBtn.style.backgroundColor = col;
            cBtn.setAttribute('aria-label', `Color rápido ${col}`);
            cBtn.onclick = () => {
                this.currentColor = col;
                this.updateReadoutVisual();
                this.highlightGridSelectedCell();
            };
            quickRow.appendChild(cBtn);
        });

        const dropperBtn = document.createElement('button');
        dropperBtn.type = 'button';
        dropperBtn.className = 'color-eyedropper-btn';
        dropperBtn.title = 'Selector cuentagotas';
        dropperBtn.appendChild(createSvg(ICONS.eyedropper, { size: 18 }));
        dropperBtn.onclick = async () => {
            if (typeof window !== 'undefined' && (window as any).EyeDropper) {
                try {
                    const dropper = new (window as any).EyeDropper();
                    const res = await dropper.open();
                    this.currentColor = res.sRGBHex.toUpperCase();
                    this.updateReadoutVisual();
                    this.highlightGridSelectedCell();
                } catch {
                    // Canceled by user
                }
            } else {
                const inp = document.createElement('input');
                inp.type = 'color';
                inp.value = this.currentColor;
                inp.oninput = () => {
                    this.currentColor = inp.value.toUpperCase();
                    this.updateReadoutVisual();
                };
                inp.click();
            }
        };
        quickRow.appendChild(dropperBtn);
        this.el.appendChild(quickRow);

        // 6. Action buttons (Cancelar / Realiz.)
        const actionsRow = document.createElement('div');
        actionsRow.className = 'color-picker-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'color-action-btn';
        cancelBtn.textContent = 'Cancelar';
        cancelBtn.onclick = () => this.close();

        const dividerSpan = document.createElement('span');
        dividerSpan.textContent = '|';
        dividerSpan.style.color = 'var(--apolo-border-subtle)';

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'color-action-btn is-confirm';
        confirmBtn.textContent = 'Realiz.';
        confirmBtn.onclick = () => {
            if (this.onConfirmCallback) {
                this.onConfirmCallback(this.currentColor, this.currentOpacity, this.currentSlotIndex);
            }
            this.close();
        };

        actionsRow.append(cancelBtn, dividerSpan, confirmBtn);
        this.el.appendChild(actionsRow);
    }

    private renderSwatchesGrid(): void {
        this.gridEl = document.createElement('div');
        this.gridEl.className = 'color-swatches-grid';

        const hues = [0, 25, 45, 60, 100, 150, 185, 215, 240, 275, 315];
        const lightnessSteps = [96, 88, 78, 68, 58, 48, 38, 28, 18, 8];

        for (let row = 0; row < 10; row++) {
            const grayVal = Math.round(255 * (1 - row / 9));
            const grayHex = this.rgbToHex(grayVal, grayVal, grayVal);
            this.gridEl.appendChild(this.createGridCell(grayHex));

            for (let col = 0; col < 11; col++) {
                const h = hues[col];
                const l = lightnessSteps[row];
                const s = row < 2 ? 80 : 100;
                const hex = this.hslToHex(h, s, l);
                this.gridEl.appendChild(this.createGridCell(hex));
            }
        }

        this.el.appendChild(this.gridEl);
        this.highlightGridSelectedCell();
    }

    private createGridCell(hex: string): HTMLElement {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'color-matrix-cell';
        cell.style.backgroundColor = hex;
        cell.dataset.color = hex.toUpperCase();
        cell.onclick = () => {
            this.currentColor = hex.toUpperCase();
            this.updateReadoutVisual();
            this.highlightGridSelectedCell();
        };
        return cell;
    }

    private highlightGridSelectedCell(): void {
        if (!this.gridEl) return;
        const cur = this.currentColor.toUpperCase();
        this.gridEl.querySelectorAll('.color-matrix-cell').forEach((cell) => {
            cell.classList.toggle('is-selected', (cell as HTMLElement).dataset.color === cur);
        });
    }

    private renderSpectrumCanvas(): void {
        const wrap = document.createElement('div');
        wrap.style.cssText =
            'height: 200px; display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; background: var(--apolo-bg-alt); border-radius: 12px;';

        const canvas = document.createElement('canvas');
        canvas.width = 280;
        canvas.height = 160;
        canvas.style.borderRadius = '8px';
        canvas.style.cursor = 'crosshair';

        const ctx = canvas.getContext('2d');
        if (ctx) {
            const gradH = ctx.createLinearGradient(0, 0, canvas.width, 0);
            gradH.addColorStop(0, '#f00');
            gradH.addColorStop(0.17, '#ff0');
            gradH.addColorStop(0.33, '#0f0');
            gradH.addColorStop(0.5, '#0ff');
            gradH.addColorStop(0.67, '#00f');
            gradH.addColorStop(0.83, '#f0f');
            gradH.addColorStop(1, '#f00');
            ctx.fillStyle = gradH;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const gradV = ctx.createLinearGradient(0, 0, 0, canvas.height);
            gradV.addColorStop(0, 'rgba(255,255,255,1)');
            gradV.addColorStop(0.5, 'rgba(255,255,255,0)');
            gradV.addColorStop(0.5, 'rgba(0,0,0,0)');
            gradV.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = gradV;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const handlePointer = (e: PointerEvent) => {
                if (e.buttons !== 1) return;
                const rect = canvas.getBoundingClientRect();
                const x = Math.max(0, Math.min(canvas.width - 1, e.clientX - rect.left));
                const y = Math.max(0, Math.min(canvas.height - 1, e.clientY - rect.top));
                const p = ctx.getImageData(x, y, 1, 1).data;
                this.currentColor = this.rgbToHex(p[0], p[1], p[2]);
                this.updateReadoutVisual();
            };

            canvas.onpointerdown = handlePointer;
            canvas.onpointermove = handlePointer;
        }

        wrap.appendChild(canvas);
        this.el.appendChild(wrap);
    }

    private updateReadoutVisual(): void {
        if (!this.readoutRow) return;
        this.readoutRow.replaceChildren();

        const dualPreview = document.createElement('div');
        dualPreview.className = 'color-dual-preview';

        const prevOrig = document.createElement('div');
        prevOrig.className = 'color-preview-orig';
        prevOrig.style.backgroundColor = this.originalColor;
        prevOrig.style.opacity = String(this.originalOpacity / 100);

        const prevCurr = document.createElement('div');
        prevCurr.className = 'color-preview-curr';
        prevCurr.style.backgroundColor = this.currentColor;
        prevCurr.style.opacity = String(this.currentOpacity / 100);

        dualPreview.append(prevOrig, prevCurr);

        const rgb = this.hexToRgb(this.currentColor);
        const vals = document.createElement('div');
        vals.className = 'color-readout-values';

        const fields = [
            { label: 'Hex', val: this.currentColor },
            { label: 'Rojo', val: String(rgb.r) },
            { label: 'Verde', val: String(rgb.g) },
            { label: 'Azul', val: String(rgb.b) },
        ];

        fields.forEach((f) => {
            const g = document.createElement('div');
            g.className = 'color-val-group';
            const lbl = document.createElement('span');
            lbl.className = 'color-val-label';
            lbl.textContent = f.label;
            const num = document.createElement('span');
            num.className = 'color-val-num';
            num.textContent = f.val;
            g.append(lbl, num);
            vals.appendChild(g);
        });

        this.readoutRow.append(dualPreview, vals);
    }

    destroy(): void {
        this.close();
        this.el.remove();
    }
}
