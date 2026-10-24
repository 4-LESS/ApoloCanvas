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
import { getShapePlugin } from '../../engine/shapes/index.ts';
import { ICONS, createSvg, createStrokeWavePreview, mapInkColorForDark, setAccessibleTooltip } from '../theme.ts';

export type DrawerDragState = 'idle' | 'dragging' | 'drag-out' | 'dropping' | 'cancelled';

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

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
}

export function getPresetLabel(preset: ToolFavoritePreset): string {
    if (preset.name && preset.name.trim().length > 0) return preset.name.trim();
    if (preset.tool === 'pen') {
        const labels: Record<string, string> = {
            fountain: 'Estilográfica', calli: 'Caligráfica', ball: 'Bolígrafo',
            pencil: 'Lápiz', hlr: 'Marcador redondo', hlf: 'Marcador plano',
        };
        return labels[(preset as PenFavoritePreset).profileId] || 'Pluma';
    }
    if (preset.tool === 'highlighter') {
        return (preset as HighlighterFavoritePreset).profileId === 'hlf' ? 'Marcador plano' : 'Marcador redondo';
    }
    if (preset.tool === 'shape') {
        const labels: Record<string, string> = {
            rect: 'Rectángulo', 'rounded-rect': 'Rectángulo redondeado',
            ellipse: 'Círculo', triangle: 'Triángulo', line: 'Línea', arrow: 'Flecha',
        };
        return labels[(preset as ShapeFavoritePreset).shapeType] || 'Forma';
    }
    return 'Favorito';
}

export function getPresetIcon(preset: ToolFavoritePreset): string {
    if (preset.tool === 'shape') {
        const shapes = ICONS.shapes as Record<string, string>;
        const type = (preset as ShapeFavoritePreset).shapeType;
        const key = type === 'ellipse' ? 'circle' : type === 'rounded-rect' ? 'rect' : type;
        return shapes[key] ?? shapes.rect;
    }
    const profileId = (preset as PenFavoritePreset | HighlighterFavoritePreset).profileId;
    const map: Record<string, string> = {
        fountain: ICONS.pen, calli: ICONS.feather, ball: ICONS.ballpoint,
        pencil: ICONS.pencil, hlf: ICONS.highlighterChisel, hlr: ICONS.highlighterRound,
    };
    return map[profileId] || (preset.tool === 'highlighter' ? ICONS.highlighter : ICONS.pen);
}

export function getPresetTooltip(preset: ToolFavoritePreset): string {
    const parts: string[] = [];
    if (preset.name) parts.push(preset.name);
    parts.push(getPresetLabel(preset), `${preset.width}px`);
    if (preset.pattern === 'dashed') parts.push('rayas');
    else if (preset.pattern === 'dotted') parts.push('puntos');
    if (preset.tool === 'shape' && (preset as ShapeFavoritePreset).fillEnabled) parts.push('relleno');
    return parts.join(' · ');
}

export function createShapePreview(
    preset: ShapeFavoritePreset,
    width = 64,
    height = 64,
): SVGSVGElement {
    const svg = svgEl('svg', {
        width, height, viewBox: `0 0 ${width} ${height}`,
        fill: 'none', 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid meet',
    });

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
        if (fill !== 'none') el.setAttribute('fill-opacity', String(fillOpacity));
        if (pattern === 'dashed') {
            el.setAttribute('stroke-dasharray', `${Math.max(6, Math.round(strokeWidth * 2.5))} ${Math.max(4, Math.round(strokeWidth * 1.8))}`);
            el.setAttribute('stroke-linecap', 'butt');
        } else if (pattern === 'dotted') {
            el.setAttribute('stroke-dasharray', `0.1 ${Math.max(4, Math.round(strokeWidth * 2))}`);
            el.setAttribute('stroke-linecap', 'round');
        } else {
            el.setAttribute('stroke-linecap', 'round');
        }
        el.setAttribute('stroke-linejoin', 'round');
    };

    const isSquare = width === height;
    const padX = 20, padY = 6, w = width - padX * 2, h = height - padY * 2;
    const addWithCommon = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
        const el = svgEl(tag, attrs);
        applyCommonAttributes(el);
        svg.appendChild(el);
    };

    switch (preset.shapeType) {
        case 'line':
            addWithCommon('line', isSquare
                ? { x1: 12, y1: 52, x2: 52, y2: 12 }
                : { x1: padX, y1: height / 2, x2: width - padX, y2: height / 2 });
            break;
        case 'arrow': {
            const endX = width - padX, midY = height / 2;
            addWithCommon('line', isSquare
                ? { x1: 14, y1: 50, x2: 50, y2: 14 }
                : { x1: padX, y1: midY, x2: endX, y2: midY });
            svg.appendChild(svgEl('path', {
                d: isSquare ? 'M35 14 H50 V29' : `M${endX - 10} ${midY - 6} L${endX} ${midY} L${endX - 10} ${midY + 6}`,
                stroke: strokeColor, 'stroke-width': strokeWidth, 'stroke-opacity': strokeOpacity,
                'stroke-linecap': 'round', 'stroke-linejoin': 'round',
                ...(isSquare ? { 'vector-effect': 'non-scaling-stroke' } : {}),
                fill: 'none',
            }));
            break;
        }
        case 'ellipse':
            addWithCommon('ellipse', isSquare
                ? { cx: 32, cy: 32, rx: 22, ry: 22 }
                : { cx: width / 2, cy: height / 2, rx: w / 2, ry: h / 2 });
            break;
        case 'rounded-rect':
            addWithCommon('rect', isSquare
                ? { x: 8, y: 14, width: 48, height: 36, rx: 8, ry: 8 }
                : { x: padX, y: padY, width: w, height: h, rx: 8, ry: 8 });
            break;
        case 'triangle':
            addWithCommon('polygon', {
                points: isSquare ? '32,10 54,50 10,50' : `${width / 2},${padY} ${width - padX},${height - padY} ${padX},${height - padY}`,
            });
            break;
        case 'cylinder':
        case 'diamond':
        case 'hexagon': {
            const plugin = getShapePlugin(preset.shapeType);
            const pad = isSquare ? 10 : 8;
            const geom = {
                x0: pad,
                y0: pad,
                x1: width - pad,
                y1: height - pad,
            };
            const style = {
                strokeColor,
                strokeWidth,
                strokeOpacity,
                strokePattern: pattern as any,
                fillEnabled: preset.fillEnabled,
                fillColor: fill,
                fillOpacity,
                fillPattern: preset.fillPattern ?? 'solid',
            };
            const rendered = plugin.renderSvg(geom, style);
            if (rendered.defs && Object.keys(rendered.defs).length > 0) {
                let defsEl = svg.querySelector('defs');
                if (!defsEl) {
                    defsEl = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                    if (typeof svg.prepend === 'function') {
                        svg.prepend(defsEl);
                    } else if (typeof svg.insertBefore === 'function') {
                        svg.insertBefore(defsEl, svg.firstChild);
                    } else {
                        svg.appendChild(defsEl);
                    }
                }
                const defsContainer = createSvg(`<svg>${Object.values(rendered.defs).join('')}</svg>`);
                for (const child of Array.from(defsContainer.children ?? [])) {
                    defsEl.appendChild(child);
                }
            }
            if (rendered.body) {
                const bodyContainer = createSvg(`<svg>${rendered.body}</svg>`);
                for (const child of Array.from(bodyContainer.children ?? [])) {
                    svg.appendChild(child);
                }
            }
            break;
        }
        case 'rect':
        default:
            addWithCommon('rect', isSquare
                ? { x: 8, y: 14, width: 48, height: 36, rx: 4, ry: 4 }
                : { x: padX, y: padY, width: w, height: h, rx: 2, ry: 2 });
            break;
    }

    return svg;
}

export function create6DotGripSvg(): SVGSVGElement {
    const svg = svgEl('svg', { viewBox: '0 0 16 20', fill: 'currentColor', 'aria-hidden': 'true' });
    svg.style.pointerEvents = 'none';
    svg.style.touchAction = 'none';
    for (const [cx, cy] of [[4.5, 4], [11.5, 4], [4.5, 10], [11.5, 10], [4.5, 16], [11.5, 16]]) {
        const circle = svgEl('circle', { cx, cy, r: 1.5 });
        circle.style.pointerEvents = 'none';
        circle.style.touchAction = 'none';
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
    private activeDragAbort: (() => void) | null = null;

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
            if (target?.closest?.('.apolo-profile-name-input, .apolo-profile-create-btn, .apolo-profile-cancel-btn, .field, .btn-ok, .apolo-favorite-drag-handle, .grip')) {
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
        if (this.activeDragAbort) {
            this.activeDragAbort();
            this.activeDragAbort = null;
        }
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
        handleBtn.style.touchAction = 'none';
        handleBtn.style.userSelect = 'none';
        handleBtn.appendChild(create6DotGripSvg());

        // Intercept native touchstart on drag handle with passive: false to prevent
        // Android WebView compositor from intercepting pure vertical drags for scrolling.
        const onHandleTouchStart = (touchEv: TouchEvent) => {
            if (touchEv.cancelable) {
                touchEv.preventDefault();
            }
            touchEv.stopPropagation();
        };
        handleBtn.addEventListener('touchstart', onHandleTouchStart, { passive: false });
        handleBtn.addEventListener('touchmove', (touchEv: TouchEvent) => {
            if (touchEv.cancelable) {
                touchEv.preventDefault();
            }
        }, { passive: false });

        let dragState: DrawerDragState = 'idle';
        let startX = 0;
        let startY = 0;
        let currentTargetIdx = index;
        let dropTimeout: ReturnType<typeof setTimeout> | null = null;
        let touchMoveWindowHandler: ((ev: TouchEvent) => void) | null = null;

        handleBtn.onpointerdown = (e: PointerEvent) => {
            if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
            if (typeof e.preventDefault === 'function') {
                e.preventDefault();
            }
            if (typeof e.stopPropagation === 'function') {
                e.stopPropagation();
            }
            try {
                handleBtn.setPointerCapture(e.pointerId);
            } catch (_) {}

            if (this.activeDragAbort) {
                this.activeDragAbort();
                this.activeDragAbort = null;
            }

            dragState = 'idle';
            startX = e.clientX;
            startY = e.clientY;
            currentTargetIdx = index;

            const listEl = card.parentElement as HTMLElement | null;
            const allCards = listEl ? (Array.from(listEl.children) as HTMLElement[]) : [];
            const drawerRect = this.el.getBoundingClientRect();
            const isShape = this.tool === 'shape';
            const cardHeight = (card.offsetHeight || (isShape ? 96 : 48)) + (isShape ? 8 : 4);
            const cardWidth = (card.offsetWidth || 138) + 8;

            // Immediately lock scrolling on the list and card to prevent Android WebView
            // from claiming any pure vertical motion as native scroll before drag threshold.
            const originalListTouchAction = listEl ? (listEl.style.touchAction || '') : '';
            const originalListOverflow = listEl ? (listEl.style.overflow || '') : '';
            if (listEl) {
                listEl.classList.add('is-dragging-active');
                listEl.style.touchAction = 'none';
                listEl.style.overflow = 'hidden';
            }
            card.style.touchAction = 'none';

            // Global window touchmove interceptor during active drag to forbid browser scrolling
            touchMoveWindowHandler = (touchEv: TouchEvent) => {
                if (touchEv.cancelable) {
                    touchEv.preventDefault();
                }
            };
            window.addEventListener('touchmove', touchMoveWindowHandler, { passive: false });

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

            const cleanupDragTransforms = () => {
                if (dropTimeout) {
                    clearTimeout(dropTimeout);
                    dropTimeout = null;
                }
                if (touchMoveWindowHandler) {
                    window.removeEventListener('touchmove', touchMoveWindowHandler);
                    touchMoveWindowHandler = null;
                }
                card.classList.remove('is-dragging', 'is-drag-out');
                card.style.zIndex = '';
                card.style.opacity = '';
                card.style.maxHeight = '';
                card.style.padding = '';
                card.style.margin = '';
                card.style.overflow = '';
                card.style.transform = '';
                card.style.transition = '';
                card.style.touchAction = '';
                allCards.forEach(c => {
                    c.style.transform = '';
                    c.style.transition = '';
                    c.style.zIndex = '';
                    c.style.touchAction = '';
                });
                if (listEl) {
                    listEl.classList.remove('is-dragging-active');
                    listEl.style.touchAction = originalListTouchAction;
                    listEl.style.overflow = originalListOverflow;
                }
                dragState = 'idle';
                this.activeDragAbort = null;
            };

            const onPointerMove = (moveEv: PointerEvent) => {
                if (moveEv.pointerId !== undefined && e.pointerId !== undefined && moveEv.pointerId !== e.pointerId) return;
                if (dragState === 'dropping' || dragState === 'cancelled') return;
                if (typeof moveEv.preventDefault === 'function') {
                    moveEv.preventDefault();
                }

                const dx = moveEv.clientX - startX;
                const dy = moveEv.clientY - startY;

                if (dragState === 'idle' && Math.hypot(dx, dy) > 4) {
                    dragState = 'dragging';
                    card.classList.add('is-dragging');
                    card.style.zIndex = '30';
                    card.style.transition = 'none';
                }

                if (dragState !== 'dragging' && dragState !== 'drag-out') return;

                // Deletion triggers strictly when dragging intentionally outside the drawer boundaries.
                // Reordering occurs anywhere inside the drawer without accidental deletion from horizontal swiping.
                const isOutside = (
                    moveEv.clientX < drawerRect.left - 24 ||
                    moveEv.clientX > drawerRect.right + 24 ||
                    moveEv.clientY < drawerRect.top - 24 ||
                    moveEv.clientY > drawerRect.bottom + 24
                );

                if (isOutside) {
                    dragState = 'drag-out';
                    card.classList.add('is-drag-out');
                    card.style.transform = `translate(${dx}px, ${dy}px) scale(0.94)`;
                    allCards.forEach(c => {
                        if (c !== card) {
                            c.style.transform = '';
                            c.style.transition = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)';
                        }
                    });
                } else {
                    dragState = 'dragging';
                    card.classList.remove('is-drag-out');
                    card.style.transform = `translate(${dx}px, ${dy}px) scale(1.02)`;

                    // Determine closest target slot:
                    // In 2D shape grid (2 columns), map directly by grid row and column
                    // In 1D stroke list, map primarily by vertical row progression
                    const draggedCenterX = originX + dx;
                    const draggedCenterY = originY + dy;
                    let bestIdx = index;

                    if (isShape && slotCenters.length > 1) {
                        const col0X = slotCenters[0]?.x ?? originX;
                        const col1X = slotCenters[1]?.x ?? (col0X + cardWidth);
                        const midX = (col0X + col1X) / 2;
                        const targetCol = draggedCenterX >= midX ? 1 : 0;

                        const row0Y = slotCenters[0]?.y ?? originY;
                        const row1Y = slotCenters.length > 2 ? slotCenters[2].y : (row0Y + cardHeight);
                        const rowStep = Math.max(30, row1Y - row0Y);

                        const rawRow = Math.round((draggedCenterY - row0Y) / rowStep);
                        const maxRow = Math.floor((allCards.length - 1) / 2);
                        const targetRow = Math.max(0, Math.min(maxRow, rawRow));

                        bestIdx = Math.max(0, Math.min(allCards.length - 1, targetRow * 2 + targetCol));
                    } else if (!isShape && slotCenters.length > 1) {
                        const row0Y = slotCenters[0]?.y ?? originY;
                        const row1Y = slotCenters.length > 1 ? slotCenters[1].y : (row0Y + cardHeight);
                        const rowStep = Math.max(24, row1Y - row0Y);

                        const rawRow = Math.round((draggedCenterY - row0Y) / rowStep);
                        bestIdx = Math.max(0, Math.min(allCards.length - 1, rawRow));
                    } else {
                        let minDist = Infinity;
                        for (let j = 0; j < slotCenters.length; j++) {
                            const dist = Math.hypot(draggedCenterX - slotCenters[j].x, draggedCenterY - slotCenters[j].y);
                            if (dist < minDist) {
                                minDist = dist;
                                bestIdx = j;
                            }
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

            const onPointerCancel = (cancelEv: PointerEvent) => {
                if (cancelEv.pointerId !== undefined && e.pointerId !== undefined && cancelEv.pointerId !== e.pointerId) return;
                try {
                    handleBtn.releasePointerCapture(cancelEv.pointerId);
                } catch (_) {}
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerCancel);

                if (dragState === 'idle') {
                    cleanupDragTransforms();
                    this.activeDragAbort = null;
                    return;
                }
                dragState = 'cancelled';
                cleanupDragTransforms();
            };

            const onPointerUp = (upEv: PointerEvent) => {
                if (upEv.pointerId !== undefined && e.pointerId !== undefined && upEv.pointerId !== e.pointerId) return;
                try {
                    handleBtn.releasePointerCapture(upEv.pointerId);
                } catch (_) {}
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerCancel);

                if (dragState === 'idle') {
                    cleanupDragTransforms();
                    this.activeDragAbort = null;
                    return;
                }

                if (dragState === 'drag-out') {
                    const finalDx = upEv.clientX - startX;
                    const flyX = finalDx >= 0 ? 180 : -180;
                    card.style.transition = 'transform 0.22s ease, opacity 0.2s ease, max-height 0.22s ease, margin 0.22s ease, padding 0.22s ease';
                    card.style.transform = `translate(${flyX}px, ${upEv.clientY - startY}px) scale(0.7)`;
                    card.style.opacity = '0';
                    card.style.maxHeight = '0';
                    card.style.padding = '0';
                    card.style.margin = '0';
                    card.style.overflow = 'hidden';

                    dropTimeout = setTimeout(() => {
                        cleanupDragTransforms();
                        this.callbacks.onDeleteFavorite(preset.id);
                    }, 220);
                    return;
                }

                if (dragState === 'dragging') {
                    dragState = 'dropping';
                    card.classList.remove('is-dragging');
                    if (currentTargetIdx !== index && slotCenters[currentTargetIdx] && slotCenters[index]) {
                        const dropDx = slotCenters[currentTargetIdx].x - slotCenters[index].x;
                        const dropDy = slotCenters[currentTargetIdx].y - slotCenters[index].y;
                        card.style.transition = 'transform 0.18s cubic-bezier(0.2, 0, 0, 1)';
                        card.style.transform = `translate(${dropDx}px, ${dropDy}px)`;
                        dropTimeout = setTimeout(() => {
                            const targetIdx = currentTargetIdx;
                            cleanupDragTransforms();
                            this.callbacks.onReorderFavorite(index, targetIdx);
                        }, 180);
                    } else {
                        card.style.transition = 'transform 0.18s ease';
                        card.style.transform = 'translate(0px, 0px)';
                        dropTimeout = setTimeout(() => {
                            cleanupDragTransforms();
                        }, 180);
                    }
                }
            };

            this.activeDragAbort = () => {
                try {
                    handleBtn.releasePointerCapture(e.pointerId);
                } catch (_) {}
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerCancel);
                cleanupDragTransforms();
            };

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerCancel);
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
        if (this.activeDragAbort) {
            this.activeDragAbort();
            this.activeDragAbort = null;
        }
        this.el.remove();
    }
}
