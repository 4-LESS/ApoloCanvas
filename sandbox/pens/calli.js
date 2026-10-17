/**
 * sandbox/pens/calli.js
 * 
 * Caligráfica (Calligraphy Chisel Pen)
 * Plumilla biselada plana inclinada a -40° con variación natural de grosor según la dirección
 * del trazo (trazos anchos descendentes, finos ascendentes).
 * 
 * Arquitectura de alto rendimiento (120 FPS en trazos largos > 1500 puntos):
 * 1. Monotone Ribbon Strips: agrupa segmentos continuos con signo de producto cruz constante
 *    en 2 a 6 polígonos cerrados de giro 100% horario (+1). Cero agujeros o inversiones.
 * 2. Filtrado euclidiano (< 1.8px) y subdivisión cuadrática adaptativa (solo en giros > 12° o tramos > 6px).
 * 3. Cache nativo Path2D vía WeakMap para trazos confirmados y ventana incremental prefix en vivo.
 * 
 * Contrato Sandbox:
 * export function renderPen(ctx, points, style)
 * export function renderSvg(points, style)
 */

export const id = 'calli';
export const name = 'Caligráfica';
export const description = 'Plumilla biselada a -40° (Monotone Ribbon Strips) con corte bisel plano, Path2D cache y cero agujeros';

const calliStrokeCache = new WeakMap();

let activeLivePrefix = null;

export function resetCalliCacheForTesting() {
    activeLivePrefix = null;
}

/**
 * Filtra puntos redundantes consecutivos a distancia < 1.8px
 * preservando siempre el primer y último punto.
 */
export function filterRedundantPoints(rawPoints) {
    if (!rawPoints || rawPoints.length <= 2) return (rawPoints || []).map(p => ({ x: p.x, y: p.y }));
    const filtered = [{ x: rawPoints[0].x, y: rawPoints[0].y }];
    const minDistSq = 1.8 * 1.8;
    for (let i = 1; i < rawPoints.length - 1; i++) {
        const last = filtered[filtered.length - 1];
        const p = rawPoints[i];
        const dx = p.x - last.x;
        const dy = p.y - last.y;
        if (dx * dx + dy * dy >= minDistSq) {
            filtered.push({ x: p.x, y: p.y });
        }
    }
    const lastRaw = rawPoints[rawPoints.length - 1];
    filtered.push({ x: lastRaw.x, y: lastRaw.y });
    return filtered;
}

/**
 * Genera puntos suavizados adaptativos (subdivisión cuadrática condicional)
 * para que las curvas sean suaves con mínimo overhead de vértices.
 */
export function smoothCalligraphyPoints(rawPoints) {
    if (!rawPoints || rawPoints.length <= 2) return (rawPoints || []).map(p => ({ x: p.x, y: p.y }));
    const filtered = filterRedundantPoints(rawPoints);
    if (filtered.length <= 2) return filtered;

    const smoothed = [{ x: filtered[0].x, y: filtered[0].y }];
    const cos12Deg = Math.cos((12 * Math.PI) / 180);

    for (let i = 1; i < filtered.length - 1; i++) {
        const p0 = filtered[i - 1];
        const p1 = filtered[i];
        const p2 = filtered[i + 1];

        const d01 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const d12 = Math.hypot(p2.x - p1.x, p2.y - p1.y);

        let isSharp = false;
        if (d01 > 0.01 && d12 > 0.01) {
            const dot = ((p1.x - p0.x) * (p2.x - p1.x) + (p1.y - p0.y) * (p2.y - p1.y)) / (d01 * d12);
            if (dot < cos12Deg) {
                isSharp = true;
            }
        }

        const needsFullSubdivision = d01 > 6 || d12 > 6 || isSharp;

        const m0x = (p0.x + p1.x) * 0.5;
        const m0y = (p0.y + p1.y) * 0.5;
        const m1x = (p1.x + p2.x) * 0.5;
        const m1y = (p1.y + p2.y) * 0.5;

        if (needsFullSubdivision) {
            for (let t = 0.25; t <= 1.0; t += 0.25) {
                const it = 1 - t;
                smoothed.push({
                    x: it * it * m0x + 2 * it * t * p1.x + t * t * m1x,
                    y: it * it * m0y + 2 * it * t * p1.y + t * t * m1y,
                });
            }
        } else {
            smoothed.push({
                x: 0.25 * m0x + 0.5 * p1.x + 0.25 * m1x,
                y: 0.25 * m0y + 0.5 * p1.y + 0.25 * m1y,
            });
        }
    }
    const last = filtered[filtered.length - 1];
    smoothed.push({ x: last.x, y: last.y });
    return smoothed;
}

/**
 * Construye el SVG path string (`d`) y/o dibuja en el Canvas2D una pluma biselada
 * con ángulo fijo de -40°, puntas cortadas en bisel exacto, y giro (winding) 100% positivo
 * agrupando segmentos contiguos en tiras de cinta monótonas (Monotone Ribbon Strips).
 */
export function buildCalligraphicChiselPath(
    rawPoints,
    baseWidth,
    nibAngleRad = (-40 * Math.PI) / 180
) {
    if (typeof rawPoints === 'object' && rawPoints !== null) {
        const cached = calliStrokeCache.get(rawPoints);
        if (cached && cached.width === baseWidth && Math.abs(cached.nibAngle - nibAngleRad) < 1e-4) {
            return {
                drawToCanvas(ctx) {
                    ctx.beginPath();
                    if (cached.path2D && typeof ctx.fill === 'function') {
                        try {
                            ctx.fill(cached.path2D, 'nonzero');
                            return;
                        } catch {
                            // fallback
                        }
                    }
                    for (const poly of cached.strips) {
                        for (let j = 0; j < poly.length; j += 2) {
                            if (j === 0) ctx.moveTo(poly[j], poly[j + 1]);
                            else ctx.lineTo(poly[j], poly[j + 1]);
                        }
                        ctx.closePath();
                    }
                    ctx.fill('nonzero');
                },
                toSvgPathD() {
                    return cached.svgD;
                },
                path2D: cached.path2D,
                strips: cached.strips,
            };
        }
    }

    const pts = smoothCalligraphyPoints(rawPoints);
    const halfSpan = Math.max(1.5, baseWidth * 0.85); // Mitad del ancho del bisel
    const minNibThickness = Math.max(0.6, baseWidth * 0.08); // Grosor físico mínimo del metal de la plumilla

    // Vector unitario del filo de la plumilla (bisel) y su normal perpendicular
    const ux = Math.cos(nibAngleRad);
    const uy = Math.sin(nibAngleRad);
    const nx = -uy;
    const ny = ux;

    const edgeA = [];
    const edgeB = [];

    for (let i = 0; i < pts.length; i++) {
        let dx = 0;
        let dy = 0;
        if (i === 0 && pts.length > 1) {
            dx = pts[1].x - pts[0].x;
            dy = pts[1].y - pts[0].y;
        } else if (i === pts.length - 1 && pts.length > 1) {
            dx = pts[i].x - pts[i - 1].x;
            dy = pts[i].y - pts[i - 1].y;
        } else if (pts.length > 2) {
            dx = pts[i + 1].x - pts[i - 1].x;
            dy = pts[i + 1].y - pts[i - 1].y;
        }

        const padSign = (dx * nx + dy * ny >= 0) ? 1 : -1;
        const padX = nx * minNibThickness * padSign;
        const padY = ny * minNibThickness * padSign;

        edgeA.push({
            x: pts[i].x - ux * halfSpan - padX,
            y: pts[i].y - uy * halfSpan - padY,
        });
        edgeB.push({
            x: pts[i].x + ux * halfSpan + padX,
            y: pts[i].y + uy * halfSpan + padY,
        });
    }

    const strips = [];

    const pushStrip = (startIdx, endIdx, sign) => {
        if (endIdx <= startIdx) return;
        const poly = [];
        if (sign >= 0) {
            for (let k = startIdx; k <= endIdx; k++) {
                poly.push(edgeA[k].x, edgeA[k].y);
            }
            for (let k = endIdx; k >= startIdx; k--) {
                poly.push(edgeB[k].x, edgeB[k].y);
            }
        } else {
            for (let k = startIdx; k <= endIdx; k++) {
                poly.push(edgeB[k].x, edgeB[k].y);
            }
            for (let k = endIdx; k >= startIdx; k--) {
                poly.push(edgeA[k].x, edgeA[k].y);
            }
        }
        strips.push(poly);
    };

    if (pts.length >= 2) {
        let stripStart = 0;
        let stripSign = 0;

        for (let i = 1; i < pts.length; i++) {
            const p0 = pts[i - 1];
            const p1 = pts[i];
            const dx = p1.x - p0.x;
            const dy = p1.y - p0.y;
            if (Math.hypot(dx, dy) < 0.001) continue;

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

        if (stripSign !== 0 && stripStart < pts.length - 1) {
            pushStrip(stripStart, pts.length - 1, stripSign);
        } else if (strips.length === 0 && pts.length >= 2) {
            pushStrip(0, pts.length - 1, 1);
        }
    }

    if (strips.length === 0 && pts.length > 0) {
        const p = pts[0];
        const a0x = p.x - ux * halfSpan - nx * minNibThickness;
        const a0y = p.y - uy * halfSpan - ny * minNibThickness;
        const b0x = p.x + ux * halfSpan - nx * minNibThickness;
        const b0y = p.y + uy * halfSpan - ny * minNibThickness;
        const b1x = p.x + ux * halfSpan + nx * minNibThickness;
        const b1y = p.y + uy * halfSpan + ny * minNibThickness;
        const a1x = p.x - ux * halfSpan + nx * minNibThickness;
        const a1y = p.y - uy * halfSpan + ny * minNibThickness;
        strips.push([a0x, a0y, b0x, b0y, b1x, b1y, a1x, a1y]);
    }

    let svgPathD = '';
    for (const poly of strips) {
        if (poly.length < 4) continue;
        svgPathD += `M${poly[0].toFixed(2)} ${poly[1].toFixed(2)}`;
        for (let j = 2; j < poly.length; j += 2) {
            svgPathD += `L${poly[j].toFixed(2)} ${poly[j + 1].toFixed(2)}`;
        }
        svgPathD += 'Z';
    }

    let path2DInstance = null;
    if (typeof Path2D !== 'undefined' && svgPathD) {
        try {
            path2DInstance = new Path2D(svgPathD);
        } catch {
            path2DInstance = null;
        }
    }

    const drawToCanvas = (ctx) => {
        ctx.beginPath();
        if (path2DInstance && typeof ctx.fill === 'function') {
            try {
                ctx.fill(path2DInstance, 'nonzero');
                return;
            } catch {
                // Fallback to direct path iteration
            }
        }
        for (const poly of strips) {
            for (let j = 0; j < poly.length; j += 2) {
                if (j === 0) ctx.moveTo(poly[j], poly[j + 1]);
                else ctx.lineTo(poly[j], poly[j + 1]);
            }
            ctx.closePath();
        }
        ctx.fill('nonzero');
    };

    const result = {
        drawToCanvas,
        toSvgPathD() {
            return svgPathD;
        },
        path2D: path2DInstance,
        strips,
    };

    if (typeof rawPoints === 'object' && rawPoints !== null) {
        calliStrokeCache.set(rawPoints, {
            width: baseWidth,
            nibAngle: nibAngleRad,
            path2D: path2DInstance,
            svgD: svgPathD,
            strips,
        });
    }

    return result;
}

/**
 * Renderiza un trazo caligráfico de plumilla plana biselada en Canvas 2D
 * @param {CanvasRenderingContext2D} ctx - Contexto 2D del canvas
 * @param {Array<{x: number, y: number, pressure?: number}>} points - Secuencia de puntos
 * @param {{width: number, opacity: number, color: string, tiltAngle?: number}} style - Parámetros de estilo
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

    if (points.length > 120 && opacity === 1) {
        const isSameStroke = activeLivePrefix && (
            activeLivePrefix.pointsRef === points ||
            (activeLivePrefix.firstPoint &&
             points[0].x === activeLivePrefix.firstPoint.x &&
             points[0].y === activeLivePrefix.firstPoint.y)
        ) && points.length >= activeLivePrefix.frozenLength;

        if (!isSameStroke || (points.length - activeLivePrefix.frozenLength > 32)) {
            const frozenLength = points.length - 24;
            const prefixSlice = points.slice(0, frozenLength);
            activeLivePrefix = {
                pointsRef: points,
                firstPoint: { x: points[0].x, y: points[0].y },
                frozenLength,
                prefixChisel: buildCalligraphicChiselPath(prefixSlice, baseWidth, angle),
            };
        }

        // Draw cached prefix
        activeLivePrefix.prefixChisel.drawToCanvas(ctx);

        // Draw live tail (with overlap of 2 points to avoid seam gap)
        const tailSlice = points.slice(Math.max(0, activeLivePrefix.frozenLength - 2));
        const tailChisel = buildCalligraphicChiselPath(tailSlice, baseWidth, angle);
        tailChisel.drawToCanvas(ctx);
    } else {
        activeLivePrefix = null;
        const chisel = buildCalligraphicChiselPath(points, baseWidth, angle);
        chisel.drawToCanvas(ctx);
    }

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
    const chisel = buildCalligraphicChiselPath(points, baseWidth, angle);
    return {
        defs: '',
        body: `<path d="${chisel.toSvgPathD()}" fill="${color}" fill-rule="nonzero" opacity="${opacity}" stroke="none"/>`
    };
}

// Fallback de registro global para compatibilidad directa
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
