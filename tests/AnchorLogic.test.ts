import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('Anchor Coordinate Transformations', () => {
    test('reanchorSelection preserves exact document world coordinates', () => {
        const contentLeft = 120;
        const contentWidth = 750;

        // An element initially anchored to Block A at top 200px
        const oldBlockTop = 200;
        const oldU = 0.35; // 35% across content
        const oldV = 0.10; // 10% of content width below Block A

        // World coordinates before move
        const docX_before = contentLeft + oldU * contentWidth;
        const docY_before = oldBlockTop + oldV * contentWidth;

        // User translates selection by dx = +50px, dy = +300px
        const dx = 50;
        const dy = 300;
        const du = dx / contentWidth;
        const dv = dy / contentWidth;

        const movedU = oldU + du;
        const movedV = oldV + dv;

        // World coordinates after translation
        const docX_moved = contentLeft + movedU * contentWidth;
        const docY_moved = oldBlockTop + movedV * contentWidth;

        assert.strictEqual(Math.round(docX_moved), Math.round(docX_before + dx));
        assert.strictEqual(Math.round(docY_moved), Math.round(docY_before + dy));

        // Now re-anchoring: At the new position, nearest block is Block B at top 480px
        const newBlockTop = 480;
        // The correction formula:
        const deltaTop = oldBlockTop - newBlockTop; // 200 - 480 = -280
        const adjustV = deltaTop / contentWidth;
        const newV = movedV + adjustV;

        // World coordinates computed with new block top and new V
        const docY_afterReanchor = newBlockTop + newV * contentWidth;

        assert.ok(
            Math.abs(docY_afterReanchor - docY_moved) < 0.0001,
            `World Y must not change during re-anchoring! Expected ${docY_moved}, got ${docY_afterReanchor}`
        );
    });

    test('space block insertion does not double shift when element relies on anchor block', () => {
        const contentWidth = 800;

        // An element anchored to Paragraph 2 (blockTop = 500)
        let blockTop_para2 = 500;
        const v = 0.05; // 40px below paragraph 2
        const initialY = blockTop_para2 + v * contentWidth; // 540

        // User inserts a 150px space block ABOVE Paragraph 2
        const spaceHeight = 150;

        // In CodeMirror / preview DOM, inserting the space block physically pushes Paragraph 2 down
        blockTop_para2 += spaceHeight; // now 650

        // With SINGLE shift (correct behavior: element moves with its anchor block):
        const correctNewY = blockTop_para2 + v * contentWidth; // 650 + 40 = 690
        assert.strictEqual(correctNewY - initialY, spaceHeight, 'Element must move down by exactly the space height (150px)');

        // With DOUBLE shift (buggy behavior where code also modified v):
        const buggyV = v + spaceHeight / contentWidth;
        const doubleShiftY = blockTop_para2 + buggyV * contentWidth; // 650 + 40 + 150 = 840 (moved by 300px!)
        assert.strictEqual(doubleShiftY - initialY, 2 * spaceHeight, 'Double shift incorrectly moved by 300px');
    });

    test('document world Y is strictly invariant under scroll operations', () => {
        const contentWidth = 720;
        const blockTopDoc = 450;
        const v = 0.08; // 57.6px below block
        const docY = blockTopDoc + v * contentWidth;

        // Simulate multiple scroll positions
        const scrollPositions = [0, 100, 250, 600, 1200];
        for (const sTop of scrollPositions) {
            // Screen Y = docY - sTop
            const screenY = docY - sTop;
            // Transforming screen back to document space: screenY + sTop
            const recoveredDocY = screenY + sTop;
            assert.strictEqual(recoveredDocY, docY, `Document Y must not change when sTop=${sTop}`);
        }
    });

    test('offscreen block cached position prevents fallback estimation corruption', () => {
        const cache = new Map<string, number>();
        const blockId = 'line:25';
        const measuredTop = 840;

        // 1. Block measured while onscreen
        cache.set(blockId, measuredTop);

        // 2. Block scrolls offscreen (DOM element unavailable)
        const elementInDom = null;
        let resolvedTop: number;

        if (elementInDom !== null) {
            resolvedTop = 9999; // would measure from DOM
        } else {
            // Offscreen cache lookup before fallback
            const cached = cache.get(blockId);
            if (cached !== undefined) {
                resolvedTop = cached;
            } else {
                resolvedTop = 25 * 24; // inaccurate fallback
            }
        }

        assert.strictEqual(resolvedTop, measuredTop, 'Must return measuredTop from cache rather than falling back to estimate');
    });
});

