import type { StrokePattern, StrokeStyle } from '../core/types';

export interface SolidProfileSegmentStyle {
    width: number;
    opacity: number;
    lineCap: CanvasLineCap;
}

export function getSolidProfileSegmentStyle(
    profile: StrokeStyle['profile'],
    baseWidth: number,
    pressure: number,
    opacity: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    segmentIndex: number,
): SolidProfileSegmentStyle {
    const p = Number.isFinite(pressure) ? Math.max(0, Math.min(1, pressure)) : 0.5;
    const dx = x1 - x0;
    const dy = y1 - y0;

    switch (profile) {
        case 'ball':
            return {
                width: baseWidth * Math.max(0.95, Math.min(1.05, 0.95 + p * 0.1)),
                opacity: 0.98 * opacity,
                lineCap: 'round',
            };
        case 'calli': {
            const angle = Math.atan2(dy, dx);
            return {
                width: baseWidth * (0.3 + 0.9 * Math.abs(Math.sin(angle - Math.PI / 4))),
                opacity,
                lineCap: 'butt',
            };
        }
        case 'pencil': {
            const grainWave = (Math.sin(
                x0 * 12.9898 + y0 * 78.233 + x1 * 37.719 + y1 * 11.13 + segmentIndex * 19.19,
            ) + 1) / 2;
            return {
                width: baseWidth * (0.97 + grainWave * 0.06),
                opacity: (0.38 + 0.48 * p) * opacity,
                lineCap: 'round',
            };
        }
        case 'fountain':
        default: {
            const easedPressure = p * p * (3 - 2 * p);
            return {
                width: baseWidth * (0.45 + 0.9 * easedPressure),
                opacity,
                lineCap: 'round',
            };
        }
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