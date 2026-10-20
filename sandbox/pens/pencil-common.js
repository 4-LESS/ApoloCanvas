/**
 * sandbox/pens/pencil-common.js
 *
 * Núcleo compartido de utilidades geométricas y pipeline estándar O(1) para las herramientas
 * de dibujo de ApoloCanvas (`ball.js`, `fountain-v2.js`, `calli-v2.js`, `pencil-sketch.js`
 * y futuras plumas personalizadas).
 */

/** Hash determinista 1D en [0, 1) — estable entre frames (sin parpadeo en live preview). */
export function hash(i, seed = 0) {
    const v = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    return v - Math.floor(v);
}

/** Hash entero rápido 1D en [0, 1) libre de trigonometría. */
export function hash1D(i, salt = 0) {
    let h = Math.imul((i | 0) ^ (salt | 0), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Hash entero rápido 2D en [0, 1) para campos de textura de papel. */
export function hash2D(x, y, seed = 0) {
    let h = Math.imul(x ^ seed, 374761393) + Math.imul(y ^ (seed >> 3), 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Curva de presión estándar con suavizado Hermite (smoothstep). */
export function pressureScale(p, minScale = 0.45, maxScale = 1.35, gamma = 0.8) {
    if (p === undefined || isNaN(p) || p <= 0) return 1;
    const t = Math.pow(Math.max(0, Math.min(1, p)), gamma);
    const e = t * t * (3 - 2 * t);
    return minScale + e * (maxScale - minScale);
}

export function meanPressure(points) {
    let s = 0;
    for (const p of points) s += p.pressure ?? 0.5;
    return points.length ? s / points.length : 0.5;
}

/** Normales unitarias por punto (promedio de segmentos adyacentes). */
export function normals(points) {
    const n = points.length;
    const out = new Array(n);
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
export function tracePath(ctx, pts) {
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

const f = (v) => (Math.round(v * 10) / 10).toString();

/** Mismo camino que tracePath pero serializado como atributo SVG `d`. */
export function svgPathD(pts) {
    if (pts.length === 1) return `M${f(pts[0].x)} ${f(pts[0].y)}l0.01 0`;
    let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1];
        const c = pts[i];
        d += `Q${f(p.x)} ${f(p.y)} ${f((p.x + c.x) * 0.5)} ${f((p.y + c.y) * 0.5)}`;
    }
    const l = pts[pts.length - 1];
    return d + `L${f(l.x)} ${f(l.y)}`;
}

/** Polígono cerrado como atributo SVG `d`. */
export function svgPolygonD(poly) {
    let d = '';
    for (let i = 0; i < poly.length; i++) d += (i ? 'L' : 'M') + f(poly[i].x) + ' ' + f(poly[i].y);
    return d + 'Z';
}

export const fmt = f;
export const colorId = (c) => String(c).replace(/[^a-zA-Z0-9]/g, '');

/**
 * Envuelve un generador SVG `(points, style) => { defs, body }` con un caché `WeakMap`
 * que valida estrictamente `pointCount === points.length`.
 * Previene el bug donde `activePoints.push(pt)` muta el array en vivo y un caché ingenuo
 * devolvería únicamente el punto inicial capturado en `pointerdown`.
 */
export function createCachedSvgRenderer(buildSvgFn) {
    const cache = new WeakMap();

    return function renderSvg(points, style = {}) {
        if (!points || points.length === 0) return { defs: {}, body: '' };

        const width = style.width || 3;
        const color = style.color || '#1e1e1e';
        const opacity = style.opacity !== undefined ? style.opacity : 1.0;
        const tiltAngle = style.tiltAngle !== undefined ? style.tiltAngle : 0;

        if (typeof points === 'object') {
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

        if (typeof points === 'object') {
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

/**
 * Pipeline estándar de renderizado incremental O(1) (Delta Bake + Zero-Shift Sprite Commit).
 *
 * Separa automáticamente los 3 escenarios de ejecución del motor:
 * - Caso A (`isMainCanvasLive`): Durante `pointermove` en `#drawingCanvas`, hornea únicamente
 *   los puntos nuevos `[bakedRawIdx .. freezeIdx]` sobre un buffer offscreen con `globalAlpha = 1.0`
 *   (unión booleana idempotente sin costuras), vuelca el buffer con 1 `ctx.drawImage` O(1)
 *   aplicando la opacidad global del trazo, y dibuja sólo la punta viva (~1..4 puntos).
 * - Caso B (`isSpriteCommit`): Al soltar el puntero (`pointerup`, cuando `OptimizedEngine` pasa
 *   `style.viewport`), termina de hornear la punta viva y transfiere el bitmap al sprite
 *   respetando la matriz de traslación `(-bounds.minX, -bounds.minY)` en < 0.2 ms (sin re-teselar
 *   los 50.000 puntos ni desplazar coordenadas).
 * - Caso C (Cold / Preview / Fallback): Trazos cortos, miniaturas de la barra lateral o motores
 *   inmediatos sin estado.
 */
export function createIncrementalPen({
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
}) {
    const liveBake = {
        canvas: null,
        ctx: null,
        dpr: 1,
        strokeKey: '',
        bakedRawIdx: 0,
        state: null,
    };

    function ensureBakeCanvas(targetCanvas, dpr) {
        if (!targetCanvas || typeof document === 'undefined' || typeof document.createElement !== 'function') {
            return null;
        }
        if (!liveBake.canvas) {
            liveBake.canvas = document.createElement('canvas');
            liveBake.ctx = liveBake.canvas.getContext && liveBake.canvas.getContext('2d');
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

    function resetCache() {
        liveBake.strokeKey = '';
        liveBake.bakedRawIdx = 0;
        liveBake.state = null;
    }

    function renderCanvas(ctx, points, style = {}) {
        if (!points || points.length === 0) return;

        const baseWidth = Math.max(1, style.width || defaultWidth);
        const color = style.color || defaultColor;
        const opacity = style.opacity !== undefined ? style.opacity : defaultOpacity;
        const angle = style.tiltAngle !== undefined ? style.tiltAngle : (-40 * Math.PI) / 180;
        const ctxData = prepareCall ? prepareCall(ctx, points, style, { baseWidth, color, opacity, angle }) : { baseWidth, color, opacity, angle };

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
            if (bakeCtx) {
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
                        1.0
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
                const tipState = cloneState ? cloneState(liveBake.state) : { ...liveBake.state };
                if (liveBake.bakedRawIdx <= n - 1) {
                    renderDelta(
                        ctx,
                        points,
                        liveBake.bakedRawIdx,
                        n - 1,
                        style,
                        ctxData,
                        tipState,
                        opacity
                    );
                }
                if (typeof renderLiveTip === 'function') {
                    renderLiveTip(ctx, points[n - 1], style, ctxData, tipState, opacity);
                }

                ctx.restore();
                return;
            }
        }

        // Caso B: Commit de sprite en `pointerup` dentro de OptimizedEngine -> Copia O(1) sin desplazamiento
        if (
            isSpriteCommit &&
            liveBake.canvas &&
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
                    1.0
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
                liveBake.canvas.height / bakeDpr
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

    return {
        renderCanvas,
        renderPen: renderCanvas,
        resetCache,
    };
}
