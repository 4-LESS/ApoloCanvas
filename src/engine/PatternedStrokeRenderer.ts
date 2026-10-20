import type { PenProfileId, StrokePattern, StrokeStyle } from '../core/types.ts';
import { calliPenPlugin, getPenPlugin, pencilPenPlugin } from './pens/index.ts';

let graphiteTileCache: { color: string; pattern: CanvasPattern } | null = null;

export function resetGraphitePatternCacheForTesting(): void {
    graphiteTileCache = null;
    pencilPenPlugin.resetCache?.();
}

export function getGraphitePattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | null {
    if (graphiteTileCache && graphiteTileCache.color === color) {
        return graphiteTileCache.pattern;
    }
    try {
        const size = 96;
        const tile = document.createElement('canvas');
        tile.width = size;
        tile.height = size;
        const tCtx = tile.getContext('2d');
        if (!tCtx) return null;

        tCtx.fillStyle = color;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                // High-frequency hash + low-frequency paper grain modulation
                const h1 = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
                const n1 = h1 - Math.floor(h1);
                const h2 = Math.sin(x * 0.35 + y * 0.45) * 1973.17;
                const n2 = h2 - Math.floor(h2);
                const combined = n1 * 0.75 + n2 * 0.25;

                if (combined > 0.36) {
                    tCtx.globalAlpha = Math.min(1, (combined - 0.36) * 1.45);
                    tCtx.fillRect(x, y, 1, 1);
                }
            }
        }
        const pattern = ctx.createPattern(tile, 'repeat');
        if (pattern) {
            graphiteTileCache = { color, pattern };
            return pattern;
        }
    } catch {
        // Safe fallback for headless test mocks
    }
    return null;
}

/**
 * Genera puntos suavizados (subdivisión cuadrática de Chaikin / punto medio)
 * para que las curvas sean infinitamente suaves al hacer zoom sin facetas poligonales.
 */
interface CalliCacheEntry {
    width: number;
    nibAngle: number;
    path2D?: any;
    svgD: string;
    strips: number[][];
}

const calliStrokeCache = new WeakMap<readonly any[], CalliCacheEntry>();

interface LivePrefixCache {
    pointsRef?: readonly any[];
    firstPoint?: { x: number; y: number };
    frozenLength: number;
    prefixChisel: ReturnType<typeof buildCalligraphicChiselPath>;
}

let activeLivePrefix: LivePrefixCache | null = null;

export function resetCalliCacheForTesting(): void {
    activeLivePrefix = null;
    calliPenPlugin.resetCache?.();
}

/**
 * Filtra puntos redundantes consecutivos a distancia < 1.8px
 * preservando siempre el primer y último punto.
 */
export function filterRedundantPoints(
    rawPoints: readonly { x: number; y: number }[]
): { x: number; y: number }[] {
    if (!rawPoints || rawPoints.length <= 2) return (rawPoints || []).map(p => ({ x: p.x, y: p.y }));
    const filtered: { x: number; y: number }[] = [{ x: rawPoints[0].x, y: rawPoints[0].y }];
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
export function smoothCalligraphyPoints(
    rawPoints: readonly { x: number; y: number }[]
): { x: number; y: number }[] {
    if (!rawPoints || rawPoints.length <= 2) return (rawPoints || []).map(p => ({ x: p.x, y: p.y }));
    const filtered = filterRedundantPoints(rawPoints);
    if (filtered.length <= 2) return filtered;

    const smoothed: { x: number; y: number }[] = [{ x: filtered[0].x, y: filtered[0].y }];
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
    rawPoints: readonly { x: number; y: number }[],
    baseWidth: number,
    nibAngleRad = (-40 * Math.PI) / 180
): { drawToCanvas: (ctx: CanvasRenderingContext2D) => void; toSvgPathD: () => string; path2D?: any } {
    if (typeof rawPoints === 'object' && rawPoints !== null) {
        const cached = calliStrokeCache.get(rawPoints);
        if (cached && cached.width === baseWidth && Math.abs(cached.nibAngle - nibAngleRad) < 1e-4) {
            return {
                drawToCanvas(ctx: CanvasRenderingContext2D) {
                    ctx.beginPath();
                    if (cached.path2D && typeof (ctx as any).fill === 'function') {
                        try {
                            (ctx as any).fill(cached.path2D, 'nonzero');
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

    const edgeA: Array<{ x: number; y: number }> = [];
    const edgeB: Array<{ x: number; y: number }> = [];

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

    const strips: Array<number[]> = [];

    const pushStrip = (startIdx: number, endIdx: number, sign: number) => {
        if (endIdx <= startIdx) return;
        const poly: number[] = [];
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

    let path2DInstance: any = null;
    if (typeof Path2D !== 'undefined' && svgPathD) {
        try {
            path2DInstance = new Path2D(svgPathD);
        } catch {
            path2DInstance = null;
        }
    }

    const drawToCanvas = (ctx: CanvasRenderingContext2D) => {
        ctx.beginPath();
        if (path2DInstance && typeof (ctx as any).fill === 'function') {
            try {
                (ctx as any).fill(path2DInstance, 'nonzero');
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
        toSvgPathD(): string {
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
 * Renderizador unificado de trazos sólidos con perfiles continuos.
 * Delega directamente en el registro modular `src/engine/pens/`.
 */
export function renderContinuousSolidStroke(
    ctx: CanvasRenderingContext2D,
    points: readonly { x: number; y: number; pressure?: number; time?: number }[],
    style: { color: string; width: number; opacity: number; profile?: PenProfileId | string; tiltAngle?: number; simulatePressure?: boolean }
): void {
    if (!points || points.length === 0) return;
    getPenPlugin(style.profile).renderCanvas(ctx, points, style);
}

export function drawSolidProfileStrokePath(
    context: CanvasRenderingContext2D,
    data: readonly number[],
    contentLeft: number,
    contentWidth: number,
    blockTop: number,
    style: StrokeStyle,
): void {
    if (data.length < 4) return;
    const points: { x: number; y: number; pressure?: number }[] = [];
    for (let i = 0; i < data.length; i += 4) {
        points.push({
            x: contentLeft + data[i] * contentWidth,
            y: blockTop + data[i + 1] * contentWidth,
            pressure: data[i + 2],
        });
    }
    renderContinuousSolidStroke(context, points, style);
}

export function applyStrokePattern(
    context: CanvasRenderingContext2D,
    pattern: StrokePattern,
    width: number,
    solidLineCap: CanvasLineCap,
): void {
    if (pattern === 'dashed') {
        context.lineCap = 'butt';
        context.setLineDash([Math.max(6, width * 3), Math.max(4, width * 2)]);
    } else if (pattern === 'dotted') {
        context.lineCap = 'round';
        context.setLineDash([0.5, Math.max(4, width * 2.2)]);
    } else {
        context.lineCap = solidLineCap;
        context.setLineDash([]);
    }
}

export function drawPatternedStrokePath(
    context: CanvasRenderingContext2D,
    points: readonly number[],
    contentLeft: number,
    contentWidth: number,
    blockTop: number,
    style: StrokeStyle,
): void {
    context.strokeStyle = style.color;
    context.lineWidth = style.width;
    context.globalAlpha = style.opacity;
    context.lineJoin = 'round';
    applyStrokePattern(context, style.pattern, style.width, style.lineCap ?? 'round');

    try {
        if (points.length === 4) {
            context.beginPath();
            context.arc(
                contentLeft + points[0] * contentWidth,
                blockTop + points[1] * contentWidth,
                style.width / 2,
                0,
                Math.PI * 2,
            );
            context.fillStyle = style.color;
            context.fill();
            return;
        }

        if (points.length < 8) return;

        context.beginPath();
        context.moveTo(contentLeft + points[0] * contentWidth, blockTop + points[1] * contentWidth);
        for (let i = 4; i < points.length; i += 4) {
            context.lineTo(contentLeft + points[i] * contentWidth, blockTop + points[i + 1] * contentWidth);
        }
        context.stroke();
    } finally {
        context.setLineDash([]);
    }
}