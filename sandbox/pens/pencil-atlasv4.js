/**
 * sandbox/pens/pencil-atlas.js  (v3: Paridad 1:1 Canvas/SVG + Rendimiento O(1))
 *
 * Lápiz de Grafito Atlas (Ruta B):
 * 1. Campo de altura H (256x256) Blue-Noise + micro-grano + fibra, rank-normalized con
 *    counting sort O(N).
 * 2. Atlas de K=12 niveles anidados con ALFA BINARIO ESTRICTO (255 o 0): garantiza que
 *    la superposición de las 4 cintas concéntricas, de los chunks horneados y de los
 *    auto-cruces en zig-zag sea 100% IDEMPOTENTE (1 U 1 = 1, 0 U 0 = 0), igualando el
 *    comportamiento booleano de `<path>` en SVG y eliminando el empastado oscuro.
 * 3. Opacidad aplicada a nivel de trazo completo (al volcar los tiles en Canvas y mediante
 *    `<g opacity="...">` aislado en SVG) en lugar de multiplicar alfa por cada hebra/chunk.
 * 4. Horneado incremental por TILES dispersos (256x256 px de dispositivo) con pool LRU.
 * 5. Acondicionamiento por longitud de arco en Structure-of-Arrays (SoA) con normales
 *    analíticas continuas y simplificación RDP de alta precisión en SVG.
 *
 * Contrato con el host:
 *  - export function renderCanvas(ctx, points, style)
 *  - export function renderSvg(points, style)
 *  - export function renderPen(ctx, points, style)
 *  - export function releasePencilStroke(strokeId | points)
 *  - export function prewarmPencilAtlas(color, dpr, opts)
 */

export const id = 'pencil-atlasv4';
export const name = 'Lápiz 10 · Atlas v4 (Tiles Idempotentes)';
export const description = 'Iteración 10: Atlas binario idempotente K=12 con pool LRU de tiles de 256px y grupo de opacidad aislado';

// ───────────────────────────── Constantes ─────────────────────────────

const PAPER_SIZE = 256;
const ATLAS_LEVELS = 12;
const TILE_PX = 256;               // Tiles de 256x256 px de dispositivo
const MIN_CHUNK_STEPS = 16;        // Pasos confirmados mínimos para hornear un nuevo chunk
const MAX_CHUNK_STEPS = 256;       // Tope por chunk en reconstrucciones completas
const SEAM_OVERLAP = 0.35;         // Solape sub-píxel tangencial (100% idempotente con alfa binario)
const LEVEL_HYSTERESIS = 0.25;     // Margen extra sobre 0.5 para cambiar de nivel del atlas
const MIN_RUN_STEPS = 6;           // Pasos mínimos antes de permitir otro cambio de nivel
const MAX_CACHED_TILES = 384;      // ~96 MB máximo a 256x256 RGBA
const MAX_ATLAS_ENTRIES = 8;
const MAX_TILE_POOL = 96;
const MAX_ID_STATES = 256;
const SVG_RAIL_TOLERANCE = 0.09;   // px: máxima fidelidad de silueta en curvas cerradas respecto a Canvas

/**
 * Si es true, cada trazo nuevo aplica un desfase determinista al patrón tanto en Canvas como en SVG
 * para que múltiples trazos independientes rellenen gradualmente los poros al sombrear.
 * Si es false, el grano queda anclado de forma absoluta al origen (0,0) del papel.
 */
const ENABLE_SHADING_BUILDUP = false;

/**
 * 4 cintas concéntricas para caída gaussiana de densidad desde el núcleo hacia los bordes.
 */
const RIBBON_TIERS = [
    { widthFactor: 1.18, levelProfile: 0.32, minK: 1, jitterScale: 0.30, salt: 11, minHalf: 0.22 },
    { widthFactor: 0.88, levelProfile: 0.60, minK: 2, jitterScale: 0.18, salt: 29, minHalf: 0.22 },
    { widthFactor: 0.58, levelProfile: 0.85, minK: 4, jitterScale: 0.09, salt: 53, minHalf: 0.22 },
    { widthFactor: 0.30, levelProfile: 1.05, minK: 6, jitterScale: 0.03, salt: 79, minHalf: 0.45 },
];
const TIER_COUNT = RIBBON_TIERS.length;

// ───────────────────────────── Utilidades ─────────────────────────────

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function hasDocument() {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function pressureOf(pt) {
    return pt.pressure !== undefined && pt.pressure > 0 ? pt.pressure : 0.5;
}

function yieldToMain() {
    if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') return scheduler.yield();
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * PRNG determinista rápido (Mulberry32 mix) para (seed, index) -> [0, 1)
 */
function prngStep(seed, index, salt = 0) {
    let t = (seed + Math.imul(index + 1, 0x9E3779B1) + Math.imul(salt, 0x85EBCA6B)) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ─────────────────────── Campo de altura del papel H ───────────────────────

let paperHeightField = null;
const latticeCache = new Map();

function getLattice(seed, cellSize) {
    const key = seed * 1000 + cellSize;
    let lat = latticeCache.get(key);
    if (!lat) {
        const period = PAPER_SIZE / cellSize;
        lat = new Float32Array(period * period);
        for (let i = 0; i < lat.length; i++) lat[i] = prngStep(seed, i, 1);
        latticeCache.set(key, lat);
    }
    return lat;
}

/**
 * Value-noise periódico 2D sobre una grilla precalculada (periodo = PAPER_SIZE / cellSize).
 */
function periodicValueNoise(x, y, cellSize, lattice) {
    const period = PAPER_SIZE / cellSize;
    const gx = x / cellSize;
    const gy = y / cellSize;

    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;

    const u = tx * tx * (3 - 2 * tx);
    const v = ty * ty * (3 - 2 * ty);

    const ix0 = ((x0 % period) + period) % period;
    const iy0 = ((y0 % period) + period) % period;
    const ix1 = (ix0 + 1) % period;
    const iy1 = (iy0 + 1) % period;

    const n00 = lattice[iy0 * period + ix0];
    const n10 = lattice[iy0 * period + ix1];
    const n01 = lattice[iy1 * period + ix0];
    const n11 = lattice[iy1 * period + ix1];

    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return nx0 + v * (nx1 - nx0);
}

/**
 * Campo de altura H (256x256): blue-noise de alta frecuencia + micro-grano + fibra,
 * rank-normalized a [0, 1) con counting sort O(N) (16 bits).
 */
export function getPaperHeightField() {
    if (paperHeightField) return paperHeightField;

    const total = PAPER_SIZE * PAPER_SIZE;
    const white = new Float32Array(total);
    const raw = new Float32Array(total);
    const twoPiOver256 = (Math.PI * 2) / PAPER_SIZE;
    const lat2 = getLattice(303, 2);
    const lat4 = getLattice(202, 4);

    for (let i = 0; i < total; i++) {
        white[i] = prngStep(707, i, 3);
    }

    const mask = PAPER_SIZE - 1;
    let min = Infinity;
    let max = -Infinity;

    for (let y = 0; y < PAPER_SIZE; y++) {
        const yUp = ((y - 1) & mask) * PAPER_SIZE;
        const yMid = y * PAPER_SIZE;
        const yDn = ((y + 1) & mask) * PAPER_SIZE;

        for (let x = 0; x < PAPER_SIZE; x++) {
            const xL = (x - 1) & mask;
            const xR = (x + 1) & mask;
            const idx = yMid + x;

            const neighbors =
                (white[yUp + xL] + white[yUp + x] + white[yUp + xR] +
                 white[yMid + xL] +                 white[yMid + xR] +
                 white[yDn + xL] + white[yDn + x] + white[yDn + xR]) * 0.125;

            const blueGrain = (white[idx] - neighbors * 0.65) + 0.5;
            const micro2px = periodicValueNoise(x, y, 2, lat2);
            const subtle4px = periodicValueNoise(x, y, 4, lat4);

            const f1 = Math.sin((32 * x + 24 * y) * twoPiOver256) * 0.5 + 0.5;
            const f2 = Math.cos((24 * x - 32 * y) * twoPiOver256) * 0.5 + 0.5;
            const fiber = f1 * 0.5 + f2 * 0.5;

            const v = blueGrain * 0.55 + micro2px * 0.25 + fiber * 0.10 + subtle4px * 0.10;
            raw[idx] = v;
            if (v < min) min = v;
            if (v > max) max = v;
        }
    }

    // Rank-normalization por counting sort O(N)
    const BINS = 65536;
    const scale = (BINS - 1) / Math.max(1e-9, max - min);
    const counts = new Uint32Array(BINS + 1);
    const bins = new Uint16Array(total);
    for (let i = 0; i < total; i++) {
        const b = ((raw[i] - min) * scale) | 0;
        bins[i] = b;
        counts[b + 1]++;
    }
    for (let b = 0; b < BINS; b++) counts[b + 1] += counts[b];

    const normalized = new Float32Array(total);
    const invTotal = 1 / total;
    for (let i = 0; i < total; i++) {
        normalized[i] = (counts[bins[i]]++) * invTotal;
    }

    paperHeightField = normalized;
    return paperHeightField;
}

// ───────────────────────────── Atlas de grano ─────────────────────────────

const atlasCache = new Map();

function parseColorToRgb(colorStr) {
    const clean = (colorStr || '#2b2b2b').trim();
    if (clean.startsWith('#')) {
        let hex = clean.slice(1);
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        const num = parseInt(hex.slice(0, 6), 16);
        if (!Number.isNaN(num)) {
            return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
        }
    }
    const rgbMatch = clean.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
        return [Number(rgbMatch[1]) & 255, Number(rgbMatch[2]) & 255, Number(rgbMatch[3]) & 255];
    }
    return [43, 43, 43];
}

/**
 * Entrada de atlas por (color, dpr). Los niveles, patrones y data URLs se crean bajo demanda.
 */
export function getOrCreateGrainAtlas(ctx, color, dpr = 1) {
    const safeColor = color || '#2b2b2b';
    const key = `${safeColor}|${dpr.toFixed(2)}`;
    let entry = atlasCache.get(key);
    if (entry) {
        atlasCache.delete(key);
        atlasCache.set(key, entry);
        return entry;
    }
    entry = {
        color: safeColor,
        dpr,
        rgb: parseColorToRgb(safeColor),
        tiles: new Array(ATLAS_LEVELS + 1).fill(null),
        patterns: new Array(ATLAS_LEVELS + 1).fill(null),
        dataUrls: new Array(ATLAS_LEVELS + 1).fill(''),
    };
    atlasCache.set(key, entry);
    if (atlasCache.size > MAX_ATLAS_ENTRIES) {
        atlasCache.delete(atlasCache.keys().next().value);
    }
    return entry;
}

/**
 * Construye el tile del nivel k con ALFA BINARIO ESTRICTO (255 o 0).
 * Al ser binario y anidado (A_1 subset A_2 subset ... subset A_K), pintar múltiples
 * niveles, chunks o auto-intersecciones a globalAlpha = 1 es 100% idempotente,
 * garantizando que los poros blancos (alpha = 0) jamás se empasten en Canvas respecto a SVG.
 */
function buildAtlasTile(entry, k) {
    if (entry.tiles[k]) return entry.tiles[k];
    if (!hasDocument()) return null;

    const H = getPaperHeightField();
    const [r, g, b] = entry.rgb;

    // Cobertura calibrada de 22% (nivel 1: halo exterior) a 96% (nivel 12: núcleo a máxima presión)
    const minCoverage = 0.22;
    const maxCoverage = 0.96;
    const frac = (k - 1) / (ATLAS_LEVELS - 1);
    const threshold = minCoverage + frac * (maxCoverage - minCoverage);

    const tile = document.createElement('canvas');
    tile.width = PAPER_SIZE;
    tile.height = PAPER_SIZE;
    const tCtx = tile.getContext('2d');
    if (!tCtx) return null;

    const imgData = tCtx.createImageData(PAPER_SIZE, PAPER_SIZE);
    const data = imgData.data;

    for (let i = 0; i < H.length; i++) {
        if (H[i] < threshold) {
            const p = i * 4;
            data[p] = r;
            data[p + 1] = g;
            data[p + 2] = b;
            data[p + 3] = 255; // Alfa binario puro: idempotencia total Canvas <-> SVG
        }
    }

    tCtx.putImageData(imgData, 0, 0);
    entry.tiles[k] = tile;
    return tile;
}

export function getAtlasPattern(entry, k, ctx) {
    let pat = entry.patterns[k];
    if (pat) return pat;
    if (!ctx || typeof ctx.createPattern !== 'function') return null;
    const tile = buildAtlasTile(entry, k);
    if (!tile) return null;
    pat = ctx.createPattern(tile, 'repeat');
    if (pat && typeof pat.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
        pat.setTransform(new DOMMatrix().scale(1 / entry.dpr, 1 / entry.dpr));
    }
    entry.patterns[k] = pat;
    return pat;
}

export function getAtlasDataUrl(entry, k) {
    if (entry.dataUrls[k]) return entry.dataUrls[k];
    const tile = buildAtlasTile(entry, k);
    if (!tile) return '';
    try {
        entry.dataUrls[k] = tile.toDataURL('image/png');
    } catch {
        entry.dataUrls[k] = '';
    }
    return entry.dataUrls[k];
}

/**
 * Precalienta H y el atlas del color/dpr cediendo el hilo entre pasos.
 */
export async function prewarmPencilAtlas(color, dpr, opts = {}) {
    const d = dpr || (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
    await yieldToMain();
    getPaperHeightField();
    const entry = getOrCreateGrainAtlas(null, color, d);
    let scratchCtx = null;
    if (hasDocument()) {
        scratchCtx = document.createElement('canvas').getContext('2d');
    }
    for (let k = 1; k <= ATLAS_LEVELS; k++) {
        await yieldToMain();
        getAtlasPattern(entry, k, scratchCtx);
        if (opts.svg) getAtlasDataUrl(entry, k);
    }
    return entry;
}

// ───────────────────── Estado por trazo (conditioning SoA) ─────────────────────

function getStrokeSeed(points, style) {
    if (style && typeof style.seed === 'number') return style.seed | 0;
    if (!points || points.length === 0) return 1337;
    const p0 = points[0];
    return (Math.imul(Math.round(p0.x * 100), 73856093) ^ Math.imul(Math.round(p0.y * 100), 19349663)) | 0;
}

function getStrokePatternShift(seed) {
    if (!ENABLE_SHADING_BUILDUP) return { shiftX: 0, shiftY: 0 };
    const shiftX = Math.round(prngStep(seed, 0, 911) * PAPER_SIZE);
    const shiftY = Math.round(prngStep(seed, 1, 911) * PAPER_SIZE);
    return { shiftX, shiftY };
}

function applyPatternShift(pat, dpr, shift) {
    if (!pat || typeof pat.setTransform !== 'function' || typeof DOMMatrix === 'undefined') return;
    if (ENABLE_SHADING_BUILDUP) {
        pat.setTransform(new DOMMatrix().translate(shift.shiftX, shift.shiftY).scale(1 / dpr, 1 / dpr));
    }
}

function createSoA(cap) {
    return {
        cap,
        count: 0,
        x: new Float64Array(cap),
        y: new Float64Array(cap),
        nx: new Float32Array(cap),
        ny: new Float32Array(cap),
        p: new Float32Array(cap),
    };
}

function growSoA(a) {
    const cap = a.cap * 2;
    const x = new Float64Array(cap); x.set(a.x); a.x = x;
    const y = new Float64Array(cap); y.set(a.y); a.y = y;
    const nx = new Float32Array(cap); nx.set(a.nx); a.nx = nx;
    const ny = new Float32Array(cap); ny.set(a.ny); a.ny = ny;
    const p = new Float32Array(cap); p.set(a.p); a.p = p;
    a.cap = cap;
}

function soaPush(a, x, y, nx, ny, p) {
    if (a.count === a.cap) growSoA(a);
    const i = a.count++;
    a.x[i] = x;
    a.y[i] = y;
    a.nx[i] = nx;
    a.ny[i] = ny;
    a.p[i] = p;
}

function createHyst() {
    const h = new Array(TIER_COUNT);
    for (let t = 0; t < TIER_COUNT; t++) h[t] = { lvl: 0, run: 0, init: false };
    return h;
}

function resetHyst(h) {
    for (let t = 0; t < TIER_COUNT; t++) {
        h[t].lvl = 0;
        h[t].run = 0;
        h[t].init = false;
    }
}

function copyHyst(dst, src) {
    for (let t = 0; t < TIER_COUNT; t++) {
        dst[t].lvl = src[t].lvl;
        dst[t].run = src[t].run;
        dst[t].init = src[t].init;
    }
}

function createStrokeState(p0, baseWidth, seed) {
    const ds = Math.max(0.45, 0.22 * baseWidth);
    const tau = Math.max(1.0, baseWidth);
    const initP = pressureOf(p0);
    const confirmed = createSoA(256);
    soaPush(confirmed, p0.x, p0.y, 0, -1, initP);

    return {
        baseWidth,
        seed,
        ds,
        alphaP: 1 - Math.exp(-ds / tau),
        firstX: p0.x,
        firstY: p0.y,
        rawCount: 1,
        lastAnchorX: p0.x,
        lastAnchorY: p0.y,
        lastAnchorP: initP,
        emaP: initP,
        remDist: 0,
        confirmed,
        tail: createSoA(64),
        tailRun: { emaP: initP, remDist: 0 },
        shift: getStrokePatternShift(seed),
        // Estado de horneado en tiles (siempre a alfa binario 1.0; opacity se aplica al volcar)
        bakeDpr: 0,
        bakeColor: '',
        bakedUpTo: 0,
        bakeDisabled: false,
        hyst: createHyst(),
        tiles: new Map(),
    };
}

let stateByPoints = new WeakMap();
const stateById = new Map();
const liveStates = new Set();
let totalTiles = 0;

function getState(points, style, baseWidth, seed) {
    const sid = style && style.strokeId !== undefined && style.strokeId !== null ? style.strokeId : null;
    let state = sid !== null ? stateById.get(sid) : stateByPoints.get(points);
    const p0 = points[0];

    if (state && (
        state.baseWidth !== baseWidth ||
        state.seed !== seed ||
        state.firstX !== p0.x ||
        state.firstY !== p0.y ||
        points.length - 1 < state.rawCount
    )) {
        releaseState(state);
        state = null;
    }

    if (!state) {
        state = createStrokeState(p0, baseWidth, seed);
        if (sid !== null) {
            stateById.set(sid, state);
            if (stateById.size > MAX_ID_STATES) {
                const oldestKey = stateById.keys().next().value;
                const oldest = stateById.get(oldestKey);
                stateById.delete(oldestKey);
                if (oldest) releaseState(oldest);
            }
        } else {
            stateByPoints.set(points, state);
        }
    }
    return state;
}

/**
 * Emite pasos cada `ds` px de longitud de arco sobre un segmento B-spline cuadrático.
 * La normal sale de la derivada analítica de la curva (continua entre sub-segmentos).
 */
function emitQuadSegment(target, run, ds, alphaP, ax0, ay0, ap0, cx, cy, cp, ax1, ay1, ap1) {
    let prevX = ax0;
    let prevY = ay0;
    let prevP = ap0;

    for (let sub = 1; sub <= 4; sub++) {
        const t = sub * 0.25;
        const it = 1 - t;
        const bx = it * it * ax0 + 2 * it * t * cx + t * t * ax1;
        const by = it * it * ay0 + 2 * it * t * cy + t * t * ay1;
        const bp = it * it * ap0 + 2 * it * t * cp + t * t * ap1;

        const dx = bx - prevX;
        const dy = by - prevY;
        const segLen = Math.hypot(dx, dy);

        if (segLen > 1e-4) {
            const tPrev = t - 0.25;
            let cursor = ds - run.remDist;
            while (cursor <= segLen) {
                const frac = cursor / segLen;
                const sx = prevX + dx * frac;
                const sy = prevY + dy * frac;
                const sp = prevP + (bp - prevP) * frac;

                run.emaP += (sp - run.emaP) * alphaP;

                const tt = tPrev + frac * 0.25;
                const itt = 1 - tt;
                let tx = 2 * itt * (cx - ax0) + 2 * tt * (ax1 - cx);
                let ty = 2 * itt * (cy - ay0) + 2 * tt * (ay1 - cy);
                let tl = Math.hypot(tx, ty);
                if (tl < 1e-6) {
                    tx = dx;
                    ty = dy;
                    tl = segLen;
                }
                soaPush(target, sx, sy, -ty / tl, tx / tl, run.emaP);

                cursor += ds;
            }
            run.remDist = segLen - (cursor - ds);
        }

        prevX = bx;
        prevY = by;
        prevP = bp;
    }
}

/**
 * Avanza el condicionamiento solo sobre los puntos crudos nuevos y recalcula la cola provisional.
 */
function advanceConditioning(state, rawPoints) {
    const maxConfirmedIdx = rawPoints.length - 2;
    while (state.rawCount <= maxConfirmedIdx) {
        const i = state.rawCount;
        const curr = rawPoints[i];
        const next = rawPoints[i + 1];
        const cp = pressureOf(curr);
        const np = pressureOf(next);
        const midX = (curr.x + next.x) * 0.5;
        const midY = (curr.y + next.y) * 0.5;
        const midP = (cp + np) * 0.5;

        const prevConfirmedCount = state.confirmed.count;

        emitQuadSegment(
            state.confirmed, state, state.ds, state.alphaP,
            state.lastAnchorX, state.lastAnchorY, state.lastAnchorP,
            curr.x, curr.y, cp,
            midX, midY, midP
        );

        // Si acabamos de emitir el paso 1, sincronizamos la normal inicial del paso 0
        if (prevConfirmedCount === 1 && state.confirmed.count > 1) {
            state.confirmed.nx[0] = state.confirmed.nx[1];
            state.confirmed.ny[0] = state.confirmed.ny[1];
        }

        state.lastAnchorX = midX;
        state.lastAnchorY = midY;
        state.lastAnchorP = midP;
        state.rawCount++;
    }

    // Cola provisional: del último ancla al último punto crudo
    const tail = state.tail;
    tail.count = 0;
    const run = state.tailRun;
    run.emaP = state.emaP;
    run.remDist = state.remDist;

    const lastPt = rawPoints[rawPoints.length - 1];
    const lastP = pressureOf(lastPt);
    emitQuadSegment(
        tail, run, state.ds, state.alphaP,
        state.lastAnchorX, state.lastAnchorY, state.lastAnchorP,
        (state.lastAnchorX + lastPt.x) * 0.5, (state.lastAnchorY + lastPt.y) * 0.5, (state.lastAnchorP + lastP) * 0.5,
        lastPt.x, lastPt.y, lastP
    );

    if (state.confirmed.count === 1 && tail.count > 0) {
        state.confirmed.nx[0] = tail.nx[0];
        state.confirmed.ny[0] = tail.ny[0];
    }
}

/**
 * API compatible con v1: devuelve pasos como objetos.
 */
export function conditionStrokeByArcLength(rawPoints, baseWidth, seed) {
    if (!rawPoints || rawPoints.length === 0) return [];
    if (rawPoints.length === 1) {
        const p0 = rawPoints[0];
        return [{ x: p0.x, y: p0.y, nx: 0, ny: 1, p: pressureOf(p0), stepIndex: 0 }];
    }
    const state = getState(rawPoints, null, baseWidth, seed);
    advanceConditioning(state, rawPoints);

    const c = state.confirmed;
    const t = state.tail;
    const total = c.count + t.count;
    const out = new Array(total);
    for (let g = 0; g < total; g++) {
        const src = g < c.count ? c : t;
        const i = g < c.count ? g : g - c.count;
        out[g] = { x: src.x[i], y: src.y[i], nx: src.nx[i], ny: src.ny[i], p: src.p[i], stepIndex: g };
    }
    return out;
}

// ───────────────────── Geometría de cintas (buffers de trabajo) ─────────────────────

const S = {
    cap: 0,
    x: null, y: null, nx: null, ny: null, p: null, pn: null,
    LX: new Array(TIER_COUNT), LY: new Array(TIER_COUNT),
    RX: new Array(TIER_COUNT), RY: new Array(TIER_COUNT),
    LV: new Array(TIER_COUNT),
    minX: 0, minY: 0, maxX: 0, maxY: 0,
    runCap: 0, runCount: 0,
    runT: null, runA: null, runB: null, runK: null,
    levelUsed: new Uint8Array(ATLAS_LEVELS + 1),
};

function ensureScratch(m) {
    if (m <= S.cap) return;
    let cap = Math.max(512, S.cap);
    while (cap < m) cap *= 2;
    S.cap = cap;
    S.x = new Float64Array(cap);
    S.y = new Float64Array(cap);
    S.nx = new Float32Array(cap);
    S.ny = new Float32Array(cap);
    S.p = new Float32Array(cap);
    S.pn = new Float32Array(cap);
    for (let t = 0; t < TIER_COUNT; t++) {
        S.LX[t] = new Float64Array(cap);
        S.LY[t] = new Float64Array(cap);
        S.RX[t] = new Float64Array(cap);
        S.RY[t] = new Float64Array(cap);
        S.LV[t] = new Uint8Array(cap);
    }
}

function pressureNorm(p) {
    return clamp(Math.pow(p, 0.80), 0.08, 1);
}

/**
 * Copia los pasos globales [g0, g1) (confirmados + cola) al buffer de trabajo.
 */
function assemble(state, g0, g1) {
    const m = g1 - g0;
    ensureScratch(m);
    const conf = state.confirmed;
    const tail = state.tail;
    const cc = conf.count;

    for (let j = 0; j < m; j++) {
        const g = g0 + j;
        if (g < cc) {
            S.x[j] = conf.x[g];
            S.y[j] = conf.y[g];
            S.nx[j] = conf.nx[g];
            S.ny[j] = conf.ny[g];
            S.p[j] = conf.p[g];
        } else {
            const tj = g - cc;
            S.x[j] = tail.x[tj];
            S.y[j] = tail.y[tj];
            S.nx[j] = tail.nx[tj];
            S.ny[j] = tail.ny[tj];
            S.p[j] = tail.p[tj];
        }
        S.pn[j] = pressureNorm(S.p[j]);
    }
    if (g0 === 0 && m > 1) {
        S.nx[0] = S.nx[1];
        S.ny[0] = S.ny[1];
    }
    return m;
}

/**
 * Nivel del atlas por paso y por tier con histéresis y largo mínimo de tramo.
 */
function computeLevels(m, hasAnchor, hyst) {
    for (let t = 0; t < TIER_COUNT; t++) {
        const tier = RIBBON_TIERS[t];
        const h = hyst[t];
        const out = S.LV[t];
        const profile = ATLAS_LEVELS * tier.levelProfile;

        for (let j = 0; j < m; j++) {
            if (j === 0 && hasAnchor) {
                out[0] = h.lvl;
                continue;
            }
            const v = clamp(profile * S.pn[j], tier.minK, ATLAS_LEVELS);
            if (!h.init) {
                h.lvl = Math.round(v);
                h.run = 1;
                h.init = true;
            } else if (h.run >= MIN_RUN_STEPS && Math.abs(v - h.lvl) > 0.5 + LEVEL_HYSTERESIS) {
                h.lvl = Math.round(v);
                h.run = 1;
            } else {
                h.run++;
            }
            out[j] = h.lvl;
        }
    }
}

/**
 * Rieles izquierdo/derecho de cada tier. El ruido es f(seed, índice global de paso).
 */
function buildGeometry(m, segBase, seed, baseWidth) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (let t = 0; t < TIER_COUNT; t++) {
        const tier = RIBBON_TIERS[t];
        const LX = S.LX[t], LY = S.LY[t], RX = S.RX[t], RY = S.RY[t];
        const saltB = tier.salt + 7;
        const wBase = baseWidth * tier.widthFactor;
        const minHalf = tier.minHalf;
        const jit = tier.jitterScale;

        let a1 = prngStep(seed, segBase, tier.salt) - 0.5;
        let b1 = prngStep(seed, segBase, saltB) - 0.5;

        for (let j = 0; j < m; j++) {
            const a2 = prngStep(seed, segBase + j + 1, tier.salt) - 0.5;
            const b2 = prngStep(seed, segBase + j + 1, saltB) - 0.5;
            const r1 = a1 + a2;
            const r2 = b1 + b2;
            a1 = a2;
            b1 = b2;

            const wi = wBase * (0.55 + 0.75 * S.pn[j]);
            const halfL = Math.max(minHalf, wi * 0.5 * (1 + r1 * jit));
            const halfR = Math.max(minHalf, wi * 0.5 * (1 + r2 * jit));

            const x = S.x[j], y = S.y[j], nx = S.nx[j], ny = S.ny[j];
            const lx = x + nx * halfL, ly = y + ny * halfL;
            const rx = x - nx * halfR, ry = y - ny * halfR;
            LX[j] = lx; LY[j] = ly; RX[j] = rx; RY[j] = ry;

            if (lx < minX) minX = lx; if (lx > maxX) maxX = lx;
            if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
            if (ly < minY) minY = ly; if (ly > maxY) maxY = ly;
            if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
        }
    }
    S.minX = minX; S.minY = minY; S.maxX = maxX; S.maxY = maxY;
}

function pushRun(t, a, b, k) {
    if (b <= a) return;
    if (S.runCount === S.runCap) {
        const cap = Math.max(64, S.runCap * 2);
        const grow = (old) => { const n = new Int32Array(cap); if (old) n.set(old); return n; };
        S.runT = grow(S.runT); S.runA = grow(S.runA); S.runB = grow(S.runB); S.runK = grow(S.runK);
        S.runCap = cap;
    }
    const r = S.runCount++;
    S.runT[r] = t; S.runA[r] = a; S.runB[r] = b; S.runK[r] = k;
    S.levelUsed[k] = 1;
}

function collectRuns(m) {
    S.runCount = 0;
    S.levelUsed.fill(0);
    for (let t = 0; t < TIER_COUNT; t++) {
        const lv = S.LV[t];
        let rs = 0;
        let cur = lv[0];
        for (let j = 1; j < m; j++) {
            const k = lv[j];
            if (k !== cur) {
                pushRun(t, rs, j, cur);
                rs = j;
                cur = k;
            }
        }
        pushRun(t, rs, m - 1, cur);
    }
}

/**
 * Traza un tramo como polígono cerrado en `target` (CanvasRenderingContext2D o Path2D).
 */
function traceRun(target, r, m, segBase, atStrokeEnd) {
    const t = S.runT[r];
    const a = S.runA[r];
    const b = S.runB[r];
    const LX = S.LX[t], LY = S.LY[t], RX = S.RX[t], RY = S.RY[t];

    let sx = 0, sy = 0, ex = 0, ey = 0;
    if (a > 0) {
        sx = -SEAM_OVERLAP * S.ny[a];
        sy = SEAM_OVERLAP * S.nx[a];
    }
    if (!(atStrokeEnd && b === m - 1)) {
        ex = SEAM_OVERLAP * S.ny[b];
        ey = -SEAM_OVERLAP * S.nx[b];
    }

    target.moveTo(LX[a] + sx, LY[a] + sy);
    for (let j = a + 1; j < b; j++) target.lineTo(LX[j], LY[j]);
    target.lineTo(LX[b] + ex, LY[b] + ey);
    target.lineTo(RX[b] + ex, RY[b] + ey);
    for (let j = b - 1; j > a; j--) target.lineTo(RX[j], RY[j]);
    target.lineTo(RX[a] + sx, RY[a] + sy);
    target.closePath();
}

function traceLevel(target, k, m, segBase, atStrokeEnd) {
    for (let r = 0; r < S.runCount; r++) {
        if (S.runK[r] === k) traceRun(target, r, m, segBase, atStrokeEnd);
    }
}

/**
 * API compatible con v1: polígonos por nivel.
 */
export function buildLevelRuns(steps, baseWidth, seed) {
    const runsByLevel = Array.from({ length: ATLAS_LEVELS + 1 }, () => []);
    if (!steps || steps.length < 2) return runsByLevel;

    const m = steps.length;
    ensureScratch(m);
    for (let j = 0; j < m; j++) {
        const s = steps[j];
        S.x[j] = s.x; S.y[j] = s.y; S.nx[j] = s.nx; S.ny[j] = s.ny; S.p[j] = s.p;
        S.pn[j] = pressureNorm(s.p);
    }
    const hyst = createHyst();
    computeLevels(m, false, hyst);
    buildGeometry(m, 0, seed, baseWidth);
    collectRuns(m);

    for (let r = 0; r < S.runCount; r++) {
        const t = S.runT[r], a = S.runA[r], b = S.runB[r];
        const poly = new Float32Array((b - a + 1) * 4);
        let ptr = 0;
        for (let j = a; j <= b; j++) { poly[ptr++] = S.LX[t][j]; poly[ptr++] = S.LY[t][j]; }
        for (let j = b; j >= a; j--) { poly[ptr++] = S.RX[t][j]; poly[ptr++] = S.RY[t][j]; }
        runsByLevel[S.runK[r]].push(poly);
    }
    return runsByLevel;
}

// ───────────────────────── Tiles de horneado ─────────────────────────

const tilePool = [];

function acquireTileCanvas() {
    let t = tilePool.pop();
    if (!t) {
        const canvas = document.createElement('canvas');
        canvas.width = TILE_PX;
        canvas.height = TILE_PX;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        t = { canvas, ctx, ox: 0, oy: 0 };
    }
    return t;
}

function recycleTileCanvas(t) {
    t.ctx.setTransform(1, 0, 0, 1, 0, 0);
    t.ctx.globalAlpha = 1;
    t.ctx.clearRect(0, 0, TILE_PX, TILE_PX);
    if (tilePool.length < MAX_TILE_POOL) {
        tilePool.push(t);
    } else {
        t.canvas.width = 0;
        t.canvas.height = 0;
    }
}

function releaseTiles(state) {
    for (const t of state.tiles.values()) {
        recycleTileCanvas(t);
        totalTiles--;
    }
    state.tiles.clear();
    liveStates.delete(state);
}

function resetBake(state) {
    releaseTiles(state);
    state.bakedUpTo = 0;
    state.bakeDisabled = false;
    resetHyst(state.hyst);
}

function releaseState(state) {
    releaseTiles(state);
    state.bakedUpTo = 0;
}

function ensureBakeParams(state, dpr, color) {
    if (state.bakeDpr !== dpr || state.bakeColor !== color) {
        resetBake(state);
        state.bakeDpr = dpr;
        state.bakeColor = color;
    }
}

function acquireStateTile(state, tx, ty) {
    if (tx < -32768 || tx > 32767 || ty < -32768 || ty > 32767) return null;
    const key = (tx + 32768) * 65536 + (ty + 32768);
    let tile = state.tiles.get(key);
    if (tile) return tile;
    tile = acquireTileCanvas();
    if (!tile) return null;
    tile.ox = (tx * TILE_PX) / state.bakeDpr;
    tile.oy = (ty * TILE_PX) / state.bakeDpr;
    tile.tx = tx;
    tile.ty = ty;
    state.tiles.set(key, tile);
    totalTiles++;
    liveStates.add(state);
    return tile;
}

function enforceTileBudget(current) {
    if (totalTiles <= MAX_CACHED_TILES) return;
    for (const st of liveStates) {
        if (st === current) continue;
        resetBake(st);
        if (totalTiles <= MAX_CACHED_TILES) return;
    }
    if (totalTiles > MAX_CACHED_TILES * 2) {
        releaseTiles(current);
        current.bakedUpTo = 0;
        resetHyst(current.hyst);
        current.bakeDisabled = true;
    }
}

/**
 * Pinta el segmento ya preparado en S dentro de los tiles que toca su bbox a globalAlpha = 1.0 (idempotente).
 */
function paintToTiles(state, entry, m, segBase) {
    if (!hasDocument()) return false;
    const dpr = state.bakeDpr;

    const tx0 = Math.floor((S.minX * dpr - 1) / TILE_PX);
    const tx1 = Math.floor((S.maxX * dpr + 1) / TILE_PX);
    const ty0 = Math.floor((S.minY * dpr - 1) / TILE_PX);
    const ty1 = Math.floor((S.maxY * dpr + 1) / TILE_PX);

    const usePath2D = typeof Path2D !== 'undefined';
    let paths = null;
    if (usePath2D) {
        paths = new Array(ATLAS_LEVELS + 1).fill(null);
        for (let k = 1; k <= ATLAS_LEVELS; k++) {
            if (!S.levelUsed[k]) continue;
            const p = new Path2D();
            traceLevel(p, k, m, segBase, false);
            paths[k] = p;
        }
    }

    for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
            const tile = acquireStateTile(state, tx, ty);
            if (!tile) return false;
            const c = tile.ctx;
            c.setTransform(dpr, 0, 0, dpr, -tx * TILE_PX, -ty * TILE_PX);
            c.globalAlpha = 1.0; // Idempotencia binaria dentro del tile del trazo

            for (let k = 1; k <= ATLAS_LEVELS; k++) {
                if (!S.levelUsed[k]) continue;
                const pat = getAtlasPattern(entry, k, c);
                applyPatternShift(pat, dpr, state.shift);
                c.fillStyle = pat || state.bakeColor;
                if (paths) {
                    c.fill(paths[k], 'nonzero');
                } else {
                    c.beginPath();
                    traceLevel(c, k, m, segBase, false);
                    c.fill('nonzero');
                }
            }
        }
    }
    return true;
}

/**
 * Hornea los pasos confirmados nuevos en chunks. Costo O(pasos nuevos).
 */
function bakeIncremental(state, entry) {
    const conf = state.confirmed;
    while (!state.bakeDisabled && conf.count - state.bakedUpTo >= MIN_CHUNK_STEPS) {
        const from = state.bakedUpTo;
        const to = Math.min(conf.count, from + MAX_CHUNK_STEPS);
        const g0 = from > 0 ? from - 1 : 0;

        const m = assemble(state, g0, to);
        computeLevels(m, from > 0, state.hyst);
        buildGeometry(m, g0, state.seed, state.baseWidth);
        collectRuns(m);

        if (!paintToTiles(state, entry, m, g0)) {
            releaseTiles(state);
            state.bakedUpTo = 0;
            resetHyst(state.hyst);
            state.bakeDisabled = true;
            return;
        }
        state.bakedUpTo = to;
        enforceTileBudget(state);
    }
}

// ───────────────────────────── Canvas ─────────────────────────────

const liveHyst = createHyst();

function dotLevel(p) {
    return Math.max(3, Math.min(ATLAS_LEVELS, Math.round(ATLAS_LEVELS * p * 0.85)));
}

function drawDot(ctx, entry, color, opacity, dpr, x, y, p, baseWidth, shift) {
    const k = dotLevel(p);
    const pat = getAtlasPattern(entry, k, ctx);
    applyPatternShift(pat, dpr, shift);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = pat || color;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.8, baseWidth * (0.4 + 0.5 * p)), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

export function renderCanvas(ctx, points, style) {
    if (!points || points.length === 0) return;
    const st = style || {};

    const baseWidth = Math.max(1, st.width || 3);
    const color = st.color || '#2b2b2b';
    const opacity = st.opacity !== undefined ? st.opacity : 0.90;
    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;

    const seed = getStrokeSeed(points, st);
    const entry = getOrCreateGrainAtlas(ctx, color, dpr);

    if (points.length === 1) {
        drawDot(ctx, entry, color, opacity, dpr, points[0].x, points[0].y, pressureOf(points[0]), baseWidth, getStrokePatternShift(seed));
        return;
    }

    const state = getState(points, st, baseWidth, seed);
    advanceConditioning(state, points);

    const conf = state.confirmed;
    const total = conf.count + state.tail.count;
    if (total < 2) {
        drawDot(ctx, entry, color, opacity, dpr, conf.x[0], conf.y[0], conf.p[0], baseWidth, state.shift);
        return;
    }

    ensureBakeParams(state, dpr, color);
    if (!state.bakeDisabled) bakeIncremental(state, entry);

    ctx.save();
    ctx.globalAlpha = opacity;

    // 1. Volcar los tiles horneados aplicando la opacidad del trazo una única vez
    if (state.tiles.size > 0) {
        liveStates.delete(state);
        liveStates.add(state); // LRU
        const size = TILE_PX / dpr;
        const vp = st.viewport;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        for (const t of state.tiles.values()) {
            if (vp && (t.ox > vp.x + vp.width || t.ox + size < vp.x || t.oy > vp.y + vp.height || t.oy + size < vp.y)) continue;
            ctx.drawImage(t.canvas, t.ox, t.oy, size, size);
        }
        ctx.restore();
    }

    // 2. Cola viva: desde el último paso horneado (ancla) hasta el final
    const g0 = state.bakedUpTo > 0 ? state.bakedUpTo - 1 : 0;
    const m = assemble(state, g0, total);
    copyHyst(liveHyst, state.hyst);
    computeLevels(m, state.bakedUpTo > 0, liveHyst);
    buildGeometry(m, g0, seed, baseWidth);
    collectRuns(m);

    for (let k = 1; k <= ATLAS_LEVELS; k++) {
        if (!S.levelUsed[k]) continue;
        const pat = getAtlasPattern(entry, k, ctx);
        applyPatternShift(pat, dpr, state.shift);
        ctx.fillStyle = pat || color;
        ctx.beginPath();
        traceLevel(ctx, k, m, g0, true);
        ctx.fill('nonzero');
    }

    ctx.restore();
}

export const renderPen = renderCanvas;

/**
 * Libera los tiles (y el estado) de un trazo. Llamado por optimized-engine al hornear el sprite.
 */
export function releasePencilStroke(ref) {
    let state = null;
    if (ref && typeof ref === 'object') {
        state = stateByPoints.get(ref);
        stateByPoints.delete(ref);
    } else if (ref !== undefined && ref !== null) {
        state = stateById.get(ref);
        stateById.delete(ref);
    }
    if (state) releaseState(state);
}

export function resetPencilAtlasCacheForTesting() {
    paperHeightField = null;
    atlasCache.clear();
    latticeCache.clear();
    for (const st of Array.from(liveStates)) releaseState(st);
    liveStates.clear();
    stateById.clear();
    stateByPoints = new WeakMap();
    totalTiles = 0;
}

// ───────────────────────────── SVG ─────────────────────────────

const TMP = { cap: 0, lx: null, ly: null, rx: null, ry: null, kl: null, kr: null };

function ensureTemp(n) {
    if (n <= TMP.cap) return;
    let cap = Math.max(256, TMP.cap);
    while (cap < n) cap *= 2;
    TMP.cap = cap;
    TMP.lx = new Float64Array(cap);
    TMP.ly = new Float64Array(cap);
    TMP.rx = new Float64Array(cap);
    TMP.ry = new Float64Array(cap);
    TMP.kl = new Uint8Array(cap);
    TMP.kr = new Uint8Array(cap);
}

/**
 * Ramer-Douglas-Peucker iterativo: marca en `keep` los vértices que se conservan.
 */
function rdpKeep(xs, ys, n, tol, keep) {
    keep.fill(0, 0, n);
    keep[0] = 1;
    keep[n - 1] = 1;
    if (n < 3) return;

    const stack = [0, n - 1];
    while (stack.length) {
        const b = stack.pop();
        const a = stack.pop();
        if (b - a < 2) continue;

        const ax = xs[a], ay = ys[a];
        const dx = xs[b] - ax, dy = ys[b] - ay;
        const len = Math.hypot(dx, dy);

        let maxD = -1;
        let idx = -1;
        for (let i = a + 1; i < b; i++) {
            const d = len < 1e-9
                ? Math.hypot(xs[i] - ax, ys[i] - ay)
                : Math.abs((xs[i] - ax) * dy - (ys[i] - ay) * dx) / len;
            if (d > maxD) { maxD = d; idx = i; }
        }
        if (maxD > tol) {
            keep[idx] = 1;
            stack.push(a, idx, idx, b);
        }
    }
}

function svgRunD(r, m) {
    const t = S.runT[r];
    const a = S.runA[r];
    const b = S.runB[r];
    const n = b - a + 1;
    ensureTemp(n);

    let sx = 0, sy = 0, ex = 0, ey = 0;
    if (a > 0) {
        sx = -SEAM_OVERLAP * S.ny[a];
        sy = SEAM_OVERLAP * S.nx[a];
    }
    if (b < m - 1) {
        ex = SEAM_OVERLAP * S.ny[b];
        ey = -SEAM_OVERLAP * S.nx[b];
    }

    const LX = S.LX[t], LY = S.LY[t], RX = S.RX[t], RY = S.RY[t];
    for (let j = 0; j < n; j++) {
        const g = a + j;
        let lx = LX[g], ly = LY[g], rx = RX[g], ry = RY[g];
        if (j === 0) { lx += sx; ly += sy; rx += sx; ry += sy; }
        if (j === n - 1) { lx += ex; ly += ey; rx += ex; ry += ey; }
        TMP.lx[j] = lx; TMP.ly[j] = ly;
        TMP.rx[n - 1 - j] = rx; TMP.ry[n - 1 - j] = ry;
    }

    rdpKeep(TMP.lx, TMP.ly, n, SVG_RAIL_TOLERANCE, TMP.kl);
    rdpKeep(TMP.rx, TMP.ry, n, SVG_RAIL_TOLERANCE, TMP.kr);

    let qx = Math.round(TMP.lx[0] * 10);
    let qy = Math.round(TMP.ly[0] * 10);
    const d = 'M' + (qx / 10) + ' ' + (qy / 10);
    let rel = '';

    const emit = (x, y) => {
        const nqx = Math.round(x * 10);
        const nqy = Math.round(y * 10);
        const dx = nqx - qx;
        const dy = nqy - qy;
        if (dx === 0 && dy === 0) return;
        rel += (rel ? ' ' : '') + (dx / 10) + ' ' + (dy / 10);
        qx = nqx;
        qy = nqy;
    };

    for (let i = 1; i < n; i++) if (TMP.kl[i]) emit(TMP.lx[i], TMP.ly[i]);
    for (let i = 0; i < n; i++) if (TMP.kr[i]) emit(TMP.rx[i], TMP.ry[i]);

    return d + (rel ? 'l' + rel : '') + 'z';
}

export function renderSvg(points, style) {
    if (!points || points.length === 0) return { defs: {}, body: '' };
    const st = style || {};

    const baseWidth = Math.max(1, st.width || 3);
    const color = st.color || '#2b2b2b';
    const opacity = st.opacity !== undefined ? st.opacity : 0.90;
    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;

    const seed = getStrokeSeed(points, st);
    const entry = getOrCreateGrainAtlas(null, color, dpr);
    const shift = getStrokePatternShift(seed);

    const colorSlug = color.replace(/[^a-zA-Z0-9]/g, '');
    const tileCssSize = Math.round((PAPER_SIZE / dpr) * 100) / 100;
    const f = (n) => (Math.round(n * 10) / 10).toString();

    const defs = {};
    const shiftSuffix = ENABLE_SHADING_BUILDUP ? `-s${shift.shiftX}_${shift.shiftY}` : '';
    const patternTransformAttr = ENABLE_SHADING_BUILDUP
        ? ` patternTransform="translate(${shift.shiftX} ${shift.shiftY})"`
        : '';

    const registerPatternDef = (k) => {
        const patId = `apolo-grain-${colorSlug}-k${k}${shiftSuffix}`;
        const href = getAtlasDataUrl(entry, k);
        if (href && !defs[patId]) {
            defs[patId] =
                `<pattern id="${patId}" patternUnits="userSpaceOnUse" width="${tileCssSize}" height="${tileCssSize}"${patternTransformAttr}>` +
                `<image href="${href}" width="${tileCssSize}" height="${tileCssSize}" image-rendering="pixelated"/>` +
                `</pattern>`;
        }
        return href ? `url(#${patId})` : color;
    };

    const dotSvg = (x, y, p) => {
        const k = dotLevel(p);
        const fillRef = registerPatternDef(k);
        const r = Math.max(0.8, baseWidth * (0.4 + 0.5 * p));
        return {
            defs,
            body: `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${fillRef}" opacity="${opacity.toFixed(2)}"/>`,
        };
    };

    if (points.length === 1) {
        return dotSvg(points[0].x, points[0].y, pressureOf(points[0]));
    }

    const state = getState(points, st, baseWidth, seed);
    advanceConditioning(state, points);
    const total = state.confirmed.count + state.tail.count;
    if (total < 2) {
        return dotSvg(state.confirmed.x[0], state.confirmed.y[0], state.confirmed.p[0]);
    }

    const m = assemble(state, 0, total);
    const hyst = createHyst();
    computeLevels(m, false, hyst);
    buildGeometry(m, 0, seed, baseWidth);
    collectRuns(m);

    let pathsHtml = '';
    for (let k = 1; k <= ATLAS_LEVELS; k++) {
        if (!S.levelUsed[k]) continue;
        let d = '';
        for (let r = 0; r < S.runCount; r++) {
            if (S.runK[r] === k) d += svgRunD(r, m);
        }
        if (!d) continue;
        pathsHtml += `<path d="${d}" fill="${registerPatternDef(k)}"/>`;
    }

    // Usamos `opacity` a nivel de <g> (grupo aislado) en vez de `fill-opacity` heredado por path,
    // logrando paridad exacta con el volcado de tiles a globalAlpha = opacity en Canvas.
    const body = `<g fill-rule="nonzero" opacity="${opacity.toFixed(2)}" stroke="none">${pathsHtml}</g>`;
    return { defs, body };
}

// ───────────────────────────── Registro global ─────────────────────────────

if (typeof globalThis !== 'undefined') {
    globalThis.ApoloSandbox = globalThis.ApoloSandbox || { pens: {}, engines: {} };
    globalThis.ApoloSandbox.pens['pencil-atlas'] = {
        id,
        name,
        description,
        renderPen,
        renderCanvas,
        renderSvg,
        releasePencilStroke,
        prewarmPencilAtlas,
        getPaperHeightField,
        getOrCreateGrainAtlas,
        getAtlasPattern,
        getAtlasDataUrl,
        conditionStrokeByArcLength,
        buildLevelRuns,
    };
}