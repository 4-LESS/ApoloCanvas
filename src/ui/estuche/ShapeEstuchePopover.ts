import type { ShapeType, ToolbarSlot } from '../../core/types.ts';
import { ICONS, createSvg } from '../theme.ts';
import { applyPopoverGeometry } from '../popover/PopoverGeometry.ts';
import type { OpenColorPickerFn } from './PenEstuchePopover.ts';

export interface ShapeEstucheState {
    shape: ShapeType;
    lineStyle: 'solid' | 'dashed' | 'dotted';
    strokeWidth: number;
    strokeColor: string;
    strokeOpacity: number;
    fillEnabled: boolean;
    syncColors: boolean;
    fillColor: string;
    fillOpacity: number;
}

export class ShapeEstuchePopover {
    readonly el: HTMLElement;
    private onStateChange: (state: ShapeEstucheState) => void;
    private onOpenColorPicker?: OpenColorPickerFn;
    private openState = false;

    private state: ShapeEstucheState = {
        shape: 'rect',
        lineStyle: 'solid',
        strokeWidth: 3,
        strokeColor: '#2F6BFF',
        strokeOpacity: 100,
        fillEnabled: false,
        syncColors: true,
        fillColor: '#2F6BFF',
        fillOpacity: 100,
    };

    private strokeColors: string[] = ['#111827', '#2F6BFF', '#FFA726', '#10B981', '#E53935', '#8E24AA'];
    private fillColors: string[] = ['#9CA3AF', '#93C5FD', '#FED7AA', '#A7F3D0', '#FECACA', '#E9D5FF'];

    private currentAnchor: HTMLElement | null = null;
    private currentSlot: ToolbarSlot = 'tc';
    private currentToolbar: HTMLElement | null = null;

    private readonly shapes: Array<{ id: ShapeType; label: string; iconD: string }> = [
        { id: 'line', label: 'Línea', iconD: ICONS.shapes.line },
        { id: 'arrow', label: 'Flecha', iconD: ICONS.shapes.arrow },
        { id: 'rect', label: 'Rectángulo', iconD: ICONS.shapes.rect },
        { id: 'ellipse', label: 'Círculo', iconD: ICONS.shapes.circle },
        { id: 'triangle', label: 'Triángulo', iconD: ICONS.shapes.triangle },
    ];

    constructor(
        onStateChange: (state: ShapeEstucheState) => void,
        onOpenColorPicker?: OpenColorPickerFn,
        parent: HTMLElement = document.body
    ) {
        this.onStateChange = onStateChange;
        this.onOpenColorPicker = onOpenColorPicker;

        this.el = document.createElement('div');
        this.el.className = 'apolo-estuche-popover';
        this.el.style.width = '330px';
        this.el.style.display = 'none';
        this.el.setAttribute('role', 'dialog');
        this.el.setAttribute('aria-label', 'Estuche de formas');
        this.el.addEventListener('pointerdown', (e) => e.stopPropagation());

        parent.appendChild(this.el);
    }

    isOpen(): boolean {
        return this.openState;
    }

    open(
        anchorEl: HTMLElement,
        slot: ToolbarSlot,
        toolbarEl: HTMLElement,
        initialState?: Partial<ShapeEstucheState>
    ): void {
        this.openState = true;
        this.currentAnchor = anchorEl;
        this.currentSlot = slot;
        this.currentToolbar = toolbarEl;
        if (initialState) {
            this.state = { ...this.state, ...initialState };
        }

        this.render();
        this.reposition(anchorEl, slot, toolbarEl);
        this.triggerAnimation();
    }

    close(): void {
        if (!this.openState) return;
        this.openState = false;
        this.el.style.display = 'none';
        this.el.classList.remove('apolo-popover-animated');
    }

    reposition(anchorEl = this.currentAnchor, slot = this.currentSlot, toolbarEl = this.currentToolbar): void {
        if (!this.openState || !anchorEl) return;
        this.currentAnchor = anchorEl;
        this.currentSlot = slot;
        this.currentToolbar = toolbarEl;
        applyPopoverGeometry(this.el, anchorEl, toolbarEl, slot, { fallbackWidth: 330, fallbackHeight: 520 });
    }

    private triggerAnimation(): void {
        this.el.classList.remove('apolo-popover-animated');
        void this.el.offsetWidth;
        this.el.classList.add('apolo-popover-animated');
    }

    updateState(partial: Partial<ShapeEstucheState>): void {
        this.state = { ...this.state, ...partial };
        if (this.openState) {
            this.render();
        }
    }

    private render(): void {
        this.el.replaceChildren();

        // 1. Header
        const header = document.createElement('div');
        header.className = 'popover-header';

        const favsBtn = document.createElement('button');
        favsBtn.type = 'button';
        favsBtn.className = 'popover-hdr-btn';
        favsBtn.title = 'Formas favoritas';
        favsBtn.appendChild(createSvg(ICONS.bookmark, { size: 18 }));
        header.appendChild(favsBtn);

        const rightBtns = document.createElement('div');
        rightBtns.className = 'popover-header-right';

        const starBtn = document.createElement('button');
        starBtn.type = 'button';
        starBtn.className = 'popover-hdr-btn';
        starBtn.title = 'Guardar forma en favoritos';
        starBtn.appendChild(createSvg(ICONS.star, { size: 18 }));
        starBtn.onclick = () => starBtn.classList.toggle('is-fav-saved');

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'popover-hdr-btn popover-close';
        closeBtn.title = 'Cerrar';
        closeBtn.appendChild(createSvg(ICONS.close, { size: 16 }));
        closeBtn.onclick = () => this.close();

        rightBtns.append(starBtn, closeBtn);
        header.appendChild(rightBtns);
        this.el.appendChild(header);

        // 2. Grid de 5 formas
        const shapesGrid = document.createElement('div');
        shapesGrid.className = 'shape-grid-selector';

        for (const s of this.shapes) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `shape-grid-btn ${this.state.shape === s.id ? 'is-active' : ''}`;
            btn.title = s.label;
            btn.appendChild(createSvg(s.iconD, { size: 24 }));

            btn.onclick = () => {
                this.state.shape = s.id;
                shapesGrid.querySelectorAll('.shape-grid-btn').forEach((b) => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                this.onStateChange(this.state);
            };
            shapesGrid.appendChild(btn);
        }
        this.el.appendChild(shapesGrid);

        // 3. Estilos de línea
        const stylesRow = document.createElement('div');
        stylesRow.className = 'popover-lines-grid';
        const styles: Array<{ id: 'solid' | 'dashed' | 'dotted'; cls: string }> = [
            { id: 'solid', cls: '' },
            { id: 'dashed', cls: 'is-dashed' },
            { id: 'dotted', cls: 'is-dotted' },
        ];
        for (const st of styles) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `popover-line-chip ${this.state.lineStyle === st.id ? 'is-active' : ''}`;
            const bar = document.createElement('div');
            bar.className = `popover-line-bar ${st.cls}`;
            btn.appendChild(bar);
            btn.onclick = () => {
                this.state.lineStyle = st.id;
                stylesRow.querySelectorAll('.popover-line-chip').forEach((b) => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                this.onStateChange(this.state);
            };
            stylesRow.appendChild(btn);
        }
        this.el.appendChild(stylesRow);

        // 4. Slider Grosor del trazo
        this.renderSlider('Grosor del trazo', this.state.strokeWidth, 1, 20, (v) => {
            this.state.strokeWidth = v;
            this.onStateChange(this.state);
        });

        // 5. Paleta de Color de Trazo
        const strokeColorWrap = document.createElement('div');
        strokeColorWrap.className = 'popover-slider-section';
        const strokeColorLbl = document.createElement('span');
        strokeColorLbl.className = 'popover-slider-label';
        strokeColorLbl.textContent = 'Color del trazo';
        strokeColorWrap.appendChild(strokeColorLbl);

        const strokeRow = document.createElement('div');
        strokeRow.className = 'popover-swatches-row';
        for (const col of this.strokeColors) {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = `popover-swatch-circle ${this.state.strokeColor.toUpperCase() === col.toUpperCase() ? 'is-active' : ''}`;
            sw.title = col;
            sw.setAttribute('aria-label', `Color de trazo ${col}`);
            sw.style.backgroundColor = col;
            sw.style.setProperty('--swatch-color', col);

            const inner = document.createElement('span');
            inner.className = 'popover-swatch-inner';
            inner.style.backgroundColor = col;
            sw.appendChild(inner);

            sw.onclick = () => {
                this.state.strokeColor = col;
                if (this.state.syncColors) {
                    this.state.fillColor = col;
                    this.state.fillOpacity = this.state.strokeOpacity;
                }
                strokeRow.querySelectorAll('.popover-swatch-circle').forEach((s) => s.classList.remove('is-active'));
                sw.classList.add('is-active');
                this.onStateChange(this.state);
            };
            strokeRow.appendChild(sw);
        }

        const addStrokeBtn = document.createElement('button');
        addStrokeBtn.type = 'button';
        addStrokeBtn.className = 'popover-color-add';
        addStrokeBtn.setAttribute('data-apolo-popover-trigger', 'true');
        addStrokeBtn.title = 'Añadir color de trazo';
        addStrokeBtn.appendChild(createSvg(ICONS.plusCircle, { size: 20 }));
        addStrokeBtn.onclick = (e) => {
            e.stopPropagation();
            if (this.onOpenColorPicker) {
                this.onOpenColorPicker(
                    addStrokeBtn,
                    this.state.strokeColor,
                    (newColor, opacity) => {
                        this.state.strokeColor = newColor;
                        this.state.strokeOpacity = opacity;
                        if (this.state.syncColors) {
                            this.state.fillColor = newColor;
                            this.state.fillOpacity = opacity;
                        }
                        if (!this.strokeColors.includes(newColor.toUpperCase())) {
                            this.strokeColors.unshift(newColor.toUpperCase());
                            if (this.strokeColors.length > 8) this.strokeColors.pop();
                        }
                        this.render();
                        this.onStateChange(this.state);
                    },
                    null,
                    this.state.strokeOpacity
                );
            }
        };
        strokeRow.appendChild(addStrokeBtn);

        strokeColorWrap.appendChild(strokeRow);
        this.el.appendChild(strokeColorWrap);

        const divider = document.createElement('div');
        divider.className = 'eraser-divider';
        this.el.appendChild(divider);

        // 6. Relleno de la forma
        const fillToggleRow = document.createElement('div');
        fillToggleRow.className = 'popover-toggle-row';
        const fTitle = document.createElement('span');
        fTitle.className = 'popover-toggle-title';
        fTitle.textContent = 'Relleno de forma';

        const fillSw = document.createElement('div');
        fillSw.className = `popover-switch ${this.state.fillEnabled ? 'is-checked' : ''}`;
        const fillThumb = document.createElement('span');
        fillThumb.className = 'popover-switch-thumb';
        fillSw.appendChild(fillThumb);

        fillToggleRow.append(fTitle, fillSw);
        this.el.appendChild(fillToggleRow);

        // 7. Subpanel de relleno (activo si fillEnabled)
        const fillSubpanel = document.createElement('div');
        fillSubpanel.className = `shape-fill-subpanel ${!this.state.fillEnabled ? 'is-disabled' : ''}`;

        const syncRow = document.createElement('div');
        syncRow.className = 'popover-toggle-row';
        const syncTitle = document.createElement('span');
        syncTitle.className = 'popover-toggle-title';
        syncTitle.textContent = 'Mismo color del trazo';

        const syncSw = document.createElement('div');
        syncSw.className = `popover-switch ${this.state.syncColors ? 'is-checked' : ''}`;
        const syncThumb = document.createElement('span');
        syncThumb.className = 'popover-switch-thumb';
        syncSw.appendChild(syncThumb);
        syncRow.append(syncTitle, syncSw);
        fillSubpanel.appendChild(syncRow);

        const fillSwatchesRow = document.createElement('div');
        fillSwatchesRow.className = `popover-swatches-row ${this.state.syncColors ? 'is-disabled' : ''}`;
        for (const col of this.fillColors) {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = `popover-swatch-circle ${this.state.fillColor.toUpperCase() === col.toUpperCase() ? 'is-active' : ''}`;
            sw.title = col;
            sw.setAttribute('aria-label', `Color de relleno ${col}`);
            sw.style.backgroundColor = col;
            sw.style.setProperty('--swatch-color', col);

            const inner = document.createElement('span');
            inner.className = 'popover-swatch-inner';
            inner.style.backgroundColor = col;
            sw.appendChild(inner);

            sw.onclick = () => {
                this.state.fillColor = col;
                fillSwatchesRow.querySelectorAll('.popover-swatch-circle').forEach((s) => s.classList.remove('is-active'));
                sw.classList.add('is-active');
                this.onStateChange(this.state);
            };
            fillSwatchesRow.appendChild(sw);
        }

        const addFillBtn = document.createElement('button');
        addFillBtn.type = 'button';
        addFillBtn.className = 'popover-color-add';
        addFillBtn.setAttribute('data-apolo-popover-trigger', 'true');
        addFillBtn.title = 'Elegir color personalizado para el relleno';
        addFillBtn.appendChild(createSvg(ICONS.plusCircle, { size: 20 }));
        addFillBtn.onclick = (e) => {
            e.stopPropagation();
            if (this.onOpenColorPicker) {
                this.onOpenColorPicker(
                    addFillBtn,
                    this.state.fillColor,
                    (newColor, opacity) => {
                        this.state.fillColor = newColor;
                        this.state.fillOpacity = opacity;
                        if (!this.fillColors.includes(newColor.toUpperCase())) {
                            this.fillColors.unshift(newColor.toUpperCase());
                            if (this.fillColors.length > 8) this.fillColors.pop();
                        }
                        this.render();
                        this.onStateChange(this.state);
                    },
                    null,
                    this.state.fillOpacity
                );
            }
        };
        fillSwatchesRow.appendChild(addFillBtn);
        fillSubpanel.appendChild(fillSwatchesRow);

        fillSw.onclick = () => {
            this.state.fillEnabled = !this.state.fillEnabled;
            fillSw.classList.toggle('is-checked', this.state.fillEnabled);
            fillSubpanel.classList.toggle('is-disabled', !this.state.fillEnabled);
            this.onStateChange(this.state);
        };

        syncSw.onclick = () => {
            this.state.syncColors = !this.state.syncColors;
            syncSw.classList.toggle('is-checked', this.state.syncColors);
            fillSwatchesRow.classList.toggle('is-disabled', this.state.syncColors);
            if (this.state.syncColors) {
                this.state.fillColor = this.state.strokeColor;
                this.state.fillOpacity = this.state.strokeOpacity;
            }
            this.onStateChange(this.state);
        };

        this.el.appendChild(fillSubpanel);
    }

    private renderSlider(
        label: string,
        currentVal: number,
        min: number,
        max: number,
        onChange: (val: number) => void
    ): void {
        const wrap = document.createElement('div');
        wrap.className = 'popover-slider-section';

        const lbl = document.createElement('span');
        lbl.className = 'popover-slider-label';
        lbl.textContent = label;
        wrap.appendChild(lbl);

        const row = document.createElement('div');
        row.className = 'popover-slider-row';

        const minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.className = 'popover-step-btn';
        minusBtn.title = 'Disminuir';
        minusBtn.appendChild(createSvg(ICONS.minus, { size: 14 }));

        const track = document.createElement('div');
        track.className = 'popover-track-wrap';

        const bubble = document.createElement('div');
        bubble.className = 'popover-bubble-val';
        bubble.textContent = String(currentVal);

        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'popover-range-native';
        input.min = String(min);
        input.max = String(max);
        input.value = String(currentVal);
        input.style.width = '100%';
        input.style.minWidth = '0';
        input.style.maxWidth = 'none';
        input.style.flex = '1 1 100%';

        track.append(input, bubble);

        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.className = 'popover-step-btn';
        plusBtn.title = 'Aumentar';
        plusBtn.appendChild(createSvg(ICONS.plus, { size: 14 }));

        row.append(minusBtn, track, plusBtn);
        wrap.appendChild(row);

        const updateVal = (val: number) => {
            val = Math.max(min, Math.min(max, val));
            input.value = String(val);
            bubble.textContent = String(val);
            const ratio = Math.max(0, Math.min(1, (val - min) / (max - min)));
            bubble.style.left = `calc(${ratio * 100}% - ${ratio * 26}px)`;
            onChange(val);
        };

        input.oninput = () => updateVal(Number(input.value));
        minusBtn.onclick = () => updateVal(Number(input.value) - 1);
        plusBtn.onclick = () => updateVal(Number(input.value) + 1);

        setTimeout(() => updateVal(currentVal), 0);
        this.el.appendChild(wrap);
    }

    destroy(): void {
        this.close();
        this.el.remove();
    }
}
