import type { ToolbarSlot } from '../core/types.ts';

export interface MoreMenuOptions {
    slot: ToolbarSlot;
    onlyPen: boolean;
    snapGrid: boolean;
    onExportSvg: () => void;
    onOpenGraph: () => void;
    onTestAnchor: () => void;
    onToggleOnlyPen: (enabled: boolean) => void;
    onToggleSnapGrid: (enabled: boolean) => void;
    onClose: () => void;
}

export class MoreMenu {
    readonly container: HTMLElement;
    private options: MoreMenuOptions;
    private isVisible = false;

    constructor(options: MoreMenuOptions, parent: HTMLElement = document.body) {
        this.options = { ...options };

        this.container = document.createElement('div');
        this.container.className = 'apolo-popover-panel apolo-more-menu-popover';
        this.container.setAttribute('role', 'dialog');
        this.container.setAttribute('aria-label', 'Más opciones y ajustes');
        this.container.hidden = true;
        this.container.style.display = 'none';

        this.container.addEventListener('pointerdown', e => e.stopPropagation());
        this.container.addEventListener('touchstart', e => e.stopPropagation());

        parent.appendChild(this.container);
        this.render();

        window.addEventListener('pointerdown', this.onOutsidePointerDown, { capture: true });
        window.addEventListener('touchstart', this.onOutsideTouchStart, { capture: true });
        window.addEventListener('keydown', this.onKeyDown);
    }

    private readonly onOutsidePointerDown = (e: PointerEvent): void => {
        if (this.isOpen() && !this.container.contains(e.target as Node)) {
            const targetEl = (e.target && typeof (e.target as any).closest === 'function') ? (e.target as any) : null;
            if (targetEl?.closest?.('.apolo-more-btn')) {
                return;
            }
            this.close();
        }
    };

    private readonly onOutsideTouchStart = (e: TouchEvent): void => {
        if (this.isOpen() && e.target && !this.container.contains(e.target as Node)) {
            const targetEl = (e.target && typeof (e.target as any).closest === 'function') ? (e.target as any) : null;
            if (targetEl?.closest?.('.apolo-more-btn')) {
                return;
            }
            this.close();
        }
    };

    private readonly onKeyDown = (e: KeyboardEvent): void => {
        if (this.isOpen() && e.key === 'Escape') {
            this.close();
        }
    };

    open(options?: Partial<MoreMenuOptions>): void {
        if (options) {
            this.options = { ...this.options, ...options };
        }
        this.isVisible = true;
        this.container.hidden = false;
        this.container.style.display = 'block';
        this.render();
        this.position();
    }

    close(): void {
        this.isVisible = false;
        this.container.hidden = true;
        this.container.style.display = 'none';
        this.options.onClose();
    }

    toggle(options?: Partial<MoreMenuOptions>): void {
        if (this.isOpen()) {
            this.close();
        } else {
            this.open(options);
        }
    }

    isOpen(): boolean {
        return this.isVisible && !this.container.hidden && this.container.style.display !== 'none';
    }

    updateState(options: Partial<MoreMenuOptions>): void {
        this.options = { ...this.options, ...options };
        if (this.isOpen()) {
            this.render();
            this.position();
        }
    }

    position(): void {
        const slot = this.options.slot;
        const col = slot === 'tl' || slot === 'ml' || slot === 'bl' ? 0 : (slot === 'tc' || slot === 'bc' ? 1 : 2);
        const row = slot === 'tl' || slot === 'tc' || slot === 'tr' ? 0 : (slot === 'ml' || slot === 'mr' ? 1 : 2);

        const menuWidth = 360;
        const marginX = 16;
        const panelTop = row === 0 ? 122 : 56;

        let left = 0;
        if (col === 2) {
            left = marginX + 44;
        } else {
            left = Math.max(16, window.innerWidth - menuWidth - marginX);
        }

        const maxH = Math.max(260, window.innerHeight - panelTop - 28);
        this.container.style.position = 'fixed';
        this.container.style.left = `${left}px`;
        this.container.style.top = `${panelTop}px`;
        this.container.style.width = `${menuWidth}px`;
        this.container.style.maxHeight = `${maxH}px`;
    }

    private render(): void {
        this.container.replaceChildren();

        const header = document.createElement('div');
        header.className = 'apolo-popover-header';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.marginBottom = '8px';

        const title = document.createElement('div');
        title.className = 'apolo-popover-title';
        title.textContent = 'Opciones de Apolo Canvas';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'apolo-box-menu-close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Cerrar');
        closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        const handleClose = (e: Event): void => {
            e.stopPropagation();
            e.preventDefault();
            this.close();
        };
        closeBtn.addEventListener('pointerdown', handleClose);
        closeBtn.addEventListener('click', handleClose);
        closeBtn.addEventListener('touchend', handleClose);
        header.appendChild(closeBtn);

        this.container.appendChild(header);

        const actionsList = document.createElement('div');
        actionsList.className = 'apolo-more-actions-list';

        const actionItems = [
            {
                title: 'Exportar SVG companion',
                desc: 'Genera el archivo .ink.svg en assets/ink para visualización nativa',
                action: () => {
                    this.close();
                    this.options.onExportSvg();
                },
            },
            {
                title: 'Grafo local',
                desc: 'Abre la vista de grafo nativa de Obsidian para esta nota',
                action: () => {
                    this.close();
                    this.options.onOpenGraph();
                },
            },
            {
                title: 'Probar anclaje de texto',
                desc: 'Inserta un bloque de prueba para verificar desplazamiento tinta-texto',
                action: () => {
                    this.close();
                    this.options.onTestAnchor();
                },
            },
        ];

        for (const item of actionItems) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'apolo-more-item-btn';

            const titleEl = document.createElement('div');
            titleEl.className = 'apolo-more-item-title';
            titleEl.textContent = item.title;

            const descEl = document.createElement('div');
            descEl.className = 'apolo-more-item-desc';
            descEl.textContent = item.desc;

            btn.append(titleEl, descEl);
            btn.addEventListener('click', item.action);
            actionsList.appendChild(btn);
        }
        this.container.appendChild(actionsList);

        // Settings Section
        const settingsDivider = document.createElement('div');
        settingsDivider.className = 'apolo-section-label';
        settingsDivider.style.marginTop = '14px';
        settingsDivider.textContent = 'Ajustes rápidos';
        this.container.appendChild(settingsDivider);

        const settingsList = document.createElement('div');
        settingsList.className = 'apolo-more-settings-list';

        // 1. Only Pen toggle
        settingsList.appendChild(this.createToggleRow(
            'Solo lápiz (rechazo de palma)',
            'Los dedos hacen scroll y solo el S-Pen dibuja',
            this.options.onlyPen,
            enabled => {
                this.options.onlyPen = enabled;
                this.options.onToggleOnlyPen(enabled);
            },
        ));

        // 2. Snap Grid toggle
        settingsList.appendChild(this.createToggleRow(
            'Cuadrícula magnética',
            'Las formas y trazos encajan en una cuadrícula de 12 px',
            this.options.snapGrid,
            enabled => {
                this.options.snapGrid = enabled;
                this.options.onToggleSnapGrid(enabled);
            },
        ));

        this.container.appendChild(settingsList);
    }

    private createToggleRow(
        title: string,
        desc: string,
        active: boolean,
        onChange: (enabled: boolean) => void,
    ): HTMLElement {
        const row = document.createElement('div');
        row.className = 'apolo-toggle-row';

        const textWrap = document.createElement('div');
        textWrap.className = 'apolo-toggle-row-text';

        const titleEl = document.createElement('div');
        titleEl.className = 'apolo-toggle-title';
        titleEl.textContent = title;

        const descEl = document.createElement('div');
        descEl.className = 'apolo-toggle-desc';
        descEl.textContent = desc;

        textWrap.append(titleEl, descEl);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `apolo-switch-btn ${active ? '' : 'is-off'}`;
        btn.setAttribute('aria-pressed', String(active));
        btn.innerHTML = '<span class="apolo-switch-track"><span class="apolo-switch-thumb"></span></span>';

        btn.addEventListener('click', () => {
            const next = !active;
            btn.classList.toggle('is-off', !next);
            btn.setAttribute('aria-pressed', String(next));
            onChange(next);
        });

        row.append(textWrap, btn);
        return row;
    }

    destroy(): void {
        window.removeEventListener('pointerdown', this.onOutsidePointerDown, { capture: true });
        window.removeEventListener('touchstart', this.onOutsideTouchStart, { capture: true });
        window.removeEventListener('keydown', this.onKeyDown);
        this.container.remove();
    }
}
