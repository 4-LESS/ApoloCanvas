function cleanBoxId(id: string): string {
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

/** Feeds a string into a running 32-bit FNV-1a accumulator. */
function fnv1aUpdate(hash: number, input: string): number {
    let h = hash;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Computes a deterministic 8-hex-character 32-bit FNV-1a hash for collision-free ID disambiguation. */
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
function sanitizePathSegment(segment: string, fallback = 'note'): string {
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

/** Resolves the legacy dot-prefixed `<dir>/.<BaseName>.<safeBoxId>.svg` path for migration cleanup. */
export function getLegacyDotBoxSvgPath(mdPath: string, boxId: string): string {
    const { dir, baseName } = splitNotePath(mdPath);
    const safeBoxId = sanitizeBoxId(boxId);
    return `${dir ? `${dir}/` : ''}.${baseName}.${safeBoxId}.svg`;
}

/** Resolves `<dir>/<BaseName>.md` from a trigger path `<dir>/<BaseName>.apnote`. */
export function resolveMdFromTrigger(apnotePath: string): string {
    return splitNotePath(apnotePath).mdPath;
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

    if (lower.endsWith('.svg')) {
        const rawStem = fileName.slice(0, -'.svg'.length);
        const stem = rawStem.startsWith('.') ? rawStem.slice(1) : rawStem;
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
 * Returns `true` for `.<BaseName>.global.json`, `.<BaseName>.<boxId>.svg`, or `<BaseName>.md`
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

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
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
        if (bytes.length >= 4 && bytes[2] === 0x03 && bytes[3] === 0x04) {
            return 'zip';
        }
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

/** Rewrites `![[.<OldBaseName>.<boxId>.svg]]` or `![[<OldBaseName>.<boxId>.svg]]` fallback embeds inside markdown when a note is renamed. */
export function rewriteSatelliteEmbedLinks(markdown: string, oldBaseName: string, newBaseName: string): string {
    if (!markdown || !oldBaseName || !newBaseName || oldBaseName === newBaseName) {
        return markdown;
    }
    const escapedOld = escapeRegexLiteral(oldBaseName);
    const wikiEmbedRegex = new RegExp(`(!\\[\\[)\\.?(${escapedOld})(\\.[^\\]|\\r\\n]+\\.svg(?:\\|[^\\]]*)?\\]\\])`, 'g');
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
        const embedRegex = new RegExp(`!\\[\\[\\.?${escapedBase}\\.([A-Za-z0-9_-]+)\\.svg(?:\\|[^\\]]*)?\\]\\]`, 'g');
        while ((m = embedRegex.exec(markdown)) !== null) {
            addId(m[1]);
        }
    }

    return ids;
}

// =============================================================================
// Portable ZIP Codec (JSZip runtime integration + pure TS PKZIP fallback)
// =============================================================================

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function computeCrc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRawIfBeneficial(bytes: Uint8Array): Promise<{ method: 0 | 8; payload: Uint8Array }> {
    if (bytes.length < 32 || typeof CompressionStream !== 'function') {
        return { method: 0, payload: bytes };
    }
    try {
        const cs = new CompressionStream('deflate-raw');
        const writer = cs.writable.getWriter();
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        const writePromise = writer.write(copy).then(() => writer.close());
        const compressedBuf = await new Response(cs.readable).arrayBuffer();
        await writePromise;
        const compressed = new Uint8Array(compressedBuf);
        if (compressed.length < bytes.length) {
            return { method: 8, payload: compressed };
        }
    } catch {
        // Fallback to uncompressed STORE
    }
    return { method: 0, payload: bytes };
}

async function inflateRawBytes(bytes: Uint8Array): Promise<Uint8Array> {
    if (typeof DecompressionStream !== 'function') {
        throw new Error('DecompressionStream("deflate-raw") is unavailable to unpack compressed .apnote archive.');
    }
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const writePromise = writer.write(copy).then(() => writer.close());
    const decompressedBuf = await new Response(ds.readable).arrayBuffer();
    await writePromise;
    return new Uint8Array(decompressedBuf);
}

interface RuntimeJSZipInstance {
    file(name: string, data?: string | Uint8Array | ArrayBuffer): any;
    files?: Record<string, { dir?: boolean; async(type: 'uint8array'): Promise<Uint8Array> }>;
    loadAsync(data: ArrayBuffer | Uint8Array): Promise<RuntimeJSZipInstance>;
    generateAsync(options: { type: 'arraybuffer'; compression?: string }): Promise<ArrayBuffer>;
}

function getRuntimeJSZipConstructor(): (new () => RuntimeJSZipInstance) | null {
    const ctor = (globalThis as { JSZip?: unknown }).JSZip;
    return typeof ctor === 'function' ? (ctor as new () => RuntimeJSZipInstance) : null;
}

async function encodeZipEntries(entries: Array<{ name: string; data: Uint8Array }>): Promise<ArrayBuffer> {
    const JSZipCtor = getRuntimeJSZipConstructor();
    if (JSZipCtor) {
        try {
            const zip = new JSZipCtor();
            for (const entry of entries) {
                zip.file(entry.name, entry.data);
            }
            const out = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
            if (isZipApnote(out)) {
                return out;
            }
        } catch {
            // Fall through to built-in PKZIP encoder
        }
    }

    const textEncoder = new TextEncoder();
    const localParts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];
    let localOffset = 0;

    for (const entry of entries) {
        const nameBytes = textEncoder.encode(entry.name);
        const crc = computeCrc32(entry.data);
        const { method, payload } = await deflateRawIfBeneficial(entry.data);

        // Local file header (30 bytes + filename)
        const localHeader = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(localHeader.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true); // Version needed to extract
        lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
        lv.setUint16(8, method, true);
        lv.setUint16(10, 0, true); // Mod time
        lv.setUint16(12, 0, true); // Mod date
        lv.setUint32(14, crc, true);
        lv.setUint32(18, payload.length, true);
        lv.setUint32(22, entry.data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true); // Extra field length
        localHeader.set(nameBytes, 30);

        // Central directory header (46 bytes + filename)
        const centralHeader = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(centralHeader.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true); // Version made by
        cv.setUint16(6, 20, true); // Version needed
        cv.setUint16(8, 0x0800, true); // UTF-8 flag
        cv.setUint16(10, method, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, payload.length, true);
        cv.setUint32(24, entry.data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true); // Extra length
        cv.setUint16(32, 0, true); // Comment length
        cv.setUint16(34, 0, true); // Disk number start
        cv.setUint16(36, 0, true); // Internal attributes
        cv.setUint32(38, 0, true); // External attributes
        cv.setUint32(42, localOffset, true);
        centralHeader.set(nameBytes, 46);

        localParts.push(localHeader, payload);
        centralParts.push(centralHeader);
        localOffset += localHeader.length + payload.length;
    }

    const centralSize = centralParts.reduce((acc, part) => acc + part.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, localOffset, true);
    ev.setUint16(20, 0, true);

    const totalSize = localOffset + centralSize + eocd.length;
    const output = new Uint8Array(totalSize);
    let cursor = 0;
    for (const part of localParts) {
        output.set(part, cursor);
        cursor += part.length;
    }
    for (const part of centralParts) {
        output.set(part, cursor);
        cursor += part.length;
    }
    output.set(eocd, cursor);
    return output.buffer;
}

async function decodeZipEntries(archiveBuffer: ArrayBuffer | Uint8Array): Promise<Map<string, Uint8Array>> {
    const JSZipCtor = getRuntimeJSZipConstructor();
    if (JSZipCtor) {
        try {
            const zip = new JSZipCtor();
            const loaded = await zip.loadAsync(archiveBuffer);
            const result = new Map<string, Uint8Array>();
            if (loaded.files) {
                for (const [name, entry] of Object.entries(loaded.files)) {
                    if (!entry || entry.dir) continue;
                    result.set(name, await entry.async('uint8array'));
                }
                return result;
            }
        } catch {
            // Fall through to built-in PKZIP parser
        }
    }

    const bytes = toUint8Array(archiveBuffer);
    if (bytes.length < 22 || !isZipApnote(bytes)) {
        throw new Error('Invalid .apnote archive: missing PKZIP header.');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const minEocdOffset = Math.max(0, bytes.length - 65557);
    let eocdOffset = -1;
    for (let i = bytes.length - 22; i >= minEocdOffset; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }
    if (eocdOffset < 0) {
        throw new Error('Invalid .apnote archive: End of Central Directory not found.');
    }

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const centralDirOffset = view.getUint32(eocdOffset + 16, true);
    const textDecoder = new TextDecoder();
    const entries = new Map<string, Uint8Array>();

    let offset = centralDirOffset;
    for (let i = 0; i < totalEntries; i++) {
        if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
            throw new Error('Corrupt .apnote archive: invalid central directory header.');
        }
        const method = view.getUint16(offset + 10, true);
        const expectedCrc = view.getUint32(offset + 16, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const uncompressedSize = view.getUint32(offset + 24, true);
        const nameLen = view.getUint16(offset + 28, true);
        const extraLen = view.getUint16(offset + 30, true);
        const commentLen = view.getUint16(offset + 32, true);
        const localHeaderOffset = view.getUint32(offset + 42, true);

        const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLen);
        const entryName = textDecoder.decode(nameBytes);
        offset += 46 + nameLen + extraLen + commentLen;

        if (entryName.endsWith('/')) continue;

        if (localHeaderOffset + 30 > bytes.length || view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
            throw new Error(`Corrupt .apnote archive: invalid local file header for "${entryName}".`);
        }
        const localNameLen = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > bytes.length) {
            throw new Error(`Corrupt .apnote archive: truncated payload for "${entryName}".`);
        }

        const compressedPayload = bytes.subarray(dataStart, dataEnd);
        let payload: Uint8Array;
        if (method === 0) {
            payload = compressedPayload.slice();
        } else if (method === 8) {
            payload = await inflateRawBytes(compressedPayload);
        } else {
            throw new Error(`Unsupported ZIP compression method ${method} for "${entryName}".`);
        }

        if (payload.length !== uncompressedSize || (expectedCrc !== 0 && computeCrc32(payload) !== expectedCrc)) {
            throw new Error(`Corrupt .apnote archive: checksum mismatch for "${entryName}".`);
        }
        entries.set(entryName, payload);
    }

    return entries;
}

/** Discovers all existing `<BaseName>.<boxId>.svg` (and legacy dot-prefixed) satellite paths for `mdPath`. */
export async function discoverBoxSvgPaths(vault: VaultLike, mdPath: string): Promise<string[]> {
    const split = splitNotePath(mdPath);
    const results = new Set<string>();

    // 1. Check existing .apnote manifest
    if (await vault.adapter.exists(split.apnotePath)) {
        try {
            const rawTrigger = await vault.adapter.read(split.apnotePath);
            const manifest = parseApnoteManifest(rawTrigger);
            if (manifest) {
                for (const boxId of manifest.canvases) {
                    for (const candidate of [getBoxSvgPath(split.mdPath, boxId), getLegacyDotBoxSvgPath(split.mdPath, boxId)]) {
                        if (await vault.adapter.exists(candidate)) {
                            results.add(candidate);
                        }
                    }
                }
            }
        } catch {
            // Ignore unreadable trigger manifest
        }
    }

    // 2. Scan folder listing when adapter.list is available
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

    // 3. Fallback scan of Markdown blocks / embeds (useful for mock adapters without list())
    if (await vault.adapter.exists(split.mdPath)) {
        try {
            const mdContent = await vault.adapter.read(split.mdPath);
            for (const boxId of extractReferencedBoxIds(mdContent, split.baseName)) {
                for (const candidate of [getBoxSvgPath(split.mdPath, boxId), getLegacyDotBoxSvgPath(split.mdPath, boxId)]) {
                    if (await vault.adapter.exists(candidate)) {
                        results.add(candidate);
                    }
                }
            }
        } catch {
            // Ignore read failure
        }
    }

    return Array.from(results);
}

/**
 * Packs `<BaseName>.md`, `.<BaseName>.global.json`, all `.<BaseName>.*.svg` files, and the
 * `.apnote` manifest into a single portable ZIP `ArrayBuffer` (starting with `PK\x03\x04`).
 */
export async function exportAsPortableApnote(vault: VaultLike, mdPath: string): Promise<ArrayBuffer> {
    const split = splitNotePath(mdPath);
    const encoder = new TextEncoder();
    const entries: Array<{ name: string; data: Uint8Array }> = [];

    let mdContent = '';
    if (await vault.adapter.exists(split.mdPath)) {
        mdContent = await vault.adapter.read(split.mdPath);
    } else {
        const tfile = vault.getAbstractFileByPath?.(split.mdPath);
        if (tfile && typeof vault.read === 'function') {
            mdContent = await vault.read(tfile);
        } else {
            throw new Error(`Cannot export portable .apnote: markdown file "${split.mdPath}" not found.`);
        }
    }
    entries.push({ name: `${split.baseName}.md`, data: encoder.encode(mdContent) });

    const globalPath = getGlobalInkPath(split.mdPath);
    const globalFileName = `.${split.baseName}.global.json`;
    if (await vault.adapter.exists(globalPath)) {
        const globalRaw = await vault.adapter.read(globalPath);
        entries.push({ name: globalFileName, data: encoder.encode(globalRaw) });
    } else {
        const emptyGlobal = JSON.stringify({ notePath: split.mdPath, updatedAt: Date.now(), elements: [] });
        entries.push({ name: globalFileName, data: encoder.encode(emptyGlobal) });
    }

    const svgPaths = await discoverBoxSvgPaths(vault, split.mdPath);
    const canvasIds: string[] = [];
    for (const svgPath of svgPaths) {
        const svgContent = await vault.adapter.read(svgPath);
        const fileName = svgPath.slice(svgPath.lastIndexOf('/') + 1);
        entries.push({ name: fileName, data: encoder.encode(svgContent) });
        const parsed = parseSatelliteFilename(svgPath);
        if (parsed?.boxId) {
            canvasIds.push(parsed.boxId);
        }
    }

    const manifest = createApnoteManifest(split.mdPath, canvasIds);
    entries.push({ name: `${split.baseName}.apnote`, data: encoder.encode(serializeApnoteManifest(manifest)) });

    return encodeZipEntries(entries);
}

/**
 * Unpacks a portable `.apnote` ZIP archive into `targetDir`, writes `<targetDir>/.nomedia`,
 * unpacks `<BaseName>.md`, `.<BaseName>.global.json`, and all `.<BaseName>.*.svg` satellites,
 * writes the uncompressed JSON `<BaseName>.apnote` trigger manifest, and returns `<targetDir>/<BaseName>.md`.
 */
export async function importPortableApnote(
    vault: VaultLike,
    archiveBuffer: ArrayBuffer | Uint8Array,
    targetDir: string,
    overrideBaseName?: string,
): Promise<string> {
    const cleanDir = normalizeVaultNotePath(targetDir);
    await ensureNoMediaFile(vault, cleanDir);

    const decodedEntries = await decodeZipEntries(archiveBuffer);
    const decoder = new TextDecoder();

    // Locate manifest & markdown entries cleanly using sanitized filenames
    let embeddedManifest: ApnoteManifest | null = null;
    let sourceMdName: string | null = null;
    const safeEntries = new Map<string, Uint8Array>();

    for (const [rawEntryName, contentBytes] of decodedEntries.entries()) {
        const normalizedEntry = normalizeVaultNotePath(rawEntryName);
        if (!normalizedEntry || normalizedEntry.includes('/')) {
            // Only read leaf filename for bundle-local satellites
            const leaf = normalizedEntry.split('/').pop() ?? '';
            if (!leaf || leaf === '.nomedia') continue;
            safeEntries.set(leaf, contentBytes);
        } else {
            if (normalizedEntry === '.nomedia') continue;
            safeEntries.set(normalizedEntry, contentBytes);
        }
    }

    for (const [name, contentBytes] of safeEntries.entries()) {
        if (!name.startsWith('.') && name.toLowerCase().endsWith('.apnote')) {
            const text = decoder.decode(contentBytes);
            const parsed = parseApnoteManifest(text);
            if (parsed) {
                embeddedManifest = parsed;
                sourceMdName = parsed.markdown;
                break;
            }
        }
    }

    if (!sourceMdName) {
        for (const name of safeEntries.keys()) {
            if (!name.startsWith('.') && name.toLowerCase().endsWith('.md')) {
                sourceMdName = name;
                break;
            }
        }
    }

    if (!sourceMdName || !safeEntries.has(sourceMdName)) {
        throw new Error('Portable .apnote archive is missing its markdown note.');
    }

    const archiveBaseName = sanitizePathSegment(sourceMdName.replace(/\.md$/i, ''), 'note');
    const targetBaseName = overrideBaseName ? sanitizePathSegment(overrideBaseName, archiveBaseName) : archiveBaseName;
    const prefix = cleanDir ? `${cleanDir}/` : '';

    const targetMdPath = `${prefix}${targetBaseName}.md`;
    const targetApnotePath = `${prefix}${targetBaseName}.apnote`;
    const targetGlobalPath = `${prefix}.${targetBaseName}.global.json`;

    let mdContent = decoder.decode(safeEntries.get(sourceMdName)!);
    if (archiveBaseName !== targetBaseName) {
        mdContent = rewriteSatelliteEmbedLinks(mdContent, archiveBaseName, targetBaseName);
    }
    await vault.adapter.write(targetMdPath, mdContent);

    const sourceGlobalName = embeddedManifest?.globalInk ?? `.${archiveBaseName}.global.json`;
    const globalBytes = safeEntries.get(sourceGlobalName);
    if (globalBytes) {
        let globalRaw = decoder.decode(globalBytes);
        try {
            const parsedGlobal = JSON.parse(globalRaw) as Record<string, unknown>;
            if (parsedGlobal && typeof parsedGlobal === 'object') {
                parsedGlobal.notePath = targetMdPath;
                globalRaw = JSON.stringify(parsedGlobal);
            }
        } catch {
            // Preserve raw content if non-standard
        }
        await vault.adapter.write(targetGlobalPath, globalRaw);
    }

    const unpackedCanvases: string[] = [];
    for (const [entryName, contentBytes] of safeEntries.entries()) {
        const parsed = parseSatelliteFilename(entryName);
        if (parsed && parsed.kind === 'box-svg' && parsed.baseName === archiveBaseName && parsed.boxId) {
            const targetSvgPath = getBoxSvgPath(targetMdPath, parsed.boxId);
            await vault.adapter.write(targetSvgPath, decoder.decode(contentBytes));
            unpackedCanvases.push(parsed.boxId);
        }
    }

    const manifestCanvases = embeddedManifest?.canvases.length ? embeddedManifest.canvases : unpackedCanvases;
    const targetManifest = createApnoteManifest(targetMdPath, manifestCanvases);
    await vault.adapter.write(targetApnotePath, serializeApnoteManifest(targetManifest));
    registerKnownApnote(targetApnotePath);

    return targetMdPath;
}

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

    if (newSplit.dir) {
        await ensureNoMediaFile(vault, newSplit.dir);
    } else {
        await ensureNoMediaFile(vault, '');
    }

    // 1. Move sibling .md if not already at destination
    if (!(await vault.adapter.exists(newSplit.mdPath)) && (await vault.adapter.exists(oldSplit.mdPath))) {
        if (await moveFileAcrossVault(vault, oldSplit.mdPath, newSplit.mdPath)) {
            movedPaths.push(newSplit.mdPath);
        }
    }

    // 2. Move sibling .apnote if not already at destination
    if (!(await vault.adapter.exists(newSplit.apnotePath)) && (await vault.adapter.exists(oldSplit.apnotePath))) {
        if (await moveFileAcrossVault(vault, oldSplit.apnotePath, newSplit.apnotePath)) {
            movedPaths.push(newSplit.apnotePath);
        }
    }

    // 3. Move .<BaseName>.global.json and update notePath inside
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

    // 4. Discover and move all <OldBaseName>.<boxId>.svg (and legacy dot-prefixed) satellites
    const boxIds: string[] = [];
    const oldSvgCandidates = new Set<string>();

    if (await vault.adapter.exists(newSplit.apnotePath)) {
        try {
            const raw = await vault.adapter.read(newSplit.apnotePath);
            const manifest = parseApnoteManifest(raw);
            if (manifest) {
                for (const id of manifest.canvases) {
                    oldSvgCandidates.add(getBoxSvgPath(oldSplit.mdPath, id));
                    oldSvgCandidates.add(getLegacyDotBoxSvgPath(oldSplit.mdPath, id));
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
                oldSvgCandidates.add(getLegacyDotBoxSvgPath(oldSplit.mdPath, boxId));
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
        if (await vault.adapter.exists(oldSvgPath)) {
            if (!(await vault.adapter.exists(newSvgPath))) {
                if (await moveFileAcrossVault(vault, oldSvgPath, newSvgPath)) {
                    movedPaths.push(newSvgPath);
                }
            } else if (oldSvgPath !== newSvgPath) {
                try {
                    await vault.adapter.remove(oldSvgPath);
                } catch {
                    // Best-effort cleanup of superseded legacy dotfile
                }
            }
        }
    }

    // 5. Rewrite ![[.<NewName>.*.svg]] links inside destination .md
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

    // 6. Update .apnote JSON manifest (skip if binary ZIP not yet unpacked)
    if (await vault.adapter.exists(newSplit.apnotePath)) {
        try {
            let isZip = false;
            if (typeof vault.adapter.readBinary === 'function') {
                const bin = await vault.adapter.readBinary(newSplit.apnotePath);
                isZip = isZipApnote(bin);
            } else {
                const raw = await vault.adapter.read(newSplit.apnotePath);
                isZip = isZipApnote(raw);
            }
            if (!isZip) {
                const existingRaw = await vault.adapter.read(newSplit.apnotePath);
                const existingManifest = parseApnoteManifest(existingRaw);
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

    return {
        oldMdPath: oldSplit.mdPath,
        newMdPath: newSplit.mdPath,
        oldApnotePath: oldSplit.apnotePath,
        newApnotePath: newSplit.apnotePath,
        movedPaths,
    };
}

/** Removes `.apnote`, `.global.json`, and `.<BaseName>.*.svg` satellites when a note is deleted. */
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
}

// =============================================================================
// File Explorer Cloaking Helpers (Pure DOM)
// =============================================================================

export const APOLO_SATELLITE_HIDDEN_CLASS = 'apolo-satellite-hidden';
export const APOLO_APNOTE_ITEM_CLASS = 'apolo-apnote-item';
export const APOLO_APNOTE_ICON_CLASS = 'apolo-apnote-icon';

/** Creates a subtle, minimalist vector icon for `.apnote` items in the Obsidian File Explorer. */
export function createApnoteExplorerIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', APOLO_APNOTE_ICON_CLASS);
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    const frame = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    frame.setAttribute('x', '2');
    frame.setAttribute('y', '2');
    frame.setAttribute('width', '12');
    frame.setAttribute('height', '12');
    frame.setAttribute('rx', '3');

    const wave = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    wave.setAttribute('d', 'M4.75 9.5c1.5-2.5 2.75-2.5 4.25 0s1.5 0 2.25-1.25');

    svg.appendChild(frame);
    svg.appendChild(wave);
    return svg;
}

/**
 * Cloaks `<BaseName>.md`, `.<BaseName>.global.json`, and `<BaseName>.<boxId>.svg` satellite items
 * inside Obsidian's File Explorer whenever a sibling `<BaseName>.apnote` exists in the same folder,
 * leaving only `<BaseName>.apnote` visible with a minimalist Apolo icon.
 */
export function applyFileExplorerCloaking(root: ParentNode, vault?: VaultLike): void {
    const items = root.querySelectorAll<HTMLElement>('.nav-file-title[data-path], .tree-item-self[data-path]');
    const apnoteSet = new Set<string>(knownApnotePaths);
    const activeApnotePaths = new Set<string>();

    if (vault?.getFiles) {
        for (const f of vault.getFiles()) {
            const norm = normalizeVaultNotePath(f.path);
            if (norm.toLowerCase().endsWith('.apnote')) {
                apnoteSet.add(norm);
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

    for (let i = 0; i < items.length; i++) {
        const titleEl = items[i];
        const rawPath = titleEl.dataset?.path || titleEl.getAttribute('data-path') || '';
        const normPath = normalizeVaultNotePath(rawPath);
        if (!normPath) continue;

        const rowEl = titleEl.closest?.('.nav-file, .tree-item') as HTMLElement | null ?? titleEl;
        const parsed = parseSatelliteFilename(normPath);

        if (parsed?.kind === 'apnote') {
            rowEl.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            titleEl.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            titleEl.classList.add(APOLO_APNOTE_ITEM_CLASS);
            if (activeApnotePaths.has(normPath)) {
                titleEl.classList.add('is-active');
            } else {
                titleEl.classList.remove('is-active');
            }
            if (!titleEl.querySelector(`.${APOLO_APNOTE_ICON_CLASS}`)) {
                const icon = createApnoteExplorerIcon();
                if (typeof titleEl.insertBefore === 'function' && titleEl.firstChild) {
                    titleEl.insertBefore(icon, titleEl.firstChild);
                } else {
                    titleEl.appendChild(icon);
                }
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
        } else {
            rowEl.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
            titleEl.classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
        }
    }
}

/** Removes all File Explorer cloaking classes and injected Apolo `.apnote` icons on unload. */
export function removeFileExplorerCloaking(root: ParentNode): void {
    const hiddenEls = root.querySelectorAll<HTMLElement>(`.${APOLO_SATELLITE_HIDDEN_CLASS}`);
    for (let i = 0; i < hiddenEls.length; i++) {
        hiddenEls[i].classList.remove(APOLO_SATELLITE_HIDDEN_CLASS);
    }
    const apnoteEls = root.querySelectorAll<HTMLElement>(`.${APOLO_APNOTE_ITEM_CLASS}`);
    for (let i = 0; i < apnoteEls.length; i++) {
        apnoteEls[i].classList.remove(APOLO_APNOTE_ITEM_CLASS);
    }
    const iconEls = root.querySelectorAll<Element>(`.${APOLO_APNOTE_ICON_CLASS}`);
    for (let i = 0; i < iconEls.length; i++) {
        iconEls[i].remove();
    }
}
