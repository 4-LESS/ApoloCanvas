import type { BoxAccentColor, BoxBgTheme, BoxGridStyle } from './types';

export class BoxRegistry {
    private static heights = new Map<string, number>();
    private static gridVisible = new Map<string, boolean>();
    private static snapActive = new Map<string, boolean>();
    private static gridStyles = new Map<string, BoxGridStyle>();
    private static bgThemes = new Map<string, BoxBgTheme>();
    private static accentColors = new Map<string, BoxAccentColor>();
    private static gridDensities = new Map<string, number>();
    private static borderOutlines = new Map<string, boolean>();
    private static customBgColors = new Map<string, string>();
    private static listeners = new Set<() => void>();

    static onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private static notifyChange(): void {
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                console.error('[BoxRegistry] Error in change listener:', err);
            }
        }
    }

    static setHeight(boxId: string, height: number): void {
        if (this.heights.get(boxId) === height) return;
        this.heights.set(boxId, height);
        this.notifyChange();
    }

    static getHeight(boxId: string): number | undefined {
        return this.heights.get(boxId);
    }

    static setGridVisible(boxId: string, visible: boolean): void {
        if (this.gridVisible.get(boxId) === visible) return;
        this.gridVisible.set(boxId, visible);
        this.notifyChange();
    }

    static isGridVisible(boxId: string): boolean {
        return this.gridVisible.get(boxId) ?? true;
    }

    static setSnapActive(boxId: string, active: boolean): void {
        if (this.snapActive.get(boxId) === active) return;
        this.snapActive.set(boxId, active);
        this.notifyChange();
    }

    static isSnapActive(boxId: string): boolean {
        return this.snapActive.get(boxId) ?? false;
    }

    static setGridStyle(boxId: string, style: BoxGridStyle): void {
        const prev = this.gridStyles.get(boxId);
        this.gridStyles.set(boxId, style);
        if (style === 'none') {
            this.gridVisible.set(boxId, false);
        } else {
            this.gridVisible.set(boxId, true);
        }
        if (prev !== style) {
            this.notifyChange();
        }
    }

    static getGridStyle(boxId: string): BoxGridStyle {
        return this.gridStyles.get(boxId) ?? 'dots';
    }

    static setBgTheme(boxId: string, theme: BoxBgTheme): void {
        if (this.bgThemes.get(boxId) === theme) return;
        this.bgThemes.set(boxId, theme);
        this.notifyChange();
    }

    static getBgTheme(boxId: string): BoxBgTheme {
        return this.bgThemes.get(boxId) ?? 'default';
    }

    static setCustomBgColor(boxId: string, color: string): void {
        if (this.customBgColors.get(boxId) === color) return;
        this.customBgColors.set(boxId, color);
        this.notifyChange();
    }

    static getCustomBgColor(boxId: string): string | undefined {
        return this.customBgColors.get(boxId);
    }

    static setAccentColor(boxId: string, accent: BoxAccentColor): void {
        if (this.accentColors.get(boxId) === accent) return;
        this.accentColors.set(boxId, accent);
        this.notifyChange();
    }

    static getAccentColor(boxId: string): BoxAccentColor {
        return this.accentColors.get(boxId) ?? 'purple';
    }

    static setGridDensity(boxId: string, density: number): void {
        if (this.gridDensities.get(boxId) === density) return;
        this.gridDensities.set(boxId, density);
        this.notifyChange();
    }

    static getGridDensity(boxId: string): number {
        return this.gridDensities.get(boxId) ?? 32;
    }

    static setBorderOutline(boxId: string, outline: boolean): void {
        if (this.borderOutlines.get(boxId) === outline) return;
        this.borderOutlines.set(boxId, outline);
        this.notifyChange();
    }

    static isBorderOutline(boxId: string): boolean {
        return this.borderOutlines.get(boxId) ?? false;
    }

    static clear(): void {
        this.heights.clear();
        this.gridVisible.clear();
        this.snapActive.clear();
        this.gridStyles.clear();
        this.bgThemes.clear();
        this.accentColors.clear();
        this.gridDensities.clear();
        this.borderOutlines.clear();
        this.customBgColors.clear();
        this.notifyChange();
    }
}
