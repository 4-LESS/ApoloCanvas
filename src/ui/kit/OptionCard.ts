import { createSvgIcon, type IconName } from './Icon.ts';

export interface OptionCardOptions {
    id: string;
    title: string;
    icon?: IconName;
    previewElement?: HTMLElement | SVGSVGElement;
    description?: string;
    active?: boolean;
    onClick?: () => void;
}

export class OptionCard {
    readonly element: HTMLButtonElement;
    private options: OptionCardOptions;

    constructor(options: OptionCardOptions) {
        this.options = options;

        this.element = document.createElement('button');
        this.element.type = 'button';
        this.element.className = `apolo-option-card${options.active ? ' is-active' : ''}`;
        this.element.setAttribute('role', 'radio');
        this.element.setAttribute('aria-checked', String(Boolean(options.active)));
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

        if (options.previewElement) {
            const previewWrap = document.createElement('div');
            previewWrap.className = 'apolo-option-card-preview';
            previewWrap.appendChild(options.previewElement);
            this.element.appendChild(previewWrap);
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
        this.element.classList.toggle('is-active', active);
        this.element.setAttribute('aria-checked', String(active));
    }
}
