/**
 * sandbox/pens/pencil-svg-turbulence.js — Grano en Canvas + filtro nativo feTurbulence en SVG.
 * Canvas: 2 pasadas continuas con patrón de grano (sin shadowBlur → máximo FPS).
 * SVG: 1 <path> por trazo con filter="url(#apolo-pencil-tooth)".
 */
import { pressureScale, meanPressure, svgPathD, fmt } from './pencil-common.js';
import { drawGrainPasses } from './pencil-paper-grain.js';

export const id = 'pencil-svg-turbulence';
export const name = 'Lápiz 5 · SVG Turbulence (Filtro SVG)';
export const description = 'Iteración 5: Patrón de grano en Canvas y filtro nativo feTurbulence + feDisplacementMap en SVG';

export function renderCanvas(ctx, points, style) {
    if (!points || !points.length) return;
    // Bordes suaves vía shadowBlur sólo para trazos anchos (coste GPU alto en finos sin beneficio)
    drawGrainPasses(ctx, points, style, { shadow: (style.width || 3) >= 12 });
}

const FILTER = `<filter id="apolo-pencil-tooth" x="-10%" y="-10%" width="120%" height="120%">`
    + `<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="7" result="noise"/>`
    + `<feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.6" result="tooth"/>`
    + `<feComposite in="SourceGraphic" in2="tooth" operator="in" result="grain"/>`
    + `<feDisplacementMap in="grain" in2="noise" scale="2.5" xChannelSelector="R" yChannelSelector="G"/>`
    + `</filter>`;

export function renderSvg(points, style) {
    if (!points || !points.length) return { defs: {}, body: '' };
    const c = style.color || '#2b2b2b';
    const w = Math.max(1, style.width || 3) * pressureScale(meanPressure(points));
    const body = `<path d="${svgPathD(points)}" fill="none" stroke="${c}" stroke-width="${fmt(w)}" stroke-opacity="${(style.opacity ?? 1).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" filter="url(#apolo-pencil-tooth)"/>`;
    return { defs: { 'apolo-pencil-tooth': FILTER }, body };
}

export const renderPen = renderCanvas;
