import {
    isInsideNoteBundleFolder,
    normalizeVaultNotePath,
    resolveBundleFolderPaths,
    resolveMdFromTrigger,
    splitNotePath,
    type SplitNotePath,
    type VaultLike,
} from './ApnotePaths.ts';
import { collectKnownAndVaultApnotes } from './ExplorerCloaking.ts';

interface MakeMdPathLabel {
    sticker?: string;
    thumbnail?: string;
    name?: string;
    color?: string;
}

interface MakeMdPathMetadata {
    isFolder?: boolean;
    [key: string]: unknown;
}

interface MakeMdPathState {
    path?: string;
    name?: string;
    type?: string;
    subtype?: string;
    hidden?: boolean;
    file?: { isFolder?: boolean; [key: string]: unknown };
    metadata?: MakeMdPathMetadata;
    label?: MakeMdPathLabel;
    [key: string]: unknown;
}

interface MakeMdEventsDispatcher {
    addListener?(event: string, listener: (...args: unknown[]) => void): void;
    removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

interface MakeMdSuperstate {
    pathsIndex?: Map<string, MakeMdPathState>;
    spacesIndex?: Map<string, unknown>;
    settings?: {
        expandedSpaces?: string[];
        [key: string]: unknown;
    };
    eventsDispatcher?: MakeMdEventsDispatcher;
    dispatchEvent?(event: string, payload?: unknown): void;
    ui?: {
        openPath?: (path: string, ...args: unknown[]) => unknown;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface MakeMdPluginLike {
    superstate?: MakeMdSuperstate;
    openPath?: (leaf: unknown, path: string, ...args: unknown[]) => unknown;
    [key: string]: unknown;
}

function getMakeMdPlugin(app: unknown): MakeMdPluginLike | null {
    const plugins = (app as { plugins?: { plugins?: Record<string, unknown> } } | null | undefined)?.plugins?.plugins;
    const candidate = plugins?.['make-md'];
    return candidate && typeof candidate === 'object' ? (candidate as MakeMdPluginLike) : null;
}

function rewriteMakeMdTargetPath(targetPath: string, vault?: VaultLike): string {
    if (typeof targetPath !== 'string' || !targetPath) return targetPath;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(targetPath)) return targetPath;
    const bundle = resolveBundleFolderPaths(targetPath, vault);
    if (bundle) {
        return bundle.mdPath;
    }
    const norm = normalizeVaultNotePath(targetPath);
    if (norm.toLowerCase().endsWith('.apnote')) {
        return resolveMdFromTrigger(norm);
    }
    return targetPath;
}

/**
 * Synchronizes Apolo single-folder note bundles into Make.md's `superstate` so bundle folders
 * are represented as flat Markdown notes rather than collapsible folder spaces, and internal
 * satellites stay hidden in Make.md's Navigator index.
 *
 * Returns `true` if any `superstate` entry was modified.
 */
export function syncMakeMdBundleState(app: unknown, vault?: VaultLike): boolean {
    const makeMd = getMakeMdPlugin(app);
    const superstate = makeMd?.superstate;
    if (!superstate || typeof superstate !== 'object') return false;

    const pathsIndex = superstate.pathsIndex instanceof Map ? superstate.pathsIndex : undefined;
    const apnoteSet = collectKnownAndVaultApnotes(vault, pathsIndex);
    const bundleByDir = new Map<string, SplitNotePath>();
    for (const apnotePath of apnoteSet) {
        if (isInsideNoteBundleFolder(apnotePath)) {
            const split = splitNotePath(apnotePath);
            bundleByDir.set(split.dir, split);
        }
    }
    if (bundleByDir.size === 0) return false;

    let changed = false;

    if (superstate.spacesIndex instanceof Map) {
        for (const bundleDir of bundleByDir.keys()) {
            if (superstate.spacesIndex.delete(bundleDir)) {
                changed = true;
            }
        }
    }

    const expandedSpaces = superstate.settings?.expandedSpaces;
    if (Array.isArray(expandedSpaces) && expandedSpaces.length > 0) {
        const nextExpanded = expandedSpaces.filter((sp) => {
            if (typeof sp !== 'string') return true;
            const norm = normalizeVaultNotePath(sp);
            return !bundleByDir.has(norm);
        });
        if (nextExpanded.length !== expandedSpaces.length) {
            expandedSpaces.splice(0, expandedSpaces.length, ...nextExpanded);
            changed = true;
        }
    }

    if (pathsIndex) {
        for (const bundleDir of bundleByDir.keys()) {
            const folderState = pathsIndex.get(bundleDir);
            if (!folderState || typeof folderState !== 'object') continue;

            if (folderState.type !== 'file') {
                folderState.type = 'file';
                changed = true;
            }
            if (folderState.subtype !== 'md') {
                folderState.subtype = 'md';
                changed = true;
            }
            if (folderState.file && typeof folderState.file === 'object' && folderState.file.isFolder !== false) {
                folderState.file.isFolder = false;
                changed = true;
            }
            if (!folderState.metadata || typeof folderState.metadata !== 'object') {
                folderState.metadata = { isFolder: false };
                changed = true;
            } else if (folderState.metadata.isFolder !== false) {
                folderState.metadata.isFolder = false;
                changed = true;
            }
            if (folderState.label && typeof folderState.label === 'object') {
                if (folderState.label.sticker) {
                    folderState.label.sticker = '';
                    changed = true;
                }
                if (folderState.label.thumbnail) {
                    folderState.label.thumbnail = '';
                    changed = true;
                }
            }
        }

        for (const [rawEntryPath, entryState] of pathsIndex.entries()) {
            if (!entryState || typeof entryState !== 'object') continue;
            const normEntry = normalizeVaultNotePath(rawEntryPath);
            if (!normEntry || bundleByDir.has(normEntry)) continue;
            const slashIdx = normEntry.lastIndexOf('/');
            if (slashIdx <= 0) continue;
            const parentDir = normEntry.slice(0, slashIdx);
            const split = bundleByDir.get(parentDir);
            if (!split) continue;

            const fileName = normEntry.slice(slashIdx + 1);
            const lowerFile = fileName.toLowerCase();
            const lowerBase = split.baseName.toLowerCase();
            const isBundleInternal =
                normEntry === split.apnotePath ||
                normEntry === split.mdPath ||
                fileName === '.nomedia' ||
                (lowerFile.startsWith(`.${lowerBase}.`) && lowerFile.endsWith('.global.json')) ||
                (lowerFile.startsWith(`${lowerBase}.`) && lowerFile.endsWith('.svg'));

            if (isBundleInternal && entryState.hidden !== true) {
                entryState.hidden = true;
                changed = true;
            }
        }
    }

    return changed;
}

/**
 * Attaches reactive listeners and path-open redirection onto Make.md's plugin instance and
 * `superstate` so Apolo bundle folders always look and open like notes in Make.md.
 *
 * Returns a cleanup callback that restores patched Make.md methods and removes listeners.
 */
export function attachMakeMdBridge(app: unknown, vault?: VaultLike): () => void {
    const makeMd = getMakeMdPlugin(app);
    const superstate = makeMd?.superstate;
    if (!makeMd || !superstate || typeof superstate !== 'object') {
        return () => {};
    }

    let disposed = false;
    let inSync = false;

    const runSync = (emitUpdate: boolean) => {
        if (disposed || inSync) return;
        inSync = true;
        try {
            if (syncMakeMdBundleState(app, vault) && emitUpdate) {
                superstate.dispatchEvent?.('superstateUpdated', null);
            }
        } finally {
            inSync = false;
        }
    };

    runSync(true);

    const origMakeMdOpenPath = typeof makeMd.openPath === 'function' ? makeMd.openPath : null;
    const wrappedMakeMdOpenPath = origMakeMdOpenPath
        ? function (this: unknown, leaf: unknown, path: string, ...rest: unknown[]) {
              const resolved = rewriteMakeMdTargetPath(path, vault);
              return origMakeMdOpenPath.call(this, leaf, resolved, ...rest);
          }
        : null;
    if (wrappedMakeMdOpenPath) {
        makeMd.openPath = wrappedMakeMdOpenPath;
    }

    const uiObj = superstate.ui;
    const origUiOpenPath = uiObj && typeof uiObj.openPath === 'function' ? uiObj.openPath : null;
    const wrappedUiOpenPath = origUiOpenPath
        ? function (this: unknown, path: string, ...rest: unknown[]) {
              const resolved = rewriteMakeMdTargetPath(path, vault);
              return origUiOpenPath.call(this, resolved, ...rest);
          }
        : null;
    if (uiObj && wrappedUiOpenPath) {
        uiObj.openPath = wrappedUiOpenPath;
    }

    const onSuperstateChange = () => {
        runSync(true);
    };
    const listenedEvents = ['superstateUpdated', 'spaceStateUpdated', 'pathStateUpdated', 'superstateReindex'] as const;
    const dispatcher = superstate.eventsDispatcher;
    if (dispatcher?.addListener) {
        for (const ev of listenedEvents) {
            dispatcher.addListener(ev, onSuperstateChange);
        }
    }

    return () => {
        disposed = true;
        if (dispatcher?.removeListener) {
            for (const ev of listenedEvents) {
                dispatcher.removeListener(ev, onSuperstateChange);
            }
        }
        if (wrappedMakeMdOpenPath && makeMd.openPath === wrappedMakeMdOpenPath && origMakeMdOpenPath) {
            makeMd.openPath = origMakeMdOpenPath;
        }
        if (uiObj && wrappedUiOpenPath && uiObj.openPath === wrappedUiOpenPath && origUiOpenPath) {
            uiObj.openPath = origUiOpenPath;
        }
    };
}
