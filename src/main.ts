import { App, editorLivePreviewField, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { EngineEventBus } from './core/events.ts';
import type { BoxAccentColor, BoxBgTheme, BoxGridStyle, PenFavorite, StrokeFavoriteProfile, ShapeFavoriteProfile, ToolbarSlot, WorkspaceToolState } from './core/types.ts';
import { DEFAULT_WORKSPACE_TOOL_STATE, DEFAULT_STROKE_FAVORITE_PROFILES, DEFAULT_SHAPE_FAVORITE_PROFILES, cloneWorkspaceToolState, mergeWorkspaceToolState } from './core/types.ts';
import {
    computeFavoriteFingerprint,
    findMatchingFavorite,
    getNextFavoritePreset,
    toggleFavoritePreset,
    removeFavoriteById,
    reorderFavorites,
    getActiveStrokeProfile,
    getActiveShapeProfile,
    switchStrokeProfile,
    switchShapeProfile,
    createStrokeProfile,
    createShapeProfile,
    renameStrokeProfile,
    deleteStrokeProfile,
    renameShapeProfile,
    deleteShapeProfile,
    renameFavoritePreset,
    setCanonicalFavorites,
    getCanonicalFavorites,
    type ToolFavoritePreset,
    type PenFavoritePreset,
    type HighlighterFavoritePreset,
    type ShapeFavoritePreset,
} from './ui/favorites/FavoritesStore.ts';
import { CanvasController } from './engine/CanvasController.ts';
import { PersistenceQueue, renderBoxSvg } from './io/PersistenceQueue.ts';
import { createDotsIcon, createSvgFromMarkup, DEFAULT_FAVORITES, DEFAULT_TOOL_PALETTES } from './ui/theme.ts';
import { openLocalGraph } from './ui/LinkSuggestModal.ts';
import { BoxRegistry, boxRegistryUpdateEffect, createApoloSpaceExtension, normalizeBoxId } from './editor/ApoloSpaceExtension.ts';

export interface ApoloCanvasSettings {
    defaultPenColor: string;
    defaultPenWidth: number;
    palmRejectionCooldownMs: number;
    autoSaveDebounceMs: number;
    companionSvgExport: boolean;
    penInputEnabled: boolean;
    enableMouseDrawing: boolean;
    shapeRecognition: boolean;
    straightenLines: boolean;
    toolState: WorkspaceToolState;
    toolbarSlot: ToolbarSlot;
    favorites: PenFavorite[];
    toolPalettes: Record<'pen' | 'highlighter' | 'shape', { colors: string[]; opacities: number[] }>;
    hasSeenHelpNotice: boolean;
    gridDensity: number;
    defaultBoxHeight: number;
    defaultBoxGridStyle: BoxGridStyle;
    defaultBoxGridDensity: number;
    defaultBoxBorderOutline: boolean;
    defaultBoxBgTheme: BoxBgTheme;
    defaultBoxCustomBgColor: string;
    defaultBoxAccentColor: BoxAccentColor;
    showSpenDebugHud?: boolean;
}

export const DEFAULT_SETTINGS: ApoloCanvasSettings = {
    defaultPenColor: '#1F4FD8',
    defaultPenWidth: 3,
    palmRejectionCooldownMs: 400,
    autoSaveDebounceMs: 500,
    companionSvgExport: true,
    penInputEnabled: true,
    enableMouseDrawing: false,
    shapeRecognition: true,
    straightenLines: false,
    showSpenDebugHud: false,
    toolState: DEFAULT_WORKSPACE_TOOL_STATE,
    toolbarSlot: 'tc',
    favorites: [
        { profile: 'fountain', color: '#1F4FD8', width: 3 },
        { profile: 'ball', color: '#D9480F', width: 2 },
        { profile: 'fountain', color: '#6C3FD1', width: 2 },
        { profile: 'pencil', color: '#111827', width: 3 },
    ],
    toolPalettes: {
        pen: {
            colors: ['#E53935', '#1F4FD8', '#10B981', '#111827'],
            opacities: [100, 100, 100, 100],
        },
        highlighter: {
            colors: ['#1E88E5', '#FDD835', '#43A047', '#00ACC1'],
            opacities: [75, 75, 75, 75],
        },
        shape: {
            colors: ['#2F6BFF', '#111827', '#FFA726', '#10B981'],
            opacities: [100, 100, 100, 100],
        },
    },
    hasSeenHelpNotice: false,
    gridDensity: 32,
    defaultBoxHeight: 120,
    defaultBoxGridStyle: 'dots',
    defaultBoxGridDensity: 32,
    defaultBoxBorderOutline: false,
    defaultBoxBgTheme: 'default',
    defaultBoxCustomBgColor: '',
    defaultBoxAccentColor: 'purple',
};

export default class ApoloCanvasPlugin extends Plugin {
    settings: ApoloCanvasSettings = { ...DEFAULT_SETTINGS };
    readonly eventBus = new EngineEventBus();
    private persistence!: PersistenceQueue;
    private controller: CanvasController | null = null;
    private mountedScroller: HTMLElement | null = null;
    private mountedFilePath = '';
    private mountedMode: 'source' | 'preview' | '' = '';
    private mountGeneration = 0;
    private saveStatusBarItem: HTMLElement | null = null;
    private isShuttingDown = false;
    private mountPromise: Promise<void> = Promise.resolve();

    async onload(): Promise<void> {
        await this.loadSettings();
        this.persistence = new PersistenceQueue(
            this.app,
            this.settings.autoSaveDebounceMs,
            () => new Notice('Apolo Canvas: El guardado falló; revisa la consola para más detalles.'),
        );
        this.persistence.setCompanionSvgEnabled(this.settings.companionSvgExport);
        BoxRegistry.setDefaultBgTheme(this.settings.defaultBoxBgTheme || 'default');

        await ensureFolder(this.app, '.apolocanvas');
        await ensureFolder(this.app, '.apolocanvas/boxes');
        await ensureFolder(this.app, '.apolocanvas/notes');

        // Register CM6 Live Preview widget extension for apolo-space blocks
        this.registerEditorExtension(createApoloSpaceExtension(editorLivePreviewField));

        // Register Reading mode codeblock processor for apolo-space blocks
        this.registerMarkdownCodeBlockProcessor('apolo-space', (source, el) => {
            const heightMatch = source.match(/height:\s*(\d+)/i);
            const height = heightMatch ? Math.max(20, Math.min(2000, parseInt(heightMatch[1], 10))) : 200;
            const idMatch = source.match(/(?:^|\r?\n)\s*id:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s\n\r#"']+))/i);
            let rawId = '';
            if (idMatch) {
                if (idMatch[1] !== undefined) {
                    try {
                        rawId = JSON.parse(`"${idMatch[1]}"`);
                    } catch {
                        rawId = idMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                    }
                } else if (idMatch[2] !== undefined) {
                    rawId = idMatch[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
                } else if (idMatch[3] !== undefined) {
                    rawId = idMatch[3];
                }
            }
            const id = normalizeBoxId(rawId);

            const densityMatch = source.match(/gridDensity:\s*(\d+)/i);
            const gridStyleMatch = source.match(/gridStyle:\s*["']?([^\s\r\n"']+)["']?/i);
            const bgThemeMatch = source.match(/bgTheme:\s*["']?([^\s\r\n"']+)["']?/i);
            const accentMatch = source.match(/accentColor:\s*["']?([^\s\r\n"']+)["']?/i);

            el.empty();
            el.addClass('apolo-space-block');
            el.dataset.apoloSpaceId = id;
            el.dataset.apoloSpace = id;
            el.dataset.apoloHeight = String(height);
            if (densityMatch) el.dataset.apoloGridDensity = densityMatch[1];
            if (gridStyleMatch) el.dataset.apoloGridStyle = gridStyleMatch[1];
            if (bgThemeMatch) el.dataset.apoloBgTheme = bgThemeMatch[1];
            if (accentMatch) el.dataset.apoloAccent = accentMatch[1];
            el.style.height = `${height}px`;
            el.style.width = '100%';
            el.style.display = 'block';
            el.style.userSelect = 'none';
        });

        // Register Reading mode section info post-processor for precise paragraph anchoring
        this.registerMarkdownPostProcessor((el, ctx) => {
            const spaceCandidates: HTMLElement[] = [];
            if (el.matches?.('.apolo-space, [data-apolo-space], [data-apolo-space-id]')) {
                spaceCandidates.push(el);
            }
            const foundDescendants = el.querySelectorAll<HTMLElement>('.apolo-space, [data-apolo-space], [data-apolo-space-id]');
            for (let i = 0; i < foundDescendants.length; i++) {
                spaceCandidates.push(foundDescendants[i]);
            }

            for (const s of spaceCandidates) {
                s.addClass('apolo-space-block');
                const id = s.dataset.apoloSpace || s.dataset.apoloSpaceId;
                if (id) {
                    s.dataset.apoloSpaceId = id;
                    s.dataset.apoloSpace = id;
                }
                const sidecarH = id ? BoxRegistry.getHeight(id) : undefined;
                const dataH = s.dataset.h ? parseInt(s.dataset.h, 10) : undefined;
                const hMatch = s.style.height || s.getAttribute('style')?.match(/height:\s*(\d+)px/i)?.[1];
                const h = Math.max(120, sidecarH ?? dataH ?? (hMatch ? parseInt(hMatch, 10) : 280));
                s.dataset.apoloHeight = String(h);
                s.style.setProperty('height', `${h}px`, 'important');
                s.style.setProperty('min-height', `${h}px`, 'important');
                s.style.setProperty('width', '100%', 'important');
                s.style.setProperty('display', 'block', 'important');

                const embedParent = s.closest<HTMLElement>('.cm-embed-block');
                if (embedParent) {
                    embedParent.style.setProperty('min-height', `${h}px`, 'important');
                }

                // Sincronizar BoxRegistry para que Live Preview y el motor de dibujo lo conozcan
                if (id) {
                    if (BoxRegistry.getHeight(id) === undefined) {
                        BoxRegistry.setHeight(id, h);
                    }
                    if (s.dataset.apoloGridDensity) {
                        BoxRegistry.setGridDensity(id, parseInt(s.dataset.apoloGridDensity, 10));
                    }
                    if (s.dataset.apoloGridStyle) {
                        BoxRegistry.setGridStyle(id, s.dataset.apoloGridStyle as BoxGridStyle);
                    }
                    if (s.dataset.apoloBgTheme && s.dataset.apoloBgTheme !== 'default') {
                        BoxRegistry.setBgTheme(id, s.dataset.apoloBgTheme as BoxBgTheme);
                    }
                    if (s.dataset.apoloAccent) {
                        BoxRegistry.setAccentColor(id, s.dataset.apoloAccent as BoxAccentColor);
                    }
                    s.dataset.apoloGrid = BoxRegistry.isGridVisible(id) ? 'true' : 'false';
                    s.dataset.apoloGridStyle = BoxRegistry.getGridStyle(id);
                    const effectiveBgTheme = BoxRegistry.getBgTheme(id);
                    s.dataset.apoloBgTheme = effectiveBgTheme;
                    const density = BoxRegistry.getGridDensity(id);
                    s.dataset.apoloGridDensity = String(density);
                    const updateGridStep = () => {
                        const parentW = s.parentElement?.clientWidth || s.closest('.markdown-rendered, .markdown-preview-view, .cm-content')?.clientWidth;
                        const w = s.clientWidth || s.offsetWidth || parentW || 800;
                        const step = Math.round((w / density) * 100) / 100;
                        s.style.setProperty('--apolo-grid-step', step + 'px');
                    };
                    updateGridStep();
                    if (!s.clientWidth && typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
                        window.requestAnimationFrame(() => updateGridStep());
                    }
                    s.dataset.apoloAccent = BoxRegistry.getAccentColor(id);
                    s.dataset.apoloBorder = BoxRegistry.isBorderOutline(id) ? 'true' : 'false';
                    s.dataset.apoloSnap = BoxRegistry.isSnapActive(id) ? 'true' : 'false';
                    const customBg = BoxRegistry.getCustomBgColor(id);
                    if (customBg) {
                        s.style.setProperty('background-color', customBg, 'important');
                    } else if (effectiveBgTheme === 'pitch-black') {
                        s.style.setProperty('background-color', '#000000', 'important');
                    } else if (effectiveBgTheme === 'graphite') {
                        s.style.setProperty('background-color', '#27272a', 'important');
                    } else if (effectiveBgTheme === 'transparent') {
                        s.style.setProperty('background-color', 'transparent', 'important');
                    } else {
                        s.style.removeProperty('background-color');
                    }
                }

                // En modo lectura no se muestran asas ni botones de menú; sólo la caja y sus trazos
                const isPreview = !!el.closest('.markdown-preview-view');
                const existingHandle = s.querySelector('.apolo-box-handle');
                const existingOptions = s.querySelector('.apolo-box-options-btn');
                if (isPreview) {
                    if (existingHandle) existingHandle.remove();
                    if (existingOptions) existingOptions.remove();

                    // Render companion SVG faithfully synchronized with text
                    if (id) {
                        const doc = this.controller?.getDocument() ?? (this.mountedFilePath ? this.persistence?.getDocument(this.mountedFilePath) : null);
                        const boxElements = doc?.elements.filter(e => e.blockId === `space:${id}`) || [];
                        let previewSvgWrap = s.querySelector<HTMLElement>('.apolo-box-preview-svg');
                        if (boxElements.length > 0) {
                            if (!previewSvgWrap) {
                                previewSvgWrap = document.createElement('div');
                                previewSvgWrap.className = 'apolo-box-preview-svg';
                                s.appendChild(previewSvgWrap);
                            }
                            const boxW = Math.round(s.clientWidth || s.offsetWidth || 800);
                            const svgMarkup = renderBoxSvg(id, boxElements, boxW, h);
                            const parsedSvg = createSvgFromMarkup(svgMarkup);
                            previewSvgWrap.replaceChildren(parsedSvg);
                            previewSvgWrap.dataset.apoloSvgHash = `${boxElements.length}:${boxW}:${h}`;
                        } else if (previewSvgWrap) {
                            previewSvgWrap.remove();
                        }
                    }
                } else if (id) {
                    if (!existingOptions) {
                        const optBtn = document.createElement('button');
                        optBtn.className = 'apolo-box-options-btn';
                        optBtn.type = 'button';
                        optBtn.dataset.apoloBoxId = id;
                        optBtn.setAttribute('aria-label', 'Opciones del espacio');
                        optBtn.appendChild(createDotsIcon());
                        s.appendChild(optBtn);
                    }
                    if (!existingHandle) {
                        const handle = document.createElement('div');
                        handle.className = 'apolo-box-handle';
                        handle.dataset.apoloHandleId = id;
                        handle.setAttribute('role', 'button');
                        handle.setAttribute('aria-label', 'Redimensionar caja de dibujo');

                        const bar = document.createElement('div');
                        bar.className = 'apolo-box-handle-bar';

                        handle.appendChild(bar);
                        s.appendChild(handle);
                    }
                }
            }

            const sectionInfo = ctx.getSectionInfo(el);
            if (sectionInfo) {
                el.dataset.apoloLineStart = String(sectionInfo.lineStart);
                el.dataset.apoloLineEnd = String(sectionInfo.lineEnd);
            } else {
                // Fallback: check closest ancestor with line data
                const parent = el.closest<HTMLElement>('[data-apolo-line-start]');
                if (parent) {
                    el.dataset.apoloLineStart = parent.dataset.apoloLineStart;
                    el.dataset.apoloLineEnd = parent.dataset.apoloLineEnd;
                } else {
                    // Fallback: check nearest preceding sibling with line data
                    let prev = el.previousElementSibling;
                    let found = false;
                    while (prev) {
                        if (prev instanceof HTMLElement && prev.dataset.apoloLineEnd) {
                            const end = parseInt(prev.dataset.apoloLineEnd, 10);
                            el.dataset.apoloLineStart = String(end + 1);
                            el.dataset.apoloLineEnd = String(end + 1);
                            found = true;
                            break;
                        }
                        prev = prev.previousElementSibling;
                    }
                    if (!found) {
                        // Fallback: check nearest following sibling with line data
                        let next = el.nextElementSibling;
                        while (next) {
                            if (next instanceof HTMLElement && next.dataset.apoloLineStart) {
                                const start = parseInt(next.dataset.apoloLineStart, 10);
                                const approx = String(Math.max(0, start - 1));
                                el.dataset.apoloLineStart = approx;
                                el.dataset.apoloLineEnd = approx;
                                break;
                            }
                            next = next.nextElementSibling;
                        }
                    }
                }
            }

            // Notify active controller on lazy section rendering in Reading mode
            this.controller?.onPreviewSectionRendered();
        });

        // Status bar item (Desktop + Mobile fallback)
        this.saveStatusBarItem = this.addStatusBarItem();
        this.saveStatusBarItem.setText('Apolo Canvas: Guardado');
        this.eventBus.on('save:status', (isSaving) => {
            if (this.saveStatusBarItem) {
                this.saveStatusBarItem.setText(isSaving ? 'Apolo Canvas: Guardando…' : 'Apolo Canvas: Guardado');
            }
        });

        this.eventBus.on('favorites:cycle', () => {
            const tool = this.controller ? this.controller.getTool() : this.settings.toolState.activeTool;
            if (tool === 'eraser' || tool === 'lasso') {
                if (this.controller) {
                    this.controller.setTool('pen');
                } else {
                    this.settings.toolState.activeTool = 'pen';
                }
                new Notice('Apolo: Pluma');
                return;
            }
            const count = this.controller ? this.controller.getActiveToolFavoritesCount() : this.getActiveToolFavoritesCount();
            if (count < 2) {
                if (this.controller) {
                    this.controller.toggleEstucheFavorites();
                }
            }
        });

        this.addSettingTab(new ApoloCanvasSettingsTab(this.app, this));
        this.registerCommands();

        this.registerEvent(this.app.workspace.on('active-leaf-change', () => { void this.mountActiveEditor(); }));
        this.registerEvent(this.app.workspace.on('layout-change', () => { void this.mountActiveEditor(); }));
        this.registerEvent(this.app.workspace.on('editor-change', () => this.controller?.onEditorChange()));
        this.registerEvent(this.app.workspace.on('file-open', () => { void this.mountActiveEditor(); }));

        // Vault note renaming: preserve ink document association and rename companion SVG without data loss
        this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
            if (!(file instanceof TFile)) return;
            try {
                this.controller?.commitActiveStroke();
                await this.persistence?.flush();
            } catch (err) {
                console.error('[ApoloCanvas] Flush failed before rename:', err);
            }
            if (this.mountedFilePath === oldPath) {
                this.mountedFilePath = file.path;
            }
            this.controller?.onFileRenamed(file, oldPath);
            await this.persistence?.onFileRenamed(oldPath, file);
        }));

        // Vault note deletion: clean up note-level ink storage (boxes kept as orphans)
        this.registerEvent(this.app.vault.on('delete', async (file) => {
            if (!(file instanceof TFile)) return;
            if (this.mountedFilePath === file.path) {
                await this.destroyController();
            }
            await this.persistence?.onFileDeleted(file.path);
        }));

        this.app.workspace.onLayoutReady(() => {
            void this.mountActiveEditor();
            this.showFirstTimeNoticeIfNeeded();
        });

        // App closing / tab hiding / lifecycle hooks: ensure immediate flush of all pending ink data
        this.registerDomEvent(window, 'beforeunload', () => {
            if (this.isShuttingDown) return;
            this.controller?.commitActiveStroke();
            void this.persistence?.flush();
        });
        this.registerDomEvent(window, 'pagehide', () => {
            if (this.isShuttingDown) return;
            this.controller?.commitActiveStroke();
            void this.persistence?.flush();
        });

        this.registerDomEvent(window, 'keydown', this.onKeyDown, true);
        console.log('[ApoloCanvas] Ready: S-Pen input, editor overlay and sidecar persistence enabled.');
    }

    onunload(): void {
        void this.flushAndDestroy();
        console.log('[ApoloCanvas] Unloaded.');
    }

    private showFirstTimeNoticeIfNeeded(): void {
        if (!this.settings.hasSeenHelpNotice) {
            this.settings.hasSeenHelpNotice = true;
            void this.saveSettings();
            new Notice(
                'Apolo Canvas: Toca otra vez la herramienta activa para abrir su estuche · Arrastra la barra por el asa para moverla.',
                9000,
            );
        }
    }

    async loadSettings(): Promise<void> {
        const saved = await this.loadData() as Partial<ApoloCanvasSettings> | null;
        const initialToolState = mergeWorkspaceToolState(saved?.toolState, {
            ...DEFAULT_WORKSPACE_TOOL_STATE,
            penEnabled: saved?.penInputEnabled ?? DEFAULT_WORKSPACE_TOOL_STATE.penEnabled,
            pen: {
                ...DEFAULT_WORKSPACE_TOOL_STATE.pen,
                color: saved?.defaultPenColor ?? DEFAULT_WORKSPACE_TOOL_STATE.pen.color,
                width: saved?.defaultPenWidth ?? DEFAULT_WORKSPACE_TOOL_STATE.pen.width,
                straightenLines: saved?.straightenLines ?? DEFAULT_WORKSPACE_TOOL_STATE.pen.straightenLines,
                palette: saved?.toolPalettes?.pen?.colors && saved.toolPalettes.pen.colors.length === 4
                    ? { colors: [...saved.toolPalettes.pen.colors], opacities: [...(saved.toolPalettes.pen.opacities ?? [100, 100, 100, 100])] }
                    : DEFAULT_WORKSPACE_TOOL_STATE.pen.palette,
            },
            highlighter: {
                ...DEFAULT_WORKSPACE_TOOL_STATE.highlighter,
                palette: saved?.toolPalettes?.highlighter?.colors && saved.toolPalettes.highlighter.colors.length === 4
                    ? { colors: [...saved.toolPalettes.highlighter.colors], opacities: [...(saved.toolPalettes.highlighter.opacities ?? [75, 75, 75, 75])] }
                    : DEFAULT_WORKSPACE_TOOL_STATE.highlighter.palette,
            },
            shape: {
                ...DEFAULT_WORKSPACE_TOOL_STATE.shape,
                palette: saved?.toolPalettes?.shape?.colors && saved.toolPalettes.shape.colors.length === 4
                    ? { colors: [...saved.toolPalettes.shape.colors], opacities: [...(saved.toolPalettes.shape.opacities ?? [100, 100, 100, 100])] }
                    : DEFAULT_WORKSPACE_TOOL_STATE.shape.palette,
            },
        });

        this.settings = {
            ...DEFAULT_SETTINGS,
            ...(saved ?? {}),
            toolState: initialToolState,
            favorites: saved?.favorites && saved.favorites.length === 4
                ? saved.favorites
                : [...DEFAULT_FAVORITES],
            toolPalettes: {
                pen: { ...initialToolState.pen.palette },
                highlighter: { ...initialToolState.highlighter.palette },
                shape: { ...initialToolState.shape.palette },
            },
        };
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    private toolStateSaveTimer: number | null = null;

    handleToolStateChange(state: WorkspaceToolState): void {
        this.settings.toolState = cloneWorkspaceToolState(state);
        this.settings.penInputEnabled = state.penEnabled;
        this.settings.defaultPenColor = state.pen.color;
        this.settings.defaultPenWidth = state.pen.width;
        this.settings.straightenLines = state.pen.straightenLines;
        this.settings.toolPalettes = {
            pen: { colors: [...state.pen.palette.colors], opacities: [...state.pen.palette.opacities] },
            highlighter: { colors: [...state.highlighter.palette.colors], opacities: [...state.highlighter.palette.opacities] },
            shape: { colors: [...state.shape.palette.colors], opacities: [...state.shape.palette.opacities] },
        };
        this.debouncedSaveSettings();
    }

    private debouncedSaveSettings(): void {
        if (this.toolStateSaveTimer !== null) {
            window.clearTimeout(this.toolStateSaveTimer);
        }
        this.toolStateSaveTimer = window.setTimeout(() => {
            this.toolStateSaveTimer = null;
            void this.saveSettings();
        }, 300);
    }

    applyWorkspaceToolStateToController(controller: CanvasController): void {
        if (this.settings.toolState) {
            controller.applyWorkspaceToolState(this.settings.toolState, true);
        }
    }

    setAutoSaveDelay(value: number): void { this.persistence?.setDebounceMs(value); }
    setCompanionExport(value: boolean): void { this.persistence?.setCompanionSvgEnabled(value); }
    setShapeRecognition(value: boolean): void { this.controller?.setShapeRecognition(value); }
    setStraightenLines(value: boolean): void {
        this.settings.straightenLines = value;
        if (this.settings.toolState) {
            this.settings.toolState.pen.straightenLines = value;
            this.settings.toolState.highlighter.straightenLines = value;
        }
        this.controller?.setStraightenLines(value);
        void this.saveSettings();
    }

    setPenInput(value: boolean): void {
        this.settings.penInputEnabled = value;
        if (this.settings.toolState) {
            this.settings.toolState.penEnabled = value;
        }
        this.controller?.setPenEnabled(value);
        void this.saveSettings();
    }

    setMouseDrawing(value: boolean): void {
        if (this.settings.enableMouseDrawing === value) return;
        this.settings.enableMouseDrawing = value;
        void this.remountActiveEditor();
    }

    toggleActiveToolFavorite(): void {
        if (this.controller) {
            this.controller.toggleFavorite();
            return;
        }
        const tool = this.settings.toolState.activeTool;
        if (tool !== 'pen' && tool !== 'highlighter' && tool !== 'shape') return;
        const list = getCanonicalFavorites(this.settings.toolState, tool);
        const result = toggleFavoritePreset(list, { tool, ...this.settings.toolState[tool] } as any);
        setCanonicalFavorites(this.settings.toolState, tool, result.updatedList);
        this.debouncedSaveSettings();
    }

    applyToolFavorite(preset: ToolFavoritePreset): void {
        if (this.controller) {
            this.controller.applyToolFavoritePreset(preset);
            return;
        }
        const st = this.settings.toolState;
        st.activeTool = preset.tool;
        if (preset.tool === 'pen' || preset.tool === 'highlighter') {
            const target = st[preset.tool];
            target.profileId = preset.profileId;
            target.color = preset.color;
            target.width = preset.width;
            target.opacity = preset.opacity;
            target.pattern = preset.pattern;
            if (preset.straightenLines !== undefined) target.straightenLines = preset.straightenLines;
            if (preset.tool === 'pen' && preset.smoothing !== undefined) st.pen.smoothing = preset.smoothing;
        } else if (preset.tool === 'shape') {
            st.shape.shapeType = preset.shapeType;
            st.shape.color = preset.color;
            st.shape.width = preset.width;
            st.shape.opacity = preset.opacity;
            st.shape.pattern = preset.pattern;
            if (preset.fillEnabled !== undefined) st.shape.fillEnabled = preset.fillEnabled;
            if (preset.fillColor !== undefined) st.shape.fillColor = preset.fillColor;
            if (preset.fillOpacity !== undefined) st.shape.fillOpacity = preset.fillOpacity;
        }
        this.debouncedSaveSettings();
    }

    deleteToolFavorite(presetId: string): void {
        if (this.controller) {
            this.controller.deleteToolFavoritePreset(presetId);
            return;
        }
        const tool = this.settings.toolState.activeTool;
        if (tool !== 'pen' && tool !== 'highlighter' && tool !== 'shape') return;
        setCanonicalFavorites(this.settings.toolState, tool, removeFavoriteById(getCanonicalFavorites(this.settings.toolState, tool), presetId));
        this.debouncedSaveSettings();
    }

    reorderToolFavorites(fromIndex: number, toIndex: number): void {
        if (this.controller) {
            this.controller.reorderToolFavorites(fromIndex, toIndex);
            return;
        }
        const tool = this.settings.toolState.activeTool;
        if (tool !== 'pen' && tool !== 'highlighter' && tool !== 'shape') return;
        setCanonicalFavorites(this.settings.toolState, tool, reorderFavorites(getCanonicalFavorites(this.settings.toolState, tool), fromIndex, toIndex));
        this.debouncedSaveSettings();
    }

    switchToolFavoriteProfile(profileId: string): void {
        if (this.controller) {
            this.controller.switchFavoriteProfile(profileId);
            return;
        }
        if (this.settings.toolState.activeTool === 'shape') switchShapeProfile(this.settings.toolState, profileId);
        else switchStrokeProfile(this.settings.toolState, profileId);
        this.debouncedSaveSettings();
    }

    createToolFavoriteProfile(name: string): void {
        if (this.controller) {
            this.controller.createFavoriteProfile(name);
            return;
        }
        if (this.settings.toolState.activeTool === 'shape') createShapeProfile(this.settings.toolState, name);
        else createStrokeProfile(this.settings.toolState, name);
        this.debouncedSaveSettings();
    }

    getStrokeFavoriteProfiles(): StrokeFavoriteProfile[] {
        if (!Array.isArray(this.settings.toolState.strokeFavoriteProfiles) || this.settings.toolState.strokeFavoriteProfiles.length === 0) {
            this.settings.toolState.strokeFavoriteProfiles = DEFAULT_STROKE_FAVORITE_PROFILES.map(sp => ({
                ...sp, pen: [...sp.pen], highlighter: [...sp.highlighter],
            }));
        }
        return this.settings.toolState.strokeFavoriteProfiles;
    }

    getShapeFavoriteProfiles(): ShapeFavoriteProfile[] {
        if (!Array.isArray(this.settings.toolState.shapeFavoriteProfiles) || this.settings.toolState.shapeFavoriteProfiles.length === 0) {
            this.settings.toolState.shapeFavoriteProfiles = DEFAULT_SHAPE_FAVORITE_PROFILES.map(shp => ({
                ...shp, shape: [...shp.shape],
            }));
        }
        return this.settings.toolState.shapeFavoriteProfiles;
    }

    async renameStrokeProfile(profileId: string, name: string): Promise<boolean> {
        const ok = this.controller ? this.controller.renameStrokeProfile(profileId, name) : renameStrokeProfile(this.settings.toolState, profileId, name);
        await this.saveSettings();
        return ok;
    }

    async deleteStrokeProfile(profileId: string): Promise<boolean> {
        const ok = this.controller ? this.controller.deleteStrokeProfile(profileId) : deleteStrokeProfile(this.settings.toolState, profileId);
        await this.saveSettings();
        return ok;
    }

    async createStrokeProfile(name: string): Promise<void> {
        if (this.controller) this.controller.createStrokeProfile(name);
        else createStrokeProfile(this.settings.toolState, name);
        await this.saveSettings();
    }

    async renameShapeProfile(profileId: string, name: string): Promise<boolean> {
        const ok = this.controller ? this.controller.renameShapeProfile(profileId, name) : renameShapeProfile(this.settings.toolState, profileId, name);
        await this.saveSettings();
        return ok;
    }

    async deleteShapeProfile(profileId: string): Promise<boolean> {
        const ok = this.controller ? this.controller.deleteShapeProfile(profileId) : deleteShapeProfile(this.settings.toolState, profileId);
        await this.saveSettings();
        return ok;
    }

    async createShapeProfile(name: string): Promise<void> {
        if (this.controller) this.controller.createShapeProfile(name);
        else createShapeProfile(this.settings.toolState, name);
        await this.saveSettings();
    }

    toggleSyncFavoriteProfiles(sync: boolean): void {
        if (this.controller) {
            this.controller.toggleSyncFavoriteProfiles(sync);
            return;
        }
        this.settings.toolState.syncFavoriteProfiles = sync;
        this.debouncedSaveSettings();
    }

    getActiveToolFavoritesCount(): number {
        const tool = this.settings.toolState.activeTool;
        if (tool === 'pen' || tool === 'highlighter' || tool === 'shape') {
            return getCanonicalFavorites(this.settings.toolState, tool).length;
        }
        return 0;
    }

    cycleActiveToolFavorite(): boolean {
        if (this.controller) return this.controller.cycleActiveToolFavorite();
        const tool = this.settings.toolState.activeTool;
        if (tool === 'eraser' || tool === 'lasso') {
            this.settings.toolState.activeTool = 'pen';
            new Notice('Apolo: Pluma');
            this.debouncedSaveSettings();
            return true;
        }
        if (tool !== 'pen' && tool !== 'highlighter' && tool !== 'shape') return false;

        const profile = tool === 'shape' ? getActiveShapeProfile(this.settings.toolState) : getActiveStrokeProfile(this.settings.toolState);
        const list = getCanonicalFavorites(this.settings.toolState, tool);
        if (!list || list.length < 2) {
            new Notice(`${profile.name}: Sin favoritos para ciclar`);
            return false;
        }

        const next = getNextFavoritePreset(list, { tool, ...this.settings.toolState[tool] } as any);
        if (!next) return false;

        this.applyToolFavorite(next.preset);
        new Notice(`${profile.name} · Favorito ${next.index + 1}/${list.length}`);
        return true;
    }

    cycleActiveToolProfile(): boolean {
        if (this.controller) return this.controller.cycleActiveToolProfile();
        const isShape = this.settings.toolState.activeTool === 'shape';
        const profiles = isShape ? this.settings.toolState.shapeFavoriteProfiles : this.settings.toolState.strokeFavoriteProfiles;
        const activeId = isShape ? this.settings.toolState.activeShapeProfileId : this.settings.toolState.activeStrokeProfileId;
        if (!profiles || profiles.length === 0) return false;
        const currIdx = profiles.findIndex(p => p.id === activeId);
        const nextProfile = profiles[currIdx !== -1 ? (currIdx + 1) % profiles.length : 0];
        this.switchToolFavoriteProfile(nextProfile.id);
        new Notice(`Perfil: ${nextProfile.name}`);
        return true;
    }

    private registerCommands(): void {
        this.addCommand({
            id: 'apolo-insert-canvas',
            name: 'Apolo Canvas: Insertar canvas',
            callback: () => {
                this.controller?.insertCanvas();
            },
        });

        this.addCommand({
            id: 'apolo-toggle-pen',
            name: 'Apolo Canvas: Alternar modo lápiz / modo teclado',
            hotkeys: [
                { modifiers: ['Alt'], key: 'P' },
                { modifiers: ['Mod', 'Shift'], key: 'P' },
            ],
            callback: () => {
                this.setPenInput(!this.settings.penInputEnabled);
            },
        });

        this.addCommand({
            id: 'apolo-focus-editor',
            name: 'Apolo Canvas: Enfocar editor de texto',
            callback: () => {
                this.controller?.setPenEnabled(false);
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                view?.editor?.focus();
            },
        });

        this.addCommand({
            id: 'apolo-toggle-mouse-drawing',
            name: 'Apolo Canvas: Alternar dibujo con ratón',
            callback: () => {
                this.setMouseDrawing(!this.settings.enableMouseDrawing);
                void this.saveSettings();
            },
        });

        this.addCommand({
            id: 'apolo-save-now',
            name: 'Apolo Canvas: Guardar tinta ahora',
            callback: () => {
                void this.persistence.flush()
                    .then(() => new Notice('Apolo Canvas: tinta guardada'))
                    .catch(() => new Notice('Apolo Canvas: error al guardar'));
            },
        });

        this.addCommand({
            id: 'apolo-open-local-graph',
            name: 'Apolo Canvas: Abrir grafo local',
            callback: () => openLocalGraph(this.app),
        });

        this.addCommand({
            id: 'apolo-tool-eraser',
            name: 'Apolo Canvas: Seleccionar borrador',
            callback: () => this.controller?.selectTool('eraser'),
        });

        this.addCommand({
            id: 'apolo-tool-lasso',
            name: 'Apolo Canvas: Seleccionar lazo',
            callback: () => this.controller?.selectTool('lasso'),
        });

        this.addCommand({
            id: 'apolo-tool-highlighter',
            name: 'Apolo Canvas: Seleccionar marcador',
            callback: () => this.controller?.selectTool('highlighter'),
        });

        this.addCommand({
            id: 'apolo-cycle-favorite-preset',
            name: 'Apolo Canvas: Ciclar siguiente favorito de la herramienta activa',
            callback: () => {
                this.cycleActiveToolFavorite();
            },
        });

        this.addCommand({
            id: 'apolo-cycle-favorite-profile',
            name: 'Apolo Canvas: Cambiar al siguiente perfil de favoritos de la herramienta activa',
            callback: () => {
                this.cycleActiveToolProfile();
            },
        });

        this.addCommand({
            id: 'apolo-toggle-spen-debug-hud',
            name: 'Apolo Canvas: Mostrar/Ocultar diagnóstico de eventos S-Pen en pantalla',
            callback: () => {
                this.settings.showSpenDebugHud = !this.settings.showSpenDebugHud;
                if (this.controller) {
                    this.controller.setSpenDebugHud(this.settings.showSpenDebugHud);
                }
                new Notice(`Apolo S-Pen HUD: ${this.settings.showSpenDebugHud ? 'Activado' : 'Desactivado'}`);
                void this.saveSettings();
            },
        });

        this.addCommand({
            id: 'apolo-undo',
            name: 'Apolo Canvas: Deshacer',
            callback: () => this.controller?.undo(),
        });

        this.addCommand({
            id: 'apolo-redo',
            name: 'Apolo Canvas: Rehacer',
            callback: () => this.controller?.redo(),
        });
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (this.mountedMode !== 'source') return;
        const target = event.target;
        if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

        // Quick toggle shortcut: Alt+P or Mod+Shift+P to freeze pen and switch to keyboard mode
        if ((event.altKey && event.key.toLowerCase() === 'p') ||
            ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p')) {
            event.preventDefault();
            this.setPenInput(!this.settings.penInputEnabled);
            return;
        }

        // Undo (Ctrl+Z) and Redo (Ctrl+Shift+Z / Ctrl+Y)
        const isUndo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey;
        const isRedo = ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z') ||
                       ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y');
        if (isUndo) {
            event.preventDefault();
            this.controller?.undo();
            return;
        }
        if (isRedo) {
            event.preventDefault();
            this.controller?.redo();
            return;
        }

        // Printable text key press -> switch to text editing mode automatically
        if (this.settings.penInputEnabled && !event.ctrlKey && !event.altKey && !event.metaKey && (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Enter')) {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (view && view.getMode() === 'source' && view.editor) {
                this.setPenInput(false);
                view.editor.focus();
            }
        }
    };

    private async mountActiveEditor(force = false): Promise<void> {
        if (this.isShuttingDown) return;
        this.mountPromise = this.mountPromise.then(async () => {
            if (this.isShuttingDown) return;
            await this.doMountActiveEditor(force);
        }).catch((err) => {
            console.error('[ApoloCanvas] Error during mountActiveEditor:', err);
        });
        await this.mountPromise;
    }

    private async doMountActiveEditor(force = false): Promise<void> {
        const generation = ++this.mountGeneration;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const file = view?.file;
        const mode = view?.getMode();

        if (!view || !file || (mode !== 'source' && mode !== 'preview')) {
            await this.destroyController();
            return;
        }

        // Add view header action icons once per view container
        const container = view.contentEl.parentElement;
        if (container && !container.dataset.apoloActionsAdded) {
            container.dataset.apoloActionsAdded = 'true';
            view.addAction('git-fork', 'Apolo Canvas: Grafo local', () => {
                openLocalGraph(this.app);
            });
            view.addAction('file-down', 'Apolo Canvas: Exportar SVG companion', () => {
                void this.persistence.flush().then(() => {
                    new Notice('Apolo Canvas: SVG companion sincronizado en assets/ink');
                });
            });
        }

        const scroller = mode === 'source'
            ? (view.contentEl.querySelector<HTMLElement>('.cm-scroller') ?? null)
            : (view.contentEl.querySelector<HTMLElement>('.markdown-preview-view')
                ?? ((view as any).previewMode?.containerEl as HTMLElement | undefined)?.querySelector<HTMLElement>('.markdown-preview-view')
                ?? null);

        if (!scroller || !scroller.isConnected) {
            window.setTimeout(() => {
                if (generation === this.mountGeneration && this.app.workspace.getActiveViewOfType(MarkdownView) === view) {
                    void this.mountActiveEditor(force);
                }
            }, 50);
            return;
        }

        if (!force && this.controller && this.mountedScroller === scroller && this.mountedFilePath === file.path && this.mountedMode === mode) {
            return;
        }

        const inMemoryDoc = (this.controller && this.mountedFilePath === file.path) ? this.controller.getDocument() : null;
        await this.destroyController();
        const pageId = file.path;

        if (!inMemoryDoc) {
            await this.persistence.flush();
        }

        const documentModel = inMemoryDoc ?? (await this.persistence.loadDocumentForNote(file));
        if (generation !== this.mountGeneration || this.app.workspace.getActiveFile()?.path !== file.path || !scroller.isConnected || view.getMode() !== mode) {
            return;
        }

        this.controller = new CanvasController(
            scroller,
            view.editor,
            documentModel,
            file,
            pageId,
            this.persistence,
            {
                palmRejectionCooldownMs: this.settings.palmRejectionCooldownMs,
                autoSaveDebounceMs: this.settings.autoSaveDebounceMs,
                defaultPenColor: this.settings.defaultPenColor,
                defaultPenWidth: this.settings.defaultPenWidth,
                enabled: this.settings.penInputEnabled,
                enableMouseDrawing: this.settings.enableMouseDrawing,
                shapeRecognition: this.settings.shapeRecognition,
                straightenLines: this.settings.straightenLines,
                toolbarSlot: this.settings.toolbarSlot,
                showSpenDebugHud: this.settings.showSpenDebugHud,
                favorites: this.settings.favorites,
                gridDensity: this.settings.gridDensity,
                defaultBoxHeight: this.settings.defaultBoxHeight,
                defaultBoxGridStyle: this.settings.defaultBoxGridStyle,
                defaultBoxGridDensity: this.settings.defaultBoxGridDensity,
                defaultBoxBorderOutline: this.settings.defaultBoxBorderOutline,
                defaultBoxBgTheme: this.settings.defaultBoxBgTheme,
                defaultBoxAccentColor: this.settings.defaultBoxAccentColor,
                defaultBoxCustomBgColor: this.settings.defaultBoxCustomBgColor,
                eventBus: this.eventBus,
                app: this.app,
                viewContainer: view.contentEl,
                readonly: mode !== 'source',
                onPenEnabledChange: (enabled: boolean) => {
                    this.settings.penInputEnabled = enabled;
                    void this.saveSettings();
                },
                onToggleStraighten: (enabled: boolean) => {
                    this.settings.straightenLines = enabled;
                    void this.saveSettings();
                    this.controller?.setStraightenLines(enabled);
                },
                onToolbarSlotChange: (slot: ToolbarSlot) => {
                    this.settings.toolbarSlot = slot;
                    void this.saveSettings();
                },
                onFavoritesChange: (favs: PenFavorite[]) => {
                    this.settings.favorites = favs;
                    void this.saveSettings();
                },
                onToggleFavorite: () => {
                    this.debouncedSaveSettings();
                },
                onApplyFavorite: (preset: ToolFavoritePreset) => {
                    this.debouncedSaveSettings();
                },
                onDeleteFavorite: (presetId: string) => {
                    this.debouncedSaveSettings();
                },
                onReorderFavorites: (fromIndex: number, toIndex: number) => {
                    this.debouncedSaveSettings();
                },
                toolState: this.settings.toolState,
                onToolStateChange: (state: WorkspaceToolState) => {
                    this.handleToolStateChange(state);
                },
                toolPalettes: this.settings.toolPalettes,
                onToolPalettesChange: (palettes) => {
                    this.settings.toolPalettes = palettes;
                    if (this.settings.favorites) {
                        palettes.pen.colors.forEach((col, idx) => {
                            if (this.settings.favorites[idx]) {
                                this.settings.favorites[idx].color = col;
                            }
                        });
                    }
                    void this.saveSettings();
                },
            },
        );

        this.mountedScroller = scroller;
        this.mountedFilePath = file.path;
        this.mountedMode = mode;

        if (mode === 'source') {
            this.applyWorkspaceToolStateToController(this.controller);
        }

        if (mode === 'preview') {
            this.controller.syncPreviewSpacing();
        }

        requestAnimationFrame(() => {
            if (this.controller && this.mountedScroller === scroller && this.mountedMode === mode) {
                this.controller.requestPaint();
            }
        });
        window.setTimeout(() => {
            if (this.controller && this.mountedScroller === scroller && this.mountedMode === mode) {
                this.controller.requestPaint();
            }
        }, 80);
    }

    private async remountActiveEditor(): Promise<void> {
        await this.controller?.flush();
        await this.mountActiveEditor(true);
    }

    private async destroyController(): Promise<void> {
        if (this.controller) {
            const current = this.controller;
            this.controller = null;
            try {
                current.commitActiveStroke();
                await current.flush();
            } catch (error) {
                console.error('[ApoloCanvas] Final save failed:', error);
            } finally {
                current.destroy();
            }
        }
        this.mountedScroller = null;
        this.mountedFilePath = '';
        this.mountedMode = '';
    }

    async updateGlobalBgTheme(newTheme: BoxBgTheme): Promise<void> {
        this.settings.defaultBoxBgTheme = newTheme;
        await this.saveSettings();

        // 1. Update BoxRegistry and trigger Live Preview update
        BoxRegistry.updateAllBgThemes(newTheme);

        // 2. Update active controller if mounted
        if (this.controller) {
            this.controller.updateDefaultBoxBgTheme(newTheme);
        }

        // 3. Immediately dispatch boxRegistryUpdateEffect to all open CM6 editor leaves
        try {
            this.app.workspace.iterateAllLeaves(leaf => {
                const cm = (leaf.view as any)?.editor?.cm;
                if (cm && typeof cm.dispatch === 'function') {
                    cm.dispatch({
                        effects: boxRegistryUpdateEffect.of(),
                    });
                }
            });
        } catch (err) {
            console.error('[ApoloCanvas] Failed to dispatch update effect to leaves:', err);
        }

        // 4. Update all DOM elements in workspace (Reading mode, CM views)
        const spaceEls = document.querySelectorAll<HTMLElement>(
            '.apolo-space, .apolo-space-block, .apolo-space-widget, [data-apolo-space], [data-apolo-space-id]'
        );
        for (const el of Array.from(spaceEls)) {
            el.dataset.apoloBgTheme = newTheme;
            const boxId = el.dataset.apoloSpaceId || el.dataset.apoloSpace;
            const customBg = boxId ? BoxRegistry.getCustomBgColor(boxId) : null;
            if (customBg) {
                el.style.setProperty('background-color', customBg, 'important');
            } else if (newTheme === 'pitch-black') {
                el.style.setProperty('background-color', '#000000', 'important');
            } else if (newTheme === 'graphite') {
                el.style.setProperty('background-color', '#27272a', 'important');
            } else if (newTheme === 'transparent') {
                el.style.setProperty('background-color', 'transparent', 'important');
            } else {
                el.style.removeProperty('background-color');
            }
        }

        // 4. Update all vault box persistence files (.apolocanvas/boxes/*.json) retroactively
        try {
            const adapter = this.app.vault.adapter;
            if (await adapter.exists('.apolocanvas/boxes')) {
                const listing = await adapter.list('.apolocanvas/boxes');
                for (const filePath of listing.files) {
                    if (filePath.endsWith('.json')) {
                        try {
                            const raw = await adapter.read(filePath);
                            const parsed = JSON.parse(raw);
                            if (parsed && typeof parsed === 'object') {
                                parsed.bgTheme = newTheme;
                                await adapter.write(filePath, JSON.stringify(parsed));
                            }
                        } catch { /* skip invalid */ }
                    }
                }
            }
        } catch (err) {
            console.error('[ApoloCanvas] Failed to update vault boxes retroactively:', err);
        }
    }

    setDefaultBoxAccentColor(accent: BoxAccentColor): void {
        this.settings.defaultBoxAccentColor = accent;
        if (this.controller) {
            this.controller.setDefaultBoxAccentColor(accent);
        }
    }

    setPalmRejectionCooldown(ms: number): void {
        this.settings.palmRejectionCooldownMs = ms;
        this.controller?.setPalmRejectionCooldown(ms);
    }

    setSpenDebugHud(enabled: boolean): void {
        this.settings.showSpenDebugHud = enabled;
        this.controller?.setSpenDebugHud(enabled);
    }

    private async flushAndDestroy(): Promise<void> {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;
        this.mountGeneration++;
        try {
            this.controller?.commitActiveStroke();
            await this.persistence?.flush();
        } catch (error) {
            console.error('[ApoloCanvas] Flush failed during unload:', error);
        } finally {
            await this.destroyController();
        }
    }
}

class ApoloCanvasSettingsTab extends PluginSettingTab {
    private readonly plugin: ApoloCanvasPlugin;

    constructor(app: App, plugin: ApoloCanvasPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Apolo Canvas' });

        new Setting(containerEl)
            .setName('Posición de la barra')
            .setDesc('Ranura inicial donde se acopla la barra flotante.')
            .addDropdown(dd => dd
                .addOption('tc', 'Arriba centro (horizontal)')
                .addOption('tl', 'Arriba izquierda (horizontal)')
                .addOption('tr', 'Arriba derecha (horizontal)')
                .addOption('ml', 'Borde izquierdo (vertical)')
                .addOption('mr', 'Borde derecho (vertical)')
                .addOption('bc', 'Abajo centro (horizontal)')
                .addOption('bl', 'Abajo izquierda (horizontal)')
                .addOption('br', 'Abajo derecha (horizontal)')
                .setValue(this.plugin.settings.toolbarSlot)
                .onChange(async value => {
                    this.plugin.settings.toolbarSlot = value as ToolbarSlot;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Color por defecto de la pluma')
            .addColorPicker(color => color
                .setValue(this.plugin.settings.defaultPenColor)
                .onChange(async value => {
                    this.plugin.settings.defaultPenColor = value;
                    if (this.plugin.settings.toolState) {
                        this.plugin.settings.toolState.pen.color = value;
                    }
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Grosor por defecto')
            .addSlider(slider => slider
                .setLimits(1, 12, 0.5)
                .setValue(this.plugin.settings.defaultPenWidth)
                .setDynamicTooltip()
                .onChange(async value => {
                    this.plugin.settings.defaultPenWidth = value;
                    if (this.plugin.settings.toolState) {
                        this.plugin.settings.toolState.pen.width = value;
                    }
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Rechazo de palma S-Pen')
            .setDesc('Milisegundos de enfriamiento tras contacto del lápiz en que los toques de los dedos se ignoran.')
            .addSlider(slider => slider
                .setLimits(100, 1000, 25)
                .setValue(this.plugin.settings.palmRejectionCooldownMs)
                .setDynamicTooltip()
                .onChange(async value => {
                    this.plugin.setPalmRejectionCooldown(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Demora de autoguardado')
            .addSlider(slider => slider
                .setLimits(100, 2000, 100)
                .setValue(this.plugin.settings.autoSaveDebounceMs)
                .setDynamicTooltip()
                .onChange(async value => {
                    this.plugin.settings.autoSaveDebounceMs = value;
                    this.plugin.setAutoSaveDelay(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Modo lápiz activo')
            .setDesc('Permite dibujar directamente con el S-Pen sobre la nota.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.penInputEnabled)
                .onChange(async value => {
                    this.plugin.settings.penInputEnabled = value;
                    this.plugin.setPenInput(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Dibujo con ratón en escritorio')
            .setDesc('Permite dibujar usando el ratón además del S-Pen / stylus.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableMouseDrawing)
                .onChange(async value => {
                    this.plugin.setMouseDrawing(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Exportación companion SVG')
            .setDesc('Mantener copia SVG vectorial nativa en assets/ink sincronizada.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.companionSvgExport)
                .onChange(async value => {
                    this.plugin.settings.companionSvgExport = value;
                    this.plugin.setCompanionExport(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Hold-to-snap (Formas automáticas)')
            .setDesc('Líneas rectas y formas geométricas al mantener quieto 300 ms el trazo.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.shapeRecognition)
                .onChange(async value => {
                    this.plugin.settings.shapeRecognition = value;
                    this.plugin.setShapeRecognition(value);
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Perfiles de Favoritos' });

        new Setting(containerEl)
            .setName('Sincronizar perfiles de favoritos (Lápices y Formas)')
            .setDesc('Al cambiar de perfil de favoritos en Lápices o Marcadores, cambia automáticamente al perfil equivalente en Formas.')
            .addToggle(toggle => toggle
                .setValue(Boolean(this.plugin.settings.toolState?.syncFavoriteProfiles))
                .onChange(async value => {
                    this.plugin.toggleSyncFavoriteProfiles(value);
                    await this.plugin.saveSettings();
                }));

        const renderProfileSection = (
            heading: string,
            profiles: Array<{ id: string; name: string }>,
            addLabel: string,
            placeholder: string,
            onRename: (id: string, val: string) => Promise<boolean>,
            onDelete: (id: string) => Promise<boolean>,
            onCreate: (name: string) => Promise<void>,
        ) => {
            containerEl.createEl('h4', { text: heading });
            const canDelete = profiles.length > 1;
            profiles.forEach((prof) => {
                const setting = new Setting(containerEl)
                    .addText(text => text.setValue(prof.name).setPlaceholder('Nombre del perfil').onChange(async val => { await onRename(prof.id, val); }))
                    .addExtraButton(btn => btn
                        .setIcon('trash')
                        .setTooltip(canDelete ? 'Eliminar perfil' : 'No se puede eliminar el único perfil')
                        .setDisabled(!canDelete)
                        .onClick(async () => { if (canDelete) { await onDelete(prof.id); this.display(); } }));
                setting.settingEl.style.borderTop = 'none';
                setting.settingEl.style.padding = '4px 0';
            });
            let newName = '';
            new Setting(containerEl)
                .setName(addLabel)
                .addText(text => text.setPlaceholder(placeholder).onChange(val => { newName = val; }))
                .addButton(btn => btn.setButtonText('+ Añadir').setCta().onClick(async () => {
                    await onCreate(newName.trim() || 'Nuevo perfil');
                    newName = '';
                    this.display();
                }));
        };

        renderProfileSection(
            'Perfiles de Trazos (Plumas y Marcadores)',
            this.plugin.getStrokeFavoriteProfiles(),
            'Añadir perfil de trazos',
            'Ej: Matemáticas',
            (id, val) => this.plugin.renameStrokeProfile(id, val),
            (id) => this.plugin.deleteStrokeProfile(id),
            (name) => this.plugin.createStrokeProfile(name),
        );
        renderProfileSection(
            'Perfiles de Formas',
            this.plugin.getShapeFavoriteProfiles(),
            'Añadir perfil de formas',
            'Ej: Diagramas',
            (id, val) => this.plugin.renameShapeProfile(id, val),
            (id) => this.plugin.deleteShapeProfile(id),
            (name) => this.plugin.createShapeProfile(name),
        );

        containerEl.createEl('h3', { text: 'Cajas de Dibujo (Canvas)' });

        new Setting(containerEl)
            .setName('Altura inicial por defecto')
            .setDesc('Altura en píxeles al insertar un nuevo canvas debajo del bloque activo.')
            .addText(text => text
                .setPlaceholder('280')
                .setValue(String(this.plugin.settings.defaultBoxHeight || 280))
                .onChange(async value => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num >= 120 && num <= 3000) {
                        this.plugin.settings.defaultBoxHeight = num;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Estilo de rejilla por defecto')
            .setDesc('Patrón de fondo para nuevas cajas de dibujo.')
            .addDropdown(dd => dd
                .addOption('dots', 'Puntos (Dots)')
                .addOption('grid', 'Cuadrícula (Grid)')
                .addOption('ruled', 'Rayas horizontales (Ruled)')
                .addOption('none', 'En blanco (Sin rejilla)')
                .setValue(this.plugin.settings.defaultBoxGridStyle || 'dots')
                .onChange(async value => {
                    this.plugin.settings.defaultBoxGridStyle = value as BoxGridStyle;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Densidad de la rejilla por defecto')
            .setDesc('Número de divisiones relativas al ancho de la columna (ancho / N).')
            .addDropdown(dd => dd
                .addOption('40', 'Fina (40 divisiones)')
                .addOption('32', 'Normal (32 divisiones)')
                .addOption('24', 'Amplia (24 divisiones)')
                .setValue(String(this.plugin.settings.defaultBoxGridDensity || 32))
                .onChange(async value => {
                    this.plugin.settings.defaultBoxGridDensity = parseInt(value, 10);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Tema de fondo por defecto')
            .setDesc('Color y apariencia del fondo de las cajas de dibujo (afecta a todos los canvas retroactivamente).')
            .addDropdown(dd => dd
                .addOption('default', 'Gris oscuro (#1f1f21)')
                .addOption('pitch-black', 'Negro puro (#000000 - OLED)')
                .addOption('graphite', 'Gris grafito (#27272a)')
                .addOption('transparent', 'Transparente (Sin fondo)')
                .setValue(this.plugin.settings.defaultBoxBgTheme || 'default')
                .onChange(async value => {
                    await this.plugin.updateGlobalBgTheme(value as BoxBgTheme);
                }));

        new Setting(containerEl)
            .setName('Color de fondo personalizado (Opcional)')
            .setDesc('Color hexadecimal si deseas un tono específico en lugar de los predefinidos (ej. #18181b).')
            .addText(text => text
                .setPlaceholder('#1f1f21')
                .setValue(this.plugin.settings.defaultBoxCustomBgColor || '')
                .onChange(async value => {
                    this.plugin.settings.defaultBoxCustomBgColor = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Color de acento lateral por defecto')
            .setDesc('Franja de color identificativa en el borde izquierdo de la caja (solo para nuevos espacios).')
            .addDropdown(dd => dd
                .addOption('purple', 'Morado (#a98bff)')
                .addOption('blue', 'Azul (#3b82f6)')
                .addOption('emerald', 'Esmeralda (#10b981)')
                .addOption('amber', 'Ámbar (#f59e0b)')
                .addOption('coral', 'Coral (#f43f5e)')
                .addOption('neutral', 'Gris neutro')
                .addOption('none', 'Desactivado (Sin barra)')
                .setValue(this.plugin.settings.defaultBoxAccentColor || 'purple')
                .onChange(async value => {
                    this.plugin.setDefaultBoxAccentColor(value as BoxAccentColor);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Contorno exterior (Borde de 1px)')
            .setDesc('Activa un sutil borde perimetral de 1px alrededor de toda la tarjeta además del acento izquierdo.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.defaultBoxBorderOutline ?? false)
                .onChange(async value => {
                    this.plugin.settings.defaultBoxBorderOutline = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Diagnóstico de eventos S-Pen en pantalla')
            .setDesc('Muestra un panel flotante semitransparente con los últimos eventos del lápiz (pointerdown, pointermove, contextmenu) para depuración en tabletas.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showSpenDebugHud ?? false)
                .onChange(async value => {
                    this.plugin.setSpenDebugHud(value);
                    await this.plugin.saveSettings();
                }));
    }
}

async function ensureFolder(app: App, path: string): Promise<void> {
    const adapter = app.vault.adapter;
    if (!(await adapter.exists(path))) await adapter.mkdir(path);
}
