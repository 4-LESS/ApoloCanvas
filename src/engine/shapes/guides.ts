/**
 * src/engine/shapes/guides.ts
 *
 * Smart alignment snap guides: computes live alignment guides (min, center, max)
 * on X and Y axes between the dragged shape/selection and other shapes on the canvas.
 */

export interface AlignmentGuide {
    axis: 'x' | 'y';
    /** Position in document coordinates where the guide line lies */
    position: number;
    /** Start coordinate along the perpendicular axis */
    from: number;
    /** End coordinate along the perpendicular axis */
    to: number;
}

export interface SnapTargetBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface SmartGuideResult {
    deltaX: number;
    deltaY: number;
    guides: AlignmentGuide[];
}

/**
 * Computes smart alignment guides and snap offsets.
 *
 * @param activeBounds Bounding box of the element(s) currently being moved/dragged
 * @param otherBounds Array of bounding boxes of static shapes on the canvas
 * @param toleranceDoc Snap distance threshold in document coordinates (typically 5 / zoom)
 */
export function computeSmartAlignmentGuides(
    activeBounds: SnapTargetBounds,
    otherBounds: readonly SnapTargetBounds[],
    toleranceDoc: number,
): SmartGuideResult {
    let deltaX = 0;
    let deltaY = 0;
    let bestDistX = toleranceDoc + 0.0001;
    let bestDistY = toleranceDoc + 0.0001;
    const guides: AlignmentGuide[] = [];

    const activeCenterX = (activeBounds.minX + activeBounds.maxX) / 2;
    const activeCenterY = (activeBounds.minY + activeBounds.maxY) / 2;

    const activeXPoints = [activeBounds.minX, activeCenterX, activeBounds.maxX];
    const activeYPoints = [activeBounds.minY, activeCenterY, activeBounds.maxY];

    let snapMatchX: { pos: number; fromY: number; toY: number } | null = null;
    let snapMatchY: { pos: number; fromX: number; toX: number } | null = null;

    for (const ob of otherBounds) {
        const obCenterX = (ob.minX + ob.maxX) / 2;
        const obCenterY = (ob.minY + ob.maxY) / 2;
        const obXPoints = [ob.minX, obCenterX, ob.maxX];
        const obYPoints = [ob.minY, obCenterY, ob.maxY];

        // Check X alignments
        for (const ax of activeXPoints) {
            for (const ox of obXPoints) {
                const diff = ox - ax;
                if (Math.abs(diff) <= toleranceDoc && Math.abs(diff) < bestDistX) {
                    bestDistX = Math.abs(diff);
                    deltaX = diff;
                    snapMatchX = {
                        pos: ox,
                        fromY: Math.min(activeBounds.minY, ob.minY) - 15,
                        toY: Math.max(activeBounds.maxY, ob.maxY) + 15,
                    };
                }
            }
        }

        // Check Y alignments
        for (const ay of activeYPoints) {
            for (const oy of obYPoints) {
                const diff = oy - ay;
                if (Math.abs(diff) <= toleranceDoc && Math.abs(diff) < bestDistY) {
                    bestDistY = Math.abs(diff);
                    deltaY = diff;
                    snapMatchY = {
                        pos: oy,
                        fromX: Math.min(activeBounds.minX, ob.minX) - 15,
                        toX: Math.max(activeBounds.maxX, ob.maxX) + 15,
                    };
                }
            }
        }
    }

    if (snapMatchX) {
        guides.push({
            axis: 'x',
            position: snapMatchX.pos,
            from: snapMatchX.fromY,
            to: snapMatchX.toY,
        });
    }
    if (snapMatchY) {
        guides.push({
            axis: 'y',
            position: snapMatchY.pos,
            from: snapMatchY.fromX,
            to: snapMatchY.toX,
        });
    }

    return {
        deltaX,
        deltaY,
        guides,
    };
}
