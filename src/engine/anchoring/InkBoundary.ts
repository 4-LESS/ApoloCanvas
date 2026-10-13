/**
 * InkBoundary module for Apolo Canvas
 * Defines stability limits, forbidden zones, and coordinate sanitization for inking.
 */

export interface InkLimits {
    /** Upward tolerance in document pixels above the first content element */
    topMarginPx: number;
}

export const DEFAULT_INK_LIMITS: InkLimits = {
    topMarginPx: 4,
};

export interface SpaceBlockRegion {
    top: number;
    bottom: number;
}

export interface DocumentContentBounds {
    contentLeft: number;
    contentWidth: number;
    contentTop: number;
    contentBottom: number;
    spaceBlocks: SpaceBlockRegion[];
}

export const FORBIDDEN_DOM_SELECTORS = [
    // Apolo Canvas UI overlays
    '.apolo-ui',
    '.apolo-toolbar',
    '.apolo-canvas-toolbar',
    '.apolo-estuche',
    '.apolo-tool-estuche',
    '.apolo-popover-panel',
    '.apolo-lasso-menu',
    '.apolo-more-menu',
    '.apolo-zoom-pill',
    '.apolo-toast',
    '.apolo-box-menu-container',
    // Obsidian header and workspace elements
    '.view-header',
    '.workspace-ribbon',
    '.workspace-tab-header-container',
    // Obsidian Frontmatter / Properties & Note Title
    '.metadata-container',
    '.metadata-properties-heading',
    '.inline-title',
    // CodeMirror Gutters (line numbers and folding markers)
    '.cm-gutters',
    // Interactive HTML controls
    'button',
    'input',
    'textarea',
    'select',
    'audio',
    'video',
    'iframe',
];

/**
 * Checks whether a document-space coordinate (docX, docY) is within the allowable
 * area for drawing ink. Forbids drawing above the content top (frontmatter/title),
 * while permitting free drawing anywhere below (including empty space below text).
 */
export function isInkAllowedAt(
    docX: number,
    docY: number,
    bounds: DocumentContentBounds,
    limits: InkLimits = DEFAULT_INK_LIMITS,
): { allowed: boolean; reason?: string } {
    if (bounds.contentWidth <= 0) {
        return { allowed: false, reason: 'invalid-content-width' };
    }

    // Top Boundary Check (protects frontmatter, note title, and above-content void)
    if (docY < bounds.contentTop - limits.topMarginPx) {
        return { allowed: false, reason: 'above-content-top' };
    }

    return { allowed: true };
}

/**
 * Sanitizes normalized coordinates to ensure values are finite and valid numbers.
 * If isBoxStroke is true, confines u to [0, 1] and v to >= 0 (clipping to box boundaries).
 * If isBoxStroke is false (freehand ink), preserves coordinates without artificial clamping.
 */
export function sanitizeNormalizedPoint(
    u: number,
    v: number,
    options?: { isBoxStroke?: boolean },
): { u: number; v: number } {
    let safeU = Number.isFinite(u) ? u : 0;
    let safeV = Number.isFinite(v) ? v : 0;
    if (options?.isBoxStroke) {
        safeU = Math.max(0, Math.min(1, safeU));
        safeV = Math.max(0, safeV);
    }
    return { u: safeU, v: safeV };
}

/**
 * Snaps normalized coordinates to an N-division grid (step = 1 / N).
 * Both axes are normalized by contentWidth, so snapping to 1/N
 * preserves exact square grid cells proportional to column width.
 */
export function snapNormalizedPoint(
    u: number,
    v: number,
    density = 32,
): { u: number; v: number } {
    if (density <= 0) return { u, v };
    const step = 1 / density;
    const snappedU = Math.round(u / step) * step;
    const snappedV = Math.round(v / step) * step;
    return {
        u: Math.round(snappedU * 100000) / 100000,
        v: Math.round(snappedV * 100000) / 100000,
    };
}

export interface BoundaryPoint {
    x: number;
    y: number;
    pressure?: number;
    time?: number;
}

/**
 * Splits a list of drawn points into contiguous valid runs based on the top boundary threshold.
 * If a stroke moves into a forbidden zone and later returns to the allowable canvas,
 * it is partitioned into separate disconnected runs, interpolating the exact boundary entry
 * and exit coordinates. This eliminates bridging / jumping straight-line artifacts between
 * the exit point and the re-entry point.
 */
export function splitStrokeIntoValidRuns<T extends BoundaryPoint>(
    points: readonly T[],
    contentTop: number,
    topMarginPx: number = DEFAULT_INK_LIMITS.topMarginPx,
): T[][] {
    if (points.length === 0) return [];
    if (contentTop <= 0) return [[...points]];

    const forbiddenY = contentTop - topMarginPx;
    const runs: T[][] = [];
    let currentRun: T[] = [];

    for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const isValid = pt.y >= forbiddenY;

        if (isValid) {
            // If previous point was in forbidden zone, interpolate boundary entry
            if (i > 0 && points[i - 1].y < forbiddenY) {
                const prev = points[i - 1];
                const dy = pt.y - prev.y;
                if (dy !== 0) {
                    const t = (forbiddenY - prev.y) / dy;
                    const intersectX = prev.x + t * (pt.x - prev.x);
                    currentRun.push({
                        ...pt,
                        x: intersectX,
                        y: forbiddenY,
                        pressure: (prev.pressure ?? 0.5) + t * ((pt.pressure ?? 0.5) - (prev.pressure ?? 0.5)),
                        time: (prev.time ?? 0) + t * ((pt.time ?? 0) - (prev.time ?? 0)),
                    });
                }
            }
            currentRun.push(pt);
        } else {
            // Point is in forbidden zone
            // If previous point was valid, close current run at boundary exit
            if (currentRun.length > 0 && i > 0 && points[i - 1].y >= forbiddenY) {
                const prev = points[i - 1];
                const dy = pt.y - prev.y;
                if (dy !== 0) {
                    const t = (forbiddenY - prev.y) / dy;
                    const intersectX = prev.x + t * (pt.x - prev.x);
                    currentRun.push({
                        ...pt,
                        x: intersectX,
                        y: forbiddenY,
                        pressure: (prev.pressure ?? 0.5) + t * ((pt.pressure ?? 0.5) - (prev.pressure ?? 0.5)),
                        time: (prev.time ?? 0) + t * ((pt.time ?? 0) - (prev.time ?? 0)),
                    });
                }
                runs.push(currentRun);
                currentRun = [];
            }
        }
    }

    if (currentRun.length > 0) {
        runs.push(currentRun);
    }

    return runs;
}

/**
 * Checks if a given DOM element or any of its ancestors matches any forbidden selector.
 */
export function isElementForbidden(
    element: Element | null,
    selectors: readonly string[] = FORBIDDEN_DOM_SELECTORS,
): boolean {
    if (!element) return false;
    for (const sel of selectors) {
        try {
            if (element.matches(sel) || element.closest(sel) !== null) {
                return true;
            }
        } catch {
            // ignore selector syntax errors if any
        }
    }
    return false;
}

/**
 * Checks if a screen viewport point (clientX, clientY) hits any forbidden UI element,
 * querying through canvas layers via elementsFromPoint.
 */
export function isScreenPointForbidden(
    clientX: number,
    clientY: number,
    selectors: readonly string[] = FORBIDDEN_DOM_SELECTORS,
): boolean {
    if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') {
        return false;
    }

    const elements = document.elementsFromPoint(clientX, clientY);
    for (const el of elements) {
        // Skip canvas surfaces themselves
        if (
            el.classList?.contains('apolo-canvas-surface') ||
            el.classList?.contains('apolo-canvas-layer')
        ) {
            continue;
        }

        if (isElementForbidden(el, selectors)) {
            return true;
        }
    }

    return false;
}
