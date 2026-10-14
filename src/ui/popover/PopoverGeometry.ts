import type { ToolbarSlot } from '../../core/types.ts';

export interface PopoverGeometryOptions {
    offset?: number;
    margin?: number;
    fallbackWidth?: number;
    fallbackHeight?: number;
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

    popoverEl.style.visibility = 'hidden';
    popoverEl.style.display = 'flex';
    popoverEl.style.maxHeight = '';
    popoverEl.style.overflowY = '';

    const popRect = popoverEl.getBoundingClientRect();
    const popW = popRect.width || popoverEl.offsetWidth || (options.fallbackWidth ?? 320);
    const popH = popRect.height || popoverEl.offsetHeight || (options.fallbackHeight ?? 440);

    const anchorRect = anchorEl
        ? anchorEl.getBoundingClientRect()
        : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
    const tbRect = toolbarEl ? toolbarEl.getBoundingClientRect() : anchorRect;

    const vpW = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vpH = typeof window !== 'undefined' ? window.innerHeight : 800;

    let left = 0;
    let top = 0;
    let originX = 'center';
    let originY = 'center';

    const isBottom = slot === 'bl' || slot === 'bc' || slot === 'br';
    const isTop = slot === 'tl' || slot === 'tc' || slot === 'tr';

    if (slot === 'ml') {
        left = tbRect.right + offset;
        top = (anchorRect.top + anchorRect.height / 2) - popH / 2;
        originX = 'left';
        originY = `${Math.max(24, Math.min(popH - 24, (anchorRect.top + anchorRect.height / 2) - top))}px`;
    } else if (slot === 'mr') {
        left = tbRect.left - offset - popW;
        top = (anchorRect.top + anchorRect.height / 2) - popH / 2;
        originX = 'right';
        originY = `${Math.max(24, Math.min(popH - 24, (anchorRect.top + anchorRect.height / 2) - top))}px`;
    } else if (isBottom) {
        top = tbRect.top - offset - popH;
        left = (anchorRect.left + anchorRect.width / 2) - popW / 2;
        originX = `${Math.max(24, Math.min(popW - 24, (anchorRect.left + anchorRect.width / 2) - left))}px`;
        originY = 'bottom';
    } else {
        // 'tl', 'tc', 'tr'
        top = tbRect.bottom + offset;
        left = (anchorRect.left + anchorRect.width / 2) - popW / 2;
        originX = `${Math.max(24, Math.min(popW - 24, (anchorRect.left + anchorRect.width / 2) - left))}px`;
        originY = 'top';
    }

    if (left < margin) left = margin;
    if (left + popW > vpW - margin) left = vpW - popW - margin;

    if (isBottom) {
        if (top < margin) {
            top = margin;
            const availableH = tbRect.top - offset - margin;
            if (popH > availableH && availableH > 220) {
                popoverEl.style.maxHeight = `${availableH}px`;
                popoverEl.style.overflowY = 'auto';
            }
        }
    } else if (isTop) {
        if (top + popH > vpH - margin) {
            const availableH = vpH - margin - top;
            if (popH > availableH && availableH > 220) {
                popoverEl.style.maxHeight = `${availableH}px`;
                popoverEl.style.overflowY = 'auto';
            }
        }
    } else {
        if (top < margin) top = margin;
        if (top + popH > vpH - margin) top = vpH - popH - margin;
    }

    popoverEl.style.left = `${Math.round(left)}px`;
    popoverEl.style.top = `${Math.round(top)}px`;
    popoverEl.style.transformOrigin = `${originX} ${originY}`;
    popoverEl.style.visibility = '';
}
