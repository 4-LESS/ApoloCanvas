export type PopoverPlacement = 'bottom' | 'top' | 'left' | 'right' | 'auto';

export interface RectLike {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface AnchorPositionOptions {
    anchorRect: RectLike;
    popoverSize: { width: number; height: number };
    preferredPlacement?: PopoverPlacement;
    offset?: number;
    padding?: number;
}

export interface AnchorPositionResult {
    left: number;
    top: number;
    placement: 'bottom' | 'top' | 'left' | 'right';
}

/**
 * Calculates optimal viewport coordinates for anchor-docked popovers.
 * Automatically flips vertically or horizontally when space is constrained.
 * Honors visualViewport boundaries (essential for Galaxy Tab S10 with on-screen keyboard).
 */
export function calculateAnchorPosition(options: AnchorPositionOptions): AnchorPositionResult {
    const {
        anchorRect,
        popoverSize,
        preferredPlacement = 'bottom',
        offset = 8,
        padding = 12,
    } = options;

    const vp = typeof window !== 'undefined' ? window.visualViewport : null;
    const vpWidth = vp?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 1024);
    const vpHeight = vp?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 768);
    const vpLeft = vp?.offsetLeft ?? 0;
    const vpTop = vp?.offsetTop ?? 0;

    let placement: 'bottom' | 'top' | 'left' | 'right' = 'bottom';
    let left = 0;
    let top = 0;

    // Handle horizontal preferred placement (for vertical side toolbars)
    if (preferredPlacement === 'right' || preferredPlacement === 'left') {
        const spaceRight = vpWidth - (anchorRect.right + offset);
        const spaceLeft = anchorRect.left - offset;

        if (preferredPlacement === 'right' && spaceRight < popoverSize.width && spaceLeft >= popoverSize.width) {
            placement = 'left';
            left = anchorRect.left - offset - popoverSize.width;
        } else if (preferredPlacement === 'left' && spaceLeft < popoverSize.width && spaceRight >= popoverSize.width) {
            placement = 'right';
            left = anchorRect.right + offset;
        } else if (preferredPlacement === 'right') {
            placement = 'right';
            left = anchorRect.right + offset;
        } else {
            placement = 'left';
            left = anchorRect.left - offset - popoverSize.width;
        }

        // Center vertically on anchor
        top = anchorRect.top + (anchorRect.height / 2) - (popoverSize.height / 2);
    } else {
        // Vertical preferred placement (bottom or top)
        const spaceBelow = vpHeight - (anchorRect.bottom + offset);
        const spaceAbove = anchorRect.top - offset;

        if (preferredPlacement === 'top') {
            if (spaceAbove < popoverSize.height && spaceBelow >= popoverSize.height) {
                placement = 'bottom';
                top = anchorRect.bottom + offset;
            } else {
                placement = 'top';
                top = anchorRect.top - offset - popoverSize.height;
            }
        } else {
            // Default: bottom
            if (spaceBelow < popoverSize.height && spaceAbove >= popoverSize.height) {
                placement = 'top';
                top = anchorRect.top - offset - popoverSize.height;
            } else {
                placement = 'bottom';
                top = anchorRect.bottom + offset;
            }
        }

        // Center horizontally on anchor
        left = anchorRect.left + (anchorRect.width / 2) - (popoverSize.width / 2);
    }

    // Clamp within viewport safe margin
    const minLeft = vpLeft + padding;
    const maxLeft = vpLeft + vpWidth - popoverSize.width - padding;
    left = Math.max(minLeft, Math.min(Math.max(minLeft, maxLeft), left));

    const minTop = vpTop + padding;
    const maxTop = vpTop + vpHeight - popoverSize.height - padding;
    top = Math.max(minTop, Math.min(Math.max(minTop, maxTop), top));

    return {
        left: Math.round(left),
        top: Math.round(top),
        placement,
    };
}

/**
 * Applies calculated anchor position to an element via position: fixed.
 */
export function applyPopoverPosition(element: HTMLElement, pos: AnchorPositionResult): void {
    element.style.position = 'fixed';
    element.style.left = `${pos.left}px`;
    element.style.top = `${pos.top}px`;
}
