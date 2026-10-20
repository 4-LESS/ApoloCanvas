/**
 * sandbox/pens/fountain.js
 * 
 * Estilográfica (Fountain Pen)
 * Trazos expresivos y caligráficos con grosor dinámico variable según presión y velocidad.
 * 
 * Contrato:
 * export function renderPen(ctx, points, style)
 */

export const id = 'fountain';
export const name = 'Estilográfica';
export const description = 'Trazo caligráfico dinámico sensible a la presión, fino al elevarse y con cuerpo al apoyar';

// Configuración de respuesta ergonómica de presión para estilográfica
const FOUNTAIN_CONFIG = {
    minScale: 0.35,
    maxScale: 1.60,
    gamma: 0.75,
};

/**
 * Mapea presión cruda [0..1] a un factor de escala no lineal natural
 */
function calculateFountainPressureScale(rawPressure) {
    if (rawPressure === undefined || isNaN(rawPressure) || rawPressure <= 0) {
        return 1.0;
    }
    const p = Math.max(0, Math.min(1, rawPressure));
    const curvedT = Math.pow(p, FOUNTAIN_CONFIG.gamma);
    // Suavizado hermite (smoothstep)
    const easedT = curvedT * curvedT * (3 - 2 * curvedT);
    return FOUNTAIN_CONFIG.minScale + easedT * (FOUNTAIN_CONFIG.maxScale - FOUNTAIN_CONFIG.minScale);
}

/**
 * Renderiza un trazo de pluma estilográfica
 * @param {CanvasRenderingContext2D} ctx - Contexto 2D del canvas
 * @param {Array<{x: number, y: number, pressure?: number}>} points - Secuencia de puntos
 * @param {{width: number, opacity: number, color: string}} style - Parámetros de estilo
 */
export function renderPen(ctx, points, style) {
    if (!points || points.length === 0) return;

    const baseWidth = Math.max(1, style.width || 3);
    const color = style.color || '#1e1e1e';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Caso 1: Punto único (toque o gota de tinta)
    if (points.length === 1) {
        const pt = points[0];
        const scale = calculateFountainPressureScale(pt.pressure);
        const radius = Math.max(1, (baseWidth * scale) / 2);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
    }

    // Verificar si hay variación de presión entre los puntos
    let hasVariablePressure = false;
    const firstP = points[0].pressure ?? 0.5;
    for (let i = 1; i < points.length; i++) {
        if (Math.abs((points[i].pressure ?? 0.5) - firstP) > 0.05) {
            hasVariablePressure = true;
            break;
        }
    }

    // Si la presión es prácticamente constante o no hay sensor, usamos renderizado de cinta continua bezier
    if (!hasVariablePressure) {
        const scale = calculateFountainPressureScale(firstP);
        ctx.lineWidth = Math.max(1, baseWidth * scale);
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
        return;
    }

    // Con presión variable: Renderizado de segmentos trapeciales continuos con extremos circulares
    // agrupados en un único beginPath + fill('nonzero') (1 sola llamada de dibujo O(1))
    ctx.beginPath();
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];

        const s1 = calculateFountainPressureScale(p1.pressure);
        const s2 = calculateFountainPressureScale(p2.pressure);

        const r1 = Math.max(0.75, (baseWidth * s1) / 2);
        const r2 = Math.max(0.75, (baseWidth * s2) / 2);

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.hypot(dx, dy);

        if (dist >= 0.2) {
            const nx = -dy / dist;
            const ny = dx / dist;

            const x1a = p1.x + nx * r1;
            const y1a = p1.y + ny * r1;
            const x1b = p1.x - nx * r1;
            const y1b = p1.y - ny * r1;

            const x2a = p2.x + nx * r2;
            const y2a = p2.y + ny * r2;
            const x2b = p2.x - nx * r2;
            const y2b = p2.y - ny * r2;

            ctx.moveTo(x1a, y1a);
            ctx.lineTo(x2a, y2a);
            ctx.lineTo(x2b, y2b);
            ctx.lineTo(x1b, y1b);
            ctx.closePath();
        }

        ctx.moveTo(p1.x + r1, p1.y);
        ctx.arc(p1.x, p1.y, r1, 0, Math.PI * 2);
    }

    const lastPt = points[points.length - 1];
    const lastR = Math.max(0.75, (baseWidth * calculateFountainPressureScale(lastPt.pressure)) / 2);
    ctx.moveTo(lastPt.x + lastR, lastPt.y);
    ctx.arc(lastPt.x, lastPt.y, lastR, 0, Math.PI * 2);
    ctx.fill('nonzero');

    ctx.restore();
}

export const renderCanvas = renderPen;

/**
 * Exportación SVG de estilográfica con envolvente de ancho variable sensible a la presión
 */
export function renderSvg(points, style) {
    if (!points || points.length === 0) return { defs: {}, body: '' };

    const baseWidth = Math.max(1, style.width || 3);
    const color = style.color || '#1e1e1e';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;
    const f = (n) => (Math.round(n * 10) / 10).toString();

    if (points.length === 1) {
        const pt = points[0];
        const scale = calculateFountainPressureScale(pt.pressure);
        const radius = Math.max(1, (baseWidth * scale) / 2);
        return {
            defs: {},
            body: `<circle cx="${f(pt.x)}" cy="${f(pt.y)}" r="${f(radius)}" fill="${color}" fill-opacity="${opacity.toFixed(2)}"/>`,
        };
    }

    let d = '';
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const r1 = Math.max(0.75, (baseWidth * calculateFountainPressureScale(p1.pressure)) / 2);
        const r2 = Math.max(0.75, (baseWidth * calculateFountainPressureScale(p2.pressure)) / 2);

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.hypot(dx, dy);

        if (dist >= 0.2) {
            const nx = -dy / dist;
            const ny = dx / dist;
            d += `M${f(p1.x + nx * r1)} ${f(p1.y + ny * r1)}` +
                 `L${f(p2.x + nx * r2)} ${f(p2.y + ny * r2)}` +
                 `L${f(p2.x - nx * r2)} ${f(p2.y - ny * r2)}` +
                 `L${f(p1.x - nx * r1)} ${f(p1.y - ny * r1)}Z`;
        }
        d += `M${f(p1.x - r1)} ${f(p1.y)}a${f(r1)} ${f(r1)} 0 1 0 ${f(r1 * 2)} 0a${f(r1)} ${f(r1)} 0 1 0 -${f(r1 * 2)} 0Z`;
    }

    const lastPt = points[points.length - 1];
    const lastR = Math.max(0.75, (baseWidth * calculateFountainPressureScale(lastPt.pressure)) / 2);
    d += `M${f(lastPt.x - lastR)} ${f(lastPt.y)}a${f(lastR)} ${f(lastR)} 0 1 0 ${f(lastR * 2)} 0a${f(lastR)} ${f(lastR)} 0 1 0 -${f(lastR * 2)} 0Z`;

    return {
        defs: {},
        body: `<path d="${d}" fill="${color}" fill-rule="nonzero" fill-opacity="${opacity.toFixed(2)}"/>`,
    };
}

// Fallback de registro global para compatibilidad directa
if (typeof globalThis !== 'undefined') {
    globalThis.ApoloSandbox = globalThis.ApoloSandbox || { pens: {}, engines: {} };
    globalThis.ApoloSandbox.pens.fountain = { id, name, description, renderPen, renderCanvas, renderSvg };
}
