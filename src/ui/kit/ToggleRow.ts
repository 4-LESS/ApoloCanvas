export interface ToggleRowOptions {
    label: string;
    description?: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
}

/**
 * Accessible switch row with title, optional subtitle and toggle button.
 */
export class ToggleRow {
    readonly element: HTMLElement;
    private switchBtn: HTMLButtonElement;
    private thumbEl: HTMLElement;
    private isChecked: boolean;
    private options: ToggleRowOptions;

    constructor(options: ToggleRowOptions) {
        this.options = options;
        this.isChecked = options.checked;

        this.element = document.createElement('div');
        this.element.className = 'apolo-toggle-row';

        const textGroup = document.createElement('div');
        textGroup.className = 'apolo-toggle-text-group';

        const labelEl = document.createElement('span');
        labelEl.className = 'apolo-toggle-label';
        labelEl.textContent = options.label;
        textGroup.appendChild(labelEl);

        if (options.description) {
            const descEl = document.createElement('span');
            descEl.className = 'apolo-toggle-desc';
            descEl.textContent = options.description;
            textGroup.appendChild(descEl);
        }

        this.switchBtn = document.createElement('button');
        this.switchBtn.type = 'button';
        this.switchBtn.className = `apolo-toggle-switch${this.isChecked ? ' is-checked' : ''}`;
        this.switchBtn.setAttribute('role', 'switch');
        this.switchBtn.setAttribute('aria-checked', String(this.isChecked));
        this.switchBtn.setAttribute('aria-label', options.label);

        this.thumbEl = document.createElement('span');
        this.thumbEl.className = 'apolo-toggle-thumb';
        this.switchBtn.appendChild(this.thumbEl);

        this.switchBtn.addEventListener('click', () => {
            if (this.switchBtn.disabled) return;
            this.setChecked(!this.isChecked);
            this.options.onChange(this.isChecked);
        });

        this.element.append(textGroup, this.switchBtn);
    }

    setChecked(checked: boolean): void {
        this.isChecked = checked;
        this.switchBtn.classList.toggle('is-checked', checked);
        this.switchBtn.setAttribute('aria-checked', String(checked));
    }

    getChecked(): boolean {
        return this.isChecked;
    }

    setDisabled(disabled: boolean): void {
        this.switchBtn.disabled = disabled;
        this.element.classList.toggle('is-disabled', disabled);
    }
}
