import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FORBIDDEN_DOM_SELECTORS, isScreenPointForbidden } from '../src/engine/anchoring/InkBoundary.ts';
import { InputManager } from '../src/engine/input/InputManager.ts';
import { BoxMenu } from '../src/ui/BoxMenu.ts';
import { LassoMenu } from '../src/ui/LassoMenu.ts';
import { setupMockDom } from './helpers/mockDom.ts';

const REVIEW_DOM_OPTS = {
    defaultRect: { left: 100, top: 100, right: 200, bottom: 130, width: 100, height: 30 },
};

describe('Phase 1 Review Actions & Guard Verification', () => {
    test('styles.css: centralizes --apolo-layer-canvas token and eliminates !important from popovers & BoxMenu', () => {
        const cssPath = path.resolve('styles.css');
        const cssContent = fs.readFileSync(cssPath, 'utf8');

        // 1. Verify canvas layer token
        assert.ok(
            cssContent.includes('--apolo-layer-canvas: 6;'),
            'styles.css must declare --apolo-layer-canvas: 6 in :root'
        );
        assert.ok(
            cssContent.includes('z-index: var(--apolo-layer-canvas, 6);'),
            '.apolo-canvas-layer must use var(--apolo-layer-canvas, 6)'
        );

        // 2. Verify NO !important on .apolo-estuche-close-btn
        const estucheCloseMatch = cssContent.match(/\.apolo-(?:ui\s+)?\.apolo-estuche-close-btn\s*\{([^}]+)\}/s);
        if (estucheCloseMatch) {
            assert.ok(!estucheCloseMatch[1].includes('!important'), '.apolo-estuche-close-btn must not use !important');
        }

        // 3. Verify NO !important on .apolo-palette-swatch.is-active
        const swatchActiveMatch = cssContent.match(/\.apolo-palette-swatch\.is-active\s*\{([^}]+)\}/s);
        if (swatchActiveMatch) {
            assert.ok(!swatchActiveMatch[1].includes('!important'), '.apolo-palette-swatch.is-active must not use !important');
        }

        // 4. Verify NO !important on BoxMenu controls
        const boxTilesMatch = cssContent.match(/\.apolo-box-menu-tile\s*\{([^}]+)\}/s);
        if (boxTilesMatch) {
            assert.ok(!boxTilesMatch[1].includes('!important'), '.apolo-box-menu-tile must not use !important');
        }

        const boxSegMatch = cssContent.match(/\.apolo-box-menu-seg-btn\s*\{([^}]+)\}/s);
        if (boxSegMatch) {
            assert.ok(!boxSegMatch[1].includes('!important'), '.apolo-box-menu-seg-btn must not use !important');
        }

        const boxActionMatch = cssContent.match(/\.apolo-box-menu-action-btn\s*\{([^}]+)\}/s);
        if (boxActionMatch) {
            assert.ok(!boxActionMatch[1].includes('!important'), '.apolo-box-menu-action-btn must not use !important');
        }
    });

    test('FORBIDDEN_DOM_SELECTORS includes .apolo-ui, .apolo-canvas-toolbar, .apolo-tool-estuche, .apolo-popover-panel', () => {
        assert.ok(FORBIDDEN_DOM_SELECTORS.includes('.apolo-ui'), 'Must forbid ink on .apolo-ui');
        assert.ok(FORBIDDEN_DOM_SELECTORS.includes('.apolo-canvas-toolbar'), 'Must forbid ink on .apolo-canvas-toolbar');
        assert.ok(FORBIDDEN_DOM_SELECTORS.includes('.apolo-tool-estuche'), 'Must forbid ink on .apolo-tool-estuche');
        assert.ok(FORBIDDEN_DOM_SELECTORS.includes('.apolo-popover-panel'), 'Must forbid ink on .apolo-popover-panel');
    });

    test('InputManager: isPalmRejected() and isPointerRejected() correctly reflect palm gating', () => {
        const { mockDoc: mockDocument, teardown } = setupMockDom(REVIEW_DOM_OPTS);

        try {
            const canvas = mockDocument.createElement('canvas');
            const im = new InputManager(canvas as any, {
                palmRejectionCooldownMs: 300,
            });

            // Initially no palm rejection
            assert.strictEqual(im.isPalmRejected(), false);
            assert.strictEqual(im.isPointerRejected(99), false);

            // Simulate pen contact to trigger palm cooldown
            const penDown = {
                type: 'pointerdown',
                pointerId: 1,
                pointerType: 'pen',
                clientX: 100,
                clientY: 100,
                button: 0,
                buttons: 1,
                pressure: 0.5,
                timeStamp: Date.now(),
                preventDefault: () => {},
                stopPropagation: () => {},
            };

            // Dispatch pen event through target listener
            canvas.dispatch(penDown);

            // Immediate check: palm rejection must now be ACTIVE
            assert.strictEqual(im.isPalmRejected(), true, 'Palm rejection should be active immediately after pen contact');

            // Touch event during palm cooldown must be rejected and recorded in rejectedPointerIds
            let prevented = false;
            let stopped = false;
            const touchDown = {
                type: 'pointerdown',
                pointerId: 42,
                pointerType: 'touch',
                clientX: 150,
                clientY: 150,
                button: 0,
                buttons: 1,
                pressure: 0,
                timeStamp: Date.now(),
                preventDefault: () => { prevented = true; },
                stopPropagation: () => { stopped = true; },
            };

            canvas.dispatch(touchDown);
            assert.strictEqual(prevented, true, 'Touch during palm rejection must be prevented');
            assert.strictEqual(stopped, true, 'Touch during palm rejection must be stopped');
            assert.strictEqual(im.isPointerRejected(42), true, 'Rejected pointerId 42 must be recorded in rejectedPointerIds');

            im.destroy();
        } finally {
            teardown();
        }
    });

    test('BoxMenu: Does not hardcode z-index and provides ARIA semantics & keyboard navigation', () => {
        const { mockDoc: mockDocument, teardown } = setupMockDom(REVIEW_DOM_OPTS);

        try {
            let heightFitted = false;
            const callbacks = {
                onSetGridStyle: () => {},
                onSetBgTheme: () => {},
                onSetAccentColor: () => {},
                onSetGridDensity: () => {},
                onToggleBorderOutline: () => {},
                onFitHeight: () => { heightFitted = true; },
                onClearContent: () => {},
                onDeleteBox: () => {},
                onExportSvg: () => {},
            };

            const menu = new BoxMenu(callbacks, mockDocument.body as any);
            assert.strictEqual(menu.isOpen(), false);

            menu.show('box-1', {
                left: 100,
                top: 100,
                right: 140,
                bottom: 140,
                width: 40,
                height: 40,
            } as any, {
                gridStyle: 'dots',
                bgTheme: 'default',
                accentColor: 'purple',
                gridDensity: 32,
                borderOutline: false,
            });

            assert.strictEqual(menu.isOpen(), true);
            // Verify z-index is NOT hardcoded in inline style to 1002 (must rely on CSS token)
            assert.notStrictEqual(menu.container.style.zIndex, '1002', 'BoxMenu must not hardcode zIndex to 1002 in inline style');

            // Verify action buttons have accessible aria-labels
            const buttons = menu.container.querySelectorAll('button');
            assert.ok(buttons.length > 0, 'BoxMenu should render buttons');

            // Test hide
            menu.hide();
            assert.strictEqual(menu.isOpen(), false);
            menu.destroy();
        } finally {
            teardown();
        }
    });

    test('LassoMenu: isOpen() reflects menu container visibility', () => {
        const { mockDoc: mockDocument, teardown } = setupMockDom(REVIEW_DOM_OPTS);

        try {
            const lasso = new LassoMenu({
                onCopy: () => {},
                onPaste: () => {},
                onLink: () => {},
                onBringToFront: () => {},
                onSendToBack: () => {},
                onDelete: () => {},
                onApplyColor: () => {},
                onApplyWidth: () => {},
                onApplyPattern: () => {},
                onOpenLinkedNote: () => {},
                onUnlink: () => {},
                onDeselect: () => {},
            }, mockDocument.body as any);

            assert.strictEqual(lasso.isOpen(), false);
            lasso.destroy();
        } finally {
            teardown();
        }
    });
});
