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
} from '../core/types.ts';
import {
    DEFAULT_STROKE_FAVORITE_PROFILES,
    DEFAULT_SHAPE_FAVORITE_PROFILES,
} from '../core/types.ts';
import { ICONS, createSvg, setAccessibleTooltip } from './theme.ts';
import type { PopoverController, PopoverInstance } from './kit/index.ts';
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

        this.colorPicker = new ColorPickerPopover(parent);
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
        this.colorPicker?.close();
        if (this.popoverController) {
            this.popoverController.close(this);
        }
        this.callbacks.onClose?.();
    }

    hide(): void {
        this.close();
    }

    isOpen(): boolean {
        return this.openState;
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

        if (partial.isCurrentFavorite !== undefined) {
            this.updateStarButtonVisual();
        }

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
                const tool = this.state.tool as FavoritableTool;
                const isShape = tool === 'shape';
                const profiles = isShape
                    ? (this.state.shapeFavoriteProfiles ?? DEFAULT_SHAPE_FAVORITE_PROFILES)
                    : (this.state.strokeFavoriteProfiles ?? DEFAULT_STROKE_FAVORITE_PROFILES);
                const activeProfileId = isShape
                    ? (this.state.activeShapeProfileId ?? 'general')
                    : (this.state.activeStrokeProfileId ?? 'notes');
                const syncFavoriteProfiles = Boolean(this.state.syncFavoriteProfiles);

                this.favoritesDrawer.update(
                    tool,
                    this.getToolFavorites(),
                    this.getCurrentToolSlice(),
                    profiles,
                    activeProfileId,
                    syncFavoriteProfiles,
                );
            }
        }

        // In-place updates: zero DOM destruction to preserve slider drags and focus
        if (partial.width !== undefined && this.widthInput && this.widthBubble) {
            this.widthInput.value = String(partial.width);
            this.widthBubble.textContent = String(partial.width);
            const min = Number(this.widthInput.min) || 1;
            const max = Number(this.widthInput.max) || 20;
            const ratio = Math.max(0, Math.min(1, (partial.width - min) / (max - min)));
            const pct = `${(ratio * 100).toFixed(1)}%`;
            this.widthBubble.style.left = `calc(${ratio * 100}% - ${ratio * 24}px)`;
            const track = this.widthInput.parentElement;
            if (track) {
                track.style.setProperty?.('--val', pct);
                const fill = (track as any).querySelector
                    ? ((track as any).querySelector('.slider-fill') as HTMLElement | null)
                    : ((track as any).children ? (Array.from((track as any).children) as any[]).find((c: any) => c.className?.includes?.('slider-fill')) : null) as HTMLElement | null;
                if (fill) fill.style.width = pct;
            }
        }

        if (partial.smoothing !== undefined && this.smoothingInput && this.smoothingBubble) {
            const val = Math.round(partial.smoothing * 10);
            this.smoothingInput.value = String(val);
            this.smoothingBubble.textContent = String(val);
            const ratio = Math.max(0, Math.min(1, val / 10));
            const pct = `${(ratio * 100).toFixed(1)}%`;
            this.smoothingBubble.style.left = `calc(${ratio * 100}% - ${ratio * 24}px)`;
            const track = this.smoothingInput.parentElement;
            if (track) {
                track.style.setProperty?.('--val', pct);
                const fill = (track as any).querySelector
                    ? ((track as any).querySelector('.slider-fill') as HTMLElement | null)
                    : ((track as any).children ? (Array.from((track as any).children) as any[]).find((c: any) => c.className?.includes?.('slider-fill')) : null) as HTMLElement | null;
                if (fill) fill.style.width = pct;
            }
        }

        if (partial.opacity !== undefined && this.opacityInput && this.opacityBubble) {
            const val = Math.round(partial.opacity);
            this.opacityInput.value = String(val);
            this.opacityBubble.textContent = String(val);
            const ratio = Math.max(0, Math.min(1, val / 100));
            const pct = `${(ratio * 100).toFixed(1)}%`;
            this.opacityBubble.style.left = `calc(${ratio * 100}% - ${ratio * 24}px)`;
            this.opacityBubble.style.backgroundColor = this.state.color;
            this.opacityBubble.style.opacity = String(Math.max(0.35, val / 100));
            const track = this.opacityInput.parentElement;
            if (track) {
                track.style.setProperty('--val', pct);
                const fill = track.querySelector('.slider-fill') as HTMLElement | null;
                if (fill) fill.style.width = pct;
            }
        } else if (partial.pressureSensitivity !== undefined && this.opacityInput && this.opacityBubble) {
            const val = Math.round(partial.pressureSensitivity * 100);
            this.opacityInput.value = String(val);
            this.opacityBubble.textContent = String(val);
            const ratio = Math.max(0, Math.min(1, val / 100));
            const pct = `${(ratio * 100).toFixed(1)}%`;
            this.opacityBubble.style.left = `calc(${ratio * 100}% - ${ratio * 24}px)`;
            this.opacityBubble.style.backgroundColor = this.state.color;
            this.opacityBubble.style.opacity = String(Math.max(0.35, val / 100));
            const track = this.opacityInput.parentElement;
            if (track) {
                track.style.setProperty('--val', pct);
                const fill = track.querySelector('.slider-fill') as HTMLElement | null;
                if (fill) fill.style.width = pct;
            }
        }

        if ((partial.lineStyle !== undefined || partial.pattern !== undefined) && this.lineStyleChips.size > 0) {
            const nextPattern = (partial.pattern ?? partial.lineStyle ?? this.state.pattern ?? this.state.lineStyle ?? 'solid') as StrokePattern;
            this.state.lineStyle = nextPattern;
            this.state.pattern = nextPattern;
            for (const [pattern, btn] of this.lineStyleChips) {
                const isActive = pattern === nextPattern;
                btn.classList.toggle('is-active', isActive);
                btn.setAttribute('aria-pressed', String(isActive));
            }
        }

        if (partial.straightenLines !== undefined && this.straightenSwitch) {
            this.straightenSwitch.classList.toggle('is-checked', partial.straightenLines);
            this.straightenSwitch.classList.toggle('is-on', partial.straightenLines);
            const thumb = this.straightenSwitch.querySelector('.popover-switch-thumb') as HTMLElement | null;
            if (thumb) thumb.style.transform = partial.straightenLines ? 'translateX(18px)' : 'none';
        }

        if (partial.onlyHighlighter !== undefined && this.onlyHighlighterSwitch) {
            this.onlyHighlighterSwitch.classList.toggle('is-checked', partial.onlyHighlighter);
            this.onlyHighlighterSwitch.classList.toggle('is-on', partial.onlyHighlighter);
            const thumb = this.onlyHighlighterSwitch.querySelector('.popover-switch-thumb') as HTMLElement | null;
            if (thumb) thumb.style.transform = partial.onlyHighlighter ? 'translateX(18px)' : 'none';
        }

        if (partial.profileId !== undefined) {
            for (const [id, btn] of this.toolButtons) {
                btn.classList.toggle('is-active', id === partial.profileId);
            }
        }

        if (partial.color !== undefined) {
            const clean = partial.color.toUpperCase();
            this.pushRecentColor(partial.color);
            for (const [col, btn] of this.swatchButtons) {
                btn.classList.toggle('is-active', col.toUpperCase() === clean);
            }
            if (this.opacityBubble) {
                this.opacityBubble.style.backgroundColor = partial.color;
            }
        }

        if (partial.eraserRadius !== undefined && this.eraserRadiusInput && this.eraserRadiusBubble) {
            this.eraserRadiusInput.value = String(partial.eraserRadius);
            this.eraserRadiusBubble.textContent = String(partial.eraserRadius);
            const min = Number(this.eraserRadiusInput.min) || 8;
            const max = Number(this.eraserRadiusInput.max) || 60;
            const ratio = Math.max(0, Math.min(1, (partial.eraserRadius - min) / (max - min)));
            this.eraserRadiusBubble.style.left = `calc(${ratio * 100}% - ${ratio * 24}px)`;
            if (this.eraserPreviewDot) {
                const dotSize = Math.max(12, Math.min(36, partial.eraserRadius * 0.7));
                this.eraserPreviewDot.style.width = `${dotSize}px`;
                this.eraserPreviewDot.style.height = `${dotSize}px`;
            }
        }

        if (partial.eraserMode !== undefined) {
            for (const [mode, btn] of this.eraserModeButtons) {
                btn.classList.toggle('is-active', mode === partial.eraserMode);
            }
        }

        if (partial.lassoMode !== undefined) {
            for (const [mode, btn] of this.lassoModeButtons) {
                btn.classList.toggle('is-active', mode === partial.lassoMode);
            }
        }

        if (partial.shapeType !== undefined) {
            for (const [type, btn] of this.shapeButtons) {
                btn.classList.toggle('is-active', type === partial.shapeType);
            }
        }

        if (partial.snapGrid !== undefined && this.snapGridSwitch) {
            this.snapGridSwitch.classList.toggle('is-checked', partial.snapGrid);
            this.snapGridSwitch.classList.toggle('is-on', partial.snapGrid);
            const thumb = this.snapGridSwitch.querySelector('.popover-switch-thumb') as HTMLElement | null;
            if (thumb) thumb.style.transform = partial.snapGrid ? 'translateX(18px)' : 'none';
        }

        if (partial.scribbleToErase !== undefined && this.scribbleSwitch) {
            this.scribbleSwitch.classList.toggle('is-checked', partial.scribbleToErase);
            this.scribbleSwitch.classList.toggle('is-on', partial.scribbleToErase);
            const thumb = this.scribbleSwitch.querySelector('.popover-switch-thumb') as HTMLElement | null;
            if (thumb) thumb.style.transform = partial.scribbleToErase ? 'translateX(18px)' : 'none';
        }

        if (partial.slot !== undefined) {
            this.position(this.currentAnchorEl);
        }
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
        if (isShowing) {
            this.favsBtn.className = 'ibtn popover-hdr-btn popover-back-btn';
            setAccessibleTooltip(this.favsBtn, 'Volver al estuche');
            this.favsBtn.onclick = () => this.setShowingFavorites(false);
            this.favsBtn.replaceChildren(createSvg(ICONS.arrowLeft, { size: 18, strokeWidth: 2 }));
            return;
        }

        this.favsBtn.className = 'hd-bookmark-btn popover-hdr-btn popover-favs-btn';
        setAccessibleTooltip(this.favsBtn, 'Ver favoritos guardados');
        this.favsBtn.onclick = () => this.setShowingFavorites(true);

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
        const isShape = this.state.tool === 'shape';
        const profiles = isShape
            ? (Array.isArray(this.state.shapeFavoriteProfiles) && this.state.shapeFavoriteProfiles.length > 0
                ? this.state.shapeFavoriteProfiles
                : DEFAULT_SHAPE_FAVORITE_PROFILES)
            : (Array.isArray(this.state.strokeFavoriteProfiles) && this.state.strokeFavoriteProfiles.length > 0
                ? this.state.strokeFavoriteProfiles
                : DEFAULT_STROKE_FAVORITE_PROFILES);
        return profiles.map(p => ({ id: p.id, name: p.name }));
    }

    private getActiveProfileId(): string {
        const isShape = this.state.tool === 'shape';
        return isShape
            ? (this.state.activeShapeProfileId ?? 'general')
            : (this.state.activeStrokeProfileId ?? 'notes');
    }

    private getActiveProfileName(): string {
        const profiles = this.getActiveToolProfiles();
        const activeId = this.getActiveProfileId();
        const activeProfile = profiles.find(p => p.id === activeId) ?? profiles[0];
        return activeProfile?.name || 'Favoritos';
    }

    public switchProfile(profileId: string): void {
        const isShape = this.state.tool === 'shape';
        if (isShape) {
            this.state.activeShapeProfileId = profileId;
        } else {
            this.state.activeStrokeProfileId = profileId;
        }
        this.updateHeaderTitleVisual();
        this.updateFavsButtonVisual();
        if (this.favoritesDrawer) {
            const tool = this.state.tool as FavoritableTool;
            const profiles = isShape
                ? (Array.isArray(this.state.shapeFavoriteProfiles) && this.state.shapeFavoriteProfiles.length > 0
                    ? this.state.shapeFavoriteProfiles
                    : DEFAULT_SHAPE_FAVORITE_PROFILES)
                : (Array.isArray(this.state.strokeFavoriteProfiles) && this.state.strokeFavoriteProfiles.length > 0
                    ? this.state.strokeFavoriteProfiles
                    : DEFAULT_STROKE_FAVORITE_PROFILES);
            this.favoritesDrawer.update(
                tool,
                this.getToolFavorites(),
                this.getCurrentToolSlice(),
                profiles,
                profileId,
                Boolean(this.state.syncFavoriteProfiles),
            );
        }
        this.callbacks.onSwitchProfile?.(profileId);
    }

    private updateHeaderTitleVisual(): void {
        if (!this.titleEl) return;
        if (this.state.showingFavorites) {
            const profileName = this.getActiveProfileName();
            this.titleEl.textContent = profileName;

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
                const activeProfileId = this.getActiveProfileId();
                const currIdx = profiles.findIndex(p => p.id === activeProfileId);
                const safeIdx = currIdx !== -1 ? currIdx : 0;
                const isLastProfile = safeIdx === profiles.length - 1;

                // 1. Prev Navigation Chevron (<)
                const prevBtn = document.createElement('button');
                prevBtn.type = 'button';
                prevBtn.className = 'arrow apolo-kit-nav-btn apolo-kit-nav-prev';
                setAccessibleTooltip(prevBtn, 'Perfil anterior');
                prevBtn.appendChild(createSvg(ICONS.chevronLeft, { size: 12, strokeWidth: 2 }));
                if (safeIdx === 0) {
                    prevBtn.classList.add('is-disabled');
                    prevBtn.disabled = true;
                } else {
                    prevBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.switchProfile(profiles[safeIdx - 1].id);
                    };
                }
                this.headerDotsContainer.appendChild(prevBtn);

                // 2. Track of dots
                const track = document.createElement('div');
                track.className = 'apolo-kit-dots-track';

                profiles.forEach((p, idx) => {
                    const dot = document.createElement('button');
                    dot.type = 'button';
                    const isActive = idx === safeIdx;
                    dot.className = `dot popover-header-dot apolo-kit-dot${isActive ? ' is-active' : ''}`;
                    setAccessibleTooltip(dot, `Perfil ${p.name}`, p.name);
                    dot.onclick = (e) => {
                        e.stopPropagation();
                        this.switchProfile(p.id);
                    };
                    track.appendChild(dot);
                });

                // Add Profile dot indicator at the end
                const addDot = document.createElement('button');
                addDot.type = 'button';
                addDot.className = `dot-add popover-header-dot apolo-kit-dot is-add-dot${isLastProfile ? ' is-next-hint' : ''}`;
                setAccessibleTooltip(addDot, 'Nuevo perfil');
                addDot.appendChild(createSvg(ICONS.plus, { size: 10, strokeWidth: 2.2 }));
                addDot.onclick = (e) => {
                    e.stopPropagation();
                    this.favoritesDrawer?.openCreateProfileForm();
                };
                track.appendChild(addDot);
                this.headerDotsContainer.appendChild(track);

                // 3. Next Navigation Chevron (>)
                const nextBtn = document.createElement('button');
                nextBtn.type = 'button';
                nextBtn.className = 'arrow apolo-kit-nav-btn apolo-kit-nav-next';
                setAccessibleTooltip(nextBtn, isLastProfile ? 'Nuevo perfil' : 'Perfil siguiente');
                nextBtn.appendChild(createSvg(ICONS.chevronRight, { size: 12, strokeWidth: 2 }));
                nextBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (safeIdx < profiles.length - 1) {
                        this.switchProfile(profiles[safeIdx + 1].id);
                    } else {
                        this.favoritesDrawer?.openCreateProfileForm();
                    }
                };
                this.headerDotsContainer.appendChild(nextBtn);
            }
        } else {
            this.titleEl.textContent = this.getTitleForTool(this.state.tool);
            if (this.headerDotsContainer) {
                this.headerDotsContainer.replaceChildren();
            }
        }
    }

    private renderCreateProfileHeaderDots(): void {
        if (!this.headerDotsContainer) return;
        this.headerDotsContainer.replaceChildren();

        const profiles = this.getActiveToolProfiles();

        // 1. Prev Navigation Chevron (<)
        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'arrow apolo-kit-nav-btn apolo-kit-nav-prev';
        setAccessibleTooltip(prevBtn, 'Cancelar y volver');
        prevBtn.appendChild(createSvg(ICONS.chevronLeft, { size: 12, strokeWidth: 2 }));
        prevBtn.onclick = (e) => {
            e.stopPropagation();
            this.favoritesDrawer?.closeCreateProfileForm?.();
            this.updateHeaderTitleVisual();
        };
        this.headerDotsContainer.appendChild(prevBtn);

        // 2. Track of dots
        const track = document.createElement('div');
        track.className = 'apolo-kit-dots-track';

        profiles.forEach((p) => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'dot popover-header-dot apolo-kit-dot';
            setAccessibleTooltip(dot, `Perfil ${p.name}`, p.name);
            dot.onclick = (e) => {
                e.stopPropagation();
                this.favoritesDrawer?.closeCreateProfileForm?.();
                this.switchProfile(p.id);
            };
            track.appendChild(dot);
        });

        // Add Profile dot indicator (active)
        const addDot = document.createElement('button');
        addDot.type = 'button';
        addDot.className = 'dot-add popover-header-dot apolo-kit-dot is-add-dot is-active';
        setAccessibleTooltip(addDot, 'Nuevo perfil');
        addDot.appendChild(createSvg(ICONS.plus, { size: 10, strokeWidth: 2.2 }));
        track.appendChild(addDot);
        this.headerDotsContainer.appendChild(track);

        // 3. Next Navigation Chevron (>) (disabled in create view)
        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'arrow apolo-kit-nav-btn apolo-kit-nav-next is-disabled';
        nextBtn.disabled = true;
        setAccessibleTooltip(nextBtn, 'Perfil siguiente');
        nextBtn.appendChild(createSvg(ICONS.chevronRight, { size: 12, strokeWidth: 2 }));
        this.headerDotsContainer.appendChild(nextBtn);
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
        const tool = this.state.tool as FavoritableTool;
        const favorites = this.getToolFavorites();
        const currentSlice = this.getCurrentToolSlice();
        const isShape = tool === 'shape';
        const profiles = isShape
            ? (Array.isArray(this.state.shapeFavoriteProfiles) && this.state.shapeFavoriteProfiles.length > 0
                ? this.state.shapeFavoriteProfiles
                : DEFAULT_SHAPE_FAVORITE_PROFILES)
            : (Array.isArray(this.state.strokeFavoriteProfiles) && this.state.strokeFavoriteProfiles.length > 0
                ? this.state.strokeFavoriteProfiles
                : DEFAULT_STROKE_FAVORITE_PROFILES);
        const activeProfileId = isShape
            ? (this.state.activeShapeProfileId ?? 'general')
            : (this.state.activeStrokeProfileId ?? 'notes');
        const syncFavoriteProfiles = Boolean(this.state.syncFavoriteProfiles);

        this.favoritesDrawer = new FavoritesDrawer(
            {
                onSelectFavorite: (preset) => {
                    this.callbacks.onApplyFavorite?.(preset);
                    this.close();
                },
                onDeleteFavorite: (presetId) => {
                    this.callbacks.onDeleteFavorite?.(presetId);
                },
                onReorderFavorite: (fromIndex, toIndex) => {
                    this.callbacks.onReorderFavorites?.(fromIndex, toIndex);
                },
                onRenameFavorite: (presetId, newName) => {
                    this.callbacks.onRenameFavorite?.(presetId, newName);
                },
                onSwitchProfile: (profileId) => {
                    this.switchProfile(profileId);
                },
                onCreateProfile: (name) => {
                    this.callbacks.onCreateProfile?.(name);
                },
                onToggleSyncProfiles: (sync) => {
                    this.callbacks.onToggleSyncProfiles?.(sync);
                },
                onProfileModeChange: (mode) => {
                    if (mode === 'create') {
                        if (this.titleEl) this.titleEl.textContent = 'Nuevo perfil';
                        if (this.headerDotsContainer) this.headerDotsContainer.style.display = 'none';
                        if (this.starBtn) this.starBtn.style.display = 'none';
                        if (this.favsBtn) setAccessibleTooltip(this.favsBtn, 'Cancelar y volver');
                    } else {
                        if (this.headerDotsContainer) this.headerDotsContainer.style.display = '';
                        if (this.starBtn) this.starBtn.style.display = '';
                        if (this.favsBtn) setAccessibleTooltip(this.favsBtn, 'Volver al estuche');
                        this.updateHeaderTitleVisual();
                    }
                },
            },
            tool,
            favorites,
            currentSlice,
            this.bodyEl,
            profiles,
            activeProfileId,
            syncFavoriteProfiles,
        );
    }

    private renderFavoritesAwareHeader(titleText: string): void {
        const hdLeft = document.createElement('div');
        hdLeft.className = 'hd-left';

        const isShowingFavs = Boolean(this.state.showingFavorites);

        if (isShowingFavs) {
            const backBtn = document.createElement('button');
            backBtn.type = 'button';
            backBtn.className = 'ibtn popover-hdr-btn popover-favs-btn popover-back-btn';
            setAccessibleTooltip(backBtn, 'Volver al estuche');
            backBtn.appendChild(createSvg(ICONS.arrowLeft, { size: 18, strokeWidth: 2 }));
            backBtn.onclick = () => {
                if (this.favoritesDrawer?.getIsCreatingProfile?.()) {
                    this.favoritesDrawer.closeCreateProfileForm();
                } else {
                    this.setShowingFavorites(false);
                }
            };
            this.favsBtn = backBtn;
            hdLeft.appendChild(backBtn);
        } else {
            const favsBtn = document.createElement('button');
            favsBtn.type = 'button';
            favsBtn.className = 'hd-bookmark-btn popover-hdr-btn popover-favs-btn';
            setAccessibleTooltip(favsBtn, 'Ver favoritos guardados');
            favsBtn.appendChild(createSvg(ICONS.bookmark, { size: 18 }));

            const count = this.getToolFavorites().length;
            if (count > 0) {
                const badge = document.createElement('span');
                badge.className = 'popover-favs-badge';
                badge.textContent = String(count);
                favsBtn.appendChild(badge);
            }

            favsBtn.onclick = () => {
                this.setShowingFavorites(true);
            };
            this.favsBtn = favsBtn;
            hdLeft.appendChild(favsBtn);
        }

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
        closeBtn.className = 'ibtn popover-hdr-btn popover-close';
        setAccessibleTooltip(closeBtn, 'Cerrar');
        closeBtn.appendChild(createSvg(ICONS.close, { size: 16 }));
        closeBtn.onclick = () => this.close();

        rightBtns.append(starBtn, closeBtn);
        this.headerEl.append(hdLeft, titleContainer, rightBtns);
    }

    private renderPenHeader(): void {
        this.renderFavoritesAwareHeader(this.getTitleForTool(this.state.tool));
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
        closeBtn.className = 'ibtn popover-hdr-btn popover-close';
        setAccessibleTooltip(closeBtn, 'Cerrar');
        closeBtn.appendChild(createSvg(ICONS.close, { size: 16 }));
        closeBtn.onclick = () => this.close();

        rightBtns.appendChild(closeBtn);
        this.headerEl.append(hdLeft, titleContainer, rightBtns);
    }

    // =========================================================================
    // Pen Content (Image 2 - 1:1 visually with mockup)
    // =========================================================================
    private renderPenContent(): void {
        // 1. Selector de Herramientas (4 profiles)
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
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.width = '100%';
            btn.style.height = '44px';
            btn.style.minHeight = '44px';
            btn.style.borderRadius = '14px';
            btn.style.boxSizing = 'border-box';
            btn.style.padding = '8px';
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

        // 2. Slider Grosor (1 to 20 px)
        const widthSlider = this.createSlider(
            'Grosor',
            this.state.width,
            1,
            20,
            0.5,
            (val) => {
                this.state.width = val;
                this.callbacks.onChangeWidth(val);
            }
        );
        this.widthInput = widthSlider.input;
        this.widthBubble = widthSlider.bubble;
        this.bodyEl.appendChild(widthSlider.element);

        // 3. Slider Suavizado (0 to 10)
        const smoothingSlider = this.createSlider(
            'Suavizado',
            Math.round(this.state.smoothing * 10),
            0,
            10,
            1,
            (val) => {
                this.state.smoothing = val / 10;
                this.callbacks.onChangeSmoothing(this.state.smoothing);
            }
        );
        this.smoothingInput = smoothingSlider.input;
        this.smoothingBubble = smoothingSlider.bubble;
        this.bodyEl.appendChild(smoothingSlider.element);

        // 4. Line styles grid (solid, dashed, dotted)
        this.bodyEl.appendChild(this.createLineStylesGrid((pattern) => {
            this.state.lineStyle = pattern;
            this.state.pattern = pattern;
            this.callbacks.onChangeLineStyle?.(pattern);
        }));

        // 5. Toggle Row: "Enderezar líneas"
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

        // 6. Paleta de Colores
        this.bodyEl.appendChild(this.createPaletteSection());
    }

    // =========================================================================
    // Highlighter Content
    // =========================================================================
    private renderHighlighterContent(): void {
        // 1. Selector de Puntas (Chisel & Round)
        const toolsRow = document.createElement('div');
        toolsRow.className = 'popover-tools-selector';
        toolsRow.setAttribute('role', 'radiogroup');
        toolsRow.setAttribute('aria-label', 'Punta de resaltador');
        const activeTip: PenProfileId =
            this.state.profileId === 'hlf' || this.state.profileId === 'hlr' ? this.state.profileId : 'hlf';

        const tips: Array<{ id: PenProfileId; label: string; iconD: string }> = [
            { id: 'hlf', label: 'Marcador Biselado', iconD: ICONS.highlighterChisel },
            { id: 'hlr', label: 'Marcador Redondo', iconD: ICONS.highlighterRound },
        ];

        for (const t of tips) {
            const btn = document.createElement('button');
            btn.type = 'button';
            const isActive = activeTip === t.id;
            btn.className = `tool-btn popover-tool-opt ${isActive ? 'is-active' : ''}`;
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.width = '100%';
            btn.style.height = '44px';
            btn.style.minHeight = '44px';
            btn.style.borderRadius = '14px';
            btn.style.boxSizing = 'border-box';
            btn.style.padding = '8px';
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

    // =========================================================================
    // Eraser Content
    // =========================================================================
    private renderEraserContent(): void {
        // 1. Selector de Modos (Whole vs Reticle)
        const modesList = document.createElement('div');
        modesList.className = 'eraser-modes-list';

        const modes: Array<{ id: EraserMode; label: string }> = [
            { id: 'whole', label: 'Borrar trazo completo' },
            { id: 'reticle', label: 'Borrar por área (retícula)' },
        ];

        for (const m of modes) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `eraser-radio-row ${this.state.eraserMode === m.id ? 'is-active' : ''}`;

            const circle = document.createElement('div');
            circle.className = 'eraser-radio-circle';
            const dot = document.createElement('div');
            dot.className = 'eraser-radio-inner-dot';
            circle.appendChild(dot);

            const span = document.createElement('span');
            span.textContent = m.label;

            row.append(circle, span);
            row.onclick = () => {
                this.state.eraserMode = m.id;
                for (const [, r] of this.eraserModeButtons) r.classList.remove('is-active');
                row.classList.add('is-active');
                this.callbacks.onSelectEraserMode(m.id);
            };

            this.eraserModeButtons.set(m.id, row);
            modesList.appendChild(row);
        }
        this.bodyEl.appendChild(modesList);

        const divider = document.createElement('div');
        divider.className = 'eraser-divider';
        this.bodyEl.appendChild(divider);

        // 2. Slider Tamaño del Borrador (8 to 60 px)
        const radiusSlider = this.createSlider(
            'Tamaño del borrador',
            this.state.eraserRadius,
            8,
            60,
            2,
            (val) => {
                this.state.eraserRadius = val;
                this.callbacks.onChangeEraserRadius(val);
                if (this.eraserPreviewDot) {
                    const dotSize = Math.max(12, Math.min(36, val * 0.7));
                    this.eraserPreviewDot.style.width = `${dotSize}px`;
                    this.eraserPreviewDot.style.height = `${dotSize}px`;
                }
            }
        );
        this.eraserRadiusInput = radiusSlider.input;
        this.eraserRadiusBubble = radiusSlider.bubble;
        this.bodyEl.appendChild(radiusSlider.element);

        // 3. Toggle Row: "Borrar resaltador solamente"
        const onlyHighlighterRow = this.createToggleRow(
            'Borrar resaltador solamente',
            !!this.state.onlyHighlighter,
            (checked) => {
                this.state.onlyHighlighter = checked;
                this.callbacks.onToggleOnlyHighlighter?.(checked);
            }
        );
        this.onlyHighlighterSwitch = (onlyHighlighterRow as any).__switch as HTMLElement;
        this.bodyEl.appendChild(onlyHighlighterRow);

        // 4. Toggle Row: "Garabato para borrar"
        const scribbleRow = this.createToggleRow(
            'Garabato para borrar',
            this.state.scribbleToErase,
            (checked) => {
                this.state.scribbleToErase = checked;
                this.callbacks.onToggleScribble(checked);
            }
        );
        this.scribbleSwitch = (scribbleRow as any).__switch as HTMLElement;
        this.bodyEl.appendChild(scribbleRow);
    }

    // =========================================================================
    // Shape Content
    // =========================================================================
    private renderShapeContent(): void {
        // 1. Grid de Formas (5 shapes con targets de 44px)
        const shapesGrid = document.createElement('div');
        shapesGrid.className = 'shape-grid-selector';

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
            btn.className = `shape-grid-btn ${this.state.shapeType === def.type ? 'is-active' : ''}`;
            setAccessibleTooltip(btn, def.label);
            btn.appendChild(createSvg(def.iconD, { size: 24 }));

            btn.onclick = () => {
                this.state.shapeType = def.type;
                for (const [, b] of this.shapeButtons) b.classList.remove('is-active');
                btn.classList.add('is-active');
                this.callbacks.onSelectShapeType(def.type);
            };

            this.shapeButtons.set(def.type, btn);
            shapesGrid.appendChild(btn);
        }
        this.bodyEl.appendChild(shapesGrid);

        // 2. Slider Grosor (1 to 12 px)
        const widthSlider = this.createSlider(
            'Grosor de trazo',
            this.state.width,
            1,
            12,
            0.5,
            (val) => {
                this.state.width = val;
                this.callbacks.onChangeWidth(val);
            }
        );
        this.widthInput = widthSlider.input;
        this.widthBubble = widthSlider.bubble;
        this.bodyEl.appendChild(widthSlider.element);

        // 3. Line styles grid
        this.bodyEl.appendChild(this.createLineStylesGrid((pattern) => {
            this.state.lineStyle = pattern;
            this.state.pattern = pattern;
            this.callbacks.onChangeLineStyle?.(pattern);
        }));

        // 4. Toggle Row: "Imán de cuadrícula"
        const snapRow = this.createToggleRow(
            'Imán de cuadrícula',
            this.state.snapGrid,
            (checked) => {
                this.state.snapGrid = checked;
                this.callbacks.onToggleSnapGrid(checked);
            }
        );
        this.snapGridSwitch = (snapRow as any).__switch as HTMLElement;
        this.bodyEl.appendChild(snapRow);

        // 5. Paleta de Colores
        this.bodyEl.appendChild(this.createPaletteSection());
    }

    // =========================================================================
    // Lasso Content
    // =========================================================================
    private renderLassoContent(): void {
        const modesList = document.createElement('div');
        modesList.className = 'eraser-modes-list';

        const modes: Array<{ id: LassoMode; label: string }> = [
            { id: 'free', label: 'Lazo libre' },
            { id: 'rect', label: 'Lazo rectangular' },
        ];

        for (const m of modes) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `eraser-radio-row ${this.state.lassoMode === m.id ? 'is-active' : ''}`;

            const circle = document.createElement('div');
            circle.className = 'eraser-radio-circle';
            const dot = document.createElement('div');
            dot.className = 'eraser-radio-inner-dot';
            circle.appendChild(dot);

            const span = document.createElement('span');
            span.textContent = m.label;

            row.append(circle, span);
            row.onclick = () => {
                this.state.lassoMode = m.id;
                for (const [, r] of this.lassoModeButtons) r.classList.remove('is-active');
                row.classList.add('is-active');
                this.callbacks.onSelectLassoMode(m.id);
            };

            this.lassoModeButtons.set(m.id, row);
            modesList.appendChild(row);
        }
        this.bodyEl.appendChild(modesList);
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
        track.className = 'slider-track popover-track-wrap';

        const fill = document.createElement('div');
        fill.className = 'slider-fill';

        const bubble = document.createElement('div');
        bubble.className = 'slider-thumb popover-bubble-val';
        bubble.textContent = String(currentVal);
        if (isOpacity) {
            bubble.style.backgroundColor = this.state.color;
            bubble.style.opacity = String(Math.max(0.35, currentVal / 100));
        }

        const input = document.createElement('input');
        input.type = 'range';
        input.className = `popover-range-native ${isOpacity ? 'popover-track-checkerboard' : ''}`;
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(currentVal);
        input.setAttribute('aria-label', label);
        input.style.width = '100%';
        input.style.minWidth = '0';
        input.style.maxWidth = 'none';
        input.style.flex = '1 1 100%';
        track.append(fill, input, bubble);

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
            fill.style.width = pct;
            if (isOpacity) {
                bubble.style.backgroundColor = this.state.color;
                bubble.style.opacity = String(Math.max(0.35, val / 100));
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
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.width = '100%';
            btn.style.height = '38px';
            btn.style.minHeight = '38px';
            btn.style.borderRadius = '12px';
            btn.style.boxSizing = 'border-box';
            btn.style.padding = '0 12px';
            setAccessibleTooltip(btn, s.label);

            const pill = document.createElement('span');
            pill.className = 'popover-line-chip-pill';
            pill.setAttribute('aria-hidden', 'true');
            pill.style.display = 'flex';
            pill.style.alignItems = 'center';
            pill.style.justifyContent = 'center';
            pill.style.width = '100%';
            pill.style.height = '100%';

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
        toggleRow.style.display = 'flex';
        toggleRow.style.alignItems = 'center';
        toggleRow.style.justifyContent = 'space-between';
        toggleRow.style.width = '100%';

        const tTitle = document.createElement('span');
        tTitle.className = 'toggle-label popover-toggle-title';
        tTitle.textContent = title;
        tTitle.style.flex = '1';

        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = `switch popover-switch ${initialChecked ? 'is-on is-checked' : ''}`;
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-checked', String(initialChecked));
        sw.style.position = 'relative';
        sw.style.display = 'inline-block';
        sw.style.width = '40px';
        sw.style.height = '22px';
        sw.style.flexShrink = '0';
        setAccessibleTooltip(sw, title);

        const thumb = document.createElement('span');
        thumb.className = 'popover-switch-thumb';
        thumb.style.position = 'absolute';
        thumb.style.top = '2px';
        thumb.style.left = '2px';
        thumb.style.width = '16px';
        thumb.style.height = '16px';
        thumb.style.borderRadius = '50%';
        thumb.style.background = '#ffffff';
        thumb.style.pointerEvents = 'none';
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
            setAccessibleTooltip(sw, `Color ${col}`);
            sw.style.backgroundColor = col;
            sw.style.setProperty('--c', col);
            sw.style.setProperty('--swatch-color', col);

            const inner = document.createElement('span');
            inner.className = 'popover-swatch-inner';
            inner.style.backgroundColor = col;
            sw.appendChild(inner);

            sw.onclick = () => {
                this.state.color = col;
                this.pushRecentColor(col);
                for (const [, s] of this.swatchButtons) s.classList.remove('is-active');
                sw.classList.add('is-active');
                if (this.opacityBubble) {
                    this.opacityBubble.style.backgroundColor = col;
                }
                this.callbacks.onChangeColor(col);
            };

            this.swatchButtons.set(col, sw);
            this.swatchRowEl.appendChild(sw);
        }

        // Circular "+" button (opens ColorPickerPopover)
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'swatch-add popover-color-add';
        addBtn.setAttribute('data-apolo-popover-trigger', 'true');
        setAccessibleTooltip(addBtn, 'Personalizar color');
        addBtn.appendChild(createSvg(ICONS.plus, { size: 14, strokeWidth: 2 }));

        addBtn.onclick = (e) => {
            e.stopPropagation();
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

                    const nextOpacity = this.getOpacityPercent();
                    if (this.opacityInput && this.opacityBubble) {
                        this.opacityInput.value = String(nextOpacity);
                        this.opacityBubble.textContent = String(nextOpacity);
                        const ratio = Math.max(0, Math.min(1, nextOpacity / 100));
                        this.opacityBubble.style.left = `calc(${ratio * 100}% - ${ratio * 24}px)`;
                        this.opacityBubble.style.backgroundColor = newColor;
                        this.opacityBubble.style.opacity = String(Math.max(0.35, nextOpacity / 100));
                    }

                    this.updateColorsUI();
                    this.callbacks.onChangeColor(newColor);
                    this.callbacks.onChangeOpacity?.(opacity);
                },
                null,
                this.getOpacityPercent()
            );
        };
        this.swatchRowEl.appendChild(addBtn);

        // Pagination dots
        this.paginationEl.replaceChildren();
        for (let i = 0; i < this.colorPages.length; i++) {
            const dot = document.createElement('button');
            dot.type = 'button';
            const isActive = i === this.currentPageIndex;
            dot.className = `${i === 0 ? 'popover-pag-clock is-clock-dot ' : 'dot '}popover-pag-dot ${isActive ? 'is-active' : ''}`;
            setAccessibleTooltip(dot, i === 0 ? 'Colores recientes' : `Página ${i + 1}`);
            if (i === 0) {
                dot.appendChild(createSvg(ICONS.clock, { size: 14 }));
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
        this.colorPicker?.destroy();
        this.container.remove();
    }
}
