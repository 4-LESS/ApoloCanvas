/**
 * pencil-atlas.js (v3: mínimo y rápido)
 *
 * El trazo se descompone en pasos a distancia fija. Los pasos confirmados son inmutables, así que se
 * hornean UNA vez en tiles de 256 px; cada frame solo se rasteriza la cola. Costo por frame ~ pasos
 * nuevos, no largo del trazo.
 *
 * Contrato: renderCanvas(ctx, points, style) dibuja el trazo COMPLETO (el host limpia antes) con
 * ctx.transform = dpr. style: { width, color, opacity, seed?, strokeId? }.
 *  - Pasa strokeId si `points` no es el mismo array entre frames (si no, se re-hornea cada frame).
 *  - Al aplanar el trazo en tu capa confirmada: releasePencilStroke(strokeId | points).
 *  - Al elegir color: prewarmPencilAtlas(color) para que el primer trazo no pague la construcción.
 */

export const id = 'pencil-atlasClaude';
export const name = 'Lápiz 11 · Atlas v5 (Compacto SoA)';
export const description = 'Iteración 11: Atlas de K=12 niveles con estado SoA append-only, horneado incremental en tiles de 256px y simplificación SVG';

const P = 256;          // lado (px de dispositivo) del tile de papel y de los tiles de horneado
const K = 12;           // niveles del atlas (bajarlo reduce fills por frame)
const CHUNK = 24;       // pasos confirmados mínimos para hornear
const OVERLAP = 0.35;   // solape (px) entre tramos: evita costuras
const MAX_BAKED = 6;    // trazos con tiles en memoria
const SVG_REL = 0.12;   // tolerancia SVG = SVG_REL × ancho de cada cinta

// Cintas concéntricas: ancho relativo, perfil de nivel, nivel mínimo, jitter, salt PRNG, semiancho mínimo
const TIERS = [
    { w: 1.18, prof: 0.32, minK: 1, jit: 0.30, salt: 11, min: 0.22 },
    { w: 0.88, prof: 0.60, minK: 2, jit: 0.18, salt: 29, min: 0.22 },
    { w: 0.58, prof: 0.85, minK: 4, jit: 0.09, salt: 53, min: 0.22 },
    { w: 0.30, prof: 1.05, minK: 6, jit: 0.03, salt: 79, min: 0.45 },
];

const pr = (pt) => (pt.pressure > 0 ? pt.pressure : 0.5);
const dotLevel = (p) => Math.max(3, Math.min(K, Math.round(K * p * 0.85)));

function rnd(seed, i, salt) {
    let t = (seed + Math.imul(i + 1, 0x9E3779B1) + Math.imul(salt, 0x85EBCA6B)) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ───────────────────────── Papel y atlas ─────────────────────────

let paper = null; // { raw, sorted }

const lattice = (seed, cs) => Float32Array.from({ length: (P / cs) ** 2 }, (_, i) => rnd(seed, i, 1));

function vnoise(x, y, cs, lat) {
    const n = P / cs, gx = x / cs, gy = y / cs, x0 = Math.floor(gx), y0 = Math.floor(gy);
    const u = gx - x0, v = gy - y0, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const i0 = x0 % n, i1 = (x0 + 1) % n, j0 = (y0 % n) * n, j1 = ((y0 + 1) % n) * n;
    const a = lat[j0 + i0], b = lat[j0 + i1], c = lat[j1 + i0], d = lat[j1 + i1];
    const t = a + su * (b - a), s = c + su * (d - c);
    return t + sv * (s - t);
}

/** Altura del papel (periódica 256x256). `sorted` da los cuantiles: nivel k = píxeles con H bajo el cuantil f(k). */
function getPaper() {
    if (paper) return paper;
    const N = P * P, M = P - 1, TAU = (Math.PI * 2) / P;
    const w = new Float32Array(N), raw = new Float32Array(N);
    const L2 = lattice(303, 2), L4 = lattice(202, 4);
    for (let i = 0; i < N; i++) w[i] = rnd(707, i, 3);
    for (let y = 0; y < P; y++) {
        const u = ((y - 1) & M) * P, m = y * P, d = ((y + 1) & M) * P;
        for (let x = 0; x < P; x++) {
            const l = (x - 1) & M, r = (x + 1) & M;
            const nb = (w[u + l] + w[u + x] + w[u + r] + w[m + l] + w[m + r] + w[d + l] + w[d + x] + w[d + r]) * 0.125;
            const fiber = (Math.sin((32 * x + 24 * y) * TAU) + Math.cos((24 * x - 32 * y) * TAU)) * 0.25 + 0.5;
            raw[m + x] = (w[m + x] - nb * 0.65 + 0.5) * 0.55 + vnoise(x, y, 2, L2) * 0.25 + fiber * 0.10 + vnoise(x, y, 4, L4) * 0.10;
        }
    }
    paper = { raw, sorted: raw.slice().sort() }; // sort de typed array = numérico y nativo
    return paper;
}

function parseRgb(c) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((c || '').trim());
    if (m) {
        const n = parseInt(m[1].length === 3 ? m[1].replace(/./g, (s) => s + s) : m[1], 16);
        return [n >> 16, (n >> 8) & 255, n & 255];
    }
    const q = /(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c || '');
    return q ? [+q[1], +q[2], +q[3]] : [43, 43, 43];
}

const atlases = new Map();

function getAtlas(color) {
    let a = atlases.get(color);
    if (!a) {
        a = { rgb: parseRgb(color), tiles: [], pats: [], urls: [], dpr: 0 };
        atlases.set(color, a);
        if (atlases.size > 8) atlases.delete(atlases.keys().next().value);
        // Construcción en segundo plano en navegador, un nivel por macrotarea
        if (typeof window !== 'undefined' && typeof document !== 'undefined') {
            let k = 0;
            const step = () => { if (++k <= K) { tile(a, k); setTimeout(step, 0); } };
            setTimeout(step, 0);
        }
    }
    return a;
}

/** Tile alfa del nivel k (1..K): cobertura creciente, ladera suave. Se construye una sola vez. */
function tile(a, k) {
    if (a.tiles[k]) return a.tiles[k];
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const cv = document.createElement('canvas');
    cv.width = cv.height = P;
    const cx = cv.getContext && cv.getContext('2d');
    if (!cx || typeof cx.createImageData !== 'function') return null;
    const { raw, sorted } = getPaper(), N = raw.length;
    const f = 0.18 + ((k - 1) / (K - 1)) * 0.78;
    const lo = sorted[(f * N) | 0], hi = sorted[Math.min(N - 1, ((f + 0.14) * N) | 0)];
    const img = cx.createImageData(P, P), d = img.data, [r, g, b] = a.rgb;
    for (let i = 0; i < N; i++) {
        const h = raw[i];
        if (h >= hi) continue;
        const o = i * 4;
        d[o] = r; d[o + 1] = g; d[o + 2] = b;
        if (h <= lo) d[o + 3] = 255;
        else { const t = (hi - h) / (hi - lo); d[o + 3] = (t * t * 185) | 0; }
    }
    cx.putImageData(img, 0, 0);
    return (a.tiles[k] = cv);
}

function pattern(a, k, ctx, dpr) {
    if (a.dpr !== dpr) { a.pats = []; a.dpr = dpr; }
    let p = a.pats[k];
    if (!p) {
        const t = tile(a, k);
        if (!t || !ctx || typeof ctx.createPattern !== 'function') return `rgb(${a.rgb.join(',')})`;
        p = ctx.createPattern(t, 'repeat');
        if (p && typeof p.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
            p.setTransform(new DOMMatrix().scale(1 / dpr, 1 / dpr));
        }
        a.pats[k] = p;
    }
    return p || `rgb(${a.rgb.join(',')})`;
}

export function prewarmPencilAtlas(color) { getAtlas(color || '#2b2b2b'); }
if (typeof window !== 'undefined') setTimeout(() => prewarmPencilAtlas(), 0);

// ───────────────────────── Estado del trazo (SoA, append-only) ─────────────────────────

const byPts = new WeakMap();
const byId = new Map();
const baked = []; // estados con tiles en memoria (el más antiguo primero)

function newState(p0, w, seed) {
    const cap = 512, p = pr(p0), ds = Math.max(0.45, 0.22 * w);
    const s = {
        w, seed, ds, ap: 1 - Math.exp(-ds / Math.max(1, w)),
        raw: 1, ax: p0.x, ay: p0.y, aP: p, ema: p, rem: 0,
        cap, n: 1, conf: 1,
        x: new Float64Array(cap), y: new Float64Array(cap),
        nx: new Float32Array(cap), ny: new Float32Array(cap), p: new Float32Array(cap),
        bk: '', op: 1, nBaked: 0, hy: [0, 0, 0, 0], tiles: new Map(),
    };
    s.x[0] = p0.x; s.y[0] = p0.y; s.ny[0] = -1; s.p[0] = p;
    return s;
}

function stateFor(pts, st, w) {
    const sid = st.strokeId;
    let s = sid != null ? byId.get(sid) : byPts.get(pts);
    if (s && (s.w !== w || s.x[0] !== pts[0].x || s.y[0] !== pts[0].y || pts.length - 1 < s.raw)) {
        free(s);
        s = null;
    }
    if (!s) {
        const seed = typeof st.seed === 'number' ? st.seed | 0
            : (Math.imul(Math.round(pts[0].x * 100), 73856093) ^ Math.imul(Math.round(pts[0].y * 100), 19349663)) | 0;
        s = newState(pts[0], w, seed);
        if (sid != null) {
            byId.set(sid, s);
            if (byId.size > 200) { const k = byId.keys().next().value; free(byId.get(k)); byId.delete(k); }
        } else byPts.set(pts, s);
    }
    return s;
}

function free(s) {
    for (const T of s.tiles.values()) T.cv.width = 0;
    s.tiles.clear();
    s.nBaked = 0;
    s.hy = [0, 0, 0, 0];
    const i = baked.indexOf(s);
    if (i >= 0) baked.splice(i, 1);
}

export function releasePencilStroke(ref) {
    const isPts = ref !== null && typeof ref === 'object';
    const s = isPts ? byPts.get(ref) : byId.get(ref);
    if (!s) return;
    free(s);
    if (isPts) byPts.delete(ref); else byId.delete(ref);
}

function push(s, x, y, nx, ny, p) {
    if (s.n === s.cap) {
        s.cap *= 2;
        for (const k of ['x', 'y', 'nx', 'ny', 'p']) {
            const a = new s[k].constructor(s.cap);
            a.set(s[k]);
            s[k] = a;
        }
    }
    const i = s.n++;
    s.x[i] = x; s.y[i] = y; s.nx[i] = nx; s.ny[i] = ny; s.p[i] = p;
}

/** Pasos cada `ds` px sobre una B-spline cuadrática; la normal sale de la derivada analítica (continua). */
function emit(s, r, ax, ay, ap, cx, cy, cp, bx, by, bp) {
    let px = ax, py = ay, pp = ap;
    for (let q = 1; q <= 4; q++) {
        const t = q / 4, u = 1 - t;
        const X = u * u * ax + 2 * u * t * cx + t * t * bx;
        const Y = u * u * ay + 2 * u * t * cy + t * t * by;
        const pq = u * u * ap + 2 * u * t * cp + t * t * bp;
        const dx = X - px, dy = Y - py, L = Math.hypot(dx, dy);
        if (L > 1e-4) {
            let cur = s.ds - r.rem;
            while (cur <= L) {
                const f = cur / L, tt = t - 0.25 + f * 0.25, v = 1 - tt;
                let tx = 2 * v * (cx - ax) + 2 * tt * (bx - cx), ty = 2 * v * (cy - ay) + 2 * tt * (by - cy);
                let tl = Math.hypot(tx, ty);
                if (tl < 1e-6) { tx = dx; ty = dy; tl = L; }
                r.ema += (pp + (pq - pp) * f - r.ema) * s.ap;
                push(s, px + dx * f, py + dy * f, -ty / tl, tx / tl, r.ema);
                cur += s.ds;
            }
            r.rem = L - (cur - s.ds);
        }
        px = X; py = Y; pp = pq;
    }
}

/** Confirma los puntos nuevos (inmutables) y recalcula la cola provisional detrás de ellos. */
function advance(s, pts) {
    s.n = s.conf; // descarta la cola anterior
    for (; s.raw <= pts.length - 2; s.raw++) {
        const c = pts[s.raw], nx = pts[s.raw + 1], cp = pr(c);
        const mx = (c.x + nx.x) * 0.5, my = (c.y + nx.y) * 0.5, mp = (cp + pr(nx)) * 0.5;
        emit(s, s, s.ax, s.ay, s.aP, c.x, c.y, cp, mx, my, mp);
        s.ax = mx; s.ay = my; s.aP = mp;
    }
    s.conf = s.n;
    const l = pts[pts.length - 1], lp = pr(l);
    emit(s, { ema: s.ema, rem: s.rem }, s.ax, s.ay, s.aP, (s.ax + l.x) * 0.5, (s.ay + l.y) * 0.5, (s.aP + lp) * 0.5, l.x, l.y, lp);
    if (s.n > 1) { s.nx[0] = s.nx[1]; s.ny[0] = s.ny[1]; }
}

// ───────────────────────── Geometría de cintas ─────────────────────────

let cap = 0, pn, LX = [], LY = [], RX = [], RY = [], LV = [];
let bx0, by0, bx1, by1;
const runs = [];                       // [tier, a, b, nivel] * n
const used = new Uint8Array(K + 1);

function ensure(m) {
    if (m <= cap) return;
    cap = Math.max(512, m * 2);
    pn = new Float32Array(cap);
    for (let t = 0; t < TIERS.length; t++) {
        LX[t] = new Float64Array(cap); LY[t] = new Float64Array(cap);
        RX[t] = new Float64Array(cap); RY[t] = new Float64Array(cap);
    }
}

/**
 * Rieles y tramos de nivel de los pasos [g0, g1). Si g0 > 0, el paso g0 es un ancla ya procesada y su
 * nivel es hy[t]. `hy` (nivel actual por tier, histéresis) se actualiza en sitio.
 */
function prep(s, g0, g1, hy) {
    const m = g1 - g0, seed = s.seed;
    ensure(m);
    bx0 = by0 = Infinity; bx1 = by1 = -Infinity;
    runs.length = 0;
    used.fill(0);
    for (let j = 0; j < m; j++) pn[j] = Math.min(1, Math.max(0.08, Math.pow(s.p[g0 + j], 0.8)));

    for (let t = 0; t < TIERS.length; t++) {
        const T = TIERS[t], lx = LX[t], ly = LY[t], rx = RX[t], ry = RY[t], base = s.w * T.w * 0.5;
        let a1 = rnd(seed, g0, T.salt) - 0.5, b1 = rnd(seed, g0, T.salt + 7) - 0.5;
        let lvl = hy[t], cur = 0, start = 0;

        for (let j = 0; j < m; j++) {
            const g = g0 + j;
            const a2 = rnd(seed, g + 1, T.salt) - 0.5, b2 = rnd(seed, g + 1, T.salt + 7) - 0.5;
            const wi = base * (0.55 + 0.75 * pn[j]);
            const hl = Math.max(T.min, wi * (1 + (a1 + a2) * T.jit));
            const hr = Math.max(T.min, wi * (1 + (b1 + b2) * T.jit));
            a1 = a2; b1 = b2;

            const X = s.x[g], Y = s.y[g], nx = s.nx[g], ny = s.ny[g];
            const ax = X + nx * hl, ay = Y + ny * hl, bx = X - nx * hr, by = Y - ny * hr;
            lx[j] = ax; ly[j] = ay; rx[j] = bx; ry[j] = by;
            if (ax < bx0) bx0 = ax; if (bx < bx0) bx0 = bx; if (ax > bx1) bx1 = ax; if (bx > bx1) bx1 = bx;
            if (ay < by0) by0 = ay; if (by < by0) by0 = by; if (ay > by1) by1 = ay; if (by > by1) by1 = by;

            // Nivel con histéresis (solo cambia si se aleja > 0.75 del actual)
            const v = Math.min(K, Math.max(T.minK, K * T.prof * pn[j]));
            if (!lvl) lvl = Math.round(v);
            else if (j > 0 && Math.abs(v - lvl) > 0.75) lvl = Math.round(v);

            if (j === 0) cur = lvl;
            else if (lvl !== cur) { addRun(t, start, j, cur); start = j; cur = lvl; }
        }
        addRun(t, start, m - 1, cur);
        hy[t] = lvl;
    }
    return m;
}

function addRun(t, a, b, k) {
    if (b <= a) return;
    runs.push(t, a, b, k);
    used[k] = 1;
}

/** Traza los tramos del nivel k como polígonos en `tg` (ctx, Path2D o sumidero SVG). */
function trace(tg, s, k, g0, m, live) {
    for (let i = 0; i < runs.length; i += 4) {
        if (runs[i + 3] !== k) continue;
        const t = runs[i], a = runs[i + 1], b = runs[i + 2];
        if (tg.tier) tg.tier(t);
        const lx = LX[t], ly = LY[t], rx = RX[t], ry = RY[t];
        // Solape ±OVERLAP a lo largo de la tangente (ny, -nx) en uniones internas
        const sa = g0 + a > 0 ? OVERLAP : 0, sb = live && b === m - 1 ? 0 : OVERLAP;
        const sx = -sa * s.ny[g0 + a], sy = sa * s.nx[g0 + a];
        const ex = sb * s.ny[g0 + b], ey = -sb * s.nx[g0 + b];

        tg.moveTo(lx[a] + sx, ly[a] + sy);
        for (let j = a + 1; j < b; j++) tg.lineTo(lx[j], ly[j]);
        tg.lineTo(lx[b] + ex, ly[b] + ey);
        tg.lineTo(rx[b] + ex, ry[b] + ey);
        for (let j = b - 1; j > a; j--) tg.lineTo(rx[j], ry[j]);
        tg.lineTo(rx[a] + sx, ry[a] + sy);
        tg.closePath();
    }
}

// ───────────────────────── Horneado en tiles ─────────────────────────

function tileAt(s, tx, ty, dpr) {
    const key = tx * 65536 + ty;
    let T = s.tiles.get(key);
    if (!T) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = P;
        T = { cv, ctx: cv.getContext('2d'), x: (tx * P) / dpr, y: (ty * P) / dpr };
        s.tiles.set(key, T);
    }
    return T;
}

function bake(s, A, dpr) {
    if (typeof document === 'undefined' || typeof Path2D === 'undefined') return;
    while (s.conf - s.nBaked >= CHUNK) {
        const from = s.nBaked, to = Math.min(s.conf, from + 256), g0 = from ? from - 1 : 0;
        const m = prep(s, g0, to, s.hy);

        const paths = [];
        for (let k = 1; k <= K; k++) {
            if (!used[k]) continue;
            paths[k] = new Path2D();
            trace(paths[k], s, k, g0, m, false);
        }
        const tx0 = Math.floor((bx0 * dpr - 1) / P), tx1 = Math.floor((bx1 * dpr + 1) / P);
        const ty0 = Math.floor((by0 * dpr - 1) / P), ty1 = Math.floor((by1 * dpr + 1) / P);
        for (let ty = ty0; ty <= ty1; ty++) {
            for (let tx = tx0; tx <= tx1; tx++) {
                const c = tileAt(s, tx, ty, dpr).ctx;
                c.setTransform(dpr, 0, 0, dpr, -tx * P, -ty * P);
                c.globalAlpha = s.op;
                for (let k = 1; k <= K; k++) {
                    if (!used[k]) continue;
                    c.fillStyle = pattern(A, k, c, dpr);
                    c.fill(paths[k]);
                }
            }
        }
        s.nBaked = to;
    }
    if (s.tiles.size && !baked.includes(s)) {
        baked.push(s);
        if (baked.length > MAX_BAKED) free(baked[0]);
    }
}

// ───────────────────────── Canvas ─────────────────────────

function dot(ctx, A, dpr, x, y, p, w, op) {
    ctx.save();
    ctx.globalAlpha = op;
    ctx.fillStyle = pattern(A, dotLevel(p), ctx, dpr);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.8, w * (0.4 + 0.5 * p)), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

export function renderCanvas(ctx, pts, st) {
    if (!pts || !pts.length) return;
    st = st || {};
    const w = Math.max(1, st.width || 3), color = st.color || '#2b2b2b', op = st.opacity !== undefined ? st.opacity : 0.9;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const A = getAtlas(color);

    if (pts.length === 1) return dot(ctx, A, dpr, pts[0].x, pts[0].y, pr(pts[0]), w, op);

    const s = stateFor(pts, st, w);
    advance(s, pts);
    if (s.n < 2) return dot(ctx, A, dpr, s.x[0], s.y[0], s.p[0], w, op);

    const key = color + '|' + op + '|' + dpr;
    if (s.bk !== key) { free(s); s.bk = key; s.op = op; }
    bake(s, A, dpr);

    ctx.save();

    // 1. Volcar lo horneado (1:1 con píxeles de dispositivo)
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const T of s.tiles.values()) ctx.drawImage(T.cv, T.x, T.y, P / dpr, P / dpr);
    ctx.restore();

    // 2. Cola viva: desde el último paso horneado (ancla) hasta el final
    const g0 = s.nBaked ? s.nBaked - 1 : 0;
    const m = prep(s, g0, s.n, s.hy.slice());
    ctx.globalAlpha = op;
    for (let k = 1; k <= K; k++) {
        if (!used[k]) continue;
        ctx.fillStyle = pattern(A, k, ctx, dpr);
        ctx.beginPath();
        trace(ctx, s, k, g0, m, true);
        ctx.fill();
    }
    ctx.restore();
}

export const renderPen = renderCanvas;

// ───────────────────────── SVG ─────────────────────────

/** Sumidero de path SVG: simplificación en línea (tolerancia ∝ ancho de la cinta) y coordenadas relativas de 1 decimal. */
function svgSink(w) {
    let d = '', tol = 0.2, px = 0, py = 0, qx = 0, qy = 0, cx = 0, cy = 0, has = false, rel = false;
    const emit = (x, y) => {
        const X = Math.round(x * 10), Y = Math.round(y * 10);
        if (X === cx && Y === cy) return;
        d += (rel ? ' ' : 'l') + (X - cx) / 10 + ' ' + (Y - cy) / 10;
        rel = true; cx = X; cy = Y;
    };
    return {
        tier(t) { tol = SVG_REL * w * TIERS[t].w; },
        moveTo(x, y) {
            cx = Math.round(x * 10); cy = Math.round(y * 10);
            d += 'M' + cx / 10 + ' ' + cy / 10;
            px = x; py = y; has = false; rel = false;
        },
        lineTo(x, y) {
            if (has) {
                const dx = x - px, dy = y - py, l = Math.hypot(dx, dy) || 1;
                if (Math.abs((qx - px) * dy - (qy - py) * dx) / l > tol) { emit(qx, qy); px = qx; py = qy; }
            }
            qx = x; qy = y; has = true;
        },
        closePath() { if (has) emit(qx, qy); d += 'z'; has = false; rel = false; },
        get d() { return d; },
    };
}

export function renderSvg(points, style) {
    if (!points || !points.length) return { defs: {}, body: '' };
    const st = style || {};
    const w = Math.max(1, st.width || 3), color = st.color || '#2b2b2b', op = st.opacity !== undefined ? st.opacity : 0.9;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const A = getAtlas(color), slug = color.replace(/\W/g, ''), size = Math.round((P / dpr) * 100) / 100;

    const defs = {};
    const fill = (k) => {
        const pid = `apolo-grain-${slug}-k${k}`;
        const t = tile(A, k);
        if (!t || typeof t.toDataURL !== 'function') return color;
        if (!defs[pid]) {
            const href = A.urls[k] || (A.urls[k] = t.toDataURL('image/png'));
            defs[pid] = `<pattern id="${pid}" patternUnits="userSpaceOnUse" width="${size}" height="${size}">` +
                `<image href="${href}" width="${size}" height="${size}" image-rendering="pixelated"/></pattern>`;
        }
        return `url(#${pid})`;
    };
    const dotSvg = (x, y, p) =>
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${Math.max(0.8, w * (0.4 + 0.5 * p)).toFixed(1)}" fill="${fill(dotLevel(p))}" fill-opacity="${op.toFixed(2)}"/>`;

    if (points.length === 1) return { defs, body: dotSvg(points[0].x, points[0].y, pr(points[0])) };

    const s = stateFor(points, st, w);
    advance(s, points);
    if (s.n < 2) return { defs, body: dotSvg(s.x[0], s.y[0], s.p[0]) };

    const m = prep(s, 0, s.n, [0, 0, 0, 0]);
    let paths = '';
    for (let k = 1; k <= K; k++) {
        if (!used[k]) continue;
        const sink = svgSink(s.w);
        trace(sink, s, k, 0, m, true);
        paths += `<path d="${sink.d}" fill="${fill(k)}"/>`;
    }
    return { defs, body: `<g fill-rule="nonzero" fill-opacity="${op.toFixed(2)}" stroke="none">${paths}</g>` };
}

export function resetPencilAtlasCacheForTesting() {
    atlases.clear();
    paper = null;
}

if (typeof globalThis !== 'undefined') {
    globalThis.ApoloSandbox = globalThis.ApoloSandbox || { pens: {}, engines: {} };
    globalThis.ApoloSandbox.pens[id] = { id, name, description, renderPen, renderCanvas, renderSvg };
}
