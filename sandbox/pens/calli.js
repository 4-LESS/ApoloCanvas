/**
 * sandbox/pens/calli.js
 * 
 * Caligráfica (Calligraphy Chisel Pen) - O(1) Incremental Chunk Baking
 */

export const id = 'calli';
export const name = 'Caligráfica';
export const description = 'Plumilla biselada a -40° (Monotone Ribbon Strips) con horneado incremental O(1) y cero lag';

const calliStrokeCache = new WeakMap();

// Estado para el horneado incremental O(1) en vivo
let liveBakeState = {
    canvas: null,
    ctx: null,
    firstPointX: null,
    firstPointY: null,
    bakedRawIndex: 0,
    width: 0,
    angle: 0,
    color: '',
    dpr: 1,
};

export function resetCalliCacheForTesting() {
    liveBakeState.bakedRawIndex = 0;
    liveBakeState.firstPointX = null;
}

function ensureLiveBakeCanvas(targetCanvas, dpr) {
    if (!liveBakeState.canvas && typeof document !== 'undefined') {
        liveBakeState.canvas = document.createElement('canvas');
        liveBakeState.ctx = liveBakeState.canvas.getContext('2d');
    }
    if (!liveBakeState.canvas) return null;

    if (
        liveBakeState.canvas.width !== targetCanvas.width ||
        liveBakeState.canvas.height !== targetCanvas.height
    ) {
        liveBakeState.canvas.width = targetCanvas.width;
        liveBakeState.canvas.height = targetCanvas.height;
        liveBakeState.bakedRawIndex = 0; // Forzar reseteo si cambió el tamaño
    }
    liveBakeState.dpr = dpr;
    return liveBakeState.ctx;
}

/**
 * Filtra puntos redundantes consecutivos a distancia < 1.8px
 * preservando siempre el primer y último punto.
 */
export function filterRedundantPoints(rawPoints) {
    if (!rawPoints || rawPoints.length <= 2) return rawPoints ? rawPoints.slice() : [];
    const len = rawPoints.length;
    const filtered = [rawPoints[0]];
    const minDistSq = 1.8 * 1.8;
    let last = rawPoints[0];

    for (let i = 1; i < len - 1; i++) {
        const p = rawPoints[i];
        const dx = p.x - last.x;
        const dy = p.y - last.y;
        if (dx * dx + dy * dy >= minDistSq) {
            filtered.push(p);
            last = p;
        }
    }
    filtered.push(rawPoints[len - 1]);
    return filtered;
}

/**
 * Genera puntos suavizados adaptativos (subdivisión cuadrática condicional)
 */
export function smoothCalligraphyPoints(rawPoints) {
    if (!rawPoints || rawPoints.length <= 2) return rawPoints ? rawPoints.slice() : [];
    const filtered = filterRedundantPoints(rawPoints);
    const flen = filtered.length;
    if (flen <= 2) return filtered;

    const smoothed = [{ x: filtered[0].x, y: filtered[0].y }];
    const cos12Deg = 0.9781476; // Math.cos((12 * Math.PI) / 180)

    for (let i = 1; i < flen - 1; i++) {
        const p0 = filtered[i - 1];
        const p1 = filtered[i];
        const p2 = filtered[i + 1];

        const v0x = p1.x - p0.x;
        const v0y = p1.y - p0.y;
        const v1x = p2.x - p1.x;
        const v1y = p2.y - p1.y;

        const d01 = Math.hypot(v0x, v0y);
        const d12 = Math.hypot(v1x, v1y);

        let isSharp = false;
        if (d01 > 0.01 && d12 > 0.01) {
            const dot = (v0x * v1x + v0y * v1y) / (d01 * d12);
            if (dot < cos12Deg) isSharp = true;
        }

        const m0x = (p0.x + p1.x) * 0.5;
        const m0y = (p0.y + p1.y) * 0.5;
        const m1x = (p1.x + p2.x) * 0.5;
        const m1y = (p1.y + p2.y) * 0.5;

        if (d01 > 6 || d12 > 6 || isSharp) {
            // Desenrollado de bucle (t = 0.25, 0.5, 0.75, 1.0) para evitar overhead en caliente
            smoothed.push(
                { x: 0.5625 * m0x + 0.375 * p1.x + 0.0625 * m1x, y: 0.5625 * m0y + 0.375 * p1.y + 0.0625 * m1y },
                { x: 0.25 * m0x + 0.5 * p1.x + 0.25 * m1x,       y: 0.25 * m0y + 0.5 * p1.y + 0.25 * m1y },
                { x: 0.0625 * m0x + 0.375 * p1.x + 0.5625 * m1x, y: 0.0625 * m0y + 0.375 * p1.y + 0.5625 * m1y },
                { x: m1x, y: m1y }
            );
        } else {
            smoothed.push({
                x: 0.25 * m0x + 0.5 * p1.x + 0.25 * m1x,
                y: 0.25 * m0y + 0.5 * p1.y + 0.25 * m1y,
            });
        }
    }
    const last = filtered[flen - 1];
    smoothed.push({ x: last.x, y: last.y });
    return smoothed;
}

/**
 * Construye las tiras de polígonos (Monotone Ribbon Strips) sin serializar strings en caliente.
 * La generación de string SVG y Path2D se hace de forma perezosa (lazy) solo si se solicita.
 */
export function buildCalligraphicChiselPath(
    rawPoints,
    baseWidth,
    nibAngleRad = (-40 * Math.PI) / 180,
    allowCache = true
) {
    if (allowCache && typeof rawPoints === 'object' && rawPoints !== null) {
        const cached = calliStrokeCache.get(rawPoints);
        if (cached && cached.width === baseWidth && Math.abs(cached.nibAngle - nibAngleRad) < 1e-4) {
            return cached.result;
        }
    }

    const pts = smoothCalligraphyPoints(rawPoints);
    const plen = pts.length;
    const halfSpan = Math.max(1.5, baseWidth * 0.85);
    const minNibThickness = Math.max(0.6, baseWidth * 0.08);

    const ux = Math.cos(nibAngleRad);
    const uy = Math.sin(nibAngleRad);
    const nx = -uy;
    const ny = ux;

    // Arrays planos tipados para evitar miles de objetos {x, y} en el Garbage Collector
    const edgeAx = new Float32Array(plen);
    const edgeAy = new Float32Array(plen);
    const edgeBx = new Float32Array(plen);
    const edgeBy = new Float32Array(plen);

    const uxSpan = ux * halfSpan;
    const uySpan = uy * halfSpan;
    const nxThick = nx * minNibThickness;
    const nyThick = ny * minNibThickness;

    for (let i = 0; i < plen; i++) {
        let dx = 0;
        let dy = 0;
        if (i === 0 && plen > 1) {
            dx = pts[1].x - pts[0].x;
            dy = pts[1].y - pts[0].y;
        } else if (i === plen - 1 && plen > 1) {
            dx = pts[i].x - pts[i - 1].x;
            dy = pts[i].y - pts[i - 1].y;
        } else if (plen > 2) {
            dx = pts[i + 1].x - pts[i - 1].x;
            dy = pts[i + 1].y - pts[i - 1].y;
        }

        const padSign = (dx * nx + dy * ny >= 0) ? 1 : -1;
        const padX = nxThick * padSign;
        const padY = nyThick * padSign;

        const px = pts[i].x;
        const py = pts[i].y;

        edgeAx[i] = px - uxSpan - padX;
        edgeAy[i] = py - uySpan - padY;
        edgeBx[i] = px + uxSpan + padX;
        edgeBy[i] = py + uySpan + padY;
    }

    const strips = [];

    const pushStrip = (startIdx, endIdx, sign) => {
        if (endIdx <= startIdx) return;
        const count = (endIdx - startIdx + 1) * 4;
        const poly = new Float32Array(count);
        let ptr = 0;

        if (sign >= 0) {
            for (let k = startIdx; k <= endIdx; k++) {
                poly[ptr++] = edgeAx[k];
                poly[ptr++] = edgeAy[k];
            }
            for (let k = endIdx; k >= startIdx; k--) {
                poly[ptr++] = edgeBx[k];
                poly[ptr++] = edgeBy[k];
            }
        } else {
            for (let k = startIdx; k <= endIdx; k++) {
                poly[ptr++] = edgeBx[k];
                poly[ptr++] = edgeBy[k];
            }
            for (let k = endIdx; k >= startIdx; k--) {
                poly[ptr++] = edgeAx[k];
                poly[ptr++] = edgeAy[k];
            }
        }
        strips.push(poly);
    };

    if (plen >= 2) {
        let stripStart = 0;
        let stripSign = 0;

        for (let i = 1; i < plen; i++) {
            const dx = pts[i].x - pts[i - 1].x;
            const dy = pts[i].y - pts[i - 1].y;
            if (dx * dx + dy * dy < 1e-6) continue;

            const cross = ux * dy - uy * dx;
            const sign = cross >= 0 ? 1 : -1;

            if (stripSign === 0) {
                stripSign = sign;
                stripStart = i - 1;
            } else if (sign !== stripSign) {
                pushStrip(stripStart, i - 1, stripSign);
                stripStart = i - 1;
                stripSign = sign;
            }
        }

        if (stripSign !== 0 && stripStart < plen - 1) {
            pushStrip(stripStart, plen - 1, stripSign);
        } else if (strips.length === 0 && plen >= 2) {
            pushStrip(0, plen - 1, 1);
        }
    }

    if (strips.length === 0 && plen > 0) {
        const p = pts[0];
        strips.push(new Float32Array([
            p.x - uxSpan - nxThick, p.y - uySpan - nyThick,
            p.x + uxSpan - nxThick, p.y + uySpan - nyThick,
            p.x + uxSpan + nxThick, p.y + uySpan + nyThick,
            p.x - uxSpan + nxThick, p.y - uySpan + nyThick
        ]));
    }

    // Dibuja directamente desde los Float32Array sin crear strings ni Path2D intermedios
    const drawToCanvas = (ctx) => {
        ctx.beginPath();
        for (let s = 0; s < strips.length; s++) {
            const poly = strips[s];
            const len = poly.length;
            if (len < 4) continue;
            ctx.moveTo(poly[0], poly[1]);
            for (let j = 2; j < len; j += 2) {
                ctx.lineTo(poly[j], poly[j + 1]);
            }
            ctx.closePath();
        }
        ctx.fill('nonzero');
    };

    let lazySvgD = null;
    const toSvgPathD = () => {
        if (lazySvgD !== null) return lazySvgD;
        let d = '';
        for (let s = 0; s < strips.length; s++) {
            const poly = strips[s];
            if (poly.length < 4) continue;
            d += `M${poly[0].toFixed(2)} ${poly[1].toFixed(2)}`;
            for (let j = 2; j < poly.length; j += 2) {
                d += `L${poly[j].toFixed(2)} ${poly[j + 1].toFixed(2)}`;
            }
            d += 'Z';
        }
        lazySvgD = d;
        return d;
    };

    const result = {
        drawToCanvas,
        toSvgPathD,
        strips,
    };

    if (allowCache && typeof rawPoints === 'object' && rawPoints !== null) {
        calliStrokeCache.set(rawPoints, {
            width: baseWidth,
            nibAngle: nibAngleRad,
            result,
        });
    }

    return result;
}

/**
 * Renderiza un trazo caligráfico con complejidad O(1) en trazos largos mediante Chunk Baking
 */
export function renderPen(ctx, points, style) {
    if (!points || points.length === 0) return;

    const baseWidth = Math.max(1, style.width || 4);
    const color = style.color || '#1e1e1e';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;
    const angle = style.tiltAngle !== undefined ? style.tiltAngle : (-40 * Math.PI) / 180;

    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;

    // Si estamos en un trazo largo en vivo (> 48 puntos), horneamos en chunks O(1)
    const targetCanvas = ctx.canvas;
    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;

    if (points.length > 48 && opacity === 1 && targetCanvas) {
        const bakeCtx = ensureLiveBakeCanvas(targetCanvas, dpr);
        if (bakeCtx) {
            const isContinuation =
                liveBakeState.firstPointX === points[0].x &&
                liveBakeState.firstPointY === points[0].y &&
                liveBakeState.width === baseWidth &&
                liveBakeState.angle === angle &&
                liveBakeState.color === color &&
                points.length >= liveBakeState.bakedRawIndex;

            if (!isContinuation) {
                // Nuevo trazo largo: limpiar buffer acumulativo
                liveBakeState.firstPointX = points[0].x;
                liveBakeState.firstPointY = points[0].y;
                liveBakeState.bakedRawIndex = 0;
                liveBakeState.width = baseWidth;
                liveBakeState.angle = angle;
                liveBakeState.color = color;

                bakeCtx.save();
                bakeCtx.setTransform(1, 0, 0, 1, 0, 0);
                bakeCtx.clearRect(0, 0, liveBakeState.canvas.width, liveBakeState.canvas.height);
                bakeCtx.restore();
            }

            // Dejamos siempre solo los últimos 16 puntos como "cola viva"
            const safeFreezeLimit = points.length - 16;

            // Si acumulamos al menos 16 puntos nuevos sin hornear, horneamos SOLO ese delta O(1)
            if (safeFreezeLimit - liveBakeState.bakedRawIndex >= 16) {
                const chunkStart = Math.max(0, liveBakeState.bakedRawIndex - 3); // Solapamiento de 3 pts para costura invisible
                const chunkPoints = points.slice(chunkStart, safeFreezeLimit + 1);

                bakeCtx.save();
                bakeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                bakeCtx.fillStyle = color;
                const chunkChisel = buildCalligraphicChiselPath(chunkPoints, baseWidth, angle, false);
                chunkChisel.drawToCanvas(bakeCtx);
                bakeCtx.restore();

                liveBakeState.bakedRawIndex = safeFreezeLimit;
            }

            // 1. Volcar todo el historial congelado en una sola operación GPU (O(1))
            if (liveBakeState.bakedRawIndex > 0) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.drawImage(liveBakeState.canvas, 0, 0);
                ctx.restore();
            }

            // 2. Dibujar únicamente los últimos ~18 puntos vivos (complejidad constante O(1))
            const tailStart = Math.max(0, liveBakeState.bakedRawIndex - 3);
            const tailSlice = points.slice(tailStart);
            const tailChisel = buildCalligraphicChiselPath(tailSlice, baseWidth, angle, false);
            tailChisel.drawToCanvas(ctx);

            ctx.restore();
            return;
        }
    }

    // Trazos cortos (< 48 puntos) o renderizado final a sprite
    const chisel = buildCalligraphicChiselPath(points, baseWidth, angle, true);
    chisel.drawToCanvas(ctx);
    ctx.restore();
}

/**
 * Genera el markup SVG del trazo caligráfico
 */
export function renderSvg(points, style) {
    if (!points || points.length === 0) return { defs: '', body: '' };
    const baseWidth = Math.max(1, style.width || 4);
    const color = style.color || '#1e1e1e';
    const opacity = style.opacity !== undefined ? style.opacity : 1.0;
    const angle = style.tiltAngle !== undefined ? style.tiltAngle : (-40 * Math.PI) / 180;
    const chisel = buildCalligraphicChiselPath(points, baseWidth, angle, true);
    return {
        defs: '',
        body: `<path d="${chisel.toSvgPathD()}" fill="${color}" fill-rule="nonzero" opacity="${opacity}" stroke="none"/>`
    };
}

if (typeof globalThis !== 'undefined') {
    globalThis.ApoloSandbox = globalThis.ApoloSandbox || { pens: {}, engines: {} };
    globalThis.ApoloSandbox.pens.calli = {
        id,
        name,
        description,
        renderPen,
        renderSvg,
        buildCalligraphicChiselPath,
        smoothCalligraphyPoints,
        filterRedundantPoints,
    };
}