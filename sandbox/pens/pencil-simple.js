/**
 * sandbox/pens/pencil-simple.js
 * 
 * Lápiz minimalista de ancho variable aleatorio (Simple Variable-Width Pencil)
 * Basado en la técnica directa de segmentos conectados con variaciones discretas
 * de grosor y terminaciones redondeadas (lineJoin = lineCap = 'round').
 * 
 * Contrato:
 * export function renderCanvas(ctx, points, style)
 * export function renderSvg(points, style)
 * export function renderPen(ctx, points, style)
 */

export const id = 'pencil-simple';
export const name = 'Lápiz 1 · Simple (Segmentos)';
export const description = 'Iteración 1: Segmentos conectados punto a punto con ancho pseudo-aleatorio discreto';

/**
 * Generador pseudo-aleatorio determinista basado en índice y semilla para evitar
 * parpadeos (jitter/flicker) entre frames de redibujado.
 */
function getPseudoRandomInt(i, min, max, seed = 42) {
    const v = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    const norm = v - Math.floor(v);
    return Math.floor(norm * (max - min + 1)) + min;
}

/**
 * Renderiza el trazo conectando segmentos punto a punto con grosores variables
 * @param {CanvasRenderingContext2D} ctx - Contexto 2D del canvas
 * @param {Array<{x: number, y: number, pressure?: number}>} points - Secuencia de puntos
 * @param {{width?: number, opacity?: number, color?: string, simulatePressure?: boolean}} style - Parámetros de estilo
 */
export function renderCanvas(ctx, points, style) {
    if (!points || points.length === 0) return;

    const baseWidth = Math.max(1, style.width || 4);
    const color = style.color || '#2b2b2b';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Rango de variación dinámico centrado en el baseWidth seleccionado
    // Para baseWidth = 4, rango aprox [3, 5] (como en el snippet del usuario)
    const minW = Math.max(0.75, baseWidth * 0.75);
    const maxW = Math.max(minW + 0.5, baseWidth * 1.25);

    // Caso 1: Punto único
    if (points.length === 1) {
        const pt = points[0];
        const pFactor = pt.pressure !== undefined && pt.pressure > 0 ? pt.pressure : 0.5;
        const w = (baseWidth * (0.6 + 0.8 * pFactor));
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(0.5, w / 2), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
    }

    // Caso 2: Segmentos conectados con anchos variables
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];

        // Ancho pseudo-aleatorio estable por índice de punto
        const randWidth = getPseudoRandomInt(i, Math.round(minW * 10), Math.round(maxW * 10), 101) / 10;
        
        // Modulación por presión del sensor stylus (si existe)
        const p = curr.pressure !== undefined && curr.pressure > 0 ? curr.pressure : 0.5;
        const pressureScale = 0.7 + 0.6 * p;
        const segmentWidth = Math.max(0.75, randWidth * pressureScale);

        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineWidth = segmentWidth;
        ctx.lineTo(curr.x, curr.y);
        ctx.stroke();
    }

    ctx.restore();
}

export const renderPen = renderCanvas;

/**
 * Exportador complementario SVG para compatibilidad total con la suite del sandbox
 */
export function renderSvg(points, style) {
    if (!points || points.length === 0) return { defs: {}, body: '' };

    const baseWidth = Math.max(1, style.width || 4);
    const color = style.color || '#2b2b2b';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;

    const f = (n) => (Math.round(n * 10) / 10).toString();

    if (points.length === 1) {
        const pt = points[0];
        const r = Math.max(0.5, baseWidth / 2);
        return {
            defs: {},
            body: `<circle cx="${f(pt.x)}" cy="${f(pt.y)}" r="${f(r)}" fill="${color}" opacity="${opacity.toFixed(2)}"/>`,
        };
    }

    const minW = Math.max(0.75, baseWidth * 0.75);
    const maxW = Math.max(minW + 0.5, baseWidth * 1.25);

    let body = '';
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const randWidth = getPseudoRandomInt(i, Math.round(minW * 10), Math.round(maxW * 10), 101) / 10;
        const p = curr.pressure !== undefined && curr.pressure > 0 ? curr.pressure : 0.5;
        const segmentWidth = Math.max(0.75, randWidth * (0.7 + 0.6 * p));

        body += `<path d="M ${f(prev.x)} ${f(prev.y)} L ${f(curr.x)} ${f(curr.y)}" fill="none" stroke="${color}" stroke-width="${f(segmentWidth)}" stroke-opacity="${opacity.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }

    return { defs: {}, body };
}

// Fallback de registro global para compatibilidad directa
if (typeof globalThis !== 'undefined') {
    globalThis.ApoloSandbox = globalThis.ApoloSandbox || { pens: {}, engines: {} };
    globalThis.ApoloSandbox.pens['pencil-simple'] = { id, name, description, renderPen, renderCanvas, renderSvg };
}
