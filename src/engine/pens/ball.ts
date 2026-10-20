/**
 * src/engine/pens/ball.ts
 *
 * Bolígrafo (Ballpoint Pen) — O(1) Incremental Delta Bake
 * Trazo monolínea uniforme con terminaciones redondeadas, flujo de tinta constante
 * y complejidad O(1) estandarizada mediante `createIncrementalPen`.
 * Portado 1:1 desde `sandbox/pens/ball.js`.
 */

import type { Point } from '../../core/types.ts';
import {
    createCachedSvgRenderer,
    createIncrementalPen,
    fmt,
    type IncrementalPenBaseData,
    svgPathD,
} from './common.ts';
import type { PenStyleOptions, PenToolPlugin } from './types.ts';

export const id = 'ball' as const;
export const name = 'Bolígrafo';
export const description = 'Monolínea constante y precisa con horneado incremental O(1) y flujo de tinta uniforme';
export const incrementalBake = true;

interface BallCtxData extends IncrementalPenBaseData {
    effWidth: number;
}

interface BallState {
    lastMidX: number;
    lastMidY: number;
    _initialized?: boolean;
    _isIncrementalSegment?: boolean;
}

/**
 * Traza los segmentos cuadráticos por puntos medios en el rango `[rawStart .. rawEnd]`
 * dividiendo en lotes de 128 curvas para mantener el teselador en O(1).
 */
function strokeBallpointDelta(
    ctx: CanvasRenderingContext2D,
    points: readonly Point[],
    rawStart: number,
    rawEnd: number,
    _style: PenStyleOptions,
    { effWidth }: BallCtxData,
    state: BallState,
): void {
    let prevMidX = state.lastMidX;
    let prevMidY = state.lastMidY;

    ctx.lineWidth = effWidth;
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

        if (countInBatch >= 128) {
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(prevMidX, prevMidY);
            countInBatch = 0;
        }
    }

    if (rawEnd === points.length - 1 && !state._isIncrementalSegment) {
        const lastPt = points[rawEnd];
        ctx.lineTo(lastPt.x, lastPt.y);
        countInBatch++;
    }

    if (countInBatch > 0) {
        ctx.stroke();
    }

    state.lastMidX = prevMidX;
    state.lastMidY = prevMidY;
}

const { renderCanvas, renderSegment, resetCache } = createIncrementalPen<BallCtxData, BallState>({
    minLivePoints: 6,
    freezeLag: 1,
    minDeltaPoints: 1,
    defaultWidth: 3,
    defaultColor: '#1e1e1e',
    defaultOpacity: 1.0,
    prepareCall(_ctx, _points, _style, base) {
        return { ...base, effWidth: Math.max(1, base.baseWidth * 0.9) };
    },
    renderSinglePoint(ctx, pt, style, { baseWidth, color, opacity }) {
        const pressure = pt.pressure !== undefined && pt.pressure > 0 ? pt.pressure : 0.5;
        const radius = Math.max(1, (baseWidth * 0.5) * (style.simulatePressure ? (0.75 + pressure * 0.5) : 1));
        ctx.fillStyle = color;
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fill();
    },
    renderTwoPoints(ctx, p0, p1, _style, { effWidth, color, opacity }) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = opacity;
        ctx.lineWidth = effWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
    },
    initState(points) {
        return { lastMidX: points[0].x, lastMidY: points[0].y };
    },
    renderDelta: strokeBallpointDelta,
});

export { renderCanvas, renderSegment };
export const renderPen = renderCanvas;
export const resetBallCacheForTesting = resetCache;

/**
 * Exportación SVG equivalente al trazo cuadrático continuo de Canvas (con caché validado por longitud).
 */
export const renderSvg = createCachedSvgRenderer((points, style = {}) => {
    const baseWidth = Math.max(1, style.width || 3);
    const effWidth = Math.max(1, baseWidth * 0.9);
    const color = style.color || '#1e1e1e';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;

    if (points.length === 1) {
        const pt = points[0];
        const pressure = pt.pressure !== undefined && pt.pressure > 0 ? pt.pressure : 0.5;
        const radius = Math.max(1, (baseWidth * 0.5) * (style.simulatePressure ? (0.75 + pressure * 0.5) : 1));
        return {
            defs: {},
            body: `<circle cx="${fmt(pt.x)}" cy="${fmt(pt.y)}" r="${fmt(radius)}" fill="${color}" fill-opacity="${opacity.toFixed(2)}"/>`,
        };
    }

    const d = points.length === 2
        ? `M${fmt(points[0].x)} ${fmt(points[0].y)}L${fmt(points[1].x)} ${fmt(points[1].y)}`
        : svgPathD(points);

    return {
        defs: {},
        body: `<path d="${d}" fill="none" stroke="${color}" stroke-width="${fmt(effWidth)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${opacity.toFixed(2)}"/>`,
    };
});

export const ballPenPlugin: PenToolPlugin = {
    id,
    name,
    renderCanvas,
    renderSegment,
    renderSvg,
    resetCache,
};
