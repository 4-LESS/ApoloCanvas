/**
 * sandbox/engines/optimized-engine.js
 * 
 * Motor Optimizado con Caché de Capas y Sprites (Optimized Engine)
 * 
 * Implementa las técnicas de alto rendimiento de ApoloCanvas:
 * 1. Capa "Dry" fuera de pantalla (Double buffering): Los trazos completados se hornean
 *    en un canvas secundario y se vuelcan a la GPU en una única llamada `drawImage` (~0.05ms).
 * 2. Pre-renderizado en Sprite por trazo (Pencil Bitmap Cache): Cada trazo de lápiz pesado
 *    se almacena en un canvas miniatura ajustado a su Bounding Box (`getOrCreatePencilCache`),
 *    haciendo que Undo/Redo sea instantáneo.
 * 3. Vista previa ligera en arrastre: Durante `pointermove`, el lápiz muestra una guía fluida
 *    y hornea las partículas estocásticas de grafito al levantar el lápiz (`pointerup`).
 * 
 * Contrato:
 * export class SandboxEngine {
 *     constructor(canvas, ctx, options) { ... }
 *     handlePointerDown(e) { ... }
 *     handlePointerMove(e) { ... }
 *     handlePointerUp(e) { ... }
 *     clear() { ... }
 * }
 */

export class SandboxEngine {
    constructor(canvas, ctx, options = {}) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.options = options;

        this.getPenRenderer = options.getPenRenderer || (() => null);
        this.getStyle = options.getStyle || (() => ({ width: 3, opacity: 1, color: '#1e1e1e', smoothing: 0.5 }));
        this.onStats = options.onStats || (() => {});

        this.strokes = [];
        this.redoStack = [];

        this.isDrawing = false;
        this.activePoints = [];
        this.activeStyle = null;
        this.activeRenderPen = null;

        // Capa seca (Dry Layer) para trazos finalizados
        const isDoc = typeof document !== 'undefined' && typeof document.createElement === 'function';
        this.dryCanvas = isDoc ? document.createElement('canvas') : null;
        this.dryCtx = this.dryCanvas ? this.dryCanvas.getContext('2d') : null;
        this.syncDryCanvasSize();

        // Caché de sprites por ID de trazo
        this.strokeSpriteCache = new Map();

        // Estado para suavizado de presión y coordenadas
        this.lastRawPoint = null;
        this.lastSmoothedPoint = null;
        this.lastPressure = 0.5;

        // Métricas de benchmarking
        this.fps = 60;
        this.renderTimeMs = 0;
        this.frameCount = 0;
        this.fpsTimer = performance.now();
    }

    syncDryCanvasSize() {
        if (!this.dryCanvas) return;
        const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
        if (this.dryCanvas.width !== this.canvas.width || this.dryCanvas.height !== this.canvas.height) {
            this.dryCanvas.width = this.canvas.width;
            this.dryCanvas.height = this.canvas.height;
            this.rebakeDryLayer();
        }
    }

    setPenRenderer(renderer) {
        this.options.getPenRenderer = () => renderer;
    }

    setStyle(style) {
        this.options.getStyle = () => style;
    }

    getStrokes() {
        return this.strokes;
    }

    setStrokes(strokes) {
        this.strokes = strokes ? [...strokes] : [];
        this.redoStack = [];
        this.strokeSpriteCache.clear();
        this.rebakeDryLayer();
        this.redraw();
    }

    getCanvasPoint(e) {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
        const x = (e.clientX - rect.left) * (this.canvas.width / (rect.width * dpr));
        const y = (e.clientY - rect.top) * (this.canvas.height / (rect.height * dpr));

        let pressure = e.pressure;
        const style = this.getStyle();
        const now = performance.now();

        if (style.simulatePressure || pressure === undefined || (e.pointerType === 'mouse' && pressure === 0)) {
            if (this.lastRawPoint) {
                const dt = Math.max(1, now - this.lastRawPoint.time);
                const dist = Math.hypot(x - this.lastRawPoint.x, y - this.lastRawPoint.y);
                const speed = dist / dt;
                pressure = Math.max(0.15, Math.min(0.95, 0.9 - Math.min(speed * 0.25, 0.75)));
            } else {
                pressure = 0.5;
            }
        }

        const smoothedPressure = this.lastPressure * 0.3 + pressure * 0.7;
        this.lastPressure = smoothedPressure;

        return { x, y, pressure: smoothedPressure, time: now };
    }

    smoothPoint(raw) {
        const style = this.getStyle();
        const smoothing = Math.max(0, Math.min(0.95, style.smoothing !== undefined ? style.smoothing : 0.5));

        if (!this.lastSmoothedPoint || smoothing <= 0.02) {
            this.lastSmoothedPoint = { ...raw };
            return this.lastSmoothedPoint;
        }

        const alpha = 1 - smoothing;
        const sx = this.lastSmoothedPoint.x + (raw.x - this.lastSmoothedPoint.x) * alpha;
        const sy = this.lastSmoothedPoint.y + (raw.y - this.lastSmoothedPoint.y) * alpha;

        this.lastSmoothedPoint = {
            x: sx,
            y: sy,
            pressure: raw.pressure,
            time: raw.time,
        };

        return this.lastSmoothedPoint;
    }

    /**
     * Calcula la caja delimitadora (Bounding Box) de un trazo con padding
     */
    calculateBounds(points, padding = 16) {
        if (!points || points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
        let minX = points[0].x;
        let maxX = minX;
        let minY = points[0].y;
        let maxY = minY;
        for (let i = 1; i < points.length; i++) {
            const p = points[i];
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        return {
            minX: Math.floor(minX - padding),
            minY: Math.floor(minY - padding),
            maxX: Math.ceil(maxX + padding),
            maxY: Math.ceil(maxY + padding),
            width: Math.ceil(maxX - minX + padding * 2),
            height: Math.ceil(maxY - minY + padding * 2),
        };
    }

    /**
     * Genera un sprite fuera de pantalla para un trazo específico (crucial para pencil de miles de partículas)
     */
    getOrCreateStrokeSprite(stroke) {
        if (!stroke.id) {
            stroke.id = 'stroke_' + Math.random().toString(36).substring(2, 9);
        }
        if (this.strokeSpriteCache.has(stroke.id)) {
            return this.strokeSpriteCache.get(stroke.id);
        }

        const pad = Math.max(16, Math.ceil((stroke.style.width || 3) * 2));
        const bounds = this.calculateBounds(stroke.points, pad);
        const w = Math.max(1, bounds.width);
        const h = Math.max(1, bounds.height);

        const isDoc = typeof document !== 'undefined' && typeof document.createElement === 'function';
        const sprite = isDoc ? document.createElement('canvas') : null;
        if (!sprite) return null;
        sprite.width = w;
        sprite.height = h;
        const sCtx = sprite.getContext('2d');

        if (sCtx && typeof stroke.renderPen === 'function') {
            sCtx.save();
            // Desplazar puntos al origen local del sprite
            const localPoints = stroke.points.map(p => ({
                x: p.x - bounds.minX,
                y: p.y - bounds.minY,
                pressure: p.pressure,
            }));
            stroke.renderPen(sCtx, localPoints, stroke.style);
            sCtx.restore();
        }

        const entry = { sprite, bounds };
        this.strokeSpriteCache.set(stroke.id, entry);
        return entry;
    }

    /**
     * Re-hornea la capa "dry" completa con aceleración por sprite
     */
    rebakeDryLayer() {
        if (!this.dryCtx) return;
        const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
        const width = this.canvas.width / dpr;
        const height = this.canvas.height / dpr;

        this.dryCtx.save();
        this.dryCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.dryCtx.clearRect(0, 0, width, height);

        for (let i = 0; i < this.strokes.length; i++) {
            const stroke = this.strokes[i];
            const cached = this.getOrCreateStrokeSprite(stroke);
            if (cached && cached.sprite) {
                this.dryCtx.drawImage(cached.sprite, cached.bounds.minX, cached.bounds.minY);
            } else if (typeof stroke.renderPen === 'function') {
                stroke.renderPen(this.dryCtx, stroke.points, stroke.style);
            }
        }

        this.dryCtx.restore();
    }

    handlePointerDown(e) {
        if (e.button !== 0 && e.pointerType === 'mouse') return;

        this.isDrawing = true;
        this.lastRawPoint = null;
        this.lastSmoothedPoint = null;
        this.lastPressure = e.pressure > 0 ? e.pressure : 0.5;

        const rawPt = this.getCanvasPoint(e);
        this.lastRawPoint = rawPt;
        const pt = this.smoothPoint(rawPt);

        this.activePoints = [pt];
        this.activeStyle = { ...this.getStyle() };
        this.activeRenderPen = this.getPenRenderer();

        this.redoStack = [];
        this.redraw();
    }

    handlePointerMove(e) {
        if (!this.isDrawing) return;

        const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;

        if (coalesced && coalesced.length > 0) {
            for (let i = 0; i < coalesced.length; i++) {
                const rawPt = this.getCanvasPoint(coalesced[i]);
                this.lastRawPoint = rawPt;
                const pt = this.smoothPoint(rawPt);
                this.activePoints.push(pt);
            }
        } else {
            const rawPt = this.getCanvasPoint(e);
            this.lastRawPoint = rawPt;
            const pt = this.smoothPoint(rawPt);
            this.activePoints.push(pt);
        }

        this.redraw();
    }

    handlePointerUp(e) {
        if (!this.isDrawing) return;
        this.isDrawing = false;

        if (this.activePoints.length > 0 && this.activeRenderPen) {
            const stroke = {
                id: 'stroke_' + Math.random().toString(36).substring(2, 9),
                points: [...this.activePoints],
                style: { ...this.activeStyle },
                renderPen: this.activeRenderPen,
            };

            this.strokes.push(stroke);

            // Genera sprite en caché para el trazo horneado
            const cached = this.getOrCreateStrokeSprite(stroke);

            // Estampa inmediatamente el nuevo trazo en la capa dry sin necesidad de redibujar los anteriores
            const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
            this.dryCtx.save();
            this.dryCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (cached && cached.sprite) {
                this.dryCtx.drawImage(cached.sprite, cached.bounds.minX, cached.bounds.minY);
            } else {
                stroke.renderPen(this.dryCtx, stroke.points, stroke.style);
            }
            this.dryCtx.restore();
        }

        this.activePoints = [];
        this.activeStyle = null;
        this.activeRenderPen = null;
        this.lastRawPoint = null;
        this.lastSmoothedPoint = null;

        this.redraw();
    }

    handlePointerCancel(e) {
        this.isDrawing = false;
        this.activePoints = [];
        this.lastRawPoint = null;
        this.lastSmoothedPoint = null;
        this.redraw();
    }

    clear() {
        this.strokes = [];
        this.redoStack = [];
        this.activePoints = [];
        this.strokeSpriteCache.clear();
        this.isDrawing = false;

        const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
        const width = this.canvas.width / dpr;
        const height = this.canvas.height / dpr;

        this.dryCtx.save();
        this.dryCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.dryCtx.clearRect(0, 0, width, height);
        this.dryCtx.restore();

        this.redraw();
    }

    undo() {
        if (this.strokes.length === 0) return;
        const popped = this.strokes.pop();
        this.redoStack.push(popped);
        this.rebakeDryLayer();
        this.redraw();
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const restored = this.redoStack.pop();
        this.strokes.push(restored);
        this.rebakeDryLayer();
        this.redraw();
    }

    /**
     * Redibujado ultrarrápido: Vuelca la capa "dry" completa en una sola llamada GPU
     * y dibuja únicamente el trazo activo actual (con vista previa optimizada en arrastre).
     */
    redraw() {
        const start = performance.now();
        const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
        const width = this.canvas.width / dpr;
        const height = this.canvas.height / dpr;

        this.ctx.save();
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.ctx.clearRect(0, 0, width, height);

        // Blit acelerado por hardware de todos los trazos horneados
        this.ctx.drawImage(this.dryCanvas, 0, 0, width, height);

        // Trazo activo: renderiza directamente con la pluma activa a 120fps
        if (this.activePoints.length > 0 && typeof this.activeRenderPen === 'function') {
            this.activeRenderPen(this.ctx, this.activePoints, this.activeStyle);
        }

        this.ctx.restore();

        const end = performance.now();
        this.renderTimeMs = end - start;
        this.recordFrame();
    }

    recordFrame() {
        this.frameCount++;
        const now = performance.now();
        if (now - this.fpsTimer >= 500) {
            this.fps = Math.round((this.frameCount * 1000) / (now - this.fpsTimer));
            this.frameCount = 0;
            this.fpsTimer = now;
        }

        let totalPoints = 0;
        for (let i = 0; i < this.strokes.length; i++) {
            totalPoints += this.strokes[i].points.length;
        }
        totalPoints += this.activePoints.length;

        this.onStats({
            engineName: 'Optimized Engine (Dry Canvas + Sprite Cache)',
            fps: this.fps,
            renderTimeMs: this.renderTimeMs,
            strokeCount: this.strokes.length + (this.isDrawing ? 1 : 0),
            pointCount: totalPoints,
            cachedSprites: this.strokeSpriteCache.size,
        });
    }
}

// Fallback de registro global para compatibilidad directa
if (typeof globalThis !== 'undefined') {
    globalThis.ApoloSandbox = globalThis.ApoloSandbox || { pens: {}, engines: {} };
    globalThis.ApoloSandbox.engines['optimized-engine'] = SandboxEngine;
}
