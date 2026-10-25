import { Notice } from 'obsidian';
import type ApoloCanvasPlugin from '../../main.ts';
import type {
    WorkspaceColorCarousels,
    ColorProfileSlot,
    ColorCarouselProfile,
    ToolbarSlot,
} from '../../core/types.ts';
import { cloneColorCarousels } from '../../core/types.ts';
import { ColorPickerPopover } from '../popover/ColorPickerPopover.ts';
import { ICONS, createSvg } from '../theme.ts';

export type ToolScopeKey = 'pen' | 'highlighter' | 'shapeStroke' | 'shapeFill';
export type PaletteScopeKey = 'global' | ToolScopeKey;

interface ToolHistoryItem {
    key: 'pen' | 'highlighter' | 'shapeStroke' | 'shapeFill';
    label: string;
    icon: string;
}

const TOOL_HISTORY_ITEMS: ToolHistoryItem[] = [
    { key: 'pen', label: 'Pluma', icon: '✏️' },
    { key: 'highlighter', label: 'Resaltador', icon: '🖍️' },
    { key: 'shapeStroke', label: 'Formas (Trazo)', icon: '🔷' },
    { key: 'shapeFill', label: 'Formas (Relleno)', icon: '🎨' },
];

const SCOPE_OPTIONS: Record<PaletteScopeKey, string> = {
    global: '🌐 Global (Todas las herramientas)',
    pen: '✏️ Pluma',
    highlighter: '🖍️ Resaltador',
    shapeStroke: '🔷 Formas (Trazo)',
    shapeFill: '🎨 Formas (Relleno)',
};

function hexToRgba(hex: string, opacityPercent: number): string {
    const clean = hex.replace('#', '');
    const num = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16);
    if (isNaN(num)) return hex;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    const a = Math.max(0, Math.min(1, opacityPercent / 100));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export class ColorPaletteManager {
    private readonly plugin: ApoloCanvasPlugin;
    private colorPicker: ColorPickerPopover | null = null;
    private openSections = new Set<string>(['global']);
    private outsidePointerListener: ((e: PointerEvent | MouseEvent) => void) | null = null;

    constructor(plugin: ApoloCanvasPlugin) {
        this.plugin = plugin;
    }

    destroy(): void {
        if (this.outsidePointerListener) {
            document.removeEventListener('pointerdown', this.outsidePointerListener, true);
            this.outsidePointerListener = null;
        }
        if (this.colorPicker) {
            this.colorPicker.destroy();
            this.colorPicker = null;
        }
    }

    private getColorPicker(): ColorPickerPopover {
        if (!this.colorPicker) {
            this.colorPicker = new ColorPickerPopover(document.body);
            this.colorPicker.el.style.zIndex = '9999';
        }
        return this.colorPicker;
    }

    private openColorPickerForAnchor(
        anchorEl: HTMLElement,
        initialColor: string,
        initialOpacity: number,
        onConfirm: (color: string, opacity: number) => void
    ): void {
        const picker = this.getColorPicker();
        picker.close();

        if (this.outsidePointerListener) {
            document.removeEventListener('pointerdown', this.outsidePointerListener, true);
            this.outsidePointerListener = null;
        }

        const rect = anchorEl.getBoundingClientRect();
        const slot: ToolbarSlot = rect.top > (window.innerHeight / 2) ? 'bc' : 'tc';

        picker.el.style.zIndex = '9999';
        picker.open(
            anchorEl,
            slot,
            anchorEl,
            initialColor,
            (newColor, opacity) => {
                const normOpacity = typeof opacity === 'number'
                    ? (opacity > 1 ? opacity : Math.round(opacity * 100))
                    : 100;
                onConfirm(newColor, normOpacity);
            },
            null,
            initialOpacity
        );

        this.outsidePointerListener = (ev: PointerEvent | MouseEvent) => {
            if (!picker.isOpen()) {
                if (this.outsidePointerListener) {
                    document.removeEventListener('pointerdown', this.outsidePointerListener, true);
                    this.outsidePointerListener = null;
                }
                return;
            }
            const target = ev.target as Node;
            if (picker.el.contains(target) || anchorEl.contains(target)) {
                return;
            }
            picker.close();
            if (this.outsidePointerListener) {
                document.removeEventListener('pointerdown', this.outsidePointerListener, true);
                this.outsidePointerListener = null;
            }
        };

        setTimeout(() => {
            if (this.outsidePointerListener) {
                document.addEventListener('pointerdown', this.outsidePointerListener, true);
            }
        }, 30);
    }

    private getCarousels(): WorkspaceColorCarousels {
        if (!this.plugin.settings.toolState.colorCarousels) {
            this.plugin.settings.toolState.colorCarousels = cloneColorCarousels();
        }
        if (!this.plugin.settings.toolState.colorCarousels.globalProfiles) {
            this.plugin.settings.toolState.colorCarousels.globalProfiles = [];
        }
        const prune = (profiles: ColorCarouselProfile[]) => profiles.filter(p => p.slots && p.slots.length > 0);
        this.plugin.settings.toolState.colorCarousels.globalProfiles = prune(this.plugin.settings.toolState.colorCarousels.globalProfiles);
        const scopes: Array<'pen' | 'highlighter' | 'shapeStroke' | 'shapeFill'> = ['pen', 'highlighter', 'shapeStroke', 'shapeFill'];
        for (const s of scopes) {
            if (this.plugin.settings.toolState.colorCarousels[s]?.profiles) {
                this.plugin.settings.toolState.colorCarousels[s].profiles = prune(this.plugin.settings.toolState.colorCarousels[s].profiles);
            }
        }
        return this.plugin.settings.toolState.colorCarousels;
    }

    private async saveAndNotify(): Promise<void> {
        await this.plugin.saveSettings();
        if ((this.plugin as any).controller) {
            (this.plugin as any).controller.applyWorkspaceToolState(this.plugin.settings.toolState, true);
        }
    }

    private findProfileLocation(profileId: string): { scope: PaletteScopeKey; list: ColorCarouselProfile[]; index: number } | null {
        const carousels = this.getCarousels();

        const globalIdx = (carousels.globalProfiles ?? []).findIndex(p => p.id === profileId);
        if (globalIdx !== -1) {
            return { scope: 'global', list: carousels.globalProfiles!, index: globalIdx };
        }

        const contexts: Array<{ scope: PaletteScopeKey; list: ColorCarouselProfile[] }> = [
            { scope: 'pen', list: carousels.pen.profiles },
            { scope: 'highlighter', list: carousels.highlighter.profiles },
            { scope: 'shapeStroke', list: carousels.shapeStroke.profiles },
            { scope: 'shapeFill', list: carousels.shapeFill.profiles },
        ];

        for (const ctx of contexts) {
            const idx = ctx.list.findIndex(p => p.id === profileId);
            if (idx !== -1) {
                return { scope: ctx.scope, list: ctx.list, index: idx };
            }
        }

        return null;
    }

    private moveProfile(profileId: string, targetScope: PaletteScopeKey): void {
        const loc = this.findProfileLocation(profileId);
        if (!loc || loc.scope === targetScope) return;

        const [profile] = loc.list.splice(loc.index, 1);
        const carousels = this.getCarousels();

        if (targetScope === 'global') {
            carousels.globalProfiles = carousels.globalProfiles ?? [];
            carousels.globalProfiles.push(profile);
        } else {
            carousels[targetScope].profiles = carousels[targetScope].profiles ?? [];
            carousels[targetScope].profiles.push(profile);
        }

        new Notice(`Paleta "${profile.name || 'Sin nombre'}" movida a ${SCOPE_OPTIONS[targetScope]}`);
    }

    private deleteProfile(profileId: string): void {
        const loc = this.findProfileLocation(profileId);
        if (!loc) return;
        const [removed] = loc.list.splice(loc.index, 1);
        new Notice(`Paleta "${removed.name || 'Sin nombre'}" eliminada`);
    }

    private createProfile(scope: PaletteScopeKey, name?: string): ColorCarouselProfile {
        const carousels = this.getCarousels();
        const profile: ColorCarouselProfile = {
            id: `palette-${scope}-${Date.now()}`,
            name: name || 'Nueva Paleta',
            slots: [{ color: '#2F6BFF', opacity: 100 }],
        };

        if (scope === 'global') {
            carousels.globalProfiles = carousels.globalProfiles ?? [];
            carousels.globalProfiles.push(profile);
        } else {
            carousels[scope].profiles = carousels[scope].profiles ?? [];
            carousels[scope].profiles.push(profile);
        }

        new Notice(`Paleta "${profile.name}" creada en ${SCOPE_OPTIONS[scope]}`);
        return profile;
    }

    render(containerEl: HTMLElement): void {
        containerEl.empty();
        const carousels = this.getCarousels();

        const rootEl = document.createElement('div');
        rootEl.className = 'apolo-color-palette-manager';

        // Clean Section Header
        const header = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = 'Paletas de Colores y Perfiles';
        title.style.margin = '0 0 6px 0';

        const desc = document.createElement('p');
        desc.className = 'apolo-manager-section-desc';
        desc.textContent = 'Administra el historial de colores recientes por herramienta, paletas globales (compartidas) y paletas personalizadas.';
        header.append(title, desc);
        rootEl.appendChild(header);

        // --- 1. Historial de Colores Recientes (Collapsible) ---
        const historyDetails = this.createCollapsible(
            'history',
            '🕒 Historial de Colores Recientes',
            '4 herramientas',
            () => {
                const body = document.createElement('div');
                body.className = 'apolo-history-list';

                for (const item of TOOL_HISTORY_ITEMS) {
                    const ctxState = carousels[item.key];
                    const rowItem = document.createElement('div');
                    rowItem.className = 'apolo-history-row-item';

                    const leftInfo = document.createElement('div');
                    leftInfo.className = 'apolo-history-tool-info';
                    leftInfo.textContent = `${item.icon} ${item.label}`;

                    const swatchesWrapper = this.renderRecentRow(item.key, async () => {
                        await this.saveAndNotify();
                        this.render(containerEl);
                    });

                    const clearBtn = document.createElement('button');
                    clearBtn.type = 'button';
                    clearBtn.className = 'mod-warning';
                    clearBtn.textContent = 'Limpiar';
                    clearBtn.style.fontSize = '12px';
                    clearBtn.style.padding = '2px 8px';
                    clearBtn.onclick = async () => {
                        ctxState.recentColors = [];
                        await this.saveAndNotify();
                        this.render(containerEl);
                        new Notice(`Historial de ${item.label} limpiado`);
                    };

                    rowItem.append(leftInfo, swatchesWrapper, clearBtn);
                    body.appendChild(rowItem);
                }

                return body;
            }
        );
        rootEl.appendChild(historyDetails);

        // --- 2. Paletas Globales (Collapsible, open by default) ---
        const globalProfiles = carousels.globalProfiles ?? [];
        const globalDetails = this.createPaletteScopeSection(
            'global',
            '🌐 Paletas Globales (Compartidas)',
            globalProfiles,
            containerEl
        );
        rootEl.appendChild(globalDetails);

        // --- 3. Paletas por Herramienta (Collapsibles) ---
        const toolSections: Array<{ scope: ToolScopeKey; label: string }> = [
            { scope: 'pen', label: '✏️ Paletas: Pluma' },
            { scope: 'highlighter', label: '🖍️ Paletas: Resaltador' },
            { scope: 'shapeStroke', label: '🔷 Paletas: Formas (Trazo)' },
            { scope: 'shapeFill', label: '🎨 Paletas: Formas (Relleno)' },
        ];

        for (const ts of toolSections) {
            const list = carousels[ts.scope]?.profiles ?? [];
            const details = this.createPaletteScopeSection(ts.scope, ts.label, list, containerEl);
            rootEl.appendChild(details);
        }

        containerEl.appendChild(rootEl);
    }

    private createCollapsible(
        key: string,
        titleText: string,
        badgeText: string,
        contentBuilder: () => HTMLElement
    ): HTMLDetailsElement {
        const details = document.createElement('details');
        details.className = 'apolo-settings-collapse';
        if (this.openSections.has(key)) {
            details.open = true;
        }

        details.ontoggle = () => {
            if (details.open) {
                this.openSections.add(key);
            } else {
                this.openSections.delete(key);
            }
        };

        const summary = document.createElement('summary');
        summary.className = 'apolo-settings-summary';

        const left = document.createElement('div');
        left.className = 'apolo-collapse-header-left';

        const arrow = document.createElement('span');
        arrow.className = 'apolo-collapse-arrow';
        arrow.textContent = '▶';

        const title = document.createElement('span');
        title.textContent = titleText;

        left.append(arrow, title);

        const badge = document.createElement('span');
        badge.className = 'apolo-collapse-badge';
        badge.textContent = badgeText;

        summary.append(left, badge);
        details.appendChild(summary);

        const bodyContainer = document.createElement('div');
        bodyContainer.className = 'apolo-settings-collapse-body';
        bodyContainer.appendChild(contentBuilder());
        details.appendChild(bodyContainer);

        return details;
    }

    private createPaletteScopeSection(
        scope: PaletteScopeKey,
        titleLabel: string,
        profiles: ColorCarouselProfile[],
        containerEl: HTMLElement
    ): HTMLDetailsElement {
        const badgeLabel = `${profiles.length} ${profiles.length === 1 ? 'paleta' : 'paletas'}`;

        return this.createCollapsible(scope, titleLabel, badgeLabel, () => {
            const wrapper = document.createElement('div');
            wrapper.style.display = 'flex';
            wrapper.style.flexDirection = 'column';
            wrapper.style.gap = '12px';

            // Top action bar
            const topBar = document.createElement('div');
            topBar.style.display = 'flex';
            topBar.style.justifyContent = 'flex-end';

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'mod-cta';
            addBtn.textContent = '+ Nueva Paleta';
            addBtn.onclick = async () => {
                this.createProfile(scope);
                this.openSections.add(scope);
                await this.saveAndNotify();
                this.render(containerEl);
            };
            topBar.appendChild(addBtn);
            wrapper.appendChild(topBar);

            if (profiles.length === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.style.padding = '12px';
                emptyMsg.style.textAlign = 'center';
                emptyMsg.style.color = 'var(--text-muted)';
                emptyMsg.style.fontSize = '0.9em';
                emptyMsg.textContent = 'No hay paletas configuradas. Pulsa "+ Nueva Paleta" para crear una.';
                wrapper.appendChild(emptyMsg);
            } else {
                for (const profile of profiles) {
                    const card = this.createPaletteCard(profile, scope, async () => {
                        await this.saveAndNotify();
                        this.render(containerEl);
                    });
                    wrapper.appendChild(card);
                }
            }

            return wrapper;
        });
    }

    private createPaletteCard(
        profile: ColorCarouselProfile,
        currentScope: PaletteScopeKey,
        onChange: () => Promise<void>
    ): HTMLElement {
        const card = document.createElement('div');
        card.className = 'apolo-settings-palette-card';

        // Header: Name + Scope Selector + Delete Button
        const header = document.createElement('div');
        header.className = 'apolo-settings-palette-card-header';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'apolo-palette-name-input';
        nameInput.placeholder = 'Nombre de la paleta';
        nameInput.value = profile.name || '';
        nameInput.onchange = async () => {
            profile.name = nameInput.value.trim() || 'Paleta';
            await onChange();
        };

        const scopeSelect = document.createElement('select');
        scopeSelect.className = 'dropdown';
        for (const [key, label] of Object.entries(SCOPE_OPTIONS)) {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = label;
            if (key === currentScope) opt.selected = true;
            scopeSelect.appendChild(opt);
        }

        scopeSelect.onchange = async () => {
            const newScope = scopeSelect.value as PaletteScopeKey;
            this.moveProfile(profile.id, newScope);
            this.openSections.add(newScope);
            await onChange();
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'mod-warning';
        deleteBtn.textContent = 'Eliminar';
        deleteBtn.style.fontSize = '12px';
        deleteBtn.onclick = async () => {
            this.deleteProfile(profile.id);
            await onChange();
        };

        header.append(nameInput, scopeSelect, deleteBtn);
        card.appendChild(header);

        // Swatch row: The exact same component
        const swatchesRow = this.renderPaletteRow(profile, onChange);
        card.appendChild(swatchesRow);

        return card;
    }

    private renderPaletteRow(
        profile: ColorCarouselProfile,
        onChange: () => Promise<void>
    ): HTMLElement {
        const rowEl = document.createElement('div');
        rowEl.className = 'swatch-row popover-swatches-row apolo-settings-palette-row';
        if (profile.slots.length < 6) {
            rowEl.classList.add('is-centered');
        }

        for (let i = 0; i < profile.slots.length; i++) {
            const slot = profile.slots[i];
            const slotWrapper = document.createElement('div');
            slotWrapper.className = 'apolo-slot-circle-wrapper';

            const sw = document.createElement('button');
            sw.type = 'button';
            const hasTrans = (slot.opacity ?? 100) < 100;
            sw.className = `swatch popover-swatch-circle ${hasTrans ? 'has-transparency' : ''}`;
            sw.title = `Color ${slot.color} (${slot.opacity ?? 100}%) - Clic para cambiar`;
            sw.style.touchAction = 'manipulation';
            sw.style.setProperty('--c', slot.color);
            sw.style.setProperty('--swatch-color', slot.color);

            const inner = document.createElement('span');
            inner.className = 'popover-swatch-inner';
            if (hasTrans) {
                inner.style.backgroundColor = hexToRgba(slot.color, slot.opacity ?? 100);
            } else {
                sw.style.backgroundColor = slot.color;
                inner.style.backgroundColor = slot.color;
            }
            sw.appendChild(inner);

            // Clicking swatch opens real ColorPickerPopover
            sw.onclick = (e) => {
                e.stopPropagation();
                this.openColorPickerForAnchor(
                    sw,
                    slot.color,
                    slot.opacity ?? 100,
                    async (newColor, newOpacity) => {
                        slot.color = newColor;
                        slot.opacity = newOpacity;
                        await onChange();
                    }
                );
            };

            // Small subtle delete badge on hover/touch
            const delBadge = document.createElement('button');
            delBadge.type = 'button';
            delBadge.className = 'apolo-slot-del-badge';
            delBadge.title = 'Eliminar color';
            delBadge.textContent = '×';
            delBadge.onclick = async (e) => {
                e.stopPropagation();
                profile.slots.splice(i, 1);
                if (profile.slots.length === 0) {
                    this.deleteProfile(profile.id);
                    new Notice(`Paleta "${profile.name}" eliminada al quedarse sin colores`);
                }
                await onChange();
            };

            slotWrapper.append(sw, delBadge);
            rowEl.appendChild(slotWrapper);
        }

        // If slots < 6: show single dashed circle centered to add next color
        if (profile.slots.length < 6) {
            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'swatch popover-swatch-circle is-dashed-empty';
            addBtn.title = 'Añadir nuevo color a la paleta';
            addBtn.onclick = (e) => {
                e.stopPropagation();
                this.openColorPickerForAnchor(
                    addBtn,
                    '#2F6BFF',
                    100,
                    async (newColor, newOpacity) => {
                        profile.slots.push({ color: newColor, opacity: newOpacity });
                        await onChange();
                    }
                );
            };
            rowEl.appendChild(addBtn);
        }

        return rowEl;
    }

    private renderRecentRow(
        contextKey: 'pen' | 'highlighter' | 'shapeStroke' | 'shapeFill',
        onChange: () => Promise<void>
    ): HTMLElement {
        const carousels = this.getCarousels();
        const ctx = carousels[contextKey];
        const rowEl = document.createElement('div');
        rowEl.className = 'swatch-row popover-swatches-row apolo-settings-palette-row';

        const recentSlots = ctx.recentColors.slice(0, 6);
        for (let i = 0; i < recentSlots.length; i++) {
            const slot = recentSlots[i];
            const sw = document.createElement('button');
            sw.type = 'button';
            const hasTrans = (slot.opacity ?? 100) < 100;
            sw.className = `swatch popover-swatch-circle ${hasTrans ? 'has-transparency' : ''}`;
            sw.title = `Color ${slot.color} (${slot.opacity ?? 100}%) - Clic para cambiar`;
            sw.style.touchAction = 'manipulation';
            sw.style.setProperty('--c', slot.color);
            sw.style.setProperty('--swatch-color', slot.color);

            const inner = document.createElement('span');
            inner.className = 'popover-swatch-inner';
            if (hasTrans) {
                inner.style.backgroundColor = hexToRgba(slot.color, slot.opacity ?? 100);
            } else {
                sw.style.backgroundColor = slot.color;
                inner.style.backgroundColor = slot.color;
            }
            sw.appendChild(inner);

            // Clicking swatch opens real ColorPickerPopover
            sw.onclick = (e) => {
                e.stopPropagation();
                this.openColorPickerForAnchor(
                    sw,
                    slot.color,
                    slot.opacity ?? 100,
                    async (newColor, newOpacity) => {
                        slot.color = newColor;
                        slot.opacity = newOpacity;
                        await onChange();
                    }
                );
            };

            rowEl.appendChild(sw);
        }

        // Circular "+" button (exclusivo del historial de recientes)
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'swatch-add popover-color-add';
        addBtn.title = 'Añadir color al historial';
        addBtn.appendChild(createSvg(ICONS.plus, { size: 14, strokeWidth: 2 }));
        addBtn.onclick = (e) => {
            e.stopPropagation();
            this.openColorPickerForAnchor(
                addBtn,
                '#2F6BFF',
                100,
                async (newColor, newOpacity) => {
                    ctx.recentColors = [
                        { color: newColor, opacity: newOpacity },
                        ...ctx.recentColors.filter(s => s.color.toUpperCase() !== newColor.toUpperCase() || s.opacity !== newOpacity),
                    ].slice(0, 6);
                    await onChange();
                }
            );
        };
        rowEl.appendChild(addBtn);

        return rowEl;
    }
}
