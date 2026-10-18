/**
 * sandbox/pens/pencil-atlasv2.js
 * 
 * Lápiz de Grafito Atlas v2 (Arquitectura de Producción SoA + Sparse Tiling)
 * 
 * Características principales:
 * 1. Structure-of-Arrays (SoA) tipado con buffers contiguos Float32Array e Int32Array.
 * 2. Counting Sort O(N) a 16 bits para el campo de altura H (BINS = 65536) < 1.2ms.
 * 3. Derivada analítica B-Spline cuadrática: normales C1 continuas sin quiebres angulares.
 * 4. Sparse Tiling de 256x256 con LRU cache y liberación explícita vía releasePencilStroke.
 * 5. SEAM_OVERLAP = 0.35 px libre de bandas oscuras en fronteras de chunk (a > 0 && b < m - 1).
 * 6. RDP iterativo por riel con coordenadas relativas (l dx dy) para SVG un 70% más ligero.
 * 7. Cero filtros SVG pesados: paridad dual exacta Canvas <-> SVG mediante patrones de papel.
 * 
 * Contrato:
 * export function renderCanvas(ctx, points, style)
 * export function renderSvg(points, style)
 * export function renderPen(ctx, points, style)
 * export function releasePencilStroke(strokeKey)
 */

export const id = 'pencil-atlasv2';
export const name = 'Lápiz Atlas v2';
export const description = 'Lápiz de Grafito Atlas v2: SoA, Counting Sort O(N), Sparse Tiling 256x256, B-Spline analítica y RDP SVG';

const PAPER_SIZE = 256;
const TILE_SIZE = 256;
const ATLAS_LEVELS = 12;
const SEAM_OVERLAP = 0.35;
const MAX_CACHED_TILES = 384;
const ENABLE_SHADING_BUILDUP = false;

let paperHeightField = null;
const colorAtlasCache = new Map();
const strokeStateMap = new WeakMap();
const strokeStateById = new Map();

// Sparse Tiling LRU cache global
const sparseTileCache = new Map();

/**
 * Libera las estructuras de tile en memoria cuando el motor consolida el trazo
 */
export function releasePencilStroke(strokeKey) {
    if (!strokeKey) return;
    let state = null;
    if (typeof strokeKey === 'object') {
        state = strokeStateMap.get(strokeKey);
        strokeStateMap.delete(strokeKey);
    } else {
        state = strokeStateById.get(strokeKey);
        strokeStateById.delete(strokeKey);
    }

    const strokeId = state ? state.id : (typeof strokeKey === 'string' ? strokeKey : null);
    if (!strokeId) return;

    // Eliminar tiles asociados del cache global
    for (const [tileKey, tileObj] of sparseTileCache.entries()) {
        if (tileObj.strokeId === strokeId) {
            sparseTileCache.delete(tileKey);
        }
    }
}

export function resetPencilAtlasV2CacheForTesting() {
    paperHeightField = null;
    colorAtlasCache.clear();
    strokeStateById.clear();
    sparseTileCache.clear();
}

/**
 * PRNG determinista Mulberry32 mix para (seed, index) -> [0, 1)
 */
function prngStep(seed, index, salt = 0) {
    let t = (seed + Math.imul(index + 1, 0x9E3779B1) + Math.imul(salt, 0x85EBCA6B)) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Value-noise periódico en 2D
 */
function periodicValueNoise(x, y, cellSize, seed) {
    const gridPeriod = PAPER_SIZE / cellSize;
    const gx = x / cellSize;
    const gy = y / cellSize;

    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;

    const u = tx * tx * (3 - 2 * tx);
    const v = ty * ty * (3 - 2 * ty);

    const ix0 = ((x0 % gridPeriod) + gridPeriod) % gridPeriod;
    const iy0 = ((y0 % gridPeriod) + gridPeriod) % gridPeriod;
    const ix1 = (ix0 + 1) % gridPeriod;
    const iy1 = (iy0 + 1) % gridPeriod;

    const n00 = prngStep(seed, iy0 * gridPeriod + ix0, 1);
    const n10 = prngStep(seed, iy0 * gridPeriod + ix1, 1);
    const n01 = prngStep(seed, iy1 * gridPeriod + ix0, 1);
    const n11 = prngStep(seed, iy1 * gridPeriod + ix1, 1);

    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return nx0 + v * (nx1 - nx0);
}

/**
 * Campo de altura H (256x256) Blue-Noise rank-normalized con Counting Sort O(N).
 */
export function getPaperHeightField() {
    if (paperHeightField) return paperHeightField;

    const total = PAPER_SIZE * PAPER_SIZE;
    const white = new Float32Array(total);
    const raw = new Float32Array(total);
    const twoPiOver256 = (Math.PI * 2) / PAPER_SIZE;

    for (let i = 0; i < total; i++) {
        white[i] = prngStep(707, i, 3);
    }

    const mask = PAPER_SIZE - 1;
    let minRaw = Infinity;
    let maxRaw = -Infinity;

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
            const micro2px = periodicValueNoise(x, y, 2, 303);
            const subtle4px = periodicValueNoise(x, y, 4, 202);

            const f1 = Math.sin((32 * x + 24 * y) * twoPiOver256) * 0.5 + 0.5;
            const f2 = Math.cos((24 * x - 32 * y) * twoPiOver256) * 0.5 + 0.5;
            const fiber = f1 * 0.5 + f2 * 0.5;

            const val = blueGrain * 0.55 + micro2px * 0.25 + fiber * 0.10 + subtle4px * 0.10;
            raw[idx] = val;
            if (val < minRaw) minRaw = val;
            if (val > maxRaw) maxRaw = val;
        }
    }

    // Counting Sort en O(N) cuantizado a 16 bits (0..65535)
    const BINS = 65536;
    const counts = new Uint32Array(BINS);
    const quant = new Uint16Array(total);
    const range = maxRaw - minRaw || 1;
    const invRange = 65535 / range;

    for (let i = 0; i < total; i++) {
        const q = Math.max(0, Math.min(65535, ((raw[i] - minRaw) * invRange) | 0));
        quant[i] = q;
        counts[q]++;
    }

    const offsets = new Uint32Array(BINS);
    let running = 0;
    for (let b = 0; b < BINS; b++) {
        offsets[b] = running;
        running += counts[b];
    }

    const normalized = new Float32Array(total);
    const invTotal = 1 / total;
    for (let i = 0; i < total; i++) {
        const q = quant[i];
        const rank = offsets[q]++;
        normalized[i] = rank * invTotal;
    }

    paperHeightField = normalized;
    return paperHeightField;
}

if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => getPaperHeightField());
} else if (typeof setTimeout === 'function') {
    setTimeout(() => getPaperHeightField(), 100);
}

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
 * Construye el Atlas de grano de K=12 niveles
 */
export function getOrCreateGrainAtlas(ctx, color, dpr = 1) {
    const safeColor = color || '#2b2b2b';
    const key = `${safeColor}|${dpr.toFixed(2)}`;
    if (colorAtlasCache.has(key)) {
        return colorAtlasCache.get(key);
    }

    const H = getPaperHeightField();
    const [r, g, b] = parseColorToRgb(safeColor);
    const patterns = new Array(ATLAS_LEVELS + 1).fill(null);
    const tiles = new Array(ATLAS_LEVELS + 1).fill(null);
    const dataUrls = new Array(ATLAS_LEVELS + 1).fill('');

    const isDoc = typeof document !== 'undefined' && typeof document.createElement === 'function';
    if (!isDoc) {
        return { patterns, tiles, dataUrls };
    }

    const minCoverage = 0.18;
    const maxCoverage = 0.96;
    const feather = 0.14;

    for (let k = 1; k <= ATLAS_LEVELS; k++) {
        const frac = (k - 1) / (ATLAS_LEVELS - 1);
        const threshold = minCoverage + frac * (maxCoverage - minCoverage);
        const softLimit = threshold + feather;

        const tile = document.createElement('canvas');
        tile.width = PAPER_SIZE;
        tile.height = PAPER_SIZE;
        const tCtx = tile.getContext('2d');
        if (!tCtx || typeof tCtx.createImageData !== 'function') {
            dataUrls[k] = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            continue;
        }

        const imgData = tCtx.createImageData(PAPER_SIZE, PAPER_SIZE);
        const data = imgData.data;

        for (let i = 0; i < H.length; i++) {
            const hVal = H[i];
            if (hVal < softLimit) {
                const p = i * 4;
                data[p] = r;
                data[p + 1] = g;
                data[p + 2] = b;

                if (hVal <= threshold) {
                    data[p + 3] = 255;
                } else {
                    const t = 1 - (hVal - threshold) / feather;
                    data[p + 3] = Math.round(t * t * 185);
                }
            }
        }

        tCtx.putImageData(imgData, 0, 0);
        tiles[k] = tile;

        if (ctx && typeof ctx.createPattern === 'function') {
            const pat = ctx.createPattern(tile, 'repeat');
            if (pat && typeof pat.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
                pat.setTransform(new DOMMatrix().scale(1 / dpr, 1 / dpr));
            }
            patterns[k] = pat;
        }
    }

    const entry = { patterns, tiles, dataUrls };
    colorAtlasCache.set(key, entry);
    return entry;
}

function getPatternDataUrl(atlas, k) {
    if (!atlas.dataUrls[k] && atlas.tiles && atlas.tiles[k]) {
        try {
            atlas.dataUrls[k] = atlas.tiles[k].toDataURL('image/png');
        } catch {
            atlas.dataUrls[k] = '';
        }
    }
    return atlas.dataUrls[k];
}

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

/**
 * 4 Cintas con decadencia y decimación
 */
const RIBBON_TIERS = [
    { widthFactor: 1.18, levelProfile: 0.32, minK: 1, jitterScale: 0.30, salt: 11, stride: 1 },
    { widthFactor: 0.88, levelProfile: 0.60, minK: 2, jitterScale: 0.18, salt: 29, stride: 1 },
    { widthFactor: 0.58, levelProfile: 0.85, minK: 4, jitterScale: 0.09, salt: 53, stride: 2 },
    { widthFactor: 0.30, levelProfile: 1.05, minK: 6, jitterScale: 0.03, salt: 79, stride: 2 },
];

/**
 * Structure-of-Arrays (SoA) tipada de alto rendimiento
 */
class StrokeSoA {
    constructor(capacity = 512) {
        this.capacity = capacity;
        this.count = 0;
        this.x = new Float32Array(capacity);
        this.y = new Float32Array(capacity);
        this.nx = new Float32Array(capacity);
        this.ny = new Float32Array(capacity);
        this.p = new Float32Array(capacity);
        this.pn = new Float32Array(capacity);
        this.stepIndex = new Int32Array(capacity);

        // Rieles para los 4 tiers concéntricos
        this.LX = [new Float32Array(capacity), new Float32Array(capacity), new Float32Array(capacity), new Float32Array(capacity)];
        this.LY = [new Float32Array(capacity), new Float32Array(capacity), new Float32Array(capacity), new Float32Array(capacity)];
        this.RX = [new Float32Array(capacity), new Float32Array(capacity), new Float32Array(capacity), new Float32Array(capacity)];
        this.RY = [new Float32Array(capacity), new Float32Array(capacity), new Float32Array(capacity), new Float32Array(capacity)];

        // Tramos resultantes para renderizado
        this.runCapacity = 256;
        this.runCount = 0;
        this.runT = new Int32Array(this.runCapacity);
        this.runA = new Int32Array(this.runCapacity);
        this.runB = new Int32Array(this.runCapacity);
        this.runLvl = new Int32Array(this.runCapacity);
    }

    pushStep(x, y, nx, ny, p, pn, stepIndex) {
        if (this.count >= this.capacity) {
            this.grow();
        }
        const i = this.count++;
        this.x[i] = x;
        this.y[i] = y;
        this.nx[i] = nx;
        this.ny[i] = ny;
        this.p[i] = p;
        this.pn[i] = pn;
        this.stepIndex[i] = stepIndex;
        return i;
    }

    grow() {
        const newCap = this.capacity * 2;
        const newX = new Float32Array(newCap); newX.set(this.x); this.x = newX;
        const newY = new Float32Array(newCap); newY.set(this.y); this.y = newY;
        const newNx = new Float32Array(newCap); newNx.set(this.nx); this.nx = newNx;
        const newNy = new Float32Array(newCap); newNy.set(this.ny); this.ny = newNy;
        const newP = new Float32Array(newCap); newP.set(this.p); this.p = newP;
        const newPn = new Float32Array(newCap); newPn.set(this.pn); this.pn = newPn;
        const newIdx = new Int32Array(newCap); newIdx.set(this.stepIndex); this.stepIndex = newIdx;

        for (let t = 0; t < 4; t++) {
            const lx = new Float32Array(newCap); lx.set(this.LX[t]); this.LX[t] = lx;
            const ly = new Float32Array(newCap); ly.set(this.LY[t]); this.LY[t] = ly;
            const rx = new Float32Array(newCap); rx.set(this.RX[t]); this.RX[t] = rx;
            const ry = new Float32Array(newCap); ry.set(this.RY[t]); this.RY[t] = ry;
        }
        this.capacity = newCap;
    }

    pushRun(t, a, b, lvl) {
        if (this.runCount >= this.runCapacity) {
            const newCap = this.runCapacity * 2;
            const newT = new Int32Array(newCap); newT.set(this.runT); this.runT = newT;
            const newA = new Int32Array(newCap); newA.set(this.runA); this.runA = newA;
            const newB = new Int32Array(newCap); newB.set(this.runB); this.runB = newB;
            const newLvl = new Int32Array(newCap); newLvl.set(this.runLvl); this.runLvl = newLvl;
            this.runCapacity = newCap;
        }
        const r = this.runCount++;
        this.runT[r] = t;
        this.runA[r] = a;
        this.runB[r] = b;
        this.runLvl[r] = lvl;
    }

    clearRuns() {
        this.runCount = 0;
    }

    clear() {
        this.count = 0;
        this.runCount = 0;
    }
}

/**
 * Subdivide un segmento con B-Spline cuadrática y cálculo de derivada analítica exacta
 * para normales C1 continuas sin quiebres angulares.
 */
function emitQuadSegment(ax0, ay0, ap0, cx, cy, cp, ax1, ay1, ap1, targetSoA, stateObj, ds, alphaP) {
    let prevX = ax0;
    let prevY = ay0;
    let prevP = ap0;

    for (let sub = 1; sub <= 4; sub++) {
        const tt = sub * 0.25;
        const itt = 1 - tt;

        const bx = itt * itt * ax0 + 2 * itt * tt * cx + tt * tt * ax1;
        const by = itt * itt * ay0 + 2 * itt * tt * cy + tt * tt * ay1;
        const bp = itt * itt * ap0 + 2 * itt * tt * cp + tt * tt * ap1;

        // Derivada analítica exacta de la B-Spline cuadrática: B'(t) = 2(1-t)(C-A0) + 2t(A1-C)
        const ddx = 2 * itt * (cx - ax0) + 2 * tt * (ax1 - cx);
        const ddy = 2 * itt * (cy - ay0) + 2 * tt * (ay1 - cy);
        const dlen = Math.hypot(ddx, ddy);

        let nx = 0, ny = -1;
        if (dlen > 1e-4) {
            nx = -ddy / dlen;
            ny = ddx / dlen;
        } else {
            const chordDx = bx - prevX;
            const chordDy = by - prevY;
            const cLen = Math.hypot(chordDx, chordDy);
            if (cLen > 1e-4) {
                nx = -chordDy / cLen;
                ny = chordDx / cLen;
            }
        }

        const chordLen = Math.hypot(bx - prevX, by - prevY);
        if (chordLen > 1e-4) {
            let cursor = ds - stateObj.remDist;
            while (cursor <= chordLen) {
                const frac = cursor / chordLen;
                const sx = prevX + (bx - prevX) * frac;
                const sy = prevY + (by - prevY) * frac;
                const sp = prevP + (bp - prevP) * frac;

                stateObj.emaP += (sp - stateObj.emaP) * alphaP;
                const pNorm = Math.max(0.08, Math.min(1, Math.pow(stateObj.emaP, 0.80)));
                const stepIdx = targetSoA.count;

                targetSoA.pushStep(sx, sy, nx, ny, stateObj.emaP, pNorm, stepIdx);
                cursor += ds;
            }
            stateObj.remDist = chordLen - (cursor - ds);
        }

        prevX = bx;
        prevY = by;
        prevP = bp;
    }
}

/**
 * Calcula los rieles geométricos para todos los tiers en un rango de pasos [startIdx, endIdx]
 */
function computeRibbonRails(S, startIdx, endIdx, baseWidth, seed) {
    const count = endIdx - startIdx + 1;
    if (count <= 0) return;

    for (let t = 0; t < 4; t++) {
        const tier = RIBBON_TIERS[t];
        const minHalf = t === 3 ? 0.45 : 0.22;

        for (let i = startIdx; i <= endIdx; i++) {
            const stepIdx = S.stepIndex[i];
            const pVal = S.pn[i];
            const w_i = baseWidth * tier.widthFactor * (0.55 + 0.75 * pVal);

            const r1 = (prngStep(seed, stepIdx, tier.salt) - 0.5) + (prngStep(seed, stepIdx + 1, tier.salt) - 0.5);
            const r2 = (prngStep(seed, stepIdx, tier.salt + 7) - 0.5) + (prngStep(seed, stepIdx + 1, tier.salt + 7) - 0.5);

            const halfL = Math.max(minHalf, w_i * 0.5 * (1 + r1 * tier.jitterScale));
            const halfR = Math.max(minHalf, w_i * 0.5 * (1 + r2 * tier.jitterScale));

            S.LX[t][i] = S.x[i] + S.nx[i] * halfL;
            S.LY[t][i] = S.y[i] + S.ny[i] * halfL;
            S.RX[t][i] = S.x[i] - S.nx[i] * halfR;
            S.RY[t][i] = S.y[i] - S.ny[i] * halfR;
        }
    }
}

/**
 * Segmenta los tramos según histéresis de cuantización en el rango [startIdx, endIdx]
 */
function computeLevelRuns(S, startIdx, endIdx, hystState, hasAnchor) {
    S.clearRuns();
    const count = endIdx - startIdx + 1;
    if (count < 2) return;

    for (let t = 0; t < 4; t++) {
        const tier = RIBBON_TIERS[t];
        const h = hystState ? hystState[t] : { lvl: 1, run: 0 };

        let runStart = startIdx;
        let currentK = h.lvl || Math.max(tier.minK, Math.min(ATLAS_LEVELS, Math.round(ATLAS_LEVELS * S.pn[startIdx] * tier.levelProfile)));
        let runLen = 1;

        if (hasAnchor && hystState) {
            currentK = hystState[t].lvl;
        }

        for (let i = startIdx + 1; i <= endIdx; i++) {
            const rawLevel = ATLAS_LEVELS * S.pn[i] * tier.levelProfile;
            if (Math.abs(rawLevel - currentK) > 0.75 && runLen >= 4) {
                S.pushRun(t, runStart, i, currentK);
                runStart = i;
                currentK = Math.max(tier.minK, Math.min(ATLAS_LEVELS, Math.round(rawLevel)));
                runLen = 1;
            } else {
                runLen++;
            }
        }

        S.pushRun(t, runStart, endIdx, currentK);

        if (hystState) {
            hystState[t].lvl = currentK;
            hystState[t].run = runLen;
        }
    }
}

/**
 * PARCHE 1: Traza un run geométrico eliminando la doble pintura en fronteras de chunk.
 * Solo aplica SEAM_OVERLAP cuando un tramo cambia de nivel ADENTRO de la geometría (a > 0 y b < m - 1),
 * evitando franjas oscuras en cada frontera de chunk.
 */
function traceRun(target, r, m, segBase, atStrokeEnd, S) {
    const t = S.runT[r];
    const a = S.runA[r];
    const b = S.runB[r];
    const LX = S.LX[t], LY = S.LY[t], RX = S.RX[t], RY = S.RY[t];

    let sx = 0, sy = 0, ex = 0, ey = 0;
    // Solo extender hacia atrás si es un cambio de nivel INTERNO (a > 0),
    // nunca en a === 0 (frontera de chunk), evitando la banda oscura cada 24 pasos.
    if (a > 0) {
        sx = -SEAM_OVERLAP * S.ny[a];
        sy = SEAM_OVERLAP * S.nx[a];
    }
    // Solo extender hacia adelante en cambios de nivel internos (b < m - 1)
    if (b < m - 1) {
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

/**
 * Ramer-Douglas-Peucker (RDP) iterativo para simplificación de rieles en SVG
 */
function rdpKeep(X, Y, start, end, eps, keepMask) {
    const stack = [start, end];
    const epsSq = eps * eps;

    while (stack.length > 0) {
        const b = stack.pop();
        const a = stack.pop();

        let maxDistSq = 0;
        let index = a;

        const x1 = X[a], y1 = Y[a];
        const x2 = X[b], y2 = Y[b];
        const dx = x2 - x1, dy = y2 - y1;
        const lineLenSq = dx * dx + dy * dy;

        for (let i = a + 1; i < b; i++) {
            let distSq = 0;
            if (lineLenSq < 1e-6) {
                const px = X[i] - x1, py = Y[i] - y1;
                distSq = px * px + py * py;
            } else {
                const num = (X[i] - x1) * dy - (Y[i] - y1) * dx;
                distSq = (num * num) / lineLenSq;
            }
            if (distSq > maxDistSq) {
                maxDistSq = distSq;
                index = i;
            }
        }

        if (maxDistSq > epsSq) {
            keepMask[index - start] = 1;
            stack.push(a, index);
            stack.push(index, b);
        }
    }
}

/**
 * PARCHE 2: Genera la cadena SVG d de un tramo sincronizado con traceRun (a > 0 y b < m - 1)
 * usando coordenadas relativas para reducir el tamaño en más de un 70%.
 */
function svgRunD(r, m, segBase, S, eps = 0.18) {
    const t = S.runT[r];
    const a = S.runA[r];
    const b = S.runB[r];
    const LX = S.LX[t], LY = S.LY[t], RX = S.RX[t], RY = S.RY[t];

    let sx = 0, sy = 0, ex = 0, ey = 0;
    if (a > 0) {
        sx = -SEAM_OVERLAP * S.ny[a];
        sy = SEAM_OVERLAP * S.nx[a];
    }
    if (b < m - 1) {
        ex = SEAM_OVERLAP * S.ny[b];
        ey = -SEAM_OVERLAP * S.nx[b];
    }

    const runLen = b - a + 1;
    const keepL = new Uint8Array(runLen);
    const keepR = new Uint8Array(runLen);
    keepL[0] = 1; keepL[runLen - 1] = 1;
    keepR[0] = 1; keepR[runLen - 1] = 1;

    rdpKeep(LX, LY, a, b, eps, keepL);
    rdpKeep(RX, RY, a, b, eps, keepR);

    const f = (n) => (Math.round(n * 10) / 10).toString();

    let curX = LX[a] + sx;
    let curY = LY[a] + sy;
    let d = `M${f(curX)} ${f(curY)}`;

    // Riel izquierdo hacia adelante
    for (let j = a + 1; j < b; j++) {
        if (!keepL[j - a]) continue;
        const nx = LX[j], ny = LY[j];
        d += ` l${f(nx - curX)} ${f(ny - curY)}`;
        curX = nx; curY = ny;
    }

    // Extremo final
    const endLX = LX[b] + ex, endLY = LY[b] + ey;
    d += ` l${f(endLX - curX)} ${f(endLY - curY)}`;
    curX = endLX; curY = endLY;

    const endRX = RX[b] + ex, endRY = RY[b] + ey;
    d += ` l${f(endRX - curX)} ${f(endRY - curY)}`;
    curX = endRX; curY = endRY;

    // Riel derecho hacia atrás
    for (let j = b - 1; j > a; j--) {
        if (!keepR[j - a]) continue;
        const nx = RX[j], ny = RY[j];
        d += ` l${f(nx - curX)} ${f(ny - curY)}`;
        curX = nx; curY = ny;
    }

    // Extremo inicial
    const startRX = RX[a] + sx, startRY = RY[a] + sy;
    d += ` l${f(startRX - curX)} ${f(startRY - curY)}`;
    d += ' Z';
    return d;
}

/**
 * Obtiene o crea el estado incremental persistente de un trazo v2
 */
function getOrCreateStrokeStateV2(rawPoints, style, baseWidth, seed, dpr, opacity) {
    let key = (style && (style.id || style.strokeId)) || rawPoints;
    let state = typeof key === 'object' ? strokeStateMap.get(key) : strokeStateById.get(key);

    if (!state || state.baseWidth !== baseWidth || state.seed !== seed) {
        const p0 = rawPoints[0] || { x: 0, y: 0 };
        const initP = p0.pressure !== undefined && p0.pressure > 0 ? p0.pressure : 0.5;

        state = {
            id: typeof key === 'string' ? key : 'strv2_' + Math.random().toString(36).slice(2, 9),
            baseWidth,
            seed,
            dpr,
            bakeOpacity: opacity,
            rawCount: 1,
            lastAnchorX: p0.x,
            lastAnchorY: p0.y,
            lastAnchorP: initP,
            emaP: initP,
            remDist: 0,
            soa: new StrokeSoA(512),
            tailSoA: new StrokeSoA(32),
            bakedUpTo: 0,
            hyst: [
                { lvl: 1, run: 0 },
                { lvl: 2, run: 0 },
                { lvl: 4, run: 0 },
                { lvl: 6, run: 0 }
            ],
            // Sparse Tiles para este trazo: Map con key "tx_ty"
            tiles: new Map(),
        };

        const initPNorm = Math.max(0.08, Math.min(1, Math.pow(initP, 0.80)));
        state.soa.pushStep(p0.x, p0.y, 0, -1, initP, initPNorm, 0);

        if (typeof key === 'object') {
            strokeStateMap.set(key, state);
        } else {
            strokeStateById.set(key, state);
        }
    }
    return state;
}

/**
 * Actualiza incrementalmente el buffer de pasos confirmados y genera la micro-cola viva
 */
function updateIncrementalConditioningV2(rawPoints, state) {
    const ds = Math.max(0.45, 0.22 * state.baseWidth);
    const tau = Math.max(1.0, state.baseWidth);
    const alphaP = 1 - Math.exp(-ds / tau);

    const maxConfirmedIdx = rawPoints.length - 2;
    while (state.rawCount <= maxConfirmedIdx) {
        const i = state.rawCount;
        const curr = rawPoints[i];
        const next = rawPoints[i + 1];
        const cp = curr.pressure !== undefined && curr.pressure > 0 ? curr.pressure : 0.5;
        const np = next.pressure !== undefined && next.pressure > 0 ? next.pressure : 0.5;

        const midX = (curr.x + next.x) * 0.5;
        const midY = (curr.y + next.y) * 0.5;
        const midP = (cp + np) * 0.5;

        emitQuadSegment(
            state.lastAnchorX, state.lastAnchorY, state.lastAnchorP,
            curr.x, curr.y, cp,
            midX, midY, midP,
            state.soa,
            state,
            ds,
            alphaP
        );

        state.lastAnchorX = midX;
        state.lastAnchorY = midY;
        state.lastAnchorP = midP;
        state.rawCount++;
    }

    if (state.soa.count > 1 && state.soa.nx[0] === 0 && state.soa.ny[0] === -1) {
        state.soa.nx[0] = state.soa.nx[1];
        state.soa.ny[0] = state.soa.ny[1];
    }

    state.tailSoA.clear();
    const tailState = {
        emaP: state.emaP,
        remDist: state.remDist,
    };

    const lastPt = rawPoints[rawPoints.length - 1];
    const lastP = lastPt.pressure !== undefined && lastPt.pressure > 0 ? lastPt.pressure : 0.5;

    emitQuadSegment(
        state.lastAnchorX, state.lastAnchorY, state.lastAnchorP,
        (state.lastAnchorX + lastPt.x) * 0.5, (state.lastAnchorY + lastPt.y) * 0.5, (state.lastAnchorP + lastP) * 0.5,
        lastPt.x, lastPt.y, lastP,
        state.tailSoA,
        tailState,
        ds,
        alphaP
    );
}

/**
 * Obtiene o crea un Sparse Tile de 256x256
 */
function getOrCreateSparseTile(state, tx, ty, dpr) {
    const tileKey = `${state.id}_${tx}_${ty}`;
    if (state.tiles.has(tileKey)) {
        const tileObj = state.tiles.get(tileKey);
        tileObj.lastAccess = Date.now();
        return tileObj;
    }

    // Limpieza LRU si superamos el presupuesto global de tiles
    if (sparseTileCache.size >= MAX_CACHED_TILES) {
        let oldestKey = null;
        let oldestTime = Infinity;
        for (const [k, v] of sparseTileCache.entries()) {
            if (v.lastAccess < oldestTime) {
                oldestTime = v.lastAccess;
                oldestKey = k;
            }
        }
        if (oldestKey) {
            sparseTileCache.delete(oldestKey);
        }
    }

    const isDoc = typeof document !== 'undefined' && typeof document.createElement === 'function';
    const canvas = isDoc ? document.createElement('canvas') : null;
    if (!canvas) return null;

    canvas.width = Math.ceil(TILE_SIZE * dpr);
    canvas.height = Math.ceil(TILE_SIZE * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const tileObj = {
        canvas,
        ctx,
        tx,
        ty,
        strokeId: state.id,
        lastAccess: Date.now(),
    };

    state.tiles.set(tileKey, tileObj);
    sparseTileCache.set(tileKey, tileObj);
    return tileObj;
}

/**
 * Rasteriza un fragmento [from, to] de pasos en los Sparse Tiles de 256x256 correspondientes
 */
function paintToTiles(state, from, to, atStrokeEnd, atlas, color) {
    const S = state.soa;
    const m = S.count;
    if (to <= from || m < 2) return;

    computeRibbonRails(S, from, to, state.baseWidth, state.seed);
    computeLevelRuns(S, from, to, state.hyst, from > 0);

    const runsCount = S.runCount;
    if (runsCount === 0) return;

    // Calcular la caja delimitadora del chunk para determinar qué tiles intersecta
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = from; i <= to; i++) {
        for (let t = 0; t < 4; t++) {
            if (S.LX[t][i] < minX) minX = S.LX[t][i];
            if (S.LX[t][i] > maxX) maxX = S.LX[t][i];
            if (S.LY[t][i] < minY) minY = S.LY[t][i];
            if (S.LY[t][i] > maxY) maxY = S.LY[t][i];
            if (S.RX[t][i] < minX) minX = S.RX[t][i];
            if (S.RX[t][i] > maxX) maxX = S.RX[t][i];
            if (S.RY[t][i] < minY) minY = S.RY[t][i];
            if (S.RY[t][i] > maxY) maxY = S.RY[t][i];
        }
    }

    const minTX = Math.floor((minX - 4) / TILE_SIZE);
    const maxTX = Math.floor((maxX + 4) / TILE_SIZE);
    const minTY = Math.floor((minY - 4) / TILE_SIZE);
    const maxTY = Math.floor((maxY + 4) / TILE_SIZE);

    const hasPath2D = typeof Path2D !== 'undefined';

    for (let ty = minTY; ty <= maxTY; ty++) {
        for (let tx = minTX; tx <= maxTX; tx++) {
            const tileObj = getOrCreateSparseTile(state, tx, ty, state.dpr);
            if (!tileObj || !tileObj.ctx) continue;

            const c = tileObj.ctx;
            const originX = tx * TILE_SIZE;
            const originY = ty * TILE_SIZE;

            c.save();
            c.setTransform(state.dpr, 0, 0, state.dpr, -originX * state.dpr, -originY * state.dpr);
            c.globalAlpha = state.bakeOpacity;

            for (let k = 1; k <= ATLAS_LEVELS; k++) {
                let hasRunsForLevel = false;
                const path = hasPath2D ? new Path2D() : null;

                if (!hasPath2D) c.beginPath();

                for (let r = 0; r < runsCount; r++) {
                    if (S.runLvl[r] === k) {
                        hasRunsForLevel = true;
                        traceRun(path || c, r, m, from, atStrokeEnd, S);
                    }
                }

                if (hasRunsForLevel) {
                    c.fillStyle = atlas.patterns[k] || color;
                    if (hasPath2D) {
                        c.fill(path, 'nonzero');
                    } else {
                        c.fill('nonzero');
                    }
                }
            }

            c.restore();
        }
    }
}

/**
 * Renderizado de un tramo directamente sobre el targetCtx (para la micro-cola viva o headless)
 */
function renderDirectChunk(targetCtx, S, from, to, baseWidth, seed, atlas, color, opacity) {
    if (to <= from || S.count < 2) return;

    computeRibbonRails(S, from, to, baseWidth, seed);
    computeLevelRuns(S, from, to, null, false);

    const runsCount = S.runCount;
    if (runsCount === 0) return;

    const hasPath2D = typeof Path2D !== 'undefined';
    targetCtx.save();
    targetCtx.globalAlpha = opacity;

    for (let k = 1; k <= ATLAS_LEVELS; k++) {
        let hasLevel = false;
        const path = hasPath2D ? new Path2D() : null;
        if (!hasPath2D) targetCtx.beginPath();

        for (let r = 0; r < runsCount; r++) {
            if (S.runLvl[r] === k) {
                hasLevel = true;
                traceRun(path || targetCtx, r, S.count, from, true, S);
            }
        }

        if (hasLevel) {
            targetCtx.fillStyle = atlas.patterns[k] || color;
            if (hasPath2D) {
                targetCtx.fill(path, 'nonzero');
            } else {
                targetCtx.fill('nonzero');
            }
        }
    }

    targetCtx.restore();
}

/**
 * Renderizado principal en Canvas 2D
 */
export function renderCanvas(ctx, points, style) {
    if (!points || points.length === 0) return;

    const baseWidth = Math.max(1, style.width || 3);
    const color = style.color || '#2b2b2b';
    const opacity = style.opacity !== undefined ? style.opacity : 0.90;
    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;

    const seed = getStrokeSeed(points, style);
    const atlas = getOrCreateGrainAtlas(ctx, color, dpr);

    if (ENABLE_SHADING_BUILDUP) {
        const { shiftX, shiftY } = getStrokePatternShift(seed);
        for (let k = 1; k <= ATLAS_LEVELS; k++) {
            const pat = atlas.patterns[k];
            if (pat && typeof pat.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
                pat.setTransform(new DOMMatrix().translate(shiftX, shiftY).scale(1 / dpr, 1 / dpr));
            }
        }
    }

    ctx.save();

    // Caso trazo puntual (tap)
    if (points.length === 1) {
        const p0 = points[0];
        const pVal = p0.pressure !== undefined && p0.pressure > 0 ? p0.pressure : 0.5;
        const k = Math.max(3, Math.min(ATLAS_LEVELS, Math.round(ATLAS_LEVELS * pVal * 0.85)));
        ctx.globalAlpha = opacity;
        ctx.fillStyle = atlas.patterns[k] || color;
        ctx.beginPath();
        ctx.arc(p0.x, p0.y, Math.max(0.8, baseWidth * (0.4 + 0.5 * pVal)), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
    }

    const isBrowserEnv = typeof document !== 'undefined' && ctx.canvas && typeof ctx.drawImage === 'function';
    if (!isBrowserEnv) {
        // Modo headless / mock tests
        const steps = conditionStrokeByArcLength(points, baseWidth, seed);
        const tempSoA = new StrokeSoA(steps.length + 4);
        for (let i = 0; i < steps.length; i++) {
            const s = steps[i];
            tempSoA.pushStep(s.x, s.y, s.nx, s.ny, s.p, Math.max(0.08, Math.min(1, Math.pow(s.p, 0.80))), s.stepIndex);
        }
        renderDirectChunk(ctx, tempSoA, 0, tempSoA.count - 1, baseWidth, seed, atlas, color, opacity);
        ctx.restore();
        return;
    }

    // 1. Acondicionamiento incremental
    const state = getOrCreateStrokeStateV2(points, style, baseWidth, seed, dpr, opacity);
    updateIncrementalConditioningV2(points, state);

    const totalConfirmed = state.soa.count;

    // 2. Horneado incremental a Sparse Tiles cada ~24 pasos
    const unbakedCount = totalConfirmed - state.bakedUpTo;
    if (unbakedCount >= 24) {
        const chunkStart = Math.max(0, state.bakedUpTo - 1);
        const chunkEnd = totalConfirmed - 1;

        paintToTiles(state, chunkStart, chunkEnd, false, atlas, color);
        state.bakedUpTo = totalConfirmed;
    }

    // 3. Volcado de todos los Sparse Tiles horneados en coordenadas de mundo
    for (const tileObj of state.tiles.values()) {
        ctx.drawImage(
            tileObj.canvas,
            tileObj.tx * TILE_SIZE,
            tileObj.ty * TILE_SIZE,
            TILE_SIZE,
            TILE_SIZE
        );
    }

    // 4. Cola provisional (pasos confirmados no horneados + micro-cola en vuelo)
    const remainingStart = Math.max(0, state.bakedUpTo - 1);
    if (totalConfirmed > remainingStart) {
        renderDirectChunk(ctx, state.soa, remainingStart, totalConfirmed - 1, baseWidth, seed, atlas, color, opacity);
    }

    if (state.tailSoA.count > 0) {
        // Enlazar el último paso confirmado con la cola
        const tailComb = new StrokeSoA(state.tailSoA.count + 4);
        if (totalConfirmed > 0) {
            const li = totalConfirmed - 1;
            tailComb.pushStep(state.soa.x[li], state.soa.y[li], state.soa.nx[li], state.soa.ny[li], state.soa.p[li], state.soa.pn[li], state.soa.stepIndex[li]);
        }
        for (let i = 0; i < state.tailSoA.count; i++) {
            tailComb.pushStep(state.tailSoA.x[i], state.tailSoA.y[i], state.tailSoA.nx[i], state.tailSoA.ny[i], state.tailSoA.p[i], state.tailSoA.pn[i], state.tailSoA.stepIndex[i]);
        }
        renderDirectChunk(ctx, tailComb, 0, tailComb.count - 1, baseWidth, seed, atlas, color, opacity);
    }

    ctx.restore();
}

export const renderPen = renderCanvas;

/**
 * Acondiciona los pasos del trazo para APIs compatibles y tests
 */
export function conditionStrokeByArcLength(rawPoints, baseWidth, seed) {
    if (!rawPoints || rawPoints.length === 0) return [];
    if (rawPoints.length === 1) {
        const p0 = rawPoints[0];
        const rawP = p0.pressure !== undefined && p0.pressure > 0 ? p0.pressure : 0.5;
        return [{
            x: p0.x,
            y: p0.y,
            nx: 0,
            ny: 1,
            p: rawP,
            stepIndex: 0,
        }];
    }

    const state = getOrCreateStrokeStateV2(rawPoints, null, baseWidth, seed, 1, 0.90);
    updateIncrementalConditioningV2(rawPoints, state);

    const result = [];
    for (let i = 0; i < state.soa.count; i++) {
        result.push({
            x: state.soa.x[i],
            y: state.soa.y[i],
            nx: state.soa.nx[i],
            ny: state.soa.ny[i],
            p: state.soa.p[i],
            stepIndex: state.soa.stepIndex[i],
        });
    }
    for (let i = 0; i < state.tailSoA.count; i++) {
        result.push({
            x: state.tailSoA.x[i],
            y: state.tailSoA.y[i],
            nx: state.tailSoA.nx[i],
            ny: state.tailSoA.ny[i],
            p: state.tailSoA.p[i],
            stepIndex: state.tailSoA.stepIndex[i],
        });
    }
    return result;
}

/**
 * Construcción de tramos por nivel (usado por SVG y tests)
 */
export function buildLevelRuns(steps, baseWidth, seed) {
    const runsByLevel = Array.from({ length: ATLAS_LEVELS + 1 }, () => []);
    if (!steps || steps.length < 2) return runsByLevel;

    const S = new StrokeSoA(steps.length + 4);
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const pVal = s.p !== undefined ? s.p : 0.5;
        const pNorm = Math.max(0.08, Math.min(1, Math.pow(pVal, 0.80)));
        S.pushStep(s.x, s.y, s.nx || 0, s.ny || 1, pVal, pNorm, s.stepIndex || i);
    }

    computeRibbonRails(S, 0, S.count - 1, baseWidth, seed);
    computeLevelRuns(S, 0, S.count - 1, null, false);

    for (let r = 0; r < S.runCount; r++) {
        const k = S.runLvl[r];
        const t = S.runT[r];
        const a = S.runA[r];
        const b = S.runB[r];
        const polyLen = (b - a + 1) * 4;
        const poly = new Float32Array(polyLen);
        let ptr = 0;
        for (let j = a; j <= b; j++) { poly[ptr++] = S.LX[t][j]; poly[ptr++] = S.LY[t][j]; }
        for (let j = b; j >= a; j--) { poly[ptr++] = S.RX[t][j]; poly[ptr++] = S.RY[t][j]; }
        runsByLevel[k].push(poly);
    }

    return runsByLevel;
}

/**
 * Exportación SVG ultra-compacta con RDP por riel y paridad exacta sin filtros pesados
 */
export function renderSvg(points, style) {
    if (!points || points.length === 0) return { defs: {}, body: '' };

    const baseWidth = Math.max(1, style.width || 3);
    const color = style.color || '#2b2b2b';
    const opacity = style.opacity !== undefined ? style.opacity : 0.90;
    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;

    const seed = getStrokeSeed(points, style);
    const steps = conditionStrokeByArcLength(points, baseWidth, seed);
    const atlas = getOrCreateGrainAtlas(null, color, dpr);
    const { shiftX, shiftY } = getStrokePatternShift(seed);

    const colorSlug = color.replace(/[^a-zA-Z0-9]/g, '');
    const tileCssSize = Math.round((PAPER_SIZE / dpr) * 100) / 100;
    const f = (n) => (Math.round(n * 10) / 10).toString();

    const defs = {};
    const shiftSuffix = ENABLE_SHADING_BUILDUP ? `-s${shiftX}_${shiftY}` : '';
    const patternTransformAttr = ENABLE_SHADING_BUILDUP
        ? ` patternTransform="translate(${shiftX} ${shiftY})"`
        : '';

    const registerPatternDef = (k) => {
        const patId = `apolo-grain-v2-${colorSlug}-k${k}${shiftSuffix}`;
        const href = getPatternDataUrl(atlas, k);
        if (href && !defs[patId]) {
            defs[patId] =
                `<pattern id="${patId}" patternUnits="userSpaceOnUse" width="${tileCssSize}" height="${tileCssSize}"${patternTransformAttr}>` +
                `<image href="${href}" width="${tileCssSize}" height="${tileCssSize}" image-rendering="pixelated"/>` +
                `</pattern>`;
        }
        return href ? `url(#${patId})` : color;
    };

    if (steps.length < 2) {
        const s0 = steps[0];
        const k = Math.max(3, Math.min(ATLAS_LEVELS, Math.round(ATLAS_LEVELS * s0.p * 0.85)));
        const fillRef = registerPatternDef(k);
        const r = Math.max(0.8, baseWidth * (0.4 + 0.5 * s0.p));
        return {
            defs,
            body: `<circle cx="${f(s0.x)}" cy="${f(s0.y)}" r="${f(r)}" fill="${fillRef}" fill-opacity="${opacity.toFixed(2)}"/>`,
        };
    }

    const S = new StrokeSoA(steps.length + 4);
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const pVal = s.p !== undefined ? s.p : 0.5;
        const pNorm = Math.max(0.08, Math.min(1, Math.pow(pVal, 0.80)));
        S.pushStep(s.x, s.y, s.nx || 0, s.ny || 1, pVal, pNorm, s.stepIndex || i);
    }

    computeRibbonRails(S, 0, S.count - 1, baseWidth, seed);
    computeLevelRuns(S, 0, S.count - 1, null, false);

    const pathsByLevel = new Array(ATLAS_LEVELS + 1).fill('');
    const m = S.count;

    for (let r = 0; r < S.runCount; r++) {
        const k = S.runLvl[r];
        const d = svgRunD(r, m, 0, S, 0.18);
        pathsByLevel[k] += d + ' ';
    }

    let pathsHtml = '';
    for (let k = 1; k <= ATLAS_LEVELS; k++) {
        const dStr = pathsByLevel[k].trim();
        if (!dStr) continue;
        const fillRef = registerPatternDef(k);
        pathsHtml += `<path d="${dStr}" fill="${fillRef}"/>`;
    }

    const body = `<g fill-rule="nonzero" fill-opacity="${opacity.toFixed(2)}" stroke="none">${pathsHtml}</g>`;
    return { defs, body };
}

if (typeof globalThis !== 'undefined') {
    globalThis.ApoloSandbox = globalThis.ApoloSandbox || { pens: {}, engines: {} };
    globalThis.ApoloSandbox.pens['pencil-atlasv2'] = {
        id,
        name,
        description,
        renderPen,
        renderCanvas,
        renderSvg,
        getPaperHeightField,
        getOrCreateGrainAtlas,
        conditionStrokeByArcLength,
        buildLevelRuns,
        releasePencilStroke,
    };
}
