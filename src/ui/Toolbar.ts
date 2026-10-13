import type { EraserMode, PenFavorite, PenProfileId, ShapeType, ThicknessPreset, ToolbarSlot, ToolType } from '../core/types.ts';
import { ICONS, createSvg, isDarkTheme, mapInkColorForDark } from './theme.ts';

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
    eraserMode?: EraserMode;
    onSlotChange: (slot: ToolbarSlot) => void;
    onToggleKeyboardMode: () => void;
    onSelectTool: (tool: ToolType) => void;
    onToggleEraserMode?: () => void;
    onToggleEstuche: (tool: ToolType) => void;
    onUndo: () => void;
    onRedo: () => void;
    onSelectFavorite: (index: number) => void;
    onSelectThickness: (preset: ThicknessPreset) => void;
    onToggleSnapGrid: () => void;
    onToggleMoreMenu?: () => void;
    onInsertCanvas?: () => void;
}

export type ToolbarItemId =
    | 'grip'
    | 'keyboardMode'
    | 'pen'
    | 'highlighter'
    | 'eraser'
    | 'lasso'
    | 'shape'
    | 'insertCanvas'
    | 'undo'
    | 'redo'
    | 'favorites'
    | 'thickness'
    | 'snapGrid';

export const TOOLBAR_PRIORITIES = {
    snapGrid: 10,   // Overflows first
    thickness: 20,  // Overflows second
    favorites: 30,  // Overflows third
    history: 70,    // Core undo / redo
    insertCanvas: 80,
    tools: 90,
    keyboardMode: 95,
    grip: 100,
} as const;

export interface ToolbarItemDefinition {
    id: ToolbarItemId;
    priority: number;
    groupId: string;
    label: string;
    render: () => HTMLElement;
    update?: () => void;
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
    private resizeObserver: ResizeObserver | null = null;

    // Set of currently overflowed items (hidden from toolbar, delegated to MoreMenu)
    private overflowedItemIds = new Set<string>();

    // DOM references for instant state updating
    private keyboardBtn!: HTMLButtonElement;
    private toolButtons = new Map<ToolType, HTMLButtonElement>();
    private shapeBtnIcon!: HTMLElement;
    private insertCanvasBtn!: HTMLButtonElement;
    private undoBtn!: HTMLButtonElement;
    private redoBtn!: HTMLButtonElement;
    private favGroup!: HTMLElement;
    private favButtons: HTMLButtonElement[] = [];
    private thicknessGroup!: HTMLElement;
    private thicknessButtons: HTMLButtonElement[] = [];
    private gridBtn!: HTMLButtonElement;

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
        this.setupObservers();
        this.recalculateLayout();
    }

    private setupObservers(): void {
        if (typeof ResizeObserver !== 'undefined' && typeof document !== 'undefined' && document.documentElement) {
            try {
                this.resizeObserver = new ResizeObserver(() => {
                    this.recalculateLayout();
                });
                this.resizeObserver.observe(document.documentElement);
            } catch {
                // best effort in testing environments
            }
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', this.onWindowResize);
        }
    }

    private readonly onWindowResize = (): void => {
        this.recalculateLayout();
    };

    private isVertical(): boolean {
        return this.options.slot === 'ml' || this.options.slot === 'mr';
    }

    getDimensions(slot?: ToolbarSlot): { width: number; height: number } {
        const targetSlot = slot ?? this.options.slot;
        const vert = targetSlot === 'ml' || targetSlot === 'mr';
        if (vert) {
            const h = (this.container.offsetHeight && this.container.offsetHeight > 0)
                ? this.container.offsetHeight
                : this.computeIntrinsicHeight();
            const maxH = typeof window !== 'undefined' ? window.innerHeight - 96 : 600;
            return {
                width: 58,
                height: Math.min(h, maxH),
            };
        }
        const w = (this.container.offsetWidth && this.container.offsetWidth > 0)
            ? this.container.offsetWidth
            : this.computeIntrinsicWidth();
        const maxW = typeof window !== 'undefined' ? window.innerWidth - 32 : 1200;
        return {
            width: Math.min(w, maxW),
            height: 58,
        };
    }

    getSlotCoordinates(slot: ToolbarSlot): { x: number; y: number; width: number; height: number } {
        const { width, height } = this.getDimensions(slot);

        const marginX = 16;
        const marginY = 56; // Leave room for Obsidian header / tabs
        const marginBottom = 36;

        const winW = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const winH = typeof window !== 'undefined' ? window.innerHeight : 800;

        let x = 0;
        if (slot === 'tl' || slot === 'ml' || slot === 'bl') {
            x = marginX;
        } else if (slot === 'tc' || slot === 'bc') {
            x = Math.round((winW - width) / 2);
        } else {
            // 'tr', 'mr', 'br'
            x = winW - width - marginX;
        }

        let y = 0;
        if (slot === 'tl' || slot === 'tc' || slot === 'tr') {
            y = marginY;
        } else if (slot === 'ml' || slot === 'mr') {
            y = Math.round((winH - height) / 2);
        } else {
            // 'bl', 'bc', 'br'
            y = winH - height - marginBottom;
        }

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
            this.container.style.width = vert ? '58px' : 'fit-content';
            this.container.style.maxWidth = 'calc(100vw - 32px)';
            this.container.style.height = vert ? 'fit-content' : '58px';
            this.container.style.maxHeight = 'calc(100vh - 96px)';
            this.container.style.transform = 'none';
            this.container.style.transition = 'left 0.25s cubic-bezier(0.2, 0, 0, 1), top 0.25s cubic-bezier(0.2, 0, 0, 1)';
        }
    }

    private render(): void {
        this.container.replaceChildren();

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
        // Inverted logic: active when !penEnabled, rendered with amber styling
        const kbBtn = document.createElement('button');
        kbBtn.type = 'button';
        kbBtn.className = 'apolo-toolbar-btn apolo-btn-keyboard';
        kbBtn.setAttribute('aria-label', 'Alternar modo lápiz / teclado (Alt+P)');
        kbBtn.title = 'Alternar modo lápiz / teclado (Alt+P)';
        kbBtn.appendChild(createSvg(ICONS.keyboardMode));
        kbBtn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
        });
        kbBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.options.onToggleKeyboardMode();
        });
        this.keyboardBtn = kbBtn;
        this.updateKeyboardModeVisual();
        this.container.appendChild(kbBtn);

        this.container.appendChild(this.createDivider());

        // 3. Core Tool buttons (pen, highlighter, eraser, lasso, shape)
        const toolsGroup = document.createElement('div');
        toolsGroup.className = 'apolo-toolbar-group apolo-tools-group';
        this.toolButtons.clear();

        const toolDefs: Array<{ tool: ToolType; label: string; iconD: string }> = [
            { tool: 'pen', label: 'Pluma', iconD: ICONS.pen },
            { tool: 'highlighter', label: 'Marcador', iconD: ICONS.highlighter },
            { tool: 'eraser', label: 'Borrador', iconD: ICONS.eraser },
            { tool: 'lasso', label: 'Lazo', iconD: ICONS.lasso },
            { tool: 'shape', label: 'Formas', iconD: this.getShapeIcon(this.options.activeShape) },
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

            // Triangle indicator for estuche on active tool
            const tri = document.createElement('span');
            tri.className = 'apolo-tool-triangle';
            tri.setAttribute('data-apolo-popover-trigger', 'true');
            tri.title = `Abrir opciones de ${def.label}`;
            tri.addEventListener('click', (e) => {
                e.stopPropagation();
                this.options.onToggleEstuche(def.tool);
            });
            btn.appendChild(tri);

            btn.setAttribute('data-apolo-popover-trigger', 'true');
            btn.addEventListener('click', () => {
                // Second tap on the active tool toggles its estuche (including eraser!)
                if (this.options.activeTool === def.tool && this.options.penEnabled) {
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

        // 4. Instant Action: "Insertar canvas" (one tap inserts canvas, not a persistent mode)
        const insertCanvasBtn = document.createElement('button');
        insertCanvasBtn.type = 'button';
        insertCanvasBtn.className = 'apolo-toolbar-btn apolo-tool-btn apolo-insert-canvas-btn';
        insertCanvasBtn.setAttribute('aria-label', 'Insertar canvas');
        insertCanvasBtn.title = 'Insertar canvas de dibujo';
        const canvasIconWrap = document.createElement('span');
        canvasIconWrap.className = 'apolo-tool-icon-wrap';
        canvasIconWrap.appendChild(createSvg(ICONS.insertCanvas));
        insertCanvasBtn.appendChild(canvasIconWrap);
        insertCanvasBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.options.onInsertCanvas?.();
        });
        this.insertCanvasBtn = insertCanvasBtn;
        this.container.appendChild(insertCanvasBtn);

        this.container.appendChild(this.createDivider());

        // 5. Undo and Redo - instant response on pointerdown with zero latency
        const historyGroup = document.createElement('div');
        historyGroup.className = 'apolo-toolbar-group apolo-history-group';

        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'apolo-toolbar-btn';
        undoBtn.setAttribute('aria-label', 'Deshacer (Ctrl+Z)');
        undoBtn.title = 'Deshacer (Ctrl+Z)';
        undoBtn.appendChild(createSvg(ICONS.undo));
        undoBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.options.canUndo) this.options.onUndo();
        });
        undoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.options.canUndo) this.options.onUndo();
        });
        this.undoBtn = undoBtn;

        const redoBtn = document.createElement('button');
        redoBtn.type = 'button';
        redoBtn.className = 'apolo-toolbar-btn';
        redoBtn.setAttribute('aria-label', 'Rehacer (Ctrl+Y / Ctrl+Shift+Z)');
        redoBtn.title = 'Rehacer (Ctrl+Y / Ctrl+Shift+Z)';
        redoBtn.appendChild(createSvg(ICONS.redo));
        redoBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.options.canRedo) this.options.onRedo();
        });
        redoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.options.canRedo) this.options.onRedo();
        });
        this.redoBtn = redoBtn;

        historyGroup.append(undoBtn, redoBtn);
        this.container.appendChild(historyGroup);
        this.updateHistoryButtonsVisual();

        this.container.appendChild(this.createDivider());

        // 6. Four Favorites (Priority 30: candidate for overflow)
        const favGroup = document.createElement('div');
        favGroup.className = 'apolo-toolbar-group apolo-favs-group';
        this.favGroup = favGroup;
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

        // 7. Thickness preset dots: fine (4px), medium (8px), thick (14px) (Priority 20: candidate for overflow)
        const thicknessGroup = document.createElement('div');
        thicknessGroup.className = 'apolo-toolbar-group apolo-thickness-group';
        this.thicknessGroup = thicknessGroup;
        this.thicknessButtons = [];

        const presets: Array<{ id: ThicknessPreset; label: string; tooltip: string }> = [
            { id: 'fine', label: 'Fino', tooltip: 'Grosor fino (letra pequeña)' },
            { id: 'medium', label: 'Normal', tooltip: 'Grosor normal (texto)' },
            { id: 'thick', label: 'Grueso', tooltip: 'Grosor grueso (títulos)' },
        ];

        for (let i = 0; i < presets.length; i++) {
            const preset = presets[i];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `apolo-toolbar-btn apolo-thickness-btn apolo-thick-${preset.id}`;
            btn.setAttribute('aria-label', preset.tooltip);
            btn.title = preset.tooltip;

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

        // 8. Grid (Priority 10: overflows first)
        const utilGroup = document.createElement('div');
        utilGroup.className = 'apolo-toolbar-group apolo-util-group';

        const gridBtn = document.createElement('button');
        gridBtn.type = 'button';
        gridBtn.className = 'apolo-toolbar-btn apolo-grid-btn';
        gridBtn.setAttribute('aria-label', 'Cuadrícula magnética (Snap to Grid)');
        gridBtn.title = 'Cuadrícula magnética (Snap to Grid)';
        gridBtn.appendChild(createSvg(ICONS.grid));
        gridBtn.addEventListener('click', () => this.options.onToggleSnapGrid());
        this.gridBtn = gridBtn;

        utilGroup.append(gridBtn);
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

    // Responsive overflow evaluation
    recalculateLayout(): void {
        this.evaluateOverflow();
        this.updatePosition();
    }

    private evaluateOverflow(): void {
        const vert = this.isVertical();
        const winW = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const winH = typeof window !== 'undefined' ? window.innerHeight : 800;

        const availableSpace = vert
            ? Math.max(300, winH - 96)
            : Math.max(300, winW - 32);

        // Reset visibility before measuring
        this.overflowedItemIds.clear();
        this.setCandidateVisibility('snapGrid', true);
        this.setCandidateVisibility('thickness', true);
        this.setCandidateVisibility('favorites', true);
        this.updateDividersVisibility();

        // Candidates ordered by priority: lowest priority overflows first
        const overflowCandidates: Array<{ id: 'snapGrid' | 'thickness' | 'favorites'; priority: number }> = [
            { id: 'snapGrid', priority: TOOLBAR_PRIORITIES.snapGrid },
            { id: 'thickness', priority: TOOLBAR_PRIORITIES.thickness },
            { id: 'favorites', priority: TOOLBAR_PRIORITIES.favorites },
        ];

        let neededSpace = vert ? this.getNeededHeight() : this.getNeededWidth();

        for (const candidate of overflowCandidates) {
            if (neededSpace <= availableSpace) {
                break;
            }
            // Candidate must overflow
            this.overflowedItemIds.add(candidate.id);
            this.setCandidateVisibility(candidate.id, false);
            this.updateDividersVisibility();
            neededSpace = vert ? this.getNeededHeight() : this.getNeededWidth();
        }
    }

    private setCandidateVisibility(id: 'snapGrid' | 'thickness' | 'favorites', visible: boolean): void {
        if (id === 'snapGrid' && this.gridBtn) {
            this.gridBtn.classList.toggle('is-overflowed', !visible);
            this.gridBtn.style.display = visible ? '' : 'none';
        } else if (id === 'thickness' && this.thicknessGroup) {
            this.thicknessGroup.classList.toggle('is-overflowed', !visible);
            this.thicknessGroup.style.display = visible ? '' : 'none';
        } else if (id === 'favorites' && this.favGroup) {
            this.favGroup.classList.toggle('is-overflowed', !visible);
            this.favGroup.style.display = visible ? '' : 'none';
        }
    }

    private updateDividersVisibility(): void {
        const children = Array.from(this.container.children) as HTMLElement[];
        let hasVisiblePreceding = false;

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child.classList.contains('apolo-snap-dots-container')) continue;

            if (child.classList.contains('apolo-toolbar-divider')) {
                // Find if there is any visible following interactive element
                let hasVisibleFollowing = false;
                for (let j = i + 1; j < children.length; j++) {
                    const next = children[j];
                    if (!next.classList.contains('apolo-toolbar-divider') && next.style.display !== 'none' && !next.hidden) {
                        hasVisibleFollowing = true;
                        break;
                    }
                }
                if (hasVisiblePreceding && hasVisibleFollowing) {
                    child.style.display = '';
                    hasVisiblePreceding = false;
                } else {
                    child.style.display = 'none';
                }
            } else {
                if (child.style.display !== 'none' && !child.hidden) {
                    hasVisiblePreceding = true;
                }
            }
        }
    }

    private getNeededWidth(): number {
        if (this.container.scrollWidth && this.container.scrollWidth > 0) {
            return this.container.scrollWidth;
        }
        return this.computeIntrinsicWidth();
    }

    private getNeededHeight(): number {
        if (this.container.scrollHeight && this.container.scrollHeight > 0) {
            return this.container.scrollHeight;
        }
        return this.computeIntrinsicHeight();
    }

    computeIntrinsicWidth(): number {
        let width = 24; // padding left & right (12px * 2)
        // grip
        width += 22 + 2;
        // keyboard
        width += 42 + 2;
        // divider
        width += 13;
        // 5 tools
        width += 5 * 42 + 4 * 2;
        // divider
        width += 13;
        // insert canvas
        width += 42 + 2;
        // divider
        width += 13;
        // history (undo, redo)
        width += 2 * 42 + 2;

        if (!this.overflowedItemIds.has('favorites')) {
            width += 13; // divider
            width += 4 * 38 + 3 * 2;
        }
        if (!this.overflowedItemIds.has('thickness')) {
            width += 13; // divider
            width += 3 * 36 + 2 * 2;
        }
        if (!this.overflowedItemIds.has('snapGrid')) {
            width += 13; // divider
            width += 42 + 2;
        }
        return width;
    }

    computeIntrinsicHeight(): number {
        let height = 16; // padding top & bottom (8px * 2)
        // grip
        height += 20 + 2;
        // keyboard
        height += 36 + 2;
        // divider
        height += 9;
        // 5 tools
        height += 5 * 36 + 4 * 2;
        // divider
        height += 9;
        // insert canvas
        height += 36 + 2;
        // divider
        height += 9;
        // history
        height += 2 * 36 + 2;

        if (!this.overflowedItemIds.has('favorites')) {
            height += 9;
            height += 4 * 34 + 3 * 2;
        }
        if (!this.overflowedItemIds.has('thickness')) {
            height += 9;
            height += 3 * 32 + 2 * 2;
        }
        if (!this.overflowedItemIds.has('snapGrid')) {
            height += 9; // divider
            height += 36 + 2;
        }
        return height;
    }

    getOverflowedItems(): string[] {
        return Array.from(this.overflowedItemIds);
    }

    isItemOverflowed(id: string): boolean {
        return this.overflowedItemIds.has(id);
    }

    getSlot(): ToolbarSlot {
        return this.options.slot;
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

            if (tool === 'eraser') {
                const isWhole = (this.options.eraserMode ?? 'whole') === 'whole';
                btn.classList.toggle('is-whole-mode', isWhole);
                btn.classList.toggle('is-reticle-mode', !isWhole);
                const title = isWhole
                    ? 'Borrador (Trazo completo) - Clic para opciones'
                    : 'Borrador (Retícula / Píxel) - Clic para opciones';
                btn.title = title;
                btn.setAttribute('aria-label', title);
            }
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
        const isHighlighter = this.options.activeTool === 'highlighter';
        const isDimmed = !this.options.penEnabled || this.options.activeTool === 'lasso';
        const dark = isDarkTheme();

        let activeIdx = 1; // default medium
        if (isEraser) {
            const r = this.options.eraserRadius;
            if (r <= 12) activeIdx = 0;
            else if (r <= 25) activeIdx = 1;
            else activeIdx = 2;
        } else if (isHighlighter) {
            const w = this.options.activeWidth;
            if (w <= 15) activeIdx = 0;
            else if (w <= 25) activeIdx = 1;
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

        const curWidth = this.container.offsetWidth || this.computeIntrinsicWidth();
        const curHeight = this.container.offsetHeight || this.computeIntrinsicHeight();
        const nearest = this.getNearestSlot(newX + curWidth / 2, newY + curHeight / 2);
        this.highlightSnapDot(nearest);
    };

    private readonly onGripPointerUp = (e: PointerEvent): void => {
        if (!this.dragState || e.pointerId !== this.dragState.pointerId) return;

        const curWidth = this.container.offsetWidth || this.computeIntrinsicWidth();
        const curHeight = this.container.offsetHeight || this.computeIntrinsicHeight();
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
        this.recalculateLayout();
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

    setEraserMode(mode: EraserMode): void {
        this.options.eraserMode = mode;
        this.updateToolButtonsVisual();
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

    getToolButton(tool: ToolType): HTMLButtonElement | undefined {
        return this.toolButtons.get(tool);
    }

    setVisible(visible: boolean): void {
        this.container.hidden = !visible;
    }

    destroy(): void {
        this.resizeObserver?.disconnect();
        if (typeof window !== 'undefined') {
            window.removeEventListener('resize', this.onWindowResize);
            window.removeEventListener('pointermove', this.onGripPointerMove);
            window.removeEventListener('pointerup', this.onGripPointerUp);
            window.removeEventListener('pointercancel', this.onGripPointerUp);
        }
        this.dotsContainer.remove();
        this.container.remove();
    }
}
