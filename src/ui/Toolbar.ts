import type { EraserMode, PenFavorite, PenProfileId, ShapeType, ThicknessPreset, ToolbarSlot, ToolType } from '../core/types.ts';
import { ICONS, createSvg } from './theme.ts';
import { ColorPickerPopover } from './popover/ColorPickerPopover.ts';
import { ThicknessPopover } from './popover/ThicknessPopover.ts';

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
    onChangeColor?: (color: string) => void;
    onChangeWidth?: (width: number) => void;
    onSelectColorSlot?: (
        toolKey: 'pen' | 'highlighter' | 'shape',
        slotIndex: number,
        color: string,
        opacity: number
    ) => void;
    onUpdatePaletteColor?: (
        toolKey: 'pen' | 'highlighter' | 'shape',
        slotIndex: number,
        color: string,
        opacity: number
    ) => void;
    toolPalettes?: {
        pen?: { colors: string[]; opacities: number[] };
        highlighter?: { colors: string[]; opacities: number[] };
        shape?: { colors: string[]; opacities: number[] };
    };
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

const SNAP_SLOTS: ToolbarSlot[] = ['tc', 'bc', 'ml', 'mr'];
const EDGE_THRESHOLD = 36;
const UNLOCK_DELTA = 44;

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
    initialSlot: ToolbarSlot;
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
}

interface LockedSnap {
    slot: ToolbarSlot;
    pointerX: number;
    pointerY: number;
}

export class Toolbar {
    readonly container: HTMLElement;
    private readonly dotsContainer: HTMLElement;
    private options: ToolbarOptions;
    private dragState: DragState | null = null;
    private lockedSnap: LockedSnap | null = null;
    private currentDragPos: { x: number; y: number } | null = null;
    private unlockTransitionUntil = 0;
    private resizeObserver: ResizeObserver | null = null;

    // Set of currently overflowed items (hidden from toolbar, delegated to MoreMenu)
    private overflowedItemIds = new Set<string>();

    // Tool palettes per core tool with 4 slots and opacities (Samsung Notes style)
    readonly toolPalettes: Record<'pen' | 'highlighter' | 'shape', { colors: string[]; opacities: number[] }> = {
        pen: {
            colors: ['#E53935', '#1F4FD8', '#10B981', '#111827'],
            opacities: [100, 100, 100, 100],
        },
        highlighter: {
            colors: ['#1E88E5', '#FDD835', '#43A047', '#00ACC1'],
            opacities: [75, 75, 75, 75],
        },
        shape: {
            colors: ['#2F6BFF', '#111827', '#FFA726', '#10B981'],
            opacities: [100, 100, 100, 100],
        },
    };
    readonly activeColorSlots: Record<'pen' | 'highlighter' | 'shape', number> = {
        pen: 0,
        highlighter: 0,
        shape: 0,
    };

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
    private thicknessTriggerBtn!: HTMLButtonElement;
    private thickLinePreview!: HTMLElement;
    private thicknessButtons: HTMLButtonElement[] = [];
    private gridBtn!: HTMLButtonElement;

    // Modular Popovers
    readonly thicknessPopover: ThicknessPopover;
    readonly colorPickerPopover: ColorPickerPopover;

    constructor(options: ToolbarOptions, parent: HTMLElement = document.body) {
        this.options = { ...options, slot: this.normalizeSlot(options.slot) };

        if (options.toolPalettes) {
            if (options.toolPalettes.pen) {
                this.toolPalettes.pen = {
                    colors: [...options.toolPalettes.pen.colors],
                    opacities: [...options.toolPalettes.pen.opacities],
                };
            }
            if (options.toolPalettes.highlighter) {
                this.toolPalettes.highlighter = {
                    colors: [...options.toolPalettes.highlighter.colors],
                    opacities: [...options.toolPalettes.highlighter.opacities],
                };
            }
            if (options.toolPalettes.shape) {
                this.toolPalettes.shape = {
                    colors: [...options.toolPalettes.shape.colors],
                    opacities: [...options.toolPalettes.shape.opacities],
                };
            }
        } else if (options.favorites && options.favorites.length > 0) {
            this.toolPalettes.pen.colors = options.favorites.slice(0, 4).map(f => f.color);
        }
        if (options.activeFavoriteIndex !== undefined) {
            this.activeColorSlots.pen = Math.max(0, Math.min(3, options.activeFavoriteIndex));
        }

        this.thicknessPopover = new ThicknessPopover((width: number) => {
            this.options.activeWidth = width;
            this.updateThicknessVisual();
            this.options.onChangeWidth?.(width);
        }, parent);

        this.colorPickerPopover = new ColorPickerPopover(parent);

        this.container = document.createElement('div');
        this.container.className = 'apolo-canvas-toolbar';
        this.container.setAttribute('role', 'toolbar');

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
                if (typeof document.querySelector === 'function') {
                    for (const selector of ['.workspace-split.mod-root', '.workspace-leaf.mod-active']) {
                        const workspaceEl = document.querySelector<HTMLElement>(selector);
                        if (workspaceEl) this.resizeObserver.observe(workspaceEl);
                    }
                }
            } catch {
                // best effort in testing environments
            }
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', this.onWindowResize);
            window.addEventListener('pointerdown', this.onWindowPointerDown, { capture: true });
        }
    }

    private readonly onWindowPointerDown = (e: PointerEvent): void => {
        const target = e.target as HTMLElement | null;
        if (!target || typeof target.closest !== 'function') return;

        const thicknessHit = this.thicknessTriggerBtn?.contains(target) ?? false;
        if (this.thicknessPopover?.isOpen() && !thicknessHit && !this.thicknessPopover.el.contains(target as Node)) {
            this.thicknessPopover.close();
            this.thicknessTriggerBtn?.classList.remove('is-open');
        }

        const colorHit = this.favGroup?.contains(target) ?? false;
        if (this.colorPickerPopover?.isOpen() && !colorHit && !this.colorPickerPopover.el.contains(target as Node)) {
            this.colorPickerPopover.close();
        }
    };

    private readonly onWindowResize = (): void => {
        this.recalculateLayout();
    };

    private isVertical(): boolean {
        return this.options.slot === 'ml' || this.options.slot === 'mr';
    }

    private normalizeSlot(slot: ToolbarSlot): ToolbarSlot {
        if (slot === 'tl' || slot === 'tr') return 'tc';
        if (slot === 'bl' || slot === 'br') return 'bc';
        return slot;
    }

    private getActiveEditingElement(): HTMLElement | null {
        if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
        return document.querySelector<HTMLElement>('.workspace-leaf.mod-active .view-content')
            ?? document.querySelector<HTMLElement>('.workspace-split.mod-vertical.mod-root')
            ?? document.querySelector<HTMLElement>('.mod-root');
    }

    private getEditingBounds(): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
        const editEl = this.getActiveEditingElement();
        if (editEl) {
            const rect = editEl.getBoundingClientRect();
            if (rect.width > 100 && rect.height > 100) {
                return {
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                };
            }
        }

        const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
        const width = viewport?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 1280);
        const height = viewport?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 800);
        return { left: 0, top: 0, right: width, bottom: height, width, height };
    }

    getDimensions(slot?: ToolbarSlot): { width: number; height: number } {
        const targetSlot = slot ?? this.options.slot;
        const vert = targetSlot === 'ml' || targetSlot === 'mr';
        const isCurrentOrientation = vert === this.isVertical();
        const bounds = this.getEditingBounds();
        if (vert) {
            const h = isCurrentOrientation && this.container.offsetHeight > 64
                ? this.container.offsetHeight
                : this.computeIntrinsicHeight();
            const maxH = bounds.height - 96;
            return {
                width: 58,
                height: Math.min(h, maxH),
            };
        }
        const w = isCurrentOrientation && this.container.offsetWidth > 64
            ? this.container.offsetWidth
            : this.computeIntrinsicWidth();
        const maxW = bounds.width - 32;
        return {
            width: Math.min(w, maxW),
            height: 58,
        };
    }

    getSlotCoordinates(slot: ToolbarSlot): { x: number; y: number; width: number; height: number } {
        const { width, height } = this.getDimensions(slot);
        const bounds = this.getEditingBounds();
        const editEl = this.getActiveEditingElement();
        const marginX = 16;
        const marginY = editEl?.classList.contains('view-content') ? 16 : 56;
        const marginBottom = 56;

        let x = 0;
        if (slot === 'tl' || slot === 'ml' || slot === 'bl') {
            x = bounds.left + marginX;
        } else if (slot === 'tc' || slot === 'bc') {
            x = Math.round(bounds.left + (bounds.width - width) / 2);
        } else {
            // 'tr', 'mr', 'br'
            x = bounds.right - width - marginX;
        }

        let y = 0;
        if (slot === 'tl' || slot === 'tc' || slot === 'tr') {
            y = bounds.top + marginY;
        } else if (slot === 'ml' || slot === 'mr') {
            y = Math.round(bounds.top + (bounds.height - height) / 2);
        } else {
            // 'bl', 'bc', 'br'
            y = bounds.bottom - height - marginBottom;
        }

        x = Math.max(bounds.left + 8, Math.min(Math.max(bounds.left + 8, bounds.right - width - 8), x));
        y = Math.max(bounds.top + 8, Math.min(Math.max(bounds.top + 8, bounds.bottom - height - 8), y));

        return { x, y, width, height };
    }

    private getLeadingEdgeSnapSlot(
        pointerX: number,
        pointerY: number,
        toolbarRect: { left: number; top: number; right: number; bottom: number },
    ): ToolbarSlot | null {
        const bounds = this.getEditingBounds();
        const cx = bounds.left + bounds.width / 2;
        const cy = bounds.top + bounds.height / 2;
        const horizSpan = Math.min(240, Math.max(140, Math.round(bounds.width * 0.34)));
        const vertSpan = Math.min(240, Math.max(140, Math.round(bounds.height * 0.34)));
        const centerX = toolbarRect.left + (toolbarRect.right - toolbarRect.left) / 2;
        const centerY = toolbarRect.top + (toolbarRect.bottom - toolbarRect.top) / 2;
        const topDist = toolbarRect.top - bounds.top;
        const bottomDist = bounds.bottom - toolbarRect.bottom;
        const leftDist = toolbarRect.left - bounds.left;
        const rightDist = bounds.right - toolbarRect.right;
        const inHorizCenter = Math.abs((this.isVertical() ? centerX : pointerX) - cx) <= horizSpan / 2;
        const inVertCenter = Math.abs((this.isVertical() ? pointerY : centerY) - cy) <= vertSpan / 2;
        const deltaX = pointerX - (this.dragState?.startX ?? pointerX);
        const deltaY = pointerY - (this.dragState?.startY ?? pointerY);

        if (inHorizCenter && topDist <= EDGE_THRESHOLD && topDist < bottomDist && deltaY < 0) return 'tc';
        if (inHorizCenter && bottomDist <= EDGE_THRESHOLD && bottomDist < topDist && deltaY > 0) return 'bc';
        if (inVertCenter && leftDist <= EDGE_THRESHOLD && leftDist < rightDist && deltaX < 0) return 'ml';
        if (inVertCenter && rightDist <= EDGE_THRESHOLD && rightDist < leftDist && deltaX > 0) return 'mr';
        return null;
    }

    private shouldKeepLockedSnap(pointerX: number, pointerY: number): boolean {
        if (!this.lockedSnap) return false;
        const bounds = this.getEditingBounds();
        const cx = bounds.left + bounds.width / 2;
        const cy = bounds.top + bounds.height / 2;
        const horizSpan = Math.min(240, Math.max(140, Math.round(bounds.width * 0.34)));
        const vertSpan = Math.min(240, Math.max(140, Math.round(bounds.height * 0.34)));

        switch (this.lockedSnap.slot) {
            case 'tc':
                return pointerY <= this.lockedSnap.pointerY + UNLOCK_DELTA
                    && Math.abs(pointerX - cx) <= horizSpan / 2 + 30;
            case 'bc':
                return pointerY >= this.lockedSnap.pointerY - UNLOCK_DELTA
                    && Math.abs(pointerX - cx) <= horizSpan / 2 + 30;
            case 'ml':
                return pointerX <= this.lockedSnap.pointerX + UNLOCK_DELTA
                    && Math.abs(pointerY - cy) <= vertSpan / 2 + 30;
            case 'mr':
                return pointerX >= this.lockedSnap.pointerX - UNLOCK_DELTA
                    && Math.abs(pointerY - cy) <= vertSpan / 2 + 30;
        }
        return false;
    }

    private anchorToSnapSlot(slot: ToolbarSlot): void {
        const wasVertical = this.isVertical();
        this.options.slot = slot;
        if (wasVertical !== this.isVertical()) this.triggerOrientationAnimation();
        this.applyOrientationStyles();
        this.evaluateOverflow();
        const coords = this.getSlotCoordinates(slot);
        this.currentDragPos = { x: coords.x, y: coords.y };
        this.updatePosition();
    }

    private clampPosition(x: number, y: number, width: number, height: number): { x: number; y: number } {
        const bounds = this.getEditingBounds();
        const minX = bounds.left + 8;
        const minY = bounds.top + 8;
        const maxX = Math.max(minX, bounds.right - width - 8);
        const maxY = Math.max(minY, bounds.bottom - height - 8);
        return {
            x: Math.max(minX, Math.min(maxX, x)),
            y: Math.max(minY, Math.min(maxY, y)),
        };
    }

    private applyOrientationStyles(): void {
        const vert = this.isVertical();
        this.container.classList.toggle('is-vertical', vert);
        this.container.style.width = vert ? '58px' : 'fit-content';
        this.container.style.maxWidth = 'calc(100vw - 32px)';
        this.container.style.height = vert ? 'fit-content' : '58px';
        this.container.style.maxHeight = 'calc(100vh - 96px)';
    }

    private triggerOrientationAnimation(): void {
        this.container.classList.remove('is-flipping-orientation');
        void this.container.offsetWidth;
        this.container.classList.add('is-flipping-orientation');
    }

    private updatePosition(): void {
        this.applyOrientationStyles();
        const isSnapLocked = this.lockedSnap !== null;
        this.container.classList.toggle('is-snap-locked', isSnapLocked);
        if (this.currentDragPos) {
            this.container.classList.toggle('is-dragging', !isSnapLocked);
            const { width, height } = this.getDimensions();
            this.currentDragPos = this.clampPosition(this.currentDragPos.x, this.currentDragPos.y, width, height);
            this.container.style.left = `${this.currentDragPos.x}px`;
            this.container.style.top = `${this.currentDragPos.y}px`;
            this.container.style.transform = 'none';
            const isUnlocking = this.unlockTransitionUntil > Date.now();
            this.container.style.transition = isSnapLocked
                ? 'left 0.24s cubic-bezier(0.22, 1, 0.36, 1), top 0.24s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.22s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)'
                : isUnlocking
                    ? 'left 0.16s cubic-bezier(0.22, 1, 0.36, 1), top 0.16s cubic-bezier(0.22, 1, 0.36, 1)'
                    : 'box-shadow 0.2s ease';
        } else {
            this.container.classList.remove('is-dragging', 'is-snap-locked');
            const coords = this.getSlotCoordinates(this.options.slot);
            this.container.style.left = `${coords.x}px`;
            this.container.style.top = `${coords.y}px`;
            this.container.style.transform = 'none';
            this.container.style.transition = 'left 0.24s cubic-bezier(0.22, 1, 0.36, 1), top 0.24s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.22s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)';
        }
    }

    private render(): void {
        this.container.replaceChildren();

        // 1. Grip handle for dragging
        const grip = document.createElement('button');
        grip.type = 'button';
        grip.className = 'apolo-toolbar-grip';
        grip.appendChild(createSvg(ICONS.dragGrip, {
            size: 18,
            width: 18,
            height: 18,
            viewBox: '0 0 14 14',
            fill: 'currentColor',
            stroke: 'none',
            strokeWidth: 0,
        }));
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


            btn.setAttribute('data-apolo-popover-trigger', 'true');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeAllPopovers();
                // Second tap on the active tool toggles its estuche (including eraser!)
                if (this.options.activeTool === def.tool && this.options.penEnabled) {
                    this.options.onToggleEstuche(def.tool);
                } else {
                    this.options.penEnabled = true;
                    this.setTool(def.tool);
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

        // 6. Dynamic Color slots per tool (Priority 30: candidate for overflow)
        const favGroup = document.createElement('div');
        favGroup.className = 'apolo-toolbar-group apolo-favs-group';
        this.favGroup = favGroup;
        this.favButtons = [];

        for (let i = 0; i < 4; i++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'apolo-toolbar-btn apolo-color-slot-btn apolo-fav-chip';
            btn.setAttribute('data-apolo-popover-trigger', 'true');
            btn.setAttribute('aria-label', `Color ${i + 1}`);
            btn.title = `Color ${i + 1} (Clic para seleccionar, clic de nuevo para editar)`;

            const dot = document.createElement('span');
            dot.className = 'apolo-color-dot apolo-fav-dot';
            btn.appendChild(dot);

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const paletteKey = this.getToolbarPaletteKey();
                const currentActiveSlot = this.activeColorSlots[paletteKey] ?? 0;

                if (currentActiveSlot === i) {
                    // 2nd tap on already active slot: toggle ColorPickerPopover
                    if (this.colorPickerPopover.isOpen()) {
                        this.colorPickerPopover.close();
                    } else {
                        this.closeAllPopovers();
                        const currentColor = this.toolPalettes[paletteKey].colors[i] || '#E53935';
                        const currentOpacity = this.toolPalettes[paletteKey].opacities[i] ?? 100;
                        this.colorPickerPopover.open(
                            btn,
                            this.options.slot,
                            this.container,
                            currentColor,
                            (newColor: string, opacity: number, slotIdx: number | null) => {
                                const targetIdx = slotIdx !== null ? slotIdx : i;
                                this.toolPalettes[paletteKey].colors[targetIdx] = newColor;
                                this.toolPalettes[paletteKey].opacities[targetIdx] = opacity;
                                this.options.activeColor = newColor;
                                this.updateFavoritesVisual();
                                this.options.onChangeColor?.(newColor);
                                this.options.onUpdatePaletteColor?.(paletteKey, targetIdx, newColor, opacity);
                            },
                            i,
                            currentOpacity
                        );
                    }
                } else {
                    // 1st tap: select slot (strictly changes active color without resetting tool configuration)
                    this.closeAllPopovers();
                    this.activeColorSlots[paletteKey] = i;
                    const color = this.toolPalettes[paletteKey].colors[i] || '#E53935';
                    const opacity = this.toolPalettes[paletteKey].opacities[i] ?? 100;
                    this.options.activeColor = color;
                    this.updateFavoritesVisual();
                    this.options.onChangeColor?.(color);
                    this.options.onSelectFavorite?.(i);
                    this.options.onSelectColorSlot?.(paletteKey, i, color, opacity);
                }
            });

            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const paletteKey = this.getToolbarPaletteKey();
                this.activeColorSlots[paletteKey] = i;
                this.closeAllPopovers();
                const currentColor = this.toolPalettes[paletteKey].colors[i] || '#E53935';
                const currentOpacity = this.toolPalettes[paletteKey].opacities[i] ?? 100;
                this.colorPickerPopover.open(
                    btn,
                    this.options.slot,
                    this.container,
                    currentColor,
                    (newColor: string, opacity: number, slotIdx: number | null) => {
                        const targetIdx = slotIdx !== null ? slotIdx : i;
                        this.toolPalettes[paletteKey].colors[targetIdx] = newColor;
                        this.toolPalettes[paletteKey].opacities[targetIdx] = opacity;
                        this.options.activeColor = newColor;
                        this.updateFavoritesVisual();
                        this.options.onChangeColor?.(newColor);
                        this.options.onUpdatePaletteColor?.(paletteKey, targetIdx, newColor, opacity);
                    },
                    i,
                    currentOpacity
                );
            });

            this.favButtons.push(btn);
            favGroup.appendChild(btn);
        }
        this.container.appendChild(favGroup);
        this.updateFavoritesVisual();

        this.container.appendChild(this.createDivider());

        // 7. Single Thickness trigger button (Priority 20: candidate for overflow)
        const thicknessGroup = document.createElement('div');
        thicknessGroup.className = 'apolo-toolbar-group apolo-thickness-group';
        this.thicknessGroup = thicknessGroup;

        const thickBtn = document.createElement('button');
        thickBtn.type = 'button';
        thickBtn.className = 'apolo-toolbar-btn apolo-thickness-trigger-btn apolo-thickness-btn';
        thickBtn.setAttribute('data-apolo-popover-trigger', 'true');
        thickBtn.setAttribute('aria-label', 'Grosor de trazo');
        thickBtn.title = 'Grosor de trazo (Clic para abrir o cerrar barra deslizable)';

        this.thickLinePreview = document.createElement('span');
        this.thickLinePreview.className = 'apolo-thickness-line-preview apolo-thickness-dot';
        thickBtn.appendChild(this.thickLinePreview);

        thickBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.thicknessPopover.isOpen()) {
                this.thicknessPopover.close();
                thickBtn.classList.remove('is-open');
            } else {
                this.closeAllPopovers();
                thickBtn.classList.add('is-open');
                this.thicknessPopover.open(
                    thickBtn,
                    this.options.slot,
                    this.container,
                    this.options.activeWidth
                );
            }
        });

        this.thicknessTriggerBtn = thickBtn;
        this.thicknessButtons = [thickBtn];
        thicknessGroup.appendChild(thickBtn);
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
        this.applyOrientationStyles();
        this.evaluateOverflow();
        this.updatePosition();
    }

    private evaluateOverflow(): void {
        const vert = this.isVertical();
        const bounds = this.getEditingBounds();

        const availableSpace = vert
            ? Math.max(0, bounds.height - 96)
            : Math.max(0, bounds.width - 32);

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
        let width = 40; // padding left & right (20px * 2)
        // grip
        width += 20 + 8;
        // keyboard
        width += 40 + 8;
        // divider
        width += 17;
        // 5 tools
        width += 5 * 40 + 4 * 10;
        // divider
        width += 17;
        // insert canvas
        width += 40 + 8;
        // divider
        width += 17;
        // history (undo, redo)
        width += 2 * 40 + 6;

        if (!this.overflowedItemIds.has('favorites')) {
            width += 17; // divider
            width += 4 * 36 + 3 * 10;
        }
        if (!this.overflowedItemIds.has('thickness')) {
            width += 17; // divider
            width += 36;
        }
        if (!this.overflowedItemIds.has('snapGrid')) {
            width += 17; // divider
            width += 40;
        }
        return width;
    }

    computeIntrinsicHeight(): number {
        let height = 40; // padding top & bottom (20px * 2)
        // grip
        height += 20 + 8;
        // keyboard
        height += 40 + 8;
        // divider
        height += 17;
        // 5 tools
        height += 5 * 40 + 4 * 10;
        // divider
        height += 17;
        // insert canvas
        height += 40 + 8;
        // divider
        height += 17;
        // history
        height += 2 * 40 + 6;

        if (!this.overflowedItemIds.has('favorites')) {
            height += 17;
            height += 4 * 36 + 3 * 10;
        }
        if (!this.overflowedItemIds.has('thickness')) {
            height += 17;
            height += 36;
        }
        if (!this.overflowedItemIds.has('snapGrid')) {
            height += 17; // divider
            height += 40;
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

    private getToolbarPaletteKey(): 'pen' | 'highlighter' | 'shape' {
        if (this.options.activeTool === 'highlighter' || this.options.activeTool === 'shape') {
            return this.options.activeTool;
        }
        return 'pen';
    }

    private syncToolbarPaletteFromTool(): void {
        const key = this.getToolbarPaletteKey();
        const palette = this.toolPalettes[key];
        const slotIdx = this.activeColorSlots[key] ?? 0;
        const color = palette.colors[slotIdx] ?? palette.colors[0];
        if (color) {
            this.options.activeColor = color;
        }
    }

    private updateFavoritesVisual(): void {
        const paletteKey = this.getToolbarPaletteKey();
        const activeSlot = this.activeColorSlots[paletteKey] ?? 0;
        const palette = this.toolPalettes[paletteKey];

        this.favButtons.forEach((btn, index) => {
            const color = palette.colors[index] || '#1E2330';
            const opacity = palette.opacities[index] ?? 100;
            const dot = btn.querySelector<HTMLElement>('.apolo-color-dot');
            if (dot) {
                dot.style.backgroundColor = color;
                dot.style.opacity = String(opacity / 100);
            }
            const isSelected = activeSlot === index;
            btn.classList.toggle('is-selected', isSelected);
            btn.classList.toggle('is-active', isSelected);
            btn.setAttribute('aria-pressed', String(isSelected));
        });
    }

    private updateThicknessVisual(): void {
        const isEraser = this.options.activeTool === 'eraser';
        const isDimmed = !this.options.penEnabled || this.options.activeTool === 'lasso';
        const w = this.options.activeWidth;

        if (this.thicknessTriggerBtn) {
            this.thicknessTriggerBtn.classList.toggle('is-dimmed', isDimmed);
            this.thicknessTriggerBtn.classList.toggle('is-eraser', isEraser);
            this.thicknessTriggerBtn.classList.toggle('is-active', !isDimmed);
        }

        if (this.thickLinePreview) {
            const h = Math.min(10, Math.max(2, Math.round(w)));
            this.thickLinePreview.style.height = `${h}px`;
            this.thickLinePreview.style.backgroundColor = isEraser ? 'transparent' : 'var(--apolo-text)';
            if (isEraser) {
                this.thickLinePreview.style.border = '2px solid currentColor';
            } else {
                this.thickLinePreview.style.border = 'none';
            }
        }
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
        const measuredScale = this.container.offsetWidth > 0 ? rect.width / this.container.offsetWidth : 1;
        const scale = Number.isFinite(measuredScale) && measuredScale > 0 ? measuredScale : 1;
        this.lockedSnap = null;

        this.dragState = {
            pointerId: e.pointerId,
            scale,
            initialSlot: this.options.slot,
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

        const { width: curWidth, height: curHeight } = this.getDimensions();
        const position = this.clampPosition(
            this.dragState.origLeft + dx,
            this.dragState.origTop + dy,
            curWidth,
            curHeight,
        );
        const newX = position.x;
        const newY = position.y;

        this.currentDragPos = { x: newX, y: newY };
        this.updatePosition();

        const candidateRect = {
            left: newX,
            top: newY,
            right: newX + curWidth,
            bottom: newY + curHeight,
        };

        if (this.lockedSnap) {
            if (this.shouldKeepLockedSnap(e.clientX, e.clientY)) {
                this.anchorToSnapSlot(this.lockedSnap.slot);
                this.highlightSnapDot(this.lockedSnap.slot);
                return;
            }

            this.lockedSnap = null;
            this.unlockTransitionUntil = Date.now() + 150;
            const unlockedPosition = this.currentDragPos ?? { x: newX, y: newY };
            this.dragState.origLeft = unlockedPosition.x;
            this.dragState.origTop = unlockedPosition.y;
            this.dragState.startX = e.clientX;
            this.dragState.startY = e.clientY;
            this.currentDragPos = unlockedPosition;
            this.updatePosition();
            this.highlightSnapDot(null);
            return;
        }

        const triggeredSlot = this.getLeadingEdgeSnapSlot(e.clientX, e.clientY, candidateRect);
        if (triggeredSlot) {
            this.lockedSnap = { slot: triggeredSlot, pointerX: e.clientX, pointerY: e.clientY };
            this.anchorToSnapSlot(triggeredSlot);
            this.dragState.startX = e.clientX;
            this.dragState.startY = e.clientY;
            this.dragState.origLeft = this.currentDragPos!.x;
            this.dragState.origTop = this.currentDragPos!.y;
            this.showSnapDots();
            this.highlightSnapDot(triggeredSlot);
            return;
        }

        this.highlightSnapDot(null);
    };

    private readonly onGripPointerUp = (e: PointerEvent): void => {
        if (!this.dragState || e.pointerId !== this.dragState.pointerId) return;

        const initialSlot = this.dragState.initialSlot;
        const targetSlot = this.lockedSnap?.slot ?? this.options.slot;

        this.dragState = null;
        this.lockedSnap = null;
        this.currentDragPos = null;
        this.container.classList.remove('is-dragging', 'is-snap-locked');
        this.hideSnapDots();

        window.removeEventListener('pointermove', this.onGripPointerMove);
        window.removeEventListener('pointerup', this.onGripPointerUp);
        window.removeEventListener('pointercancel', this.onGripPointerUp);

        this.setSlot(targetSlot);
        if (initialSlot !== targetSlot) this.options.onSlotChange(targetSlot);
    };

    private showSnapDots(): void {
        this.dotsContainer.replaceChildren();
        this.dotsContainer.hidden = false;

        const bounds = this.getEditingBounds();
        const horizontalWidth = Math.min(220, Math.round(bounds.width * 0.32));
        const verticalHeight = Math.min(220, Math.round(bounds.height * 0.32));
        for (const slot of SNAP_SLOTS) {
            const dot = document.createElement('div');
            const isHorizontal = slot === 'tc' || slot === 'bc';
            dot.className = `apolo-snap-dot apolo-snap-zone ${isHorizontal ? 'is-horizontal' : 'is-vertical'}`;
            dot.dataset.slot = slot;
            dot.style.setProperty('--apolo-snap-zone-width', `${isHorizontal ? horizontalWidth : 6}px`);
            dot.style.setProperty('--apolo-snap-zone-height', `${isHorizontal ? 6 : verticalHeight}px`);

            if (slot === 'tc' || slot === 'bc') {
                dot.style.left = `${bounds.left + bounds.width / 2}px`;
                dot.style.top = `${slot === 'tc' ? bounds.top + 14 : bounds.bottom - 18}px`;
            } else {
                dot.style.left = `${slot === 'ml' ? bounds.left + 14 : bounds.right - 18}px`;
                dot.style.top = `${bounds.top + bounds.height / 2}px`;
            }
            this.dotsContainer.appendChild(dot);
        }
    }

    private highlightSnapDot(activeSlot: ToolbarSlot | null): void {
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
        slot = this.normalizeSlot(slot);
        const wasVert = this.isVertical();
        this.options.slot = slot;
        const nowVert = this.isVertical();
        if (wasVert !== nowVert) this.triggerOrientationAnimation();
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
        this.syncToolbarPaletteFromTool();
        this.updateToolButtonsVisual();
        this.updateFavoritesVisual();
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
        const paletteKey = this.getToolbarPaletteKey();
        const matchingIndex = this.toolPalettes[paletteKey].colors.findIndex(
            (c) => c.toLowerCase() === color.toLowerCase()
        );
        if (matchingIndex !== -1) {
            this.activeColorSlots[paletteKey] = matchingIndex;
        }
        this.updateFavoritesVisual();
        this.updateThicknessVisual();
    }

    setFavorites(favorites: PenFavorite[], activeIndex: number): void {
        this.options.favorites = [...favorites];
        this.options.activeFavoriteIndex = activeIndex;
        if (favorites.length > 0 && !this.options.toolPalettes?.pen) {
            this.toolPalettes.pen.colors = favorites.slice(0, 4).map(f => f.color);
        }
        this.activeColorSlots.pen = Math.max(0, Math.min(3, activeIndex));
        this.updateFavoritesVisual();
    }

    setToolPalettes(palettes: Record<'pen' | 'highlighter' | 'shape', { colors: string[]; opacities: number[] }>): void {
        if (palettes.pen) {
            this.toolPalettes.pen = {
                colors: [...palettes.pen.colors],
                opacities: [...palettes.pen.opacities],
            };
        }
        if (palettes.highlighter) {
            this.toolPalettes.highlighter = {
                colors: [...palettes.highlighter.colors],
                opacities: [...palettes.highlighter.opacities],
            };
        }
        if (palettes.shape) {
            this.toolPalettes.shape = {
                colors: [...palettes.shape.colors],
                opacities: [...palettes.shape.opacities],
            };
        }
        this.updateFavoritesVisual();
    }

    getToolPalettes(): Record<'pen' | 'highlighter' | 'shape', { colors: string[]; opacities: number[] }> {
        return {
            pen: { colors: [...this.toolPalettes.pen.colors], opacities: [...this.toolPalettes.pen.opacities] },
            highlighter: { colors: [...this.toolPalettes.highlighter.colors], opacities: [...this.toolPalettes.highlighter.opacities] },
            shape: { colors: [...this.toolPalettes.shape.colors], opacities: [...this.toolPalettes.shape.opacities] },
        };
    }

    setThicknessValues(width: number, eraserRadius: number): void {
        this.options.activeWidth = width;
        this.options.eraserRadius = eraserRadius;
        this.updateThicknessVisual();
    }

    setWidth(width: number): void {
        this.options.activeWidth = width;
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

    closeAllPopovers(): void {
        if (this.thicknessPopover?.isOpen()) {
            this.thicknessPopover.close();
            this.thicknessTriggerBtn?.classList.remove('is-open');
        }
        if (this.colorPickerPopover?.isOpen()) {
            this.colorPickerPopover.close();
        }
    }

    setVisible(visible: boolean): void {
        this.container.hidden = !visible;
    }

    destroy(): void {
        this.closeAllPopovers();
        this.resizeObserver?.disconnect();
        if (typeof window !== 'undefined') {
            window.removeEventListener('resize', this.onWindowResize);
            window.removeEventListener('pointerdown', this.onWindowPointerDown, { capture: true });
            window.removeEventListener('pointermove', this.onGripPointerMove);
            window.removeEventListener('pointerup', this.onGripPointerUp);
            window.removeEventListener('pointercancel', this.onGripPointerUp);
        }
        this.thicknessPopover.destroy();
        this.colorPickerPopover.destroy();
        this.dotsContainer.remove();
        this.container.remove();
    }
}
