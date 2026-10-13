import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    isInkAllowedAt,
    sanitizeNormalizedPoint,
    isElementForbidden,
    splitStrokeIntoValidRuns,
    DEFAULT_INK_LIMITS,
    type DocumentContentBounds,
    type InkLimits,
} from '../src/engine/anchoring/InkBoundary.ts';

describe('InkBoundary - Drawing Limits and Forbidden Zones', () => {
    const mockBounds: DocumentContentBounds = {
        contentLeft: 100,
        contentWidth: 800,
        contentTop: 150,     // e.g. after frontmatter and title
        contentBottom: 950,  // bottom of last text paragraph
        spaceBlocks: [
            { top: 1100, bottom: 1300 },
        ],
    };

    test('allows ink within standard document body', () => {
        const docX = 300;
        const docY = 400;
        const result = isInkAllowedAt(docX, docY, mockBounds);
        assert.strictEqual(result.allowed, true);
    });

    test('allows ink in side margins without restriction', () => {
        // Left margin: docX = -50
        const leftResult = isInkAllowedAt(-50, 400, mockBounds);
        assert.strictEqual(leftResult.allowed, true);

        // Right margin: docX = 1200
        const rightResult = isInkAllowedAt(1200, 400, mockBounds);
        assert.strictEqual(rightResult.allowed, true);
    });

    test('rejects ink above content top (protects frontmatter and title)', () => {
        // docY = 100 (< contentTop 150 - 4px tolerance)
        const result = isInkAllowedAt(300, 100, mockBounds);
        assert.strictEqual(result.allowed, false);
        assert.strictEqual(result.reason, 'above-content-top');
    });

    test('allows ink anywhere below content top, including empty space below text', () => {
        // docY = 1050 (below last paragraph, even without space blocks)
        const result = isInkAllowedAt(300, 1050, mockBounds);
        assert.strictEqual(result.allowed, true);

        // docY = 3000 (deep in empty page space)
        const deepResult = isInkAllowedAt(300, 3000, mockBounds);
        assert.strictEqual(deepResult.allowed, true);
    });

    test('rejects drawing when contentWidth is invalid', () => {
        const invalidBounds: DocumentContentBounds = {
            ...mockBounds,
            contentWidth: 0,
        };
        const result = isInkAllowedAt(300, 400, invalidBounds);
        assert.strictEqual(result.allowed, false);
        assert.strictEqual(result.reason, 'invalid-content-width');
    });

    test('sanitizeNormalizedPoint preserves coordinates without artificial clamping', () => {
        // Natural coordinates within content
        const mid = sanitizeNormalizedPoint(0.5, 0.1);
        assert.strictEqual(mid.u, 0.5);
        assert.strictEqual(mid.v, 0.1);

        // Freehand coordinates extending into margins are preserved naturally
        const farLeft = sanitizeNormalizedPoint(-0.8, 0.1);
        assert.strictEqual(farLeft.u, -0.8);
        assert.strictEqual(farLeft.v, 0.1);

        const farRight = sanitizeNormalizedPoint(2.5, -0.3);
        assert.strictEqual(farRight.u, 2.5);
        assert.strictEqual(farRight.v, -0.3);

        // Non-finite values (NaN, Infinity) are safely sanitized to 0
        const nanCase = sanitizeNormalizedPoint(Number.NaN, Number.POSITIVE_INFINITY);
        assert.strictEqual(nanCase.u, 0);
        assert.strictEqual(nanCase.v, 0);
    });

    test('isElementForbidden detects forbidden selectors', () => {
        // Mock DOM element hierarchy
        function createMockElement(tag: string, className = '', parent?: any): any {
            return {
                tagName: tag.toUpperCase(),
                className,
                parentElement: parent || null,
                matches(selector: string) {
                    if (selector.startsWith('.') && this.className.includes(selector.slice(1))) return true;
                    if (selector.toLowerCase() === tag.toLowerCase()) return true;
                    return false;
                },
                closest(selector: string) {
                    let cur: any = this;
                    while (cur) {
                        if (cur.matches(selector)) return cur;
                        cur = cur.parentElement;
                    }
                    return null;
                },
            };
        }

        const frontmatterEl = createMockElement('div', 'metadata-container');
        const frontmatterChild = createMockElement('span', 'metadata-property-key', frontmatterEl);
        assert.strictEqual(isElementForbidden(frontmatterEl), true);
        assert.strictEqual(isElementForbidden(frontmatterChild), true);

        const titleEl = createMockElement('div', 'inline-title');
        assert.strictEqual(isElementForbidden(titleEl), true);

        const gutterEl = createMockElement('div', 'cm-gutters');
        assert.strictEqual(isElementForbidden(gutterEl), true);

        const toolbarEl = createMockElement('div', 'apolo-toolbar');
        assert.strictEqual(isElementForbidden(toolbarEl), true);

        const buttonEl = createMockElement('button', 'clickable-icon');
        assert.strictEqual(isElementForbidden(buttonEl), true);

        // Allowed document element
        const docPara = createMockElement('p', 'cm-line');
        const textSpan = createMockElement('span', 'cm-text', docPara);
        assert.strictEqual(isElementForbidden(docPara), false);
        assert.strictEqual(isElementForbidden(textSpan), false);
    });

    test('splitStrokeIntoValidRuns preserves continuous valid strokes', () => {
        const points = [
            { x: 100, y: 200 },
            { x: 150, y: 250 },
            { x: 200, y: 300 },
        ];
        const contentTop = 150; // forbidden boundary = 150 - 4 = 146
        const runs = splitStrokeIntoValidRuns(points, contentTop);
        assert.strictEqual(runs.length, 1);
        assert.strictEqual(runs[0].length, 3);
        assert.deepStrictEqual(runs[0], points);
    });

    test('splitStrokeIntoValidRuns discards strokes entirely in forbidden zone', () => {
        const points = [
            { x: 100, y: 50 },
            { x: 150, y: 80 },
            { x: 200, y: 100 },
        ];
        const contentTop = 150; // forbidden boundary = 146
        const runs = splitStrokeIntoValidRuns(points, contentTop);
        assert.strictEqual(runs.length, 0);
    });

    test('splitStrokeIntoValidRuns splits stroke entering forbidden zone and returning, eliminating jump artifact', () => {
        // ContentTop = 150 (forbidden boundary = 146)
        // Path: (100, 200) -> (150, 100 [forbidden]) -> (200, 80 [forbidden]) -> (250, 200 [valid])
        const points = [
            { x: 100, y: 200, pressure: 0.5, time: 10 },
            { x: 150, y: 100, pressure: 0.5, time: 20 }, // forbidden (< 146)
            { x: 200, y: 80, pressure: 0.5, time: 30 },  // forbidden (< 146)
            { x: 250, y: 200, pressure: 0.5, time: 40 }, // returns to valid
            { x: 300, y: 250, pressure: 0.5, time: 50 },
        ];
        const contentTop = 150;
        const runs = splitStrokeIntoValidRuns(points, contentTop);

        // MUST be split into 2 disconnected runs (no connecting bridge/jump)
        assert.strictEqual(runs.length, 2);

        // Run 1: starts at (100, 200) and ends at boundary exit (y = 146)
        assert.strictEqual(runs[0].length, 2);
        assert.strictEqual(runs[0][0].x, 100);
        assert.strictEqual(runs[0][0].y, 200);
        assert.strictEqual(runs[0][1].y, 146); // interpolated boundary exit

        // Run 2: starts at boundary re-entry (y = 146) and continues to (300, 250)
        assert.strictEqual(runs[1].length, 3);
        assert.strictEqual(runs[1][0].y, 146); // interpolated boundary entry
        assert.strictEqual(runs[1][1].x, 250);
        assert.strictEqual(runs[1][1].y, 200);
        assert.strictEqual(runs[1][2].x, 300);
        assert.strictEqual(runs[1][2].y, 250);
    });
});
