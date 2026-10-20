import type { Point } from '../../core/types.ts';

/** Velocity based tip projection with exponential decay as motion slows. */
export class Predictor {
    private previousX = 0;
    private previousY = 0;
    private velocityX = 0;
    private velocityY = 0;
    private lastTime = 0;
    private pressure = 0;
    private initialized = false;

    private readonly horizonMs: number;
    private readonly damping: number;
    private readonly maxSpeed: number;

    constructor(horizonMs = 12, damping = 0.82, maxSpeed = 5) {
        this.horizonMs = horizonMs;
        this.damping = damping;
        this.maxSpeed = maxSpeed;
    }

    update(point: Point): Point {
        const time = point.time ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
        this.updateValues(point.x, point.y, point.pressure ?? 0, time);
        return this.predict();
    }

    updateValues(x: number, y: number, pressure: number, time: number): void {
        if (this.initialized) {
            const dt = Math.max(1, Math.min(50, time - this.lastTime));
            const instantX = (x - this.previousX) / dt;
            const instantY = (y - this.previousY) / dt;
            this.velocityX = this.velocityX * this.damping + instantX * (1 - this.damping);
            this.velocityY = this.velocityY * this.damping + instantY * (1 - this.damping);
        } else {
            this.initialized = true;
        }
        this.previousX = x;
        this.previousY = y;
        this.lastTime = time;
        this.pressure = pressure;
    }

    predict(horizonMs = this.horizonMs): Point {
        const result: Point = { x: 0, y: 0, pressure: 0, time: 0 };
        this.predictInto(result, horizonMs);
        return result;
    }

    predictInto(output: Point, horizonMs = this.horizonMs): void {
        const speed = Math.hypot(this.velocityX, this.velocityY);
        const scale = speed > this.maxSpeed ? this.maxSpeed / speed : 1;
        output.x = this.previousX + this.velocityX * scale * horizonMs;
        output.y = this.previousY + this.velocityY * scale * horizonMs;
        output.pressure = this.pressure;
        output.time = this.lastTime + horizonMs;
    }

    decay(factor = this.damping): void {
        const amount = Math.max(0, Math.min(1, factor));
        this.velocityX *= amount;
        this.velocityY *= amount;
    }

    reset(): void {
        this.previousX = 0;
        this.previousY = 0;
        this.velocityX = 0;
        this.velocityY = 0;
        this.lastTime = 0;
        this.pressure = 0;
        this.initialized = false;
    }
}
