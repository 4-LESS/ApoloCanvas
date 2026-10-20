/**
 * sandbox/pens/pencil-multistrand.js — Fibras de grafito vectoriales puras.
 * 6 curvas continuas desplazadas por la normal, con lineDash de primos y alpha bajo.
 * Draw calls por trazo: 6.  SVG: 6 <path> con stroke-dasharray / stroke-opacity.
 */
import { pressureScale, meanPressure, normals, tracePath, svgPathD, fmt } from './pencil-common.js';

export const id = 'pencil-multistrand';
export const name = 'Lápiz 2 · Multistrand (Fibras)';
export const description = 'Iteración 2: 6 hebras paralelas desplazadas por la normal con lineDash primo';

const OFFSETS = [-0.42, -0.22, -0.06, 0.08, 0.25, 0.40];
const SUBW    = [0.22, 0.30, 0.38, 0.36, 0.30, 0.20];
const ALPHA   = [0.18, 0.26, 0.32, 0.31, 0.25, 0.19];
const DASHES  = [
    [1.5, 1.2, 3.1, 0.9], [2.3, 0.7, 1.3, 1.1], [3.7, 0.5, 2.9, 0.7],
    [4.1, 0.6, 1.9, 0.5], [2.1, 1.3, 1.7, 0.8], [1.3, 1.7, 2.3, 1.1],
];

function strands(points, style) {
    const w = Math.max(1, style.width || 3);
    const ns = normals(points);
    const pm = meanPressure(points);
    const dashScale = Math.max(1, w / 6);
    return OFFSETS.map((off, k) => ({
        pts: points.map((p, i) => {
            const r = off * w * pressureScale(p.pressure);
            return { x: p.x + ns[i].x * r, y: p.y + ns[i].y * r };
        }),
        width: Math.max(0.6, w * SUBW[k] * pressureScale(pm)),
        alpha: Math.min(1, (style.opacity ?? 1) * ALPHA[k] * (0.6 + pm * 1.2)),
        dash: DASHES[k].map((d) => d * dashScale),
    }));
}

export function renderCanvas(ctx, points, style) {
    if (!points || !points.length) return;
    ctx.save();
    ctx.strokeStyle = style.color || '#2b2b2b';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strands(points, style)) {
        ctx.globalAlpha = s.alpha;
        ctx.lineWidth = s.width;
        ctx.setLineDash(points.length > 1 ? s.dash : []);
        ctx.beginPath();
        tracePath(ctx, s.pts);
        ctx.stroke();
    }
    ctx.restore();
}

export function renderSvg(points, style) {
    if (!points || !points.length) return { defs: {}, body: '' };
    const c = style.color || '#2b2b2b';
    const body = strands(points, style).map((s) =>
        `<path d="${svgPathD(s.pts)}" fill="none" stroke="${c}" stroke-width="${fmt(s.width)}" stroke-opacity="${s.alpha.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${s.dash.map(fmt).join(' ')}"/>`
    ).join('');
    return { defs: {}, body };
}

export const renderPen = renderCanvas;
