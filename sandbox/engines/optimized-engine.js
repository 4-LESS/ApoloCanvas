/**
 * sandbox/engines/optimized-engine.js
 * 
 * Motor Optimizado con Caché de Capas, Coordenadas de Mundo DPR y Gestión de Tiles (v3)
 */

export class SandboxEngine {
    constructor(canvas, ctx, options = {}) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.options = options;

        this.getPenRenderer = options.getPenRenderer || (() => null);
        this.getStyle = options.getStyle || (() => ({ width: 3, opacity: 1, color: '#1e1e1e', smoothing: 0.25 }));
        this.onStats = options.onStats || (() => {});

        this.strokes = [];
        this.redoStack = [];

        this.isDrawing = false;
        this.activeStrokeId = null;
        this.activePoints = [];
        this.activeStyle = null;
        this.activeRenderPen = null;

        this.cachedRect = null;

        // Caché de sprites por ID de trazo (inicializado ANTES de syncDryCanvasSize)
        this.strokeSpriteCache = new Map();

        // Capa seca (Dry Layer) para trazos finalizados
        const isDoc = typeof document !== 'undefined' && typeof document.createElement === 'function';
        this.dryCanvas = isDoc ? document.createElement('canvas') : null;
        this.dryCtx = this.dryCanvas ? this.dryCanvas.getContext('2d') : null;
        this.syncDryCanvasSize();

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
        this.cachedRect = null;
        if (this.dryCanvas.width !== this.canvas.width || this.dryCanvas.height !== this.canvas.height) {
            this.dryCanvas.width = this.canvas.width;
            this.dryCanvas.height = this.canvas.height;
            if (this.strokeSpriteCache) {
                this.strokeSpriteCache.clear();
            }
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

    releaseLivePenState(strokeId, pointsRef) {
        const atlasPen = typeof globalThis !== 'undefined'
            ? globalThis.ApoloSandbox?.pens?.['pencil-atlas']
            : null;
        if (atlasPen && typeof atlasPen.releasePencilStroke === 'function') {
            if (strokeId) atlasPen.releasePencilStroke(strokeId);
            if (pointsRef) atlasPen.releasePencilStroke(pointsRef);
        }
    }

    getCanvasPoint(e) {
        const rect = this.cachedRect || this.canvas.getBoundingClientRect();
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
        const smoothing = Math.max(0, Math.min(0.85, style.smoothing !== undefined ? style.smoothing : 0.25));

        if (!this.lastSmoothedPoint || this.activePoints.length < 2 || smoothing <= 0.02) {
            this.lastSmoothedPoint = { ...raw };
            return this.lastSmoothedPoint;
        }

        const dist = Math.hypot(raw.x - this.lastSmoothedPoint.x, raw.y - this.lastSmoothedPoint.y);
        const dynamicAlpha = Math.min(1, (1 - smoothing) + Math.min(dist / 25, 0.45));

        const sx = this.lastSmoothedPoint.x + (raw.x - this.lastSmoothedPoint.x) * dynamicAlpha;
        const sy = this.lastSmoothedPoint.y + (raw.y - this.lastSmoothedPoint.y) * dynamicAlpha;

        this.lastSmoothedPoint = {
            x: sx,
            y: sy,
            pressure: raw.pressure,
            time: raw.time,
        };

        return this.lastSmoothedPoint;
    }

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
        const bMinX = Math.floor(minX - padding);
        const bMinY = Math.floor(minY - padding);
        const bMaxX = Math.ceil(maxX + padding);
        const bMaxY = Math.ceil(maxY + padding);
        return {
            minX: bMinX,
            minY: bMinY,
            maxX: bMaxX,
            maxY: bMaxY,
            width: Math.max(1, bMaxX - bMinX),
            height: Math.max(1, bMaxY - bMinY),
        };
    }

    getOrCreateStrokeSprite(stroke) {
        if (!stroke.id) {
            stroke.id = 'stroke_' + Math.random().toString(36).substring(2, 9);
        }
        if (this.strokeSpriteCache.has(stroke.id)) {
            return this.strokeSpriteCache.get(stroke.id);
        }

        const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
        const pad = Math.max(16, Math.ceil((stroke.style.width || 3) * 2.5));
        const bounds = this.calculateBounds(stroke.points, pad);
        const w = bounds.width;
        const h = bounds.height;

        const isDoc = typeof document !== 'undefined' && typeof document.createElement === 'function';
        const sprite = isDoc ? document.createElement('canvas') : null;
        if (!sprite) return null;

        sprite.width = Math.max(1, Math.ceil(w * dpr));
        sprite.height = Math.max(1, Math.ceil(h * dpr));
        const sCtx = sprite.getContext('2d');

        if (sCtx && typeof stroke.renderPen === 'function') {
            sCtx.save();
            sCtx.setTransform(dpr, 0, 0, dpr, -bounds.minX * dpr, -bounds.minY * dpr);
            const renderStyle = {
                ...stroke.style,
                strokeId: stroke.id,
                viewport: {
                    x: bounds.minX,
                    y: bounds.minY,
                    width: bounds.width,
                    height: bounds.height,
                },
            };
            stroke.renderPen(sCtx, stroke.points, renderStyle);
            sCtx.restore();

            this.releaseLivePenState(stroke.id, stroke.points);
        }

        const entry = { sprite, bounds };
        this.strokeSpriteCache.set(stroke.id, entry);
        return entry;
    }

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
                this.dryCtx.drawImage(
                    cached.sprite,
                    cached.bounds.minX,
                    cached.bounds.minY,
                    cached.bounds.width,
                    cached.bounds.height
                );
            } else if (typeof stroke.renderPen === 'function') {
                stroke.renderPen(this.dryCtx, stroke.points, stroke.style);
            }
        }

        this.dryCtx.restore();
    }

    handlePointerDown(e) {
        if (e.button !== 0 && e.pointerType === 'mouse') return;

        this.cachedRect = this.canvas.getBoundingClientRect();
        this.isDrawing = true;
        this.lastRawPoint = null;
        this.lastSmoothedPoint = null;
        this.lastPressure = e.pressure > 0 ? e.pressure : 0.5;

        const rawPt = this.getCanvasPoint(e);
        this.lastRawPoint = rawPt;
        const pt = this.smoothPoint(rawPt);

        this.activeStrokeId = 'stroke_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
        this.activePoints = [pt];
        this.activeStyle = {
            ...this.getStyle(),
            strokeId: this.activeStrokeId,
        };
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
            const strokeId = this.activeStrokeId || ('stroke_' + Math.random().toString(36).substring(2, 9));
            const stroke = {
                id: strokeId,
                points: this.activePoints,
                style: {
                    ...this.activeStyle,
                    strokeId,
                },
                renderPen: this.activeRenderPen,
            };

            this.strokes.push(stroke);

            const cached = this.getOrCreateStrokeSprite(stroke);

            const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
            this.dryCtx.save();
            this.dryCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (cached && cached.sprite) {
                this.dryCtx.drawImage(
                    cached.sprite,
                    cached.bounds.minX,
                    cached.bounds.minY,
                    cached.bounds.width,
                    cached.bounds.height
                );
            } else {
                stroke.renderPen(this.dryCtx, stroke.points, stroke.style);
            }
            this.dryCtx.restore();
        }

        this.activeStrokeId = null;
        this.activePoints = [];
        this.activeStyle = null;
        this.activeRenderPen = null;
        this.lastRawPoint = null;
        this.lastSmoothedPoint = null;

        this.redraw();
    }

    handlePointerCancel(e) {
        if (this.activeStrokeId || this.activePoints.length > 0) {
            this.releaseLivePenState(this.activeStrokeId, this.activePoints);
        }
        this.isDrawing = false;
        this.activeStrokeId = null;
        this.activePoints = [];
        this.lastRawPoint = null;
        this.lastSmoothedPoint = null;
        this.redraw();
    }

    clear() {
        if (this.activeStrokeId || this.activePoints.length > 0) {
            this.releaseLivePenState(this.activeStrokeId, this.activePoints);
        }
        this.strokes = [];
        this.redoStack = [];
        this.activeStrokeId = null;
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

    redraw() {
        const start = performance.now();
        const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
        const width = this.canvas.width / dpr;
        const height = this.canvas.height / dpr;

        this.ctx.save();
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.ctx.clearRect(0, 0, width, height);

        this.ctx.drawImage(this.dryCanvas, 0, 0, width, height);

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
            engineName: 'Optimized Engine v3 (World-DPR Sprite + Tile Pool)',
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