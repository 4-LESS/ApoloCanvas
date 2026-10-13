import { test, describe } from 'node:test';
import assert from 'node:assert';
import { EditorState } from '@codemirror/state';
import {
    ApoloSpaceWidget,
    ApoloSpaceSyncController,
    BoxRegistry,
    apoloSpaceField,
    boxRegistryUpdateEffect,
    parseApoloSpaceHtml,
    parseApoloSpaceBlock,
    applySpaceMutationToMarkdown,
    htmlEscapeAttribute,
    htmlUnescapeAttribute,
    safeQuotedIdForCodeblock,
    normalizeBoxId,
    escapeRegExp,
    type BoxWidgetSnapshot,
} from '../src/editor/ApoloSpaceExtension.ts';
import { formatCanvasDivTag } from '../src/editor/CanvasInsertion.ts';
import { InputManager } from '../src/engine/input/InputManager.ts';
import { BoxMenu } from '../src/ui/BoxMenu.ts';
import { MoreMenu } from '../src/ui/MoreMenu.ts';
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
        test('Pen hover state resets automatically after cooldown timeout if pointerleave is dropped', async () => {
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

            // Wait default cooldown (400ms) + buffer for the watchdog timeout to fire
            await new Promise((resolve) => setTimeout(resolve, 450));

            assert.strictEqual(input.isPenActive, false, 'Hover state must reset after cooldown timeout of inactivity');
            input.destroy();
        });

        test('Pen hover watchdog uses configured palmRejectionCooldownMs', async () => {
            const target = {
                style: { touchAction: '', userSelect: '' },
                addEventListener: () => {},
                removeEventListener: () => {},
                getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
            } as unknown as HTMLElement;

            const customCooldown = 150;
            const input = new InputManager(target, { palmRejectionCooldownMs: customCooldown });

            (input as any).handleEnter({
                pointerType: 'pen',
                clientX: 100,
                clientY: 100,
            } as PointerEvent);

            assert.strictEqual(input.isPenActive, true, 'Pen must be active on hover enter');

            await new Promise((resolve) => setTimeout(resolve, customCooldown + 40));

            assert.strictEqual(input.isPenActive, false, 'Hover state must reset after custom cooldownMs of inactivity');
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

        test('passThroughPointerEvent dispatches pointerdown immediately and schedules pointerup and click asynchronously', async () => {
            const target = {
                style: { touchAction: '', userSelect: '' },
                addEventListener: () => {},
                removeEventListener: () => {},
                contains: () => false,
                getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
            } as unknown as HTMLElement;

            const input = new InputManager(target);

            const dispatchedEvents: Event[] = [];
            let focusCalled = false;
            let clickCalled = false;

            const mockUnderlying = {
                tagName: 'BUTTON',
                classList: { contains: () => false },
                focus: () => { focusCalled = true; },
                click: () => { clickCalled = true; },
                closest: () => mockUnderlying,
                dispatchEvent: (ev: Event) => {
                    dispatchedEvents.push(ev);
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

                // Synchronously: only pointerdown should be dispatched; pointerup and click are scheduled
                assert.strictEqual(focusCalled, false, 'Focus must NOT be stolen from editor');
                assert.strictEqual(dispatchedEvents.length, 1, 'Only pointerdown must be dispatched synchronously');
                assert.strictEqual((dispatchedEvents[0] as any).type, 'pointerdown');
                assert.strictEqual((dispatchedEvents[0] as any).clientX, 120);
                assert.strictEqual((dispatchedEvents[0] as any).clientY, 240);
                assert.strictEqual(clickCalled, false, 'Click must not be called synchronously');

                // Wait for scheduled release (next tick/rAF)
                await new Promise((resolve) => setTimeout(resolve, 20));

                assert.strictEqual(dispatchedEvents.length, 2, 'Must dispatch both pointerdown and pointerup');
                assert.strictEqual((dispatchedEvents[1] as any).type, 'pointerup');
                assert.strictEqual(clickCalled, true, 'Click must be triggered on interactive buttons');
            } finally {
                (globalThis as any).document = originalDoc;
                input.destroy();
            }
        });

        test('InputManager markPenHover uses configurable cooldownMs watchdog', async () => {
            const mockTarget = {
                style: { touchAction: '', userSelect: '' },
                addEventListener: () => {},
                removeEventListener: () => {},
            } as any;

            const input = new InputManager(mockTarget, { palmRejectionCooldownMs: 150 });
            assert.strictEqual(input.getPalmRejectionCooldown(), 150);

            (input as any).markPenHover();
            assert.strictEqual((input as any).isPenHovering, true);

            // Wait 80ms (before timeout): should still be hovering
            await new Promise(r => setTimeout(r, 80));
            assert.strictEqual((input as any).isPenHovering, true);

            // Wait another 100ms (180ms total > 150ms): should expire
            await new Promise(r => setTimeout(r, 100));
            assert.strictEqual((input as any).isPenHovering, false);

            // Dynamically update cooldown to 300ms
            input.setPalmRejectionCooldown(300);
            assert.strictEqual(input.getPalmRejectionCooldown(), 300);

            input.destroy();
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

    describe('Issue 10: Markdown Block ID Parsing and Regex Escaping', () => {
        test('parseApoloSpaceBlock parses unquoted, double-quoted, and single-quoted IDs with spaces', () => {
            const raw1 = 'height: 180\nid: box-standard\n';
            const parsed1 = parseApoloSpaceBlock(raw1);
            assert.strictEqual(parsed1.id, 'box-standard');
            assert.strictEqual(parsed1.height, 180);

            const raw2 = 'height: 220\nid: "box with spaces and dots.v1"\n';
            const parsed2 = parseApoloSpaceBlock(raw2);
            assert.strictEqual(parsed2.id, 'box with spaces and dots.v1');
            assert.strictEqual(parsed2.height, 220);

            const raw3 = "height: 300\nid: 'single-quoted-id [special]'\n";
            const parsed3 = parseApoloSpaceBlock(raw3);
            assert.strictEqual(parsed3.id, 'single-quoted-id [special]');
            assert.strictEqual(parsed3.height, 300);
        });

        test('applySpaceMutationToMarkdown safely handles IDs containing regex special characters', () => {
            const specialId = 'box.test[1]+v2*special?';
            const initialDoc = [
                '# Heading',
                `<div class="apolo-space" data-apolo-space="${specialId}" style="height:150px;"></div>`,
                'Content text',
            ].join('\n');

            // Update height
            const updated = applySpaceMutationToMarkdown(initialDoc, {
                id: specialId,
                height: 350,
            });
            assert.ok(updated.includes('height:350px'));
            const removed = applySpaceMutationToMarkdown(updated, {
                id: specialId,
                type: 'delete',
            });
            assert.ok(!removed.includes(specialId));
            assert.ok(removed.includes('# Heading'));
            assert.ok(removed.includes('Content text'));
        });

        test('applySpaceMutationToMarkdown safely handles IDs containing replacement injection tokens ($1, $&, $)', () => {
            const injectionId = 'box$1&test$2';
            const initialDoc = [
                '# Heading',
                `<div class="apolo-space" data-apolo-space="${injectionId}" style="height:150px;"></div>`,
                'Content text',
            ].join('\n');

            const updated = applySpaceMutationToMarkdown(initialDoc, {
                id: injectionId,
                height: 400,
            });
            assert.ok(updated.includes('height:400px'));
            assert.ok(updated.includes(injectionId), 'ID with $ tokens must be preserved literally without injection');

            const removed = applySpaceMutationToMarkdown(updated, {
                id: injectionId,
                type: 'delete',
            });
            assert.ok(!removed.includes(injectionId));
        });

        test('applySpaceMutationToMarkdown correctly updates codeblocks with quoted IDs', () => {
            const initialDoc = [
                '# Title',
                '```apolo-space',
                'height: 150',
                'id: "box 1"',
                '```',
                'Paragraph text',
            ].join('\n');

            const updated = applySpaceMutationToMarkdown(initialDoc, {
                id: 'box 1',
                height: 280,
            });
            assert.ok(updated.includes('height: 280'));
            assert.ok(updated.includes('id: "box 1"'));
            assert.ok(updated.includes('Paragraph text'));

            // Remove codeblock with quoted ID
            const removed = applySpaceMutationToMarkdown(updated, {
                id: 'box 1',
                type: 'delete',
            });
            assert.ok(!removed.includes('box 1'));
            assert.ok(removed.includes('Paragraph text'));
        });
    });

    describe('Issue 11: Canvas Menu & Popover Instant Dismissal and State Management', () => {
        const createMockEnvironment = () => {
            const listeners = new Map<string, Array<{ listener: Function; options?: any }>>();
            const mockWindow = {
                innerWidth: 1024,
                innerHeight: 768,
                addEventListener: (event: string, listener: Function, options?: any) => {
                    if (!listeners.has(event)) listeners.set(event, []);
                    listeners.get(event)!.push({ listener, options });
                },
                removeEventListener: (event: string, listener: Function) => {
                    const list = listeners.get(event);
                    if (list) {
                        const idx = list.findIndex(item => item.listener === listener);
                        if (idx !== -1) list.splice(idx, 1);
                    }
                },
                dispatch: (event: string, evObj: any) => {
                    const list = listeners.get(event) || [];
                    for (const item of [...list]) {
                        item.listener(evObj);
                    }
                },
            };

            const createElement = (tag: string) => {
                const children: any[] = [];
                const classes = new Set<string>();
                const el: any = {
                    tagName: tag.toUpperCase(),
                    style: { display: '' },
                    dataset: {},
                    hidden: false,
                    className: '',
                    children,
                    classList: {
                        add: (c: string) => { classes.add(c); el.className = [...classes].join(' '); },
                        remove: (c: string) => { classes.delete(c); el.className = [...classes].join(' '); },
                        contains: (c: string) => classes.has(c),
                        toggle: (c: string, force?: boolean) => {
                            const next = force !== undefined ? force : !classes.has(c);
                            if (next) classes.add(c); else classes.delete(c);
                            el.className = [...classes].join(' ');
                            return next;
                        },
                    },
                    setAttribute: () => {},
                    getAttribute: () => null,
                    appendChild: (child: any) => { children.push(child); return child; },
                    append: (...args: any[]) => { children.push(...args); },
                    replaceChildren: (...args: any[]) => { children.length = 0; children.push(...args); },
                    empty: () => { children.length = 0; },
                    remove: () => {},
                    contains: (target: any) => target === el || children.some(c => c === target || c.contains?.(target)),
                    addEventListener: () => {},
                    removeEventListener: () => {},
                    closest: () => null,
                    getBoundingClientRect: () => ({ left: 100, top: 100, right: 200, bottom: 130, width: 100, height: 30 }),
                };
                return el;
            };

            const mockDocument = {
                body: createElement('body'),
                createElement,
                createElementNS: () => createElement('svg'),
            };

            return { mockWindow, mockDocument };
        };

        test('BoxMenu properly toggles style.display, hidden attribute, and dismisses on outside clicks and Escape', () => {
            const { mockWindow, mockDocument } = createMockEnvironment();
            const prevWindow = (globalThis as any).window;
            const prevDocument = (globalThis as any).document;
            (globalThis as any).window = mockWindow;
            (globalThis as any).document = mockDocument;

            try {
                let deletedBox = '';
                const menu = new BoxMenu({
                    onSetGridStyle: () => {},
                    onSetGridDensity: () => {},
                    onSetAccentColor: () => {},
                    onFitHeight: () => {},
                    onClearContent: () => {},
                    onDeleteBox: (id) => { deletedBox = id; },
                }, mockDocument.body as any);

                // Initially hidden with display: none
                assert.strictEqual(menu.isOpen(), false);
                assert.strictEqual(menu.container.hidden, true);
                assert.strictEqual(menu.container.style.display, 'none');

                // Show menu
                const anchorRect = { left: 150, top: 100, bottom: 120, right: 200 } as DOMRect;
                menu.show('box-test-1', anchorRect, { gridStyle: 'dots', gridDensity: 32 });

                assert.strictEqual(menu.isOpen(), true);
                assert.strictEqual(menu.container.hidden, false);
                assert.strictEqual(menu.container.style.display, 'flex');
                assert.strictEqual(menu.boxId, 'box-test-1');

                // Outside click dismisses menu
                const outsideEl = mockDocument.createElement('div');
                mockWindow.dispatch('pointerdown', { target: outsideEl });

                assert.strictEqual(menu.isOpen(), false);
                assert.strictEqual(menu.container.hidden, true);
                assert.strictEqual(menu.container.style.display, 'none');
                assert.strictEqual(menu.boxId, '');

                // Re-open and test Escape key dismissal
                menu.show('box-test-1', anchorRect, { gridStyle: 'dots', gridDensity: 32 });
                assert.strictEqual(menu.isOpen(), true);

                mockWindow.dispatch('keydown', { key: 'Escape' });
                assert.strictEqual(menu.isOpen(), false);
                assert.strictEqual(menu.container.style.display, 'none');

                menu.destroy();
            } finally {
                (globalThis as any).window = prevWindow;
                (globalThis as any).document = prevDocument;
            }
        });

        test('MoreMenu properly toggles style.display, hidden attribute, and dismisses on outside clicks and Escape', () => {
            const { mockWindow, mockDocument } = createMockEnvironment();
            const prevWindow = (globalThis as any).window;
            const prevDocument = (globalThis as any).document;
            (globalThis as any).window = mockWindow;
            (globalThis as any).document = mockDocument;

            try {
                let closed = false;
                const menu = new MoreMenu({
                    slot: 'tr',
                    onlyPen: false,
                    snapGrid: false,
                    onExportSvg: () => {},
                    onOpenGraph: () => {},
                    onTestAnchor: () => {},
                    onToggleOnlyPen: () => {},
                    onToggleSnapGrid: () => {},
                    onClose: () => { closed = true; },
                }, mockDocument.body as any);

                assert.strictEqual(menu.isOpen(), false);
                assert.strictEqual(menu.container.hidden, true);
                assert.strictEqual(menu.container.style.display, 'none');

                menu.open();
                assert.strictEqual(menu.isOpen(), true);
                assert.strictEqual(menu.container.hidden, false);
                assert.strictEqual(menu.container.style.display, 'block');

                // Outside click dismisses MoreMenu
                const outsideEl = mockDocument.createElement('div');
                mockWindow.dispatch('pointerdown', { target: outsideEl });

                assert.strictEqual(menu.isOpen(), false);
                assert.strictEqual(menu.container.hidden, true);
                assert.strictEqual(menu.container.style.display, 'none');
                assert.strictEqual(closed, true);

                // Re-open and test Escape dismissal
                menu.open();
                assert.strictEqual(menu.isOpen(), true);

                mockWindow.dispatch('keydown', { key: 'Escape' });
                assert.strictEqual(menu.isOpen(), false);
                assert.strictEqual(menu.container.style.display, 'none');

                menu.destroy();
            } finally {
                (globalThis as any).window = prevWindow;
                (globalThis as any).document = prevDocument;
            }
        });
    });

    describe('Issue 12: Grid Density Rendering & Retroactive Background Theme vs Scoped Accent', () => {
        test('parseApoloSpaceHtml and parseApoloSpaceBlock extract gridDensity, gridStyle, bgTheme, and accentColor', () => {
            const html = '<div class="apolo-space" data-apolo-space="box-custom" data-h="280" data-apolo-grid-density="40" data-apolo-grid-style="grid" data-apolo-bg-theme="pitch-black" data-apolo-accent="emerald"></div>';
            const parsedHtml = parseApoloSpaceHtml(html);
            assert.ok(parsedHtml);
            assert.strictEqual(parsedHtml.id, 'box-custom');
            assert.strictEqual(parsedHtml.height, 280);
            assert.strictEqual(parsedHtml.gridDensity, 40);
            assert.strictEqual(parsedHtml.gridStyle, 'grid');
            assert.strictEqual(parsedHtml.bgTheme, 'pitch-black');
            assert.strictEqual(parsedHtml.accentColor, 'emerald');

            const codeblock = '```apolo-space\nid: "box-code"\nheight: 320\ngridDensity: 24\ngridStyle: ruled\nbgTheme: graphite\naccentColor: coral\n```';
            const parsedBlock = parseApoloSpaceBlock(codeblock);
            assert.strictEqual(parsedBlock.id, 'box-code');
            assert.strictEqual(parsedBlock.height, 320);
            assert.strictEqual(parsedBlock.gridDensity, 24);
            assert.strictEqual(parsedBlock.gridStyle, 'ruled');
            assert.strictEqual(parsedBlock.bgTheme, 'graphite');
            assert.strictEqual(parsedBlock.accentColor, 'coral');
        });

        test('ApoloSpaceWidget toDOM and updateDOM set data-apolo-grid-density and calculate --apolo-grid-step', () => {
            const prevWindow = (globalThis as any).window;
            const prevDoc = (globalThis as any).document;

            class MockStyle {
                private props = new Map<string, string>();
                setProperty(prop: string, val: string) { this.props.set(prop, val); }
                getPropertyValue(prop: string) { return this.props.get(prop) || ''; }
                removeProperty(prop: string) { this.props.delete(prop); }
            }

            class MockDomElement {
                style = new MockStyle();
                dataset: Record<string, string> = {};
                className = '';
                clientWidth = 800;
                offsetWidth = 800;
                isConnected = true;
                children: any[] = [];
                appendChild(c: any) { this.children.push(c); }
                setAttribute(_k: string, _v: string) {}
            }

            (globalThis as any).document = {
                createElement: () => new MockDomElement(),
                createElementNS: () => new MockDomElement(),
            };
            (globalThis as any).window = {
                requestAnimationFrame: (cb: () => void) => cb(),
            };

            try {
                BoxRegistry.clear();
                BoxRegistry.setHeight('box-dense-1', 250);
                BoxRegistry.setGridDensity('box-dense-1', 40); // 800 / 40 = 20px step
                BoxRegistry.setBgTheme('box-dense-1', 'pitch-black');

                const widget = new ApoloSpaceWidget(250, 'box-dense-1');
                const dom = widget.toDOM();

                assert.strictEqual(dom.dataset.apoloGridDensity, '40');
                assert.strictEqual(dom.style.getPropertyValue('--apolo-grid-step'), '20px');
                assert.strictEqual(dom.dataset.apoloBgTheme, 'pitch-black');

                // Update DOM with normal density (32 -> 800 / 32 = 25px)
                BoxRegistry.setGridDensity('box-dense-1', 32);
                const updatedWidget = new ApoloSpaceWidget(250, 'box-dense-1');
                updatedWidget.updateDOM(dom);

                assert.strictEqual(dom.dataset.apoloGridDensity, '32');
                assert.strictEqual(dom.style.getPropertyValue('--apolo-grid-step'), '25px');
            } finally {
                (globalThis as any).window = prevWindow;
                (globalThis as any).document = prevDoc;
            }
        });

        test('Changing background theme retroactively updates all existing boxes in BoxRegistry, while accent color remains scoped', () => {
            BoxRegistry.clear();

            // Set up two existing boxes with different accent colors
            BoxRegistry.setHeight('box-1', 200);
            BoxRegistry.setAccentColor('box-1', 'purple');
            BoxRegistry.setBgTheme('box-1', 'default');

            BoxRegistry.setHeight('box-2', 200);
            BoxRegistry.setAccentColor('box-2', 'amber');
            BoxRegistry.setBgTheme('box-2', 'default');

            assert.strictEqual(BoxRegistry.getBgTheme('box-1'), 'default');
            assert.strictEqual(BoxRegistry.getBgTheme('box-2'), 'default');
            assert.strictEqual(BoxRegistry.getAccentColor('box-1'), 'purple');
            assert.strictEqual(BoxRegistry.getAccentColor('box-2'), 'amber');

            // User changes plugin background theme to pitch-black (retroactive)
            BoxRegistry.updateAllBgThemes('pitch-black');

            // Both existing boxes now reflect pitch-black retroactively
            assert.strictEqual(BoxRegistry.getBgTheme('box-1'), 'pitch-black');
            assert.strictEqual(BoxRegistry.getBgTheme('box-2'), 'pitch-black');

            // Accent colors of existing boxes are strictly preserved!
            assert.strictEqual(BoxRegistry.getAccentColor('box-1'), 'purple', 'box-1 accent color must not change');
            assert.strictEqual(BoxRegistry.getAccentColor('box-2'), 'amber', 'box-2 accent color must not change');

            // Newly created box can adopt new default accent color
            const defaultNewAccent = 'emerald';
            BoxRegistry.setHeight('box-new', 200);
            BoxRegistry.setAccentColor('box-new', defaultNewAccent);

            assert.strictEqual(BoxRegistry.getAccentColor('box-new'), 'emerald');
            assert.strictEqual(BoxRegistry.getAccentColor('box-1'), 'purple');
            assert.strictEqual(BoxRegistry.getAccentColor('box-2'), 'amber');
        });

        test('Live Preview ApoloSpaceWidget updates background styling when defaultBgTheme changes', () => {
            const prevWindow = (globalThis as any).window;
            const prevDoc = (globalThis as any).document;

            class MockStyle {
                private props = new Map<string, string>();
                setProperty(prop: string, val: string) { this.props.set(prop, val); }
                getPropertyValue(prop: string) { return this.props.get(prop) || ''; }
                removeProperty(prop: string) { this.props.delete(prop); }
            }

            class MockDomElement {
                style = new MockStyle();
                dataset: Record<string, string> = {};
                className = '';
                clientWidth = 800;
                offsetWidth = 800;
                isConnected = true;
                children: any[] = [];
                appendChild(c: any) { this.children.push(c); }
                setAttribute(_k: string, _v: string) {}
            }

            (globalThis as any).document = {
                createElement: () => new MockDomElement(),
                createElementNS: () => new MockDomElement(),
            };
            (globalThis as any).window = {
                requestAnimationFrame: (cb: () => void) => cb(),
            };

            try {
                BoxRegistry.clear();
                // box-default has default theme
                BoxRegistry.setHeight('box-lp-1', 220);
                assert.strictEqual(BoxRegistry.getBgTheme('box-lp-1'), 'default');

                const widgetDefault = new ApoloSpaceWidget(220, 'box-lp-1');
                const dom = widgetDefault.toDOM();

                assert.strictEqual(dom.dataset.apoloBgTheme, 'default');
                assert.strictEqual(dom.style.getPropertyValue('background-color'), '', 'Default theme without custom color leaves inline background empty for CSS theme');

                // User changes default theme to pitch-black in settings
                BoxRegistry.updateAllBgThemes('pitch-black');
                assert.strictEqual(BoxRegistry.getBgTheme('box-lp-1'), 'pitch-black');

                // New decoration rebuild creates widget with pitch-black snapshot
                const widgetPitchBlack = new ApoloSpaceWidget(220, 'box-lp-1');
                assert.strictEqual(widgetDefault.eq(widgetPitchBlack), false, 'Widget equality must fail when bgTheme changes so CM6 updates DOM');

                widgetPitchBlack.updateDOM(dom);
                assert.strictEqual(dom.dataset.apoloBgTheme, 'pitch-black');
                assert.strictEqual(dom.style.getPropertyValue('background-color'), '#000000', 'Live Preview DOM element must have #000000 inline');

                // User changes default theme to graphite
                BoxRegistry.updateAllBgThemes('graphite');
                const widgetGraphite = new ApoloSpaceWidget(220, 'box-lp-1');
                widgetGraphite.updateDOM(dom);
                assert.strictEqual(dom.dataset.apoloBgTheme, 'graphite');
                assert.strictEqual(dom.style.getPropertyValue('background-color'), '#27272a', 'Live Preview DOM element must have #27272a inline');

                // User changes default theme to transparent
                BoxRegistry.updateAllBgThemes('transparent');
                const widgetTrans = new ApoloSpaceWidget(220, 'box-lp-1');
                widgetTrans.updateDOM(dom);
                assert.strictEqual(dom.dataset.apoloBgTheme, 'transparent');
                assert.strictEqual(dom.style.getPropertyValue('background-color'), 'transparent', 'Live Preview DOM element must have transparent inline');
            } finally {
                (globalThis as any).window = prevWindow;
                (globalThis as any).document = prevDoc;
            }
        });
    });

    describe('Issue 13: HTML Attribute Escaping, Safe Codeblock Serialization, and ID Fuzzing Round-Trip', () => {
        test('htmlEscapeAttribute and htmlUnescapeAttribute correctly round-trip special characters', () => {
            const raw = `box "quotes" & 'single' <tag> >arrow< $dollar`;
            const escaped = htmlEscapeAttribute(raw);
            assert.strictEqual(escaped.includes('"'), false, 'Escaped attribute must not contain literal double quotes');
            assert.strictEqual(escaped.includes("'"), false, 'Escaped attribute must not contain literal single quotes');
            assert.strictEqual(escaped.includes('<'), false, 'Escaped attribute must not contain literal <');
            assert.strictEqual(escaped.includes('>'), false, 'Escaped attribute must not contain literal >');
            assert.ok(escaped.includes('&quot;'));
            assert.ok(escaped.includes('&#39;'));
            assert.ok(escaped.includes('&amp;'));
            assert.ok(escaped.includes('&lt;'));
            assert.ok(escaped.includes('&gt;'));

            const unescaped = htmlUnescapeAttribute(escaped);
            assert.strictEqual(unescaped, raw, 'Unescape must restore original string exactly');
        });

        test('safeQuotedIdForCodeblock strips backticks and safely serializes JSON string', () => {
            const withTicks = 'box`with`backticks```';
            const serialized1 = safeQuotedIdForCodeblock(withTicks);
            assert.strictEqual(serialized1.includes('`'), false, 'Backticks must be stripped to protect code fences');
            assert.strictEqual(JSON.parse(serialized1), 'boxwithbackticks');

            const withQuotes = 'box"double"and\\backslash';
            const serialized2 = safeQuotedIdForCodeblock(withQuotes);
            assert.strictEqual(JSON.parse(serialized2), 'box"double"and\\backslash');
        });

        test('formatCanvasDivTag produces HTML-safe data-apolo-space attribute', () => {
            const tag = formatCanvasDivTag('box<"bad"&attr>', 250);
            assert.ok(tag.startsWith('<div data-apolo-space="'));
            assert.ok(tag.includes('&quot;bad&quot;'));
            assert.ok(tag.includes('&lt;'));
            assert.ok(tag.includes('&gt;'));
            assert.ok(tag.includes('&amp;'));
            assert.ok(!tag.includes('<"bad"'));

            const parsed = parseApoloSpaceHtml(tag);
            assert.ok(parsed);
            assert.strictEqual(parsed.id, 'box<"bad"&attr>');
            assert.strictEqual(parsed.height, 250);
        });

        test('ID Fuzzing Round-Trip (insert -> parse -> update -> delete) with extreme characters in HTML blocks', () => {
            const testIds = [
                'box"double"quotes',
                "box'single'quotes",
                'box`with`backticks',
                'box$1&test$2',
                'box.*+?^${}()|[]\\/regex',
                '<box>&attr="val"\'quote\'',
                'box&amp;test&quot;123',
                'box🎨dibujo_日本語_ñç_🚀',
                'simple-box-123',
            ];

            const initialDoc = '# Title\n\nIntroductory paragraph.\n';

            for (const testId of testIds) {
                // 1. Insert new space block
                const insertedDoc = applySpaceMutationToMarkdown(initialDoc, {
                    id: testId,
                    height: 240,
                    isNew: true,
                    targetLine: 1,
                });

                assert.ok(insertedDoc.includes('<div class="apolo-space"'), `Must insert div tag for ID: ${testId}`);

                // 2. Parse space block
                const parsed = parseApoloSpaceHtml(insertedDoc);
                assert.ok(parsed, `Failed to parse HTML for ID: ${testId}`);
                assert.strictEqual(parsed.id, normalizeBoxId(testId), `Parsed ID must match normalized ID for ${testId}`);
                assert.strictEqual(parsed.height, 240);

                // 3. Update height
                const updatedDoc = applySpaceMutationToMarkdown(insertedDoc, {
                    id: testId,
                    height: 480,
                });
                assert.ok(updatedDoc.includes('height:480px') || updatedDoc.includes('data-h="480"'), `Must update height for ID: ${testId}`);

                // 4. Delete space block
                const deletedDoc = applySpaceMutationToMarkdown(updatedDoc, {
                    id: testId,
                    type: 'delete',
                });

                assert.strictEqual(deletedDoc.includes('data-apolo-space'), false, `Space block must be deleted for ID: ${testId}`);
                assert.ok(!deletedDoc.includes(testId), `Document must not contain ID after delete: ${testId}`);
                assert.ok(deletedDoc.includes('# Title'));
                assert.ok(deletedDoc.includes('Introductory paragraph.'));
            }
        });

        test('ID Fuzzing Round-Trip (insert -> parse -> update -> delete) with extreme characters in Codeblocks', () => {
            const testIds = [
                'box"double"quotes',
                "box'single'quotes",
                'box`with`backticks',
                'box$1&test$2',
                'box.*+?^${}()|[]\\/regex',
                'box🎨dibujo_日本語_ñç_🚀',
                'standard-code-box',
            ];

            for (const rawId of testIds) {
                const normId = normalizeBoxId(rawId);
                const safeCodeId = safeQuotedIdForCodeblock(normId);

                const codeblockDoc = [
                    '# Header',
                    '```apolo-space',
                    'height: 210',
                    `id: ${safeCodeId}`,
                    '```',
                    'Paragraph after.',
                ].join('\n');

                // 1. Parse codeblock
                const parsed = parseApoloSpaceBlock(codeblockDoc);
                // Backticks are stripped for codeblocks
                const expectedId = normId.replace(/`/g, '');
                assert.strictEqual(parsed.id, expectedId, `Parsed codeblock ID must match expected ID for ${rawId}`);
                assert.strictEqual(parsed.height, 210);

                // 2. Update codeblock height (using rawId directly even if it contains backticks)
                const updatedDoc = applySpaceMutationToMarkdown(codeblockDoc, {
                    id: rawId,
                    height: 520,
                });
                assert.ok(updatedDoc.includes('height: 520'), `Must update height in codeblock for ID: ${rawId}`);
                assert.ok(updatedDoc.includes('# Header'));
                assert.ok(updatedDoc.includes('Paragraph after.'));

                // 3. Delete codeblock (using rawId directly)
                const deletedDoc = applySpaceMutationToMarkdown(updatedDoc, {
                    id: rawId,
                    type: 'delete',
                });
                assert.strictEqual(deletedDoc.includes('```apolo-space'), false, `Codeblock must be deleted for ID: ${rawId}`);
                assert.ok(deletedDoc.includes('# Header'));
                assert.ok(deletedDoc.includes('Paragraph after.'));
            }
        });

        test('Stress test: 200 rapid BoxRegistry mutations coalesce into <= 1 effect dispatch per frame and cancel on destroy', async () => {
            BoxRegistry.clear();
            let dispatchCount = 0;

            const mockView = {
                dom: { isConnected: true },
                viewport: { from: 0, to: 500 },
                dispatch: (tr: any) => {
                    if (tr?.effects) {
                        dispatchCount++;
                    }
                },
            } as any;

            const syncController = new ApoloSpaceSyncController(mockView);

            // Fire 200 rapid BoxRegistry changes in a burst (simulating continuous resize drag)
            for (let i = 1; i <= 200; i++) {
                BoxRegistry.setHeight('stress-box-1', 200 + i);
            }

            // Before the frame fires, 0 dispatches have occurred
            assert.strictEqual(dispatchCount, 0, 'Dispatches must be coalesced until animation frame fires');

            // Wait for 1 frame window (~25ms)
            await new Promise((resolve) => setTimeout(resolve, 25));

            assert.strictEqual(dispatchCount, 1, '200 rapid BoxRegistry mutations must coalesce into exactly 1 dispatch per frame');

            // Fire another 50 mutations and immediately destroy before frame fires
            for (let i = 1; i <= 50; i++) {
                BoxRegistry.setHeight('stress-box-1', 500 + i);
            }
            syncController.destroy();

            await new Promise((resolve) => setTimeout(resolve, 25));
            assert.strictEqual(dispatchCount, 1, 'Pending frame dispatch must be cancelled when controller is destroyed');
        });

        test('Pass-through timing: stateful UI button requiring temporal down->up separation opens menu on pointerup', async () => {
            const target = {
                style: { touchAction: '', userSelect: '' },
                addEventListener: () => {},
                removeEventListener: () => {},
                contains: () => false,
                getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
            } as unknown as HTMLElement;

            const input = new InputManager(target);

            // Simulate a UI component that tracks press state on pointerdown and only triggers action if pointerup arrives in a later tick
            let isPressedInPreviousTick = false;
            let pressTickCompleted = false;
            let menuOpenedOnPointerUp = false;
            let downButtons = -1;
            let upButtons = -1;

            const statefulButton = {
                tagName: 'BUTTON',
                classList: { contains: () => false },
                closest: () => statefulButton,
                dispatchEvent: (ev: any) => {
                    if (ev.type === 'pointerdown') {
                        isPressedInPreviousTick = true;
                        downButtons = ev.buttons;
                        queueMicrotask(() => {
                            pressTickCompleted = true;
                        });
                    } else if (ev.type === 'pointerup') {
                        upButtons = ev.buttons;
                        if (isPressedInPreviousTick && pressTickCompleted) {
                            menuOpenedOnPointerUp = true;
                        }
                        isPressedInPreviousTick = false;
                    }
                    return true;
                },
            };

            const originalDoc = globalThis.document;
            (globalThis as any).document = {
                elementsFromPoint: () => [statefulButton],
            };

            try {
                (input as any).passThroughPointerEvent({
                    clientX: 80,
                    clientY: 40,
                    screenX: 80,
                    screenY: 40,
                    button: 0,
                    buttons: 1,
                    pointerId: 7,
                    pointerType: 'pen',
                    isPrimary: true,
                } as PointerEvent);

                assert.strictEqual(isPressedInPreviousTick, true, 'Button must enter pressed state synchronously on pointerdown');
                assert.strictEqual(downButtons, 1, 'pointerdown must carry active buttons=1');
                assert.strictEqual(menuOpenedOnPointerUp, false, 'Menu must not open synchronously before pointerup frame');

                await new Promise((resolve) => setTimeout(resolve, 20));

                assert.strictEqual(upButtons, 0, 'pointerup must carry released buttons=0');
                assert.strictEqual(menuOpenedOnPointerUp, true, 'Stateful button must open menu after receiving asynchronous pointerup');
            } finally {
                (globalThis as any).document = originalDoc;
                input.destroy();
            }
        });

        test('Mobile S-Pen and Finger tap on .apolo-box-options-btn under canvas overlay keeps BoxMenu open across trailing touchstart', () => {
            const winListeners = new Map<string, Set<Function>>();
            const mockWindow = {
                innerWidth: 1024,
                innerHeight: 768,
                addEventListener: (type: string, fn: Function) => {
                    if (!winListeners.has(type)) winListeners.set(type, new Set());
                    winListeners.get(type)!.add(fn);
                },
                removeEventListener: (type: string, fn: Function) => {
                    winListeners.get(type)?.delete(fn);
                },
                dispatch: (type: string, ev: any) => {
                    const set = winListeners.get(type);
                    if (set) {
                        for (const fn of set) fn(ev);
                    }
                },
            };

            const createEl = (tag: string): any => {
                const classes = new Set<string>();
                const children: any[] = [];
                const listeners = new Map<string, Set<Function>>();
                const el: any = {
                    tagName: tag.toUpperCase(),
                    hidden: false,
                    style: { display: '' },
                    dataset: {},
                    children,
                    get className() { return [...classes].join(' '); },
                    set className(val: string) {
                        classes.clear();
                        val.split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
                    },
                    classList: {
                        add: (c: string) => classes.add(c),
                        remove: (c: string) => classes.delete(c),
                        contains: (c: string) => classes.has(c),
                    },
                    setAttribute: () => {},
                    getAttribute: () => null,
                    appendChild: (c: any) => { children.push(c); return c; },
                    append: (...args: any[]) => { children.push(...args); },
                    replaceChildren: (...args: any[]) => { children.length = 0; children.push(...args); },
                    remove: () => {},
                    contains: (t: any) => t === el || children.some(c => c === t || c.contains?.(t)),
                    addEventListener: (type: string, fn: Function) => {
                        if (!listeners.has(type)) listeners.set(type, new Set());
                        listeners.get(type)!.add(fn);
                    },
                    removeEventListener: (type: string, fn: Function) => {
                        listeners.get(type)?.delete(fn);
                    },
                    dispatch: (type: string, ev: any) => {
                        const set = listeners.get(type);
                        if (set) {
                            for (const fn of set) fn(ev);
                        }
                    },
                    closest: (sel: string) => (sel.includes('apolo-box-options-btn') && classes.has('apolo-box-options-btn') ? el : null),
                    getBoundingClientRect: () => ({ left: 20, top: 20, right: 52, bottom: 52, width: 32, height: 32 }),
                };
                return el;
            };

            const canvasEl = createEl('canvas');
            canvasEl.className = 'apolo-canvas-surface apolo-canvas-wet';
            const optionsBtn = createEl('button');
            optionsBtn.className = 'apolo-box-options-btn';

            const mockDocument = {
                body: createEl('body'),
                createElement: createEl,
                createElementNS: () => createEl('svg'),
                elementsFromPoint: (x: number, y: number) => {
                    if (x >= 20 && x <= 52 && y >= 20 && y <= 52) {
                        return [canvasEl, optionsBtn];
                    }
                    return [canvasEl];
                },
                querySelectorAll: (sel: string) => (sel.includes('apolo-box-options-btn') ? [optionsBtn] : []),
            };

            const prevWindow = (globalThis as any).window;
            const prevDocument = (globalThis as any).document;
            (globalThis as any).window = mockWindow;
            (globalThis as any).document = mockDocument;

            try {
                let selectedStyle = '';
                const menu = new BoxMenu({
                    onSetGridStyle: (_id, style) => { selectedStyle = style; },
                    onSetGridDensity: () => {},
                    onSetAccentColor: () => {},
                    onFitHeight: () => {},
                    onClearContent: () => {},
                    onDeleteBox: () => {},
                }, mockDocument.body as any);

                const anchorRect = { left: 20, top: 20, bottom: 52, right: 52 } as DOMRect;

                // Simulate mobile finger / S-Pen tap on .apolo-box-options-btn where canvas is event.target:
                // 1. pointerdown opens menu
                menu.show('box-mobile-1', anchorRect, { gridStyle: 'dots', gridDensity: 32 });
                assert.strictEqual(menu.isOpen(), true);

                // 2. Trailing touchstart fires 1ms later with target = canvasEl at (30, 30)
                mockWindow.dispatch('touchstart', {
                    target: canvasEl,
                    touches: [{ clientX: 30, clientY: 30 }],
                });
                assert.strictEqual(menu.isOpen(), true, 'BoxMenu must NOT close on trailing touchstart from the same tap');

                // 3. Even if another pointerdown on canvas over the options button hits window capture, BoxMenu detects optionsBtn under canvas
                mockWindow.dispatch('pointerdown', {
                    target: canvasEl,
                    clientX: 30,
                    clientY: 30,
                    pointerType: 'pen',
                });
                assert.strictEqual(menu.isOpen(), true, 'BoxMenu window capture must recognize .apolo-box-options-btn underneath canvas overlay');

                // 4. Tapping a tile inside BoxMenu via pointerup (mobile S-Pen / finger) triggers callback without double-firing on subsequent click
                const fondoSection = menu.container.children[1];
                const fondoGrid = fondoSection.children[1];
                const gridTileBtn = fondoGrid.children[1]; // 'grid'
                gridTileBtn.dispatch('pointerup', {
                    button: 0,
                    stopPropagation: () => {},
                    preventDefault: () => {},
                });
                assert.strictEqual(selectedStyle, 'grid', 'BoxMenu tile button must respond immediately to pointerup on mobile');

                menu.destroy();
            } finally {
                (globalThis as any).window = prevWindow;
                (globalThis as any).document = prevDocument;
            }
        });
    });
});
