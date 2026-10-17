/**
 * sandbox/pens/pencil.js
 * 
 * Lápiz de mina (Graphite Pencil)
 * Arquitectura híbrida de 3 pasadas continuas con patrón estocástico de grafito 96x96
 * y desfase de fase determinista por trazo.
 * 
 * Contrato:
 * export function renderCanvas(ctx, points, style)
 * export function renderSvg(points, style)
 * export function renderPen(ctx, points, style)
 */

export const id = 'pencil';
export const name = 'Lápiz de Mina';
export const description = 'Textura estocástica de grafito en 3 pasadas continuas con desfase de fase y exportación SVG feTurbulence';

let graphiteTileCache = null;

export function resetGraphitePatternCacheForTesting() {
    graphiteTileCache = null;
}

export function getGraphitePattern(ctx, color) {
    if (graphiteTileCache && graphiteTileCache.color === color) {
        return graphiteTileCache.pattern;
    }
    try {
        const size = 96;
        const tile = document.createElement('canvas');
        tile.width = size;
        tile.height = size;
        const tCtx = tile.getContext('2d');
        if (!tCtx) return null;

        tCtx.fillStyle = color;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const h1 = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
                const n1 = h1 - Math.floor(h1);
                const h2 = Math.sin(x * 0.35 + y * 0.45) * 1973.17;
                const n2 = h2 - Math.floor(h2);
                const combined = n1 * 0.75 + n2 * 0.25;

                if (combined > 0.36) {
                    tCtx.globalAlpha = Math.min(1, (combined - 0.36) * 1.45);
                    tCtx.fillRect(x, y, 1, 1);
                }
            }
        }
        const pattern = ctx.createPattern(tile, 'repeat');
        if (pattern) {
            graphiteTileCache = { color, pattern };
            return pattern;
        }
    } catch {
        // Safe fallback for headless test mocks
    }
    return null;
}

/**
 * Renderiza un trazo continuo en Canvas 2D usando 3 pasadas y CanvasPattern con desfase de fase
 */
export function renderCanvas(ctx, points, style) {
    if (!points || points.length === 0) return;

    const baseWidth = Math.max(1, style.width || 3);
    const color = style.color || '#2b2b2b';
    const opacity = style.opacity !== undefined ? style.opacity : 0.85;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const grainPattern = getGraphitePattern(ctx, color);
    const strokeStyle = grainPattern ?? color;

    // Caso 1: Punto único
    if (points.length === 1) {
        const pt = points[0];
        ctx.fillStyle = strokeStyle;
        const shiftX = Math.round((pt.x * 37.7) % 96);
        const shiftY = Math.round((pt.y * 53.3) % 96);
        if (grainPattern && typeof grainPattern.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
            grainPattern.setTransform(new DOMMatrix().translate(shiftX, shiftY));
        }
        const avgPressure = pt.pressure !== undefined && pt.pressure > 0 ? pt.pressure : 0.5;
        const pFactor = 0.55 + 0.45 * avgPressure;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(1, (baseWidth * pFactor) / 2), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
    }

    const buildContinuousPath = () => {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const mx = (prev.x + curr.x) / 2;
            const my = (prev.y + curr.y) / 2;
            ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    };

    let totalP = 0;
    for (let i = 0; i < points.length; i++) {
        totalP += (points[i].pressure !== undefined && points[i].pressure > 0) ? points[i].pressure : 0.5;
    }
    const avgPressure = totalP / points.length;
    const pFactor = 0.55 + 0.45 * avgPressure;

    const shiftX = Math.round((points[0].x * 37.7) % 96);
    const shiftY = Math.round((points[0].y * 53.3) % 96);

    const applyShift = (passOffsetX, passOffsetY) => {
        if (grainPattern && typeof grainPattern.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
            grainPattern.setTransform(new DOMMatrix().translate(shiftX + passOffsetX, shiftY + passOffsetY));
        }
    };

    ctx.strokeStyle = strokeStyle;

    // Pass 1 (Outer Soft Halo)
    applyShift(0, 0);
    ctx.lineWidth = Math.max(1.2, baseWidth * 1.18);
    ctx.globalAlpha = opacity * pFactor * 0.22;
    buildContinuousPath();
    ctx.stroke();

    // Pass 2 (Mid Graphite Body)
    applyShift(31, 19);
    ctx.lineWidth = Math.max(1, baseWidth * 0.92);
    ctx.globalAlpha = opacity * pFactor * 0.48;
    buildContinuousPath();
    ctx.stroke();

    // Pass 3 (Dense Inner Core)
    applyShift(67, 43);
    ctx.lineWidth = Math.max(0.8, baseWidth * 0.62);
    ctx.globalAlpha = opacity * pFactor * 0.72;
    buildContinuousPath();
    ctx.stroke();

    ctx.restore();
}

export const renderPen = renderCanvas;

const PENCIL_SVG_FILTER = `<filter id="apolo-pencil-grain" filterUnits="userSpaceOnUse" x="-50" y="-50" width="10000" height="10000">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" seed="17" result="noise"/>` +
    `<feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.45 -0.22" in="noise" result="grainMask"/>` +
    `<feComposite operator="in" in="SourceGraphic" in2="grainMask" result="textured"/>` +
    `<feDisplacementMap in="textured" in2="noise" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter>`;

export function renderSvg(points, style) {
    if (!points || points.length === 0) return { defs: {}, body: '' };

    const color = style.color || '#2b2b2b';
    const width = Math.max(1, style.width || 3);
    const opacity = style.opacity !== undefined ? style.opacity : 0.85;

    const f = (n) => (Math.round(n * 10) / 10).toString();

    let pathD = '';
    if (points.length === 1) {
        pathD = `M ${f(points[0].x)} ${f(points[0].y)} l 0.01 0`;
    } else {
        pathD = `M ${f(points[0].x)} ${f(points[0].y)}`;
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const mx = (prev.x + curr.x) / 2;
            const my = (prev.y + curr.y) / 2;
            pathD += ` Q ${f(prev.x)} ${f(prev.y)} ${f(mx)} ${f(my)}`;
        }
        const last = points[points.length - 1];
        pathD += ` L ${f(last.x)} ${f(last.y)}`;
    }

    const body = `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="${f(width)}" stroke-opacity="${opacity.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" filter="url(#apolo-pencil-grain)"/>`;

    return {
        defs: { 'apolo-pencil-grain': PENCIL_SVG_FILTER },
        body,
    };
}

// Fallback de registro global para compatibilidad directa
if (typeof globalThis !== 'undefined') {
    globalThis.ApoloSandbox = globalThis.ApoloSandbox || { pens: {}, engines: {} };
    globalThis.ApoloSandbox.pens.pencil = { id, name, description, renderPen, renderCanvas, renderSvg };
}
