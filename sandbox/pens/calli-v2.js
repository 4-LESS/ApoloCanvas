/**
 * sandbox/pens/calli-v2.js
 *
 * Caligráfica v2 · O(1) (Bisel 2D Exacto + Delta Bake)
 *
 * Corrige los 3 bugs estructurales de `calli.js` y aplica horneado incremental O(1) estricto:
 * 1. Comportamiento perfecto al moverse en dirección paralela al ángulo del bisel:
 *    - En `calli.js`, los extremos de la plumilla dependían de `padSign = sign(dx*nx + dy*ny)`,
 *      que invertía su signo violentamente al moverse paralelo al bisel, retorciendo la cinta
 *      y dejando huecos o bordes deshilachados.
 *    - Aquí la plumilla se modela como un bisel físico 2D de 4 esquinas fijas `c0, c1, c2, c3`
 *      (semiancho mayor `L` en dirección `u` y semigrosor físico `T` en dirección `n`), cuyas
 *      coordenadas dependen SOLO de `(x, y)` y nunca de `(dx, dy)`.
 *    - Cada sub-paso de la spline cuadrática emite la envolvente convexa exacta (hexágono horario
 *      con winding +1) de `R(P1) U R(P2)`. Cuando el movimiento es paralelo al bisel, produce un
 *      trazo fino (hairline) de espesor constante `2T` 100% estable sin saltos de signo.
 * 2. Sin desplazamiento al soltar el lápiz (`pointerup` en modo Canvas):
 *    - `calli.js` sobrescribía `ctx.setTransform(1,0,0,1,0,0)` incluso cuando `OptimizedEngine`
 *      le pasaba el contexto del sprite recortado (`style.viewport`), desplazando el trazo por
 *      `(bounds.minX, bounds.minY)` al levantar el puntero.
 *    - `calli-v2.js` distingue `isMainCanvasLive` de `isSpriteCommit` y transfiere el buffer
 *      horneado respetando la transformación del sprite en O(1) (< 0.2 ms).
 * 3. SVG completo y sincronizado (sin quedarse pegado en el punto inicial):
 *    - `calli.js` guardaba en un `WeakMap(points)` el resultado del primer frame (`points.length === 1`
 *      en `pointerdown`) sin verificar `points.length`, devolviendo siempre el punto inicial
 *      cuando `activePoints` crecía por mutación (`push`). Aquí el caché valida `pointCount === points.length`.
 */

export const id = 'calli-v2';
export const name = 'Caligráfica v2 · O(1) (Bisel 2D)';
export const description = 'Plumilla biselada 2D exacta (estable en paralelo y perpendicular) con Delta Bake O(1) y SVG fiel';
export const incrementalBake = true;

/**
 * Estado del buffer incremental O(1) para el trazo activo en curso.
 */
const liveCalliV2Bake = {
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
    angle: 0,
    color: '',
};

export function resetCalliV2CacheForTesting() {
    liveCalliV2Bake.bakedRawIdx = 0;
    liveCalliV2Bake.firstX = null;
    liveCalliV2Bake.secondX = null;
}

function ensureCalliV2BakeCanvas(targetCanvas, dpr) {
    if (!targetCanvas || typeof document === 'undefined') return null;
    if (!liveCalliV2Bake.canvas) {
        liveCalliV2Bake.canvas = document.createElement('canvas');
        liveCalliV2Bake.ctx = liveCalliV2Bake.canvas.getContext('2d');
    }
    if (!liveCalliV2Bake.canvas || !liveCalliV2Bake.ctx) return null;

    if (
        liveCalliV2Bake.canvas.width !== targetCanvas.width ||
        liveCalliV2Bake.canvas.height !== targetCanvas.height
    ) {
        liveCalliV2Bake.canvas.width = targetCanvas.width;
        liveCalliV2Bake.canvas.height = targetCanvas.height;
        liveCalliV2Bake.bakedRawIdx = 0;
        liveCalliV2Bake.firstX = null;
    }
    liveCalliV2Bake.dpr = dpr;
    return liveCalliV2Bake.ctx;
}

/**
 * Calcula los 4 vectores esquina `(c0, c1, c2, c3)` en sentido horario (+1 en Canvas Y-abajo)
 * del bisel físico 2D para el ancho y ángulo dados:
 *   c0 = -L*u - T*n
 *   c1 = +L*u - T*n
 *   c2 = +L*u + T*n
 *   c3 = -L*u + T*n
 */
function computeNibOffsets(baseWidth, nibAngleRad) {
    const L = Math.max(1.5, baseWidth * 0.85); // Semiancho del filo de la plumilla
    const T = Math.max(0.85, baseWidth * 0.14); // Semigrosor transversal físico del metal

    const ux = Math.cos(nibAngleRad);
    const uy = Math.sin(nibAngleRad);
    const nx = -uy;
    const ny = ux;

    const uLx = ux * L;
    const uLy = uy * L;
    const nTx = nx * T;
    const nTy = ny * T;

    return {
        ux,
        uy,
        nx,
        ny,
        cx: [
            -uLx - nTx, // c0
             uLx - nTx, // c1
             uLx + nTx, // c2
            -uLx + nTx, // c3
        ],
        cy: [
            -uLy - nTy, // c0
             uLy - nTy, // c1
             uLy + nTy, // c2
            -uLy + nTy, // c3
        ],
    };
}

/**
 * Emite en `ctx` el hexágono convexo exacto en sentido horario (+1) que barre el bisel
 * rectangular `R(x1, y1) -> R(x2, y2)`.
 * Totalmente continuo y libre de auto-intersecciones en los 360° (incluyendo movimiento
 * exactamente paralelo al ángulo del bisel).
 */
function emitChiselHullStep(ctx, x1, y1, x2, y2, nib) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const { ux, uy, nx, ny, cx, cy } = nib;

    const du = dx * ux + dy * uy;
    const dn = dx * nx + dy * ny;

    // Índice de la esquina delantera k en {0, 1, 2, 3} según el cuadrante en el marco (u, n)
    let k;
    if (du >= 0) {
        k = dn >= 0 ? 2 : 1;
    } else {
        k = dn >= 0 ? 3 : 0;
    }

    const k1 = (k + 1) & 3;
    const k2 = (k + 2) & 3;
    const k3 = (k + 3) & 3;

    // Envolvente convexa horaria: c_{k+1}(P1) -> c_{k+2}(P1) -> c_{k+3}(P1) -> c_{k+3}(P2) -> c_k(P2) -> c_{k+1}(P2)
    ctx.moveTo(x1 + cx[k1], y1 + cy[k1]);
    ctx.lineTo(x1 + cx[k2], y1 + cy[k2]);
    ctx.lineTo(x1 + cx[k3], y1 + cy[k3]);
    ctx.lineTo(x2 + cx[k3], y2 + cy[k3]);
    ctx.lineTo(x2 + cx[k],  y2 + cy[k]);
    ctx.lineTo(x2 + cx[k1], y2 + cy[k1]);
    ctx.closePath();
}

/**
 * Estampa la huella rectangular horaria del bisel en un punto único `(x, y)`.
 */
function emitChiselStamp(ctx, x, y, nib) {
    const { cx, cy } = nib;
    ctx.moveTo(x + cx[0], y + cy[0]);
    ctx.lineTo(x + cx[1], y + cy[1]);
    ctx.lineTo(x + cx[2], y + cy[2]);
    ctx.lineTo(x + cx[3], y + cy[3]);
    ctx.closePath();
}

/**
 * Renderiza el rango de puntos `[rawStart .. rawEnd]` usando subdivisión cuadrática por puntos medios
 * y actualiza `stateObj.lastMidX / lastMidY`.
 * Complejidad: O(rawEnd - rawStart).
 */
function renderCalliV2DeltaRange(ctx, points, rawStart, rawEnd, nib, stateObj, flushBatchSize = 48) {
    let prevMidX = stateObj.lastMidX;
    let prevMidY = stateObj.lastMidY;

    let stepCountInBatch = 0;
    ctx.beginPath();

    if (rawStart === 0) {
        prevMidX = points[0].x;
        prevMidY = points[0].y;
        emitChiselStamp(ctx, prevMidX, prevMidY, nib);
        stepCountInBatch++;
    }

    const startIdx = Math.max(1, rawStart);
    for (let i = startIdx; i <= rawEnd; i++) {
        const pPrev = points[i - 1];
        const pCurr = points[i];

        const midX = (pPrev.x + pCurr.x) * 0.5;
        const midY = (pPrev.y + pCurr.y) * 0.5;

        const x0 = prevMidX;
        const y0 = prevMidY;

        const chordDist = Math.hypot(midX - x0, midY - y0);
        if (chordDist < 0.05) continue;

        const ctrlDist = Math.hypot(pPrev.x - x0, pPrev.y - y0) + Math.hypot(midX - pPrev.x, midY - pPrev.y);
        const steps = Math.max(1, Math.min(8, Math.ceil(ctrlDist / 2.8)));

        let subPrevX = x0;
        let subPrevY = y0;

        for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const inv = 1 - t;
            const qx = inv * inv * x0 + 2 * inv * t * pPrev.x + t * t * midX;
            const qy = inv * inv * y0 + 2 * inv * t * pPrev.y + t * t * midY;

            emitChiselHullStep(ctx, subPrevX, subPrevY, qx, qy, nib);

            subPrevX = qx;
            subPrevY = qy;
            stepCountInBatch++;

            if (stepCountInBatch >= flushBatchSize) {
                ctx.fill('nonzero');
                ctx.beginPath();
                stepCountInBatch = 0;
            }
        }

        prevMidX = subPrevX;
        prevMidY = subPrevY;
    }

    if (stepCountInBatch > 0) {
        ctx.fill('nonzero');
    }

    stateObj.lastMidX = prevMidX;
    stateObj.lastMidY = prevMidY;
}

/**
 * Dibuja el tramo final vivo desde `lastMid` hasta `points[n-1]`.
 */
function renderCalliV2LiveTip(ctx, lastPt, nib, stateObj) {
    ctx.beginPath();
    const d = Math.hypot(lastPt.x - stateObj.lastMidX, lastPt.y - stateObj.lastMidY);
    if (d >= 0.05) {
        emitChiselHullStep(ctx, stateObj.lastMidX, stateObj.lastMidY, lastPt.x, lastPt.y, nib);
    } else {
        emitChiselStamp(ctx, lastPt.x, lastPt.y, nib);
    }
    ctx.fill('nonzero');
}

/**
 * Renderiza un trazo de Caligráfica v2 en Canvas2D con complejidad O(1) por frame.
 */
export function renderCanvas(ctx, points, style = {}) {
    if (!points || points.length === 0) return;

    const baseWidth = Math.max(1, style.width || 4);
    const color = style.color || '#1e1e1e';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;
    const angle = style.tiltAngle !== undefined ? style.tiltAngle : (-40 * Math.PI) / 180;
    const nib = computeNibOffsets(baseWidth, angle);

    // Caso 1: Punto único
    if (points.length === 1) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        emitChiselStamp(ctx, points[0].x, points[0].y, nib);
        ctx.fill('nonzero');
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
        const bakeCtx = ensureCalliV2BakeCanvas(targetCanvas, dpr);
        if (bakeCtx) {
            const p0 = points[0];
            const p1 = points[1];
            const isSameStroke =
                liveCalliV2Bake.firstX === p0.x &&
                liveCalliV2Bake.firstY === p0.y &&
                liveCalliV2Bake.secondX === p1.x &&
                liveCalliV2Bake.secondY === p1.y &&
                liveCalliV2Bake.width === baseWidth &&
                Math.abs(liveCalliV2Bake.angle - angle) < 1e-4 &&
                liveCalliV2Bake.color === color &&
                n >= liveCalliV2Bake.bakedRawIdx;

            if (!isSameStroke) {
                liveCalliV2Bake.firstX = p0.x;
                liveCalliV2Bake.firstY = p0.y;
                liveCalliV2Bake.secondX = p1.x;
                liveCalliV2Bake.secondY = p1.y;
                liveCalliV2Bake.bakedRawIdx = 0;
                liveCalliV2Bake.lastMidX = p0.x;
                liveCalliV2Bake.lastMidY = p0.y;
                liveCalliV2Bake.width = baseWidth;
                liveCalliV2Bake.angle = angle;
                liveCalliV2Bake.color = color;

                bakeCtx.save();
                bakeCtx.setTransform(1, 0, 0, 1, 0, 0);
                bakeCtx.clearRect(0, 0, liveCalliV2Bake.canvas.width, liveCalliV2Bake.canvas.height);
                bakeCtx.restore();
            }

            // Hornear incrementalmente solo el rango nuevo hasta n - 2 con globalAlpha = 1.0
            const freezeIdx = n - 2;
            if (freezeIdx >= liveCalliV2Bake.bakedRawIdx) {
                bakeCtx.save();
                bakeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                bakeCtx.fillStyle = color;
                bakeCtx.globalAlpha = 1.0;

                renderCalliV2DeltaRange(
                    bakeCtx,
                    points,
                    liveCalliV2Bake.bakedRawIdx,
                    freezeIdx,
                    nib,
                    liveCalliV2Bake,
                    48
                );

                bakeCtx.restore();
                liveCalliV2Bake.bakedRawIdx = freezeIdx + 1;
            }

            // 1. Volcar el buffer horneado con 1 sola llamada GPU O(1)
            ctx.save();
            ctx.globalAlpha = opacity;

            if (liveCalliV2Bake.bakedRawIdx > 0) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.drawImage(liveCalliV2Bake.canvas, 0, 0);
                ctx.restore();
            }

            // 2. Dibujar únicamente el segmento final vivo O(1)
            ctx.fillStyle = color;
            const tipState = {
                lastMidX: liveCalliV2Bake.lastMidX,
                lastMidY: liveCalliV2Bake.lastMidY,
            };
            renderCalliV2DeltaRange(
                ctx,
                points,
                liveCalliV2Bake.bakedRawIdx,
                n - 1,
                nib,
                tipState,
                32
            );
            renderCalliV2LiveTip(ctx, points[n - 1], nib, tipState);

            ctx.restore();
            return;
        }
    }

    // Caso B: Commit de sprite en `pointerup` dentro de OptimizedEngine -> Copia O(1) sin desplazamiento
    if (isSpriteCommit && liveCalliV2Bake.canvas && liveCalliV2Bake.bakedRawIdx > 0 && n > 6) {
        const p0 = points[0];
        const p1 = points[1];
        if (
            liveCalliV2Bake.firstX === p0.x &&
            liveCalliV2Bake.firstY === p0.y &&
            liveCalliV2Bake.secondX === p1.x &&
            liveCalliV2Bake.secondY === p1.y &&
            liveCalliV2Bake.width === baseWidth &&
            Math.abs(liveCalliV2Bake.angle - angle) < 1e-4 &&
            liveCalliV2Bake.color === color &&
            n >= liveCalliV2Bake.bakedRawIdx
        ) {
            const bakeCtx = liveCalliV2Bake.ctx;
            const bakeDpr = liveCalliV2Bake.dpr || 1;
            bakeCtx.save();
            bakeCtx.setTransform(bakeDpr, 0, 0, bakeDpr, 0, 0);
            bakeCtx.fillStyle = color;
            bakeCtx.globalAlpha = 1.0;

            if (liveCalliV2Bake.bakedRawIdx <= n - 1) {
                renderCalliV2DeltaRange(
                    bakeCtx,
                    points,
                    liveCalliV2Bake.bakedRawIdx,
                    n - 1,
                    nib,
                    liveCalliV2Bake,
                    48
                );
            }
            renderCalliV2LiveTip(bakeCtx, points[n - 1], nib, liveCalliV2Bake);
            bakeCtx.restore();

            liveCalliV2Bake.bakedRawIdx = n;

            // Copiar desde liveCalliV2Bake respetando la matriz de transformación del sprite (-bounds.minX, -bounds.minY)
            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.drawImage(
                liveCalliV2Bake.canvas,
                0,
                0,
                liveCalliV2Bake.canvas.width,
                liveCalliV2Bake.canvas.height,
                0,
                0,
                liveCalliV2Bake.canvas.width / bakeDpr,
                liveCalliV2Bake.canvas.height / bakeDpr
            );
            ctx.restore();
            return;
        }
    }

    // Caso C: Trazos cortos (<= 6 puntos), previews de tarjeta o redibujado frío
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;

    const coldState = {
        lastMidX: points[0].x,
        lastMidY: points[0].y,
    };
    renderCalliV2DeltaRange(ctx, points, 0, n - 1, nib, coldState, 48);
    renderCalliV2LiveTip(ctx, points[n - 1], nib, coldState);

    ctx.restore();
}

export const renderPen = renderCanvas;

/**
 * Exportación SVG de Caligráfica v2 mediante la envolvente convexa exacta de bisel 2D.
 * Incluye validación de longitud (`pointCount === points.length`) para que nunca devuelva
 * únicamente el punto inicial cuando el array de puntos crece en vivo.
 */
const svgCache = new WeakMap();

export function renderSvg(points, style = {}) {
    if (!points || points.length === 0) return { defs: {}, body: '' };

    const baseWidth = Math.max(1, style.width || 4);
    const color = style.color || '#1e1e1e';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;
    const angle = style.tiltAngle !== undefined ? style.tiltAngle : (-40 * Math.PI) / 180;

    const cached = svgCache.get(points);
    if (
        cached &&
        cached.pointCount === points.length &&
        cached.width === baseWidth &&
        Math.abs(cached.angle - angle) < 1e-4 &&
        cached.color === color &&
        cached.opacity === opacity
    ) {
        return cached.out;
    }

    const nib = computeNibOffsets(baseWidth, angle);
    const { ux, uy, nx, ny, cx, cy } = nib;
    const f = (v) => (Math.round(v * 10) / 10).toString();

    let d = '';
    const appendStampSvg = (x, y) => {
        d += `M${f(x + cx[0])} ${f(y + cy[0])}` +
             `L${f(x + cx[1])} ${f(y + cy[1])}` +
             `L${f(x + cx[2])} ${f(y + cy[2])}` +
             `L${f(x + cx[3])} ${f(y + cy[3])}Z`;
    };

    const appendHullSvg = (x1, y1, x2, y2) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        if (Math.hypot(dx, dy) < 0.05) return;
        const du = dx * ux + dy * uy;
        const dn = dx * nx + dy * ny;
        const k = du >= 0 ? (dn >= 0 ? 2 : 1) : (dn >= 0 ? 3 : 0);
        const k1 = (k + 1) & 3;
        const k2 = (k + 2) & 3;
        const k3 = (k + 3) & 3;

        d += `M${f(x1 + cx[k1])} ${f(y1 + cy[k1])}` +
             `L${f(x1 + cx[k2])} ${f(y1 + cy[k2])}` +
             `L${f(x1 + cx[k3])} ${f(y1 + cy[k3])}` +
             `L${f(x2 + cx[k3])} ${f(y2 + cy[k3])}` +
             `L${f(x2 + cx[k])} ${f(y2 + cy[k])}` +
             `L${f(x2 + cx[k1])} ${f(y2 + cy[k1])}Z`;
    };

    const n = points.length;
    appendStampSvg(points[0].x, points[0].y);

    if (n > 1) {
        let prevX = points[0].x;
        let prevY = points[0].y;

        for (let i = 1; i < n; i++) {
            const pPrev = points[i - 1];
            const pCurr = points[i];
            const midX = (pPrev.x + pCurr.x) * 0.5;
            const midY = (pPrev.y + pCurr.y) * 0.5;

            const x0 = prevX;
            const y0 = prevY;
            const chordDist = Math.hypot(midX - x0, midY - y0);
            if (chordDist < 0.05) continue;

            const ctrlDist = Math.hypot(pPrev.x - x0, pPrev.y - y0) + Math.hypot(midX - pPrev.x, midY - pPrev.y);
            const steps = Math.max(1, Math.min(4, Math.ceil(ctrlDist / 4.0)));

            let subPrevX = x0;
            let subPrevY = y0;
            for (let s = 1; s <= steps; s++) {
                const t = s / steps;
                const inv = 1 - t;
                const qx = inv * inv * x0 + 2 * inv * t * pPrev.x + t * t * midX;
                const qy = inv * inv * y0 + 2 * inv * t * pPrev.y + t * t * midY;
                appendHullSvg(subPrevX, subPrevY, qx, qy);
                subPrevX = qx;
                subPrevY = qy;
            }
            prevX = subPrevX;
            prevY = subPrevY;
        }

        const lastPt = points[n - 1];
        appendHullSvg(prevX, prevY, lastPt.x, lastPt.y);
    }

    const out = {
        defs: {},
        body: `<path d="${d}" fill="${color}" fill-rule="nonzero" fill-opacity="${opacity.toFixed(2)}"/>`,
    };

    svgCache.set(points, {
        pointCount: points.length,
        width: baseWidth,
        angle,
        color,
        opacity,
        out,
    });

    return out;
}

if (typeof globalThis !== 'undefined') {
    globalThis.ApoloSandbox = globalThis.ApoloSandbox || { pens: {}, engines: {} };
    globalThis.ApoloSandbox.pens['calli-v2'] = {
        id,
        name,
        description,
        incrementalBake,
        renderPen,
        renderCanvas,
        renderSvg,
    };
}
