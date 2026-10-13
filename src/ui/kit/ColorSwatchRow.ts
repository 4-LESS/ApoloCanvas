import { createSvgIcon } from './Icon.ts';

export interface SwatchItem {
    id: string; // color hex or semantic id
    color: string;
    label: string;
}

export interface ColorSwatchRowOptions {
    label: string;
    swatches: SwatchItem[];
    value: string;
    allowCustomColor?: boolean;
    onCustomColorRequested?: () => void;
    onChange: (color: string) => void;
}

export class ColorSwatchRow {
    readonly element: HTMLElement;
    private options: ColorSwatchRowOptions;
    private swatchEntries: Array<{ item: SwatchItem; btn: HTMLButtonElement }> = [];
    private currentColor: string;

    constructor(options: ColorSwatchRowOptions) {
        this.options = options;
        this.currentColor = options.value.toLowerCase();

        this.element = document.createElement('div');
        this.element.className = 'apolo-swatches-row';
        this.element.setAttribute('role', 'radiogroup');
        this.element.setAttribute('aria-label', options.label);

        this.renderSwatches();
    }

    private renderSwatches(): void {
        this.element.replaceChildren();
        this.swatchEntries = [];

        for (const s of this.options.swatches) {
            const btn = document.createElement('button');
            btn.type = 'button';
            const isActive = this.currentColor === s.color.toLowerCase() || this.currentColor === s.id.toLowerCase();
            btn.className = `apolo-swatch-btn${isActive ? ' is-active' : ''}`;
            btn.setAttribute('role', 'radio');
            btn.setAttribute('aria-checked', String(isActive));
            btn.setAttribute('aria-label', s.label);
            btn.title = s.label;
            btn.style.setProperty('--swatch-color', s.color);
            btn.style.backgroundColor = s.color;

            btn.addEventListener('click', () => {
                this.setColor(s.color);
                this.options.onChange(s.color);
            });

            this.swatchEntries.push({ item: s, btn });
            this.element.appendChild(btn);
        }

        if (this.options.allowCustomColor) {
            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'apolo-swatch-add-btn';
            addBtn.setAttribute('aria-label', 'Selector de color personalizado');
            addBtn.title = 'Color personalizado';
            addBtn.appendChild(createSvgIcon('plus', { size: 16 }));

            addBtn.addEventListener('click', () => {
                this.options.onCustomColorRequested?.();
            });

            this.element.appendChild(addBtn);
        }
    }

    setColor(color: string): void {
        this.currentColor = color.toLowerCase();
        for (const { item, btn } of this.swatchEntries) {
            const isActive = item.color.toLowerCase() === this.currentColor || item.id.toLowerCase() === this.currentColor;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-checked', String(isActive));
        }
    }

    getColor(): string {
        return this.currentColor;
    }
}
