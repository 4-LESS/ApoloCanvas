/**
 * src/engine/pens/calli.ts
 *
 * Caligráfica (Bisel 2D Exacto + Delta Bake O(1))
 * Portado 1:1 desde `sandbox/pens/calli-v2.js`.
 *
 * Arquitectura:
 * 1. Bisel físico 2D de 4 esquinas fijas `(c0, c1, c2, c3)`:
 *    Semiancho mayor `L = 0.85 * w` en dirección `u = (cos θ, sin θ)` y semigrosor transversal
 *    físico `T = 0.14 * w` en dirección `n = (-sin θ, cos θ)`. Las esquinas dependen sólo de
 *    `(x, y)` y jamás de `(dx, dy)`.
 * 2. Envolvente convexa horaria exacta (+1 winding):
 *    En cada paso `P1 -> P2`, emite el hexágono convexo horario de `R(P1) U R(P2)`. Estable
 *    tanto en movimiento perpendicular (ancho 2L) como paralelo al ángulo del bisel (ancho 2T).
 * 3. Pipeline O(1) estandarizado (`createIncrementalPen` + `createCachedSvgRenderer`).
 */

import type { Point } from '../../core/types.ts';
import {
    createCachedSvgRenderer,
    createIncrementalPen,
    fmt,
    type IncrementalPenBaseData,
} from './common.ts';
import type { PenStyleOptions, PenToolPlugin } from './types.ts';

export const id = 'calli' as const;
export const name = 'Caligráfica';
export const description = 'Plumilla biselada 2D exacta (estable en paralelo y perpendicular) con Delta Bake O(1) y SVG fiel';
export const incrementalBake = true;

export interface NibOffsets {
    ux: number;
    uy: number;
    nx: number;
    ny: number;
    cx: [number, number, number, number];
    cy: [number, number, number, number];
}

interface CalliCtxData extends IncrementalPenBaseData {
    nib: NibOffsets;
}

interface CalliState {
    lastMidX: number;
    lastMidY: number;
    _initialized?: boolean;
    _isIncrementalSegment?: boolean;
}

/**
 * Calcula los 4 vectores esquina `(c0, c1, c2, c3)` en sentido horario (+1 en Canvas Y-abajo)
 * del bisel físico 2D para el ancho y ángulo dados.
 */
export function computeNibOffsets(baseWidth: number, nibAngleRad: number): NibOffsets {
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
function emitChiselHullStep(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    nib: NibOffsets,
): void {
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
function emitChiselStamp(ctx: CanvasRenderingContext2D, x: number, y: number, nib: NibOffsets): void {
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
function renderCalliV2Delta(
    ctx: CanvasRenderingContext2D,
    points: readonly Point[],
    rawStart: number,
    rawEnd: number,
    _style: PenStyleOptions,
    { nib }: CalliCtxData,
    state: CalliState,
): void {
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

    if (rawEnd === points.length - 1 && !state._isIncrementalSegment) {
        const lastPt = points[rawEnd];
        const d = Math.hypot(lastPt.x - prevMidX, lastPt.y - prevMidY);
        if (d >= 0.05) {
            emitChiselHullStep(ctx, prevMidX, prevMidY, lastPt.x, lastPt.y, nib);
        } else {
            emitChiselStamp(ctx, lastPt.x, lastPt.y, nib);
        }
        stepCountInBatch++;
    }

    if (stepCountInBatch > 0) {
        ctx.fill('nonzero');
    }

    state.lastMidX = prevMidX;
    state.lastMidY = prevMidY;
}

const { renderCanvas, renderSegment, resetCache } = createIncrementalPen<CalliCtxData, CalliState>({
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
});

export { renderCanvas, renderSegment };
export const renderPen = renderCanvas;
export const resetCalliCacheForTesting = resetCache;

/**
 * Exportación SVG de Caligráfica mediante la envolvente convexa exacta de bisel 2D
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
    const appendStampSvg = (x: number, y: number) => {
        d += `M${fmt(x + cx[0])} ${fmt(y + cy[0])}` +
             `L${fmt(x + cx[1])} ${fmt(y + cy[1])}` +
             `L${fmt(x + cx[2])} ${fmt(y + cy[2])}` +
             `L${fmt(x + cx[3])} ${fmt(y + cy[3])}Z`;
    };

    const appendHullSvg = (x1: number, y1: number, x2: number, y2: number) => {
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

export const calliPenPlugin: PenToolPlugin = {
    id,
    name,
    renderCanvas,
    renderSegment,
    renderSvg,
    resetCache,
};
