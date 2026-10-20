import type { BoundingBox, Point } from '../../core/types.ts';

/** Interleaved point storage: x, y, pressure, timestamp (milliseconds). */
export class PointBuffer {
    private data: Float32Array;
    private length = 0;

    constructor(initialCapacity = 2048) {
        const capacity = Number.isFinite(initialCapacity) ? Math.max(1, Math.floor(initialCapacity)) : 2048;
        this.data = new Float32Array(capacity * 4);
    }

    get size(): number {
        return this.length;
    }

    push(x: number, y: number, pressure: number, time: number): void {
        if (this.length === this.data.length / 4) this.grow();
        const offset = this.length * 4;
        this.data[offset] = x;
        this.data[offset + 1] = y;
        this.data[offset + 2] = pressure;
        this.data[offset + 3] = time;
        this.length++;
    }

    get(index: number): Point {
        this.assertIndex(index);
        const offset = index * 4;
        return {
            x: this.data[offset],
            y: this.data[offset + 1],
            pressure: this.data[offset + 2],
            time: this.data[offset + 3],
        };
    }

    getX(index: number): number { this.assertIndex(index); return this.data[index * 4]; }
    getY(index: number): number { this.assertIndex(index); return this.data[index * 4 + 1]; }
    getPressure(index: number): number { this.assertIndex(index); return this.data[index * 4 + 2]; }
    getTime(index: number): number { this.assertIndex(index); return this.data[index * 4 + 3]; }

    getBounds(padding = 0): BoundingBox {
        if (this.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        let minX = this.data[0];
        let maxX = minX;
        let minY = this.data[1];
        let maxY = minY;
        for (let i = 1; i < this.length; i++) {
            const offset = i * 4;
            const x = this.data[offset];
            const y = this.data[offset + 1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
    }

    clear(): void { this.length = 0; }

    toArray(): number[] {
        const result = new Array<number>(this.length * 4);
        for (let i = 0; i < result.length; i++) result[i] = this.data[i];
        return result;
    }

    fromArray(points: number[]): void {
        if (points.length % 4 !== 0) throw new RangeError('Point data length must be a multiple of four.');
        const count = points.length / 4;
        this.ensureCapacity(count);
        this.data.set(points);
        this.length = count;
    }

    private assertIndex(index: number): void {
        if (!Number.isInteger(index) || index < 0 || index >= this.length) throw new RangeError('Point index out of range.');
    }

    private ensureCapacity(points: number): void {
        if (points <= this.data.length / 4) return;
        let capacity = this.data.length / 4;
        while (capacity < points) capacity *= 2;
        const next = new Float32Array(capacity * 4);
        next.set(this.data.subarray(0, this.length * 4));
        this.data = next;
    }

    private grow(): void { this.ensureCapacity(this.length + 1); }
}
