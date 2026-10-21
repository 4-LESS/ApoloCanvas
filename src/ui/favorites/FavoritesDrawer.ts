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
import { ICONS, createSvg, createStrokeWavePreview, mapInkColorForDark } from '../theme.ts';

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
        case 'fountain': return ICONS.feather;
        case 'calli': return ICONS.pen;
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
    const parts = [getPresetLabel(preset), `${preset.width}px`];
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
    width = 140,
    height = 36,
): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');

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
        this.el.className = 'apolo-favorites-drawer';

        this.setupSwipeListeners();

        this.el.addEventListener('click', (e) => {
            const target = e.target as HTMLElement | null;
            if (!target?.closest?.('.apolo-favorite-handle-wrap')) {
                this.el.querySelectorAll('.apolo-card-menu').forEach((m) => {
                    (m as HTMLElement).style.display = 'none';
                });
            }
        });

        if (parent) {
            parent.appendChild(this.el);
        }

        this.render();
    }

    private setupSwipeListeners(): void {
        this.el.addEventListener('pointerdown', (e: PointerEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest?.('.apolo-profile-name-input, .apolo-profile-create-btn, .apolo-profile-cancel-btn')) {
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
        dotsContainer.className = 'apolo-kit-dots-indicator';
        dotsContainer.style.display = 'flex';
        dotsContainer.style.alignItems = 'center';
        dotsContainer.style.justifyContent = 'center';
        dotsContainer.style.gap = '6px';

        const currIdx = this.profiles.findIndex(p => p.id === this.activeProfileId);
        const safeIdx = currIdx !== -1 ? currIdx : 0;
        const isLastProfile = safeIdx === this.profiles.length - 1;

        // 1. Prev Navigation Chevron (<)
        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'apolo-kit-nav-btn apolo-kit-nav-prev';
        prevBtn.title = 'Perfil anterior';
        prevBtn.setAttribute('aria-label', 'Perfil anterior');
        prevBtn.appendChild(createSvg(ICONS.chevronLeft, { size: 12, strokeWidth: 2 }));
        if (safeIdx === 0) {
            prevBtn.classList.add('is-disabled');
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
            dot.className = `popover-header-dot apolo-kit-dot${isActive ? ' is-active' : ''}`;
            dot.title = p.name;
            dot.setAttribute('aria-label', `Perfil ${p.name}`);
            dot.onclick = (e) => {
                e.stopPropagation();
                this.switchProfile(p.id);
            };
            track.appendChild(dot);
        });

        // Add Profile dot indicator at the end
        const addDot = document.createElement('button');
        addDot.type = 'button';
        addDot.className = `popover-header-dot apolo-kit-dot is-add-dot${isLastProfile ? ' is-next-hint' : ''}`;
        addDot.title = 'Nuevo perfil';
        addDot.setAttribute('aria-label', 'Crear nuevo perfil');
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
        nextBtn.className = 'apolo-kit-nav-btn apolo-kit-nav-next';
        nextBtn.title = isLastProfile ? 'Nuevo perfil' : 'Perfil siguiente';
        nextBtn.setAttribute('aria-label', nextBtn.title);
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

    public openCreateProfileForm(): void {
        this.isCreatingProfile = true;
        this.render();
        this.callbacks.onProfileModeChange?.('create');
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
        form.className = 'apolo-profile-create-form';

        const title = document.createElement('span');
        title.className = 'apolo-profile-create-title';
        title.textContent = 'Nuevo perfil';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'apolo-profile-name-input';
        input.placeholder = 'Nombre del nuevo perfil...';
        input.maxLength = 24;

        const actions = document.createElement('div');
        actions.className = 'apolo-profile-create-actions';

        const cancel = () => {
            this.isCreatingProfile = false;
            this.render();
            this.callbacks.onProfileModeChange?.('list');
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'apolo-profile-cancel-btn';
        cancelBtn.textContent = 'Cancelar';
        cancelBtn.onclick = (e) => {
            e.stopPropagation();
            cancel();
        };

        const createBtn = document.createElement('button');
        createBtn.type = 'button';
        createBtn.className = 'apolo-profile-create-btn';
        createBtn.textContent = 'Crear';

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

        createBtn.onclick = (e) => {
            e.stopPropagation();
            submit();
        };

        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
            }
        };

        actions.append(cancelBtn, createBtn);
        form.append(title, input, actions);
        this.el.appendChild(form);

        setTimeout(() => input.focus?.(), 0);
    }

    /**
     * Renders the clean empty state when no favorites exist.
     */
    private renderEmptyState(): void {
        const emptyContainer = document.createElement('div');
        emptyContainer.className = 'apolo-favorites-empty';

        const bookmarkIcon = createSvg(ICONS.bookmark, { size: 24 });
        const text = document.createElement('p');
        text.className = 'apolo-favorites-empty-text';
        text.append('Toca ', createSvg(ICONS.star, { size: 13 }), ' para guardar el trazo actual');

        emptyContainer.append(bookmarkIcon, text);
        this.el.appendChild(emptyContainer);
    }

    /**
     * Renders the list of favorite cards.
     */
    private renderFavoritesList(): void {
        const listContainer = document.createElement('div');
        listContainer.className = 'apolo-favorites-list';

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

        const card = document.createElement('div');
        card.className = `apolo-favorite-card${isActive ? ' is-active' : ''}`;
        card.dataset.presetId = preset.id;
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-pressed', String(isActive));
        card.setAttribute('aria-label', tooltip);
        card.title = tooltip;

        card.onclick = () => this.callbacks.onSelectFavorite(preset);
        card.onkeydown = (e) => {
            if (e.target !== card) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.callbacks.onSelectFavorite(preset);
            }
        };

        // 1) Tool glyph
        const glyph = document.createElement('span');
        glyph.className = 'apolo-favorite-glyph';
        glyph.appendChild(createSvg(getPresetIcon(preset), { size: 18 }));

        // 2) Preview (wave is drawn wide; shapes keep their compact box)
        const previewWrap = document.createElement('div');
        previewWrap.className = 'apolo-favorite-preview-wrap';

        const previewEl = document.createElement('div');
        previewEl.className = 'apolo-favorite-preview';
        if (preset.tool === 'pen' || preset.tool === 'highlighter') {
            const stroke = preset as PenFavoritePreset | HighlighterFavoritePreset;
            previewEl.appendChild(
                createStrokeWavePreview(stroke.color, stroke.width, stroke.profileId, stroke.opacity, stroke.pattern, 220, 32),
            );
        } else if (preset.tool === 'shape') {
            previewEl.appendChild(createShapePreview(preset as ShapeFavoritePreset));
        }
        previewWrap.appendChild(previewEl);

        if (preset.name) {
            const nameBadge = document.createElement('span');
            nameBadge.className = 'apolo-favorite-custom-name';
            nameBadge.textContent = preset.name;
            previewWrap.appendChild(nameBadge);
        }

        // 3) Thickness as a dot instead of "7px"
        const size = document.createElement('span');
        size.className = 'apolo-favorite-size';
        size.setAttribute('aria-hidden', 'true');
        const dot = document.createElement('span');
        dot.className = 'apolo-favorite-size-dot';
        dot.style.setProperty('--dot', `${Math.max(3, Math.min(14, 2 + preset.width * 0.8))}px`);
        size.appendChild(dot);

        // 4) Drag Handle & Contextual Menu (Rename & Delete)
        const handleWrap = document.createElement('div');
        handleWrap.className = 'apolo-favorite-handle-wrap';

        const handleBtn = document.createElement('button');
        handleBtn.type = 'button';
        handleBtn.className = 'apolo-favorite-drag-handle';
        handleBtn.title = 'Arrastrar para reordenar / Clic para opciones';
        handleBtn.setAttribute('aria-label', 'Mover o editar favorito');
        handleBtn.appendChild(createSvg(ICONS.dragGrip, {
            size: 14,
            width: 14,
            height: 14,
            viewBox: '0 0 14 14',
            fill: 'currentColor',
            stroke: 'none',
            strokeWidth: 0,
        }));

        const menu = document.createElement('div');
        menu.className = 'apolo-card-menu';
        menu.style.display = 'none';

        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'apolo-card-menu-btn apolo-card-rename-btn';
        renameBtn.title = 'Cambiar nombre';
        renameBtn.setAttribute('aria-label', 'Cambiar nombre');
        renameBtn.appendChild(createSvg(ICONS.pencil, { size: 14, strokeWidth: 1.8 }));
        renameBtn.onclick = (e) => {
            e.stopPropagation();
            menu.style.display = 'none';
            this.openRenameCardRow(card, preset);
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'apolo-card-menu-btn apolo-favorite-delete-btn';
        deleteBtn.title = 'Eliminar favorito';
        deleteBtn.setAttribute('aria-label', 'Eliminar favorito');
        deleteBtn.appendChild(createSvg(ICONS.trash, { size: 14, strokeWidth: 1.8 }));
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            menu.style.display = 'none';
            this.callbacks.onDeleteFavorite(preset.id);
        };

        menu.append(renameBtn, deleteBtn);
        handleWrap.append(handleBtn, menu);

        // Dragging & Clicking interactions
        let isDragging = false;
        let startX = 0;
        let startY = 0;

        handleBtn.onpointerdown = (e) => {
            e.stopPropagation();
            isDragging = false;
            startX = e.clientX;
            startY = e.clientY;
            card.setAttribute('draggable', 'true');

            const onPointerMove = (moveEv: PointerEvent) => {
                const dy = moveEv.clientY - startY;
                const dx = moveEv.clientX - startX;
                if (Math.hypot(dx, dy) > 6) {
                    isDragging = true;
                    card.classList.add('is-dragging');
                }
            };

            const onPointerUp = (upEv: PointerEvent) => {
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                card.removeAttribute('draggable');
                card.classList.remove('is-dragging');

                if (isDragging) {
                    const elemBelow = document.elementFromPoint(upEv.clientX, upEv.clientY);
                    const targetCard = elemBelow?.closest?.('.apolo-favorite-card') as HTMLElement | null;
                    if (targetCard && targetCard !== card) {
                        const targetId = targetCard.dataset.presetId;
                        const toIdx = this.favorites.findIndex(f => f.id === targetId);
                        if (toIdx !== -1 && toIdx !== index) {
                            this.callbacks.onReorderFavorite(index, toIdx);
                        }
                    }
                }
            };

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
        };

        handleBtn.onclick = (e) => {
            e.stopPropagation();
            if (isDragging) return;
            const isShowing = menu.style.display !== 'none';
            this.el.querySelectorAll('.apolo-card-menu').forEach((m) => {
                (m as HTMLElement).style.display = 'none';
            });
            menu.style.display = isShowing ? 'none' : 'flex';
        };

        // Native HTML5 Drag and Drop on card
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

        card.append(glyph, previewWrap, size, handleWrap);
        return card;
    }

    private openRenameCardRow(card: HTMLElement, preset: ToolFavoritePreset): void {
        const originalChildren = Array.from(card.children);
        originalChildren.forEach((child) => {
            (child as HTMLElement).style.display = 'none';
        });

        const renameRow = document.createElement('div');
        renameRow.className = 'apolo-card-rename-row';
        renameRow.onclick = (e) => e.stopPropagation();

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'apolo-card-rename-input';
        input.value = preset.name || getPresetLabel(preset);
        input.maxLength = 28;
        input.placeholder = 'Nombre del favorito...';

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'apolo-card-rename-btn apolo-card-rename-save';
        saveBtn.title = 'Guardar nombre';
        saveBtn.setAttribute('aria-label', 'Guardar nombre');
        saveBtn.appendChild(createSvg(ICONS.check, { size: 14, strokeWidth: 2.2 }));

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'apolo-card-rename-btn apolo-card-rename-cancel';
        cancelBtn.title = 'Cancelar';
        cancelBtn.setAttribute('aria-label', 'Cancelar');
        cancelBtn.appendChild(createSvg(ICONS.close, { size: 14, strokeWidth: 2 }));

        const finish = () => {
            renameRow.remove();
            originalChildren.forEach((child) => {
                (child as HTMLElement).style.display = '';
            });
        };

        const submit = () => {
            const val = input.value.trim();
            preset.name = val || undefined;
            this.callbacks.onRenameFavorite?.(preset.id, val);
            finish();
            this.render();
        };

        saveBtn.onclick = (e) => {
            e.stopPropagation();
            submit();
        };

        cancelBtn.onclick = (e) => {
            e.stopPropagation();
            finish();
        };

        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finish();
            }
        };

        renameRow.append(input, saveBtn, cancelBtn);
        card.appendChild(renameRow);
        setTimeout(() => input.focus?.(), 0);
    }

    /**
     * Removes the drawer from the DOM.
     */
    destroy(): void {
        this.el.remove();
    }
}
