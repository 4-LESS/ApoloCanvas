import { createSvgIcon, type IconName } from './Icon.ts';

export interface ActionItem {
    id: string;
    label: string;
    icon: IconName;
    danger?: boolean;
    onClick: () => void;
}

export class ActionRow {
    readonly element: HTMLElement;
    private buttons: Map<string, HTMLButtonElement> = new Map();

    constructor(items: ActionItem[]) {
        this.element = document.createElement('div');
        this.element.className = 'apolo-action-row';

        for (const item of items) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `apolo-action-btn${item.danger ? ' is-danger' : ''}`;
            btn.setAttribute('aria-label', item.label);

            btn.appendChild(createSvgIcon(item.icon, { size: 18 }));

            const labelSpan = document.createElement('span');
            labelSpan.textContent = item.label;
            btn.appendChild(labelSpan);

            btn.addEventListener('click', () => {
                item.onClick();
            });

            this.buttons.set(item.id, btn);
            this.element.appendChild(btn);
        }
    }

    setDisabled(id: string, disabled: boolean): void {
        const btn = this.buttons.get(id);
        if (btn) btn.disabled = disabled;
    }
}
