import type {
    FavoritableTool,
    ToolFavoritePreset,
    PenFavoritePreset,
    HighlighterFavoritePreset,
    ShapeFavoritePreset,
} from '../../core/types.ts';
import {
    DEFAULT_STROKE_FAVORITE_PROFILES,
    DEFAULT_SHAPE_FAVORITE_PROFILES,
} from '../../core/types.ts';
import { computeFavoriteFingerprint, inferTool } from './FavoritesStore.ts';
import { ICONS, createSvg, createStrokeWavePreview, mapInkColorForDark, setAccessibleTooltip } from '../theme.ts';

export interface FavoritesDrawerCallbacks {
    onSelectFavorite: (preset: ToolFavoritePreset) => void;
    onDeleteFavorite: (presetId: string) => void;
    onReorderFavorite: (fromIndex: number, toIndex: number) => void;
    onRenameFavorite?: (presetId: string, newName: string) => void;
    onSwitchProfile?: (profileId: string) => void;
    onSelectProfile?: (profileId: string) => void;
    onCreateProfile?: (name: string) => void;
    onToggleSyncProfiles?: (sync: boolean) => void;
    onProfileModeChange?: (mode: 'list' | 'create') => void;
}

/**
 * Returns a human-friendly Spanish label for a favorite preset.
 */
export function getPresetLabel(preset: ToolFavoritePreset): string {
    if (preset.name && preset.name.trim().length > 0) {
        return preset.name.trim();
    }
    if (preset.tool === 'pen') {
        const pen = preset as PenFavoritePreset;
        switch (pen.profileId) {
            case 'fountain': return 'Estilográfica';
            case 'calli': return 'Caligráfica';
            case 'ball': return 'Bolígrafo';
            case 'pencil': return 'Lápiz';
            case 'hlr': return 'Marcador redondo';
            case 'hlf': return 'Marcador plano';
            default: return 'Pluma';
        }
    }
    if (preset.tool === 'highlighter') {
        const hl = preset as HighlighterFavoritePreset;
        return hl.profileId === 'hlf' ? 'Marcador plano' : 'Marcador redondo';
    }
    if (preset.tool === 'shape') {
        const shape = preset as ShapeFavoritePreset;
        switch (shape.shapeType) {
            case 'rect': return 'Rectángulo';
            case 'rounded-rect': return 'Rectángulo redondeado';
            case 'ellipse': return 'Círculo';
            case 'triangle': return 'Triángulo';
            case 'line': return 'Línea';
            case 'arrow': return 'Flecha';
            default: return 'Forma';
        }
    }
    return 'Favorito';
}

/**
 * Returns the SVG path (from ICONS) that represents the tool/profile/shape of a preset.
 */
export function getPresetIcon(preset: ToolFavoritePreset): string {
    if (preset.tool === 'shape') {
        const shapes = ICONS.shapes as Record<string, string>;
        const type = (preset as ShapeFavoritePreset).shapeType;
        const key = type === 'ellipse' ? 'circle' : type === 'rounded-rect' ? 'rect' : type;
        return shapes[key] ?? shapes.rect;
    }
    const profileId = (preset as PenFavoritePreset | HighlighterFavoritePreset).profileId;
    switch (profileId) {
        case 'fountain': return ICONS.pen;
        case 'calli': return ICONS.feather;
        case 'ball': return ICONS.ballpoint;
        case 'pencil': return ICONS.pencil;
        case 'hlf': return ICONS.highlighterChisel;
        case 'hlr': return ICONS.highlighterRound;
        default: return preset.tool === 'highlighter' ? ICONS.highlighter : ICONS.pen;
    }
}

/**
 * Tooltip / aria text: the info that no longer takes space on the card.
 */
export function getPresetTooltip(preset: ToolFavoritePreset): string {
    const parts: string[] = [];
    if (preset.name) parts.push(preset.name);
    parts.push(getPresetLabel(preset), `${preset.width}px`);
    if (preset.pattern === 'dashed') parts.push('rayas');
    else if (preset.pattern === 'dotted') parts.push('puntos');
    if (preset.tool === 'shape' && (preset as ShapeFavoritePreset).fillEnabled) parts.push('relleno');
    return parts.join(' · ');
}

/**
 * Creates a pure DOM inline SVG preview for a shape favorite preset.
 */
export function createShapePreview(
    preset: ShapeFavoritePreset,
    width = 64,
    height = 64,
): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const strokeColor = mapInkColorForDark(preset.color || '#2F6BFF');
    const strokeWidth = Math.max(1.5, Math.min(6, preset.width || 3));
    const rawOpacity = preset.opacity !== undefined ? Number(preset.opacity) : 1;
    const strokeOpacity = rawOpacity > 1 ? rawOpacity / 100 : Math.max(0, rawOpacity);

    let fill = 'none';
    let fillOpacity = 1;
    if (preset.fillEnabled) {
        fill = preset.fillColor ? mapInkColorForDark(preset.fillColor) : strokeColor;
        const rawFillOp = preset.fillOpacity !== undefined ? Number(preset.fillOpacity) : 0.3;
        fillOpacity = rawFillOp > 1 ? rawFillOp / 100 : Math.max(0, rawFillOp);
    }

    const pattern = preset.pattern || 'solid';
    const applyCommonAttributes = (el: SVGElement) => {
        el.setAttribute('stroke', strokeColor);
        el.setAttribute('stroke-width', String(strokeWidth));
        el.setAttribute('stroke-opacity', String(strokeOpacity));
        el.setAttribute('vector-effect', 'non-scaling-stroke');
        el.setAttribute('fill', fill);
        if (fill !== 'none') {
            el.setAttribute('fill-opacity', String(fillOpacity));
        }
        if (pattern === 'dashed') {
            const dash = Math.max(6, Math.round(strokeWidth * 2.5));
            const gap = Math.max(4, Math.round(strokeWidth * 1.8));
            el.setAttribute('stroke-dasharray', `${dash} ${gap}`);
            el.setAttribute('stroke-linecap', 'butt');
        } else if (pattern === 'dotted') {
            const gap = Math.max(4, Math.round(strokeWidth * 2));
            el.setAttribute('stroke-dasharray', `0.1 ${gap}`);
            el.setAttribute('stroke-linecap', 'round');
        } else {
            el.setAttribute('stroke-linecap', 'round');
        }
        el.setAttribute('stroke-linejoin', 'round');
    };

    const isSquare = width === height;

    if (isSquare) {
        switch (preset.shapeType) {
            case 'line': {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', '12');
                line.setAttribute('y1', '52');
                line.setAttribute('x2', '52');
                line.setAttribute('y2', '12');
                applyCommonAttributes(line);
                svg.appendChild(line);
                break;
            }
            case 'arrow': {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', '14');
                line.setAttribute('y1', '50');
                line.setAttribute('x2', '50');
                line.setAttribute('y2', '14');
                applyCommonAttributes(line);
                svg.appendChild(line);

                const head = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                head.setAttribute('d', 'M35 14 H50 V29');
                head.setAttribute('stroke', strokeColor);
                head.setAttribute('stroke-width', String(strokeWidth));
                head.setAttribute('stroke-opacity', String(strokeOpacity));
                head.setAttribute('stroke-linecap', 'round');
                head.setAttribute('stroke-linejoin', 'round');
                head.setAttribute('vector-effect', 'non-scaling-stroke');
                head.setAttribute('fill', 'none');
                svg.appendChild(head);
                break;
            }
            case 'ellipse': {
                const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
                ellipse.setAttribute('cx', '32');
                ellipse.setAttribute('cy', '32');
                ellipse.setAttribute('rx', '22');
                ellipse.setAttribute('ry', '22');
                applyCommonAttributes(ellipse);
                svg.appendChild(ellipse);
                break;
            }
            case 'rounded-rect': {
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', '8');
                rect.setAttribute('y', '14');
                rect.setAttribute('width', '48');
                rect.setAttribute('height', '36');
                rect.setAttribute('rx', '8');
                rect.setAttribute('ry', '8');
                applyCommonAttributes(rect);
                svg.appendChild(rect);
                break;
            }
            case 'triangle': {
                const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                polygon.setAttribute('points', '32,10 54,50 10,50');
                applyCommonAttributes(polygon);
                svg.appendChild(polygon);
                break;
            }
            case 'rect':
            default: {
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', '8');
                rect.setAttribute('y', '14');
                rect.setAttribute('width', '48');
                rect.setAttribute('height', '36');
                rect.setAttribute('rx', '4');
                rect.setAttribute('ry', '4');
                applyCommonAttributes(rect);
                svg.appendChild(rect);
                break;
            }
        }
        return svg;
    }

    const padX = 20;
    const padY = 6;
    const w = width - padX * 2;
    const h = height - padY * 2;

    switch (preset.shapeType) {
        case 'line': {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(padX));
            line.setAttribute('y1', String(height / 2));
            line.setAttribute('x2', String(width - padX));
            line.setAttribute('y2', String(height / 2));
            applyCommonAttributes(line);
            svg.appendChild(line);
            break;
        }
        case 'arrow': {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            const endX = width - padX;
            const midY = height / 2;
            line.setAttribute('x1', String(padX));
            line.setAttribute('y1', String(midY));
            line.setAttribute('x2', String(endX));
            line.setAttribute('y2', String(midY));
            applyCommonAttributes(line);
            svg.appendChild(line);

            const head = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            head.setAttribute('d', `M${endX - 10} ${midY - 6} L${endX} ${midY} L${endX - 10} ${midY + 6}`);
            head.setAttribute('stroke', strokeColor);
            head.setAttribute('stroke-width', String(strokeWidth));
            head.setAttribute('stroke-opacity', String(strokeOpacity));
            head.setAttribute('stroke-linecap', 'round');
            head.setAttribute('stroke-linejoin', 'round');
            head.setAttribute('fill', 'none');
            svg.appendChild(head);
            break;
        }
        case 'ellipse': {
            const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
            ellipse.setAttribute('cx', String(width / 2));
            ellipse.setAttribute('cy', String(height / 2));
            ellipse.setAttribute('rx', String(w / 2));
            ellipse.setAttribute('ry', String(h / 2));
            applyCommonAttributes(ellipse);
            svg.appendChild(ellipse);
            break;
        }
        case 'rounded-rect': {
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', String(padX));
            rect.setAttribute('y', String(padY));
            rect.setAttribute('width', String(w));
            rect.setAttribute('height', String(h));
            rect.setAttribute('rx', '8');
            rect.setAttribute('ry', '8');
            applyCommonAttributes(rect);
            svg.appendChild(rect);
            break;
        }
        case 'triangle': {
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            const topPt = `${width / 2},${padY}`;
            const rightPt = `${width - padX},${height - padY}`;
            const leftPt = `${padX},${height - padY}`;
            polygon.setAttribute('points', `${topPt} ${rightPt} ${leftPt}`);
            applyCommonAttributes(polygon);
            svg.appendChild(polygon);
            break;
        }
        case 'rect':
        default: {
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', String(padX));
            rect.setAttribute('y', String(padY));
            rect.setAttribute('width', String(w));
            rect.setAttribute('height', String(h));
            rect.setAttribute('rx', '2');
            rect.setAttribute('ry', '2');
            applyCommonAttributes(rect);
            svg.appendChild(rect);
            break;
        }
    }

    return svg;
}

/**
 * Creates a pure DOM 6-dot drag grip icon matching the unified design mockup.
 */
export function create6DotGripSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 20');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const coords: [number, number][] = [
        [4.5, 4], [11.5, 4],
        [4.5, 10], [11.5, 10],
        [4.5, 16], [11.5, 16],
    ];
    for (const [cx, cy] of coords) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(cx));
        circle.setAttribute('cy', String(cy));
        circle.setAttribute('r', '1.5');
        svg.appendChild(circle);
    }
    return svg;
}

/**
 * Pure DOM reusable favorites drawer component.
 * Displays saved presets for pen, highlighter, or shape tools.
 */
export class FavoritesDrawer {
    readonly el: HTMLElement;
    private callbacks: FavoritesDrawerCallbacks;
    private tool: FavoritableTool;
    private favorites: ToolFavoritePreset[] = [];
    private currentSlice: any = null;
    private profiles: { id: string; name: string }[] = [];
    private activeProfileId: string = '';
    private syncFavoriteProfiles: boolean = false;
    private isCreatingProfile: boolean = false;
    private lastValidProfileId: string = '';
    private showDotsIndicator: boolean = false;

    // Gesture tracking state
    private pointerStartX = 0;
    private pointerStartY = 0;
    private isPointerDown = false;

    constructor(
        callbacks: FavoritesDrawerCallbacks,
        initialTool: FavoritableTool = 'pen',
        initialFavorites: readonly ToolFavoritePreset[] = [],
        initialSlice?: any,
        parent?: HTMLElement,
        initialProfiles?: readonly { id: string; name: string }[],
        initialActiveProfileId?: string,
        initialSyncProfiles?: boolean,
        showDotsIndicator?: boolean,
    ) {
        this.callbacks = callbacks;
        this.tool = initialTool;
        this.favorites = [...initialFavorites];
        this.currentSlice = initialSlice ?? null;
        this.syncFavoriteProfiles = Boolean(initialSyncProfiles);
        this.showDotsIndicator = Boolean(showDotsIndicator);

        if (initialProfiles && initialProfiles.length > 0) {
            this.profiles = initialProfiles.map(p => ({ id: p.id, name: p.name }));
        } else if (initialTool === 'shape') {
            this.profiles = DEFAULT_SHAPE_FAVORITE_PROFILES.map(p => ({ id: p.id, name: p.name }));
        } else {
            this.profiles = DEFAULT_STROKE_FAVORITE_PROFILES.map(p => ({ id: p.id, name: p.name }));
        }

        this.activeProfileId = initialActiveProfileId && this.profiles.some(p => p.id === initialActiveProfileId)
            ? initialActiveProfileId
            : (this.profiles[0]?.id || (initialTool === 'shape' ? 'general' : 'notes'));

        this.el = document.createElement('div');
        this.el.className = 'drawer apolo-favorites-drawer';

        this.setupSwipeListeners();

        if (parent) {
            parent.appendChild(this.el);
        }

        this.render();
    }

    private setupSwipeListeners(): void {
        this.el.addEventListener('pointerdown', (e: PointerEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest?.('.apolo-profile-name-input, .apolo-profile-create-btn, .apolo-profile-cancel-btn, .field, .btn-ok')) {
                return;
            }
            this.pointerStartX = e.clientX;
            this.pointerStartY = e.clientY;
            this.isPointerDown = true;
        });

        const onPointerEnd = (e: PointerEvent) => {
            if (!this.isPointerDown) return;
            this.isPointerDown = false;
            const dx = e.clientX - this.pointerStartX;
            const dy = e.clientY - this.pointerStartY;
            if (Math.abs(dx) >= 44 && Math.abs(dx) > Math.abs(dy) * 1.4) {
                this.handleHorizontalSwipe(dx);
            }
        };

        this.el.addEventListener('pointerup', onPointerEnd);
        this.el.addEventListener('pointercancel', () => {
            this.isPointerDown = false;
        });
    }

    public handleHorizontalSwipe(dx: number): void {
        if (this.isCreatingProfile) return;
        const currIdx = this.profiles.findIndex(p => p.id === this.activeProfileId);
        if (currIdx === -1) {
            if (this.profiles.length > 0) {
                this.switchProfile(this.profiles[0].id);
            }
            return;
        }

        if (dx < 0) {
            // Swipe Left (dx < 0): Switch to next profile in current domain (index + 1)
            if (currIdx < this.profiles.length - 1) {
                this.switchProfile(this.profiles[currIdx + 1].id);
            } else {
                // Overswipe beyond last profile -> create profile view
                this.openCreateProfileForm();
            }
        } else if (dx > 0) {
            // Swipe Right (dx > 0): Switch to previous profile in current domain (index - 1)
            if (currIdx > 0) {
                this.switchProfile(this.profiles[currIdx - 1].id);
            } else {
                // Overswipe beyond first profile -> create profile view
                this.openCreateProfileForm();
            }
        }
    }

    public switchProfile(profileId: string): void {
        this.activeProfileId = profileId;
        this.isCreatingProfile = false;
        if (this.callbacks.onSelectProfile) {
            this.callbacks.onSelectProfile(profileId);
        }
        if (this.callbacks.onSwitchProfile) {
            this.callbacks.onSwitchProfile(profileId);
        } else if (!this.callbacks.onSelectProfile) {
            this.render();
        }
        this.callbacks.onProfileModeChange?.('list');
    }

    public renderDotsIndicator(container?: HTMLElement): HTMLElement {
        const dotsContainer = document.createElement('div');
        dotsContainer.className = 'pager popover-header-profile-dots apolo-kit-dots-indicator';

        const currIdx = this.profiles.findIndex(p => p.id === this.activeProfileId);
        const safeIdx = currIdx !== -1 ? currIdx : 0;
        const isLastProfile = safeIdx === this.profiles.length - 1;

        // 1. Prev Navigation Chevron (<)
        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'arrow apolo-kit-nav-btn apolo-kit-nav-prev' + (safeIdx === 0 ? ' is-disabled' : '');
        setAccessibleTooltip(prevBtn, 'Perfil anterior');
        prevBtn.appendChild(createSvg(ICONS.chevronLeft, { size: 12, strokeWidth: 2 }));
        if (safeIdx === 0) {
            prevBtn.disabled = true;
        } else {
            prevBtn.onclick = (e) => {
                e.stopPropagation();
                this.switchProfile(this.profiles[safeIdx - 1].id);
            };
        }
        dotsContainer.appendChild(prevBtn);

        // 2. Track of dots
        const track = document.createElement('div');
        track.className = 'apolo-kit-dots-track';

        this.profiles.forEach((p, idx) => {
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
        addDot.appendChild(createSvg(ICONS.plus, { size: 8, strokeWidth: 2.2 }));
        addDot.onclick = (e) => {
            e.stopPropagation();
            this.openCreateProfileForm();
        };
        track.appendChild(addDot);
        dotsContainer.appendChild(track);

        // 3. Next Navigation Chevron (>)
        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'arrow apolo-kit-nav-btn apolo-kit-nav-next';
        setAccessibleTooltip(nextBtn, isLastProfile ? 'Nuevo perfil' : 'Perfil siguiente');
        nextBtn.appendChild(createSvg(ICONS.chevronRight, { size: 12, strokeWidth: 2 }));
        nextBtn.onclick = (e) => {
            e.stopPropagation();
            if (safeIdx < this.profiles.length - 1) {
                this.switchProfile(this.profiles[safeIdx + 1].id);
            } else {
                this.openCreateProfileForm();
            }
        };
        dotsContainer.appendChild(nextBtn);

        if (container) {
            container.appendChild(dotsContainer);
        }
        return dotsContainer;
    }

    public getIsCreatingProfile(): boolean {
        return this.isCreatingProfile;
    }

    public openCreateProfileForm(): void {
        if (this.activeProfileId && this.profiles.some(p => p.id === this.activeProfileId)) {
            this.lastValidProfileId = this.activeProfileId;
        } else if (this.profiles.length > 0) {
            this.lastValidProfileId = this.profiles[0].id;
        }
        this.isCreatingProfile = true;
        this.render();
        this.callbacks.onProfileModeChange?.('create');
    }

    public closeCreateProfileForm(): void {
        this.isCreatingProfile = false;
        const targetId = this.lastValidProfileId || this.activeProfileId || (this.profiles.length > 0 ? this.profiles[0].id : '');
        if (targetId) {
            this.switchProfile(targetId);
        } else {
            this.render();
            this.callbacks.onProfileModeChange?.('list');
        }
    }

    /**
     * Updates tool, favorites list, and active configuration slice.
     */
    update(
        tool: FavoritableTool,
        favorites: readonly ToolFavoritePreset[],
        currentSlice?: any,
        profiles?: readonly { id: string; name: string }[],
        activeProfileId?: string,
        syncFavoriteProfiles?: boolean,
    ): void {
        this.tool = tool;
        this.favorites = [...favorites];
        this.currentSlice = currentSlice ?? null;
        if (profiles !== undefined && profiles.length > 0) {
            this.profiles = profiles.map(p => ({ id: p.id, name: p.name }));
        }
        if (activeProfileId !== undefined) {
            this.activeProfileId = activeProfileId;
        }
        if (syncFavoriteProfiles !== undefined) {
            this.syncFavoriteProfiles = syncFavoriteProfiles;
        }
        this.render();
    }

    /**
     * Partial state update helper.
     */
    updateState(partial: Partial<{
        tool: FavoritableTool;
        favorites: readonly ToolFavoritePreset[];
        currentSlice: any;
        profiles: readonly { id: string; name: string }[];
        activeProfileId: string;
        syncFavoriteProfiles: boolean;
        isCreatingProfile: boolean;
    }>): void {
        if (partial.tool !== undefined) this.tool = partial.tool;
        if (partial.favorites !== undefined) this.favorites = [...partial.favorites];
        if (partial.currentSlice !== undefined) this.currentSlice = partial.currentSlice;
        if (partial.profiles !== undefined && partial.profiles.length > 0) {
            this.profiles = partial.profiles.map(p => ({ id: p.id, name: p.name }));
        }
        if (partial.activeProfileId !== undefined) this.activeProfileId = partial.activeProfileId;
        if (partial.syncFavoriteProfiles !== undefined) this.syncFavoriteProfiles = partial.syncFavoriteProfiles;
        if (partial.isCreatingProfile !== undefined) this.isCreatingProfile = partial.isCreatingProfile;
        this.render();
    }

    /**
     * Renders or re-renders the drawer contents.
     */
    private render(): void {
        this.el.replaceChildren();

        // 1. Either Create Profile View or Favorites List / Empty State
        if (this.isCreatingProfile) {
            this.renderCreateProfileForm();
            return;
        }

        if (this.favorites.length === 0) {
            this.renderEmptyState();
        } else {
            this.renderFavoritesList();
        }

        if (this.showDotsIndicator && this.profiles.length > 0) {
            this.renderDotsIndicator(this.el);
        }
    }

    /**
     * Renders the inline "Nuevo perfil" creation form.
     */
    private renderCreateProfileForm(): void {
        const form = document.createElement('div');
        form.className = 'field apolo-profile-create-form';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'apolo-profile-name-input';
        input.placeholder = 'Nombre del perfil…';
        input.maxLength = 24;

        const cancel = () => {
            this.closeCreateProfileForm();
        };

        const submit = () => {
            const rawName = input.value.trim();
            const name = rawName || 'Nuevo perfil';
            this.isCreatingProfile = false;
            if (this.callbacks.onCreateProfile) {
                this.callbacks.onCreateProfile(name);
                this.render();
            } else {
                const id = `profile-${Date.now().toString(36)}`;
                this.profiles.push({ id, name });
                this.activeProfileId = id;
                this.favorites = [];
                this.render();
            }
            this.callbacks.onProfileModeChange?.('list');
        };

        const actions = document.createElement('div');
        actions.className = 'apolo-profile-form-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'ibtn apolo-profile-cancel-btn';
        setAccessibleTooltip(cancelBtn, 'Cancelar');
        cancelBtn.appendChild(createSvg(ICONS.close, { size: 14, strokeWidth: 2 }));
        cancelBtn.onclick = (e) => {
            e.stopPropagation();
            cancel();
        };

        const createBtn = document.createElement('button');
        createBtn.type = 'button';
        createBtn.className = 'btn-ok apolo-profile-create-btn';
        setAccessibleTooltip(createBtn, 'Crear perfil');
        createBtn.appendChild(createSvg(ICONS.check, { size: 16, strokeWidth: 2.2 }));
        createBtn.onclick = (e) => {
            e.stopPropagation();
            submit();
        };

        actions.append(cancelBtn, createBtn);

        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
            }
        };

        form.append(input, actions);
        this.el.appendChild(form);

        setTimeout(() => input.focus?.(), 0);
    }

    /**
     * Renders the clean empty state when no favorites exist.
     */
    private renderEmptyState(): void {
        const emptyContainer = document.createElement('div');
        emptyContainer.className = 'empty apolo-favorites-empty';

        const bookmarkIcon = createSvg(ICONS.bookmark, { size: 28 });
        bookmarkIcon.classList.add('empty-ic');

        const text = document.createElement('p');
        text.className = 'empty-txt apolo-favorites-empty-text';
        text.append('Toca ', createSvg(ICONS.star, { size: 13 }), ' para guardar el trazo actual');

        emptyContainer.append(bookmarkIcon, text);
        this.el.appendChild(emptyContainer);
    }

    /**
     * Renders the list of favorite cards.
     */
    private renderFavoritesList(): void {
        const listContainer = document.createElement('div');
        listContainer.className = 'list apolo-favorites-list';
        if (this.tool === 'shape') {
            listContainer.classList.add('is-shape-grid', 'shape-fav-grid');
        }

        const activeFp = this.currentSlice
            ? computeFavoriteFingerprint({ ...this.currentSlice, tool: inferTool(this.currentSlice, this.tool) })
            : '';

        this.favorites.forEach((preset, index) => {
            const isActive = Boolean(activeFp && computeFavoriteFingerprint(preset) === activeFp);
            listContainer.appendChild(this.buildCard(preset, index, isActive));
        });

        this.el.appendChild(listContainer);
    }

    /**
     * Card = [tool glyph] [stroke/shape preview] [thickness dot] + drag handle & actions.
     * Label, thickness number, pattern and fill live in the tooltip / aria-label.
     */
    private buildCard(preset: ToolFavoritePreset, index: number, isActive: boolean): HTMLElement {
        const tooltip = getPresetTooltip(preset);
        const isShape = preset.tool === 'shape';

        const card = document.createElement('div');
        card.className = `card apolo-favorite-card${isActive ? ' is-active' : ''}${isShape ? ' shape-card' : ''}`;
        card.dataset.presetId = preset.id;
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-pressed', String(isActive));
        if (isShape) {
            // Sin atributo title en las tarjetas de forma para evitar tooltips no deseados
            card.setAttribute('aria-label', tooltip);
        } else {
            setAccessibleTooltip(card, tooltip);
        }

        card.onclick = () => this.callbacks.onSelectFavorite(preset);
        card.onkeydown = (e) => {
            if (e.target !== card) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.callbacks.onSelectFavorite(preset);
            }
        };

        // 1) Tool glyph (omitted for shape cards per design requirement)
        let glyph: HTMLElement | null = null;
        if (!isShape) {
            glyph = document.createElement('span');
            glyph.className = 'glyph apolo-favorite-glyph';
            glyph.appendChild(createSvg(getPresetIcon(preset), { size: 18 }));
        }

        // 2) Preview (shapes use square shape-stage; strokes use wave)
        const previewEl = document.createElement('div');
        if (isShape) {
            previewEl.className = 'shape-stage preview apolo-favorite-preview';
            previewEl.appendChild(createShapePreview(preset as ShapeFavoritePreset));
        } else {
            previewEl.className = 'preview apolo-favorite-preview';
            const stroke = preset as PenFavoritePreset | HighlighterFavoritePreset;
            previewEl.appendChild(
                createStrokeWavePreview(stroke.color, stroke.width, stroke.profileId, stroke.opacity, stroke.pattern, 220, 32),
            );
        }

        // 3) Drag Handle (Reorder & Drag out to delete)
        const handleBtn = document.createElement('button');
        handleBtn.type = 'button';
        handleBtn.className = 'grip apolo-favorite-handle-wrap apolo-favorite-drag-handle';
        setAccessibleTooltip(handleBtn, 'Arrastrar para reordenar o sacar para eliminar');
        handleBtn.appendChild(create6DotGripSvg());

        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let currentTargetIdx = index;
        let isDragOut = false;

        handleBtn.onpointerdown = (e: PointerEvent) => {
            e.stopPropagation();
            try {
                handleBtn.setPointerCapture(e.pointerId);
            } catch (_) {}

            isDragging = false;
            isDragOut = false;
            startX = e.clientX;
            startY = e.clientY;
            currentTargetIdx = index;

            const listEl = card.parentElement as HTMLElement | null;
            const allCards = listEl ? (Array.from(listEl.children) as HTMLElement[]) : [];
            const drawerRect = this.el.getBoundingClientRect();
            const isShape = this.tool === 'shape';
            const cardHeight = (card.offsetHeight || (isShape ? 96 : 48)) + (isShape ? 8 : 4);
            const cardWidth = (card.offsetWidth || 138) + 8;

            // Pre-calculate resting slot centers for all cards before any transforms
            const slotCenters = allCards.map((c, idx) => {
                const r = c.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                    return {
                        x: r.left + r.width / 2,
                        y: r.top + r.height / 2,
                    };
                }
                // Fallback for headless / simulated environments without layout engine
                if (isShape) {
                    const col = idx % 2;
                    const row = Math.floor(idx / 2);
                    return {
                        x: drawerRect.left + col * cardWidth + cardWidth / 2,
                        y: drawerRect.top + row * cardHeight + cardHeight / 2,
                    };
                }
                return {
                    x: drawerRect.left + 150,
                    y: drawerRect.top + idx * cardHeight + cardHeight / 2,
                };
            });

            const originX = slotCenters[index]?.x ?? startX;
            const originY = slotCenters[index]?.y ?? startY;

            const onPointerMove = (moveEv: PointerEvent) => {
                const dx = moveEv.clientX - startX;
                const dy = moveEv.clientY - startY;

                if (!isDragging && Math.hypot(dx, dy) > 4) {
                    isDragging = true;
                    card.classList.add('is-dragging');
                    card.style.zIndex = '30';
                    card.style.transition = 'none';
                }

                if (!isDragging) return;

                // For shapes in a 2-column grid, horizontal movement across columns is standard reordering
                // and must NOT trigger accidental deletion. Deletion only triggers when dragging out
                // beyond the popover drawer boundaries.
                const isOutside = isShape
                    ? (moveEv.clientX < drawerRect.left - 30 ||
                       moveEv.clientX > drawerRect.right + 30 ||
                       moveEv.clientY < drawerRect.top - 30 ||
                       moveEv.clientY > drawerRect.bottom + 30)
                    : (moveEv.clientX < drawerRect.left - 15 ||
                       moveEv.clientX > drawerRect.right + 15 ||
                       Math.abs(dx) > 100);

                if (isOutside) {
                    isDragOut = true;
                    card.classList.add('is-drag-out');
                    card.style.transform = `translate(${dx}px, ${dy}px) scale(0.94)`;
                    allCards.forEach(c => {
                        if (c !== card) {
                            c.style.transform = '';
                            c.style.transition = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)';
                        }
                    });
                } else {
                    isDragOut = false;
                    card.classList.remove('is-drag-out');
                    card.style.transform = `translate(${dx}px, ${dy}px) scale(1.02)`;

                    // Find closest slot by Euclidean distance to dragged card center
                    const draggedCenterX = originX + dx;
                    const draggedCenterY = originY + dy;
                    let bestIdx = index;
                    let minDist = Infinity;
                    for (let j = 0; j < slotCenters.length; j++) {
                        const dist = Math.hypot(draggedCenterX - slotCenters[j].x, draggedCenterY - slotCenters[j].y);
                        if (dist < minDist) {
                            minDist = dist;
                            bestIdx = j;
                        }
                    }
                    currentTargetIdx = bestIdx;

                    allCards.forEach((c, cIdx) => {
                        if (c === card) return;
                        c.style.transition = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)';

                        let targetSlot = cIdx;
                        if (index < currentTargetIdx) {
                            if (cIdx > index && cIdx <= currentTargetIdx) {
                                targetSlot = cIdx - 1;
                            }
                        } else if (index > currentTargetIdx) {
                            if (cIdx >= currentTargetIdx && cIdx < index) {
                                targetSlot = cIdx + 1;
                            }
                        }

                        if (targetSlot === cIdx || !slotCenters[targetSlot] || !slotCenters[cIdx]) {
                            c.style.transform = '';
                        } else {
                            const shiftX = slotCenters[targetSlot].x - slotCenters[cIdx].x;
                            const shiftY = slotCenters[targetSlot].y - slotCenters[cIdx].y;
                            c.style.transform = `translate(${shiftX}px, ${shiftY}px)`;
                        }
                    });
                }
            };

            const onPointerUp = (upEv: PointerEvent) => {
                try {
                    handleBtn.releasePointerCapture(upEv.pointerId);
                } catch (_) {}
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerUp);

                if (!isDragging) return;

                if (isDragOut) {
                    const finalDx = upEv.clientX - startX;
                    const flyX = finalDx >= 0 ? 180 : -180;
                    card.style.transition = 'transform 0.22s ease, opacity 0.2s ease, max-height 0.22s ease, margin 0.22s ease, padding 0.22s ease';
                    card.style.transform = `translate(${flyX}px, ${upEv.clientY - startY}px) scale(0.7)`;
                    card.style.opacity = '0';
                    card.style.maxHeight = '0';
                    card.style.padding = '0';
                    card.style.margin = '0';
                    card.style.overflow = 'hidden';

                    setTimeout(() => {
                        this.callbacks.onDeleteFavorite(preset.id);
                    }, 220);
                } else {
                    card.classList.remove('is-dragging');
                    if (currentTargetIdx !== index && slotCenters[currentTargetIdx] && slotCenters[index]) {
                        const dropDx = slotCenters[currentTargetIdx].x - slotCenters[index].x;
                        const dropDy = slotCenters[currentTargetIdx].y - slotCenters[index].y;
                        card.style.transition = 'transform 0.18s cubic-bezier(0.2, 0, 0, 1)';
                        card.style.transform = `translate(${dropDx}px, ${dropDy}px)`;
                        setTimeout(() => {
                            allCards.forEach(c => {
                                c.style.transform = '';
                                c.style.transition = '';
                                c.style.zIndex = '';
                            });
                            this.callbacks.onReorderFavorite(index, currentTargetIdx);
                        }, 180);
                    } else {
                        card.style.transition = 'transform 0.18s ease';
                        card.style.transform = 'translate(0px, 0px)';
                        setTimeout(() => {
                            allCards.forEach(c => {
                                c.style.transform = '';
                                c.style.transition = '';
                                c.style.zIndex = '';
                            });
                        }, 180);
                    }
                }
            };

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
        };

        // Native HTML5 Drag and Drop fallback on card
        card.ondragstart = (e) => {
            e.dataTransfer?.setData('text/plain', String(index));
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
            }
            card.classList.add('is-dragging');
        };

        card.ondragover = (e) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
            }
            card.classList.add('is-drag-over');
        };

        card.ondragleave = () => {
            card.classList.remove('is-drag-over');
        };

        card.ondrop = (e) => {
            e.preventDefault();
            card.classList.remove('is-drag-over');
            const rawFrom = e.dataTransfer?.getData('text/plain');
            const fromIdx = Number(rawFrom);
            if (!isNaN(fromIdx) && fromIdx !== index && fromIdx >= 0 && fromIdx < this.favorites.length) {
                this.callbacks.onReorderFavorite(fromIdx, index);
            }
        };

        card.ondragend = () => {
            card.classList.remove('is-dragging');
            card.classList.remove('is-drag-over');
            card.removeAttribute('draggable');
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'apolo-favorite-delete-btn';
        deleteBtn.style.display = 'none';
        deleteBtn.setAttribute('aria-hidden', 'true');
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            this.callbacks.onDeleteFavorite(preset.id);
        };

        if (isShape) {
            card.append(previewEl, handleBtn, deleteBtn);
        } else {
            if (glyph) {
                card.append(glyph, previewEl, handleBtn, deleteBtn);
            } else {
                card.append(previewEl, handleBtn, deleteBtn);
            }
        }

        return card;
    }

    /**
     * Removes the drawer from the DOM.
     */
    destroy(): void {
        this.el.remove();
    }
}
