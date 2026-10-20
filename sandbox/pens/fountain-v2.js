/**
 * sandbox/pens/fountain-v2.js
 *
 * Estilográfica v2 · O(1) (Cinta Variable + Delta Bake)
 *
 * Soluciona los cuellos de botella de `fountain.js` (que caía a 1 FPS / 1780 ms en 50k puntos)
 * manteniendo bordes 100% continuos, curvos y libres de grietas o costillas:
 * 1. Complejidad O(1) estricta en vivo (`renderCanvas`):
 *    - Hornea incrementalmente SOLO los puntos nuevos `[bakedRawIdx .. n-2]` sobre un buffer
 *      offscreen (`liveFountainBake`) con `globalAlpha = 1` (unión idempotente sin costuras).
 *    - En cada frame vuelca el buffer con 1 `ctx.drawImage` O(1) y dibuja únicamente la punta viva.
 * 2. Commit O(1) instantáneo al soltar (`pointerup` en OptimizedEngine):
 *    - Reutiliza `liveFountainBake.canvas` directamente al construir el sprite del trazo (< 0.2 ms).
 * 3. Cápsulas tangenciales exactas con winding horario (+1) y spline cuadrática sin saltos:
 *    - Cada sub-paso de la curva cuadrática se emite como la envolvente convexa exacta entre dos
 *      círculos (trapecio tangencial horario + disco de unión horario en el extremo), eliminando
 *      por completo los gaps triangulares en giros y las costillas dentadas en los bordes.
 */

export const id = 'fountain-v2';
export const name = 'Estilográfica v2 · O(1) (Delta Bake)';
export const description = 'Estilográfica de ancho variable con horneado incremental O(1), cápsulas continuas sin gaps y SVG compacto';
export const incrementalBake = true;

const FOUNTAIN_V2_CONFIG = {
    minScale: 0.35,
    maxScale: 1.60,
    gamma: 0.75,
};

/**
 * Mapea presión cruda [0..1] a un factor de escala no lineal natural
 */
export function calculateFountainV2PressureScale(rawPressure) {
    if (rawPressure === undefined || isNaN(rawPressure) || rawPressure <= 0) {
        return 1.0;
    }
    const p = Math.max(0, Math.min(1, rawPressure));
    const curvedT = Math.pow(p, FOUNTAIN_V2_CONFIG.gamma);
    const easedT = curvedT * curvedT * (3 - 2 * curvedT);
    return FOUNTAIN_V2_CONFIG.minScale + easedT * (FOUNTAIN_V2_CONFIG.maxScale - FOUNTAIN_V2_CONFIG.minScale);
}

/**
 * Estado del buffer incremental O(1) para el trazo activo en curso.
 */
const liveFountainBake = {
    canvas: null,
    ctx: null,
    dpr: 1,
    firstX: null,
    firstY: null,
    secondX: null,
    secondY: null,
    bakedRawIdx: 0,
    bakedTotalLen: 0,
    lastMidX: 0,
    lastMidY: 0,
    lastR: 0,
    lastEmaP: 0.5,
    width: 0,
    color: '',
};

export function resetFountainV2CacheForTesting() {
    liveFountainBake.bakedRawIdx = 0;
    liveFountainBake.bakedTotalLen = 0;
    liveFountainBake.firstX = null;
    liveFountainBake.secondX = null;
}

function ensureFountainBakeCanvas(targetCanvas, dpr) {
    if (!targetCanvas || typeof document === 'undefined') return null;
    if (!liveFountainBake.canvas) {
        liveFountainBake.canvas = document.createElement('canvas');
        liveFountainBake.ctx = liveFountainBake.canvas.getContext('2d');
    }
    if (!liveFountainBake.canvas || !liveFountainBake.ctx) return null;

    if (
        liveFountainBake.canvas.width !== targetCanvas.width ||
        liveFountainBake.canvas.height !== targetCanvas.height
    ) {
        liveFountainBake.canvas.width = targetCanvas.width;
        liveFountainBake.canvas.height = targetCanvas.height;
        liveFountainBake.bakedRawIdx = 0;
        liveFountainBake.firstX = null;
    }
    liveFountainBake.dpr = dpr;
    return liveFountainBake.ctx;
}

/**
 * Emite una cápsula tangencial convexa con winding horario (+1) desde `(x1, y1, r1)` hasta `(x2, y2, r2)`.
 * El trapecio usa la normal propia del segmento `(nx, ny)` en ambos extremos (conectando exactamente los
 * diámetros de los círculos `(x1, y1, r1)` y `(x2, y2, r2)`), y estampa el círculo horario en `(x2, y2, r2)`.
 * Garantiza cero huecos triangulares y cero costillas en cualquier ángulo de giro (0° a 180°).
 */
function emitSeamlessCapsuleStep(ctx, x1, y1, r1, x2, y2, r2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const d = Math.hypot(dx, dy);

    if (d >= 0.05) {
        const nx = -dy / d;
        const ny = dx / d;

        const a1x = x1 + nx * r1;
        const a1y = y1 + ny * r1;
        const b1x = x1 - nx * r1;
        const b1y = y1 - ny * r1;

        const a2x = x2 + nx * r2;
        const a2y = y2 + ny * r2;
        const b2x = x2 - nx * r2;
        const b2y = y2 - ny * r2;

        // B1 -> B2 -> A2 -> A1 tiene siempre área firmada positiva (winding +1 horario en Canvas Y-abajo)
        ctx.moveTo(b1x, b1y);
        ctx.lineTo(b2x, b2y);
        ctx.lineTo(a2x, a2y);
        ctx.lineTo(a1x, a1y);
        ctx.closePath();
    }

    // Disco horario (+1) en el extremo final del sub-paso que sella la articulación con el siguiente tramo
    ctx.moveTo(x2 + r2, y2);
    ctx.arc(x2, y2, r2, 0, Math.PI * 2, false);
}

/**
 * Renderiza el rango de puntos `[rawStart .. rawEnd]` a lo largo de la spline cuadrática de puntos medios
 * y actualiza el estado continuo de la punta (`stateObj`).
 * Complejidad: O(rawEnd - rawStart).
 */
function renderFountainDeltaRange(ctx, points, rawStart, rawEnd, baseWidth, stateObj, flushBatchSize = 32) {
    let prevMidX = stateObj.lastMidX;
    let prevMidY = stateObj.lastMidY;
    let prevR = stateObj.lastR;
    let emaP = stateObj.lastEmaP;

    let stepCountInBatch = 0;
    ctx.beginPath();

    // Si comenzamos en el punto 0, inicializar punta y estampar tapa circular inicial
    if (rawStart === 0) {
        const p0 = points[0];
        const p1 = points[Math.min(points.length - 1, 1)];
        // Evitar "bulbo" inicial cuando el punto 0 tiene presión estática alta y el punto 1 arranca rápido
        const p0Raw = p0.pressure ?? 0.5;
        const p1Raw = p1.pressure ?? p0Raw;
        emaP = p0Raw * 0.4 + Math.min(p0Raw, p1Raw) * 0.6;
        const r0 = Math.max(0.75, (baseWidth * calculateFountainV2PressureScale(emaP)) * 0.5);

        prevMidX = p0.x;
        prevMidY = p0.y;
        prevR = r0;

        ctx.moveTo(p0.x + r0, p0.y);
        ctx.arc(p0.x, p0.y, r0, 0, Math.PI * 2, false);
        stepCountInBatch++;
    }

    const startIdx = Math.max(1, rawStart);
    for (let i = startIdx; i <= rawEnd; i++) {
        const pPrev = points[i - 1];
        const pCurr = points[i];

        const rawP = pCurr.pressure ?? 0.5;
        emaP = emaP * 0.82 + rawP * 0.18;
        const desiredR = Math.max(0.75, (baseWidth * calculateFountainV2PressureScale(emaP)) * 0.5);

        // Punto medio de la spline cuadrática M_i = (P_{i-1} + P_i) / 2
        const midX = (pPrev.x + pCurr.x) * 0.5;
        const midY = (pPrev.y + pCurr.y) * 0.5;

        // Guardar el punto de inicio fijo (x0, y0, r0) de la curva cuadrática ANTES de subdividir
        const x0 = prevMidX;
        const y0 = prevMidY;
        const r0 = prevR;

        const chordDist = Math.hypot(midX - x0, midY - y0);
        if (chordDist < 0.08) continue;

        // Limitar el cambio máximo de radio por unidad de longitud de arco para transiciones orgánicas sin escalones
        const maxDeltaR = Math.max(0.25, chordDist * 0.14);
        const targetR = r0 + Math.max(-maxDeltaR, Math.min(maxDeltaR, desiredR - r0));

        // Subdivisión cuadrática adaptativa según longitud y curvatura del tramo
        const ctrlDist = Math.hypot(pPrev.x - x0, pPrev.y - y0) + Math.hypot(midX - pPrev.x, midY - pPrev.y);
        const steps = Math.max(1, Math.min(8, Math.ceil(ctrlDist / 3.0)));

        let subPrevX = x0;
        let subPrevY = y0;
        let subPrevR = r0;

        for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const inv = 1 - t;

            // Evaluación exacta de Bézier cuadrática B(t) = (1-t)^2 * P_start + 2(1-t)t * P_ctrl + t^2 * P_end
            const qx = inv * inv * x0 + 2 * inv * t * pPrev.x + t * t * midX;
            const qy = inv * inv * y0 + 2 * inv * t * pPrev.y + t * t * midY;
            const qr = r0 + (targetR - r0) * t;

            emitSeamlessCapsuleStep(ctx, subPrevX, subPrevY, subPrevR, qx, qy, qr);

            subPrevX = qx;
            subPrevY = qy;
            subPrevR = qr;
            stepCountInBatch++;

            // Flush periódico para mantener el Active Edge Table del teselador acotado en O(1)
            if (stepCountInBatch >= flushBatchSize) {
                ctx.fill('nonzero');
                ctx.beginPath();
                stepCountInBatch = 0;
            }
        }

        prevMidX = subPrevX;
        prevMidY = subPrevY;
        prevR = subPrevR;
    }

    if (stepCountInBatch > 0) {
        ctx.fill('nonzero');
    }

    stateObj.lastMidX = prevMidX;
    stateObj.lastMidY = prevMidY;
    stateObj.lastR = prevR;
    stateObj.lastEmaP = emaP;
}

/**
 * Dibuja el remate final desde `lastMid` hasta el último punto `points[n-1]`.
 */
function renderFountainLiveTip(ctx, lastPt, baseWidth, stateObj) {
    const rawP = lastPt.pressure ?? 0.5;
    const emaP = stateObj.lastEmaP * 0.82 + rawP * 0.18;
    const desiredR = Math.max(0.75, (baseWidth * calculateFountainV2PressureScale(emaP)) * 0.5);

    const dx = lastPt.x - stateObj.lastMidX;
    const dy = lastPt.y - stateObj.lastMidY;
    const d = Math.hypot(dx, dy);
    const maxDeltaR = Math.max(0.25, d * 0.14);
    const rEnd = stateObj.lastR + Math.max(-maxDeltaR, Math.min(maxDeltaR, desiredR - stateObj.lastR));

    ctx.beginPath();
    emitSeamlessCapsuleStep(ctx, stateObj.lastMidX, stateObj.lastMidY, stateObj.lastR, lastPt.x, lastPt.y, rEnd);
    ctx.fill('nonzero');
}

/**
 * Renderiza un trazo de Estilográfica v2 en Canvas2D con complejidad O(1) por frame.
 */
export function renderCanvas(ctx, points, style = {}) {
    if (!points || points.length === 0) return;

    const baseWidth = Math.max(1, style.width || 3);
    const color = style.color || '#1e1e1e';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;

    // Caso 1: Punto único
    if (points.length === 1) {
        const pt = points[0];
        const r = Math.max(1, (baseWidth * calculateFountainV2PressureScale(pt.pressure)) * 0.5);
        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2, false);
        ctx.fill();
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
        const bakeCtx = ensureFountainBakeCanvas(targetCanvas, dpr);
        if (bakeCtx) {
            const p0 = points[0];
            const p1 = points[1];
            const isSameStroke =
                liveFountainBake.firstX === p0.x &&
                liveFountainBake.firstY === p0.y &&
                liveFountainBake.secondX === p1.x &&
                liveFountainBake.secondY === p1.y &&
                liveFountainBake.width === baseWidth &&
                liveFountainBake.color === color &&
                n >= liveFountainBake.bakedRawIdx;

            if (!isSameStroke) {
                liveFountainBake.firstX = p0.x;
                liveFountainBake.firstY = p0.y;
                liveFountainBake.secondX = p1.x;
                liveFountainBake.secondY = p1.y;
                liveFountainBake.bakedRawIdx = 0;
                liveFountainBake.bakedTotalLen = 0;
                liveFountainBake.width = baseWidth;
                liveFountainBake.color = color;

                bakeCtx.save();
                bakeCtx.setTransform(1, 0, 0, 1, 0, 0);
                bakeCtx.clearRect(0, 0, liveFountainBake.canvas.width, liveFountainBake.canvas.height);
                bakeCtx.restore();
            }

            // Cada segmento hasta M_{n-2} depende únicamente de P_{i-1} y P_i (100% determinista e inmutable).
            // Horneamos todos los puntos nuevos hasta n - 2 sobre el buffer offscreen con opacidad 1.0.
            const freezeIdx = n - 2;
            if (freezeIdx >= liveFountainBake.bakedRawIdx) {
                bakeCtx.save();
                bakeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                bakeCtx.fillStyle = color;
                bakeCtx.globalAlpha = 1.0;

                renderFountainDeltaRange(
                    bakeCtx,
                    points,
                    liveFountainBake.bakedRawIdx,
                    freezeIdx,
                    baseWidth,
                    liveFountainBake,
                    32
                );

                bakeCtx.restore();
                liveFountainBake.bakedRawIdx = freezeIdx + 1;
                liveFountainBake.bakedTotalLen = n;
            }

            // Volcar buffer horneado + punta viva aplicando la opacidad global del estilo
            ctx.save();
            ctx.globalAlpha = opacity;

            if (liveFountainBake.bakedRawIdx > 0) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.drawImage(liveFountainBake.canvas, 0, 0);
                ctx.restore();
            }

            // Dibujar únicamente el último segmento vivo (de M_{n-2} a P_{n-1}) -> O(1)
            ctx.fillStyle = color;
            const tipState = {
                lastMidX: liveFountainBake.lastMidX,
                lastMidY: liveFountainBake.lastMidY,
                lastR: liveFountainBake.lastR,
                lastEmaP: liveFountainBake.lastEmaP,
            };
            renderFountainDeltaRange(
                ctx,
                points,
                liveFountainBake.bakedRawIdx,
                n - 1,
                baseWidth,
                tipState,
                32
            );
            renderFountainLiveTip(ctx, points[n - 1], baseWidth, tipState);

            ctx.restore();
            return;
        }
    }

    // Caso B: Commit de sprite en `pointerup` dentro de OptimizedEngine -> Copia O(1) desde liveFountainBake
    if (isSpriteCommit && liveFountainBake.canvas && liveFountainBake.bakedRawIdx > 0 && n > 6) {
        const p0 = points[0];
        const p1 = points[1];
        if (
            liveFountainBake.firstX === p0.x &&
            liveFountainBake.firstY === p0.y &&
            liveFountainBake.secondX === p1.x &&
            liveFountainBake.secondY === p1.y &&
            liveFountainBake.width === baseWidth &&
            liveFountainBake.color === color &&
            n >= liveFountainBake.bakedRawIdx
        ) {
            const bakeCtx = liveFountainBake.ctx;
            const bakeDpr = liveFountainBake.dpr || 1;
            bakeCtx.save();
            bakeCtx.setTransform(bakeDpr, 0, 0, bakeDpr, 0, 0);
            bakeCtx.fillStyle = color;
            bakeCtx.globalAlpha = 1.0;

            if (liveFountainBake.bakedRawIdx <= n - 1) {
                renderFountainDeltaRange(
                    bakeCtx,
                    points,
                    liveFountainBake.bakedRawIdx,
                    n - 1,
                    baseWidth,
                    liveFountainBake,
                    32
                );
            }
            renderFountainLiveTip(bakeCtx, points[n - 1], baseWidth, liveFountainBake);
            bakeCtx.restore();

            liveFountainBake.bakedRawIdx = n;
            liveFountainBake.bakedTotalLen = n;

            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.drawImage(
                liveFountainBake.canvas,
                0,
                0,
                liveFountainBake.canvas.width,
                liveFountainBake.canvas.height,
                0,
                0,
                liveFountainBake.canvas.width / bakeDpr,
                liveFountainBake.canvas.height / bakeDpr
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
        lastMidX: 0,
        lastMidY: 0,
        lastR: 0,
        lastEmaP: 0.5,
    };
    renderFountainDeltaRange(ctx, points, 0, n - 1, baseWidth, coldState, 32);
    renderFountainLiveTip(ctx, points[n - 1], baseWidth, coldState);

    ctx.restore();
}

export const renderPen = renderCanvas;

/**
 * Exportación SVG de Estilográfica v2 mediante cápsulas tangenciales continuas con winding +1
 * sobre la spline cuadrática suavizada (cero grietas en curvas y giros).
 */
export function renderSvg(points, style = {}) {
    if (!points || points.length === 0) return { defs: {}, body: '' };

    const baseWidth = Math.max(1, style.width || 3);
    const color = style.color || '#1e1e1e';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;
    const f = (n) => (Math.round(n * 10) / 10).toString();

    if (points.length === 1) {
        const pt = points[0];
        const r = Math.max(1, (baseWidth * calculateFountainV2PressureScale(pt.pressure)) * 0.5);
        return {
            defs: {},
            body: `<circle cx="${f(pt.x)}" cy="${f(pt.y)}" r="${f(r)}" fill="${color}" fill-opacity="${opacity.toFixed(2)}"/>`,
        };
    }

    const n = points.length;
    const p0 = points[0];
    const p1 = points[1];
    const p0Raw = p0.pressure ?? 0.5;
    const p1Raw = p1.pressure ?? p0Raw;
    let emaP = p0Raw * 0.4 + Math.min(p0Raw, p1Raw) * 0.6;
    let prevX = p0.x;
    let prevY = p0.y;
    let prevR = Math.max(0.75, (baseWidth * calculateFountainV2PressureScale(emaP)) * 0.5);

    // Tapa redonda inicial en sentido horario (+1)
    let d = `M${f(prevX - prevR)} ${f(prevY)}a${f(prevR)} ${f(prevR)} 0 1 1 ${f(prevR * 2)} 0a${f(prevR)} ${f(prevR)} 0 1 1 -${f(prevR * 2)} 0Z`;

    const appendCapsuleSvg = (x1, y1, r1, x2, y2, r2) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.hypot(dx, dy);
        if (dist >= 0.08) {
            const nx = -dy / dist;
            const ny = dx / dist;
            const a1x = x1 + nx * r1;
            const a1y = y1 + ny * r1;
            const b1x = x1 - nx * r1;
            const b1y = y1 - ny * r1;
            const a2x = x2 + nx * r2;
            const a2y = y2 + ny * r2;
            const b2x = x2 - nx * r2;
            const b2y = y2 - ny * r2;
            d += `M${f(b1x)} ${f(b1y)}L${f(b2x)} ${f(b2y)}L${f(a2x)} ${f(a2y)}L${f(a1x)} ${f(a1y)}Z`;
        }
        d += `M${f(x2 - r2)} ${f(y2)}a${f(r2)} ${f(r2)} 0 1 1 ${f(r2 * 2)} 0a${f(r2)} ${f(r2)} 0 1 1 -${f(r2 * 2)} 0Z`;
    };

    for (let i = 1; i < n; i++) {
        const pPrev = points[i - 1];
        const pCurr = points[i];
        emaP = emaP * 0.82 + (pCurr.pressure ?? 0.5) * 0.18;
        const desiredR = Math.max(0.75, (baseWidth * calculateFountainV2PressureScale(emaP)) * 0.5);

        const midX = (pPrev.x + pCurr.x) * 0.5;
        const midY = (pPrev.y + pCurr.y) * 0.5;

        const x0 = prevX;
        const y0 = prevY;
        const r0 = prevR;
        const chordDist = Math.hypot(midX - x0, midY - y0);
        if (chordDist < 0.08) continue;

        const maxDeltaR = Math.max(0.25, chordDist * 0.14);
        const targetR = r0 + Math.max(-maxDeltaR, Math.min(maxDeltaR, desiredR - r0));
        const ctrlDist = Math.hypot(pPrev.x - x0, pPrev.y - y0) + Math.hypot(midX - pPrev.x, midY - pPrev.y);
        const steps = Math.max(1, Math.min(4, Math.ceil(ctrlDist / 4.5)));

        let subPrevX = x0;
        let subPrevY = y0;
        let subPrevR = r0;
        for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const inv = 1 - t;
            const qx = inv * inv * x0 + 2 * inv * t * pPrev.x + t * t * midX;
            const qy = inv * inv * y0 + 2 * inv * t * pPrev.y + t * t * midY;
            const qr = r0 + (targetR - r0) * t;
            appendCapsuleSvg(subPrevX, subPrevY, subPrevR, qx, qy, qr);
            subPrevX = qx;
            subPrevY = qy;
            subPrevR = qr;
        }
        prevX = subPrevX;
        prevY = subPrevY;
        prevR = subPrevR;
    }

    const lastPt = points[n - 1];
    const endDist = Math.hypot(lastPt.x - prevX, lastPt.y - prevY);
    if (endDist >= 0.08) {
        const desiredEndR = Math.max(0.75, (baseWidth * calculateFountainV2PressureScale(emaP)) * 0.5);
        const maxDeltaR = Math.max(0.25, endDist * 0.14);
        const rEnd = prevR + Math.max(-maxDeltaR, Math.min(maxDeltaR, desiredEndR - prevR));
        appendCapsuleSvg(prevX, prevY, prevR, lastPt.x, lastPt.y, rEnd);
    }

    return {
        defs: {},
        body: `<path d="${d}" fill="${color}" fill-rule="nonzero" fill-opacity="${opacity.toFixed(2)}"/>`,
    };
}

if (typeof globalThis !== 'undefined') {
    globalThis.ApoloSandbox = globalThis.ApoloSandbox || { pens: {}, engines: {} };
    globalThis.ApoloSandbox.pens['fountain-v2'] = {
        id,
        name,
        description,
        incrementalBake,
        renderPen,
        renderCanvas,
        renderSvg,
    };
}
