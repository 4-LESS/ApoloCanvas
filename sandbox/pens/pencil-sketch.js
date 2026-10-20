/**
 * sandbox/pens/pencil-sketch.js
 *
 * Lápiz 12 · Vector Sketch (Híbrido O(1))
 *
 * Diseñado bajo orden estricto de prioridades:
 * 1. RENDIMIENTO (120 FPS incluso en trazos de 50.000 puntos):
 *    - Espina dorsal e historial geométrico incremental O(ΔN) en arrays tipados (SoA):
 *      cada nuevo evento pointermove procesa únicamente los puntos nuevos.
 *    - Horneado incremental sin costuras (Seamless Strip Baking) para trazos en vivo
 *      largos (> 64 nodos): sólo la tapa inicial lleva abanico semicircular al inicio,
 *      los tramos intermedios se unen por su normal exacta sin tapas internas, y la
 *      cola viva cierra con la tapa semicircular final.
 *    - En renderizado completo / sprite / SVG ejecuta estrictamente 3 llamadas O(1):
 *      (1) Cinta exterior porosa, (2) Núcleo dinámico por presión, (3) Filamentos secos.
 * 2. COMPATIBILIDAD (Paridad 1:1 Live Canvas <-> SVG Vector):
 *    Cero shadowBlur y cero filtros pesados (<feTurbulence> / <feDisplacementMap>).
 *    Canvas y SVG comparten exactamente la misma geometría vectorial y el mismo par de
 *    texturas PNG tileables (128x128 userSpaceOnUse).
 * 3. FIDELIDAD (Lápiz mina real):
 *    Textura bimodal de diente de papel (fibra suave + microporo mineral), núcleo
 *    dinámico que se ensancha al presionar y hebras secas discontinuas en los flancos.
 * 4. GROSOR Y ZOOM (1px a 40px sin artefactos):
 *    Paso mínimo proporcional al grosor (evita pliegues tipo peine en grosores altos),
 *    normales suavizadas, tapas redondas vectoriales y escalado armónico de grano.
 */

export const id = 'pencil-sketch';
export const name = 'Lápiz 12 · Vector Sketch (Híbrido O(1))';
export const description = 'Iteración 12: Híbrido vectorial O(1) con espina incremental para 50k puntos, doble cinta de grano 128x128 y paridad 1:1 Canvas/SVG';

const TILE_SIZE = 128;
const TILE_MASK = TILE_SIZE - 1;
const CAP_STEPS = 5;
const SEAM_EPS = 0.22;

let cachedPaperField = null;
const patternCache = new Map();
const strokeStateByPoints = new WeakMap();
const strokeStateById = new Map();

// Buffer offscreen reutilizable para hornear tramos confirmados en trazos de hasta 50k+ puntos
const liveSketchBake = {
    canvas: null,
    ctx: null,
    strokeKey: '',
    bakedSpineIdx: 0,
};

function ensureLiveBakeCanvas(targetCanvas) {
    if (!targetCanvas || typeof document === 'undefined' || typeof document.createElement !== 'function') {
        return null;
    }
    const w = targetCanvas.width || 1;
    const h = targetCanvas.height || 1;
    if (!liveSketchBake.canvas) {
        liveSketchBake.canvas = document.createElement('canvas');
        liveSketchBake.ctx = liveSketchBake.canvas.getContext && liveSketchBake.canvas.getContext('2d');
    }
    if (!liveSketchBake.ctx) return null;
    if (liveSketchBake.canvas.width !== w || liveSketchBake.canvas.height !== h) {
        liveSketchBake.canvas.width = w;
        liveSketchBake.canvas.height = h;
        liveSketchBake.strokeKey = '';
        liveSketchBake.bakedSpineIdx = 0;
    }
    return liveSketchBake.ctx;
}

export function releasePencilStroke(idOrPoints) {
    if (idOrPoints && typeof idOrPoints === 'object') {
        strokeStateByPoints.delete(idOrPoints);
    } else if (typeof idOrPoints === 'string') {
        strokeStateById.delete(idOrPoints);
    }
}

function hash2D(x, y, seed) {
    let h = Math.imul(x ^ seed, 374761393) + Math.imul(y ^ (seed >> 3), 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash1D(i, salt) {
    let h = Math.imul((i | 0) ^ (salt | 0), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function getPaperField() {
    if (cachedPaperField) return cachedPaperField;

    const total = TILE_SIZE * TILE_SIZE;
    const n0 = new Float32Array(total);
    for (let y = 0; y < TILE_SIZE; y++) {
        const row = y * TILE_SIZE;
        for (let x = 0; x < TILE_SIZE; x++) {
            n0[row + x] = hash2D(x, y, 0x6c8e9cf5);
        }
    }

    const boxBlurToroidal = (src, radius) => {
        const tmp = new Float32Array(total);
        const dst = new Float32Array(total);
        const span = 2 * radius + 1;
        for (let y = 0; y < TILE_SIZE; y++) {
            const row = y * TILE_SIZE;
            for (let x = 0; x < TILE_SIZE; x++) {
                let acc = 0;
                for (let dx = -radius; dx <= radius; dx++) {
                    acc += src[row + ((x + dx) & TILE_MASK)];
                }
                tmp[row + x] = acc / span;
            }
        }
        for (let y = 0; y < TILE_SIZE; y++) {
            const row = y * TILE_SIZE;
            for (let x = 0; x < TILE_SIZE; x++) {
                let acc = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    acc += tmp[((y + dy) & TILE_MASK) * TILE_SIZE + x];
                }
                dst[row + x] = acc / span;
            }
        }
        return dst;
    };

    const fine = boxBlurToroidal(n0, 1);
    const medium = boxBlurToroidal(n0, 2);

    const raw = new Float32Array(total);
    const indices = new Uint32Array(total);
    for (let i = 0; i < total; i++) {
        raw[i] = 0.50 * medium[i] + 0.35 * fine[i] + 0.15 * n0[i];
        indices[i] = i;
    }

    indices.sort((a, b) => raw[a] - raw[b]);

    const field = new Float32Array(total);
    const invTotal = 1 / total;
    for (let rank = 0; rank < total; rank++) {
        field[indices[rank]] = (rank + 0.5) * invTotal;
    }

    cachedPaperField = field;
    return field;
}

function parseColorRgb(colorStr) {
    const clean = (colorStr || '#2b2b2b').trim();
    if (clean.startsWith('#')) {
        let hex = clean.slice(1);
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        const num = parseInt(hex.slice(0, 6), 16);
        if (!isNaN(num)) {
            return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
        }
    }
    return [43, 43, 43];
}

function getGrainPatterns(ctx, color, baseWidth) {
    const safeColor = color || '#2b2b2b';
    let entry = patternCache.get(safeColor);

    if (!entry) {
        const H = getPaperField();
        const [r, g, b] = parseColorRgb(safeColor);
        const isDoc = typeof document !== 'undefined' && typeof document.createElement === 'function';

        let coarseTile = null;
        let coreTile = null;
        let coarseUrl = '';
        let coreUrl = '';

        if (isDoc) {
            const createTile = (threshold, feather, maxAlpha) => {
                const c = document.createElement('canvas');
                c.width = TILE_SIZE;
                c.height = TILE_SIZE;
                const cCtx = c.getContext && c.getContext('2d');
                if (!cCtx || typeof cCtx.createImageData !== 'function') return { canvas: null, url: '' };

                const img = cCtx.createImageData(TILE_SIZE, TILE_SIZE);
                const data = img.data;
                const limit = threshold + feather;

                for (let i = 0; i < H.length; i++) {
                    const h = H[i];
                    if (h < limit) {
                        const p = i * 4;
                        data[p] = r;
                        data[p + 1] = g;
                        data[p + 2] = b;
                        if (h <= threshold) {
                            const depth = 1 - (h / threshold) * 0.25;
                            data[p + 3] = Math.round(maxAlpha * depth);
                        } else {
                            const t = 1 - (h - threshold) / feather;
                            data[p + 3] = Math.round(maxAlpha * 0.65 * t * t);
                        }
                    }
                }
                cCtx.putImageData(img, 0, 0);
                let url = '';
                try {
                    if (typeof c.toDataURL === 'function') url = c.toDataURL('image/png');
                } catch {
                    url = '';
                }
                return { canvas: c, url };
            };

            const coarseObj = createTile(0.42, 0.20, 220);
            const coreObj = createTile(0.76, 0.16, 255);
            coarseTile = coarseObj.canvas;
            coreTile = coreObj.canvas;
            coarseUrl = coarseObj.url;
            coreUrl = coreObj.url;
        }

        entry = {
            coarseTile,
            coreTile,
            coarseUrl,
            coreUrl,
            rawCoarsePat: null,
            rawCorePat: null,
        };
        patternCache.set(safeColor, entry);
    }

    const grainScale = Math.max(0.85, Math.min(1.55, 0.80 + baseWidth * 0.025));

    if (ctx && typeof ctx.createPattern === 'function' && entry.coarseTile && entry.coreTile) {
        if (!entry.rawCoarsePat) {
            entry.rawCoarsePat = ctx.createPattern(entry.coarseTile, 'repeat');
            entry.rawCorePat = ctx.createPattern(entry.coreTile, 'repeat');
        }
        if (typeof DOMMatrix !== 'undefined') {
            const mat = new DOMMatrix().scale(grainScale, grainScale);
            if (entry.rawCoarsePat && typeof entry.rawCoarsePat.setTransform === 'function') {
                entry.rawCoarsePat.setTransform(mat);
            }
            if (entry.rawCorePat && typeof entry.rawCorePat.setTransform === 'function') {
                entry.rawCorePat.setTransform(mat);
            }
        }
    }

    return {
        coarsePattern: entry.rawCoarsePat || safeColor,
        corePattern: entry.rawCorePat || safeColor,
        coarseUrl: entry.coarseUrl,
        coreUrl: entry.coreUrl,
        tileSize: Math.round(TILE_SIZE * grainScale * 10) / 10,
    };
}

function pencilPressureResponse(rawP) {
    const p = rawP !== undefined && !isNaN(rawP) && rawP > 0 ? Math.max(0.05, Math.min(1, rawP)) : 0.5;
    return Math.pow(p, 0.78);
}

/**
 * Estado incremental SoA por trazo: permite crecer hasta 50.000+ puntos en O(ΔN) por frame
 */
function createIncrementalState(p0, baseWidth) {
    const cap = 256;
    const seed =
        (Math.imul(Math.round(p0.x * 100), 73856093) ^
            Math.imul(Math.round(p0.y * 100), 19349663)) |
        0;
    const initP = pencilPressureResponse(p0.pressure);
    const minDist = Math.max(1.3, baseWidth * 0.22);

    const filamentWidth = Math.max(0.55, Math.min(3.2, baseWidth * 0.11));
    const dashUnit = Math.max(1.8, baseWidth * 0.85);
    const filamentDash = [
        Math.round(dashUnit * 2.3 * 10) / 10,
        Math.round(dashUnit * 1.4 * 10) / 10,
        Math.round(dashUnit * 0.8 * 10) / 10,
        Math.round(dashUnit * 1.9 * 10) / 10,
    ];

    const state = {
        baseWidth,
        seed,
        minDist,
        filamentWidth,
        filamentDash,
        firstX: p0.x,
        firstY: p0.y,
        rawCount: 1,
        // Puntos filtrados confirmados
        fLen: 1,
        fx: [p0.x],
        fy: [p0.y],
        fp: [initP],
        // Espina dorsal confirmada (SoA)
        sCap: cap,
        sConfirmed: 1,
        sTotal: 1,
        sx: new Float32Array(cap),
        sy: new Float32Array(cap),
        sp: new Float32Array(cap),
        nx: new Float32Array(cap),
        ny: new Float32Array(cap),
        outerL: new Float32Array(cap),
        outerR: new Float32Array(cap),
        coreL: new Float32Array(cap),
        coreR: new Float32Array(cap),
        strandLX: new Float32Array(cap),
        strandLY: new Float32Array(cap),
        strandRX: new Float32Array(cap),
        strandRY: new Float32Array(cap),
    };

    state.sx[0] = p0.x;
    state.sy[0] = p0.y;
    state.sp[0] = initP;
    state.nx[0] = 0;
    state.ny[0] = -1;
    computeNodeOffsets(state, 0);

    return state;
}

function ensureSpineCapacity(state, needed) {
    if (needed <= state.sCap) return;
    let newCap = state.sCap;
    while (newCap < needed) newCap *= 2;
    const keys = [
        'sx', 'sy', 'sp', 'nx', 'ny',
        'outerL', 'outerR', 'coreL', 'coreR',
        'strandLX', 'strandLY', 'strandRX', 'strandRY',
    ];
    for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        const nextArr = new Float32Array(newCap);
        nextArr.set(state[key]);
        state[key] = nextArr;
    }
    state.sCap = newCap;
}

function computeNodeOffsets(state, i) {
    const seed = state.seed;
    const baseWidth = state.baseWidth;
    const p = state.sp[i];
    const x = state.sx[i];
    const y = state.sy[i];
    const nx = state.nx[i];
    const ny = state.ny[i];

    const nL =
        (hash1D(i - 1, seed + 13) + hash1D(i, seed + 13) * 2 + hash1D(i + 1, seed + 13)) * 0.25 - 0.5;
    const nR =
        (hash1D(i - 1, seed + 47) + hash1D(i, seed + 47) * 2 + hash1D(i + 1, seed + 47)) * 0.25 - 0.5;

    const outerHalf = baseWidth * 0.5 * (0.68 + 0.48 * p);
    const oL = Math.max(0.4, outerHalf * (1 + nL * 0.16));
    const oR = Math.max(0.4, outerHalf * (1 + nR * 0.16));
    state.outerL[i] = oL;
    state.outerR[i] = oR;

    const coreRatio = 0.34 + 0.42 * p;
    const coreHalf = outerHalf * coreRatio;
    state.coreL[i] = Math.max(0.28, coreHalf * (1 + nR * 0.10));
    state.coreR[i] = Math.max(0.28, coreHalf * (1 + nL * 0.10));

    const sL = oL * 0.78;
    const sR = oR * 0.78;
    state.strandLX[i] = x + nx * sL;
    state.strandLY[i] = y + ny * sL;
    state.strandRX[i] = x - nx * sR;
    state.strandRY[i] = y - ny * sR;
}

function updateNormalsAndOffsetsRange(state, startIdx, endIdx) {
    const from = Math.max(0, startIdx);
    const last = endIdx;
    for (let i = from; i <= last; i++) {
        const iPrev = i > 0 ? i - 1 : 0;
        const iNext = i < last ? i + 1 : last;
        const dx = state.sx[iNext] - state.sx[iPrev];
        const dy = state.sy[iNext] - state.sy[iPrev];
        const len = Math.hypot(dx, dy) || 1;
        state.nx[i] = -dy / len;
        state.ny[i] = dx / len;
    }
    // Suavizado ligero con vecinos inmediatos y actualización de bordes
    for (let i = from; i <= last; i++) {
        if (i > 0 && i < last) {
            const sx = state.nx[i - 1] * 0.25 + state.nx[i] * 0.5 + state.nx[i + 1] * 0.25;
            const sy = state.ny[i - 1] * 0.25 + state.ny[i] * 0.5 + state.ny[i + 1] * 0.25;
            const len = Math.hypot(sx, sy) || 1;
            state.nx[i] = sx / len;
            state.ny[i] = sy / len;
        }
        computeNodeOffsets(state, i);
    }
}

/**
 * Avanza incrementalmente la espina dorsal sólo para los puntos nuevos añadidos desde el último frame
 */
function advanceSketchState(rawPoints, baseWidth, style) {
    const strokeId = style && style.strokeId;
    let state = strokeId ? strokeStateById.get(strokeId) : strokeStateByPoints.get(rawPoints);

    const p0 = rawPoints[0];
    if (
        !state ||
        state.baseWidth !== baseWidth ||
        state.firstX !== p0.x ||
        state.firstY !== p0.y ||
        rawPoints.length < state.rawCount
    ) {
        state = createIncrementalState(p0, baseWidth);
        if (strokeId) {
            strokeStateById.set(strokeId, state);
            if (strokeStateById.size > 128) {
                const oldest = strokeStateById.keys().next().value;
                strokeStateById.delete(oldest);
            }
        } else {
            strokeStateByPoints.set(rawPoints, state);
        }
    }

    const prevConfirmedSpine = state.sConfirmed;

    // 1. Filtrar únicamente los puntos crudos nuevos
    for (let i = state.rawCount; i < rawPoints.length; i++) {
        const pt = rawPoints[i];
        const lastIdx = state.fLen - 1;
        const lx = state.fx[lastIdx];
        const ly = state.fy[lastIdx];
        const lp = state.fp[lastIdx];
        const dist = Math.hypot(pt.x - lx, pt.y - ly);

        if (dist >= state.minDist) {
            const pVal = pencilPressureResponse(pt.pressure);
            const curFIdx = state.fLen;
            state.fx.push(pt.x);
            state.fy.push(pt.y);
            const newP = lp * 0.35 + pVal * 0.65;
            state.fp.push(newP);
            state.fLen++;

            // Añadir nodos Chaikin confirmados a la espina dorsal
            ensureSpineCapacity(state, state.sConfirmed + 3);
            if (curFIdx > 1) {
                const prevS = state.sConfirmed - 1;
                const qx = (state.sx[prevS] + lx) * 0.5;
                const qy = (state.sy[prevS] + ly) * 0.5;
                const qp = (state.sp[prevS] + lp) * 0.5;
                state.sx[state.sConfirmed] = qx;
                state.sy[state.sConfirmed] = qy;
                state.sp[state.sConfirmed] = qp;
                state.sConfirmed++;
            }
            state.sx[state.sConfirmed] = (lx + pt.x) * 0.5;
            state.sy[state.sConfirmed] = (ly + pt.y) * 0.5;
            state.sp[state.sConfirmed] = (lp + newP) * 0.5;
            state.sConfirmed++;
        }
    }

    state.rawCount = rawPoints.length;

    // 2. Añadir el punto final vivo (cola actual) en la posición sConfirmed
    const rawLast = rawPoints[rawPoints.length - 1];
    const lastFIdx = state.fLen - 1;
    let total = state.sConfirmed;

    if (state.fLen === 1) {
        const dEnd = Math.hypot(rawLast.x - state.fx[0], rawLast.y - state.fy[0]);
        if (dEnd > 0.15) {
            ensureSpineCapacity(state, 2);
            state.sx[1] = rawLast.x;
            state.sy[1] = rawLast.y;
            state.sp[1] = pencilPressureResponse(rawLast.pressure);
            total = 2;
        } else {
            total = 1;
        }
    } else {
        ensureSpineCapacity(state, state.sConfirmed + 2);
        state.sx[total] = state.fx[lastFIdx];
        state.sy[total] = state.fy[lastFIdx];
        state.sp[total] = state.fp[lastFIdx];
        total++;

        const dTail = Math.hypot(rawLast.x - state.fx[lastFIdx], rawLast.y - state.fy[lastFIdx]);
        if (dTail > 0.15) {
            state.sx[total] = rawLast.x;
            state.sy[total] = rawLast.y;
            state.sp[total] = pencilPressureResponse(rawLast.pressure);
            total++;
        }
    }

    state.sTotal = total;
    if (total >= 2) {
        updateNormalsAndOffsetsRange(state, Math.max(0, prevConfirmedSpine - 3), total - 1);
    }

    return state;
}

/**
 * Traza en ctx un tramo [startIdx .. endIdx] de una cinta (outer o core).
 * - includeStartCap: añade abanico semicircular en startIdx (sólo para startIdx === 0)
 * - includeEndCap: añade abanico semicircular en endIdx (sólo para el final del trazo)
 */
function traceRibbonRangeOnCtx(ctx, state, hwLeft, hwRight, startIdx, endIdx, includeStartCap, includeEndCap) {
    if (endIdx <= startIdx) return;

    const sx = state.sx;
    const sy = state.sy;
    const nx = state.nx;
    const ny = state.ny;

    // Solape sub-píxel en uniones internas para impedir micro-fisuras de antialiasing
    const extStart = !includeStartCap && startIdx > 0 ? SEAM_EPS : 0;
    const tx0 = -ny[startIdx] * extStart;
    const ty0 = nx[startIdx] * extStart;

    ctx.moveTo(
        sx[startIdx] + nx[startIdx] * hwLeft[startIdx] + tx0,
        sy[startIdx] + ny[startIdx] * hwLeft[startIdx] + ty0
    );

    for (let i = startIdx + 1; i <= endIdx; i++) {
        ctx.lineTo(sx[i] + nx[i] * hwLeft[i], sy[i] + ny[i] * hwLeft[i]);
    }

    if (includeEndCap) {
        const txEnd = ny[endIdx];
        const tyEnd = -nx[endIdx];
        const rEnd = (hwLeft[endIdx] + hwRight[endIdx]) * 0.5;
        for (let c = 1; c < CAP_STEPS; c++) {
            const theta = (c / CAP_STEPS) * Math.PI;
            const cosT = Math.cos(theta);
            const sinT = Math.sin(theta);
            ctx.lineTo(
                sx[endIdx] + (nx[endIdx] * cosT + txEnd * sinT) * rEnd,
                sy[endIdx] + (ny[endIdx] * cosT + tyEnd * sinT) * rEnd
            );
        }
    }

    for (let i = endIdx; i >= startIdx; i--) {
        const ox = i === startIdx ? tx0 : 0;
        const oy = i === startIdx ? ty0 : 0;
        ctx.lineTo(sx[i] - nx[i] * hwRight[i] + ox, sy[i] - ny[i] * hwRight[i] + oy);
    }

    if (includeStartCap) {
        const txStart = -ny[startIdx];
        const tyStart = nx[startIdx];
        const rStart = (hwLeft[startIdx] + hwRight[startIdx]) * 0.5;
        for (let c = 1; c < CAP_STEPS; c++) {
            const theta = (c / CAP_STEPS) * Math.PI;
            const cosT = -Math.cos(theta);
            const sinT = Math.sin(theta);
            ctx.lineTo(
                sx[startIdx] + (nx[startIdx] * cosT + txStart * sinT) * rStart,
                sy[startIdx] + (ny[startIdx] * cosT + tyStart * sinT) * rStart
            );
        }
    }

    ctx.closePath();
}

function drawSpineRange(ctx, state, grain, color, opacity, startIdx, endIdx, includeStartCap, includeEndCap) {
    if (endIdx <= startIdx) return;

    // Pasada 1: Cuerpo poroso exterior
    ctx.globalAlpha = opacity * 0.62;
    ctx.fillStyle = grain.coarsePattern;
    ctx.beginPath();
    traceRibbonRangeOnCtx(ctx, state, state.outerL, state.outerR, startIdx, endIdx, includeStartCap, includeEndCap);
    ctx.fill('nonzero');

    // Pasada 2: Núcleo de grafito sensible a la presión
    ctx.globalAlpha = opacity * 0.92;
    ctx.fillStyle = grain.corePattern;
    ctx.beginPath();
    traceRibbonRangeOnCtx(ctx, state, state.coreL, state.coreR, startIdx, endIdx, includeStartCap, includeEndCap);
    ctx.fill('nonzero');

    // Pasada 3: Filamentos secos de borde (1 solo stroke continuo)
    ctx.globalAlpha = opacity * 0.34;
    ctx.strokeStyle = color;
    ctx.lineWidth = state.filamentWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (typeof ctx.setLineDash === 'function') {
        ctx.setLineDash(state.filamentDash);
    }
    ctx.beginPath();
    ctx.moveTo(state.strandLX[startIdx], state.strandLY[startIdx]);
    for (let i = startIdx + 1; i <= endIdx; i++) {
        ctx.lineTo(state.strandLX[i], state.strandLY[i]);
    }
    ctx.moveTo(state.strandRX[startIdx], state.strandRY[startIdx]);
    for (let i = startIdx + 1; i <= endIdx; i++) {
        ctx.lineTo(state.strandRX[i], state.strandRY[i]);
    }
    ctx.stroke();
}

export function buildSketchGeometry(rawPoints, baseWidth, style = {}) {
    if (!rawPoints || rawPoints.length === 0) return null;
    return advanceSketchState(rawPoints, baseWidth, style);
}

/**
 * Renderizado en Canvas 2D — 3 llamadas O(1) + Horneado Incremental sin costuras para 50.000+ puntos
 */
export function renderCanvas(ctx, points, style = {}) {
    if (!points || points.length === 0) return;

    const baseWidth = Math.max(1, style.width || 3);
    const color = style.color || '#2b2b2b';
    const opacity = style.opacity !== undefined ? style.opacity : 0.88;

    const state = advanceSketchState(points, baseWidth, style);
    const grain = getGrainPatterns(ctx, color, baseWidth);

    ctx.save();

    if (state.sTotal < 2) {
        const p0 = state.sp[0];
        const outerR = Math.max(0.8, baseWidth * (0.38 + 0.28 * p0));
        const coreR = Math.max(0.45, baseWidth * (0.20 + 0.25 * p0));

        ctx.globalAlpha = opacity * 0.62;
        ctx.fillStyle = grain.coarsePattern;
        ctx.beginPath();
        ctx.arc(state.sx[0], state.sy[0], outerR, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = opacity * 0.90;
        ctx.fillStyle = grain.corePattern;
        ctx.beginPath();
        ctx.arc(state.sx[0], state.sy[0], coreR, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
        return;
    }

    const targetCanvas = ctx.canvas;
    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;

    // En trazos largos en vivo (> 48 nodos de espina), congelamos los tramos confirmados en O(1)
    if (state.sTotal > 48 && targetCanvas && !style.viewport && targetCanvas.id === 'drawingCanvas') {
        const bakeCtx = ensureLiveBakeCanvas(targetCanvas);
        if (bakeCtx) {
            const strokeKey = `${style.strokeId || ''}|${state.firstX}|${state.firstY}|${baseWidth}|${color}|${opacity.toFixed(3)}`;
            if (liveSketchBake.strokeKey !== strokeKey || state.sConfirmed < liveSketchBake.bakedSpineIdx) {
                liveSketchBake.strokeKey = strokeKey;
                liveSketchBake.bakedSpineIdx = 0;
                bakeCtx.save();
                bakeCtx.setTransform(1, 0, 0, 1, 0, 0);
                bakeCtx.clearRect(0, 0, liveSketchBake.canvas.width, liveSketchBake.canvas.height);
                bakeCtx.restore();
            }

            const freezeTarget = Math.max(0, state.sConfirmed - 6);
            if (freezeTarget - liveSketchBake.bakedSpineIdx >= 16) {
                const fromIdx = liveSketchBake.bakedSpineIdx;
                bakeCtx.save();
                bakeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                drawSpineRange(
                    bakeCtx,
                    state,
                    grain,
                    color,
                    opacity,
                    fromIdx,
                    freezeTarget,
                    fromIdx === 0,
                    false
                );
                bakeCtx.restore();
                liveSketchBake.bakedSpineIdx = freezeTarget;
            }

            if (liveSketchBake.bakedSpineIdx > 0) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.drawImage(liveSketchBake.canvas, 0, 0);
                ctx.restore();
            }

            const tailStart = liveSketchBake.bakedSpineIdx;
            drawSpineRange(
                ctx,
                state,
                grain,
                color,
                opacity,
                tailStart,
                state.sTotal - 1,
                tailStart === 0,
                true
            );
            ctx.restore();
            return;
        }
    }

    drawSpineRange(ctx, state, grain, color, opacity, 0, state.sTotal - 1, true, true);
    ctx.restore();
}

export const renderPen = renderCanvas;

function buildRibbonSvgPathD(state, hwLeft, hwRight) {
    const n = state.sTotal;
    if (n < 2) return '';
    const f = (v) => (Math.round(v * 10) / 10).toString();
    const sx = state.sx;
    const sy = state.sy;
    const nx = state.nx;
    const ny = state.ny;

    let d = `M${f(sx[0] + nx[0] * hwLeft[0])} ${f(sy[0] + ny[0] * hwLeft[0])}`;
    for (let i = 1; i < n; i++) {
        d += `L${f(sx[i] + nx[i] * hwLeft[i])} ${f(sy[i] + ny[i] * hwLeft[i])}`;
    }

    const last = n - 1;
    const txEnd = ny[last];
    const tyEnd = -nx[last];
    const rEnd = (hwLeft[last] + hwRight[last]) * 0.5;
    for (let c = 1; c < CAP_STEPS; c++) {
        const theta = (c / CAP_STEPS) * Math.PI;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        d += `L${f(sx[last] + (nx[last] * cosT + txEnd * sinT) * rEnd)} ${f(sy[last] + (ny[last] * cosT + tyEnd * sinT) * rEnd)}`;
    }

    for (let i = last; i >= 0; i--) {
        d += `L${f(sx[i] - nx[i] * hwRight[i])} ${f(sy[i] - ny[i] * hwRight[i])}`;
    }

    const txStart = -ny[0];
    const tyStart = nx[0];
    const rStart = (hwLeft[0] + hwRight[0]) * 0.5;
    for (let c = 1; c < CAP_STEPS; c++) {
        const theta = (c / CAP_STEPS) * Math.PI;
        const cosT = -Math.cos(theta);
        const sinT = Math.sin(theta);
        d += `L${f(sx[0] + (nx[0] * cosT + txStart * sinT) * rStart)} ${f(sy[0] + (ny[0] * cosT + tyStart * sinT) * rStart)}`;
    }

    return d + 'Z';
}

/**
 * Renderizado en SVG Vector — Equivalencia 1:1 con renderCanvas (misma geometría y patrones PNG)
 */
export function renderSvg(points, style = {}) {
    if (!points || points.length === 0) return { defs: {}, body: '' };

    const baseWidth = Math.max(1, style.width || 3);
    const color = style.color || '#2b2b2b';
    const opacity = style.opacity !== undefined ? style.opacity : 0.88;

    const state = advanceSketchState(points, baseWidth, style);
    const grain = getGrainPatterns(null, color, baseWidth);
    const f = (n) => (Math.round(n * 10) / 10).toString();
    const colorSlug = color.replace(/[^a-zA-Z0-9]/g, '');
    const sizeSlug = String(grain.tileSize).replace('.', '_');

    const coarseId = `apolo-sketch-coarse-${colorSlug}-${sizeSlug}`;
    const coreId = `apolo-sketch-core-${colorSlug}-${sizeSlug}`;

    const defs = {};
    if (grain.coarseUrl) {
        defs[coarseId] =
            `<pattern id="${coarseId}" patternUnits="userSpaceOnUse" width="${grain.tileSize}" height="${grain.tileSize}">` +
            `<image href="${grain.coarseUrl}" width="${grain.tileSize}" height="${grain.tileSize}"/>` +
            `</pattern>`;
    }
    if (grain.coreUrl) {
        defs[coreId] =
            `<pattern id="${coreId}" patternUnits="userSpaceOnUse" width="${grain.tileSize}" height="${grain.tileSize}">` +
            `<image href="${grain.coreUrl}" width="${grain.tileSize}" height="${grain.tileSize}"/>` +
            `</pattern>`;
    }

    const coarseFill = grain.coarseUrl ? `url(#${coarseId})` : color;
    const coreFill = grain.coreUrl ? `url(#${coreId})` : color;

    if (state.sTotal < 2) {
        const p0 = state.sp[0];
        const outerR = Math.max(0.8, baseWidth * (0.38 + 0.28 * p0));
        const coreR = Math.max(0.45, baseWidth * (0.20 + 0.25 * p0));
        const body =
            `<g stroke="none">` +
            `<circle cx="${f(state.sx[0])}" cy="${f(state.sy[0])}" r="${f(outerR)}" fill="${coarseFill}" fill-opacity="${(opacity * 0.62).toFixed(2)}"/>` +
            `<circle cx="${f(state.sx[0])}" cy="${f(state.sy[0])}" r="${f(coreR)}" fill="${coreFill}" fill-opacity="${(opacity * 0.90).toFixed(2)}"/>` +
            `</g>`;
        return { defs, body };
    }

    const outerD = buildRibbonSvgPathD(state, state.outerL, state.outerR);
    const coreD = buildRibbonSvgPathD(state, state.coreL, state.coreR);

    let strandsD = `M${f(state.strandLX[0])} ${f(state.strandLY[0])}`;
    for (let i = 1; i < state.sTotal; i++) {
        strandsD += `L${f(state.strandLX[i])} ${f(state.strandLY[i])}`;
    }
    strandsD += `M${f(state.strandRX[0])} ${f(state.strandRY[0])}`;
    for (let i = 1; i < state.sTotal; i++) {
        strandsD += `L${f(state.strandRX[i])} ${f(state.strandRY[i])}`;
    }

    const dashAttr = state.filamentDash.join(' ');

    const body =
        `<g>` +
        `<path d="${outerD}" fill="${coarseFill}" fill-rule="nonzero" fill-opacity="${(opacity * 0.62).toFixed(2)}" stroke="none"/>` +
        `<path d="${coreD}" fill="${coreFill}" fill-rule="nonzero" fill-opacity="${(opacity * 0.92).toFixed(2)}" stroke="none"/>` +
        `<path d="${strandsD}" fill="none" stroke="${color}" stroke-width="${f(state.filamentWidth)}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${dashAttr}" stroke-opacity="${(opacity * 0.34).toFixed(2)}"/>` +
        `</g>`;

    return { defs, body };
}

if (typeof globalThis !== 'undefined') {
    globalThis.ApoloSandbox = globalThis.ApoloSandbox || { pens: {}, engines: {} };
    globalThis.ApoloSandbox.pens['pencil-sketch'] = {
        id,
        name,
        description,
        renderPen,
        renderCanvas,
        renderSvg,
        buildSketchGeometry,
        releasePencilStroke,
    };
}
