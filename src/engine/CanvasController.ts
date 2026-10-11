import { App, Editor, Notice, TFile } from 'obsidian';
import {
    BoundingBox,
    CanvasElement,
    EraserMode,
    LassoMode,
    PageDocument,
    PenFavorite,
    PenProfileId,
    Point,
    ShapeElement,
    ShapeType,
    StrokeElement,
    StrokePattern,
    StrokeStyle,
    ThicknessPreset,
    ToolbarSlot,
    ToolType,
} from '../core/types';
import { InputManager } from './input/InputManager';
import { PointBuffer } from './input/PointBuffer';
import { SpatialGrid } from './spatial/SpatialGrid';
import { PersistenceQueue } from '../io/PersistenceQueue';
import { ShapeRecognizer } from '../tools/ShapeRecognizer';
import { Predictor } from './input/Predictor';
import { EngineEventBus } from '../core/events';
import { Toolbar } from '../ui/Toolbar';
import { ToolEstuche } from '../ui/ToolEstuche';
import { LassoMenu } from '../ui/LassoMenu';
import { MoreMenu } from '../ui/MoreMenu';
import { ZoomPill } from '../ui/ZoomPill';
import { Toast } from '../ui/Toast';
import { LinkSuggestModal, openLocalGraph } from '../ui/LinkSuggestModal';
import { DEFAULT_FAVORITES, PEN_PROFILES } from '../ui/theme';

export interface CanvasControllerOptions {
    palmRejectionCooldownMs: number;
    autoSaveDebounceMs: number;
    defaultPenColor: string;
    defaultPenWidth: number;
    enabled: boolean;
    enableMouseDrawing: boolean;
    shapeRecognition: boolean;
    eventBus?: EngineEventBus;
    app: App;
    viewContainer?: HTMLElement;
    readonly?: boolean;
    toolbarSlot?: ToolbarSlot;
    favorites?: PenFavorite[];
    getScroll?: () => number;
    onPenEnabledChange?: (enabled: boolean) => void;
    onToolbarSlotChange?: (slot: ToolbarSlot) => void;
    onFavoritesChange?: (favorites: PenFavorite[]) => void;
}

interface Anchor {
    blockId: string;
    text: string;
    y: number;
}

interface TouchPoint {
    x: number;
    y: number;
}

interface SpaceMutation {
    id: string;
    height: number;
    isNew: boolean;
    remove: boolean;
    targetLine: number;
}

/**
 * High-performance engineering canvas controller.
 * Manages the double-buffered rendering motor, 120Hz input loop, spatial indexing,
 * block-level anchor synchronization, and interfaces with the decoupled UI shell.
 */
export class CanvasController {
    readonly pageId: string;
    private readonly layer = document.createElement('div');
    private readonly canvas = document.createElement('canvas');
    private readonly dryCanvas = document.createElement('canvas');
    private readonly context: CanvasRenderingContext2D;
    private readonly dryContext: CanvasRenderingContext2D;

    // UI Components
    private toolbar: Toolbar | null = null;
    private estuche: ToolEstuche | null = null;
    private lassoMenu: LassoMenu | null = null;
    private moreMenu: MoreMenu | null = null;
    private zoomPill: ZoomPill | null = null;
    private toast: Toast | null = null;

    // Engine Core Subsystems
    private readonly input: InputManager | null = null;
    private readonly points = new PointBuffer(32768);
    private readonly index = new SpatialGrid();
    private readonly visible: CanvasElement[] = [];
    private readonly recognizer = new ShapeRecognizer();
    private readonly predictor = new Predictor(12, 0.72, 5);
    private readonly history: string[] = [];
    private readonly future: string[] = [];
    private readonly touches = new Map<number, TouchPoint>();
    private singleTouchStartCoords: { x: number; y: number; time: number } | null = null;
    private lastSingleTouch: { x: number; y: number } | null = null;
    private singleTouchPanned = false;

    // Scroller properties
    private readonly originalScrollerPosition: string;
    private readonly originalScrollerOverflow: string;
    private readonly originalScrollerUserSelect: string;
    private resizeObserver: ResizeObserver | null = null;
    private sizerObserver: ResizeObserver | null = null;
    private scrollHandler: ((event?: Event) => void) | null = null;
    private lastScrollTop = -1;
    private lastScrollLeft = -1;
    private reanchorTimer: number | null = null;
    private frame = 0;
    private readonly onAnimationFrame = (): void => {
        this.frame = 0;
        this.paint();
    };
    private renderDirty = true;

    // Document & Tool State
    private document: PageDocument;
    private tool: ToolType = 'pen';
    private style: StrokeStyle;
    private shapeType: ShapeType = 'rect';
    private penProfileId: PenProfileId = 'fountain';
    private penEnabled: boolean;
    private shapeRecognition: boolean;
    private barrelActive = false;
    private eraserMode: EraserMode = 'reticle';
    private eraserRadius = 18;
    private scribbleToErase = true;
    private lassoMode: LassoMode = 'free';
    private snapGrid = false;
    private smoothing = 0.6;
    private pressureSensitivity = 0.75;
    private previousPenColor = '#1F4FD8';
    private favorites: PenFavorite[];
    private activeFavoriteIndex = 0;
    private toolbarSlot: ToolbarSlot = 'tc';

    // Selection & Manipulation
    private selection: CanvasElement[] = [];
    private activeStart: Point | null = null;
    private activeAnchor: Anchor | null = null;
    private activeContentLeft = 0;
    private activeContentWidth = 1;
    private activeBlockTop = 0;
    private readonly blockPositionCache = new Map<string, number>();
    private movingSelection = false;
    private clipboard: CanvasElement[] = [];
    private readonly predictedPoint: Point = { x: 0, y: 0, pressure: 0, time: 0 };
    private hasPrediction = false;

    // Zoom & Viewport State (Single Source of Truth: {zoom, scrollLeft, scrollTop})
    private zoom = 1.0;
    private lastAppliedZoom = -1;
    private gestureDistance = 0;
    private gestureZoom = 1;
    private gestureWorldX = 0;
    private gestureWorldY = 0;

    private lastSavedAt = Date.now();
    private spacerDebounceTimer: number | null = null;
    private previewReanchorTimer: number | null = null;
    private pendingSpaceMutations: SpaceMutation[] = [];
    private destroyed = false;

    constructor(
        private readonly scroller: HTMLElement,
        private readonly editor: Editor | undefined,
        documentModel: PageDocument,
        private readonly file: TFile,
        pageId: string,
        private readonly persistence: PersistenceQueue,
        private readonly options: CanvasControllerOptions,
    ) {
        this.document = documentModel;
        this.pageId = pageId;
        this.penEnabled = options.enabled;
        this.shapeRecognition = options.shapeRecognition;
        this.toolbarSlot = options.toolbarSlot ?? 'tc';
        this.favorites = options.favorites && options.favorites.length === 4
            ? [...options.favorites]
            : [...DEFAULT_FAVORITES];

        this.style = {
            color: options.defaultPenColor,
            width: options.defaultPenWidth,
            opacity: 1,
            pattern: 'solid',
            lineCap: 'round',
        };
        this.previousPenColor = options.defaultPenColor;

        const context = this.canvas.getContext('2d', { alpha: true, desynchronized: true });
        if (!context) throw new Error('Canvas 2D is unavailable in this Obsidian WebView.');
        this.context = context;

        const dryContext = this.dryCanvas.getContext('2d', { alpha: true, desynchronized: true });
        if (!dryContext) throw new Error('Canvas 2D is unavailable in this Obsidian WebView.');
        this.dryContext = dryContext;

        this.originalScrollerPosition = scroller.style.position;
        this.originalScrollerOverflow = scroller.style.overflow;
        this.originalScrollerUserSelect = scroller.style.userSelect;
        if (getComputedStyle(scroller).position === 'static') scroller.style.position = 'relative';

        this.layer.className = 'apolo-canvas-layer';
        this.updateLayerPointerEvents();

        this.canvas.className = 'apolo-canvas-surface apolo-canvas-wet';
        this.dryCanvas.className = 'apolo-canvas-surface apolo-canvas-dry';
        this.layer.append(this.dryCanvas, this.canvas);
        scroller.appendChild(this.layer);

        // Mount decoupled UI components if not readonly
        if (!this.options.readonly) {
            this.toast = new Toast(document.body);
            this.initToolbar();
            this.initEstuche();
            this.initLassoMenu();
            this.initMoreMenu();
            this.initZoomPill();

            this.input = new InputManager(this.canvas, {
                palmRejectionCooldownMs: options.palmRejectionCooldownMs,
                enableMouseDrawing: options.enableMouseDrawing,
                onStrokeStart: (point, barrel) => this.begin(point, barrel),
                onStrokeMove: (points, barrel) => this.move(points, barrel),
                onStrokeEnd: (point, barrel, rawEvent) => this.end(point, barrel, rawEvent.timeStamp),
                onStrokeCancel: () => this.cancel(),
                onNonDrawingPointerDown: (event) => this.focusEditorAt(event.clientX, event.clientY),
            });

            this.canvas.addEventListener('pointerdown', this.onTouchDown, { passive: false });
            this.canvas.addEventListener('pointermove', this.onTouchMove, { passive: false });
            this.canvas.addEventListener('pointerup', this.onTouchEnd, { passive: false });
            this.canvas.addEventListener('pointercancel', this.onTouchEnd, { passive: false });
            this.canvas.addEventListener('dblclick', this.onCanvasDblClick);
            document.addEventListener('pointerdown', this.onDocumentPointerDown);
        }

        this.scrollHandler = (event?: Event) => {
            if (event && event.target && event.target !== this.scroller && event.target !== window && event.target !== document) {
                return;
            }
            const currentTop = this.currentScrollTop;
            const currentLeft = this.currentScrollLeft;
            if (currentTop === this.lastScrollTop && currentLeft === this.lastScrollLeft) return;

            this.lastScrollTop = currentTop;
            this.lastScrollLeft = currentLeft;
            this.positionLayer();
            this.renderDirty = true;
            this.schedulePaint();
            this.lassoMenu?.updateViewport(this.zoom, this.currentScrollLeft, this.currentScrollTop);
            if (!this.options.readonly) this.scheduleReanchor();
        };

        scroller.addEventListener('scroll', this.scrollHandler, { passive: true });
        window.addEventListener('scroll', this.scrollHandler, { capture: true, passive: true });
        window.addEventListener('wheel', this.scrollHandler, { capture: true, passive: true });

        this.resizeObserver = new ResizeObserver(() => {
            this.positionLayer();
            this.resize();
            if (this.options.readonly) {
                this.reanchorPreview();
            } else {
                this.scheduleReanchor();
            }
            this.renderDirty = true;
            this.schedulePaint();
            this.toolbar?.setSlot(this.toolbarSlot);
            this.estuche?.position();
            this.moreMenu?.position();
            this.lassoMenu?.updateViewport(this.zoom, this.currentScrollLeft, this.currentScrollTop);
        });
        this.resizeObserver.observe(scroller);

        this.sizerObserver = new ResizeObserver(() => {
            if (this.zoom > 1.0) {
                this.applyContentZoom();
            }
            this.renderDirty = true;
            this.schedulePaint();
        });
        this.observeSizer();

        this.rebuildIndex();
        this.positionLayer();
        this.resize();
        this.paint();

        if (this.options.readonly) {
            window.setTimeout(() => this.reanchorPreview(), 60);
            window.setTimeout(() => this.reanchorPreview(), 200);
            window.setTimeout(() => this.reanchorPreview(), 500);
        } else {
            this.queueSave(file);
        }
    }

    private updateLayerPointerEvents(): void {
        const canDraw = !this.options.readonly && this.penEnabled;
        this.layer.classList.toggle('is-readonly', !!this.options.readonly);
        this.layer.classList.toggle('is-pen-disabled', !canDraw);
        this.layer.style.pointerEvents = canDraw ? 'auto' : 'none';
        this.canvas.style.pointerEvents = canDraw ? 'auto' : 'none';
    }

    private initToolbar(): void {
        this.toolbar = new Toolbar({
            slot: this.toolbarSlot,
            penEnabled: this.penEnabled,
            activeTool: this.tool,
            activeShape: this.shapeType,
            activeColor: this.style.color,
            activeWidth: this.style.width,
            activeProfileId: this.penProfileId,
            activeFavoriteIndex: this.activeFavoriteIndex,
            favorites: this.favorites,
            snapGrid: this.snapGrid,
            canUndo: this.history.length > 0,
            canRedo: this.future.length > 0,
            eraserRadius: this.eraserRadius,
            onSlotChange: (slot) => {
                this.toolbarSlot = slot;
                this.estuche?.updateState({ slot });
                this.moreMenu?.updateState({ slot });
                this.options.onToolbarSlotChange?.(slot);
            },
            onToggleKeyboardMode: () => {
                this.setPenEnabled(!this.penEnabled);
            },
            onSelectTool: (tool) => {
                this.estuche?.close();
                this.setTool(tool);
            },
            onToggleEstuche: (tool) => {
                if (this.estuche?.isOpen()) {
                    this.estuche.close();
                } else {
                    this.estuche?.open({
                        tool,
                        slot: this.toolbarSlot,
                        color: this.style.color,
                        width: this.style.width,
                        profileId: this.penProfileId,
                        smoothing: this.smoothing,
                        pressureSensitivity: this.pressureSensitivity,
                        favorites: this.favorites,
                        eraserMode: this.eraserMode,
                        eraserRadius: this.eraserRadius,
                        scribbleToErase: this.scribbleToErase,
                        lassoMode: this.lassoMode,
                        shapeType: this.shapeType,
                        snapGrid: this.snapGrid,
                    });
                }
            },
            onUndo: () => this.performUndo(),
            onRedo: () => this.performRedo(),
            onSelectFavorite: (index) => this.applyFavorite(index),
            onSelectThickness: (preset) => this.applyThicknessPreset(preset),
            onToggleSnapGrid: () => {
                this.snapGrid = !this.snapGrid;
                this.toolbar?.setSnapGrid(this.snapGrid);
                this.estuche?.updateState({ snapGrid: this.snapGrid });
                this.moreMenu?.updateState({ snapGrid: this.snapGrid });
                this.renderDirty = true;
                this.schedulePaint();
            },
            onToggleMoreMenu: () => {
                this.estuche?.close();
                this.moreMenu?.toggle({
                    slot: this.toolbarSlot,
                    onlyPen: !this.options.enableMouseDrawing,
                    snapGrid: this.snapGrid,
                });
            },
        });
    }

    private initEstuche(): void {
        this.estuche = new ToolEstuche(
            {
                tool: this.tool,
                slot: this.toolbarSlot,
                color: this.style.color,
                width: this.style.width,
                profileId: this.penProfileId,
                smoothing: this.smoothing,
                pressureSensitivity: this.pressureSensitivity,
                favorites: this.favorites,
                eraserMode: this.eraserMode,
                eraserRadius: this.eraserRadius,
                scribbleToErase: this.scribbleToErase,
                lassoMode: this.lassoMode,
                shapeType: this.shapeType,
                snapGrid: this.snapGrid,
            },
            {
                onSelectProfile: (profileId) => this.applyPenProfile(profileId),
                onChangeColor: (color) => this.setInkColor(color),
                onChangeWidth: (width) => this.setWidth(width),
                onChangeSmoothing: (smoothing) => { this.smoothing = smoothing; },
                onChangePressure: (pressure) => {
                    this.pressureSensitivity = pressure;
                    this.renderDirty = true;
                    this.schedulePaint();
                },
                onUseFavorite: (index) => this.applyFavorite(index),
                onSaveFavorite: (index) => this.saveFavoriteAt(index),
                onSelectEraserMode: (mode) => {
                    this.eraserMode = mode;
                },
                onChangeEraserRadius: (radius) => {
                    this.eraserRadius = radius;
                    this.toolbar?.setThicknessValues(this.style.width, this.eraserRadius);
                },
                onToggleScribble: (enabled) => { this.scribbleToErase = enabled; },
                onSelectLassoMode: (mode) => { this.lassoMode = mode; },
                onSelectShapeType: (shapeType) => {
                    this.shapeType = shapeType;
                    this.toolbar?.setShape(shapeType);
                    this.toolbar?.setTool('shape', shapeType);
                },
                onToggleSnapGrid: (enabled) => {
                    this.snapGrid = enabled;
                    this.toolbar?.setSnapGrid(enabled);
                    this.renderDirty = true;
                    this.schedulePaint();
                },
                onClose: () => undefined,
            },
        );
    }

    private initLassoMenu(): void {
        this.lassoMenu = new LassoMenu({
            onCopy: () => {
                this.clipboard = JSON.parse(JSON.stringify(this.selection)) as CanvasElement[];
                this.toast?.show(`${this.selection.length} elemento(s) copiado(s)`);
            },
            onPaste: () => this.duplicateSelection(),
            onLink: () => {
                new LinkSuggestModal(this.options.app, (target) => {
                    this.linkSelection(target);
                }).open();
            },
            onBringToFront: () => this.changeSelectionOrder(true),
            onSendToBack: () => this.changeSelectionOrder(false),
            onDelete: () => this.deleteSelection(),
            onApplyColor: (color) => this.applyStyleToSelection({ color }),
            onApplyWidth: (width) => this.applyStyleToSelection({ width }),
            onApplyPattern: (pattern) => this.applyStyleToSelection({ pattern }),
            onOpenLinkedNote: (target) => {
                this.options.app.workspace.openLinkText(target, this.file.path);
            },
            onUnlink: () => this.unlinkSelection(),
            onDeselect: () => {
                this.selection = [];
                this.lassoMenu?.hide();
                this.schedulePaint();
            },
        });
    }

    private initMoreMenu(): void {
        this.moreMenu = new MoreMenu({
            slot: this.toolbarSlot,
            onlyPen: !this.options.enableMouseDrawing,
            snapGrid: this.snapGrid,
            onExportSvg: () => {
                void this.persistence.flush().then(() => {
                    this.toast?.show('SVG companion sincronizado en assets/ink');
                });
            },
            onOpenGraph: () => openLocalGraph(this.options.app),
            onTestAnchor: () => this.testAnchorDisplacement(),
            onToggleOnlyPen: (onlyPen) => {
                this.options.enableMouseDrawing = !onlyPen;
                this.toast?.show(onlyPen ? 'Rechazo de palma estricto activado' : 'Dibujo con ratón activado');
            },
            onToggleSnapGrid: (enabled) => {
                this.snapGrid = enabled;
                this.toolbar?.setSnapGrid(enabled);
                this.estuche?.updateState({ snapGrid: enabled });
                this.renderDirty = true;
                this.schedulePaint();
            },
            onClose: () => undefined,
        });
    }

    private initZoomPill(): void {
        this.zoomPill = new ZoomPill({
            onZoomIn: () => this.stepZoom(1),
            onZoomOut: () => this.stepZoom(-1),
            onZoomFit: () => this.resetView(),
        });
    }

    private getSizerElement(): HTMLElement | null {
        return this.scroller.querySelector<HTMLElement>('.cm-sizer')
            ?? this.scroller.querySelector<HTMLElement>('.markdown-preview-sizer');
    }

    private observeSizer(): void {
        const sizer = this.getSizerElement();
        if (sizer && this.sizerObserver) {
            this.sizerObserver.disconnect();
            this.sizerObserver.observe(sizer);
        }
    }

    private applyContentZoom(): void {
        const sizer = this.getSizerElement();
        if (!sizer) return;

        if (this.zoom <= 1.0) {
            if (this.lastAppliedZoom !== 1.0) {
                sizer.style.transform = '';
                sizer.style.transformOrigin = '';
                sizer.style.marginBottom = '';
                sizer.style.marginRight = '';
                this.lastAppliedZoom = 1.0;
            }
        } else {
            const transformStr = `scale(${this.zoom})`;
            if (sizer.style.transform !== transformStr) {
                sizer.style.transform = transformStr;
                sizer.style.transformOrigin = '0 0';
            }
            const baseHeight = sizer.offsetHeight;
            const baseWidth = sizer.offsetWidth;
            const mb = `${Math.round(baseHeight * (this.zoom - 1))}px`;
            const mr = `${Math.round(baseWidth * (this.zoom - 1))}px`;
            if (sizer.style.marginBottom !== mb) sizer.style.marginBottom = mb;
            if (sizer.style.marginRight !== mr) sizer.style.marginRight = mr;

            // Pan horizontal y vertical limitado estrictamente a los bordes
            const maxScrollX = Math.max(0, Math.round(baseWidth * this.zoom - this.scroller.clientWidth));
            const maxScrollY = Math.max(0, Math.round(baseHeight * this.zoom - this.scroller.clientHeight));
            if (this.scroller.scrollLeft > maxScrollX) this.scroller.scrollLeft = maxScrollX;
            if (this.scroller.scrollTop > maxScrollY) this.scroller.scrollTop = maxScrollY;

            this.lastAppliedZoom = this.zoom;
        }
    }

    private setZoomLevel(newZoom: number): void {
        const clampedZoom = Math.max(1.0, Math.min(3.0, newZoom));
        if (Math.abs(clampedZoom - this.zoom) < 0.001) return;
        this.zoom = clampedZoom;
        this.applyContentZoom();
        this.zoomPill?.setZoom(this.zoom);
        this.options.eventBus?.emit('zoom:changed', this.zoom);
        this.renderDirty = true;
        this.schedulePaint();
        this.lassoMenu?.updateViewport(this.zoom, this.currentScrollLeft, this.currentScrollTop);
    }

    private stepZoom(dir: number): void {
        const levels = [1.0, 1.25, 1.5, 2.0, 3.0];
        const currentIdx = levels.findIndex(lvl => Math.abs(lvl - this.zoom) < 0.1);
        let nextIdx = (currentIdx === -1 ? 0 : currentIdx) + dir;
        nextIdx = Math.max(0, Math.min(levels.length - 1, nextIdx));
        const newZoom = levels[nextIdx];
        if (Math.abs(newZoom - this.zoom) < 0.01) return;

        const oldZoom = this.zoom;
        const centerX = this.scroller.clientWidth / 2;
        const centerY = this.scroller.clientHeight / 2;
        const worldX = (centerX + this.currentScrollLeft) / oldZoom;
        const worldY = (centerY + this.currentScrollTop) / oldZoom;

        this.setZoomLevel(newZoom);

        if (newZoom > 1.0) {
            const sizer = this.getSizerElement();
            const baseWidth = sizer?.offsetWidth ?? this.scroller.clientWidth;
            const baseHeight = sizer?.offsetHeight ?? this.scroller.clientHeight;
            const maxScrollX = Math.max(0, Math.round(baseWidth * newZoom - this.scroller.clientWidth));
            const maxScrollY = Math.max(0, Math.round(baseHeight * newZoom - this.scroller.clientHeight));

            this.scroller.scrollLeft = Math.max(0, Math.min(maxScrollX, Math.round(worldX * newZoom - centerX)));
            this.scroller.scrollTop = Math.max(0, Math.min(maxScrollY, Math.round(worldY * newZoom - centerY)));
        } else {
            this.scroller.scrollLeft = 0;
        }
    }

    private applyFavorite(index: number): void {
        const fav = this.favorites[index];
        if (!fav) return;
        this.activeFavoriteIndex = index;
        this.setTool(fav.profile === 'hlr' || fav.profile === 'hlf' ? 'highlighter' : 'pen');
        this.applyPenProfile(fav.profile);
        this.setInkColor(fav.color);
        this.setWidth(fav.width);
        this.toolbar?.setFavorites(this.favorites, this.activeFavoriteIndex);
        this.toast?.show(`Favorito ${index + 1} seleccionado`);
    }

    private saveFavoriteAt(index: number): void {
        this.favorites[index] = {
            profile: this.penProfileId,
            color: this.style.color,
            width: this.style.width,
        };
        this.activeFavoriteIndex = index;
        this.toolbar?.setFavorites(this.favorites, this.activeFavoriteIndex);
        this.options.onFavoritesChange?.(this.favorites);
        this.toast?.show(`Favorito ${index + 1} guardado`);
    }

    private applyThicknessPreset(preset: ThicknessPreset): void {
        if (this.tool === 'eraser') {
            const radii = { fine: 8, medium: 18, thick: 36 };
            this.eraserRadius = radii[preset];
            this.toolbar?.setThicknessValues(this.style.width, this.eraserRadius);
            this.estuche?.updateState({ eraserRadius: this.eraserRadius });
            this.toast?.show(`Borrador: ${preset}`);
        } else {
            const widths = { fine: 2, medium: 3.5, thick: 6 };
            this.setWidth(widths[preset]);
            this.toast?.show(`Grosor: ${preset} (${widths[preset]} px)`);
        }
    }

    private applyPenProfile(profileId: PenProfileId): void {
        const profile = PEN_PROFILES[profileId] || PEN_PROFILES.fountain;
        this.penProfileId = profileId;
        this.style.opacity = profile.op;
        this.style.lineCap = profile.cap;
        this.style.pattern = profile.dash ? 'dashed' : 'solid';

        if (profileId === 'hlr' || profileId === 'hlf') {
            this.tool = 'highlighter';
        } else {
            this.tool = 'pen';
        }

        this.toolbar?.setTool(this.tool);
        this.toolbar?.setStyle(this.style.color, this.style.width, this.penProfileId);
        this.estuche?.updateState({
            tool: this.tool,
            profileId: this.penProfileId,
            width: this.style.width,
        });
        this.options.eventBus?.emit('tool:changed', this.tool);
        this.options.eventBus?.emit('style:changed', this.style, this.penProfileId);
        this.schedulePaint();
    }

    setInkColor(color: string): void {
        this.style.color = color;
        if (this.tool === 'pen') {
            this.previousPenColor = color;
        }
        this.toolbar?.setStyle(color, this.style.width, this.penProfileId);
        this.estuche?.updateState({ color });
        this.options.eventBus?.emit('style:changed', { color });
        this.schedulePaint();
    }

    setWidth(width: number): void {
        this.style.width = width;
        this.toolbar?.setStyle(this.style.color, width, this.penProfileId);
        this.estuche?.updateState({ width });
        this.options.eventBus?.emit('style:changed', { width });
        this.schedulePaint();
    }

    private readonly onCanvasDblClick = (event: MouseEvent): void => {
        this.focusEditorAt(event.clientX, event.clientY);
    };

    private focusEditorAt(clientX: number, clientY: number): void {
        if (!this.editor) return;
        try {
            const ed = this.editor as unknown as Record<string, unknown>;
            if (typeof ed.posAtCoords === 'function') {
                const pos = (ed.posAtCoords as (c: { x: number; y: number }) => unknown)({ x: clientX, y: clientY });
                if (pos) (this.editor.setCursor as (p: unknown) => void)(pos);
            } else if (ed.cm && typeof (ed.cm as Record<string, unknown>).posAtCoords === 'function') {
                const offset = ((ed.cm as Record<string, unknown>).posAtCoords as (c: { x: number; y: number }) => unknown)({ x: clientX, y: clientY });
                if (typeof offset === 'number' && typeof this.editor.offsetToPos === 'function') {
                    this.editor.setCursor(this.editor.offsetToPos(offset));
                }
            }
        } catch {
            // Coordinate resolution is best-effort
        }
        this.editor.focus();
    }

    getDocument(): PageDocument {
        return this.document;
    }

    requestPaint(): void {
        this.positionLayer();
        this.renderDirty = true;
        this.paint();
    }

    setPenEnabled(enabled: boolean): void {
        if (this.options.readonly) return;
        this.penEnabled = enabled;
        this.updateLayerPointerEvents();
        this.toolbar?.setPenEnabled(enabled);
        this.options.onPenEnabledChange?.(enabled);
        this.options.eventBus?.emit('pen:changed', enabled);

        if (!enabled && this.editor) {
            this.toast?.show('Modo teclado activo: toca el texto para editar');
            this.editor.focus();
        } else if (enabled) {
            this.toast?.show('Modo lápiz activo');
        }
    }

    setShapeRecognition(enabled: boolean): void {
        this.shapeRecognition = enabled;
    }

    selectTool(tool: ToolType): void {
        if (!this.options.readonly) this.setTool(tool);
    }

    setTool(tool: ToolType): void {
        const previousTool = this.tool;
        this.tool = tool;

        // Auto color switch when moving between pen and highlighter
        if (tool === 'highlighter' && previousTool !== 'highlighter') {
            this.previousPenColor = this.style.color;
            this.style.color = '#F5C400';
            this.style.opacity = 0.35;
        } else if (previousTool === 'highlighter' && tool === 'pen') {
            this.style.color = this.previousPenColor || '#1F4FD8';
            this.style.opacity = 1.0;
        } else if (tool === 'eraser') {
            this.selection = [];
            this.lassoMenu?.hide();
        }

        this.toolbar?.setTool(tool);
        this.estuche?.updateState({ tool, color: this.style.color });
        this.options.eventBus?.emit('tool:changed', tool);
        this.schedulePaint();
    }

    undo(): void { if (!this.options.readonly) this.performUndo(); }
    redo(): void { if (!this.options.readonly) this.performRedo(); }

    onEditorChange(): void { if (!this.options.readonly) this.scheduleReanchor(); }

    async flush(): Promise<void> { await this.persistence.flush(); }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        this.input?.destroy();
        if (this.scrollHandler) {
            this.scroller.removeEventListener('scroll', this.scrollHandler);
            window.removeEventListener('scroll', this.scrollHandler, { capture: true });
            window.removeEventListener('wheel', this.scrollHandler, { capture: true });
        }
        if (this.reanchorTimer !== null) window.clearTimeout(this.reanchorTimer);
        if (this.previewReanchorTimer !== null) {
            window.clearTimeout(this.previewReanchorTimer);
            this.previewReanchorTimer = null;
        }
        if (this.spacerDebounceTimer !== null) {
            window.clearTimeout(this.spacerDebounceTimer);
            this.spacerDebounceTimer = null;
            void this.flushSpaceMutations();
        }
        this.resizeObserver?.disconnect();
        this.sizerObserver?.disconnect();

        this.canvas.removeEventListener('pointerdown', this.onTouchDown);
        this.canvas.removeEventListener('pointermove', this.onTouchMove);
        this.canvas.removeEventListener('pointerup', this.onTouchEnd);
        this.canvas.removeEventListener('pointercancel', this.onTouchEnd);
        this.canvas.removeEventListener('dblclick', this.onCanvasDblClick);
        document.removeEventListener('pointerdown', this.onDocumentPointerDown);

        if (this.frame) cancelAnimationFrame(this.frame);

        this.toolbar?.destroy();
        this.estuche?.destroy();
        this.lassoMenu?.destroy();
        this.moreMenu?.destroy();
        this.zoomPill?.destroy();
        this.toast?.destroy();

        this.layer.remove();
        const sizer = this.getSizerElement();
        if (sizer) {
            sizer.style.transform = '';
            sizer.style.transformOrigin = '';
            sizer.style.marginBottom = '';
            sizer.style.marginRight = '';
        }
        this.scroller.style.position = this.originalScrollerPosition;
        this.scroller.style.overflow = this.originalScrollerOverflow;
        this.scroller.style.userSelect = this.originalScrollerUserSelect;
    }

    private readonly onDocumentPointerDown = (event: PointerEvent): void => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (
            this.toolbar?.container.contains(target) ||
            this.estuche?.container.contains(target) ||
            this.lassoMenu?.container.contains(target) ||
            this.moreMenu?.container.contains(target) ||
            this.zoomPill?.container.contains(target)
        ) {
            return;
        }
        this.estuche?.close();
        this.moreMenu?.close();
    };

    // Drawing input lifecycle (normalized to content column width & anchor block)
    private begin(rawPoint: Point, barrel: boolean): void {
        if (!this.penEnabled) return;
        this.points.clear();
        this.predictor.reset();

        const docX = (rawPoint.x + this.currentScrollLeft) / this.zoom;
        const docY = (rawPoint.y + this.currentScrollTop) / this.zoom;

        const { left: contentLeft, width: contentWidth } = this.getContentGeometry();
        this.activeContentLeft = contentLeft;
        this.activeContentWidth = contentWidth;

        this.activeAnchor = this.anchorAt(docY);
        this.activeBlockTop = this.activeAnchor.y;

        this.activeStart = { x: docX, y: docY, pressure: rawPoint.pressure, time: rawPoint.time };

        // Moving existing selection if tapped inside bounds
        this.movingSelection = this.tool === 'lasso' && this.selection.some(element => {
            const docBounds = this.getElementDocBounds(element);
            return contains(docBounds, docX, docY, 6);
        });
        this.barrelActive = barrel;

        this.pushWorldPoint(rawPoint);
        this.schedulePaint();
    }

    private move(rawPoints: Point[], barrel: boolean): void {
        if (!this.activeStart) return;
        this.barrelActive = barrel;
        for (let i = 0; i < rawPoints.length; i++) this.pushWorldPoint(rawPoints[i]);

        if (this.movingSelection && this.tool === 'lasso' && this.points.size > 1) {
            const last = this.points.get(this.points.size - 1);
            const prev = this.points.get(this.points.size - 2);
            const dx = last.x - prev.x;
            const dy = last.y - prev.y;
            this.translateSelection(dx, dy, false);
        }

        this.schedulePaint();
    }

    private end(rawPoint: Point, barrel: boolean, releasedAt: number): void {
        if (!this.activeStart) return;
        const lastMotionAt = this.points.size > 0 ? this.points.getTime(this.points.size - 1) : releasedAt;
        this.pushWorldPoint(rawPoint);
        const raw = this.readActivePoints();

        if (this.movingSelection && this.tool === 'lasso') {
            this.recordHistory();
            this.movingSelection = false;
            this.rebuildIndex();
            this.emitSelection();
            this.persistSoon();
            this.toast?.show('Selección reubicada');
        } else {
            this.recordHistory();
            if (this.tool === 'eraser' || barrel) {
                this.erase(raw);
            } else if (this.tool === 'lasso') {
                this.selectLasso(raw);
            } else if (this.tool === 'spacer') {
                this.insertSpace(raw);
            } else if (this.tool === 'shape') {
                this.addShape(this.activeStart, raw[raw.length - 1], this.shapeType);
            } else {
                const recognized = this.shapeRecognition ? this.recognizer.recognize(raw, releasedAt, lastMotionAt) : null;
                if (recognized) {
                    this.addShape(recognized.start, recognized.end, recognized.type);
                    this.toast?.show(`Forma reconocida: ${recognized.type}`);
                } else {
                    this.addStroke(raw);
                }
            }
        }

        this.points.clear();
        this.predictor.reset();
        this.hasPrediction = false;
        this.activeStart = null;
        this.activeAnchor = null;
        this.barrelActive = false;
        this.rebuildIndex();
        this.schedulePaint();
        this.persistSoon();
        this.options.eventBus?.emit('canvas:dirty', this.pageId);
    }

    private cancel(): void {
        this.points.clear();
        this.predictor.reset();
        this.hasPrediction = false;
        this.activeStart = null;
        this.activeAnchor = null;
        this.movingSelection = false;
        this.barrelActive = false;
        this.schedulePaint();
    }

    private pushWorldPoint(point: Point): void {
        const docX = (point.x + this.currentScrollLeft) / this.zoom;
        const docY = (point.y + this.currentScrollTop) / this.zoom;
        const previousPressure = this.points.size > 0 ? this.points.getPressure(this.points.size - 1) : 0.5;
        const pressure = point.pressure === undefined || (point.pressure === 0 && this.points.size > 0)
            ? previousPressure
            : point.pressure;
        const time = point.time ?? 0;
        this.points.push(docX, docY, pressure, time);
        this.predictor.updateValues(docX, docY, pressure, time);
        this.predictor.predictInto(this.predictedPoint);
        this.hasPrediction = true;
    }

    private readActivePoints(): Point[] {
        const points = new Array<Point>(this.points.size);
        for (let i = 0; i < points.length; i++) points[i] = this.points.get(i);
        return points;
    }

    private addStroke(points: Point[]): void {
        if (points.length === 0) return;
        if (this.scribbleToErase && this.isScribble(points)) {
            this.erase(points);
            this.rebuildIndex();
            this.schedulePaint();
            this.persistSoon();
            this.toast?.show('Garabato detectado: trazos eliminados');
            return;
        }

        const anchor = this.anchorAt(points[0].y);
        const { left: contentLeft, width: contentWidth } = this.getContentGeometry();
        const blockTop = anchor.y;

        const flat = new Array<number>(points.length * 4);
        let minU = Number.POSITIVE_INFINITY;
        let maxU = Number.NEGATIVE_INFINITY;
        let minV = Number.POSITIVE_INFINITY;
        let maxV = Number.NEGATIVE_INFINITY;

        for (let i = 0; i < points.length; i++) {
            const offset = i * 4;
            const pt = points[i];
            const u = (pt.x - contentLeft) / contentWidth;
            const v = (pt.y - blockTop) / contentWidth;
            flat[offset] = u;
            flat[offset + 1] = v;
            flat[offset + 2] = pt.pressure ?? 0.5;
            flat[offset + 3] = pt.time ?? 0;
            if (u < minU) minU = u;
            if (u > maxU) maxU = u;
            if (v < minV) minV = v;
            if (v > maxV) maxV = v;
        }

        const element: StrokeElement = {
            id: uuid(),
            type: 'stroke',
            timestamp: Date.now(),
            zIndex: this.document.elements.length,
            blockId: anchor.blockId,
            anchorText: anchor.text,
            points: flat,
            style: { ...this.style },
            bounds: { minX: minU, maxX: maxU, minY: minV, maxY: maxV },
        };
        this.document.elements.push(element);
    }

    private isScribble(points: Point[]): boolean {
        if (points.length < 10) return false;
        const threshold = 18;
        let reversals = 0;
        let prevSign = 0;
        for (let i = 2; i < points.length; i++) {
            const dx = points[i].x - points[i - 1].x;
            if (Math.abs(dx) > threshold) {
                const sign = dx > 0 ? 1 : -1;
                if (prevSign !== 0 && sign !== prevSign) reversals++;
                prevSign = sign;
            }
        }
        if (reversals >= 4) {
            const b = boundsOf(points, 0);
            return (b.maxX - b.minX) < 250 && (b.maxY - b.minY) < 180;
        }
        return false;
    }

    private addShape(start: Point, end: Point, shapeType: ShapeElement['shapeType']): void {
        const anchor = this.anchorAt(start.y);
        const { left: contentLeft, width: contentWidth } = this.getContentGeometry();
        const blockTop = anchor.y;

        const startU = (start.x - contentLeft) / contentWidth;
        const startV = (start.y - blockTop) / contentWidth;
        const endU = (end.x - contentLeft) / contentWidth;
        const endV = (end.y - blockTop) / contentWidth;

        const minU = Math.min(startU, endU);
        const maxU = Math.max(startU, endU);
        const minV = Math.min(startV, endV);
        const maxV = Math.max(startV, endV);

        const element: ShapeElement = {
            id: uuid(),
            type: 'shape',
            shapeType,
            timestamp: Date.now(),
            zIndex: this.document.elements.length,
            blockId: anchor.blockId,
            anchorText: anchor.text,
            startX: startU,
            startY: startV,
            endX: endU,
            endY: endV,
            style: { ...this.style },
            bounds: { minX: minU, maxX: maxU, minY: minV, maxY: maxV },
        };
        this.document.elements.push(element);
        this.options.eventBus?.emit('snap:detected', shapeType, end.x, end.y);
    }

    private getContentGeometry(): { left: number; width: number } {
        const scrollerRect = this.scroller.getBoundingClientRect();
        const candidateSelectors = [
            '.cm-content',
            '.markdown-preview-section',
            '.markdown-rendered',
            '.markdown-preview-sizer',
            '.cm-sizer',
        ];
        let contentEl: HTMLElement | null = null;
        for (const sel of candidateSelectors) {
            const el = this.scroller.querySelector<HTMLElement>(sel);
            if (el && el.offsetWidth > 0) {
                contentEl = el;
                break;
            }
        }
        if (!contentEl) {
            return { left: 0, width: Math.max(1, this.scroller.clientWidth / this.zoom) };
        }
        const rect = contentEl.getBoundingClientRect();
        const left = (rect.left - scrollerRect.left + this.currentScrollLeft) / this.zoom;
        const width = Math.max(1, rect.width / this.zoom);
        return { left, width };
    }

    private getBlockTop(blockId: string, anchorText?: string): number {
        const scrollerRect = this.scroller.getBoundingClientRect();

        // 1. Space block anchor: direct element match in both Live Preview & Reading mode
        if (blockId.startsWith('space:')) {
            const spaceId = blockId.slice(6);
            const spaceEl = this.scroller.querySelector<HTMLElement>(
                `[data-apolo-space-id="${spaceId}"], [data-apolo-space="${spaceId}"]`
            );
            if (spaceEl) {
                const top = (spaceEl.getBoundingClientRect().top - scrollerRect.top + this.currentScrollTop) / this.zoom;
                this.blockPositionCache.set(blockId, top);
                return top;
            }
            const cached = this.blockPositionCache.get(blockId);
            if (cached !== undefined) return cached;
            return 0;
        }

        // 2. Reading mode (preview) anchor resolution
        if (this.options.readonly) {
            const lineMatch = blockId.match(/^line:(\d+)$/);
            if (lineMatch) {
                const targetLine = parseInt(lineMatch[1], 10);
                const rendered = Array.from(this.scroller.querySelectorAll<HTMLElement>('[data-apolo-line-start]'));

                if (rendered.length > 0) {
                    // Match by anchorText if available
                    if (anchorText) {
                        for (const el of rendered) {
                            if (el.textContent && el.textContent.includes(anchorText)) {
                                const rect = el.getBoundingClientRect();
                                const top = (rect.top - scrollerRect.top + this.currentScrollTop) / this.zoom;
                                this.blockPositionCache.set(blockId, top);
                                return top;
                            }
                        }
                    }

                    // Exact match within rendered block with fractional line interpolation
                    for (const el of rendered) {
                        const start = parseInt(el.dataset.apoloLineStart || '0', 10);
                        const end = parseInt(el.dataset.apoloLineEnd || '0', 10);
                        if (targetLine >= start && targetLine <= end) {
                            const rect = el.getBoundingClientRect();
                            const lineOffset = targetLine - start;
                            const totalLinesInBlock = Math.max(1, end - start + 1);
                            const lineFraction = lineOffset / totalLinesInBlock;
                            const top = (rect.top - scrollerRect.top + this.currentScrollTop) / this.zoom + (rect.height / this.zoom) * lineFraction;
                            this.blockPositionCache.set(blockId, top);
                            return top;
                        }
                    }

                    // Fallback: nearest rendered block if target section is lazy-unmounted
                    let closestEl = rendered[0];
                    let minDistance = Number.POSITIVE_INFINITY;
                    let closestLine = 0;

                    for (const el of rendered) {
                        const start = parseInt(el.dataset.apoloLineStart || '0', 10);
                        const end = parseInt(el.dataset.apoloLineEnd || '0', 10);
                        const dist = targetLine < start ? start - targetLine : targetLine > end ? targetLine - end : 0;
                        if (dist < minDistance) {
                            minDistance = dist;
                            closestEl = el;
                            closestLine = targetLine < start ? start : end;
                        }
                    }

                    if (closestEl) {
                        const rect = closestEl.getBoundingClientRect();
                        const closestTop = (rect.top - scrollerRect.top + this.currentScrollTop) / this.zoom;
                        const blockLineCount = Math.max(1, (parseInt(closestEl.dataset.apoloLineEnd || '0') - parseInt(closestEl.dataset.apoloLineStart || '0') + 1));
                        const avgLineHeight = Math.max(16, (rect.height / this.zoom) / blockLineCount);
                        const deltaLines = targetLine - closestLine;
                        const estimatedTop = closestTop + deltaLines * avgLineHeight;
                        this.blockPositionCache.set(blockId, estimatedTop);
                        return estimatedTop;
                    }
                }
            }
        } else if (this.editor) {
            const lineMatch = blockId.match(/^line:(\d+)$/);
            if (lineMatch) {
                const targetLine = parseInt(lineMatch[1], 10);
                const lines = this.scroller.querySelectorAll<HTMLElement>('.cm-line');
                if (lines.length > 0) {
                    const approxFirst = this.estimatedFirstLine(lines.length);
                    const relativeIdx = targetLine - approxFirst;
                    if (relativeIdx >= 0 && relativeIdx < lines.length) {
                        const lineEl = lines[relativeIdx];
                        if (lineEl) {
                            const top = (lineEl.getBoundingClientRect().top - scrollerRect.top + this.currentScrollTop) / this.zoom;
                            this.blockPositionCache.set(blockId, top);
                            return top;
                        }
                    }
                    if (anchorText) {
                        for (let i = 0; i < lines.length; i++) {
                            if (lines[i].textContent?.trim() === anchorText) {
                                const top = (lines[i].getBoundingClientRect().top - scrollerRect.top + this.currentScrollTop) / this.zoom;
                                this.blockPositionCache.set(blockId, top);
                                return top;
                            }
                        }
                    }
                }
            }
        }

        const cached = this.blockPositionCache.get(blockId);
        if (cached !== undefined) return cached;

        const lineMatch = blockId.match(/^line:(\d+)$/);
        if (lineMatch) {
            const lineNum = parseInt(lineMatch[1], 10);
            const lineCount = Math.max(1, this.editor ? this.editor.lineCount() : 1);
            const avgLineHeight = this.editor ? (this.scroller.scrollHeight / lineCount) : 26;
            return lineNum * avgLineHeight;
        }

        return 0;
    }

    private getElementDocBounds(element: CanvasElement): BoundingBox {
        const { left: contentLeft, width: contentWidth } = this.getContentGeometry();
        const blockTop = this.getBlockTop(element.blockId, element.anchorText);
        const halfWidth = (element.style.width || 2) / 2;
        return {
            minX: contentLeft + element.bounds.minX * contentWidth - halfWidth,
            maxX: contentLeft + element.bounds.maxX * contentWidth + halfWidth,
            minY: blockTop + element.bounds.minY * contentWidth - halfWidth,
            maxY: blockTop + element.bounds.maxY * contentWidth + halfWidth,
        };
    }

    private anchorAt(docY: number): Anchor {
        const scrollerRect = this.scroller.getBoundingClientRect();

        // 1. Check if docY falls inside any apolo-space block (both Live Preview & Reading mode)
        const spaceBlocks = Array.from(
            this.scroller.querySelectorAll<HTMLElement>('.apolo-space-block, [data-apolo-space], [data-apolo-space-id]')
        );
        for (const blockEl of spaceBlocks) {
            const spaceId = blockEl.dataset.apoloSpaceId || blockEl.dataset.apoloSpace;
            if (!spaceId) continue;
            const rect = blockEl.getBoundingClientRect();
            const blockTop = (rect.top - scrollerRect.top + this.currentScrollTop) / this.zoom;
            const blockBottom = (rect.bottom - scrollerRect.top + this.currentScrollTop) / this.zoom;
            if (docY >= blockTop && docY <= blockBottom) {
                return {
                    blockId: `space:${spaceId}`,
                    text: '',
                    y: blockTop,
                };
            }
        }

        // 2. Line anchoring fallback
        if (!this.options.readonly && this.editor) {
            const lines = this.scroller.querySelectorAll<HTMLElement>('.cm-line');
            if (lines.length > 0) {
                let best = lines[0];
                let bestDistance = Number.POSITIVE_INFINITY;
                let lineNumber = 0;
                for (let i = 0; i < lines.length; i++) {
                    const rect = lines[i].getBoundingClientRect();
                    const lineTop = (rect.top - scrollerRect.top + this.currentScrollTop) / this.zoom;
                    const lineBottom = (rect.bottom - scrollerRect.top + this.currentScrollTop) / this.zoom;
                    const delta = Math.max(lineTop - docY, 0, docY - lineBottom);
                    if (delta < bestDistance) {
                        best = lines[i];
                        bestDistance = delta;
                        lineNumber = i;
                    }
                }
                const text = best.textContent?.trim() ?? '';
                const globalLine = this.findLineNumber(text, this.estimatedFirstLine(lines.length) + lineNumber);
                const blockTop = (best.getBoundingClientRect().top - scrollerRect.top + this.currentScrollTop) / this.zoom;
                return {
                    blockId: `line:${globalLine}`,
                    text,
                    y: blockTop,
                };
            }
        }
        return { blockId: 'line:0', text: '', y: 0 };
    }

    private erase(points: Point[]): void {
        const radius = Math.max(12, this.eraserRadius);
        const { left: contentLeft, width: contentWidth } = this.getContentGeometry();
        const kept: CanvasElement[] = [];

        for (const element of this.document.elements) {
            const blockTop = this.getBlockTop(element.blockId, element.anchorText);
            if (element.type === 'stroke') {
                const fragments = this.eraserMode === 'reticle'
                    ? splitStrokeDoc(element, points, radius, contentLeft, contentWidth, blockTop)
                    : null;
                if (fragments) {
                    kept.push(...fragments);
                } else if (!strokeHitDoc(element, points, radius, contentLeft, contentWidth, blockTop)) {
                    kept.push(element);
                }
            } else {
                const b = this.getElementDocBounds(element);
                const cx = (b.minX + b.maxX) / 2;
                const cy = (b.minY + b.maxY) / 2;
                if (!nearPath(points, cx, cy, radius)) {
                    kept.push(element);
                }
            }
        }
        this.document.elements = kept;
        this.selection = [];
        this.lassoMenu?.hide();
        this.emitSelection();
    }

    // Lasso selection: supports freeform polygon and rectangular selection
    private selectLasso(points: Point[]): void {
        if (this.lassoMode === 'rect' && this.activeStart && points.length > 0) {
            const end = points[points.length - 1];
            const rxMin = Math.min(this.activeStart.x, end.x);
            const rxMax = Math.max(this.activeStart.x, end.x);
            const ryMin = Math.min(this.activeStart.y, end.y);
            const ryMax = Math.max(this.activeStart.y, end.y);
            this.selection = this.document.elements.filter(element => {
                const b = this.getElementDocBounds(element);
                return b.minX <= rxMax && b.maxX >= rxMin && b.minY <= ryMax && b.maxY >= ryMin;
            });
        } else {
            if (points.length < 3) {
                if (points.length > 0) {
                    this.selectAt(points[0]);
                } else {
                    this.selection = [];
                }
                return;
            }
            this.selection = this.document.elements.filter(element => {
                const b = this.getElementDocBounds(element);
                return pointInPolygon((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, points);
            });
        }
        this.emitSelection();
    }

    private selectAt(point: Point): void {
        const hit = [...this.document.elements].reverse().find(element =>
            contains(this.getElementDocBounds(element), point.x, point.y, 14),
        );
        if (hit) {
            // Select all strokes sharing the same link if linked
            if (hit.url) {
                this.selection = this.document.elements.filter(el => el.url === hit.url);
            } else {
                this.selection = [hit];
            }
        } else {
            this.selection = [];
        }
        this.emitSelection();
    }

    private getSelectionDocBounds(): BoundingBox | null {
        if (this.selection.length === 0) return null;
        let bounds = this.getElementDocBounds(this.selection[0]);
        for (let i = 1; i < this.selection.length; i++) {
            const b = this.getElementDocBounds(this.selection[i]);
            bounds = {
                minX: Math.min(bounds.minX, b.minX),
                minY: Math.min(bounds.minY, b.minY),
                maxX: Math.max(bounds.maxX, b.maxX),
                maxY: Math.max(bounds.maxY, b.maxY),
            };
        }
        return bounds;
    }

    private emitSelection(): void {
        const bounds = this.getSelectionDocBounds();
        this.options.eventBus?.emit('selection:changed', this.selection, bounds);
        if (this.selection.length > 0 && bounds) {
            const anchorName = this.selection[0].blockId ?? 'bloque 1';
            this.lassoMenu?.setSelection(
                this.selection,
                bounds,
                anchorName,
                this.zoom,
                this.currentScrollLeft,
                this.currentScrollTop,
            );
        } else {
            this.lassoMenu?.hide();
        }
    }

    private linkSelection(target: string): void {
        if (this.selection.length === 0 || !target) return;
        this.recordHistory();
        const formatted = target.startsWith('[[') || /^https?:/i.test(target) ? target : `[[${target}]]`;
        for (const element of this.selection) {
            element.url = formatted;
        }
        this.rebuildIndex();
        this.emitSelection();
        this.persistSoon();
        this.schedulePaint();
        this.toast?.show(`Enlazado a ${formatted}`);
    }

    private unlinkSelection(): void {
        if (this.selection.length === 0) return;
        this.recordHistory();
        for (const element of this.selection) {
            delete element.url;
        }
        this.rebuildIndex();
        this.emitSelection();
        this.persistSoon();
        this.schedulePaint();
        this.toast?.show('Enlace eliminado de la selección');
    }

    private shiftElementNormalized(element: CanvasElement, du: number, dv: number): void {
        element.bounds.minX += du;
        element.bounds.maxX += du;
        element.bounds.minY += dv;
        element.bounds.maxY += dv;
        if (element.type === 'shape') {
            element.startX += du;
            element.endX += du;
            element.startY += dv;
            element.endY += dv;
        } else {
            for (let i = 0; i < element.points.length; i += 4) {
                element.points[i] += du;
                element.points[i + 1] += dv;
            }
        }
    }

    private duplicateSelection(): void {
        const source = this.clipboard.length > 0 ? this.clipboard : this.selection;
        if (source.length === 0) return;
        this.recordHistory();
        const copies = JSON.parse(JSON.stringify(source)) as CanvasElement[];
        const offset = this.document.elements.length;
        const { width: contentWidth } = this.getContentGeometry();
        const du = 20 / contentWidth;
        const dv = 20 / contentWidth;
        for (let i = 0; i < copies.length; i++) {
            copies[i].id = uuid();
            copies[i].zIndex = offset + i;
            this.shiftElementNormalized(copies[i], du, dv);
            this.document.elements.push(copies[i]);
        }
        this.selection = copies;
        this.rebuildIndex();
        this.emitSelection();
        this.persistSoon();
        this.schedulePaint();
        this.toast?.show(`${copies.length} elemento(s) pegado(s)`);
    }

    private deleteSelection(): void {
        if (this.selection.length === 0) return;
        this.recordHistory();
        const ids = new Set(this.selection.map(element => element.id));
        this.document.elements = this.document.elements.filter(element => !ids.has(element.id));
        this.selection = [];
        this.lassoMenu?.hide();
        this.rebuildIndex();
        this.persistSoon();
        this.schedulePaint();
        this.toast?.show('Elementos eliminados');
    }

    private applyStyleToSelection(patch: { color?: string; width?: number; pattern?: StrokePattern }): void {
        if (this.selection.length === 0) return;
        this.recordHistory();
        for (const element of this.selection) {
            if (patch.color) element.style.color = patch.color;
            if (patch.width !== undefined) element.style.width = patch.width;
            if (patch.pattern) element.style.pattern = patch.pattern;
        }
        this.rebuildIndex();
        this.emitSelection();
        this.persistSoon();
        this.schedulePaint();
        this.toast?.show('Estilo aplicado a la selección');
    }

    private changeSelectionOrder(front: boolean): void {
        if (this.selection.length === 0) return;
        this.recordHistory();
        const selectedIds = new Set(this.selection.map(element => element.id));
        const selected = this.document.elements.filter(element => selectedIds.has(element.id));
        const remaining = this.document.elements.filter(element => !selectedIds.has(element.id));
        this.document.elements = front ? [...remaining, ...selected] : [...selected, ...remaining];
        for (let i = 0; i < this.document.elements.length; i++) this.document.elements[i].zIndex = i;
        this.rebuildIndex();
        this.persistSoon();
        this.schedulePaint();
        this.toast?.show(front ? 'Selección traída al frente' : 'Selección enviada al fondo');
    }

    private translateSelection(dx: number, dy: number, persist = true): void {
        if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
        const { width: contentWidth } = this.getContentGeometry();
        const du = dx / contentWidth;
        const dv = dy / contentWidth;
        for (const element of this.selection) {
            this.shiftElementNormalized(element, du, dv);
        }
        this.rebuildIndex();
        this.emitSelection();
        if (persist) this.persistSoon();
        this.schedulePaint();
    }

    private insertSpace(points: Point[]): void {
        if (points.length < 2) return;
        const dy = points[points.length - 1].y - points[0].y;
        if (Math.abs(dy) < 6) return;
        const pivot = points[0].y;

        this.recordHistory();

        const { width: contentWidth } = this.getContentGeometry();

        // 1. Check if the pivot touch is inside an existing apolo-space block
        const spaceBlocks = Array.from(this.scroller.querySelectorAll<HTMLElement>('.apolo-space-block, [data-apolo-space], [data-apolo-space-id]'));
        const scrollerRect = this.scroller.getBoundingClientRect();
        let targetSpace: { id: string; height: number; el: HTMLElement; top: number; bottom: number } | null = null;

        for (const blockEl of spaceBlocks) {
            const spaceId = blockEl.dataset.apoloSpaceId || blockEl.dataset.apoloSpace;
            if (!spaceId) continue;
            const rect = blockEl.getBoundingClientRect();
            const top = (rect.top - scrollerRect.top + this.currentScrollTop) / this.zoom;
            const bottom = (rect.bottom - scrollerRect.top + this.currentScrollTop) / this.zoom;
            if (pivot >= top - 8 && pivot <= bottom + 8) {
                const currentHeight = parseInt(blockEl.dataset.apoloHeight || String(Math.round(rect.height / this.zoom)), 10);
                targetSpace = { id: spaceId, height: currentHeight, el: blockEl, top, bottom };
                break;
            }
        }

        let effectiveShift = 0;
        let mutation: SpaceMutation | null = null;

        if (targetSpace) {
            // Modifying existing space block
            const newHeight = Math.max(0, targetSpace.height + Math.round(dy));
            effectiveShift = newHeight - targetSpace.height;

            if (newHeight <= 10 && dy < 0) {
                // Remove space block
                mutation = { id: targetSpace.id, height: 0, isNew: false, remove: true, targetLine: 0 };
                targetSpace.el.remove();
            } else {
                const clampedH = Math.max(20, Math.min(3000, newHeight));
                mutation = { id: targetSpace.id, height: clampedH, isNew: false, remove: false, targetLine: 0 };
                targetSpace.el.style.height = `${clampedH}px`;
                targetSpace.el.dataset.apoloHeight = String(clampedH);
            }
        } else if (dy >= 20) {
            // Creating a new space block
            const newId = `space-${Date.now()}`;
            const newHeight = Math.round(dy);
            effectiveShift = newHeight;

            let targetLine = 0;
            if (this.editor) {
                const anchor = this.anchorAt(pivot);
                if (anchor.blockId.startsWith('line:')) {
                    targetLine = parseInt(anchor.blockId.slice(5), 10);
                } else {
                    targetLine = this.editor.lastLine();
                }
            }
            mutation = { id: newId, height: newHeight, isNew: true, remove: false, targetLine };
        }

        if (mutation) {
            // 2. Shift elements below the pivot (preserving local anchors inside the space block being modified)
            if (effectiveShift !== 0) {
                const dv = effectiveShift / contentWidth;
                for (const element of this.document.elements) {
                    if (targetSpace && element.blockId === `space:${targetSpace.id}`) continue;

                    const b = this.getElementDocBounds(element);
                    if (b.minY >= pivot) {
                        this.shiftElementNormalized(element, 0, dv);
                    }
                }
                this.rebuildIndex();
            }

            // 3. Debounced write to markdown file via vault.process
            this.queueSpaceMutation(mutation);
            this.persistSoon();
            this.schedulePaint();
            this.toast?.show(`Espacio: ${effectiveShift > 0 ? '+' : ''}${Math.round(effectiveShift)} px`);
        }
    }

    private queueSpaceMutation(mutation: SpaceMutation): void {
        this.pendingSpaceMutations.push(mutation);
        if (this.spacerDebounceTimer !== null) {
            window.clearTimeout(this.spacerDebounceTimer);
        }
        this.spacerDebounceTimer = window.setTimeout(() => {
            this.spacerDebounceTimer = null;
            void this.flushSpaceMutations();
        }, 300);
    }

    private async flushSpaceMutations(): Promise<void> {
        const mutations = [...this.pendingSpaceMutations];
        this.pendingSpaceMutations = [];
        if (mutations.length === 0) return;

        try {
            await this.options.app.vault.process(this.file, (content) => {
                let updated = content;
                for (const mut of mutations) {
                    updated = this.applySpaceMutationToMarkdown(updated, mut);
                }
                return updated;
            });
        } catch (err) {
            console.error('[ApoloCanvas] Error updating space block via vault.process:', err);
        }
    }

    private applySpaceMutationToMarkdown(content: string, mutation: SpaceMutation): string {
        if (mutation.remove) {
            // Remove <div ... data-apolo-space="id" ...></div>
            const divRegex = new RegExp(`[\\r\\n]*<div\\s+[^>]*data-apolo-space(?:-id)?=["']${mutation.id}["'][^>]*><\\/div>`, 'gi');
            let res = content.replace(divRegex, '');
            // Also remove codeblock if present
            const codeBlockRegex = new RegExp(`[\\r\\n]*\`\`\`apolo-space[\\s\\S]*?id:\\s*${mutation.id}[\\s\\S]*?\`\`\``, 'gi');
            res = res.replace(codeBlockRegex, '');
            return res;
        }

        if (!mutation.isNew) {
            // Update existing block
            // 1. Try HTML div
            const divRegex = new RegExp(`(<div\\s+[^>]*data-apolo-space(?:-id)?=["']${mutation.id}["'][^>]*style=["'][^"']*height:\\s*)\\d+px([^"']*["'][^>]*><\\/div>)`, 'i');
            if (divRegex.test(content)) {
                return content.replace(divRegex, `$1${mutation.height}px$2`);
            }
            const generalDiv = new RegExp(`<div\\s+[^>]*data-apolo-space(?:-id)?=["']${mutation.id}["'][^>]*><\\/div>`, 'i');
            if (generalDiv.test(content)) {
                return content.replace(generalDiv, `<div class="apolo-space" data-apolo-space="${mutation.id}" style="height:${mutation.height}px;"></div>`);
            }
            // 2. Try codeblock
            const codeBlockRegex = new RegExp(`\`\`\`apolo-space([\\s\\S]*?id:\\s*${mutation.id}[\\s\\S]*?)\`\`\``, 'i');
            if (codeBlockRegex.test(content)) {
                return content.replace(codeBlockRegex, `\`\`\`apolo-space\nheight: ${mutation.height}\nid: ${mutation.id}\n\`\`\``);
            }
            return `${content}\n<div class="apolo-space" data-apolo-space="${mutation.id}" style="height:${mutation.height}px;"></div>\n`;
        } else {
            // Insert new block as <div class="apolo-space" data-apolo-space="..." style="height:...px;"></div>
            const divTag = `<div class="apolo-space" data-apolo-space="${mutation.id}" style="height:${mutation.height}px;"></div>`;
            const lines = content.split('\n');
            const targetLine = Math.max(0, Math.min(lines.length, mutation.targetLine + 1));
            lines.splice(targetLine, 0, divTag);
            return lines.join('\n');
        }
    }

    private testAnchorDisplacement(): void {
        if (this.document.elements.length === 0) {
            this.toast?.show('Dibuja algún trazo primero para probar el anclaje');
            return;
        }
        const { width: contentWidth } = this.getContentGeometry();
        this.recordHistory();
        const dv = 56 / contentWidth;
        for (const element of this.document.elements) {
            this.shiftElementNormalized(element, 0, dv);
        }
        this.rebuildIndex();
        this.persistSoon();
        this.schedulePaint();
        this.toast?.show('Tinta desplazada +56 px simulando nuevo párrafo arriba');
    }

    private performUndo(): void {
        const snapshot = this.history.pop();
        if (!snapshot) return;
        this.future.push(JSON.stringify(this.document.elements));
        this.document.elements = JSON.parse(snapshot) as CanvasElement[];
        this.selection = [];
        this.lassoMenu?.hide();
        this.rebuildIndex();
        this.persistSoon();
        this.schedulePaint();
        this.toolbar?.setHistory(this.history.length > 0, this.future.length > 0);
        this.options.eventBus?.emit('history:changed', this.history.length > 0, this.future.length > 0);
        this.toast?.show('Deshecho');
    }

    private performRedo(): void {
        const snapshot = this.future.pop();
        if (!snapshot) return;
        this.history.push(JSON.stringify(this.document.elements));
        this.document.elements = JSON.parse(snapshot) as CanvasElement[];
        this.selection = [];
        this.lassoMenu?.hide();
        this.rebuildIndex();
        this.persistSoon();
        this.schedulePaint();
        this.toolbar?.setHistory(this.history.length > 0, this.future.length > 0);
        this.options.eventBus?.emit('history:changed', this.history.length > 0, this.future.length > 0);
        this.toast?.show('Rehecho');
    }

    private recordHistory(): void {
        this.history.push(JSON.stringify(this.document.elements));
        if (this.history.length > 30) this.history.shift();
        this.future.length = 0;
        this.toolbar?.setHistory(this.history.length > 0, false);
        this.options.eventBus?.emit('history:changed', this.history.length > 0, false);
    }

    private resetView(): void {
        this.setZoomLevel(1.0);
    }

    private rebuildIndex(): void {
        this.index.clear();
        for (const element of this.document.elements) {
            this.index.add(element, this.getElementDocBounds(element));
        }
        this.renderDirty = true;
    }

    private persistSoon(): void {
        this.document.updatedAt = Date.now();
        this.persistence.enqueue(this.document, this.file, this.pageId);
        this.options.eventBus?.emit('save:status', true, this.lastSavedAt);
    }

    private queueSave(file: TFile): void {
        this.persistence.enqueue(this.document, file, this.pageId);
    }

    private scheduleReanchor(): void {
        if (this.options.readonly || !this.editor) return;
        if (this.reanchorTimer !== null) window.clearTimeout(this.reanchorTimer);
        this.reanchorTimer = window.setTimeout(() => {
            this.reanchorTimer = null;
            this.reanchor();
        }, 180);
    }

    private reanchor(): void {
        if (this.options.readonly || !this.editor) return;
        if (this.document.elements.length === 0) return;
        this.blockPositionCache.clear();

        let changed = false;
        const lineCount = this.editor.lineCount();

        const desiredTexts = new Set<string>();
        for (const element of this.document.elements) {
            if (element.anchorText) desiredTexts.add(element.anchorText);
        }

        if (desiredTexts.size > 0) {
            const textToLines = new Map<string, number[]>();
            for (let line = 0; line < lineCount; line++) {
                const text = this.editor.getLine(line).trim();
                if (desiredTexts.has(text)) {
                    let arr = textToLines.get(text);
                    if (!arr) {
                        arr = [];
                        textToLines.set(text, arr);
                    }
                    arr.push(line);
                }
            }

            for (const element of this.document.elements) {
                if (!element.anchorText) continue;
                const match = element.blockId.match(/^line:(\d+)$/);
                if (!match) continue;
                const oldLine = parseInt(match[1], 10);
                const candidates = textToLines.get(element.anchorText);
                if (candidates && candidates.length > 0) {
                    let nearest = candidates[0];
                    let minDiff = Math.abs(nearest - oldLine);
                    for (let i = 1; i < candidates.length; i++) {
                        const diff = Math.abs(candidates[i] - oldLine);
                        if (diff < minDiff) {
                            minDiff = diff;
                            nearest = candidates[i];
                        }
                    }
                    if (nearest !== oldLine) {
                        element.blockId = `line:${nearest}`;
                        changed = true;
                    }
                }
            }
        }

        this.rebuildIndex();
        if (changed) {
            this.persistSoon();
        }
        this.schedulePaint();
    }

    onPreviewSectionRendered(): void {
        if (!this.options.readonly) return;
        this.schedulePreviewReanchor();
    }

    private schedulePreviewReanchor(): void {
        if (!this.options.readonly || this.document.elements.length === 0) return;
        if (this.previewReanchorTimer !== null) {
            window.clearTimeout(this.previewReanchorTimer);
        }
        this.previewReanchorTimer = window.setTimeout(() => {
            this.previewReanchorTimer = null;
            this.reanchorPreview();
        }, 50);
    }

    private reanchorPreview(): void {
        if (!this.options.readonly || this.document.elements.length === 0) return;
        this.blockPositionCache.clear();
        this.rebuildIndex();
        this.renderDirty = true;
        this.schedulePaint();
    }

    private estimatedFirstLine(visibleLineCount: number): number {
        if (!this.editor) return 0;
        const lineCount = this.editor.lineCount();
        const maxScroll = Math.max(1, this.scroller.scrollHeight - this.scroller.clientHeight);
        const fraction = Math.max(0, Math.min(1, this.currentScrollTop / maxScroll));
        return Math.round(fraction * Math.max(0, lineCount - visibleLineCount));
    }

    private findLineNumber(text: string, approximateLine: number): number {
        if (!this.editor) return approximateLine;
        if (!text) return Math.max(0, Math.min(this.editor.lastLine(), approximateLine));
        let best = Math.max(0, Math.min(this.editor.lastLine(), approximateLine));
        let bestDistance = Number.POSITIVE_INFINITY;
        const first = Math.max(0, approximateLine - 96);
        const last = Math.min(this.editor.lastLine(), approximateLine + 96);
        for (let line = first; line <= last; line++) {
            if (this.editor.getLine(line).trim() !== text) continue;
            const distance = Math.abs(line - approximateLine);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = line;
            }
        }
        return best;
    }

    private get currentScrollTop(): number {
        if (typeof this.options.getScroll === 'function') {
            const val = this.options.getScroll();
            if (typeof val === 'number' && !Number.isNaN(val)) return val;
        }
        return this.scroller.scrollTop;
    }

    private get currentScrollLeft(): number {
        return this.scroller.scrollLeft;
    }

    private positionLayer(): void {
        this.layer.style.top = `${this.currentScrollTop}px`;
        this.layer.style.left = `${this.currentScrollLeft}px`;
    }

    private resize(): void {
        if (this.destroyed) return;
        const width = Math.max(1, this.scroller.clientWidth);
        const height = Math.max(1, this.scroller.clientHeight);
        const ratio = Math.max(1, window.devicePixelRatio || 1);

        this.layer.style.width = `${width}px`;
        this.layer.style.height = `${height}px`;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        this.dryCanvas.style.width = `${width}px`;
        this.dryCanvas.style.height = `${height}px`;

        const maxDim = 4096;
        const targetW = Math.min(maxDim, Math.round(width * ratio));
        const targetH = Math.min(maxDim, Math.round(height * ratio));

        if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
            this.canvas.width = targetW;
            this.canvas.height = targetH;
            this.dryCanvas.width = targetW;
            this.dryCanvas.height = targetH;
            this.renderDirty = true;
        }
    }

    private schedulePaint(): void {
        if (this.frame || this.destroyed) return;
        this.frame = requestAnimationFrame(this.onAnimationFrame);
    }

    private paint(): void {
        if (this.destroyed) return;
        this.applyContentZoom();
        this.positionLayer();

        const ratio = Math.max(1, window.devicePixelRatio || 1);
        const width = this.scroller.clientWidth;
        const height = this.scroller.clientHeight;
        const sTop = this.currentScrollTop;
        const sLeft = this.currentScrollLeft;

        this.context.setTransform(1, 0, 0, 1, 0, 0);
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.renderDirty) {
            this.blockPositionCache.clear();
            this.dryContext.setTransform(1, 0, 0, 1, 0, 0);
            this.dryContext.clearRect(0, 0, this.dryCanvas.width, this.dryCanvas.height);
            this.dryContext.setTransform(
                ratio * this.zoom,
                0,
                0,
                ratio * this.zoom,
                -ratio * sLeft,
                -ratio * sTop,
            );

            if (this.snapGrid) this.paintGrid(this.dryContext, width, height);

            const viewport: BoundingBox = {
                minX: sLeft / this.zoom,
                minY: sTop / this.zoom,
                maxX: (sLeft + width) / this.zoom,
                maxY: (sTop + height) / this.zoom,
            };

            this.index.query(viewport, this.visible);
            this.visible.sort((a, b) => a.zIndex - b.zIndex);
            for (const element of this.visible) this.paintElement(element, this.dryContext);
            this.renderDirty = false;
        }

        this.dryContext.setTransform(1, 0, 0, 1, 0, 0);
        this.context.setTransform(
            ratio * this.zoom,
            0,
            0,
            ratio * this.zoom,
            -ratio * sLeft,
            -ratio * sTop,
        );

        if (this.points.size > 0 && this.activeStart) {
            if (this.tool === 'spacer') {
                this.paintSpacer();
            } else if (this.tool === 'lasso') {
                this.paintLasso();
            } else {
                this.paintActive();
            }
        }

        if (this.selection.length) this.paintSelection();
        this.context.setTransform(1, 0, 0, 1, 0, 0);
    }

    private paintGrid(context: CanvasRenderingContext2D, width: number, height: number): void {
        const sTop = this.currentScrollTop;
        const sLeft = this.currentScrollLeft;
        const startX = Math.floor(sLeft / (this.zoom * 12)) * 12;
        const startY = Math.floor(sTop / (this.zoom * 12)) * 12;
        const endX = (sLeft + width) / this.zoom;
        const endY = (sTop + height) / this.zoom;

        context.save();
        context.strokeStyle = '#7d8793';
        context.globalAlpha = 0.12;
        context.lineWidth = 1 / this.zoom;
        context.beginPath();
        for (let x = startX; x <= endX; x += 12) {
            context.moveTo(x, startY);
            context.lineTo(x, endY);
        }
        for (let y = startY; y <= endY; y += 12) {
            context.moveTo(startX, y);
            context.lineTo(endX, y);
        }
        context.stroke();
        context.restore();
    }

    private paintElement(element: CanvasElement, context: CanvasRenderingContext2D): void {
        const { left: contentLeft, width: contentWidth } = this.getContentGeometry();
        const blockTop = this.getBlockTop(element.blockId, element.anchorText);

        context.save();

        // Render purple link halo if element has a WikiLink / URL
        if (element.url) {
            context.save();
            context.strokeStyle = '#6C3FD1';
            context.globalAlpha = 0.25;
            context.lineWidth = element.style.width + 8;
            context.lineCap = 'round';
            context.lineJoin = 'round';
            if (element.type === 'stroke') {
                const data = element.points;
                if (data.length >= 4) {
                    context.beginPath();
                    context.moveTo(contentLeft + data[0] * contentWidth, blockTop + data[1] * contentWidth);
                    for (let i = 4; i < data.length; i += 4) {
                        context.lineTo(contentLeft + data[i] * contentWidth, blockTop + data[i + 1] * contentWidth);
                    }
                    context.stroke();
                }
            } else {
                this.paintShape(element, context, contentLeft, contentWidth, blockTop);
            }
            context.restore();
        }

        context.strokeStyle = element.style.color;
        context.lineWidth = element.style.width;
        context.globalAlpha = element.style.opacity;
        context.lineCap = element.style.lineCap ?? 'round';
        context.lineJoin = 'round';
        context.setLineDash(element.style.pattern === 'dashed' ? [8, 6] : element.style.pattern === 'dotted' ? [1, 5] : []);

        if (element.type === 'stroke') {
            const data = element.points;
            if (data.length >= 4) {
                if (element.style.pattern !== 'solid') {
                    context.lineWidth = element.style.width;
                    context.beginPath();
                    context.moveTo(contentLeft + data[0] * contentWidth, blockTop + data[1] * contentWidth);
                    for (let i = 4; i < data.length; i += 4) {
                        context.lineTo(contentLeft + data[i] * contentWidth, blockTop + data[i + 1] * contentWidth);
                    }
                    context.stroke();
                } else if (data.length === 4) {
                    context.lineWidth = element.style.width * pressureScale(data[2], this.pressureSensitivity);
                    context.beginPath();
                    context.arc(
                        contentLeft + data[0] * contentWidth,
                        blockTop + data[1] * contentWidth,
                        context.lineWidth / 2,
                        0,
                        Math.PI * 2,
                    );
                    context.fillStyle = element.style.color;
                    context.fill();
                } else {
                    for (let i = 4; i < data.length; i += 4) {
                        context.lineWidth = element.style.width * pressureScale((data[i - 2] + data[i + 2]) / 2, this.pressureSensitivity);
                        context.beginPath();
                        context.moveTo(contentLeft + data[i - 4] * contentWidth, blockTop + data[i - 3] * contentWidth);
                        context.lineTo(contentLeft + data[i] * contentWidth, blockTop + data[i + 1] * contentWidth);
                        context.stroke();
                    }
                }
            }
        } else {
            this.paintShape(element, context, contentLeft, contentWidth, blockTop);
        }

        context.restore();
    }

    private paintShape(
        shape: ShapeElement,
        context: CanvasRenderingContext2D,
        contentLeft: number,
        contentWidth: number,
        blockTop: number,
    ): void {
        const startX = contentLeft + shape.startX * contentWidth;
        const startY = blockTop + shape.startY * contentWidth;
        const endX = contentLeft + shape.endX * contentWidth;
        const endY = blockTop + shape.endY * contentWidth;

        const x = Math.min(startX, endX);
        const y = Math.min(startY, endY);
        const width = Math.abs(endX - startX);
        const height = Math.abs(endY - startY);

        context.beginPath();
        switch (shape.shapeType) {
            case 'line':
                context.moveTo(startX, startY);
                context.lineTo(endX, endY);
                break;
            case 'arrow':
                context.moveTo(startX, startY);
                context.lineTo(endX, endY);
                context.lineTo(endX - 10, endY - 5);
                context.moveTo(endX, endY);
                context.lineTo(endX - 5, endY - 10);
                break;
            case 'ellipse':
                context.ellipse(x + width / 2, y + height / 2, Math.max(1, width / 2), Math.max(1, height / 2), 0, 0, Math.PI * 2);
                break;
            case 'triangle':
                context.moveTo(x + width / 2, y);
                context.lineTo(x + width, y + height);
                context.lineTo(x, y + height);
                context.closePath();
                break;
            case 'rounded-rect':
                context.roundRect(x, y, width, height, 8);
                break;
            default:
                context.rect(x, y, width, height);
                break;
        }
        if (shape.fillColor) {
            context.fillStyle = shape.fillColor;
            context.fill();
        }
        context.stroke();
    }

    private paintActive(): void {
        const context = this.context;
        context.save();
        context.strokeStyle = this.style.color;
        context.lineWidth = this.style.width;
        context.globalAlpha = this.barrelActive ? 0.75 : this.style.opacity;
        context.lineCap = this.style.lineCap ?? 'round';
        context.lineJoin = 'round';
        if (this.style.pattern === 'dashed') context.setLineDash([8, 6]);
        else if (this.style.pattern === 'dotted') context.setLineDash([1, 5]);
        if (this.barrelActive) context.setLineDash([4, 4]);

        context.beginPath();
        if (this.points.size === 1) {
            context.lineWidth = this.style.width * pressureScale(this.points.getPressure(0), this.pressureSensitivity);
            context.beginPath();
            context.arc(this.points.getX(0), this.points.getY(0), context.lineWidth / 2, 0, Math.PI * 2);
            context.fillStyle = this.style.color;
            context.fill();
        } else if (this.style.pattern !== 'solid') {
            context.lineWidth = this.style.width;
            context.moveTo(this.points.getX(0), this.points.getY(0));
            for (let i = 1; i < this.points.size; i++) context.lineTo(this.points.getX(i), this.points.getY(i));
            context.stroke();
        } else {
            for (let i = 1; i < this.points.size; i++) {
                context.lineWidth = this.style.width * pressureScale((this.points.getPressure(i - 1) + this.points.getPressure(i)) / 2, this.pressureSensitivity);
                context.beginPath();
                context.moveTo(this.points.getX(i - 1), this.points.getY(i - 1));
                context.lineTo(this.points.getX(i), this.points.getY(i));
                context.stroke();
            }
        }
        context.restore();

        if (this.hasPrediction && this.points.size > 0 && !this.barrelActive) {
            context.save();
            context.globalAlpha = this.style.opacity * 0.55;
            context.lineWidth = this.style.width;
            context.strokeStyle = this.style.color;
            context.setLineDash([3, 3]);
            context.beginPath();
            context.moveTo(this.points.getX(this.points.size - 1), this.points.getY(this.points.size - 1));
            context.lineTo(this.predictedPoint.x, this.predictedPoint.y);
            context.stroke();
            context.restore();
        }
    }

    private paintLasso(): void {
        this.context.save();
        this.context.strokeStyle = '#2F6BFF';
        this.context.lineWidth = 1.5;
        this.context.setLineDash([6, 4]);
        this.context.beginPath();

        if (this.lassoMode === 'rect' && this.activeStart) {
            const endX = this.points.getX(this.points.size - 1);
            const endY = this.points.getY(this.points.size - 1);
            const rx = Math.min(this.activeStart.x, endX);
            const ry = Math.min(this.activeStart.y, endY);
            const rw = Math.abs(endX - this.activeStart.x);
            const rh = Math.abs(endY - this.activeStart.y);
            this.context.fillStyle = 'rgba(47, 107, 255, 0.08)';
            this.context.fillRect(rx, ry, rw, rh);
            this.context.strokeRect(rx, ry, rw, rh);
        } else {
            this.context.moveTo(this.points.getX(0), this.points.getY(0));
            for (let i = 1; i < this.points.size; i++) this.context.lineTo(this.points.getX(i), this.points.getY(i));
            this.context.stroke();
        }
        this.context.restore();
    }

    private paintSpacer(): void {
        if (!this.activeStart || this.points.size === 0) return;
        const currentY = this.points.getY(this.points.size - 1);
        const startY = this.activeStart.y;
        const dy = currentY - startY;

        const { left: contentLeft, width: contentWidth } = this.getContentGeometry();
        const scrollerW = this.scroller.clientWidth / this.zoom;
        const x1 = Math.max(0, contentLeft - 20);
        const x2 = Math.min(scrollerW, contentLeft + contentWidth + 20);

        this.context.save();

        // Start pivot line (gray dashed)
        this.context.strokeStyle = '#8B949E';
        this.context.lineWidth = 1.5 / this.zoom;
        this.context.setLineDash([4 / this.zoom, 4 / this.zoom]);
        this.context.beginPath();
        this.context.moveTo(x1, startY);
        this.context.lineTo(x2, startY);
        this.context.stroke();

        // End line (blue solid)
        this.context.strokeStyle = '#2F6BFF';
        this.context.lineWidth = 2 / this.zoom;
        this.context.setLineDash([]);
        this.context.beginPath();
        this.context.moveTo(x1, currentY);
        this.context.lineTo(x2, currentY);
        this.context.stroke();

        // Tinted region between pivot and currentY
        const minY = Math.min(startY, currentY);
        const h = Math.abs(dy);
        this.context.fillStyle = dy >= 0 ? 'rgba(47, 107, 255, 0.08)' : 'rgba(239, 68, 68, 0.08)';
        this.context.fillRect(x1, minY, x2 - x1, h);

        // Height badge at center
        const midX = (x1 + x2) / 2;
        const midY = (startY + currentY) / 2;
        const text = `${dy >= 0 ? '+' : ''}${Math.round(dy)} px`;
        this.context.font = `600 ${Math.round(13 / this.zoom)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        this.context.fillStyle = '#2F6BFF';
        this.context.textAlign = 'center';
        this.context.textBaseline = 'middle';
        this.context.fillText(text, midX, midY);

        this.context.restore();
    }

    private paintSelection(): void {
        const bounds = this.getSelectionDocBounds();
        if (!bounds) return;
        const padding = 6;
        const x = bounds.minX - padding;
        const y = bounds.minY - padding;
        const w = bounds.maxX - bounds.minX + padding * 2;
        const h = bounds.maxY - bounds.minY + padding * 2;

        this.context.save();
        const strokeW = 1.5 / this.zoom;
        const handleStrokeW = 2 / this.zoom;
        const rCorner = 6 / this.zoom;
        const rMid = 5 / this.zoom;

        // Bounding rect
        this.context.fillStyle = 'rgba(47, 107, 255, 0.06)';
        this.context.strokeStyle = '#2F6BFF';
        this.context.lineWidth = strokeW;
        this.context.fillRect(x, y, w, h);
        this.context.strokeRect(x, y, w, h);

        // 8 control handles
        const handles = [
            { x: x, y: y, r: rCorner },
            { x: x + w, y: y, r: rCorner },
            { x: x, y: y + h, r: rCorner },
            { x: x + w, y: y + h, r: rCorner },
            { x: x + w / 2, y: y, r: rMid },
            { x: x + w / 2, y: y + h, r: rMid },
            { x: x, y: y + h / 2, r: rMid },
            { x: x + w, y: y + h / 2, r: rMid },
        ];
        for (const hp of handles) {
            this.context.beginPath();
            this.context.arc(hp.x, hp.y, hp.r, 0, Math.PI * 2);
            this.context.fillStyle = '#FFFFFF';
            this.context.fill();
            this.context.lineWidth = handleStrokeW;
            this.context.strokeStyle = '#2F6BFF';
            this.context.stroke();
        }
        this.context.restore();
    }

    // Touch gesture handling (Pinch-to-zoom & 1-finger scrolling)
    private readonly onTouchDown = (event: PointerEvent): void => {
        if (event.pointerType !== 'touch' || !this.input || this.input.shouldRejectTouch() || this.input.hasActivePenStroke) return;
        this.touches.set(event.pointerId, this.localTouch(event));
        if (this.touches.size === 1) {
            this.singleTouchStartCoords = { x: event.clientX, y: event.clientY, time: Date.now() };
            this.lastSingleTouch = { x: event.clientX, y: event.clientY };
            this.singleTouchPanned = false;
        } else if (this.touches.size === 2) {
            event.preventDefault();
            this.singleTouchStartCoords = null;
            this.lastSingleTouch = null;
            this.singleTouchPanned = false;
            try { this.canvas.setPointerCapture(event.pointerId); } catch { /* best effort */ }
            this.startGesture();
        }
    };

    private readonly onTouchMove = (event: PointerEvent): void => {
        if (event.pointerType !== 'touch' || !this.touches.has(event.pointerId)) return;
        this.touches.set(event.pointerId, this.localTouch(event));

        if (this.touches.size === 1 && this.lastSingleTouch) {
            const dx = event.clientX - this.lastSingleTouch.x;
            const dy = event.clientY - this.lastSingleTouch.y;
            this.lastSingleTouch = { x: event.clientX, y: event.clientY };

            if (!this.singleTouchPanned) {
                const totalDx = Math.abs(event.clientX - (this.singleTouchStartCoords?.x ?? event.clientX));
                const totalDy = Math.abs(event.clientY - (this.singleTouchStartCoords?.y ?? event.clientY));
                if (totalDx > 6 || totalDy > 6) {
                    this.singleTouchPanned = true;
                }
            }

            if (this.singleTouchPanned) {
                event.preventDefault();
                const sizer = this.getSizerElement();
                const baseWidth = sizer?.offsetWidth ?? this.scroller.clientWidth;
                const baseHeight = sizer?.offsetHeight ?? this.scroller.clientHeight;
                const maxScrollX = Math.max(0, Math.round(baseWidth * this.zoom - this.scroller.clientWidth));
                const maxScrollY = Math.max(0, Math.round(baseHeight * this.zoom - this.scroller.clientHeight));

                this.scroller.scrollLeft = Math.max(0, Math.min(maxScrollX, this.scroller.scrollLeft - dx));
                this.scroller.scrollTop = Math.max(0, Math.min(maxScrollY, this.scroller.scrollTop - dy));
            }
        } else if (this.touches.size >= 2) {
            event.preventDefault();
            this.singleTouchStartCoords = null;
            this.lastSingleTouch = null;
            this.updateGesture();
        }
    };

    private readonly onTouchEnd = (event: PointerEvent): void => {
        if (event.pointerType !== 'touch') return;
        const start = this.singleTouchStartCoords;
        const wasPanned = this.singleTouchPanned;
        this.singleTouchStartCoords = null;
        this.lastSingleTouch = null;
        this.singleTouchPanned = false;
        this.touches.delete(event.pointerId);

        if (this.touches.size < 2) {
            this.gestureDistance = 0;
            // On releasing two-finger pinch gesture, re-rasterize dry canvas to zoom * devicePixelRatio
            this.renderDirty = true;
            this.schedulePaint();
        }
        try { if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId); } catch { /* best effort */ }

        if (start && !wasPanned && this.touches.size === 0) {
            const dx = Math.abs(event.clientX - start.x);
            const dy = Math.abs(event.clientY - start.y);
            const dt = Date.now() - start.time;
            if (dx < 12 && dy < 12 && dt < 400) {
                this.focusEditorAt(event.clientX, event.clientY);
            }
        }
    };

    private localTouch(event: PointerEvent): TouchPoint {
        const rect = this.scroller.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    private startGesture(): void {
        const points = Array.from(this.touches.values());
        if (points.length < 2) return;
        const dx = points[1].x - points[0].x;
        const dy = points[1].y - points[0].y;
        this.gestureDistance = Math.max(1, Math.hypot(dx, dy));
        this.gestureZoom = this.zoom;
        const centerX = (points[0].x + points[1].x) / 2;
        const centerY = (points[0].y + points[1].y) / 2;
        this.gestureWorldX = (centerX + this.currentScrollLeft) / this.zoom;
        this.gestureWorldY = (centerY + this.currentScrollTop) / this.zoom;
    }

    private updateGesture(): void {
        const points = Array.from(this.touches.values());
        if (points.length < 2) return;
        const dx = points[1].x - points[0].x;
        const dy = points[1].y - points[0].y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const centerX = (points[0].x + points[1].x) / 2;
        const centerY = (points[0].y + points[1].y) / 2;
        if (!this.gestureDistance) this.startGesture();

        const newZoom = Math.max(1.0, Math.min(3.0, (this.gestureZoom * distance) / this.gestureDistance));
        this.setZoomLevel(newZoom);

        if (newZoom > 1.0) {
            const sizer = this.getSizerElement();
            const baseWidth = sizer?.offsetWidth ?? this.scroller.clientWidth;
            const baseHeight = sizer?.offsetHeight ?? this.scroller.clientHeight;
            const maxScrollX = Math.max(0, Math.round(baseWidth * newZoom - this.scroller.clientWidth));
            const maxScrollY = Math.max(0, Math.round(baseHeight * newZoom - this.scroller.clientHeight));

            const targetScrollLeft = Math.max(0, Math.min(maxScrollX, Math.round(this.gestureWorldX * newZoom - centerX)));
            const targetScrollTop = Math.max(0, Math.min(maxScrollY, Math.round(this.gestureWorldY * newZoom - centerY)));
            this.scroller.scrollLeft = targetScrollLeft;
            this.scroller.scrollTop = targetScrollTop;
        } else {
            this.scroller.scrollLeft = 0;
        }
    }
}

// Geometric & spatial helpers
function uuid(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return `apolo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function boundsOf(points: readonly Point[], padding: number): BoundingBox {
    let minX = points[0].x;
    let maxX = minX;
    let minY = points[0].y;
    let maxY = minY;
    for (let i = 1; i < points.length; i++) {
        minX = Math.min(minX, points[i].x);
        maxX = Math.max(maxX, points[i].x);
        minY = Math.min(minY, points[i].y);
        maxY = Math.max(maxY, points[i].y);
    }
    return {
        minX: minX - padding / 2,
        minY: minY - padding / 2,
        maxX: maxX + padding / 2,
        maxY: maxY + padding / 2,
    };
}

function strokeHitDoc(
    stroke: StrokeElement,
    eraser: Point[],
    radius: number,
    contentLeft: number,
    contentWidth: number,
    blockTop: number,
): boolean {
    for (let i = 0; i < stroke.points.length; i += 4) {
        const x = contentLeft + stroke.points[i] * contentWidth;
        const y = blockTop + stroke.points[i + 1] * contentWidth;
        if (nearPath(eraser, x, y, radius)) return true;
    }
    return false;
}

function splitStrokeDoc(
    stroke: StrokeElement,
    eraser: Point[],
    radius: number,
    contentLeft: number,
    contentWidth: number,
    blockTop: number,
): StrokeElement[] | null {
    let hit = false;
    let part: number[] = [];
    const fragments: StrokeElement[] = [];
    const flush = (): void => {
        if (part.length >= 8) {
            let minU = Number.POSITIVE_INFINITY;
            let maxU = Number.NEGATIVE_INFINITY;
            let minV = Number.POSITIVE_INFINITY;
            let maxV = Number.NEGATIVE_INFINITY;
            for (let i = 0; i < part.length; i += 4) {
                const u = part[i];
                const v = part[i + 1];
                if (u < minU) minU = u;
                if (u > maxU) maxU = u;
                if (v < minV) minV = v;
                if (v > maxV) maxV = v;
            }
            fragments.push({
                ...stroke,
                id: uuid(),
                points: part,
                zIndex: stroke.zIndex,
                bounds: { minX: minU, maxX: maxU, minY: minV, maxY: maxV },
            });
        }
        part = [];
    };
    for (let i = 0; i < stroke.points.length; i += 4) {
        const u = stroke.points[i];
        const v = stroke.points[i + 1];
        const x = contentLeft + u * contentWidth;
        const y = blockTop + v * contentWidth;
        if (nearPath(eraser, x, y, radius)) {
            hit = true;
            flush();
        } else {
            part.push(u, v, stroke.points[i + 2], stroke.points[i + 3]);
        }
    }
    flush();
    return hit ? fragments : null;
}

function contains(bounds: BoundingBox, x: number, y: number, padding: number): boolean {
    return x >= bounds.minX - padding && x <= bounds.maxX + padding && y >= bounds.minY - padding && y <= bounds.maxY + padding;
}

function nearPath(path: Point[], x: number, y: number, radius: number): boolean {
    for (let i = 0; i < path.length; i++) {
        if (i === 0) {
            if (Math.hypot(x - path[i].x, y - path[i].y) <= radius) return true;
            continue;
        }
        const a = path[i - 1];
        const b = path[i];
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const length = vx * vx + vy * vy;
        const t = length ? Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / length)) : 0;
        if (Math.hypot(x - (a.x + t * vx), y - (a.y + t * vy)) <= radius) return true;
    }
    return false;
}

function pressureScale(pressure: number, sensitivity = 0.75): number {
    const minScale = Math.max(0.1, 0.5 - sensitivity * 0.4);
    const maxScale = 0.8 + sensitivity * 0.9;
    return minScale + Math.max(0, Math.min(1, pressure)) * (maxScale - minScale);
}

function pointInPolygon(x: number, y: number, polygon: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        const crosses = (a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
        if (crosses) inside = !inside;
    }
    return inside;
}
