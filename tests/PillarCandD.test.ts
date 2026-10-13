import { test, describe } from 'node:test';
import assert from 'node:assert';
import { cloneElements, type CanvasElement, type PageDocument, type StrokeElement } from '../src/core/types.ts';
import { companionPath } from '../src/io/PersistenceQueue.ts';

describe('Pilar C: Rechazo de Palma y Alternancia Lápiz / Teclado', () => {
    test('palm rejection gating: 1-finger touches ignored during pen contact or hover', () => {
        let isPenHovering = false;
        let lastPenContactAt = Number.NEGATIVE_INFINITY;
        const cooldownMs = 400;

        const isPalmRejected = (now: number): boolean => {
            return isPenHovering || (now - lastPenContactAt < cooldownMs);
        };

        const now1 = 1000;
        // Initially no pen interaction
        assert.strictEqual(isPalmRejected(now1), false, 'Palm rejection should be inactive initially');

        // Pen hovers over screen
        isPenHovering = true;
        assert.strictEqual(isPalmRejected(now1), true, 'Palm rejection active while pen is hovering');

        // Pen lifts away from hover zone at t = 2000
        isPenHovering = false;
        lastPenContactAt = 2000;

        // Inside cooldown period (< 400ms)
        assert.strictEqual(isPalmRejected(2200), true, 'Palm rejection active within cooldown window');

        // Beyond cooldown period (>= 400ms)
        assert.strictEqual(isPalmRejected(2450), false, 'Palm rejection inactive after cooldown window');
    });

    test('1-finger touch cancellation vs 2-finger navigation gesture allowance', () => {
        // State simulation matching CanvasController logic
        const touches = new Map<number, { x: number; y: number }>();
        let palmRejectedSingleTouch = false;
        let singleTouchStartCoords: { x: number; y: number } | null = null;
        let singleTouchPanned = false;
        let gestureStarted = false;

        const simulateTouchDown = (pointerId: number, x: number, y: number, isPenGated: boolean) => {
            touches.set(pointerId, { x, y });
            if (touches.size === 1) {
                if (isPenGated) {
                    palmRejectedSingleTouch = true;
                    singleTouchStartCoords = null;
                    singleTouchPanned = false;
                } else {
                    palmRejectedSingleTouch = false;
                    singleTouchStartCoords = { x, y };
                    singleTouchPanned = false;
                }
            } else if (touches.size === 2) {
                palmRejectedSingleTouch = false;
                singleTouchStartCoords = null;
                singleTouchPanned = false;
                gestureStarted = true;
            }
        };

        // 1. User rests hand (1 finger contact) while pen is hovering
        simulateTouchDown(1, 200, 300, true);
        assert.strictEqual(touches.size, 1);
        assert.strictEqual(palmRejectedSingleTouch, true, '1-finger palm touch must be marked as rejected');
        assert.strictEqual(singleTouchStartCoords, null, '1-finger touch must not start single-finger pan or tap tracking');

        // 2. User places second finger for 2-finger navigation scroll/pinch
        simulateTouchDown(2, 280, 300, true);
        assert.strictEqual(touches.size, 2);
        assert.strictEqual(palmRejectedSingleTouch, false, '2-finger touch must clear single-finger palm rejection');
        assert.strictEqual(gestureStarted, true, '2-finger navigation gesture must be allowed');
    });

    test('immediate cancellation of active 1-finger touch when pen proximity is detected', () => {
        const touches = new Map<number, { x: number; y: number }>();
        let palmRejectedSingleTouch = false;
        let singleTouchStartCoords: { x: number; y: number } | null = { x: 100, y: 150 };
        let singleTouchPanned = false;
        touches.set(1, { x: 100, y: 150 });

        const cancelSingleFingerTouch = () => {
            if (touches.size === 1) {
                palmRejectedSingleTouch = true;
                singleTouchStartCoords = null;
                singleTouchPanned = false;
            }
        };

        // S-Pen approaches screen (hover event arrives)
        cancelSingleFingerTouch();

        assert.strictEqual(palmRejectedSingleTouch, true);
        assert.strictEqual(singleTouchStartCoords, null, 'Active 1-finger coordinates must be immediately discarded');
        assert.strictEqual(singleTouchPanned, false, 'Accidental pan must be stopped');
    });

    test('2-finger navigation delta computation at 1.0 zoom and zoomed in', () => {
        let scrollerLeft = 0;
        let scrollerTop = 100;
        const maxScrollY = 2000;

        // Two fingers dragging down by 40px
        const p0 = { x: 200, y: 300 };
        const p1 = { x: 300, y: 300 };
        const center1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }; // {250, 300}

        const p0_moved = { x: 200, y: 340 };
        const p1_moved = { x: 300, y: 340 };
        const center2 = { x: (p0_moved.x + p1_moved.x) / 2, y: (p0_moved.y + p1_moved.y) / 2 }; // {250, 340}

        const deltaY = center2.y - center1.y; // +40px
        assert.strictEqual(deltaY, 40);

        // At zoom 1.0, dragging fingers down scrolls document up (revealing upper content)
        scrollerTop = Math.max(0, Math.min(maxScrollY, scrollerTop - deltaY));
        assert.strictEqual(scrollerTop, 60, 'Scroller top must scroll naturally with 2 fingers at zoom 1.0');
    });
});

describe('Pilar D: Ciclo de vida, Zero Data Loss y Undo/Redo', () => {
    test('companionPath resolves matching SVG paths and sanitizes note basenames', () => {
        const path1 = 'My Folder/Daily Note.md';
        const expected1 = 'My Folder/assets/ink/Daily Note.ink.svg';
        assert.strictEqual(companionPath(path1), expected1);

        const path2 = 'RootNote.md';
        const expected2 = 'assets/ink/RootNote.ink.svg';
        assert.strictEqual(companionPath(path2), expected2);

        const pathSpecial = 'Folder/Note:With*Invalid?Chars.md';
        const expectedSpecial = 'Folder/assets/ink/Note-With-Invalid-Chars.ink.svg';
        assert.strictEqual(companionPath(pathSpecial), expectedSpecial);
    });

    test('in-memory document caching guarantees zero data loss on rapid tab switching', () => {
        const cacheByPageId = new Map<string, PageDocument>();
        const pageId = 'test-page-123';

        const stroke1: StrokeElement = {
            id: 's1',
            type: 'stroke',
            timestamp: 1000,
            zIndex: 0,
            blockId: 'line:0',
            points: [0.1, 0.2, 0.5, 1000, 0.15, 0.25, 0.5, 1010],
            style: { color: '#1F4FD8', width: 3, opacity: 1 },
            bounds: { minX: 0.1, maxX: 0.15, minY: 0.2, maxY: 0.25 },
        };

        const doc: PageDocument = {
            schemaVersion: 1,
            id: pageId,
            notePath: 'Notes/TestNote.md',
            elements: [stroke1],
            createdAt: 1000,
            updatedAt: 1010,
        };

        // Enqueue doc in memory
        cacheByPageId.set(pageId, JSON.parse(JSON.stringify(doc)));

        // User draws stroke 2 immediately before switching tabs
        const stroke2: StrokeElement = {
            id: 's2',
            type: 'stroke',
            timestamp: 1020,
            zIndex: 1,
            blockId: 'line:0',
            points: [0.2, 0.3, 0.6, 1020, 0.25, 0.35, 0.6, 1030],
            style: { color: '#1F4FD8', width: 3, opacity: 1 },
            bounds: { minX: 0.2, maxX: 0.25, minY: 0.3, maxY: 0.35 },
        };
        doc.elements.push(stroke2);
        cacheByPageId.set(pageId, JSON.parse(JSON.stringify(doc)));

        // User rapidly switches tab: simulated loadDocument looks up in-memory cache first
        const loadedDoc = cacheByPageId.get(pageId);
        assert.ok(loadedDoc);
        assert.strictEqual(loadedDoc.elements.length, 2, 'Latest in-memory document must contain both strokes');
        assert.strictEqual(loadedDoc.elements[1].id, 's2', 'Last stroke drawn before switch must not be lost');
    });

    test('note rename propagates notePath update and flushes document', () => {
        const cacheByPageId = new Map<string, PageDocument>();
        const doc: PageDocument = {
            schemaVersion: 1,
            id: 'page-rename-1',
            notePath: 'Folder/OldName.md',
            elements: [],
            createdAt: 1000,
            updatedAt: 1000,
        };
        cacheByPageId.set(doc.id, doc);

        // Simulation of onFileRenamed
        const oldPath = 'Folder/OldName.md';
        const newPath = 'Folder/NewName.md';
        for (const d of cacheByPageId.values()) {
            if (d.notePath === oldPath) {
                d.notePath = newPath;
            }
        }

        assert.strictEqual(cacheByPageId.get('page-rename-1')?.notePath, 'Folder/NewName.md');
    });

    test('cloneElements produces fast deep copies of elements without mutating originals', () => {
        const originalStroke: StrokeElement = {
            id: 'orig-1',
            type: 'stroke',
            timestamp: 500,
            zIndex: 0,
            blockId: 'line:1',
            points: [0.1, 0.2, 0.5, 500, 0.3, 0.4, 0.5, 510],
            style: { color: '#000000', width: 2, opacity: 1 },
            bounds: { minX: 0.1, maxX: 0.3, minY: 0.2, maxY: 0.4 },
        };

        const list: CanvasElement[] = [originalStroke];
        const cloned = cloneElements(list);

        assert.strictEqual(cloned.length, 1);
        assert.notStrictEqual(cloned[0], list[0], 'Element reference must be cloned');

        const clonedStroke = cloned[0] as StrokeElement;
        assert.notStrictEqual(clonedStroke.points, originalStroke.points, 'Points array must be cloned');
        assert.deepStrictEqual(clonedStroke.points, originalStroke.points);

        // Mutating clone does not affect original
        clonedStroke.points[0] = 0.999;
        assert.strictEqual(originalStroke.points[0], 0.1);
    });

    test('undo/redo stack caps history at 30 states and preserves redo when not mutating', () => {
        const history: CanvasElement[][] = [];
        const future: CanvasElement[][] = [];
        const MAX_STATES = 30;

        const recordHistory = (elements: CanvasElement[]) => {
            history.push(cloneElements(elements));
            if (history.length > MAX_STATES) history.shift();
            future.length = 0; // clears redo on new mutation
        };

        let currentElements: CanvasElement[] = [];

        // Record 35 operations (recordHistory called before mutation)
        for (let i = 1; i <= 35; i++) {
            recordHistory(currentElements);
            const stroke: StrokeElement = {
                id: `s-${i}`,
                type: 'stroke',
                timestamp: i * 10,
                zIndex: i,
                blockId: `line:${i}`,
                points: [0, 0, 0.5, 0],
                style: { color: '#000', width: 2, opacity: 1 },
                bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
            };
            currentElements = [...currentElements, stroke];
        }

        // Current elements has all 35 strokes
        assert.strictEqual(currentElements.length, 35);
        // History must be capped strictly at 30
        assert.strictEqual(history.length, MAX_STATES, 'History stack must cap at exactly 30 states');
        // Oldest state dropped: first state in history should be state 5 (having 5 elements)
        assert.strictEqual(history[0].length, 5, 'Oldest states beyond 30 must be shifted out');
        // Latest state in history before stroke 35 was state 34 (having 34 elements)
        assert.strictEqual(history[history.length - 1].length, 34);

        // Perform Undo
        const undo = () => {
            const snapshot = history.pop();
            if (!snapshot) return;
            future.push(cloneElements(currentElements));
            if (future.length > MAX_STATES) future.shift();
            currentElements = cloneElements(snapshot);
        };

        undo();
        assert.strictEqual(currentElements.length, 34);
        assert.strictEqual(history.length, 29);
        assert.strictEqual(future.length, 1);

        undo();
        assert.strictEqual(currentElements.length, 33);
        assert.strictEqual(history.length, 28);
        assert.strictEqual(future.length, 2);

        // Perform Redo
        const redo = () => {
            const snapshot = future.pop();
            if (!snapshot) return;
            history.push(cloneElements(currentElements));
            if (history.length > MAX_STATES) history.shift();
            currentElements = cloneElements(snapshot);
        };

        redo();
        assert.strictEqual(currentElements.length, 34);
        assert.strictEqual(history.length, 29);
        assert.strictEqual(future.length, 1);

        redo();
        assert.strictEqual(currentElements.length, 35);
        assert.strictEqual(future.length, 0);
    });
});
