# Apolo Canvas 2.0

Apolo Canvas adds pressure-sensitive S-Pen ink to Obsidian Markdown source and Live Preview editors. The editor gets a viewport-sized transparent wet canvas above a cached dry canvas; saved documents live in `.apolocanvas/data/`, and each note can keep a linked SVG companion for Reading view and native Obsidian graph indexing.

## Build and load

From this plugin folder run:

```sh
npm install
npm run build
```

The loadable plugin files are `main.js`, `manifest.json`, and `styles.css` in this folder. The Obsidian plugin ID is `apolo-canvas`; install these three files in `.obsidian/plugins/apolo-canvas/`, then reload Obsidian. The manifest supports desktop and mobile; no native Android module is required.

## Use

- Write with the S-Pen. Pointer samples are collected from `getCoalescedEvents`; the active line uses pressure and a 12 ms velocity preview.
- Choose Pen, Highlighter, Eraser, Lasso, Shape, Insert Space, or Link from the floating toolbar. Change color, width, profile, or dash style there.
- Use two fingers to pan and zoom when no pen stroke is active. The Grid button displays and snaps shapes to a 32 px grid. Cut switches the eraser to split intersected strokes.
- Lasso-selected ink can be duplicated, reordered, recolored, deleted, moved, or bound to a `[[note]]` link. Undo/redo are also available from the command palette.
- Toggle ink capture off to place a text caret and select note text normally. Companion SVGs and their graph links appear in Reading view.

The engine keeps a spatial hash of stroke bounds for viewport culling, writes sidecars through a debounced serialized queue, and stores the Markdown source line and text fingerprint with each element to move ink after text above it changes.

## Runtime notes

Obsidian controls the Android WebView frame scheduler and S-Pen hardware event delivery. The plugin consumes every coalesced sample available to it, but actual latency and drawer behavior should be checked on the Galaxy Tab S10 with the target Obsidian version. Line reanchoring uses the public editor text API and visible CodeMirror line layout; unusual folds and heavily wrapped blocks can make its estimated line-to-pixel shift less exact.
