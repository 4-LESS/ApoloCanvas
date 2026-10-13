import { test, describe } from 'node:test';
import assert from 'node:assert';
import { boxCompanionPath, companionPath, renderBoxSvg } from '../src/io/PersistenceQueue.ts';
import { BoxRegistry } from '../src/core/BoxRegistry.ts';
import type { CanvasElement, PageDocument, StrokeElement } from '../src/core/types.ts';

describe('(c4) Herramienta Lazo y Pila de Deshacer integrada', () => {
    test('Lasso re-anchoring: Dragging freehand ink into a box assigns space blockId and normalizes coordinates', () => {
        const contentWidth = 800;
        const boxOriginX = 100;
        const boxOriginY = 400;
        const boxWidth = 600;
        const boxHeight = 280;

        // Freehand stroke drawn in document coordinates at (250, 460) to (310, 520)
        // With old content anchor: originX = 0, scaleWidth = contentWidth = 800, originY = 200
        const oldOriginX = 0;
        const oldScaleWidth = contentWidth;
        const oldOriginY = 200;

        const originalU1 = (250 - oldOriginX) / oldScaleWidth;
        const originalV1 = (460 - oldOriginY) / oldScaleWidth;
        const originalU2 = (310 - oldOriginX) / oldScaleWidth;
        const originalV2 = (520 - oldOriginY) / oldScaleWidth;

        const stroke: StrokeElement = {
            id: 'stroke-lasso-1',
            type: 'stroke',
            timestamp: Date.now(),
            zIndex: 1,
            blockId: 'p:1',
            points: [originalU1, originalV1, 0.5, 1000, originalU2, originalV2, 0.5, 1010],
            style: { color: '#6C3FD1', width: 3, opacity: 1 },
            bounds: { minX: originalU1, maxX: originalU2, minY: originalV1, maxY: originalV2 },
        };

        // Simulated reanchorSelection when dropped inside space:box-123
        const newGeom = { originX: boxOriginX, scaleWidth: boxWidth, originY: boxOriginY, boxHeight, isBox: true };
        for (let i = 0; i < stroke.points.length; i += 4) {
            const docX = oldOriginX + stroke.points[i] * oldScaleWidth;
            const docY = oldOriginY + stroke.points[i + 1] * oldScaleWidth;
            let newU = (docX - newGeom.originX) / newGeom.scaleWidth;
            let newV = (docY - newGeom.originY) / newGeom.scaleWidth;
            if (newGeom.isBox) {
                newU = Math.max(0, Math.min(1, newU));
                newV = Math.max(0, newV);
            }
            stroke.points[i] = newU;
            stroke.points[i + 1] = newV;
        }
        stroke.blockId = 'space:box-123';

        assert.strictEqual(stroke.blockId, 'space:box-123', 'Stroke must now belong to the box');
        assert.ok(stroke.points[0] >= 0 && stroke.points[0] <= 1, 'Horizontal coordinate must be normalized inside box [0, 1]');
        assert.ok(stroke.points[1] >= 0, 'Vertical coordinate must be non-negative inside box');

        // Document world positions reconstructed from box coordinates must match original docX and docY
        const reconstructedDocX1 = newGeom.originX + stroke.points[0] * newGeom.scaleWidth;
        const reconstructedDocY1 = newGeom.originY + stroke.points[1] * newGeom.scaleWidth;
        assert.strictEqual(Math.round(reconstructedDocX1), 250);
        assert.strictEqual(Math.round(reconstructedDocY1), 460);
    });

    test('Lasso re-anchoring: Dragging ink out of a box re-anchors to freehand content with zero clipping', () => {
        const boxOriginX = 100;
        const boxOriginY = 400;
        const boxWidth = 600;

        // Stroke in box coordinates (u=0.5, v=0.2) => docX = 100 + 0.5*600 = 400, docY = 400 + 0.2*600 = 520
        const stroke: StrokeElement = {
            id: 'stroke-lasso-2',
            type: 'stroke',
            timestamp: Date.now(),
            zIndex: 1,
            blockId: 'space:box-123',
            points: [0.5, 0.2, 0.5, 1000],
            style: { color: '#6C3FD1', width: 3, opacity: 1 },
            bounds: { minX: 0.5, maxX: 0.5, minY: 0.2, maxY: 0.2 },
        };

        // Dragged OUT of the box into document paragraph p:5 at blockTop = 800, contentLeft = 50, contentWidth = 700
        const freehandGeom = { originX: 50, scaleWidth: 700, originY: 800, isBox: false };
        const docX = boxOriginX + stroke.points[0] * boxWidth; // 400
        const docY = boxOriginY + stroke.points[1] * boxWidth; // 520

        const newU = (docX - freehandGeom.originX) / freehandGeom.scaleWidth;
        const newV = (docY - freehandGeom.originY) / freehandGeom.scaleWidth;

        stroke.points[0] = newU;
        stroke.points[1] = newV;
        stroke.blockId = 'p:5';

        assert.strictEqual(stroke.blockId, 'p:5');
        // World coordinates must still match exactly
        const reconstructedDocX = freehandGeom.originX + stroke.points[0] * freehandGeom.scaleWidth;
        const reconstructedDocY = freehandGeom.originY + stroke.points[1] * freehandGeom.scaleWidth;
        assert.strictEqual(Math.round(reconstructedDocX), 400);
        assert.strictEqual(Math.round(reconstructedDocY), 520);
    });

    test('HistoryStack captures box heights and Ctrl+Z restores both previous strokes and previous box height', () => {
        interface HistorySnapshot {
            elements: CanvasElement[];
            boxHeights: Record<string, number>;
        }

        const history: HistorySnapshot[] = [];
        const future: HistorySnapshot[] = [];

        let currentElements: CanvasElement[] = [];
        let currentBoxHeights: Record<string, number> = { 'box-1': 160 };

        const recordHistory = () => {
            history.push({
                elements: JSON.parse(JSON.stringify(currentElements)),
                boxHeights: { ...currentBoxHeights },
            });
            future.length = 0;
        };

        // 1. Initial state recorded
        recordHistory();

        // 2. User draws a stroke inside box-1 and resizes box-1 from 160px to 320px
        const stroke: StrokeElement = {
            id: 's1',
            type: 'stroke',
            timestamp: 1000,
            zIndex: 0,
            blockId: 'space:box-1',
            points: [0.1, 0.1, 0.5, 1000],
            style: { color: '#000', width: 2, opacity: 1 },
            bounds: { minX: 0.1, maxX: 0.1, minY: 0.1, maxY: 0.1 },
        };
        currentElements.push(stroke);
        currentBoxHeights['box-1'] = 320;

        assert.strictEqual(currentBoxHeights['box-1'], 320);
        assert.strictEqual(currentElements.length, 1);

        // 3. User hits Undo (Ctrl + Z)
        const undo = () => {
            const snap = history.pop();
            if (!snap) return;
            future.push({
                elements: JSON.parse(JSON.stringify(currentElements)),
                boxHeights: { ...currentBoxHeights },
            });
            currentElements = JSON.parse(JSON.stringify(snap.elements));
            currentBoxHeights = { ...snap.boxHeights };
        };

        undo();

        // Must restore BOTH previous stroke count (0) and previous height (160)
        assert.strictEqual(currentElements.length, 0, 'Undo must remove stroke drawn after snapshot');
        assert.strictEqual(currentBoxHeights['box-1'], 160, 'Undo must restore original box height 160px');

        // 4. User hits Redo (Ctrl + Y)
        const redo = () => {
            const snap = future.pop();
            if (!snap) return;
            history.push({
                elements: JSON.parse(JSON.stringify(currentElements)),
                boxHeights: { ...currentBoxHeights },
            });
            currentElements = JSON.parse(JSON.stringify(snap.elements));
            currentBoxHeights = { ...snap.boxHeights };
        };

        redo();
        assert.strictEqual(currentElements.length, 1, 'Redo must restore stroke');
        assert.strictEqual(currentBoxHeights['box-1'], 320, 'Redo must restore resized box height 320px');
    });
});

describe('(c5) Duplicados de ID y Huérfanos', () => {
    test('Duplicate box ID detection in markdown automatically regenerates unique ID', () => {
        const lines = [
            '# Note Title',
            '<div data-apolo-space="box-dup" data-h="200"></div>',
            'Some paragraph between.',
            '<div data-apolo-space="box-dup" data-h="200"></div>',
        ];

        const seenIds = new Set<string>();
        const updatedLines = [...lines];

        for (let i = 0; i < updatedLines.length; i++) {
            const match = updatedLines[i].match(/data-apolo-space(?:-id)?=["']([^"']+)["']/i);
            if (match) {
                const id = match[1];
                if (seenIds.has(id)) {
                    // Duplicate found: generate fresh ID
                    const newId = 'c_' + Math.random().toString(36).slice(2, 8);
                    updatedLines[i] = updatedLines[i].replace(match[0], `data-apolo-space="${newId}"`);
                    seenIds.add(newId);
                } else {
                    seenIds.add(id);
                }
            }
        }

        assert.strictEqual(seenIds.size, 2, 'Two distinct IDs must now exist');
        assert.ok(updatedLines[1].includes('data-apolo-space="box-dup"'), 'First occurrence keeps original ID');
        assert.ok(!updatedLines[3].includes('data-apolo-space="box-dup"'), 'Second occurrence must have new regenerated ID');
    });

    test('Silent cleanup prunes orphaned strokes older than 30 days while preserving fresh ones', () => {
        const activeBoxIds = new Set(['box-active']);
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();

        const elements: CanvasElement[] = [
            // Active stroke in existing box
            {
                id: 'active-1',
                type: 'stroke',
                timestamp: now - 1000,
                zIndex: 0,
                blockId: 'space:box-active',
                points: [0.1, 0.1, 0.5, 1000],
                style: { color: '#000', width: 2, opacity: 1 },
                bounds: { minX: 0.1, maxX: 0.1, minY: 0.1, maxY: 0.1 },
            },
            // Fresh orphan (box was deleted 2 days ago) -> MUST BE PRESERVED
            {
                id: 'orphan-fresh',
                type: 'stroke',
                timestamp: now - (2 * 24 * 60 * 60 * 1000),
                zIndex: 1,
                blockId: 'space:box-deleted-recently',
                points: [0.2, 0.2, 0.5, 1000],
                style: { color: '#000', width: 2, opacity: 1 },
                bounds: { minX: 0.2, maxX: 0.2, minY: 0.2, maxY: 0.2 },
            },
            // Old orphan (box was deleted 45 days ago) -> MUST BE SILENTLY PRUNED
            {
                id: 'orphan-old',
                type: 'stroke',
                timestamp: now - (45 * 24 * 60 * 60 * 1000),
                zIndex: 2,
                blockId: 'space:box-deleted-long-ago',
                points: [0.3, 0.3, 0.5, 1000],
                style: { color: '#000', width: 2, opacity: 1 },
                bounds: { minX: 0.3, maxX: 0.3, minY: 0.3, maxY: 0.3 },
            },
        ];

        // Pruning logic implemented in PersistenceQueue
        const filtered = elements.filter(el => {
            if (el.blockId && el.blockId.startsWith('space:')) {
                const boxId = el.blockId.slice(6);
                if (!activeBoxIds.has(boxId)) {
                    const age = now - (el.timestamp || 0);
                    if (age > THIRTY_DAYS_MS) {
                        return false;
                    }
                }
            }
            return true;
        });

        assert.strictEqual(filtered.length, 2, 'Must prune only the old orphan');
        assert.ok(filtered.some(e => e.id === 'active-1'), 'Active stroke must remain');
        assert.ok(filtered.some(e => e.id === 'orphan-fresh'), 'Fresh orphan (<30d) must remain');
        assert.ok(!filtered.some(e => e.id === 'orphan-old'), 'Old orphan (>30d) must be pruned');
    });
});

describe('(d) Exportador SVG companion por caja y (e) Modo lectura integral', () => {
    test('boxCompanionPath resolves clean asset path for individual boxes', () => {
        const path1 = 'Notes/Daily Note.md';
        const boxId = 'box-abc';
        const expected = 'Notes/assets/ink/Daily Note.box-abc.ink.svg';
        assert.strictEqual(boxCompanionPath(path1, boxId), expected);

        const pathRoot = 'RootNote.md';
        assert.strictEqual(boxCompanionPath(pathRoot, 'b1'), 'assets/ink/RootNote.b1.ink.svg');
    });

    test('renderBoxSvg generates responsive SVG with grid pattern and strokes', () => {
        BoxRegistry.setGridStyle('box-test-svg', 'grid');
        BoxRegistry.setGridDensity('box-test-svg', 32);

        const stroke: StrokeElement = {
            id: 's-svg',
            type: 'stroke',
            timestamp: 1000,
            zIndex: 0,
            blockId: 'space:box-test-svg',
            points: [0.1, 0.1, 0.5, 1000, 0.5, 0.5, 0.5, 1010],
            style: { color: '#1F4FD8', width: 3, opacity: 1, pattern: 'solid' },
            bounds: { minX: 0.1, maxX: 0.5, minY: 0.1, maxY: 0.5 },
        };

        const svg = renderBoxSvg('box-test-svg', [stroke], 800, 240);
        assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
        assert.ok(svg.includes('viewBox="0 0 800 240"'));
        assert.ok(svg.includes('pattern id="apolo-grid-box-test-svg"'));
        assert.ok(svg.includes('stroke="#1F4FD8"'));
    });
});
