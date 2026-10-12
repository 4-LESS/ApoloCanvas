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

    static setHeight(boxId: string, height: number): void {
        this.heights.set(boxId, height);
    }

    static getHeight(boxId: string): number | undefined {
        return this.heights.get(boxId);
    }

    static setGridVisible(boxId: string, visible: boolean): void {
        this.gridVisible.set(boxId, visible);
    }

    static isGridVisible(boxId: string): boolean {
        return this.gridVisible.get(boxId) ?? true;
    }

    static setSnapActive(boxId: string, active: boolean): void {
        this.snapActive.set(boxId, active);
    }

    static isSnapActive(boxId: string): boolean {
        return this.snapActive.get(boxId) ?? false;
    }

    static setGridStyle(boxId: string, style: BoxGridStyle): void {
        this.gridStyles.set(boxId, style);
        if (style === 'none') {
            this.gridVisible.set(boxId, false);
        } else {
            this.gridVisible.set(boxId, true);
        }
    }

    static getGridStyle(boxId: string): BoxGridStyle {
        return this.gridStyles.get(boxId) ?? 'dots';
    }

    static setBgTheme(boxId: string, theme: BoxBgTheme): void {
        this.bgThemes.set(boxId, theme);
    }

    static getBgTheme(boxId: string): BoxBgTheme {
        return this.bgThemes.get(boxId) ?? 'default';
    }

    static setCustomBgColor(boxId: string, color: string): void {
        this.customBgColors.set(boxId, color);
    }

    static getCustomBgColor(boxId: string): string | undefined {
        return this.customBgColors.get(boxId);
    }

    static setAccentColor(boxId: string, accent: BoxAccentColor): void {
        this.accentColors.set(boxId, accent);
    }

    static getAccentColor(boxId: string): BoxAccentColor {
        return this.accentColors.get(boxId) ?? 'purple';
    }

    static setGridDensity(boxId: string, density: number): void {
        this.gridDensities.set(boxId, density);
    }

    static getGridDensity(boxId: string): number {
        return this.gridDensities.get(boxId) ?? 32;
    }

    static setBorderOutline(boxId: string, outline: boolean): void {
        this.borderOutlines.set(boxId, outline);
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
    }
}
