import { App, FileView, Keymap, MarkdownView, Notice, Plugin, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import type { CanvasController } from '../engine/CanvasController.ts';
import type { PersistenceQueue } from './PersistenceQueue.ts';
import {
    applyFileExplorerCloaking,
    attachMakeMdBridge,
    clearKnownApnotes,
    ensureDirectory,
    ensureNoteInBundleFolder,
    exportAsPortableApnote,
    getApnoteTriggerPath,
    getBundledMdPath,
    getNoteBundleFolderPath,
    importPortableApnote,
    isInsideNoteBundleFolder,
    isZipApnote,
    normalizeVaultNotePath,
    parseApnoteManifest,
    parseSatelliteFilename,
    registerKnownApnote,
    removeFileExplorerCloaking,
    resolveBundleFolderPaths,
    resolveMdFromTrigger,
    splitNotePath,
    syncMakeMdBundleState,
} from './ApnoteBundle.ts';

export const APOLO_NOTE_VIEW_TYPE = 'apolo-note-view';

export interface ApnoteWorkspaceHost {
    plugin: Plugin;
    app: App;
    isShuttingDown: () => boolean;
    getPersistence: () => PersistenceQueue | undefined;
    getController: () => CanvasController | null;
    getMountedFilePath: () => string;
    setMountedFilePath: (path: string) => void;
    destroyController: () => Promise<void>;
    mountActiveEditor: () => Promise<void>;
    onLayoutReadyMount: () => void;
}

class ApoloNoteRedirectView extends FileView {
    constructor(leaf: WorkspaceLeaf, private readonly workspaceCoordinator: ApnoteWorkspaceCoordinator) {
        super(leaf);
        this.allowNoFile = false;
        this.navigation = true;
    }

    getViewType(): string {
        return APOLO_NOTE_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file?.basename || 'Apolo Note';
    }

    canAcceptExtension(extension: string): boolean {
        return extension.toLowerCase() === 'apnote';
    }

    async onLoadFile(file: TFile): Promise<void> {
        await super.onLoadFile(file);
        window.setTimeout(() => {
            void this.workspaceCoordinator.handleApnoteFileOpen(file, this.leaf);
        }, 0);
    }
}

/**
 * Coordinates the Obsidian workspace lifecycle for `.apnote` bundles:
 * extension redirection, portable archive import/export, atomic vault rename/delete sync,
 * File Explorer cloaking, and optional Make.md virtual-tree adaptation.
 */
export class ApnoteWorkspaceCoordinator {
    private explorerObserver: MutationObserver | null = null;
    private explorerObservedContainers = new WeakSet<Node>();
    private cloakingRafId: number | null = null;
    private cleanupMakeMdBridge: (() => void) | null = null;
    private redirectingMakeMdLeaves = new WeakSet<WorkspaceLeaf>();
    private syncingRenames = new Set<string>();
    private syncingDeletes = new Set<string>();

    constructor(private readonly host: ApnoteWorkspaceHost) {}

    register(): void {
        const { plugin, app } = this.host;

        plugin.registerView(APOLO_NOTE_VIEW_TYPE, (leaf) => new ApoloNoteRedirectView(leaf, this));
        plugin.registerExtensions(['apnote'], APOLO_NOTE_VIEW_TYPE);
        for (const f of app.vault.getFiles()) {
            if (f.path.toLowerCase().endsWith('.apnote')) {
                registerKnownApnote(f.path);
            }
        }

        plugin.registerEvent(app.workspace.on('active-leaf-change', () => {
            this.redirectMakeMdBundleLeaves();
            void this.host.mountActiveEditor();
            this.scheduleCloaking();
        }));
        plugin.registerEvent(app.workspace.on('layout-change', () => {
            this.redirectMakeMdBundleLeaves();
            void this.host.mountActiveEditor();
            this.scheduleCloaking();
        }));
        plugin.registerEvent(app.workspace.on('file-open', (openedFile) => {
            void this.host.mountActiveEditor();
            if (openedFile instanceof TFile && openedFile.extension.toLowerCase() === 'apnote') {
                registerKnownApnote(openedFile.path);
            }
            this.scheduleCloaking();
        }));

        this.registerFileMenu();
        this.registerVaultEvents();
        this.registerLayoutReadySync();
        this.registerExplorerClickHandler();
    }

    private registerFileMenu(): void {
        const { plugin, app } = this.host;
        plugin.registerEvent(app.workspace.on('file-menu', (menu, abstractFile) => {
            let targetFile: TFile | null = null;
            if (abstractFile instanceof TFile) {
                const ext = abstractFile.extension.toLowerCase();
                if (ext === 'md' || ext === 'apnote') {
                    targetFile = abstractFile;
                }
            } else if (abstractFile instanceof TFolder) {
                const bundle = resolveBundleFolderPaths(abstractFile.path, app.vault);
                if (bundle) {
                    const md = app.vault.getAbstractFileByPath(bundle.mdPath);
                    if (md instanceof TFile) {
                        targetFile = md;
                    }
                }
            }
            if (!targetFile) return;
            const exportFile = targetFile;
            menu.addItem((item) => {
                item.setTitle('Export note as portable .apnote package')
                    .setIcon('package')
                    .onClick(() => {
                        void this.exportNoteAsPortablePackage(exportFile);
                    });
            });
        }));
    }

    private registerVaultEvents(): void {
        const { plugin, app } = this.host;

        plugin.registerEvent(app.vault.on('create', (file) => {
            if (!(file instanceof TFile)) return;
            const ext = file.extension.toLowerCase();
            if (ext === 'apnote') {
                registerKnownApnote(file.path);
                this.scheduleCloaking();
            } else if (ext === 'md') {
                this.scheduleCloaking();
            }
        }));

        plugin.registerEvent(app.vault.on('rename', async (file, oldPath) => {
            await this.handleVaultRename(file, oldPath);
        }));

        plugin.registerEvent(app.vault.on('delete', async (file) => {
            if (!(file instanceof TFile)) return;
            if (this.syncingDeletes.has(file.path)) return;

            const parsed = parseSatelliteFilename(file.path);
            if (!parsed || (parsed.kind !== 'md' && parsed.kind !== 'apnote')) {
                this.scheduleCloaking();
                return;
            }

            this.syncingDeletes.add(parsed.mdPath);
            this.syncingDeletes.add(parsed.apnotePath);
            try {
                if (this.host.getMountedFilePath() === parsed.mdPath || this.host.getMountedFilePath() === file.path) {
                    await this.host.destroyController();
                }
                await this.host.getPersistence()?.onFileDeleted(file.path);
            } finally {
                this.syncingDeletes.delete(parsed.mdPath);
                this.syncingDeletes.delete(parsed.apnotePath);
                this.scheduleCloaking();
            }
        }));
    }

    private async handleVaultRename(file: unknown, oldPath: string): Promise<void> {
        const { app } = this.host;
        const persistence = this.host.getPersistence();
        const controller = this.host.getController();

        if (persistence?.isInternalRename(oldPath, (file as { path?: string }).path)) {
            const newPath = (file as { path: string }).path;
            if (this.host.getMountedFilePath() === oldPath) {
                this.host.setMountedFilePath(newPath);
            }
            if (file instanceof TFile) {
                controller?.onFileRenamed(file, oldPath);
            }
            this.scheduleCloaking();
            return;
        }

        if (file instanceof TFolder) {
            await this.handleBundleFolderRename(file, oldPath);
            return;
        }

        if (!(file instanceof TFile)) return;
        if (this.syncingRenames.has(oldPath) || this.syncingRenames.has(file.path)) return;

        const parsedOld = parseSatelliteFilename(oldPath);
        const parsedNew = parseSatelliteFilename(file.path);
        const isPrimaryNoteOrTrigger =
            (parsedOld && (parsedOld.kind === 'md' || parsedOld.kind === 'apnote')) ||
            (parsedNew && (parsedNew.kind === 'md' || parsedNew.kind === 'apnote'));

        if (!isPrimaryNoteOrTrigger) {
            this.scheduleCloaking();
            return;
        }

        let sourceForSync = oldPath;
        let effectiveNewPath = file.path;
        if (isInsideNoteBundleFolder(oldPath)) {
            const oldSplit = splitNotePath(oldPath);
            const newSplit = splitNotePath(file.path);
            if (oldSplit.baseName === newSplit.baseName && !isInsideNoteBundleFolder(file.path) && newSplit.dir) {
                const newFolderName = newSplit.dir.slice(newSplit.dir.lastIndexOf('/') + 1);
                effectiveNewPath = `${newSplit.dir}/${newFolderName}.md`;
                if (await app.vault.adapter.exists(file.path)) {
                    sourceForSync = file.path;
                }
            } else if (oldSplit.dir === newSplit.dir && oldSplit.baseName !== newSplit.baseName) {
                const oldParentDir = oldSplit.dir.includes('/') ? oldSplit.dir.slice(0, oldSplit.dir.lastIndexOf('/')) : '';
                effectiveNewPath = `${oldParentDir ? `${oldParentDir}/` : ''}${newSplit.baseName}/${newSplit.baseName}.md`;
            }
        }

        const parsedTarget = parseSatelliteFilename(effectiveNewPath);
        const oldMdPath = parsedOld?.mdPath ?? oldPath;
        const newMdPath = parsedTarget?.mdPath ?? effectiveNewPath;
        const oldApnotePath = parsedOld?.apnotePath ?? getApnoteTriggerPath(oldPath);
        const newApnotePath = parsedTarget?.apnotePath ?? getApnoteTriggerPath(effectiveNewPath);

        const trackedPaths = [oldPath, file.path, sourceForSync, oldMdPath, newMdPath, oldApnotePath, newApnotePath];
        trackedPaths.forEach((p) => this.syncingRenames.add(p));

        try {
            try {
                controller?.commitActiveStroke();
                await persistence?.flush();
            } catch (err) {
                console.error('[ApoloCanvas] Flush failed before rename:', err);
            }

            if (effectiveNewPath !== file.path && (await app.vault.adapter.exists(file.path)) && !(await app.vault.adapter.exists(newMdPath))) {
                const targetDir = newMdPath.includes('/') ? newMdPath.slice(0, newMdPath.lastIndexOf('/')) : '';
                if (targetDir) {
                    await ensureDirectory(app.vault.adapter, targetDir);
                }
                await app.vault.rename(file, newMdPath);
            }

            const mounted = this.host.getMountedFilePath();
            if (mounted === oldMdPath || mounted === oldPath || mounted === file.path) {
                this.host.setMountedFilePath(newMdPath);
            }

            await persistence?.onFileRenamed(sourceForSync, newMdPath);

            const movedMdFile = app.vault.getAbstractFileByPath(newMdPath);
            if (movedMdFile instanceof TFile) {
                controller?.onFileRenamed(movedMdFile, oldMdPath);
            } else {
                controller?.onFileRenamed(file, oldMdPath);
            }
        } finally {
            trackedPaths.forEach((p) => this.syncingRenames.delete(p));
            this.scheduleCloaking();
        }
    }

    private async handleBundleFolderRename(folder: TFolder, oldPath: string): Promise<void> {
        const { app } = this.host;
        const persistence = this.host.getPersistence();
        const controller = this.host.getController();

        const normOld = normalizeVaultNotePath(oldPath);
        const normNew = normalizeVaultNotePath(folder.path);
        const oldFolderName = normOld.includes('/') ? normOld.slice(normOld.lastIndexOf('/') + 1) : normOld;
        const newFolderName = normNew.includes('/') ? normNew.slice(normNew.lastIndexOf('/') + 1) : normNew;

        if (!oldFolderName || !newFolderName || oldFolderName === newFolderName) {
            this.scheduleCloaking();
            return;
        }

        const currentApnotePath = `${normNew}/${oldFolderName}.apnote`;
        const currentMdPath = `${normNew}/${oldFolderName}.md`;
        const nextMdPath = `${normNew}/${newFolderName}.md`;
        const nextApnotePath = `${normNew}/${newFolderName}.apnote`;
        const oldOriginalMdPath = `${normOld}/${oldFolderName}.md`;
        const hasInnerApnote = await app.vault.adapter.exists(currentApnotePath);
        const hasInnerMd = await app.vault.adapter.exists(currentMdPath);

        if ((hasInnerApnote || hasInnerMd) && !this.syncingRenames.has(currentMdPath) && !this.syncingRenames.has(nextMdPath)) {
            const trackedPaths = [oldPath, folder.path, oldOriginalMdPath, currentMdPath, nextMdPath, currentApnotePath, nextApnotePath];
            trackedPaths.forEach((p) => this.syncingRenames.add(p));
            try {
                try {
                    controller?.commitActiveStroke();
                    await persistence?.flush();
                } catch (err) {
                    console.error('[ApoloCanvas] Flush failed before bundle folder rename:', err);
                }
                const mounted = this.host.getMountedFilePath();
                if (mounted === oldOriginalMdPath || mounted === currentMdPath) {
                    this.host.setMountedFilePath(nextMdPath);
                }
                await persistence?.onFileRenamed(currentMdPath, nextMdPath);
                const movedMdFile = app.vault.getAbstractFileByPath(nextMdPath);
                if (movedMdFile instanceof TFile) {
                    controller?.onFileRenamed(movedMdFile, oldOriginalMdPath);
                }
            } finally {
                trackedPaths.forEach((p) => this.syncingRenames.delete(p));
                this.scheduleCloaking();
            }
        } else {
            this.scheduleCloaking();
        }
    }

    private registerLayoutReadySync(): void {
        const { app } = this.host;
        app.workspace.onLayoutReady(() => {
            for (const f of app.vault.getFiles()) {
                if (f.path.toLowerCase().endsWith('.apnote')) {
                    registerKnownApnote(f.path);
                }
            }
            this.ensureMakeMdIntegration();
            this.redirectMakeMdBundleLeaves();
            this.refreshCloaking();
            this.host.onLayoutReadyMount();

            void (async () => {
                for (const f of app.vault.getFiles()) {
                    if (f.path.toLowerCase().endsWith('.apnote')) {
                        registerKnownApnote(f.path);
                        if (!isInsideNoteBundleFolder(f.path)) {
                            const targetMd = getBundledMdPath(f.path);
                            this.syncingRenames.add(f.path);
                            this.syncingRenames.add(targetMd);
                            try {
                                await ensureNoteInBundleFolder(app.vault, f.path);
                            } catch (err) {
                                console.warn('[ApoloCanvas] Bundle folder migration skipped for', f.path, err);
                            } finally {
                                this.syncingRenames.delete(f.path);
                                this.syncingRenames.delete(targetMd);
                            }
                        }
                    }
                }
                this.ensureMakeMdIntegration();
                this.redirectMakeMdBundleLeaves();
                this.scheduleCloaking();

                const apnoteLeaves = app.workspace.getLeavesOfType(APOLO_NOTE_VIEW_TYPE);
                for (const leaf of apnoteLeaves) {
                    const viewFile = (leaf.view as FileView | undefined)?.file;
                    const stateFilePath = (leaf.getViewState()?.state as { file?: string } | undefined)?.file;
                    const candidatePath = viewFile instanceof TFile ? viewFile.path : stateFilePath;
                    if (!candidatePath) continue;
                    const bundledApnotePath = !isInsideNoteBundleFolder(candidatePath)
                        ? getApnoteTriggerPath(getBundledMdPath(candidatePath))
                        : candidatePath;
                    const targetApnote = app.vault.getAbstractFileByPath(candidatePath)
                        ?? app.vault.getAbstractFileByPath(bundledApnotePath);
                    if (targetApnote instanceof TFile) {
                        void this.handleApnoteFileOpen(targetApnote, leaf);
                    }
                }
            })();
        });
    }

    private registerExplorerClickHandler(): void {
        if (typeof document === 'undefined') return;
        const { plugin, app } = this.host;
        plugin.registerDomEvent(document, 'click', (evt: MouseEvent) => {
            if (evt.button !== 0 || evt.defaultPrevented) return;
            const target = evt.target instanceof Element ? evt.target : null;
            if (!target || target.closest('input')) return;
            const inExplorer = Boolean(target.closest('.nav-files-container, .mk-path-tree'));
            const titleEl = inExplorer
                ? target.closest<HTMLElement>('[data-path]')
                : target.closest<HTMLElement>('.nav-file-title[data-path], .nav-folder-title[data-path], .tree-item-self[data-path], .mk-tree-item[data-path]');
            if (!titleEl || titleEl.classList.contains('is-being-renamed')) return;
            const rawPath = titleEl.dataset.path || titleEl.getAttribute('data-path') || '';
            if (!rawPath) return;

            const bundle = resolveBundleFolderPaths(rawPath, app.vault);
            if (bundle) {
                evt.preventDefault();
                evt.stopPropagation();
                evt.stopImmediatePropagation();
                registerKnownApnote(bundle.apnotePath);
                const leaf = app.workspace.getLeaf(Keymap.isModEvent(evt));
                const mdFile = app.vault.getAbstractFileByPath(bundle.mdPath);
                if (mdFile instanceof TFile) {
                    void leaf.openFile(mdFile);
                } else {
                    const apnoteFile = app.vault.getAbstractFileByPath(bundle.apnotePath);
                    if (apnoteFile instanceof TFile) {
                        void this.handleApnoteFileOpen(apnoteFile, leaf);
                    }
                }
                return;
            }

            if (!rawPath.toLowerCase().endsWith('.apnote')) return;

            const apnoteFile = app.vault.getAbstractFileByPath(rawPath);
            if (!(apnoteFile instanceof TFile)) return;

            evt.preventDefault();
            evt.stopPropagation();
            registerKnownApnote(apnoteFile.path);
            const leaf = app.workspace.getLeaf(Keymap.isModEvent(evt));
            void this.handleApnoteFileOpen(apnoteFile, leaf);
        }, true);
    }

    private ensureMakeMdIntegration(): void {
        if (this.host.isShuttingDown()) return;
        const { app } = this.host;
        const makeMd = (app as unknown as {
            plugins?: { plugins?: Record<string, { superstate?: { dispatchEvent?: (event: string, payload?: unknown) => void } }> };
        })?.plugins?.plugins?.['make-md'];
        if (!makeMd?.superstate) return;

        if (!this.cleanupMakeMdBridge) {
            this.cleanupMakeMdBridge = attachMakeMdBridge(app, app.vault);
        } else if (syncMakeMdBundleState(app, app.vault)) {
            makeMd.superstate.dispatchEvent?.('superstateUpdated', null);
        }
    }

    redirectMakeMdBundleLeaves(): void {
        if (this.host.isShuttingDown()) return;
        const { app } = this.host;
        for (const viewType of ['mk-space', 'mk-flow']) {
            const leaves = app.workspace.getLeavesOfType(viewType);
            for (const leaf of leaves) {
                if (this.redirectingMakeMdLeaves.has(leaf)) continue;
                const statePath = (leaf.getViewState()?.state as { path?: unknown } | undefined)?.path;
                if (typeof statePath !== 'string' || !statePath) continue;
                const bundle = resolveBundleFolderPaths(statePath, app.vault);
                if (!bundle) continue;
                const mdFile = app.vault.getAbstractFileByPath(bundle.mdPath);
                if (!(mdFile instanceof TFile)) continue;
                this.redirectingMakeMdLeaves.add(leaf);
                void Promise.resolve(leaf.openFile(mdFile)).finally(() => {
                    this.redirectingMakeMdLeaves.delete(leaf);
                });
            }
        }
    }

    scheduleCloaking(): void {
        if (this.host.isShuttingDown() || typeof document === 'undefined') return;
        if (typeof requestAnimationFrame !== 'function') {
            this.refreshCloaking();
            return;
        }
        if (this.cloakingRafId !== null) return;
        this.cloakingRafId = requestAnimationFrame(() => {
            this.cloakingRafId = null;
            this.refreshCloaking();
        });
    }

    private refreshCloaking(): void {
        if (this.host.isShuttingDown() || typeof document === 'undefined') return;
        const { app } = this.host;
        this.ensureMakeMdIntegration();
        applyFileExplorerCloaking(document, app.vault, app.workspace.getActiveFile()?.path);

        if (typeof MutationObserver === 'undefined') return;
        if (!this.explorerObserver) {
            this.explorerObserver = new MutationObserver(() => {
                this.scheduleCloaking();
            });
        }
        const containers = document.querySelectorAll('.nav-files-container, .mk-path-tree, .view-header-title-container');
        for (let i = 0; i < containers.length; i++) {
            const container = containers[i];
            if (!this.explorerObservedContainers.has(container)) {
                this.explorerObservedContainers.add(container);
                this.explorerObserver.observe(container, { childList: true, subtree: true });
            }
        }
    }

    async handleApnoteFileOpen(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
        const { app } = this.host;
        try {
            registerKnownApnote(file.path);
            let bytes: ArrayBuffer;
            if (typeof app.vault.readBinary === 'function') {
                bytes = await app.vault.readBinary(file);
            } else {
                bytes = await app.vault.adapter.readBinary(file.path);
            }

            let targetMdPath = resolveMdFromTrigger(file.path);
            if (isZipApnote(bytes)) {
                const { baseName } = splitNotePath(file.path);
                const bundleDir = getNoteBundleFolderPath(file.path);
                targetMdPath = await importPortableApnote(app.vault, bytes, bundleDir, baseName);
                const bundledApnotePath = `${bundleDir}/${baseName}.apnote`;
                registerKnownApnote(getApnoteTriggerPath(targetMdPath));
                if (file.path !== bundledApnotePath) {
                    try {
                        await app.vault.delete(file);
                    } catch {
                        if (await app.vault.adapter.exists(file.path)) {
                            await app.vault.adapter.remove(file.path);
                        }
                    }
                }
                this.scheduleCloaking();
                new Notice(`Apolo Canvas: Paquete .apnote importado (${baseName}).`);
            } else if (typeof TextDecoder !== 'undefined') {
                const rawText = new TextDecoder().decode(bytes);
                const manifest = parseApnoteManifest(rawText);
                if (manifest?.markdown) {
                    const { dir } = splitNotePath(file.path);
                    const manifestMd = normalizeVaultNotePath(dir ? `${dir}/${manifest.markdown}` : manifest.markdown);
                    if (manifestMd.toLowerCase().endsWith('.md')) {
                        targetMdPath = manifestMd;
                    }
                }
            }

            let targetFile = app.vault.getAbstractFileByPath(targetMdPath);
            if (!(targetFile instanceof TFile)) {
                await new Promise(resolve => setTimeout(resolve, 60));
                targetFile = app.vault.getAbstractFileByPath(targetMdPath);
            }
            if (!(targetFile instanceof TFile)) {
                if (await app.vault.adapter.exists(targetMdPath)) {
                    await new Promise(resolve => setTimeout(resolve, 80));
                    targetFile = app.vault.getAbstractFileByPath(targetMdPath);
                } else {
                    try {
                        targetFile = await app.vault.create(targetMdPath, '');
                    } catch {
                        targetFile = app.vault.getAbstractFileByPath(targetMdPath);
                    }
                }
            }

            for (let i = 0; i < 30 && (leaf as { working?: boolean }).working; i++) {
                await new Promise(resolve => setTimeout(resolve, 15));
            }

            if (targetFile instanceof TFile) {
                await leaf.openFile(targetFile);
                this.scheduleCloaking();
            } else {
                new Notice(`Apolo Canvas: No se encontró la nota Markdown asociada (${targetMdPath}).`);
            }
        } catch (err) {
            console.error('[ApoloCanvas] Error opening .apnote file:', err);
            new Notice('Apolo Canvas: No se pudo abrir el archivo .apnote.');
        }
    }

    async exportNoteAsPortablePackage(targetFile?: TFile | null): Promise<void> {
        const { app } = this.host;
        const persistence = this.host.getPersistence();
        const controller = this.host.getController();
        const sourceFile = targetFile ?? app.workspace.getActiveViewOfType(MarkdownView)?.file ?? app.workspace.getActiveFile();
        if (!sourceFile) {
            new Notice('Apolo Canvas: Abre o selecciona una nota para exportar como .apnote.');
            return;
        }

        const ext = sourceFile.extension.toLowerCase();
        if (ext !== 'md' && ext !== 'apnote') {
            new Notice('Apolo Canvas: Solo se pueden exportar notas Markdown o manifiestos .apnote.');
            return;
        }

        const mdPath = ext === 'apnote' ? resolveMdFromTrigger(sourceFile.path) : sourceFile.path;
        const { baseName } = splitNotePath(mdPath);

        try {
            controller?.commitActiveStroke();
            await persistence?.flush();
            const zipBuffer = await exportAsPortableApnote(app.vault, mdPath);

            if (
                typeof document !== 'undefined' &&
                typeof Blob !== 'undefined' &&
                typeof URL !== 'undefined' &&
                typeof URL.createObjectURL === 'function'
            ) {
                const blob = new Blob([zipBuffer], { type: 'application/zip' });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `${baseName}.apnote`;
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            }

            new Notice(`Apolo Canvas: Paquete portátil ${baseName}.apnote exportado (${zipBuffer.byteLength} bytes).`);
        } catch (err) {
            console.error('[ApoloCanvas] Failed to export portable .apnote package:', err);
            new Notice('Apolo Canvas: Error al exportar el paquete portátil .apnote.');
        }
    }

    destroy(): void {
        if (this.cleanupMakeMdBridge) {
            this.cleanupMakeMdBridge();
            this.cleanupMakeMdBridge = null;
        }
        if (this.cloakingRafId !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.cloakingRafId);
            this.cloakingRafId = null;
        }
        if (this.explorerObserver) {
            this.explorerObserver.disconnect();
            this.explorerObserver = null;
        }
        if (typeof document !== 'undefined') {
            removeFileExplorerCloaking(document);
            const hiddenEmbeds = document.querySelectorAll('.apolo-fallback-embed-hidden');
            for (let i = 0; i < hiddenEmbeds.length; i++) {
                hiddenEmbeds[i].classList.remove('apolo-fallback-embed-hidden');
            }
        }
        clearKnownApnotes();
    }
}
