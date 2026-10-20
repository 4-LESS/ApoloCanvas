/**
 * sandbox/pens/calli-v2.js
 *
 * Caligráfica v2 · O(1) (Bisel 2D Exacto + Delta Bake)
 *
 * Arquitectura:
 * 1. Bisel físico 2D de 4 esquinas fijas `(c0, c1, c2, c3)`:
 *    Semiancho mayor `L = 0.85 * w` en dirección `u = (cos θ, sin θ)` y semigrosor transversal
 *    físico `T = 0.14 * w` en dirección `n = (-sin θ, cos θ)`. Las esquinas dependen sólo de
 *    `(x, y)` y jamás de `(dx, dy)`.
 * 2. Envolvente convexa horaria exacta (+1 winding):
 *    En cada paso `P1 -> P2`, emite el hexágono convexo horario de `R(P1) U R(P2)`. Estable
 *    tanto en movimiento perpendicular (ancho 2L) como paralelo al ángulo del bisel (ancho 2T).
 * 3. Pipeline O(1) estandarizado (`createIncrementalPen` + `createCachedSvgRenderer`):
 *    Sin desplazamiento al soltar el puntero (`pointerup`) y con sincronización completa en SVG.
 */

import { fmt, createIncrementalPen, createCachedSvgRenderer } from './pencil-common.js';

export const id = 'calli-v2';
export const name = 'Caligráfica v2 · O(1) (Bisel 2D)';
export const description = 'Plumilla biselada 2D exacta (estable en paralelo y perpendicular) con Delta Bake O(1) y SVG fiel';
export const incrementalBake = true;

/**
 * Calcula los 4 vectores esquina `(c0, c1, c2, c3)` en sentido horario (+1 en Canvas Y-abajo)
 * del bisel físico 2D para el ancho y ángulo dados.
 */
export function computeNibOffsets(baseWidth, nibAngleRad) {
    const L = Math.max(1.5, baseWidth * 0.85);
    const T = Math.max(0.85, baseWidth * 0.14);

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
        cx: [-uLx - nTx, uLx - nTx, uLx + nTx, -uLx + nTx],
        cy: [-uLy - nTy, uLy - nTy, uLy + nTy, -uLy + nTy],
    };
}

/**
 * Emite en `ctx` el hexágono convexo exacto en sentido horario (+1) que barre `R(x1, y1) -> R(x2, y2)`.
 */
function emitChiselHullStep(ctx, x1, y1, x2, y2, nib) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const { ux, uy, nx, ny, cx, cy } = nib;

    const du = dx * ux + dy * uy;
    const dn = dx * nx + dy * ny;
    const k = du >= 0 ? (dn >= 0 ? 2 : 1) : (dn >= 0 ? 3 : 0);

    const k1 = (k + 1) & 3;
    const k2 = (k + 2) & 3;
    const k3 = (k + 3) & 3;

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
 * Renderiza el rango de puntos `[rawStart .. rawEnd]` a lo largo de la spline cuadrática de puntos medios.
 */
function renderCalliV2Delta(ctx, points, rawStart, rawEnd, _style, { nib }, state) {
    let prevMidX = state.lastMidX;
    let prevMidY = state.lastMidY;

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

            if (stepCountInBatch >= 48) {
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

    state.lastMidX = prevMidX;
    state.lastMidY = prevMidY;
}

const { renderCanvas, resetCache } = createIncrementalPen({
    minLivePoints: 6,
    freezeLag: 1,
    minDeltaPoints: 1,
    defaultWidth: 4,
    defaultColor: '#1e1e1e',
    defaultOpacity: 1.0,
    prepareCall(_ctx, _points, _style, base) {
        return { ...base, nib: computeNibOffsets(base.baseWidth, base.angle) };
    },
    renderSinglePoint(ctx, pt, _style, { color, opacity, nib }) {
        ctx.fillStyle = color;
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        emitChiselStamp(ctx, pt.x, pt.y, nib);
        ctx.fill('nonzero');
    },
    initState(points) {
        return { lastMidX: points[0].x, lastMidY: points[0].y };
    },
    renderDelta: renderCalliV2Delta,
    renderLiveTip(ctx, lastPt, _style, { nib }, state) {
        ctx.beginPath();
        const d = Math.hypot(lastPt.x - state.lastMidX, lastPt.y - state.lastMidY);
        if (d >= 0.05) {
            emitChiselHullStep(ctx, state.lastMidX, state.lastMidY, lastPt.x, lastPt.y, nib);
        } else {
            emitChiselStamp(ctx, lastPt.x, lastPt.y, nib);
        }
        ctx.fill('nonzero');
    },
});

export { renderCanvas };
export const renderPen = renderCanvas;
export const resetCalliV2CacheForTesting = resetCache;

/**
 * Exportación SVG de Caligráfica v2 mediante la envolvente convexa exacta de bisel 2D
 * y caché validado por longitud (`createCachedSvgRenderer`).
 */
export const renderSvg = createCachedSvgRenderer((points, style = {}) => {
    const baseWidth = Math.max(1, style.width || 4);
    const color = style.color || '#1e1e1e';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;
    const angle = style.tiltAngle !== undefined ? style.tiltAngle : (-40 * Math.PI) / 180;

    const nib = computeNibOffsets(baseWidth, angle);
    const { ux, uy, nx, ny, cx, cy } = nib;

    let d = '';
    const appendStampSvg = (x, y) => {
        d += `M${fmt(x + cx[0])} ${fmt(y + cy[0])}` +
             `L${fmt(x + cx[1])} ${fmt(y + cy[1])}` +
             `L${fmt(x + cx[2])} ${fmt(y + cy[2])}` +
             `L${fmt(x + cx[3])} ${fmt(y + cy[3])}Z`;
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

        d += `M${fmt(x1 + cx[k1])} ${fmt(y1 + cy[k1])}` +
             `L${fmt(x1 + cx[k2])} ${fmt(y1 + cy[k2])}` +
             `L${fmt(x1 + cx[k3])} ${fmt(y1 + cy[k3])}` +
             `L${fmt(x2 + cx[k3])} ${fmt(y2 + cy[k3])}` +
             `L${fmt(x2 + cx[k])} ${fmt(y2 + cy[k])}` +
             `L${fmt(x2 + cx[k1])} ${fmt(y2 + cy[k1])}Z`;
    };

    const n = points.length;
    appendStampSvg(points[0].x, points[0].y);

    if (n > 1) {
        let prevX = points[0].x;
        let prevY = points[0].y;
        const minChord = n > 5000 ? 2.2 : 0.05;

        for (let i = 1; i < n; i++) {
            const pPrev = points[i - 1];
            const pCurr = points[i];
            const midX = (pPrev.x + pCurr.x) * 0.5;
            const midY = (pPrev.y + pCurr.y) * 0.5;

            const x0 = prevX;
            const y0 = prevY;
            const chordDist = Math.hypot(midX - x0, midY - y0);
            if (chordDist < minChord && i < n - 1) continue;

            const ctrlDist = Math.hypot(pPrev.x - x0, pPrev.y - y0) + Math.hypot(midX - pPrev.x, midY - pPrev.y);
            const steps = n > 5000 ? 1 : Math.max(1, Math.min(4, Math.ceil(ctrlDist / 4.0)));

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

    return {
        defs: {},
        body: `<path d="${d}" fill="${color}" fill-rule="nonzero" fill-opacity="${opacity.toFixed(2)}"/>`,
    };
});

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
