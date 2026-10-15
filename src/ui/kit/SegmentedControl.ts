import { createSvgIcon, type IconName } from './Icon.ts';

export interface SegmentedItem<T = string> {
    id: T;
    label: string;
    icon?: IconName;
    tooltip?: string;
}

export interface SegmentedControlOptions<T = string> {
    label: string;
    items: SegmentedItem<T>[];
    value: T;
    onChange: (value: T) => void;
}

export class SegmentedControl<T = string> {
    readonly element: HTMLElement;
    private options: SegmentedControlOptions<T>;
    private buttons: Map<T, HTMLButtonElement> = new Map();
    private currentValue: T;

    constructor(options: SegmentedControlOptions<T>) {
        this.options = options;
        this.currentValue = options.value;

        this.element = document.createElement('div');
        this.element.className = 'apolo-segmented';
        this.element.setAttribute('role', 'radiogroup');
        this.element.setAttribute('aria-label', options.label);

        this.renderItems();
    }

    private renderItems(): void {
        this.element.replaceChildren();
        this.buttons.clear();

        for (const item of this.options.items) {
            const btn = document.createElement('button');
            btn.type = 'button';
            const isActive = this.currentValue === item.id;
            btn.className = `apolo-segmented-btn${isActive ? ' is-active' : ''}`;
            btn.setAttribute('role', 'radio');
            btn.setAttribute('aria-checked', String(isActive));
            btn.setAttribute('aria-label', item.label);
            if (item.tooltip) btn.title = item.tooltip;

            if (item.icon) {
                btn.appendChild(createSvgIcon(item.icon, { size: 16 }));
            }
            if (item.label) {
                const textSpan = document.createElement('span');
                textSpan.textContent = item.label;
                btn.appendChild(textSpan);
            }

            btn.addEventListener('click', () => {
                this.setValue(item.id);
                this.options.onChange(item.id);
            });

            this.buttons.set(item.id, btn);
            this.element.appendChild(btn);
        }
    }

    setValue(value: T): void {
        this.currentValue = value;
        for (const [id, btn] of this.buttons) {
            const isActive = id === value;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-checked', String(isActive));
        }
    }

    getValue(): T {
        return this.currentValue;
    }
}
