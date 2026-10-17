/**
 * sandbox/pens/ball.js
 * 
 * Bolígrafo (Ballpoint Pen)
 * Trazo monolinea uniforme con terminaciones redondeadas y flujo de tinta constante.
 * 
 * Contrato:
 * export function renderPen(ctx, points, style)
 */

export const id = 'ball';
export const name = 'Bolígrafo';
export const description = 'Monolínea constante y precisa, flujo de tinta uniforme';

/**
 * Renderiza un trazo de bolígrafo
 * @param {CanvasRenderingContext2D} ctx - Contexto 2D del canvas
 * @param {Array<{x: number, y: number, pressure?: number}>} points - Secuencia de puntos
 * @param {{width: number, opacity: number, color: string, simulatePressure?: boolean}} style - Parámetros de estilo
 */
export function renderPen(ctx, points, style) {
    if (!points || points.length === 0) return;

    const baseWidth = Math.max(1, (style.width || 3) * 0.9);
    const color = style.color || '#1e1e1e';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Caso 1: Punto único (toque o tap)
    if (points.length === 1) {
        const pt = points[0];
        const pressure = pt.pressure !== undefined && pt.pressure > 0 ? pt.pressure : 0.5;
        const radius = Math.max(1, (baseWidth / 2) * (style.simulatePressure ? (0.75 + pressure * 0.5) : 1));
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
    }

    // Caso 2: Dos puntos simples
    if (points.length === 2) {
        ctx.lineWidth = baseWidth;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        ctx.stroke();
        ctx.restore();
        return;
    }

    // Caso 3: Múltiples puntos con curva bezier cuadrática continua a través de puntos medios
    ctx.lineWidth = baseWidth;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const mx = (prev.x + curr.x) / 2;
        const my = (prev.y + curr.y) / 2;
        ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }

    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();

    ctx.restore();
}

// Fallback de registro global para compatibilidad directa
if (typeof globalThis !== 'undefined') {
    globalThis.ApoloSandbox = globalThis.ApoloSandbox || { pens: {}, engines: {} };
    globalThis.ApoloSandbox.pens.ball = { id, name, description, renderPen };
}
