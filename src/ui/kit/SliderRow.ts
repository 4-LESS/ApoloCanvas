export interface SliderRowOptions {
    label: string;
    min: number;
    max: number;
    step?: number;
    value: number;
    unit?: string;
    formatValue?: (value: number) => string;
    onInput?: (value: number) => void;
    onChange?: (value: number) => void;
}

/**
 * Accessible slider row with label and live numeric readout.
 * NEVER destroys the <input type="range"> node during dragging,
 * ensuring fluid continuous touch dragging without focus interruption.
 */
export class SliderRow {
    readonly element: HTMLElement;
    private labelEl: HTMLElement;
    private valEl: HTMLElement;
    private inputEl: HTMLInputElement;
    private options: SliderRowOptions;

    constructor(options: SliderRowOptions) {
        this.options = options;

        this.element = document.createElement('div');
        this.element.className = 'apolo-slider-row';

        const header = document.createElement('div');
        header.className = 'apolo-slider-header';

        this.labelEl = document.createElement('span');
        this.labelEl.className = 'apolo-slider-label';
        this.labelEl.textContent = options.label;

        this.valEl = document.createElement('span');
        this.valEl.className = 'apolo-slider-val';
        this.valEl.textContent = this.format(options.value);

        header.append(this.labelEl, this.valEl);

        this.inputEl = document.createElement('input');
        this.inputEl.type = 'range';
        this.inputEl.className = 'apolo-slider-input';
        this.inputEl.min = String(options.min);
        this.inputEl.max = String(options.max);
        this.inputEl.step = String(options.step ?? 0.5);
        this.inputEl.value = String(options.value);
        this.inputEl.setAttribute('aria-label', options.label);

        // Update value text immediately on drag without touching DOM structure
        this.inputEl.addEventListener('input', () => {
            const val = parseFloat(this.inputEl.value);
            this.valEl.textContent = this.format(val);
            this.options.onInput?.(val);
        });

        this.inputEl.addEventListener('change', () => {
            const val = parseFloat(this.inputEl.value);
            this.options.onChange?.(val);
        });

        this.element.append(header, this.inputEl);
    }

    private format(val: number): string {
        if (this.options.formatValue) {
            return this.options.formatValue(val);
        }
        const unit = this.options.unit ?? 'px';
        return `${val} ${unit}`;
    }

    setValue(value: number): void {
        this.inputEl.value = String(value);
        this.valEl.textContent = this.format(value);
    }

    getValue(): number {
        return parseFloat(this.inputEl.value);
    }

    setDisabled(disabled: boolean): void {
        this.inputEl.disabled = disabled;
        this.element.classList.toggle('is-disabled', disabled);
    }
}
