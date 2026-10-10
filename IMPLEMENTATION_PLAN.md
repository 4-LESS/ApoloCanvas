# Rebuild Master Plan: Apolo Canvas 2.0 (From Scratch)
## "Draw Anywhere, Link Everything" — High-Performance Engineering Engine

---

## Executive Architectural Summary

We are rebuilding the plugin from the ground up to support **heavy engineering usage** on the **Samsung Galaxy Tab S10** (120Hz S-Pen digitizer, Android WebView), structured around three non-negotiable rules:
1. **The Motor (No React)**: Raw TypeScript + HTML5 Canvas 2D double-buffered renderer with zero-allocation `Float32Array` buffers, spatial R-Tree culling, and 120Hz/240Hz `getCoalescedEvents()` sampling.
2. **The UI (Preact / React)**: Lightweight declarative shell for the dockable toolbar, pencil case, color swatch manager, and floating lasso selection menu.
3. **The Philosophy ("Draw Anywhere, Link Everything")**: Freeform inking anywhere across notes, smart block-level anchoring to prevent text-drift, bidirectional Obsidian Knowledge Graph linking (`metadataCache`), and companion SVG generation for graceful deactivation.

---

## User Review Required

> [!IMPORTANT]
> **Key Decisions to Lock Before Phase 1:**
> 1. **Rebuild Directory / Clean Slate**: Because this is a complete rewrite from scratch, we will develop cleanly in a dedicated directory structure, deprecating the legacy codebase.
> 2. **Preact vs. React**: Confirming the use of **Preact** (`preact/compat`) to keep the mobile runtime bundle under 250KB total while maintaining full React JSX/Hooks syntax.
> 3. **Non-blocking Async Persistence**: Saving will be decoupled from the note lifecycle into an independent background worker queue, guaranteeing zero data loss when switching notes rapidly.

---

## Phased Implementation Roadmap

```
+---------------------------------------------------------------------------------------------------+
|                                  INCREMENTAL REBUILD PHASES                                       |
+---------------------------------------------------------------------------------------------------+
| Phase 0: Project Scaffolding & Contract Interfaces                                                |
| Phase 1: 120Hz S-Pen Input Loop & Focus Guard (Tab S10 Hardware Foundation)                       |
| Phase 2: Double-Buffered Motor & Spatial R-Tree (Culling 10,000+ Engineering Strokes)             |
| Phase 3: Smart Block Anchoring & CodeMirror 6 Editor Synchronization                              |
| Phase 4: Resilient Async Persistence & Companion SVG Generator (Zero-JS Deactivation)               |
| Phase 5: Knowledge Graph Integration (Stroke Linking, Graph View & Backlinks)                    |
| Phase 6: Engineering Toolset (Profiles, Reticle Eraser, Scribble-to-Erase, Hold-to-Snap, Grid)      |
| Phase 7: Preact UI Shell (Dockable Toolbar, Pencil Case, Swatch Manager, Selection Menu)          |
+---------------------------------------------------------------------------------------------------+
```

---

### Phase 0: Project Scaffolding & Core Architecture Contracts
*Goal: Set up the clean green-field structure, build pipeline, and bridge contracts.*

1. **Build Tooling & Dependencies**:
   - `esbuild` pipeline configured with TypeScript + Preact JSX aliasing (`preact/compat`).
   - Core lightweight utilities: Spatial R-Tree library (`flatbush` or `rbush`), geometric vector helpers.
2. **Directory Structure**:
   ```
   src/
   ├── core/           # Data contracts, interfaces, serialization schemas
   ├── engine/         # Pure TS high-performance motor (input, render, spatial)
   ├── editor/         # CodeMirror 6 integration & smart block anchoring
   ├── io/             # Async background persistence & companion SVG export
   ├── graph/          # Obsidian MetadataCache & link injection worker
   ├── tools/          # Pen profiles, erasers, shape recognition, grid snapping
   └── ui/             # Preact components (Toolbar, Menus, Modals)
   ```
3. **Bridge Contract**:
   - Define a strictly typed, unidirectional `EngineEventBus` so the Engine emits high-level events (`toolChanged`, `selectionChanged`) to Preact without exposing the high-frequency pointer loop.

---

### Phase 1: 120Hz S-Pen Input Loop & Focus Lock (Tab S10 Foundation)
*Goal: Solve S-Pen latency, palm rejection, barrel buttons, and swipe interference on Android WebView.*

1. **High-Frequency Pointer Consumer**:
   - Listen to native `pointerdown`, `pointermove`, `pointerup`, `pointercancel`.
   - On `pointermove`, extract all intermediate points via `e.getCoalescedEvents()` (capturing true 120Hz–240Hz S-Pen hardware points).
   - Low-latency Kalman/velocity predictor to eliminate tip visual lag.
2. **Focus & Drawer Interference Guard**:
   - Apply `touch-action: none` and stop propagation on horizontal pen swipes to prevent accidentally pulling open Obsidian’s left/right navigation drawers.
3. **S-Pen Hardware Button & Palm Gating**:
   - Detect S-Pen barrel button (`e.buttons === 2` or Pen button flags) to activate temporary lasso or eraser.
   - Intelligent touch gating: When stylus hover or contact is detected, immediately reject finger touches for the stroke duration + 400ms cooldown.

---

### Phase 2: Double-Buffered Motor & Spatial Index (Heavy Engineering Scale)
*Goal: Guarantee rock-solid 120 FPS on notes with 5,000+ complex engineering strokes and schematics.*

1. **Zero-Allocation Data Buffers**:
   - Active drawing points stored in pre-allocated `Float32Array` chunks `[x, y, pressure, time]`, eliminating V8 Garbage Collection pauses.
2. **Two-Layer Double Buffering**:
   - **Wet Canvas**: Lightweight transient canvas that draws only the active stroke at 120fps.
   - **Dry Canvas**: High-resolution backing canvas holding all committed strokes with Catmull-Rom / Bezier smoothing.
3. **Spatial R-Tree Viewport Culling**:
   - Index all committed strokes in an R-Tree (`RBush`).
   - During pan/zoom on the Tab S10, query the visible bounding box in <0.5ms and cull all off-screen strokes.

---

### Phase 3: Smart Block Anchoring & CodeMirror 6 Synchronization
*Goal: Deliver "draw anywhere" without drawings drifting when text is edited.*

1. **CodeMirror 6 Overlay ViewPlugin**:
   - Mount the canvas engine as an editor extension that tracks the note scroller’s exact matrix, scroll position, and zoom.
2. **Paragraph/Block-Level Anchoring**:
   - Each stroke or shape records the CodeMirror block index / line range where it was created.
   - **Text Added Above**: CodeMirror transaction listener detects block displacement \(\Delta y\); engine instantly shifts downstream strokes down by \(\Delta y\).
   - **Text Deleted Above**: Strokes pull upward in real time.
   - **Within-Block Editing**: Strokes maintain relative local block coordinates, preventing horizontal distortion while preserving visual association.
3. **Insert Space Tool**:
   - Dedicated drag tool to insert vertical breathing room, shifting text and ink downwards synchronously.

---

### Phase 4: Resilient Async Persistence & Companion SVG Safety Net
*Goal: Fix file-switch save cancellation and ensure 100% native preview when plugin is deactivated.*

1. **Detached Async Write Queue**:
   - Decouple saving from the Obsidian leaf/view.
   - Save requests enter a FIFO background worker with debouncing and retry logic. Switching notes mid-save never cancels in-flight file writes.
2. **Two-Artifact Persistence**:
   - **Engine Sidecar**: `.apolocanvas/data/<page-id>.json` (point data, styles, transforms).
   - **Companion SVG**: `assets/ink/<Note-Name>.ink.svg` (rendered vector graphic).
3. **Deactivation Safety Net**:
   - Frontmatter tag: `apolo-page-id: <uuid>`.
   - Maintained native callout block at note bottom:
     ```markdown
     > [!note]- 🖋️ Handwritten Notes & Diagrams
     > ![[assets/ink/Note.ink.svg]]
     > **Graph Links in Ink:** [[Database Engine]], [[Auth API]]
     ```
   - Active plugin hides this callout in Live Preview; deactivation lets Obsidian render the full vector drawing and parse the wiki-links natively.
4. **Reading Mode Sync**:
   - In Reading Mode, hide editing toolbars and display the canvas fixed/centered, matching the global view mode.

---

### Phase 5: Knowledge Graph Integration (Stroke Linking)
*Goal: Turn engineering schematics and handwritten text into first-class Obsidian graph nodes.*

1. **Lasso Selection Subsystem**:
   - Polygon lasso hit-testing against the R-Tree to select arbitrary strokes, math equations, or shapes.
   - Emits selection bounding box to the Preact bridge.
2. **WikiLink & URL Binding**:
   - Assign internal note targets (`[[Note]]` or `[[Note#Heading]]`) to selected stroke groups.
3. **GraphCacheWorker Integration**:
   - Injects linked stroke targets into `app.metadataCache.resolvedLinks` and `unresolvedLinks`.
   - Links appear in Obsidian’s **Graph View** and the target note’s **Backlinks Panel**.
4. **Hover Previews & Click Navigation**:
   - Hovering over a linked stroke opens native Obsidian Page Previews.
   - Clicking navigates directly to the target note.

---

### Phase 6: Engineering Toolset & Intelligence
*Goal: Shape snapping, reticle slicing, scribble erase, smart grid, and physical pen profiles.*

1. **Pen Profiles (`PenProfileRegistry`)**:
   - Fountain Pen, Calligraphy Chisel, Ballpoint, Textured Pencil, Rounded and Square Highlighters.
2. **Dual Eraser Engine + Scribble Gesture**:
   - Whole stroke erase mode.
   - **Reticle / Path-Splitting Mode**: Slices intersected strokes into independent sub-strokes at eraser radius boundaries.
   - **Scribble to Erase**: Detects high-frequency back-and-forth zigzag motion to quickly delete underlying elements.
3. **Hold-to-Snap Recognition**:
   - Detect 300ms stationary dwell at stroke end. Classify into geometric Line, Arrow, Rectangle, Rounded Rect, Circle, or Triangle.
4. **Smart Anchor Grid**:
   - Replaces rigid coordinate snapping with magnetic alignment points (enabling clean diagonals, angle snapping, and connector pins for schematics).

---

### Phase 7: Preact UI Shell & Polish
*Goal: Build a modern, responsive, dockable interface for the S10 tablet.*

1. **Floating Dockable Toolbar**:
   - 3x3 edge/corner snapping with drag grip and auto-collapse on narrow split-views.
   - Quick Pen Favorites (up to 4 starred preset chips with hotkey bindings).
   - Stylus-to-Caret passthrough toggle (`Pen on / off`) to tap-to-type without drawing dots.
2. **Pencil Case & Color Swatch Manager**:
   - Preact modal and popovers for custom palette creation, HEX pickers, and tool-specific presets.
3. **Lasso Selection Menu**:
   - Floating context popup above selected strokes: *Copy, Paste, Link, Bring to Front, Send to Back, Style (Color, Width, Dash/Dot)*.

---

## Verification & Acceptance Plan

| Milestone | Acceptance Criteria | Test Target |
| :--- | :--- | :--- |
| **Phase 1-2** | 120 FPS drawing with zero stutters; S-Pen tip stays pinned to glass; barrel button triggers tool toggle. | Samsung Tab S10 (Android WebView) |
| **Phase 3** | Typing 5 paragraphs above an inked diagram moves the diagram down smoothly by the exact height; no drift. | Live Preview Note Editor |
| **Phase 4** | Rapidly switching between 10 notes while writing saves 100% of ink without data loss; deactivating plugin displays full vector SVG. | Persistence Stress Test |
| **Phase 5** | Linked strokes visibly connect notes in Obsidian global Graph View and appear in Backlinks panel. | Vault Metadata Cache |
| **Phase 6** | Drawing a box and dwelling 300ms converts to crisp vector rectangle; cutting stroke splits into two sub-strokes. | Engineering Schematics Test |
| **Stress Test** | 10-page dense calculus & circuit schematic note (8,000+ strokes): smooth 120 FPS zoom/pan with <5ms latency. | Heavy Usage Acceptance Test |
