export function cleanBoxId(id: string): string {
    if (!id) return '';
    let clean = id.trim();
    if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
        clean = clean.slice(1, -1).trim();
    }
    clean = clean
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
        clean = clean.slice(1, -1).trim();
    }
    return clean;
}

const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const STRICT_SAFE_BOX_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Minimal adapter interface compatible with Obsidian DataAdapter and test mocks. */
export interface VaultAdapterLike {
    exists(normalizedPath: string): Promise<boolean>;
    read(normalizedPath: string): Promise<string>;
    write(normalizedPath: string, data: string): Promise<void>;
    rename(normalizedPath: string, newPath: string): Promise<void>;
    remove(normalizedPath: string): Promise<void>;
    mkdir(normalizedPath: string): Promise<void>;
    rmdir?(normalizedPath: string, recursive: boolean): Promise<void>;
    list?(normalizedPath: string): Promise<{ files: string[]; folders: string[] }>;
    readBinary?(normalizedPath: string): Promise<ArrayBuffer>;
    writeBinary?(normalizedPath: string, data: ArrayBuffer): Promise<void>;
}

/** Minimal vault interface compatible with Obsidian Vault and lightweight unit test mocks. */
export interface VaultLike {
    adapter: VaultAdapterLike;
    getAbstractFileByPath?(path: string): unknown;
    getFileByPath?(path: string): unknown;
    getFiles?(): Array<{ path: string; extension?: string }>;
    read?(file: any): Promise<string>;
    readBinary?(file: any): Promise<ArrayBuffer>;
    modify?(file: any, data: string): Promise<void>;
    rename?(file: any, newPath: string): Promise<void>;
    delete?(file: any, force?: boolean): Promise<void>;
}

export interface ApnoteManifest {
    format: 'apnote';
    version: 1;
    markdown: string;
    globalInk: string;
    canvases: string[];
}

export interface SplitNotePath {
    dir: string;
    baseName: string;
    mdPath: string;
    apnotePath: string;
}

export interface ParsedSatelliteFile {
    dir: string;
    baseName: string;
    kind: 'apnote' | 'md' | 'global' | 'box-svg';
    boxId?: string;
    apnotePath: string;
    mdPath: string;
}

export type SatelliteSiblingSource =
    | ReadonlySet<string>
    | readonly string[]
    | ((apnotePath: string) => boolean)
    | { getAbstractFileByPath?(path: string): unknown; getFileByPath?(path: string): unknown };

export interface AtomicRenameResult {
    oldMdPath: string;
    newMdPath: string;
    oldApnotePath: string;
    newApnotePath: string;
    movedPaths: string[];
}

/** In-memory registry of known `.apnote` trigger paths for single-argument `isSatelliteFile` lookups. */
const knownApnotePaths = new Set<string>();

/** Registers an active `.apnote` trigger path. */
export function registerKnownApnote(apnotePath: string): void {
    const clean = normalizeVaultNotePath(apnotePath);
    if (clean.toLowerCase().endsWith('.apnote')) {
        knownApnotePaths.add(clean);
    }
}

/** Unregisters an `.apnote` trigger path. */
export function unregisterKnownApnote(apnotePath: string): void {
    knownApnotePaths.delete(normalizeVaultNotePath(apnotePath));
}

/** Clears the in-memory `.apnote` trigger path registry (useful in tests and plugin unload). */
export function clearKnownApnotes(): void {
    knownApnotePaths.clear();
}

/** Returns a snapshot view of registered `.apnote` trigger paths. */
export function getKnownApnotePaths(): ReadonlySet<string> {
    return knownApnotePaths;
}

function fnv1aUpdate(hash: number, input: string): number {
    let h = hash;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

function fnv1aHex(input: string): string {
    return fnv1aUpdate(0x811c9dc5, input).toString(16).padStart(8, '0');
}

/**
 * Normalizes a vault-relative note path by converting backslashes to forward slashes,
 * stripping control characters, and removing empty, `.` or `..` traversal segments.
 */
export function normalizeVaultNotePath(notePath: string): string {
    const cleaned = (notePath ?? '').replace(/[\x00-\x1f\x7f]/g, '').replace(/\\/g, '/');
    const segments: string[] = [];
    for (const rawSeg of cleaned.split('/')) {
        const seg = rawSeg.trim();
        if (!seg || seg === '.' || seg === '..') continue;
        segments.push(seg);
    }
    return segments.join('/');
}

/**
 * Converts a user-supplied box ID into a strict, cross-platform filesystem-safe identifier
 * matching `/^[a-zA-Z0-9_-]{1,64}$/` and guaranteed not to be a Windows reserved device name
 * or contain path separators / traversal sequences.
 */
export function sanitizeBoxId(rawId: string): string {
    const trimmed = (rawId ?? '').trim();
    const normalized = cleanBoxId(trimmed);
    if (
        normalized.length > 0 &&
        normalized === trimmed &&
        STRICT_SAFE_BOX_ID_RE.test(normalized) &&
        !WINDOWS_RESERVED_NAME_RE.test(normalized)
    ) {
        return normalized;
    }

    const source = normalized || trimmed;
    let slug = source
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '')
        .slice(0, 32)
        .replace(/[-_]+$/g, '');

    if (!slug || WINDOWS_RESERVED_NAME_RE.test(slug)) {
        slug = 'box';
    }

    const hash = fnv1aHex(source || 'empty');
    return `${slug}_${hash}`;
}

/** Sanitizes a single path segment (folder or base filename) against invalid OS chars and reserved device names. */
export function sanitizePathSegment(segment: string, fallback = 'note'): string {
    let clean = segment
        .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '-')
        .replace(/^\.+|\.+$/g, '')
        .trim();
    if (!clean || clean === '.' || clean === '..' || WINDOWS_RESERVED_NAME_RE.test(clean)) {
        clean = clean ? `_${clean}` : fallback;
    }
    if (clean.length > 120) {
        clean = `${clean.slice(0, 100)}_${fnv1aHex(segment)}`;
    }
    return clean;
}

/** Splits a `.md` or `.apnote` vault path into sanitized directory, baseName, mdPath, and apnotePath. */
export function splitNotePath(noteOrTriggerPath: string): SplitNotePath {
    const normalized = normalizeVaultNotePath(noteOrTriggerPath);
    const segments = normalized ? normalized.split('/') : [];
    const rawFile = segments.pop() ?? 'note';
    const safeFolders = segments.map(seg => sanitizePathSegment(seg, 'folder'));
    const dir = safeFolders.join('/');
    const rawBasename = rawFile.replace(/\.(md|apnote)$/i, '');
    const baseName = sanitizePathSegment(rawBasename, 'note');
    const prefix = dir ? `${dir}/` : '';
    return {
        dir,
        baseName,
        mdPath: `${prefix}${baseName}.md`,
        apnotePath: `${prefix}${baseName}.apnote`,
    };
}

/** Resolves `<dir>/<BaseName>.apnote` for a note at `<dir>/<BaseName>.md`. */
export function getApnoteTriggerPath(mdPath: string): string {
    return splitNotePath(mdPath).apnotePath;
}

/** Resolves `<dir>/.<BaseName>.global.json` for a note at `<dir>/<BaseName>.md`. */
export function getGlobalInkPath(mdPath: string): string {
    const { dir, baseName } = splitNotePath(mdPath);
    return `${dir ? `${dir}/` : ''}.${baseName}.global.json`;
}

/** Resolves `<dir>/<BaseName>.<safeBoxId>.svg` for a note at `<dir>/<BaseName>.md`. */
export function getBoxSvgPath(mdPath: string, boxId: string): string {
    const { dir, baseName } = splitNotePath(mdPath);
    const safeBoxId = sanitizeBoxId(boxId);
    return `${dir ? `${dir}/` : ''}${baseName}.${safeBoxId}.svg`;
}

/** Resolves `<dir>/<BaseName>.md` from a trigger path `<dir>/<BaseName>.apnote`. */
export function resolveMdFromTrigger(apnotePath: string): string {
    return splitNotePath(apnotePath).mdPath;
}

/**
 * Returns `true` when `<dir>/<BaseName>.md` (or `.apnote`) already resides inside
 * its dedicated single-note bundle folder (`.../<BaseName>/<BaseName>.md`).
 */
export function isInsideNoteBundleFolder(noteOrTriggerPath: string): boolean {
    const split = splitNotePath(noteOrTriggerPath);
    if (!split.dir || !split.baseName) return false;
    const folderName = split.dir.slice(split.dir.lastIndexOf('/') + 1);
    return folderName.toLowerCase() === split.baseName.toLowerCase();
}

/** Resolves the dedicated folder path `<parentDir>/<BaseName>` for a note or trigger path. */
export function getNoteBundleFolderPath(noteOrTriggerPath: string): string {
    const split = splitNotePath(noteOrTriggerPath);
    if (isInsideNoteBundleFolder(noteOrTriggerPath)) {
        return split.dir;
    }
    return split.dir ? `${split.dir}/${split.baseName}` : split.baseName;
}

/** Resolves `<parentDir>/<BaseName>/<BaseName>.md` for any note or trigger path. */
export function getBundledMdPath(noteOrTriggerPath: string): string {
    const split = splitNotePath(noteOrTriggerPath);
    const bundleDir = getNoteBundleFolderPath(noteOrTriggerPath);
    return `${bundleDir}/${split.baseName}.md`;
}

/**
 * Resolves `{ folderPath, baseName, mdPath, apnotePath }` if `folderPath` is a single-note
 * Apolo bundle folder (i.e. contains `<BaseName>.apnote`), or `null` otherwise.
 */
export function resolveBundleFolderPaths(
    folderPath: string,
    siblingCheck?: SatelliteSiblingSource,
): { folderPath: string; baseName: string; mdPath: string; apnotePath: string } | null {
    const cleanFolder = normalizeVaultNotePath(folderPath);
    if (!cleanFolder) return null;
    const rawFolderName = cleanFolder.slice(cleanFolder.lastIndexOf('/') + 1);
    const baseName = sanitizePathSegment(rawFolderName, '');
    if (!baseName) return null;
    const apnotePath = `${cleanFolder}/${baseName}.apnote`;
    const mdPath = `${cleanFolder}/${baseName}.md`;
    const exists = siblingCheck !== undefined
        ? hasSiblingApnote(apnotePath, siblingCheck) || knownApnotePaths.has(apnotePath)
        : knownApnotePaths.has(apnotePath);
    if (!exists) return null;
    return { folderPath: cleanFolder, baseName, mdPath, apnotePath };
}

/** Parses any vault path into its satellite classification, baseName, and sibling `.apnote` / `.md` paths. */
export function parseSatelliteFilename(filePath: string): ParsedSatelliteFile | null {
    const normalized = normalizeVaultNotePath(filePath);
    if (!normalized) return null;
    const lastSlash = normalized.lastIndexOf('/');
    const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
    const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
    if (!fileName || fileName === '.nomedia') return null;

    const prefix = dir ? `${dir}/` : '';
    const lower = fileName.toLowerCase();

    if (!fileName.startsWith('.') && lower.endsWith('.apnote')) {
        const baseName = fileName.slice(0, -'.apnote'.length);
        if (!baseName) return null;
        return {
            dir,
            baseName,
            kind: 'apnote',
            apnotePath: `${prefix}${baseName}.apnote`,
            mdPath: `${prefix}${baseName}.md`,
        };
    }

    if (!fileName.startsWith('.') && lower.endsWith('.md')) {
        const baseName = fileName.slice(0, -'.md'.length);
        if (!baseName) return null;
        return {
            dir,
            baseName,
            kind: 'md',
            apnotePath: `${prefix}${baseName}.apnote`,
            mdPath: `${prefix}${baseName}.md`,
        };
    }

    if (fileName.startsWith('.') && lower.endsWith('.global.json')) {
        const baseName = fileName.slice(1, -'.global.json'.length);
        if (!baseName) return null;
        return {
            dir,
            baseName,
            kind: 'global',
            apnotePath: `${prefix}${baseName}.apnote`,
            mdPath: `${prefix}${baseName}.md`,
        };
    }

    if (!fileName.startsWith('.') && lower.endsWith('.svg')) {
        const stem = fileName.slice(0, -'.svg'.length);
        const lastDot = stem.lastIndexOf('.');
        if (lastDot <= 0) return null;
        const baseName = stem.slice(0, lastDot);
        const boxId = stem.slice(lastDot + 1);
        if (!baseName || !boxId) return null;
        return {
            dir,
            baseName,
            kind: 'box-svg',
            boxId,
            apnotePath: `${prefix}${baseName}.apnote`,
            mdPath: `${prefix}${baseName}.md`,
        };
    }

    return null;
}

function hasSiblingApnote(apnotePath: string, siblingCheck: SatelliteSiblingSource): boolean {
    if (typeof siblingCheck === 'function') {
        return Boolean(siblingCheck(apnotePath));
    }
    if (siblingCheck instanceof Set) {
        return siblingCheck.has(apnotePath);
    }
    if (Array.isArray(siblingCheck)) {
        return siblingCheck.includes(apnotePath);
    }
    if (typeof siblingCheck === 'object' && siblingCheck !== null) {
        if ('getFileByPath' in siblingCheck && typeof siblingCheck.getFileByPath === 'function') {
            return siblingCheck.getFileByPath(apnotePath) != null;
        }
        if ('getAbstractFileByPath' in siblingCheck && typeof siblingCheck.getAbstractFileByPath === 'function') {
            return siblingCheck.getAbstractFileByPath(apnotePath) != null;
        }
    }
    return false;
}

/**
 * Returns `true` for `.<BaseName>.global.json`, `<BaseName>.<boxId>.svg`, or `<BaseName>.md`
 * when a sibling `<BaseName>.apnote` exists.
 */
export function isSatelliteFile(filePath: string, siblingCheck?: SatelliteSiblingSource): boolean {
    const parsed = parseSatelliteFilename(filePath);
    if (!parsed || parsed.kind === 'apnote') return false;

    if (siblingCheck !== undefined) {
        return hasSiblingApnote(parsed.apnotePath, siblingCheck);
    }

    if (parsed.kind === 'global' || parsed.kind === 'box-svg') {
        return true;
    }

    return knownApnotePaths.has(parsed.apnotePath);
}

/** Builds a lightweight JSON manifest for `<dir>/<BaseName>.apnote`. */
export function createApnoteManifest(mdPath: string, canvases: Iterable<string>): ApnoteManifest {
    const { baseName } = splitNotePath(mdPath);
    const seen = new Set<string>();
    const safeCanvases: string[] = [];
    for (const rawId of canvases) {
        const clean = cleanBoxId(rawId) || rawId;
        if (clean && !seen.has(clean)) {
            seen.add(clean);
            safeCanvases.push(clean);
        }
    }
    return {
        format: 'apnote',
        version: 1,
        markdown: `${baseName}.md`,
        globalInk: `.${baseName}.global.json`,
        canvases: safeCanvases,
    };
}

/** Serializes an `.apnote` manifest to formatted JSON. */
export function serializeApnoteManifest(manifest: ApnoteManifest): string {
    return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Parses an uncompressed `.apnote` JSON manifest, returning `null` if invalid. */
export function parseApnoteManifest(raw: string): ApnoteManifest | null {
    const trimmed = (raw ?? '').trim();
    if (!trimmed.startsWith('{')) return null;
    try {
        const parsed = JSON.parse(trimmed) as Partial<ApnoteManifest>;
        if (!parsed || parsed.format !== 'apnote' || parsed.version !== 1) return null;
        if (typeof parsed.markdown !== 'string' || typeof parsed.globalInk !== 'string') return null;
        const canvases = Array.isArray(parsed.canvases)
            ? parsed.canvases.filter((id): id is string => typeof id === 'string' && id.length > 0)
            : [];
        return {
            format: 'apnote',
            version: 1,
            markdown: parsed.markdown,
            globalInk: parsed.globalInk,
            canvases,
        };
    } catch {
        return null;
    }
}

export function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
    return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/** Distinguishes a compressed ZIP `.apnote` archive (`PK\x03\x04`) from an uncompressed JSON manifest (`{`). */
export function detectApnoteFormat(data: ArrayBuffer | Uint8Array | string): 'zip' | 'json' | 'unknown' {
    if (typeof data === 'string') {
        if (data.startsWith('PK\x03\x04') || data.startsWith('PK')) return 'zip';
        const trimmed = data.trimStart();
        if (trimmed.startsWith('{')) return 'json';
        return 'unknown';
    }
    const bytes = toUint8Array(data);
    if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
        return 'zip';
    }
    let idx = 0;
    while (idx < bytes.length && (bytes[idx] === 0x20 || bytes[idx] === 0x09 || bytes[idx] === 0x0a || bytes[idx] === 0x0d)) {
        idx++;
    }
    if (idx < bytes.length && bytes[idx] === 0x7b /* '{' */) {
        return 'json';
    }
    return 'unknown';
}

export function isZipApnote(data: ArrayBuffer | Uint8Array | string): boolean {
    return detectApnoteFormat(data) === 'zip';
}

export function isJsonApnote(data: ArrayBuffer | Uint8Array | string): boolean {
    return detectApnoteFormat(data) === 'json';
}

/** Recursively ensures every segment of a relative directory path exists. */
export async function ensureDirectory(adapter: VaultAdapterLike, dirPath: string): Promise<void> {
    const clean = normalizeVaultNotePath(dirPath);
    if (!clean) return;
    const parts = clean.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!(await adapter.exists(current))) {
            await adapter.mkdir(current);
        }
    }
}

/**
 * Ensures `<dir>/.nomedia` exists (creating `<dir>` if necessary) so Android/iOS media
 * scanners never index satellite `.svg` assets into the photo gallery.
 */
export async function ensureNoMediaFile(vault: VaultLike, dirPath: string): Promise<string> {
    const cleanDir = normalizeVaultNotePath(dirPath);
    if (cleanDir) {
        await ensureDirectory(vault.adapter, cleanDir);
    }
    const noMediaPath = cleanDir ? `${cleanDir}/.nomedia` : '.nomedia';
    if (!(await vault.adapter.exists(noMediaPath))) {
        await vault.adapter.write(noMediaPath, '');
    }
    return noMediaPath;
}

function escapeRegexLiteral(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Rewrites `![[<OldBaseName>.<boxId>.svg]]` fallback embeds inside markdown when a note is renamed. */
export function rewriteSatelliteEmbedLinks(markdown: string, oldBaseName: string, newBaseName: string): string {
    if (!markdown || !oldBaseName || !newBaseName || oldBaseName === newBaseName) {
        return markdown;
    }
    const escapedOld = escapeRegexLiteral(oldBaseName);
    const wikiEmbedRegex = new RegExp(`(!\\[\\[)(${escapedOld})(\\.[^\\]|\\r\\n]+\\.svg(?:\\|[^\\]]*)?\\]\\])`, 'g');
    return markdown.replace(wikiEmbedRegex, (_full, prefix, _oldName, suffix) => `${prefix}${newBaseName}${suffix}`);
}

/** Extracts all box IDs referenced by `<div data-apolo-space>`, ` ```apolo-space `, or `![[<BaseName>.<boxId>.svg]]`. */
export function extractReferencedBoxIds(markdown: string, baseName?: string): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    const addId = (raw: string) => {
        const norm = cleanBoxId(raw) || raw.trim();
        if (norm && !seen.has(norm)) {
            seen.add(norm);
            ids.push(norm);
        }
    };

    const divAttrRegex = /data-apolo-space(?:-id)?=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
    let m: RegExpExecArray | null;
    while ((m = divAttrRegex.exec(markdown)) !== null) {
        addId(m[1] ?? m[2] ?? m[3] ?? '');
    }

    const codeBlockRegex = /```apolo-space\b([\s\S]*?)```/gi;
    while ((m = codeBlockRegex.exec(markdown)) !== null) {
        const idMatch = m[1].match(/(?:^|\r?\n)\s*id:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s\r\n#"']+))/i);
        if (idMatch) {
            const raw = idMatch[1] ?? idMatch[2] ?? idMatch[3] ?? '';
            addId(raw);
        }
    }

    if (baseName) {
        const escapedBase = escapeRegexLiteral(baseName);
        const embedRegex = new RegExp(`!\\[\\[${escapedBase}\\.([A-Za-z0-9_-]+)\\.svg(?:\\|[^\\]]*)?\\]\\]`, 'g');
        while ((m = embedRegex.exec(markdown)) !== null) {
            addId(m[1]);
        }
    }

    return ids;
}

/** Discovers all existing `<BaseName>.<boxId>.svg` satellite paths for `mdPath`. */
export async function discoverBoxSvgPaths(vault: VaultLike, mdPath: string): Promise<string[]> {
    const split = splitNotePath(mdPath);
    const results = new Set<string>();

    if (await vault.adapter.exists(split.apnotePath)) {
        try {
            const rawTrigger = await vault.adapter.read(split.apnotePath);
            const manifest = parseApnoteManifest(rawTrigger);
            if (manifest) {
                for (const boxId of manifest.canvases) {
                    const candidate = getBoxSvgPath(split.mdPath, boxId);
                    if (await vault.adapter.exists(candidate)) {
                        results.add(candidate);
                    }
                }
            }
        } catch {
            // Ignore unreadable trigger manifest
        }
    }

    if (typeof vault.adapter.list === 'function') {
        try {
            const listed = await vault.adapter.list(split.dir);
            for (const filePath of listed.files) {
                const parsed = parseSatelliteFilename(filePath);
                if (parsed && parsed.kind === 'box-svg' && parsed.baseName === split.baseName && parsed.dir === split.dir) {
                    results.add(normalizeVaultNotePath(filePath));
                }
            }
        } catch {
            // Directory may not support list or may not exist yet
        }
    }

    if (await vault.adapter.exists(split.mdPath)) {
        try {
            const mdContent = await vault.adapter.read(split.mdPath);
            for (const boxId of extractReferencedBoxIds(mdContent, split.baseName)) {
                const candidate = getBoxSvgPath(split.mdPath, boxId);
                if (await vault.adapter.exists(candidate)) {
                    results.add(candidate);
                }
            }
        } catch {
            // Ignore read failure
        }
    }

    return Array.from(results);
}
