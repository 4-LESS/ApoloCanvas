/**
 * sandbox/pens/pencil-ribbon-jitter.js — Cinta poligonal de ancho variable con borde rugoso.
 * Contorno tipo perfect-freehand modulado por presión + jitter normal determinista ±18% r.
 * Draw calls por trazo: 3 (2 fill + 1 stroke núcleo).  SVG: polígonos vectoriales puros.
 */
import { hash, pressureScale, normals, tracePath, svgPathD, svgPolygonD, fmt } from './pencil-common.js';

export const id = 'pencil-ribbon-jitter';
export const name = 'Lápiz Ribbon Jitter';

const JITTER = 0.18;
const CAP_STEPS = 6;

function ribbon(points, style, radiusK, seed) {
    const w = Math.max(1, style.width || 3);
    const n = points.length;
    if (n === 1) {
        const p = points[0], r = (w / 2) * radiusK * pressureScale(p.pressure);
        const poly = [];
        for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2, rr = r * (1 + (hash(k, seed) - 0.5) * 2 * JITTER);
            poly.push({ x: p.x + Math.cos(a) * rr, y: p.y + Math.sin(a) * rr });
        }
        return poly;
    }
    const ns = normals(points);
    const left = [], right = [];
    const radii = points.map((p, i) => {
        // Afinado natural en los extremos (taper)
        const t = Math.min(1, i / 3, (n - 1 - i) / 3) * 0.35 + 0.65;
        return (w / 2) * radiusK * pressureScale(p.pressure) * t;
    });
    for (let i = 0; i < n; i++) {
        const p = points[i], r = radii[i];
        const jl = 1 + (hash(i, seed) - 0.5) * 2 * JITTER;
        const jr = 1 + (hash(i, seed + 7) - 0.5) * 2 * JITTER;
        left.push({ x: p.x + ns[i].x * r * jl, y: p.y + ns[i].y * r * jl });
        right.push({ x: p.x - ns[i].x * r * jr, y: p.y - ns[i].y * r * jr });
    }
    // Tapas semicirculares en los extremos
    const cap = (p, nrm, r, from) => {
        const out = [];
        const base = Math.atan2(nrm.y, nrm.x);
        for (let k = 1; k < CAP_STEPS; k++) {
            const a = base + from * (k / CAP_STEPS) * Math.PI;
            out.push({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r });
        }
        return out;
    };
    const endCap = cap(points[n - 1], ns[n - 1], radii[n - 1], -1);
    const startCap = cap(points[0], { x: -ns[0].x, y: -ns[0].y }, radii[0], -1);
    return [...left, ...endCap, ...right.reverse(), ...startCap];
}

function fillPoly(ctx, poly) {
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    ctx.fill();
}

const LAYERS = [[1.0, 0.35, 11], [0.78, 0.55, 23]];

export function renderCanvas(ctx, points, style) {
    if (!points || !points.length) return;
    const op = style.opacity ?? 1;
    ctx.save();
    ctx.fillStyle = ctx.strokeStyle = style.color || '#2b2b2b';
    for (const [k, a, seed] of LAYERS) {
        ctx.globalAlpha = op * a;
        fillPoly(ctx, ribbon(points, style, k, seed));
    }
    if (points.length > 1) {
        ctx.globalAlpha = op * 0.35;
        ctx.lineWidth = Math.max(0.6, (style.width || 3) * 0.18);
        ctx.lineCap = 'round';
        ctx.beginPath();
        tracePath(ctx, points);
        ctx.stroke();
    }
    ctx.restore();
}

export function renderSvg(points, style) {
    if (!points || !points.length) return { defs: {}, body: '' };
    const c = style.color || '#2b2b2b';
    const op = style.opacity ?? 1;
    let body = LAYERS.map(([k, a, seed]) =>
        `<path d="${svgPolygonD(ribbon(points, style, k, seed))}" fill="${c}" fill-opacity="${(op * a).toFixed(2)}"/>`).join('');
    if (points.length > 1) {
        body += `<path d="${svgPathD(points)}" fill="none" stroke="${c}" stroke-opacity="${(op * 0.35).toFixed(2)}" stroke-width="${fmt(Math.max(0.6, (style.width || 3) * 0.18))}" stroke-linecap="round"/>`;
    }
    return { defs: {}, body };
}

export const renderPen = renderCanvas;
