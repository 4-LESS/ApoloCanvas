import { BoundingBox, CanvasElement, StrokePattern } from '../core/types';
import { ICONS, PRIMARY_COLOR_NAMES, PRIMARY_PALETTE, createSvg, isDarkTheme, mapInkColorForDark } from './theme';

export interface LassoMenuCallbacks {
    onCopy: () => void;
    onPaste: () => void;
    onLink: () => void;
    onBringToFront: () => void;
    onSendToBack: () => void;
    onDelete: () => void;
    onApplyColor: (color: string) => void;
    onApplyWidth: (width: number) => void;
    onApplyPattern: (pattern: StrokePattern) => void;
    onOpenLinkedNote: (target: string) => void;
    onUnlink: () => void;
    onDeselect: () => void;
}

export class LassoMenu {
    readonly container: HTMLElement;
    private readonly menuEl: HTMLElement;
    private readonly anchorPillEl: HTMLElement;
    private readonly stylePopoverEl: HTMLElement;
    private readonly linkCardEl: HTMLElement;

    private selection: CanvasElement[] = [];
    private bounds: BoundingBox | null = null;
    private anchorBlockName = 'bloque 1';
    private isStyleOpen = false;
    private zoom = 1;
    private scrollLeft = 0;
    private scrollTop = 0;
    private callbacks: LassoMenuCallbacks;

    constructor(callbacks: LassoMenuCallbacks, parent: HTMLElement = document.body) {
        this.callbacks = callbacks;

        this.container = document.createElement('div');
        this.container.className = 'apolo-lasso-menu-container';
        this.container.hidden = true;
        this.container.style.display = 'none';

        this.menuEl = document.createElement('div');
        this.menuEl.className = 'apolo-selection-floating-menu';
        this.menuEl.setAttribute('role', 'toolbar');
        this.menuEl.setAttribute('aria-label', 'Acciones de selección');

        this.anchorPillEl = document.createElement('div');
        this.anchorPillEl.className = 'apolo-anchor-pill';

        this.stylePopoverEl = document.createElement('div');
        this.stylePopoverEl.className = 'apolo-popover-panel apolo-selection-style-popover';
        this.stylePopoverEl.hidden = true;

        this.linkCardEl = document.createElement('div');
        this.linkCardEl.className = 'apolo-popover-panel apolo-selection-link-card';
        this.linkCardEl.hidden = true;

        // Prevent pointerdown from dropping through to canvas
        this.container.addEventListener('pointerdown', e => e.stopPropagation());

        this.container.append(this.anchorPillEl, this.menuEl, this.stylePopoverEl, this.linkCardEl);
        parent.appendChild(this.container);

        this.renderMenu();
        this.renderStylePopover();
    }

    setSelection(
        selection: CanvasElement[],
        bounds: BoundingBox | null,
        anchorBlock = 'bloque 1',
        zoom = 1,
        scrollLeft = 0,
        scrollTop = 0,
    ): void {
        this.selection = selection;
        this.bounds = bounds;
        this.anchorBlockName = anchorBlock;
        this.zoom = zoom;
        this.scrollLeft = scrollLeft;
        this.scrollTop = scrollTop;

        if (!selection.length || !bounds) {
            this.hide();
            return;
        }

        this.container.style.display = '';
        this.container.hidden = false;
        this.updatePosition();
        this.updateLinkCard();
    }

    updateViewport(zoom: number, scrollLeft: number, scrollTop: number): void {
        this.zoom = zoom;
        this.scrollLeft = scrollLeft;
        this.scrollTop = scrollTop;
        if (!this.container.hidden && this.bounds) {
            this.updatePosition();
        }
    }

    hide(): void {
        this.container.hidden = true;
        this.container.style.display = 'none';
        this.isStyleOpen = false;
        this.stylePopoverEl.hidden = true;
        this.linkCardEl.hidden = true;
    }

    private updatePosition(): void {
        if (!this.bounds) return;

        const invZoom = 1 / Math.max(0.1, this.zoom);

        // Convert document bounds to viewport client coordinates
        const minX = this.bounds.minX * this.zoom - this.scrollLeft;
        const maxX = this.bounds.maxX * this.zoom - this.scrollLeft;
        const minY = this.bounds.minY * this.zoom - this.scrollTop;
        const maxY = this.bounds.maxY * this.zoom - this.scrollTop;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        const menuHeight = 44;
        const isAbove = minY - menuHeight - 16 > 48; // room above

        // 1. Position Floating Action Menu
        const menuTop = isAbove ? minY - 12 : maxY + 12;
        this.menuEl.style.position = 'fixed';
        this.menuEl.style.left = `${centerX}px`;
        this.menuEl.style.top = `${menuTop}px`;
        this.menuEl.style.transform = `translate(-50%, ${isAbove ? '-100%' : '0%'}) scale(${invZoom})`;
        this.menuEl.style.transformOrigin = `50% ${isAbove ? '100%' : '0%'}`;

        // 2. Position Anchor Pill
        this.anchorPillEl.textContent = `ancla · ${this.anchorBlockName}`;
        this.anchorPillEl.style.position = 'fixed';
        this.anchorPillEl.style.left = `${minX - 10}px`;
        this.anchorPillEl.style.top = `${centerY}px`;
        this.anchorPillEl.style.transform = `translate(-100%, -50%) scale(${invZoom})`;
        this.anchorPillEl.style.transformOrigin = '100% 50%';

        // 3. Position Style Popover (if open)
        if (this.isStyleOpen) {
            const styleLeft = Math.min(window.innerWidth - 300, Math.max(16, maxX + 14));
            this.stylePopoverEl.style.position = 'fixed';
            this.stylePopoverEl.style.left = `${styleLeft}px`;
            this.stylePopoverEl.style.top = `${minY}px`;
            this.stylePopoverEl.style.transform = `scale(${invZoom})`;
            this.stylePopoverEl.style.transformOrigin = '0 0';
        }

        // 4. Position Link Card (if selection has a link)
        const linkedUrl = this.getLinkedUrl();
        if (linkedUrl && !this.isStyleOpen) {
            const cardTop = isAbove ? maxY + 14 : maxY + (menuHeight + 20) * invZoom;
            this.linkCardEl.style.position = 'fixed';
            this.linkCardEl.style.left = `${centerX}px`;
            this.linkCardEl.style.top = `${cardTop}px`;
            this.linkCardEl.style.transform = `translate(-50%, 0) scale(${invZoom})`;
            this.linkCardEl.style.transformOrigin = '50% 0';
        }
    }

    private getLinkedUrl(): string | null {
        const item = this.selection.find(el => !!el.url);
        return item?.url ?? null;
    }

    private updateLinkCard(): void {
        const url = this.getLinkedUrl();
        if (!url || this.isStyleOpen) {
            this.linkCardEl.hidden = true;
            return;
        }

        const cleanTitle = url.replace(/^\[\[/, '').replace(/\]\]$/, '');
        this.linkCardEl.replaceChildren();
        this.linkCardEl.hidden = false;

        const header = document.createElement('div');
        header.className = 'apolo-link-card-header';
        header.appendChild(createSvg(ICONS.link, { size: 16, stroke: '#6C3FD1' }));
        const titleSpan = document.createElement('span');
        titleSpan.textContent = `[[${cleanTitle}]]`;
        header.appendChild(titleSpan);

        const desc = document.createElement('div');
        desc.className = 'apolo-link-card-desc';
        desc.textContent = 'Enlazado a nota de Obsidian. Aparece en el grafo y en los backlinks.';

        const actions = document.createElement('div');
        actions.className = 'apolo-link-card-actions';

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'apolo-btn-primary';
        openBtn.textContent = 'Abrir nota';
        openBtn.addEventListener('click', () => this.callbacks.onOpenLinkedNote(cleanTitle));

        const unlinkBtn = document.createElement('button');
        unlinkBtn.type = 'button';
        unlinkBtn.className = 'apolo-btn-ghost';
        unlinkBtn.textContent = 'Quitar enlace';
        unlinkBtn.addEventListener('click', () => {
            this.callbacks.onUnlink();
            this.updateLinkCard();
        });

        actions.append(openBtn, unlinkBtn);
        this.linkCardEl.append(header, desc, actions);
    }

    private renderMenu(): void {
        this.menuEl.replaceChildren();

        const btnDefs: Array<{
            label: string;
            className?: string;
            onClick: () => void;
            iconSvg?: string;
        }> = [
            { label: 'Copiar', onClick: () => this.callbacks.onCopy() },
            { label: 'Pegar', onClick: () => this.callbacks.onPaste() },
            {
                label: 'Enlazar',
                className: 'is-accent-link',
                onClick: () => this.callbacks.onLink(),
            },
            { label: 'Al frente', onClick: () => this.callbacks.onBringToFront() },
            { label: 'Al fondo', onClick: () => this.callbacks.onSendToBack() },
            {
                label: 'Estilo',
                onClick: () => {
                    this.isStyleOpen = !this.isStyleOpen;
                    this.stylePopoverEl.hidden = !this.isStyleOpen;
                    if (this.isStyleOpen) {
                        this.linkCardEl.hidden = true;
                    } else {
                        this.updateLinkCard();
                    }
                    this.updatePosition();
                },
            },
            {
                label: 'Eliminar',
                className: 'is-danger',
                onClick: () => this.callbacks.onDelete(),
            },
        ];

        for (const def of btnDefs) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `apolo-selection-action-btn ${def.className ?? ''}`;
            btn.textContent = def.label;
            btn.setAttribute('aria-label', def.label);
            btn.addEventListener('click', def.onClick);
            this.menuEl.appendChild(btn);
        }
    }

    private renderStylePopover(): void {
        this.stylePopoverEl.replaceChildren();

        const title = document.createElement('div');
        title.className = 'apolo-section-label';
        title.textContent = 'Estilo de la selección';
        this.stylePopoverEl.appendChild(title);

        // 1. Color Palette Row
        const colorsRow = document.createElement('div');
        colorsRow.className = 'apolo-colors-row';
        const dark = isDarkTheme();

        for (const col of PRIMARY_PALETTE) {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = 'apolo-palette-swatch';
            sw.style.background = mapInkColorForDark(col, dark);
            sw.setAttribute('aria-label', PRIMARY_COLOR_NAMES[col] || col);
            sw.title = PRIMARY_COLOR_NAMES[col] || col;
            sw.addEventListener('click', () => {
                this.callbacks.onApplyColor(col);
                this.isStyleOpen = false;
                this.stylePopoverEl.hidden = true;
                this.updateLinkCard();
            });
            colorsRow.appendChild(sw);
        }
        this.stylePopoverEl.appendChild(colorsRow);

        // 2. Thickness Chips (Fina, Media, Gruesa)
        const thicknessRow = document.createElement('div');
        thicknessRow.className = 'apolo-chips-row';

        const thicknessOptions: Array<{ label: string; width: number }> = [
            { label: 'Fina', width: 2 },
            { label: 'Media', width: 3.5 },
            { label: 'Gruesa', width: 6 },
        ];

        for (const opt of thicknessOptions) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'apolo-style-chip';
            chip.textContent = opt.label;
            chip.addEventListener('click', () => {
                this.callbacks.onApplyWidth(opt.width);
            });
            thicknessRow.appendChild(chip);
        }
        this.stylePopoverEl.appendChild(thicknessRow);

        // 3. Pattern Chips (Continuo, Guiones, Puntos)
        const patternRow = document.createElement('div');
        patternRow.className = 'apolo-chips-row';

        const patternOptions: Array<{ label: string; pattern: StrokePattern }> = [
            { label: 'Continuo', pattern: 'solid' },
            { label: 'Guiones', pattern: 'dashed' },
            { label: 'Puntos', pattern: 'dotted' },
        ];

        for (const opt of patternOptions) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'apolo-style-chip';
            chip.textContent = opt.label;
            chip.addEventListener('click', () => {
                this.callbacks.onApplyPattern(opt.pattern);
            });
            patternRow.appendChild(chip);
        }
        this.stylePopoverEl.appendChild(patternRow);
    }

    destroy(): void {
        this.container.remove();
    }
}
