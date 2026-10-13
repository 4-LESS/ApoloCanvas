import type { EraserMode, LassoMode, PenFavorite, PenProfileId, ShapeType, ToolbarSlot, ToolType } from '../core/types.ts';
import { HIGHLIGHTER_COLOR_NAMES, HIGHLIGHTER_PALETTE, ICONS, PEN_PROFILES, PRIMARY_COLOR_NAMES, PRIMARY_PALETTE, createStrokeWavePreview, createSvg, isDarkTheme, mapInkColorForDark } from './theme.ts';
import {
    PopoverShell,
    PopoverController,
    OptionCard,
    SliderRow,
    ToggleRow,
    ColorSwatchRow,
    createSectionLabel,
    calculateAnchorPosition,
    applyPopoverPosition,
    createSvgIcon,
    type IconName,
} from './kit/index.ts';

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
    private shell: PopoverShell;
    private state: ToolEstucheState;
    private callbacks: ToolEstucheCallbacks;
    private popoverController?: PopoverController;
    private currentAnchorEl: HTMLElement | null = null;

    // Direct references to UI Kit primitives to support in-place updates without DOM destruction
    private widthSlider?: SliderRow;
    private smoothingSlider?: SliderRow;
    private pressureSlider?: SliderRow;
    private eraserRadiusSlider?: SliderRow;
    private eraserPreviewDot?: HTMLElement;
    private colorSwatchRow?: ColorSwatchRow;
    private snapGridToggle?: ToggleRow;
    private scribbleToggle?: ToggleRow;
    private profileCards: Map<PenProfileId, OptionCard> = new Map();
    private eraserModeCards: Map<EraserMode, OptionCard> = new Map();
    private lassoModeCards: Map<LassoMode, OptionCard> = new Map();
    private shapeButtons: Map<ShapeType, HTMLButtonElement> = new Map();

    constructor(
        initialState: ToolEstucheState,
        callbacks: ToolEstucheCallbacks,
        parent: HTMLElement = document.body,
        popoverController?: PopoverController,
    ) {
        this.state = { ...initialState };
        this.callbacks = callbacks;
        this.popoverController = popoverController;

        this.shell = new PopoverShell({
            title: this.getTitleForTool(this.state.tool),
            icon: this.getIconForTool(this.state.tool),
            onClose: () => this.close(),
        });

        this.container = this.shell.container;
        this.container.classList.add('apolo-tool-estuche');

        parent.appendChild(this.container);
    }

    private getTitleForTool(tool: ToolType): string {
        const titles: Record<ToolType, string> = {
            pen: 'Estuche de plumas',
            highlighter: 'Estuche de marcadores',
            eraser: 'Estuche del borrador',
            lasso: 'Estuche del lazo',
            shape: 'Estuche de formas',
            spacer: 'Insertar canvas',
            link: 'Enlazar',
        };
        return titles[tool] || 'Estuche';
    }

    private getIconForTool(tool: ToolType): IconName {
        const icons: Record<ToolType, IconName> = {
            pen: 'pen',
            highlighter: 'highlighter',
            eraser: 'eraser',
            lasso: 'lasso',
            shape: 'shapes',
            spacer: 'insertCanvas',
            link: 'dots',
        };
        return icons[tool] || 'pen';
    }

    open(state?: Partial<ToolEstucheState>, anchorEl?: HTMLElement | null): void {
        if (state) {
            this.state = { ...this.state, ...state };
        }
        if (this.state.tool === 'spacer') {
            this.close();
            return;
        }

        if (anchorEl) {
            this.currentAnchorEl = anchorEl;
        }

        this.shell.setTitle(this.getTitleForTool(this.state.tool));
        this.shell.setIcon(this.getIconForTool(this.state.tool));

        this.render();
        this.shell.show();
        this.position(this.currentAnchorEl);

        if (this.popoverController) {
            this.popoverController.open(this.shell, this.currentAnchorEl);
        }
    }

    close(): void {
        if (!this.isOpen()) return;
        this.shell.hide();
        if (this.popoverController) {
            this.popoverController.close(this.shell);
        }
        this.callbacks.onClose();
    }

    isOpen(): boolean {
        return this.shell.isOpen();
    }

    updateState(partial: Partial<ToolEstucheState>): void {
        const previousTool = this.state.tool;
        this.state = { ...this.state, ...partial };

        if (!this.isOpen()) return;

        // If the tool itself changed, rebuild the panel body
        if (partial.tool && partial.tool !== previousTool) {
            this.shell.setTitle(this.getTitleForTool(this.state.tool));
            this.shell.setIcon(this.getIconForTool(this.state.tool));
            this.render();
            this.position(this.currentAnchorEl);
            return;
        }

        // In-place updates: do NOT reconstruct DOM to preserve focus and drag operations
        if (partial.width !== undefined && this.widthSlider) {
            this.widthSlider.setValue(partial.width);
        }
        if (partial.smoothing !== undefined && this.smoothingSlider) {
            this.smoothingSlider.setValue(Math.round(partial.smoothing * 100));
        }
        if (partial.pressureSensitivity !== undefined && this.pressureSlider) {
            this.pressureSlider.setValue(Math.round(partial.pressureSensitivity * 100));
        }
        if (partial.eraserRadius !== undefined && this.eraserRadiusSlider) {
            this.eraserRadiusSlider.setValue(partial.eraserRadius);
            this.updateEraserPreviewDot(partial.eraserRadius);
        }
        if (partial.color !== undefined && this.colorSwatchRow) {
            this.colorSwatchRow.setSelectedColor(partial.color);
        }
        if (partial.snapGrid !== undefined && this.snapGridToggle) {
            this.snapGridToggle.setChecked(partial.snapGrid);
        }
        if (partial.scribbleToErase !== undefined && this.scribbleToggle) {
            this.scribbleToggle.setChecked(partial.scribbleToErase);
        }
        if (partial.profileId !== undefined) {
            for (const [pId, card] of this.profileCards) {
                card.setSelected(pId === partial.profileId);
            }
        }
        if (partial.eraserMode !== undefined) {
            for (const [mode, card] of this.eraserModeCards) {
                card.setSelected(mode === partial.eraserMode);
            }
        }
        if (partial.lassoMode !== undefined) {
            for (const [mode, card] of this.lassoModeCards) {
                card.setSelected(mode === partial.lassoMode);
            }
        }
        if (partial.shapeType !== undefined) {
            for (const [type, btn] of this.shapeButtons) {
                const isActive = type === partial.shapeType;
                btn.classList.toggle('is-active', isActive);
                btn.setAttribute('aria-pressed', String(isActive));
            }
        }
        if (partial.slot !== undefined) {
            this.position(this.currentAnchorEl);
        }
    }

    position(anchorEl?: HTMLElement | null): void {
        const targetAnchor = anchorEl ?? this.currentAnchorEl;
        const estWidth = 420;
        const estHeight = Math.min(520, window.innerHeight - 80);

        if (targetAnchor) {
            const anchorRect = targetAnchor.getBoundingClientRect();
            const slot = this.state.slot;
            const preferredPlacement = (slot === 'bl' || slot === 'bc' || slot === 'br') ? 'top' :
                                       (slot === 'ml') ? 'right' :
                                       (slot === 'mr') ? 'left' : 'bottom';
            const pos = calculateAnchorPosition({
                anchorRect,
                popoverSize: { width: estWidth, height: estHeight },
                preferredPlacement,
                offset: 8,
                padding: 12,
            });
            applyPopoverPosition(this.container, pos);
            this.container.style.width = `${estWidth}px`;
            return;
        }

        // Fallback: slot geometry
        const slot = this.state.slot;
        const col = slot === 'tl' || slot === 'ml' || slot === 'bl' ? 0 : (slot === 'tc' || slot === 'bc' ? 1 : 2);
        const row = slot === 'tl' || slot === 'tc' || slot === 'tr' ? 0 : (slot === 'ml' || slot === 'mr' ? 1 : 2);

        const marginX = 16;
        const panelTop = row === 0 ? 122 : 56;

        let left = 0;
        if (col === 2) {
            left = marginX + 44;
        } else {
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
        const body = this.shell.body;
        body.replaceChildren();

        this.profileCards.clear();
        this.eraserModeCards.clear();
        this.lassoModeCards.clear();
        this.shapeButtons.clear();
        this.widthSlider = undefined;
        this.smoothingSlider = undefined;
        this.pressureSlider = undefined;
        this.eraserRadiusSlider = undefined;
        this.colorSwatchRow = undefined;
        this.snapGridToggle = undefined;
        this.scribbleToggle = undefined;

        const tool = this.state.tool;
        if (tool === 'pen') {
            this.renderPenContent(body);
        } else if (tool === 'highlighter') {
            this.renderHighlighterContent(body);
        } else if (tool === 'eraser') {
            this.renderEraserContent(body);
        } else if (tool === 'lasso') {
            this.renderLassoContent(body);
        } else if (tool === 'shape') {
            this.renderShapeContent(body);
        }
    }

    private renderPenContent(body: HTMLElement): void {
        // 1. Profile Cards (2x2 grid)
        const profilesGrid = document.createElement('div');
        profilesGrid.className = 'apolo-profiles-grid';

        const profiles: PenProfileId[] = ['fountain', 'calli', 'ball', 'pencil'];
        for (const pId of profiles) {
            const profile = PEN_PROFILES[pId];
            const wave = createStrokeWavePreview(profile, this.state.width, this.state.color);
            wave.classList.add('apolo-profile-wave');

            const card = new OptionCard({
                title: profile.name,
                preview: wave,
                selected: this.state.profileId === pId,
                onClick: () => {
                    this.callbacks.onSelectProfile(pId);
                    this.state.profileId = pId;
                    for (const [id, c] of this.profileCards) {
                        c.setSelected(id === pId);
                    }
                },
            });
            this.profileCards.set(pId, card);
            profilesGrid.appendChild(card.element);
        }
        body.appendChild(profilesGrid);

        // 2. Sliders (Grosor, Suavizado, Presión)
        const slidersList = document.createElement('div');
        slidersList.className = 'apolo-sliders-list';

        this.widthSlider = new SliderRow({
            label: 'Grosor',
            min: 1,
            max: 12,
            step: 0.5,
            value: this.state.width,
            unit: ' px',
            onInput: (val) => {
                this.state.width = val;
                this.callbacks.onChangeWidth(val);
                this.updateWavePreviews();
            },
        });
        slidersList.appendChild(this.widthSlider.element);

        this.smoothingSlider = new SliderRow({
            label: 'Suavizado',
            min: 0,
            max: 100,
            step: 1,
            value: Math.round(this.state.smoothing * 100),
            unit: ' %',
            onInput: (val) => {
                this.state.smoothing = val / 100;
                this.callbacks.onChangeSmoothing(this.state.smoothing);
            },
        });
        slidersList.appendChild(this.smoothingSlider.element);

        this.pressureSlider = new SliderRow({
            label: 'Sensibilidad a presión',
            min: 0,
            max: 100,
            step: 1,
            value: Math.round(this.state.pressureSensitivity * 100),
            unit: ' %',
            onInput: (val) => {
                this.state.pressureSensitivity = val / 100;
                this.callbacks.onChangePressure(this.state.pressureSensitivity);
            },
        });
        slidersList.appendChild(this.pressureSlider.element);

        body.appendChild(slidersList);

        // 3. Color Swatches + HEX
        body.appendChild(this.createColorSection(PRIMARY_PALETTE, PRIMARY_COLOR_NAMES));

        // 4. Favoritos de la barra
        body.appendChild(this.createFavoritesSection());
    }

    private renderHighlighterContent(body: HTMLElement): void {
        // 2 Highlighter Profiles (Round and Flat)
        const profilesGrid = document.createElement('div');
        profilesGrid.className = 'apolo-profiles-grid apolo-grid-2cols';

        const profiles: PenProfileId[] = ['hlr', 'hlf'];
        for (const pId of profiles) {
            const profile = PEN_PROFILES[pId];
            const wave = createStrokeWavePreview(profile, this.state.width, this.state.color);
            wave.classList.add('apolo-profile-wave');

            const card = new OptionCard({
                title: profile.name,
                preview: wave,
                selected: this.state.profileId === pId,
                onClick: () => {
                    this.callbacks.onSelectProfile(pId);
                    this.state.profileId = pId;
                    for (const [id, c] of this.profileCards) {
                        c.setSelected(id === pId);
                    }
                },
            });
            this.profileCards.set(pId, card);
            profilesGrid.appendChild(card.element);
        }
        body.appendChild(profilesGrid);

        // Slider Grosor
        const slidersList = document.createElement('div');
        slidersList.className = 'apolo-sliders-list';

        this.widthSlider = new SliderRow({
            label: 'Grosor',
            min: 4,
            max: 24,
            step: 1,
            value: this.state.width,
            unit: ' px',
            onInput: (val) => {
                this.state.width = val;
                this.callbacks.onChangeWidth(val);
                this.updateWavePreviews();
            },
        });
        slidersList.appendChild(this.widthSlider.element);
        body.appendChild(slidersList);

        // Color Swatches
        body.appendChild(this.createColorSection(HIGHLIGHTER_PALETTE, HIGHLIGHTER_COLOR_NAMES));
    }

    private renderEraserContent(body: HTMLElement): void {
        // Mode cards (Trazo completo vs Retícula)
        const modes = document.createElement('div');
        modes.className = 'apolo-eraser-modes';

        const wholeCard = new OptionCard({
            title: 'Trazo completo',
            description: 'Borra el trazo entero al tocarlo',
            selected: this.state.eraserMode === 'whole',
            onClick: () => {
                this.callbacks.onSelectEraserMode('whole');
                this.state.eraserMode = 'whole';
                for (const [m, c] of this.eraserModeCards) c.setSelected(m === 'whole');
            },
        });
        this.eraserModeCards.set('whole', wholeCard);

        const reticleCard = new OptionCard({
            title: 'Retícula',
            description: 'Corta el trazo en sub-trazos',
            selected: this.state.eraserMode === 'reticle',
            onClick: () => {
                this.callbacks.onSelectEraserMode('reticle');
                this.state.eraserMode = 'reticle';
                for (const [m, c] of this.eraserModeCards) c.setSelected(m === 'reticle');
            },
        });
        this.eraserModeCards.set('reticle', reticleCard);

        modes.append(wholeCard.element, reticleCard.element);
        body.appendChild(modes);

        // Eraser Size Slider with live preview circle
        const sizeSection = document.createElement('div');
        sizeSection.className = 'apolo-eraser-size-section';

        const previewWrap = document.createElement('div');
        previewWrap.className = 'apolo-eraser-preview-wrap';
        this.eraserPreviewDot = document.createElement('span');
        this.eraserPreviewDot.className = 'apolo-eraser-preview-dot';
        this.updateEraserPreviewDot(this.state.eraserRadius);
        previewWrap.appendChild(this.eraserPreviewDot);

        this.eraserRadiusSlider = new SliderRow({
            label: 'Tamaño del borrador',
            min: 8,
            max: 60,
            step: 2,
            value: this.state.eraserRadius,
            unit: ' px',
            onInput: (val) => {
                this.state.eraserRadius = val;
                this.updateEraserPreviewDot(val);
                this.callbacks.onChangeEraserRadius(val);
            },
        });
        this.eraserRadiusSlider.element.appendChild(previewWrap);
        sizeSection.appendChild(this.eraserRadiusSlider.element);
        body.appendChild(sizeSection);

        // Scribble to Erase Toggle
        this.scribbleToggle = new ToggleRow({
            label: 'Garabato para borrar',
            description: 'Zigzag rápido sobre trazos para eliminarlos',
            checked: this.state.scribbleToErase,
            onChange: (enabled) => {
                this.state.scribbleToErase = enabled;
                this.callbacks.onToggleScribble(enabled);
            },
        });
        body.appendChild(this.scribbleToggle.element);
    }

    private renderLassoContent(body: HTMLElement): void {
        const modes = document.createElement('div');
        modes.className = 'apolo-eraser-modes';

        const freeCard = new OptionCard({
            title: 'Lazo libre',
            description: 'Dibuja el contorno con el lápiz',
            selected: this.state.lassoMode === 'free',
            onClick: () => {
                this.callbacks.onSelectLassoMode('free');
                this.state.lassoMode = 'free';
                for (const [m, c] of this.lassoModeCards) c.setSelected(m === 'free');
            },
        });
        this.lassoModeCards.set('free', freeCard);

        const rectCard = new OptionCard({
            title: 'Rectángulo',
            description: 'Arrastra de una esquina a la opuesta',
            selected: this.state.lassoMode === 'rect',
            onClick: () => {
                this.callbacks.onSelectLassoMode('rect');
                this.state.lassoMode = 'rect';
                for (const [m, c] of this.lassoModeCards) c.setSelected(m === 'rect');
            },
        });
        this.lassoModeCards.set('rect', rectCard);

        modes.append(freeCard.element, rectCard.element);
        body.appendChild(modes);
    }

    private renderShapeContent(body: HTMLElement): void {
        // Shapes row (5 shapes with 44px touch targets)
        const shapesRow = document.createElement('div');
        shapesRow.className = 'apolo-shapes-row';

        const shapeDefs: Array<{ type: ShapeType; label: string; icon: IconName }> = [
            { type: 'line', label: 'Línea', icon: 'line' },
            { type: 'arrow', label: 'Flecha', icon: 'arrow' as IconName },
            { type: 'rect', label: 'Rectángulo', icon: 'rect' as IconName },
            { type: 'ellipse', label: 'Círculo', icon: 'ellipse' as IconName },
            { type: 'triangle', label: 'Triángulo', icon: 'triangle' as IconName },
        ];

        for (const def of shapeDefs) {
            const btn = document.createElement('button');
            btn.type = 'button';
            const isActive = this.state.shapeType === def.type;
            btn.className = `apolo-shape-icon-btn ${isActive ? 'is-active' : ''}`;
            btn.setAttribute('aria-label', def.label);
            btn.setAttribute('aria-pressed', String(isActive));
            btn.title = def.label;

            // Use kit icon helper with fallback to existing theme icon SVG
            if (ICONS.shapes[def.type]) {
                btn.appendChild(createSvg(ICONS.shapes[def.type], { size: 28 }));
            } else {
                btn.appendChild(createSvgIcon(def.icon, { size: 28 }));
            }

            btn.addEventListener('click', () => {
                this.callbacks.onSelectShapeType(def.type);
                this.state.shapeType = def.type;
                for (const [t, b] of this.shapeButtons) {
                    const active = t === def.type;
                    b.classList.toggle('is-active', active);
                    b.setAttribute('aria-pressed', String(active));
                }
            });

            this.shapeButtons.set(def.type, btn);
            shapesRow.appendChild(btn);
        }
        body.appendChild(shapesRow);

        // Snap Grid Toggle
        this.snapGridToggle = new ToggleRow({
            label: 'Imán de cuadrícula',
            description: 'Las formas encajan en una cuadrícula de 12 px',
            checked: this.state.snapGrid,
            onChange: (enabled) => {
                this.state.snapGrid = enabled;
                this.callbacks.onToggleSnapGrid(enabled);
            },
        });
        body.appendChild(this.snapGridToggle.element);

        // Thickness Slider
        const slidersList = document.createElement('div');
        slidersList.className = 'apolo-sliders-list';
        this.widthSlider = new SliderRow({
            label: 'Grosor',
            min: 1,
            max: 12,
            step: 0.5,
            value: this.state.width,
            unit: ' px',
            onInput: (val) => {
                this.state.width = val;
                this.callbacks.onChangeWidth(val);
            },
        });
        slidersList.appendChild(this.widthSlider.element);
        body.appendChild(slidersList);

        // Color Section
        body.appendChild(this.createColorSection(PRIMARY_PALETTE, PRIMARY_COLOR_NAMES));
    }

    private updateEraserPreviewDot(radius: number): void {
        if (!this.eraserPreviewDot) return;
        const size = Math.max(12, Math.min(36, radius * 0.7));
        this.eraserPreviewDot.style.width = `${size}px`;
        this.eraserPreviewDot.style.height = `${size}px`;
    }

    private updateWavePreviews(): void {
        for (const [pId, card] of this.profileCards) {
            const profile = PEN_PROFILES[pId];
            if (!profile) continue;
            const newWave = createStrokeWavePreview(profile, this.state.width, this.state.color);
            newWave.classList.add('apolo-profile-wave');
            card.setPreview(newWave);
        }
    }

    private createColorSection(palette: readonly string[], colorNames: Record<string, string>): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'apolo-estuche-color-section';

        wrap.appendChild(createSectionLabel('Color'));

        this.colorSwatchRow = new ColorSwatchRow({
            colors: [...palette],
            colorNames,
            selectedColor: this.state.color,
            onSelect: (col) => {
                this.state.color = col;
                this.callbacks.onChangeColor(col);
                this.updateWavePreviews();
            },
        });

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
            this.colorSwatchRow?.setSelectedColor(hiddenInput.value);
            this.updateWavePreviews();
        });
        addBtn.appendChild(hiddenInput);
        addBtn.addEventListener('click', () => hiddenInput.click());
        this.colorSwatchRow.element.appendChild(addBtn);

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
                this.colorSwatchRow?.setSelectedColor(val);
                this.updateWavePreviews();
            }
        });

        hexGroup.append(hexLabel, hexInput);
        this.colorSwatchRow.element.appendChild(hexGroup);

        wrap.appendChild(this.colorSwatchRow.element);
        return wrap;
    }

    private createFavoritesSection(): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'apolo-favorites-section';

        wrap.appendChild(createSectionLabel('Favoritos de la barra'));

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

    destroy(): void {
        this.close();
        this.shell.destroy();
    }
}
