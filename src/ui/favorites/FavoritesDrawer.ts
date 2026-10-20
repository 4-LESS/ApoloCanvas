import type {
    FavoritableTool,
    ToolFavoritePreset,
    PenFavoritePreset,
    HighlighterFavoritePreset,
    ShapeFavoritePreset,
} from '../../core/types.ts';
import { computeFavoriteFingerprint, inferTool } from './FavoritesStore.ts';
import { ICONS, createSvg, createStrokeWavePreview, mapInkColorForDark } from '../theme.ts';

export interface FavoritesDrawerCallbacks {
    onSelectFavorite: (preset: ToolFavoritePreset) => void;
    onDeleteFavorite: (presetId: string) => void;
    onReorderFavorite: (fromIndex: number, toIndex: number) => void;
}

/**
 * Returns a human-friendly Spanish label for a favorite preset.
 */
export function getPresetLabel(preset: ToolFavoritePreset): string {
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

    constructor(
        callbacks: FavoritesDrawerCallbacks,
        initialTool: FavoritableTool = 'pen',
        initialFavorites: readonly ToolFavoritePreset[] = [],
        initialSlice?: any,
        parent?: HTMLElement,
    ) {
        this.callbacks = callbacks;
        this.tool = initialTool;
        this.favorites = [...initialFavorites];
        this.currentSlice = initialSlice ?? null;

        this.el = document.createElement('div');
        this.el.className = 'apolo-favorites-drawer';

        if (parent) {
            parent.appendChild(this.el);
        }

        this.render();
    }

    /**
     * Updates tool, favorites list, and active configuration slice.
     */
    update(tool: FavoritableTool, favorites: readonly ToolFavoritePreset[], currentSlice?: any): void {
        this.tool = tool;
        this.favorites = [...favorites];
        this.currentSlice = currentSlice ?? null;
        this.render();
    }

    /**
     * Partial state update helper.
     */
    updateState(partial: Partial<{ tool: FavoritableTool; favorites: readonly ToolFavoritePreset[]; currentSlice: any }>): void {
        if (partial.tool !== undefined) this.tool = partial.tool;
        if (partial.favorites !== undefined) this.favorites = [...partial.favorites];
        if (partial.currentSlice !== undefined) this.currentSlice = partial.currentSlice;
        this.render();
    }

    /**
     * Renders or re-renders the drawer contents.
     */
    private render(): void {
        this.el.replaceChildren();

        if (this.favorites.length === 0) {
            this.renderEmptyState();
            return;
        }

        this.renderFavoritesList();
    }

    /**
     * Renders the clean empty state when no favorites exist.
     */
    private renderEmptyState(): void {
        const emptyContainer = document.createElement('div');
        emptyContainer.className = 'apolo-favorites-empty';

        const starIcon = createSvg(ICONS.star, { size: 24 });
        const text = document.createElement('p');
        text.className = 'apolo-favorites-empty-text';
        text.textContent = 'No hay favoritos guardados. Toca ☆ arriba para guardar la configuración actual.';

        emptyContainer.append(starIcon, text);
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

        for (let i = 0; i < this.favorites.length; i++) {
            const preset = this.favorites[i];
            const presetFp = computeFavoriteFingerprint(preset);
            const isActive = Boolean(activeFp && presetFp === activeFp);

            const card = document.createElement('div');
            card.className = `apolo-favorite-card ${isActive ? 'is-active' : ''}`;
            card.dataset.presetId = preset.id;
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.setAttribute('aria-label', `Favorito ${getPresetLabel(preset)} ${preset.width}px`);

            // Apply preset on click / Enter
            card.onclick = () => {
                this.callbacks.onSelectFavorite(preset);
            };
            card.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.callbacks.onSelectFavorite(preset);
                }
            };

            // Main content column (preview + metadata)
            const content = document.createElement('div');
            content.className = 'apolo-favorite-content';

            // Preview Area
            const previewEl = document.createElement('div');
            previewEl.className = 'apolo-favorite-preview';

            if (preset.tool === 'pen') {
                const pen = preset as PenFavoritePreset;
                const wave = createStrokeWavePreview(
                    pen.color,
                    pen.width,
                    pen.profileId,
                    pen.opacity,
                    pen.pattern,
                );
                previewEl.appendChild(wave);
            } else if (preset.tool === 'highlighter') {
                const hl = preset as HighlighterFavoritePreset;
                const wave = createStrokeWavePreview(
                    hl.color,
                    hl.width,
                    hl.profileId,
                    hl.opacity,
                    hl.pattern,
                );
                previewEl.appendChild(wave);
            } else if (preset.tool === 'shape') {
                const shape = preset as ShapeFavoritePreset;
                const shapeSvg = createShapePreview(shape);
                previewEl.appendChild(shapeSvg);
            }
            content.appendChild(previewEl);

            // Metadata row
            const metaEl = document.createElement('div');
            metaEl.className = 'apolo-favorite-meta';

            const labelSpan = document.createElement('span');
            labelSpan.className = 'apolo-favorite-label';
            labelSpan.textContent = getPresetLabel(preset);

            const thicknessSpan = document.createElement('span');
            thicknessSpan.className = 'apolo-favorite-thickness';
            thicknessSpan.textContent = `${preset.width}px`;

            metaEl.append(labelSpan, thicknessSpan);

            if (preset.pattern && preset.pattern !== 'solid') {
                const patternBadge = document.createElement('span');
                patternBadge.className = 'apolo-favorite-pattern-badge';
                patternBadge.textContent = preset.pattern === 'dashed' ? 'Rayas' : 'Puntos';
                metaEl.appendChild(patternBadge);
            }

            if (preset.tool === 'shape' && (preset as ShapeFavoritePreset).fillEnabled) {
                const fillBadge = document.createElement('span');
                fillBadge.className = 'apolo-favorite-fill-badge';
                fillBadge.textContent = 'Relleno';
                metaEl.appendChild(fillBadge);
            }

            content.appendChild(metaEl);
            card.appendChild(content);

            // Actions (Reorder + Delete)
            const actions = document.createElement('div');
            actions.className = 'apolo-favorite-actions';

            if (this.favorites.length > 1) {
                if (i > 0) {
                    const upBtn = document.createElement('button');
                    upBtn.type = 'button';
                    upBtn.className = 'apolo-favorite-reorder-btn apolo-favorite-reorder-up';
                    upBtn.setAttribute('aria-label', 'Mover arriba');
                    upBtn.title = 'Mover arriba';
                    const upSvg = createSvg('M12 5l-7 7h14z', { size: 12 });
                    upBtn.appendChild(upSvg);
                    upBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.callbacks.onReorderFavorite(i, i - 1);
                    };
                    actions.appendChild(upBtn);
                }

                if (i < this.favorites.length - 1) {
                    const downBtn = document.createElement('button');
                    downBtn.type = 'button';
                    downBtn.className = 'apolo-favorite-reorder-btn apolo-favorite-reorder-down';
                    downBtn.setAttribute('aria-label', 'Mover abajo');
                    downBtn.title = 'Mover abajo';
                    const downSvg = createSvg('M12 19l7-7H5z', { size: 12 });
                    downBtn.appendChild(downSvg);
                    downBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.callbacks.onReorderFavorite(i, i + 1);
                    };
                    actions.appendChild(downBtn);
                }
            }

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'apolo-favorite-delete-btn';
            deleteBtn.setAttribute('aria-label', 'Eliminar favorito');
            deleteBtn.title = 'Eliminar favorito';
            deleteBtn.appendChild(createSvg(ICONS.close, { size: 14 }));
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                this.callbacks.onDeleteFavorite(preset.id);
            };
            actions.appendChild(deleteBtn);

            card.appendChild(actions);
            listContainer.appendChild(card);
        }

        this.el.appendChild(listContainer);
    }

    /**
     * Removes the drawer from the DOM.
     */
    destroy(): void {
        this.el.remove();
    }
}
