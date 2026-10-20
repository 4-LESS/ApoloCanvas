import type { PenProfileId, Point, StrokeStyle } from '../../core/types.ts';

export interface PenSvgOutput {
    defs?: Record<string, string> | string;
    body: string;
}

export interface PenStyleOptions extends Omit<Partial<StrokeStyle>, 'profile'> {
    profile?: PenProfileId | string;
    width?: number;
    color?: string;
    opacity?: number;
    tiltAngle?: number;
    simulatePressure?: boolean;
    strokeId?: string;
    viewport?: unknown;
}

export interface PenToolPlugin {
    readonly id: PenProfileId;
    readonly name: string;
    renderCanvas(ctx: CanvasRenderingContext2D, points: readonly Point[], style: StrokeStyle | PenStyleOptions): void;
    renderSegment?(
        ctx: CanvasRenderingContext2D,
        points: readonly Point[],
        fromIndex: number,
        style: StrokeStyle | PenStyleOptions,
        segState?: Record<string, unknown>,
    ): void;
    renderSvg(points: readonly Point[], style: StrokeStyle | PenStyleOptions): PenSvgOutput;
    resetCache?(): void;
}
