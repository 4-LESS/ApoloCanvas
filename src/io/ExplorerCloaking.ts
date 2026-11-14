import {
    getKnownApnotePaths,
    isInsideNoteBundleFolder,
    isSatelliteFile,
    normalizeVaultNotePath,
    parseSatelliteFilename,
    registerKnownApnote,
    resolveBundleFolderPaths,
    splitNotePath,
    type VaultLike,
} from './ApnotePaths.ts';

export const APOLO_SATELLITE_HIDDEN_CLASS = 'apolo-satellite-hidden';
export const APOLO_APNOTE_ITEM_CLASS = 'apolo-apnote-item';
export const APOLO_BUNDLE_FOLDER_CLASS = 'apolo-bundle-folder';
export const APOLO_BREADCRUMB_HIDDEN_CLASS = 'apolo-breadcrumb-bundle-hidden';

/** Collects all known and vault-resident `.apnote` trigger paths. */
export function collectKnownAndVaultApnotes(
    vault?: VaultLike,
    pathsIndex?: Map<string, unknown>,
): Set<string> {
    const apnoteSet = new Set<string>(getKnownApnotePaths());
    if (vault?.getFiles) {
        for (const f of vault.getFiles()) {
            const norm = normalizeVaultNotePath(f.path);
            if (norm.toLowerCase().endsWith('.apnote')) {
                apnoteSet.add(norm);
                registerKnownApnote(norm);
            }
        }
    }
    if (pathsIndex instanceof Map) {
        for (const rawPath of pathsIndex.keys()) {
            const norm = normalizeVaultNotePath(rawPath);
            if (norm.toLowerCase().endsWith('.apnote')) {
                apnoteSet.add(norm);
                registerKnownApnote(norm);
            }
        }
    }
    return apnoteSet;
}

/**
 * Cloaks internal bundle files inside Obsidian's File Explorer, Make.md's Spaces Navigator,
 * and native view-header breadcrumbs whenever `<BaseName>.apnote` or a bundle folder exists.
 */
export function applyFileExplorerCloaking(root: ParentNode, vault?: VaultLike, activeFilePath?: string | null): void {
    const items = root.querySelectorAll<HTMLElement>(
        '.nav-file-title[data-path], .nav-folder-title[data-path], .tree-item-self[data-path], .mk-tree-item[data-path]',
    );
    const apnoteSet = collectKnownAndVaultApnotes(vault);
    const activeApnotePaths = new Set<string>();

    if (activeFilePath) {
        const parsedActive = parseSatelliteFilename(activeFilePath);
        if (parsedActive && (parsedActive.kind === 'md' || parsedActive.kind === 'apnote')) {
            activeApnotePaths.add(parsedActive.apnotePath);
        } else {
            const activeBundle = resolveBundleFolderPaths(activeFilePath, vault);
            if (activeBundle) {
                activeApnotePaths.add(activeBundle.apnotePath);
            }
        }
    }

    for (let i = 0; i < items.length; i++) {
        const titleEl = items[i];
        const path = titleEl.dataset?.path || titleEl.getAttribute('data-path') || '';
        const norm = normalizeVaultNotePath(path);
        if (norm.toLowerCase().endsWith('.apnote')) {
            apnoteSet.add(norm);
        } else if (titleEl.classList.contains('is-active')) {
            const parsed = parseSatelliteFilename(norm);
            if (parsed?.kind === 'md') {
                activeApnotePaths.add(parsed.apnotePath);
            }
        }
    }

    const bundleFolderMap = new Map<string, { mdPath: string; apnotePath: string }>();
    for (const apnotePath of apnoteSet) {
        if (isInsideNoteBundleFolder(apnotePath)) {
            const split = splitNotePath(apnotePath);
            bundleFolderMap.set(split.dir, { mdPath: split.mdPath, apnotePath });
        }
    }
    if (vault?.getFiles) {
        for (const f of vault.getFiles()) {
            const norm = normalizeVaultNotePath(f.path);
            if (norm.toLowerCase().endsWith('.md') && isInsideNoteBundleFolder(norm)) {
                const split = splitNotePath(norm);
                if (!bundleFolderMap.has(split.dir)) {
                    bundleFolderMap.set(split.dir, { mdPath: split.mdPath, apnotePath: split.apnotePath });
                }
            }
        }
    }

    const folderDomSet = new Set<string>();
    for (let i = 0; i < items.length; i++) {
        const titleEl = items[i];
        const rawPath = titleEl.dataset?.path || titleEl.getAttribute('data-path') || '';
        const norm = normalizeVaultNotePath(rawPath);
        if (!norm) continue;
        if (titleEl.classList.contains('nav-folder-title') || bundleFolderMap.has(norm)) {
            folderDomSet.add(norm);
        }
    }

    for (let i = 0; i < items.length; i++) {
        const titleEl = items[i];
        const rawPath = titleEl.dataset?.path || titleEl.getAttribute('data-path') || '';
        const normPath = normalizeVaultNotePath(rawPath);
        if (!normPath) continue;

        const mkWrapper = titleEl.closest?.('.mk-tree-wrapper') as HTMLElement | null;
        const mkNode = titleEl.closest?.('.mk-tree-node') as HTMLElement | null;

        const bundleInfo = bundleFolderMap.get(normPath);
        if (bundleInfo) {
            const folderRow = titleEl.closest?.('.nav-folder, .nav-file, .tree-item') as HTMLElement | null ?? titleEl;
            folderRow.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            titleEl.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            mkWrapper?.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            mkNode?.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);

            folderRow.classList.add(APOLO_BUNDLE_FOLDER_CLASS);
            mkWrapper?.classList.add(APOLO_BUNDLE_FOLDER_CLASS);
            mkNode?.classList.add(APOLO_BUNDLE_FOLDER_CLASS);
            if (titleEl.classList.contains('mk-tree-item')) {
                titleEl.classList.add(APOLO_BUNDLE_FOLDER_CLASS);
            }
            titleEl.classList.add(APOLO_APNOTE_ITEM_CLASS);

            const isActive = activeApnotePaths.has(bundleInfo.apnotePath);
            if (isActive) {
                titleEl.classList.add('is-active');
                mkWrapper?.classList.add('is-active');
            } else {
                titleEl.classList.remove('is-active');
                mkWrapper?.classList.remove('is-active');
            }
            continue;
        }

        if (titleEl.classList.contains('nav-folder-title')) {
            const folderRow = titleEl.closest?.('.nav-folder, .tree-item') as HTMLElement | null ?? titleEl;
            folderRow.classList.remove(APOLO_BUNDLE_FOLDER_CLASS);
            folderRow.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            mkWrapper?.classList.remove(APOLO_BUNDLE_FOLDER_CLASS);
            mkWrapper?.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            mkNode?.classList.remove(APOLO_BUNDLE_FOLDER_CLASS);
            mkNode?.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            titleEl.classList.remove(APOLO_BUNDLE_FOLDER_CLASS);
            titleEl.classList.remove(APOLO_APNOTE_ITEM_CLASS);
            titleEl.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            continue;
        }

        const rowEl = titleEl.closest?.('.nav-file, .tree-item') as HTMLElement | null ?? titleEl;
        rowEl.classList.remove(APOLO_BUNDLE_FOLDER_CLASS);
        mkWrapper?.classList.remove(APOLO_BUNDLE_FOLDER_CLASS);
        mkNode?.classList.remove(APOLO_BUNDLE_FOLDER_CLASS);
        titleEl.classList.remove(APOLO_BUNDLE_FOLDER_CLASS);

        const parsed = parseSatelliteFilename(normPath);

        if (parsed?.kind === 'apnote') {
            if (
                isInsideNoteBundleFolder(normPath) &&
                bundleFolderMap.has(parsed.dir) &&
                (folderDomSet.has(parsed.dir) || mkNode !== null || mkWrapper !== null)
            ) {
                rowEl.classList.add(APOLO_SATELLITE_HIDDEN_CLASS);
                titleEl.classList.add(APOLO_SATELLITE_HIDDEN_CLASS);
                mkWrapper?.classList.add(APOLO_SATELLITE_HIDDEN_CLASS);
                mkNode?.classList.add(APOLO_SATELLITE_HIDDEN_CLASS);
                continue;
            }
            rowEl.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            titleEl.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            mkWrapper?.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            mkNode?.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            titleEl.classList.add(APOLO_APNOTE_ITEM_CLASS);
            if (activeApnotePaths.has(normPath)) {
                titleEl.classList.add('is-active');
                mkWrapper?.classList.add('is-active');
            } else {
                titleEl.classList.remove('is-active');
                mkWrapper?.classList.remove('is-active');
            }
            continue;
        }

        const shouldHide = isSatelliteFile(normPath, (apnotePath) => {
            if (apnoteSet.has(apnotePath)) return true;
            if (vault?.getAbstractFileByPath?.(apnotePath) != null) return true;
            return false;
        });

        if (shouldHide) {
            rowEl.classList.add(APOLO_SATELLITE_HIDDEN_CLASS);
            titleEl.classList.add(APOLO_SATELLITE_HIDDEN_CLASS);
            mkWrapper?.classList.add(APOLO_SATELLITE_HIDDEN_CLASS);
            mkNode?.classList.add(APOLO_SATELLITE_HIDDEN_CLASS);
        } else {
            rowEl.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            titleEl.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            mkWrapper?.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            mkNode?.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            titleEl.classList.remove(APOLO_APNOTE_ITEM_CLASS);
        }
    }

    // Hide redundant bundle folder breadcrumb in Obsidian's native view header (e.g. `Test / Test` -> `Test`)
    const headerContainers = root.querySelectorAll<HTMLElement>('.view-header-title-container');
    for (let i = 0; i < headerContainers.length; i++) {
        const container = headerContainers[i];
        const parentEl = container.querySelector<HTMLElement>('.view-header-title-parent');
        const titleEl = container.querySelector<HTMLElement>('.view-header-title');
        if (!parentEl) continue;

        parentEl.classList.remove(APOLO_BREADCRUMB_HIDDEN_CLASS);
        const crumbs = parentEl.querySelectorAll<HTMLElement>('.view-header-breadcrumb');
        const seps = parentEl.querySelectorAll<HTMLElement>('.view-header-breadcrumb-separator');
        for (let c = 0; c < crumbs.length; c++) {
            crumbs[c].classList.remove(APOLO_BREADCRUMB_HIDDEN_CLASS);
        }
        for (let s = 0; s < seps.length; s++) {
            seps[s].classList.remove(APOLO_BREADCRUMB_HIDDEN_CLASS);
        }

        if (crumbs.length === 0 || !titleEl) continue;

        const crumbNames: string[] = [];
        for (let c = 0; c < crumbs.length; c++) {
            const text = (crumbs[c].textContent ?? '').trim();
            if (text) crumbNames.push(text);
        }
        if (crumbNames.length === 0) continue;

        const lastCrumb = crumbs[crumbs.length - 1];
        const lastCrumbText = (lastCrumb.textContent ?? '').trim();
        const titleText = (titleEl.textContent ?? '').trim();
        const folderPath = normalizeVaultNotePath(crumbNames.join('/'));

        if (
            lastCrumbText &&
            titleText &&
            lastCrumbText.toLowerCase() === titleText.toLowerCase() &&
            (bundleFolderMap.has(folderPath) || isInsideNoteBundleFolder(`${folderPath}/${titleText}.md`))
        ) {
            lastCrumb.classList.add(APOLO_BREADCRUMB_HIDDEN_CLASS);
            if (seps.length > 0) {
                seps[seps.length - 1].classList.add(APOLO_BREADCRUMB_HIDDEN_CLASS);
            }
            if (crumbs.length === 1) {
                parentEl.classList.add(APOLO_BREADCRUMB_HIDDEN_CLASS);
            }
        }
    }
}

/** Removes all File Explorer, Make.md, breadcrumb, and bundle folder cloaking classes on unload. */
export function removeFileExplorerCloaking(root: ParentNode): void {
    const classesToClear = [
        APOLO_SATELLITE_HIDDEN_CLASS,
        APOLO_BREADCRUMB_HIDDEN_CLASS,
        APOLO_BUNDLE_FOLDER_CLASS,
        APOLO_APNOTE_ITEM_CLASS,
    ];
    for (const cls of classesToClear) {
        const els = root.querySelectorAll<HTMLElement>(`.${cls}`);
        for (let i = 0; i < els.length; i++) {
            els[i].classList.remove(cls);
        }
    }
}
