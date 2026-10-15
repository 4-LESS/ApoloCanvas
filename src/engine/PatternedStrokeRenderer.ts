import type { StrokePattern, StrokeStyle } from '../core/types';

interface SolidStrokePoint {
    x: number;
    y: number;
    pressure: number;
    time: number;
}

interface RibbonPoint extends SolidStrokePoint {
    radius: number;
    nx: number;
    ny: number;
    angle: number;
}

const graphitePatterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern | null>>();

function smoothCenterline(context: CanvasRenderingContext2D, points: readonly SolidStrokePoint[]): void {
    context.moveTo(points[0].x, points[0].y);
    if (points.length === 2) {
        context.lineTo(points[1].x, points[1].y);
        return;
    }

    for (let i = 1; i < points.length - 1; i++) {
        const midpointX = (points[i].x + points[i + 1].x) / 2;
        const midpointY = (points[i].y + points[i + 1].y) / 2;
        context.quadraticCurveTo(points[i].x, points[i].y, midpointX, midpointY);
    }
    const last = points[points.length - 1];
    context.lineTo(last.x, last.y);
}

function normalizedPressure(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

function getGraphitePattern(context: CanvasRenderingContext2D, color: string): CanvasPattern | null {
    let colorPatterns = graphitePatterns.get(context);
    if (colorPatterns?.has(color)) return colorPatterns.get(color) ?? null;
    if (!colorPatterns) {
        colorPatterns = new Map();
        graphitePatterns.set(context, colorPatterns);
    }

    let pattern: CanvasPattern | null = null;
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        try {
            const tile = document.createElement('canvas');
            tile.width = 24;
            tile.height = 24;
            const tileContext = tile.getContext('2d');
            if (tileContext) {
                tileContext.fillStyle = color;
                for (let y = 0; y < 24; y++) {
                    for (let x = 0; x < 24; x++) {
                        const hash = (x * 17 + y * 31 + (x * y % 13) * 7) % 20;
                        if (hash < 7) continue;
                        tileContext.globalAlpha = hash < 13 ? 0.5 : 1;
                        tileContext.fillRect(x, y, 1, 1);
                    }
                }
                tileContext.globalAlpha = 1;
                pattern = context.createPattern(tile, 'repeat');
            }
        } catch {
            pattern = null;
        }
    }

    colorPatterns.set(color, pattern);
    return pattern;
}

function makeSolidStrokePoints(
    data: readonly number[],
    contentLeft: number,
    contentWidth: number,
    blockTop: number,
): SolidStrokePoint[] {
    const points: SolidStrokePoint[] = [];
    for (let i = 0; i < data.length; i += 4) {
        points.push({
            x: contentLeft + data[i] * contentWidth,
            y: blockTop + data[i + 1] * contentWidth,
            pressure: normalizedPressure(data[i + 2]),
            time: Number.isFinite(data[i + 3]) ? data[i + 3] : 0,
        });
    }
    return points;
}

function drawFountainRibbon(
    context: CanvasRenderingContext2D,
    points: readonly SolidStrokePoint[],
    style: StrokeStyle,
): void {
    if (points.length === 1) {
        const radius = style.width * (0.28 + 1.17 * points[0].pressure) / 2;
        context.beginPath();
        context.arc(points[0].x, points[0].y, radius, 0, Math.PI * 2);
        context.fill();
        return;
    }

    const ribbon: RibbonPoint[] = [];
    let previousRadius = style.width / 2;
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const previous = points[Math.max(0, i - 1)];
        const next = points[Math.min(points.length - 1, i + 1)];
        const tangentX = next.x - previous.x;
        const tangentY = next.y - previous.y;
        const tangentLength = Math.hypot(tangentX, tangentY) || 1;
        const ux = tangentX / tangentLength;
        const uy = tangentY / tangentLength;
        const distance = i === 0 ? 0 : Math.hypot(point.x - previous.x, point.y - previous.y);
        const elapsed = i === 0 ? 0 : point.time - previous.time;
        const velocity = elapsed > 0 ? distance / elapsed : 0;
        const targetScale = Math.max(
            0.28,
            Math.min(1.45, (0.55 + 0.9 * point.pressure) / (1 + velocity * 0.35)),
        );
        const targetRadius = style.width * targetScale / 2;
        const radius = i === 0 ? targetRadius : 0.65 * previousRadius + 0.35 * targetRadius;
        previousRadius = radius;
        ribbon.push({
            ...point,
            radius,
            nx: -uy,
            ny: ux,
            angle: Math.atan2(uy, ux),
        });
    }

    const first = ribbon[0];
    const last = ribbon[ribbon.length - 1];
    const leftX = ribbon.map(point => point.x + point.nx * point.radius);
    const leftY = ribbon.map(point => point.y + point.ny * point.radius);
    const rightX = ribbon.map(point => point.x - point.nx * point.radius);
    const rightY = ribbon.map(point => point.y - point.ny * point.radius);

    context.beginPath();
    context.moveTo(leftX[0], leftY[0]);
    for (let i = 1; i < ribbon.length; i++) {
        const midpointX = (leftX[i - 1] + leftX[i]) / 2;
        const midpointY = (leftY[i - 1] + leftY[i]) / 2;
        context.quadraticCurveTo(leftX[i - 1], leftY[i - 1], midpointX, midpointY);
    }
    context.lineTo(leftX[leftX.length - 1], leftY[leftY.length - 1]);
    context.arc(
        last.x,
        last.y,
        last.radius,
        last.angle + Math.PI / 2,
        last.angle - Math.PI / 2,
        true,
    );
    context.lineTo(rightX[rightX.length - 1], rightY[rightY.length - 1]);
    for (let i = ribbon.length - 2; i >= 0; i--) {
        const midpointX = (rightX[i + 1] + rightX[i]) / 2;
        const midpointY = (rightY[i + 1] + rightY[i]) / 2;
        context.quadraticCurveTo(rightX[i + 1], rightY[i + 1], midpointX, midpointY);
    }
    context.lineTo(rightX[0], rightY[0]);
    context.arc(
        first.x,
        first.y,
        first.radius,
        first.angle - Math.PI / 2,
        first.angle + Math.PI / 2,
        true,
    );
    context.closePath();
    context.fill();
}

function drawCalligraphicRibbon(
    context: CanvasRenderingContext2D,
    points: readonly SolidStrokePoint[],
    style: StrokeStyle,
): void {
    const halfNibWidth = style.width * 1.15;
    const nibX = Math.cos(-Math.PI / 4) * halfNibWidth;
    const nibY = Math.sin(-Math.PI / 4) * halfNibWidth;

    if (points.length === 1) {
        context.beginPath();
        context.moveTo(points[0].x - nibX, points[0].y - nibY);
        context.lineTo(points[0].x + nibX, points[0].y + nibY);
        context.lineWidth = Math.max(1, style.width * 0.22);
        context.lineCap = 'butt';
        context.stroke();
        return;
    }

    context.beginPath();
    for (let i = 1; i < points.length; i++) {
        const previous = points[i - 1];
        const current = points[i];
        context.moveTo(previous.x - nibX, previous.y - nibY);
        context.lineTo(previous.x + nibX, previous.y + nibY);
        context.lineTo(current.x + nibX, current.y + nibY);
        context.lineTo(current.x - nibX, current.y - nibY);
        context.closePath();
    }
    context.fill();

    context.beginPath();
    smoothCenterline(context, points);
    context.lineWidth = Math.max(1, style.width * 0.22);
    context.lineCap = 'butt';
    context.lineJoin = 'round';
    context.stroke();
}

function drawPencilStroke(
    context: CanvasRenderingContext2D,
    points: readonly SolidStrokePoint[],
    style: StrokeStyle,
): void {
    context.beginPath();
    if (points.length === 1) {
        context.arc(points[0].x, points[0].y, style.width * 0.475, 0, Math.PI * 2);
    } else {
        smoothCenterline(context, points);
    }

    const averagePressure = points.reduce((sum, point) => sum + point.pressure, 0) / points.length;
    context.strokeStyle = style.color;
    context.lineWidth = style.width * 0.95;
    context.globalAlpha = 0.42 * (0.7 + 0.3 * averagePressure) * style.opacity;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();

    const graphitePattern = getGraphitePattern(context, style.color);
    context.lineWidth = style.width * 1.15;
    context.globalAlpha = 0.65 * style.opacity;
    if (graphitePattern) {
        context.strokeStyle = graphitePattern;
        context.stroke();
    } else {
        context.strokeStyle = style.color;
        context.setLineDash([1.2, 1.8]);
        context.lineDashOffset = 0;
        context.stroke();
        context.setLineDash([0.8, 2.4]);
        context.lineDashOffset = 1.1;
        context.stroke();
        context.setLineDash([]);
        context.lineDashOffset = 0;
    }
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
    const points = makeSolidStrokePoints(data, contentLeft, contentWidth, blockTop);
    context.save();
    context.fillStyle = style.color;
    context.strokeStyle = style.color;
    context.lineJoin = 'round';

    try {
        switch (style.profile || 'fountain') {
            case 'ball':
                context.beginPath();
                if (points.length === 1) {
                    context.arc(points[0].x, points[0].y, style.width * 0.45, 0, Math.PI * 2);
                    context.fillStyle = style.color;
                    context.globalAlpha = 0.98 * style.opacity;
                    context.fill();
                } else {
                    smoothCenterline(context, points);
                    context.lineWidth = style.width * 0.9;
                    context.lineCap = 'round';
                    context.lineJoin = 'round';
                    context.globalAlpha = 0.98 * style.opacity;
                    context.stroke();
                }
                break;
            case 'calli':
                context.globalAlpha = style.opacity;
                drawCalligraphicRibbon(context, points, style);
                break;
            case 'pencil':
                drawPencilStroke(context, points, style);
                break;
            case 'fountain':
            default:
                context.globalAlpha = style.opacity;
                drawFountainRibbon(context, points, style);
                break;
        }
    } finally {
        context.setLineDash([]);
        context.restore();
    }
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