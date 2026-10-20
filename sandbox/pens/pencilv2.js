/**
 * sandbox/pens/pencil-atlas.js
 * 
 * Lápiz de Grafito Atlas (Ruta B: Un Modelo, Salida Dual Canvas/SVG)
 * 
 * Arquitectura:
 * 1. Campo de altura periódico H (256x256) rank-normalized en [0, 1): cobertura lineal exacta.
 * 2. Atlas de K=10 niveles anidados con alfa binario (idempotente: cero costuras entre tramos).
 * 3. Acondicionamiento por longitud de arco (ds = 0.25 * w) con EMA de presión sobre s y
 *    PRNG(seed, stepIndex) independiente de la tasa de muestreo del hardware.
 * 4. Paridad exacta Canvas <-> SVG mediante fusión de tramos por nivel k y <pattern> PNG,
 *    sin feTurbulence ni feDisplacementMap.
 * 
 * Contrato:
 * export function renderCanvas(ctx, points, style)
 * export function renderSvg(points, style)
 * export function renderPen(ctx, points, style)
 */

export const id = 'pencilv2';
export const name = 'Lápiz 7 · Atlas v1 (Binario K=10)';
export const description = 'Iteración 7: Campo H 256x256 Box-Blur rank-normalized con Atlas binario de K=10 niveles';

const PAPER_SIZE = 256;
const PAPER_MASK = PAPER_SIZE - 1;
const ATLAS_LEVELS = 10; // K niveles anidados

let paperHeightField = null; // Float32Array(65536) en [0, 1)
const colorAtlasCache = new Map(); // key: `${color}|${dpr}` -> { patterns[], dataUrls[], matrix }
const strokeConditionCache = new WeakMap(); // points ref -> conditioned steps cache

export function resetPencilAtlasCacheForTesting() {
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
 * Value-noise periódico en 2D sobre grilla de periodo `period` (potencia de 2)
 */
function periodicValueNoise(x, y, cellSize, seed) {
    const gridPeriod = PAPER_SIZE / cellSize;
    const gx = x / cellSize;
    const gy = y / cellSize;

    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;

    // Smoothstep cúbico
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
 * 1. Genera una sola vez el campo de altura del papel H (256x256) periódico y rank-normalized.
 * Así el conjunto { H < t } cubre exactamente la fracción t de píxeles del papel.
 */
export function getPaperHeightField() {
    if (paperHeightField) return paperHeightField;

    const total = PAPER_SIZE * PAPER_SIZE;
    const raw = new Float32Array(total);
    const indices = new Uint32Array(total);
    const twoPiOver256 = (Math.PI * 2) / PAPER_SIZE;

    for (let y = 0; y < PAPER_SIZE; y++) {
        for (let x = 0; x < PAPER_SIZE; x++) {
            const idx = y * PAPER_SIZE + x;
            indices[idx] = idx;

            // 3 octavas de value-noise estrictamente periódicas en 256
            const oct1 = periodicValueNoise(x, y, 8, 101);
            const oct2 = periodicValueNoise(x, y, 4, 202);
            const oct3 = periodicValueNoise(x, y, 2, 303);
            const fine = prngStep(404, idx, 7);

            // Componente de fibra anisotrópica periódica (armónicos enteros de 2*PI/256: cero costuras)
            const f1 = Math.sin((18 * x + 12 * y) * twoPiOver256) * 0.5 + 0.5;
            const f2 = Math.cos((14 * x - 20 * y) * twoPiOver256) * 0.5 + 0.5;
            const fiber = f1 * 0.55 + f2 * 0.45;

            raw[idx] = oct1 * 0.30 + oct2 * 0.28 + oct3 * 0.18 + fine * 0.12 + fiber * 0.12;
        }
    }

    // Rank-normalization exacta: ordenar índices por valor y asignar rango uniforme [0, 1)
    indices.sort((a, b) => raw[a] - raw[b]);

    const normalized = new Float32Array(total);
    const invTotal = 1 / total;
    for (let rank = 0; rank < total; rank++) {
        normalized[indices[rank]] = rank * invTotal;
    }

    paperHeightField = normalized;
    return paperHeightField;
}

/**
 * Convierte cualquier string de color CSS a [R, G, B]
 */
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
 * 2. Construye y cachea el Atlas de K niveles anidados (alfa BINARIO: H < k/K)
 * para un color dado, a resolución de dispositivo (escalado por 1/dpr).
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

    // Factor de cobertura máxima del grafito (deja un ~8% de micro-poro incluso a tope de presión)
    const maxCoverage = 0.92;

    for (let k = 1; k <= ATLAS_LEVELS; k++) {
        const threshold = (k / ATLAS_LEVELS) * maxCoverage;
        const tile = document.createElement('canvas');
        tile.width = PAPER_SIZE;
        tile.height = PAPER_SIZE;
        const tCtx = tile.getContext('2d');
        if (!tCtx) continue;

        const imgData = tCtx.createImageData(PAPER_SIZE, PAPER_SIZE);
        const data = imgData.data;

        for (let i = 0; i < H.length; i++) {
            if (H[i] < threshold) {
                const p = i * 4;
                data[p] = r;
                data[p + 1] = g;
                data[p + 2] = b;
                data[p + 3] = 255; // Alfa BINARIO (idempotente al sobreponer tramos y cintas)
            }
        }

        tCtx.putImageData(imgData, 0, 0);

        if (ctx && typeof ctx.createPattern === 'function') {
            const pat = ctx.createPattern(tile, 'repeat');
            if (pat && typeof pat.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
                pat.setTransform(new DOMMatrix().scale(1 / dpr, 1 / dpr));
            }
            patterns[k] = pat;
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

/**
 * Semilla determinista por trazo derivada del primer punto (o style.seed si existe)
 */
function getStrokeSeed(points, style) {
    if (style && typeof style.seed === 'number') return style.seed | 0;
    if (!points || points.length === 0) return 1337;
    const p0 = points[0];
    return (Math.imul(Math.round(p0.x * 100), 73856093) ^ Math.imul(Math.round(p0.y * 100), 19349663)) | 0;
}

/**
 * 3. Acondicionamiento Incremental por Longitud de Arco:
 * - Suavizado por puntos medios cuadráticos sobre las muestras crudas.
 * - Remuestreo uniforme cada ds = 0.25 * w.
 * - EMA de presión sobre s con constante de espacio tau = w.
 * - Guarda estado incremental sobre el array `points` para no recalcular pasos previos.
 */
export function conditionStrokeByArcLength(rawPoints, baseWidth, seed) {
    if (!rawPoints || rawPoints.length === 0) return [];

    const ds = Math.max(0.5, 0.25 * baseWidth);
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

    // Construir nodos de control de la cadena cuadrática de puntos medios
    // Nota: El último tramo hasta rawPoints[N-1] es provisorio mientras el trazo está vivo;
    // cacheamos todos los tramos cuadráticos confirmados hasta rawPoints.length - 2.
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

    // Emitir pasos a lo largo de una curva cuadrática B(t) desde A0 -> Ctrl -> A1
    const emitQuadraticSegment = (ax0, ay0, ap0, cx, cy, cp, ax1, ay1, ap1, targetArray, stateObj) => {
        // Subdividimos en 4 cuerdas lineales cortas para parametrizar longitud de arco exacta y rápida
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

    // Procesar incrementalmente los puntos intermedios ya confirmados (hasta length - 2)
    const maxConfirmedIdx = rawPoints.length - 2;
    while (state.rawCount <= maxConfirmedIdx) {
        const i = state.rawCount;
        const curr = rawPoints[i];
        const next = rawPoints[i + 1];
        const cp = curr.pressure !== undefined && curr.pressure > 0 ? curr.pressure : 0.5;
        const np = next.pressure !== undefined && next.pressure > 0 ? next.pressure : 0.5;

        const midX = (curr.x + next.x) * 0.5;
        const midY = (curr.y + curr.y !== undefined ? (curr.y + next.y) * 0.5 : curr.y);
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

    // Clonar estado superficialmente para emitir el tramo final hacia el último punto en vivo
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

    // Corregir la normal del paso 0 usando el paso 1 si existe
    if (finalSteps.length > 1) {
        finalSteps[0].nx = finalSteps[1].nx;
        finalSteps[0].ny = finalSteps[1].ny;
    }

    return finalSteps;
}

/**
 * Configuración de las 3 cintas anidadas (Exterior, Medio, Núcleo):
 * - widthFactor: {1.2, 0.9, 0.5}
 * - levelProfile: factor multiplicador sobre K * P_tramo (exterior bajo, núcleo alto)
 * - jitterScale: erosión transversal determinista por paso s_i
 */
const RIBBON_TIERS = [
    { widthFactor: 1.20, levelProfile: 0.42, jitterScale: 0.22, salt: 11 }, // Exterior (erosiona el borde)
    { widthFactor: 0.90, levelProfile: 0.72, jitterScale: 0.12, salt: 29 }, // Medio (cuerpo fibroso)
    { widthFactor: 0.50, levelProfile: 1.00, jitterScale: 0.05, salt: 53 }, // Núcleo (contacto denso)
];

/**
 * Construye los tramos de cintas fusionando pasos contiguos con igual nivel k in [1..K].
 * Usado de manera idéntica por renderCanvas y renderSvg (paridad 100%).
 */
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
            // Curva de presión local suave
            const pNorm = Math.max(0.05, Math.min(1, Math.pow(s.p, 0.85)));
            const w_i = baseWidth * tier.widthFactor * (0.58 + 0.72 * pNorm);

            // Ruido f(seed, stepIndex) -> jamás hierve al agregar nuevos puntos
            const r1 = (prngStep(seed, s.stepIndex, tier.salt) - 0.5) * 2;
            const r2 = (prngStep(seed, s.stepIndex, tier.salt + 7) - 0.5) * 2;

            const halfL = Math.max(0.2, w_i * 0.5 * (1 + r1 * tier.jitterScale));
            const halfR = Math.max(0.2, w_i * 0.5 * (1 + r2 * tier.jitterScale));

            leftX[i] = s.x + s.nx * halfL;
            leftY[i] = s.y + s.ny * halfL;
            rightX[i] = s.x - s.nx * halfR;
            rightY[i] = s.y - s.ny * halfR;

            // Cuantización del nivel k con histéresis implícita por tramo
            const rawLevel = Math.round(ATLAS_LEVELS * pNorm * tier.levelProfile);
            stepLevels[i] = Math.max(1, Math.min(ATLAS_LEVELS, rawLevel));
        }

        // Fusionar pasos contiguos con el mismo nivel k en un único polígono cerrado
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
                // Solapamos el índice de frontera (i) para unión geométrica continua;
                // como el alfa del Atlas es binario, el solapamiento tiene cero doble oscurecimiento
                flushRun(runStart, i, currentK);
                runStart = i;
                currentK = k;
            }
        }
        flushRun(runStart, n - 1, currentK);
    }

    return runsByLevel;
}

/**
 * Renderiza el trazo en Canvas 2D usando el Atlas de K niveles anidados
 */
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

    // Caso trazo puntual (tap)
    if (steps.length < 2) {
        const s0 = steps[0];
        const k = Math.max(1, Math.min(ATLAS_LEVELS, Math.round(ATLAS_LEVELS * s0.p * 0.85)));
        ctx.fillStyle = atlas.patterns[k] || color;
        ctx.beginPath();
        ctx.arc(s0.x, s0.y, Math.max(0.8, baseWidth * (0.4 + 0.5 * s0.p)), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
    }

    const runsByLevel = buildLevelRuns(steps, baseWidth, seed);

    // Un único fill() por cada nivel k activo -> mínimo overhead de llamadas a Canvas2D
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

/**
 * 6. Exportación SVG con paridad 100% exacta y CERO filtros (<feTurbulence> eliminado):
 * Usa exactamente las mismas cintas agrupadas por nivel k y define <pattern> compartidos.
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

    const colorSlug = color.replace(/[^a-zA-Z0-9]/g, '');
    const tileCssSize = Math.round((PAPER_SIZE / dpr) * 100) / 100;
    const f = (n) => (Math.round(n * 10) / 10).toString();

    const defs = {};
    const registerPatternDef = (k) => {
        const patId = `apolo-grain-${colorSlug}-k${k}`;
        const href = atlas.dataUrls[k];
        if (href && !defs[patId]) {
            defs[patId] =
                `<pattern id="${patId}" patternUnits="userSpaceOnUse" width="${tileCssSize}" height="${tileCssSize}">` +
                `<image href="${href}" width="${tileCssSize}" height="${tileCssSize}" image-rendering="pixelated"/>` +
                `</pattern>`;
        }
        return href ? `url(#${patId})` : color;
    };

    if (steps.length < 2) {
        const s0 = steps[0];
        const k = Math.max(1, Math.min(ATLAS_LEVELS, Math.round(ATLAS_LEVELS * s0.p * 0.85)));
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

// Registro global automático para el Sandbox
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