import { createSvgIcon, type IconName } from './Icon.ts';

export interface IconButtonOptions {
    icon: IconName | SVGSVGElement;
    label: string;
    tooltip?: string;
    size?: 44 | 36 | 32;
    active?: boolean;
    variant?: 'default' | 'subtle' | 'ghost' | 'danger';
    triggerForPopover?: boolean;
    onClick?: (event: MouseEvent | PointerEvent) => void;
}

/**
 * Standard 44px (or compact 36px/32px) touch-accessible icon button.
 */
export class IconButton {
    readonly element: HTMLButtonElement;
    private iconContainer: HTMLElement;
    private options: IconButtonOptions;

    constructor(options: IconButtonOptions) {
        this.options = options;
        this.element = document.createElement('button');
        this.element.type = 'button';
        this.element.className = this.computeClassName();
        this.element.setAttribute('aria-label', options.label);
        this.element.title = options.tooltip ?? options.label;

        if (options.triggerForPopover) {
            this.element.setAttribute('data-apolo-popover-trigger', 'true');
        }

        if (options.active !== undefined) {
            this.element.setAttribute('aria-pressed', String(options.active));
        }

        this.iconContainer = document.createElement('span');
        this.iconContainer.className = 'apolo-icon-wrap';
        this.renderIcon(options.icon);
        this.element.appendChild(this.iconContainer);

        this.element.addEventListener('click', (e) => {
            if (this.element.disabled) return;
            this.options.onClick?.(e);
        });

        this.element.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault?.();
                if (!this.element.disabled) {
                    this.options.onClick?.(e as unknown as MouseEvent);
                }
            }
        });
    }

    private computeClassName(): string {
        const classes = ['apolo-icon-btn'];
        if (this.options.size === 36) classes.push('is-compact');
        else if (this.options.size === 32) classes.push('is-sm');
        if (this.options.variant === 'danger') classes.push('is-danger');
        else if (this.options.variant === 'ghost') classes.push('is-ghost');
        else if (this.options.variant === 'subtle') classes.push('is-subtle');
        if (this.options.active) classes.push('is-active');
        return classes.join(' ');
    }

    private renderIcon(icon: IconName | SVGSVGElement): void {
        this.iconContainer.replaceChildren();
        if (typeof icon === 'string') {
            const iconSize = this.options.size === 32 ? 18 : this.options.size === 36 ? 20 : 22;
            this.iconContainer.appendChild(createSvgIcon(icon, { size: iconSize }));
        } else {
            this.iconContainer.appendChild(icon);
        }
    }

    setIcon(icon: IconName | SVGSVGElement): void {
        this.options.icon = icon;
        this.renderIcon(icon);
    }

    setActive(active: boolean): void {
        this.options.active = active;
        this.element.classList.toggle('is-active', active);
        this.element.setAttribute('aria-pressed', String(active));
    }

    setLabel(label: string, tooltip?: string): void {
        this.options.label = label;
        this.element.setAttribute('aria-label', label);
        this.element.title = tooltip ?? label;
    }

    setDisabled(disabled: boolean): void {
        this.element.disabled = disabled;
    }
}
