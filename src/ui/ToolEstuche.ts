import type { EraserMode, LassoMode, PenFavorite, PenProfileId, ShapeType, ToolbarSlot, ToolType } from '../core/types.ts';
import { HIGHLIGHTER_COLOR_NAMES, HIGHLIGHTER_PALETTE, ICONS, PEN_PROFILES, PRIMARY_COLOR_NAMES, PRIMARY_PALETTE, createStrokeWavePreview, createSvg, isDarkTheme, mapInkColorForDark } from './theme.ts';

export interface ToolEstucheState {
    tool: ToolType;
    slot: ToolbarSlot;
    color: string;
    width: number;
    profileId: PenProfileId;
    smoothing: number; // 0..1
    pressureSensitivity: number; // 0..1
    favorites: PenFavorite[];
    eraserMode: EraserMode;
    eraserRadius: number;
    scribbleToErase: boolean;
    lassoMode: LassoMode;
    shapeType: ShapeType;
    snapGrid: boolean;
}

export interface ToolEstucheCallbacks {
    onSelectProfile: (profile: PenProfileId) => void;
    onChangeColor: (color: string) => void;
    onChangeWidth: (width: number) => void;
    onChangeSmoothing: (smoothing: number) => void;
    onChangePressure: (pressure: number) => void;
    onUseFavorite: (index: number) => void;
    onSaveFavorite: (index: number) => void;
    onSelectEraserMode: (mode: EraserMode) => void;
    onChangeEraserRadius: (radius: number) => void;
    onToggleScribble: (enabled: boolean) => void;
    onSelectLassoMode: (mode: LassoMode) => void;
    onSelectShapeType: (shapeType: ShapeType) => void;
    onToggleSnapGrid: (enabled: boolean) => void;
    onClose: () => void;
}

export class ToolEstuche {
    readonly container: HTMLElement;
    private state: ToolEstucheState;
    private callbacks: ToolEstucheCallbacks;
    private isVisible = false;

    constructor(initialState: ToolEstucheState, callbacks: ToolEstucheCallbacks, parent: HTMLElement = document.body) {
        this.state = { ...initialState };
        this.callbacks = callbacks;

        this.container = document.createElement('div');
        this.container.className = 'apolo-popover-panel apolo-tool-estuche';
        this.container.setAttribute('role', 'dialog');
        this.container.hidden = true;
        this.container.style.display = 'none';

        // Prevent pointer events from falling through to the canvas
        this.container.addEventListener('pointerdown', e => e.stopPropagation());
        this.container.addEventListener('touchstart', e => e.stopPropagation());

        parent.appendChild(this.container);

        window.addEventListener('pointerdown', this.onOutsidePointerDown, { capture: true });
        window.addEventListener('touchstart', this.onOutsideTouchStart, { capture: true });
        window.addEventListener('keydown', this.onKeyDown);
    }

    private readonly onOutsidePointerDown = (e: PointerEvent): void => {
        if (this.isOpen() && !this.container.contains(e.target as Node)) {
            const targetEl = (e.target && typeof (e.target as any).closest === 'function') ? (e.target as any) : null;
            if (targetEl?.closest?.('.apolo-tool-btn') || targetEl?.closest?.('.apolo-toolbar-btn')) {
                return;
            }
            this.close();
        }
    };

    private readonly onOutsideTouchStart = (e: TouchEvent): void => {
        if (this.isOpen() && e.target && !this.container.contains(e.target as Node)) {
            const targetEl = (e.target && typeof (e.target as any).closest === 'function') ? (e.target as any) : null;
            if (targetEl?.closest?.('.apolo-tool-btn') || targetEl?.closest?.('.apolo-toolbar-btn')) {
                return;
            }
            this.close();
        }
    };

    private readonly onKeyDown = (e: KeyboardEvent): void => {
        if (this.isOpen() && e.key === 'Escape') {
            this.close();
        }
    };

    open(state?: Partial<ToolEstucheState>): void {
        if (state) {
            this.state = { ...this.state, ...state };
        }
        if (this.state.tool === 'spacer') {
            this.close();
            return;
        }
        this.isVisible = true;
        this.container.hidden = false;
        this.container.style.display = 'block';
        this.render();
        this.position();
    }

    close(): void {
        this.isVisible = false;
        this.container.hidden = true;
        this.container.style.display = 'none';
        this.callbacks.onClose();
    }

    isOpen(): boolean {
        return this.isVisible && !this.container.hidden && this.container.style.display !== 'none';
    }

    updateState(partial: Partial<ToolEstucheState>): void {
        this.state = { ...this.state, ...partial };
        if (this.isOpen()) {
            this.render();
            this.position();
        }
    }

    position(): void {
        const slot = this.state.slot;
        const col = slot === 'tl' || slot === 'ml' || slot === 'bl' ? 0 : (slot === 'tc' || slot === 'bc' ? 1 : 2);
        const row = slot === 'tl' || slot === 'tc' || slot === 'tr' ? 0 : (slot === 'ml' || slot === 'mr' ? 1 : 2);

        const estWidth = 420;
        const marginX = 16;
        const panelTop = row === 0 ? 122 : 56;

        let left = 0;
        if (col === 2) {
            // Toolbar is on the right -> place estuche on the left
            left = marginX + 44;
        } else {
            // Toolbar is on the left or center -> place estuche on the right
            left = Math.max(16, window.innerWidth - estWidth - marginX);
        }

        const maxH = Math.max(300, window.innerHeight - panelTop - 28);
        this.container.style.position = 'fixed';
        this.container.style.left = `${left}px`;
        this.container.style.top = `${panelTop}px`;
        this.container.style.width = `${estWidth}px`;
        this.container.style.maxHeight = `${maxH}px`;
    }

    private render(): void {
        this.container.replaceChildren();

        const tool = this.state.tool;
        const titles: Record<ToolType, string> = {
            pen: 'Estuche de plumas',
            highlighter: 'Estuche de marcadores',
            eraser: 'Estuche del borrador',
            lasso: 'Estuche del lazo',
            shape: 'Estuche de formas',
            spacer: 'Insertar espacio',
            link: 'Enlazar',
        };

        const icons: Record<ToolType, string> = {
            pen: ICONS.pen,
            highlighter: ICONS.highlighter,
            eraser: ICONS.eraser,
            lasso: ICONS.lasso,
            shape: ICONS.shapes[this.state.shapeType] || ICONS.shapes.rect,
            spacer: ICONS.spacer,
            link: ICONS.link,
        };

        // 1. Header (Icon + Title + Close Button)
        const header = document.createElement('div');
        header.className = 'apolo-estuche-header';

        const titleGroup = document.createElement('div');
        titleGroup.className = 'apolo-estuche-title-group';
        titleGroup.appendChild(createSvg(icons[tool] || ICONS.pen, { size: 22, className: 'apolo-estuche-icon' }));

        const titleText = document.createElement('div');
        titleText.className = 'apolo-estuche-title';
        titleText.textContent = titles[tool] || 'Estuche';
        titleGroup.appendChild(titleText);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'apolo-estuche-close-btn';
        closeBtn.setAttribute('aria-label', 'Cerrar estuche');
        closeBtn.title = 'Cerrar';
        closeBtn.appendChild(createSvg(ICONS.close, { size: 18 }));
        const handleClose = (e: Event): void => {
            e.stopPropagation();
            e.preventDefault();
            this.close();
        };
        closeBtn.addEventListener('click', handleClose);
        closeBtn.addEventListener('pointerdown', handleClose);
        closeBtn.addEventListener('touchend', handleClose);

        header.append(titleGroup, closeBtn);
        this.container.appendChild(header);

        // 2. Body based on tool
        if (tool === 'pen') {
            this.renderPenContent();
        } else if (tool === 'highlighter') {
            this.renderHighlighterContent();
        } else if (tool === 'eraser') {
            this.renderEraserContent();
        } else if (tool === 'lasso') {
            this.renderLassoContent();
        } else if (tool === 'shape') {
            this.renderShapeContent();
        }
    }

    private renderPenContent(): void {
        // 4 Profile Cards (2x2)
        const profilesGrid = document.createElement('div');
        profilesGrid.className = 'apolo-profiles-grid';

        const profiles: PenProfileId[] = ['fountain', 'calli', 'ball', 'pencil'];
        for (const pId of profiles) {
            const profile = PEN_PROFILES[pId];
            const card = document.createElement('button');
            card.type = 'button';
            card.className = `apolo-profile-card ${this.state.profileId === pId ? 'is-active' : ''}`;
            card.setAttribute('aria-label', profile.name);

            const nameEl = document.createElement('div');
            nameEl.className = 'apolo-profile-name';
            nameEl.textContent = profile.name;

            const wave = createStrokeWavePreview(profile, this.state.width, this.state.color);
            wave.classList.add('apolo-profile-wave');

            card.append(nameEl, wave);
            card.addEventListener('click', () => {
                this.callbacks.onSelectProfile(pId);
                this.state.profileId = pId;
                this.render();
            });
            profilesGrid.appendChild(card);
        }
        this.container.appendChild(profilesGrid);

        // Sliders (Grosor, Suavizado, Presión)
        const slidersList = document.createElement('div');
        slidersList.className = 'apolo-sliders-list';

        slidersList.appendChild(this.createSliderRow('Grosor', 1, 12, 0.5, this.state.width, val => {
            this.state.width = val;
            this.callbacks.onChangeWidth(val);
        }, ' px'));

        slidersList.appendChild(this.createSliderRow('Suavizado', 0, 100, 1, Math.round(this.state.smoothing * 100), val => {
            this.state.smoothing = val / 100;
            this.callbacks.onChangeSmoothing(this.state.smoothing);
        }, ' %'));

        slidersList.appendChild(this.createSliderRow('Sensibilidad a presión', 0, 100, 1, Math.round(this.state.pressureSensitivity * 100), val => {
            this.state.pressureSensitivity = val / 100;
            this.callbacks.onChangePressure(this.state.pressureSensitivity);
        }, ' %'));

        this.container.appendChild(slidersList);

        // Color Swatches + HEX
        this.container.appendChild(this.createColorSection());

        // Favoritos de la barra
        this.container.appendChild(this.createFavoritesSection());
    }

    private renderHighlighterContent(): void {
        // 2 Highlighter Profiles (Round and Flat)
        const profilesGrid = document.createElement('div');
        profilesGrid.className = 'apolo-profiles-grid apolo-grid-2cols';

        const profiles: PenProfileId[] = ['hlr', 'hlf'];
        for (const pId of profiles) {
            const profile = PEN_PROFILES[pId];
            const card = document.createElement('button');
            card.type = 'button';
            card.className = `apolo-profile-card ${this.state.profileId === pId ? 'is-active' : ''}`;
            card.setAttribute('aria-label', profile.name);

            const nameEl = document.createElement('div');
            nameEl.className = 'apolo-profile-name';
            nameEl.textContent = profile.name;

            const wave = createStrokeWavePreview(profile, this.state.width, this.state.color);
            wave.classList.add('apolo-profile-wave');

            card.append(nameEl, wave);
            card.addEventListener('click', () => {
                this.callbacks.onSelectProfile(pId);
                this.state.profileId = pId;
                this.render();
            });
            profilesGrid.appendChild(card);
        }
        this.container.appendChild(profilesGrid);

        // Slider Grosor
        const slidersList = document.createElement('div');
        slidersList.className = 'apolo-sliders-list';
        slidersList.appendChild(this.createSliderRow('Grosor', 4, 24, 1, this.state.width, val => {
            this.state.width = val;
            this.callbacks.onChangeWidth(val);
        }, ' px'));
        this.container.appendChild(slidersList);

        // Color Palette
        this.container.appendChild(this.createColorSection());
    }

    private renderEraserContent(): void {
        // Mode cards (Trazo completo vs Retícula)
        const modes = document.createElement('div');
        modes.className = 'apolo-eraser-modes';

        const wholeCard = document.createElement('button');
        wholeCard.type = 'button';
        wholeCard.className = `apolo-eraser-mode-card ${this.state.eraserMode === 'whole' ? 'is-active' : ''}`;
        wholeCard.innerHTML = `
            <div class="apolo-eraser-mode-title">Trazo completo</div>
            <div class="apolo-eraser-mode-desc">Borra el trazo entero al tocarlo</div>
        `;
        wholeCard.addEventListener('click', () => {
            this.callbacks.onSelectEraserMode('whole');
            this.state.eraserMode = 'whole';
            this.render();
        });

        const reticleCard = document.createElement('button');
        reticleCard.type = 'button';
        reticleCard.className = `apolo-eraser-mode-card ${this.state.eraserMode === 'reticle' ? 'is-active' : ''}`;
        reticleCard.innerHTML = `
            <div class="apolo-eraser-mode-title">Retícula</div>
            <div class="apolo-eraser-mode-desc">Corta el trazo en sub-trazos</div>
        `;
        reticleCard.addEventListener('click', () => {
            this.callbacks.onSelectEraserMode('reticle');
            this.state.eraserMode = 'reticle';
            this.render();
        });

        modes.append(wholeCard, reticleCard);
        this.container.appendChild(modes);

        // Eraser Size Slider with preview circle
        const sizeSection = document.createElement('div');
        sizeSection.className = 'apolo-eraser-size-section';

        const sizeTitle = document.createElement('div');
        sizeTitle.className = 'apolo-section-label';
        sizeTitle.textContent = 'Tamaño del borrador';

        const sizeWrap = document.createElement('div');
        sizeWrap.className = 'apolo-eraser-size-wrap';

        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'apolo-slider-input';
        input.min = '8';
        input.max = '60';
        input.step = '2';
        input.value = String(this.state.eraserRadius);
        input.style.flex = '1';

        const previewDot = document.createElement('span');
        previewDot.className = 'apolo-eraser-preview-dot';
        const updateDot = (r: number) => {
            const size = Math.max(12, Math.min(36, r * 0.7));
            previewDot.style.width = `${size}px`;
            previewDot.style.height = `${size}px`;
        };
        updateDot(this.state.eraserRadius);

        input.addEventListener('input', () => {
            const next = Number(input.value);
            this.state.eraserRadius = next;
            updateDot(next);
            this.callbacks.onChangeEraserRadius(next);
        });

        sizeWrap.append(input, previewDot);
        sizeSection.append(sizeTitle, sizeWrap);
        this.container.appendChild(sizeSection);

        // Scribble to Erase Toggle
        const toggleRow = this.createToggleRow(
            'Garabato para borrar',
            'Zigzag rápido sobre trazos para eliminarlos',
            this.state.scribbleToErase,
            enabled => {
                this.state.scribbleToErase = enabled;
                this.callbacks.onToggleScribble(enabled);
            },
        );
        this.container.appendChild(toggleRow);
    }

    private renderLassoContent(): void {
        const modes = document.createElement('div');
        modes.className = 'apolo-eraser-modes';

        const freeCard = document.createElement('button');
        freeCard.type = 'button';
        freeCard.className = `apolo-eraser-mode-card ${this.state.lassoMode === 'free' ? 'is-active' : ''}`;
        freeCard.innerHTML = `
            <div class="apolo-eraser-mode-title">Lazo libre</div>
            <div class="apolo-eraser-mode-desc">Dibuja el contorno con el lápiz</div>
        `;
        freeCard.addEventListener('click', () => {
            this.callbacks.onSelectLassoMode('free');
            this.state.lassoMode = 'free';
            this.render();
        });

        const rectCard = document.createElement('button');
        rectCard.type = 'button';
        rectCard.className = `apolo-eraser-mode-card ${this.state.lassoMode === 'rect' ? 'is-active' : ''}`;
        rectCard.innerHTML = `
            <div class="apolo-eraser-mode-title">Rectángulo</div>
            <div class="apolo-eraser-mode-desc">Arrastra de una esquina a la opuesta</div>
        `;
        rectCard.addEventListener('click', () => {
            this.callbacks.onSelectLassoMode('rect');
            this.state.lassoMode = 'rect';
            this.render();
        });

        modes.append(freeCard, rectCard);
        this.container.appendChild(modes);
    }

    private renderShapeContent(): void {
        // 5 Shape Icons without text (line, arrow, rect, circle, triangle)
        const shapesRow = document.createElement('div');
        shapesRow.className = 'apolo-shapes-row';

        const shapeDefs: Array<{ type: ShapeType; label: string; iconD: string }> = [
            { type: 'line', label: 'Línea', iconD: ICONS.shapes.line },
            { type: 'arrow', label: 'Flecha', iconD: ICONS.shapes.arrow },
            { type: 'rect', label: 'Rectángulo', iconD: ICONS.shapes.rect },
            { type: 'ellipse', label: 'Círculo', iconD: ICONS.shapes.circle },
            { type: 'triangle', label: 'Triángulo', iconD: ICONS.shapes.triangle },
        ];

        for (const def of shapeDefs) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `apolo-shape-icon-btn ${this.state.shapeType === def.type ? 'is-active' : ''}`;
            btn.setAttribute('aria-label', def.label);
            btn.title = def.label;
            btn.appendChild(createSvg(def.iconD, { size: 30 }));
            btn.addEventListener('click', () => {
                this.callbacks.onSelectShapeType(def.type);
                this.state.shapeType = def.type;
                this.render();
            });
            shapesRow.appendChild(btn);
        }
        this.container.appendChild(shapesRow);

        // Snap Grid Toggle
        const gridRow = this.createToggleRow(
            'Imán de cuadrícula',
            'Las formas encajan en una cuadrícula de 12 px',
            this.state.snapGrid,
            enabled => {
                this.state.snapGrid = enabled;
                this.callbacks.onToggleSnapGrid(enabled);
            },
        );
        this.container.appendChild(gridRow);

        // Slider Grosor
        const slidersList = document.createElement('div');
        slidersList.className = 'apolo-sliders-list';
        slidersList.appendChild(this.createSliderRow('Grosor', 1, 12, 0.5, this.state.width, val => {
            this.state.width = val;
            this.callbacks.onChangeWidth(val);
        }, ' px'));
        this.container.appendChild(slidersList);

        // Color Palette
        this.container.appendChild(this.createColorSection());
    }

    private createSliderRow(
        label: string,
        min: number,
        max: number,
        step: number,
        value: number,
        onInput: (val: number) => void,
        suffix = ' px',
    ): HTMLElement {
        const row = document.createElement('div');
        row.className = 'apolo-slider-item';

        const labelEl = document.createElement('div');
        labelEl.className = 'apolo-slider-label';
        labelEl.textContent = label;

        const trackWrap = document.createElement('div');
        trackWrap.className = 'apolo-slider-track-wrap';

        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'apolo-slider-input';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(value);

        const valText = document.createElement('div');
        valText.className = 'apolo-slider-value';
        valText.textContent = suffix === ' px' ? `${value.toFixed(1).replace('.', ',')}${suffix}` : `${value}${suffix}`;

        input.addEventListener('input', () => {
            const next = Number(input.value);
            valText.textContent = suffix === ' px' ? `${next.toFixed(1).replace('.', ',')}${suffix}` : `${next}${suffix}`;
            onInput(next);
        });

        trackWrap.appendChild(input);
        row.append(labelEl, trackWrap, valText);
        return row;
    }

    private createColorSection(): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'apolo-estuche-color-section';

        const title = document.createElement('div');
        title.className = 'apolo-section-label';
        title.textContent = 'Color';
        wrap.appendChild(title);

        const swatchesRow = document.createElement('div');
        swatchesRow.className = 'apolo-colors-row';

        const dark = isDarkTheme();
        const palette = this.state.tool === 'highlighter' ? HIGHLIGHTER_PALETTE : PRIMARY_PALETTE;
        const colorNames = this.state.tool === 'highlighter' ? HIGHLIGHTER_COLOR_NAMES : PRIMARY_COLOR_NAMES;

        for (const col of palette) {
            const swatch = document.createElement('button');
            swatch.type = 'button';
            const isActive = this.state.color.toLowerCase() === col.toLowerCase();
            swatch.className = `apolo-palette-swatch ${isActive ? 'is-active' : ''}`;
            swatch.style.background = mapInkColorForDark(col, dark);
            swatch.setAttribute('aria-label', colorNames[col] || col);
            swatch.title = colorNames[col] || col;

            swatch.addEventListener('click', () => {
                this.state.color = col;
                this.callbacks.onChangeColor(col);
                this.render();
            });
            swatchesRow.appendChild(swatch);
        }

        // Custom color input button
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'apolo-add-color-btn';
        addBtn.title = 'Selector de color del sistema';
        addBtn.setAttribute('aria-label', 'Selector de color');
        addBtn.textContent = '+';

        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'color';
        hiddenInput.value = this.state.color;
        hiddenInput.style.display = 'none';
        hiddenInput.addEventListener('input', () => {
            this.state.color = hiddenInput.value;
            this.callbacks.onChangeColor(hiddenInput.value);
            this.render();
        });
        addBtn.appendChild(hiddenInput);
        addBtn.addEventListener('click', () => hiddenInput.click());
        swatchesRow.appendChild(addBtn);

        // HEX Input Field
        const hexGroup = document.createElement('div');
        hexGroup.className = 'apolo-hex-group';

        const hexLabel = document.createElement('label');
        hexLabel.className = 'apolo-hex-label';
        hexLabel.textContent = 'HEX';

        const hexInput = document.createElement('input');
        hexInput.type = 'text';
        hexInput.className = 'apolo-hex-input';
        hexInput.value = this.state.color.toUpperCase();
        hexInput.addEventListener('change', () => {
            const val = hexInput.value.trim();
            if (/^#[\da-f]{3,8}$/i.test(val)) {
                this.state.color = val;
                this.callbacks.onChangeColor(val);
                this.render();
            }
        });

        hexGroup.append(hexLabel, hexInput);
        swatchesRow.appendChild(hexGroup);
        wrap.appendChild(swatchesRow);

        return wrap;
    }

    private createFavoritesSection(): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'apolo-favorites-section';

        const title = document.createElement('div');
        title.className = 'apolo-section-label';
        title.textContent = 'Favoritos de la barra';
        wrap.appendChild(title);

        const list = document.createElement('div');
        list.className = 'apolo-favorites-list';

        const dark = isDarkTheme();
        for (let i = 0; i < this.state.favorites.length; i++) {
            const fav = this.state.favorites[i];
            const profile = PEN_PROFILES[fav.profile] || PEN_PROFILES.fountain;

            const row = document.createElement('div');
            row.className = 'apolo-favorite-row';

            const dot = document.createElement('span');
            dot.className = 'apolo-fav-card-dot';
            dot.style.background = mapInkColorForDark(fav.color, dark);

            const label = document.createElement('div');
            label.className = 'apolo-favorite-row-label';
            label.textContent = `Favorito ${i + 1} · ${profile.name} · ${fav.width} px`;

            const useBtn = document.createElement('button');
            useBtn.type = 'button';
            useBtn.className = 'apolo-fav-action-btn';
            useBtn.textContent = 'Usar';
            useBtn.setAttribute('aria-label', `Usar favorito ${i + 1}`);
            useBtn.addEventListener('click', () => {
                this.callbacks.onUseFavorite(i);
            });

            const saveBtn = document.createElement('button');
            saveBtn.type = 'button';
            saveBtn.className = 'apolo-fav-action-btn';
            saveBtn.textContent = 'Guardar aquí';
            saveBtn.setAttribute('aria-label', `Guardar estilo actual en favorito ${i + 1}`);
            saveBtn.addEventListener('click', () => {
                this.callbacks.onSaveFavorite(i);
                this.render();
            });

            row.append(dot, label, useBtn, saveBtn);
            list.appendChild(row);
        }
        wrap.appendChild(list);

        return wrap;
    }

    private createToggleRow(
        title: string,
        desc: string,
        active: boolean,
        onChange: (enabled: boolean) => void,
    ): HTMLElement {
        const row = document.createElement('div');
        row.className = 'apolo-toggle-row';

        const textWrap = document.createElement('div');
        textWrap.className = 'apolo-toggle-row-text';

        const titleEl = document.createElement('div');
        titleEl.className = 'apolo-toggle-title';
        titleEl.textContent = title;

        const descEl = document.createElement('div');
        descEl.className = 'apolo-toggle-desc';
        descEl.textContent = desc;

        textWrap.append(titleEl, descEl);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `apolo-switch-btn ${active ? '' : 'is-off'}`;
        btn.setAttribute('aria-pressed', String(active));
        btn.innerHTML = '<span class="apolo-switch-track"><span class="apolo-switch-thumb"></span></span>';

        btn.addEventListener('click', () => {
            const next = !active;
            btn.classList.toggle('is-off', !next);
            btn.setAttribute('aria-pressed', String(next));
            onChange(next);
        });

        row.append(textWrap, btn);
        return row;
    }

    destroy(): void {
        window.removeEventListener('pointerdown', this.onOutsidePointerDown, { capture: true });
        window.removeEventListener('touchstart', this.onOutsideTouchStart, { capture: true });
        window.removeEventListener('keydown', this.onKeyDown);
        this.container.remove();
    }
}
