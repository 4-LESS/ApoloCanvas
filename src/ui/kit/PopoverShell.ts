import { createSvgIcon, type IconName } from './Icon.ts';

export interface PopoverShellOptions {
    title: string;
    icon?: IconName;
    className?: string;
    parent?: HTMLElement;
    onClose?: () => void;
}

/**
 * Standard Popover Shell: encapsulates the container, header, close button and body.
 * Eliminates timing hacks and triple event binding in favor of pure pointer/keyboard activation.
 */
export class PopoverShell {
    readonly container: HTMLElement;
    readonly headerEl: HTMLElement;
    readonly titleGroupEl: HTMLElement;
    readonly titleEl: HTMLElement;
    readonly iconEl: HTMLElement;
    readonly closeBtn: HTMLButtonElement;
    readonly bodyEl: HTMLElement;
    private options: PopoverShellOptions;

    constructor(options: PopoverShellOptions) {
        this.options = options;

        this.container = document.createElement('div');
        this.container.className = `apolo-popover-panel apolo-popover-shell${options.className ? ' ' + options.className : ''}`;
        this.container.hidden = true;
        this.container.style.display = 'none';
        this.container.setAttribute('role', 'dialog');
        this.container.setAttribute('aria-label', options.title);

        // Header
        this.headerEl = document.createElement('div');
        this.headerEl.className = 'apolo-popover-header';

        this.titleGroupEl = document.createElement('div');
        this.titleGroupEl.className = 'apolo-popover-title-group';

        this.iconEl = document.createElement('span');
        this.iconEl.className = 'apolo-popover-icon';
        if (options.icon) {
            this.iconEl.appendChild(createSvgIcon(options.icon, { size: 20 }));
        }

        this.titleEl = document.createElement('h3');
        this.titleEl.className = 'apolo-popover-title';
        this.titleEl.textContent = options.title;

        this.titleGroupEl.append(this.iconEl, this.titleEl);

        // 40px touch-manipulation close button
        this.closeBtn = document.createElement('button');
        this.closeBtn.type = 'button';
        this.closeBtn.className = 'apolo-popover-close-btn';
        this.closeBtn.setAttribute('aria-label', 'Cerrar');
        this.closeBtn.appendChild(createSvgIcon('close', { size: 18 }));

        this.closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.options.onClose?.();
        });

        this.headerEl.append(this.titleGroupEl, this.closeBtn);

        // Body
        this.bodyEl = document.createElement('div');
        this.bodyEl.className = 'apolo-popover-body';

        this.container.append(this.headerEl, this.bodyEl);

        const mountTarget = options.parent ?? (typeof document !== 'undefined' ? document.body : null);
        if (mountTarget) {
            mountTarget.appendChild(this.container);
        }
    }

    get body(): HTMLElement {
        return this.bodyEl;
    }

    setTitle(title: string): void {
        this.titleEl.textContent = title;
        this.container.setAttribute('aria-label', title);
    }

    setIcon(icon: IconName): void {
        this.iconEl.replaceChildren(createSvgIcon(icon, { size: 20 }));
    }

    show(): void {
        this.container.hidden = false;
        this.container.style.display = 'flex';
    }

    hide(): void {
        this.container.hidden = true;
        this.container.style.display = 'none';
    }

    isOpen(): boolean {
        return !this.container.hidden && this.container.style.display !== 'none';
    }

    destroy(): void {
        this.container.remove();
    }
}
