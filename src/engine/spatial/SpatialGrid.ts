import type { BoundingBox, CanvasElement } from '../../core/types.ts';

/** A compact spatial hash that avoids scanning every stroke on each viewport paint. */
export class SpatialGrid {
    private readonly cellSize: number;
    private readonly cells = new Map<string, Set<string>>();
    private readonly elements = new Map<string, CanvasElement>();
    private readonly elementCells = new Map<string, string[]>();
    private readonly elementBounds = new Map<string, BoundingBox>();

    constructor(cellSize = 512) { this.cellSize = Math.max(64, cellSize); }

    clear(): void {
        this.cells.clear();
        this.elements.clear();
        this.elementCells.clear();
        this.elementBounds.clear();
    }

    add(element: CanvasElement, customBounds?: BoundingBox): void {
        this.remove(element.id);
        const bounds = customBounds ?? element.bounds;
        this.elements.set(element.id, element);
        this.elementBounds.set(element.id, bounds);
        const keys = this.keysFor(bounds);
        this.elementCells.set(element.id, keys);
        for (const key of keys) {
            let cell = this.cells.get(key);
            if (!cell) { cell = new Set<string>(); this.cells.set(key, cell); }
            cell.add(element.id);
        }
    }

    remove(id: string): void {
        const keys = this.elementCells.get(id);
        if (keys) for (const key of keys) {
            const cell = this.cells.get(key);
            cell?.delete(id);
            if (cell?.size === 0) this.cells.delete(key);
        }
        this.elementCells.delete(id);
        this.elementBounds.delete(id);
        this.elements.delete(id);
    }

    query(bounds: BoundingBox, output: CanvasElement[]): CanvasElement[] {
        output.length = 0;
        const seen = new Set<string>();
        const keys = this.keysFor(bounds);
        keys.push('*');
        for (const key of keys) {
            const cell = this.cells.get(key);
            if (!cell) continue;
            for (const id of cell) {
                if (seen.has(id)) continue;
                seen.add(id);
                const element = this.elements.get(id);
                const elBounds = this.elementBounds.get(id) ?? element?.bounds;
                if (element && elBounds && intersects(elBounds, bounds)) output.push(element);
            }
        }
        return output;
    }

    private keysFor(bounds: BoundingBox): string[] {
        const minX = Math.floor(bounds.minX / this.cellSize);
        const maxX = Math.floor(bounds.maxX / this.cellSize);
        const minY = Math.floor(bounds.minY / this.cellSize);
        const maxY = Math.floor(bounds.maxY / this.cellSize);
        const keys: string[] = [];
        const maxCells = 4096;
        if ((maxX - minX + 1) * (maxY - minY + 1) > maxCells) return ['*'];
        for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) keys.push(`${x}:${y}`);
        return keys;
    }
}

function intersects(a: BoundingBox, b: BoundingBox): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
