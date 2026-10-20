/**
 * src/engine/pens/fountain.ts
 *
 * Estilográfica (Cinta Variable + Delta Bake O(1))
 * Portado 1:1 desde `sandbox/pens/fountain-v2.js`.
 *
 * Arquitectura:
 * 1. Cápsulas tangenciales convexas con winding horario (+1):
 *    Cada sub-paso de la spline cuadrática de puntos medios emite un trapecio en sentido
 *    horario (`B1 -> B2 -> A2 -> A1`) usando la normal propia del segmento en ambos extremos,
 *    más un disco horario en `(x2, y2, r2 * 1.02)`. Cero huecos en giros de 0° a 180° y cero costuras.
 * 2. Pipeline incremental O(1) estandarizado (`createIncrementalPen`).
 * 3. Exportación SVG con caché validado por longitud (`createCachedSvgRenderer`).
 */

import type { Point } from '../../core/types.ts';
import {
    createCachedSvgRenderer,
    createIncrementalPen,
    fmt,
    type IncrementalPenBaseData,
    pressureScale,
} from './common.ts';
import type { PenStyleOptions, PenToolPlugin } from './types.ts';

export const id = 'fountain' as const;
export const name = 'Estilográfica';
export const description = 'Estilográfica de ancho variable con horneado incremental O(1), cápsulas continuas sin gaps y SVG compacto';
export const incrementalBake = true;

interface FountainState {
    lastMidX: number;
    lastMidY: number;
    lastR: number;
    lastEmaP: number;
    _initialized?: boolean;
}

export function calculateFountainV2PressureScale(rawPressure?: number): number {
    return pressureScale(rawPressure, 0.35, 1.60, 0.75);
}

/**
 * Emite una cápsula tangencial convexa con winding horario (+1) desde `(x1, y1, r1)` hasta `(x2, y2, r2)`.
 * El disco de unión usa un factor `1.02` para sellar cualquier micro-costura subpíxel.
 */
function emitSeamlessCapsuleStep(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    r1: number,
    x2: number,
    y2: number,
    r2: number,
): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const d = Math.hypot(dx, dy);

    if (d >= 0.05) {
        const nx = -dy / d;
        const ny = dx / d;

        ctx.moveTo(x1 - nx * r1, y1 - ny * r1);
        ctx.lineTo(x2 - nx * r2, y2 - ny * r2);
        ctx.lineTo(x2 + nx * r2, y2 + ny * r2);
        ctx.lineTo(x1 + nx * r1, y1 + ny * r1);
        ctx.closePath();
    }

    const rJoint = r2 * 1.02;
    ctx.moveTo(x2 + rJoint, y2);
    ctx.arc(x2, y2, rJoint, 0, Math.PI * 2, false);
}

/**
 * Renderiza el rango de puntos `[rawStart .. rawEnd]` a lo largo de la spline cuadrática de puntos medios.
 */
function renderFountainDelta(
    ctx: CanvasRenderingContext2D,
    points: readonly Point[],
    rawStart: number,
    rawEnd: number,
    _style: PenStyleOptions,
    { baseWidth }: IncrementalPenBaseData,
    state: FountainState,
): void {
    let prevMidX = state.lastMidX;
    let prevMidY = state.lastMidY;
    let prevR = state.lastR;
    let emaP = state.lastEmaP;

    let stepCountInBatch = 0;
    ctx.beginPath();

    if (rawStart === 0) {
        const p0 = points[0];
        const p1 = points[Math.min(points.length - 1, 1)];
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

        emaP = emaP * 0.82 + (pCurr.pressure ?? 0.5) * 0.18;
        const desiredR = Math.max(0.75, (baseWidth * calculateFountainV2PressureScale(emaP)) * 0.5);

        const midX = (pPrev.x + pCurr.x) * 0.5;
        const midY = (pPrev.y + pCurr.y) * 0.5;

        const x0 = prevMidX;
        const y0 = prevMidY;
        const r0 = prevR;

        const chordDist = Math.hypot(midX - x0, midY - y0);
        if (chordDist < 0.08) continue;

        const maxDeltaR = Math.max(0.25, chordDist * 0.14);
        const targetR = r0 + Math.max(-maxDeltaR, Math.min(maxDeltaR, desiredR - r0));

        const ctrlDist = Math.hypot(pPrev.x - x0, pPrev.y - y0) + Math.hypot(midX - pPrev.x, midY - pPrev.y);
        const steps = Math.max(1, Math.min(8, Math.ceil(ctrlDist / 3.0)));

        let subPrevX = x0;
        let subPrevY = y0;
        let subPrevR = r0;

        for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const inv = 1 - t;
            const qx = inv * inv * x0 + 2 * inv * t * pPrev.x + t * t * midX;
            const qy = inv * inv * y0 + 2 * inv * t * pPrev.y + t * t * midY;
            const qr = r0 + (targetR - r0) * t;

            emitSeamlessCapsuleStep(ctx, subPrevX, subPrevY, subPrevR, qx, qy, qr);

            subPrevX = qx;
            subPrevY = qy;
            subPrevR = qr;
            stepCountInBatch++;

            if (stepCountInBatch >= 32) {
                ctx.fill('nonzero');
                ctx.beginPath();
                stepCountInBatch = 0;
            }
        }

        prevMidX = subPrevX;
        prevMidY = subPrevY;
        prevR = subPrevR;
    }

    if (rawEnd === points.length - 1) {
        const lastPt = points[rawEnd];
        const tipEmaP = emaP * 0.82 + (lastPt.pressure ?? 0.5) * 0.18;
        const desiredR = Math.max(0.75, (baseWidth * calculateFountainV2PressureScale(tipEmaP)) * 0.5);
        const d = Math.hypot(lastPt.x - prevMidX, lastPt.y - prevMidY);
        const maxDeltaR = Math.max(0.25, d * 0.14);
        const rEnd = prevR + Math.max(-maxDeltaR, Math.min(maxDeltaR, desiredR - prevR));
        emitSeamlessCapsuleStep(ctx, prevMidX, prevMidY, prevR, lastPt.x, lastPt.y, rEnd);
        stepCountInBatch++;
    }

    if (stepCountInBatch > 0) {
        ctx.fill('nonzero');
    }

    state.lastMidX = prevMidX;
    state.lastMidY = prevMidY;
    state.lastR = prevR;
    state.lastEmaP = emaP;
}

const { renderCanvas, renderSegment, resetCache } = createIncrementalPen<IncrementalPenBaseData, FountainState>({
    minLivePoints: 6,
    freezeLag: 1,
    minDeltaPoints: 1,
    defaultWidth: 3,
    defaultColor: '#1e1e1e',
    defaultOpacity: 1.0,
    renderSinglePoint(ctx, pt, _style, { baseWidth, color, opacity }) {
        const r = Math.max(1, (baseWidth * calculateFountainV2PressureScale(pt.pressure)) * 0.5);
        ctx.fillStyle = color;
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2, false);
        ctx.fill();
    },
    initState(points, _style, { baseWidth }) {
        const p0 = points[0];
        const r0 = Math.max(0.75, (baseWidth * calculateFountainV2PressureScale(p0.pressure)) * 0.5);
        return {
            lastMidX: p0.x,
            lastMidY: p0.y,
            lastR: r0,
            lastEmaP: p0.pressure ?? 0.5,
        };
    },
    renderDelta: renderFountainDelta,
});

export { renderCanvas, renderSegment };
export const renderPen = renderCanvas;
export const resetFountainCacheForTesting = resetCache;

/**
 * Exportación SVG de Estilográfica mediante cápsulas tangenciales continuas con winding +1
 * y caché validado por longitud.
 */
export const renderSvg = createCachedSvgRenderer((points, style = {}) => {
    const baseWidth = Math.max(1, style.width || 3);
    const color = style.color || '#1e1e1e';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;

    if (points.length === 1) {
        const pt = points[0];
        const r = Math.max(1, (baseWidth * calculateFountainV2PressureScale(pt.pressure)) * 0.5);
        return {
            defs: {},
            body: `<circle cx="${fmt(pt.x)}" cy="${fmt(pt.y)}" r="${fmt(r)}" fill="${color}" fill-opacity="${opacity.toFixed(2)}"/>`,
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

    let d = `M${fmt(prevX - prevR)} ${fmt(prevY)}a${fmt(prevR)} ${fmt(prevR)} 0 1 1 ${fmt(prevR * 2)} 0a${fmt(prevR)} ${fmt(prevR)} 0 1 1 -${fmt(prevR * 2)} 0Z`;

    const appendCapsuleSvg = (x1: number, y1: number, r1: number, x2: number, y2: number, r2: number) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.hypot(dx, dy);
        if (dist >= 0.08) {
            const nx = -dy / dist;
            const ny = dx / dist;
            d += `M${fmt(x1 - nx * r1)} ${fmt(y1 - ny * r1)}` +
                 `L${fmt(x2 - nx * r2)} ${fmt(y2 - ny * r2)}` +
                 `L${fmt(x2 + nx * r2)} ${fmt(y2 + ny * r2)}` +
                 `L${fmt(x1 + nx * r1)} ${fmt(y1 + ny * r1)}Z`;
        }
        const rJoint = r2 * 1.02;
        d += `M${fmt(x2 - rJoint)} ${fmt(y2)}a${fmt(rJoint)} ${fmt(rJoint)} 0 1 1 ${fmt(rJoint * 2)} 0a${fmt(rJoint)} ${fmt(rJoint)} 0 1 1 -${fmt(rJoint * 2)} 0Z`;
    };

    const minChord = n > 5000 ? 2.2 : 0.08;
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
        if (chordDist < minChord && i < n - 1) continue;

        const maxDeltaR = Math.max(0.25, chordDist * 0.14);
        const targetR = r0 + Math.max(-maxDeltaR, Math.min(maxDeltaR, desiredR - r0));
        const ctrlDist = Math.hypot(pPrev.x - x0, pPrev.y - y0) + Math.hypot(midX - pPrev.x, midY - pPrev.y);
        const steps = n > 5000 ? 1 : Math.max(1, Math.min(4, Math.ceil(ctrlDist / 4.5)));

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
});

export const fountainPenPlugin: PenToolPlugin = {
    id,
    name,
    renderCanvas,
    renderSegment,
    renderSvg,
    resetCache,
};
