/**
 * src/engine/pens/common.ts
 *
 * Núcleo compartido de utilidades geométricas y pipeline estándar O(1) para las herramientas
 * de dibujo de ApoloCanvas (`ball.ts`, `fountain.ts`, `calli.ts`, `pencil.ts`).
 * Portado 1:1 desde `sandbox/pens/pencil-common.js`.
 */

import type { Point } from '../../core/types.ts';
import type { PenStyleOptions, PenSvgOutput } from './types.ts';

/** Hash determinista 1D en [0, 1) — estable entre frames (sin parpadeo en live preview). */
export function hash(i: number, seed = 0): number {
    const v = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    return v - Math.floor(v);
}

/** Hash entero rápido 1D en [0, 1) libre de trigonometría. */
export function hash1D(i: number, salt = 0): number {
    let h = Math.imul((i | 0) ^ (salt | 0), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Hash entero rápido 2D en [0, 1) para campos de textura de papel. */
export function hash2D(x: number, y: number, seed = 0): number {
    let h = Math.imul(x ^ seed, 374761393) + Math.imul(y ^ (seed >> 3), 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Ruido 2D continuo interpolado bilinealmente con curva Hermite en [0, 1). */
export function valueNoise2D(x: number, y: number, seed = 0): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);

    const n00 = hash2D(xi, yi, seed);
    const n10 = hash2D(xi + 1, yi, seed);
    const n01 = hash2D(xi, yi + 1, seed);
    const n11 = hash2D(xi + 1, yi + 1, seed);

    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return nx0 + v * (nx1 - nx0);
}

/** Movimiento Browniano Fraccional (FBM) 2D normalizado en [0, 1). */
export function fbm2D(x: number, y: number, octaves = 3, seed = 0): number {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1.0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
        value += amplitude * valueNoise2D(x * frequency, y * frequency, seed + i * 101);
        norm += amplitude;
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return norm > 0 ? value / norm : 0;
}

/** Convierte un color hexadecimal `#RGB` o `#RRGGBB` en `[r, g, b]`. */
export function parseColorRgb(colorStr?: string): [number, number, number] {
    const clean = (colorStr || '#2b2b2b').trim();
    if (clean.startsWith('#')) {
        let hex = clean.slice(1);
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        const num = parseInt(hex.slice(0, 6), 16);
        if (!Number.isNaN(num)) {
            return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
        }
    }
    return [43, 43, 43];
}

/** Convierte un color hexadecimal en objeto `{ r, g, b }`. */
export function hexToRgb(colorStr?: string): { r: number; g: number; b: number } {
    const [r, g, b] = parseColorRgb(colorStr);
    return { r, g, b };
}

/** Curva de presión estándar con suavizado Hermite (smoothstep). */
export function pressureScale(p: number | undefined, minScale = 0.45, maxScale = 1.35, gamma = 0.8): number {
    if (p === undefined || Number.isNaN(p) || p <= 0) return 1;
    const t = Math.pow(Math.max(0, Math.min(1, p)), gamma);
    const e = t * t * (3 - 2 * t);
    return minScale + e * (maxScale - minScale);
}

export function meanPressure(points: readonly Point[]): number {
    let s = 0;
    for (const p of points) s += p.pressure ?? 0.5;
    return points.length ? s / points.length : 0.5;
}

/** Normales unitarias por punto (promedio de segmentos adyacentes). */
export function normals(points: readonly Point[]): { x: number; y: number }[] {
    const n = points.length;
    const out = new Array<{ x: number; y: number }>(n);
    for (let i = 0; i < n; i++) {
        const a = points[Math.max(0, i - 1)];
        const b = points[Math.min(n - 1, i + 1)];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        out[i] = { x: -dy / len, y: dx / len };
    }
    return out;
}

/** Traza en ctx un camino cuadrático continuo por puntos medios. */
export function tracePath(ctx: CanvasRenderingContext2D, pts: readonly Point[]): void {
    if (pts.length === 1) {
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[0].x + 0.01, pts[0].y);
        return;
    }
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1];
        const c = pts[i];
        ctx.quadraticCurveTo(p.x, p.y, (p.x + c.x) * 0.5, (p.y + c.y) * 0.5);
    }
    const l = pts[pts.length - 1];
    ctx.lineTo(l.x, l.y);
}

/** Redondea a 1 decimal numérico. */
export function round1(v: number): number {
    return Math.round(v * 10) / 10;
}

/** Formatea a string con 1 decimal como máximo. */
export function fmt(v: number): string {
    return round1(v).toString();
}

/** Mismo camino que tracePath pero serializado como atributo SVG `d`. */
export function svgPathD(pts: readonly Point[]): string {
    if (pts.length === 1) return `M${fmt(pts[0].x)} ${fmt(pts[0].y)}l0.01 0`;
    let d = `M${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1];
        const c = pts[i];
        d += `Q${fmt(p.x)} ${fmt(p.y)} ${fmt((p.x + c.x) * 0.5)} ${fmt((p.y + c.y) * 0.5)}`;
    }
    const l = pts[pts.length - 1];
    return d + `L${fmt(l.x)} ${fmt(l.y)}`;
}

/** Polígono cerrado como atributo SVG `d`. */
export function svgPolygonD(poly: readonly { x: number; y: number }[]): string {
    let d = '';
    for (let i = 0; i < poly.length; i++) d += (i ? 'L' : 'M') + fmt(poly[i].x) + ' ' + fmt(poly[i].y);
    return d + 'Z';
}

export const colorId = (c: string): string => String(c).replace(/[^a-zA-Z0-9]/g, '');

interface CachedSvgHit {
    pointCount: number;
    width: number;
    color: string;
    opacity: number;
    tiltAngle: number;
    out: PenSvgOutput;
}

/**
 * Envuelve un generador SVG `(points, style) => { defs, body }` con un caché `WeakMap`
 * que valida estrictamente `pointCount === points.length` y las propiedades de estilo.
 */
export function createCachedSvgRenderer(
    buildSvgFn: (points: readonly Point[], style: PenStyleOptions) => PenSvgOutput,
): (points: readonly Point[], style?: PenStyleOptions) => PenSvgOutput {
    const cache = new WeakMap<object, CachedSvgHit>();

    return function renderSvg(points: readonly Point[], style: PenStyleOptions = {}): PenSvgOutput {
        if (!points || points.length === 0) return { defs: {}, body: '' };

        const width = style.width || 3;
        const color = style.color || '#1e1e1e';
        const opacity = style.opacity !== undefined ? style.opacity : 1.0;
        const tiltAngle = style.tiltAngle !== undefined ? style.tiltAngle : 0;

        if (typeof points === 'object' && points !== null) {
            const hit = cache.get(points);
            if (
                hit &&
                hit.pointCount === points.length &&
                hit.width === width &&
                hit.color === color &&
                hit.opacity === opacity &&
                Math.abs(hit.tiltAngle - tiltAngle) < 1e-4
            ) {
                return hit.out;
            }
        }

        const out = buildSvgFn(points, style);

        if (typeof points === 'object' && points !== null) {
            cache.set(points, {
                pointCount: points.length,
                width,
                color,
                opacity,
                tiltAngle,
                out,
            });
        }
        return out;
    };
}

export interface IncrementalPenBaseData {
    baseWidth: number;
    color: string;
    opacity: number;
    angle: number;
}

export interface IncrementalPenConfig<TCtxData extends IncrementalPenBaseData, TState extends Record<string, any>> {
    minLivePoints?: number;
    freezeLag?: number;
    minDeltaPoints?: number;
    overlapPoint?: boolean;
    defaultWidth?: number;
    defaultColor?: string;
    defaultOpacity?: number;
    prepareCall?: (
        ctx: CanvasRenderingContext2D,
        points: readonly Point[],
        style: PenStyleOptions,
        base: IncrementalPenBaseData,
    ) => TCtxData;
    renderSinglePoint: (
        ctx: CanvasRenderingContext2D,
        pt: Point,
        style: PenStyleOptions,
        ctxData: TCtxData,
    ) => void;
    renderTwoPoints?: (
        ctx: CanvasRenderingContext2D,
        p0: Point,
        p1: Point,
        style: PenStyleOptions,
        ctxData: TCtxData,
    ) => void;
    initState: (points: readonly Point[], style: PenStyleOptions, ctxData: TCtxData) => TState;
    cloneState?: (state: TState) => TState;
    renderDelta: (
        ctx: CanvasRenderingContext2D,
        points: readonly Point[],
        rawStart: number,
        rawEnd: number,
        style: PenStyleOptions,
        ctxData: TCtxData,
        state: TState,
        alphaScale: number,
    ) => void;
    renderLiveTip?: (
        ctx: CanvasRenderingContext2D,
        lastPt: Point,
        style: PenStyleOptions,
        ctxData: TCtxData,
        state: TState,
        alphaScale: number,
    ) => void;
}

/**
 * Pipeline estándar de renderizado incremental O(1) (Delta Bake + Zero-Shift Sprite Commit).
 * Portado 1:1 desde `sandbox/pens/pencil-common.js`.
 */
export function createIncrementalPen<
    TCtxData extends IncrementalPenBaseData = IncrementalPenBaseData,
    TState extends Record<string, any> = Record<string, any>,
>({
    minLivePoints = 6,
    freezeLag = 1,
    minDeltaPoints = 1,
    overlapPoint = false,
    defaultWidth = 3,
    defaultColor = '#1e1e1e',
    defaultOpacity = 1.0,
    prepareCall,
    renderSinglePoint,
    renderTwoPoints,
    initState,
    cloneState,
    renderDelta,
    renderLiveTip,
}: IncrementalPenConfig<TCtxData, TState>) {
    const liveBake: {
        canvas: HTMLCanvasElement | null;
        ctx: CanvasRenderingContext2D | null;
        dpr: number;
        strokeKey: string;
        bakedRawIdx: number;
        state: TState | null;
    } = {
        canvas: null,
        ctx: null,
        dpr: 1,
        strokeKey: '',
        bakedRawIdx: 0,
        state: null,
    };

    function ensureBakeCanvas(targetCanvas: HTMLCanvasElement | null | undefined, dpr: number): CanvasRenderingContext2D | null {
        if (!targetCanvas || typeof document === 'undefined' || typeof document.createElement !== 'function') {
            return null;
        }
        if (!liveBake.canvas) {
            try {
                liveBake.canvas = document.createElement('canvas');
                liveBake.ctx = liveBake.canvas && typeof liveBake.canvas.getContext === 'function'
                    ? liveBake.canvas.getContext('2d')
                    : null;
            } catch {
                liveBake.canvas = null;
                liveBake.ctx = null;
            }
        }
        if (!liveBake.canvas || !liveBake.ctx) return null;

        if (liveBake.canvas.width !== targetCanvas.width || liveBake.canvas.height !== targetCanvas.height) {
            liveBake.canvas.width = targetCanvas.width;
            liveBake.canvas.height = targetCanvas.height;
            liveBake.strokeKey = '';
            liveBake.bakedRawIdx = 0;
        }
        liveBake.dpr = dpr;
        return liveBake.ctx;
    }

    function resetCache(): void {
        liveBake.strokeKey = '';
        liveBake.bakedRawIdx = 0;
        liveBake.state = null;
    }

    function buildCtxData(
        ctx: CanvasRenderingContext2D,
        points: readonly Point[],
        style: PenStyleOptions,
    ): TCtxData {
        const baseWidth = Math.max(1, style.width || defaultWidth);
        const color = style.color || defaultColor;
        const opacity = style.opacity !== undefined ? style.opacity : defaultOpacity;
        const angle = style.tiltAngle !== undefined ? style.tiltAngle : (-40 * Math.PI) / 180;
        const base: IncrementalPenBaseData = { baseWidth, color, opacity, angle };
        return prepareCall ? prepareCall(ctx, points, style, base) : (base as TCtxData);
    }

    function renderCanvas(ctx: CanvasRenderingContext2D, points: readonly Point[], style: PenStyleOptions = {}): void {
        if (!points || points.length === 0) return;

        const ctxData = buildCtxData(ctx, points, style);
        const { baseWidth, color, opacity, angle } = ctxData;

        // 1. Punto único (tap)
        if (points.length === 1) {
            ctx.save();
            renderSinglePoint(ctx, points[0], style, ctxData);
            ctx.restore();
            return;
        }

        // 2. Dos puntos (opcional)
        if (points.length === 2 && typeof renderTwoPoints === 'function') {
            ctx.save();
            renderTwoPoints(ctx, points[0], points[1], style, ctxData);
            ctx.restore();
            return;
        }

        const n = points.length;
        const targetCanvas = ctx.canvas;
        const isMainCanvasLive = Boolean(targetCanvas && targetCanvas.id === 'drawingCanvas' && !style.viewport);
        const isSpriteCommit = Boolean(style && style.viewport);
        const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;

        const p0 = points[0];
        const p1 = points[1];
        const strokeKey = `${style.strokeId || ''}|${p0.x.toFixed(1)}|${p0.y.toFixed(1)}|${p1.x.toFixed(1)}|${p1.y.toFixed(1)}|${baseWidth}|${color}|${angle.toFixed(3)}`;

        // Caso A: Dibujo en vivo sobre #drawingCanvas -> Delta Bake O(1)
        if (isMainCanvasLive && n > minLivePoints) {
            const bakeCtx = ensureBakeCanvas(targetCanvas, dpr);
            if (bakeCtx && liveBake.canvas) {
                if (liveBake.strokeKey !== strokeKey || n < liveBake.bakedRawIdx || !liveBake.state) {
                    liveBake.strokeKey = strokeKey;
                    liveBake.bakedRawIdx = 0;
                    liveBake.state = initState(points, style, ctxData);

                    bakeCtx.save();
                    bakeCtx.setTransform(1, 0, 0, 1, 0, 0);
                    bakeCtx.clearRect(0, 0, liveBake.canvas.width, liveBake.canvas.height);
                    bakeCtx.restore();
                }

                const freezeIdx = Math.max(0, n - 1 - freezeLag);
                if (freezeIdx - liveBake.bakedRawIdx >= minDeltaPoints - 1) {
                    bakeCtx.save();
                    bakeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    bakeCtx.fillStyle = color;
                    bakeCtx.strokeStyle = color;
                    bakeCtx.globalAlpha = 1.0;

                    renderDelta(
                        bakeCtx,
                        points,
                        liveBake.bakedRawIdx,
                        freezeIdx,
                        style,
                        ctxData,
                        liveBake.state,
                        1.0,
                    );

                    bakeCtx.restore();
                    liveBake.bakedRawIdx = overlapPoint ? freezeIdx : freezeIdx + 1;
                }

                // 1. Volcar el bitmap acumulado con 1 sola operación GPU O(1)
                ctx.save();
                ctx.globalAlpha = opacity;
                if (liveBake.bakedRawIdx > 0) {
                    ctx.save();
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                    ctx.drawImage(liveBake.canvas, 0, 0);
                    ctx.restore();
                }

                // 2. Dibujar únicamente la punta viva pendiente O(1)
                ctx.fillStyle = color;
                ctx.strokeStyle = color;
                const tipState = cloneState ? cloneState(liveBake.state) : ({ ...liveBake.state } as TState);
                if (liveBake.bakedRawIdx <= n - 1) {
                    renderDelta(
                        ctx,
                        points,
                        liveBake.bakedRawIdx,
                        n - 1,
                        style,
                        ctxData,
                        tipState,
                        opacity,
                    );
                }
                if (typeof renderLiveTip === 'function') {
                    renderLiveTip(ctx, points[n - 1], style, ctxData, tipState, opacity);
                }

                ctx.restore();
                return;
            }
        }

        // Caso B: Commit de sprite en `pointerup` -> Copia O(1) sin desplazamiento
        if (
            isSpriteCommit &&
            liveBake.canvas &&
            liveBake.ctx &&
            liveBake.strokeKey === strokeKey &&
            liveBake.bakedRawIdx > 0 &&
            liveBake.state &&
            n >= liveBake.bakedRawIdx
        ) {
            const bakeCtx = liveBake.ctx;
            const bakeDpr = liveBake.dpr || 1;
            bakeCtx.save();
            bakeCtx.setTransform(bakeDpr, 0, 0, bakeDpr, 0, 0);
            bakeCtx.fillStyle = color;
            bakeCtx.strokeStyle = color;
            bakeCtx.globalAlpha = 1.0;

            if (liveBake.bakedRawIdx <= n - 1) {
                renderDelta(
                    bakeCtx,
                    points,
                    liveBake.bakedRawIdx,
                    n - 1,
                    style,
                    ctxData,
                    liveBake.state,
                    1.0,
                );
            }
            if (typeof renderLiveTip === 'function') {
                renderLiveTip(bakeCtx, points[n - 1], style, ctxData, liveBake.state, 1.0);
            }
            bakeCtx.restore();

            liveBake.bakedRawIdx = n;

            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.drawImage(
                liveBake.canvas,
                0,
                0,
                liveBake.canvas.width,
                liveBake.canvas.height,
                0,
                0,
                liveBake.canvas.width / bakeDpr,
                liveBake.canvas.height / bakeDpr,
            );
            ctx.restore();
            return;
        }

        // Caso C: Trazos cortos, previews de tarjeta o redibujado frío
        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.globalAlpha = opacity;

        const coldState = initState(points, style, ctxData);
        renderDelta(ctx, points, 0, n - 1, style, ctxData, coldState, opacity);
        if (typeof renderLiveTip === 'function') {
            renderLiveTip(ctx, points[n - 1], style, ctxData, coldState, opacity);
        }

        ctx.restore();
    }

    /**
     * Renderiza incrementalmente el rango `[fromIndex .. points.length - 1]` manteniendo el
     * estado de empalme en `segState` para buffers incrementales externos (`CanvasController`).
     */
    function renderSegment(
        ctx: CanvasRenderingContext2D,
        points: readonly Point[],
        fromIndex: number,
        style: PenStyleOptions = {},
        segState?: Record<string, unknown>,
    ): void {
        if (!points || points.length === 0) return;

        const ctxData = buildCtxData(ctx, points, style);
        const { color, opacity } = ctxData;

        const stateObj = (segState ?? {}) as TState;
        (stateObj as Record<string, unknown>)._isIncrementalSegment = true;

        if (fromIndex === 0 || !stateObj._initialized) {
            const initial = initState(points, style, ctxData);
            Object.assign(stateObj, initial, { _initialized: true, _isIncrementalSegment: true });
        }

        if (points.length === 1 && fromIndex === 0) {
            ctx.save();
            renderSinglePoint(ctx, points[0], style, ctxData);
            ctx.restore();
            return;
        }

        const rawStart = overlapPoint ? Math.max(0, fromIndex - 1) : Math.max(0, fromIndex);
        const rawEnd = points.length - 1;
        if (rawEnd < rawStart) return;

        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.globalAlpha = opacity;
        renderDelta(ctx, points, rawStart, rawEnd, style, ctxData, stateObj, opacity);
        ctx.restore();
    }

    return {
        renderCanvas,
        renderPen: renderCanvas,
        renderSegment,
        resetCache,
        overlapPoint,
    };
}
