/**
 * sandbox/pens/ball.js
 *
 * Bolígrafo (Ballpoint Pen) — O(1) Incremental Delta Bake
 * Trazo monolínea uniforme con terminaciones redondeadas, flujo de tinta constante
 * y complejidad O(1) estricta tanto en dibujo en vivo (50.000+ puntos a 120 FPS)
 * como al soltar el trazo (commit instantáneo a sprite).
 *
 * Contrato:
 * export function renderPen(ctx, points, style)
 * export function renderCanvas(ctx, points, style)
 * export function renderSvg(points, style)
 */

export const id = 'ball';
export const name = 'Bolígrafo';
export const description = 'Monolínea constante y precisa con horneado incremental O(1) y flujo de tinta uniforme';
export const incrementalBake = true;

/**
 * Estado del buffer incremental O(1) para el trazo activo en curso.
 * En una spline cuadrática de puntos medios M_i = (P_{i-1} + P_i) / 2, el tramo
 * desde M_{i-1} hasta M_i con punto de control P_{i-1} es 100% determinista e inmutable
 * tan pronto como llega P_i.
 * Horneamos con `globalAlpha = 1.0` y `lineCap = 'round'` sobre `liveBallBake.canvas`:
 * como cada tramo termina exactamente en M_k con media circunferencia de radio w/2 y el
 * siguiente tramo arranca exactamente en M_k con la otra media circunferencia y alfa 1.0,
 * la unión es 100% idempotente (1.0 U 1.0 = 1.0), sin grietas ni costuras de opacidad.
 */
const liveBallBake = {
    canvas: null,
    ctx: null,
    dpr: 1,
    firstX: null,
    firstY: null,
    secondX: null,
    secondY: null,
    bakedRawIdx: 0,
    lastMidX: 0,
    lastMidY: 0,
    width: 0,
    color: '',
};

export function resetBallCacheForTesting() {
    liveBallBake.bakedRawIdx = 0;
    liveBallBake.firstX = null;
    liveBallBake.secondX = null;
}

function ensureBallBakeCanvas(targetCanvas, dpr) {
    if (!targetCanvas || typeof document === 'undefined') return null;
    if (!liveBallBake.canvas) {
        liveBallBake.canvas = document.createElement('canvas');
        liveBallBake.ctx = liveBallBake.canvas.getContext('2d');
    }
    if (!liveBallBake.canvas || !liveBallBake.ctx) return null;

    if (
        liveBallBake.canvas.width !== targetCanvas.width ||
        liveBallBake.canvas.height !== targetCanvas.height
    ) {
        liveBallBake.canvas.width = targetCanvas.width;
        liveBallBake.canvas.height = targetCanvas.height;
        liveBallBake.bakedRawIdx = 0;
        liveBallBake.firstX = null;
    }
    liveBallBake.dpr = dpr;
    return liveBallBake.ctx;
}

/**
 * Traza en `ctx` los segmentos cuadráticos por puntos medios en el rango `[rawStart .. rawEnd]`
 * actualizando `stateObj.lastMidX / lastMidY`.
 * En renderizados largos en frío, divide en lotes de `flushBatchSize` para que el teselador
 * de trazos del navegador mantenga costo constante por lote.
 */
function strokeBallpointDeltaRange(ctx, points, rawStart, rawEnd, baseWidth, stateObj, flushBatchSize = 128) {
    let prevMidX = stateObj.lastMidX;
    let prevMidY = stateObj.lastMidY;

    ctx.lineWidth = baseWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    if (rawStart === 0) {
        prevMidX = points[0].x;
        prevMidY = points[0].y;
    }

    ctx.moveTo(prevMidX, prevMidY);
    let countInBatch = 0;

    const startIdx = Math.max(1, rawStart);
    for (let i = startIdx; i <= rawEnd; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const mx = (prev.x + curr.x) * 0.5;
        const my = (prev.y + curr.y) * 0.5;

        ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
        prevMidX = mx;
        prevMidY = my;
        countInBatch++;

        if (countInBatch >= flushBatchSize) {
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(prevMidX, prevMidY);
            countInBatch = 0;
        }
    }

    if (countInBatch > 0) {
        ctx.stroke();
    }

    stateObj.lastMidX = prevMidX;
    stateObj.lastMidY = prevMidY;
}

/**
 * Renderiza un trazo de bolígrafo con complejidad O(1) en vivo y al confirmar el sprite.
 * @param {CanvasRenderingContext2D} ctx - Contexto 2D del canvas
 * @param {Array<{x: number, y: number, pressure?: number}>} points - Secuencia de puntos
 * @param {{width: number, opacity: number, color: string, simulatePressure?: boolean, viewport?: object}} style - Parámetros de estilo
 */
export function renderCanvas(ctx, points, style = {}) {
    if (!points || points.length === 0) return;

    const baseWidth = Math.max(1, (style.width || 3) * 0.9);
    const color = style.color || '#1e1e1e';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;

    // Caso 1: Punto único (toque o tap)
    if (points.length === 1) {
        const pt = points[0];
        const pressure = pt.pressure !== undefined && pt.pressure > 0 ? pt.pressure : 0.5;
        const radius = Math.max(1, (baseWidth / 2) * (style.simulatePressure ? (0.75 + pressure * 0.5) : 1));
        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
    }

    // Caso 2: Dos puntos simples
    if (points.length === 2) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = opacity;
        ctx.lineWidth = baseWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        ctx.stroke();
        ctx.restore();
        return;
    }

    const n = points.length;
    const targetCanvas = ctx.canvas;
    const isMainCanvasLive = Boolean(targetCanvas && targetCanvas.id === 'drawingCanvas' && !style.viewport);
    const isSpriteCommit = Boolean(style && style.viewport);
    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;

    // Caso A: Dibujo en vivo sobre el canvas principal -> Horneado incremental O(1)
    if (isMainCanvasLive && n > 6) {
        const bakeCtx = ensureBallBakeCanvas(targetCanvas, dpr);
        if (bakeCtx) {
            const p0 = points[0];
            const p1 = points[1];
            const isSameStroke =
                liveBallBake.firstX === p0.x &&
                liveBallBake.firstY === p0.y &&
                liveBallBake.secondX === p1.x &&
                liveBallBake.secondY === p1.y &&
                liveBallBake.width === baseWidth &&
                liveBallBake.color === color &&
                n >= liveBallBake.bakedRawIdx;

            if (!isSameStroke) {
                liveBallBake.firstX = p0.x;
                liveBallBake.firstY = p0.y;
                liveBallBake.secondX = p1.x;
                liveBallBake.secondY = p1.y;
                liveBallBake.bakedRawIdx = 0;
                liveBallBake.lastMidX = p0.x;
                liveBallBake.lastMidY = p0.y;
                liveBallBake.width = baseWidth;
                liveBallBake.color = color;

                bakeCtx.save();
                bakeCtx.setTransform(1, 0, 0, 1, 0, 0);
                bakeCtx.clearRect(0, 0, liveBallBake.canvas.width, liveBallBake.canvas.height);
                bakeCtx.restore();
            }

            // Hornear todos los segmentos nuevos hasta M_{n-1} sobre liveBallBake con opacidad 1.0
            const freezeIdx = n - 1;
            if (freezeIdx >= liveBallBake.bakedRawIdx) {
                bakeCtx.save();
                bakeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                bakeCtx.strokeStyle = color;
                bakeCtx.globalAlpha = 1.0;

                strokeBallpointDeltaRange(
                    bakeCtx,
                    points,
                    liveBallBake.bakedRawIdx,
                    freezeIdx,
                    baseWidth,
                    liveBallBake,
                    128
                );

                bakeCtx.restore();
                liveBallBake.bakedRawIdx = freezeIdx + 1;
            }

            // 1. Volcar el buffer horneado con 1 sola llamada GPU O(1)
            ctx.save();
            ctx.globalAlpha = opacity;

            if (liveBallBake.bakedRawIdx > 0) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.drawImage(liveBallBake.canvas, 0, 0);
                ctx.restore();
            }

            // 2. Dibujar únicamente el remate vivo desde M_{n-1} hasta P_{n-1} (1 segmento -> O(1))
            const last = points[n - 1];
            ctx.strokeStyle = color;
            ctx.lineWidth = baseWidth;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(liveBallBake.lastMidX, liveBallBake.lastMidY);
            ctx.lineTo(last.x, last.y);
            ctx.stroke();

            ctx.restore();
            return;
        }
    }

    // Caso B: Commit de sprite en `pointerup` dentro de OptimizedEngine -> Copia O(1) desde liveBallBake
    if (isSpriteCommit && liveBallBake.canvas && liveBallBake.bakedRawIdx > 0 && n > 6) {
        const p0 = points[0];
        const p1 = points[1];
        if (
            liveBallBake.firstX === p0.x &&
            liveBallBake.firstY === p0.y &&
            liveBallBake.secondX === p1.x &&
            liveBallBake.secondY === p1.y &&
            liveBallBake.width === baseWidth &&
            liveBallBake.color === color &&
            n >= liveBallBake.bakedRawIdx
        ) {
            const bakeCtx = liveBallBake.ctx;
            const bakeDpr = liveBallBake.dpr || 1;
            bakeCtx.save();
            bakeCtx.setTransform(bakeDpr, 0, 0, bakeDpr, 0, 0);
            bakeCtx.strokeStyle = color;
            bakeCtx.globalAlpha = 1.0;

            if (liveBallBake.bakedRawIdx <= n - 1) {
                strokeBallpointDeltaRange(
                    bakeCtx,
                    points,
                    liveBallBake.bakedRawIdx,
                    n - 1,
                    baseWidth,
                    liveBallBake,
                    128
                );
            }

            // Remate final hasta el último punto P_{n-1}
            const last = points[n - 1];
            bakeCtx.lineWidth = baseWidth;
            bakeCtx.lineCap = 'round';
            bakeCtx.lineJoin = 'round';
            bakeCtx.beginPath();
            bakeCtx.moveTo(liveBallBake.lastMidX, liveBallBake.lastMidY);
            bakeCtx.lineTo(last.x, last.y);
            bakeCtx.stroke();
            bakeCtx.restore();

            liveBallBake.bakedRawIdx = n;

            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.drawImage(
                liveBallBake.canvas,
                0,
                0,
                liveBallBake.canvas.width,
                liveBallBake.canvas.height,
                0,
                0,
                liveBallBake.canvas.width / bakeDpr,
                liveBallBake.canvas.height / bakeDpr
            );
            ctx.restore();
            return;
        }
    }

    // Caso C: Trazos cortos (<= 6 puntos), previews de tarjeta o redibujado frío
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    ctx.lineWidth = baseWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (n <= 256) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < n; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const mx = (prev.x + curr.x) * 0.5;
            const my = (prev.y + curr.y) * 0.5;
            ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
        }
        const last = points[n - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
    } else {
        const coldState = { lastMidX: points[0].x, lastMidY: points[0].y };
        strokeBallpointDeltaRange(ctx, points, 0, n - 1, baseWidth, coldState, 128);
        const last = points[n - 1];
        ctx.beginPath();
        ctx.moveTo(coldState.lastMidX, coldState.lastMidY);
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
    }

    ctx.restore();
}

export const renderPen = renderCanvas;

/**
 * Exportación SVG equivalente al trazo cuadrático continuo de Canvas
 */
export function renderSvg(points, style = {}) {
    if (!points || points.length === 0) return { defs: {}, body: '' };

    const baseWidth = Math.max(1, (style.width || 3) * 0.9);
    const color = style.color || '#1e1e1e';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;
    const f = (n) => (Math.round(n * 10) / 10).toString();

    if (points.length === 1) {
        const pt = points[0];
        const pressure = pt.pressure !== undefined && pt.pressure > 0 ? pt.pressure : 0.5;
        const radius = Math.max(1, (baseWidth / 2) * (style.simulatePressure ? (0.75 + pressure * 0.5) : 1));
        return {
            defs: {},
            body: `<circle cx="${f(pt.x)}" cy="${f(pt.y)}" r="${f(radius)}" fill="${color}" fill-opacity="${opacity.toFixed(2)}"/>`,
        };
    }

    let d = `M${f(points[0].x)} ${f(points[0].y)}`;
    if (points.length === 2) {
        d += `L${f(points[1].x)} ${f(points[1].y)}`;
    } else {
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            d += `Q${f(prev.x)} ${f(prev.y)} ${f((prev.x + curr.x) / 2)} ${f((prev.y + curr.y) / 2)}`;
        }
        const last = points[points.length - 1];
        d += `L${f(last.x)} ${f(last.y)}`;
    }

    return {
        defs: {},
        body: `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(baseWidth)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${opacity.toFixed(2)}"/>`,
    };
}

// Fallback de registro global para compatibilidad directa
if (typeof globalThis !== 'undefined') {
    globalThis.ApoloSandbox = globalThis.ApoloSandbox || { pens: {}, engines: {} };
    globalThis.ApoloSandbox.pens.ball = {
        id,
        name,
        description,
        incrementalBake,
        renderPen,
        renderCanvas,
        renderSvg,
    };
}
