import type { EraserMode, ToolbarSlot } from '../../core/types.ts';
import { ICONS, createSvg } from '../theme.ts';
import { applyPopoverGeometry } from '../popover/PopoverGeometry.ts';

export interface EraserEstucheState {
    mode: EraserMode;
    onlyHighlighter: boolean;
}

export class EraserEstuchePopover {
    readonly el: HTMLElement;
    private onStateChange: (state: EraserEstucheState) => void;
    private openState = false;

    private state: EraserEstucheState = {
        mode: 'whole',
        onlyHighlighter: false,
    };

    private currentAnchor: HTMLElement | null = null;
    private currentSlot: ToolbarSlot = 'tc';
    private currentToolbar: HTMLElement | null = null;

    constructor(
        onStateChange: (state: EraserEstucheState) => void,
        parent: HTMLElement = document.body
    ) {
        this.onStateChange = onStateChange;

        this.el = document.createElement('div');
        this.el.className = 'apolo-estuche-popover';
        this.el.style.width = '290px';
        this.el.style.display = 'none';
        this.el.setAttribute('role', 'dialog');
        this.el.setAttribute('aria-label', 'Estuche del borrador');
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
        initialState?: Partial<EraserEstucheState>
    ): void {
        this.openState = true;
        this.currentAnchor = anchorEl;
        this.currentSlot = slot;
        this.currentToolbar = toolbarEl;
        if (initialState) {
            this.state = { ...this.state, ...initialState };
        }

        this.render();
        this.reposition(anchorEl, slot, toolbarEl);
        this.triggerAnimation();
    }

    close(): void {
        if (!this.openState) return;
        this.openState = false;
        this.el.style.display = 'none';
        this.el.classList.remove('apolo-popover-animated');
    }

    reposition(anchorEl = this.currentAnchor, slot = this.currentSlot, toolbarEl = this.currentToolbar): void {
        if (!this.openState || !anchorEl) return;
        this.currentAnchor = anchorEl;
        this.currentSlot = slot;
        this.currentToolbar = toolbarEl;
        applyPopoverGeometry(this.el, anchorEl, toolbarEl, slot, { fallbackWidth: 290, fallbackHeight: 220 });
    }

    private triggerAnimation(): void {
        this.el.classList.remove('apolo-popover-animated');
        void this.el.offsetWidth;
        this.el.classList.add('apolo-popover-animated');
    }

    updateState(partial: Partial<EraserEstucheState>): void {
        this.state = { ...this.state, ...partial };
        if (this.openState) {
            this.render();
        }
    }

    private render(): void {
        this.el.replaceChildren();

        // 1. Header
        const header = document.createElement('div');
        header.className = 'popover-header';

        const title = document.createElement('h3');
        title.className = 'popover-title';
        title.textContent = 'Borrador';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'popover-hdr-btn popover-close';
        closeBtn.title = 'Cerrar';
        closeBtn.appendChild(createSvg(ICONS.close, { size: 16 }));
        closeBtn.onclick = () => this.close();
        header.appendChild(closeBtn);

        this.el.appendChild(header);

        // 2. Radio Options List
        const modesList = document.createElement('div');
        modesList.className = 'eraser-modes-list';

        const modes: Array<{ id: EraserMode; label: string }> = [
            { id: 'whole', label: 'Borrador de trazos' },
            { id: 'reticle', label: 'Borrador de área' },
        ];

        for (const m of modes) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `eraser-radio-row ${this.state.mode === m.id ? 'is-active' : ''}`;

            const circle = document.createElement('span');
            circle.className = 'eraser-radio-circle';

            const innerDot = document.createElement('span');
            innerDot.className = 'eraser-radio-inner-dot';
            circle.appendChild(innerDot);

            const label = document.createElement('span');
            label.textContent = m.label;

            row.append(circle, label);

            row.onclick = () => {
                this.state.mode = m.id;
                modesList.querySelectorAll('.eraser-radio-row').forEach((r) => r.classList.remove('is-active'));
                row.classList.add('is-active');
                this.onStateChange(this.state);
            };

            modesList.appendChild(row);
        }

        this.el.appendChild(modesList);

        const divider = document.createElement('div');
        divider.className = 'eraser-divider';
        this.el.appendChild(divider);

        // 3. Switch "Borrar resaltador solamente"
        const toggleRow = document.createElement('div');
        toggleRow.className = 'popover-toggle-row';

        const tTitle = document.createElement('span');
        tTitle.className = 'popover-toggle-title';
        tTitle.textContent = 'Borrar resaltador solamente';

        const sw = document.createElement('div');
        sw.className = `popover-switch ${this.state.onlyHighlighter ? 'is-checked' : ''}`;
        const thumb = document.createElement('span');
        thumb.className = 'popover-switch-thumb';
        sw.appendChild(thumb);

        sw.onclick = () => {
            this.state.onlyHighlighter = !this.state.onlyHighlighter;
            sw.classList.toggle('is-checked', this.state.onlyHighlighter);
            this.onStateChange(this.state);
        };

        toggleRow.append(tTitle, sw);
        this.el.appendChild(toggleRow);
    }

    destroy(): void {
        this.close();
        this.el.remove();
    }
}
