import type { StrokePattern, StrokeStyle } from '../core/types';

// Cache para el patrón de textura de grafito (evita recrearlo en cada frame)
let graphitePatternCache: { color: string; pattern: CanvasPattern } | null = null;

export function resetGraphitePatternCacheForTesting(): void {
    graphitePatternCache = null;
}

function getGraphitePattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | null {
    if (graphitePatternCache && graphitePatternCache.color === color) {
        return graphitePatternCache.pattern;
    }
    try {
        const patternCanvas = document.createElement('canvas');
        patternCanvas.width = 24;
        patternCanvas.height = 24;
        const pCtx = patternCanvas.getContext('2d');
        if (!pCtx) return null;

        pCtx.fillStyle = color;
        // Generar puntos de porosidad estilo Kangax (deterministicos / bayer-like)
        const density = 0.38;
        for (let x = 0; x < 24; x += 2) {
            for (let y = 0; y < 24; y += 2) {
                // Pseudo-random hash basado en coordenadas
                const rnd = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
                if ((rnd - Math.floor(rnd)) < density) {
                    pCtx.globalAlpha = 0.45 + 0.5 * (rnd - Math.floor(rnd));
                    pCtx.fillRect(x + (x % 3 === 0 ? 1 : 0), y + (y % 2 === 0 ? 1 : 0), 1.2, 1.2);
                }
            }
        }
        const pattern = ctx.createPattern(patternCanvas, 'repeat');
        if (pattern) {
            graphitePatternCache = { color, pattern };
            return pattern;
        }
    } catch {
        // Fallback seguro en entornos headless / testing
    }
    return null;
}

/**
 * Renderizador unificado de trazos sólidos con perfiles continuos
 */
export function renderContinuousSolidStroke(
    ctx: CanvasRenderingContext2D,
    points: readonly { x: number; y: number; pressure?: number }[],
    style: { color: string; width: number; opacity: number; profile?: string }
): void {
    if (!points || points.length === 0) return;

    const profile = style.profile ?? 'fountain';
    const baseWidth = style.width;
    const opacity = style.opacity;
    const color = style.color;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;

    // Caso 1: Punto único (toque simple)
    if (points.length === 1) {
        const pt = points[0];
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(1, baseWidth / 2), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
    }

    // Helper para construir un camino suave continuo de principio a fin
    const buildContinuousPath = () => {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const mx = (prev.x + curr.x) / 2;
            const my = (prev.y + curr.y) / 2;
            ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    };

    if (profile === 'ball') {
        // Bolígrafo: Monolinea 100% constante
        ctx.lineWidth = Math.max(1, baseWidth * 0.9);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        buildContinuousPath();
        ctx.stroke();

    } else if (profile === 'fountain') {
        // Estilográfica: Cinta continua variable basada en presión con suavizado EMA
        ctx.lineWidth = Math.max(1, baseWidth);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        buildContinuousPath();
        ctx.stroke();

    } else if (profile === 'calli') {
        // Caligráfica: Plumilla plana a -45 grados (Cero espinas, barrido continuo)
        const angle = -Math.PI / 4;
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        const h = Math.max(1, baseWidth * 1.15);

        ctx.beginPath();
        // Lado A hacia adelante
        for (let i = 0; i < points.length; i++) {
            const pt = points[i];
            const ax = pt.x - h * ux;
            const ay = pt.y - h * uy;
            if (i === 0) ctx.moveTo(ax, ay);
            else ctx.lineTo(ax, ay);
        }
        // Lado B hacia atrás (cierre del polígono de la plumilla)
        for (let i = points.length - 1; i >= 0; i--) {
            const pt = points[i];
            const bx = pt.x + h * ux;
            const by = pt.y + h * uy;
            ctx.lineTo(bx, by);
        }
        ctx.closePath();
        ctx.fill();

        // Espina central ultrafina para mantener nitidez en trazos paralelos a -45°
        ctx.lineWidth = Math.max(1, baseWidth * 0.22);
        ctx.lineCap = 'butt';
        buildContinuousPath();
        ctx.stroke();

    } else if (profile === 'pencil') {
        // Lápiz de mina: Receta Kangax (Patrón poroso + 2 pasadas continuas sin superposición de vértices)
        const grainPattern = getGraphitePattern(ctx, color);

        // Pasada 1: Núcleo de grafito translúcido
        ctx.lineWidth = Math.max(1, baseWidth * 0.95);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (grainPattern) {
            ctx.strokeStyle = grainPattern;
        }
        ctx.globalAlpha = opacity * 0.65;
        buildContinuousPath();
        ctx.stroke();

        // Pasada 2: Textura de fibras exteriores desfasadas
        if (grainPattern) {
            ctx.strokeStyle = grainPattern;
            ctx.lineWidth = Math.max(1, baseWidth * 1.25);
            ctx.globalAlpha = opacity * 0.35;
            // Dibujar ligeramente desplazado para dar aspecto fibroso de mina
            ctx.save();
            ctx.translate(0.35, -0.35);
            buildContinuousPath();
            ctx.stroke();
            ctx.restore();
        }
    }

    ctx.restore();
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