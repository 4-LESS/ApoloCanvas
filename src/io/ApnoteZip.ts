import {
    type ApnoteManifest,
    createApnoteManifest,
    discoverBoxSvgPaths,
    ensureNoMediaFile,
    getBoxSvgPath,
    getGlobalInkPath,
    isZipApnote,
    normalizeVaultNotePath,
    parseApnoteManifest,
    parseSatelliteFilename,
    registerKnownApnote,
    rewriteSatelliteEmbedLinks,
    sanitizePathSegment,
    serializeApnoteManifest,
    splitNotePath,
    toUint8Array,
    type VaultLike,
} from './ApnotePaths.ts';

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

        const localHeader = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(localHeader.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true);
        lv.setUint16(8, method, true);
        lv.setUint16(10, 0, true);
        lv.setUint16(12, 0, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, payload.length, true);
        lv.setUint32(22, entry.data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        localHeader.set(nameBytes, 30);

        const centralHeader = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(centralHeader.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, method, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, payload.length, true);
        cv.setUint32(24, entry.data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
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

/**
 * Packs `<BaseName>.md`, `.<BaseName>.global.json`, all `<BaseName>.*.svg` files, and the
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
 * unpacks `<BaseName>.md`, `.<BaseName>.global.json`, and all `<BaseName>.*.svg` satellites,
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

    let embeddedManifest: ApnoteManifest | null = null;
    let sourceMdName: string | null = null;
    const safeEntries = new Map<string, Uint8Array>();

    for (const [rawEntryName, contentBytes] of decodedEntries.entries()) {
        const normalizedEntry = normalizeVaultNotePath(rawEntryName);
        if (!normalizedEntry) continue;
        const leaf = normalizedEntry.includes('/') ? normalizedEntry.split('/').pop() ?? '' : normalizedEntry;
        if (!leaf || leaf === '.nomedia') continue;
        safeEntries.set(leaf, contentBytes);
    }

    for (const [name, contentBytes] of safeEntries.entries()) {
        if (!name.startsWith('.') && name.toLowerCase().endsWith('.apnote')) {
            const parsed = parseApnoteManifest(decoder.decode(contentBytes));
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
