/**
 * sandbox/pens/pencil-atlas.js
 * 
 * Lápiz de Grafito Atlas (Ruta B Refinada: Grano Micro-Poroso Cohesivo)
 * 
 * Correcciones sobre la versión anterior:
 * 1. Espectro Blue-Noise de alta frecuencia en H (256x256): evita "islas" o huecos de 8px
 *    que cortaban los trazos finos y agrupaban el grafito en grumos separados.
 * 2. Transición suave en el borde del poro (Soft-Threshold en el Atlas) manteniendo K niveles.
 * 3. 4 cintas anidadas con espina central conectada y caída gaussiana hacia el borde.
 */

export const id = 'pencil-atlas';
export const name = 'Lápiz 8 · Atlas v2 (Blue-Noise K=12)';
export const description = 'Iteración 8: Campo de altura Blue-Noise 256x256 rank-normalized con 4 cintas y Atlas suave de 12 niveles';

const PAPER_SIZE = 256;
const ATLAS_LEVELS = 12; // Más resolución tonal entre borde y centro

let paperHeightField = null;
const colorAtlasCache = new Map();
const strokeConditionCache = new WeakMap();

export function resetPencilAtlasCacheForTesting() {
    paperHeightField = null;
    colorAtlasCache.clear();
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

/**
 * Value-noise periódico en 2D sobre grilla de periodo `PAPER_SIZE / cellSize`
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
 * 1. Campo de altura H (256x256) con distribución Blue-Noise de alta frecuencia y Rank-Normalization.
 * Evita los huecos largos que rompían los trazos delgados y los grumos grandes.
 */
export function getPaperHeightField() {
    if (paperHeightField) return paperHeightField;

    const total = PAPER_SIZE * PAPER_SIZE;
    const white = new Float32Array(total);
    const raw = new Float32Array(total);
    const indices = new Uint32Array(total);
    const twoPiOver256 = (Math.PI * 2) / PAPER_SIZE;

    // Paso A: Ruido base de alta frecuencia por píxel
    for (let i = 0; i < total; i++) {
        white[i] = prngStep(707, i, 3);
    }

    // Paso B: Filtro High-Pass (aproximación Blue-Noise rápida: resta la media vecinal 3x3)
    // para que los picos y valles estén uniformemente distribuidos cada 1-2px sin formar manchas
    const mask = PAPER_SIZE - 1;
    for (let y = 0; y < PAPER_SIZE; y++) {
        const yUp = ((y - 1) & mask) * PAPER_SIZE;
        const yMid = y * PAPER_SIZE;
        const yDn = ((y + 1) & mask) * PAPER_SIZE;

        for (let x = 0; x < PAPER_SIZE; x++) {
            const xL = (x - 1) & mask;
            const xR = (x + 1) & mask;
            const idx = yMid + x;
            indices[idx] = idx;

            const neighbors =
                (white[yUp + xL] + white[yUp + x] + white[yUp + xR] +
                 white[yMid + xL] +                 white[yMid + xR] +
                 white[yDn + xL] + white[yDn + x] + white[yDn + xR]) * 0.125;

            const blueGrain = (white[idx] - neighbors * 0.65) + 0.5;

            // Micro-grano de 2px y modulación sutil de 4px (eliminada la octava de 8px que creaba islas)
            const micro2px = periodicValueNoise(x, y, 2, 303);
            const subtle4px = periodicValueNoise(x, y, 4, 202);

            // Fibra fina de papel de alta frecuencia (32 y 28 ciclos cada 256px)
            const f1 = Math.sin((32 * x + 24 * y) * twoPiOver256) * 0.5 + 0.5;
            const f2 = Math.cos((24 * x - 32 * y) * twoPiOver256) * 0.5 + 0.5;
            const fiber = f1 * 0.5 + f2 * 0.5;

            // 55% blue-noise 1px + 25% micro 2px + 10% fibra + 10% variación 4px
            raw[idx] = blueGrain * 0.55 + micro2px * 0.25 + fiber * 0.10 + subtle4px * 0.10;
        }
    }

    // Rank-normalization a [0, 1)
    indices.sort((a, b) => raw[a] - raw[b]);

    const normalized = new Float32Array(total);
    const invTotal = 1 / total;
    for (let rank = 0; rank < total; rank++) {
        normalized[indices[rank]] = rank * invTotal;
    }

    paperHeightField = normalized;
    return paperHeightField;
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
 * 2. Construye el Atlas de K=12 niveles con transición micro-suavizada en la cresta del grano
 * para evitar que los granos se vean como recortes duros desconectados.
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
    const dataUrls = new Array(ATLAS_LEVELS + 1).fill('');

    const isDoc = typeof document !== 'undefined' && typeof document.createElement === 'function';
    if (!isDoc) {
        return { patterns, dataUrls };
    }

    // Desde 18% de cobertura en el nivel 1 (para que nunca se corte a cero) hasta 96% en el nivel 12
    const minCoverage = 0.18;
    const maxCoverage = 0.96;
    const feather = 0.14; // Zona de penumbra en la ladera de cada poro del papel

    for (let k = 1; k <= ATLAS_LEVELS; k++) {
        const frac = (k - 1) / (ATLAS_LEVELS - 1);
        const threshold = minCoverage + frac * (maxCoverage - minCoverage);
        const softLimit = threshold + feather;

        const tile = document.createElement('canvas');
        tile.width = PAPER_SIZE;
        tile.height = PAPER_SIZE;
        const tCtx = tile.getContext('2d');
        if (!tCtx) continue;

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
                    // Centro del valle del papel: depósito firme
                    data[p + 3] = 255;
                } else {
                    // Ladera del poro: puente de grafito tenue que une los granos vecinos
                    const t = 1 - (hVal - threshold) / feather;
                    data[p + 3] = Math.round(t * t * 185);
                }
            }
        }

        tCtx.putImageData(imgData, 0, 0);

        if (ctx && typeof ctx.createPattern === 'function') {
            patterns[k] = ctx.createPattern(tile, 'repeat');
        }

        try {
            dataUrls[k] = tile.toDataURL('image/png');
        } catch {
            dataUrls[k] = '';
        }
    }

    const entry = { patterns, dataUrls };
    colorAtlasCache.set(key, entry);
    return entry;
}

function getStrokeSeed(points, style) {
    if (style && typeof style.seed === 'number') return style.seed | 0;
    if (!points || points.length === 0) return 1337;
    const p0 = points[0];
    return (Math.imul(Math.round(p0.x * 100), 73856093) ^ Math.imul(Math.round(p0.y * 100), 19349663)) | 0;
}

/**
 * 3. Acondicionamiento Incremental por Longitud de Arco (ds = 0.22 * w)
 */
export function conditionStrokeByArcLength(rawPoints, baseWidth, seed) {
    if (!rawPoints || rawPoints.length === 0) return [];

    const ds = Math.max(0.45, 0.22 * baseWidth);
    const tau = Math.max(1.0, baseWidth);
    const alphaP = 1 - Math.exp(-ds / tau);

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

    let state = strokeConditionCache.get(rawPoints);
    if (!state || state.baseWidth !== baseWidth || state.seed !== seed || rawPoints.length < state.rawCount) {
        const p0 = rawPoints[0];
        const initP = p0.pressure !== undefined && p0.pressure > 0 ? p0.pressure : 0.5;
        state = {
            baseWidth,
            seed,
            rawCount: 1,
            lastAnchorX: p0.x,
            lastAnchorY: p0.y,
            lastAnchorP: initP,
            emaP: initP,
            remDist: 0,
            confirmedSteps: [{
                x: p0.x,
                y: p0.y,
                nx: 0,
                ny: -1,
                p: initP,
                stepIndex: 0,
            }],
        };
        strokeConditionCache.set(rawPoints, state);
    }

    const emitQuadraticSegment = (ax0, ay0, ap0, cx, cy, cp, ax1, ay1, ap1, targetArray, stateObj) => {
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
                const ux = dx / segLen;
                const uy = dy / segLen;
                const nx = -uy;
                const ny = ux;

                let cursor = ds - stateObj.remDist;
                while (cursor <= segLen) {
                    const frac = cursor / segLen;
                    const sx = prevX + dx * frac;
                    const sy = prevY + dy * frac;
                    const sp = prevP + (bp - prevP) * frac;

                    stateObj.emaP += (sp - stateObj.emaP) * alphaP;
                    const stepIdx = targetArray.length;

                    targetArray.push({
                        x: sx,
                        y: sy,
                        nx,
                        ny,
                        p: stateObj.emaP,
                        stepIndex: stepIdx,
                    });

                    cursor += ds;
                }
                stateObj.remDist = segLen - (cursor - ds);
            }

            prevX = bx;
            prevY = by;
            prevP = bp;
        }
    };

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

        emitQuadraticSegment(
            state.lastAnchorX, state.lastAnchorY, state.lastAnchorP,
            curr.x, curr.y, cp,
            midX, midY, midP,
            state.confirmedSteps,
            state
        );

        state.lastAnchorX = midX;
        state.lastAnchorY = midY;
        state.lastAnchorP = midP;
        state.rawCount++;
    }

    const finalSteps = state.confirmedSteps.slice();
    const tailState = {
        emaP: state.emaP,
        remDist: state.remDist,
    };

    const lastPt = rawPoints[rawPoints.length - 1];
    const lastP = lastPt.pressure !== undefined && lastPt.pressure > 0 ? lastPt.pressure : 0.5;

    emitQuadraticSegment(
        state.lastAnchorX, state.lastAnchorY, state.lastAnchorP,
        (state.lastAnchorX + lastPt.x) * 0.5, (state.lastAnchorY + lastPt.y) * 0.5, (state.lastAnchorP + lastP) * 0.5,
        lastPt.x, lastPt.y, lastP,
        finalSteps,
        tailState
    );

    if (finalSteps.length > 1) {
        finalSteps[0].nx = finalSteps[1].nx;
        finalSteps[0].ny = finalSteps[1].ny;
    }

    return finalSteps;
}

/**
 * 4 Cintas Concéntricas para caída gaussiana suave desde el núcleo hacia los bordes:
 * - Tier 0: Polvo exterior difuso (erosiona el contorno)
 * - Tier 1: Cuerpo medio-bajo
 * - Tier 2: Cuerpo medio-alto
 * - Tier 3: Espina dorsal del núcleo (garantiza que los trazos finos nunca se corten)
 */
const RIBBON_TIERS = [
    { widthFactor: 1.18, levelProfile: 0.32, minK: 1, jitterScale: 0.30, salt: 11 },
    { widthFactor: 0.88, levelProfile: 0.60, minK: 2, jitterScale: 0.18, salt: 29 },
    { widthFactor: 0.58, levelProfile: 0.85, minK: 4, jitterScale: 0.09, salt: 53 },
    { widthFactor: 0.30, levelProfile: 1.05, minK: 6, jitterScale: 0.03, salt: 79 },
];

export function buildLevelRuns(steps, baseWidth, seed) {
    const runsByLevel = Array.from({ length: ATLAS_LEVELS + 1 }, () => []);
    if (!steps || steps.length < 2) return runsByLevel;

    const n = steps.length;
    const leftX = new Float32Array(n);
    const leftY = new Float32Array(n);
    const rightX = new Float32Array(n);
    const rightY = new Float32Array(n);
    const stepLevels = new Uint8Array(n);

    for (let t = 0; t < RIBBON_TIERS.length; t++) {
        const tier = RIBBON_TIERS[t];

        for (let i = 0; i < n; i++) {
            const s = steps[i];
            const pNorm = Math.max(0.08, Math.min(1, Math.pow(s.p, 0.80)));
            const w_i = baseWidth * tier.widthFactor * (0.55 + 0.75 * pNorm);

            // Dithering transversal suave de 2 pasos promediados para borde orgánico sin picos
            const r1a = prngStep(seed, s.stepIndex, tier.salt) - 0.5;
            const r1b = prngStep(seed, s.stepIndex + 1, tier.salt) - 0.5;
            const r2a = prngStep(seed, s.stepIndex, tier.salt + 7) - 0.5;
            const r2b = prngStep(seed, s.stepIndex + 1, tier.salt + 7) - 0.5;

            const r1 = r1a + r1b;
            const r2 = r2a + r2b;

            // El núcleo tiene un ancho mínimo de 0.45px para que los trazos finos sean continuos
            const minHalf = t === 3 ? 0.45 : 0.22;
            const halfL = Math.max(minHalf, w_i * 0.5 * (1 + r1 * tier.jitterScale));
            const halfR = Math.max(minHalf, w_i * 0.5 * (1 + r2 * tier.jitterScale));

            leftX[i] = s.x + s.nx * halfL;
            leftY[i] = s.y + s.ny * halfL;
            rightX[i] = s.x - s.nx * halfR;
            rightY[i] = s.y - s.ny * halfR;

            const rawLevel = Math.round(ATLAS_LEVELS * pNorm * tier.levelProfile);
            stepLevels[i] = Math.max(tier.minK, Math.min(ATLAS_LEVELS, rawLevel));
        }

        let runStart = 0;
        let currentK = stepLevels[0];

        const flushRun = (startIdx, endIdx, k) => {
            if (endIdx <= startIdx) return;
            const count = (endIdx - startIdx + 1) * 4;
            const poly = new Float32Array(count);
            let ptr = 0;
            for (let j = startIdx; j <= endIdx; j++) {
                poly[ptr++] = leftX[j];
                poly[ptr++] = leftY[j];
            }
            for (let j = endIdx; j >= startIdx; j--) {
                poly[ptr++] = rightX[j];
                poly[ptr++] = rightY[j];
            }
            runsByLevel[k].push(poly);
        };

        for (let i = 1; i < n; i++) {
            const k = stepLevels[i];
            if (k !== currentK) {
                flushRun(runStart, i, currentK);
                runStart = i;
                currentK = k;
            }
        }
        flushRun(runStart, n - 1, currentK);
    }

    return runsByLevel;
}

export function renderCanvas(ctx, points, style) {
    if (!points || points.length === 0) return;

    const baseWidth = Math.max(1, style.width || 3);
    const color = style.color || '#2b2b2b';
    const opacity = style.opacity !== undefined ? style.opacity : 0.90;
    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;

    const seed = getStrokeSeed(points, style);
    const steps = conditionStrokeByArcLength(points, baseWidth, seed);
    const atlas = getOrCreateGrainAtlas(ctx, color, dpr);

    ctx.save();
    ctx.globalAlpha = opacity;

    if (steps.length < 2) {
        const s0 = steps[0];
        const k = Math.max(3, Math.min(ATLAS_LEVELS, Math.round(ATLAS_LEVELS * s0.p * 0.85)));
        ctx.fillStyle = atlas.patterns[k] || color;
        ctx.beginPath();
        ctx.arc(s0.x, s0.y, Math.max(0.8, baseWidth * (0.4 + 0.5 * s0.p)), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
    }

    const runsByLevel = buildLevelRuns(steps, baseWidth, seed);

    for (let k = 1; k <= ATLAS_LEVELS; k++) {
        const polys = runsByLevel[k];
        if (!polys || polys.length === 0) continue;

        ctx.fillStyle = atlas.patterns[k] || color;
        ctx.beginPath();
        for (let p = 0; p < polys.length; p++) {
            const poly = polys[p];
            ctx.moveTo(poly[0], poly[1]);
            for (let j = 2; j < poly.length; j += 2) {
                ctx.lineTo(poly[j], poly[j + 1]);
            }
            ctx.closePath();
        }
        ctx.fill('nonzero');
    }

    ctx.restore();
}

export const renderPen = renderCanvas;

export function renderSvg(points, style) {
    if (!points || points.length === 0) return { defs: {}, body: '' };

    const baseWidth = Math.max(1, style.width || 3);
    const color = style.color || '#2b2b2b';
    const opacity = style.opacity !== undefined ? style.opacity : 0.90;
    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;

    const seed = getStrokeSeed(points, style);
    const steps = conditionStrokeByArcLength(points, baseWidth, seed);
    const atlas = getOrCreateGrainAtlas(null, color, dpr);

    const colorSlug = color.replace(/[^a-zA-Z0-9]/g, '');
    const tileCssSize = PAPER_SIZE;
    const f = (n) => (Math.round(n * 10) / 10).toString();

    const defs = {};
    const registerPatternDef = (k) => {
        const patId = `apolo-grain-${colorSlug}-k${k}`;
        const href = atlas.dataUrls[k];
        if (href && !defs[patId]) {
            defs[patId] =
                `<pattern id="${patId}" patternUnits="userSpaceOnUse" width="${tileCssSize}" height="${tileCssSize}">` +
                `<image href="${href}" width="${tileCssSize}" height="${tileCssSize}"/>` +
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

    const runsByLevel = buildLevelRuns(steps, baseWidth, seed);
    let pathsHtml = '';

    for (let k = 1; k <= ATLAS_LEVELS; k++) {
        const polys = runsByLevel[k];
        if (!polys || polys.length === 0) continue;

        let d = '';
        for (let p = 0; p < polys.length; p++) {
            const poly = polys[p];
            d += `M${f(poly[0])} ${f(poly[1])}`;
            for (let j = 2; j < poly.length; j += 2) {
                d += `L${f(poly[j])} ${f(poly[j + 1])}`;
            }
            d += 'Z';
        }

        const fillRef = registerPatternDef(k);
        pathsHtml += `<path d="${d}" fill="${fillRef}"/>`;
    }

    const body = `<g fill-rule="nonzero" fill-opacity="${opacity.toFixed(2)}" stroke="none">${pathsHtml}</g>`;
    return { defs, body };
}

if (typeof globalThis !== 'undefined') {
    globalThis.ApoloSandbox = globalThis.ApoloSandbox || { pens: {}, engines: {} };
    globalThis.ApoloSandbox.pens['pencil-atlas'] = {
        id,
        name,
        description,
        renderPen,
        renderCanvas,
        renderSvg,
        getPaperHeightField,
        getOrCreateGrainAtlas,
        conditionStrokeByArcLength,
    };
}