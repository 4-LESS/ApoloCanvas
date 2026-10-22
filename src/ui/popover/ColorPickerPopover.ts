import type { ToolbarSlot } from '../../core/types.ts';
import { ICONS, createSvg } from '../theme.ts';
import { applyPopoverGeometry } from './PopoverGeometry.ts';
import type { PopoverController, PopoverInstance } from '../kit/index.ts';

export type ColorPickerConfirmCallback = (
    color: string,
    opacity: number,
    slotIndex: number | null
) => void;

const SWATCHES_MATRIX: string[][] = [
    ['#FFFFFF', '#FBE5E5', '#FCECDD', '#FEF9E1', '#EFF9E3', '#E3F7E9', '#E0F7FA', '#E2F0FC', '#E5E8FC', '#EFE5FC', '#FCE5F7', '#FCE5EC'],
    ['#E0E0E0', '#F6B8B8', '#F8CEA3', '#FDF0A6', '#D6F1B4', '#B5EAC5', '#ACEBF2', '#B3D8F8', '#BBC3F8', '#D6B8F8', '#F7B8E8', '#F7B8CB'],
    ['#C2C2C2', '#F08686', '#F4AE64', '#FBE565', '#BBE882', '#84DD9E', '#74DFEC', '#80BFF3', '#8E9BF3', '#BB86F4', '#F186D8', '#F186A8'],
    ['#A3A3A3', '#EA5454', '#F08E26', '#F9DA24', '#A0DF50', '#53D078', '#3CD3E6', '#4DA6EE', '#6173EE', '#A054F0', '#EB54C8', '#EB5485'],
    ['#858585', '#E52222', '#DC730B', '#ECC406', '#85C92A', '#2BB656', '#18B8CC', '#1E88E5', '#3449E5', '#8522E5', '#E522B7', '#E52262'],
    ['#666666', '#C40D0D', '#B85D00', '#C8A500', '#6BA619', '#1A9940', '#0097A7', '#0D6ECD', '#1A2ECC', '#6B0DC4', '#C40D99', '#C40D49'],
    ['#4D4D4D', '#990606', '#8F4700', '#9C8000', '#528011', '#117730', '#007685', '#0855A0', '#11229F', '#530699', '#990677', '#990638'],
    ['#333333', '#6E0202', '#663200', '#705C00', '#3A5B0A', '#0A5521', '#00545C', '#043C73', '#0A1772', '#3B026E', '#6E0255', '#6E0227'],
    ['#1A1A1A', '#470000', '#422000', '#473A00', '#243A04', '#053614', '#00363B', '#02264A', '#050E4A', '#260047', '#470037', '#470019'],
    ['#000000', '#260000', '#241100', '#261F00', '#131F01', '#021C0A', '#001D20', '#011428', '#020728', '#140026', '#26001D', '#26000D'],
];

export class ColorPickerPopover implements PopoverInstance {
    readonly el: HTMLElement;
    get container(): HTMLElement {
        return this.el;
    }
    private openState = false;
    private popoverController?: PopoverController;
    private currentSlotIndex: number | null = null;
    private originalColor = '#FCFCFC';
    private currentColor = '#FCFCFC';
    private currentOpacity = 100;
    private originalOpacity = 100;
    private currentTab: 'samples' | 'spectrum' = 'samples';
    private onConfirmCallback: ColorPickerConfirmCallback | null = null;

    private static recentColors: string[] = ColorPickerPopover.loadStoredRecentColors();

    private static loadStoredRecentColors(): string[] {
        try {
            if (typeof localStorage !== 'undefined') {
                const stored = localStorage.getItem('apolo_recent_colors');
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        return parsed.slice(0, 5).map((c) => String(c).toUpperCase());
                    }
                }
            }
        } catch {
            // fallback
        }
        return ['#E53935', '#F58700', '#2F6BFF', '#FFFFFF', '#FF6D00'];
    }

    private static saveStoredRecentColors(): void {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('apolo_recent_colors', JSON.stringify(ColorPickerPopover.recentColors));
            }
        } catch {
            // fallback
        }
    }

    static pushRecentColor(hex: string): void {
        if (!hex || typeof hex !== 'string') return;
        const clean = hex.trim().toUpperCase();
        if (!/^#[0-9A-F]{3,8}$/.test(clean)) return;
        ColorPickerPopover.recentColors = [
            clean,
            ...ColorPickerPopover.recentColors.filter((c) => c.toUpperCase() !== clean),
        ].slice(0, 5);
        ColorPickerPopover.saveStoredRecentColors();
    }

    static getRecentColors(): string[] {
        return [...ColorPickerPopover.recentColors];
    }

    pushRecentColor(hex: string): void {
        ColorPickerPopover.pushRecentColor(hex);
        this.renderRecentSwatches();
        this.highlightRecentSelectedCell();
    }

    private gridEl?: HTMLElement;
    private readoutRow?: HTMLElement;
    private previewFillEl?: HTMLElement;
    private inHexEl?: HTMLInputElement;
    private inREl?: HTMLInputElement;
    private inGEl?: HTMLInputElement;
    private inBEl?: HTMLInputElement;
    private recentSwatchesEl?: HTMLElement;

    private currentAnchor: HTMLElement | null = null;
    private currentSlot: ToolbarSlot = 'tc';
    private currentToolbar: HTMLElement | null = null;

    constructor(parent: HTMLElement = document.body, popoverController?: PopoverController) {
        this.popoverController = popoverController;
        this.el = document.createElement('div');
        this.el.className = 'color-picker-popover apolo-color-picker-popover panel';
        this.el.dataset.mode = 'swatches';
        this.el.hidden = true;
        this.el.style.display = 'none';
        this.el.setAttribute('role', 'dialog');
        this.el.setAttribute('aria-label', 'Selector de color');
        this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
        this.el.addEventListener('touchstart', (e) => e.stopPropagation());

        parent.appendChild(this.el);
    }

    isOpen(): boolean {
        return this.openState;
    }

    hide(): void {
        this.close();
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

        if (this.currentColor && this.currentColor.startsWith('#')) {
            ColorPickerPopover.pushRecentColor(this.currentColor);
        }

        this.render();
        this.reposition(anchorEl, slot, toolbarEl);
        this.triggerAnimation();

        if (this.popoverController) {
            this.popoverController.open(this, anchorEl);
        }
    }

    close(): void {
        if (!this.openState) return;
        this.openState = false;
        this.el.hidden = true;
        this.el.style.display = 'none';
        this.el.classList.remove('apolo-popover-animated');
        if (this.popoverController) {
            this.popoverController.close(this);
        }
    }

    reposition(anchorEl = this.currentAnchor, slot = this.currentSlot, toolbarEl = this.currentToolbar): void {
        if (!this.openState || !anchorEl) return;
        this.currentAnchor = anchorEl;
        this.currentSlot = slot;
        this.currentToolbar = toolbarEl;
        applyPopoverGeometry(this.el, anchorEl, toolbarEl, slot, { fallbackWidth: 320, fallbackHeight: 440 });
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

        // 1. Control segmentado (Muestras / Espectro)
        const tabsRow = document.createElement('div');
        tabsRow.className = 'color-picker-tabs seg-control';
        tabsRow.setAttribute('role', 'tablist');
        tabsRow.setAttribute('aria-label', 'Modo de selección de color');

        const samplesBtn = document.createElement('button');
        samplesBtn.type = 'button';
        samplesBtn.className = `color-picker-tab-btn seg-btn ${this.currentTab === 'samples' ? 'is-active' : ''}`;
        samplesBtn.textContent = 'Muestras';
        samplesBtn.setAttribute('role', 'tab');
        samplesBtn.setAttribute('aria-selected', this.currentTab === 'samples' ? 'true' : 'false');
        samplesBtn.onclick = () => {
            this.currentTab = 'samples';
            this.el.dataset.mode = 'swatches';
            this.render();
        };

        const spectrumBtn = document.createElement('button');
        spectrumBtn.type = 'button';
        spectrumBtn.className = `color-picker-tab-btn seg-btn ${this.currentTab === 'spectrum' ? 'is-active' : ''}`;
        spectrumBtn.textContent = 'Espectro';
        spectrumBtn.setAttribute('role', 'tab');
        spectrumBtn.setAttribute('aria-selected', this.currentTab === 'spectrum' ? 'true' : 'false');
        spectrumBtn.onclick = () => {
            this.currentTab = 'spectrum';
            this.el.dataset.mode = 'spectrum';
            this.render();
        };

        tabsRow.append(samplesBtn, spectrumBtn);
        this.el.appendChild(tabsRow);

        // 2. Viewport (Swatches Matrix 12x10 o Espectro Continuo)
        const viewport = document.createElement('div');
        viewport.className = 'picker-viewport';

        if (this.currentTab === 'samples') {
            this.renderSwatchesGrid(viewport);
        } else {
            this.renderSpectrumCanvas(viewport);
        }
        this.el.appendChild(viewport);

        // 3. Fila de Muestra Activa + Campos Hex / Rojo / Verde / Azul
        this.readoutRow = document.createElement('div');
        this.readoutRow.className = 'color-readout-row color-meta-row';
        this.setupReadoutRow();
        this.updateReadoutVisual();
        this.el.appendChild(this.readoutRow);

        // 4. Slider de Transparencia
        const transPct = 100 - this.currentOpacity;
        const transGroup = document.createElement('div');
        transGroup.className = 'transparency-group popover-slider-section color-opacity-section';

        const transHd = document.createElement('div');
        transHd.className = 'transparency-hd';

        const transLabel = document.createElement('span');
        transLabel.className = 'section-label popover-slider-label';
        transLabel.textContent = 'Transparencia';

        const transVal = document.createElement('span');
        transVal.className = 'transparency-val popover-slider-label';
        transVal.textContent = `${transPct}%`;
        transHd.append(transLabel, transVal);

        const track = document.createElement('div');
        track.className = 'slider-track';
        track.style.setProperty('--pos', `${transPct}%`);
        track.setAttribute('role', 'slider');
        track.setAttribute('aria-label', 'Transparencia');
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.setAttribute('aria-valuenow', String(transPct));

        const fill = document.createElement('div');
        fill.className = 'slider-fill';

        const thumb = document.createElement('div');
        thumb.className = 'slider-thumb';

        track.append(fill, thumb);

        const updateTransparency = (clientX: number) => {
            const rect = track.getBoundingClientRect();
            const pct = Math.max(0, Math.min(100, Math.round(((clientX - rect.left) / (rect.width || 1)) * 100)));
            track.style.setProperty('--pos', `${pct}%`);
            track.setAttribute('aria-valuenow', String(pct));
            transVal.textContent = `${pct}%`;
            this.currentOpacity = 100 - pct;
            this.updateReadoutVisual();
        };

        track.addEventListener('pointerdown', (e: PointerEvent) => {
            try {
                track.setPointerCapture(e.pointerId);
            } catch {
                // best-effort
            }
            updateTransparency(e.clientX);
            const onMove = (ev: PointerEvent) => updateTransparency(ev.clientX);
            const onUp = (ev: PointerEvent) => {
                track.removeEventListener('pointermove', onMove);
                track.removeEventListener('pointerup', onUp);
                try {
                    track.releasePointerCapture(ev.pointerId);
                } catch {
                    // best-effort
                }
            };
            track.addEventListener('pointermove', onMove);
            track.addEventListener('pointerup', onUp);
        });

        transGroup.append(transHd, track);
        this.el.appendChild(transGroup);

        // Divider
        const divider = document.createElement('div');
        divider.className = 'divider eraser-divider';
        this.el.appendChild(divider);

        // 5. Colores recientes + Cuentagotas
        const recentRow = document.createElement('div');
        recentRow.className = 'recent-row color-quick-row';

        this.recentSwatchesEl = document.createElement('div');
        this.recentSwatchesEl.className = 'recent-swatches';
        this.renderRecentSwatches();
        recentRow.appendChild(this.recentSwatchesEl);

        const dropperBtn = document.createElement('button');
        dropperBtn.type = 'button';
        dropperBtn.className = 'ibtn color-eyedropper-btn';
        dropperBtn.title = 'Cuentagotas';
        dropperBtn.setAttribute('aria-label', 'Seleccionar color de la pantalla');
        dropperBtn.appendChild(createSvg(ICONS.eyedropper, { size: 18 }));
        dropperBtn.onclick = async () => {
            if (typeof window !== 'undefined' && (window as any).EyeDropper) {
                try {
                    const dropper = new (window as any).EyeDropper();
                    const res = await dropper.open();
                    this.currentColor = res.sRGBHex.toUpperCase();
                    this.pushRecentColor(this.currentColor);
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
                    this.pushRecentColor(this.currentColor);
                    this.updateReadoutVisual();
                    this.highlightGridSelectedCell();
                };
                inp.click();
            }
        };
        recentRow.appendChild(dropperBtn);
        this.el.appendChild(recentRow);

        // 6. Pie de Acciones (Cancelar | Listo)
        const footer = document.createElement('footer');
        footer.className = 'cp-footer color-picker-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'cp-action color-action-btn';
        cancelBtn.textContent = 'Cancelar';
        cancelBtn.onclick = () => this.close();

        const sep = document.createElement('div');
        sep.className = 'cp-sep';
        sep.setAttribute('aria-hidden', 'true');

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'cp-action primary is-confirm color-action-btn';
        confirmBtn.textContent = 'Listo';
        confirmBtn.onclick = () => {
            this.pushRecentColor(this.currentColor);
            if (this.onConfirmCallback) {
                this.onConfirmCallback(this.currentColor, this.currentOpacity, this.currentSlotIndex);
            }
            this.close();
        };

        footer.append(cancelBtn, sep, confirmBtn);
        this.el.appendChild(footer);
    }

    private setupReadoutRow(): void {
        if (!this.readoutRow) return;
        this.readoutRow.replaceChildren();

        const well = document.createElement('div');
        well.className = 'active-preview-well';
        well.title = 'Color seleccionado';

        this.previewFillEl = document.createElement('div');
        this.previewFillEl.className = 'active-preview-fill';
        well.appendChild(this.previewFillEl);

        // Hex Field
        const hexLabel = document.createElement('label');
        hexLabel.className = 'meta-field';
        const hexSpan = document.createElement('span');
        hexSpan.className = 'meta-label';
        hexSpan.textContent = 'Hex';
        this.inHexEl = document.createElement('input');
        this.inHexEl.className = 'meta-input';
        this.inHexEl.type = 'text';
        this.inHexEl.maxLength = 7;
        this.inHexEl.setAttribute('aria-label', 'Código hexadecimal');
        this.inHexEl.oninput = () => {
            let val = this.inHexEl?.value.trim() ?? '';
            if (!val.startsWith('#')) val = '#' + val;
            if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                this.currentColor = val.toUpperCase();
                this.updateReadoutVisual(this.inHexEl);
                this.highlightGridSelectedCell();
                this.highlightRecentSelectedCell();
            }
        };
        hexLabel.append(hexSpan, this.inHexEl);

        // Rojo Field
        const rLabel = document.createElement('label');
        rLabel.className = 'meta-field';
        const rSpan = document.createElement('span');
        rSpan.className = 'meta-label';
        rSpan.textContent = 'Rojo';
        this.inREl = document.createElement('input');
        this.inREl.className = 'meta-input';
        this.inREl.type = 'text';
        this.inREl.maxLength = 3;
        this.inREl.setAttribute('aria-label', 'Rojo');
        this.inREl.oninput = () => this.handleRgbInput(this.inREl);
        rLabel.append(rSpan, this.inREl);

        // Verde Field
        const gLabel = document.createElement('label');
        gLabel.className = 'meta-field';
        const gSpan = document.createElement('span');
        gSpan.className = 'meta-label';
        gSpan.textContent = 'Verde';
        this.inGEl = document.createElement('input');
        this.inGEl.className = 'meta-input';
        this.inGEl.type = 'text';
        this.inGEl.maxLength = 3;
        this.inGEl.setAttribute('aria-label', 'Verde');
        this.inGEl.oninput = () => this.handleRgbInput(this.inGEl);
        gLabel.append(gSpan, this.inGEl);

        // Azul Field
        const bLabel = document.createElement('label');
        bLabel.className = 'meta-field';
        const bSpan = document.createElement('span');
        bSpan.className = 'meta-label';
        bSpan.textContent = 'Azul';
        this.inBEl = document.createElement('input');
        this.inBEl.className = 'meta-input';
        this.inBEl.type = 'text';
        this.inBEl.maxLength = 3;
        this.inBEl.setAttribute('aria-label', 'Azul');
        this.inBEl.oninput = () => this.handleRgbInput(this.inBEl);
        bLabel.append(bSpan, this.inBEl);

        this.readoutRow.append(well, hexLabel, rLabel, gLabel, bLabel);
    }

    private handleRgbInput(skipInput?: HTMLElement | null): void {
        const r = Math.max(0, Math.min(255, parseInt(this.inREl?.value || '0', 10) || 0));
        const g = Math.max(0, Math.min(255, parseInt(this.inGEl?.value || '0', 10) || 0));
        const b = Math.max(0, Math.min(255, parseInt(this.inBEl?.value || '0', 10) || 0));
        this.currentColor = this.rgbToHex(r, g, b);
        this.updateReadoutVisual(skipInput);
        this.highlightGridSelectedCell();
        this.highlightRecentSelectedCell();
    }

    private renderSwatchesGrid(container: HTMLElement): void {
        this.gridEl = document.createElement('div');
        this.gridEl.className = 'color-swatches-grid swatches-grid';
        this.gridEl.setAttribute('role', 'grid');
        this.gridEl.setAttribute('aria-label', 'Muestras de color');

        SWATCHES_MATRIX.forEach((row) => {
            row.forEach((hex) => {
                this.gridEl!.appendChild(this.createGridCell(hex));
            });
        });

        container.appendChild(this.gridEl);
        this.highlightGridSelectedCell();
    }

    private renderRecentSwatches(): void {
        if (!this.recentSwatchesEl) return;
        this.recentSwatchesEl.replaceChildren();

        const recents = ColorPickerPopover.recentColors.slice(0, 5);
        recents.forEach((col) => {
            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className =
                'swatch color-quick-circle' +
                (this.currentColor.toUpperCase() === col.toUpperCase() ? ' is-active' : '');
            swatch.style.setProperty('--c', col);
            swatch.style.backgroundColor = col;
            swatch.dataset.hex = col.toUpperCase();
            swatch.title = col;
            swatch.setAttribute('aria-label', `Color ${col}`);
            swatch.onclick = () => {
                this.currentColor = col.toUpperCase();
                this.updateReadoutVisual();
                this.highlightGridSelectedCell();
                this.highlightRecentSelectedCell();
            };
            this.recentSwatchesEl!.appendChild(swatch);
        });
    }

    private createGridCell(hex: string): HTMLElement {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'color-matrix-cell cell';
        cell.style.setProperty('--c', hex);
        cell.style.backgroundColor = hex;
        cell.dataset.color = hex.toUpperCase();
        cell.title = hex;
        cell.setAttribute('aria-label', hex);
        cell.onclick = () => {
            this.currentColor = hex.toUpperCase();
            this.updateReadoutVisual();
            this.highlightGridSelectedCell();
            this.highlightRecentSelectedCell();
        };
        return cell;
    }

    private highlightGridSelectedCell(): void {
        if (!this.gridEl) return;
        const cur = this.currentColor.toUpperCase();
        this.gridEl.querySelectorAll('.color-matrix-cell, .cell').forEach((cell) => {
            cell.classList.toggle('is-selected', (cell as HTMLElement).dataset.color === cur);
        });
    }

    private highlightRecentSelectedCell(): void {
        if (!this.recentSwatchesEl) return;
        const cur = this.currentColor.toUpperCase();
        this.recentSwatchesEl.querySelectorAll('.swatch, .color-quick-circle').forEach((s) => {
            s.classList.toggle('is-active', (s as HTMLElement).dataset.hex === cur);
        });
    }

    private renderSpectrumCanvas(container: HTMLElement): void {
        const wrap = document.createElement('div');
        wrap.className = 'spectrum-box';

        const canvas = document.createElement('canvas');
        canvas.width = 292;
        canvas.height = 200;
        canvas.style.cssText = 'width: 100%; height: 100%; display: block; cursor: crosshair;';

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
                const scaleX = canvas.width / (rect.width || canvas.width);
                const scaleY = canvas.height / (rect.height || canvas.height);
                const x = Math.max(0, Math.min(canvas.width - 1, (e.clientX - rect.left) * scaleX));
                const y = Math.max(0, Math.min(canvas.height - 1, (e.clientY - rect.top) * scaleY));
                const p = ctx.getImageData(x, y, 1, 1).data;
                this.currentColor = this.rgbToHex(p[0], p[1], p[2]);
                this.updateReadoutVisual();
                this.highlightRecentSelectedCell();
            };

            canvas.onpointerdown = (e) => {
                try {
                    canvas.setPointerCapture(e.pointerId);
                } catch {
                    // best effort
                }
                handlePointer(e);
            };
            canvas.onpointermove = handlePointer;
        }

        wrap.appendChild(canvas);
        container.appendChild(wrap);
    }

    private updateReadoutVisual(skipInput?: HTMLElement | null): void {
        if (!this.previewFillEl) return;
        this.previewFillEl.style.backgroundColor = this.currentColor;
        this.previewFillEl.style.opacity = String(this.currentOpacity / 100);
        this.previewFillEl.style.setProperty('--alpha', String(this.currentOpacity / 100));

        const rgb = this.hexToRgb(this.currentColor);
        if (this.inHexEl && skipInput !== this.inHexEl) {
            this.inHexEl.value = this.currentColor.toUpperCase();
        }
        if (this.inREl && skipInput !== this.inREl) {
            this.inREl.value = String(rgb.r);
        }
        if (this.inGEl && skipInput !== this.inGEl) {
            this.inGEl.value = String(rgb.g);
        }
        if (this.inBEl && skipInput !== this.inBEl) {
            this.inBEl.value = String(rgb.b);
        }
    }

    destroy(): void {
        this.close();
        this.el.remove();
    }
}
