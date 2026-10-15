import type { StrokePattern, StrokeStyle } from '../core/types';

// Patrón de textura estocástica para lápiz de mina (grafito orgánico)
let graphitePatternCache: { color: string; pattern: CanvasPattern } | null = null;

export function resetGraphitePatternCacheForTesting(): void {
    graphitePatternCache = null;
}

function getGraphitePattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | null {
    if (graphitePatternCache && graphitePatternCache.color === color) {
        return graphitePatternCache.pattern;
    }
    try {
        const size = 64; // Textura más amplia y de alta resolución
        const patternCanvas = document.createElement('canvas');
        patternCanvas.width = size;
        patternCanvas.height = size;
        const pCtx = patternCanvas.getContext('2d');
        if (!pCtx) return null;

        pCtx.fillStyle = color;
        
        // Distribución estocástica (ruido de dispersión por partículas aleatorias)
        const particleCount = 450; // Cantidad de motas de grafito por celda
        for (let i = 0; i < particleCount; i++) {
            // Posición pseudo-aleatoria pero determinista para evitar parpadeos al hacer zoom
            const rx = (Math.sin(i * 12.9898 + i * 78.233) * 43758.5453) % 1;
            const ry = (Math.sin(i * 78.233 + i * 15.127) * 12345.6789) % 1;
            const x = Math.abs(rx) * size;
            const y = Math.abs(ry) * size;
            
            // Tamaño de mota variable para simular el poro del papel
            const radius = 0.4 + ((i * 9301 + 49297) % 233280) / 233280 * 0.9;
            
            pCtx.globalAlpha = 0.15 + 0.45 * (((i * 3 + 7) % 100) / 100);
            pCtx.beginPath();
            pCtx.arc(x, y, radius, 0, Math.PI * 2);
            pCtx.fill();
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
        // Lápiz de mina: Renderizado orgánico por dispersión estocástica gaussiana (sin contornos sólidos)
        ctx.save();
        ctx.fillStyle = color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Determinar paso y densidad de partículas según el grosor
        const step = Math.max(1.5, baseWidth * 0.25);
        const radius = Math.max(1, baseWidth * 0.5);

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const stepsCount = Math.ceil(dist / step);

            for (let s = 0; s <= stepsCount; s++) {
                const t = stepsCount === 0 ? 0 : s / stepsCount;
                const cx = p1.x + (p2.x - p1.x) * t;
                const cy = p1.y + (p2.y - p1.y) * t;

                // Densidad proporcional al área para que grosores altos mantengan textura rica
                const density = Math.max(4, Math.round(baseWidth * 1.5));

                for (let c = 0; c < density; c++) {
                    // Distribución gaussiana / radial aproximada (más denso al centro, difuso en el radio)
                    const u1 = ((c * 93.13 + i * 41.2 + s * 17.3) % 100) / 100;
                    const u2 = ((c * 47.7 + i * 83.9 + s * 29.1) % 100) / 100;
                    
                    const angle = u1 * Math.PI * 2;
                    // Raíz cuadrada de u2 concentra las partículas hacia el centro (distribución natural de mina)
                    const r = radius * Math.sqrt(u2);

                    const px = cx + Math.cos(angle) * r;
                    const py = cy + Math.sin(angle) * r;

                    // Opacidad individual variable para dar el efecto de grano de papel
                    const particleAlpha = opacity * (0.12 + 0.38 * (((c * 7 + s * 3) % 10) / 10));
                    ctx.globalAlpha = particleAlpha;

                    // Usar círculos pequeños en lugar de rectángulos para evitar esquinas cuadradas
                    ctx.beginPath();
                    ctx.arc(px, py, 0.85 + (c % 2) * 0.4, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
        ctx.restore();
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