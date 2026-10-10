import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { EngineEventBus } from './core/events';
import { BoundingBox, CanvasElement, PageDocument, PenFavorite, ToolbarSlot, ToolType } from './core/types';
import { CanvasController } from './engine/CanvasController';
import { PersistenceQueue } from './io/PersistenceQueue';
import { DEFAULT_FAVORITES } from './ui/theme';
import { openLocalGraph } from './ui/LinkSuggestModal';
import { apoloSpaceExtension } from './editor/ApoloSpaceExtension';

export interface ApoloCanvasSettings {
    defaultPenColor: string;
    defaultPenWidth: number;
    palmRejectionCooldownMs: number;
    autoSaveDebounceMs: number;
    companionSvgExport: boolean;
    penInputEnabled: boolean;
    enableMouseDrawing: boolean;
    shapeRecognition: boolean;
    toolbarSlot: ToolbarSlot;
    favorites: PenFavorite[];
    hasSeenHelpNotice: boolean;
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
    toolbarSlot: 'tc',
    favorites: [
        { profile: 'fountain', color: '#1F4FD8', width: 3 },
        { profile: 'ball', color: '#D9480F', width: 2 },
        { profile: 'fountain', color: '#6C3FD1', width: 2 },
        { profile: 'pencil', color: '#111827', width: 3 },
    ],
    hasSeenHelpNotice: false,
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

    async onload(): Promise<void> {
        await this.loadSettings();
        this.persistence = new PersistenceQueue(
            this.app,
            this.settings.autoSaveDebounceMs,
            () => new Notice('Apolo Canvas: El guardado falló; revisa la consola para más detalles.'),
        );
        this.persistence.setCompanionSvgEnabled(this.settings.companionSvgExport);

        await ensureFolder(this.app, '.apolocanvas');
        await ensureFolder(this.app, '.apolocanvas/data');

        // Register CM6 Live Preview widget extension for apolo-space blocks
        this.registerEditorExtension(apoloSpaceExtension);

        // Register Reading mode codeblock processor for apolo-space blocks
        this.registerMarkdownCodeBlockProcessor('apolo-space', (source, el) => {
            const heightMatch = source.match(/height:\s*(\d+)/i);
            const height = heightMatch ? Math.max(20, Math.min(2000, parseInt(heightMatch[1], 10))) : 200;
            const idMatch = source.match(/id:\s*([^\s\n\r]+)/i);
            const id = idMatch ? idMatch[1] : '';

            el.empty();
            el.addClass('apolo-space-block');
            el.dataset.apoloSpaceId = id;
            el.dataset.apoloHeight = String(height);
            el.style.height = `${height}px`;
            el.style.width = '100%';
            el.style.display = 'block';
            el.style.userSelect = 'none';
        });

        // Register Reading mode section info post-processor for precise paragraph anchoring
        this.registerMarkdownPostProcessor((el, ctx) => {
            const sectionInfo = ctx.getSectionInfo(el);
            if (sectionInfo) {
                el.dataset.apoloLineStart = String(sectionInfo.lineStart);
                el.dataset.apoloLineEnd = String(sectionInfo.lineEnd);
            }
        });

        // Status bar item (Desktop + Mobile fallback)
        this.saveStatusBarItem = this.addStatusBarItem();
        this.saveStatusBarItem.setText('Apolo Canvas: Guardado');
        this.eventBus.on('save:status', (isSaving) => {
            if (this.saveStatusBarItem) {
                this.saveStatusBarItem.setText(isSaving ? 'Apolo Canvas: Guardando…' : 'Apolo Canvas: Guardado');
            }
        });

        this.addSettingTab(new ApoloCanvasSettingsTab(this.app, this));
        this.registerCommands();

        this.registerEvent(this.app.workspace.on('active-leaf-change', () => { void this.mountActiveEditor(); }));
        this.registerEvent(this.app.workspace.on('layout-change', () => { void this.mountActiveEditor(); }));
        this.registerEvent(this.app.workspace.on('editor-change', () => this.controller?.onEditorChange()));
        this.registerEvent(this.app.workspace.on('file-open', () => { void this.mountActiveEditor(); }));

        this.app.workspace.onLayoutReady(() => {
            void this.mountActiveEditor();
            this.showFirstTimeNoticeIfNeeded();
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
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...(saved ?? {}),
            favorites: saved?.favorites && saved.favorites.length === 4
                ? saved.favorites
                : [...DEFAULT_FAVORITES],
        };
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    setAutoSaveDelay(value: number): void { this.persistence?.setDebounceMs(value); }
    setCompanionExport(value: boolean): void { this.persistence?.setCompanionSvgEnabled(value); }
    setShapeRecognition(value: boolean): void { this.controller?.setShapeRecognition(value); }

    setPenInput(value: boolean): void {
        this.settings.penInputEnabled = value;
        this.controller?.setPenEnabled(value);
        void this.saveSettings();
    }

    setMouseDrawing(value: boolean): void {
        if (this.settings.enableMouseDrawing === value) return;
        this.settings.enableMouseDrawing = value;
        void this.remountActiveEditor();
    }

    private registerCommands(): void {
        this.addCommand({
            id: 'apolo-toggle-pen',
            name: 'Apolo Canvas: Alternar modo lápiz / modo teclado',
            callback: () => {
                this.settings.penInputEnabled = !this.settings.penInputEnabled;
                this.controller?.setPenEnabled(this.settings.penInputEnabled);
                void this.saveSettings();
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

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            if (event.shiftKey) this.controller?.redo();
            else this.controller?.undo();
            return;
        }

        // Printable text key press -> switch to text editing mode automatically
        if (!event.ctrlKey && !event.altKey && !event.metaKey && (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Enter')) {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (view && view.getMode() === 'source' && view.editor) {
                this.controller?.setPenEnabled(false);
                view.editor.focus();
            }
        }
    };

    private async mountActiveEditor(force = false): Promise<void> {
        const generation = ++this.mountGeneration;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const file = view?.file;
        const mode = view?.getMode();

        if (!view || !file || (mode !== 'source' && mode !== 'preview')) {
            this.destroyController();
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
        this.destroyController();
        const pageId = await this.ensurePageId(file);

        if (!inMemoryDoc) {
            await this.persistence.flush();
        }

        const documentModel = inMemoryDoc ?? (await this.loadDocument(file, pageId));
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
                toolbarSlot: this.settings.toolbarSlot,
                favorites: this.settings.favorites,
                eventBus: this.eventBus,
                app: this.app,
                viewContainer: view.contentEl,
                readonly: mode !== 'source',
                getScroll: () => {
                    if (mode === 'preview') {
                        return (view as any).previewMode?.getScroll?.() ?? scroller.scrollTop;
                    }
                    return scroller.scrollTop;
                },
                onPenEnabledChange: (enabled: boolean) => {
                    this.settings.penInputEnabled = enabled;
                    void this.saveSettings();
                },
                onToolbarSlotChange: (slot: ToolbarSlot) => {
                    this.settings.toolbarSlot = slot;
                    void this.saveSettings();
                },
                onFavoritesChange: (favs: PenFavorite[]) => {
                    this.settings.favorites = favs;
                    void this.saveSettings();
                },
            },
        );

        this.mountedScroller = scroller;
        this.mountedFilePath = file.path;
        this.mountedMode = mode;

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

    private async ensurePageId(file: TFile): Promise<string> {
        const current = this.app.metadataCache.getFileCache(file)?.frontmatter?.['apolo-page-id'];
        if (typeof current === 'string' && current.length > 0) return current;
        let pageId = createId();
        await this.app.fileManager.processFrontMatter(file, frontmatter => {
            const existing = frontmatter['apolo-page-id'];
            if (typeof existing === 'string' && existing.length > 0) pageId = existing;
            else frontmatter['apolo-page-id'] = pageId;
        });
        return pageId;
    }

    private async loadDocument(file: TFile, pageId: string): Promise<PageDocument> {
        const path = `.apolocanvas/data/${pageId}.json`;
        const adapter = this.app.vault.adapter;
        if (await adapter.exists(path)) {
            try {
                const parsed: unknown = JSON.parse(await adapter.read(path));
                if (isPageDocument(parsed)) {
                    parsed.notePath = file.path;
                    return parsed;
                }
            } catch (error) {
                console.error(`[ApoloCanvas] Could not load ${path}`, error);
                new Notice('Apolo Canvas: no se pudo leer la tinta; el archivo original fue preservado.');
            }
        }
        const now = Date.now();
        return { schemaVersion: 1, version: 1, id: pageId, notePath: file.path, elements: [], createdAt: now, updatedAt: now };
    }

    private destroyController(): void {
        if (this.controller) {
            const current = this.controller;
            void current.flush().catch(error => console.error('[ApoloCanvas] Final save failed:', error));
            current.destroy();
        }
        this.controller = null;
        this.mountedScroller = null;
        this.mountedFilePath = '';
        this.mountedMode = '';
    }

    private async flushAndDestroy(): Promise<void> {
        this.mountGeneration++;
        try {
            await this.controller?.flush();
            await this.persistence?.flush();
        } catch (error) {
            console.error('[ApoloCanvas] Flush failed during unload:', error);
        }
        this.destroyController();
    }
}

class ApoloCanvasSettingsTab extends PluginSettingTab {
    constructor(app: App, private readonly plugin: ApoloCanvasPlugin) { super(app, plugin); }

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
                    this.plugin.settings.palmRejectionCooldownMs = value;
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
    }
}

async function ensureFolder(app: App, path: string): Promise<void> {
    const adapter = app.vault.adapter;
    if (!(await adapter.exists(path))) await adapter.mkdir(path);
}

function createId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `apolo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isPageDocument(value: unknown): value is PageDocument {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Partial<PageDocument>;
    return (candidate.schemaVersion === 1 || typeof candidate.version === 'number')
        && typeof candidate.id === 'string'
        && typeof candidate.notePath === 'string'
        && Array.isArray(candidate.elements)
        && candidate.elements.every(isCanvasElement)
        && typeof candidate.createdAt === 'number'
        && typeof candidate.updatedAt === 'number';
}

function isCanvasElement(value: unknown): value is CanvasElement {
    if (typeof value !== 'object' || value === null) return false;
    const element = value as Partial<CanvasElement>;
    if (typeof element.id !== 'string' || typeof element.timestamp !== 'number'
        || typeof element.zIndex !== 'number' || !validBounds(element.bounds)
        || typeof element.style !== 'object' || element.style === null) return false;
    if (element.type === 'stroke') return Array.isArray(element.points) && element.points.length % 4 === 0;
    return element.type === 'shape' && typeof element.startX === 'number' && typeof element.startY === 'number'
        && typeof element.endX === 'number' && typeof element.endY === 'number';
}

function validBounds(value: unknown): value is BoundingBox {
    if (typeof value !== 'object' || value === null) return false;
    const bounds = value as Partial<BoundingBox>;
    return typeof bounds.minX === 'number' && typeof bounds.minY === 'number'
        && typeof bounds.maxX === 'number' && typeof bounds.maxY === 'number';
}
