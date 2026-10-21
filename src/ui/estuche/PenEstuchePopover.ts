import type { PenProfileId, ToolbarSlot } from '../../core/types.ts';
import { ICONS, createSvg } from '../theme.ts';
import { applyPopoverGeometry } from '../popover/PopoverGeometry.ts';
import { ColorPickerPopover } from '../popover/ColorPickerPopover.ts';

export interface PenEstucheState {
    profileId: PenProfileId;
    size: number;
    smoothing: number;
    lineStyle: 'solid' | 'dashed' | 'dotted';
    straightenLines: boolean;
    color: string;
    opacity: number;
}

export type OpenColorPickerFn = (
    anchorEl: HTMLElement,
    initialColor: string,
    onConfirm: (newColor: string, opacity: number) => void,
    slotIndex?: number | null,
    initialOpacity?: number
) => void;

export class PenEstuchePopover {
    readonly el: HTMLElement;
    private onStateChange: (state: PenEstucheState) => void;
    private onOpenColorPicker?: OpenColorPickerFn;
    private openState = false;

    private state: PenEstucheState = {
        profileId: 'fountain',
        size: 3,
        smoothing: 2,
        lineStyle: 'solid',
        straightenLines: false,
        color: '#E53935',
        opacity: 100,
    };

    private recentColors: string[] = ['#E53935', '#FFA726', '#FFEE58', '#26A69A', '#42A5F5', '#1E88E5', '#7E57C2', '#EEEEEE'];
    private maxRecentSlots = 8;
    private colorPages: string[][] = [
        this.recentColors,
        ['#D32F2F', '#C2185B', '#7B1FA2', '#512DA8', '#303F9F', '#1976D2', '#0288D1', '#0097A7'],
        ['#FFCDD2', '#F8BBD0', '#E1BEE7', '#D1C4E9', '#C5CAE9', '#BBDEFB', '#B3E5FC', '#B2EBF2'],
        ['#212121', '#424242', '#616161', '#757575', '#9E9E9E', '#BDBDBD', '#E0E0E0', '#FFFFFF'],
    ];
    private currentPageIndex = 0;

    private swatchRowEl?: HTMLElement;
    private paginationEl?: HTMLElement;

    private currentAnchor: HTMLElement | null = null;
    private currentSlot: ToolbarSlot = 'tc';
    private currentToolbar: HTMLElement | null = null;

    private readonly tools: Array<{ id: PenProfileId; label: string; iconD: string }> = [
        { id: 'fountain', label: 'Estilográfica', iconD: ICONS.pen },
        { id: 'calli', label: 'Caligráfica', iconD: ICONS.feather },
        { id: 'ball', label: 'Bolígrafo', iconD: ICONS.ballpoint },
        { id: 'pencil', label: 'Lápiz de mina', iconD: ICONS.pencil },
    ];

    constructor(
        onStateChange: (state: PenEstucheState) => void,
        onOpenColorPicker?: OpenColorPickerFn,
        parent: HTMLElement = document.body
    ) {
        this.onStateChange = onStateChange;
        this.onOpenColorPicker = onOpenColorPicker;

        this.el = document.createElement('div');
        this.el.className = 'apolo-estuche-popover';
        this.el.style.display = 'none';
        this.el.setAttribute('role', 'dialog');
        this.el.setAttribute('aria-label', 'Estuche de plumas');
        this.el.addEventListener('pointerdown', (e) => e.stopPropagation());

        parent.appendChild(this.el);
    }

    isOpen(): boolean {
        return this.openState;
    }

    pushRecentColor(hex: string): void {
        const clean = hex.toUpperCase();
        this.recentColors = this.recentColors.filter((c) => c.toUpperCase() !== clean);
        this.recentColors.unshift(clean);
        if (this.recentColors.length > this.maxRecentSlots) {
            this.recentColors.pop();
        }
        this.colorPages[0] = this.recentColors;
        ColorPickerPopover.pushRecentColor(clean);
    }

    open(
        anchorEl: HTMLElement,
        slot: ToolbarSlot,
        toolbarEl: HTMLElement,
        initialState?: Partial<PenEstucheState>
    ): void {
        this.openState = true;
        this.currentAnchor = anchorEl;
        this.currentSlot = slot;
        this.currentToolbar = toolbarEl;
        if (initialState) {
            this.state = { ...this.state, ...initialState };
            if (initialState.color) this.pushRecentColor(initialState.color);
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
        applyPopoverGeometry(this.el, anchorEl, toolbarEl, slot, { fallbackWidth: 320, fallbackHeight: 440 });
    }

    private triggerAnimation(): void {
        this.el.classList.remove('apolo-popover-animated');
        void this.el.offsetWidth;
        this.el.classList.add('apolo-popover-animated');
    }

    updateState(partial: Partial<PenEstucheState>): void {
        this.state = { ...this.state, ...partial };
        if (this.openState) {
            this.render();
        }
    }

    private render(): void {
        this.el.replaceChildren();

        // 1. Header (Favoritos a la izquierda, Estrella + Cerrar a la derecha)
        const header = document.createElement('div');
        header.className = 'popover-header';

        const favsBtn = document.createElement('button');
        favsBtn.type = 'button';
        favsBtn.className = 'popover-hdr-btn';
        favsBtn.title = 'Lápices favoritos';
        favsBtn.setAttribute('aria-label', 'Lápices favoritos');
        favsBtn.appendChild(createSvg(ICONS.bookmark, { size: 18 }));
        header.appendChild(favsBtn);

        const rightBtns = document.createElement('div');
        rightBtns.className = 'popover-header-right';

        const starBtn = document.createElement('button');
        starBtn.type = 'button';
        starBtn.className = 'popover-hdr-btn';
        starBtn.title = 'Marcar actual como favorito';
        starBtn.setAttribute('aria-label', 'Marcar actual como favorito');
        starBtn.appendChild(createSvg(ICONS.star, { size: 18 }));
        starBtn.onclick = () => starBtn.classList.toggle('is-fav-saved');

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'popover-hdr-btn popover-close';
        closeBtn.title = 'Cerrar';
        closeBtn.setAttribute('aria-label', 'Cerrar');
        closeBtn.appendChild(createSvg(ICONS.close, { size: 16 }));
        closeBtn.onclick = () => this.close();

        rightBtns.append(starBtn, closeBtn);
        header.appendChild(rightBtns);
        this.el.appendChild(header);

        // 2. Selector de Herramientas
        const toolsRow = document.createElement('div');
        toolsRow.className = 'popover-tools-selector';
        for (const t of this.tools) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `popover-tool-opt ${this.state.profileId === t.id ? 'is-active' : ''}`;
            btn.title = t.label;

            const wrap = document.createElement('div');
            wrap.className = 'icon-wrap';
            wrap.appendChild(createSvg(t.iconD, { size: 24 }));
            btn.appendChild(wrap);

            btn.onclick = () => {
                this.state.profileId = t.id;
                toolsRow.querySelectorAll('.popover-tool-opt').forEach((el) => el.classList.remove('is-active'));
                btn.classList.add('is-active');
                this.onStateChange(this.state);
            };
            toolsRow.appendChild(btn);
        }
        this.el.appendChild(toolsRow);

        // 3. Slider Grosor
        this.renderSlider('Grosor', this.state.size, 1, 20, (v) => {
            this.state.size = v;
            this.onStateChange(this.state);
        });

        // 4. Slider Suavizado
        this.renderSlider('Suavizado', this.state.smoothing, 0, 10, (v) => {
            this.state.smoothing = v;
            this.onStateChange(this.state);
        });

        // 5. Líneas sólidas, punteadas y discontinuas
        const stylesRow = document.createElement('div');
        stylesRow.className = 'popover-lines-grid';
        const styles: Array<{ id: 'solid' | 'dashed' | 'dotted'; cls: string }> = [
            { id: 'solid', cls: '' },
            { id: 'dashed', cls: 'is-dashed' },
            { id: 'dotted', cls: 'is-dotted' },
        ];
        for (const s of styles) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `popover-line-chip ${this.state.lineStyle === s.id ? 'is-active' : ''}`;
            const pill = document.createElement('span');
            pill.className = 'popover-line-chip-pill';
            pill.setAttribute('aria-hidden', 'true');
            const bar = document.createElement('div');
            bar.className = `popover-line-bar ${s.cls}`;
            pill.appendChild(bar);
            btn.appendChild(pill);
            btn.onclick = () => {
                this.state.lineStyle = s.id;
                stylesRow.querySelectorAll('.popover-line-chip').forEach((b) => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                this.onStateChange(this.state);
            };
            stylesRow.appendChild(btn);
        }
        this.el.appendChild(stylesRow);

        // 6. Interruptor "Enderezar líneas"
        const toggleRow = document.createElement('div');
        toggleRow.className = 'popover-toggle-row';
        const tTitle = document.createElement('span');
        tTitle.className = 'popover-toggle-title';
        tTitle.textContent = 'Enderezar líneas';

        const sw = document.createElement('div');
        sw.className = `popover-switch ${this.state.straightenLines ? 'is-checked' : ''}`;
        const thumb = document.createElement('span');
        thumb.className = 'popover-switch-thumb';
        sw.appendChild(thumb);
        sw.onclick = () => {
            this.state.straightenLines = !this.state.straightenLines;
            sw.classList.toggle('is-checked', this.state.straightenLines);
            this.onStateChange(this.state);
        };
        toggleRow.append(tTitle, sw);
        this.el.appendChild(toggleRow);

        // 7. Paleta de Colores
        const colSection = document.createElement('div');
        colSection.className = 'popover-palette-section';

        this.swatchRowEl = document.createElement('div');
        this.swatchRowEl.className = 'popover-swatches-row';
        this.swatchRowEl.onwheel = (e) => {
            e.preventDefault();
            this.changeColorPage(e.deltaY > 0 ? 1 : -1);
        };

        this.paginationEl = document.createElement('div');
        this.paginationEl.className = 'popover-pagination';

        colSection.append(this.swatchRowEl, this.paginationEl);
        this.el.appendChild(colSection);

        this.updateColorsUI();
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

        const updateVal = (val: number, notify = true) => {
            val = Math.max(min, Math.min(max, val));
            input.value = String(val);
            bubble.textContent = String(val);
            const ratio = Math.max(0, Math.min(1, (val - min) / (max - min)));
            bubble.style.left = `calc(${ratio * 100}% - ${ratio * 26}px)`;
            if (notify) onChange(val);
        };

        input.oninput = () => updateVal(Number(input.value));
        minusBtn.onclick = () => updateVal(Number(input.value) - 1);
        plusBtn.onclick = () => updateVal(Number(input.value) + 1);

        setTimeout(() => updateVal(currentVal, false), 0);
        this.el.appendChild(wrap);
    }

    private changeColorPage(delta: number): void {
        const n = this.currentPageIndex + delta;
        if (n >= 0 && n < this.colorPages.length) {
            this.currentPageIndex = n;
            this.updateColorsUI();
        }
    }

    private updateColorsUI(): void {
        if (!this.swatchRowEl || !this.paginationEl) return;
        this.swatchRowEl.replaceChildren();
        const colors = this.colorPages[this.currentPageIndex];
        const visibleColors = colors.slice(0, 8);

        for (const col of visibleColors) {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = `popover-swatch-circle ${this.state.color.toUpperCase() === col.toUpperCase() ? 'is-active' : ''}`;
            sw.title = col;
            sw.setAttribute('aria-label', `Color ${col}`);
            sw.style.backgroundColor = col;
            sw.style.setProperty('--swatch-color', col);

            const inner = document.createElement('span');
            inner.className = 'popover-swatch-inner';
            inner.style.backgroundColor = col;
            sw.appendChild(inner);

            sw.onclick = () => {
                this.state.color = col;
                this.pushRecentColor(col);
                this.swatchRowEl?.querySelectorAll('.popover-swatch-circle').forEach((s) => s.classList.remove('is-active'));
                sw.classList.add('is-active');
                this.onStateChange(this.state);
            };
            this.swatchRowEl.appendChild(sw);
        }

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'popover-color-add';
        addBtn.setAttribute('data-apolo-popover-trigger', 'true');
        addBtn.title = 'Añadir color';
        addBtn.appendChild(createSvg(ICONS.plusCircle, { size: 20 }));
        addBtn.onclick = (e) => {
            e.stopPropagation();
            if (this.onOpenColorPicker) {
                this.onOpenColorPicker(
                    addBtn,
                    this.state.color,
                    (newColor, opacity) => {
                        this.state.color = newColor;
                        this.state.opacity = opacity;
                        this.pushRecentColor(newColor);
                        this.currentPageIndex = 0;
                        this.updateColorsUI();
                        this.onStateChange(this.state);
                    },
                    null,
                    this.state.opacity ?? 100
                );
            }
        };
        this.swatchRowEl.appendChild(addBtn);

        this.paginationEl.replaceChildren();
        for (let i = 0; i < this.colorPages.length; i++) {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = `popover-pag-dot ${i === this.currentPageIndex ? 'is-active' : ''}`;
            dot.setAttribute('aria-label', i === 0 ? 'Colores recientes' : `Página ${i + 1}`);
            if (i === 0) {
                dot.appendChild(createSvg(ICONS.clock, { size: 12 }));
            } else {
                const dotInner = document.createElement('span');
                dotInner.className = 'popover-dot-inner';
                dot.appendChild(dotInner);
            }
            dot.onclick = () => {
                this.currentPageIndex = i;
                this.updateColorsUI();
            };
            this.paginationEl.appendChild(dot);
        }
    }

    destroy(): void {
        this.close();
        this.el.remove();
    }
}
