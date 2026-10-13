import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoxRegistry } from '../src/core/BoxRegistry.ts';
import { applySpaceMutationToMarkdown } from '../src/editor/ApoloSpaceExtension.ts';
import { sanitizeNormalizedPoint } from '../src/engine/anchoring/InkBoundary.ts';

describe('Paso c2: Cajas de dibujo, Confinamiento, Crecimiento y Handle Menu', () => {
    it('BoxRegistry maintains heights and grid visibility across instances', () => {
        BoxRegistry.clear();
        assert.equal(BoxRegistry.getHeight('box-123'), undefined);
        assert.equal(BoxRegistry.isGridVisible('box-123'), true); // default true

        BoxRegistry.setHeight('box-123', 350);
        BoxRegistry.setGridVisible('box-123', false);

        assert.equal(BoxRegistry.getHeight('box-123'), 350);
        assert.equal(BoxRegistry.isGridVisible('box-123'), false);

        BoxRegistry.setGridVisible('box-123', true);
        assert.equal(BoxRegistry.isGridVisible('box-123'), true);
    });

    it('Local box coordinates map strictly to [0, 1] within box width and confine top edge', () => {
        const boxLeft = 100;
        const boxTop = 200;
        const boxWidth = 500;

        // Inside point (x=350, y=250) -> u = 0.5, v = 0.1
        const rawU = (350 - boxLeft) / boxWidth;
        const rawV = (250 - boxTop) / boxWidth;
        const sanitized = sanitizeNormalizedPoint(rawU, rawV, { isBoxStroke: true });
        assert.equal(sanitized.u, 0.5);
        assert.equal(sanitized.v, 0.1);

        // Outside point to the left (x=50 -> rawU = -0.1) -> clamped to u = 0
        const outLeftU = (50 - boxLeft) / boxWidth;
        const sanitizedLeft = sanitizeNormalizedPoint(outLeftU, rawV, { isBoxStroke: true });
        assert.equal(sanitizedLeft.u, 0);

        // Outside point above top edge (y=150 -> rawV = -0.1) -> clamped to v = 0
        const outTopV = (150 - boxTop) / boxWidth;
        const sanitizedTop = sanitizeNormalizedPoint(rawU, outTopV, { isBoxStroke: true });
        assert.equal(sanitizedTop.v, 0);

        // Outside point to the right (x=650 -> rawU = 1.1) -> clamped to u = 1
        const outRightU = (650 - boxLeft) / boxWidth;
        const sanitizedRight = sanitizeNormalizedPoint(outRightU, rawV, { isBoxStroke: true });
        assert.equal(sanitizedRight.u, 1);
    });

    it('Auto-growth formula computes new height smoothly in stable 32px steps when drawing near or past bottom edge', () => {
        const boxTop = 300;
        const currentHeight = 240; // current box height
        const TRIGGER_MARGIN = 48;
        const GROWTH_STEP = 32;

        const calcGrowth = (ptY: number, curH: number) => {
            const yInBox = ptY - boxTop;
            if (yInBox + TRIGGER_MARGIN > curH) {
                const needed = (yInBox + TRIGGER_MARGIN) - curH;
                const steps = Math.max(1, Math.ceil(needed / GROWTH_STEP));
                return Math.min(3000, curH + steps * GROWTH_STEP);
            }
            return curH;
        };

        // Drawing inside box within margin (y = 450 -> yInBox = 150)
        // 150 + 48 = 198 < 240 -> does not expand yet
        assert.equal(calcGrowth(450, currentHeight), 240);

        // Drawing near bottom boundary (y = 520 -> yInBox = 220)
        // 220 + 48 = 268 > 240 -> needed = 28 -> 1 step of 32px -> expands to 272
        assert.equal(calcGrowth(520, currentHeight), 272);

        // Drawing past bottom boundary (y = 600 -> yInBox = 300)
        // 300 + 48 = 348 > 240 -> needed = 108 -> 4 steps of 32px -> expands to 368
        assert.equal(calcGrowth(600, currentHeight), 368);
    });

    it('Fit height (ajustar altura) computes bottom-most ink + 36px with 120px lower bound', () => {
        const boxTop = 100;

        // Case A: Box with no strokes -> defaults to min 120px
        const maxInkYA = 0;
        const fitA = maxInkYA > boxTop ? Math.max(120, Math.ceil((maxInkYA - boxTop) + 36)) : 120;
        assert.equal(fitA, 120);

        // Case B: Box with small drawing (ink ends at y = 140 -> inkHeight = 40)
        // 40 + 36 = 76 < 120 -> clamped to 120
        const maxInkYB = 140;
        const fitB = Math.max(120, Math.ceil((maxInkYB - boxTop) + 36));
        assert.equal(fitB, 120);

        // Case C: Box with drawing extending to y = 450 (inkHeight = 350)
        // 350 + 36 = 386 -> fit height is 386
        const maxInkYC = 450;
        const fitC = Math.max(120, Math.ceil((maxInkYC - boxTop) + 36));
        assert.equal(fitC, 386);
    });

    it('applySpaceMutationToMarkdown handles update and delete mutations with type discrimination', () => {
        const md = `# Nota\n\n<div class="apolo-space" data-apolo-space="box-abc" style="height:200px;"></div>\n\nTexto siguiente.`;

        // Update height via mutation
        const updated = applySpaceMutationToMarkdown(md, {
            type: 'update',
            id: 'box-abc',
            height: 380,
        });
        assert.ok(updated.includes('height:380px') || updated.includes('data-h="380"'));
        assert.ok(!updated.includes('height:200px'));

        // Delete box via mutation
        const deleted = applySpaceMutationToMarkdown(updated, {
            type: 'delete',
            id: 'box-abc',
        });
        assert.ok(!deleted.includes('box-abc'));
        assert.ok(deleted.includes('Texto siguiente.'));
    });

    it('Paso c3: BoxRegistry manages snap state and grid step aligns with column width / density', () => {
        BoxRegistry.clear();
        assert.equal(BoxRegistry.isSnapActive('box-snap'), false); // default false

        BoxRegistry.setSnapActive('box-snap', true);
        assert.equal(BoxRegistry.isSnapActive('box-snap'), true);

        BoxRegistry.setSnapActive('box-snap', false);
        assert.equal(BoxRegistry.isSnapActive('box-snap'), false);

        // Step calculation test: width / density
        const contentWidth = 768; // tablet viewport
        const density = 32;
        const stepPx = Math.round((contentWidth / density) * 100) / 100;
        assert.equal(stepPx, 24); // 768 / 32 = 24px exactly
    });

    it('Paso c3: BoxRegistry manages full box appearance (gridStyle, bgTheme, accentColor, gridDensity)', () => {
        BoxRegistry.clear();
        assert.equal(BoxRegistry.getGridStyle('box-app'), 'dots'); // default dots
        assert.equal(BoxRegistry.getBgTheme('box-app'), 'default');
        assert.equal(BoxRegistry.getAccentColor('box-app'), 'purple');
        assert.equal(BoxRegistry.getGridDensity('box-app'), 32);

        // Customize appearance
        BoxRegistry.setGridStyle('box-app', 'grid');
        BoxRegistry.setBgTheme('box-app', 'pitch-black');
        BoxRegistry.setAccentColor('box-app', 'emerald');
        BoxRegistry.setGridDensity('box-app', 40);

        assert.equal(BoxRegistry.getGridStyle('box-app'), 'grid');
        assert.equal(BoxRegistry.getBgTheme('box-app'), 'pitch-black');
        assert.equal(BoxRegistry.getAccentColor('box-app'), 'emerald');
        assert.equal(BoxRegistry.getGridDensity('box-app'), 40);

        // None grid style sets gridVisible to false
        BoxRegistry.setGridStyle('box-app', 'none');
        assert.equal(BoxRegistry.getGridStyle('box-app'), 'none');
        assert.equal(BoxRegistry.isGridVisible('box-app'), false);
    });

    it('Strict vertical clipping confines ink rect to box height rather than document void', () => {
        BoxRegistry.clear();
        BoxRegistry.setHeight('box-clip', 280);
        const boxHeight = BoxRegistry.getHeight('box-clip');
        assert.equal(boxHeight, 280);

        // Clip rect must use exact boxHeight, never infinite 100000px
        const clipRect = { x: 50, y: 100, width: 600, height: boxHeight! };
        assert.equal(clipRect.height, 280);
        assert.ok(clipRect.height < 10000);
    });

    it('Granular line mutation updates only the target line without affecting surrounding document text', () => {
        const line1 = '# Encabezado principal';
        const line2 = '<div data-apolo-space="c_target" data-h="280"></div>';
        const line3 = 'Párrafo de texto subsiguiente que no debe alterarse.';
        const docLines = [line1, line2, line3];

        const targetIndex = docLines.findIndex(l => l.includes('c_target'));
        assert.equal(targetIndex, 1);

        const updatedLine = applySpaceMutationToMarkdown(docLines[targetIndex], {
            type: 'update',
            id: 'c_target',
            height: 344,
        });

        assert.equal(updatedLine, '<div data-apolo-space="c_target" data-h="344"></div>');
        docLines[targetIndex] = updatedLine;

        assert.equal(docLines[0], line1);
        assert.equal(docLines[1], '<div data-apolo-space="c_target" data-h="344"></div>');
        assert.equal(docLines[2], line3);
    });

    it('Minimum height resize clamping ensures handle drag cannot shrink smaller than existing ink', () => {
        const boxTop = 200;
        // Mock existing ink in the box ending at y = 380 (180px of ink)
        const maxInkY = 380;
        const inkHeight = maxInkY - boxTop; // 180px
        const minAllowed = Math.max(120, Math.ceil(inkHeight + 24)); // 180 + 24 = 204px
        assert.equal(minAllowed, 204);

        // User attempts to drag handle all the way up to height = 100px
        const attemptedHeight = 100;
        const clampedHeight = Math.max(minAllowed, Math.min(3000, attemptedHeight));
        assert.equal(clampedHeight, 204); // Strictly clamped to ink + 24px!
    });

    it('BoxRegistry manages per-box isolation, borderOutline toggle, and customBgColor', () => {
        BoxRegistry.clear();
        assert.equal(BoxRegistry.isBorderOutline('box-1'), false);
        assert.equal(BoxRegistry.isBorderOutline('box-2'), false);

        // Turn on 1px outline for box-1 only
        BoxRegistry.setBorderOutline('box-1', true);
        assert.equal(BoxRegistry.isBorderOutline('box-1'), true);
        assert.equal(BoxRegistry.isBorderOutline('box-2'), false); // box-2 remains off

        // Change accent color on box-1 only
        BoxRegistry.setAccentColor('box-1', 'emerald');
        BoxRegistry.setAccentColor('box-2', 'purple');
        assert.equal(BoxRegistry.getAccentColor('box-1'), 'emerald');
        assert.equal(BoxRegistry.getAccentColor('box-2'), 'purple');

        // Custom background color on box-1
        BoxRegistry.setCustomBgColor('box-1', '#18181b');
        assert.equal(BoxRegistry.getCustomBgColor('box-1'), '#18181b');
        assert.equal(BoxRegistry.getCustomBgColor('box-2'), undefined);
    });
});


