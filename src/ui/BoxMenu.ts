import type { BoxAccentColor, BoxBgTheme, BoxGridStyle } from '../core/types';

export interface BoxMenuCallbacks {
    onSetGridStyle: (boxId: string, style: BoxGridStyle) => void;
    onSetGridDensity: (boxId: string, density: number) => void;
    onSetAccentColor: (boxId: string, accent: BoxAccentColor) => void;
    onFitHeight: (boxId: string) => void;
    onClearContent: (boxId: string) => void;
    onDeleteBox: (boxId: string) => void;
    onSetBgTheme?: (boxId: string, theme: BoxBgTheme) => void;
    onToggleBorderOutline?: (boxId: string, outline: boolean) => void;
    onExportSvg?: (boxId: string) => void;
}

export interface BoxMenuState {
    gridStyle: BoxGridStyle;
    gridDensity: number;
    accentColor?: BoxAccentColor;
    bgTheme?: BoxBgTheme;
    customBgColor?: string;
    borderOutline?: boolean;
}

const GRID_STYLES: Array<{ id: BoxGridStyle; label: string }> = [
    { id: 'dots', label: 'Puntos' },
    { id: 'grid', label: 'Cuadrícula' },
    { id: 'ruled', label: 'Rayas' },
    { id: 'none', label: 'En blanco' },
];

const GRID_DENSITIES: Array<{ density: number; label: string }> = [
    { density: 40, label: 'Fina' },
    { density: 32, label: 'Normal' },
    { density: 24, label: 'Amplia' },
];

const ACCENT_COLORS: Array<{ id: BoxAccentColor; label: string; color: string }> = [
    { id: 'purple', label: 'Morado', color: '#a98bff' },
    { id: 'blue', label: 'Azul', color: '#3b82f6' },
    { id: 'emerald', label: 'Esmeralda', color: '#10b981' },
    { id: 'amber', label: 'Ámbar', color: '#f59e0b' },
    { id: 'coral', label: 'Coral', color: '#f43f5e' },
    { id: 'neutral', label: 'Neutro', color: '#6b7280' },
];

function createDotsSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'currentColor');
    const coords = [
        [6, 6], [12, 6], [18, 6],
        [6, 12], [12, 12], [18, 12],
        [6, 18], [12, 18], [18, 18],
    ];
    for (const [cx, cy] of coords) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(cx));
        circle.setAttribute('cy', String(cy));
        circle.setAttribute('r', '1.6');
        svg.appendChild(circle);
    }
    return svg;
}

function createGridSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '3');
    rect.setAttribute('y', '3');
    rect.setAttribute('width', '18');
    rect.setAttribute('height', '18');
    rect.setAttribute('rx', '2');
    svg.appendChild(rect);
    const lines = [
        [9, 3, 9, 21],
        [15, 3, 15, 21],
        [3, 9, 21, 9],
        [3, 15, 21, 15],
    ];
    for (const [x1, y1, x2, y2] of lines) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        svg.appendChild(line);
    }
    return svg;
}

function createRuledSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    const yValues = [7, 12, 17];
    for (const y of yValues) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '4');
        line.setAttribute('y1', String(y));
        line.setAttribute('x2', '20');
        line.setAttribute('y2', String(y));
        svg.appendChild(line);
    }
    return svg;
}

function createBlankSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '4');
    rect.setAttribute('y', '4');
    rect.setAttribute('width', '16');
    rect.setAttribute('height', '16');
    rect.setAttribute('rx', '4');
    svg.appendChild(rect);
    return svg;
}

function createCloseSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    p1.setAttribute('x1', '18');
    p1.setAttribute('y1', '6');
    p1.setAttribute('x2', '6');
    p1.setAttribute('y2', '18');
    const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    p2.setAttribute('x1', '6');
    p2.setAttribute('y1', '6');
    p2.setAttribute('x2', '18');
    p2.setAttribute('y2', '18');
    svg.append(p1, p2);
    return svg;
}

function createCompressSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p1.setAttribute('d', 'M12 3v6m-3-3l3 3 3-3');
    const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p2.setAttribute('d', 'M12 21v-6m-3 3l3-3 3 3');
    const p3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p3.setAttribute('d', 'M4 12h16');
    svg.append(p1, p2, p3);
    return svg;
}

function createEraserSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M19 19H8l-5-5a2.8 2.8 0 010-4l7-7a2.8 2.8 0 014 0l6 6a2.8 2.8 0 010 4l-4 4 M6 12l8 8');
    svg.appendChild(path);
    return svg;
}

function createTrashSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16');
    svg.appendChild(path);
    return svg;
}

/**
 * Visual floating inspector panel for drawing boxes.
 * Opens exclusively via the top-left 3-dots button.
 * Matches mockup design from media_1791777394923_df71a561.png.
 * Dismisses instantly on 'X', outside screen touch, or drawing start.
 */
export class BoxMenu {
    readonly container: HTMLElement;
    private currentBoxId = '';
    private currentState: BoxMenuState | null = null;
    private callbacks: BoxMenuCallbacks;

    constructor(callbacks: BoxMenuCallbacks, parent: HTMLElement = document.body) {
        this.callbacks = callbacks;

        this.container = document.createElement('div');
        this.container.className = 'apolo-box-menu-container apolo-popover-panel';
        this.container.hidden = true;
        this.container.setAttribute('role', 'dialog');
        this.container.setAttribute('aria-label', 'Espacio de dibujo');

        // Prevent pointer/touch inside menu from bubbling to canvas or closing prematurely
        this.container.addEventListener('pointerdown', e => e.stopPropagation());
        this.container.addEventListener('touchstart', e => e.stopPropagation());

        parent.appendChild(this.container);

        // Window capture listeners to reliably dismiss on touch/click outside
        window.addEventListener('pointerdown', this.onOutsidePointerDown, { capture: true });
        window.addEventListener('touchstart', this.onOutsideTouchStart, { capture: true });
        window.addEventListener('keydown', this.onKeyDown);
    }

    private readonly onOutsidePointerDown = (e: PointerEvent): void => {
        if (!this.container.hidden && !this.container.contains(e.target as Node)) {
            this.hide();
        }
    };

    private readonly onOutsideTouchStart = (e: TouchEvent): void => {
        if (!this.container.hidden && e.target && !this.container.contains(e.target as Node)) {
            this.hide();
        }
    };

    private readonly onKeyDown = (e: KeyboardEvent): void => {
        if (!this.container.hidden && e.key === 'Escape') {
            this.hide();
        }
    };

    isOpen(): boolean {
        return !this.container.hidden;
    }

    show(boxId: string, anchorRect: DOMRect, state: BoxMenuState): void {
        this.currentBoxId = boxId;
        this.currentState = { ...state };
        this.render(this.currentState);

        const menuWidth = 326;
        let left = anchorRect.left;
        if (left + menuWidth > window.innerWidth - 12) {
            left = window.innerWidth - menuWidth - 12;
        }
        left = Math.max(12, left);

        let top = anchorRect.bottom + 8;
        const estimatedHeight = 310;
        if (top + estimatedHeight > window.innerHeight && anchorRect.top > estimatedHeight + 10) {
            top = anchorRect.top - estimatedHeight - 8;
        }
        top = Math.max(12, top);

        this.container.style.position = 'fixed';
        this.container.style.left = `${Math.round(left)}px`;
        this.container.style.top = `${Math.round(top)}px`;
        this.container.style.zIndex = '1002';

        requestAnimationFrame(() => {
            this.container.hidden = false;
        });
    }

    hide(): void {
        this.container.hidden = true;
        this.currentBoxId = '';
        this.currentState = null;
    }

    destroy(): void {
        window.removeEventListener('pointerdown', this.onOutsidePointerDown, { capture: true });
        window.removeEventListener('touchstart', this.onOutsideTouchStart, { capture: true });
        window.removeEventListener('keydown', this.onKeyDown);
        this.container.remove();
    }

    private render(state: BoxMenuState): void {
        this.container.empty();

        // 1. Header (Title "Espacio" + Circular Close Button "✕")
        const header = document.createElement('div');
        header.className = 'apolo-box-menu-header';

        const title = document.createElement('span');
        title.className = 'apolo-box-menu-title';
        title.textContent = 'Espacio';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'apolo-box-menu-close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Cerrar');
        closeBtn.appendChild(createCloseSvg());

        const handleClose = (e: Event): void => {
            e.stopPropagation();
            e.preventDefault();
            this.hide();
        };
        closeBtn.addEventListener('pointerdown', (e: PointerEvent) => {
            e.stopPropagation();
            e.preventDefault();
            this.hide();
        });
        closeBtn.addEventListener('click', handleClose);
        closeBtn.addEventListener('touchend', handleClose);

        header.appendChild(closeBtn);
        this.container.appendChild(header);

        // 2. Section: Fondo (4 Visual Cards: Dots, Grid, Ruled, Blank)
        const fondoSection = document.createElement('div');
        fondoSection.className = 'apolo-box-menu-section';

        const fondoLabel = document.createElement('span');
        fondoLabel.className = 'apolo-box-menu-section-label';
        fondoLabel.textContent = 'Fondo';
        fondoSection.appendChild(fondoLabel);

        const fondoGrid = document.createElement('div');
        fondoGrid.className = 'apolo-box-menu-grid-tiles';

        for (const s of GRID_STYLES) {
            const btn = document.createElement('button');
            btn.className = `apolo-box-menu-tile${state.gridStyle === s.id ? ' is-active' : ''}`;
            btn.type = 'button';
            btn.setAttribute('aria-label', s.label);
            btn.title = s.label;

            if (s.id === 'dots') btn.appendChild(createDotsSvg());
            else if (s.id === 'grid') btn.appendChild(createGridSvg());
            else if (s.id === 'ruled') btn.appendChild(createRuledSvg());
            else btn.appendChild(createBlankSvg());

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                state.gridStyle = s.id;
                this.callbacks.onSetGridStyle(this.currentBoxId, s.id);
                this.render(state);
            });
            fondoGrid.appendChild(btn);
        }
        fondoSection.appendChild(fondoGrid);
        this.container.appendChild(fondoSection);

        // 3. Section: Espaciado (Single row with label on left, segmented pill on right)
        const espaciadoRow = document.createElement('div');
        espaciadoRow.className = 'apolo-box-menu-espaciado-row';

        const espaciadoLabel = document.createElement('span');
        espaciadoLabel.className = 'apolo-box-menu-section-label';
        espaciadoLabel.textContent = 'Espaciado';
        espaciadoRow.appendChild(espaciadoLabel);

        const segmentedContainer = document.createElement('div');
        segmentedContainer.className = 'apolo-box-menu-segmented';

        for (const d of GRID_DENSITIES) {
            const btn = document.createElement('button');
            const isActive = Math.abs((state.gridDensity || 32) - d.density) < 4;
            btn.className = `apolo-box-menu-seg-btn${isActive ? ' is-active' : ''}`;
            btn.type = 'button';
            btn.textContent = d.label;

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                state.gridDensity = d.density;
                this.callbacks.onSetGridDensity(this.currentBoxId, d.density);
                this.render(state);
            });
            segmentedContainer.appendChild(btn);
        }
        espaciadoRow.appendChild(segmentedContainer);
        this.container.appendChild(espaciadoRow);

        // 4. Section: Acento lateral (Label + Circular Color Swatches)
        const accentSection = document.createElement('div');
        accentSection.className = 'apolo-box-menu-section';

        const accentLabel = document.createElement('span');
        accentLabel.className = 'apolo-box-menu-section-label';
        accentLabel.textContent = 'Acento lateral';
        accentSection.appendChild(accentLabel);

        const swatchesRow = document.createElement('div');
        swatchesRow.className = 'apolo-box-menu-swatches';

        for (const a of ACCENT_COLORS) {
            const btn = document.createElement('button');
            const isActive = (state.accentColor || 'purple') === a.id;
            btn.className = `apolo-box-menu-swatch${isActive ? ' is-active' : ''}`;
            btn.type = 'button';
            btn.title = a.label;
            btn.setAttribute('aria-label', a.label);
            btn.style.backgroundColor = a.color;

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                state.accentColor = a.id;
                this.callbacks.onSetAccentColor(this.currentBoxId, a.id);
                this.render(state);
            });
            swatchesRow.appendChild(btn);
        }
        accentSection.appendChild(swatchesRow);
        this.container.appendChild(accentSection);

        // 5. Section: Bottom Action Row (3 Buttons: Ajustar altura, Limpiar trazos, Eliminar)
        const actionsRow = document.createElement('div');
        actionsRow.className = 'apolo-box-menu-actions';

        // Action 1: Ajustar altura
        const fitBtn = document.createElement('button');
        fitBtn.className = 'apolo-box-menu-action-btn';
        fitBtn.type = 'button';
        fitBtn.appendChild(createCompressSvg());
        const fitTxt = document.createElement('span');
        fitTxt.textContent = 'Ajustar altura';
        fitBtn.appendChild(fitTxt);
        fitBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = this.currentBoxId;
            this.callbacks.onFitHeight(id);
            this.hide();
        });
        actionsRow.appendChild(fitBtn);

        // Action 2: Limpiar trazos
        const clearBtn = document.createElement('button');
        clearBtn.className = 'apolo-box-menu-action-btn';
        clearBtn.type = 'button';
        clearBtn.appendChild(createEraserSvg());
        const clearTxt = document.createElement('span');
        clearTxt.textContent = 'Limpiar trazos';
        clearBtn.appendChild(clearTxt);
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = this.currentBoxId;
            this.callbacks.onClearContent(id);
            this.hide();
        });
        actionsRow.appendChild(clearBtn);

        // Action 3: Eliminar (Danger)
        const delBtn = document.createElement('button');
        delBtn.className = 'apolo-box-menu-action-btn is-danger';
        delBtn.type = 'button';
        delBtn.appendChild(createTrashSvg());
        const delTxt = document.createElement('span');
        delTxt.textContent = 'Eliminar';
        delBtn.appendChild(delTxt);
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = this.currentBoxId;
            this.callbacks.onDeleteBox(id);
            this.hide();
        });
        actionsRow.appendChild(delBtn);

        this.container.appendChild(actionsRow);
    }
}
