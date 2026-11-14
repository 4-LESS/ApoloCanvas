import {
    type AtomicRenameResult,
    createApnoteManifest,
    discoverBoxSvgPaths,
    ensureDirectory,
    ensureNoMediaFile,
    extractReferencedBoxIds,
    getBoxSvgPath,
    getBundledMdPath,
    getGlobalInkPath,
    isInsideNoteBundleFolder,
    isZipApnote,
    normalizeVaultNotePath,
    parseApnoteManifest,
    parseSatelliteFilename,
    registerKnownApnote,
    rewriteSatelliteEmbedLinks,
    serializeApnoteManifest,
    splitNotePath,
    unregisterKnownApnote,
    type VaultLike,
} from './ApnotePaths.ts';

async function moveFileAcrossVault(vault: VaultLike, fromPath: string, toPath: string): Promise<boolean> {
    if (fromPath === toPath) return false;
    const targetDir = toPath.includes('/') ? toPath.slice(0, toPath.lastIndexOf('/')) : '';
    if (targetDir) {
        await ensureDirectory(vault.adapter, targetDir);
    }
    const abstractFile = vault.getAbstractFileByPath?.(fromPath);
    if (abstractFile && typeof vault.rename === 'function') {
        try {
            await vault.rename(abstractFile, toPath);
            return true;
        } catch {
            // Fall through to adapter.rename
        }
    }
    if (await vault.adapter.exists(fromPath)) {
        await vault.adapter.rename(fromPath, toPath);
        return true;
    }
    return false;
}

/** Removes an empty note bundle folder (along with an orphaned `.nomedia` file inside it). */
async function cleanupEmptyBundleDir(vault: VaultLike, dirPath: string): Promise<void> {
    if (!dirPath || typeof vault.adapter.list !== 'function') return;
    try {
        const listed = await vault.adapter.list(dirPath);
        if (listed.folders.length > 0) return;
        const nonNoMediaFiles = listed.files.filter((f) => {
            const name = f.slice(f.lastIndexOf('/') + 1);
            return name !== '.nomedia';
        });
        if (nonNoMediaFiles.length > 0) return;
        const noMediaPath = `${dirPath}/.nomedia`;
        if (await vault.adapter.exists(noMediaPath)) {
            await vault.adapter.remove(noMediaPath);
        }
        await vault.adapter.rmdir?.(dirPath, false);
    } catch {
        // Ignore cleanup failure when folder is missing or non-empty
    }
}

/**
 * Ensures an Apolo note and all of its satellites live inside its single dedicated folder
 * (`<parentDir>/<BaseName>/`). Returns the resulting bundled `<BaseName>.md` path.
 */
export async function ensureNoteInBundleFolder(vault: VaultLike, noteOrTriggerPath: string): Promise<string> {
    if (isInsideNoteBundleFolder(noteOrTriggerPath)) {
        return splitNotePath(noteOrTriggerPath).mdPath;
    }
    const targetMdPath = getBundledMdPath(noteOrTriggerPath);
    await syncAtomicRename(vault, noteOrTriggerPath, targetMdPath);
    return targetMdPath;
}

/**
 * Synchronizes all note-local satellites when either `<dir>/<BaseName>.apnote` or
 * `<dir>/<BaseName>.md` is moved or renamed across folders or basenames.
 */
export async function syncAtomicRename(
    vault: VaultLike,
    oldPath: string,
    newPath: string,
): Promise<AtomicRenameResult | null> {
    const oldParsed = parseSatelliteFilename(oldPath);
    const newParsed = parseSatelliteFilename(newPath);
    if (!oldParsed || !newParsed) return null;
    if (oldParsed.kind !== 'apnote' && oldParsed.kind !== 'md') return null;
    if (newParsed.kind !== 'apnote' && newParsed.kind !== 'md') return null;

    const oldSplit = splitNotePath(oldParsed.mdPath);
    const newSplit = splitNotePath(newParsed.mdPath);
    const movedPaths: string[] = [];

    await ensureNoMediaFile(vault, newSplit.dir || '');

    if (!(await vault.adapter.exists(newSplit.mdPath)) && (await vault.adapter.exists(oldSplit.mdPath))) {
        if (await moveFileAcrossVault(vault, oldSplit.mdPath, newSplit.mdPath)) {
            movedPaths.push(newSplit.mdPath);
        }
    }

    if (!(await vault.adapter.exists(newSplit.apnotePath)) && (await vault.adapter.exists(oldSplit.apnotePath))) {
        if (await moveFileAcrossVault(vault, oldSplit.apnotePath, newSplit.apnotePath)) {
            movedPaths.push(newSplit.apnotePath);
        }
    }

    const oldGlobal = getGlobalInkPath(oldSplit.mdPath);
    const newGlobal = getGlobalInkPath(newSplit.mdPath);
    if (await vault.adapter.exists(oldGlobal)) {
        if (await moveFileAcrossVault(vault, oldGlobal, newGlobal)) {
            movedPaths.push(newGlobal);
        }
    }
    if (await vault.adapter.exists(newGlobal)) {
        try {
            const parsedGlobal = JSON.parse(await vault.adapter.read(newGlobal)) as Record<string, unknown>;
            if (parsedGlobal && typeof parsedGlobal === 'object' && parsedGlobal.notePath !== newSplit.mdPath) {
                parsedGlobal.notePath = newSplit.mdPath;
                await vault.adapter.write(newGlobal, JSON.stringify(parsedGlobal));
            }
        } catch {
            // Preserve existing file on parse error
        }
    }

    const boxIds: string[] = [];
    const oldSvgCandidates = new Set<string>();

    if (await vault.adapter.exists(newSplit.apnotePath)) {
        try {
            const manifest = parseApnoteManifest(await vault.adapter.read(newSplit.apnotePath));
            if (manifest) {
                for (const id of manifest.canvases) {
                    oldSvgCandidates.add(getBoxSvgPath(oldSplit.mdPath, id));
                }
            }
        } catch {
            // Ignore unreadable manifest
        }
    }

    if (typeof vault.adapter.list === 'function') {
        try {
            const listed = await vault.adapter.list(oldSplit.dir);
            for (const filePath of listed.files) {
                const parsed = parseSatelliteFilename(filePath);
                if (parsed && parsed.kind === 'box-svg' && parsed.baseName === oldSplit.baseName && parsed.dir === oldSplit.dir) {
                    oldSvgCandidates.add(normalizeVaultNotePath(filePath));
                }
            }
        } catch {
            // Directory may already be gone
        }
    }

    if (await vault.adapter.exists(newSplit.mdPath)) {
        try {
            const mdText = await vault.adapter.read(newSplit.mdPath);
            for (const boxId of extractReferencedBoxIds(mdText, oldSplit.baseName)) {
                oldSvgCandidates.add(getBoxSvgPath(oldSplit.mdPath, boxId));
            }
        } catch {
            // Ignore read failure
        }
    }

    for (const oldSvgPath of oldSvgCandidates) {
        const parsedSvg = parseSatelliteFilename(oldSvgPath);
        if (!parsedSvg?.boxId) continue;
        if (!boxIds.includes(parsedSvg.boxId)) {
            boxIds.push(parsedSvg.boxId);
        }
        const newSvgPath = getBoxSvgPath(newSplit.mdPath, parsedSvg.boxId);
        if (await vault.adapter.exists(oldSvgPath) && !(await vault.adapter.exists(newSvgPath))) {
            if (await moveFileAcrossVault(vault, oldSvgPath, newSvgPath)) {
                movedPaths.push(newSvgPath);
            }
        }
    }

    if (oldSplit.baseName !== newSplit.baseName && (await vault.adapter.exists(newSplit.mdPath))) {
        try {
            const mdFile = vault.getAbstractFileByPath?.(newSplit.mdPath);
            const currentMd = mdFile && typeof vault.read === 'function'
                ? await vault.read(mdFile)
                : await vault.adapter.read(newSplit.mdPath);
            const updatedMd = rewriteSatelliteEmbedLinks(currentMd, oldSplit.baseName, newSplit.baseName);
            if (updatedMd !== currentMd) {
                if (mdFile && typeof vault.modify === 'function') {
                    await vault.modify(mdFile, updatedMd);
                } else {
                    await vault.adapter.write(newSplit.mdPath, updatedMd);
                }
            }
        } catch {
            // Best effort markdown link rewrite
        }
    }

    if (await vault.adapter.exists(newSplit.apnotePath)) {
        try {
            let isZip = false;
            if (typeof vault.adapter.readBinary === 'function') {
                isZip = isZipApnote(await vault.adapter.readBinary(newSplit.apnotePath));
            } else {
                isZip = isZipApnote(await vault.adapter.read(newSplit.apnotePath));
            }
            if (!isZip) {
                const existingManifest = parseApnoteManifest(await vault.adapter.read(newSplit.apnotePath));
                const mergedCanvases = existingManifest?.canvases.length ? existingManifest.canvases : boxIds;
                const nextManifest = createApnoteManifest(newSplit.mdPath, mergedCanvases);
                await vault.adapter.write(newSplit.apnotePath, serializeApnoteManifest(nextManifest));
            }
        } catch {
            // Ignore manifest update failure
        }
    }

    unregisterKnownApnote(oldSplit.apnotePath);
    registerKnownApnote(newSplit.apnotePath);

    if (oldSplit.dir && oldSplit.dir !== newSplit.dir && isInsideNoteBundleFolder(oldSplit.mdPath)) {
        await cleanupEmptyBundleDir(vault, oldSplit.dir);
    }

    return {
        oldMdPath: oldSplit.mdPath,
        newMdPath: newSplit.mdPath,
        oldApnotePath: oldSplit.apnotePath,
        newApnotePath: newSplit.apnotePath,
        movedPaths,
    };
}

/** Removes `.apnote`, `.global.json`, and `<BaseName>.*.svg` satellites when a note is deleted. */
export async function deleteNoteSatellites(vault: VaultLike, noteOrTriggerPath: string): Promise<void> {
    const split = splitNotePath(noteOrTriggerPath);
    const svgPaths = await discoverBoxSvgPaths(vault, split.mdPath);
    const pathsToRemove = [split.apnotePath, getGlobalInkPath(split.mdPath), ...svgPaths];

    for (const targetPath of pathsToRemove) {
        try {
            if (await vault.adapter.exists(targetPath)) {
                await vault.adapter.remove(targetPath);
            }
        } catch {
            // Ignore deletion failure
        }
    }

    unregisterKnownApnote(split.apnotePath);

    if (split.dir && isInsideNoteBundleFolder(split.mdPath)) {
        await cleanupEmptyBundleDir(vault, split.dir);
    }
}
