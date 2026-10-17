/**
 * sandbox/pens/pencil-common.js
 * Utilidades compartidas por las 4 arquitecturas de lápiz SVG-compatibles.
 */

/** Hash determinista [0..1) — estable entre frames (sin parpadeo en live preview). */
export function hash(i, seed = 0) {
    const v = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    return v - Math.floor(v);
}

/** Curva de presión del lápiz (min 0.45, max 1.35, gamma 0.8). */
export function pressureScale(p) {
    if (p === undefined || isNaN(p) || p <= 0) return 1;
    const t = Math.pow(Math.min(1, p), 0.8);
    const e = t * t * (3 - 2 * t);
    return 0.45 + e * 0.9;
}

export function meanPressure(points) {
    let s = 0;
    for (const p of points) s += p.pressure ?? 0.5;
    return points.length ? s / points.length : 0.5;
}

/** Normales unitarias por punto (promedio de segmentos adyacentes). */
export function normals(points) {
    const n = points.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        const a = points[Math.max(0, i - 1)];
        const b = points[Math.min(n - 1, i + 1)];
        let dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        out[i] = { x: -dy / len, y: dx / len };
    }
    return out;
}

/** Traza en ctx un camino cuadrático por puntos medios (1 path continuo). */
export function tracePath(ctx, pts) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], c = pts[i];
        ctx.quadraticCurveTo(p.x, p.y, (p.x + c.x) / 2, (p.y + c.y) / 2);
    }
    const l = pts[pts.length - 1];
    ctx.lineTo(l.x, l.y);
}

const f = (v) => (Math.round(v * 10) / 10).toString();

/** Mismo camino que tracePath pero como atributo SVG `d`. */
export function svgPathD(pts) {
    if (pts.length === 1) return `M${f(pts[0].x)} ${f(pts[0].y)}l0.01 0`;
    let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], c = pts[i];
        d += `Q${f(p.x)} ${f(p.y)} ${f((p.x + c.x) / 2)} ${f((p.y + c.y) / 2)}`;
    }
    const l = pts[pts.length - 1];
    return d + `L${f(l.x)} ${f(l.y)}`;
}

/** Polígono cerrado como `d` SVG. */
export function svgPolygonD(poly) {
    let d = '';
    for (let i = 0; i < poly.length; i++) d += (i ? 'L' : 'M') + f(poly[i].x) + ' ' + f(poly[i].y);
    return d + 'Z';
}

export const fmt = f;
export const colorId = (c) => String(c).replace(/[^a-zA-Z0-9]/g, '');
