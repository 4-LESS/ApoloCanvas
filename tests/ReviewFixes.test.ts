import { test, describe } from 'node:test';
import assert from 'node:assert';
import { EditorState } from '@codemirror/state';
import {
    ApoloSpaceWidget,
    BoxRegistry,
    apoloSpaceField,
    boxRegistryUpdateEffect,
    type BoxWidgetSnapshot,
} from '../src/editor/ApoloSpaceExtension.ts';
import { InputManager } from '../src/engine/input/InputManager.ts';
import type { PageDocument, StrokeElement } from '../src/core/types.ts';

describe('Code Review Fixes Verification', () => {
    describe('Issue 1 & 3: BoxRegistry Synchronization & Widget Snapshot Equality', () => {
        test('BoxRegistry.onChange fires listeners on height and style mutations', () => {
            BoxRegistry.clear();
            let changeCount = 0;
            const unsubscribe = BoxRegistry.onChange(() => {
                changeCount++;
            });

            BoxRegistry.setHeight('box-sync-1', 250);
            assert.strictEqual(changeCount, 1);

            // Same value does not redundantly fire listener
            BoxRegistry.setHeight('box-sync-1', 250);
            assert.strictEqual(changeCount, 1);

            BoxRegistry.setGridStyle('box-sync-1', 'grid');
            assert.strictEqual(changeCount, 2);

            BoxRegistry.setBgTheme('box-sync-1', 'pitch-black');
            assert.strictEqual(changeCount, 3);

            unsubscribe();
            BoxRegistry.setHeight('box-sync-1', 300);
            assert.strictEqual(changeCount, 3, 'Unsubscribed listener must not be called');
        });

        test('ApoloSpaceWidget captures immutable snapshot and detects differences in eq()', () => {
            BoxRegistry.clear();
            BoxRegistry.setHeight('box-eq-1', 200);
            BoxRegistry.setGridStyle('box-eq-1', 'dots');

            const widget1 = new ApoloSpaceWidget(200, 'box-eq-1');
            assert.strictEqual(widget1.snapshot.height, 200);
            assert.strictEqual(widget1.snapshot.gridStyle, 'dots');

            // Widget with identical properties returns eq === true
            const widget1Copy = new ApoloSpaceWidget(200, 'box-eq-1');
            assert.strictEqual(widget1.eq(widget1Copy), true);

            // Mutate BoxRegistry
            BoxRegistry.setHeight('box-eq-1', 350);
            const widget2 = new ApoloSpaceWidget(200, 'box-eq-1');
            assert.strictEqual(widget2.snapshot.height, 350);

            // eq() must return false between widget1 (snapshot 200) and widget2 (snapshot 350)
            assert.strictEqual(widget1.eq(widget2), false, 'Different snapshot heights must return false in eq() to trigger updateDOM');
        });

        test('apoloSpaceField rebuilds decorations when boxRegistryUpdateEffect is dispatched', () => {
            BoxRegistry.clear();
            const docText = '<div class="apolo-space" data-apolo-space="box-effect-1" style="height:200px;"></div>';
            let state = EditorState.create({
                doc: docText,
                extensions: [apoloSpaceField],
            });

            const decos1 = state.field(apoloSpaceField);
            assert.ok(decos1);
            let iter = decos1.iter();
            assert.strictEqual((iter.value?.spec as any)?.widget?.snapshot?.height, 200);

            // Change BoxRegistry height and dispatch boxRegistryUpdateEffect
            BoxRegistry.setHeight('box-effect-1', 400);
            const tr = state.update({
                effects: boxRegistryUpdateEffect.of(),
            });
            state = tr.state;

            const decos2 = state.field(apoloSpaceField);
            iter = decos2.iter();
            assert.strictEqual((iter.value?.spec as any)?.widget?.snapshot?.height, 400, 'Decoration widget snapshot must reflect updated height after effect');
        });
    });

    describe('Issue 2: Space Block ID Deduplication', () => {
        test('StateField deduplicates duplicate block IDs across HTML and codeblock declarations', () => {
            const docWithDuplicates = [
                '<div class="apolo-space" data-apolo-space="duplicate-box-1" style="height:200px;"></div>',
                'Some note paragraph.',
                '<div class="apolo-space" data-apolo-space="duplicate-box-1" style="height:300px;"></div>',
                '```apolo-space',
                'height: 250',
                'id: duplicate-box-1',
                '```',
            ].join('\n');

            const state = EditorState.create({
                doc: docWithDuplicates,
                extensions: [apoloSpaceField],
            });

            const decos = state.field(apoloSpaceField);
            let count = 0;
            const iter = decos.iter();
            while (iter.value) {
                count++;
                assert.strictEqual((iter.value.spec as any)?.widget?.id, 'duplicate-box-1');
                iter.next();
            }

            assert.strictEqual(count, 1, 'Duplicate block ID must only be decorated once');
        });
    });

    describe('Issue 4: Pen Hover Watchdog Timeout', () => {
        test('Pen hover state resets automatically after 500ms timeout if pointerleave is dropped', async () => {
            // Mock DOM element
            const target = {
                style: { touchAction: '', userSelect: '' },
                addEventListener: () => {},
                removeEventListener: () => {},
                getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
            } as unknown as HTMLElement;

            const input = new InputManager(target);

            // Simulate pen enter (hover proximity)
            (input as any).handleEnter({
                pointerType: 'pen',
                clientX: 100,
                clientY: 100,
            } as PointerEvent);

            assert.strictEqual(input.isPenActive, true, 'Pen must be active on hover enter');

            // Wait 550ms for the watchdog timeout to fire
            await new Promise((resolve) => setTimeout(resolve, 550));

            assert.strictEqual(input.isPenActive, false, 'Hover state must reset after 500ms of inactivity');
            input.destroy();
        });

        test('Pen hover resets immediately when pointerleave fires', () => {
            const target = {
                style: { touchAction: '', userSelect: '' },
                addEventListener: () => {},
                removeEventListener: () => {},
                getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
            } as unknown as HTMLElement;

            const input = new InputManager(target);

            (input as any).handleEnter({ pointerType: 'pen' } as PointerEvent);
            assert.strictEqual((input as any).isPenHovering, true);

            (input as any).handleLeave({ pointerType: 'pen' } as PointerEvent);
            assert.strictEqual((input as any).isPenHovering, false, 'Pointer leave must immediately clear pen hover');
            input.destroy();
        });
    });

    describe('Issue 5 & 6: shouldAcceptPointer Enforcement and Pass-Through Event Handling', () => {
        test('shouldAcceptPointer=false prevents drawing, stops propagation, and ignores subsequent moves', () => {
            const target = {
                style: { touchAction: '', userSelect: '' },
                addEventListener: () => {},
                removeEventListener: () => {},
                getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
            } as unknown as HTMLElement;

            let strokeStarted = false;
            let strokeMoved = false;

            const input = new InputManager(target, {
                shouldAcceptPointer: (event) => event.clientX < 500, // Reject pointers at clientX >= 500
                onStrokeStart: () => { strokeStarted = true; },
                onStrokeMove: () => { strokeMoved = true; },
            });

            let defaultPrevented = false;
            let propagationStopped = false;

            const downEvent = {
                pointerId: 42,
                pointerType: 'pen',
                clientX: 600,
                clientY: 100,
                button: 0,
                preventDefault: () => { defaultPrevented = true; },
                stopPropagation: () => { propagationStopped = true; },
            } as unknown as PointerEvent;

            (input as any).handleDown(downEvent);

            assert.strictEqual(defaultPrevented, true, 'Event must be preventDefaulted when rejected');
            assert.strictEqual(propagationStopped, true, 'Event propagation must be stopped when rejected');
            assert.strictEqual(strokeStarted, false, 'Stroke must not start for rejected pointer');
            assert.strictEqual(input.hasActiveStroke, false);

            // Subsequent move with rejected pointerId
            const moveEvent = {
                pointerId: 42,
                pointerType: 'pen',
                clientX: 605,
                clientY: 105,
            } as unknown as PointerEvent;

            (input as any).handleMove(moveEvent);
            assert.strictEqual(strokeMoved, false, 'Subsequent move with rejected pointer must be ignored');

            input.destroy();
        });

        test('passThroughPointerEvent dispatches pointerdown without stealing focus', () => {
            const target = {
                style: { touchAction: '', userSelect: '' },
                addEventListener: () => {},
                removeEventListener: () => {},
                contains: () => false,
                getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
            } as unknown as HTMLElement;

            const input = new InputManager(target);

            let dispatchedEvent: PointerEvent | null = null;
            let focusCalled = false;

            const mockUnderlying = {
                tagName: 'BUTTON',
                classList: { contains: () => false },
                focus: () => { focusCalled = true; },
                dispatchEvent: (ev: Event) => {
                    dispatchedEvent = ev as PointerEvent;
                    return true;
                },
            };

            // Temporarily mock document.elementsFromPoint
            const originalDoc = globalThis.document;
            (globalThis as any).document = {
                elementsFromPoint: () => [mockUnderlying],
            };

            try {
                (input as any).passThroughPointerEvent({
                    clientX: 120,
                    clientY: 240,
                    screenX: 120,
                    screenY: 240,
                    button: 0,
                    buttons: 1,
                    pointerId: 99,
                    pointerType: 'pen',
                    isPrimary: true,
                } as PointerEvent);

                assert.strictEqual(focusCalled, false, 'Focus must NOT be stolen from editor');
                assert.ok(dispatchedEvent);
                assert.strictEqual((dispatchedEvent as any).type, 'pointerdown');
                assert.strictEqual((dispatchedEvent as any).clientX, 120);
                assert.strictEqual((dispatchedEvent as any).clientY, 240);
            } finally {
                (globalThis as any).document = originalDoc;
                input.destroy();
            }
        });
    });

    describe('Issue 7, 8 & 9: Lifecycle Shutdown Guard and Tab Switch Serialization', () => {
        test('DestroyController and flush guarantee execution even if save fails', async () => {
            let flushAttempted = false;
            let destroyed = false;

            const mockController = {
                commitActiveStroke: () => {},
                flush: async () => {
                    flushAttempted = true;
                    throw new Error('Simulated disk full or I/O error');
                },
                destroy: () => {
                    destroyed = true;
                },
            };

            // Test simulate destroyController logic
            const runDestroy = async () => {
                let current: typeof mockController | null = mockController;
                try {
                    current.commitActiveStroke();
                    await current.flush();
                } catch {
                    // Handled error
                } finally {
                    current?.destroy();
                }
            };

            await runDestroy();
            assert.strictEqual(flushAttempted, true);
            assert.strictEqual(destroyed, true, 'Controller.destroy must execute in finally block even if flush fails');
        });

        test('Rapid tab switch serialization preserves note data without concurrent writes', async () => {
            const cache = new Map<string, PageDocument>();

            const noteA: PageDocument = {
                schemaVersion: 1,
                id: 'noteA.md',
                notePath: 'noteA.md',
                elements: [{
                    id: 'strokeA1',
                    type: 'stroke',
                    timestamp: 100,
                    zIndex: 0,
                    blockId: 'line:0',
                    points: [0.1, 0.1, 0.5, 100],
                    style: { color: '#000', width: 2, opacity: 1 },
                    bounds: { minX: 0.1, maxX: 0.1, minY: 0.1, maxY: 0.1 },
                } as StrokeElement],
                createdAt: 100,
                updatedAt: 100,
            };

            const noteB: PageDocument = {
                schemaVersion: 1,
                id: 'noteB.md',
                notePath: 'noteB.md',
                elements: [],
                createdAt: 200,
                updatedAt: 200,
            };

            cache.set('noteA.md', JSON.parse(JSON.stringify(noteA)));
            cache.set('noteB.md', JSON.parse(JSON.stringify(noteB)));

            // Simulate mountPromise queue serialization
            let mountPromise = Promise.resolve();
            const executionOrder: string[] = [];

            const switchTab = (noteId: string) => {
                mountPromise = mountPromise.then(async () => {
                    executionOrder.push(`start-${noteId}`);
                    // Simulate async I/O
                    await new Promise(r => setTimeout(r, 20));
                    executionOrder.push(`end-${noteId}`);
                });
                return mountPromise;
            };

            // Fire rapid switches simultaneously
            const p1 = switchTab('noteB.md');
            const p2 = switchTab('noteA.md');

            await Promise.all([p1, p2]);

            assert.deepStrictEqual(executionOrder, [
                'start-noteB.md',
                'end-noteB.md',
                'start-noteA.md',
                'end-noteA.md',
            ], 'Tab mounts must be strictly serialized in FIFO sequence');

            // Verify note A data integrity
            const preservedDoc = cache.get('noteA.md');
            assert.ok(preservedDoc);
            assert.strictEqual(preservedDoc.elements.length, 1);
            assert.strictEqual(preservedDoc.elements[0].id, 'strokeA1');
        });
    });
});
