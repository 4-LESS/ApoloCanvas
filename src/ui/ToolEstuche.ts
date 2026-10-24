import type {
    EraserMode,
    FavoritableTool,
    LassoMode,
    PenFavorite,
    PenProfileId,
    ShapeType,
    StrokePattern,
    ToolbarSlot,
    ToolFavoritePreset,
    ToolType,
    StrokeFavoriteProfile,
    ShapeFavoriteProfile,
    ShapeFillPattern,
} from '../core/types.ts';
import {
    DEFAULT_STROKE_FAVORITE_PROFILES,
    DEFAULT_SHAPE_FAVORITE_PROFILES,
} from '../core/types.ts';
import { listShapePlugins } from '../engine/shapes/index.ts';
import { ICONS, createFillGlyph, createSvg, setAccessibleTooltip, bindTapOrClick } from './theme.ts';
import { SliderControl, type PopoverController, type PopoverInstance } from './kit/index.ts';
import { ColorPickerPopover } from './popover/ColorPickerPopover.ts';
import { applyPopoverGeometry } from './popover/PopoverGeometry.ts';
import { FavoritesDrawer } from './favorites/FavoritesDrawer.ts';

export interface ToolEstucheState {
    tool: ToolType;
    slot: ToolbarSlot;
    color: string;
    width: number;
    profileId: PenProfileId;
    smoothing: number; // 0..1
    pressureSensitivity: number; // 0..1
    opacity?: number;
    lineStyle?: StrokePattern;
    pattern?: StrokePattern;
    straightenLines?: boolean;
    onlyHighlighter?: boolean;
    favorites: PenFavorite[] | ToolFavoritePreset[];
    eraserMode: EraserMode;
    eraserRadius: number;
    scribbleToErase: boolean;
    lassoMode: LassoMode;
    shapeType: ShapeType;
    snapGrid: boolean;
    isCurrentFavorite?: boolean;
    showingFavorites?: boolean;
    strokeFavoriteProfiles?: StrokeFavoriteProfile[];
    activeStrokeProfileId?: string;
    shapeFavoriteProfiles?: ShapeFavoriteProfile[];
    activeShapeProfileId?: string;
    syncFavoriteProfiles?: boolean;
    regularize?: boolean;
    fillEnabled?: boolean;
    fillColor?: string;
    fillPattern?: ShapeFillPattern;
    fillDensity?: number;
}

export interface ToolEstucheCallbacks {
    onSelectProfile: (profile: PenProfileId) => void;
    onChangeColor: (color: string) => void;
    onChangeWidth: (width: number) => void;
    onChangeSmoothing: (smoothing: number) => void;
    onChangePressure: (pressure: number) => void;
    onChangeOpacity?: (opacity: number) => void;
    onChangeLineStyle?: (pattern: StrokePattern) => void;
    onToggleStraighten?: (enabled: boolean) => void;
    onToggleOnlyHighlighter?: (enabled: boolean) => void;
    onUseFavorite: (index: number) => void;
    onSaveFavorite: (index: number) => void;
    onToggleFavorite?: () => void;
    onApplyFavorite?: (preset: ToolFavoritePreset) => void;
    onDeleteFavorite?: (presetId: string) => void;
    onReorderFavorites?: (fromIndex: number, toIndex: number) => void;
    onRenameFavorite?: (presetId: string, newName: string) => void;
    onSwitchProfile?: (profileId: string) => void;
    onCreateProfile?: (name: string) => void;
    onToggleSyncProfiles?: (sync: boolean) => void;
    onSelectEraserMode: (mode: EraserMode) => void;
    onChangeEraserRadius: (radius: number) => void;
    onToggleScribble: (enabled: boolean) => void;
    onSelectLassoMode: (mode: LassoMode) => void;
    onSelectShapeType: (shapeType: ShapeType) => void;
    onToggleSnapGrid: (enabled: boolean) => void;
    onToggleRegularize?: (enabled: boolean) => void;
    onToggleFillEnabled?: (enabled: boolean) => void;
    onChangeFillColor?: (color: string) => void;
    onChangeFillPattern?: (pattern: ShapeFillPattern) => void;
    onChangeFillDensity?: (density: number) => void;
    onClose?: () => void;
}

export class ToolEstuche implements PopoverInstance {
    readonly container: HTMLElement;
    private state: ToolEstucheState;
    private callbacks: ToolEstucheCallbacks;
    private popoverController?: PopoverController;
    private currentAnchorEl: HTMLElement | null = null;
    private openState = false;
    private colorPicker: ColorPickerPopover;

    // Direct DOM nodes for in-place updates without DOM destruction
    private headerEl: HTMLElement;
    private bodyEl: HTMLElement;
    private widthInput?: HTMLInputElement;
    private widthBubble?: HTMLElement;
    private smoothingInput?: HTMLInputElement;
    private smoothingBubble?: HTMLElement;
    private opacityInput?: HTMLInputElement;
    private opacityBubble?: HTMLElement;
    private eraserRadiusInput?: HTMLInputElement;
    private eraserRadiusBubble?: HTMLElement;
    private eraserPreviewDot?: HTMLElement;
    private snapGridSwitch?: HTMLElement;
    private scribbleSwitch?: HTMLElement;
    private toolButtons: Map<string, HTMLElement> = new Map();
    private eraserModeButtons: Map<string, HTMLElement> = new Map();
    private lassoModeButtons: Map<string, HTMLElement> = new Map();
    private shapeButtons: Map<string, HTMLElement> = new Map();
    private lineStyleChips: Map<string, HTMLElement> = new Map();
    private regularizeSwitch?: HTMLElement;
    private fillSwitch?: HTMLElement;
    private fillSubpanel?: HTMLElement;
    private fillPatternChips: Map<string, HTMLElement> = new Map();
    private fillColorRowEl?: HTMLElement;
    private fillColorButtons: Map<string, HTMLElement> = new Map();
    private shapeCarouselEl?: HTMLElement;
    private shapePagerEl?: HTMLElement;
    private shapePageDots: HTMLElement[] = [];
    private widthSliderControl?: SliderControl;
    private shapeLineBtn?: HTMLElement;
    private shapeFillBtn?: HTMLElement;
    private shapeRegularizeBtn?: HTMLElement;
    private shapeLineTray?: HTMLElement;
    private shapeFillTray?: HTMLElement;
    private shapeOpenTray: 'line' | 'fill' | '' = '';
    private shapeLineGlyphContainer?: HTMLElement;
    private shapeFillGlyphContainer?: HTMLElement;
    private shapeLineOptionButtons: Map<StrokePattern, HTMLElement> = new Map();
    private shapeFillPatternButtons: Map<ShapeFillPattern | 'off', HTMLElement> = new Map();
    private shapeDensitySlider?: SliderControl;
    private shapeDensitySection?: HTMLElement;
    private shapeSubFillRowEl?: HTMLElement;
    private shapeSubFillButtons: Map<string, HTMLElement> = new Map();
    private straightenSwitch?: HTMLElement;
    private onlyHighlighterSwitch?: HTMLElement;
    private swatchRowEl?: HTMLElement;
    private paginationEl?: HTMLElement;
    private swatchButtons: Map<string, HTMLElement> = new Map();
    private starBtn?: HTMLElement;
    private favsBtn?: HTMLElement;
    private favoritesDrawer?: FavoritesDrawer;
    private titleEl?: HTMLElement;
    private headerDotsContainer?: HTMLElement;

    private recentColors: string[] = ['#E53935', '#FFA726', '#FFEE58', '#26A69A', '#42A5F5', '#1E88E5', '#7E57C2', '#EEEEEE'];
    private maxRecentSlots = 8;
    private colorPages: string[][] = [];
    private currentPageIndex = 0;

    constructor(
        initialState: ToolEstucheState,
        callbacks: ToolEstucheCallbacks,
        parent: HTMLElement = document.body,
        popoverController?: PopoverController,
    ) {
        this.state = { ...initialState };
        this.callbacks = callbacks;
        this.popoverController = popoverController;

        this.initColorPages();

        this.container = document.createElement('div');
        this.container.className = 'panel apolo-estuche-popover apolo-tool-estuche apolo-popover-shell';
        this.container.hidden = true;
        this.container.style.display = 'none';
        this.container.setAttribute('role', 'dialog');
        this.container.setAttribute('aria-label', this.getTitleForTool(this.state.tool));
        this.container.addEventListener('pointerdown', (e) => e.stopPropagation());

        this.headerEl = document.createElement('div');
        this.headerEl.className = 'hd popover-header';

        this.bodyEl = document.createElement('div');
        this.bodyEl.className = 'estuche-body apolo-popover-body';

        this.container.append(this.headerEl, this.bodyEl);
        parent.appendChild(this.container);

        this.colorPicker = new ColorPickerPopover(parent, this.popoverController);
    }

    private initColorPages(): void {
        if (this.state.tool === 'highlighter') {
            this.recentColors = ['#FDD835', '#43A047', '#00ACC1', '#1E88E5', '#8E24AA', '#E91E63', '#FB8C00', '#B0BEC5'];
            this.colorPages = [
                this.recentColors,
                ['#FFEE58', '#66BB6A', '#26C6DA', '#42A5F5', '#AB47BC', '#EC407A', '#FFA726', '#CFD8DC'],
                ['#FFF59D', '#A5D6A7', '#80DEEA', '#90CAF9', '#CE93D8', '#F48FB1', '#FFCC80', '#ECEFF1'],
                ['#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3', '#00BCD4', '#009688'],
            ];
        } else {
            this.recentColors = ['#E53935', '#FFA726', '#FFEE58', '#26A69A', '#42A5F5', '#1E88E5', '#7E57C2', '#EEEEEE'];
            this.colorPages = [
                this.recentColors,
                ['#D32F2F', '#C2185B', '#7B1FA2', '#512DA8', '#303F9F', '#1976D2', '#0288D1', '#0097A7'],
                ['#FFCDD2', '#F8BBD0', '#E1BEE7', '#D1C4E9', '#C5CAE9', '#BBDEFB', '#B3E5FC', '#B2EBF2'],
                ['#212121', '#424242', '#616161', '#757575', '#9E9E9E', '#BDBDBD', '#E0E0E0', '#FFFFFF'],
            ];
        }
    }

    private pushRecentColor(hex: string): void {
        const clean = hex.toUpperCase();
        this.recentColors = this.recentColors.filter((c) => c.toUpperCase() !== clean);
        this.recentColors.unshift(clean);
        if (this.recentColors.length > this.maxRecentSlots) {
            this.recentColors.pop();
        }
        this.colorPages[0] = this.recentColors;
        ColorPickerPopover.pushRecentColor(clean);
    }

    private getTitleForTool(tool: ToolType): string {
        const titles: Record<ToolType, string> = {
            pen: 'Estuche de plumas',
            highlighter: 'Estuche de marcadores',
            eraser: 'Borrador',
            lasso: 'Lazo',
            shape: 'Formas',
            link: 'Enlazar',
        };
        return titles[tool] || 'Estuche';
    }

    private getOpacityPercent(): number {
        if (this.state.opacity !== undefined) {
            return this.state.opacity <= 1 ? Math.round(this.state.opacity * 100) : Math.round(this.state.opacity);
        }
        return Math.round((this.state.pressureSensitivity ?? 0.75) * 100);
    }

    open(state?: Partial<ToolEstucheState>, anchorEl?: HTMLElement | null): void {
        if (state) {
            const toolChanged = state.tool && state.tool !== this.state.tool;
            if (toolChanged) {
                this.state.showingFavorites = false;
                this.initColorPages();
            }
            this.state = { ...this.state, ...state };
            if (state.color) {
                this.pushRecentColor(state.color);
            }
        }

        if (anchorEl) {
            this.currentAnchorEl = anchorEl;
        }

        this.openState = true;
        this.container.hidden = false;
        this.container.style.display = 'flex';
        this.container.setAttribute('aria-label', this.getTitleForTool(this.state.tool));

        this.render();
        this.position(this.currentAnchorEl);
        this.triggerAnimation();

        if (this.popoverController) {
            this.popoverController.open(this, this.currentAnchorEl);
        }
    }

    close(): void {
        if (!this.isOpen()) return;
        this.openState = false;
        this.container.hidden = true;
        this.container.style.display = 'none';
        this.container.classList.remove('apolo-popover-animated');
        this.destroyFavoritesDrawer();
        this.colorPicker?.close();
        if (this.popoverController) {
            this.popoverController.close(this);
        }
        this.callbacks.onClose?.();
    }

    private destroyFavoritesDrawer(): void {
        if (this.favoritesDrawer) {
            this.favoritesDrawer.destroy();
            this.favoritesDrawer = undefined;
        }
    }

    hide(): void {
        this.close();
    }

    isOpen(): boolean {
        return this.openState;
    }

    containsTarget(target: Node): boolean {
        return Boolean(this.colorPicker?.isOpen() && this.colorPicker.el.contains(target));
    }

    private triggerAnimation(): void {
        this.container.classList.remove('apolo-popover-animated');
        void this.container.offsetWidth;
        this.container.classList.add('apolo-popover-animated');
    }

    position(anchorEl?: HTMLElement | null): void {
        if (!this.isOpen()) return;
        const anchor = anchorEl ?? this.currentAnchorEl;
        if (!anchor) return;
        const toolbarEl = (anchor?.closest?.('.apolo-canvas-toolbar') as HTMLElement) || anchor?.parentElement || null;
        const w = this.state.tool === 'eraser' ? 290 : (this.state.tool === 'shape' ? 330 : 320);
        this.container.style.width = `${w}px`;
        applyPopoverGeometry(this.container, anchor, toolbarEl, this.state.slot, {
            fallbackWidth: w,
            fallbackHeight: 440,
        });
    }

    private syncSliderVisual(input?: HTMLInputElement, bubble?: HTMLElement, val?: number, defaultMin = 1, defaultMax = 20): void {
        if (val === undefined || !input || !bubble) return;
        input.value = String(val);
        bubble.textContent = String(val);
        const min = Number(input.min) || defaultMin;
        const max = Number(input.max) || defaultMax;
        const ratio = Math.max(0, Math.min(1, (val - min) / (max - min)));
        const pct = `${(ratio * 100).toFixed(1)}%`;
        bubble.style.left = `calc(${ratio * 100}% - ${ratio * 24}px)`;
        const track = input.parentElement;
        if (track) {
            track.style.setProperty?.('--val', pct);
            const fill = (track as any).querySelector
                ? ((track as any).querySelector('.slider-fill') as HTMLElement | null)
                : ((track as any).children ? (Array.from((track as any).children) as any[]).find((c: any) => c.className?.includes?.('slider-fill')) : null) as HTMLElement | null;
            if (fill) fill.style.width = pct;
        }
    }

    private syncSwitchVisual(sw?: HTMLElement, checked?: boolean): void {
        if (checked === undefined || !sw) return;
        sw.classList.toggle('is-checked', checked);
        sw.classList.toggle('is-on', checked);
        const thumb = sw.querySelector('.popover-switch-thumb') as HTMLElement | null;
        if (thumb) thumb.style.transform = checked ? 'translateX(18px)' : 'none';
    }

    private getDomainProfilesList(): Array<StrokeFavoriteProfile | ShapeFavoriteProfile> {
        if (this.state.tool === 'shape') {
            return Array.isArray(this.state.shapeFavoriteProfiles) && this.state.shapeFavoriteProfiles.length > 0
                ? this.state.shapeFavoriteProfiles
                : DEFAULT_SHAPE_FAVORITE_PROFILES;
        }
        return Array.isArray(this.state.strokeFavoriteProfiles) && this.state.strokeFavoriteProfiles.length > 0
            ? this.state.strokeFavoriteProfiles
            : DEFAULT_STROKE_FAVORITE_PROFILES;
    }

    updateState(partial: Partial<ToolEstucheState>): void {
        const previousTool = this.state.tool;
        const previousShowingFavs = this.state.showingFavorites;
        this.state = { ...this.state, ...partial };

        if (!this.isOpen()) return;

        if (partial.tool && partial.tool !== previousTool) {
            this.state.showingFavorites = false;
            this.initColorPages();
            this.render();
            this.position(this.currentAnchorEl);
            return;
        }

        if (partial.showingFavorites !== undefined && partial.showingFavorites !== previousShowingFavs) {
            this.setShowingFavorites(partial.showingFavorites);
            return;
        }

        if (partial.isCurrentFavorite !== undefined) this.updateStarButtonVisual();

        if (
            partial.favorites !== undefined ||
            partial.strokeFavoriteProfiles !== undefined ||
            partial.shapeFavoriteProfiles !== undefined ||
            partial.activeStrokeProfileId !== undefined ||
            partial.activeShapeProfileId !== undefined ||
            partial.syncFavoriteProfiles !== undefined
        ) {
            this.updateFavsButtonVisual();
            this.updateHeaderTitleVisual();
            if (this.state.showingFavorites && this.favoritesDrawer) {
                this.favoritesDrawer.update(
                    this.state.tool as FavoritableTool,
                    this.getToolFavorites(),
                    this.getCurrentToolSlice(),
                    this.getDomainProfilesList(),
                    this.getActiveProfileId(),
                    Boolean(this.state.syncFavoriteProfiles),
                );
            }
        }

        // In-place updates: zero DOM destruction to preserve slider drags and focus
        this.syncSliderVisual(this.widthInput, this.widthBubble, partial.width, 1, 20);
        if (partial.width !== undefined) {
            this.widthSliderControl?.setValue(partial.width, false);
        }
        if (partial.smoothing !== undefined) {
            this.syncSliderVisual(this.smoothingInput, this.smoothingBubble, Math.round(partial.smoothing * 10), 0, 10);
        }
        if (partial.opacity !== undefined) {
            this.syncSliderVisual(this.opacityInput, this.opacityBubble, Math.round(partial.opacity), 0, 100);
        } else if (partial.pressureSensitivity !== undefined) {
            this.syncSliderVisual(this.opacityInput, this.opacityBubble, Math.round(partial.pressureSensitivity * 100), 0, 100);
        }

        if (partial.lineStyle !== undefined || partial.pattern !== undefined) {
            this.updateShapeLineVisual();
            if (this.lineStyleChips.size > 0) {
                const nextPattern = (partial.pattern ?? partial.lineStyle ?? this.state.pattern ?? this.state.lineStyle ?? 'solid') as StrokePattern;
                this.state.lineStyle = nextPattern;
                this.state.pattern = nextPattern;
                for (const [pattern, btn] of this.lineStyleChips) {
                    const isActive = pattern === nextPattern;
                    btn.classList.toggle('is-active', isActive);
                    btn.setAttribute('aria-pressed', String(isActive));
                }
            }
        }

        this.syncSwitchVisual(this.straightenSwitch, partial.straightenLines);
        this.syncSwitchVisual(this.onlyHighlighterSwitch, partial.onlyHighlighter);
        this.syncSwitchVisual(this.snapGridSwitch, partial.snapGrid);
        this.syncSwitchVisual(this.regularizeSwitch, partial.regularize);
        if (partial.regularize !== undefined && this.shapeRegularizeBtn) {
            this.shapeRegularizeBtn.classList.toggle('on', Boolean(partial.regularize));
        }
        this.syncSwitchVisual(this.fillSwitch, partial.fillEnabled);
        if (partial.fillEnabled !== undefined && this.fillSubpanel) {
            this.fillSubpanel.classList.toggle('is-disabled', !partial.fillEnabled);
        }
        if (partial.fillPattern !== undefined && this.fillPatternChips.size > 0) {
            this.state.fillPattern = partial.fillPattern;
            for (const [pat, btn] of this.fillPatternChips) {
                const isActive = pat === partial.fillPattern;
                btn.classList.toggle('is-active', isActive);
                btn.setAttribute('aria-pressed', String(isActive));
            }
        }
        if (partial.fillColor !== undefined && this.fillColorButtons.size > 0) {
            const cleanFill = partial.fillColor.toUpperCase();
            this.state.fillColor = partial.fillColor;
            for (const [col, btn] of this.fillColorButtons) {
                btn.classList.toggle('is-active', col.toUpperCase() === cleanFill);
            }
        }
        if (
            partial.fillEnabled !== undefined ||
            partial.fillPattern !== undefined ||
            partial.fillColor !== undefined ||
            partial.fillDensity !== undefined
        ) {
            this.updateShapeFillGlyphs();
        }
        this.syncSwitchVisual(this.scribbleSwitch, partial.scribbleToErase);

        if (partial.profileId !== undefined) {
            for (const [id, btn] of this.toolButtons) btn.classList.toggle('is-active', id === partial.profileId);
        }

        if (partial.color !== undefined) {
            const clean = partial.color.toUpperCase();
            this.pushRecentColor(partial.color);
            for (const [col, btn] of this.swatchButtons) btn.classList.toggle('is-active', col.toUpperCase() === clean);
            this.container.style.setProperty('--hl-color', partial.color);
            this.opacityInput?.parentElement?.style.setProperty('--hl-color', partial.color);
        }

        if (partial.eraserRadius !== undefined) {
            this.syncSliderVisual(this.eraserRadiusInput, this.eraserRadiusBubble, partial.eraserRadius, 8, 60);
            if (this.eraserPreviewDot) {
                const dotSize = Math.max(12, Math.min(36, partial.eraserRadius * 0.7));
                this.eraserPreviewDot.style.width = `${dotSize}px`;
                this.eraserPreviewDot.style.height = `${dotSize}px`;
            }
        }

        if (partial.eraserMode !== undefined) {
            for (const [mode, btn] of this.eraserModeButtons) btn.classList.toggle('is-active', mode === partial.eraserMode);
        }

        if (partial.lassoMode !== undefined) {
            for (const [mode, btn] of this.lassoModeButtons) btn.classList.toggle('is-active', mode === partial.lassoMode);
        }

        if (partial.shapeType !== undefined) {
            const active = partial.shapeType;
            for (const [type, btn] of this.shapeButtons) {
                const isActive = type === active ||
                    (type === 'rect' && (active as string) === 'rectangle') ||
                    (type === 'ellipse' && (active as string) === 'circle');
                btn.classList.toggle('on', isActive);
                btn.classList.toggle('is-active', isActive);
                btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
                btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            }
        }

        if (partial.slot !== undefined) this.position(this.currentAnchorEl);
    }

    public setShowingFavorites(showing: boolean): void {
        this.state.showingFavorites = showing;
        this.render();
        this.position(this.currentAnchorEl);
    }

    public isShowingFavorites(): boolean {
        return Boolean(this.state.showingFavorites);
    }

    private updateStarButtonVisual(): void {
        if (!this.starBtn) return;
        const isFav = Boolean(this.state.isCurrentFavorite);
        this.starBtn.classList.toggle('is-active', isFav);
        this.starBtn.classList.toggle('is-fav-saved', isFav);
        this.starBtn.setAttribute('aria-pressed', String(isFav));
        setAccessibleTooltip(this.starBtn, isFav ? 'Quitar de favoritos' : 'Guardar en favoritos');
        this.starBtn.replaceChildren(createSvg(isFav ? ICONS.starOff : ICONS.star, { size: 18 }));
    }

    private updateFavsButtonVisual(): void {
        if (!this.favsBtn) return;
        const isShowing = Boolean(this.state.showingFavorites);
        this.favsBtn.className = `hd-bookmark-btn popover-hdr-btn popover-favs-btn${isShowing ? ' is-active popover-back-btn' : ''}`;
        setAccessibleTooltip(this.favsBtn, isShowing ? 'Volver al estuche' : 'Ver favoritos guardados');
        this.favsBtn.setAttribute('aria-pressed', String(isShowing));
        this.favsBtn.onclick = () => {
            if (this.state.showingFavorites) {
                if (this.favoritesDrawer?.getIsCreatingProfile?.()) {
                    this.favoritesDrawer.closeCreateProfileForm();
                } else {
                    this.setShowingFavorites(false);
                }
            } else {
                this.setShowingFavorites(true);
            }
        };

        const count = this.getToolFavorites().length;
        const bookmarkSvg = createSvg(ICONS.bookmark, { size: 18 });
        this.favsBtn.replaceChildren(bookmarkSvg);
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'popover-favs-badge';
            badge.textContent = String(count);
            this.favsBtn.appendChild(badge);
        }
    }

    private getActiveToolProfiles(): Array<{ id: string; name: string }> {
        return this.getDomainProfilesList().map(p => ({ id: p.id, name: p.name }));
    }

    private getActiveProfileId(): string {
        return this.state.tool === 'shape'
            ? (this.state.activeShapeProfileId ?? 'general')
            : (this.state.activeStrokeProfileId ?? 'notes');
    }

    private getActiveProfileName(): string {
        const profiles = this.getActiveToolProfiles();
        const activeId = this.getActiveProfileId();
        return (profiles.find(p => p.id === activeId) ?? profiles[0])?.name || 'Favoritos';
    }

    public switchProfile(profileId: string): void {
        if (this.state.tool === 'shape') this.state.activeShapeProfileId = profileId;
        else this.state.activeStrokeProfileId = profileId;
        this.updateHeaderTitleVisual();
        this.updateFavsButtonVisual();
        if (this.favoritesDrawer) {
            this.favoritesDrawer.update(
                this.state.tool as FavoritableTool,
                this.getToolFavorites(),
                this.getCurrentToolSlice(),
                this.getDomainProfilesList(),
                profileId,
                Boolean(this.state.syncFavoriteProfiles),
            );
        }
        this.callbacks.onSwitchProfile?.(profileId);
    }

    private updateHeaderTitleVisual(): void {
        if (!this.titleEl) return;
        if (this.state.showingFavorites) {
            this.titleEl.textContent = this.getActiveProfileName();

            if (!this.headerDotsContainer && this.titleEl.parentElement) {
                const dotsContainer = document.createElement('nav');
                dotsContainer.className = 'pager popover-header-profile-dots apolo-kit-dots-indicator';
                dotsContainer.setAttribute('aria-label', 'Perfiles');
                this.titleEl.parentElement.appendChild(dotsContainer);
                this.headerDotsContainer = dotsContainer;
            }

            if (this.headerDotsContainer) {
                this.headerDotsContainer.replaceChildren();
                const profiles = this.getActiveToolProfiles();
                const currIdx = profiles.findIndex(p => p.id === this.getActiveProfileId());
                const safeIdx = currIdx !== -1 ? currIdx : 0;
                const isLastProfile = safeIdx === profiles.length - 1;

                const prevBtn = document.createElement('button');
                prevBtn.type = 'button';
                prevBtn.className = 'arrow apolo-kit-nav-btn apolo-kit-nav-prev';
                setAccessibleTooltip(prevBtn, 'Perfil anterior');
                prevBtn.appendChild(createSvg(ICONS.chevronLeft, { size: 12, strokeWidth: 2 }));
                if (safeIdx === 0) {
                    prevBtn.classList.add('is-disabled');
                    prevBtn.disabled = true;
                } else {
                    prevBtn.onclick = (e) => { e.stopPropagation(); this.switchProfile(profiles[safeIdx - 1].id); };
                }
                this.headerDotsContainer.appendChild(prevBtn);

                const track = document.createElement('div');
                track.className = 'apolo-kit-dots-track';
                profiles.forEach((p, idx) => {
                    const dot = document.createElement('button');
                    dot.type = 'button';
                    dot.className = `dot popover-header-dot apolo-kit-dot${idx === safeIdx ? ' is-active' : ''}`;
                    setAccessibleTooltip(dot, `Perfil ${p.name}`, p.name);
                    dot.onclick = (e) => { e.stopPropagation(); this.switchProfile(p.id); };
                    track.appendChild(dot);
                });

                const addDot = document.createElement('button');
                addDot.type = 'button';
                addDot.className = `dot-add popover-header-dot apolo-kit-dot is-add-dot${isLastProfile ? ' is-next-hint' : ''}`;
                setAccessibleTooltip(addDot, 'Nuevo perfil');
                addDot.appendChild(createSvg(ICONS.plus, { size: 10, strokeWidth: 2.2 }));
                addDot.onclick = (e) => { e.stopPropagation(); this.favoritesDrawer?.openCreateProfileForm(); };
                track.appendChild(addDot);
                this.headerDotsContainer.appendChild(track);

                const nextBtn = document.createElement('button');
                nextBtn.type = 'button';
                nextBtn.className = 'arrow apolo-kit-nav-btn apolo-kit-nav-next';
                setAccessibleTooltip(nextBtn, isLastProfile ? 'Nuevo perfil' : 'Perfil siguiente');
                nextBtn.appendChild(createSvg(ICONS.chevronRight, { size: 12, strokeWidth: 2 }));
                nextBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (safeIdx < profiles.length - 1) this.switchProfile(profiles[safeIdx + 1].id);
                    else this.favoritesDrawer?.openCreateProfileForm();
                };
                this.headerDotsContainer.appendChild(nextBtn);
            }
        } else {
            this.titleEl.textContent = this.getTitleForTool(this.state.tool);
            this.headerDotsContainer?.replaceChildren();
        }
    }

    private getToolFavorites(): ToolFavoritePreset[] {
        const tool = this.state.tool;
        if (tool === 'pen' && this.state.strokeFavoriteProfiles) {
            const activeId = this.state.activeStrokeProfileId ?? 'notes';
            const prof = this.state.strokeFavoriteProfiles.find(p => p.id === activeId) ?? this.state.strokeFavoriteProfiles[0];
            if (prof?.pen) return prof.pen;
        } else if (tool === 'highlighter' && this.state.strokeFavoriteProfiles) {
            const activeId = this.state.activeStrokeProfileId ?? 'notes';
            const prof = this.state.strokeFavoriteProfiles.find(p => p.id === activeId) ?? this.state.strokeFavoriteProfiles[0];
            if (prof?.highlighter) return prof.highlighter;
        } else if (tool === 'shape' && this.state.shapeFavoriteProfiles) {
            const activeId = this.state.activeShapeProfileId ?? 'general';
            const prof = this.state.shapeFavoriteProfiles.find(p => p.id === activeId) ?? this.state.shapeFavoriteProfiles[0];
            if (prof?.shape) return prof.shape;
        }
        if (Array.isArray(this.state.favorites)) {
            return this.state.favorites.filter((f): f is ToolFavoritePreset => Boolean(f && typeof f === 'object' && 'id' in f));
        }
        return [];
    }

    private getCurrentToolSlice(): any {
        const tool = this.state.tool;
        if (tool === 'pen') {
            return {
                tool: 'pen',
                profileId: this.state.profileId,
                color: this.state.color,
                width: this.state.width,
                opacity: this.state.opacity ?? 1,
                pattern: this.state.pattern ?? this.state.lineStyle ?? 'solid',
                straightenLines: Boolean(this.state.straightenLines),
                smoothing: this.state.smoothing,
            };
        }
        if (tool === 'highlighter') {
            return {
                tool: 'highlighter',
                profileId: this.state.profileId === 'hlf' ? 'hlf' : 'hlr',
                color: this.state.color,
                width: this.state.width,
                opacity: this.state.opacity ?? 0.75,
                pattern: this.state.pattern ?? this.state.lineStyle ?? 'solid',
                straightenLines: Boolean(this.state.straightenLines),
            };
        }
        if (tool === 'shape') {
            return {
                tool: 'shape',
                shapeType: this.state.shapeType ?? 'rect',
                color: this.state.color,
                width: this.state.width,
                opacity: this.state.opacity ?? 1,
                pattern: this.state.pattern ?? this.state.lineStyle ?? 'solid',
                fillEnabled: false,
            };
        }
        return null;
    }

    private render(): void {
        this.destroyFavoritesDrawer();
        this.headerEl.replaceChildren();
        this.bodyEl.replaceChildren();

        this.toolButtons.clear();
        this.eraserModeButtons.clear();
        this.lassoModeButtons.clear();
        this.shapeButtons.clear();
        this.lineStyleChips.clear();
        this.swatchButtons.clear();

        const tool = this.state.tool;
        if (tool === 'pen' || tool === 'highlighter' || tool === 'shape') {
            this.renderFavoritesAwareHeader(this.getTitleForTool(tool));
            if (this.state.showingFavorites) {
                this.renderFavoritesDrawerContent();
            } else if (tool === 'pen') {
                this.renderPenContent();
            } else if (tool === 'highlighter') {
                this.renderHighlighterContent();
            } else if (tool === 'shape') {
                this.renderShapeContent();
            }
        } else if (tool === 'eraser') {
            this.renderSimpleHeader('Borrador');
            this.renderEraserContent();
        } else if (tool === 'lasso') {
            this.renderSimpleHeader('Lazo');
            this.renderLassoContent();
        }
    }

    private renderFavoritesDrawerContent(): void {
        this.destroyFavoritesDrawer();
        this.favoritesDrawer = new FavoritesDrawer(
            {
                onSelectFavorite: (preset) => {
                    this.callbacks.onApplyFavorite?.(preset);
                    this.close();
                },
                onDeleteFavorite: (presetId) => this.callbacks.onDeleteFavorite?.(presetId),
                onReorderFavorite: (fromIndex, toIndex) => this.callbacks.onReorderFavorites?.(fromIndex, toIndex),
                onRenameFavorite: (presetId, newName) => this.callbacks.onRenameFavorite?.(presetId, newName),
                onSwitchProfile: (profileId) => this.switchProfile(profileId),
                onCreateProfile: (name) => this.callbacks.onCreateProfile?.(name),
                onToggleSyncProfiles: (sync) => this.callbacks.onToggleSyncProfiles?.(sync),
                onProfileModeChange: (mode) => {
                    const isCreate = mode === 'create';
                    if (isCreate && this.titleEl) this.titleEl.textContent = 'Nuevo perfil';
                    if (this.headerDotsContainer) this.headerDotsContainer.style.display = isCreate ? 'none' : '';
                    if (this.starBtn) this.starBtn.style.display = isCreate ? 'none' : '';
                    if (this.favsBtn) setAccessibleTooltip(this.favsBtn, isCreate ? 'Cancelar y volver' : 'Volver al estuche');
                    if (!isCreate) this.updateHeaderTitleVisual();
                },
            },
            this.state.tool as FavoritableTool,
            this.getToolFavorites(),
            this.getCurrentToolSlice(),
            this.bodyEl,
            this.getDomainProfilesList(),
            this.getActiveProfileId(),
            Boolean(this.state.syncFavoriteProfiles),
        );
    }

    private renderFavoritesAwareHeader(titleText: string): void {
        const hdLeft = document.createElement('div');
        hdLeft.className = 'hd-left';

        const isShowingFavs = Boolean(this.state.showingFavorites);

        const favsBtn = document.createElement('button');
        favsBtn.type = 'button';
        favsBtn.className = `hd-bookmark-btn popover-hdr-btn popover-favs-btn${isShowingFavs ? ' is-active popover-back-btn' : ''}`;
        setAccessibleTooltip(favsBtn, isShowingFavs ? 'Volver al estuche' : 'Ver favoritos guardados');
        favsBtn.setAttribute('aria-pressed', String(isShowingFavs));
        favsBtn.appendChild(createSvg(ICONS.bookmark, { size: 18 }));

        const count = this.getToolFavorites().length;
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'popover-favs-badge';
            badge.textContent = String(count);
            favsBtn.appendChild(badge);
        }

        favsBtn.onclick = () => {
            if (this.state.showingFavorites) {
                if (this.favoritesDrawer?.getIsCreatingProfile?.()) {
                    this.favoritesDrawer.closeCreateProfileForm();
                } else {
                    this.setShowingFavorites(false);
                }
            } else {
                this.setShowingFavorites(true);
            }
        };
        this.favsBtn = favsBtn;
        hdLeft.appendChild(favsBtn);

        const titleContainer = document.createElement('div');
        titleContainer.className = 'hd-center popover-title-container popover-title-wrap';

        const isCreating = isShowingFavs && Boolean(this.favoritesDrawer?.getIsCreatingProfile?.());
        const title = document.createElement('h2');
        title.className = 'title popover-title';
        title.textContent = isCreating ? 'Nuevo perfil' : isShowingFavs ? this.getActiveProfileName() : titleText;
        titleContainer.appendChild(title);
        this.titleEl = title;

        if (isShowingFavs) {
            const dotsContainer = document.createElement('nav');
            dotsContainer.className = 'pager popover-header-profile-dots apolo-kit-dots-indicator';
            dotsContainer.setAttribute('aria-label', 'Perfiles');
            if (isCreating) {
                dotsContainer.style.display = 'none';
            }
            titleContainer.appendChild(dotsContainer);
            this.headerDotsContainer = dotsContainer;
            if (!isCreating) {
                this.updateHeaderTitleVisual();
            }
        } else {
            this.headerDotsContainer = undefined;
        }

        const rightBtns = document.createElement('div');
        rightBtns.className = 'hd-right popover-header-right';

        const starBtn = document.createElement('button');
        starBtn.type = 'button';
        const isFav = Boolean(this.state.isCurrentFavorite);
        starBtn.className = `ibtn popover-hdr-btn popover-star-btn ${isFav ? 'is-active is-fav-saved' : ''}`;
        setAccessibleTooltip(starBtn, isFav ? 'Quitar de favoritos' : 'Guardar en favoritos');
        starBtn.setAttribute('aria-pressed', String(isFav));
        starBtn.appendChild(createSvg(isFav ? ICONS.starOff : ICONS.star, { size: 18 }));
        if (isCreating) {
            starBtn.style.display = 'none';
        }

        starBtn.onclick = () => {
            if (this.callbacks.onToggleFavorite) {
                this.callbacks.onToggleFavorite();
            } else if (this.callbacks.onSaveFavorite) {
                this.callbacks.onSaveFavorite(0);
            }
            if (this.state.showingFavorites && this.favoritesDrawer) {
                const tool = this.state.tool as FavoritableTool;
                this.favoritesDrawer.update(tool, this.getToolFavorites(), this.getCurrentToolSlice());
            }
        };
        this.starBtn = starBtn;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'ibtn popover-hdr-btn popover-close-btn popover-close';
        setAccessibleTooltip(closeBtn, 'Cerrar');
        closeBtn.appendChild(createSvg(ICONS.close, { size: 16 }));
        closeBtn.onclick = () => this.close();

        rightBtns.append(starBtn, closeBtn);
        this.headerEl.append(hdLeft, titleContainer, rightBtns);
    }

    private renderSimpleHeader(titleText: string): void {
        const hdLeft = document.createElement('div');
        hdLeft.className = 'hd-left';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'hd-center popover-title-container popover-title-wrap';

        const title = document.createElement('h2');
        title.className = 'title popover-title';
        title.textContent = titleText;
        titleContainer.appendChild(title);
        this.titleEl = title;

        const rightBtns = document.createElement('div');
        rightBtns.className = 'hd-right popover-header-right';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'ibtn popover-hdr-btn popover-close-btn popover-close';
        setAccessibleTooltip(closeBtn, 'Cerrar');
        closeBtn.appendChild(createSvg(ICONS.close, { size: 16 }));
        closeBtn.onclick = () => this.close();

        rightBtns.appendChild(closeBtn);
        this.headerEl.append(hdLeft, titleContainer, rightBtns);
    }

    private renderPenContent(): void {
        const toolsRow = document.createElement('div');
        toolsRow.className = 'popover-tools-selector';
        toolsRow.setAttribute('role', 'radiogroup');
        toolsRow.setAttribute('aria-label', 'Punta de pluma');

        const penProfiles: Array<{ id: PenProfileId; label: string; iconD: string }> = [
            { id: 'fountain', label: 'Estilográfica', iconD: ICONS.pen },
            { id: 'calli', label: 'Caligráfica', iconD: ICONS.feather },
            { id: 'ball', label: 'Bolígrafo', iconD: ICONS.ballpoint },
            { id: 'pencil', label: 'Lápiz de mina', iconD: ICONS.pencil },
        ];

        for (const t of penProfiles) {
            const btn = document.createElement('button');
            btn.type = 'button';
            const isActive = this.state.profileId === t.id;
            btn.className = `tool-btn popover-tool-opt ${isActive ? 'is-active' : ''}`;
            btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:44px;min-height:44px;border-radius:14px;box-sizing:border-box;padding:8px';
            setAccessibleTooltip(btn, t.label);
            btn.setAttribute('aria-pressed', String(isActive));

            const wrap = document.createElement('div');
            wrap.className = 'icon-wrap';
            wrap.appendChild(createSvg(t.iconD, { size: 19, strokeWidth: 1.9 }));
            btn.appendChild(wrap);

            btn.onclick = () => {
                this.state.profileId = t.id;
                for (const [, b] of this.toolButtons) {
                    b.classList.remove('is-active');
                    b.setAttribute('aria-pressed', 'false');
                }
                btn.classList.add('is-active');
                btn.setAttribute('aria-pressed', 'true');
                this.callbacks.onSelectProfile(t.id);
            };

            this.toolButtons.set(t.id, btn);
            toolsRow.appendChild(btn);
        }
        this.bodyEl.appendChild(toolsRow);

        const widthSlider = this.createSlider('Grosor', this.state.width, 1, 20, 0.5, (val) => {
            this.state.width = val;
            this.callbacks.onChangeWidth(val);
        });
        this.widthInput = widthSlider.input;
        this.widthBubble = widthSlider.bubble;
        this.bodyEl.appendChild(widthSlider.element);

        const smoothingSlider = this.createSlider('Suavizado', Math.round(this.state.smoothing * 10), 0, 10, 1, (val) => {
            this.state.smoothing = val / 10;
            this.callbacks.onChangeSmoothing(this.state.smoothing);
        });
        this.smoothingInput = smoothingSlider.input;
        this.smoothingBubble = smoothingSlider.bubble;
        this.bodyEl.appendChild(smoothingSlider.element);

        this.bodyEl.appendChild(this.createLineStylesGrid((pattern) => {
            this.state.lineStyle = pattern;
            this.state.pattern = pattern;
            this.callbacks.onChangeLineStyle?.(pattern);
        }));

        const straightenRow = this.createToggleRow('Enderezar líneas', !!this.state.straightenLines, (checked) => {
            this.state.straightenLines = checked;
            this.callbacks.onToggleStraighten?.(checked);
        });
        this.straightenSwitch = (straightenRow as any).__switch as HTMLElement;
        this.bodyEl.appendChild(straightenRow);
        this.bodyEl.appendChild(this.createPaletteSection());
    }

    // =========================================================================
    // Highlighter Content
    // =========================================================================
    private createHighlighterStrokeSample(tipId: 'hlf' | 'hlr'): SVGSVGElement {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'hl-stroke-sample');
        svg.classList.add('hl-stroke-sample');
        svg.setAttribute('viewBox', '0 0 36 14');
        svg.setAttribute('aria-hidden', 'true');

        if (tipId === 'hlf') {
            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', '6,2 34,2 30,12 2,12');
            poly.setAttribute('fill', 'currentColor');
            poly.setAttribute('opacity', '0.32');

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', '6');
            line.setAttribute('y1', '2');
            line.setAttribute('x2', '2');
            line.setAttribute('y2', '12');
            line.setAttribute('stroke', 'currentColor');
            line.setAttribute('stroke-width', '1.6');

            svg.append(poly, line);
        } else {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', '6');
            line.setAttribute('y1', '7');
            line.setAttribute('x2', '30');
            line.setAttribute('y2', '7');
            line.setAttribute('stroke', 'currentColor');
            line.setAttribute('stroke-width', '9');
            line.setAttribute('stroke-linecap', 'round');
            line.setAttribute('opacity', '0.32');

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', '6');
            circle.setAttribute('cy', '7');
            circle.setAttribute('r', '4.5');
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', 'currentColor');
            circle.setAttribute('stroke-width', '1.3');

            svg.append(line, circle);
        }

        return svg;
    }

    private renderHighlighterContent(): void {
        this.container.style.setProperty('--hl-color', this.state.color);

        // 1. Selector de 2 Puntas simétrico (1fr 1fr) con muestra de trazo
        const toolsRow = document.createElement('div');
        toolsRow.className = 'hl-tip-grid';
        toolsRow.setAttribute('role', 'radiogroup');
        toolsRow.setAttribute('aria-label', 'Tipo de punta de marcador');
        const activeTip: PenProfileId =
            this.state.profileId === 'hlf' || this.state.profileId === 'hlr' ? this.state.profileId : 'hlf';

        const tips: Array<{ id: PenProfileId; label: string; fullLabel: string; iconD: string }> = [
            { id: 'hlf', label: 'Biselado', fullLabel: 'Marcador Biselado', iconD: ICONS.highlighterChisel },
            { id: 'hlr', label: 'Redondo', fullLabel: 'Marcador Redondo', iconD: ICONS.highlighterRound },
        ];

        for (const t of tips) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('role', 'radio');
            const isActive = activeTip === t.id;
            btn.className = `hl-tip-btn ${isActive ? 'is-active' : ''}`;
            btn.dataset.tip = t.id;
            btn.setAttribute('aria-checked', String(isActive));
            btn.setAttribute('aria-pressed', String(isActive));
            setAccessibleTooltip(btn, t.fullLabel);

            // Left side: icon + label
            const left = document.createElement('span');
            left.className = 'hl-tip-left';
            left.appendChild(createSvg(t.iconD, { size: 18, strokeWidth: 1.8 }));
            const lbl = document.createElement('span');
            lbl.textContent = t.label;
            left.appendChild(lbl);

            // Right side: stroke sample
            const sampleSvg = this.createHighlighterStrokeSample(t.id as 'hlf' | 'hlr');

            btn.append(left, sampleSvg);

            btn.onclick = () => {
                this.state.profileId = t.id;
                for (const [, b] of this.toolButtons) {
                    b.classList.remove('is-active');
                    b.setAttribute('aria-checked', 'false');
                    b.setAttribute('aria-pressed', 'false');
                }
                btn.classList.add('is-active');
                btn.setAttribute('aria-checked', 'true');
                btn.setAttribute('aria-pressed', 'true');
                this.callbacks.onSelectProfile(t.id);
            };

            this.toolButtons.set(t.id, btn);
            toolsRow.appendChild(btn);
        }
        this.bodyEl.appendChild(toolsRow);

        // 2. Slider Grosor (4 to 60 px)
        const widthSlider = this.createSlider(
            'Grosor',
            this.state.width,
            4,
            60,
            1,
            (val) => {
                this.state.width = val;
                this.callbacks.onChangeWidth(val);
            }
        );
        this.widthInput = widthSlider.input;
        this.widthBubble = widthSlider.bubble;
        this.bodyEl.appendChild(widthSlider.element);

        // 3. Slider Opacidad (10% to 100%)
        const opacitySlider = this.createSlider(
            'Opacidad',
            this.getOpacityPercent(),
            10,
            100,
            5,
            (val) => {
                this.state.opacity = val;
                this.state.pressureSensitivity = val / 100;
                this.callbacks.onChangeOpacity?.(val);
            },
            true
        );
        this.opacityInput = opacitySlider.input;
        this.opacityBubble = opacitySlider.bubble;
        this.bodyEl.appendChild(opacitySlider.element);

        // 4. Toggle Row: "Enderezar líneas"
        const straightenRow = this.createToggleRow(
            'Enderezar líneas',
            !!this.state.straightenLines,
            (checked) => {
                this.state.straightenLines = checked;
                this.callbacks.onToggleStraighten?.(checked);
            }
        );
        this.straightenSwitch = (straightenRow as any).__switch as HTMLElement;
        this.bodyEl.appendChild(straightenRow);

        // 5. Paleta de Colores
        this.bodyEl.appendChild(this.createPaletteSection());
    }

    private createRadioModeList<T extends string>(
        modes: Array<{ id: T; label: string }>,
        activeId: T,
        buttonMap: Map<string, HTMLElement>,
        onSelect: (id: T) => void,
    ): HTMLElement {
        const modesList = document.createElement('div');
        modesList.className = 'eraser-modes-list';
        for (const m of modes) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `eraser-radio-row ${activeId === m.id ? 'is-active' : ''}`;
            const circle = document.createElement('div');
            circle.className = 'eraser-radio-circle';
            const dot = document.createElement('div');
            dot.className = 'eraser-radio-inner-dot';
            circle.appendChild(dot);
            const span = document.createElement('span');
            span.textContent = m.label;
            row.append(circle, span);
            row.onclick = () => {
                for (const [, r] of buttonMap) r.classList.remove('is-active');
                row.classList.add('is-active');
                onSelect(m.id);
            };
            buttonMap.set(m.id, row);
            modesList.appendChild(row);
        }
        return modesList;
    }

    private renderEraserContent(): void {
        this.bodyEl.appendChild(this.createRadioModeList<EraserMode>(
            [
                { id: 'whole', label: 'Borrar trazo completo' },
                { id: 'reticle', label: 'Borrar por área (retícula)' },
            ],
            this.state.eraserMode,
            this.eraserModeButtons,
            (id) => {
                this.state.eraserMode = id;
                this.callbacks.onSelectEraserMode(id);
            },
        ));

        const divider = document.createElement('div');
        divider.className = 'eraser-divider';
        this.bodyEl.appendChild(divider);

        const radiusSlider = this.createSlider('Tamaño del borrador', this.state.eraserRadius, 8, 60, 2, (val) => {
            this.state.eraserRadius = val;
            this.callbacks.onChangeEraserRadius(val);
            if (this.eraserPreviewDot) {
                const dotSize = Math.max(12, Math.min(36, val * 0.7));
                this.eraserPreviewDot.style.width = `${dotSize}px`;
                this.eraserPreviewDot.style.height = `${dotSize}px`;
            }
        });
        this.eraserRadiusInput = radiusSlider.input;
        this.eraserRadiusBubble = radiusSlider.bubble;
        this.bodyEl.appendChild(radiusSlider.element);

        const onlyHighlighterRow = this.createToggleRow('Borrar resaltador solamente', !!this.state.onlyHighlighter, (checked) => {
            this.state.onlyHighlighter = checked;
            this.callbacks.onToggleOnlyHighlighter?.(checked);
        });
        this.onlyHighlighterSwitch = (onlyHighlighterRow as any).__switch as HTMLElement;
        this.bodyEl.appendChild(onlyHighlighterRow);

        const scribbleRow = this.createToggleRow('Garabato para borrar', this.state.scribbleToErase, (checked) => {
            this.state.scribbleToErase = checked;
            this.callbacks.onToggleScribble(checked);
        });
        this.scribbleSwitch = (scribbleRow as any).__switch as HTMLElement;
        this.bodyEl.appendChild(scribbleRow);
    }

    private renderShapeContent(): void {
        this.shapeButtons.clear();
        this.shapeLineOptionButtons.clear();
        this.shapeFillPatternButtons.clear();
        this.shapeSubFillButtons.clear();
        this.shapeOpenTray = '';

        // 1. Shapes Registry & Carousel (Pages of 5 with scroll-snap)
        const baseShapes: Array<{ type: ShapeType; label: string; iconD?: string; iconPaths?: readonly string[] }> = [
            { type: 'line', label: 'Línea', iconD: ICONS.shapes.line },
            { type: 'arrow', label: 'Flecha', iconD: ICONS.shapes.arrow },
            { type: 'rect', label: 'Rectángulo', iconD: ICONS.shapes.rect },
            { type: 'ellipse', label: 'Círculo', iconD: ICONS.shapes.circle },
            { type: 'triangle', label: 'Triángulo', iconD: ICONS.shapes.triangle },
        ];

        const customPlugins = listShapePlugins().filter((p) => {
            const id = p.id;
            return id !== 'line' && id !== 'arrow' && id !== 'rectangle' && id !== 'rect' &&
                   id !== 'rounded-rect' && id !== 'ellipse' && id !== 'circle' && id !== 'triangle';
        });

        const customShapes = customPlugins.map((p) => ({
            type: p.id as ShapeType,
            label: p.name,
            iconD: undefined,
            iconPaths: p.iconSvgPaths,
        }));

        const shapePages: Array<Array<{ type: ShapeType; label: string; iconD?: string; iconPaths?: readonly string[] }>> = [baseShapes];
        for (let i = 0; i < customShapes.length; i += 5) {
            shapePages.push(customShapes.slice(i, i + 5));
        }

        const activeShape = this.state.shapeType || 'rect';
        const isShapeActive = (defType: string) =>
            defType === activeShape ||
            (defType === 'rect' && (activeShape as string) === 'rectangle') ||
            (defType === 'ellipse' && (activeShape as string) === 'circle');

        const carouselWrap = document.createElement('div');
        carouselWrap.style.width = '100%';

        const car = document.createElement('div');
        car.className = 'car';
        if (shapePages.length <= 1) {
            car.style.overflowX = 'hidden';
            car.style.touchAction = 'manipulation';
        }
        this.shapeCarouselEl = car;

        for (let pIdx = 0; pIdx < shapePages.length; pIdx++) {
            const page = shapePages[pIdx];
            const pgs = document.createElement('div');
            pgs.className = `pgs ${pIdx === 0 ? 'shape-grid shape-grid-selector' : ''}`.trim();
            pgs.setAttribute('role', 'radiogroup');
            pgs.setAttribute('aria-label', pIdx === 0 ? 'Formas base' : `Formas personalizadas página ${pIdx + 1}`);

            for (const shape of page) {
                const btn = document.createElement('button');
                btn.type = 'button';
                const isActive = isShapeActive(shape.type);
                btn.className = `sb shape-btn ${isActive ? 'on is-active' : ''}`.trim();
                btn.style.touchAction = 'manipulation';
                btn.setAttribute('role', 'radio');
                btn.setAttribute('aria-checked', String(isActive));
                btn.setAttribute('aria-pressed', String(isActive));
                btn.setAttribute('data-s', shape.type);
                setAccessibleTooltip(btn, shape.label);

                if (shape.iconPaths && shape.iconPaths.length > 0) {
                    btn.appendChild(createSvg(shape.iconPaths.join(' '), { size: 20, strokeWidth: 1.8 }));
                } else if (shape.iconD) {
                    btn.appendChild(createSvg(shape.iconD, { size: 20, strokeWidth: 1.8 }));
                }

                bindTapOrClick(btn, () => {
                    this.state.shapeType = shape.type;
                    for (const [t, b] of this.shapeButtons) {
                        const active = isShapeActive(t);
                        b.classList.toggle('on', active);
                        b.classList.toggle('is-active', active);
                        b.setAttribute('aria-checked', String(active));
                        b.setAttribute('aria-pressed', String(active));
                    }
                    this.callbacks.onSelectShapeType(shape.type);
                });

                this.shapeButtons.set(shape.type, btn);
                pgs.appendChild(btn);
            }

            for (let j = page.length; j < 5; j++) {
                const spacer = document.createElement('i');
                pgs.appendChild(spacer);
            }

            car.appendChild(pgs);
        }

        const pager = document.createElement('div');
        pager.className = 'pager';
        if (shapePages.length <= 1) {
            pager.style.display = 'none';
        }
        this.shapePagerEl = pager;

        const updatePagerVisual = () => {
            const pageIndex = Math.round(car.scrollLeft / Math.max(1, car.clientWidth));
            this.updateShapePager(pageIndex, shapePages.length);
        };

        car.addEventListener('scroll', updatePagerVisual, { passive: true });
        carouselWrap.append(car, pager);
        this.bodyEl.appendChild(carouselWrap);
        this.updateShapePager(0, shapePages.length);

        let activePageIdx = 0;
        for (let pIdx = 0; pIdx < shapePages.length; pIdx++) {
            if (shapePages[pIdx].some((s) => isShapeActive(s.type))) {
                activePageIdx = pIdx;
                break;
            }
        }
        if (activePageIdx > 0) {
            requestAnimationFrame(() => {
                car.scrollLeft = activePageIdx * car.clientWidth;
                this.updateShapePager(activePageIdx, shapePages.length);
            });
        }

        // 2. Slider de grosor (1–12) con − y +
        this.widthSliderControl = new SliderControl({
            min: 1,
            max: 12,
            step: 0.5,
            value: this.state.width,
            variant: 'default',
            ariaLabel: 'Grosor de trazo',
            onChange: (val) => {
                this.state.width = val;
                this.callbacks.onChangeWidth(val);
            },
        });
        this.bodyEl.appendChild(this.widthSliderControl.element);

        // 3. Barra de 3 controles [Línea ▾] [Relleno ▾] [1:1]
        const controlsGroup = document.createElement('div');
        controlsGroup.style.width = '100%';

        const bar = document.createElement('div');
        bar.className = 'bar';

        // 3.1 Línea (gaveta 3 opciones)
        const lineBtn = document.createElement('button');
        lineBtn.type = 'button';
        lineBtn.className = 'pb';
        lineBtn.style.touchAction = 'manipulation';
        lineBtn.setAttribute('data-tb', 'line');
        setAccessibleTooltip(lineBtn, 'Tipo de línea');
        this.shapeLineBtn = lineBtn;

        this.shapeLineGlyphContainer = document.createElement('span');
        this.shapeLineGlyphContainer.style.display = 'inline-flex';
        this.shapeLineGlyphContainer.style.alignItems = 'center';
        lineBtn.appendChild(this.shapeLineGlyphContainer);

        const lineCaret = createSvg(ICONS.caret, { size: 9, strokeWidth: 1.7 });
        lineCaret.setAttribute('class', 'car-t');
        lineBtn.appendChild(lineCaret);

        bindTapOrClick(lineBtn, () => {
            this.toggleShapeTray('line');
        });

        // 3.2 Relleno (gaveta 5 chips, densidad, color)
        const fillBtn = document.createElement('button');
        fillBtn.type = 'button';
        fillBtn.className = 'pb';
        fillBtn.style.touchAction = 'manipulation';
        fillBtn.setAttribute('data-tb', 'fill');
        setAccessibleTooltip(fillBtn, 'Relleno de forma');
        this.shapeFillBtn = fillBtn;

        this.shapeFillGlyphContainer = document.createElement('span');
        this.shapeFillGlyphContainer.className = 'fgw';
        this.shapeFillGlyphContainer.style.display = 'inline-flex';
        this.shapeFillGlyphContainer.style.alignItems = 'center';
        fillBtn.appendChild(this.shapeFillGlyphContainer);

        const fillCaret = createSvg(ICONS.caret, { size: 9, strokeWidth: 1.7 });
        fillCaret.setAttribute('class', 'car-t');
        fillBtn.appendChild(fillCaret);

        bindTapOrClick(fillBtn, () => {
            this.toggleShapeTray('fill');
        });

        // 3.3 1:1 = Formas perfectas (toggle directo)
        const ratioBtn = document.createElement('button');
        ratioBtn.type = 'button';
        const isPerfect = Boolean(this.state.regularize);
        ratioBtn.className = `pb tg ${isPerfect ? 'on' : ''}`;
        ratioBtn.style.touchAction = 'manipulation';
        setAccessibleTooltip(ratioBtn, 'Formas perfectas (1:1 / 45°)');
        ratioBtn.appendChild(createSvg(ICONS.ratio, { size: 18, strokeWidth: 1.8 }));
        this.shapeRegularizeBtn = ratioBtn;

        bindTapOrClick(ratioBtn, () => {
            this.state.regularize = !this.state.regularize;
            ratioBtn.classList.toggle('on', this.state.regularize);
            this.callbacks.onToggleRegularize?.(this.state.regularize);
        });

        bar.append(lineBtn, fillBtn, ratioBtn);

        // 4. Gavetas de acordeón
        // 4.1 Gaveta de Línea
        const lineTray = document.createElement('div');
        lineTray.className = 'tray';
        lineTray.setAttribute('data-t', 'line');
        this.shapeLineTray = lineTray;

        const lineTrayInner = document.createElement('div');
        const lineBox = document.createElement('div');
        lineBox.className = 'box';

        const lineG3 = document.createElement('div');
        lineG3.className = 'g3';
        lineG3.setAttribute('role', 'radiogroup');
        lineG3.setAttribute('aria-label', 'Estilo de línea');

        const lineStyles: Array<{ pattern: StrokePattern; label: string; index: number }> = [
            { pattern: 'solid', label: 'Continua', index: 0 },
            { pattern: 'dashed', label: 'Guiones', index: 1 },
            { pattern: 'dotted', label: 'Puntos', index: 2 },
        ];

        const currentLineStyle = this.state.pattern || this.state.lineStyle || 'solid';

        for (const item of lineStyles) {
            const cc = document.createElement('button');
            cc.type = 'button';
            const isActive = currentLineStyle === item.pattern;
            cc.className = `cc ${isActive ? 'on' : ''}`;
            cc.style.touchAction = 'manipulation';
            cc.setAttribute('role', 'radio');
            cc.setAttribute('aria-checked', String(isActive));
            setAccessibleTooltip(cc, item.label);
            cc.appendChild(this.createLineOptionSvg(item.index));

            bindTapOrClick(cc, () => {
                this.state.pattern = item.pattern;
                this.state.lineStyle = item.pattern;
                this.callbacks.onChangeLineStyle?.(item.pattern);
                this.updateShapeLineVisual();
                this.toggleShapeTray(''); // Auto-close line drawer on selection per mockup
            });

            this.shapeLineOptionButtons.set(item.pattern, cc);
            lineG3.appendChild(cc);
        }

        lineBox.appendChild(lineG3);
        lineTrayInner.appendChild(lineBox);
        lineTray.appendChild(lineTrayInner);

        // 4.2 Gaveta de Relleno
        const fillTray = document.createElement('div');
        fillTray.className = 'tray';
        fillTray.setAttribute('data-t', 'fill');
        this.shapeFillTray = fillTray;

        const fillTrayInner = document.createElement('div');
        const fillBox = document.createElement('div');
        fillBox.className = 'box';

        const fillG5 = document.createElement('div');
        fillG5.className = 'g5';
        fillG5.setAttribute('role', 'radiogroup');
        fillG5.setAttribute('aria-label', 'Patrón de relleno');

        const patterns: Array<{ id: ShapeFillPattern | 'off'; label: string }> = [
            { id: 'off', label: 'Sin relleno' },
            { id: 'solid', label: 'Sólido' },
            { id: 'hachure', label: 'Diagonal' },
            { id: 'cross-hatch', label: 'Cruzado' },
            { id: 'dots', label: 'Punteado' },
        ];

        const activeFillPattern: ShapeFillPattern | 'off' = !this.state.fillEnabled
            ? 'off'
            : (this.state.fillPattern ?? 'solid');

        for (const pat of patterns) {
            const cc = document.createElement('button');
            cc.type = 'button';
            const isActive = activeFillPattern === pat.id;
            cc.className = `cc ${pat.id === 'off' ? 'off' : ''} ${isActive ? 'on' : ''}`;
            cc.style.touchAction = 'manipulation';
            cc.setAttribute('role', 'radio');
            cc.setAttribute('aria-checked', String(isActive));
            setAccessibleTooltip(cc, pat.label);
            cc.appendChild(createFillGlyph(pat.id, 3, `tray-chip-${pat.id}`));

            bindTapOrClick(cc, () => {
                if (pat.id === 'off') {
                    this.state.fillEnabled = false;
                    this.callbacks.onToggleFillEnabled?.(false);
                } else {
                    this.state.fillEnabled = true;
                    this.state.fillPattern = pat.id;
                    this.callbacks.onToggleFillEnabled?.(true);
                    this.callbacks.onChangeFillPattern?.(pat.id);
                }
                this.updateShapeFillGlyphs();
            });

            this.shapeFillPatternButtons.set(pat.id, cc);
            fillG5.appendChild(cc);
        }
        fillBox.appendChild(fillG5);

        // Slider de densidad (variante pequeña sm, 5 niveles)
        const densSection = document.createElement('div');
        const showDensity = Boolean(
            this.state.fillEnabled &&
            ['hachure', 'cross-hatch', 'dots'].includes(this.state.fillPattern ?? 'solid')
        );
        densSection.className = `dens ${showDensity ? 'show' : ''}`;
        this.shapeDensitySection = densSection;

        const densInner = document.createElement('div');
        this.shapeDensitySlider = new SliderControl({
            min: 1,
            max: 5,
            step: 1,
            value: this.state.fillDensity ?? 3,
            variant: 'sm',
            ariaLabel: 'Densidad de trama',
            onChange: (val) => {
                this.state.fillDensity = val;
                this.callbacks.onChangeFillDensity?.(val);
                this.updateShapeFillGlyphs();
            },
        });
        densInner.appendChild(this.shapeDensitySlider.element);
        densSection.appendChild(densInner);
        fillBox.appendChild(densSection);

        // Fila subordinada de color de relleno (muestras 20px + '+')
        const subFillRow = document.createElement('div');
        subFillRow.className = 'sr pf';
        subFillRow.setAttribute('role', 'radiogroup');
        subFillRow.setAttribute('aria-label', 'Color de relleno');
        this.shapeSubFillRowEl = subFillRow;
        this.renderShapeSubFillSwatches();
        fillBox.appendChild(subFillRow);

        fillTrayInner.appendChild(fillBox);
        fillTray.appendChild(fillTrayInner);

        controlsGroup.append(bar, lineTray, fillTray);
        this.bodyEl.appendChild(controlsGroup);

        this.updateShapeLineVisual();
        this.updateShapeFillGlyphs();

        // 5. Fila de color del trazo con '+' y pager con reloj
        this.bodyEl.appendChild(this.createPaletteSection());
    }

    private createLineOptionSvg(patternIndex: number): SVGSVGElement {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'ln');
        svg.setAttribute('viewBox', '0 0 64 10');
        svg.setAttribute('aria-hidden', 'true');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '6');
        line.setAttribute('y1', '5');
        line.setAttribute('x2', '58');
        line.setAttribute('y2', '5');
        if (patternIndex === 1) {
            line.setAttribute('stroke-dasharray', '7 6');
        } else if (patternIndex === 2) {
            line.setAttribute('stroke-dasharray', '0.1 6.5');
        }
        svg.appendChild(line);
        return svg;
    }

    private updateShapePager(pageIndex: number, totalPages: number): void {
        if (!this.shapePagerEl) return;
        this.shapePagerEl.replaceChildren();
        if (totalPages <= 1) {
            this.shapePagerEl.style.display = 'none';
            return;
        }
        this.shapePagerEl.style.display = 'flex';

        if (totalPages <= 6) {
            for (let i = 0; i < totalPages; i++) {
                const dot = document.createElement('button');
                dot.type = 'button';
                dot.className = `dot ${i === pageIndex ? 'on' : ''}`;
                dot.style.touchAction = 'manipulation';
                setAccessibleTooltip(dot, `Página ${i + 1}`);
                bindTapOrClick(dot, () => {
                    if (this.shapeCarouselEl) {
                        this.shapeCarouselEl.scrollTo({ left: i * this.shapeCarouselEl.clientWidth, behavior: 'smooth' });
                    }
                });
                this.shapePagerEl.appendChild(dot);
            }
        } else {
            const start = Math.max(0, Math.min(totalPages - 5, pageIndex - 2));
            const end = start + 5;
            for (let i = start; i < end; i++) {
                const dot = document.createElement('button');
                dot.type = 'button';
                const isOn = i === pageIndex;
                const isEdge = i === start || i === end - 1;
                dot.className = `dot ${isOn ? 'on' : ''} ${isEdge && !isOn ? 'dimmed' : ''}`.trim();
                dot.style.touchAction = 'manipulation';
                setAccessibleTooltip(dot, `Página ${i + 1}`);
                bindTapOrClick(dot, () => {
                    if (this.shapeCarouselEl) {
                        this.shapeCarouselEl.scrollTo({ left: i * this.shapeCarouselEl.clientWidth, behavior: 'smooth' });
                    }
                });
                this.shapePagerEl.appendChild(dot);
            }
        }
    }

    private toggleShapeTray(tray: 'line' | 'fill' | ''): void {
        this.shapeOpenTray = this.shapeOpenTray === tray ? '' : tray;
        this.shapeLineBtn?.classList.toggle('open', this.shapeOpenTray === 'line');
        this.shapeFillBtn?.classList.toggle('open', this.shapeOpenTray === 'fill');
        this.shapeLineTray?.classList.toggle('open', this.shapeOpenTray === 'line');
        this.shapeFillTray?.classList.toggle('open', this.shapeOpenTray === 'fill');
    }

    private updateShapeLineVisual(): void {
        const pattern = this.state.pattern || this.state.lineStyle || 'solid';
        if (this.shapeLineGlyphContainer) {
            const iconD = pattern === 'dashed' ? ICONS.lineDashed : pattern === 'dotted' ? ICONS.lineDotted : ICONS.lineSolid;
            this.shapeLineGlyphContainer.replaceChildren(createSvg(iconD, { size: 18, strokeWidth: 2 }));
        }
        for (const [pat, btn] of this.shapeLineOptionButtons) {
            const active = pat === pattern;
            btn.classList.toggle('on', active);
            btn.setAttribute('aria-checked', String(active));
        }
    }

    private updateShapeFillGlyphs(): void {
        const fillActive = Boolean(this.state.fillEnabled);
        const pat: ShapeFillPattern | 'off' = fillActive ? (this.state.fillPattern ?? 'solid') : 'off';
        const dens = this.state.fillDensity ?? 3;
        const col = this.state.fillColor || this.state.color || '#2f6bff';

        this.container.style.setProperty('--fc', col);

        if (this.shapeFillBtn) {
            this.shapeFillBtn.classList.toggle('hf', fillActive);
        }
        if (this.shapeFillGlyphContainer) {
            this.shapeFillGlyphContainer.replaceChildren(createFillGlyph(pat, dens, 'bar-fill-glyph'));
        }

        for (const [id, btn] of this.shapeFillPatternButtons) {
            const isActive = id === pat;
            btn.classList.toggle('on', isActive);
            btn.setAttribute('aria-checked', String(isActive));
        }

        const showDensity = fillActive && ['hachure', 'cross-hatch', 'dots'].includes(pat);
        this.shapeDensitySection?.classList.toggle('show', showDensity);
        this.shapeDensitySlider?.setValue(dens, false);

        this.renderShapeSubFillSwatches();
    }

    private renderShapeSubFillSwatches(): void {
        if (!this.shapeSubFillRowEl) return;
        this.shapeSubFillRowEl.replaceChildren();
        this.shapeSubFillButtons.clear();

        const activeColor = (this.state.fillColor || this.state.color).toUpperCase();
        const colors = (this.colorPages[0] || this.recentColors).slice(0, 7);

        for (const col of colors) {
            const sw = document.createElement('button');
            sw.type = 'button';
            const isActive = activeColor === col.toUpperCase();
            sw.className = `sw ${isActive ? 'on' : ''}`;
            sw.style.touchAction = 'manipulation';
            sw.style.setProperty('--c', col);
            setAccessibleTooltip(sw, `Color de relleno ${col}`);

            bindTapOrClick(sw, () => {
                this.state.fillColor = col;
                this.callbacks.onChangeFillColor?.(col);
                this.updateShapeFillGlyphs();
            });

            this.shapeSubFillButtons.set(col, sw);
            this.shapeSubFillRowEl.appendChild(sw);
        }

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'ad';
        addBtn.style.touchAction = 'manipulation';
        setAccessibleTooltip(addBtn, 'Personalizar color de relleno');
        addBtn.appendChild(createSvg(ICONS.plus, { size: 14, strokeWidth: 2 }));

        bindTapOrClick(addBtn, (e) => {
            e?.stopPropagation();
            const toolbarEl = (this.currentAnchorEl?.closest?.('.apolo-canvas-toolbar') as HTMLElement) || this.currentAnchorEl?.parentElement || null;
            this.colorPicker.open(
                addBtn,
                this.state.slot,
                toolbarEl,
                this.state.fillColor || this.state.color,
                (newColor) => {
                    this.state.fillColor = newColor;
                    this.callbacks.onChangeFillColor?.(newColor);
                    this.updateShapeFillGlyphs();
                },
                null,
                100,
            );
        });

        this.shapeSubFillRowEl.appendChild(addBtn);
    }

    private renderLassoContent(): void {
        this.bodyEl.appendChild(this.createRadioModeList<LassoMode>(
            [
                { id: 'free', label: 'Lazo libre' },
                { id: 'rect', label: 'Lazo rectangular' },
            ],
            this.state.lassoMode,
            this.lassoModeButtons,
            (id) => {
                this.state.lassoMode = id;
                this.callbacks.onSelectLassoMode(id);
            },
        ));
    }

    // =========================================================================
    // Common UI Builders (Mockup 1:1)
    // =========================================================================
    private createSlider(
        label: string,
        currentVal: number,
        min: number,
        max: number,
        step: number,
        onChange: (val: number) => void,
        isOpacity = false
    ): { element: HTMLElement; input: HTMLInputElement; bubble: HTMLElement } {
        const wrap = document.createElement('div');
        wrap.className = 'control-group popover-slider-section';

        const lbl = document.createElement('span');
        lbl.className = 'section-label popover-slider-label';
        lbl.textContent = label;
        wrap.appendChild(lbl);

        const row = document.createElement('div');
        row.className = 'slider-row popover-slider-row';

        const minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.className = 'slider-step popover-step-btn';
        setAccessibleTooltip(minusBtn, `Disminuir ${label.toLowerCase()}`);
        minusBtn.appendChild(createSvg(ICONS.minus, { size: 14 }));

        const track = document.createElement('div');
        track.className = `slider-track popover-track-wrap${isOpacity ? ' opacity-track' : ''}`;

        const fill = document.createElement('div');
        fill.className = 'slider-fill';

        if (isOpacity) {
            track.style.setProperty('--hl-color', this.state.color);
            const gradLayer = document.createElement('div');
            gradLayer.className = 'opacity-gradient-layer';
            track.appendChild(gradLayer);
        } else {
            track.appendChild(fill);
        }

        const bubble = document.createElement('div');
        bubble.className = 'slider-thumb popover-bubble-val';
        bubble.textContent = String(currentVal);

        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'popover-range-native';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(currentVal);
        input.setAttribute('aria-label', label);
        input.style.width = '100%';
        input.style.minWidth = '0';
        input.style.maxWidth = 'none';
        input.style.flex = '1 1 100%';
        track.append(input, bubble);

        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.className = 'slider-step popover-step-btn';
        setAccessibleTooltip(plusBtn, `Aumentar ${label.toLowerCase()}`);
        plusBtn.appendChild(createSvg(ICONS.plus, { size: 14 }));

        row.append(minusBtn, track, plusBtn);
        wrap.appendChild(row);

        const updateVal = (val: number, notify = true) => {
            val = Math.max(min, Math.min(max, val));
            if (step < 1) val = Math.round(val * 10) / 10;
            input.value = String(val);
            bubble.textContent = String(val);
            const ratio = Math.max(0, Math.min(1, (val - min) / (max - min)));
            const pct = `${(ratio * 100).toFixed(1)}%`;
            track.style.setProperty('--val', pct);
            bubble.style.left = `calc(${ratio * 100}% - ${ratio * 24}px)`;
            if (!isOpacity) {
                fill.style.width = pct;
            }
            if (notify) onChange(val);
        };

        input.oninput = () => updateVal(Number(input.value));
        minusBtn.onclick = () => {
            let next = Number(input.value) - step;
            if (step < 1) next = Math.round(next * 10) / 10;
            updateVal(next);
        };
        plusBtn.onclick = () => {
            let next = Number(input.value) + step;
            if (step < 1) next = Math.round(next * 10) / 10;
            updateVal(next);
        };

        setTimeout(() => updateVal(currentVal, false), 0);

        return { element: wrap, input, bubble };
    }

    private createLineStylesGrid(onSelect?: (pattern: StrokePattern) => void): HTMLElement {
        const stylesRow = document.createElement('div');
        stylesRow.className = 'line-grid popover-lines-grid';
        stylesRow.setAttribute('role', 'radiogroup');
        stylesRow.setAttribute('aria-label', 'Estilo de línea');

        const styles: Array<{ id: StrokePattern; cls: string; label: string }> = [
            { id: 'solid', cls: '', label: 'Línea continua' },
            { id: 'dashed', cls: 'is-dashed', label: 'Línea discontinua' },
            { id: 'dotted', cls: 'is-dotted', label: 'Línea punteada' },
        ];
        const activePattern = this.state.lineStyle ?? this.state.pattern ?? 'solid';

        for (const s of styles) {
            const btn = document.createElement('button');
            btn.type = 'button';
            const isActive = s.id === activePattern;
            btn.className = `line-chip popover-line-chip ${isActive ? 'is-active' : ''}`;
            btn.setAttribute('aria-pressed', String(isActive));
            btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:38px;min-height:38px;border-radius:12px;box-sizing:border-box;padding:0 12px';
            setAccessibleTooltip(btn, s.label);

            const pill = document.createElement('span');
            pill.className = 'popover-line-chip-pill';
            pill.setAttribute('aria-hidden', 'true');
            pill.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%';

            const bar = document.createElement('div');
            bar.className = `popover-line-bar ${s.cls}`;
            pill.appendChild(bar);
            btn.appendChild(pill);

            btn.onclick = () => {
                for (const [pattern, lineStyleButton] of this.lineStyleChips) {
                    const isActive = pattern === s.id;
                    lineStyleButton.classList.toggle('is-active', isActive);
                    lineStyleButton.setAttribute('aria-pressed', String(isActive));
                }
                this.state.lineStyle = s.id;
                this.state.pattern = s.id;
                onSelect?.(s.id);
            };

            this.lineStyleChips.set(s.id, btn);
            stylesRow.appendChild(btn);
        }

        return stylesRow;
    }

    private createToggleRow(title: string, initialChecked: boolean, onToggle?: (checked: boolean) => void): HTMLElement {
        const toggleRow = document.createElement('label');
        toggleRow.className = 'toggle-row popover-toggle-row';
        toggleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;width:100%';

        const tTitle = document.createElement('span');
        tTitle.className = 'toggle-label popover-toggle-title';
        tTitle.textContent = title;
        tTitle.style.flex = '1';

        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = `switch popover-switch ${initialChecked ? 'is-on is-checked' : ''}`;
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-checked', String(initialChecked));
        sw.style.cssText = 'position:relative;display:inline-block;width:40px;height:22px;flex-shrink:0';
        setAccessibleTooltip(sw, title);

        const thumb = document.createElement('span');
        thumb.className = 'popover-switch-thumb';
        thumb.style.cssText = 'position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#ffffff;pointer-events:none';
        thumb.style.transform = initialChecked ? 'translateX(18px)' : 'none';
        sw.appendChild(thumb);

        sw.onclick = (e) => {
            e?.preventDefault?.();
            const next = !sw.classList.contains('is-checked') && !sw.classList.contains('is-on');
            sw.classList.toggle('is-checked', next);
            sw.classList.toggle('is-on', next);
            sw.setAttribute('aria-checked', String(next));
            thumb.style.transform = next ? 'translateX(18px)' : 'none';
            onToggle?.(next);
        };

        (toggleRow as any).__switch = sw;
        toggleRow.append(tTitle, sw);
        return toggleRow;
    }

    private createPaletteSection(): HTMLElement {
        const colSection = document.createElement('div');
        colSection.className = 'palette-block popover-palette-section';

        this.swatchRowEl = document.createElement('div');
        this.swatchRowEl.className = 'swatch-row popover-swatches-row';
        this.swatchRowEl.onwheel = (e) => {
            e.preventDefault();
            this.changeColorPage(e.deltaY > 0 ? 1 : -1);
        };

        this.paginationEl = document.createElement('nav');
        this.paginationEl.className = 'palette-footer popover-pagination pager';
        this.paginationEl.setAttribute('aria-label', 'Páginas de colores');

        colSection.append(this.swatchRowEl, this.paginationEl);
        this.updateColorsUI();

        return colSection;
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
        this.swatchButtons.clear();

        const colors = this.colorPages[this.currentPageIndex] || this.recentColors;
        const visibleColors = colors.slice(0, 8);

        for (const col of visibleColors) {
            const sw = document.createElement('button');
            sw.type = 'button';
            const isActive = this.state.color.toUpperCase() === col.toUpperCase();
            sw.className = `swatch popover-swatch-circle ${isActive ? 'is-active' : ''}`;
            sw.style.touchAction = 'manipulation';
            setAccessibleTooltip(sw, `Color ${col}`);
            sw.style.backgroundColor = col;
            sw.style.setProperty('--c', col);
            sw.style.setProperty('--swatch-color', col);

            const inner = document.createElement('span');
            inner.className = 'popover-swatch-inner';
            inner.style.backgroundColor = col;
            sw.appendChild(inner);

            bindTapOrClick(sw, () => {
                this.state.color = col;
                this.pushRecentColor(col);
                for (const [, s] of this.swatchButtons) s.classList.remove('is-active');
                sw.classList.add('is-active');
                this.container.style.setProperty('--hl-color', col);
                if (this.opacityInput?.parentElement) {
                    this.opacityInput.parentElement.style.setProperty('--hl-color', col);
                }
                this.callbacks.onChangeColor(col);
            });

            this.swatchButtons.set(col, sw);
            this.swatchRowEl.appendChild(sw);
        }

        // Circular "+" button (opens ColorPickerPopover)
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'swatch-add popover-color-add';
        addBtn.style.touchAction = 'manipulation';
        addBtn.setAttribute('data-apolo-popover-trigger', 'true');
        setAccessibleTooltip(addBtn, 'Personalizar color');
        addBtn.appendChild(createSvg(ICONS.plus, { size: 14, strokeWidth: 2 }));

        bindTapOrClick(addBtn, (e) => {
            e?.stopPropagation();
            const toolbarEl = (this.currentAnchorEl?.closest?.('.apolo-canvas-toolbar') as HTMLElement) || this.currentAnchorEl?.parentElement || null;
            this.colorPicker.open(
                addBtn,
                this.state.slot,
                toolbarEl,
                this.state.color,
                (newColor, opacity) => {
                    this.state.color = newColor;
                    this.state.opacity = opacity;
                    this.state.pressureSensitivity = Math.max(0, Math.min(1, opacity / 100));
                    this.pushRecentColor(newColor);
                    this.currentPageIndex = 0;

                    this.container.style.setProperty('--hl-color', newColor);
                    this.opacityInput?.parentElement?.style.setProperty('--hl-color', newColor);
                    this.syncSliderVisual(this.opacityInput, this.opacityBubble, this.getOpacityPercent(), 0, 100);
                    this.updateColorsUI();
                    this.callbacks.onChangeColor(newColor);
                    this.callbacks.onChangeOpacity?.(opacity);
                },
                null,
                this.getOpacityPercent()
            );
        });
        this.swatchRowEl.appendChild(addBtn);

        // Pagination dots
        this.paginationEl.replaceChildren();
        for (let i = 0; i < this.colorPages.length; i++) {
            const dot = document.createElement('button');
            dot.type = 'button';
            const isActive = i === this.currentPageIndex;
            dot.className = `${i === 0 ? 'popover-pag-clock is-clock-dot ' : 'dot '}popover-pag-dot ${isActive ? 'is-active' : ''}`;
            dot.style.touchAction = 'manipulation';
            setAccessibleTooltip(dot, i === 0 ? 'Colores recientes' : `Página ${i + 1}`);
            if (i === 0) {
                dot.appendChild(createSvg(ICONS.clock, { size: 14 }));
            }
            bindTapOrClick(dot, () => {
                this.currentPageIndex = i;
                this.updateColorsUI();
            });
            this.paginationEl.appendChild(dot);
        }
    }

    destroy(): void {
        this.close();
        this.destroyFavoritesDrawer();
        this.colorPicker?.destroy();
        this.container.remove();
    }
}
