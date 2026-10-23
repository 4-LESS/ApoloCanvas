import type { PenProfileId, Point, StrokeCache, StrokeElement, StrokePattern, StrokeStyle } from '../core/types.ts';
import { calliPenPlugin, getPenPlugin, pencilPenPlugin } from './pens/index.ts';

export function resetGraphitePatternCacheForTesting(): void {
    pencilPenPlugin.resetCache?.();
}

export function resetCalliCacheForTesting(): void {
    calliPenPlugin.resetCache?.();
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

/**
 * Snap angle in degrees to cardinal axes (0, 90, 180, 270 within 6°)
 * or intermediate angles (30, 45, 60, 120, 135, 150, 210, 225, 240, 300, 315, 330 within 3.5°).
 */
export function snapLineAngle(deg: number): number {
    const norm = ((deg % 360) + 360) % 360;
    const diff = (a: number, b: number) => {
        const d = Math.abs(a - b);
        return Math.min(d, 360 - d);
    };

    const cardinals = [0, 90, 180, 270];
    for (const target of cardinals) {
        if (diff(norm, target) <= 6.0) {
            return target;
        }
    }

    const intermediates = [30, 45, 60, 120, 135, 150, 210, 225, 240, 300, 315, 330];
    for (const target of intermediates) {
        if (diff(norm, target) <= 3.5) {
            return target;
        }
    }

    return norm;
}

/**
 * Computes snapped endpoint and collinear sequence of points along the elastic straight line.
 */
export function computeStraightLinePoints(
    start: Point,
    current: Point,
    zoom = 1,
): { end: Point; points: Point[]; angleDeg: number; snappedDeg: number } {
    const x0 = start.x;
    const y0 = start.y;
    const p0 = start.pressure ?? 0.5;
    const t0 = start.time ?? 0;

    const dx = current.x - x0;
    const dy = current.y - y0;
    const rDoc = Math.hypot(dx, dy);
    const rScreen = rDoc * zoom;

    let xEnd = current.x;
    let yEnd = current.y;
    let angleDeg = 0;
    let snappedDeg = 0;

    if (rDoc >= 1e-4) {
        angleDeg = (Math.atan2(dy, dx) * 180 / Math.PI) % 360;
        if (angleDeg < 0) angleDeg += 360;

        snappedDeg = snapLineAngle(angleDeg);
        const snappedRad = snappedDeg * Math.PI / 180;

        xEnd = x0 + rDoc * Math.cos(snappedRad);
        yEnd = y0 + rDoc * Math.sin(snappedRad);
    }

    const pCurr = current.pressure ?? 0.5;
    const tCurr = current.time ?? 0;
    const count = Math.max(2, Math.min(24, Math.ceil(rScreen / 8)));
    const points: Point[] = new Array(count);

    for (let k = 0; k < count; k++) {
        const u = k / (count - 1);
        points[k] = {
            x: x0 + u * (xEnd - x0),
            y: y0 + u * (yEnd - y0),
            pressure: p0 + u * (pCurr - p0),
            time: t0 + u * (tCurr - t0),
        };
    }

    return {
        end: { x: xEnd, y: yEnd, pressure: pCurr, time: tCurr },
        points,
        angleDeg,
        snappedDeg,
    };
}

export interface LiveBakeState {
    liveBakeCanvas: HTMLCanvasElement | null;
    liveBakeCtx: CanvasRenderingContext2D | null;
    liveBakedIndex: number;
    liveBakeSegState: Record<string, unknown>;
    liveBakeZoom: number;
    liveBakeScrollLeft: number;
    liveBakeScrollTop: number;
    liveBakeStyleKey: string;
}

/**
 * Hornea incrementalmente O(Δk) sólo los nuevos puntos del trazo activo en `state.liveBakeCanvas`
 * a opacidad base 1 y vuelca el buffer en `context` aplicando `activeStyle.opacity`.
 */
export function bakeLiveStrokeSegment(
    state: LiveBakeState,
    context: CanvasRenderingContext2D,
    run: readonly Point[],
    activeStyle: StrokeStyle,
    profileId: PenProfileId,
    canvasWidth: number,
    canvasHeight: number,
    zoom: number,
    scrollLeft: number,
    scrollTop: number,
    devicePixelRatio = 1,
    boxClip?: { originX: number; originY: number; scaleWidth: number; boxHeight: number } | null,
): boolean {
    const penPlugin = getPenPlugin(profileId);
    if (
        run.length < 2 ||
        !penPlugin.renderSegment ||
        typeof document === 'undefined' ||
        typeof document.createElement !== 'function' ||
        typeof context.drawImage !== 'function'
    ) {
        return false;
    }

    if (!state.liveBakeCanvas) {
        state.liveBakeCanvas = document.createElement('canvas');
        state.liveBakeCtx = typeof state.liveBakeCanvas.getContext === 'function'
            ? state.liveBakeCanvas.getContext('2d')
            : null;
    }

    const bakeCanvas = state.liveBakeCanvas;
    const bakeCtx = state.liveBakeCtx;
    if (!bakeCanvas || !bakeCtx || canvasWidth <= 0 || canvasHeight <= 0) {
        return false;
    }

    const ratio = Math.max(1, devicePixelRatio || 1);
    const styleKey = `${profileId}|${activeStyle.color}|${activeStyle.width}|${activeStyle.opacity}`;
    const sizeChanged = bakeCanvas.width !== canvasWidth || bakeCanvas.height !== canvasHeight;
    if (sizeChanged) {
        bakeCanvas.width = canvasWidth;
        bakeCanvas.height = canvasHeight;
    }

    if (
        sizeChanged ||
        state.liveBakedIndex === 0 ||
        run.length < state.liveBakedIndex ||
        state.liveBakeZoom !== zoom ||
        state.liveBakeScrollLeft !== scrollLeft ||
        state.liveBakeScrollTop !== scrollTop ||
        state.liveBakeStyleKey !== styleKey
    ) {
        bakeCtx.setTransform(1, 0, 0, 1, 0, 0);
        bakeCtx.clearRect(0, 0, bakeCanvas.width, bakeCanvas.height);
        state.liveBakedIndex = 0;
        state.liveBakeSegState = {};
        state.liveBakeZoom = zoom;
        state.liveBakeScrollLeft = scrollLeft;
        state.liveBakeScrollTop = scrollTop;
        state.liveBakeStyleKey = styleKey;
    }

    if (run.length > state.liveBakedIndex) {
        bakeCtx.save();
        bakeCtx.setTransform(
            ratio * zoom,
            0,
            0,
            ratio * zoom,
            -ratio * scrollLeft,
            -ratio * scrollTop,
        );
        if (boxClip) {
            bakeCtx.beginPath();
            bakeCtx.rect(boxClip.originX, boxClip.originY, boxClip.scaleWidth, boxClip.boxHeight);
            bakeCtx.clip();
        }
        penPlugin.renderSegment(
            bakeCtx,
            run,
            state.liveBakedIndex,
            { ...activeStyle, opacity: 1 },
            state.liveBakeSegState,
        );
        bakeCtx.restore();
        state.liveBakedIndex = run.length;
    }

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = activeStyle.opacity;
    context.drawImage(bakeCanvas, 0, 0);
    context.restore();
    return true;
}

/**
 * Obtiene o genera un sprite offscreen O(1) para un `StrokeElement` sólido,
 * invalidándolo automáticamente si cambia zoom (`scale`), color, grosor, opacidad o perfil.
 */
export function getOrCreateStrokeSprite(
    el: StrokeElement,
    strokeCache: StrokeCache,
    geom: { originX: number; scaleWidth: number; originY: number },
    zoom: number,
    devicePixelRatio = 1,
): HTMLCanvasElement | null {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        return null;
    }

    const contentLeft = geom.originX;
    const contentWidth = geom.scaleWidth;
    const blockTop = geom.originY;

    const pad = Math.ceil(el.style.width * 2) + 8;
    const docMinX = contentLeft + el.bounds.minX * contentWidth;
    const docMaxX = contentLeft + el.bounds.maxX * contentWidth;
    const docMinY = blockTop + el.bounds.minY * contentWidth;
    const docMaxY = blockTop + el.bounds.maxY * contentWidth;

    const cssW = Math.max(1, Math.ceil(docMaxX - docMinX + pad * 2));
    const cssH = Math.max(1, Math.ceil(docMaxY - docMinY + pad * 2));

    const ratio = Math.max(1, devicePixelRatio || 1);
    const rawScale = ratio * zoom;
    const maxDim = 4096;
    const scale = Math.min(rawScale, maxDim / Math.max(cssW, cssH));
    const profile = el.style.profile ?? 'fountain';

    const existing = strokeCache.get(el.id);
    if (existing) {
        const meta = (existing as any)._cacheMeta;
        if (
            meta &&
            Math.abs(meta.scale - scale) < 1e-3 &&
            meta.color === el.style.color &&
            meta.width === el.style.width &&
            meta.opacity === el.style.opacity &&
            meta.profile === profile &&
            Math.abs(meta.contentWidth - contentWidth) < 0.5
        ) {
            return existing;
        }
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = Math.max(1, Math.round(cssW * scale));
    offscreen.height = Math.max(1, Math.round(cssH * scale));
    const oCtx = typeof offscreen.getContext === 'function' ? offscreen.getContext('2d') : null;
    if (!oCtx) return null;

    oCtx.save();
    if (typeof oCtx.setTransform === 'function') {
        oCtx.setTransform(
            scale,
            0,
            0,
            scale,
            (-docMinX + pad) * scale,
            (-docMinY + pad) * scale,
        );
    }
    const worldPoints: { x: number; y: number; pressure?: number; time?: number }[] = [];
    for (let i = 0; i < el.points.length; i += 4) {
        worldPoints.push({
            x: contentLeft + el.points[i] * contentWidth,
            y: blockTop + el.points[i + 1] * contentWidth,
            pressure: el.points[i + 2],
            time: el.points[i + 3],
        });
    }
    renderContinuousSolidStroke(oCtx, worldPoints, el.style);
    oCtx.restore();

    (offscreen as any)._cacheMeta = {
        scale,
        color: el.style.color,
        width: el.style.width,
        opacity: el.style.opacity,
        profile,
        contentWidth,
        pad,
        cssW,
        cssH,
    };

    strokeCache.set(el.id, offscreen);
    el.cacheCanvas = offscreen;
    return offscreen;
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