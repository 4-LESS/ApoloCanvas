import { PenFavorite, PenProfileId, ShapeType, ThicknessPreset, ToolbarSlot, ToolType } from '../core/types';
import { ICONS, createSvg, isDarkTheme, mapInkColorForDark } from './theme';

export interface ToolbarOptions {
    slot: ToolbarSlot;
    penEnabled: boolean;
    activeTool: ToolType;
    activeShape: ShapeType;
    activeColor: string;
    activeWidth: number;
    activeProfileId: PenProfileId;
    activeFavoriteIndex: number;
    favorites: PenFavorite[];
    snapGrid: boolean;
    canUndo: boolean;
    canRedo: boolean;
    eraserRadius: number;
    onSlotChange: (slot: ToolbarSlot) => void;
    onToggleKeyboardMode: () => void;
    onSelectTool: (tool: ToolType) => void;
    onToggleEstuche: (tool: ToolType) => void;
    onUndo: () => void;
    onRedo: () => void;
    onSelectFavorite: (index: number) => void;
    onSelectThickness: (preset: ThicknessPreset) => void;
    onToggleSnapGrid: () => void;
    onToggleMoreMenu: () => void;
}

interface DragState {
    pointerId: number;
    scale: number;
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
}

export class Toolbar {
    readonly container: HTMLElement;
    private readonly dotsContainer: HTMLElement;
    private options: ToolbarOptions;
    private dragState: DragState | null = null;
    private currentDragPos: { x: number; y: number } | null = null;

    // DOM references for instant state updating
    private keyboardBtn!: HTMLButtonElement;
    private toolButtons = new Map<ToolType, HTMLButtonElement>();
    private shapeBtnIcon!: HTMLElement;
    private undoBtn!: HTMLButtonElement;
    private redoBtn!: HTMLButtonElement;
    private favButtons: HTMLButtonElement[] = [];
    private thicknessButtons: HTMLButtonElement[] = [];
    private gridBtn!: HTMLButtonElement;
    private moreBtn!: HTMLButtonElement;

    constructor(options: ToolbarOptions, parent: HTMLElement = document.body) {
        this.options = { ...options };

        this.container = document.createElement('div');
        this.container.className = 'apolo-canvas-toolbar';
        this.container.setAttribute('role', 'toolbar');
        this.container.setAttribute('aria-label', 'Herramientas Apolo Canvas');

        this.dotsContainer = document.createElement('div');
        this.dotsContainer.className = 'apolo-snap-dots-container';
        this.dotsContainer.hidden = true;

        parent.appendChild(this.dotsContainer);
        parent.appendChild(this.container);

        this.render();
        this.updatePosition();
    }

    private isVertical(): boolean {
        return this.options.slot === 'ml' || this.options.slot === 'mr';
    }

    private getDimensions(slot: ToolbarSlot): { width: number; height: number } {
        const vert = slot === 'ml' || slot === 'mr';
        if (vert) {
            return {
                width: 58,
                height: Math.min(696, Math.max(480, window.innerHeight - 96)),
            };
        }
        return {
            width: Math.min(880, Math.max(520, window.innerWidth - 32)),
            height: 58,
        };
    }

    getSlotCoordinates(slot: ToolbarSlot): { x: number; y: number; width: number; height: number } {
        const { width, height } = this.getDimensions(slot);
        const col = slot === 'tl' || slot === 'ml' || slot === 'bl' ? 0 : (slot === 'tc' || slot === 'bc' ? 1 : 2);
        const row = slot === 'tl' || slot === 'tc' || slot === 'tr' ? 0 : (slot === 'ml' || slot === 'mr' ? 1 : 2);

        const marginX = 16;
        const marginY = 56; // Leave room for Obsidian header / tabs
        const marginBottom = 36;

        let x = 0;
        if (col === 0) x = marginX;
        else if (col === 1) x = Math.round((window.innerWidth - width) / 2);
        else x = window.innerWidth - width - marginX;

        let y = 0;
        if (row === 0) y = marginY;
        else if (row === 1) y = Math.round((window.innerHeight - height) / 2);
        else y = window.innerHeight - height - marginBottom;

        return { x: Math.max(8, x), y: Math.max(8, y), width, height };
    }

    private getNearestSlot(centerX: number, centerY: number): ToolbarSlot {
        const slots: ToolbarSlot[] = ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'];
        let bestSlot = this.options.slot;
        let minDistance = Number.POSITIVE_INFINITY;

        for (const s of slots) {
            const coords = this.getSlotCoordinates(s);
            const slotCenterX = coords.x + coords.width / 2;
            const slotCenterY = coords.y + coords.height / 2;
            const dist = Math.hypot(slotCenterX - centerX, slotCenterY - centerY);
            if (dist < minDistance) {
                minDistance = dist;
                bestSlot = s;
            }
        }
        return bestSlot;
    }

    private updatePosition(): void {
        const vert = this.isVertical();
        this.container.classList.toggle('is-vertical', vert);

        if (this.currentDragPos) {
            this.container.style.left = `${this.currentDragPos.x}px`;
            this.container.style.top = `${this.currentDragPos.y}px`;
            this.container.style.transform = 'none';
            this.container.style.transition = 'none';
        } else {
            const coords = this.getSlotCoordinates(this.options.slot);
            this.container.style.left = `${coords.x}px`;
            this.container.style.top = `${coords.y}px`;
            this.container.style.width = `${coords.width}px`;
            this.container.style.height = `${coords.height}px`;
            this.container.style.transform = 'none';
            this.container.style.transition = 'left 0.25s cubic-bezier(0.2, 0, 0, 1), top 0.25s cubic-bezier(0.2, 0, 0, 1)';
        }
    }

    private render(): void {
        this.container.replaceChildren();
        const vert = this.isVertical();

        // 1. Grip handle for dragging
        const grip = document.createElement('button');
        grip.type = 'button';
        grip.className = 'apolo-toolbar-grip';
        grip.setAttribute('aria-label', 'Arrastrar barra de herramientas a una esquina o borde');
        grip.title = 'Arrastra para mover la barra';
        grip.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">${ICONS.dragGrip}</svg>`;
        grip.addEventListener('pointerdown', this.onGripPointerDown);
        this.container.appendChild(grip);

        // 2. Modo teclado button (stylus as cursor)
        const kbBtn = document.createElement('button');
        kbBtn.type = 'button';
        kbBtn.className = 'apolo-toolbar-btn apolo-btn-keyboard';
        kbBtn.setAttribute('aria-label', 'Modo teclado (el lápiz hace de cursor)');
        kbBtn.title = 'Modo teclado: toca para escribir con el teclado';
        kbBtn.appendChild(createSvg(ICONS.keyboardMode));
        kbBtn.addEventListener('click', () => this.options.onToggleKeyboardMode());
        this.keyboardBtn = kbBtn;
        this.updateKeyboardModeVisual();
        this.container.appendChild(kbBtn);

        this.container.appendChild(this.createDivider());

        // 3. Tool buttons (pluma, marcador, borrador, lazo, formas, espacio)
        const toolsGroup = document.createElement('div');
        toolsGroup.className = 'apolo-toolbar-group apolo-tools-group';
        this.toolButtons.clear();

        const toolDefs: Array<{ tool: ToolType; label: string; iconD: string }> = [
            { tool: 'pen', label: 'Pluma', iconD: ICONS.pen },
            { tool: 'highlighter', label: 'Marcador', iconD: ICONS.highlighter },
            { tool: 'eraser', label: 'Borrador', iconD: ICONS.eraser },
            { tool: 'lasso', label: 'Lazo', iconD: ICONS.lasso },
            { tool: 'shape', label: 'Formas', iconD: this.getShapeIcon(this.options.activeShape) },
            { tool: 'spacer', label: 'Insertar espacio', iconD: ICONS.spacer },
        ];

        for (const def of toolDefs) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'apolo-toolbar-btn apolo-tool-btn';
            btn.dataset.tool = def.tool;
            btn.setAttribute('aria-label', def.label);
            btn.title = def.label;

            const iconContainer = document.createElement('span');
            iconContainer.className = 'apolo-tool-icon-wrap';
            iconContainer.appendChild(createSvg(def.iconD, { dash: def.tool === 'lasso' ? '3 2.5' : undefined }));
            btn.appendChild(iconContainer);

            if (def.tool === 'shape') {
                this.shapeBtnIcon = iconContainer;
            }

            // Small triangle indicator for openable estuche
            const tri = document.createElement('span');
            tri.className = 'apolo-tool-triangle';
            btn.appendChild(tri);

            btn.addEventListener('click', () => {
                if (this.options.activeTool === def.tool && this.options.penEnabled && def.tool !== 'spacer') {
                    this.options.onToggleEstuche(def.tool);
                } else {
                    this.options.onSelectTool(def.tool);
                }
            });

            this.toolButtons.set(def.tool, btn);
            toolsGroup.appendChild(btn);
        }
        this.container.appendChild(toolsGroup);
        this.updateToolButtonsVisual();

        this.container.appendChild(this.createDivider());

        // 4. Undo and Redo
        const historyGroup = document.createElement('div');
        historyGroup.className = 'apolo-toolbar-group apolo-history-group';

        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'apolo-toolbar-btn';
        undoBtn.setAttribute('aria-label', 'Deshacer');
        undoBtn.title = 'Deshacer';
        undoBtn.appendChild(createSvg(ICONS.undo));
        undoBtn.addEventListener('click', () => this.options.onUndo());
        this.undoBtn = undoBtn;

        const redoBtn = document.createElement('button');
        redoBtn.type = 'button';
        redoBtn.className = 'apolo-toolbar-btn';
        redoBtn.setAttribute('aria-label', 'Rehacer');
        redoBtn.title = 'Rehacer';
        redoBtn.appendChild(createSvg(ICONS.redo));
        redoBtn.addEventListener('click', () => this.options.onRedo());
        this.redoBtn = redoBtn;

        historyGroup.append(undoBtn, redoBtn);
        this.container.appendChild(historyGroup);
        this.updateHistoryButtonsVisual();

        this.container.appendChild(this.createDivider());

        // 5. Four Favorites
        const favGroup = document.createElement('div');
        favGroup.className = 'apolo-toolbar-group apolo-favs-group';
        this.favButtons = [];

        for (let i = 0; i < 4; i++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'apolo-toolbar-btn apolo-fav-chip';
            btn.setAttribute('aria-label', `Favorito ${i + 1}`);
            btn.title = `Favorito ${i + 1}`;

            const dot = document.createElement('span');
            dot.className = 'apolo-fav-dot';
            btn.appendChild(dot);

            btn.addEventListener('click', () => this.options.onSelectFavorite(i));
            this.favButtons.push(btn);
            favGroup.appendChild(btn);
        }
        this.container.appendChild(favGroup);
        this.updateFavoritesVisual();

        this.container.appendChild(this.createDivider());

        // 6. Thickness preset dots (fino, medio, grueso)
        const thicknessGroup = document.createElement('div');
        thicknessGroup.className = 'apolo-toolbar-group apolo-thickness-group';
        this.thicknessButtons = [];

        const presets: Array<{ id: ThicknessPreset; label: string }> = [
            { id: 'fine', label: 'Fino' },
            { id: 'medium', label: 'Medio' },
            { id: 'thick', label: 'Grueso' },
        ];

        for (let i = 0; i < presets.length; i++) {
            const preset = presets[i];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `apolo-toolbar-btn apolo-thickness-btn apolo-thick-${preset.id}`;
            btn.setAttribute('aria-label', `Grosor ${preset.label}`);
            btn.title = `Grosor ${preset.label}`;

            const dot = document.createElement('span');
            dot.className = 'apolo-thickness-dot';
            btn.appendChild(dot);

            btn.addEventListener('click', () => this.options.onSelectThickness(preset.id));
            this.thicknessButtons.push(btn);
            thicknessGroup.appendChild(btn);
        }
        this.container.appendChild(thicknessGroup);
        this.updateThicknessVisual();

        this.container.appendChild(this.createDivider());

        // 7. Grid and More menu
        const utilGroup = document.createElement('div');
        utilGroup.className = 'apolo-toolbar-group apolo-util-group';

        const gridBtn = document.createElement('button');
        gridBtn.type = 'button';
        gridBtn.className = 'apolo-toolbar-btn apolo-grid-btn';
        gridBtn.setAttribute('aria-label', 'Cuadrícula magnética');
        gridBtn.title = 'Cuadrícula magnética';
        gridBtn.appendChild(createSvg(ICONS.grid));
        gridBtn.addEventListener('click', () => this.options.onToggleSnapGrid());
        this.gridBtn = gridBtn;

        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'apolo-toolbar-btn apolo-more-btn';
        moreBtn.setAttribute('aria-label', 'Más opciones');
        moreBtn.title = 'Más opciones';
        moreBtn.appendChild(createSvg(ICONS.more, { strokeWidth: 3.4 }));
        moreBtn.addEventListener('click', () => this.options.onToggleMoreMenu());
        this.moreBtn = moreBtn;

        utilGroup.append(gridBtn, moreBtn);
        this.container.appendChild(utilGroup);
        this.updateSnapGridVisual();
    }

    private createDivider(): HTMLElement {
        const div = document.createElement('span');
        div.className = 'apolo-toolbar-divider';
        div.setAttribute('aria-hidden', 'true');
        return div;
    }

    private getShapeIcon(shape: ShapeType): string {
        return ICONS.shapes[shape] || ICONS.shapes.rect;
    }

    private updateKeyboardModeVisual(): void {
        const isKeyboardActive = !this.options.penEnabled;
        this.keyboardBtn.classList.toggle('is-active', isKeyboardActive);
        this.keyboardBtn.setAttribute('aria-pressed', String(isKeyboardActive));
    }

    private updateToolButtonsVisual(): void {
        const activeTool = this.options.activeTool;
        const penOn = this.options.penEnabled;

        this.toolButtons.forEach((btn, tool) => {
            const isActive = penOn && activeTool === tool;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-pressed', String(isActive));
        });
    }

    private updateHistoryButtonsVisual(): void {
        this.undoBtn.disabled = !this.options.canUndo;
        this.undoBtn.classList.toggle('is-disabled', !this.options.canUndo);
        this.redoBtn.disabled = !this.options.canRedo;
        this.redoBtn.classList.toggle('is-disabled', !this.options.canRedo);
    }

    private updateFavoritesVisual(): void {
        const dark = isDarkTheme();
        const activeFav = this.options.activeFavoriteIndex;

        this.favButtons.forEach((btn, index) => {
            const fav = this.options.favorites[index];
            if (!fav) return;
            const dot = btn.querySelector<HTMLElement>('.apolo-fav-dot');
            if (dot) {
                dot.style.background = mapInkColorForDark(fav.color, dark);
            }
            const isActive = activeFav === index && this.options.activeTool === 'pen';
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-pressed', String(isActive));
        });
    }

    private updateThicknessVisual(): void {
        const isEraser = this.options.activeTool === 'eraser';
        const isDimmed = !this.options.penEnabled || this.options.activeTool === 'lasso' || this.options.activeTool === 'spacer';
        const dark = isDarkTheme();

        let activeIdx = 1; // default medium
        if (isEraser) {
            const r = this.options.eraserRadius;
            if (r <= 12) activeIdx = 0;
            else if (r <= 22) activeIdx = 1;
            else activeIdx = 2;
        } else {
            const w = this.options.activeWidth;
            if (w <= 2.5) activeIdx = 0;
            else if (w <= 4.5) activeIdx = 1;
            else activeIdx = 2;
        }

        this.thicknessButtons.forEach((btn, index) => {
            btn.classList.toggle('is-dimmed', isDimmed);
            btn.classList.toggle('is-eraser', isEraser);
            btn.classList.toggle('is-active', !isDimmed && activeIdx === index);

            const dot = btn.querySelector<HTMLElement>('.apolo-thickness-dot');
            if (dot) {
                if (isEraser) {
                    dot.style.background = 'transparent';
                    dot.style.border = '2px solid currentColor';
                } else {
                    dot.style.border = 'none';
                    dot.style.background = activeIdx === index
                        ? mapInkColorForDark(this.options.activeColor, dark)
                        : 'currentColor';
                }
            }
        });
    }

    private updateSnapGridVisual(): void {
        this.gridBtn.classList.toggle('is-active', this.options.snapGrid);
        this.gridBtn.setAttribute('aria-pressed', String(this.options.snapGrid));
    }

    // Pointer event dragging logic
    private readonly onGripPointerDown = (e: PointerEvent): void => {
        e.preventDefault();
        e.stopPropagation();

        const el = e.currentTarget as HTMLElement;
        const rect = this.container.getBoundingClientRect();
        const scale = (rect.width / this.container.offsetWidth) || 1;

        this.dragState = {
            pointerId: e.pointerId,
            scale,
            startX: e.clientX,
            startY: e.clientY,
            origLeft: rect.left,
            origTop: rect.top,
        };

        try {
            el.setPointerCapture(e.pointerId);
        } catch {
            // best effort
        }

        this.currentDragPos = { x: rect.left, y: rect.top };
        this.showSnapDots();

        window.addEventListener('pointermove', this.onGripPointerMove, { passive: false });
        window.addEventListener('pointerup', this.onGripPointerUp);
        window.addEventListener('pointercancel', this.onGripPointerUp);
    };

    private readonly onGripPointerMove = (e: PointerEvent): void => {
        if (!this.dragState || e.pointerId !== this.dragState.pointerId) return;
        e.preventDefault();

        const dx = (e.clientX - this.dragState.startX) / this.dragState.scale;
        const dy = (e.clientY - this.dragState.startY) / this.dragState.scale;

        const newX = this.dragState.origLeft + dx;
        const newY = this.dragState.origTop + dy;

        this.currentDragPos = { x: newX, y: newY };
        this.updatePosition();

        const curWidth = this.container.offsetWidth;
        const curHeight = this.container.offsetHeight;
        const nearest = this.getNearestSlot(newX + curWidth / 2, newY + curHeight / 2);
        this.highlightSnapDot(nearest);
    };

    private readonly onGripPointerUp = (e: PointerEvent): void => {
        if (!this.dragState || e.pointerId !== this.dragState.pointerId) return;

        const curWidth = this.container.offsetWidth;
        const curHeight = this.container.offsetHeight;
        const lastPos = this.currentDragPos || { x: this.dragState.origLeft, y: this.dragState.origTop };
        const nearest = this.getNearestSlot(lastPos.x + curWidth / 2, lastPos.y + curHeight / 2);

        this.dragState = null;
        this.currentDragPos = null;
        this.hideSnapDots();

        window.removeEventListener('pointermove', this.onGripPointerMove);
        window.removeEventListener('pointerup', this.onGripPointerUp);
        window.removeEventListener('pointercancel', this.onGripPointerUp);

        if (this.options.slot !== nearest) {
            this.setSlot(nearest);
            this.options.onSlotChange(nearest);
        } else {
            this.updatePosition();
        }
    };

    private showSnapDots(): void {
        this.dotsContainer.replaceChildren();
        this.dotsContainer.hidden = false;

        const slots: ToolbarSlot[] = ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'];
        for (const s of slots) {
            const coords = this.getSlotCoordinates(s);
            const dot = document.createElement('div');
            dot.className = 'apolo-snap-dot';
            dot.dataset.slot = s;
            dot.style.left = `${coords.x + coords.width / 2}px`;
            dot.style.top = `${coords.y + coords.height / 2}px`;
            this.dotsContainer.appendChild(dot);
        }
    }

    private highlightSnapDot(activeSlot: ToolbarSlot): void {
        this.dotsContainer.querySelectorAll<HTMLElement>('.apolo-snap-dot').forEach(dot => {
            dot.classList.toggle('is-nearest', dot.dataset.slot === activeSlot);
        });
    }

    private hideSnapDots(): void {
        this.dotsContainer.hidden = true;
        this.dotsContainer.replaceChildren();
    }

    // Public update API
    setSlot(slot: ToolbarSlot): void {
        const wasVert = this.isVertical();
        this.options.slot = slot;
        const nowVert = this.isVertical();
        if (wasVert !== nowVert) {
            this.render();
        }
        this.updatePosition();
    }

    setPenEnabled(enabled: boolean): void {
        this.options.penEnabled = enabled;
        this.updateKeyboardModeVisual();
        this.updateToolButtonsVisual();
        this.updateThicknessVisual();
    }

    setTool(tool: ToolType, shapeType?: ShapeType): void {
        this.options.activeTool = tool;
        if (shapeType) {
            this.setShape(shapeType);
        }
        this.updateToolButtonsVisual();
        this.updateThicknessVisual();
    }

    setShape(shape: ShapeType): void {
        this.options.activeShape = shape;
        if (this.shapeBtnIcon) {
            this.shapeBtnIcon.replaceChildren(createSvg(this.getShapeIcon(shape)));
        }
    }

    setStyle(color: string, width: number, profileId?: PenProfileId): void {
        this.options.activeColor = color;
        this.options.activeWidth = width;
        if (profileId) this.options.activeProfileId = profileId;
        this.updateThicknessVisual();
    }

    setFavorites(favorites: PenFavorite[], activeIndex: number): void {
        this.options.favorites = [...favorites];
        this.options.activeFavoriteIndex = activeIndex;
        this.updateFavoritesVisual();
    }

    setThicknessValues(width: number, eraserRadius: number): void {
        this.options.activeWidth = width;
        this.options.eraserRadius = eraserRadius;
        this.updateThicknessVisual();
    }

    setHistory(canUndo: boolean, canRedo: boolean): void {
        this.options.canUndo = canUndo;
        this.options.canRedo = canRedo;
        this.updateHistoryButtonsVisual();
    }

    setSnapGrid(enabled: boolean): void {
        this.options.snapGrid = enabled;
        this.updateSnapGridVisual();
    }

    setVisible(visible: boolean): void {
        this.container.hidden = !visible;
    }

    destroy(): void {
        window.removeEventListener('pointermove', this.onGripPointerMove);
        window.removeEventListener('pointerup', this.onGripPointerUp);
        window.removeEventListener('pointercancel', this.onGripPointerUp);
        this.dotsContainer.remove();
        this.container.remove();
    }
}
