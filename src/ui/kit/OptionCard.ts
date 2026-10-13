import { createSvgIcon, type IconName } from './Icon.ts';

export interface OptionCardOptions {
    id?: string;
    title: string;
    icon?: IconName;
    previewElement?: HTMLElement | SVGSVGElement;
    preview?: HTMLElement | SVGSVGElement;
    description?: string;
    active?: boolean;
    selected?: boolean;
    onClick?: () => void;
}

export class OptionCard {
    readonly element: HTMLButtonElement;
    private previewWrap?: HTMLElement;
    private options: OptionCardOptions;

    constructor(options: OptionCardOptions) {
        this.options = options;
        const isActive = Boolean(options.selected ?? options.active);

        this.element = document.createElement('button');
        this.element.type = 'button';
        this.element.className = `apolo-option-card${isActive ? ' is-active' : ''}`;
        this.element.setAttribute('role', 'radio');
        this.element.setAttribute('aria-checked', String(isActive));
        this.element.setAttribute('aria-label', options.title);

        const header = document.createElement('div');
        header.className = 'apolo-option-card-header';

        if (options.icon) {
            const iconWrap = document.createElement('span');
            iconWrap.className = 'apolo-option-card-icon';
            iconWrap.appendChild(createSvgIcon(options.icon, { size: 18 }));
            header.appendChild(iconWrap);
        }

        const titleSpan = document.createElement('span');
        titleSpan.className = 'apolo-option-card-title';
        titleSpan.textContent = options.title;
        header.appendChild(titleSpan);
        this.element.appendChild(header);

        const previewEl = options.preview ?? options.previewElement;
        if (previewEl) {
            this.previewWrap = document.createElement('div');
            this.previewWrap.className = 'apolo-option-card-preview';
            this.previewWrap.appendChild(previewEl);
            this.element.appendChild(this.previewWrap);
        }

        if (options.description) {
            const descSpan = document.createElement('span');
            descSpan.className = 'apolo-option-card-desc';
            descSpan.textContent = options.description;
            this.element.appendChild(descSpan);
        }

        this.element.addEventListener('click', () => {
            this.options.onClick?.();
        });
    }

    setActive(active: boolean): void {
        this.options.active = active;
        this.options.selected = active;
        this.element.classList.toggle('is-active', active);
        this.element.setAttribute('aria-checked', String(active));
    }

    setSelected(selected: boolean): void {
        this.setActive(selected);
    }

    setPreview(previewElement: HTMLElement | SVGSVGElement): void {
        if (!this.previewWrap) {
            this.previewWrap = document.createElement('div');
            this.previewWrap.className = 'apolo-option-card-preview';
            this.element.appendChild(this.previewWrap);
        }
        this.previewWrap.replaceChildren(previewElement);
    }
}
