import type { ToolbarSlot } from '../../core/types.ts';

export interface PopoverGeometryOptions {
    offset?: number;
    margin?: number;
    fallbackWidth?: number;
    fallbackHeight?: number;
    targetHeight?: number;
}

/**
 * Intelligent viewport-aware positioning for all floating popovers (Estuches, Thickness, ColorPicker).
 * Guarantees zero overlap with the toolbar across all 8 slots (corners + edges),
 * handles vertical/horizontal orientation, and auto-scrolls max-height when screen space is limited.
 */
export function applyPopoverGeometry(
    popoverEl: HTMLElement,
    anchorEl: HTMLElement | null,
    toolbarEl: HTMLElement | null,
    slot: ToolbarSlot,
    options: PopoverGeometryOptions = {}
): void {
    if (!anchorEl && !toolbarEl) {
        return;
    }

    const offset = options.offset ?? 12;
    const margin = options.margin ?? 16;

    const wasVisible = popoverEl.style.visibility !== 'hidden' && !popoverEl.hidden;
    if (!wasVisible) {
        popoverEl.style.visibility = 'hidden';
    }
    popoverEl.style.display = 'flex';
    popoverEl.style.maxHeight = '';
    popoverEl.style.overflowY = '';

    const popRect = popoverEl.getBoundingClientRect();
    const popW = popRect.width || popoverEl.offsetWidth || (options.fallbackWidth ?? 320);
    const popH = options.targetHeight ?? (popRect.height || popoverEl.offsetHeight || (options.fallbackHeight ?? 440));

    const anchorRect = anchorEl
        ? anchorEl.getBoundingClientRect()
        : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
    const tbRect = toolbarEl ? toolbarEl.getBoundingClientRect() : anchorRect;

    const vp = typeof window !== 'undefined' ? window.visualViewport : null;
    const vpW = vp?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 1280);
    const vpH = vp?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 800);
    const vpLeft = vp?.offsetLeft ?? 0;
    const vpTop = vp?.offsetTop ?? 0;

    let left = 0;
    let originX = 'center';
    let originY = 'center';

    const isBottom = slot === 'bl' || slot === 'bc' || slot === 'br';
    const isTop = slot === 'tl' || slot === 'tc' || slot === 'tr';

    // Horizontal placement
    if (slot === 'ml') {
        left = tbRect.right + offset;
        originX = 'left';
    } else if (slot === 'mr') {
        left = tbRect.left - offset - popW;
        originX = 'right';
    } else {
        left = (anchorRect.left + anchorRect.width / 2) - popW / 2;
        originX = `${Math.max(24, Math.min(popW - 24, (anchorRect.left + anchorRect.width / 2) - left))}px`;
    }

    const minLeft = vpLeft + margin;
    const maxLeft = vpLeft + vpW - popW - margin;
    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = maxLeft;

    // Vertical placement: Global edge-anchoring extending towards center
    const vpCenterY = vpTop + vpH / 2;
    const anchorCenterY = anchorRect.top + anchorRect.height / 2;

    const anchorEdge: 'bottom' | 'top' = isBottom
        ? 'bottom'
        : isTop
          ? 'top'
          : anchorCenterY >= vpCenterY
            ? 'bottom'
            : 'top';

    if (anchorEdge === 'bottom') {
        const refBottom = isBottom
            ? tbRect.top - offset
            : Math.min(anchorCenterY + popH / 2, vpTop + vpH - margin);
        const bottomCoord = Math.min(refBottom, vpTop + vpH - margin);
        const bottomPx = (vpTop + vpH) - bottomCoord;
        const safeBottomPx = Math.max(margin, bottomPx);

        const availableH = vpH - safeBottomPx - margin;
        if (popH > availableH && availableH > 200) {
            popoverEl.style.maxHeight = `${availableH}px`;
            popoverEl.style.overflowY = 'auto';
        }

        popoverEl.style.bottom = `${Math.round(safeBottomPx)}px`;
        popoverEl.style.top = 'auto';
        originY = 'bottom';
    } else {
        const refTop = isTop
            ? tbRect.bottom + offset
            : Math.max(anchorCenterY - popH / 2, vpTop + margin);
        const topCoord = Math.max(refTop, vpTop + margin);

        const availableH = (vpTop + vpH - margin) - topCoord;
        if (popH > availableH && availableH > 200) {
            popoverEl.style.maxHeight = `${availableH}px`;
            popoverEl.style.overflowY = 'auto';
        }

        popoverEl.style.top = `${Math.round(topCoord)}px`;
        popoverEl.style.bottom = 'auto';
        originY = 'top';
    }

    popoverEl.style.left = `${Math.round(left)}px`;
    popoverEl.style.transformOrigin = `${originX} ${originY}`;
    if (!wasVisible) {
        popoverEl.style.visibility = '';
    }
}
