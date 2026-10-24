import { ICONS, createSvg, setAccessibleTooltip, bindTapOrClick } from '../theme.ts';

export interface SliderControlOptions {
    min?: number;
    max?: number;
    step?: number;
    value?: number;
    variant?: 'default' | 'sm';
    ariaLabel?: string;
    showValueText?: boolean;
    onChange?: (value: number) => void;
}

export class SliderControl {
    readonly element: HTMLElement;
    private readonly trackEl: HTMLElement;
    private readonly thumbEl: HTMLElement;
    private readonly minusBtn: HTMLButtonElement;
    private readonly plusBtn: HTMLButtonElement;

    private min: number;
    private max: number;
    private step: number;
    private value: number;
    private variant: 'default' | 'sm';
    private showValueText: boolean;
    private onChange?: (value: number) => void;
    private isPointerDown = false;

    constructor(options: SliderControlOptions = {}) {
        this.min = options.min ?? 1;
        this.max = options.max ?? 10;
        this.step = options.step ?? 1;
        this.variant = options.variant ?? 'default';
        this.showValueText = options.showValueText ?? (this.variant === 'default');
        this.onChange = options.onChange;

        const initialVal = options.value ?? this.min;
        this.value = Math.max(this.min, Math.min(this.max, initialVal));

        // Root container: .sl [.sl.sm]
        this.element = document.createElement('div');
        this.element.className = `sl ${this.variant === 'sm' ? 'sm' : ''}`.trim();
        this.element.setAttribute('role', 'group');
        if (options.ariaLabel) {
            this.element.setAttribute('aria-label', options.ariaLabel);
        }

        // Minus button: .st
        this.minusBtn = document.createElement('button');
        this.minusBtn.type = 'button';
        this.minusBtn.className = 'st';
        this.minusBtn.style.touchAction = 'manipulation';
        setAccessibleTooltip(this.minusBtn, 'Disminuir');
        this.minusBtn.appendChild(createSvg(ICONS.minus, { size: 14, strokeWidth: 2 }));
        bindTapOrClick(this.minusBtn, (e) => {
            e?.stopPropagation();
            this.setValue(this.value - this.step, true);
        });

        // Track: .trk
        this.trackEl = document.createElement('div');
        this.trackEl.className = 'trk';
        this.trackEl.setAttribute('role', 'slider');
        this.trackEl.setAttribute('aria-valuemin', String(this.min));
        this.trackEl.setAttribute('aria-valuemax', String(this.max));
        this.trackEl.setAttribute('aria-valuenow', String(this.value));
        if (options.ariaLabel) {
            this.trackEl.setAttribute('aria-label', options.ariaLabel);
        }
        this.trackEl.tabIndex = 0;

        // Thumb: .th
        this.thumbEl = document.createElement('div');
        this.thumbEl.className = 'th';
        this.trackEl.appendChild(this.thumbEl);

        // Plus button: .st
        this.plusBtn = document.createElement('button');
        this.plusBtn.type = 'button';
        this.plusBtn.className = 'st';
        this.plusBtn.style.touchAction = 'manipulation';
        setAccessibleTooltip(this.plusBtn, 'Aumentar');
        this.plusBtn.appendChild(createSvg(ICONS.plus, { size: 14, strokeWidth: 2 }));
        bindTapOrClick(this.plusBtn, (e) => {
            e?.stopPropagation();
            this.setValue(this.value + this.step, true);
        });

        // Setup pointer event handling on track with pointer capture
        this.setupPointerEvents();
        this.setupKeyboardEvents();

        this.element.append(this.minusBtn, this.trackEl, this.plusBtn);
        this.syncVisual();
    }

    private setupPointerEvents(): void {
        const handleMove = (clientX: number) => {
            const rect = this.trackEl.getBoundingClientRect();
            if (rect.width <= 0) return;
            const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const rawVal = this.min + ratio * (this.max - this.min);
            const stepped = Math.round((rawVal - this.min) / this.step) * this.step + this.min;
            const clamped = Math.max(this.min, Math.min(this.max, Math.round(stepped * 100) / 100));
            if (clamped !== this.value) {
                this.value = clamped;
                this.syncVisual();
                this.onChange?.(this.value);
            }
        };

        this.trackEl.onpointerdown = (e) => {
            if (typeof e.button === 'number' && e.button !== 0 && e.button !== -1) return;
            this.isPointerDown = true;
            try {
                this.trackEl.setPointerCapture(e.pointerId);
            } catch {
                // Ignore capture errors in synthetic/mock environments
            }
            handleMove(e.clientX);
        };

        this.trackEl.onpointermove = (e) => {
            if (this.isPointerDown) {
                handleMove(e.clientX);
            }
        };

        const onPointerEnd = (e: PointerEvent) => {
            if (this.isPointerDown) {
                this.isPointerDown = false;
                try {
                    this.trackEl.releasePointerCapture(e.pointerId);
                } catch {
                    // Ignore in mock environments
                }
            }
        };

        this.trackEl.onpointerup = onPointerEnd;
        this.trackEl.onpointercancel = onPointerEnd;
    }

    private setupKeyboardEvents(): void {
        this.trackEl.onkeydown = (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault();
                this.setValue(this.value - this.step, true);
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.setValue(this.value + this.step, true);
            } else if (e.key === 'Home') {
                e.preventDefault();
                this.setValue(this.min, true);
            } else if (e.key === 'End') {
                e.preventDefault();
                this.setValue(this.max, true);
            }
        };
    }

    private syncVisual(): void {
        const count = Math.max(1, Math.round((this.max - this.min) / this.step) + 1);
        this.trackEl.style.setProperty('--n', String(count));

        const span = this.max - this.min;
        const percent = span > 0 ? ((this.value - this.min + 0.5) / count) * 100 : 50;
        this.thumbEl.style.left = `${Math.max(0, Math.min(100, percent))}%`;

        if (this.showValueText) {
            this.thumbEl.textContent = String(this.value);
        } else {
            this.thumbEl.textContent = '';
        }

        this.trackEl.setAttribute('aria-valuenow', String(this.value));
    }

    setValue(value: number, emit = false): void {
        const clamped = Math.max(this.min, Math.min(this.max, Math.round(value * 100) / 100));
        if (clamped === this.value) return;
        this.value = clamped;
        this.syncVisual();
        if (emit) {
            this.onChange?.(this.value);
        }
    }

    getValue(): number {
        return this.value;
    }

    setRange(min: number, max: number, step = 1): void {
        this.min = min;
        this.max = max;
        this.step = step;
        this.trackEl.setAttribute('aria-valuemin', String(this.min));
        this.trackEl.setAttribute('aria-valuemax', String(this.max));
        this.setValue(this.value, false);
    }
}
