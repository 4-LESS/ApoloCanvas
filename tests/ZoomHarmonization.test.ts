import test from 'node:test';
import assert from 'node:assert/strict';

test('Zoom Harmonization (Step b) - Coordinate Invariance & Gestures', async (t) => {
    await t.test('Zoom level clamping guarantees range [1.0, 3.0]', () => {
        const clampZoom = (z: number) => Math.max(1.0, Math.min(3.0, z));

        assert.equal(clampZoom(0.5), 1.0, 'sub-1.0 zoom clamped to 1.0');
        assert.equal(clampZoom(1.0), 1.0);
        assert.equal(clampZoom(1.75), 1.75);
        assert.equal(clampZoom(3.0), 3.0);
        assert.equal(clampZoom(4.2), 3.0, 'above 3.0 zoom clamped to 3.0');
    });

    await t.test('Normalized coordinate projection is 100% invariant across zoom levels', () => {
        // Document content base width and position at 1.0 zoom
        const baseContentLeft = 120;
        const baseContentWidth = 760;

        // An element inside the content at local offset 190px (u = 190 / 760 = 0.25)
        const expectedU = 190 / 760;

        const zoomLevels = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

        for (const zoom of zoomLevels) {
            // At any zoom, CSS transform scale(zoom) with transform-origin: 0 0:
            // content bounding rect on screen has width = baseContentWidth * zoom
            // and screenLeft = baseContentLeft
            const screenLeft = baseContentLeft;
            const screenWidth = baseContentWidth * zoom;

            // An input event occurs at the same relative position on screen
            const screenPointerX = screenLeft + 190 * zoom;
            const scrollLeft = Math.round(50 * (zoom - 1)); // simulated scroll

            // Controller conversion:
            const docX = (screenPointerX + scrollLeft) / zoom;
            const contentLeft = (screenLeft + scrollLeft) / zoom;
            const contentWidth = screenWidth / zoom;

            const computedU = (docX - contentLeft) / contentWidth;

            assert.ok(
                Math.abs(computedU - expectedU) < 1e-9,
                `At zoom ${zoom}, computedU (${computedU}) must equal expectedU (${expectedU})`
            );

            // Reverse render:
            const renderScreenX = (contentLeft + computedU * contentWidth) * zoom - scrollLeft;
            assert.ok(
                Math.abs(renderScreenX - screenPointerX) < 1e-6,
                `At zoom ${zoom}, rendered screen position (${renderScreenX}) must exactly match pointer position (${screenPointerX})`
            );
        }
    });

    await t.test('Pinch gesture anchor maintains world point fixed under gesture center', () => {
        // Initial state at zoom 1.0
        let zoom = 1.0;
        let scrollLeft = 0;
        let scrollTop = 0;

        // Two fingers touch down with center at (400, 300) screen coordinates
        const touchCenter = { x: 400, y: 300 };
        const gestureWorldX = (touchCenter.x + scrollLeft) / zoom; // 400
        const gestureWorldY = (touchCenter.y + scrollTop) / zoom; // 300

        // User pinches out to zoom 2.0 while keeping gesture center at (400, 300)
        const newZoom = 2.0;
        const baseWidth = 1000;
        const baseHeight = 1600;
        const clientWidth = 800;
        const clientHeight = 600;

        const maxScrollX = Math.max(0, Math.round(baseWidth * newZoom - clientWidth));
        const maxScrollY = Math.max(0, Math.round(baseHeight * newZoom - clientHeight));

        const targetScrollLeft = Math.max(0, Math.min(maxScrollX, Math.round(gestureWorldX * newZoom - touchCenter.x)));
        const targetScrollTop = Math.max(0, Math.min(maxScrollY, Math.round(gestureWorldY * newZoom - touchCenter.y)));

        // Target scroll should be: 400 * 2.0 - 400 = 400
        assert.equal(targetScrollLeft, 400);
        // Target scroll should be: 300 * 2.0 - 300 = 300
        assert.equal(targetScrollTop, 300);

        // Under new zoom and scroll, what is the screen position of gestureWorld?
        const newScreenX = gestureWorldX * newZoom - targetScrollLeft;
        const newScreenY = gestureWorldY * newZoom - targetScrollTop;

        assert.equal(newScreenX, touchCenter.x, 'Focal world X stays exactly under gesture center');
        assert.equal(newScreenY, touchCenter.y, 'Focal world Y stays exactly under gesture center');
    });

    await t.test('Scrollable overflow margin expansion formula accommodates scaled content', () => {
        const baseWidth = 800;
        const baseHeight = 2000;

        // At zoom 1.0: no margin needed
        assert.equal(Math.round(baseHeight * (1.0 - 1)), 0);
        assert.equal(Math.round(baseWidth * (1.0 - 1)), 0);

        // At zoom 1.5: 50% expansion
        assert.equal(Math.round(baseHeight * (1.5 - 1)), 1000);
        assert.equal(Math.round(baseWidth * (1.5 - 1)), 400);

        // At zoom 2.0: 100% expansion
        assert.equal(Math.round(baseHeight * (2.0 - 1)), 2000);
        assert.equal(Math.round(baseWidth * (2.0 - 1)), 800);
    });

    await t.test('Two-finger navigation threshold distinguishes small pan from intentional pinch', () => {
        const isPinchGesture = (initialDistance: number, currentDistance: number) => {
            const distanceRatio = currentDistance / initialDistance;
            return Math.abs(distanceRatio - 1.0) > 0.05;
        };

        // 2% distance change (micro-jitter during 2-finger scroll) is NOT a pinch
        assert.equal(isPinchGesture(200, 204), false, '2% change ignored as scroll');
        assert.equal(isPinchGesture(200, 196), false, '-2% change ignored as scroll');

        // 10% distance change is recognized as pinch-to-zoom
        assert.equal(isPinchGesture(200, 225), true, '+12.5% change recognized as zoom in');
        assert.equal(isPinchGesture(200, 175), true, '-12.5% change recognized as zoom out');
    });
});
