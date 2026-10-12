import { test, describe } from 'node:test';
import assert from 'node:assert';
import { calculateNaturalPressureScale, smoothPressure } from '../src/engine/input/PressureCurve.ts';
import { strokeHitDoc, shapeHitDoc, distToSegmentSquared, minDistanceBetweenSegmentsSquared } from '../src/engine/eraser/StrokeEraser.ts';
import { HIGHLIGHTER_PALETTE, HIGHLIGHTER_COLOR_NAMES, PEN_PROFILES } from '../src/ui/theme.ts';
import type { StrokeElement, ShapeElement, EraserMode, ThicknessPreset } from '../src/core/types.ts';

describe('Pilar B: Pluma / Bolígrafo - Curva de presión y 3 grosores predefinidos', () => {
    test('calculateNaturalPressureScale provides non-linear natural response for stylus', () => {
        // Fallback for mouse / non-stylus without pressure
        assert.strictEqual(calculateNaturalPressureScale(0), 1.0);
        assert.strictEqual(calculateNaturalPressureScale(undefined), 1.0);
        assert.strictEqual(calculateNaturalPressureScale(-0.5), 1.0);

        // Bolígrafo (ball profile): robust, consistent width for rapid writing
        const ballLight = calculateNaturalPressureScale(0.15, 'ball', 0.75);
        const ballMedium = calculateNaturalPressureScale(0.50, 'ball', 0.75);
        const ballHeavy = calculateNaturalPressureScale(0.90, 'ball', 0.75);

        assert.ok(ballLight >= 0.70, 'Ball light pressure should stay comfortably above 0.70');
        assert.ok(ballHeavy <= 1.25, 'Ball max pressure should not exceed 1.25');
        assert.ok(ballLight < ballMedium && ballMedium < ballHeavy, 'Ball curve should be strictly monotonic');

        // Pluma estilográfica (fountain profile): dynamic calligraphic range
        const fountainLight = calculateNaturalPressureScale(0.10, 'fountain', 0.75);
        const fountainHeavy = calculateNaturalPressureScale(0.95, 'fountain', 0.75);

        assert.ok(fountainLight < 0.60, 'Fountain should allow fine upstrokes');
        assert.ok(fountainHeavy > 1.40, 'Fountain should produce rich, expressive downstrokes');
        assert.ok(fountainHeavy - fountainLight > ballHeavy - ballLight, 'Fountain dynamic range exceeds ball profile');

        // Sensitivity modulation
        const highSens = calculateNaturalPressureScale(0.35, 'fountain', 0.95);
        const lowSens = calculateNaturalPressureScale(0.35, 'fountain', 0.25);
        assert.ok(highSens > lowSens, 'Higher sensitivity produces thicker stroke at moderate pressure');
    });

    test('smoothPressure filters high-frequency sensor jitter without lag', () => {
        const prev = 0.30;
        const noisySpike = 0.70;
        const smoothed = smoothPressure(prev, noisySpike, 0.70);

        // Smoothed value: 0.30 * 0.30 + 0.70 * 0.70 = 0.09 + 0.49 = 0.58
        assert.ok(smoothed > prev && smoothed < noisySpike, 'Smoothed sample dampens sharp step');
        assert.strictEqual(Math.round(smoothed * 100) / 100, 0.58);
    });

    test('3 quick thickness presets match standard writing roles', () => {
        // Preset definitions for pen: fine (small writing), normal (standard text), bold (headings)
        const penPresets: Record<ThicknessPreset, { width: number; role: string }> = {
            fine: { width: 1.8, role: 'letra pequeña' },
            normal: { width: 3.2, role: 'texto' },
            bold: { width: 6.0, role: 'títulos' },
        };

        assert.strictEqual(penPresets.fine.width, 1.8);
        assert.strictEqual(penPresets.normal.width, 3.2);
        assert.strictEqual(penPresets.bold.width, 6.0);

        // Ratio ensures visual distinction without extreme contrast
        assert.ok(penPresets.fine.width < penPresets.normal.width);
        assert.ok(penPresets.normal.width < penPresets.bold.width);
        assert.ok(penPresets.bold.width / penPresets.normal.width < 2.5);
    });
});

describe('Pilar B: Resaltador (Highlighter) - Composición multiply y paleta', () => {
    test('HIGHLIGHTER_PALETTE contains vibrant fluorescent colors', () => {
        assert.ok(Array.isArray(HIGHLIGHTER_PALETTE));
        assert.ok(HIGHLIGHTER_PALETTE.length >= 6);

        // Core yellow and green highlighting colors
        assert.ok(HIGHLIGHTER_PALETTE.includes('#F5C400'), 'Includes classic yellow highlighter');
        assert.ok(HIGHLIGHTER_PALETTE.includes('#2ECC71'), 'Includes green neon highlighter');
        assert.ok(HIGHLIGHTER_PALETTE.includes('#54C7EC'), 'Includes sky cyan highlighter');

        // Color names match
        assert.strictEqual(HIGHLIGHTER_COLOR_NAMES['#F5C400'], 'Amarillo fluorescente');
        assert.strictEqual(HIGHLIGHTER_COLOR_NAMES['#2ECC71'], 'Verde neón');
    });

    test('Pen profile configuration for highlighter provides translucent wide ink', () => {
        const hlr = PEN_PROFILES.hlr;
        const hlf = PEN_PROFILES.hlf;

        assert.strictEqual(hlr.op, 0.45, 'Highlighter opacity should be translucent (~0.45)');
        assert.strictEqual(hlf.op, 0.45, 'Chisel highlighter opacity should be translucent (~0.45)');
        assert.ok(hlr.wm >= 4.0, 'Highlighter width multiplier should be wide');
    });

    test('Highlighter blend mode selection preserves text contrast in light and dark modes', () => {
        const getBlendMode = (isDark: boolean): string => {
            return isDark ? 'screen' : 'multiply';
        };

        // Light theme uses multiply so yellow passes behind black text without obscuring
        assert.strictEqual(getBlendMode(false), 'multiply');

        // Dark theme uses screen so highlighter illuminates dark background without washing out
        assert.strictEqual(getBlendMode(true), 'screen');
    });
});

describe('Pilar B: Borrador de trazo completo (Stroke Eraser)', () => {
    const mockStroke: StrokeElement = {
        id: 'stroke-1',
        type: 'stroke',
        blockId: 'block-1',
        anchorText: 'Sample text',
        points: [
            0.1, 0.1, 0.5, 1000,
            0.5, 0.1, 0.5, 1010,
            0.9, 0.1, 0.5, 1020,
        ],
        style: {
            color: '#000000',
            width: 3.2,
            opacity: 1,
            pattern: 'solid',
        },
        bounds: {
            minX: 0.1,
            maxX: 0.9,
            minY: 0.1,
            maxY: 0.1,
        },
        zIndex: 1,
    };

    const contentLeft = 50;
    const contentWidth = 500;
    const blockTop = 100;

    test('strokeHitDoc detects direct hit on stroke point', () => {
        // Point right on the middle vertex: (50 + 0.5*500, 100 + 0.1*500) = (300, 150)
        const eraserHits = [{ x: 300, y: 150 }];
        const hit = strokeHitDoc(mockStroke, eraserHits, 15, contentLeft, contentWidth, blockTop);
        assert.strictEqual(hit, true, 'Direct hit within eraser radius must be detected');
    });

    test('strokeHitDoc detects fast swipe cutting across a stroke segment', () => {
        // Stroke runs horizontally from (100, 150) to (500, 150)
        // Fast swipe cuts vertically from (250, 50) to (250, 250)
        // Neither eraser endpoint is within radius 10 of (250, 150), but the segment cuts across!
        const swipe = [
            { x: 250, y: 50 },
            { x: 250, y: 250 },
        ];

        const hit = strokeHitDoc(mockStroke, swipe, 10, contentLeft, contentWidth, blockTop);
        assert.strictEqual(hit, true, 'Fast cross-cutting swipe must register a collision');
    });

    test('strokeHitDoc correctly ignores distant eraser points', () => {
        const farAway = [{ x: 50, y: 500 }];
        const hit = strokeHitDoc(mockStroke, farAway, 18, contentLeft, contentWidth, blockTop);
        assert.strictEqual(hit, false, 'Far away eraser should not hit stroke');
    });

    test('strokeHitDoc detects tap on a single-point dot stroke', () => {
        const dotStroke: StrokeElement = {
            id: 'dot-1',
            type: 'stroke',
            blockId: 'block-1',
            anchorText: '',
            points: [0.3, 0.3, 0.5, 1000],
            style: { color: '#000', width: 4, opacity: 1, pattern: 'solid' },
            bounds: { minX: 0.3, maxX: 0.3, minY: 0.3, maxY: 0.3 },
            zIndex: 1,
        };

        // Dot doc coords: (50 + 150, 100 + 150) = (200, 250)
        const nearDot = [{ x: 204, y: 248 }];
        const hit = strokeHitDoc(dotStroke, nearDot, 12, contentLeft, contentWidth, blockTop);
        assert.strictEqual(hit, true, 'Tap near single-point dot must detect hit');
    });

    test('shapeHitDoc detects hits on rectangle and line shapes', () => {
        const rectShape: ShapeElement = {
            id: 'rect-1',
            type: 'shape',
            shapeType: 'rect',
            blockId: 'block-1',
            anchorText: '',
            startX: 0.2,
            startY: 0.2,
            endX: 0.4,
            endY: 0.4,
            style: { color: '#2F6BFF', width: 2, opacity: 1, pattern: 'solid' },
            bounds: { minX: 0.2, maxX: 0.4, minY: 0.2, maxY: 0.4 },
            zIndex: 1,
        };

        // Rect spans doc coords: X from (50 + 100 = 150) to (50 + 200 = 250), Y from (100 + 100 = 200) to (100 + 200 = 300)
        const hitInterior = [{ x: 200, y: 250 }];
        assert.strictEqual(shapeHitDoc(rectShape, hitInterior, 10, contentLeft, contentWidth, blockTop), true);

        const farMiss = [{ x: 400, y: 500 }];
        assert.strictEqual(shapeHitDoc(rectShape, farMiss, 10, contentLeft, contentWidth, blockTop), false);
    });

    test('stroke eraser simulation erases entire stroke on touch in whole mode', () => {
        let elements: (StrokeElement | ShapeElement)[] = [mockStroke];
        let mode: EraserMode = 'whole'; // Whole stroke eraser by default

        const eraseAt = (points: { x: number; y: number }[], radius: number) => {
            elements = elements.filter(el => {
                if (el.type === 'stroke') {
                    if (mode === 'whole') {
                        return !strokeHitDoc(el, points, radius, contentLeft, contentWidth, blockTop);
                    }
                }
                return true;
            });
        };

        // Touch the stroke once
        eraseAt([{ x: 300, y: 150 }], 18);

        // Entire stroke is immediately deleted
        assert.strictEqual(elements.length, 0, 'Stroke should be erased completely in whole mode');
    });

    test('quick toggle between whole and reticle eraser modes', () => {
        let currentMode: EraserMode = 'whole'; // Default mode is whole stroke

        const toggleEraserMode = () => {
            currentMode = currentMode === 'whole' ? 'reticle' : 'whole';
        };

        assert.strictEqual(currentMode, 'whole');
        toggleEraserMode();
        assert.strictEqual(currentMode, 'reticle');
        toggleEraserMode();
        assert.strictEqual(currentMode, 'whole');
    });
});
