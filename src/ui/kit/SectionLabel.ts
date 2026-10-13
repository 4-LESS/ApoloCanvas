/**
 * Creates an uppercase semantic section label using design system tokens.
 */
export function createSectionLabel(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'apolo-section-label';
    el.textContent = text;
    return el;
}
