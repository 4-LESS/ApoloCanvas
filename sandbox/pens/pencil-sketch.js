/**
 * sandbox/pens/pencil-sketch.js
 *
 * Lápiz 8 · Vector Sketch (Híbrido Vector + Grano Dual)
 *
 * Diseñado bajo orden estricto de prioridades:
 * 1. RENDIMIENTO (120 FPS en trazos largos):
 *    Exactamente 3 llamadas de dibujo por trazo (O(1) draw calls) + diezmado adaptativo
 *    al grosor:
 *      - Capa 1: Cinta exterior porosa con tapas semicirculares (1 fill nonzero).
 *      - Capa 2: Núcleo de grafito sensible a la presión local (1 fill nonzero).
 *      - Capa 3: Filamentos secos de borde en 1 solo path continuo (1 stroke con dash primo).
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
export const description = 'Iteración 12: Híbrido vectorial de 3 pasadas O(1): doble cinta con grano de papel 128x128, filamentos secos y paridad 1:1 Canvas/SVG a cualquier grosor';

const TILE_SIZE = 128;
const TILE_MASK = TILE_SIZE - 1;

let cachedPaperField = null;
const patternCache = new Map();
const geometryCache = new WeakMap();

/**
 * Hash entero determinista [0, 1) sin estado global.
 */
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

/**
 * Genera el campo de altitud toroidal del papel (128x128) combinando:
 * - Fibra celulósica media (radio 2)
 * - Grano fino de poro (radio 1)
 * - Micro-asperidad directa (radio 0)
 * Rank-normalized en [0, 1) para garantizar control exacto de cobertura.
 */
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

/**
 * Construye y cachea los 2 patrones complementarios de grafito por color:
 * - coarse: cobertura porosa (~48%) con penumbra suave en las crestas del papel.
 * - core: cobertura densa (~82%) para el núcleo donde la mina apoya con firmeza.
 */
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
                    url = c.toDataURL('image/png');
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

    // Escala suave del grano según el grosor (trazos gruesos muestran poro ligeramente más amplio)
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

/**
 * Curva de presión ergonómica para lápiz de grafito
 */
function pencilPressureResponse(rawP) {
    const p = rawP !== undefined && !isNaN(rawP) && rawP > 0 ? Math.max(0.05, Math.min(1, rawP)) : 0.5;
    return Math.pow(p, 0.78);
}

/**
 * Construye una cinta poligonal cerrada con tapas semicirculares en ambos extremos
 * para que a cualquier grosor (incluso 40px) las puntas sean redondas y orgánicas.
 */
function buildRoundedRibbonPolygon(spine, halfWidthsL, halfWidthsR) {
    const n = spine.length;
    if (n < 2) return new Float32Array(0);

    const capSteps = 5;
    // Total de vértices: n izquierda + (capSteps - 1) tapa final + n derecha + (capSteps - 1) tapa inicial
    const totalVerts = n * 2 + (capSteps - 1) * 2;
    const poly = new Float32Array(totalVerts * 2);
    let ptr = 0;

    // 1. Borde izquierdo de inicio a fin
    for (let i = 0; i < n; i++) {
        const pt = spine[i];
        const hw = halfWidthsL[i];
        poly[ptr++] = pt.x + pt.nx * hw;
        poly[ptr++] = pt.y + pt.ny * hw;
    }

    // 2. Tapa semicircular final (de +normal a -normal pasando por +tangente)
    const last = spine[n - 1];
    const txEnd = last.ny;
    const tyEnd = -last.nx;
    const rEnd = (halfWidthsL[n - 1] + halfWidthsR[n - 1]) * 0.5;
    for (let c = 1; c < capSteps; c++) {
        const theta = (c / capSteps) * Math.PI;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        poly[ptr++] = last.x + (last.nx * cosT + txEnd * sinT) * rEnd;
        poly[ptr++] = last.y + (last.ny * cosT + tyEnd * sinT) * rEnd;
    }

    // 3. Borde derecho de fin a inicio
    for (let i = n - 1; i >= 0; i--) {
        const pt = spine[i];
        const hw = halfWidthsR[i];
        poly[ptr++] = pt.x - pt.nx * hw;
        poly[ptr++] = pt.y - pt.ny * hw;
    }

    // 4. Tapa semicircular inicial (de -normal a +normal pasando por -tangente)
    const first = spine[0];
    const txStart = -first.ny;
    const tyStart = first.nx;
    const rStart = (halfWidthsL[0] + halfWidthsR[0]) * 0.5;
    for (let c = 1; c < capSteps; c++) {
        const theta = (c / capSteps) * Math.PI;
        const cosT = -Math.cos(theta);
        const sinT = Math.sin(theta);
        poly[ptr++] = first.x + (first.nx * cosT + txStart * sinT) * rStart;
        poly[ptr++] = first.y + (first.ny * cosT + tyStart * sinT) * rStart;
    }

    return poly;
}

/**
 * Prepara la espina dorsal suavizada y las 3 capas geométricas del lápiz.
 * Usa diezmado adaptativo al grosor para impedir auto-intersecciones y espinas en trazos anchos.
 */
export function buildSketchGeometry(rawPoints, baseWidth) {
    if (!rawPoints || rawPoints.length === 0) return null;

    const cached = geometryCache.get(rawPoints);
    if (cached && cached.rawLength === rawPoints.length && cached.baseWidth === baseWidth) {
        return cached;
    }

    const seed =
        (Math.imul(Math.round(rawPoints[0].x * 100), 73856093) ^
            Math.imul(Math.round(rawPoints[0].y * 100), 19349663)) |
        0;

    // Paso mínimo proporcional al grosor: evita que puntos muy juntos con ancho 30-40px creen picos
    const minDist = Math.max(1.3, baseWidth * 0.22);
    const filtered = [
        {
            x: rawPoints[0].x,
            y: rawPoints[0].y,
            p: pencilPressureResponse(rawPoints[0].pressure),
        },
    ];

    for (let i = 1; i < rawPoints.length; i++) {
        const pt = rawPoints[i];
        const prev = filtered[filtered.length - 1];
        const dist = Math.hypot(pt.x - prev.x, pt.y - prev.y);
        const pVal = pencilPressureResponse(pt.pressure);

        if (dist >= minDist) {
            filtered.push({
                x: pt.x,
                y: pt.y,
                p: prev.p * 0.35 + pVal * 0.65,
            });
        } else if (i === rawPoints.length - 1 && dist > 0.15) {
            // Para el último punto muy cercano, actualizamos suavemente el extremo sin crear un escalón brusco
            if (filtered.length === 1) {
                filtered.push({ x: pt.x, y: pt.y, p: pVal });
            } else {
                prev.x = prev.x * 0.4 + pt.x * 0.6;
                prev.y = prev.y * 0.4 + pt.y * 0.6;
                prev.p = prev.p * 0.5 + pVal * 0.5;
            }
        }
    }

    if (filtered.length === 1) {
        const p0 = filtered[0];
        const result = {
            rawLength: rawPoints.length,
            baseWidth,
            isSinglePoint: true,
            x: p0.x,
            y: p0.y,
            outerRadius: Math.max(0.8, baseWidth * (0.38 + 0.28 * p0.p)),
            coreRadius: Math.max(0.45, baseWidth * (0.20 + 0.25 * p0.p)),
        };
        geometryCache.set(rawPoints, result);
        return result;
    }

    // Subdivisión por puntos medios (Chaikin cuadrático de 1 paso) para curvas limpias al hacer zoom
    const spine = [];
    spine.push({ x: filtered[0].x, y: filtered[0].y, p: filtered[0].p, nx: 0, ny: -1 });

    for (let i = 0; i < filtered.length - 1; i++) {
        const a = filtered[i];
        const b = filtered[i + 1];
        const mx = (a.x + b.x) * 0.5;
        const my = (a.y + b.y) * 0.5;
        const mp = (a.p + b.p) * 0.5;

        if (i > 0) {
            spine.push({
                x: (spine[spine.length - 1].x + a.x) * 0.5,
                y: (spine[spine.length - 1].y + a.y) * 0.5,
                p: (spine[spine.length - 1].p + a.p) * 0.5,
                nx: 0,
                ny: -1,
            });
        }
        spine.push({ x: mx, y: my, p: mp, nx: 0, ny: -1 });
    }

    const lastF = filtered[filtered.length - 1];
    spine.push({ x: lastF.x, y: lastF.y, p: lastF.p, nx: 0, ny: -1 });

    const n = spine.length;

    // Cálculo de normales unitarias primero por diferencia central
    const rawNx = new Float32Array(n);
    const rawNy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const prev = spine[Math.max(0, i - 1)];
        const next = spine[Math.min(n - 1, i + 1)];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        rawNx[i] = -dy / len;
        rawNy[i] = dx / len;
    }

    // Filtro de suavizado de normales (ventana 3) para evitar auto-intersecciones en curvas cerradas con grosor alto
    for (let i = 0; i < n; i++) {
        const i0 = Math.max(0, i - 1);
        const i2 = Math.min(n - 1, i + 1);
        const sx = rawNx[i0] * 0.25 + rawNx[i] * 0.5 + rawNx[i2] * 0.25;
        const sy = rawNy[i0] * 0.25 + rawNy[i] * 0.5 + rawNy[i2] * 0.25;
        const len = Math.hypot(sx, sy) || 1;
        spine[i].nx = sx / len;
        spine[i].ny = sy / len;
    }

    const outerL = new Float32Array(n);
    const outerR = new Float32Array(n);
    const coreL = new Float32Array(n);
    const coreR = new Float32Array(n);
    const strandLeft = new Float32Array(n * 2);
    const strandRight = new Float32Array(n * 2);

    for (let i = 0; i < n; i++) {
        const pt = spine[i];
        // Ruido de borde filtrado por media móvil de 3 pasos (orgánico pero sin dientes de sierra)
        const nL =
            (hash1D(i - 1, seed + 13) + hash1D(i, seed + 13) * 2 + hash1D(i + 1, seed + 13)) * 0.25 - 0.5;
        const nR =
            (hash1D(i - 1, seed + 47) + hash1D(i, seed + 47) * 2 + hash1D(i + 1, seed + 47)) * 0.25 - 0.5;

        // Ancho exterior responde suavemente a la presión: [0.68 .. 1.16] * baseWidth
        const outerHalf = baseWidth * 0.5 * (0.68 + 0.48 * pt.p);
        outerL[i] = Math.max(0.4, outerHalf * (1 + nL * 0.16));
        outerR[i] = Math.max(0.4, outerHalf * (1 + nR * 0.16));

        // El núcleo interior se concentra cuando la presión es leve y se expande al apoyar fuerte
        const coreRatio = 0.34 + 0.42 * pt.p;
        const coreHalf = outerHalf * coreRatio;
        coreL[i] = Math.max(0.28, coreHalf * (1 + nR * 0.10));
        coreR[i] = Math.max(0.28, coreHalf * (1 + nL * 0.10));

        // Hebras secas de grafito a ~78% del borde exterior para dar definición fibrosa al contorno
        const sL = outerL[i] * 0.78;
        const sR = outerR[i] * 0.78;
        strandLeft[i * 2] = pt.x + pt.nx * sL;
        strandLeft[i * 2 + 1] = pt.y + pt.ny * sL;
        strandRight[i * 2] = pt.x - pt.nx * sR;
        strandRight[i * 2 + 1] = pt.y - pt.ny * sR;
    }

    const outerPoly = buildRoundedRibbonPolygon(spine, outerL, outerR);
    const corePoly = buildRoundedRibbonPolygon(spine, coreL, coreR);

    const filamentWidth = Math.max(0.55, Math.min(3.2, baseWidth * 0.11));
    const dashUnit = Math.max(1.8, baseWidth * 0.85);
    const filamentDash = [
        Math.round(dashUnit * 2.3 * 10) / 10,
        Math.round(dashUnit * 1.4 * 10) / 10,
        Math.round(dashUnit * 0.8 * 10) / 10,
        Math.round(dashUnit * 1.9 * 10) / 10,
    ];

    const result = {
        rawLength: rawPoints.length,
        baseWidth,
        isSinglePoint: false,
        outerPoly,
        corePoly,
        strandLeft,
        strandRight,
        filamentWidth,
        filamentDash,
    };

    geometryCache.set(rawPoints, result);
    return result;
}

function tracePolygonOnCtx(ctx, poly) {
    if (!poly || poly.length < 4) return;
    ctx.moveTo(poly[0], poly[1]);
    for (let i = 2; i < poly.length; i += 2) {
        ctx.lineTo(poly[i], poly[i + 1]);
    }
    ctx.closePath();
}

function tracePolylineOnCtx(ctx, coords) {
    if (!coords || coords.length < 4) return;
    ctx.moveTo(coords[0], coords[1]);
    for (let i = 2; i < coords.length; i += 2) {
        ctx.lineTo(coords[i], coords[i + 1]);
    }
}

/**
 * Renderizado en Canvas 2D — Exactamente 3 llamadas de dibujo O(1)
 */
export function renderCanvas(ctx, points, style) {
    if (!points || points.length === 0) return;

    const baseWidth = Math.max(1, style.width || 3);
    const color = style.color || '#2b2b2b';
    const opacity = style.opacity !== undefined ? style.opacity : 0.88;

    const geom = buildSketchGeometry(points, baseWidth);
    if (!geom) return;

    const grain = getGrainPatterns(ctx, color, baseWidth);

    ctx.save();

    if (geom.isSinglePoint) {
        ctx.globalAlpha = opacity * 0.62;
        ctx.fillStyle = grain.coarsePattern;
        ctx.beginPath();
        ctx.arc(geom.x, geom.y, geom.outerRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = opacity * 0.90;
        ctx.fillStyle = grain.corePattern;
        ctx.beginPath();
        ctx.arc(geom.x, geom.y, geom.coreRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
        return;
    }

    // Pasada 1: Cuerpo poroso exterior (textura de diente de papel abierto)
    ctx.globalAlpha = opacity * 0.62;
    ctx.fillStyle = grain.coarsePattern;
    ctx.beginPath();
    tracePolygonOnCtx(ctx, geom.outerPoly);
    ctx.fill('nonzero');

    // Pasada 2: Núcleo de grafito sensible a la presión (textura densa en valles)
    ctx.globalAlpha = opacity * 0.92;
    ctx.fillStyle = grain.corePattern;
    ctx.beginPath();
    tracePolygonOnCtx(ctx, geom.corePoly);
    ctx.fill('nonzero');

    // Pasada 3: Filamentos secos de borde (1 solo stroke continuo con dash primo)
    ctx.globalAlpha = opacity * 0.34;
    ctx.strokeStyle = color;
    ctx.lineWidth = geom.filamentWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (typeof ctx.setLineDash === 'function') {
        ctx.setLineDash(geom.filamentDash);
    }
    ctx.beginPath();
    tracePolylineOnCtx(ctx, geom.strandLeft);
    tracePolylineOnCtx(ctx, geom.strandRight);
    ctx.stroke();

    ctx.restore();
}

export const renderPen = renderCanvas;

/**
 * Renderizado en SVG Vector — Equivalencia 1:1 con renderCanvas (misma geometría y patrones PNG)
 */
export function renderSvg(points, style) {
    if (!points || points.length === 0) return { defs: {}, body: '' };

    const baseWidth = Math.max(1, style.width || 3);
    const color = style.color || '#2b2b2b';
    const opacity = style.opacity !== undefined ? style.opacity : 0.88;

    const geom = buildSketchGeometry(points, baseWidth);
    if (!geom) return { defs: {}, body: '' };

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

    if (geom.isSinglePoint) {
        const body =
            `<g stroke="none">` +
            `<circle cx="${f(geom.x)}" cy="${f(geom.y)}" r="${f(geom.outerRadius)}" fill="${coarseFill}" fill-opacity="${(opacity * 0.62).toFixed(2)}"/>` +
            `<circle cx="${f(geom.x)}" cy="${f(geom.y)}" r="${f(geom.coreRadius)}" fill="${coreFill}" fill-opacity="${(opacity * 0.90).toFixed(2)}"/>` +
            `</g>`;
        return { defs, body };
    }

    const polyToD = (poly) => {
        if (!poly || poly.length < 4) return '';
        let d = `M${f(poly[0])} ${f(poly[1])}`;
        for (let i = 2; i < poly.length; i += 2) {
            d += `L${f(poly[i])} ${f(poly[i + 1])}`;
        }
        return d + 'Z';
    };

    const polylineToD = (coords) => {
        if (!coords || coords.length < 4) return '';
        let d = `M${f(coords[0])} ${f(coords[1])}`;
        for (let i = 2; i < coords.length; i += 2) {
            d += `L${f(coords[i])} ${f(coords[i + 1])}`;
        }
        return d;
    };

    const outerD = polyToD(geom.outerPoly);
    const coreD = polyToD(geom.corePoly);
    const strandsD = polylineToD(geom.strandLeft) + polylineToD(geom.strandRight);
    const dashAttr = geom.filamentDash.join(' ');

    const body =
        `<g>` +
        `<path d="${outerD}" fill="${coarseFill}" fill-rule="nonzero" fill-opacity="${(opacity * 0.62).toFixed(2)}" stroke="none"/>` +
        `<path d="${coreD}" fill="${coreFill}" fill-rule="nonzero" fill-opacity="${(opacity * 0.92).toFixed(2)}" stroke="none"/>` +
        `<path d="${strandsD}" fill="none" stroke="${color}" stroke-width="${f(geom.filamentWidth)}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${dashAttr}" stroke-opacity="${(opacity * 0.34).toFixed(2)}"/>` +
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
    };
}
