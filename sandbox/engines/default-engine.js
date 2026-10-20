/**
 * sandbox/engines/default-engine.js
 * 
 * Motor Actual / Básico (Default Engine)
 * Procesa eventos de puntero con interpolación y suavizado de puntos.
 * Realiza un redibujado completo en modo inmediato de todos los trazos en cada frame de movimiento,
 * sirviendo como referencia (baseline) para medir el costo computacional de redibujar partículas.
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

        // Estado para suavizado de presión y coordenadas
        this.lastRawPoint = null;
        this.lastSmoothedPoint = null;
        this.lastPressure = 0.5;

        // Métricas de benchmarking
        this.fps = 60;
        this.lastFrameTime = performance.now();
        this.renderTimeMs = 0;
        this.frameCount = 0;
        this.fpsTimer = performance.now();
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
        this.redraw();
    }

    /**
     * Convierte coordenadas de evento PointerEvent al espacio local del canvas (respetando DPR)
     */
    getCanvasPoint(e) {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
        const x = (e.clientX - rect.left) * (this.canvas.width / (rect.width * dpr));
        const y = (e.clientY - rect.top) * (this.canvas.height / (rect.height * dpr));

        let pressure = e.pressure;

        // Simulación de presión basada en velocidad para ratón o punteros sin sensor
        const style = this.getStyle();
        const now = performance.now();

        if (style.simulatePressure || pressure === undefined || (e.pointerType === 'mouse' && pressure === 0)) {
            if (this.lastRawPoint) {
                const dt = Math.max(1, now - this.lastRawPoint.time);
                const dist = Math.hypot(x - this.lastRawPoint.x, y - this.lastRawPoint.y);
                const speed = dist / dt; // px / ms
                // A mayor velocidad trazo más ligero/fino; más lento trazo más pesado
                pressure = Math.max(0.15, Math.min(0.95, 0.9 - Math.min(speed * 0.25, 0.75)));
            } else {
                pressure = 0.5;
            }
        }

        // Suavizado EMA de presión (filtra ruido de digitalizador)
        const smoothedPressure = this.lastPressure * 0.3 + pressure * 0.7;
        this.lastPressure = smoothedPressure;

        return { x, y, pressure: smoothedPressure, time: now };
    }

    /**
     * Aplica filtro de suavizado a los puntos según el parámetro de smoothing
     */
    smoothPoint(raw) {
        const style = this.getStyle();
        const smoothing = Math.max(0, Math.min(0.95, style.smoothing !== undefined ? style.smoothing : 0.5));

        if (!this.lastSmoothedPoint || smoothing <= 0.02) {
            this.lastSmoothedPoint = { ...raw };
            return this.lastSmoothedPoint;
        }

        const baseAlpha = 1 - smoothing;
        const dist = Math.hypot(raw.x - this.lastSmoothedPoint.x, raw.y - this.lastSmoothedPoint.y);
        const dynamicAlpha = Math.min(1, baseAlpha + Math.min(dist / 25, 0.45));

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

        // Si el navegador soporta eventos fusionados de alta tasa (120Hz/240Hz stylus)
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
            this.strokes.push({
                points: [...this.activePoints],
                style: { ...this.activeStyle },
                renderPen: this.activeRenderPen,
            });
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
        this.isDrawing = false;
        this.redraw();
    }

    undo() {
        if (this.strokes.length === 0) return;
        const popped = this.strokes.pop();
        this.redoStack.push(popped);
        this.redraw();
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const restored = this.redoStack.pop();
        this.strokes.push(restored);
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

        // Modo Inmediato: Redibuja TODOS los trazos existentes desde cero
        for (let i = 0; i < this.strokes.length; i++) {
            const s = this.strokes[i];
            if (typeof s.renderPen === 'function') {
                s.renderPen(this.ctx, s.points, s.style);
            }
        }

        // Redibuja el trazo activo en curso
        if (this.activePoints.length > 0 && typeof this.activeRenderPen === 'function') {
            this.activeRenderPen(this.ctx, this.activePoints, this.activeStyle);
        }

        this.ctx.restore();

        // Cálculo de benchmarking
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
            engineName: 'Default Engine (Inmediato)',
            fps: this.fps,
            renderTimeMs: this.renderTimeMs,
            strokeCount: this.strokes.length + (this.isDrawing ? 1 : 0),
            pointCount: totalPoints,
        });
    }
}

// Fallback de registro global para compatibilidad directa
if (typeof globalThis !== 'undefined') {
    globalThis.ApoloSandbox = globalThis.ApoloSandbox || { pens: {}, engines: {} };
    globalThis.ApoloSandbox.engines['default-engine'] = SandboxEngine;
}
