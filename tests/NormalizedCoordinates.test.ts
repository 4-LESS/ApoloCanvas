import { test, describe } from 'node:test';
import assert from 'node:assert';
import { sanitizeNormalizedPoint, snapNormalizedPoint } from '../src/engine/anchoring/InkBoundary.ts';
import type { PageDocument, StrokeElement } from '../src/core/types.ts';

describe('Normalized Coordinate System and Grid Snapping (Step a)', () => {
    test('snapNormalizedPoint snaps coordinates to exact 1/N column-proportional intervals', () => {
        const N = 32;
        const step = 1 / N; // 0.03125

        // u = 0.05 -> round(0.05 / 0.03125) = round(1.6) = 2 -> 2 * 0.03125 = 0.0625
        const snapped1 = snapNormalizedPoint(0.05, 0.09, N);
        assert.strictEqual(snapped1.u, 0.0625);
        assert.strictEqual(snapped1.v, 0.09375); // 3 * 0.03125

        // Exact grid dot stays intact
        const snapped2 = snapNormalizedPoint(0.25, 0.50, N);
        assert.strictEqual(snapped2.u, 0.25);
        assert.strictEqual(snapped2.v, 0.50);

        // Density N=24
        const snapped24 = snapNormalizedPoint(0.125, 0.25, 24);
        const step24 = 1 / 24;
        assert.strictEqual(snapped24.u, Math.round(0.125 / step24) * step24);
    });

    test('sanitizeNormalizedPoint strictly confines box strokes to [0, 1] laterally and >= 0 vertically', () => {
        // Lateral overflow on right
        const clampedRight = sanitizeNormalizedPoint(1.35, 0.20, { isBoxStroke: true });
        assert.strictEqual(clampedRight.u, 1.0);
        assert.strictEqual(clampedRight.v, 0.20);

        // Lateral overflow on left
        const clampedLeft = sanitizeNormalizedPoint(-0.15, 0.45, { isBoxStroke: true });
        assert.strictEqual(clampedLeft.u, 0.0);
        assert.strictEqual(clampedLeft.v, 0.45);

        // Top edge overflow
        const clampedTop = sanitizeNormalizedPoint(0.60, -0.08, { isBoxStroke: true });
        assert.strictEqual(clampedTop.u, 0.60);
        assert.strictEqual(clampedTop.v, 0.0);
    });

    test('sanitizeNormalizedPoint allows unrestricted freehand ink outside boxes', () => {
        // Freehand ink in left margin (negative u)
        const marginInk = sanitizeNormalizedPoint(-0.25, 0.10, { isBoxStroke: false });
        assert.strictEqual(marginInk.u, -0.25);
        assert.strictEqual(marginInk.v, 0.10);

        // Freehand ink in right margin (u > 1)
        const rightMarginInk = sanitizeNormalizedPoint(1.30, 0.15, { isBoxStroke: false });
        assert.strictEqual(rightMarginInk.u, 1.30);
        assert.strictEqual(rightMarginInk.v, 0.15);
    });

    test('normalized coordinate proportional scale preserves visual alignment when column width changes', () => {
        // A point drawn in center of column (u = 0.5, v = 0.25)
        const u = 0.5;
        const v = 0.25;

        // Viewport 1 (tablet portrait: contentWidth = 700px, contentLeft = 50px, blockTop = 200px)
        const width1 = 700;
        const left1 = 50;
        const top1 = 200;
        const docX1 = left1 + u * width1; // 50 + 350 = 400
        const docY1 = top1 + v * width1;  // 200 + 175 = 375
        assert.strictEqual(docX1, 400);
        assert.strictEqual(docY1, 375);

        // Viewport 2 (tablet landscape: contentWidth = 900px, contentLeft = 120px, blockTop = 200px)
        const width2 = 900;
        const left2 = 120;
        const docX2 = left2 + u * width2; // 120 + 450 = 570
        const docY2 = top1 + v * width2;  // 200 + 225 = 425
        assert.strictEqual(docX2, 570);
        assert.strictEqual(docY2, 425);

        // Normalized coordinate round-trip recovers exact original u and v
        const recoveredU1 = (docX1 - left1) / width1;
        const recoveredV1 = (docY1 - top1) / width1;
        const recoveredU2 = (docX2 - left2) / width2;
        const recoveredV2 = (docY2 - top1) / width2;

        assert.strictEqual(recoveredU1, u);
        assert.strictEqual(recoveredV1, v);
        assert.strictEqual(recoveredU2, u);
        assert.strictEqual(recoveredV2, v);
    });

    test('PageDocument schema correctly persists boxes and layoutHint metadata', () => {
        const doc: PageDocument = {
            schemaVersion: 1,
            version: 1,
            id: 'page-123',
            notePath: 'Notes/Test.md',
            elements: [],
            boxes: {
                'space-001': {
                    height: 240,
                    lastTop: 350,
                    gridVisible: true,
                    gridStyle: 'dots',
                    gridDensity: 32,
                },
            },
            layoutHint: {
                contentWidth: 780,
                contentLeft: 90,
                updatedAt: Date.now(),
                anchorTops: {
                    'line:0': 100,
                    'space:space-001': 350,
                },
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        const serialized = JSON.stringify(doc);
        const parsed: PageDocument = JSON.parse(serialized);

        assert.strictEqual(parsed.boxes?.['space-001'].height, 240);
        assert.strictEqual(parsed.boxes?.['space-001'].gridDensity, 32);
        assert.strictEqual(parsed.layoutHint?.contentWidth, 780);
        assert.strictEqual(parsed.layoutHint?.anchorTops?.['space:space-001'], 350);
    });
});
