import type { App, Editor, Notice, TFile } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { Transaction } from '@codemirror/state';
import type {
    BoundingBox,
    BoxAccentColor,
    BoxBgTheme,
    BoxGridStyle,
    BoxMetadata,
    CanvasElement,
    EraserMode,
    FavoritableTool,
    LassoMode,
    PageDocument,
    PenFavorite,
    PenProfileId,
    Point,
    ShapeElement,
    ShapeType,
    StrokeCache,
    StrokeElement,
    StrokePattern,
    StrokeStyle,
    ThicknessPreset,
    ToolbarSlot,
    ToolType,
    WorkspaceToolState,
} from '../core/types.ts';
import {
    DEFAULT_WORKSPACE_TOOL_STATE,
    cloneWorkspaceToolState,
} from '../core/types.ts';
import { InputManager } from './input/InputManager.ts';
import { PointBuffer } from './input/PointBuffer.ts';
import {
    applyStrokePattern,
    bakeLiveStrokeSegment,
    computeStraightLinePoints,
    drawPatternedStrokePath,
    getOrCreateStrokeSprite,
    type LiveBakeState,
    renderContinuousSolidStroke,
    snapLineAngle,
} from './PatternedStrokeRenderer.ts';
import { getPenPlugin } from './pens/index.ts';
import {
    MAGNETIC_SNAP_RADIUS_PX,
    applyGeometryToShapeElement,
    clearDanglingBindings,
    findNearestSnapPort,
    followBoundConnectors,
    isConnectorShape,
    releaseDetachedBindings,
    setBinding,
    type ConnectorGeometryAdapter,
    type SnapPortHit,
    getLinearPathNodes,
    splitLinearSegment,
    straightenLinearSegment,
    toggleLinearNodeKind,
    toggleNodeOrSegmentOrthogonal,
    insertLinearNodeAtPoint,
    linearPathHit,
    snapAngleOrOrthogonal,
    rotatePoint,
    computeSmartAlignmentGuides,
    type AlignmentGuide,
    type SnapTargetBounds,
    getShapePlugin,
    mapShapeElementPoints,
    refreshShapeElementBounds,
    shapeElementStyle,
    shapeElementToGeometry,
    type ShapeHandleKind,
    type ShapeRenderGeometry,
    type ShapeStyleConfig,
} from './shapes/index.ts';
import { SpatialGrid } from './spatial/SpatialGrid.ts';
import { PersistenceQueue, renderBoxSvg } from '../io/PersistenceQueue.ts';
import {
    HOLD_TO_SNAP_DWELL_MS,
    HOLD_TO_SNAP_MOVE_TOLERANCE_PX,
    ShapeRecognizer,
    type RecognizedShape,
} from '../tools/ShapeRecognizer.ts';
import { Predictor } from './input/Predictor.ts';
import { isConfirmedBarrelPress, isStylusBarrelButton, isStylusHoverBarrel, hasDeliberateStylusMovement } from './input/StylusCapabilities.ts';
import { EngineEventBus } from '../core/events.ts';
import { Toolbar } from '../ui/Toolbar.ts';
import { ToolEstuche } from '../ui/ToolEstuche.ts';
import {
    computeFavoriteFingerprint,
    findMatchingFavorite,
    getNextFavoritePreset,
    toggleFavoritePreset,
    removeFavoriteById,
    reorderFavorites,
    getActiveStrokeProfile,
    getActiveShapeProfile,
    syncLegacyFavoritesSlice,
    getCanonicalFavorites,
    setCanonicalFavorites,
    findMatchingProfile,
    switchStrokeProfile,
    switchShapeProfile,
    createStrokeProfile,
    createShapeProfile,
    renameStrokeProfile,
    deleteStrokeProfile,
    renameShapeProfile,
    deleteShapeProfile,
    renameFavoritePreset,
    type ToolFavoritePreset,
    type PenFavoritePreset,
    type HighlighterFavoritePreset,
    type ShapeFavoritePreset,
} from '../ui/favorites/FavoritesStore.ts';
import { LassoMenu } from '../ui/LassoMenu.ts';
import { BoxMenu, type BoxMenuState } from '../ui/BoxMenu.ts';
import { ZoomPill } from '../ui/ZoomPill.ts';
import { Toast } from '../ui/Toast.ts';
import { PopoverController } from '../ui/kit/index.ts';
import { createDotsIcon, createSvgFromMarkup, DEFAULT_FAVORITES, DEFAULT_TOOL_PALETTES, isDarkTheme, PEN_PROFILES } from '../ui/theme.ts';
import { smoothPressure } from './input/PressureCurve.ts';
import { shapeHitDoc, splitStrokeDoc, strokeHitDoc } from './eraser/StrokeEraser.ts';
import {
    cleanAnchorText,
    findBestMatchingLine,
    findBestMatchingPreviewBlock,
    type PreviewBlockInfo,
} from './anchoring/SmartAnchor.ts';
import {
    applySpaceMutationToMarkdown,
    BoxRegistry,
    escapeRegExp,
    htmlEscapeAttribute,
    normalizeBoxId,
    type SpaceMutation,
} from '../editor/ApoloSpaceExtension.ts';
import { insertCanvasIntoMarkdown } from '../editor/CanvasInsertion.ts';
import {
    type DocumentContentBounds,
    isInkAllowedAt,
    isScreenPointForbidden,
    sanitizeNormalizedPoint,
    snapNormalizedPoint,
    type SpaceBlockRegion,
    DEFAULT_INK_LIMITS,
    splitStrokeIntoValidRuns,
} from './anchoring/InkBoundary.ts';

export interface CanvasControllerOptions {
    palmRejectionCooldownMs: number;
    autoSaveDebounceMs: number;
    defaultPenColor: string;
    defaultPenWidth: number;
    enabled: boolean;
    enableMouseDrawing: boolean;
    shapeRecognition: boolean;
    straightenLines?: boolean;
    gridDensity?: number;
    defaultBoxHeight?: number;
    defaultBoxGridStyle?: BoxGridStyle;
    defaultBoxGridDensity?: number;
    defaultBoxBorderOutline?: boolean;
    defaultBoxBgTheme?: BoxBgTheme;
    defaultBoxAccentColor?: BoxAccentColor;
    defaultBoxCustomBgColor?: string;
    eventBus?: EngineEventBus;
    app: App;
    viewContainer?: HTMLElement;
    readonly?: boolean;
    toolbarSlot?: ToolbarSlot;
    showSpenDebugHud?: boolean;
    favorites?: PenFavorite[];
    toolPalettes?: {
        pen?: { colors: string[]; opacities: number[] };
        highlighter?: { colors: string[]; opacities: number[] };
        shape?: { colors: string[]; opacities: number[] };
    };
    toolState?: WorkspaceToolState;
    onToolStateChange?: (state: WorkspaceToolState) => void;
    onPenEnabledChange?: (enabled: boolean) => void;
    onToggleStraighten?: (enabled: boolean) => void;
    onToolbarSlotChange?: (slot: ToolbarSlot) => void;
    onFavoritesChange?: (favorites: PenFavorite[]) => void;
    onToggleFavorite?: () => void;
    onApplyFavorite?: (preset: ToolFavoritePreset) => void;
    onDeleteFavorite?: (presetId: string) => void;
    onReorderFavorites?: (fromIndex: number, toIndex: number) => void;
    onToolPalettesChange?: (palettes: {
        pen: { colors: string[]; opacities: number[] };
        highlighter: { colors: string[]; opacities: number[] };
        shape: { colors: string[]; opacities: number[] };
    }) => void;
}

interface Anchor {
    blockId: string;
    text: string;
    y: number;
    isBox?: boolean;
}

interface TouchPoint {
    x: number;
    y: number;
}

interface HistorySnapshot {
    elements: CanvasElement[];
    boxHeights?: Record<string, number>;
}

/** Live drag of one parametric control handle of the selected ShapeElement. */
interface ShapeHandleDragState {
    elementId: string;
    handleId: string;
    kind: ShapeHandleKind;
    /** Document-space geometry captured at pointerdown; every move re-applies from it. */
    startGeom: ShapeRenderGeometry;
    /** Handle position minus pointer position at grab time, so the handle does not jump. */
    grabOffsetX: number;
    grabOffsetY: number;
    /** Pre-drag state, pushed to the undo stack on pointerup only if something changed. */
    snapshot: HistorySnapshot;
    changed: boolean;
    /** Port the dragged connector endpoint is currently magnetized to (start / end handles only). */
    snap: SnapPortHit | null;
}

/** Style fields of a selected shape that ToolEstuche / Toolbar edit reactively. */
interface ShapeStylePatch {
    color?: string;
    width?: number;
    opacity?: number;
    pattern?: StrokePattern;
    fillEnabled?: boolean;
    fillColor?: string;
    fillPattern?: ShapeElement['fillPattern'];
    fillOpacity?: number;
    fillDensity?: number;
}

/** Screen-space pick radius of shape control handles. */
const SHAPE_HANDLE_HIT_RADIUS_PX = 12;
/** Pointer travel (document px) below which a shape-tool gesture is a tap that selects. */
const SHAPE_TAP_SLOP_PX = 4;
/** Consecutive style edits on the same selection within this window share one undo step (slider drags). */
const SHAPE_STYLE_HISTORY_COALESCE_MS = 700;

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
    private readonly highlighterDryCanvas = document.createElement('canvas');
    private readonly context: CanvasRenderingContext2D;
    private readonly dryContext: CanvasRenderingContext2D;
    private readonly highlighterDryContext: CanvasRenderingContext2D;

    // UI Components
    private readonly uiRoot = document.createElement('div');
    private toolbar: Toolbar | null = null;
    private estuche: ToolEstuche | null = null;
    private lassoMenu: LassoMenu | null = null;
    private zoomPill: ZoomPill | null = null;
    private toast: Toast | null = null;
    private boxMenu: BoxMenu | null = null;
    private readonly popoverController = new PopoverController();
    private activeHandleDrag: {
        boxId: string;
        startY: number;
        initialHeight: number;
        minAllowedHeight: number;
        hasMoved: boolean;
        pointerId: number;
        handleEl: HTMLElement;
        spaceEl: HTMLElement | null;
    } | null = null;

    // Engine Core Subsystems
    private readonly input: InputManager | null = null;
    private readonly points = new PointBuffer(32768);
    private readonly index = new SpatialGrid();
    private readonly visible: CanvasElement[] = [];
    private readonly recognizer = new ShapeRecognizer();
    private readonly predictor = new Predictor(12, 0.72, 5);
    private readonly history: HistorySnapshot[] = [];
    private readonly future: HistorySnapshot[] = [];
    private readonly touches = new Map<number, TouchPoint>();
    private readonly strokeCache: StrokeCache = new Map<string, HTMLCanvasElement>();
    private singleTouchStartCoords: { x: number; y: number; time: number } | null = null;
    private lastSingleTouch: { x: number; y: number } | null = null;
    private singleTouchPanned = false;
    private palmRejectedSingleTouch = false;
    private lastGestureCenter = { x: 0, y: 0 };
    private lastTouchEndTime = 0;
    private lastTouchEndPos = { x: 0, y: 0 };

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
    private toolState: WorkspaceToolState;
    private tool: ToolType = 'pen';
    private style: StrokeStyle;
    private shapeType: ShapeType = 'rect';
    private penProfileId: PenProfileId = 'fountain';
    private penEnabled: boolean;
    private shapeRecognition: boolean;
    private barrelActive = false;
    private penBarrelPressed = false;
    private lastBarrelCycleTime = 0;
    private isPenTipDown = false;
    private lastPenEventTime = 0;
    private lastPointerDownTime = 0;
    private pointerDownStartPos: { x: number; y: number } | null = null;
    private strokeStartTime = 0;
    private isShiftDown = false;
    private showSpenDebugHud = false;
    private debugInputHudEl: HTMLElement | null = null;
    private readonly debugHudLogs: string[] = [];
    private eraserMode: EraserMode = 'whole';
    private eraserRadius = 18;
    private scribbleToErase = true;
    private lassoMode: LassoMode = 'free';
    private snapGrid = false;
    private gridDensity = 32;
    private smoothing = 0.6;
    private pressureSensitivity = 0.75;
    private previousPenColor = '#1F4FD8';
    private favorites: PenFavorite[];
    private activeFavoriteIndex = 0;
    private toolPalettes: Record<'pen' | 'highlighter' | 'shape', { colors: string[]; opacities: number[] }>;
    private activeColorSlots: Record<'pen' | 'highlighter' | 'shape', number> = {
        pen: 0,
        highlighter: 0,
        shape: 0,
    };
    private toolbarSlot: ToolbarSlot = 'tc';

    // Selection & Manipulation
    private selection: CanvasElement[] = [];
    private lastHandleTap: { shapeId: string; handleId: string; time: number; x: number; y: number } | null = null;
    private activeAlignmentGuides: AlignmentGuide[] = [];
    private handleDrag: ShapeHandleDragState | null = null;
    private moveSelectionSnapshot: HistorySnapshot | null = null;
    // Hold-to-snap: dwell detection at the end of a freehand stroke
    private dwellTimer: ReturnType<typeof setTimeout> | null = null;
    private dwellAnchor: { x: number; y: number } | null = null;
    private snapPreview: RecognizedShape | null = null;
    private lastShapeStyleEdit = { at: 0, key: '' };
    private suppressSelectionStyleSync = false;
    /** Anchor-aware document geometry access for magnetic connectors. */
    private readonly connectorAdapter: ConnectorGeometryAdapter = {
        getGeometry: (element) => this.getShapeDocGeometry(element),
        setGeometry: (element, geom) => {
            const anchor = this.getElementAnchorGeometry(element.blockId, element.anchorText);
            applyGeometryToShapeElement(element, geom, anchor.originX, anchor.originY, anchor.scaleWidth);
            this.strokeCache.delete(element.id);
        },
    };
    private activeStart: Point | null = null;

    public get isDrawing(): boolean {
        return this.activeStart !== null;
    }
    private activeAnchor: Anchor | null = null;
    private activeContentLeft = 0;
    private activeContentWidth = 1;
    private activeBlockTop = 0;
    private readonly blockPositionCache = new Map<string, number>();
    private movingSelection = false;
    private clipboard: CanvasElement[] = [];
    private readonly predictedPoint: Point = { x: 0, y: 0, pressure: 0, time: 0 };
    private hasPrediction = false;

    // Live O(1) Incremental Baking Buffer
    private liveBakeCanvas: HTMLCanvasElement | null = null;
    private liveBakeCtx: CanvasRenderingContext2D | null = null;
    private liveBakedIndex = 0;
    private liveBakeSegState: Record<string, unknown> = {};
    private liveBakeZoom = -1;
    private liveBakeScrollLeft = -1;
    private liveBakeScrollTop = -1;
    private liveBakeStyleKey = '';
    private straightenLines = false;

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
    private lastBoxOptionsTapAt = 0;
    private readonly handledBoxEvents = new WeakSet<Event>();
    private destroyed = false;

    private readonly scroller: HTMLElement;
    private readonly editor: Editor | undefined;
    private readonly file: TFile;
    private readonly persistence: PersistenceQueue;
    private readonly options: CanvasControllerOptions;

    constructor(
        scroller: HTMLElement,
        editor: Editor | undefined,
        documentModel: PageDocument,
        file: TFile,
        pageId: string,
        persistence: PersistenceQueue,
        options: CanvasControllerOptions,
    ) {
        this.scroller = scroller;
        this.editor = editor;
        this.file = file;
        this.persistence = persistence;
        this.options = options;
        this.document = documentModel;
        if (!this.document.elements) {
            this.document.elements = [];
        }
        if (this.document.boxes) {
            for (const [id, meta] of Object.entries(this.document.boxes)) {
                BoxRegistry.setHeight(id, meta.height);
                if (meta.gridVisible !== undefined) BoxRegistry.setGridVisible(id, meta.gridVisible);
                if (meta.gridStyle !== undefined) BoxRegistry.setGridStyle(id, meta.gridStyle);
                if (meta.bgTheme !== undefined) BoxRegistry.setBgTheme(id, meta.bgTheme);
                if (meta.customBgColor !== undefined) BoxRegistry.setCustomBgColor(id, meta.customBgColor);
                if (meta.accentColor !== undefined) BoxRegistry.setAccentColor(id, meta.accentColor);
                if (meta.gridDensity !== undefined) BoxRegistry.setGridDensity(id, meta.gridDensity);
                if (meta.borderOutline !== undefined) BoxRegistry.setBorderOutline(id, meta.borderOutline);
                if (meta.snapToGrid !== undefined) BoxRegistry.setSnapActive(id, meta.snapToGrid);
            }
        }
        this.pageId = pageId;
        this.shapeRecognition = options.shapeRecognition;
        this.gridDensity = options.gridDensity ?? 32;
        this.toolbarSlot = options.toolbarSlot ?? 'tc';
        this.favorites = options.favorites && options.favorites.length === 4
            ? [...options.favorites]
            : [...DEFAULT_FAVORITES];

        if (options.toolState) {
            this.toolState = cloneWorkspaceToolState(options.toolState);
        } else {
            this.toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
            if (options.defaultPenColor) this.toolState.pen.color = options.defaultPenColor;
            if (options.defaultPenWidth) this.toolState.pen.width = options.defaultPenWidth;
            if (options.straightenLines !== undefined) this.toolState.pen.straightenLines = options.straightenLines;
            if (options.enabled !== undefined) this.toolState.penEnabled = options.enabled;
            if (options.favorites && options.favorites.length === 4) {
                this.toolState.pen.palette.colors = options.favorites.map(f => f.color);
            }
            if (options.toolPalettes) {
                if (options.toolPalettes.pen) {
                    this.toolState.pen.palette = {
                        colors: [...options.toolPalettes.pen.colors],
                        opacities: [...options.toolPalettes.pen.opacities],
                    };
                }
                if (options.toolPalettes.highlighter) {
                    this.toolState.highlighter.palette = {
                        colors: [...options.toolPalettes.highlighter.colors],
                        opacities: [...options.toolPalettes.highlighter.opacities],
                    };
                }
                if (options.toolPalettes.shape) {
                    this.toolState.shape.palette = {
                        colors: [...options.toolPalettes.shape.colors],
                        opacities: [...options.toolPalettes.shape.opacities],
                    };
                }
            }
        }

        this.penEnabled = this.toolState.penEnabled;
        this.straightenLines = this.toolState.pen.straightenLines;
        this.toolPalettes = {
            pen: { colors: [...this.toolState.pen.palette.colors], opacities: [...this.toolState.pen.palette.opacities] },
            highlighter: { colors: [...this.toolState.highlighter.palette.colors], opacities: [...this.toolState.highlighter.palette.opacities] },
            shape: { colors: [...this.toolState.shape.palette.colors], opacities: [...this.toolState.shape.palette.opacities] },
        };

        this.style = {
            color: this.toolState.pen.color,
            width: this.toolState.pen.width,
            opacity: this.toolState.pen.opacity,
            pattern: this.toolState.pen.pattern,
            lineCap: 'round',
        };
        this.previousPenColor = this.toolState.pen.color;

        this.applyWorkspaceToolState(this.toolState, false);

        const context = this.canvas.getContext('2d', { alpha: true, desynchronized: true });
        if (!context) throw new Error('Canvas 2D is unavailable in this Obsidian WebView.');
        this.context = context;

        const dryContext = this.dryCanvas.getContext('2d', { alpha: true, desynchronized: true });
        if (!dryContext) throw new Error('Canvas 2D is unavailable in this Obsidian WebView.');
        this.dryContext = dryContext;

        const highlighterDryContext = this.highlighterDryCanvas.getContext('2d', { alpha: true, desynchronized: true });
        if (!highlighterDryContext) throw new Error('Canvas 2D is unavailable in this Obsidian WebView.');
        this.highlighterDryContext = highlighterDryContext;

        this.originalScrollerPosition = scroller.style.position;
        this.originalScrollerOverflow = scroller.style.overflow;
        this.originalScrollerUserSelect = scroller.style.userSelect;
        if (getComputedStyle(scroller).position === 'static') scroller.style.position = 'relative';

        this.layer.className = 'apolo-canvas-layer';
        this.updateLayerPointerEvents();

        this.canvas.className = 'apolo-canvas-surface apolo-canvas-wet';
        this.dryCanvas.className = 'apolo-canvas-surface apolo-canvas-dry';
        this.highlighterDryCanvas.className = 'apolo-canvas-surface apolo-canvas-highlighter apolo-canvas-dry';
        this.layer.append(this.highlighterDryCanvas, this.dryCanvas, this.canvas);
        scroller.appendChild(this.layer);

        // Mount decoupled UI components if not readonly
        if (!this.options.readonly) {
            this.mountUiRoot();

            this.toast = new Toast(this.uiRoot);
            this.initToolbar();
            this.initEstuche();
            this.initLassoMenu();
            this.initZoomPill();
            this.initBoxMenu();

            this.showSpenDebugHud = Boolean(options.showSpenDebugHud);
            if (this.showSpenDebugHud) {
                this.ensureDebugHud();
            }

            this.scroller.addEventListener('pointerdown', this.onCanvasPointerDownHandleCheck, { capture: true, passive: false });
            this.scroller.addEventListener('touchstart', this.onCanvasTouchStartHandleCheck, { capture: true, passive: false });
            this.canvas.addEventListener('pointerdown', this.onCanvasPointerDownHandleCheck, { capture: true, passive: false });
            this.canvas.addEventListener('touchstart', this.onCanvasTouchStartHandleCheck, { capture: true, passive: false });
            this.scroller.addEventListener('pointermove', this.onPointerMove, { capture: true, passive: false });
            this.canvas.addEventListener('pointermove', this.onPointerMove, { capture: true, passive: false });
            this.scroller.addEventListener('pointerup', this.onPointerUp, { capture: true, passive: false });
            this.canvas.addEventListener('pointerup', this.onPointerUp, { capture: true, passive: false });
            this.scroller.addEventListener('pointercancel', this.onPointerCancel, { capture: true, passive: false });
            this.canvas.addEventListener('pointercancel', this.onPointerCancel, { capture: true, passive: false });
            this.scroller.addEventListener('pointerleave', this.onPointerLeave, { capture: true, passive: false });
            this.canvas.addEventListener('pointerleave', this.onPointerLeave, { capture: true, passive: false });
            this.canvas.addEventListener('lostpointercapture', this.onLostPointerCapture);
            this.scroller.addEventListener('contextmenu', this.onCanvasContextMenu);
            this.canvas.addEventListener('contextmenu', this.onCanvasContextMenu);

            this.input = new InputManager(this.canvas, {
                palmRejectionCooldownMs: options.palmRejectionCooldownMs,
                enableMouseDrawing: options.enableMouseDrawing,
                shouldAcceptPointer: (event) => this.shouldAcceptDrawingPointer(event),
                onStrokeStart: (point, barrel, rawEvent) => this.begin(point, barrel, rawEvent),
                onStrokeMove: (points, barrel, rawEvent) => this.move(points, barrel, rawEvent),
                onStrokeEnd: (point, barrel, rawEvent) => this.end(point, barrel, rawEvent.timeStamp, rawEvent),
                onStrokeCancel: () => this.cancel(),
                onNonDrawingPointerDown: (event) => {
                    if (this.penEnabled) return;
                    if (this.activeHandleDrag) return;
                    if (this.input?.shouldRejectTouch() || this.input?.isPalmRejected()) return;
                    if (this.input?.isPointerRejected(event.pointerId)) return;
                    if (isScreenPointForbidden(event.clientX, event.clientY)) return;
                    if (this.isAnyMenuOpen()) return;
                    this.focusEditorAt(event.clientX, event.clientY);
                },
                onHover: (event) => this.updateCursor(event),
                onPointerLeave: () => this.resetCursor(),
                onPenHoverOrContact: () => this.cancelSingleFingerTouch(),
            });

            window.addEventListener('pointermove', this.onWindowPointerMoveHandleDrag, { passive: false });
            window.addEventListener('pointerup', this.onWindowPointerUpHandleDrag, { passive: false });
            window.addEventListener('pointercancel', this.onWindowPointerUpHandleDrag, { passive: false });
            window.addEventListener('pointerup', this.onPointerUp, { passive: false });
            window.addEventListener('pointercancel', this.onPointerCancel, { passive: false });

            this.canvas.addEventListener('pointerdown', this.onTouchDown, { passive: false });
            this.canvas.addEventListener('pointermove', this.onTouchMove, { passive: false });
            this.canvas.addEventListener('pointerup', this.onTouchEnd, { passive: false });
            this.canvas.addEventListener('pointercancel', this.onTouchEnd, { passive: false });
            this.canvas.addEventListener('dblclick', this.onCanvasDblClick);
            this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
            window.addEventListener('pointerdown', this.onDocumentPointerDown, { capture: true });
            window.addEventListener('touchstart', this.onDocumentTouchStart, { capture: true });
            window.addEventListener('keydown', this.onDocumentKeyDown);
            window.addEventListener('keyup', this.onDocumentKeyUp);
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
            this.renderDirty = true;
            this.schedulePaint();
            this.lassoMenu?.updateViewport(this.zoom, this.currentScrollLeft, this.currentScrollTop);
        };

        scroller.addEventListener('scroll', this.scrollHandler, { passive: true });
        window.addEventListener('scroll', this.scrollHandler, { capture: true, passive: true });

        this.resizeObserver = new ResizeObserver(() => {
            this.strokeCache.clear();
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
            if (this.estuche?.isOpen()) {
                this.estuche.position();
            }
            this.lassoMenu?.updateViewport(this.zoom, this.currentScrollLeft, this.currentScrollTop);
        });
        this.resizeObserver.observe(scroller);

        this.sizerObserver = new ResizeObserver(() => {
            this.syncBoxElements();
            if (this.zoom > 1.0) {
                this.applyContentZoom();
            }
            this.renderDirty = true;
            this.schedulePaint();
        });
        this.observeSizer();

        this.syncBoxElements();

        this.rebuildIndex();
        this.positionLayer();
        this.resize();
        this.paint();

        if (this.options.readonly) {
            this.syncPreviewSpacing();
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

    private mountUiRoot(): void {
        if (this.options.readonly) return;
        this.uiRoot.className = 'apolo-ui';
        if (typeof document !== 'undefined' && document.body) {
            const existingRoots = document.body.querySelectorAll(':scope > .apolo-ui');
            for (let i = 0; i < existingRoots.length; i++) {
                const node = existingRoots[i];
                if (node !== this.uiRoot) {
                    node.remove();
                }
            }
            if (!this.uiRoot.parentElement) {
                document.body.appendChild(this.uiRoot);
            }
        }
    }

    private isAnyMenuOpen(): boolean {
        return Boolean(
            this.estuche?.isOpen() ||
            this.boxMenu?.isOpen() ||
            this.lassoMenu?.isOpen()
        );
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
            toolPalettes: this.toolPalettes,
            snapGrid: this.snapGrid,
            canUndo: this.history.length > 0,
            canRedo: this.future.length > 0,
            eraserRadius: this.eraserRadius,
            eraserMode: this.eraserMode,
            onCycleFavorite: (_tool) => {
                this.cycleActiveToolFavorite();
            },
            onToggleEstucheFavorites: (tool) => {
                this.toggleEstucheFavorites(tool);
            },
            onSlotChange: (slot) => {
                this.toolbarSlot = slot;
                this.estuche?.updateState({ slot });
                this.options.onToolbarSlotChange?.(slot);
            },
            onToggleKeyboardMode: () => {
                this.setPenEnabled(!this.penEnabled);
            },
            onSelectTool: (tool) => {
                this.estuche?.close();
                this.setTool(tool);
            },
            onToggleEraserMode: () => {
                this.toggleEraserMode();
            },
            onToggleEstuche: (tool) => {
                if (this.estuche?.isOpen()) {
                    this.estuche.close();
                } else {
                    this.estuche?.open(this.buildEstucheState(tool, false), this.toolbar?.getToolButton(tool));
                }
            },
            onUndo: () => this.performUndo(),
            onRedo: () => this.performRedo(),
            onSelectFavorite: (index) => this.selectColorSlot(index),
            onChangeColor: (color) => this.setInkColor(color),
            onUpdatePaletteColor: (toolKey, slotIdx, newColor, opacity) => {
                this.updateToolPaletteColor(toolKey, slotIdx, newColor, opacity);
            },
            onSelectThickness: (preset) => this.applyThicknessPreset(preset),
            onToggleSnapGrid: () => {
                this.snapGrid = !this.snapGrid;
                this.toolbar?.setSnapGrid(this.snapGrid);
                this.estuche?.updateState({ snapGrid: this.snapGrid });
                this.toast?.show(this.snapGrid ? 'Cuadrícula magnética: Activada' : 'Cuadrícula magnética: Desactivada');
                this.syncBoxElements();
                this.renderDirty = true;
                this.schedulePaint();
            },
            onInsertCanvas: () => {
                void this.insertCanvas();
            },
        }, this.uiRoot);
    }

    private buildEstucheState(tool: ToolType = this.tool, showingFavorites?: boolean): any {
        const isFavTool = tool === 'pen' || tool === 'highlighter' || tool === 'shape';
        return {
            tool,
            slot: this.toolbarSlot,
            color: this.style.color,
            width: this.style.width,
            profileId: this.penProfileId,
            smoothing: this.smoothing,
            pressureSensitivity: this.pressureSensitivity,
            opacity: isFavTool && (this.toolState as any)[tool]?.opacity !== undefined ? (this.toolState as any)[tool].opacity : this.style.opacity,
            lineStyle: this.style.pattern,
            pattern: this.style.pattern,
            favorites: isFavTool ? this.getToolFavorites(tool) : this.favorites,
            isCurrentFavorite: isFavTool ? this.isCurrentToolFavorited() : false,
            ...(showingFavorites !== undefined ? { showingFavorites } : {}),
            strokeFavoriteProfiles: this.toolState.strokeFavoriteProfiles,
            activeStrokeProfileId: this.toolState.activeStrokeProfileId,
            shapeFavoriteProfiles: this.toolState.shapeFavoriteProfiles,
            activeShapeProfileId: this.toolState.activeShapeProfileId,
            syncFavoriteProfiles: this.toolState.syncFavoriteProfiles,
            eraserMode: this.eraserMode,
            eraserRadius: this.eraserRadius,
            scribbleToErase: this.scribbleToErase,
            lassoMode: this.lassoMode,
            shapeType: this.shapeType,
            snapGrid: this.snapGrid,
            straightenLines: this.straightenLines,
            onlyHighlighter: this.toolState.eraser.onlyHighlighter,
            regularize: this.toolState.shape.regularize,
            fillEnabled: this.toolState.shape.fillEnabled,
            fillColor: this.toolState.shape.fillColor,
            fillPattern: this.toolState.shape.fillPattern,
            fillDensity: this.toolState.shape.fillDensity,
            fillOpacity: this.toolState.shape.fillOpacity,
            colorCarousels: this.toolState.colorCarousels,
        };
    }

    private initEstuche(): void {
        this.estuche = new ToolEstuche(
            this.buildEstucheState(this.tool),
            {
                onSelectProfile: (profileId) => this.applyPenProfile(profileId),
                onChangeColor: (color) => this.setInkColor(color),
                onUpdateColorCarousels: (carousels) => {
                    this.toolState.colorCarousels = carousels;
                    this.notifyToolStateChange();
                },
                onChangeWidth: (width) => this.setWidth(width),
                onChangeOpacity: (opacity) => {
                    const norm = opacity > 1 ? opacity / 100 : Math.max(0, Math.min(1, opacity));
                    this.style.opacity = norm;
                    if (this.tool === 'pen') {
                        this.toolState.pen.opacity = norm;
                    } else if (this.tool === 'highlighter') {
                        this.toolState.highlighter.opacity = norm;
                    } else if (this.tool === 'shape') {
                        this.toolState.shape.opacity = norm;
                    }
                    this.applyStyleToSelectedShapes({ opacity: norm });
                    this.estuche?.updateState({ opacity: norm });
                    this.renderDirty = true;
                    this.schedulePaint();
                    this.notifyToolStateChange();
                },
                onChangeSmoothing: (smoothing) => {
                    this.smoothing = smoothing;
                    this.toolState.pen.smoothing = smoothing;
                    this.syncEstucheFavoriteState();
                    this.notifyToolStateChange();
                },
                onChangePressure: (pressure) => {
                    this.pressureSensitivity = pressure;
                    this.renderDirty = true;
                    this.schedulePaint();
                },
                onChangeLineStyle: (pattern) => {
                    this.style.pattern = pattern;
                    if (this.tool === 'pen') {
                        this.toolState.pen.pattern = pattern;
                    } else if (this.tool === 'highlighter') {
                        this.toolState.highlighter.pattern = pattern;
                    } else if (this.tool === 'shape') {
                        this.toolState.shape.pattern = pattern;
                    }
                    this.applyStyleToSelectedShapes({ pattern });
                    this.estuche?.updateState({ lineStyle: pattern, pattern });
                    this.options.eventBus?.emit('style:changed', { pattern });
                    this.syncEstucheFavoriteState();
                    this.schedulePaint();
                    this.notifyToolStateChange();
                },
                onUseFavorite: (index) => this.applyFavorite(index),
                onSaveFavorite: (index) => this.saveFavoriteAt(index),
                onToggleFavorite: () => this.toggleFavorite(),
                onApplyFavorite: (preset) => this.applyToolFavoritePreset(preset),
                onDeleteFavorite: (presetId) => this.deleteToolFavoritePreset(presetId),
                onReorderFavorites: (fromIndex, toIndex) => this.reorderToolFavorites(fromIndex, toIndex),
                onRenameFavorite: (presetId, newName) => this.renameFavoritePreset(presetId, newName),
                onSwitchProfile: (profileId) => this.switchFavoriteProfile(profileId),
                onCreateProfile: (name) => this.createFavoriteProfile(name),
                onToggleSyncProfiles: (sync) => this.toggleSyncFavoriteProfiles(sync),
                onSelectEraserMode: (mode) => {
                    this.setEraserMode(mode);
                },
                onChangeEraserRadius: (radius) => {
                    this.eraserRadius = radius;
                    this.toolState.eraser.radius = radius;
                    this.toolbar?.setThicknessValues(this.style.width, this.eraserRadius);
                    this.notifyToolStateChange();
                },
                onToggleScribble: (enabled) => {
                    this.scribbleToErase = enabled;
                    this.toolState.eraser.scribbleToErase = enabled;
                    this.notifyToolStateChange();
                },
                onToggleOnlyHighlighter: (enabled) => {
                    this.toolState.eraser.onlyHighlighter = enabled;
                    this.notifyToolStateChange();
                },
                onSelectLassoMode: (mode) => {
                    this.lassoMode = mode;
                    this.toolState.lasso.mode = mode;
                    this.notifyToolStateChange();
                },
                onSelectShapeType: (shapeType) => {
                    this.shapeType = shapeType;
                    this.toolState.shape.shapeType = shapeType;
                    this.toolbar?.setShape(shapeType);
                    this.toolbar?.setTool('shape', shapeType);
                    this.syncEstucheFavoriteState();
                    this.notifyToolStateChange();
                },
                onToggleSnapGrid: (enabled) => {
                    this.snapGrid = enabled;
                    this.toolState.snapGrid = enabled;
                    this.toolbar?.setSnapGrid(enabled);
                    this.renderDirty = true;
                    this.schedulePaint();
                    this.notifyToolStateChange();
                },
                onToggleRegularize: (enabled) => {
                    this.toolState.shape.regularize = enabled;
                    this.estuche?.updateState({ regularize: enabled });
                    const selected = this.selection.filter((el): el is ShapeElement => el.type === 'shape');
                    if (selected.length > 0) {
                        this.recordHistory();
                        for (const s of selected) {
                            s.regularize = enabled;
                            this.strokeCache.delete(s.id);
                        }
                        this.rebuildIndex();
                        this.renderDirty = true;
                        this.schedulePaint();
                        this.persistSoon();
                    }
                    this.syncEstucheFavoriteState();
                    this.notifyToolStateChange();
                },
                onToggleFillEnabled: (enabled) => {
                    this.toolState.shape.fillEnabled = enabled;
                    this.applyStyleToSelectedShapes({ fillEnabled: enabled });
                    this.estuche?.updateState({ fillEnabled: enabled });
                    this.syncEstucheFavoriteState();
                    this.notifyToolStateChange();
                },
                onChangeFillColor: (color) => {
                    this.toolState.shape.fillColor = color;
                    this.applyStyleToSelectedShapes({ fillColor: color });
                    this.estuche?.updateState({ fillColor: color });
                    this.syncEstucheFavoriteState();
                    this.notifyToolStateChange();
                },
                onChangeFillPattern: (pattern) => {
                    this.toolState.shape.fillPattern = pattern;
                    this.applyStyleToSelectedShapes({ fillEnabled: true, fillPattern: pattern });
                    this.estuche?.updateState({ fillPattern: pattern });
                    this.syncEstucheFavoriteState();
                    this.notifyToolStateChange();
                },
                onChangeFillDensity: (density) => {
                    this.toolState.shape.fillDensity = density;
                    this.applyStyleToSelectedShapes({ fillDensity: density });
                    this.estuche?.updateState({ fillDensity: density });
                    this.syncEstucheFavoriteState();
                    this.notifyToolStateChange();
                },
                onChangeFillOpacity: (opacity) => {
                    this.toolState.shape.fillOpacity = opacity;
                    this.applyStyleToSelectedShapes({ fillOpacity: opacity });
                    this.estuche?.updateState({ fillOpacity: opacity });
                    this.syncEstucheFavoriteState();
                    this.notifyToolStateChange();
                },
                onToggleStraighten: (enabled) => {
                    this.setStraightenLines(enabled);
                    this.options.onToggleStraighten?.(enabled);
                },
                onClose: () => undefined,
            },
            this.uiRoot,
            this.popoverController,
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
                void import('../ui/LinkSuggestModal.ts').then(({ LinkSuggestModal }) => {
                    new LinkSuggestModal(this.options.app, (target) => {
                        this.linkSelection(target);
                    }).open();
                });
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
        }, this.uiRoot);
    }


    private initZoomPill(): void {
        this.zoomPill = new ZoomPill({
            onZoomIn: () => this.stepZoom(1),
            onZoomOut: () => this.stepZoom(-1),
            onZoomFit: () => this.resetView(),
        }, this.uiRoot);
    }

    private initBoxMenu(): void {
        this.boxMenu = new BoxMenu({
            onSetGridStyle: (boxId, style) => {
                this.updateBoxProperty(boxId, 'gridStyle', style);
                this.toast?.show(`Rejilla: ${style === 'dots' ? 'Puntos' : style === 'grid' ? 'Cuadrícula' : style === 'ruled' ? 'Rayas' : 'En blanco'}`);
            },
            onSetBgTheme: (boxId, theme) => {
                this.updateBoxProperty(boxId, 'bgTheme', theme);
                this.toast?.show('Fondo actualizado');
            },
            onSetAccentColor: (boxId, accent) => {
                this.updateBoxProperty(boxId, 'accentColor', accent);
                this.toast?.show('Acento lateral actualizado');
            },
            onSetGridDensity: (boxId, density) => {
                this.updateBoxProperty(boxId, 'gridDensity', density);
                const { width: contentWidth } = this.getContentGeometry();
                if (contentWidth > 0 && density > 0) {
                    const stepPx = Math.round((contentWidth / density) * 100) / 100;
                    for (const el of this.findSpaceElementsById(boxId)) {
                        el.style.setProperty('--apolo-grid-step', `${stepPx}px`);
                    }
                }
                this.toast?.show(`Espaciado: ${density === 40 ? 'Fino' : density === 32 ? 'Normal' : 'Amplio'}`);
            },
            onToggleBorderOutline: (boxId, outline) => {
                this.updateBoxProperty(boxId, 'borderOutline', outline);
                this.toast?.show(outline ? 'Contorno 1px activado' : 'Contorno 1px desactivado');
            },
            onFitHeight: (boxId) => {
                this.fitBoxHeightToContent(boxId);
            },
            onClearContent: (boxId) => {
                this.clearBoxContent(boxId);
            },
            onDeleteBox: (boxId) => {
                this.deleteBox(boxId);
            },
            onExportSvg: () => {
                this.toast?.show('Exportación SVGcompanion disponible en paso d');
            },
        }, this.uiRoot, this.popoverController);
    }

    private findSpaceElementsById(boxId: string): HTMLElement[] {
        if (!boxId || typeof this.scroller?.querySelectorAll !== 'function') return [];
        const candidates = this.scroller.querySelectorAll<HTMLElement>(
            '.apolo-space, .apolo-space-block, .apolo-space-widget, [data-apolo-space], [data-apolo-space-id]'
        );
        const matches: HTMLElement[] = [];
        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            const id = el.dataset?.apoloSpace || el.dataset?.apoloSpaceId || el.getAttribute?.('data-apolo-space') || el.getAttribute?.('data-apolo-space-id');
            if (id === boxId) {
                matches.push(el);
            }
        }
        return matches;
    }

    private findSpaceElementById(boxId: string): HTMLElement | null {
        const list = this.findSpaceElementsById(boxId);
        return list.length > 0 ? list[0] : null;
    }

    private updateBoxProperty<K extends keyof BoxMetadata>(boxId: string, key: K, value: BoxMetadata[K]): void {
        if (!this.document.boxes) this.document.boxes = {};
        if (!this.document.boxes[boxId]) {
            const h = BoxRegistry.getHeight(boxId) ?? 120;
            this.document.boxes[boxId] = { height: h, [key]: value };
        } else {
            this.document.boxes[boxId][key] = value;
        }

        if (key === 'gridStyle') {
            BoxRegistry.setGridStyle(boxId, value as BoxGridStyle);
        } else if (key === 'bgTheme') {
            BoxRegistry.setBgTheme(boxId, value as BoxBgTheme);
        } else if (key === 'accentColor') {
            BoxRegistry.setAccentColor(boxId, value as BoxAccentColor);
        } else if (key === 'gridDensity') {
            BoxRegistry.setGridDensity(boxId, value as number);
        } else if (key === 'borderOutline') {
            BoxRegistry.setBorderOutline(boxId, !!value);
        }

        for (const el of this.findSpaceElementsById(boxId)) {
            if (key === 'gridStyle') {
                el.dataset.apoloGridStyle = String(value);
                el.dataset.apoloGrid = value !== 'none' ? 'true' : 'false';
            } else if (key === 'bgTheme') {
                el.dataset.apoloBgTheme = String(value);
                const customBg = BoxRegistry.getCustomBgColor(boxId);
                if (customBg) {
                    el.style.setProperty('background-color', customBg, 'important');
                } else if (value === 'pitch-black') {
                    el.style.setProperty('background-color', '#000000', 'important');
                } else if (value === 'graphite') {
                    el.style.setProperty('background-color', '#27272a', 'important');
                } else if (value === 'transparent') {
                    el.style.setProperty('background-color', 'transparent', 'important');
                } else {
                    el.style.removeProperty('background-color');
                }
            } else if (key === 'accentColor') {
                el.dataset.apoloAccent = String(value);
            } else if (key === 'borderOutline') {
                el.dataset.apoloBorder = value ? 'true' : 'false';
            } else if (key === 'gridDensity') {
                el.dataset.apoloGridDensity = String(value);
                const { width: contentWidth } = this.getContentGeometry();
                const boxWidth = el.clientWidth || el.offsetWidth || contentWidth || 800;
                const density = Number(value) || 32;
                if (boxWidth > 0 && density > 0) {
                    const stepPx = Math.round((boxWidth / density) * 100) / 100;
                    el.style.setProperty('--apolo-grid-step', `${stepPx}px`);
                }
            } else if (key === 'customBgColor') {
                if (value) {
                    el.style.setProperty('background-color', String(value), 'important');
                } else {
                    el.style.removeProperty('background-color');
                }
            }
        }

        this.persistSoon();
    }

    public updateDefaultBoxBgTheme(theme: BoxBgTheme): void {
        this.options.defaultBoxBgTheme = theme;
        if (this.document.boxes) {
            for (const boxId of Object.keys(this.document.boxes)) {
                this.document.boxes[boxId].bgTheme = theme;
            }
        }
        this.syncBoxElements();
        this.persistSoon();
    }

    public setDefaultBoxAccentColor(accent: BoxAccentColor): void {
        this.options.defaultBoxAccentColor = accent;
    }

    public setPalmRejectionCooldown(ms: number): void {
        this.options.palmRejectionCooldownMs = ms;
        this.input?.setPalmRejectionCooldown(ms);
    }

    private getBoxMinimumHeight(boxId: string): number {
        const spaceBlockId = `space:${boxId}`;
        const geom = this.getElementAnchorGeometry(spaceBlockId);

        let maxDocY = 0;
        let hasContent = false;
        for (const el of this.document.elements) {
            if (el.blockId === spaceBlockId) {
                hasContent = true;
                const b = this.getElementDocBounds(el);
                if (b.maxY > maxDocY) maxDocY = b.maxY;
            }
        }

        if (hasContent && maxDocY > geom.originY) {
            const inkHeight = maxDocY - geom.originY;
            return Math.max(120, Math.ceil(inkHeight + 24));
        }
        return 120;
    }

    private clearBoxContent(boxId: string): void {
        const spaceBlockId = `space:${boxId}`;
        const prevCount = this.document.elements.length;
        this.recordHistory();
        this.document.elements = this.document.elements.filter(el => el.blockId !== spaceBlockId);
        const removed = prevCount - this.document.elements.length;
        this.rebuildIndex();
        this.persistSoon();
        this.renderDirty = true;
        this.schedulePaint();
        this.toast?.show(`Espacio limpiado (${removed} trazo/s eliminado/s)`);
    }

    private openBoxMenuFor(boxId: string, anchorEl: HTMLElement): void {
        const anchorRect = anchorEl.getBoundingClientRect();
        const meta = this.document.boxes?.[boxId];
        const state: BoxMenuState = {
            gridStyle: meta?.gridStyle ?? BoxRegistry.getGridStyle(boxId),
            bgTheme: meta?.bgTheme ?? BoxRegistry.getBgTheme(boxId),
            customBgColor: meta?.customBgColor ?? BoxRegistry.getCustomBgColor(boxId),
            accentColor: meta?.accentColor ?? BoxRegistry.getAccentColor(boxId),
            gridDensity: meta?.gridDensity ?? BoxRegistry.getGridDensity(boxId),
            borderOutline: meta?.borderOutline ?? BoxRegistry.isBorderOutline(boxId),
        };
        this.boxMenu?.show(boxId, anchorRect, state);
    }

    private fitBoxHeightToContent(boxId: string): void {
        this.recordHistory();
        const spaceBlockId = `space:${boxId}`;
        const geom = this.getElementAnchorGeometry(spaceBlockId);

        let maxDocY = 0;
        let hasContent = false;
        for (const el of this.document.elements) {
            if (el.blockId === spaceBlockId) {
                hasContent = true;
                const b = this.getElementDocBounds(el);
                if (b.maxY > maxDocY) maxDocY = b.maxY;
            }
        }

        let newHeight = 120;
        if (hasContent && maxDocY > geom.originY) {
            const inkHeight = maxDocY - geom.originY;
            newHeight = Math.max(120, Math.ceil(inkHeight + 36));
        }

        this.applyBoxHeight(boxId, newHeight);
        this.queueSpaceMutation({ type: 'update', id: boxId, height: newHeight });
        this.persistSoon();
        this.toast?.show(`Altura ajustada: ${newHeight} px`);
    }

    private deleteBox(boxId: string): void {
        this.queueSpaceMutation({ type: 'delete', id: boxId });
        for (const el of this.findSpaceElementsById(boxId)) {
            el.remove();
        }
        this.requestCmMeasure();
        this.persistSoon();
        this.renderDirty = true;
        this.schedulePaint();
        this.toast?.show('Espacio eliminado');
    }

    private applyBoxHeight(boxId: string, newHeight: number): void {
        const clampedHeight = Math.max(120, Math.min(3000, newHeight));
        BoxRegistry.setHeight(boxId, clampedHeight);
        if (!this.document.boxes) this.document.boxes = {};
        if (!this.document.boxes[boxId]) {
            this.document.boxes[boxId] = { height: clampedHeight, gridVisible: true };
        } else {
            this.document.boxes[boxId].height = clampedHeight;
        }

        for (const el of this.findSpaceElementsById(boxId)) {
            el.style.setProperty('height', `${clampedHeight}px`, 'important');
            el.style.setProperty('min-height', `${clampedHeight}px`, 'important');
            el.dataset.apoloHeight = String(clampedHeight);
            const embedParent = el.closest<HTMLElement>('.cm-embed-block');
            if (embedParent) {
                embedParent.style.setProperty('min-height', `${clampedHeight}px`, 'important');
            }
        }

        this.requestCmMeasure();
        this.renderDirty = true;
        this.schedulePaint();
    }

    private requestCmMeasure(): void {
        if (this.editor) {
            const cm = (this.editor as any)?.cm as EditorView | undefined;
            cm?.requestMeasure();
        }
    }

    private findBoxOptionsButtonAt(clientX: number, clientY: number): HTMLElement | null {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
        if (typeof document !== 'undefined' && typeof document.elementsFromPoint === 'function') {
            const elements = document.elementsFromPoint(clientX, clientY);
            for (const el of elements) {
                if (el.classList?.contains('apolo-box-options-btn')) {
                    return el as HTMLElement;
                }
                const closest = (el as Element).closest?.('.apolo-box-options-btn');
                if (closest) {
                    return closest as HTMLElement;
                }
            }
        }
        if (typeof this.scroller?.querySelectorAll === 'function') {
            const buttons = this.scroller.querySelectorAll<HTMLElement>('.apolo-box-options-btn');
            const tolerance = 8;
            for (let i = 0; i < buttons.length; i++) {
                const btn = buttons[i];
                const rect = btn.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) continue;
                if (
                    clientX >= rect.left - tolerance &&
                    clientX <= rect.right + tolerance &&
                    clientY >= rect.top - tolerance &&
                    clientY <= rect.bottom + tolerance
                ) {
                    return btn;
                }
            }
        }
        return null;
    }

    private findBoxHandleAt(clientX: number, clientY: number): HTMLElement | null {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
        if (typeof document !== 'undefined' && typeof document.elementsFromPoint === 'function') {
            const elements = document.elementsFromPoint(clientX, clientY);
            for (const el of elements) {
                if (el.classList?.contains('apolo-box-handle')) {
                    return el as HTMLElement;
                }
                const closest = (el as Element).closest?.('.apolo-box-handle');
                if (closest) {
                    return closest as HTMLElement;
                }
            }
        }
        if (typeof this.scroller?.querySelectorAll === 'function') {
            const handles = this.scroller.querySelectorAll<HTMLElement>('.apolo-box-handle');
            const tolerance = 6;
            for (let i = 0; i < handles.length; i++) {
                const handle = handles[i];
                const rect = handle.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) continue;
                if (
                    clientX >= rect.left - tolerance &&
                    clientX <= rect.right + tolerance &&
                    clientY >= rect.top - tolerance &&
                    clientY <= rect.bottom + tolerance
                ) {
                    return handle;
                }
            }
        }
        return null;
    }

    private toggleBoxMenuFromButton(actualBtn: HTMLElement): void {
        const now = Date.now();
        if (now - this.lastBoxOptionsTapAt < 300) {
            return;
        }
        this.lastBoxOptionsTapAt = now;
        const boxId = actualBtn.dataset.apoloBoxId
            || actualBtn.closest('.apolo-space-block')?.getAttribute('data-apolo-space-id')
            || actualBtn.closest('.apolo-space-block')?.getAttribute('data-apolo-space')
            || '';
        if (boxId) {
            if (this.boxMenu?.isOpen() && this.boxMenu.boxId === boxId) {
                this.boxMenu.hide();
            } else {
                this.openBoxMenuFor(boxId, actualBtn);
            }
        }
    }

    private readonly onCanvasContextMenu = (event: MouseEvent | PointerEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();

        // Strictly reject non-pen pointers (mouse, touch)
        if ('pointerType' in event && (event as any).pointerType && (event as any).pointerType !== 'pen') {
            return;
        }

        // Only confirmed physical barrel button signals are allowed to cancel strokes or latch barrel state
        const isConfirmedBarrel = this.penBarrelPressed || isConfirmedBarrelPress(event as any) || isStylusBarrelButton(event);
        if (!isConfirmedBarrel) {
            this.updateDebugHud(event, 'contextmenu-unconfirmed-ignored');
            return;
        }

        // If the stylus has already demonstrated deliberate drawing movement (>8px from pointerdown),
        // do NOT abort or discard the active stroke on stray contextmenu signals.
        const hasMoved = hasDeliberateStylusMovement(
            this.pointerDownStartPos,
            { x: event.clientX, y: event.clientY },
            8,
        );
        if (hasMoved) {
            this.updateDebugHud(event, 'contextmenu-ignore-moving-stroke');
            return;
        }

        // Confirmed stationary barrel press: cancel nascent stroke if drawing
        if (this.isDrawing) {
            this.cancelActiveStroke();
        }

        this.isPenTipDown = false;
        this.penBarrelPressed = true;
        this.updateDebugHud(event, 'barrel-contextmenu');
    };

    private isPenBarrelEvent(e: PointerEvent | MouseEvent): boolean {
        return isConfirmedBarrelPress(e as PointerEvent) || isStylusBarrelButton(e);
    }

    private readonly onCanvasPointerDownHandleCheck = (event: PointerEvent): void => {
        if (event.pointerType === 'pen') {
            this.lastPenEventTime = performance.now();
            this.isPenTipDown = true;
            if (isConfirmedBarrelPress(event) || this.isPenBarrelEvent(event)) {
                this.penBarrelPressed = true;
                this.handledBoxEvents.add(event);
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                this.toggleEstucheFavorites();
                return;
            } else {
                this.penBarrelPressed = false;
            }
        }
        this.lastPointerDownTime = performance.now();
        this.pointerDownStartPos = { x: event.clientX, y: event.clientY };
        this.updateDebugHud(event);

        if (this.handledBoxEvents.has(event)) return;

        const elements = (typeof document !== 'undefined' && typeof document.elementsFromPoint === 'function')
            ? document.elementsFromPoint(event.clientX, event.clientY)
            : [];

        // 1. Check if tap is on top-left 3-dots options button
        const optionsBtn = this.findBoxOptionsButtonAt(event.clientX, event.clientY);

        // Instant menu dismissal if box menu is open and tap is outside it
        if (this.boxMenu?.isOpen()) {
            const isInsideMenu = (event.target instanceof Node && this.boxMenu.container.contains(event.target))
                || elements.some(el => this.boxMenu?.container.contains(el));
            if (!isInsideMenu && !optionsBtn) {
                this.boxMenu.hide();
            }
        }

        if (optionsBtn) {
            this.handledBoxEvents.add(event);
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            this.toggleBoxMenuFromButton(optionsBtn);
            return;
        }

        // 2. Check if tap is on bottom drag handle
        const handleEl = this.findBoxHandleAt(event.clientX, event.clientY);

        if (handleEl) {
            this.handledBoxEvents.add(event);
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            this.startHandleDrag(event, handleEl);
        }
    };

    private readonly onCanvasTouchStartHandleCheck = (event: TouchEvent): void => {
        if (this.handledBoxEvents.has(event)) return;
        const touch = event.touches?.[0] ?? event.changedTouches?.[0];
        if (!touch) return;

        const optionsBtn = this.findBoxOptionsButtonAt(touch.clientX, touch.clientY);
        if (optionsBtn) {
            this.handledBoxEvents.add(event);
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            this.toggleBoxMenuFromButton(optionsBtn);
            return;
        }

        const handleEl = this.findBoxHandleAt(touch.clientX, touch.clientY);
        if (handleEl) {
            this.handledBoxEvents.add(event);
            event.stopPropagation();
        }
    };

    private readonly onPointerMove = (e: PointerEvent): void => {
        if (e.pointerType === 'pen') {
            this.lastPenEventTime = performance.now();

            // Stylus barrel detection in hover (Windows Ink / W3C reports buttons & 32 / button 5;
            // Android / DeX reports buttons & 2 / button 2).
            const barrelHoverActive = !this.isPenTipDown && !this.isDrawing && isStylusHoverBarrel(e);

            if (barrelHoverActive) {
                if (!this.penBarrelPressed) {
                    this.penBarrelPressed = true;
                }
                this.updateDebugHud(e, 'hover-barrel');
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();
                return;
            }

            if (this.penBarrelPressed && !barrelHoverActive) {
                if (e.buttons === 0 || !this.isPenBarrelEvent(e)) {
                    this.penBarrelPressed = false;
                }
            }
        }

        this.updateDebugHud(e);

        if (!this.isDrawing) {
            return;
        }
    };

    private readonly onPointerUp = (e: PointerEvent): void => {
        if (e.pointerType === 'pen') {
            this.isPenTipDown = false;
            this.lastPenEventTime = performance.now();
            if (!this.isPenBarrelEvent(e) || e.buttons === 0) this.penBarrelPressed = false;
        } else if (e.buttons === 0) {
            this.penBarrelPressed = false;
        }
        this.updateDebugHud(e);
    };

    private readonly onPointerCancel = (e: PointerEvent): void => {
        if (e.pointerType === 'pen') {
            this.isPenTipDown = false;
            this.lastPenEventTime = performance.now();
        }
        this.penBarrelPressed = false;
        this.updateDebugHud(e);
    };

    private readonly onPointerLeave = this.onPointerCancel;

    private readonly onLostPointerCapture = (e: PointerEvent): void => {
        if (e.pointerType === 'pen') this.isPenTipDown = false;
        this.updateDebugHud(e);
    };

    private readonly onPointerDown = this.onCanvasPointerDownHandleCheck;

    public cancelActiveStroke(): void {
        this.input?.cancelActiveDrawing();
        this.cancel();
    }

    public setSpenDebugHud(enabled: boolean): void {
        this.showSpenDebugHud = enabled;
        if (!enabled) {
            this.debugInputHudEl?.remove();
            this.debugInputHudEl = null;
        } else {
            this.ensureDebugHud();
        }
    }

    public toggleSpenDebugHud(): boolean {
        this.setSpenDebugHud(!this.showSpenDebugHud);
        return this.showSpenDebugHud;
    }

    private ensureDebugHud(): void {
        if (this.debugInputHudEl) return;
        const hud = document.createElement('div');
        hud.className = 'apolo-spen-debug-hud';
        hud.style.cssText = 'position:absolute;bottom:12px;left:12px;z-index:1000;pointer-events:none;font:11px/1.3 monospace;white-space:pre;background:rgba(0,0,0,0.75);color:#00ff66;padding:6px 10px;border-radius:6px;border:1px solid rgba(0,255,102,0.4)';
        hud.textContent = 'S-Pen HUD Activo — Esperando eventos...';
        this.uiRoot.appendChild(hud);
        this.debugInputHudEl = hud;
    }

    private updateDebugHud(e: PointerEvent | MouseEvent, context?: string): void {
        if (!this.showSpenDebugHud) return;
        this.ensureDebugHud();
        if (!this.debugInputHudEl) return;
        const pEvent = e as PointerEvent;
        const press = typeof pEvent.pressure === 'number' ? pEvent.pressure.toFixed(2) : '0.00';
        const line = `[${e.type}${context ? ` (${context})` : ''}] ptr=${pEvent.pointerType ?? 'mouse'} btn=${e.button ?? -1} btns=${e.buttons ?? 0} p=${press} tipDown=${this.isPenTipDown} barrel=${this.penBarrelPressed}`;
        this.debugHudLogs.push(line);
        if (this.debugHudLogs.length > 4) this.debugHudLogs.shift();
        this.debugInputHudEl.textContent = this.debugHudLogs.join('\n');
    }

    private startHandleDrag(event: PointerEvent, handleEl: HTMLElement): void {
        const boxId = handleEl.dataset.apoloHandleId
            || handleEl.closest('.apolo-space-block')?.getAttribute('data-apolo-space-id')
            || handleEl.closest('.apolo-space-block')?.getAttribute('data-apolo-space')
            || '';
        if (!boxId) return;

        this.recordHistory();

        const spaceEl = handleEl.closest<HTMLElement>('.apolo-space, .apolo-space-block');
        if (spaceEl) {
            spaceEl.classList.add('is-resizing');
        }

        handleEl.classList.add('is-dragging');
        const currentHeight = BoxRegistry.getHeight(boxId)
            ?? (handleEl.parentElement ? handleEl.parentElement.offsetHeight : 120);

        const minAllowedHeight = this.getBoxMinimumHeight(boxId);

        this.activeHandleDrag = {
            boxId,
            startY: event.clientY,
            initialHeight: currentHeight,
            minAllowedHeight,
            hasMoved: false,
            pointerId: event.pointerId,
            handleEl,
            spaceEl: spaceEl ?? null,
        };

        try {
            this.canvas.setPointerCapture(event.pointerId);
        } catch { /* best effort */ }
    }

    private readonly onWindowPointerMoveHandleDrag = (event: PointerEvent): void => {
        if (!this.activeHandleDrag || event.pointerId !== this.activeHandleDrag.pointerId) return;
        const deltaY = (event.clientY - this.activeHandleDrag.startY) / this.zoom;
        if (Math.abs(deltaY) > 3) {
            this.activeHandleDrag.hasMoved = true;
        }

        if (this.activeHandleDrag.hasMoved) {
            event.preventDefault();
            const minH = this.activeHandleDrag.minAllowedHeight;
            const newHeight = Math.max(minH, Math.min(3000, Math.round(this.activeHandleDrag.initialHeight + deltaY)));
            this.applyBoxHeight(this.activeHandleDrag.boxId, newHeight);
        }
    };

    private readonly onWindowPointerUpHandleDrag = (event: PointerEvent): void => {
        if (!this.activeHandleDrag || event.pointerId !== this.activeHandleDrag.pointerId) return;
        const drag = this.activeHandleDrag;
        this.activeHandleDrag = null;
        drag.handleEl.classList.remove('is-dragging');
        if (drag.spaceEl) {
            drag.spaceEl.classList.remove('is-resizing');
        }

        try {
            if (this.canvas.hasPointerCapture(event.pointerId)) {
                this.canvas.releasePointerCapture(event.pointerId);
            }
        } catch { /* best effort */ }

        if (drag.hasMoved) {
            // Drag completed: commit mutation and persist
            const finalHeight = BoxRegistry.getHeight(drag.boxId) ?? drag.initialHeight;
            this.queueSpaceMutation({ type: 'update', id: drag.boxId, height: finalHeight });
            this.persistSoon();
        }
        // Notice: bottom handle is strictly for manual drag; no menu popup on tap
    };

    private checkAutoScroll(event: PointerEvent): void {
        const scrollerRect = this.scroller.getBoundingClientRect();
        const bottomThreshold = scrollerRect.bottom - 60;
        const topThreshold = scrollerRect.top + 40;

        if (event.clientY > bottomThreshold) {
            const dist = scrollerRect.bottom - event.clientY;
            const delta = Math.min(20, Math.max(4, Math.round((60 - dist) / 2)));
            this.scroller.scrollTop += delta;
        } else if (event.clientY < topThreshold && this.scroller.scrollTop > 0) {
            const dist = event.clientY - scrollerRect.top;
            const delta = Math.min(20, Math.max(4, Math.round((40 - dist) / 2)));
            this.scroller.scrollTop = Math.max(0, this.scroller.scrollTop - delta);
        }
    }

    private checkAutoGrowth(rawPoints: Point[]): void {
        if (!this.activeAnchor || !this.activeAnchor.blockId.startsWith('space:') || rawPoints.length === 0) return;
        const spaceId = this.activeAnchor.blockId.slice(6);
        const boxEl = this.findSpaceElementById(spaceId);
        if (!boxEl) return;

        const scrollerRect = this.scroller.getBoundingClientRect();
        const boxTop = this.activeBlockTop > 0
            ? this.activeBlockTop
            : (boxEl.getBoundingClientRect().top - scrollerRect.top + this.currentScrollTop) / this.zoom;
        const currentHeight = BoxRegistry.getHeight(spaceId) ?? boxEl.offsetHeight;

        let maxDocY = 0;
        for (let i = 0; i < rawPoints.length; i++) {
            const docY = (rawPoints[i].y + this.currentScrollTop) / this.zoom;
            if (docY > maxDocY) maxDocY = docY;
        }

        const yInBox = maxDocY - boxTop;
        const TRIGGER_MARGIN = 40; // Umbral de anticipación en px antes del fondo

        if (yInBox + TRIGGER_MARGIN > currentHeight) {
            const neededHeight = Math.min(3000, Math.ceil(yInBox + TRIGGER_MARGIN));
            // Apply continuous growth smoothly when needed increment >= 10px
            if (neededHeight > currentHeight + 10) {
                this.applyBoxHeight(spaceId, neededHeight);
            }
        }
    }

    private checkAndFixDuplicateBoxIds(): void {
        if (!this.editor) return;
        const cm = (this.editor as any)?.cm as EditorView | undefined;
        if (!cm || !cm.state || !cm.state.doc) return;
        const doc = cm.state.doc;
        const seenIds = new Set<string>();
        const changes: { from: number; to: number; insert: string }[] = [];

        for (let l = 1; l <= doc.lines; l++) {
            const line = doc.line(l);
            const match = line.text.match(/data-apolo-space(?:-id)?=["']([^"']+)["']/i);
            if (match) {
                const id = match[1];
                if (seenIds.has(id)) {
                    // Duplicate box ID found in editor! Generate clean unique ID
                    const newId = 'c_' + Math.random().toString(36).slice(2, 8);
                    const prevH = BoxRegistry.getHeight(id) ?? 280;
                    BoxRegistry.setHeight(newId, prevH);
                    BoxRegistry.setGridStyle(newId, BoxRegistry.getGridStyle(id));
                    BoxRegistry.setBgTheme(newId, BoxRegistry.getBgTheme(id));
                    BoxRegistry.setAccentColor(newId, BoxRegistry.getAccentColor(id));
                    BoxRegistry.setGridDensity(newId, BoxRegistry.getGridDensity(id));
                    BoxRegistry.setBorderOutline(newId, BoxRegistry.isBorderOutline(id));

                    const newLineText = line.text.replace(match[0], `data-apolo-space="${newId}"`);
                    changes.push({ from: line.from, to: line.to, insert: newLineText });
                    seenIds.add(newId);
                } else {
                    seenIds.add(id);
                }
            }
        }

        if (changes.length > 0) {
            cm.dispatch({
                changes,
                annotations: Transaction.addToHistory.of(false),
            });
            cm.requestMeasure();
        }
    }

    public syncBoxElements(): void {
        this.checkAndFixDuplicateBoxIds();
        const boxEls = this.scroller.querySelectorAll<HTMLElement>(
            '.apolo-space, .apolo-space-block, .apolo-space-widget, [data-apolo-space], [data-apolo-space-id]'
        );
        const isPreview = !!this.options.readonly || !!this.scroller.closest('.markdown-preview-view');
        for (let i = 0; i < boxEls.length; i++) {
            const el = boxEls[i];
            const id = el.dataset.apoloSpace || el.dataset.apoloSpaceId || el.getAttribute('data-apolo-space') || el.getAttribute('data-apolo-space-id');
            if (!id) continue;

            const sidecarH = BoxRegistry.getHeight(id);
            const dataH = el.dataset.h ? parseInt(el.dataset.h, 10) : undefined;
            const h = Math.max(120, sidecarH ?? dataH ?? 120);
            if (BoxRegistry.getHeight(id) === undefined) {
                BoxRegistry.setHeight(id, h);
            }

            el.style.setProperty('height', `${h}px`, 'important');
            el.style.setProperty('min-height', `${h}px`, 'important');
            el.style.setProperty('display', 'block', 'important');
            el.style.setProperty('width', '100%', 'important');
            el.dataset.apoloHeight = String(h);
            el.dataset.apoloSpace = id;
            el.dataset.apoloSpaceId = id;
            el.dataset.apoloGrid = BoxRegistry.isGridVisible(id) ? 'true' : 'false';
            el.dataset.apoloGridStyle = BoxRegistry.getGridStyle(id);
            el.dataset.apoloBgTheme = BoxRegistry.getBgTheme(id);
            el.dataset.apoloAccent = BoxRegistry.getAccentColor(id);
            el.dataset.apoloBorder = BoxRegistry.isBorderOutline(id) ? 'true' : 'false';
            el.dataset.apoloSnap = (BoxRegistry.isSnapActive(id) || this.snapGrid) ? 'true' : 'false';
            const density = BoxRegistry.getGridDensity(id) || this.document.boxes?.[id]?.gridDensity || this.gridDensity || 32;
            el.dataset.apoloGridDensity = String(density);
            const { width: contentWidth } = this.getContentGeometry();
            const boxWidth = el.clientWidth || el.offsetWidth || contentWidth || 800;
            if (boxWidth > 0 && density > 0) {
                const stepPx = Math.round((boxWidth / density) * 100) / 100;
                el.style.setProperty('--apolo-grid-step', `${stepPx}px`);
            }

            const effectiveBgTheme = BoxRegistry.getBgTheme(id);
            el.dataset.apoloBgTheme = effectiveBgTheme;
            const customBg = BoxRegistry.getCustomBgColor(id);
            if (customBg) {
                el.style.setProperty('background-color', customBg, 'important');
            } else if (effectiveBgTheme === 'pitch-black') {
                el.style.setProperty('background-color', '#000000', 'important');
            } else if (effectiveBgTheme === 'graphite') {
                el.style.setProperty('background-color', '#27272a', 'important');
            } else if (effectiveBgTheme === 'transparent') {
                el.style.setProperty('background-color', 'transparent', 'important');
            } else {
                el.style.removeProperty('background-color');
            }

            const embedWrapper = el.closest<HTMLElement>('.cm-embed-block');
            if (embedWrapper) {
                embedWrapper.style.setProperty('min-height', `${h}px`, 'important');
            }

            const existingHandle = el.querySelector<HTMLElement>('.apolo-box-handle');
            const existingOptions = el.querySelector<HTMLElement>('.apolo-box-options-btn');

            if (isPreview) {
                if (existingHandle) existingHandle.remove();
                if (existingOptions) existingOptions.remove();

                const boxElements = this.document.elements.filter(e => e.blockId === `space:${id}`);
                let previewSvgWrap = el.querySelector<HTMLElement>('.apolo-box-preview-svg');
                if (boxElements.length > 0) {
                    if (!previewSvgWrap) {
                        previewSvgWrap = document.createElement('div');
                        previewSvgWrap.className = 'apolo-box-preview-svg';
                        el.appendChild(previewSvgWrap);
                    }
                    const targetW = Math.round(boxWidth || 800);
                    const svgHash = `${boxElements.length}:${targetW}:${h}`;
                    if (previewSvgWrap.dataset.apoloSvgHash !== svgHash || previewSvgWrap.children.length === 0) {
                        const svgMarkup = renderBoxSvg(id, boxElements, targetW, h);
                        const parsedSvg = createSvgFromMarkup(svgMarkup);
                        previewSvgWrap.replaceChildren(parsedSvg);
                        previewSvgWrap.dataset.apoloSvgHash = svgHash;
                    }
                } else if (previewSvgWrap) {
                    previewSvgWrap.remove();
                }
            } else {
                const existingPreviewSvg = el.querySelector<HTMLElement>('.apolo-box-preview-svg');
                if (existingPreviewSvg) existingPreviewSvg.remove();

                // 1. Subtle top-left 3-dots button
                if (!existingOptions) {
                    const optBtn = document.createElement('button');
                    optBtn.className = 'apolo-box-options-btn';
                    optBtn.type = 'button';
                    optBtn.dataset.apoloBoxId = id;
                    optBtn.setAttribute('aria-label', 'Opciones del espacio');
                    optBtn.appendChild(createDotsIcon());
                    el.appendChild(optBtn);
                }

                // 2. 44px touch-target bottom resize handle
                if (!existingHandle) {
                    const handle = document.createElement('div');
                    handle.className = 'apolo-box-handle';
                    handle.dataset.apoloHandleId = id;
                    handle.setAttribute('role', 'button');
                    handle.setAttribute('aria-label', 'Redimensionar caja de dibujo');

                    const bar = document.createElement('div');
                    bar.className = 'apolo-box-handle-bar';
                    handle.appendChild(bar);
                    el.appendChild(handle);
                }
            }
        }
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

        if (this.editor) {
            const cm = (this.editor as any)?.cm as EditorView | undefined;
            cm?.requestMeasure?.();
        }
    }

    private setZoomLevel(newZoom: number): void {
        const clampedZoom = Math.max(1.0, Math.min(3.0, newZoom));
        if (Math.abs(clampedZoom - this.zoom) < 0.001) return;
        this.zoom = clampedZoom;
        this.applyContentZoom();
        this.blockPositionCache.clear();
        this.rebuildIndex();
        this.zoomPill?.setZoom(this.zoom);
        this.options.eventBus?.emit('zoom:changed', this.zoom);
        this.renderDirty = true;
        this.schedulePaint();
        this.lassoMenu?.updateViewport(this.zoom, this.currentScrollLeft, this.currentScrollTop);
    }

    private readonly onWheel = (event: WheelEvent): void => {
        if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            const factor = event.deltaY < 0 ? 1.08 : 0.92;
            const newZoom = Math.max(1.0, Math.min(3.0, this.zoom * factor));
            if (Math.abs(newZoom - this.zoom) < 0.005) return;

            const rect = this.scroller.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;
            const oldZoom = this.zoom;
            const worldX = (mouseX + this.currentScrollLeft) / oldZoom;
            const worldY = (mouseY + this.currentScrollTop) / oldZoom;

            this.setZoomLevel(newZoom);

            if (newZoom > 1.0) {
                const sizer = this.getSizerElement();
                const baseWidth = sizer?.offsetWidth ?? this.scroller.clientWidth;
                const baseHeight = sizer?.offsetHeight ?? this.scroller.clientHeight;
                const maxScrollX = Math.max(0, Math.round(baseWidth * newZoom - this.scroller.clientWidth));
                const maxScrollY = Math.max(0, Math.round(baseHeight * newZoom - this.scroller.clientHeight));

                this.scroller.scrollLeft = Math.max(0, Math.min(maxScrollX, Math.round(worldX * newZoom - mouseX)));
                this.scroller.scrollTop = Math.max(0, Math.min(maxScrollY, Math.round(worldY * newZoom - mouseY)));
            } else {
                this.scroller.scrollLeft = 0;
            }
        }
    };

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

    private selectColorSlot(index: number): void {
        const paletteKey = this.tool === 'highlighter' ? 'highlighter' : (this.tool === 'shape' ? 'shape' : 'pen');
        this.activeColorSlots[paletteKey] = index;
        this.activeFavoriteIndex = index;
        this.toolState[paletteKey].activeSlotIndex = index;
        const color = this.toolPalettes[paletteKey]?.colors[index] ?? this.favorites[index]?.color ?? '#1F4FD8';
        if (paletteKey === 'highlighter') {
            const op = (this.toolPalettes.highlighter.opacities[index] ?? 75) / 100;
            this.style.opacity = op;
            this.toolState.highlighter.opacity = op;
        } else if (paletteKey === 'pen') {
            const op = (this.toolPalettes.pen.opacities[index] ?? 100) / 100;
            this.style.opacity = op;
            this.toolState.pen.opacity = op;
        } else if (paletteKey === 'shape') {
            const op = (this.toolPalettes.shape.opacities[index] ?? 100) / 100;
            this.style.opacity = op;
            this.toolState.shape.opacity = op;
            this.applyStyleToSelectedShapes({ opacity: op, color });
        }
        this.setInkColor(color);
        // Note: strictly only changes ink color; does NOT alter current tool, profile, or width
    }

    private updateToolPaletteColor(
        toolKey: 'pen' | 'highlighter' | 'shape',
        slotIdx: number,
        newColor: string,
        opacity: number
    ): void {
        if (!this.toolPalettes[toolKey]) return;
        this.toolPalettes[toolKey].colors[slotIdx] = newColor;
        this.toolPalettes[toolKey].opacities[slotIdx] = opacity;
        this.activeColorSlots[toolKey] = slotIdx;
        this.activeFavoriteIndex = slotIdx;

        this.toolState[toolKey].palette.colors[slotIdx] = newColor;
        this.toolState[toolKey].palette.opacities[slotIdx] = opacity;
        this.toolState[toolKey].activeSlotIndex = slotIdx;
        this.toolState[toolKey].color = newColor;
        const normOp = opacity > 1 ? opacity / 100 : Math.max(0, Math.min(1, opacity));
        this.toolState[toolKey].opacity = normOp;
        this.style.opacity = normOp;
        if (toolKey === 'shape') {
            this.applyStyleToSelectedShapes({ opacity: normOp, color: newColor });
        }

        // Keep favorites in sync if pen palette changed
        if (toolKey === 'pen' && this.favorites[slotIdx]) {
            this.favorites[slotIdx].color = newColor;
            this.options.onFavoritesChange?.(this.favorites);
        }

        this.options.onToolPalettesChange?.(this.toolPalettes);
        this.setInkColor(newColor);
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

    public getActiveToolFavorites(): ToolFavoritePreset[] {
        if (!this.toolState) return [];
        return getCanonicalFavorites(this.toolState, this.tool as FavoritableTool);
    }

    public getCurrentToolSlice(): any {
        if (this.tool === 'pen') {
            return {
                tool: 'pen',
                profileId: this.penProfileId,
                color: this.style.color,
                width: this.style.width,
                opacity: this.style.opacity ?? 1,
                pattern: this.style.pattern ?? 'solid',
                straightenLines: Boolean(this.straightenLines),
                smoothing: this.smoothing,
            };
        }
        if (this.tool === 'highlighter') {
            return {
                tool: 'highlighter',
                profileId: this.penProfileId === 'hlf' ? 'hlf' : 'hlr',
                color: this.style.color,
                width: this.style.width,
                opacity: this.style.opacity ?? 0.75,
                pattern: this.style.pattern ?? 'solid',
                straightenLines: Boolean(this.straightenLines),
            };
        }
        if (this.tool === 'shape') {
            return {
                tool: 'shape',
                shapeType: this.shapeType,
                color: this.style.color,
                width: this.style.width,
                opacity: this.style.opacity ?? 1,
                pattern: this.style.pattern ?? 'solid',
                fillEnabled: Boolean(this.toolState.shape.fillEnabled),
                fillColor: this.toolState.shape.fillColor,
                fillOpacity: this.toolState.shape.fillOpacity,
            };
        }
        return null;
    }

    public isCurrentToolFavorited(): boolean {
        const slice = this.getCurrentToolSlice();
        if (!slice) return false;
        const list = this.getActiveToolFavorites();
        return Boolean(findMatchingFavorite(list, slice));
    }

    public syncEstucheFavoriteState(): void {
        if (!this.estuche) return;
        const tool = this.tool;
        if (tool === 'pen' || tool === 'highlighter' || tool === 'shape') {
            const favorites = this.getActiveToolFavorites();
            const isCurrentFavorite = this.isCurrentToolFavorited();
            this.estuche.updateState({
                favorites,
                isCurrentFavorite,
                strokeFavoriteProfiles: this.toolState.strokeFavoriteProfiles,
                activeStrokeProfileId: this.toolState.activeStrokeProfileId,
                shapeFavoriteProfiles: this.toolState.shapeFavoriteProfiles,
                activeShapeProfileId: this.toolState.activeShapeProfileId,
                syncFavoriteProfiles: this.toolState.syncFavoriteProfiles,
            });
        }
    }

    public toggleFavorite(): void {
        const tool = this.tool;
        if (tool !== 'pen' && tool !== 'highlighter' && tool !== 'shape') return;
        const slice = this.getCurrentToolSlice();
        if (!slice) return;

        const currentList = this.getActiveToolFavorites();
        const result = toggleFavoritePreset(currentList, slice);
        setCanonicalFavorites(this.toolState, tool, result.updatedList);

        this.syncEstucheFavoriteState();
        this.notifyToolStateChange();
        this.options.onToggleFavorite?.();
        if (result.added) {
            this.toast?.show('Guardado en favoritos');
        } else if (result.removedId) {
            this.toast?.show('Eliminado de favoritos');
        }
    }

    public applyToolFavoritePreset(preset: ToolFavoritePreset): void {
        // Arming a favorite configures the tool; it must not restyle a selected shape.
        this.suppressSelectionStyleSync = true;
        try {
            this.applyToolFavoritePresetInner(preset);
        } finally {
            this.suppressSelectionStyleSync = false;
        }
    }

    private applyToolFavoritePresetInner(preset: ToolFavoritePreset): void {
        if (this.tool !== preset.tool) this.setTool(preset.tool, false);

        if (preset.tool === 'pen' || preset.tool === 'highlighter') {
            const targetState = preset.tool === 'pen' ? this.toolState.pen : this.toolState.highlighter;
            this.applyPenProfile(preset.profileId);
            this.setInkColor(preset.color);
            this.setWidth(preset.width);
            if (preset.opacity !== undefined) {
                this.style.opacity = preset.opacity;
                targetState.opacity = preset.opacity;
            }
            if (preset.pattern) {
                this.style.pattern = preset.pattern;
                targetState.pattern = preset.pattern;
            }
            if (preset.straightenLines !== undefined) this.setStraightenLines(preset.straightenLines);
            if (preset.tool === 'pen' && preset.smoothing !== undefined) {
                this.smoothing = preset.smoothing;
                this.toolState.pen.smoothing = preset.smoothing;
            }
        } else if (preset.tool === 'shape') {
            this.shapeType = preset.shapeType;
            this.toolState.shape.shapeType = preset.shapeType;
            this.toolbar?.setShape(preset.shapeType);
            this.toolbar?.setTool('shape', preset.shapeType);
            this.setInkColor(preset.color);
            this.setWidth(preset.width);
            if (preset.opacity !== undefined) {
                this.style.opacity = preset.opacity;
                this.toolState.shape.opacity = preset.opacity;
            }
            if (preset.pattern) {
                this.style.pattern = preset.pattern;
                this.toolState.shape.pattern = preset.pattern;
            }
            if (preset.fillEnabled !== undefined) this.toolState.shape.fillEnabled = preset.fillEnabled;
            if (preset.fillColor !== undefined) this.toolState.shape.fillColor = preset.fillColor;
            if (preset.fillOpacity !== undefined) this.toolState.shape.fillOpacity = preset.fillOpacity;
            if (preset.fillPattern !== undefined) this.toolState.shape.fillPattern = preset.fillPattern;
            if (preset.fillDensity !== undefined) this.toolState.shape.fillDensity = preset.fillDensity;
            if (preset.regularize !== undefined) this.toolState.shape.regularize = preset.regularize;
        }

        this.toolbar?.setStyle(this.style.color, this.style.width, this.penProfileId);
        this.estuche?.updateState({
            tool: this.tool,
            color: this.style.color,
            width: this.style.width,
            profileId: this.penProfileId,
            pattern: this.style.pattern,
            lineStyle: this.style.pattern,
            straightenLines: this.straightenLines,
            shapeType: this.shapeType,
            ...(preset.tool === 'shape' ? {
                regularize: this.toolState.shape.regularize,
                fillEnabled: this.toolState.shape.fillEnabled,
                fillColor: this.toolState.shape.fillColor,
                fillPattern: this.toolState.shape.fillPattern,
                fillDensity: this.toolState.shape.fillDensity,
                fillOpacity: this.toolState.shape.fillOpacity,
            } : {}),
        });
        this.syncEstucheFavoriteState();
        this.schedulePaint();
        this.notifyToolStateChange();
        this.options.onApplyFavorite?.(preset);
    }

    private syncAndNotifyFavorites(): void {
        this.syncEstucheFavoriteState();
        this.notifyToolStateChange();
    }

    public deleteToolFavoritePreset(presetId: string): void {
        const tool = this.tool;
        if (tool !== 'pen' && tool !== 'highlighter' && tool !== 'shape') return;
        setCanonicalFavorites(this.toolState, tool, removeFavoriteById(this.getToolFavorites(tool), presetId));
        this.syncAndNotifyFavorites();
        this.options.onDeleteFavorite?.(presetId);
        this.toast?.show('Favorito eliminado');
    }

    public reorderToolFavorites(fromIndex: number, toIndex: number): void {
        const tool = this.tool;
        if (tool !== 'pen' && tool !== 'highlighter' && tool !== 'shape') return;
        setCanonicalFavorites(this.toolState, tool, reorderFavorites(this.getToolFavorites(tool), fromIndex, toIndex));
        this.syncAndNotifyFavorites();
        this.options.onReorderFavorites?.(fromIndex, toIndex);
    }

    public switchFavoriteProfile(profileId: string): void {
        if (this.tool === 'shape') switchShapeProfile(this.toolState, profileId);
        else switchStrokeProfile(this.toolState, profileId);
        this.syncAndNotifyFavorites();
    }

    public createFavoriteProfile(name: string): void {
        if (this.tool === 'shape') this.createShapeProfile(name);
        else this.createStrokeProfile(name);
    }

    public createStrokeProfile(name: string): void {
        createStrokeProfile(this.toolState, name);
        this.syncAndNotifyFavorites();
        this.toast?.show(`Perfil "${name}" creado`);
    }

    public createShapeProfile(name: string): void {
        createShapeProfile(this.toolState, name);
        this.syncAndNotifyFavorites();
        this.toast?.show(`Perfil "${name}" creado`);
    }

    public renameStrokeProfile(profileId: string, name: string): boolean {
        const ok = renameStrokeProfile(this.toolState, profileId, name);
        if (ok) this.syncAndNotifyFavorites();
        return ok;
    }

    public deleteStrokeProfile(profileId: string): boolean {
        const ok = deleteStrokeProfile(this.toolState, profileId);
        if (ok) this.syncAndNotifyFavorites();
        return ok;
    }

    public renameShapeProfile(profileId: string, name: string): boolean {
        const ok = renameShapeProfile(this.toolState, profileId, name);
        if (ok) this.syncAndNotifyFavorites();
        return ok;
    }

    public deleteShapeProfile(profileId: string): boolean {
        const ok = deleteShapeProfile(this.toolState, profileId);
        if (ok) this.syncAndNotifyFavorites();
        return ok;
    }

    public renameFavoritePreset(presetId: string, newName: string): boolean {
        const ok = renameFavoritePreset(this.toolState, this.tool as FavoritableTool, presetId, newName);
        if (ok) this.syncAndNotifyFavorites();
        return ok;
    }

    public toggleSyncFavoriteProfiles(sync: boolean): void {
        this.toolState.syncFavoriteProfiles = sync;
        if (sync) {
            const activeStroke = getActiveStrokeProfile(this.toolState);
            const currIdx = this.toolState.strokeFavoriteProfiles.findIndex(p => p.id === activeStroke.id);
            const matchingShape = findMatchingProfile(
                this.toolState.shapeFavoriteProfiles,
                activeStroke.id,
                activeStroke.name,
                currIdx,
            );
            if (matchingShape) this.toolState.activeShapeProfileId = matchingShape.id;
            syncLegacyFavoritesSlice(this.toolState);
        }
        this.syncAndNotifyFavorites();
        this.toast?.show(sync ? 'Perfiles sincronizados' : 'Perfiles independientes');
    }

    public getTool(): ToolType {
        return this.tool;
    }

    public getToolFavorites(tool: 'pen' | 'highlighter' | 'shape'): ToolFavoritePreset[] {
        return this.toolState ? getCanonicalFavorites(this.toolState, tool) : [];
    }

    public getActiveToolFavoritesCount(): number {
        const tool = this.tool;
        return (tool === 'pen' || tool === 'highlighter' || tool === 'shape') ? this.getToolFavorites(tool).length : 0;
    }

    public toggleEstucheFavorites(targetTool?: ToolType): void {
        const tool = targetTool || this.tool;
        if (tool !== 'pen' && tool !== 'highlighter' && tool !== 'shape') return;
        if (tool !== this.tool) this.setTool(tool);
        if (this.estuche?.isOpen()) {
            this.estuche.close();
        } else {
            this.estuche?.open(this.buildEstucheState(tool, true), this.toolbar?.getToolButton(tool));
        }
    }

    public cycleActiveToolFavorite(): boolean {
        const tool = this.tool;
        if (tool === 'eraser' || tool === 'lasso') {
            this.setTool('pen');
            this.toast?.show('Herramienta: Pluma');
            return true;
        }
        if (tool !== 'pen' && tool !== 'highlighter' && tool !== 'shape') return false;

        const profile = tool === 'shape' ? getActiveShapeProfile(this.toolState) : getActiveStrokeProfile(this.toolState);
        const list: ToolFavoritePreset[] = tool === 'shape'
            ? (profile as any).shape
            : (profile as any)[tool];

        if (!list || list.length === 0) {
            this.toggleEstucheFavorites();
            this.toast?.show(`${profile.name} · Sin favoritos guardados`);
            return false;
        }

        const next = getNextFavoritePreset(list, this.getCurrentToolSlice());
        if (!next) return false;

        this.applyToolFavoritePreset(next.preset);
        this.toast?.show(`${profile.name} · Favorito ${next.index + 1}/${list.length}`);
        return true;
    }

    public cycleActiveToolProfile(): boolean {
        const isShape = this.tool === 'shape';
        const profiles = isShape ? this.toolState.shapeFavoriteProfiles : this.toolState.strokeFavoriteProfiles;
        const activeId = isShape ? this.toolState.activeShapeProfileId : this.toolState.activeStrokeProfileId;
        if (!profiles || profiles.length === 0) return false;
        const currIdx = profiles.findIndex(p => p.id === activeId);
        const nextProfile = profiles[currIdx !== -1 ? (currIdx + 1) % profiles.length : 0];
        this.switchFavoriteProfile(nextProfile.id);
        this.toast?.show(`Perfil: ${nextProfile.name}`);
        return true;
    }

    public getEstuche(): ToolEstuche | null {
        return this.estuche;
    }

    private applyThicknessPreset(preset: ThicknessPreset): void {
        if (this.tool === 'eraser') {
            const radii = { fine: 10, medium: 20, thick: 40 };
            this.eraserRadius = radii[preset];
            this.toolState.eraser.radius = this.eraserRadius;
            this.toolbar?.setThicknessValues(this.style.width, this.eraserRadius);
            this.estuche?.updateState({ eraserRadius: this.eraserRadius });
            const labels = {
                fine: 'Borrador fino (10 px)',
                medium: 'Borrador normal (20 px)',
                thick: 'Borrador grande (40 px)',
            };
            this.toast?.show(labels[preset]);
            this.notifyToolStateChange();
        } else if (this.tool === 'highlighter') {
            const widths = { fine: 12, medium: 20, thick: 32 };
            this.setWidth(widths[preset]);
            const labels = {
                fine: 'Resaltador fino (12 px)',
                medium: 'Resaltador normal (20 px)',
                thick: 'Resaltador grueso (32 px)',
            };
            this.toast?.show(labels[preset]);
        } else {
            // Pen / Bolígrafo: 3 grosores rápidos predefinidos (fino para letra pequeña, normal para texto, grueso para títulos)
            const widths = { fine: 1.8, medium: 3.2, thick: 6.0 };
            this.setWidth(widths[preset]);
            const labels = {
                fine: 'Grosor fino (letra pequeña - 1.8 px)',
                medium: 'Grosor normal (texto - 3.2 px)',
                thick: 'Grosor grueso (títulos - 6 px)',
            };
            this.toast?.show(labels[preset]);
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
            this.toolState.activeTool = 'highlighter';
            this.toolState.highlighter.profileId = profileId;
            this.toolState.highlighter.opacity = profile.op;
            this.toolState.highlighter.pattern = this.style.pattern;
            this.style.isHighlighter = true;
            this.canvas.classList.add('is-highlighter-mode');
        } else {
            this.tool = 'pen';
            this.toolState.activeTool = 'pen';
            this.toolState.pen.profileId = profileId;
            this.toolState.pen.opacity = profile.op;
            this.toolState.pen.pattern = this.style.pattern;
            this.style.isHighlighter = false;
            this.canvas.classList.remove('is-highlighter-mode');
        }

        this.toolbar?.setTool(this.tool, this.shapeType);
        this.toolbar?.setStyle(this.style.color, this.style.width, this.penProfileId);
        this.estuche?.updateState({
            tool: this.tool,
            profileId: this.penProfileId,
            width: this.style.width,
            lineStyle: this.style.pattern,
            pattern: this.style.pattern,
            straightenLines: this.straightenLines,
        });
        this.syncEstucheFavoriteState();
        this.options.eventBus?.emit('tool:changed', this.tool, this.shapeType);
        this.options.eventBus?.emit('style:changed', this.style, this.penProfileId);
        this.schedulePaint();
        this.notifyToolStateChange();
    }

    setInkColor(color: string): void {
        this.style.color = color;
        if (this.tool === 'pen') {
            this.previousPenColor = color;
            this.toolState.pen.color = color;
        } else if (this.tool === 'highlighter') {
            this.toolState.highlighter.color = color;
        } else if (this.tool === 'shape') {
            this.toolState.shape.color = color;
        }
        this.applyStyleToSelectedShapes({ color });
        this.toolbar?.setStyle(color, this.style.width, this.penProfileId);
        this.estuche?.updateState({ color });
        this.syncEstucheFavoriteState();
        this.options.eventBus?.emit('style:changed', { color });
        this.schedulePaint();
        this.notifyToolStateChange();
    }

    setWidth(width: number): void {
        this.style.width = width;
        if (this.tool === 'pen') {
            this.toolState.pen.width = width;
        } else if (this.tool === 'highlighter') {
            this.toolState.highlighter.width = width;
        } else if (this.tool === 'shape') {
            this.toolState.shape.width = width;
        }
        this.applyStyleToSelectedShapes({ width });
        this.toolbar?.setStyle(this.style.color, width, this.penProfileId);
        this.estuche?.updateState({ width });
        this.syncEstucheFavoriteState();
        this.options.eventBus?.emit('style:changed', { width });
        this.schedulePaint();
        this.notifyToolStateChange();
    }

    setStraightenLines(enabled: boolean): void {
        this.straightenLines = enabled;
        if (this.tool === 'pen') {
            this.toolState.pen.straightenLines = enabled;
        } else if (this.tool === 'highlighter') {
            this.toolState.highlighter.straightenLines = enabled;
        }
        this.estuche?.updateState({ straightenLines: enabled });
        this.syncEstucheFavoriteState();
        this.options.eventBus?.emit('straighten:changed', enabled);
        this.notifyToolStateChange();
    }

    getStraightenLines(): boolean {
        return this.straightenLines;
    }

    getToolState(): WorkspaceToolState {
        return cloneWorkspaceToolState(this.toolState);
    }

    applyWorkspaceToolState(state: WorkspaceToolState, updateUi = true): void {
        this.toolState = cloneWorkspaceToolState(state);
        this.penEnabled = state.penEnabled;
        this.snapGrid = state.snapGrid;
        this.toolPalettes = {
            pen: { colors: [...state.pen.palette.colors], opacities: [...state.pen.palette.opacities] },
            highlighter: { colors: [...state.highlighter.palette.colors], opacities: [...state.highlighter.palette.opacities] },
            shape: { colors: [...state.shape.palette.colors], opacities: [...state.shape.palette.opacities] },
        };
        this.activeColorSlots = {
            pen: state.pen.activeSlotIndex,
            highlighter: state.highlighter.activeSlotIndex,
            shape: state.shape.activeSlotIndex,
        };

        this.eraserMode = state.eraser.mode;
        this.eraserRadius = state.eraser.radius;
        this.scribbleToErase = state.eraser.scribbleToErase;
        this.lassoMode = state.lasso.mode;
        this.shapeType = state.shape.shapeType;

        this.setTool(state.activeTool, false);

        if (updateUi) {
            this.toolbar?.setToolPalettes(this.toolPalettes);
            this.toolbar?.setPenEnabled(this.penEnabled);
            this.toolbar?.setSnapGrid(this.snapGrid);
            this.toolbar?.setEraserMode(this.eraserMode);
            this.toolbar?.setShape(this.shapeType);
            this.toolbar?.setTool(this.tool, this.shapeType);
            this.toolbar?.setStyle(this.style.color, this.style.width, this.penProfileId);
            this.toolbar?.setThicknessValues(this.style.width, this.eraserRadius);
            this.estuche?.updateState(this.buildEstucheState(this.tool));
            this.syncEstucheFavoriteState();
            this.updateLayerPointerEvents();
        }
        this.renderDirty = true;
        this.schedulePaint();
    }

    private notifyToolStateChange(): void {
        this.options.onToolStateChange?.(this.getToolState());
    }

    private readonly onCanvasDblClick = (event: MouseEvent): void => {
        if (this.penEnabled) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        this.focusEditorAt(event.clientX, event.clientY);
    };

    private focusEditorAt(clientX: number, clientY: number): void {
        if (this.penEnabled) return;
        if (!this.editor) return;
        if (this.activeHandleDrag) return;
        if (this.input?.shouldRejectTouch() || this.input?.isPalmRejected()) return;
        if (isScreenPointForbidden(clientX, clientY)) return;
        if (this.isAnyMenuOpen()) return;

        // 1. Guard against tapping inside any drawing box element or handle
        if (typeof document !== 'undefined' && typeof document.elementsFromPoint === 'function') {
            const hits = document.elementsFromPoint(clientX, clientY);
            if (hits.some(el => el.classList?.contains('apolo-space-block') || el.classList?.contains('apolo-box-handle') || el.closest?.('.apolo-space-block') !== null)) {
                return; // Do NOT refocus or move editor cursor onto the box!
            }
        }

        try {
            const ed = this.editor as unknown as Record<string, unknown>;
            let targetPos: { line: number; ch: number } | null = null;
            if (typeof ed.posAtCoords === 'function') {
                const pos = (ed.posAtCoords as (c: { x: number; y: number }) => { line: number; ch: number } | null)({ x: clientX, y: clientY });
                if (pos) targetPos = pos;
            } else if (ed.cm && typeof (ed.cm as Record<string, unknown>).posAtCoords === 'function') {
                const offset = ((ed.cm as Record<string, unknown>).posAtCoords as (c: { x: number; y: number }) => number | null)({ x: clientX, y: clientY });
                if (typeof offset === 'number' && typeof this.editor.offsetToPos === 'function') {
                    targetPos = this.editor.offsetToPos(offset);
                }
            }

            if (targetPos) {
                // 2. Guard: if the target line is a canvas box tag, do not focus onto it
                const lineContent = this.editor.getLine(targetPos.line) ?? '';
                if (lineContent.includes('data-apolo-space') || lineContent.includes('```apolo-space')) {
                    return;
                }
                (this.editor.setCursor as (p: unknown) => void)(targetPos);
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
        this.toolState.penEnabled = enabled;
        if (!enabled) {
            this.resetCursor();
        } else {
            this.canvas.style.cursor = 'crosshair';
        }
        this.updateLayerPointerEvents();
        this.toolbar?.setPenEnabled(enabled);
        this.options.onPenEnabledChange?.(enabled);
        this.options.eventBus?.emit('pen:changed', enabled);
        this.notifyToolStateChange();

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

    setTool(tool: ToolType, notify = true): void {
        const previousTool = this.tool;
        this.tool = tool;
        this.toolState.activeTool = tool;

        if (tool === 'pen') {
            const slice = this.toolState.pen;
            this.penProfileId = slice.profileId;
            const profile = PEN_PROFILES[slice.profileId] || PEN_PROFILES.fountain;
            this.style.color = slice.color;
            this.style.width = slice.width;
            this.style.opacity = slice.opacity;
            this.style.pattern = slice.pattern;
            this.style.lineCap = profile.cap;
            this.style.isHighlighter = false;
            this.smoothing = slice.smoothing;
            this.straightenLines = slice.straightenLines;
            this.canvas.classList.remove('is-highlighter-mode');
        } else if (tool === 'highlighter') {
            const slice = this.toolState.highlighter;
            this.penProfileId = slice.profileId;
            const profile = PEN_PROFILES[slice.profileId] || PEN_PROFILES.hlr;
            this.style.color = slice.color;
            this.style.width = slice.width;
            this.style.opacity = slice.opacity;
            this.style.pattern = slice.pattern;
            this.style.lineCap = profile.cap;
            this.style.isHighlighter = true;
            this.straightenLines = slice.straightenLines;
            this.canvas.classList.add('is-highlighter-mode');
        } else if (tool === 'shape') {
            const slice = this.toolState.shape;
            this.shapeType = slice.shapeType;
            this.style.color = slice.color;
            this.style.width = slice.width;
            this.style.opacity = slice.opacity;
            this.style.pattern = slice.pattern;
            this.style.lineCap = 'round';
            this.style.isHighlighter = false;
            this.canvas.classList.remove('is-highlighter-mode');
        } else if (tool === 'eraser') {
            const slice = this.toolState.eraser;
            this.eraserMode = slice.mode;
            this.eraserRadius = slice.radius;
            this.scribbleToErase = slice.scribbleToErase;
            this.selection = [];
            this.lassoMenu?.hide();
            this.canvas.classList.remove('is-highlighter-mode');
        } else if (tool === 'lasso') {
            const slice = this.toolState.lasso;
            this.lassoMode = slice.mode;
            this.canvas.classList.remove('is-highlighter-mode');
        } else {
            this.canvas.classList.remove('is-highlighter-mode');
        }

        this.toolbar?.setTool(tool, this.shapeType);
        this.toolbar?.setStyle(this.style.color, this.style.width, this.penProfileId);
        this.toolbar?.setThicknessValues(this.style.width, this.eraserRadius);
        if (tool === 'eraser') {
            this.toolbar?.setEraserMode(this.eraserMode);
        }

        this.estuche?.updateState({
            tool,
            color: this.style.color,
            width: this.style.width,
            profileId: this.penProfileId,
            lineStyle: this.style.pattern,
            pattern: this.style.pattern,
            straightenLines: this.straightenLines,
            smoothing: this.smoothing,
            eraserMode: this.eraserMode,
            eraserRadius: this.eraserRadius,
            scribbleToErase: this.scribbleToErase,
            shapeType: this.shapeType,
            snapGrid: this.snapGrid,
        });
        this.syncEstucheFavoriteState();

        this.options.eventBus?.emit('tool:changed', tool, this.shapeType);
        this.options.eventBus?.emit('style:changed', this.style, this.penProfileId);
        this.schedulePaint();

        if (notify) {
            this.notifyToolStateChange();
        }
    }

    toggleEraserMode(): EraserMode {
        this.eraserMode = this.eraserMode === 'whole' ? 'reticle' : 'whole';
        this.toolState.eraser.mode = this.eraserMode;
        this.toolbar?.setEraserMode(this.eraserMode);
        this.estuche?.updateState({ eraserMode: this.eraserMode });
        const label = this.eraserMode === 'whole'
            ? 'Borrador: Trazo completo (borra líneas enteras)'
            : 'Borrador: Retícula (corte de trazo)';
        this.toast?.show(label);
        this.notifyToolStateChange();
        return this.eraserMode;
    }

    setEraserMode(mode: EraserMode): void {
        this.eraserMode = mode;
        this.toolState.eraser.mode = mode;
        this.toolbar?.setEraserMode(mode);
        this.estuche?.updateState({ eraserMode: mode });
        this.notifyToolStateChange();
    }

    undo(): void { if (!this.options.readonly) this.performUndo(); }
    redo(): void { if (!this.options.readonly) this.performRedo(); }

    onEditorChange(): void {
        this.blockPositionCache.clear();
        if (!this.options.readonly) this.scheduleReanchor();
    }

    cancelSingleFingerTouch(): void {
        if (this.touches.size === 1) {
            this.palmRejectedSingleTouch = true;
            this.singleTouchStartCoords = null;
            this.lastSingleTouch = null;
            this.singleTouchPanned = false;
        }
    }

    commitActiveStroke(): void {
        if (!this.activeStart || this.points.size === 0) return;
        const raw = this.readActivePoints();
        if (raw.length > 0) {
            this.recordHistory();
            this.createStrokeFromPoints(raw);
            this.rebuildIndex();
            this.persistSoon();
        }
        this.cancel();
    }

    onFileRenamed(newFile: TFile, oldPath: string): void {
        if (this.file.path === oldPath || this.document.notePath === oldPath) {
            (this as any).file = newFile;
            this.document.notePath = newFile.path;
            this.persistSoon();
        }
    }

    async flush(): Promise<void> {
        this.commitActiveStroke();
        this.updateDocumentLayoutHint();
        this.updateBoxesMetadata();
        if (this.spacerDebounceTimer !== null) {
            window.clearTimeout(this.spacerDebounceTimer);
            this.spacerDebounceTimer = null;
        }
        await this.flushSpaceMutations();
        await this.persistence.flush();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        this.clearHoldToSnap();
        this.strokeCache.clear();
        this.input?.destroy();
        if (this.scrollHandler) {
            this.scroller.removeEventListener('scroll', this.scrollHandler);
            window.removeEventListener('scroll', this.scrollHandler, { capture: true });
        }
        if (this.reanchorTimer !== null) window.clearTimeout(this.reanchorTimer);
        if (this.previewReanchorTimer !== null) {
            window.clearTimeout(this.previewReanchorTimer);
            this.previewReanchorTimer = null;
        }
        if (this.spacerDebounceTimer !== null) {
            window.clearTimeout(this.spacerDebounceTimer);
            this.spacerDebounceTimer = null;
        }
        if (this.pendingSpaceMutations.length > 0) {
            void this.flushSpaceMutations();
        }
        this.resizeObserver?.disconnect();
        this.sizerObserver?.disconnect();

        this.scroller.removeEventListener('pointerdown', this.onCanvasPointerDownHandleCheck, { capture: true });
        this.scroller.removeEventListener('touchstart', this.onCanvasTouchStartHandleCheck, { capture: true });
        this.canvas.removeEventListener('pointerdown', this.onCanvasPointerDownHandleCheck, { capture: true });
        this.canvas.removeEventListener('touchstart', this.onCanvasTouchStartHandleCheck, { capture: true });
        this.scroller.removeEventListener('pointermove', this.onPointerMove, { capture: true });
        this.canvas.removeEventListener('pointermove', this.onPointerMove, { capture: true });
        this.scroller.removeEventListener('pointerup', this.onPointerUp, { capture: true });
        this.canvas.removeEventListener('pointerup', this.onPointerUp, { capture: true });
        this.scroller.removeEventListener('pointercancel', this.onPointerCancel, { capture: true });
        this.canvas.removeEventListener('pointercancel', this.onPointerCancel, { capture: true });
        this.scroller.removeEventListener('pointerleave', this.onPointerLeave, { capture: true });
        this.canvas.removeEventListener('pointerleave', this.onPointerLeave, { capture: true });
        this.canvas.removeEventListener('lostpointercapture', this.onLostPointerCapture);
        this.scroller.removeEventListener('contextmenu', this.onCanvasContextMenu);
        this.canvas.removeEventListener('contextmenu', this.onCanvasContextMenu);
        window.removeEventListener('pointermove', this.onWindowPointerMoveHandleDrag);
        window.removeEventListener('pointerup', this.onWindowPointerUpHandleDrag);
        window.removeEventListener('pointercancel', this.onWindowPointerUpHandleDrag);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerCancel);
        this.canvas.removeEventListener('pointerdown', this.onTouchDown);
        this.canvas.removeEventListener('pointermove', this.onTouchMove);
        this.canvas.removeEventListener('pointerup', this.onTouchEnd);
        this.canvas.removeEventListener('pointercancel', this.onTouchEnd);
        this.canvas.removeEventListener('dblclick', this.onCanvasDblClick);
        this.canvas.removeEventListener('wheel', this.onWheel);
        window.removeEventListener('pointerdown', this.onDocumentPointerDown, { capture: true });
        window.removeEventListener('touchstart', this.onDocumentTouchStart, { capture: true });
        window.removeEventListener('keydown', this.onDocumentKeyDown);
        window.removeEventListener('keyup', this.onDocumentKeyUp);

        if (this.frame) cancelAnimationFrame(this.frame);

        this.toolbar?.destroy();
        this.estuche?.destroy();
        this.lassoMenu?.destroy();
        this.zoomPill?.destroy();
        this.toast?.destroy();
        this.boxMenu?.destroy();
        this.popoverController.destroy();
        this.toolbar = null;
        this.estuche = null;
        this.lassoMenu = null;
        this.zoomPill = null;
        this.toast = null;
        this.boxMenu = null;
        if (this.debugInputHudEl) {
            this.debugInputHudEl.remove();
            this.debugInputHudEl = null;
        }
        this.uiRoot.replaceChildren();
        this.uiRoot.remove();

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

    private isEventInOverlayOrMenuButton(event: PointerEvent | TouchEvent): boolean {
        const target = event.target;
        if (target instanceof Node) {
            if (
                this.toolbar?.container.contains(target) ||
                this.estuche?.container.contains(target) ||
                this.lassoMenu?.container.contains(target) ||
                this.zoomPill?.container.contains(target) ||
                this.boxMenu?.container.contains(target)
            ) {
                return true;
            }
            const targetEl = typeof (target as any).closest === 'function' ? (target as Element) : null;
            if (targetEl?.closest?.('.apolo-box-options-btn, .apolo-tool-btn')) {
                return true;
            }
        }
        const pe = event as PointerEvent;
        const te = event as TouchEvent;
        const touch = te.touches?.[0] ?? te.changedTouches?.[0];
        const clientX = typeof pe.clientX === 'number' ? pe.clientX : touch?.clientX;
        const clientY = typeof pe.clientY === 'number' ? pe.clientY : touch?.clientY;

        if (typeof clientX === 'number' && typeof clientY === 'number') {
            if (this.findBoxOptionsButtonAt(clientX, clientY)) {
                return true;
            }
            if (typeof document !== 'undefined' && typeof document.elementsFromPoint === 'function') {
                const hits = document.elementsFromPoint(clientX, clientY);
                for (const el of hits) {
                    if (
                        this.toolbar?.container.contains(el) ||
                        this.estuche?.container.contains(el) ||
                        this.estuche?.containsTarget(el) ||
                        this.lassoMenu?.container.contains(el) ||
                        this.zoomPill?.container.contains(el) ||
                        this.boxMenu?.container.contains(el) ||
                        Boolean((el as Element).closest?.('.color-picker-popover, .apolo-thickness-popover, .apolo-popover-shell, .apolo-estuche-popover'))
                    ) {
                        return true;
                    }
                    if (
                        el.classList?.contains('apolo-box-options-btn') ||
                        el.classList?.contains('apolo-tool-btn') ||
                        Boolean((el as Element).closest?.('.apolo-box-options-btn, .apolo-tool-btn'))
                    ) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private readonly onDocumentPointerDown = (event: PointerEvent): void => {
        if (!(event.target instanceof Node)) return;
        if (this.isEventInOverlayOrMenuButton(event)) {
            return;
        }
        this.estuche?.close();
        this.boxMenu?.hide();
    };

    private readonly onDocumentTouchStart = (event: TouchEvent): void => {
        if (!(event.target instanceof Node)) return;
        if (this.isEventInOverlayOrMenuButton(event)) {
            return;
        }
        this.estuche?.close();
        if (Date.now() - this.lastBoxOptionsTapAt >= 300) {
            this.boxMenu?.hide();
        }
    };

    private readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Shift') {
            this.isShiftDown = true;
            if (this.tool === 'shape' && this.activeStart) {
                this.schedulePaint();
            }
        }
        if (event.key === 'Escape') {
            this.estuche?.close();
            this.boxMenu?.hide();
            this.lassoMenu?.hide();
        }
    };

    private readonly onDocumentKeyUp = (event: KeyboardEvent): void => {
        if (event.key === 'Shift') {
            this.isShiftDown = false;
            if (this.tool === 'shape' && this.activeStart) {
                this.schedulePaint();
            }
        }
    };

    private getDocumentContentBounds(): DocumentContentBounds {
        const { left: contentLeft, width: contentWidth } = this.getContentGeometry();
        const scrollerRect = this.scroller.getBoundingClientRect();

        let contentTop = 0;
        let contentBottom = 0;

        // Collect any explicit apolo-space blocks
        const spaceBlocks: SpaceBlockRegion[] = [];
        const spaceEls = Array.from(
            this.scroller.querySelectorAll<HTMLElement>('.apolo-space-block, [data-apolo-space], [data-apolo-space-id]')
        );
        for (const s of spaceEls) {
            const rect = s.getBoundingClientRect();
            const top = (rect.top - scrollerRect.top + this.currentScrollTop) / this.zoom;
            const bottom = (rect.bottom - scrollerRect.top + this.currentScrollTop) / this.zoom;
            spaceBlocks.push({ top, bottom });
        }

        if (!this.options.readonly && this.editor) {
            const cm = (this.editor as any)?.cm as EditorView | undefined;
            if (cm && cm.state && cm.state.doc) {
                const contentEl = this.scroller.querySelector<HTMLElement>('.cm-content');
                const baseTop = contentEl
                    ? (contentEl.getBoundingClientRect().top - scrollerRect.top + this.currentScrollTop) / this.zoom
                    : 0;

                // Determine first content line (skipping frontmatter properties)
                let firstContentLine = 0;
                try {
                    const cache = this.options.app.metadataCache.getFileCache(this.file);
                    if (cache?.frontmatterPosition) {
                        firstContentLine = cache.frontmatterPosition.end.line + 1;
                    }
                } catch { /* ignore */ }

                const firstLineNum = Math.min(cm.state.doc.lines, Math.max(1, firstContentLine + 1));
                const firstBlock = cm.lineBlockAt(cm.state.doc.line(firstLineNum).from);
                contentTop = baseTop + firstBlock.top;

                const lastBlock = cm.lineBlockAt(cm.state.doc.line(cm.state.doc.lines).from);
                contentBottom = baseTop + lastBlock.bottom;
            }
        } else {
            // Reading Mode: use rendered content blocks
            const rendered = Array.from(
                this.scroller.querySelectorAll<HTMLElement>('[data-apolo-line-start]')
            );
            if (rendered.length > 0) {
                let firstContentLine = 0;
                try {
                    const cache = this.options.app.metadataCache.getFileCache(this.file);
                    if (cache?.frontmatterPosition) {
                        firstContentLine = cache.frontmatterPosition.end.line + 1;
                    }
                } catch { /* ignore */ }

                let minTop = Number.POSITIVE_INFINITY;
                let maxBottom = Number.NEGATIVE_INFINITY;
                for (const el of rendered) {
                    const start = parseInt(el.dataset.apoloLineStart || '0', 10);
                    if (start >= firstContentLine) {
                        const r = el.getBoundingClientRect();
                        const t = (r.top - scrollerRect.top + this.currentScrollTop) / this.zoom;
                        const b = (r.bottom - scrollerRect.top + this.currentScrollTop) / this.zoom;
                        if (t < minTop) minTop = t;
                        if (b > maxBottom) maxBottom = b;
                    }
                }
                contentTop = Number.isFinite(minTop) ? minTop : 0;
                contentBottom = Number.isFinite(maxBottom) ? maxBottom : this.scroller.scrollHeight / this.zoom;
            } else {
                contentBottom = this.scroller.scrollHeight / this.zoom;
            }
        }

        return { contentLeft, contentWidth, contentTop, contentBottom, spaceBlocks };
    }

    private shouldAcceptDrawingPointer(event: PointerEvent): boolean {
        if (!this.penEnabled) return false;

        if (event.pointerType === 'pen' && this.isPenBarrelEvent(event)) {
            return false;
        }

        if (this.findBoxOptionsButtonAt(event.clientX, event.clientY) || this.findBoxHandleAt(event.clientX, event.clientY)) {
            return false;
        }

        // 1. Check if the screen pointer hit a forbidden DOM element (toolbar, estuche, menus, frontmatter, gutters, interactive controls)
        if (isScreenPointForbidden(event.clientX, event.clientY)) {
            return false;
        }

        // 2. Check if pointer is above the forbidden header boundary (title/properties)
        const scrollerRect = this.scroller.getBoundingClientRect();
        const docY = (event.clientY - scrollerRect.top + this.currentScrollTop) / this.zoom;
        const bounds = this.getDocumentContentBounds();
        if (bounds.contentTop > 0 && docY < bounds.contentTop - 4) {
            return false;
        }

        return true;
    }

    private updateCursor(event: PointerEvent, isDrawing = false): void {
        if (!this.penEnabled) {
            this.canvas.style.cursor = '';
            return;
        }

        const isForbidden = !this.shouldAcceptDrawingPointer(event);
        if (isForbidden) {
            this.canvas.style.cursor = 'not-allowed';
        } else {
            this.canvas.style.cursor = 'crosshair';
        }
    }

    private resetCursor(): void {
        this.canvas.style.cursor = this.penEnabled ? 'crosshair' : '';
    }

    // Drawing input lifecycle (normalized to content column width & anchor block)
    private begin(rawPoint: Point, barrel: boolean, rawEvent?: PointerEvent): void {
        if (!this.penEnabled) return;
        if (rawEvent) this.isShiftDown = Boolean(rawEvent.shiftKey);
        if (rawEvent && rawEvent.pointerType === 'pen' && this.isPenBarrelEvent(rawEvent)) {
            return;
        }
        const screenX = rawEvent ? rawEvent.clientX : rawPoint.x;
        const screenY = rawEvent ? rawEvent.clientY : rawPoint.y;
        if (this.findBoxOptionsButtonAt(screenX, screenY) || this.findBoxHandleAt(screenX, screenY)) {
            return;
        }
        if (this.boxMenu?.isOpen()) {
            this.boxMenu.hide();
        }

        // 1. Check if screen pointer hit a forbidden DOM element
        if (isScreenPointForbidden(screenX, screenY)) {
            return;
        }

        const docX = (rawPoint.x + this.currentScrollLeft) / this.zoom;
        const docY = (rawPoint.y + this.currentScrollTop) / this.zoom;

        // With a line / arrow armed, pressing on a port of a closed shape starts a magnetic connector,
        // even over a selected closed shape (whose edge handles / body would otherwise win)
        const selectedForConnector = this.getSelectedShape();
        const startsConnector = this.tool === 'shape' && !barrel &&
            !getShapePlugin(this.shapeType).isClosed &&
            (!selectedForConnector || getShapePlugin(selectedForConnector.shapeType).isClosed) &&
            this.findSnapPort({ x: docX, y: docY }) !== null;

        // Parametric control handles of the selected shape take priority over drawing / moving
        if (!startsConnector && (this.tool === 'lasso' || this.tool === 'shape') && !barrel && this.tryBeginHandleDrag(docX, docY, rawPoint)) {
            this.schedulePaint();
            return;
        }

        // 2. For ink drawing tools, forbid drawing above content top (properties / title)
        const isDrawingTool = this.tool === 'pen' || this.tool === 'highlighter' || this.tool === 'shape';
        if (isDrawingTool) {
            const bounds = this.getDocumentContentBounds();
            const check = isInkAllowedAt(docX, docY, bounds);
            if (!check.allowed) {
                return;
            }
        }

        this.points.clear();
        this.predictor.reset();
        this.resetLiveBake();
        this.strokeStartTime = performance.now();
        if (this.lastPointerDownTime === 0) {
            this.lastPointerDownTime = this.strokeStartTime;
        }

        const { left: contentLeft, width: contentWidth } = this.getContentGeometry();
        this.activeContentLeft = contentLeft;
        this.activeContentWidth = contentWidth;

        this.activeAnchor = this.anchorAt(docX, docY);
        this.activeBlockTop = this.activeAnchor.y;

        this.activeStart = { x: docX, y: docY, pressure: rawPoint.pressure, time: rawPoint.time };

        // Moving existing selection if tapped inside bounds (lasso, or a shape selected with the shape tool)
        const selectionBounds = this.getSelectionDocBounds();
        const canMoveSelection = this.tool === 'lasso' || (this.tool === 'shape' && this.getSelectedShape() !== null);
        this.movingSelection = canMoveSelection && !barrel && !startsConnector && Boolean(
            selectionBounds && contains(selectionBounds, docX, docY, 12)
        );
        this.moveSelectionSnapshot = this.movingSelection ? this.createHistorySnapshot() : null;
        if (this.tool === 'shape' && !this.movingSelection && this.selection.length > 0) {
            // Starting a new shape (or tapping elsewhere) drops the current shape selection
            this.selection = [];
            this.emitSelection();
        }
        this.barrelActive = barrel;

        this.pushWorldPoint(rawPoint);
        this.clearHoldToSnap();
        if (this.isHoldToSnapActive()) {
            this.trackHoldToSnap();
        }

        if (this.tool === 'eraser' || barrel) {
            this.recordHistory();
            const erased = this.eraseAtPoints([this.activeStart]);
            if (erased) {
                this.renderDirty = true;
            }
        }

        this.schedulePaint();
    }

    private move(rawPoints: Point[], barrel: boolean, rawEvent?: PointerEvent): void {
        if (!this.activeStart) return;
        if (rawEvent) this.isShiftDown = Boolean(rawEvent.shiftKey);
        if (this.handleDrag) {
            const last = rawPoints[rawPoints.length - 1];
            if (last) {
                this.updateHandleDrag({
                    x: (last.x + this.currentScrollLeft) / this.zoom,
                    y: (last.y + this.currentScrollTop) / this.zoom,
                });
            }
            return;
        }
        this.barrelActive = barrel;
        if (this.straightenLines && (this.tool === 'pen' || this.tool === 'highlighter') && !this.movingSelection) {
            const lastRaw = rawPoints[rawPoints.length - 1];
            const currentDocPt: Point = {
                x: (lastRaw.x + this.currentScrollLeft) / this.zoom,
                y: (lastRaw.y + this.currentScrollTop) / this.zoom,
                pressure: lastRaw.pressure,
                time: lastRaw.time,
            };
            const { points } = computeStraightLinePoints(this.activeStart, currentDocPt, this.zoom);
            this.points.clear();
            for (let i = 0; i < points.length; i++) {
                const pt = points[i];
                this.points.push(pt.x, pt.y, pt.pressure ?? 0.5, pt.time ?? 0);
            }
            this.hasPrediction = false;
        } else {
            for (let i = 0; i < rawPoints.length; i++) this.pushWorldPoint(rawPoints[i]);
        }

        if (this.isHoldToSnapActive()) {
            this.trackHoldToSnap();
        }

        if (this.tool === 'eraser' || barrel) {
            const worldPoints = rawPoints.map(p => ({
                x: (p.x + this.currentScrollLeft) / this.zoom,
                y: (p.y + this.currentScrollTop) / this.zoom,
            }));
            const erased = this.eraseAtPoints(worldPoints);
            if (erased) {
                this.renderDirty = true;
            }
        }

        if (rawEvent) {
            this.updateCursor(rawEvent, true);
            this.checkAutoScroll(rawEvent);
        }

        if (this.activeAnchor?.blockId.startsWith('space:')) {
            this.checkAutoGrowth(rawPoints);
        }

        if (this.movingSelection && this.points.size > 1) {
            const last = this.points.get(this.points.size - 1);
            const prev = this.points.get(this.points.size - 2);
            let dx = last.x - prev.x;
            let dy = last.y - prev.y;

            const selBounds = this.getSelectionDocBounds();
            if (selBounds) {
                const tol = 5 / this.zoom;
                const otherBounds: SnapTargetBounds[] = [];
                const selSet = new Set(this.selection.map(el => el.id));
                for (const el of this.document.elements) {
                    if (selSet.has(el.id)) continue;
                    if (el.type === 'shape') {
                        otherBounds.push(this.getElementDocBounds(el));
                    }
                }
                const activePredicted = {
                    minX: selBounds.minX + dx,
                    maxX: selBounds.maxX + dx,
                    minY: selBounds.minY + dy,
                    maxY: selBounds.maxY + dy,
                };
                const smart = computeSmartAlignmentGuides(activePredicted, otherBounds, tol);
                dx += smart.deltaX;
                dy += smart.deltaY;
                this.activeAlignmentGuides = smart.guides;
            }

            this.translateSelection(dx, dy, false);
        }

        this.schedulePaint();
    }

    private end(rawPoint: Point, barrel: boolean, releasedAt: number, rawEvent?: PointerEvent): void {
        if (!this.activeStart) return;
        if (rawEvent) this.isShiftDown = Boolean(rawEvent.shiftKey);
        if (this.handleDrag) {
            this.updateHandleDrag({
                x: (rawPoint.x + this.currentScrollLeft) / this.zoom,
                y: (rawPoint.y + this.currentScrollTop) / this.zoom,
            });
            this.finishHandleDrag();
            this.cancel();
            return;
        }
        const lastMotionAt = this.points.size > 0 ? this.points.getTime(this.points.size - 1) : releasedAt;
        if (this.straightenLines && (this.tool === 'pen' || this.tool === 'highlighter') && !this.movingSelection) {
            const currentDocPt: Point = {
                x: (rawPoint.x + this.currentScrollLeft) / this.zoom,
                y: (rawPoint.y + this.currentScrollTop) / this.zoom,
                pressure: rawPoint.pressure,
                time: rawPoint.time,
            };
            const { points } = computeStraightLinePoints(this.activeStart, currentDocPt, this.zoom);
            this.points.clear();
            for (let i = 0; i < points.length; i++) {
                const pt = points[i];
                this.points.push(pt.x, pt.y, pt.pressure ?? 0.5, pt.time ?? 0);
            }
            this.hasPrediction = false;
        } else {
            this.pushWorldPoint(rawPoint);
        }
        const raw = this.readActivePoints();

        if (this.movingSelection) {
            this.movingSelection = false;
            this.activeAlignmentGuides = [];
            const snapshot = this.moveSelectionSnapshot;
            this.moveSelectionSnapshot = null;
            if (this.isTapGesture(this.activeStart, raw[raw.length - 1])) {
                // No real displacement: keep the selection and leave the undo stack untouched
                if (this.tool === 'shape') this.selectShapeAt(this.activeStart);
            } else {
                // The snapshot was taken at pointerdown, so undo restores the pre-move position
                this.commitHistorySnapshot(snapshot ?? this.createHistorySnapshot());
                this.reanchorSelection();
                this.followConnectors(new Set(this.selection.map(el => el.id)));
                this.rebuildIndex();
                this.emitSelection();
                this.renderDirty = true;
                this.persistSoon();
                this.toast?.show('Selección reubicada');
            }
        } else if (this.tool === 'lasso') {
            this.selectLasso(raw);
        } else if (this.tool === 'eraser' || barrel) {
            const endDocPt = {
                x: (rawPoint.x + this.currentScrollLeft) / this.zoom,
                y: (rawPoint.y + this.currentScrollTop) / this.zoom,
            };
            this.eraseAtPoints([endDocPt]);
            this.rebuildIndex();
            this.renderDirty = true;
            this.persistSoon();
        } else if (this.tool === 'shape' && this.isTapGesture(this.activeStart, raw[raw.length - 1])) {
            // Tapping with the shape tool selects an existing shape (exposing its handles) instead of
            // creating a zero-size shape
            this.selectShapeAt(this.activeStart);
        } else {
            this.recordHistory();
            if (this.tool === 'shape') {
                const endPoint = raw[raw.length - 1];
                const snaps = this.resolveConnectorSnaps(this.shapeType, this.activeStart, endPoint);
                this.addShape(this.activeStart, endPoint, this.shapeType, {
                    startSnap: snaps.start,
                    endSnap: snaps.end,
                });
            } else {
                // Hold-to-snap: the live dwell preview wins; otherwise a stationary hold right
                // before release still converts the stroke
                const recognized = this.snapPreview ?? (this.isHoldToSnapActive()
                    ? this.recognizer.recognize(raw, releasedAt, lastMotionAt)
                    : null);
                if (recognized) {
                    this.addRecognizedShape(recognized);
                    this.toast?.show(`Forma reconocida: ${getShapePlugin(recognized.type).name}`);
                } else {
                    this.addStroke(raw);
                }
            }
        }

        if (this.activeAnchor?.blockId.startsWith('space:')) {
            this.checkAutoGrowth([rawPoint]);
            const spaceId = this.activeAnchor.blockId.slice(6);
            const finalHeight = BoxRegistry.getHeight(spaceId);
            if (finalHeight) {
                this.queueSpaceMutation({ type: 'update', id: spaceId, height: finalHeight });
            }
        }

        this.clearHoldToSnap();
        this.points.clear();
        this.predictor.reset();
        this.resetLiveBake();
        this.hasPrediction = false;
        this.activeStart = null;
        this.activeAnchor = null;
        this.barrelActive = false;
        this.isShiftDown = false;
        this.lastPointerDownTime = 0;
        this.pointerDownStartPos = null;
        this.renderDirty = true;
        this.rebuildIndex();
        this.schedulePaint();
        this.persistSoon();
        this.options.eventBus?.emit('canvas:dirty', this.pageId);
    }

    private cancel(): void {
        this.activeAlignmentGuides = [];
        if (this.handleDrag) {
            this.revertHandleDrag();
        }
        this.clearHoldToSnap();
        this.points.clear();
        this.predictor.reset();
        this.resetLiveBake();
        this.hasPrediction = false;
        this.activeStart = null;
        this.activeAnchor = null;
        this.movingSelection = false;
        this.moveSelectionSnapshot = null;
        this.barrelActive = false;
        this.isShiftDown = false;
        this.lastPointerDownTime = 0;
        this.pointerDownStartPos = null;
        this.schedulePaint();
    }

    private resetLiveBake(): void {
        this.liveBakedIndex = 0;
        this.liveBakeSegState = {};
        if (this.liveBakeCtx && this.liveBakeCanvas) {
            this.liveBakeCtx.clearRect(0, 0, this.liveBakeCanvas.width, this.liveBakeCanvas.height);
        }
    }

    private pushWorldPoint(point: Point): void {
        const docX = (point.x + this.currentScrollLeft) / this.zoom;
        const docY = (point.y + this.currentScrollTop) / this.zoom;

        const previousPressure = this.points.size > 0 ? this.points.getPressure(this.points.size - 1) : 0.5;
        const rawPressure = point.pressure === undefined || (point.pressure === 0 && this.points.size > 0)
            ? previousPressure
            : point.pressure;
        const pressure = this.points.size > 0
            ? smoothPressure(previousPressure, rawPressure, 0.70)
            : rawPressure;
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

        const bounds = this.getDocumentContentBounds();
        const runs = splitStrokeIntoValidRuns(points, bounds.contentTop, DEFAULT_INK_LIMITS.topMarginPx);

        for (const run of runs) {
            if (run.length === 0) continue;
            this.createStrokeFromPoints(run);
        }
    }

    private createStrokeFromPoints(validPoints: Point[]): void {
        const anchor = this.activeAnchor ?? this.anchorAt(validPoints[0].x, validPoints[0].y);
        const geom = this.getElementAnchorGeometry(anchor.blockId, anchor.text);
        const isBoxStroke = geom.isBox;
        const spaceId = anchor.blockId.startsWith('space:') ? anchor.blockId.slice(6) : '';
        const isBoxSnap = spaceId ? (BoxRegistry.isSnapActive(spaceId) || !!this.document.boxes?.[spaceId]?.snapToGrid) : false;
        const boxGridDensity = (spaceId && this.document.boxes?.[spaceId]?.gridDensity) || this.gridDensity || 32;

        const flat = new Array<number>(validPoints.length * 4);
        let minU = Number.POSITIVE_INFINITY;
        let maxU = Number.NEGATIVE_INFINITY;
        let minV = Number.POSITIVE_INFINITY;
        let maxV = Number.NEGATIVE_INFINITY;

        for (let i = 0; i < validPoints.length; i++) {
            const offset = i * 4;
            const pt = validPoints[i];
            const rawU = (pt.x - geom.originX) / geom.scaleWidth;
            const rawV = (pt.y - geom.originY) / geom.scaleWidth;
            let { u, v } = sanitizeNormalizedPoint(rawU, rawV, { isBoxStroke });
            if (isBoxStroke && (this.snapGrid || isBoxSnap)) {
                const snapped = snapNormalizedPoint(u, v, boxGridDensity);
                u = snapped.u;
                v = snapped.v;
            }
            flat[offset] = u;
            flat[offset + 1] = v;
            flat[offset + 2] = pt.pressure ?? 0.5;
            flat[offset + 3] = pt.time ?? 0;
            if (u < minU) minU = u;
            if (u > maxU) maxU = u;
            if (v < minV) minV = v;
            if (v > maxV) maxV = v;
        }

        const isHl = this.tool === 'highlighter';
        const element: StrokeElement = {
            id: uuid(),
            type: 'stroke',
            timestamp: Date.now(),
            zIndex: isHl ? 0 : this.document.elements.length + 1,
            blockId: anchor.blockId,
            anchorText: anchor.text,
            points: flat,
            style: {
                ...this.style,
                profile: this.penProfileId,
                isHighlighter: isHl,
            },
            bounds: { minX: minU, maxX: maxU, minY: minV, maxY: maxV },
        };
        this.document.elements.push(element);
        if (element.style.pattern === 'solid' && !isHl) {
            this.getOrCreateStrokeCache(element);
        }
        this.renderDirty = true;
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

    /** Commits a hold-to-snap recognition as a parametric ShapeElement styled like the active pen. */
    private addRecognizedShape(recognized: RecognizedShape): void {
        this.addShape(recognized.start, recognized.end, recognized.type, {
            style: { ...this.style, profile: undefined, isHighlighter: undefined },
            regularize: recognized.regularize,
            vertices: recognized.vertices,
            fill: false,
        });
    }

    private isHoldToSnapActive(): boolean {
        return this.shapeRecognition &&
            !this.straightenLines &&
            !this.barrelActive &&
            !this.movingSelection &&
            (this.tool === 'pen' || this.tool === 'highlighter');
    }

    /**
     * Restarts the dwell timer whenever the stylus travels more than HOLD_TO_SNAP_MOVE_TOLERANCE_PX
     * (screen px). If it then stays put for HOLD_TO_SNAP_DWELL_MS the stroke is classified and, when
     * confident, previewed as a perfect shape until pointerup commits it.
     */
    private trackHoldToSnap(): void {
        if (this.points.size === 0) return;
        const last = { x: this.points.getX(this.points.size - 1), y: this.points.getY(this.points.size - 1) };
        const tolerance = HOLD_TO_SNAP_MOVE_TOLERANCE_PX / this.zoom;
        const anchor = this.dwellAnchor;
        if (anchor && Math.hypot(last.x - anchor.x, last.y - anchor.y) <= tolerance) return;

        this.dwellAnchor = last;
        if (this.snapPreview) {
            // Drawing resumed: drop the preview and keep inking freehand
            this.snapPreview = null;
            this.schedulePaint();
        }
        if (this.dwellTimer !== null) clearTimeout(this.dwellTimer);
        this.dwellTimer = setTimeout(() => this.onHoldToSnapDwell(), HOLD_TO_SNAP_DWELL_MS);
    }

    private onHoldToSnapDwell(): void {
        this.dwellTimer = null;
        if (this.destroyed || !this.activeStart || !this.isHoldToSnapActive()) return;
        const recognized = this.recognizer.classify(this.readActivePoints());
        if (!recognized) return;
        this.snapPreview = recognized;
        try {
            (navigator as Navigator | undefined)?.vibrate?.(12);
        } catch { /* haptics are best effort */ }
        this.schedulePaint();
    }

    private clearHoldToSnap(): void {
        if (this.dwellTimer !== null) {
            clearTimeout(this.dwellTimer);
            this.dwellTimer = null;
        }
        this.dwellAnchor = null;
        this.snapPreview = null;
    }

    /** Wet-canvas preview of the recognized shape (with a faint accent halo) while the stylus is held. */
    private paintSnapPreview(preview: RecognizedShape): void {
        const plugin = getShapePlugin(preview.type);
        const geom: ShapeRenderGeometry = {
            x0: preview.start.x,
            y0: preview.start.y,
            x1: preview.end.x,
            y1: preview.end.y,
            regularize: preview.regularize,
            ...(preview.vertices ? { vertices: preview.vertices.map(v => ({ x: v.x, y: v.y })) } : {}),
        };
        plugin.renderCanvas(this.context, geom, {
            strokeColor: '#2F6BFF',
            strokeWidth: this.style.width + 8 / this.zoom,
            strokeOpacity: 0.18,
            fillEnabled: false,
        });
        plugin.renderCanvas(this.context, geom, {
            strokeColor: this.style.color,
            strokeWidth: this.style.width,
            strokePattern: this.style.pattern,
            strokeOpacity: this.style.opacity,
            fillEnabled: false,
        });
    }

    private addShape(
        start: Point,
        end: Point,
        shapeType: ShapeElement['shapeType'],
        options: {
            style?: StrokeStyle;
            regularize?: boolean;
            vertices?: Point[];
            fill?: boolean;
            /** Magnetic ports the connector endpoints were snapped to (line / arrow only). */
            startSnap?: SnapPortHit | null;
            endSnap?: SnapPortHit | null;
        } = {},
    ): void {
        const isMagnetized = Boolean(options.startSnap || options.endSnap);
        if (options.startSnap) start = { ...start, x: options.startSnap.x, y: options.startSnap.y };
        if (options.endSnap) end = { ...end, x: options.endSnap.x, y: options.endSnap.y };
        const bounds = this.getDocumentContentBounds();
        const forbiddenY = bounds.contentTop > 0 ? bounds.contentTop - DEFAULT_INK_LIMITS.topMarginPx : -Infinity;
        if (bounds.contentTop > 0 && start.y < forbiddenY && end.y < forbiddenY) {
            // Entire shape was in forbidden zone: discard
            return;
        }

        const anchor = this.activeAnchor ?? this.anchorAt(start.x, start.y);
        const geom = this.getElementAnchorGeometry(anchor.blockId, anchor.text);
        const isBoxStroke = geom.isBox;
        const spaceId = anchor.blockId.startsWith('space:') ? anchor.blockId.slice(6) : '';
        const isBoxSnap = spaceId ? (BoxRegistry.isSnapActive(spaceId) || !!this.document.boxes?.[spaceId]?.snapToGrid) : false;
        const boxGridDensity = (spaceId && this.document.boxes?.[spaceId]?.gridDensity) || this.gridDensity || 32;

        // Port positions win over 45° snapping and grid snapping
        const regularize = isMagnetized ? false : (options.regularize ?? Boolean(this.toolState.shape.regularize || this.isShiftDown));
        const plugin = getShapePlugin(shapeType);
        const normalizedGeom = plugin.normalizeGeometry({
            x0: start.x,
            y0: start.y,
            x1: end.x,
            y1: end.y,
            regularize,
            ...(options.vertices ? { vertices: options.vertices.map(v => ({ x: v.x, y: v.y })) } : {}),
        });

        const rawStartU = (normalizedGeom.x0 - geom.originX) / geom.scaleWidth;
        const rawStartV = (normalizedGeom.y0 - geom.originY) / geom.scaleWidth;
        const rawEndU = (normalizedGeom.x1 - geom.originX) / geom.scaleWidth;
        const rawEndV = (normalizedGeom.y1 - geom.originY) / geom.scaleWidth;

        let { u: startU, v: startV } = sanitizeNormalizedPoint(rawStartU, rawStartV, { isBoxStroke });
        let { u: endU, v: endV } = sanitizeNormalizedPoint(rawEndU, rawEndV, { isBoxStroke });

        if (isBoxStroke && (this.snapGrid || isBoxSnap) && !isMagnetized) {
            const snStart = snapNormalizedPoint(startU, startV, boxGridDensity);
            const snEnd = snapNormalizedPoint(endU, endV, boxGridDensity);
            startU = snStart.u; startV = snStart.v;
            endU = snEnd.u; endV = snEnd.v;
        }

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
            style: options.style ? { ...options.style } : {
                ...this.style,
                color: this.toolState.shape.color || this.style.color,
                width: this.toolState.shape.width || this.style.width,
                pattern: this.toolState.shape.pattern || this.style.pattern,
                opacity: this.toolState.shape.opacity !== undefined ? this.toolState.shape.opacity : this.style.opacity,
            },
            regularize,
            fillEnabled: options.fill === false ? false : this.toolState.shape.fillEnabled,
            fillColor: this.toolState.shape.fillColor || this.toolState.shape.color || this.style.color,
            fillOpacity: this.toolState.shape.fillOpacity,
            fillPattern: this.toolState.shape.fillPattern,
            fillDensity: this.toolState.shape.fillDensity,
            bounds: { minX: minU, maxX: maxU, minY: minV, maxY: maxV },
        };
        if (normalizedGeom.vertices) {
            element.vertices = normalizedGeom.vertices.map(v => {
                const { u, v: vv } = sanitizeNormalizedPoint((v.x - geom.originX) / geom.scaleWidth, (v.y - geom.originY) / geom.scaleWidth, { isBoxStroke });
                return { x: u, y: vv };
            });
            element.regularize = false;
            refreshShapeElementBounds(element);
        }
        if (!plugin.isClosed) {
            if (options.startSnap) element.startBinding = { elementId: options.startSnap.elementId, portId: options.startSnap.portId };
            if (options.endSnap) element.endBinding = { elementId: options.endSnap.elementId, portId: options.endSnap.portId };
        }
        this.document.elements.push(element);
        this.options.eventBus?.emit('snap:detected', shapeType, end.x, end.y);
    }

    private getContentGeometry(): { left: number; width: number } {
        const scrollerRect = this.scroller.getBoundingClientRect();
        const candidateSelectors = [
            '.cm-content',
            '.markdown-preview-sizer',
            '.markdown-preview-section',
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
        const cacheKey = anchorText ? `${blockId}#${anchorText}` : blockId;
        const cachedEarly = this.blockPositionCache.get(cacheKey);
        if (cachedEarly !== undefined) return cachedEarly;

        const scrollerRect = this.scroller.getBoundingClientRect();

        // 1. Space block anchor: direct element match in both Live Preview & Reading mode
        if (blockId.startsWith('space:')) {
            const spaceId = blockId.slice(6);
            const spaceEl = this.findSpaceElementById(spaceId);
            if (spaceEl) {
                const top = (spaceEl.getBoundingClientRect().top - scrollerRect.top + this.currentScrollTop) / this.zoom;
                this.blockPositionCache.set(cacheKey, top);
                this.blockPositionCache.set(blockId, top);
                return top;
            }
            const cached = this.blockPositionCache.get(blockId);
            if (cached !== undefined) return cached;

            // Fallback for Edit mode if widget is currently unmounted by CM virtualization
            if (this.editor) {
                const cm = (this.editor as any)?.cm as EditorView | undefined;
                if (cm && cm.state && cm.state.doc) {
                    const docStr = cm.state.doc.toString();
                    const marker = `data-apolo-space="${spaceId}"`;
                    const markerAlt = `data-apolo-space-id="${spaceId}"`;
                    let idx = docStr.indexOf(marker);
                    if (idx === -1) idx = docStr.indexOf(markerAlt);
                    if (idx !== -1) {
                        const lineBlock = cm.lineBlockAt(idx);
                        const contentEl = this.scroller.querySelector<HTMLElement>('.cm-content');
                        const contentTop = contentEl
                            ? (contentEl.getBoundingClientRect().top - scrollerRect.top + this.currentScrollTop) / this.zoom
                            : 0;
                        const top = contentTop + lineBlock.top;
                        this.blockPositionCache.set(cacheKey, top);
                        this.blockPositionCache.set(blockId, top);
                        return top;
                    }
                }
            }
            return 0;
        }

        // 2. Reading mode (preview) anchor resolution
        if (this.options.readonly) {
            const lineMatch = blockId.match(/^line:(\d+)$/);
            if (lineMatch) {
                const targetLine = parseInt(lineMatch[1], 10);
                const rendered = Array.from(this.scroller.querySelectorAll<HTMLElement>('[data-apolo-line-start]'));

                if (rendered.length > 0) {
                    const blockInfos: PreviewBlockInfo[] = rendered.map(el => ({
                        el,
                        start: parseInt(el.dataset.apoloLineStart || '0', 10),
                        end: parseInt(el.dataset.apoloLineEnd || '0', 10),
                        text: el.textContent || '',
                    }));

                    const bestBlockEl = findBestMatchingPreviewBlock(blockInfos, anchorText || '', targetLine);
                    if (bestBlockEl) {
                        const rect = bestBlockEl.getBoundingClientRect();
                        const start = parseInt(bestBlockEl.dataset.apoloLineStart || '0', 10);
                        const end = parseInt(bestBlockEl.dataset.apoloLineEnd || '0', 10);
                        let lineFraction = 0;
                        if (targetLine >= start && targetLine <= end) {
                            const lineOffset = targetLine - start;
                            const totalLinesInBlock = Math.max(1, end - start + 1);
                            lineFraction = lineOffset / totalLinesInBlock;
                        }
                        const top = (rect.top - scrollerRect.top + this.currentScrollTop) / this.zoom + (rect.height / this.zoom) * lineFraction;
                        this.blockPositionCache.set(cacheKey, top);
                        this.blockPositionCache.set(blockId, top);
                        return top;
                    }

                    // If not currently in DOM (e.g. virtualized/offscreen), reuse previously measured position!
                    const cachedOffscreen = this.blockPositionCache.get(cacheKey) ?? this.blockPositionCache.get(blockId);
                    if (cachedOffscreen !== undefined) {
                        return cachedOffscreen;
                    }

                    // Fallback if not directly rendered: find preceding or following rendered block
                    let prevBlock: HTMLElement | null = null;
                    let nextBlock: HTMLElement | null = null;
                    let maxStartBefore = -1;
                    let minStartAfter = Number.POSITIVE_INFINITY;

                    for (const el of rendered) {
                        const start = parseInt(el.dataset.apoloLineStart || '0', 10);
                        const end = parseInt(el.dataset.apoloLineEnd || '0', 10);
                        if (end < targetLine && end > maxStartBefore) {
                            maxStartBefore = end;
                            prevBlock = el;
                        }
                        if (start > targetLine && start < minStartAfter) {
                            minStartAfter = start;
                            nextBlock = el;
                        }
                    }

                    if (prevBlock) {
                        const rect = prevBlock.getBoundingClientRect();
                        const prevBottom = (rect.bottom - scrollerRect.top + this.currentScrollTop) / this.zoom;
                        const prevEnd = parseInt(prevBlock.dataset.apoloLineEnd || '0', 10);
                        const deltaLines = targetLine - prevEnd;
                        const estimatedTop = prevBottom + (deltaLines - 1) * 24;
                        this.blockPositionCache.set(cacheKey, estimatedTop);
                        return estimatedTop;
                    } else if (nextBlock) {
                        const rect = nextBlock.getBoundingClientRect();
                        const nextTop = (rect.top - scrollerRect.top + this.currentScrollTop) / this.zoom;
                        const nextStart = parseInt(nextBlock.dataset.apoloLineStart || '0', 10);
                        const deltaLines = nextStart - targetLine;
                        const estimatedTop = Math.max(0, nextTop - deltaLines * 24);
                        this.blockPositionCache.set(cacheKey, estimatedTop);
                        return estimatedTop;
                    }
                }
            }
        } else if (this.editor) {
            // 3. Edit mode: CodeMirror 6 exact layout coordinate lookup
            const lineMatch = blockId.match(/^line:(\d+)$/);
            if (lineMatch) {
                let targetLine = parseInt(lineMatch[1], 10);
                const cm = (this.editor as any)?.cm as EditorView | undefined;
                if (cm && cm.state && cm.state.doc) {
                    // Match by anchorText if line text shifted or changed
                    if (anchorText) {
                        const docLines: string[] = cm.state.doc.toJSON();
                        const match = findBestMatchingLine(docLines, anchorText, targetLine, 60);
                        if (match) {
                            targetLine = match.line;
                        }
                    }

                    const clampedLineNum = Math.min(cm.state.doc.lines, Math.max(1, targetLine + 1));
                    const line = cm.state.doc.line(clampedLineNum);
                    const lineBlock = cm.lineBlockAt(line.from);
                    const contentEl = this.scroller.querySelector<HTMLElement>('.cm-content');
                    const contentTop = contentEl
                        ? (contentEl.getBoundingClientRect().top - scrollerRect.top + this.currentScrollTop) / this.zoom
                        : 0;
                    const top = contentTop + lineBlock.top;
                    this.blockPositionCache.set(cacheKey, top);
                    this.blockPositionCache.set(blockId, top);
                    return top;
                }
            }
        }

        const cached = this.blockPositionCache.get(cacheKey) ?? this.blockPositionCache.get(blockId);
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

    private getElementAnchorGeometry(blockId: string, anchorText?: string): { originX: number; scaleWidth: number; originY: number; boxHeight: number; isBox: boolean } {
        const scrollerRect = this.scroller.getBoundingClientRect();
        if (blockId.startsWith('space:')) {
            const spaceId = blockId.slice(6);
            const boxH = BoxRegistry.getHeight(spaceId) ?? 280;
            const spaceEl = this.findSpaceElementById(spaceId);
            if (spaceEl) {
                const rect = spaceEl.getBoundingClientRect();
                const originX = (rect.left - scrollerRect.left + this.currentScrollLeft) / this.zoom;
                const scaleWidth = Math.max(1, rect.width / this.zoom);
                const originY = (rect.top - scrollerRect.top + this.currentScrollTop) / this.zoom;
                const elH = Math.max(120, rect.height / this.zoom);
                return { originX, scaleWidth, originY, boxHeight: elH || boxH, isBox: true };
            }
            const cachedTop = this.blockPositionCache.get(blockId);
            const { left: contentLeft, width: contentWidth } = this.getContentGeometry();
            return { originX: contentLeft, scaleWidth: contentWidth, originY: cachedTop ?? 0, boxHeight: boxH, isBox: true };
        }
        const { left: contentLeft, width: contentWidth } = this.getContentGeometry();
        const blockTop = this.getBlockTop(blockId, anchorText);
        return { originX: contentLeft, scaleWidth: contentWidth, originY: blockTop, boxHeight: 0, isBox: false };
    }

    private getElementDocBounds(element: CanvasElement): BoundingBox {
        const geom = this.getElementAnchorGeometry(element.blockId, element.anchorText);
        const halfWidth = (element.style.width || 2) / 2;
        if (element.type === 'shape') {
            const plugin = getShapePlugin(element.shapeType);
            return plugin.computeBounds(
                shapeElementToGeometry(element, geom.originX, geom.originY, geom.scaleWidth),
                element.style.width || 2,
            );
        }
        return {
            minX: geom.originX + element.bounds.minX * geom.scaleWidth - halfWidth,
            maxX: geom.originX + element.bounds.maxX * geom.scaleWidth + halfWidth,
            minY: geom.originY + element.bounds.minY * geom.scaleWidth - halfWidth,
            maxY: geom.originY + element.bounds.maxY * geom.scaleWidth + halfWidth,
        };
    }

    private anchorAt(docX: number, docY: number): Anchor {
        const scrollerRect = this.scroller.getBoundingClientRect();
        const { left: contentLeft, width: contentWidth } = this.getContentGeometry();

        // 1. Check if (docX, docY) falls inside any apolo-space box (both Live Preview & Reading mode).
        // Strokes starting within the box bounds belong to that box.
        // Strokes starting in the margins are freehand ink and are NOT assigned to the box.
        const spaceBlocks = Array.from(
            this.scroller.querySelectorAll<HTMLElement>('.apolo-space-block, [data-apolo-space], [data-apolo-space-id]')
        );
        for (const blockEl of spaceBlocks) {
            const spaceId = blockEl.dataset.apoloSpaceId || blockEl.dataset.apoloSpace;
            if (!spaceId) continue;
            const rect = blockEl.getBoundingClientRect();
            const boxLeft = (rect.left - scrollerRect.left + this.currentScrollLeft) / this.zoom;
            const boxRight = (rect.right - scrollerRect.left + this.currentScrollLeft) / this.zoom;
            const blockTop = (rect.top - scrollerRect.top + this.currentScrollTop) / this.zoom;
            const blockBottom = (rect.bottom - scrollerRect.top + this.currentScrollTop) / this.zoom;
            if (docX >= boxLeft && docX <= boxRight && docY >= blockTop && docY <= blockBottom) {
                const spaceBlockId = `space:${spaceId}`;
                this.blockPositionCache.set(spaceBlockId, blockTop);
                return {
                    blockId: spaceBlockId,
                    text: '',
                    y: blockTop,
                    isBox: true,
                };
            }
        }

        // 2. Edit mode: CodeMirror 6 exact layout coordinate lookup
        if (!this.options.readonly && this.editor) {
            const cm = (this.editor as any)?.cm as EditorView | undefined;
            if (cm && cm.state && cm.state.doc) {
                const contentEl = this.scroller.querySelector<HTMLElement>('.cm-content');
                const contentTop = contentEl
                    ? (contentEl.getBoundingClientRect().top - scrollerRect.top + this.currentScrollTop) / this.zoom
                    : 0;
                const localY = Math.max(0, docY - contentTop);
                const lineBlock = cm.lineBlockAtHeight(localY);
                const line = cm.state.doc.lineAt(lineBlock.from);
                const lineIndex = line.number - 1; // 0-based
                let text = line.text.trim();
                let anchorLine = lineIndex;
                let blockTop = contentTop + lineBlock.top;

                // If drawing on an empty line, look upwards for nearest preceding line with real text
                // so we don't anchor with empty text to frontmatter '---'
                if (!text) {
                    for (let l = line.number - 1; l >= 1; l--) {
                        const prevLine = cm.state.doc.line(l);
                        const prevText = prevLine.text.trim();
                        if (prevText && prevText !== '---') {
                            text = prevText;
                            anchorLine = l - 1;
                            const prevBlock = cm.lineBlockAt(prevLine.from);
                            blockTop = contentTop + prevBlock.top;
                            break;
                        }
                    }
                }

                const resBlockId = `line:${anchorLine}`;
                this.blockPositionCache.set(resBlockId, blockTop);
                if (text) {
                    this.blockPositionCache.set(`${resBlockId}#${text}`, blockTop);
                }
                return {
                    blockId: resBlockId,
                    text,
                    y: blockTop,
                };
            }
        }
        return { blockId: 'line:0', text: '', y: 0 };
    }

    private erase(points: Point[]): void {
        this.eraseAtPoints(points);
    }

    private eraseAtPoints(points: Point[]): boolean {
        if (points.length === 0) return false;
        const radius = Math.max(10, this.eraserRadius);
        const { left: contentLeft, width: contentWidth } = this.getContentGeometry();
        const kept: CanvasElement[] = [];
        let modified = false;

        for (const element of this.document.elements) {
            const blockTop = this.getBlockTop(element.blockId, element.anchorText);
            if (element.type === 'stroke') {
                if (this.eraserMode === 'reticle') {
                    const fragments = splitStrokeDoc(element, points, radius, contentLeft, contentWidth, blockTop, uuid);
                    if (fragments) {
                        kept.push(...fragments);
                        modified = true;
                    } else {
                        kept.push(element);
                    }
                } else {
                    // Stroke Eraser (whole): touching any part of the stroke erases it entirely!
                    if (strokeHitDoc(element, points, radius, contentLeft, contentWidth, blockTop)) {
                        modified = true;
                    } else {
                        kept.push(element);
                    }
                }
            } else {
                if (shapeHitDoc(element, points, radius, contentLeft, contentWidth, blockTop)) {
                    modified = true;
                } else {
                    kept.push(element);
                }
            }
        }

        if (modified) {
            const keptIds = new Set(kept.map(el => el.id));
            for (const el of this.document.elements) {
                if (!keptIds.has(el.id)) {
                    this.strokeCache.delete(el.id);
                }
            }
            this.document.elements = kept;
            // Erasing a connected shape leaves its connectors in place but unbound
            clearDanglingBindings(this.document.elements);
            this.selection = [];
            this.lassoMenu?.hide();
            this.emitSelection();
            this.rebuildIndex();
        }
        return modified;
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
        const hit = [...this.document.elements].reverse().find(element => {
            if (element.type === 'shape') {
                return this.hitTestShapeElement(element, point, 14);
            }
            return contains(this.getElementDocBounds(element), point.x, point.y, 14);
        });
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

    // ---------------------------------------------------------------------
    // Parametric shape editing (control handles + reactive style edits)
    // ---------------------------------------------------------------------

    /** The selected ShapeElement (live document reference) when the selection is exactly one shape. */
    private getSelectedShape(): ShapeElement | null {
        if (this.selection.length !== 1) return null;
        const selected = this.selection[0];
        if (selected.type !== 'shape') return null;
        return this.document.elements.includes(selected) ? selected : null;
    }

    private getShapeDocGeometry(shape: ShapeElement): ShapeRenderGeometry {
        const anchor = this.getElementAnchorGeometry(shape.blockId, shape.anchorText);
        return shapeElementToGeometry(shape, anchor.originX, anchor.originY, anchor.scaleWidth);
    }

    private hitTestShapeElement(shape: ShapeElement, point: Point, tolerance: number): boolean {
        const geom = this.getShapeDocGeometry(shape);
        const rot = geom.rotation ?? shape.rotation ?? 0;
        if (rot !== 0) {
            const plugin = getShapePlugin(shape.shapeType);
            const norm = plugin.normalizeGeometry(geom);
            const cx = (norm.x0 + norm.x1) / 2;
            const cy = (norm.y0 + norm.y1) / 2;
            const inv = rotatePoint(point.x, point.y, cx, cy, -rot);
            return plugin.hitTest(geom, inv, tolerance);
        }
        return getShapePlugin(shape.shapeType).hitTest(geom, point, tolerance);
    }

    private isTapGesture(start: Point, end: Point | undefined): boolean {
        if (!end) return true;
        return Math.hypot(end.x - start.x, end.y - start.y) < SHAPE_TAP_SLOP_PX;
    }

    /** Selects the topmost ShapeElement under `point` (or clears the selection). */
    private selectShapeAt(point: Point): void {
        const hit = [...this.document.elements].reverse().find(
            (el): el is ShapeElement => el.type === 'shape' && this.hitTestShapeElement(el, point, 14),
        );
        this.selection = hit ? [hit] : [];
        this.emitSelection();
    }

    /** Nearest magnetic port of a closed shape within MAGNETIC_SNAP_RADIUS_PX (screen) of `point`. */
    private findSnapPort(point: { x: number; y: number }, excludeId?: string): SnapPortHit | null {
        return findNearestSnapPort(
            this.document.elements,
            point,
            MAGNETIC_SNAP_RADIUS_PX / this.zoom,
            this.connectorAdapter,
            excludeId,
        );
    }

    /** Ports that a line / arrow being drawn from `start` to `end` snaps to (none for closed shapes). */
    private resolveConnectorSnaps(
        shapeType: ShapeType,
        start: { x: number; y: number },
        end: { x: number; y: number },
    ): { start: SnapPortHit | null; end: SnapPortHit | null } {
        if (getShapePlugin(shapeType).isClosed) return { start: null, end: null };
        const startSnap = this.findSnapPort(start);
        let endSnap = this.findSnapPort(end);
        if (endSnap && startSnap && endSnap.elementId === startSnap.elementId && endSnap.portId === startSnap.portId) {
            endSnap = null;
        }
        return { start: startSnap, end: endSnap };
    }

    /**
     * Re-glues connectors bound to any of `changedIds` and releases bindings whose target vanished.
     * Returns true when at least one connector moved.
     */
    private followConnectors(changedIds: ReadonlySet<string>): boolean {
        if (changedIds.size === 0) return false;
        const updated = followBoundConnectors(this.document.elements, changedIds, this.connectorAdapter);
        if (updated.length > 0) this.renderDirty = true;
        return updated.length > 0;
    }

    /** Magnetic feedback: the target shape's ports as dots plus a halo ring on the matched port. */
    private paintSnapTargets(hits: Array<SnapPortHit | null | undefined>): void {
        const ctx = this.context;
        const accent = '#2F6BFF';
        const painted = new Set<string>();
        ctx.save();
        ctx.setLineDash([]);
        for (const hit of hits) {
            if (!hit) continue;
            if (!painted.has(hit.elementId)) {
                painted.add(hit.elementId);
                const target = this.document.elements.find(el => el.id === hit.elementId);
                if (target && target.type === 'shape') {
                    ctx.fillStyle = accent;
                    ctx.globalAlpha = 0.45;
                    for (const port of getShapePlugin(target.shapeType).getSnapPorts(this.getShapeDocGeometry(target))) {
                        ctx.beginPath();
                        ctx.arc(port.x, port.y, 2.5 / this.zoom, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
            ctx.globalAlpha = 1;
            ctx.strokeStyle = accent;
            ctx.lineWidth = 2 / this.zoom;
            ctx.beginPath();
            ctx.arc(hit.x, hit.y, 6 / this.zoom, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }

    /** Starts dragging a control handle of the selected shape when (docX, docY) is within the pick radius. */
    private tryBeginHandleDrag(docX: number, docY: number, rawPoint: Point): boolean {
        const shape = this.getSelectedShape();
        if (!shape) return false;
        const geom = this.getShapeDocGeometry(shape);
        const hitRadius = SHAPE_HANDLE_HIT_RADIUS_PX / this.zoom;
        let best: { id: string; kind: ShapeHandleKind; x: number; y: number } | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const handle of getShapePlugin(shape.shapeType).getControlHandles(geom)) {
            const distance = Math.hypot(handle.x - docX, handle.y - docY);
            if (distance <= hitRadius && distance < bestDistance) {
                best = handle;
                bestDistance = distance;
            }
        }
        if (!best) {
            if ((shape.shapeType === 'line' || shape.shapeType === 'arrow') && linearPathHit(geom, { x: docX, y: docY }, hitRadius)) {
                const inserted = insertLinearNodeAtPoint(geom, { x: docX, y: docY });
                if (inserted) {
                    const anchor = this.getElementAnchorGeometry(shape.blockId, shape.anchorText);
                    this.recordHistory();
                    applyGeometryToShapeElement(shape, inserted.geom, anchor.originX, anchor.originY, anchor.scaleWidth);
                    this.strokeCache.delete(shape.id);
                    this.rebuildIndex();
                    this.renderDirty = true;
                    this.schedulePaint();
                    this.persistSoon();

                    this.points.clear();
                    this.predictor.reset();
                    this.resetLiveBake();
                    this.movingSelection = false;
                    this.activeStart = { x: docX, y: docY, pressure: rawPoint.pressure, time: rawPoint.time };
                    this.handleDrag = {
                        elementId: shape.id,
                        handleId: inserted.handleId,
                        kind: 'vertex',
                        startGeom: inserted.geom,
                        grabOffsetX: 0,
                        grabOffsetY: 0,
                        snapshot: this.createHistorySnapshot(),
                        changed: false,
                        snap: null,
                    };
                    return true;
                }
            }
            return false;
        }

        const now = performance.now();
        const hitRadiusPx = SHAPE_HANDLE_HIT_RADIUS_PX / this.zoom;
        const isDoubleTap = Boolean(
            this.lastHandleTap &&
            this.lastHandleTap.shapeId === shape.id &&
            this.lastHandleTap.handleId === best.id &&
            (now - this.lastHandleTap.time < 350) &&
            Math.hypot(best.x - this.lastHandleTap.x, best.y - this.lastHandleTap.y) < hitRadiusPx * 2
        );
        this.lastHandleTap = { shapeId: shape.id, handleId: best.id, time: now, x: best.x, y: best.y };

        if (isDoubleTap) {
            let nextGeom: ShapeRenderGeometry | null = null;
            if (best.id.startsWith('seg-mid-') || best.id === 'curve') {
                const segIdx = best.id.startsWith('seg-mid-') ? parseInt(best.id.slice('seg-mid-'.length), 10) : 0;
                const nodes = getLinearPathNodes(geom);
                const n0 = nodes[segIdx];
                const n1 = nodes[segIdx + 1];
                const isCurved = Boolean(n0?.handleOut || n1?.handleIn);
                nextGeom = isCurved
                    ? straightenLinearSegment(geom, segIdx)
                    : splitLinearSegment(geom, segIdx);
            } else if (best.id.startsWith('node-')) {
                const nodeIdx = parseInt(best.id.slice('node-'.length), 10);
                nextGeom = toggleLinearNodeKind(geom, nodeIdx);
            }
            if (nextGeom) {
                const anchor = this.getElementAnchorGeometry(shape.blockId, shape.anchorText);
                this.recordHistory();
                applyGeometryToShapeElement(shape, nextGeom, anchor.originX, anchor.originY, anchor.scaleWidth);
                this.strokeCache.delete(shape.id);
                this.rebuildIndex();
                this.renderDirty = true;
                this.schedulePaint();
                this.persistSoon();
                this.options.eventBus?.emit('canvas:dirty', this.pageId);
                return true;
            }
        }

        this.points.clear();
        this.predictor.reset();
        this.resetLiveBake();
        this.movingSelection = false;
        this.activeStart = { x: docX, y: docY, pressure: rawPoint.pressure, time: rawPoint.time };
        this.handleDrag = {
            elementId: shape.id,
            handleId: best.id,
            kind: best.kind,
            startGeom: geom,
            grabOffsetX: best.x - docX,
            grabOffsetY: best.y - docY,
            snapshot: this.createHistorySnapshot(),
            changed: false,
            snap: null,
        };
        return true;
    }

    private updateHandleDrag(docPoint: { x: number; y: number }): void {
        const drag = this.handleDrag;
        if (!drag) return;
        const shape = this.document.elements.find(el => el.id === drag.elementId);
        if (!shape || shape.type !== 'shape') return;

        const plugin = getShapePlugin(shape.shapeType);
        const anchor = this.getElementAnchorGeometry(shape.blockId, shape.anchorText);
        let target = { x: docPoint.x + drag.grabOffsetX, y: docPoint.y + drag.grabOffsetY };
        let regularize = Boolean(this.toolState.shape.regularize || this.isShiftDown);

        // Inverse rotate target point for local slider handles (radius / parametric 3D)
        if (drag.handleId === 'radius' || drag.handleId.startsWith('param-')) {
            if (drag.startGeom.rotation) {
                const norm = plugin.normalizeGeometry(drag.startGeom);
                const cx = (norm.x0 + norm.x1) / 2;
                const cy = (norm.y0 + norm.y1) / 2;
                target = rotatePoint(target.x, target.y, cx, cy, -drag.startGeom.rotation);
            }
        }

        // Connector endpoints magnetize to nearby ports; leaving the 14px radius releases them
        if (isConnectorShape(shape) && (drag.handleId === 'start' || drag.handleId === 'end')) {
            drag.snap = this.findSnapPort(target, shape.id);
            if (drag.snap) {
                target = { x: drag.snap.x, y: drag.snap.y };
                regularize = false;
            }
        }

        const next = plugin.applyHandleDrag(drag.startGeom, drag.handleId, target, regularize);
        applyGeometryToShapeElement(shape, next, anchor.originX, anchor.originY, anchor.scaleWidth);
        shape.regularize = regularize && !drag.snap;

        drag.changed = true;
        this.strokeCache.delete(shape.id);
        // Connectors glued to this shape follow the resize / reshape live
        this.followConnectors(new Set([shape.id]));
        this.renderDirty = true;
        this.schedulePaint();
    }

    private finishHandleDrag(): void {
        const drag = this.handleDrag;
        this.handleDrag = null;
        if (!drag || !drag.changed) return;
        const shape = this.document.elements.find(el => el.id === drag.elementId);
        if (shape && isConnectorShape(shape) && (drag.handleId === 'start' || drag.handleId === 'end')) {
            setBinding(shape, drag.handleId, drag.snap ? { elementId: drag.snap.elementId, portId: drag.snap.portId } : null);
        }
        this.commitHistorySnapshot(drag.snapshot);
        this.rebuildIndex();
        this.emitSelection();
        this.renderDirty = true;
        this.schedulePaint();
        this.persistSoon();
        this.options.eventBus?.emit('canvas:dirty', this.pageId);
    }

    /** Pointer cancelled mid-drag: restore the pre-drag document and keep the shape selected. */
    private revertHandleDrag(): void {
        const drag = this.handleDrag;
        this.handleDrag = null;
        if (!drag || !drag.changed) return;
        this.document.elements = cloneElements(drag.snapshot.elements);
        const restored = this.document.elements.find(el => el.id === drag.elementId);
        this.selection = restored ? [restored] : [];
        this.strokeCache.delete(drag.elementId);
        this.rebuildIndex();
        this.emitSelection();
    }

    /**
     * Reactive editing: style changes made in ToolEstuche / Toolbar while shapes are selected
     * (shape or lasso tool) are applied to those shapes in place, with one undo step per burst.
     */
    private applyStyleToSelectedShapes(patch: ShapeStylePatch): boolean {
        if (this.suppressSelectionStyleSync) return false;
        if (this.tool !== 'shape' && this.tool !== 'lasso') return false;
        const shapes = this.selection.filter((el): el is ShapeElement => el.type === 'shape');
        if (shapes.length === 0) return false;

        const now = Date.now();
        const key = `${shapes.map(s => s.id).join(',')}|${Object.keys(patch).sort().join(',')}`;
        if (now - this.lastShapeStyleEdit.at > SHAPE_STYLE_HISTORY_COALESCE_MS || this.lastShapeStyleEdit.key !== key) {
            this.recordHistory();
        }
        this.lastShapeStyleEdit = { at: now, key };

        for (const shape of shapes) {
            if (patch.color !== undefined) shape.style.color = patch.color;
            if (patch.width !== undefined) shape.style.width = patch.width;
            if (patch.opacity !== undefined) shape.style.opacity = patch.opacity;
            if (patch.pattern !== undefined) shape.style.pattern = patch.pattern;
            if (getShapePlugin(shape.shapeType).isClosed) {
                if (patch.fillEnabled !== undefined) shape.fillEnabled = patch.fillEnabled;
                if (patch.fillColor !== undefined) shape.fillColor = patch.fillColor;
                if (patch.fillPattern !== undefined) shape.fillPattern = patch.fillPattern;
                if (patch.fillOpacity !== undefined) shape.fillOpacity = patch.fillOpacity;
                if (patch.fillDensity !== undefined) shape.fillDensity = patch.fillDensity;
            }
            this.strokeCache.delete(shape.id);
        }

        this.rebuildIndex();
        this.renderDirty = true;
        this.schedulePaint();
        this.persistSoon();
        this.options.eventBus?.emit('canvas:dirty', this.pageId);
        return true;
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
            mapShapeElementPoints(element, (u, v) => ({ x: u + du, y: v + dv }));
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
        const idMap = new Map<string, string>();
        for (let i = 0; i < copies.length; i++) {
            const newId = uuid();
            idMap.set(copies[i].id, newId);
            copies[i].id = newId;
            copies[i].zIndex = offset + i;
            this.shiftElementNormalized(copies[i], du, dv);
            this.document.elements.push(copies[i]);
        }
        // Pasted connectors stay glued only to shapes pasted with them
        for (const copy of copies) {
            if (copy.type !== 'shape') continue;
            for (const end of ['start', 'end'] as const) {
                const binding = end === 'start' ? copy.startBinding : copy.endBinding;
                if (!binding) continue;
                const mapped = idMap.get(binding.elementId);
                setBinding(copy, end, mapped ? { elementId: mapped, portId: binding.portId } : null);
            }
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
        for (const id of ids) {
            this.strokeCache.delete(id);
        }
        this.document.elements = this.document.elements.filter(element => !ids.has(element.id));
        clearDanglingBindings(this.document.elements);
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
            this.strokeCache.delete(element.id);
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
            this.strokeCache.delete(element.id);
        }
        // Connectors dragged without their target let go; connectors glued to moved shapes follow
        releaseDetachedBindings(this.selection);
        this.followConnectors(new Set(this.selection.map(element => element.id)));
        this.rebuildIndex();
        this.emitSelection();
        this.renderDirty = true;
        if (persist) this.persistSoon();
        this.schedulePaint();
    }

    private reanchorSelection(): void {
        for (const element of this.selection) {
            const bounds = this.getElementDocBounds(element);
            const centerX = (bounds.minX + bounds.maxX) / 2;
            const centerY = (bounds.minY + bounds.maxY) / 2;
            const newAnchor = this.anchorAt(centerX, centerY);

            if (newAnchor.blockId !== element.blockId) {
                const oldGeom = this.getElementAnchorGeometry(element.blockId, element.anchorText);
                const newGeom = this.getElementAnchorGeometry(newAnchor.blockId, newAnchor.text);

                if (element.type === 'stroke') {
                    for (let i = 0; i < element.points.length; i += 4) {
                        const docX = oldGeom.originX + element.points[i] * oldGeom.scaleWidth;
                        const docY = oldGeom.originY + element.points[i + 1] * oldGeom.scaleWidth;
                        let newU = (docX - newGeom.originX) / newGeom.scaleWidth;
                        let newV = (docY - newGeom.originY) / newGeom.scaleWidth;
                        if (newGeom.isBox) {
                            newU = Math.max(0, Math.min(1, newU));
                            newV = Math.max(0, newV);
                        }
                        element.points[i] = newU;
                        element.points[i + 1] = newV;
                    }
                    let minU = element.points[0];
                    let maxU = element.points[0];
                    let minV = element.points[1];
                    let maxV = element.points[1];
                    for (let i = 4; i < element.points.length; i += 4) {
                        minU = Math.min(minU, element.points[i]);
                        maxU = Math.max(maxU, element.points[i]);
                        minV = Math.min(minV, element.points[i + 1]);
                        maxV = Math.max(maxV, element.points[i + 1]);
                    }
                    element.bounds = { minX: minU, maxX: maxU, minY: minV, maxY: maxV };
                } else {
                    mapShapeElementPoints(element, (u, v) => {
                        const docX = oldGeom.originX + u * oldGeom.scaleWidth;
                        const docY = oldGeom.originY + v * oldGeom.scaleWidth;
                        let newU = (docX - newGeom.originX) / newGeom.scaleWidth;
                        let newV = (docY - newGeom.originY) / newGeom.scaleWidth;
                        if (newGeom.isBox) {
                            newU = Math.max(0, Math.min(1, newU));
                            newV = Math.max(0, newV);
                        }
                        return { x: newU, y: newV };
                    }, oldGeom.scaleWidth / newGeom.scaleWidth);
                }

                element.blockId = newAnchor.blockId;
                element.anchorText = newAnchor.text;

                // If dropped into a box, expand box if needed to accommodate the ink
                if (newGeom.isBox) {
                    const boxId = newAnchor.blockId.slice(6);
                    const inkBottomPx = element.bounds.maxY * newGeom.scaleWidth;
                    if (inkBottomPx + 36 > newGeom.boxHeight) {
                        const neededH = Math.max(120, Math.ceil(inkBottomPx + 48));
                        this.applyBoxHeight(boxId, neededH);
                        this.queueSpaceMutation({ type: 'update', id: boxId, height: neededH });
                    }
                }
            }
        }
    }

    async insertCanvas(heightOverride?: number): Promise<string> {
        const boxId = 'c_' + Math.random().toString(36).slice(2, 8);
        const defHeight = heightOverride ?? this.options.defaultBoxHeight ?? 120;
        const defGridStyle = this.options.defaultBoxGridStyle ?? 'dots';
        const defGridDensity = this.options.defaultBoxGridDensity ?? 32;
        const defBorder = this.options.defaultBoxBorderOutline ?? false;
        const defBgTheme = this.options.defaultBoxBgTheme ?? 'default';
        const defAccent = this.options.defaultBoxAccentColor ?? 'purple';
        const defCustomBg = this.options.defaultBoxCustomBgColor ?? '';

        // 1. Register box metadata in sidecar and memory BEFORE editor mutations
        if (!this.document.boxes) this.document.boxes = {};
        this.document.boxes[boxId] = {
            height: defHeight,
            gridVisible: defGridStyle !== 'none',
            gridStyle: defGridStyle,
            bgTheme: defBgTheme,
            customBgColor: defCustomBg || undefined,
            accentColor: defAccent,
            gridDensity: defGridDensity,
            borderOutline: defBorder,
        };
        BoxRegistry.setHeight(boxId, defHeight);
        BoxRegistry.setGridVisible(boxId, defGridStyle !== 'none');
        BoxRegistry.setGridStyle(boxId, defGridStyle);
        BoxRegistry.setBgTheme(boxId, defBgTheme);
        if (defCustomBg) BoxRegistry.setCustomBgColor(boxId, defCustomBg);
        BoxRegistry.setAccentColor(boxId, defAccent);
        BoxRegistry.setGridDensity(boxId, defGridDensity);
        BoxRegistry.setBorderOutline(boxId, defBorder);

        // 2. Insert into Markdown
        if (this.editor) {
            const cursor = this.editor.getCursor?.();
            const content = this.editor.getValue();
            const { updatedContent, insertedLine } = insertCanvasIntoMarkdown(
                content,
                boxId,
                defHeight,
                cursor ? cursor.line : undefined,
            );

            if (updatedContent !== content) {
                this.editor.setValue(updatedContent);
                // Move cursor to line after the new canvas box so Live Preview replaces the block immediately
                try {
                    this.editor.setCursor({ line: Math.min(insertedLine + 1, updatedContent.split('\n').length - 1), ch: 0 });
                } catch { /* best effort */ }
                this.requestCmMeasure();
            }
        } else {
            await this.options.app.vault.process(this.file, (content) => {
                const res = insertCanvasIntoMarkdown(content, boxId, defHeight, undefined);
                return res.updatedContent;
            });
        }

        // 3. Clear cache and rebuild index
        this.blockPositionCache.clear();
        this.rebuildIndex();
        this.persistSoon();

        // 4. Activate pen tool
        this.setPenEnabled(true);
        this.setTool('pen');

        // Scroll to the new box and apply fluid entrance animation
        window.setTimeout(() => {
            const boxEl = this.findSpaceElementById(boxId);
            if (boxEl) {
                boxEl.classList.add('apolo-box-enter');
                boxEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 80);

        this.toast?.show('Canvas insertado');
        return boxId;
    }

    private insertSpace(points: Point[]): void {
        if (points.length < 2) return;
        const dy = points[points.length - 1].y - points[0].y;
        if (Math.abs(dy) < 6) return;
        const pivot = points[0].y;

        this.recordHistory();

        const { left: contentLeft, width: contentWidth } = this.getContentGeometry();

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
            const height = Math.max(1, bottom - top);
            const hitMargin = Math.max(16, (44 - height) / 2);
            if (pivot >= top - hitMargin && pivot <= bottom + hitMargin) {
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
                const anchor = this.anchorAt(contentLeft + contentWidth / 2, pivot);
                if (anchor.blockId.startsWith('line:')) {
                    targetLine = parseInt(anchor.blockId.slice(5), 10);
                } else {
                    targetLine = this.editor.lastLine();
                }
            }
            mutation = { id: newId, height: newHeight, isNew: true, remove: false, targetLine };
        }

        if (mutation) {
            this.blockPositionCache.clear();
            this.rebuildIndex();
            // 2. Debounced write to markdown file via vault.process
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

        // If in Edit mode, update the active editor via CodeMirror transaction without
        // polluting the editor's undo history (Transaction.addToHistory.of(false))!
        if (this.editor) {
            try {
                const cm = (this.editor as any)?.cm as EditorView | undefined;
                if (cm && cm.state && cm.state.doc) {
                    const doc = cm.state.doc;
                    const changes: { from: number; to: number; insert: string }[] = [];
                    for (const mut of mutations) {
                        const isDelete = !!mut.remove || mut.type === 'delete';
                        const isInsert = !!mut.isNew || mut.type === 'insert';
                        if (isInsert) continue;

                        const height = mut.height ?? 240;
                        const normalizedMutId = normalizeBoxId(mut.id);
                        const safeMutId = escapeRegExp(normalizedMutId);
                        const safeEscapedMutId = escapeRegExp(htmlEscapeAttribute(normalizedMutId));
                        const mutPattern = safeEscapedMutId === safeMutId ? safeMutId : `(?:${safeEscapedMutId}|${safeMutId})`;
                        const idRegex = new RegExp(`<div\\s+[^>]*data-apolo-space(?:-id)?=["']${mutPattern}["'][^>]*>`, 'i');

                        for (let l = 1; l <= doc.lines; l++) {
                            const line = doc.line(l);
                            if (line.text.includes('data-apolo-space') && idRegex.test(line.text)) {
                                if (isDelete) {
                                    const from = line.from;
                                    const to = l < doc.lines ? doc.line(l + 1).from : line.to;
                                    changes.push({ from, to, insert: '' });
                                } else {
                                    const match = line.text.match(idRegex);
                                    if (match) {
                                        const oldTag = match[0];
                                        let newTag = oldTag;
                                        if (/data-h=["']\d+["']/i.test(newTag)) {
                                            newTag = newTag.replace(/data-h=["']\d+["']/i, `data-h="${height}"`);
                                        } else {
                                            newTag = newTag.replace(/>$/, ` data-h="${height}">`);
                                        }
                                        if (/height:\s*\d+px/i.test(newTag)) {
                                            newTag = newTag.replace(/(height:\s*)\d+px/i, `$1${height}px`);
                                        }
                                        if (newTag !== oldTag) {
                                            const newText = line.text.replace(oldTag, () => newTag);
                                            changes.push({ from: line.from, to: line.to, insert: newText });
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if (changes.length > 0) {
                        changes.sort((a, b) => a.from - b.from);
                        cm.dispatch({
                            changes,
                            annotations: Transaction.addToHistory.of(false),
                        });
                        cm.requestMeasure();
                    }

                    // Fallback path ONLY for insert type mutations
                    const insertMutations = mutations.filter(m => !!m.isNew || m.type === 'insert');
                    if (insertMutations.length > 0) {
                        const currentDoc = cm.state.doc;
                        const docStr = currentDoc.toString();
                        let updated = docStr;
                        for (const mut of insertMutations) {
                            updated = applySpaceMutationToMarkdown(updated, mut);
                        }
                        if (updated !== docStr) {
                            cm.dispatch({
                                changes: { from: 0, to: currentDoc.length, insert: updated },
                                annotations: Transaction.addToHistory.of(false),
                            });
                            cm.requestMeasure();
                        }
                    }
                    return;
                }
            } catch (err) {
                console.error('[ApoloCanvas] Error updating space block via editor transaction:', err);
            }
        }

        try {
            await this.options.app.vault.process(this.file, (content) => {
                let updated = content;
                for (const mut of mutations) {
                    updated = applySpaceMutationToMarkdown(updated, mut);
                }
                return updated;
            });
        } catch (err) {
            console.error('[ApoloCanvas] Error updating space block via vault.process:', err);
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

    private getBoxHeightsSnapshot(): Record<string, number> {
        const heights: Record<string, number> = {};
        if (this.document.boxes) {
            for (const [id, meta] of Object.entries(this.document.boxes)) {
                heights[id] = meta.height;
            }
        }
        return heights;
    }

    private restoreBoxHeights(targetHeights: Record<string, number>): void {
        for (const [boxId, targetH] of Object.entries(targetHeights)) {
            const currentH = BoxRegistry.getHeight(boxId);
            if (currentH !== targetH) {
                this.applyBoxHeight(boxId, targetH);
                this.queueSpaceMutation({ type: 'update', id: boxId, height: targetH });
            }
        }
    }

    private performUndo(): void {
        const snapshot = this.history.pop();
        if (!snapshot) return;
        this.future.push({
            elements: cloneElements(this.document.elements),
            boxHeights: this.getBoxHeightsSnapshot(),
        });
        if (this.future.length > 30) this.future.shift();
        this.document.elements = cloneElements(snapshot.elements);
        if (snapshot.boxHeights) {
            this.restoreBoxHeights(snapshot.boxHeights);
        }
        this.selection = [];
        this.lassoMenu?.hide();
        this.strokeCache.clear();
        this.rebuildIndex();
        this.renderDirty = true;
        this.paint();
        this.persistSoon();
        this.toolbar?.setHistory(this.history.length > 0, this.future.length > 0);
        this.options.eventBus?.emit('history:changed', this.history.length > 0, this.future.length > 0);
        this.toast?.show('Deshecho');
    }

    private performRedo(): void {
        const snapshot = this.future.pop();
        if (!snapshot) return;
        this.history.push({
            elements: cloneElements(this.document.elements),
            boxHeights: this.getBoxHeightsSnapshot(),
        });
        if (this.history.length > 30) this.history.shift();
        this.document.elements = cloneElements(snapshot.elements);
        if (snapshot.boxHeights) {
            this.restoreBoxHeights(snapshot.boxHeights);
        }
        this.selection = [];
        this.lassoMenu?.hide();
        this.strokeCache.clear();
        this.rebuildIndex();
        this.renderDirty = true;
        this.paint();
        this.persistSoon();
        this.toolbar?.setHistory(this.history.length > 0, this.future.length > 0);
        this.options.eventBus?.emit('history:changed', this.history.length > 0, this.future.length > 0);
        this.toast?.show('Rehecho');
    }

    private recordHistory(): void {
        this.commitHistorySnapshot(this.createHistorySnapshot());
    }

    private createHistorySnapshot(): HistorySnapshot {
        return {
            elements: cloneElements(this.document.elements),
            boxHeights: this.getBoxHeightsSnapshot(),
        };
    }

    /** Pushes a snapshot captured earlier (e.g. at pointerdown) onto the undo stack. */
    private commitHistorySnapshot(snapshot: HistorySnapshot): void {
        this.history.push(snapshot);
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
        for (const element of (this.document?.elements || [])) {
            this.index.add(element, this.getElementDocBounds(element));
        }
        this.renderDirty = true;
    }

    private updateDocumentLayoutHint(): void {
        const { left: contentLeft, width: contentWidth } = this.getContentGeometry();
        if (contentWidth > 0) {
            const anchorTops: Record<string, number> = {};
            for (const [key, val] of this.blockPositionCache.entries()) {
                anchorTops[key] = val;
            }
            this.document.layoutHint = {
                contentWidth,
                contentLeft,
                updatedAt: Date.now(),
                anchorTops,
            };
        }
    }

    private updateBoxesMetadata(): void {
        const spaceBlocks = Array.from(
            this.scroller.querySelectorAll<HTMLElement>('.apolo-space-block, [data-apolo-space], [data-apolo-space-id]')
        );
        if (!this.document.boxes) {
            this.document.boxes = {};
        }
        for (const blockEl of spaceBlocks) {
            const spaceId = blockEl.dataset.apoloSpaceId || blockEl.dataset.apoloSpace;
            if (!spaceId) continue;
            const h = parseInt(blockEl.dataset.apoloHeight || blockEl.style.height || '180', 10);
            const existing = this.document.boxes[spaceId] || { height: h };
            existing.height = h;
            const top = this.blockPositionCache.get(`space:${spaceId}`);
            if (top !== undefined) {
                existing.lastTop = top;
            }
            this.document.boxes[spaceId] = existing;
        }
    }

    private persistSoon(): void {
        this.document.updatedAt = Date.now();
        this.updateDocumentLayoutHint();
        this.updateBoxesMetadata();
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

        let changed = false;
        const lineCount = this.editor.lineCount();
        const allLines: string[] = [];
        for (let l = 0; l < lineCount; l++) {
            allLines.push(this.editor.getLine(l));
        }
        const docText = allLines.join('\n');
        const cm = (this.editor as any)?.cm as EditorView | undefined;
        const { width: contentWidth } = this.getContentGeometry();

        for (const element of this.document.elements) {
            // Case 1: Line anchor re-matching using SmartAnchor outward search
            if (element.anchorText && element.blockId.startsWith('line:')) {
                const match = element.blockId.match(/^line:(\d+)$/);
                if (match) {
                    const oldLine = parseInt(match[1], 10);
                    const best = findBestMatchingLine(allLines, element.anchorText, oldLine, 80);
                    if (best && best.line !== oldLine) {
                        element.blockId = `line:${best.line}`;
                        if (best.confidence > 0.8) {
                            element.anchorText = allLines[best.line].trim();
                        }
                        changed = true;
                    }
                }
            }

            // Case 2: Space block anchor - handle deleted space block
            else if (element.blockId.startsWith('space:')) {
                const spaceId = element.blockId.slice(6);
                const marker = `data-apolo-space="${spaceId}"`;
                const markerAlt = `data-apolo-space-id="${spaceId}"`;
                if (!docText.includes(marker) && !docText.includes(markerAlt)) {
                    // Space block was deleted from markdown: reanchor to nearest line
                    const cachedTop = this.blockPositionCache.get(element.blockId);
                    if (cachedTop !== undefined && cm && cm.state && cm.state.doc) {
                        const contentEl = this.scroller.querySelector<HTMLElement>('.cm-content');
                        const scrollerRect = this.scroller.getBoundingClientRect();
                        const contentTop = contentEl
                            ? (contentEl.getBoundingClientRect().top - scrollerRect.top + this.currentScrollTop) / this.zoom
                            : 0;
                        const localY = Math.max(0, cachedTop - contentTop);
                        const lineBlock = cm.lineBlockAtHeight(localY);
                        const line = cm.state.doc.lineAt(lineBlock.from);
                        const newLine = line.number - 1;
                        const newLineTop = contentTop + lineBlock.top;
                        const deltaV = (cachedTop - newLineTop) / contentWidth;

                        element.blockId = `line:${newLine}`;
                        element.anchorText = line.text.trim();
                        element.bounds.minY += deltaV;
                        element.bounds.maxY += deltaV;
                        if (element.type === 'stroke') {
                            for (let i = 1; i < element.points.length; i += 4) {
                                element.points[i] += deltaV;
                            }
                        } else {
                            mapShapeElementPoints(element, (u, v) => ({ x: u, y: v + deltaV }));
                        }
                        changed = true;
                    }
                }
            }
        }

        this.blockPositionCache.clear();
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
        if (!this.options.readonly) return;
        if (this.previewReanchorTimer !== null) {
            window.clearTimeout(this.previewReanchorTimer);
        }
        this.previewReanchorTimer = window.setTimeout(() => {
            this.previewReanchorTimer = null;
            this.reanchorPreview();
        }, 50);
    }

    reanchorPreview(): void {
        if (!this.options.readonly) return;
        this.syncPreviewSpacing();
        if (this.document.elements.length === 0) return;
        this.blockPositionCache.clear();
        this.rebuildIndex();
        this.renderDirty = true;
        this.schedulePaint();
    }

    syncPreviewSpacing(): void {
        if (!this.options.readonly) return;
        const rendered = Array.from(
            this.scroller.querySelectorAll<HTMLElement>('[data-apolo-line-start]')
        );
        if (rendered.length === 0) return;

        // Keep only top-level blocks to avoid conflicting margins on child and parent
        const topLevelBlocks = rendered.filter(el => {
            return !rendered.some(other => other !== el && other.contains(el));
        });

        topLevelBlocks.sort((a, b) => {
            const startA = parseInt(a.dataset.apoloLineStart || '0', 10);
            const startB = parseInt(b.dataset.apoloLineStart || '0', 10);
            return startA - startB;
        });

        let lineHeight = 24;
        if (topLevelBlocks.length > 0) {
            const computedLh = parseFloat(window.getComputedStyle(topLevelBlocks[0]).lineHeight);
            if (!Number.isNaN(computedLh) && computedLh > 0) {
                lineHeight = computedLh;
            }
        }

        let firstContentLine = 0;
        try {
            const cache = this.options.app.metadataCache.getFileCache(this.file);
            if (cache?.frontmatterPosition) {
                firstContentLine = cache.frontmatterPosition.end.line + 1;
            }
        } catch {
            // ignore
        }

        for (let i = 0; i < topLevelBlocks.length; i++) {
            const current = topLevelBlocks[i];
            const currentStart = parseInt(current.dataset.apoloLineStart || '0', 10);

            if (i === 0) {
                // Only apply leadingBlankLines if current is actually at the beginning of content!
                // If currentStart > firstContentLine + 1, preceding blocks are virtualized, NOT blank.
                if (currentStart <= firstContentLine + 1) {
                    const leadingBlankLines = currentStart - firstContentLine;
                    if (leadingBlankLines > 0) {
                        current.style.marginTop = `${leadingBlankLines * lineHeight}px`;
                    } else {
                        current.style.marginTop = '';
                    }
                }
            } else {
                const prev = topLevelBlocks[i - 1];
                // Only apply inter-block spacing if prev and current are immediate DOM siblings
                if (current.previousElementSibling === prev) {
                    const prevEnd = parseInt(prev.dataset.apoloLineEnd || prev.dataset.apoloLineStart || '0', 10);
                    const blankLines = currentStart - prevEnd - 1;

                    if (blankLines > 0) {
                        current.style.marginTop = `${blankLines * lineHeight}px`;
                    } else {
                        current.style.marginTop = '';
                    }
                }
            }
        }

        if (topLevelBlocks.length > 0) {
            const lastBlock = topLevelBlocks[topLevelBlocks.length - 1];
            const lastBlockEnd = parseInt(lastBlock.dataset.apoloLineEnd || lastBlock.dataset.apoloLineStart || '0', 10);
            void this.options.app.vault.cachedRead(this.file).then(content => {
                if (this.destroyed) return;
                const lines = content.split('\n');
                const trailingSlice = lines.slice(lastBlockEnd + 1);
                const areAllTrailingBlank = trailingSlice.length > 0 && trailingSlice.every(l => l.trim() === '');
                if (areAllTrailingBlank) {
                    const trailingBlankLines = trailingSlice.length;
                    lastBlock.style.marginBottom = `${trailingBlankLines * lineHeight}px`;
                } else {
                    lastBlock.style.marginBottom = '';
                }
            }).catch(() => { /* ignore */ });
        }
    }

    private get currentScrollTop(): number {
        return this.scroller.scrollTop;
    }

    private get currentScrollLeft(): number {
        return this.scroller.scrollLeft;
    }

    private updateGridStepProperty(): void {
        const { width: contentWidth } = this.getContentGeometry();
        if (contentWidth > 0 && this.gridDensity > 0) {
            const stepPx = Math.round((contentWidth / this.gridDensity) * 100) / 100;
            this.scroller.style.setProperty('--apolo-grid-step', `${stepPx}px`);
        }
    }

    private positionLayer(): void {
        this.layer.style.top = `${this.currentScrollTop}px`;
        this.layer.style.left = `${this.currentScrollLeft}px`;
        this.updateGridStepProperty();
        this.syncBoxElements();
    }

    private resize(): void {
        if (this.destroyed) return;
        this.updateGridStepProperty();
        this.syncBoxElements();
        const width = Math.max(1, this.scroller.clientWidth);
        const height = Math.max(1, this.scroller.clientHeight);
        const ratio = Math.max(1, window.devicePixelRatio || 1);

        this.layer.style.width = `${width}px`;
        this.layer.style.height = `${height}px`;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        this.dryCanvas.style.width = `${width}px`;
        this.dryCanvas.style.height = `${height}px`;
        this.highlighterDryCanvas.style.width = `${width}px`;
        this.highlighterDryCanvas.style.height = `${height}px`;

        const maxDim = 4096;
        const targetW = Math.min(maxDim, Math.round(width * ratio));
        const targetH = Math.min(maxDim, Math.round(height * ratio));

        if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
            this.canvas.width = targetW;
            this.canvas.height = targetH;
            this.dryCanvas.width = targetW;
            this.dryCanvas.height = targetH;
            this.highlighterDryCanvas.width = targetW;
            this.highlighterDryCanvas.height = targetH;
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
            this.dryContext.setTransform(1, 0, 0, 1, 0, 0);
            this.dryContext.clearRect(0, 0, this.dryCanvas.width, this.dryCanvas.height);
            this.highlighterDryContext.setTransform(1, 0, 0, 1, 0, 0);
            this.highlighterDryContext.clearRect(0, 0, this.highlighterDryCanvas.width, this.highlighterDryCanvas.height);

            const m0 = ratio * this.zoom;
            const m3 = ratio * this.zoom;
            const m4 = -ratio * sLeft;
            const m5 = -ratio * sTop;

            this.dryContext.setTransform(m0, 0, 0, m3, m4, m5);
            this.highlighterDryContext.setTransform(m0, 0, 0, m3, m4, m5);

            const buffer = 200;
            const viewport: BoundingBox = {
                minX: (sLeft - buffer) / this.zoom,
                minY: (sTop - buffer) / this.zoom,
                maxX: (sLeft + width + buffer) / this.zoom,
                maxY: (sTop + height + buffer) / this.zoom,
            };

            this.index.query(viewport, this.visible);
            this.visible.sort((a, b) => a.zIndex - b.zIndex);
            const isDark = isDarkTheme();
            const isPreview = !!this.options.readonly || !!this.scroller.closest('.markdown-preview-view');
            for (const element of this.visible) {
                if (isPreview && element.blockId?.startsWith('space:')) {
                    const spaceId = element.blockId.slice(6);
                    const spaceEl = this.findSpaceElementById(spaceId);
                    if (spaceEl?.querySelector('.apolo-box-preview-svg')) {
                        continue;
                    }
                }
                if (this.isHighlighter(element)) {
                    this.paintHighlighterStroke(element as StrokeElement, this.highlighterDryContext, isDark);
                } else {
                    this.paintElement(element, this.dryContext);
                }
            }
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

        if (this.points.size > 0 && this.activeStart && !this.movingSelection && !this.handleDrag) {
            if (this.tool === 'lasso') {
                this.paintLasso();
            } else {
                this.paintActive();
            }
        }

        if (this.selection.length) this.paintSelection();
        this.paintAlignmentGuides();
        this.context.setTransform(1, 0, 0, 1, 0, 0);
    }

    private paintElement(element: CanvasElement, context: CanvasRenderingContext2D): void {
        const geom = this.getElementAnchorGeometry(element.blockId, element.anchorText);
        const contentLeft = geom.originX;
        const contentWidth = geom.scaleWidth;
        const blockTop = geom.originY;

        context.save();
        if (geom.isBox) {
            context.beginPath();
            context.rect(contentLeft, blockTop, contentWidth, geom.boxHeight);
            context.clip();
        }

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
                this.paintShape(element, context, contentLeft, contentWidth, blockTop, {
                    strokeColor: '#6C3FD1',
                    strokeWidth: element.style.width + 8,
                    strokeOpacity: 0.25,
                    fillEnabled: false,
                });
            }
            context.restore();
        }

        context.strokeStyle = element.style.color;
        context.lineWidth = element.style.width;
        context.globalAlpha = element.style.opacity;
        context.lineCap = element.style.lineCap ?? 'round';
        context.lineJoin = 'round';
        if (element.type !== 'stroke' || element.style.pattern === 'solid') {
            applyStrokePattern(context, element.style.pattern, element.style.width, element.style.lineCap ?? 'round');
        }

        if (element.type === 'stroke') {
            const data = element.points;
            if (data.length >= 4) {
                if (element.style.pattern !== 'solid') {
                    drawPatternedStrokePath(context, data, contentLeft, contentWidth, blockTop, element.style);
                } else {
                    const cacheCanvas = this.getOrCreateStrokeCache(element);
                    if (cacheCanvas && typeof context.drawImage === 'function') {
                        const meta = (cacheCanvas as any)._cacheMeta;
                        const pad = meta?.pad ?? (Math.ceil(element.style.width * 2) + 8);
                        const cssW = meta?.cssW ?? cacheCanvas.width;
                        const cssH = meta?.cssH ?? cacheCanvas.height;
                        const docMinX = contentLeft + element.bounds.minX * contentWidth;
                        const docMinY = blockTop + element.bounds.minY * contentWidth;
                        context.save();
                        context.globalAlpha = 1;
                        context.drawImage(cacheCanvas, docMinX - pad, docMinY - pad, cssW, cssH);
                        context.restore();
                    } else {
                        const points: { x: number; y: number; pressure?: number; time?: number }[] = [];
                        for (let i = 0; i < data.length; i += 4) {
                            points.push({
                                x: contentLeft + data[i] * contentWidth,
                                y: blockTop + data[i + 1] * contentWidth,
                                pressure: data[i + 2],
                                time: data[i + 3],
                            });
                        }
                        renderContinuousSolidStroke(context, points, element.style);
                    }
                }
            }
        } else {
            this.paintShape(element, context, contentLeft, contentWidth, blockTop);
        }

        context.setLineDash([]);
        context.restore();
    }

    private getOrCreateStrokeCache(el: StrokeElement): HTMLCanvasElement | null {
        const geom = this.getElementAnchorGeometry(el.blockId, el.anchorText);
        const ratio = Math.max(1, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
        return getOrCreateStrokeSprite(el, this.strokeCache, geom, this.zoom, ratio);
    }

    private getOrCreatePencilCache(el: StrokeElement): HTMLCanvasElement | null {
        return this.getOrCreateStrokeCache(el);
    }

    private isHighlighter(element: CanvasElement): boolean {
        if (element.type !== 'stroke') return false;
        if (element.style.isHighlighter) return true;
        if (element.style.profile === 'hlr' || element.style.profile === 'hlf') return true;
        if (element.style.opacity <= 0.6 && (element.style.color === '#F5C400' || element.style.width >= 10)) {
            return true;
        }
        return false;
    }

    private paintHighlighterStroke(
        element: StrokeElement,
        context: CanvasRenderingContext2D,
        isDark: boolean,
    ): void {
        const geom = this.getElementAnchorGeometry(element.blockId, element.anchorText);
        const contentLeft = geom.originX;
        const contentWidth = geom.scaleWidth;
        const blockTop = geom.originY;
        const data = element.points;
        if (data.length < 4) return;

        context.save();
        if (geom.isBox) {
            context.beginPath();
            context.rect(contentLeft, blockTop, contentWidth, geom.boxHeight);
            context.clip();
        }
        context.globalCompositeOperation = isDark ? 'screen' : 'multiply';
        context.strokeStyle = element.style.color;
        context.lineWidth = element.style.width;
        context.globalAlpha = element.style.opacity || 0.45;
        context.lineCap = element.style.lineCap ?? 'round';
        context.lineJoin = 'round';

        if (data.length === 4) {
            context.beginPath();
            context.arc(
                contentLeft + data[0] * contentWidth,
                blockTop + data[1] * contentWidth,
                element.style.width / 2,
                0,
                Math.PI * 2,
            );
            context.fillStyle = element.style.color;
            context.fill();
        } else {
            // Continuous single-path stroke: prevents internal double-blend cap seams!
            context.beginPath();
            context.moveTo(contentLeft + data[0] * contentWidth, blockTop + data[1] * contentWidth);
            for (let i = 4; i < data.length; i += 4) {
                context.lineTo(contentLeft + data[i] * contentWidth, blockTop + data[i + 1] * contentWidth);
            }
            context.stroke();
        }

        context.restore();
    }

    private paintEraserReticle(): void {
        if (this.points.size === 0) return;
        const context = this.context;
        const lastX = this.points.getX(this.points.size - 1);
        const lastY = this.points.getY(this.points.size - 1);
        const radius = Math.max(10, this.eraserRadius);

        context.save();
        context.beginPath();
        context.arc(lastX, lastY, radius, 0, Math.PI * 2);
        context.fillStyle = 'rgba(239, 68, 68, 0.12)';
        context.fill();

        context.strokeStyle = this.eraserMode === 'whole' ? '#EF4444' : '#F97316';
        context.lineWidth = 1.8 / this.zoom;
        if (this.eraserMode === 'whole') {
            context.setLineDash([]);
            context.stroke();

            context.beginPath();
            context.arc(lastX, lastY, 2.5 / this.zoom, 0, Math.PI * 2);
            context.fillStyle = '#EF4444';
            context.fill();
        } else {
            context.setLineDash([4, 4]);
            context.stroke();
        }
        context.restore();
    }

    private paintShape(
        shape: ShapeElement,
        context: CanvasRenderingContext2D,
        contentLeft: number,
        contentWidth: number,
        blockTop: number,
        styleOverride?: Partial<ShapeStyleConfig>,
    ): void {
        const plugin = getShapePlugin(shape.shapeType);
        const geom = shapeElementToGeometry(shape, contentLeft, blockTop, contentWidth);
        const rot = geom.rotation ?? shape.rotation ?? 0;
        if (rot !== 0) {
            const norm = plugin.normalizeGeometry(geom);
            const cx = (norm.x0 + norm.x1) / 2;
            const cy = (norm.y0 + norm.y1) / 2;
            context.save();
            context.translate(cx, cy);
            context.rotate(rot);
            context.translate(-cx, -cy);
            plugin.renderCanvas(context, geom, shapeElementStyle(shape, styleOverride));
            context.restore();
        } else {
            plugin.renderCanvas(context, geom, shapeElementStyle(shape, styleOverride));
        }
    }

    private paintActive(): void {
        if (this.tool === 'eraser' || this.barrelActive) {
            this.paintEraserReticle();
            return;
        }

        if (this.snapPreview && (this.tool === 'pen' || this.tool === 'highlighter')) {
            this.paintSnapPreview(this.snapPreview);
            return;
        }

        const context = this.context;
        const bounds = this.getDocumentContentBounds();
        const forbiddenY = bounds.contentTop > 0 ? bounds.contentTop - DEFAULT_INK_LIMITS.topMarginPx : -Infinity;
        const isDark = isDarkTheme();

        context.save();

        if (this.activeAnchor && this.activeAnchor.blockId.startsWith('space:')) {
            const geom = this.getElementAnchorGeometry(this.activeAnchor.blockId);
            context.beginPath();
            context.rect(geom.originX, geom.originY, geom.scaleWidth, geom.boxHeight);
            context.clip();
        }

        if (this.tool === 'shape') {
            if (this.activeStart && this.points.size > 0) {
                const shapeType = this.toolState.shape.shapeType || this.shapeType || 'rectangle';
                const shapePlugin = getShapePlugin(shapeType);

                const lastDocPt = {
                    x: this.points.getX(this.points.size - 1),
                    y: this.points.getY(this.points.size - 1),
                };

                const snaps = this.resolveConnectorSnaps(shapeType, this.activeStart, lastDocPt);
                const regularize = !snaps.start && !snaps.end && Boolean(this.toolState.shape.regularize || this.isShiftDown);
                const geom = shapePlugin.normalizeGeometry({
                    x0: snaps.start?.x ?? this.activeStart.x,
                    y0: snaps.start?.y ?? this.activeStart.y,
                    x1: snaps.end?.x ?? lastDocPt.x,
                    y1: snaps.end?.y ?? lastDocPt.y,
                    regularize,
                });
                this.paintSnapTargets([snaps.start, snaps.end]);

                const styleConfig: ShapeStyleConfig = {
                    strokeColor: this.toolState.shape.color || this.style.color,
                    strokeWidth: this.toolState.shape.width || this.style.width,
                    strokePattern: this.toolState.shape.pattern || this.style.pattern,
                    strokeOpacity: this.toolState.shape.opacity !== undefined ? this.toolState.shape.opacity : this.style.opacity,
                    fillEnabled: this.toolState.shape.fillEnabled,
                    fillColor: this.toolState.shape.fillColor || this.toolState.shape.color || this.style.color,
                    fillOpacity: this.toolState.shape.fillOpacity,
                    fillPattern: this.toolState.shape.fillPattern,
                    fillDensity: this.toolState.shape.fillDensity,
                };

                shapePlugin.renderCanvas(context, geom, styleConfig);
            }
            context.restore();
            return;
        }

        if (this.tool === 'highlighter') {
            context.globalCompositeOperation = isDark ? 'screen' : 'multiply';
            context.strokeStyle = this.style.color;
            context.lineWidth = this.style.width;
            context.globalAlpha = this.style.opacity || 0.45;
            context.lineCap = this.style.lineCap ?? 'round';
            context.lineJoin = 'round';

            if (this.points.size === 1) {
                const isForbidden = bounds.contentTop > 0 && this.points.getY(0) < forbiddenY;
                if (!isForbidden) {
                    context.beginPath();
                    context.arc(this.points.getX(0), this.points.getY(0), this.style.width / 2, 0, Math.PI * 2);
                    context.fillStyle = this.style.color;
                    context.fill();
                }
            } else if (this.points.size > 1) {
                context.beginPath();
                context.moveTo(this.points.getX(0), this.points.getY(0));
                for (let i = 1; i < this.points.size; i++) {
                    context.lineTo(this.points.getX(i), this.points.getY(i));
                }
                context.stroke();
            }

            if (!this.straightenLines && this.hasPrediction && this.points.size > 0) {
                const isPredForbidden = bounds.contentTop > 0 && this.predictedPoint.y < forbiddenY;
                if (!isPredForbidden) {
                    context.beginPath();
                    context.moveTo(this.points.getX(this.points.size - 1), this.points.getY(this.points.size - 1));
                    context.lineTo(this.predictedPoint.x, this.predictedPoint.y);
                    context.stroke();
                }
            }

            context.restore();
            return;
        }

        if (this.style.pattern !== 'solid') {
            this.paintActivePatternedStroke(context);
            context.setLineDash([]);
            context.restore();
            return;
        }

        if (this.activeAnchor) {
            const rawPoints = this.readActivePoints();
            const validRuns = splitStrokeIntoValidRuns(
                rawPoints,
                bounds.contentTop,
                DEFAULT_INK_LIMITS.topMarginPx,
            );
            const activeStyle: StrokeStyle = { ...this.style, profile: this.penProfileId };
            const penPlugin = getPenPlugin(this.penProfileId);

            if (!this.straightenLines && validRuns.length === 1 && validRuns[0].length === rawPoints.length) {
                const ratio = Math.max(1, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
                const boxClip = this.activeAnchor.blockId.startsWith('space:')
                    ? this.getElementAnchorGeometry(this.activeAnchor.blockId)
                    : null;
                const baked = bakeLiveStrokeSegment(
                    this as unknown as LiveBakeState,
                    context,
                    validRuns[0],
                    activeStyle,
                    this.penProfileId,
                    this.canvas.width,
                    this.canvas.height,
                    this.zoom,
                    this.currentScrollLeft,
                    this.currentScrollTop,
                    ratio,
                    boxClip,
                );
                if (!baked) {
                    for (const run of validRuns) {
                        renderContinuousSolidStroke(context, run, activeStyle);
                    }
                }
            } else {
                for (const run of validRuns) {
                    renderContinuousSolidStroke(context, run, activeStyle);
                }
            }
        }
        context.restore();

        if (!this.straightenLines && this.hasPrediction && this.points.size > 0) {
            context.save();
            const isPredForbidden = bounds.contentTop > 0 && this.predictedPoint.y < forbiddenY;
            if (isPredForbidden) {
                context.strokeStyle = 'rgba(140, 149, 159, 0.35)';
                context.globalAlpha = 1;
                context.setLineDash([6, 10]);
            } else {
                context.strokeStyle = this.style.color;
                context.globalAlpha = this.style.opacity * 0.55;
                context.setLineDash([3, 3]);
            }
            context.lineWidth = this.style.width;
            context.beginPath();
            context.moveTo(this.points.getX(this.points.size - 1), this.points.getY(this.points.size - 1));
            context.lineTo(this.predictedPoint.x, this.predictedPoint.y);
            context.stroke();
            context.restore();
        }
    }

    private paintActivePatternedStroke(context: CanvasRenderingContext2D): void {
        if (!this.activeAnchor || this.points.size === 0) return;

        const anchor = this.activeAnchor;
        const geometry = this.getElementAnchorGeometry(anchor.blockId, anchor.text);
        const points = this.points.toArray();

        for (let i = 0; i < points.length; i += 4) {
            const x = (points[i] - geometry.originX) / geometry.scaleWidth;
            const y = (points[i + 1] - geometry.originY) / geometry.scaleWidth;
            points[i] = x;
            points[i + 1] = y;
        }

        const activeStyle: StrokeStyle = { ...this.style, profile: this.penProfileId };
        drawPatternedStrokePath(
            context,
            points,
            geometry.originX,
            geometry.scaleWidth,
            geometry.originY,
            activeStyle,
        );
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

    private paintAlignmentGuides(): void {
        if (!this.activeAlignmentGuides || this.activeAlignmentGuides.length === 0) return;
        const ctx = this.context;
        ctx.save();
        ctx.strokeStyle = '#FF2D78';
        ctx.lineWidth = 1 / this.zoom;
        ctx.setLineDash([4 / this.zoom, 3 / this.zoom]);
        ctx.beginPath();
        for (const g of this.activeAlignmentGuides) {
            if (g.axis === 'x') {
                ctx.moveTo(g.position, g.from);
                ctx.lineTo(g.position, g.to);
            } else {
                ctx.moveTo(g.from, g.position);
                ctx.lineTo(g.to, g.position);
            }
        }
        ctx.stroke();
        ctx.restore();
    }

    private paintSelection(): void {
        const selectedShape = this.getSelectedShape();
        if (selectedShape) {
            this.paintShapeSelection(selectedShape);
            return;
        }
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

    /** Selection chrome of a single shape: light outline plus its parametric control handles. */
    private paintShapeSelection(shape: ShapeElement): void {
        const plugin = getShapePlugin(shape.shapeType);
        const geom = this.getShapeDocGeometry(shape);
        const norm = plugin.normalizeGeometry(geom);
        const bounds = this.getElementDocBounds(shape);
        const ctx = this.context;
        const accent = '#2F6BFF';
        const padding = 6;

        ctx.save();
        const rot = norm.rotation || shape.rotation || 0;
        if (rot !== 0) {
            const cx = (norm.x0 + norm.x1) / 2;
            const cy = (norm.y0 + norm.y1) / 2;
            ctx.translate(cx, cy);
            ctx.rotate(rot);
            ctx.translate(-cx, -cy);
        }
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1 / this.zoom;
        ctx.setLineDash([4 / this.zoom, 3 / this.zoom]);
        const rMinX = Math.min(norm.x0, norm.x1);
        const rMaxX = Math.max(norm.x0, norm.x1);
        const rMinY = Math.min(norm.y0, norm.y1);
        const rMaxY = Math.max(norm.y0, norm.y1);
        ctx.strokeRect(
            rMinX - padding,
            rMinY - padding,
            rMaxX - rMinX + padding * 2,
            rMaxY - rMinY + padding * 2,
        );
        ctx.restore();
        ctx.save();

        // Bezier guides: endpoints / nodes → control points
        if (shape.shapeType === 'line' || shape.shapeType === 'arrow') {
            const nodes = getLinearPathNodes(geom);
            ctx.save();
            ctx.strokeStyle = '#00A3FF';
            ctx.globalAlpha = 0.65;
            ctx.lineWidth = 1 / this.zoom;
            ctx.setLineDash([3 / this.zoom, 3 / this.zoom]);
            for (const node of nodes) {
                if (node.handleIn) {
                    ctx.beginPath();
                    ctx.moveTo(node.x, node.y);
                    ctx.lineTo(node.handleIn.x, node.handleIn.y);
                    ctx.stroke();
                }
                if (node.handleOut) {
                    ctx.beginPath();
                    ctx.moveTo(node.x, node.y);
                    ctx.lineTo(node.handleOut.x, node.handleOut.y);
                    ctx.stroke();
                }
            }
            ctx.restore();
        } else if (norm.controlPoint) {
            ctx.beginPath();
            ctx.moveTo(norm.x0, norm.y0);
            ctx.lineTo(norm.controlPoint.x, norm.controlPoint.y);
            ctx.lineTo(norm.x1, norm.y1);
            ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        const activeHandleId = this.handleDrag?.elementId === shape.id ? this.handleDrag.handleId : '';
        const radius = 6 / this.zoom;
        const diamond = 7 / this.zoom;
        const handles = plugin.getControlHandles(geom);

        // Rotation stem line if 'rotate' handle exists
        const rotHandle = handles.find(h => h.kind === 'rotate');
        if (rotHandle) {
            const minX = Math.min(norm.x0, norm.x1);
            const maxX = Math.max(norm.x0, norm.x1);
            const minY = Math.min(norm.y0, norm.y1);
            const midX = (minX + maxX) / 2;
            const cx = (norm.x0 + norm.x1) / 2;
            const cy = (norm.y0 + norm.y1) / 2;
            const stemStart = rot !== 0
                ? rotatePoint(midX, minY, cx, cy, rot)
                : { x: midX, y: minY };

            ctx.save();
            ctx.strokeStyle = accent;
            ctx.lineWidth = 1.5 / this.zoom;
            ctx.setLineDash([2 / this.zoom, 2 / this.zoom]);
            ctx.beginPath();
            ctx.moveTo(stemStart.x, stemStart.y);
            ctx.lineTo(rotHandle.x, rotHandle.y);
            ctx.stroke();
            ctx.restore();
        }

        for (const handle of handles) {
            const isActive = handle.id === activeHandleId;
            ctx.beginPath();
            if (handle.kind === 'curve' || handle.kind === 'radius' || handle.kind === 'param') {
                // Diamond accent handle for curvature / corner radius / 3D params
                ctx.moveTo(handle.x, handle.y - diamond);
                ctx.lineTo(handle.x + diamond, handle.y);
                ctx.lineTo(handle.x, handle.y + diamond);
                ctx.lineTo(handle.x - diamond, handle.y);
                ctx.closePath();
                ctx.fillStyle = isActive ? '#FFFFFF' : accent;
                ctx.fill();
                ctx.strokeStyle = isActive ? accent : '#FFFFFF';
            } else if (handle.kind === 'bezier-in' || handle.kind === 'bezier-out') {
                const rBez = 4.5 / this.zoom;
                ctx.arc(handle.x, handle.y, isActive ? rBez * 1.3 : rBez, 0, Math.PI * 2);
                ctx.fillStyle = isActive ? '#00A3FF' : '#FFFFFF';
                ctx.fill();
                ctx.strokeStyle = '#00A3FF';
            } else if (handle.kind === 'segment-mid') {
                const rMid = 4 / this.zoom;
                ctx.arc(handle.x, handle.y, isActive ? rMid * 1.3 : rMid, 0, Math.PI * 2);
                ctx.fillStyle = isActive ? accent : '#FFFFFF';
                ctx.fill();
                ctx.strokeStyle = accent;
            } else if (handle.kind === 'rotate') {
                const rRot = 6.5 / this.zoom;
                ctx.arc(handle.x, handle.y, isActive ? rRot * 1.3 : rRot, 0, Math.PI * 2);
                ctx.fillStyle = isActive ? accent : '#FFFFFF';
                ctx.fill();
                ctx.strokeStyle = accent;
            } else {
                ctx.arc(handle.x, handle.y, isActive ? radius * 1.3 : radius, 0, Math.PI * 2);
                ctx.fillStyle = isActive ? accent : '#FFFFFF';
                ctx.fill();
                ctx.strokeStyle = accent;
            }
            ctx.lineWidth = 2 / this.zoom;
            ctx.stroke();
        }
        ctx.restore();

        if (this.handleDrag?.elementId === shape.id && this.handleDrag.snap) {
            this.paintSnapTargets([this.handleDrag.snap]);
        }
    }

    // Touch gesture handling (Pinch-to-zoom & 2-finger navigation scroll with 1-finger palm rejection)
    private readonly onTouchDown = (event: PointerEvent): void => {
        if (event.pointerType !== 'touch') return;
        const isPenGated = this.input ? this.input.shouldRejectTouch() : false;
        this.touches.set(event.pointerId, this.localTouch(event));

        if (this.touches.size === 1) {
            const timeSinceLast = Date.now() - this.lastTouchEndTime;
            const distSinceLast = Math.hypot(
                event.clientX - this.lastTouchEndPos.x,
                event.clientY - this.lastTouchEndPos.y
            );
            if (this.penEnabled && timeSinceLast < 350 && distSinceLast < 32) {
                // Double tap in drawing mode: suppress browser double-tap zoom/selection/focus
                event.preventDefault();
                event.stopPropagation();
            }

            if (isPenGated) {
                // S-Pen is hovering or active: cancel single-finger touch immediately to prevent accidental screen jumping or ghost taps
                event.preventDefault();
                event.stopPropagation();
                this.palmRejectedSingleTouch = true;
                this.singleTouchStartCoords = null;
                this.lastSingleTouch = null;
                this.singleTouchPanned = false;
            } else {
                this.palmRejectedSingleTouch = false;
                this.singleTouchStartCoords = { x: event.clientX, y: event.clientY, time: Date.now() };
                this.lastSingleTouch = { x: event.clientX, y: event.clientY };
                this.singleTouchPanned = false;
            }
        } else if (this.touches.size === 2) {
            // Two fingers down: navigation gesture (scroll and pinch-to-zoom) is always permitted
            event.preventDefault();
            this.palmRejectedSingleTouch = false;
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

        if (this.touches.size === 1) {
            if (this.palmRejectedSingleTouch) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            if (this.lastSingleTouch) {
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
        this.lastTouchEndTime = Date.now();
        this.lastTouchEndPos = { x: event.clientX, y: event.clientY };

        const start = this.singleTouchStartCoords;
        const wasPanned = this.singleTouchPanned;
        const wasPalmRejected = this.palmRejectedSingleTouch || (this.input ? this.input.shouldRejectTouch() : false);
        this.singleTouchStartCoords = null;
        this.lastSingleTouch = null;
        this.singleTouchPanned = false;
        this.touches.delete(event.pointerId);

        if (this.touches.size === 0) {
            this.palmRejectedSingleTouch = false;
        }

        if (this.touches.size < 2) {
            this.gestureDistance = 0;
            // On releasing two-finger pinch gesture, re-rasterize dry canvas to zoom * devicePixelRatio
            this.renderDirty = true;
            this.schedulePaint();
        }
        try { if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId); } catch { /* best effort */ }

        if (wasPalmRejected) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (start && !wasPanned && this.touches.size === 0) {
            const dx = Math.abs(event.clientX - start.x);
            const dy = Math.abs(event.clientY - start.y);
            const dt = Date.now() - start.time;
            if (dx < 12 && dy < 12 && dt < 400) {
                if (this.penEnabled) {
                    // In drawing mode, tapping clears floating menus/selections but NEVER focuses editor or invokes virtual keyboard
                    if (this.lassoMenu?.isOpen()) {
                        this.selection = [];
                        this.lassoMenu.hide();
                        this.emitSelection();
                        this.schedulePaint();
                    }
                    if (this.boxMenu?.isOpen()) {
                        this.boxMenu.hide();
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                const hits = typeof document !== 'undefined' && typeof document.elementsFromPoint === 'function'
                    ? document.elementsFromPoint(event.clientX, event.clientY)
                    : [];
                const hitBox = hits.some(el =>
                    el.classList?.contains('apolo-space-block') ||
                    el.classList?.contains('apolo-box-handle') ||
                    el.closest?.('.apolo-space-block') !== null
                );
                if (!hitBox) {
                    this.focusEditorAt(event.clientX, event.clientY);
                }
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
        this.lastGestureCenter = { x: centerX, y: centerY };
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

        const deltaX = centerX - this.lastGestureCenter.x;
        const deltaY = centerY - this.lastGestureCenter.y;
        this.lastGestureCenter = { x: centerX, y: centerY };

        const sizer = this.getSizerElement();
        const baseWidth = sizer?.offsetWidth ?? this.scroller.clientWidth;
        const baseHeight = sizer?.offsetHeight ?? this.scroller.clientHeight;

        const distanceRatio = distance / this.gestureDistance;
        const isPinch = Math.abs(distanceRatio - 1.0) > 0.05;
        if (isPinch) {
            const newZoom = Math.max(1.0, Math.min(3.0, (this.gestureZoom * distance) / this.gestureDistance));
            this.setZoomLevel(newZoom);
        }

        if (this.zoom > 1.0) {
            const maxScrollX = Math.max(0, Math.round(baseWidth * this.zoom - this.scroller.clientWidth));
            const maxScrollY = Math.max(0, Math.round(baseHeight * this.zoom - this.scroller.clientHeight));

            const targetScrollLeft = Math.max(0, Math.min(maxScrollX, Math.round(this.gestureWorldX * this.zoom - centerX)));
            const targetScrollTop = Math.max(0, Math.min(maxScrollY, Math.round(this.gestureWorldY * this.zoom - centerY)));
            this.scroller.scrollLeft = targetScrollLeft;
            this.scroller.scrollTop = targetScrollTop;
        } else {
            // At 1.0 zoom: two-finger scroll navigation
            const maxScrollX = Math.max(0, this.scroller.scrollWidth - this.scroller.clientWidth);
            const maxScrollY = Math.max(0, this.scroller.scrollHeight - this.scroller.clientHeight);
            this.scroller.scrollLeft = Math.max(0, Math.min(maxScrollX, this.scroller.scrollLeft - deltaX));
            this.scroller.scrollTop = Math.max(0, Math.min(maxScrollY, this.scroller.scrollTop - deltaY));
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

function contains(bounds: BoundingBox, x: number, y: number, padding: number): boolean {
    return x >= bounds.minX - padding && x <= bounds.maxX + padding && y >= bounds.minY - padding && y <= bounds.maxY + padding;
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

export function cloneElements(elements: readonly CanvasElement[]): CanvasElement[] {
    return elements.map(el => {
        if (el.type === 'stroke') {
            return {
                ...el,
                points: el.points.slice(),
                style: { ...el.style },
                bounds: { ...el.bounds },
            };
        } else {
            return {
                ...el,
                style: { ...el.style },
                bounds: { ...el.bounds },
            };
        }
    });
}
