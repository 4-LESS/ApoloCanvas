import type { ToolbarSlot } from '../../core/types.ts';
import { ICONS, createSvg } from '../theme.ts';
import { applyPopoverGeometry } from './PopoverGeometry.ts';

export class ThicknessPopover {
    readonly el: HTMLElement;
    private onWidthChange: (width: number) => void;
    private openState = false;
    private currentValue = 3;
    private min = 1;
    private max = 20;
    private currentAnchor: HTMLElement | null = null;
    private currentSlot: ToolbarSlot = 'tc';
    private currentToolbar: HTMLElement | null = null;

    constructor(onWidthChange: (width: number) => void, parent: HTMLElement = document.body) {
        this.onWidthChange = onWidthChange;

        this.el = document.createElement('div');
        this.el.className = 'apolo-thickness-popover';
        this.el.hidden = true;
        this.el.style.display = 'none';
        this.el.setAttribute('role', 'dialog');
        this.el.setAttribute('aria-label', 'Selector de grosor');
        this.el.addEventListener('pointerdown', (e) => e.stopPropagation());

        parent.appendChild(this.el);
    }

    isOpen(): boolean {
        return this.openState;
    }

    open(
        anchorEl: HTMLElement,
        slot: ToolbarSlot,
        toolbarEl: HTMLElement,
        initialValue = 3,
        range: { min?: number; max?: number } = {}
    ): void {
        this.openState = true;
        this.el.hidden = false;
        this.el.style.display = 'flex';
        this.currentAnchor = anchorEl;
        this.currentSlot = slot;
        this.currentToolbar = toolbarEl;
        this.min = range.min ?? 1;
        this.max = range.max ?? 20;
        this.currentValue = Math.max(this.min, Math.min(this.max, initialValue));

        this.render();
        this.reposition(anchorEl, slot, toolbarEl);
        this.triggerAnimation();
    }

    close(): void {
        if (!this.openState) return;
        this.openState = false;
        this.el.hidden = true;
        this.el.style.display = 'none';
        this.el.classList.remove('apolo-popover-animated');
    }

    reposition(anchorEl = this.currentAnchor, slot = this.currentSlot, toolbarEl = this.currentToolbar): void {
        if (!this.openState || !anchorEl) return;
        this.currentAnchor = anchorEl;
        this.currentSlot = slot;
        this.currentToolbar = toolbarEl;
        applyPopoverGeometry(this.el, anchorEl, toolbarEl, slot, { fallbackWidth: 310, fallbackHeight: 56 });
    }

    private triggerAnimation(): void {
        this.el.classList.remove('apolo-popover-animated');
        void this.el.offsetWidth;
        this.el.classList.add('apolo-popover-animated');
    }

    private render(): void {
        this.el.replaceChildren();

        const minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.className = 'thickness-step-btn';
        minusBtn.title = 'Reducir tamaño';
        minusBtn.setAttribute('aria-label', 'Reducir grosor');
        minusBtn.appendChild(createSvg(ICONS.minus, { size: 16 }));

        const trackWrap = document.createElement('div');
        trackWrap.className = 'thickness-slider-track-wrap';

        const dotsBg = document.createElement('div');
        dotsBg.className = 'thickness-slider-dots-bg';

        const bubble = document.createElement('div');
        bubble.className = 'thickness-bubble-val';
        bubble.textContent = String(this.currentValue);

        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'thickness-range-input';
        input.min = String(this.min);
        input.max = String(this.max);
        input.value = String(this.currentValue);
        input.setAttribute('aria-label', 'Grosor');
        input.style.width = '100%';
        input.style.minWidth = '0';
        input.style.maxWidth = 'none';
        input.style.flex = '1 1 100%';

        trackWrap.append(dotsBg, input, bubble);

        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.className = 'thickness-step-btn';
        plusBtn.title = 'Aumentar tamaño';
        plusBtn.setAttribute('aria-label', 'Aumentar grosor');
        plusBtn.appendChild(createSvg(ICONS.plus, { size: 16 }));

        const updateVal = (val: number, notify = true) => {
            val = Math.max(this.min, Math.min(this.max, val));
            this.currentValue = val;
            input.value = String(val);
            bubble.textContent = String(val);
            const ratio = Math.max(0, Math.min(1, (val - this.min) / (this.max - this.min)));
            bubble.style.left = `calc(${ratio * 100}% - ${ratio * 32}px)`;
            if (notify) this.onWidthChange(val);
        };

        input.oninput = () => updateVal(Number(input.value));
        minusBtn.onclick = () => updateVal(Number(input.value) - 1);
        plusBtn.onclick = () => updateVal(Number(input.value) + 1);

        this.el.append(minusBtn, trackWrap, plusBtn);
        // Initial bubble position
        setTimeout(() => updateVal(this.currentValue, false), 0);
    }

    destroy(): void {
        this.close();
        this.el.remove();
    }
}
