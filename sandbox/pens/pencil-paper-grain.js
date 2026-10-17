/**
 * sandbox/pens/pencil-paper-grain.js — Núcleo suave + patrón de diente de papel.
 * Patrón procedural 48x48 cacheado por color + shadowBlur para eliminar el borde duro.
 * Draw calls por trazo: 2.  SVG: <pattern> + <filter> en defs y 1 <path>.
 */
import { hash, pressureScale, meanPressure, tracePath, svgPathD, fmt, colorId } from './pencil-common.js';

export const id = 'pencil-paper-grain';
export const name = 'Lápiz Paper Grain';

const SIZE = 48;
const SPECKS = 520;
const patternCache = new Map(); // color -> CanvasPattern

/** Lista determinista de motas (compartida por Canvas y SVG → misma textura). */
function specks() {
    const out = [];
    for (let i = 0; i < SPECKS; i++) {
        out.push({
            x: hash(i, 1) * SIZE,
            y: hash(i, 2) * SIZE,
            r: 0.35 + hash(i, 3) * 0.75,
            a: 0.25 + hash(i, 4) * 0.75,
        });
    }
    return out;
}
const SPECK_LIST = specks();

export function getGrainPattern(ctx, color) {
    if (patternCache.has(color)) return patternCache.get(color);
    if (typeof document === 'undefined') return color;
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const p = c.getContext('2d');
    // Base suave (gradiente de alpha bajo) para que no queden huecos totales
    p.fillStyle = color;
    p.globalAlpha = 0.28;
    p.fillRect(0, 0, SIZE, SIZE);
    for (const s of SPECK_LIST) {
        p.globalAlpha = s.a;
        p.beginPath();
        p.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        p.fill();
    }
    const pat = ctx.createPattern(c, 'repeat') || color;
    patternCache.set(color, pat);
    return pat;
}

/** Render en 2 pasadas continuas (exportado para reutilizar en svg-turbulence). */
export function drawGrainPasses(ctx, points, style, { shadow = true } = {}) {
    const color = style.color || '#2b2b2b';
    const w = Math.max(1, style.width || 3) * pressureScale(meanPressure(points));
    const op = style.opacity ?? 1;
    ctx.save();
    ctx.strokeStyle = getGrainPattern(ctx, color);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (shadow) { ctx.shadowColor = color; ctx.shadowBlur = w * 0.18; }
    const passes = [[1.05, 0.35], [0.75, 0.75]];
    for (const [k, a] of passes) {
        ctx.globalAlpha = op * a;
        ctx.lineWidth = Math.max(1, w * k);
        ctx.beginPath();
        if (points.length === 1) {
            ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            tracePath(ctx, points);
            ctx.stroke();
        }
    }
    ctx.restore();
}

export function renderCanvas(ctx, points, style) {
    if (!points || !points.length) return;
    drawGrainPasses(ctx, points, style);
}

export function renderSvg(points, style) {
    if (!points || !points.length) return { defs: {}, body: '' };
    const color = style.color || '#2b2b2b';
    const cid = colorId(color);
    const w = Math.max(1, style.width || 3) * pressureScale(meanPressure(points));
    const op = style.opacity ?? 1;
    const blurId = `apolo-soft-${Math.round(w * 0.18 * 10)}`;
    const patId = `apolo-grain-${cid}`;
    const dots = SPECK_LIST.map((s) =>
        `<circle cx="${fmt(s.x)}" cy="${fmt(s.y)}" r="${fmt(s.r)}" fill-opacity="${s.a.toFixed(2)}"/>`).join('');
    const defs = {
        [patId]: `<pattern id="${patId}" width="${SIZE}" height="${SIZE}" patternUnits="userSpaceOnUse"><g fill="${color}"><rect width="${SIZE}" height="${SIZE}" fill-opacity="0.28"/>${dots}</g></pattern>`,
        [blurId]: `<filter id="${blurId}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${fmt(w * 0.09)}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    };
    const d = svgPathD(points);
    // 1 path por trazo: la pasada base/núcleo se aproxima con opacidad combinada
    const body = `<path d="${d}" fill="none" stroke="url(#${patId})" stroke-width="${fmt(Math.max(1, w * 0.9))}" stroke-opacity="${(op * 0.85).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" filter="url(#${blurId})"/>`;
    return { defs, body };
}

export const renderPen = renderCanvas;
