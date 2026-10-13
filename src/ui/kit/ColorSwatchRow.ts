import { createSvgIcon } from './Icon.ts';

export interface SwatchItem {
    id: string; // color hex or semantic id
    color: string;
    label: string;
}

export interface ColorSwatchRowOptions {
    label?: string;
    swatches?: SwatchItem[];
    colors?: string[];
    colorNames?: Record<string, string>;
    value?: string;
    selectedColor?: string;
    allowCustomColor?: boolean;
    onCustomColorRequested?: () => void;
    onChange?: (color: string) => void;
    onSelect?: (color: string) => void;
}

export class ColorSwatchRow {
    readonly element: HTMLElement;
    private options: ColorSwatchRowOptions;
    private swatchEntries: Array<{ item: SwatchItem; btn: HTMLButtonElement }> = [];
    private currentColor: string;

    constructor(options: ColorSwatchRowOptions) {
        this.options = options;
        const initial = options.selectedColor ?? options.value ?? '#000000';
        this.currentColor = initial.toLowerCase();

        this.element = document.createElement('div');
        this.element.className = 'apolo-swatches-row';
        this.element.setAttribute('role', 'radiogroup');
        if (options.label) {
            this.element.setAttribute('aria-label', options.label);
        }

        this.renderSwatches();
    }

    private getNormalizedSwatches(): SwatchItem[] {
        if (this.options.swatches && this.options.swatches.length > 0) {
            return this.options.swatches;
        }
        if (this.options.colors && this.options.colors.length > 0) {
            return this.options.colors.map(col => ({
                id: col,
                color: col,
                label: this.options.colorNames?.[col] ?? col,
            }));
        }
        return [];
    }

    private renderSwatches(): void {
        this.element.replaceChildren();
        this.swatchEntries = [];

        const swatches = this.getNormalizedSwatches();
        for (const s of swatches) {
            const btn = document.createElement('button');
            btn.type = 'button';
            const isActive = this.currentColor === s.color.toLowerCase() || this.currentColor === s.id.toLowerCase();
            btn.className = `apolo-swatch-btn${isActive ? ' is-active' : ''}`;
            btn.setAttribute('role', 'radio');
            btn.setAttribute('aria-checked', String(isActive));
            btn.setAttribute('aria-label', s.label);
            if (typeof btn.style?.setProperty === 'function') {
                btn.style.setProperty('--swatch-color', s.color);
            }
            btn.style.backgroundColor = s.color;

            btn.addEventListener('click', () => {
                this.setColor(s.color);
                this.options.onChange?.(s.color);
                this.options.onSelect?.(s.color);
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

    setSelectedColor(color: string): void {
        this.setColor(color);
    }

    getColor(): string {
        return this.currentColor;
    }
}
