import { describe, test } from 'node:test';
import assert from 'node:assert';
import { EditorState, StateField } from '@codemirror/state';
import {
    APOLO_APNOTE_ICON_CLASS,
    APOLO_APNOTE_ITEM_CLASS,
    APOLO_BUNDLE_FOLDER_CLASS,
    APOLO_SATELLITE_HIDDEN_CLASS,
    applyFileExplorerCloaking,
    attachMakeMdBridge,
    clearKnownApnotes,
    createApnoteManifest,
    detectApnoteFormat,
    ensureNoMediaFile,
    ensureNoteInBundleFolder,
    exportAsPortableApnote,
    getApnoteTriggerPath,
    getBoxSvgPath,
    getBundledMdPath,
    getGlobalInkPath,
    getNoteBundleFolderPath,
    importPortableApnote,
    isInsideNoteBundleFolder,
    isJsonApnote,
    isSatelliteFile,
    isZipApnote,
    parseApnoteManifest,
    registerKnownApnote,
    removeFileExplorerCloaking,
    resolveBundleFolderPaths,
    resolveMdFromTrigger,
    serializeApnoteManifest,
    syncAtomicRename,
    syncMakeMdBundleState,
    type VaultLike,
} from '../src/io/ApnoteBundle.ts';
import { PersistenceQueue, syncMarkdownFallbackEmbeds } from '../src/io/PersistenceQueue.ts';
import {
    apoloSpaceField,
    configureLivePreviewField,
    createApoloSpaceExtension,
} from '../src/editor/ApoloSpaceExtension.ts';
import type { PageDocument, ShapeElement, StrokeElement } from '../src/core/types.ts';

function createMockVault(initialFiles: Record<string, string | Uint8Array> = {}): {
    vault: VaultLike;
    files: Map<string, string | Uint8Array>;
    directories: Set<string>;
} {
    const files = new Map<string, string | Uint8Array>(Object.entries(initialFiles));
    const directories = new Set<string>();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const recordDirsForPath = (path: string) => {
        const parts = path.split('/').filter(Boolean);
        parts.pop();
        let cur = '';
        for (const p of parts) {
            cur = cur ? `${cur}/${p}` : p;
            directories.add(cur);
        }
    };
    for (const p of files.keys()) {
        recordDirsForPath(p);
    }

    const toBytes = (val: string | Uint8Array): Uint8Array =>
        typeof val === 'string' ? encoder.encode(val) : val;

    const toText = (val: string | Uint8Array): string =>
        typeof val === 'string' ? val : decoder.decode(val);

    const makeTFile = (p: string) => ({
        path: p,
        extension: p.includes('.') ? p.slice(p.lastIndexOf('.') + 1) : '',
    });

    const vault: VaultLike = {
        getAbstractFileByPath(p: string) {
            // Obsidian ignores dotfiles in getAbstractFileByPath, only tracking visible files
            const base = p.split('/').pop() ?? p;
            if (!base.startsWith('.') && files.has(p)) {
                return makeTFile(p);
            }
            return null;
        },
        getFileByPath(p: string) {
            const base = p.split('/').pop() ?? p;
            if (!base.startsWith('.') && files.has(p)) {
                return makeTFile(p);
            }
            return null;
        },
        getFiles() {
            const list: Array<{ path: string; extension?: string }> = [];
            for (const p of files.keys()) {
                const base = p.split('/').pop() ?? p;
                if (!base.startsWith('.')) {
                    list.push(makeTFile(p));
                }
            }
            return list;
        },
        async read(file: { path: string }) {
            const val = files.get(file.path);
            if (val === undefined) throw new Error(`ENOENT: ${file.path}`);
            return toText(val);
        },
        async readBinary(file: { path: string }) {
            const val = files.get(file.path);
            if (val === undefined) throw new Error(`ENOENT: ${file.path}`);
            const bytes = toBytes(val);
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
        async modify(file: { path: string }, data: string) {
            if (!files.has(file.path)) throw new Error(`ENOENT: ${file.path}`);
            files.set(file.path, data);
        },
        async create(p: string, data: string) {
            recordDirsForPath(p);
            files.set(p, data);
            return makeTFile(p);
        },
        async rename(file: { path: string }, newPath: string) {
            const val = files.get(file.path);
            if (val === undefined) throw new Error(`ENOENT: ${file.path}`);
            recordDirsForPath(newPath);
            files.delete(file.path);
            files.set(newPath, val);
            file.path = newPath;
        },
        async delete(file: { path: string }) {
            files.delete(file.path);
        },
        adapter: {
            async exists(p: string) {
                return files.has(p) || directories.has(p);
            },
            async mkdir(p: string) {
                directories.add(p);
            },
            async rmdir(p: string) {
                directories.delete(p);
            },
            async read(p: string) {
                const val = files.get(p);
                if (val === undefined) throw new Error(`ENOENT: ${p}`);
                return toText(val);
            },
            async readBinary(p: string) {
                const val = files.get(p);
                if (val === undefined) throw new Error(`ENOENT: ${p}`);
                const bytes = toBytes(val);
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            },
            async write(p: string, data: string) {
                recordDirsForPath(p);
                files.set(p, data);
            },
            async writeBinary(p: string, data: ArrayBuffer | Uint8Array) {
                recordDirsForPath(p);
                const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data);
                files.set(p, bytes);
            },
            async remove(p: string) {
                files.delete(p);
            },
            async rename(oldP: string, newP: string) {
                const val = files.get(oldP);
                if (val === undefined) throw new Error(`ENOENT: ${oldP}`);
                recordDirsForPath(newP);
                files.delete(oldP);
                files.set(newP, val);
            },
            async list(dirPath: string) {
                const cleanDir = dirPath.replace(/^\/+|\/+$/g, '');
                const listedFiles: string[] = [];
                const listedFolders: string[] = [];
                for (const p of files.keys()) {
                    const idx = p.lastIndexOf('/');
                    const parent = idx === -1 ? '' : p.slice(0, idx);
                    if (parent === cleanDir) {
                        listedFiles.push(p);
                    }
                }
                for (const d of directories) {
                    const idx = d.lastIndexOf('/');
                    const parent = idx === -1 ? '' : d.slice(0, idx);
                    if (parent === cleanDir && d !== cleanDir) {
                        listedFolders.push(d);
                    }
                }
                return { files: listedFiles, folders: listedFolders };
            },
        },
    };

    return { vault, files, directories };
}

class MockClassList {
    private set = new Set<string>();
    add(c: string) { this.set.add(c); }
    remove(c: string) { this.set.delete(c); }
    contains(c: string) { return this.set.has(c); }
}

class MockExplorerNode {
    tagName: string;
    attributes = new Map<string, string>();
    dataset: Record<string, string> = {};
    classList = new MockClassList();
    children: MockExplorerNode[] = [];
    parentElement: MockExplorerNode | null = null;

    constructor(tagName = 'div') {
        this.tagName = tagName;
    }

    get firstChild(): MockExplorerNode | null {
        return this.children[0] ?? null;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
        if (name === 'data-path') this.dataset.path = value;
        if (name === 'class') {
            for (const c of value.split(/\s+/).filter(Boolean)) {
                this.classList.add(c);
            }
        }
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    appendChild(child: MockExplorerNode): MockExplorerNode {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    insertBefore(child: MockExplorerNode, ref: MockExplorerNode | null): MockExplorerNode {
        child.parentElement = this;
        const idx = ref ? this.children.indexOf(ref) : -1;
        if (idx >= 0) {
            this.children.splice(idx, 0, child);
        } else {
            this.children.push(child);
        }
        return child;
    }

    remove(): void {
        if (!this.parentElement) return;
        this.parentElement.children = this.parentElement.children.filter(c => c !== this);
        this.parentElement = null;
    }

    matchesSelector(sel: string): boolean {
        const parts = sel.split(',').map(s => s.trim()).filter(Boolean);
        for (const p of parts) {
            if (p.startsWith('.') && p.endsWith('[data-path]')) {
                const cls = p.slice(1, -'[data-path]'.length);
                if (this.classList.contains(cls) && this.attributes.has('data-path')) return true;
            } else if (p.startsWith('.')) {
                const cls = p.slice(1);
                if (this.classList.contains(cls)) return true;
            }
        }
        return false;
    }

    closest(sel: string): MockExplorerNode | null {
        const classes = sel.split(',').map(s => s.trim().replace(/^\./, '')).filter(Boolean);
        let cur: MockExplorerNode | null = this;
        while (cur) {
            if (classes.some(c => cur!.classList.contains(c))) return cur;
            cur = cur.parentElement;
        }
        return null;
    }

    querySelector(sel: string): MockExplorerNode | null {
        return this.querySelectorAll(sel)[0] ?? null;
    }

    querySelectorAll(sel: string): MockExplorerNode[] {
        const results: MockExplorerNode[] = [];
        const visit = (node: MockExplorerNode) => {
            for (const ch of node.children) {
                if (ch.matchesSelector(sel)) results.push(ch);
                visit(ch);
            }
        };
        visit(this);
        return results;
    }
}

describe('.apnote Satellite Bundle Architecture', () => {
    test('satellite path helpers and isSatelliteFile classify note-local files accurately', () => {
        clearKnownApnotes();

        const mdPath = 'Courses/Physics/Wave Optics.md';
        assert.strictEqual(getApnoteTriggerPath(mdPath), 'Courses/Physics/Wave Optics.apnote');
        assert.strictEqual(getGlobalInkPath(mdPath), 'Courses/Physics/.Wave Optics.global.json');
        assert.strictEqual(getBoxSvgPath(mdPath, 'box-1'), 'Courses/Physics/Wave Optics.box-1.svg');
        assert.strictEqual(resolveMdFromTrigger('Courses/Physics/Wave Optics.apnote'), mdPath);

        assert.strictEqual(getApnoteTriggerPath('Root.md'), 'Root.apnote');
        assert.strictEqual(getGlobalInkPath('Root.md'), '.Root.global.json');
        assert.strictEqual(getBoxSvgPath('Root.md', 'b1'), 'Root.b1.svg');

        const siblings = new Set(['Courses/Physics/Wave Optics.apnote']);
        assert.strictEqual(isSatelliteFile('Courses/Physics/.Wave Optics.global.json', siblings), true);
        assert.strictEqual(isSatelliteFile('Courses/Physics/Wave Optics.box-1.svg', siblings), true);
        assert.strictEqual(isSatelliteFile('Courses/Physics/.Wave Optics.box-1.svg', siblings), true);
        assert.strictEqual(isSatelliteFile('Courses/Physics/Wave Optics.md', siblings), true);
        assert.strictEqual(isSatelliteFile('Courses/Physics/Wave Optics.apnote', siblings), false);
        assert.strictEqual(isSatelliteFile('Courses/Physics/Plain Note.md', siblings), false);

        registerKnownApnote('Courses/Physics/Wave Optics.apnote');
        assert.strictEqual(isSatelliteFile('Courses/Physics/Wave Optics.md'), true);
        clearKnownApnotes();
    });

    test('ensureNoMediaFile creates empty .nomedia guard and codec distinguishes JSON vs PKZIP .apnote', async () => {
        const { vault, files } = createMockVault();

        const noMediaNested = await ensureNoMediaFile(vault, 'Lectures/Week 1');
        assert.strictEqual(noMediaNested, 'Lectures/Week 1/.nomedia');
        assert.strictEqual(files.get('Lectures/Week 1/.nomedia'), '');

        const noMediaRoot = await ensureNoMediaFile(vault, '');
        assert.strictEqual(noMediaRoot, '.nomedia');
        assert.strictEqual(files.get('.nomedia'), '');

        const manifest = createApnoteManifest('Lectures/Week 1/Optics.md', ['box-a', 'box-b', 'box-a']);
        assert.deepStrictEqual(manifest, {
            format: 'apnote',
            version: 1,
            markdown: 'Optics.md',
            globalInk: '.Optics.global.json',
            canvases: ['box-a', 'box-b'],
        });

        const serialized = serializeApnoteManifest(manifest);
        assert.strictEqual(detectApnoteFormat(serialized), 'json');
        assert.strictEqual(isJsonApnote(serialized), true);
        assert.strictEqual(isZipApnote(serialized), false);
        assert.deepStrictEqual(parseApnoteManifest(serialized), manifest);

        const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
        assert.strictEqual(detectApnoteFormat(zipMagic), 'zip');
        assert.strictEqual(isZipApnote(zipMagic), true);
        assert.strictEqual(isJsonApnote(zipMagic), false);
        assert.strictEqual(detectApnoteFormat(zipMagic.buffer), 'zip');
    });

    test('PersistenceQueue flushSave/loadNoteInk round-trips global ink, parametric box shapes, stale SVG cleanup, and Live Preview suppression', async () => {
        const mdPath = 'Notes/Physics.md';
        const initialMd = [
            '# Wave Optics',
            '',
            '<div class="apolo-space" data-apolo-space="box-1" data-h="260" style="height:260px;"></div>',
            '',
            '<div class="apolo-space" data-apolo-space="box-2" data-h="200" style="height:200px;"></div>',
            '',
        ].join('\n');

        const { vault, files } = createMockVault({ [mdPath]: initialMd });
        const queue = new PersistenceQueue({ vault } as any);

        const globalStroke: StrokeElement = {
            id: 'stroke-global-1',
            type: 'stroke',
            blockId: 'heading:wave-optics',
            anchorText: '# Wave Optics',
            points: [0.1, 0.2, 0.5, 100, 0.4, 0.3, 0.6, 120],
            style: { color: '#1F4FD8', width: 3, opacity: 1, blendMode: 'source-over', pattern: 'solid' },
            bounds: { minX: 0.1, minY: 0.2, maxX: 0.4, maxY: 0.3 },
            timestamp: 1000,
        };

        const boxStroke: StrokeElement = {
            id: 'stroke-box-1',
            type: 'stroke',
            blockId: 'space:box-1',
            points: [0.15, 0.05, 0.7, 200, 0.45, 0.15, 0.7, 210],
            style: { color: '#D9480F', width: 2.5, opacity: 1, blendMode: 'source-over', pattern: 'solid' },
            bounds: { minX: 0.15, minY: 0.05, maxX: 0.45, maxY: 0.15 },
            timestamp: 1001,
        };

        const parametricShape: ShapeElement = {
            id: 'shape-box-1',
            type: 'shape',
            blockId: 'space:box-1',
            shapeType: 'rectangle',
            startX: 0.1,
            startY: 20,
            endX: 0.7,
            endY: 120,
            cornerRadius: 12,
            controlPoint: { x: 0.4, y: 0.02 },
            vertices: [{ x: 0.1, y: 0.08 }, { x: 0.4, y: 0.02 }, { x: 0.7, y: 0.18 }],
            rotation: 0.25,
            pathNodes: [{ x: 0.1, y: 0.08 }, { x: 0.7, y: 0.18 }],
            shapeParams: { curvature: 0.65, tension: 0.5 },
            startBinding: { elementId: 'stroke-box-1', portId: 'e' },
            endBinding: { elementId: 'stroke-global-1', portId: 'w' },
            fillEnabled: true,
            fillColor: '#10B981',
            fillOpacity: 0.15,
            fillPattern: 'solid',
            fillDensity: 1,
            style: { color: '#10B981', width: 2, opacity: 0.9, pattern: 'solid' },
            bounds: { minX: 0.1, minY: 20, maxX: 0.7, maxY: 120 },
            timestamp: 1002,
        };

        const box2Stroke: StrokeElement = {
            id: 'stroke-box-2',
            type: 'stroke',
            blockId: 'space:box-2',
            points: [0.2, 0.05, 0.5, 300, 0.6, 0.1, 0.5, 310],
            style: { color: '#111827', width: 2, opacity: 1, blendMode: 'source-over', pattern: 'dashed' },
            bounds: { minX: 0.2, minY: 0.05, maxX: 0.6, maxY: 0.1 },
            timestamp: 1003,
        };

        const doc: PageDocument = {
            schemaVersion: 1,
            version: 1,
            id: mdPath,
            notePath: mdPath,
            elements: [globalStroke, boxStroke, parametricShape, box2Stroke],
            boxes: {
                'box-1': { height: 260, gridStyle: 'dots', gridDensity: 32, bgTheme: 'paper' },
                'box-2': { height: 200, gridStyle: 'lines', gridDensity: 24 },
            },
            createdAt: 1000,
            updatedAt: 1003,
        };

        queue.enqueue(doc, { path: mdPath } as any, mdPath);
        await queue.flushSave();

        assert.strictEqual(files.get('Notes/.nomedia'), '');
        assert.ok(files.has('Notes/.Physics.global.json'));
        assert.ok(files.has('Notes/Physics.box-1.svg'));
        assert.ok(files.has('Notes/Physics.box-2.svg'));
        assert.ok(files.has('Notes/Physics.apnote'));

        const manifest = parseApnoteManifest(String(files.get('Notes/Physics.apnote')));
        assert.deepStrictEqual(manifest, {
            format: 'apnote',
            version: 1,
            markdown: 'Physics.md',
            globalInk: '.Physics.global.json',
            canvases: ['box-1', 'box-2'],
        });

        const updatedMd = String(files.get(mdPath));
        assert.ok(updatedMd.includes('![[Physics.box-1.svg]]'), 'Must insert native fallback embed for box-1');
        assert.ok(updatedMd.includes('![[Physics.box-2.svg]]'), 'Must insert native fallback embed for box-2');

        // Active Live Preview suppresses the adjacent fallback embed via Decoration.replace range
        const mockLiveField = StateField.define<boolean>({
            create: () => true,
            update: (v) => v,
        });
        try {
            const extensions = createApoloSpaceExtension(mockLiveField);
            const state = EditorState.create({
                doc: updatedMd,
                extensions: [mockLiveField, ...extensions],
            });
            const decos = state.field(apoloSpaceField);
            const ranges: Array<{ from: number; to: number }> = [];
            const iter = decos.iter();
            while (iter.value) {
                ranges.push({ from: iter.from, to: iter.to });
                iter.next();
            }
            assert.strictEqual(ranges.length, 2, 'Live Preview must replace both apolo-space blocks and hide their fallback embeds');
            const firstReplaced = updatedMd.slice(ranges[0].from, ranges[0].to);
            assert.ok(firstReplaced.includes('data-apolo-space="box-1"'));
            assert.ok(firstReplaced.includes('![[Physics.box-1.svg]]'), 'Live Preview decoration span must cover adjacent fallback embed');
        } finally {
            configureLivePreviewField(null);
        }

        // Cold load via loadNoteInk recovers global ink and all parametric shape fields
        const coldQueue = new PersistenceQueue({ vault } as any);
        const loaded = await coldQueue.loadNoteInk(mdPath);
        assert.strictEqual(loaded.elements.length, 4);
        const loadedShape = loaded.elements.find(e => e.id === 'shape-box-1') as ShapeElement | undefined;
        assert.ok(loadedShape);
        assert.strictEqual(loadedShape.cornerRadius, 12);
        assert.deepStrictEqual(loadedShape.controlPoint, { x: 0.4, y: 0.02 });
        assert.deepStrictEqual(loadedShape.vertices, [{ x: 0.1, y: 0.08 }, { x: 0.4, y: 0.02 }, { x: 0.7, y: 0.18 }]);
        assert.strictEqual(loadedShape.rotation, 0.25);
        assert.deepStrictEqual(loadedShape.pathNodes, [{ x: 0.1, y: 0.08 }, { x: 0.7, y: 0.18 }]);
        assert.deepStrictEqual(loadedShape.shapeParams, { curvature: 0.65, tension: 0.5 });
        assert.deepStrictEqual(loadedShape.startBinding, { elementId: 'stroke-box-1', portId: 'e' });
        assert.deepStrictEqual(loadedShape.endBinding, { elementId: 'stroke-global-1', portId: 'w' });

        // Remove box-2 and flush again -> stale Physics.box-2.svg must be removed cleanly
        const withoutBox2Md = [
            '# Wave Optics',
            '',
            '<div class="apolo-space" data-apolo-space="box-1" data-h="260" style="height:260px;"></div>',
            '![[Physics.box-1.svg]]',
            '',
        ].join('\n');
        files.set(mdPath, withoutBox2Md);
        const trimmedDoc: PageDocument = {
            ...doc,
            elements: [globalStroke, boxStroke, parametricShape],
            boxes: { 'box-1': { height: 260, gridStyle: 'dots', gridDensity: 32, bgTheme: 'paper' } },
            updatedAt: 1004,
        };
        queue.enqueue(trimmedDoc, { path: mdPath } as any, mdPath);
        await queue.flushSave();

        assert.strictEqual(files.has('Notes/Physics.box-1.svg'), true);
        assert.strictEqual(files.has('Notes/Physics.box-2.svg'), false, 'Stale removed box SVG must be deleted');
        const updatedManifest = parseApnoteManifest(String(files.get('Notes/Physics.apnote')));
        assert.deepStrictEqual(updatedManifest?.canvases, ['box-1']);
    });

    test('exportAsPortableApnote -> importPortableApnote round-trips note, global ink, multiple box SVGs, and rewrites links', async () => {
        const mdPath = 'Notes/Chem.md';
        const mdWithEmbeds = syncMarkdownFallbackEmbeds(
            [
                '# Organic Chemistry',
                '',
                '<div class="apolo-space" data-apolo-space="c1" data-h="180" style="height:180px;"></div>',
                '',
                '<div class="apolo-space" data-apolo-space="c2" data-h="220" style="height:220px;"></div>',
            ].join('\n'),
            mdPath,
            ['c1', 'c2'],
        );

        const { vault: srcVault, files: srcFiles } = createMockVault({ [mdPath]: mdWithEmbeds });
        const queue = new PersistenceQueue({ vault: srcVault } as any);
        const doc: PageDocument = {
            schemaVersion: 1,
            version: 1,
            id: mdPath,
            notePath: mdPath,
            elements: [
                {
                    id: 'g-1',
                    type: 'stroke',
                    blockId: 'heading:chem',
                    points: [0.1, 0.1, 0.5, 10, 0.3, 0.2, 0.5, 20],
                    style: { color: '#111827', width: 2, opacity: 1, blendMode: 'source-over' },
                    bounds: { minX: 0.1, minY: 0.1, maxX: 0.3, maxY: 0.2 },
                    timestamp: 100,
                },
                {
                    id: 'b-c1',
                    type: 'stroke',
                    blockId: 'space:c1',
                    points: [0.1, 0.05, 0.6, 30, 0.5, 0.09, 0.6, 40],
                    style: { color: '#1F4FD8', width: 2, opacity: 1, blendMode: 'source-over' },
                    bounds: { minX: 0.1, minY: 0.05, maxX: 0.5, maxY: 0.09 },
                    timestamp: 101,
                },
                {
                    id: 'b-c2',
                    type: 'stroke',
                    blockId: 'space:c2',
                    points: [0.2, 0.05, 0.6, 50, 0.7, 0.1, 0.6, 60],
                    style: { color: '#E53935', width: 3, opacity: 1, blendMode: 'source-over' },
                    bounds: { minX: 0.2, minY: 0.05, maxX: 0.7, maxY: 0.1 },
                    timestamp: 102,
                },
            ],
            boxes: {
                c1: { height: 180 },
                c2: { height: 220 },
            },
            createdAt: 100,
            updatedAt: 102,
        };

        queue.enqueue(doc, { path: mdPath } as any, mdPath);
        await queue.flushSave();
        assert.ok(srcFiles.has('Notes/.Chem.c1.svg') === false && srcFiles.has('Notes/Chem.c1.svg'));

        const archiveBuffer = await exportAsPortableApnote(srcVault, mdPath);
        assert.strictEqual(isZipApnote(archiveBuffer), true, 'Exported archive must carry PK\\x03\\x04 ZIP signature');

        const { vault: dstVault, files: dstFiles } = createMockVault();
        const importedMdPath = await importPortableApnote(dstVault, archiveBuffer, 'Shared/Inbox', 'ChemCopy');
        assert.strictEqual(importedMdPath, 'Shared/Inbox/ChemCopy.md');

        assert.strictEqual(dstFiles.get('Shared/Inbox/.nomedia'), '');
        assert.ok(dstFiles.has('Shared/Inbox/ChemCopy.md'));
        assert.ok(dstFiles.has('Shared/Inbox/ChemCopy.apnote'));
        assert.ok(dstFiles.has('Shared/Inbox/.ChemCopy.global.json'));
        assert.ok(dstFiles.has('Shared/Inbox/ChemCopy.c1.svg'));
        assert.ok(dstFiles.has('Shared/Inbox/ChemCopy.c2.svg'));

        const importedManifestRaw = String(dstFiles.get('Shared/Inbox/ChemCopy.apnote'));
        assert.strictEqual(isJsonApnote(importedManifestRaw), true);
        assert.deepStrictEqual(parseApnoteManifest(importedManifestRaw), {
            format: 'apnote',
            version: 1,
            markdown: 'ChemCopy.md',
            globalInk: '.ChemCopy.global.json',
            canvases: ['c1', 'c2'],
        });

        const importedMd = String(dstFiles.get(importedMdPath));
        assert.ok(importedMd.includes('![[ChemCopy.c1.svg]]'));
        assert.ok(importedMd.includes('![[ChemCopy.c2.svg]]'));
        assert.ok(!importedMd.includes('![[Chem.c1.svg]]'));

        const reloadQueue = new PersistenceQueue({ vault: dstVault } as any);
        const reloaded = await reloadQueue.loadNoteInk(importedMdPath);
        assert.strictEqual(reloaded.elements.length, 3);
        assert.deepStrictEqual(new Set(reloaded.elements.map(e => e.id)), new Set(['g-1', 'b-c1', 'b-c2']));
    });

    test('syncAtomicRename and PersistenceQueue.onFileRenamed move all satellites across folders and rewrite embed links', async () => {
        const oldMdPath = 'Notes/Draft.md';
        const { vault, files } = createMockVault({
            [oldMdPath]: [
                '# Draft',
                '<div class="apolo-space" data-apolo-space="panel-1" style="height:200px;"></div>',
                '![[Draft.panel-1.svg]]',
            ].join('\n'),
            'Notes/Draft.apnote': serializeApnoteManifest(createApnoteManifest(oldMdPath, ['panel-1'])),
            'Notes/.Draft.global.json': JSON.stringify({
                schemaVersion: 1,
                version: 1,
                notePath: oldMdPath,
                elements: [{
                    id: 'g-draft',
                    type: 'stroke',
                    blockId: 'heading:draft',
                    points: [0.1, 0.1, 0.5, 1, 0.2, 0.2, 0.5, 2],
                    style: { color: '#111827', width: 2, opacity: 1, blendMode: 'source-over' },
                    bounds: { minX: 0.1, minY: 0.1, maxX: 0.2, maxY: 0.2 },
                    timestamp: 10,
                }],
            }),
            'Notes/Draft.panel-1.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200" data-apolo-box-record="{&quot;boxId&quot;:&quot;panel-1&quot;,&quot;height&quot;:200,&quot;elements&quot;:[]}"></svg>',
        });

        // Move/rename via .apnote across folders
        const result = await syncAtomicRename(vault, 'Notes/Draft.apnote', 'Archive/2026/Final.apnote');
        assert.ok(result);
        assert.strictEqual(files.has('Archive/2026/.nomedia'), true);
        assert.strictEqual(files.has('Archive/2026/Final.md'), true);
        assert.strictEqual(files.has('Archive/2026/Final.apnote'), true);
        assert.strictEqual(files.has('Archive/2026/.Final.global.json'), true);
        assert.strictEqual(files.has('Archive/2026/Final.panel-1.svg'), true);

        assert.strictEqual(files.has('Notes/Draft.md'), false);
        assert.strictEqual(files.has('Notes/Draft.apnote'), false);
        assert.strictEqual(files.has('Notes/.Draft.global.json'), false);
        assert.strictEqual(files.has('Notes/Draft.panel-1.svg'), false);

        const movedMd = String(files.get('Archive/2026/Final.md'));
        assert.ok(movedMd.includes('![[Final.panel-1.svg]]'));
        assert.ok(!movedMd.includes('![[Draft.panel-1.svg]]'));

        // Rename again via PersistenceQueue.onFileRenamed using .md path
        const queue = new PersistenceQueue({ vault } as any);
        await queue.onFileRenamed('Archive/2026/Final.md', 'Published/Release.md');
        assert.strictEqual(files.has('Published/.nomedia'), true);
        assert.strictEqual(files.has('Published/Release.md'), true);
        assert.strictEqual(files.has('Published/Release.apnote'), true);
        assert.strictEqual(files.has('Published/.Release.global.json'), true);
        assert.strictEqual(files.has('Published/Release.panel-1.svg'), true);

        const releaseMd = String(files.get('Published/Release.md'));
        assert.ok(releaseMd.includes('![[Release.panel-1.svg]]'));

        const reloaded = await queue.loadNoteInk('Published/Release.md');
        assert.strictEqual(reloaded.elements.length, 1);
        assert.strictEqual(reloaded.elements[0].id, 'g-draft');
    });

    test('applyFileExplorerCloaking hides sibling satellites and bundle children without injecting any icons', () => {
        clearKnownApnotes();
        const prevDoc = globalThis.document;
        const container = new MockExplorerNode('div');
        container.classList.add('nav-files-container');

        globalThis.document = {
            createElementNS: (_ns: string, tag: string) => new MockExplorerNode(tag),
        } as any;

        const addRow = (path: string) => {
            const row = new MockExplorerNode('div');
            row.classList.add('nav-file');
            const title = new MockExplorerNode('div');
            title.classList.add('nav-file-title');
            title.setAttribute('data-path', path);
            row.appendChild(title);
            container.appendChild(row);
            return { row, title };
        };

        const addFolderRow = (path: string) => {
            const row = new MockExplorerNode('div');
            row.classList.add('nav-folder');
            const title = new MockExplorerNode('div');
            title.classList.add('nav-folder-title');
            title.setAttribute('data-path', path);
            row.appendChild(title);
            container.appendChild(row);
            return { row, title };
        };

        const apnoteRow = addRow('Notes/Quantum.apnote');
        // Pre-seed a stale icon to verify cloaking actively strips all icons
        const staleIcon = new MockExplorerNode('svg');
        staleIcon.classList.add(APOLO_APNOTE_ICON_CLASS);
        apnoteRow.title.appendChild(staleIcon);

        const mdRow = addRow('Notes/Quantum.md');
        mdRow.title.classList.add('is-active');
        const globalRow = addRow('Notes/.Quantum.global.json');
        const svgRow = addRow('Notes/Quantum.box1.svg');
        const plainMdRow = addRow('Notes/Standalone.md');

        const regularFolderRow = addFolderRow('Notes/RegularFolder');
        const bundledFolderRow = addFolderRow('Notes/Bundled');
        const bundledApnoteRow = addRow('Notes/Bundled/Bundled.apnote');
        const bundledMdRow = addRow('Notes/Bundled/Bundled.md');
        const bundledSvgRow = addRow('Notes/Bundled/Bundled.b1.svg');

        try {
            registerKnownApnote('Notes/Bundled/Bundled.apnote');
            applyFileExplorerCloaking(container as any, undefined, 'Notes/Bundled/Bundled.md');

            assert.strictEqual(apnoteRow.row.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), false);
            assert.strictEqual(apnoteRow.title.classList.contains(APOLO_APNOTE_ITEM_CLASS), true);
            assert.strictEqual(apnoteRow.title.classList.contains('is-active'), true, 'Must highlight .apnote row when hidden .md sibling is active');
            assert.strictEqual(apnoteRow.title.querySelector(`.${APOLO_APNOTE_ICON_CLASS}`), null, 'Must never inject or retain explorer icons');

            assert.strictEqual(regularFolderRow.row.classList.contains(APOLO_BUNDLE_FOLDER_CLASS), false);
            assert.strictEqual(regularFolderRow.title.classList.contains(APOLO_APNOTE_ITEM_CLASS), false);

            assert.strictEqual(bundledFolderRow.row.classList.contains(APOLO_BUNDLE_FOLDER_CLASS), true);
            assert.strictEqual(bundledFolderRow.title.classList.contains(APOLO_APNOTE_ITEM_CLASS), true);
            assert.strictEqual(bundledFolderRow.title.classList.contains('is-active'), true, 'Must highlight bundle folder when bundled note is active');
            assert.strictEqual(bundledFolderRow.title.querySelector(`.${APOLO_APNOTE_ICON_CLASS}`), null);

            assert.strictEqual(bundledApnoteRow.row.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), true);
            assert.strictEqual(bundledMdRow.row.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), true);
            assert.strictEqual(bundledSvgRow.row.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), true);

            assert.strictEqual(mdRow.row.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), true);
            assert.strictEqual(globalRow.row.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), true);
            assert.strictEqual(svgRow.row.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), true);
            assert.strictEqual(plainMdRow.row.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), false, 'Standalone note without .apnote sibling must stay visible');

            removeFileExplorerCloaking(container as any);
            assert.strictEqual(mdRow.row.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), false);
            assert.strictEqual(globalRow.row.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), false);
            assert.strictEqual(svgRow.row.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), false);
            assert.strictEqual(bundledFolderRow.row.classList.contains(APOLO_BUNDLE_FOLDER_CLASS), false);
            assert.strictEqual(bundledFolderRow.title.classList.contains(APOLO_APNOTE_ITEM_CLASS), false);
            assert.strictEqual(bundledApnoteRow.row.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), false);
            assert.strictEqual(bundledMdRow.row.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), false);
            assert.strictEqual(bundledSvgRow.row.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), false);
            assert.strictEqual(apnoteRow.title.classList.contains(APOLO_APNOTE_ITEM_CLASS), false);
            assert.strictEqual(apnoteRow.title.querySelector(`.${APOLO_APNOTE_ICON_CLASS}`), null);
        } finally {
            globalThis.document = prevDoc;
            clearKnownApnotes();
        }
    });

    test('ensureNoteInBundleFolder and PersistenceQueue autoBundleNoteFolder pack a note into its own folder', async () => {
        clearKnownApnotes();
        assert.strictEqual(isInsideNoteBundleFolder('Notes/Physics.md'), false);
        assert.strictEqual(isInsideNoteBundleFolder('Notes/Physics/Physics.md'), true);
        assert.strictEqual(getNoteBundleFolderPath('Notes/Physics.md'), 'Notes/Physics');
        assert.strictEqual(getNoteBundleFolderPath('RootNote.md'), 'RootNote');
        assert.strictEqual(getBundledMdPath('Notes/Physics.md'), 'Notes/Physics/Physics.md');

        const initialMd = [
            '# Physics',
            '<div class="apolo-space" data-apolo-space="box-1" data-h="200" style="height:200px;"></div>',
        ].join('\n');
        const { vault, files } = createMockVault({ 'Notes/Physics.md': initialMd });
        const queue = new PersistenceQueue({ vault } as any);
        queue.setAutoBundleNoteFolder(true);

        const doc: PageDocument = {
            schemaVersion: 1,
            version: 1,
            id: 'Notes/Physics.md',
            notePath: 'Notes/Physics.md',
            elements: [
                {
                    id: 's-1',
                    type: 'stroke',
                    blockId: 'space:box-1',
                    points: [0.1, 0.1, 0.5, 10, 0.3, 0.2, 0.5, 20],
                    style: { color: '#1F4FD8', width: 2, opacity: 1, blendMode: 'source-over' },
                    bounds: { minX: 0.1, minY: 0.1, maxX: 0.3, maxY: 0.2 },
                    timestamp: 100,
                },
            ],
            boxes: { 'box-1': { height: 200 } },
            createdAt: 100,
            updatedAt: 100,
        };

        const fileHandle = { path: 'Notes/Physics.md' } as any;
        queue.enqueue(doc, fileHandle, 'Notes/Physics.md');
        await queue.flushSave();

        assert.strictEqual(files.has('Notes/Physics.md'), false, 'Loose .md must move into its bundle folder');
        assert.strictEqual(files.has('Notes/Physics/Physics.md'), true);
        assert.strictEqual(files.has('Notes/Physics/Physics.apnote'), true);
        assert.strictEqual(files.has('Notes/Physics/.Physics.global.json'), true);
        assert.strictEqual(files.has('Notes/Physics/Physics.box-1.svg'), true);
        assert.strictEqual(files.get('Notes/Physics/.nomedia'), '');
        assert.strictEqual(fileHandle.path, 'Notes/Physics/Physics.md');

        const resolved = resolveBundleFolderPaths('Notes/Physics', vault);
        assert.deepStrictEqual(resolved, {
            folderPath: 'Notes/Physics',
            baseName: 'Physics',
            mdPath: 'Notes/Physics/Physics.md',
            apnotePath: 'Notes/Physics/Physics.apnote',
        });

        const looseMdPath = 'Inbox/Standalone.md';
        files.set(looseMdPath, '# Loose');
        const bundledPath = await ensureNoteInBundleFolder(vault, looseMdPath);
        assert.strictEqual(bundledPath, 'Inbox/Standalone/Standalone.md');
        assert.strictEqual(files.has(looseMdPath), false);
        assert.strictEqual(files.has('Inbox/Standalone/Standalone.md'), true);
        assert.strictEqual(files.get('Inbox/Standalone/.nomedia'), '');
        clearKnownApnotes();
    });

    test('applyFileExplorerCloaking handles Make.md .mk-path-tree virtual nodes and hides bundle satellites', () => {
        clearKnownApnotes();
        const mkTree = new MockExplorerNode('div');
        mkTree.classList.add('mk-path-tree');

        const createMkRow = (path: string, isFolder: boolean) => {
            const node = new MockExplorerNode('div');
            node.classList.add('mk-tree-node');
            const wrapper = new MockExplorerNode('div');
            wrapper.classList.add('mk-tree-wrapper');
            const row = new MockExplorerNode('div');
            row.classList.add(isFolder ? 'nav-folder' : 'nav-file');
            const title = new MockExplorerNode('div');
            title.classList.add('mk-tree-item');
            title.classList.add('tree-item-self');
            title.classList.add(isFolder ? 'nav-folder-title' : 'nav-file-title');
            title.setAttribute('data-path', path);
            row.appendChild(title);
            wrapper.appendChild(row);
            node.appendChild(wrapper);
            mkTree.appendChild(node);
            return { node, wrapper, row, title };
        };

        const { vault } = createMockVault({
            'Test/Test.md': '# Test',
            'Test/Test.apnote': serializeApnoteManifest(createApnoteManifest('Test/Test.md', ['c1'])),
            'Test/Test.c1.svg': '<svg/>',
            'RegularFolder/Note.md': '# Regular',
        });

        const bundleRow = createMkRow('Test', true);
        const regularFolderRow = createMkRow('RegularFolder', true);
        const apnoteChildRow = createMkRow('Test/Test.apnote', false);
        const mdChildRow = createMkRow('Test/Test.md', false);
        const svgChildRow = createMkRow('Test/Test.c1.svg', false);
        const regularNoteRow = createMkRow('RegularFolder/Note.md', false);

        try {
            applyFileExplorerCloaking(mkTree as any, vault, 'Test/Test.md');

            assert.strictEqual(bundleRow.node.classList.contains(APOLO_BUNDLE_FOLDER_CLASS), true);
            assert.strictEqual(bundleRow.wrapper.classList.contains(APOLO_BUNDLE_FOLDER_CLASS), true);
            assert.strictEqual(bundleRow.row.classList.contains(APOLO_BUNDLE_FOLDER_CLASS), true);
            assert.strictEqual(bundleRow.title.classList.contains(APOLO_BUNDLE_FOLDER_CLASS), true);
            assert.strictEqual(bundleRow.title.classList.contains(APOLO_APNOTE_ITEM_CLASS), true);
            assert.strictEqual(bundleRow.title.classList.contains('is-active'), true);
            assert.strictEqual(bundleRow.wrapper.classList.contains('is-active'), true);

            assert.strictEqual(regularFolderRow.node.classList.contains(APOLO_BUNDLE_FOLDER_CLASS), false);
            assert.strictEqual(regularFolderRow.title.classList.contains(APOLO_APNOTE_ITEM_CLASS), false);

            assert.strictEqual(apnoteChildRow.node.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), true);
            assert.strictEqual(mdChildRow.node.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), true);
            assert.strictEqual(svgChildRow.node.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), true);
            assert.strictEqual(regularNoteRow.node.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), false);

            removeFileExplorerCloaking(mkTree as any);
            assert.strictEqual(bundleRow.node.classList.contains(APOLO_BUNDLE_FOLDER_CLASS), false);
            assert.strictEqual(bundleRow.wrapper.classList.contains(APOLO_BUNDLE_FOLDER_CLASS), false);
            assert.strictEqual(bundleRow.title.classList.contains(APOLO_APNOTE_ITEM_CLASS), false);
            assert.strictEqual(apnoteChildRow.node.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), false);
            assert.strictEqual(mdChildRow.node.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), false);
            assert.strictEqual(svgChildRow.node.classList.contains(APOLO_SATELLITE_HIDDEN_CLASS), false);
        } finally {
            clearKnownApnotes();
        }
    });

    test('syncMakeMdBundleState and attachMakeMdBridge convert bundle folders to file nodes and redirect openPath', () => {
        clearKnownApnotes();
        const { vault } = createMockVault({
            'Test/Test.md': '# Test',
            'Test/Test.apnote': serializeApnoteManifest(createApnoteManifest('Test/Test.md', ['c1'])),
            'Test/Test.c1.svg': '<svg/>',
            'Test/.Test.global.json': '{}',
            'Test/.nomedia': '',
            'RegularFolder/Other.md': '# Other',
        });

        const pathsIndex = new Map<string, any>([
            [
                'Test',
                {
                    path: 'Test',
                    name: 'Test',
                    type: 'space',
                    subtype: 'folder',
                    file: { isFolder: true },
                    metadata: { isFolder: true },
                    label: { name: 'Test', sticker: 'ui//mk-ui-folder', thumbnail: 'folder.png' },
                },
            ],
            ['Test/Test.apnote', { path: 'Test/Test.apnote', type: 'file', hidden: false }],
            ['Test/Test.md', { path: 'Test/Test.md', type: 'file', subtype: 'md', hidden: false }],
            ['Test/Test.c1.svg', { path: 'Test/Test.c1.svg', type: 'file', hidden: false }],
            [
                'RegularFolder',
                {
                    path: 'RegularFolder',
                    name: 'RegularFolder',
                    type: 'space',
                    subtype: 'folder',
                    file: { isFolder: true },
                    metadata: { isFolder: true },
                    label: { name: 'RegularFolder', sticker: 'ui//mk-ui-folder' },
                },
            ],
        ]);

        const spacesIndex = new Map<string, any>([
            ['Test', { name: 'Test' }],
            ['RegularFolder', { name: 'RegularFolder' }],
        ]);
        const expandedSpaces = ['//Test', 'Test', 'RegularFolder'];

        const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
        const dispatchedEvents: string[] = [];
        const pluginOpenCalls: Array<{ leaf: unknown; path: string; flow: unknown }> = [];
        const uiOpenCalls: Array<{ path: string; flow: unknown }> = [];

        const origOpenPath = async (leaf: unknown, path: string, flow?: unknown) => {
            pluginOpenCalls.push({ leaf, path, flow });
        };
        const origUiOpenPath = async (path: string, flow?: unknown) => {
            uiOpenCalls.push({ path, flow });
        };

        const eventsDispatcher = {
            addListener(ev: string, fn: (...args: unknown[]) => void) {
                let set = listeners.get(ev);
                if (!set) {
                    set = new Set();
                    listeners.set(ev, set);
                }
                set.add(fn);
            },
            removeListener(ev: string, fn: (...args: unknown[]) => void) {
                listeners.get(ev)?.delete(fn);
            },
        };

        const superstate = {
            pathsIndex,
            spacesIndex,
            settings: { expandedSpaces },
            eventsDispatcher,
            dispatchEvent(ev: string, payload?: unknown) {
                dispatchedEvents.push(ev);
                for (const fn of listeners.get(ev) ?? []) {
                    fn(payload);
                }
            },
            ui: {
                openPath: origUiOpenPath,
            },
        };

        const makeMd = {
            superstate,
            openPath: origOpenPath,
        };

        const mockApp = {
            plugins: {
                plugins: {
                    'make-md': makeMd,
                },
            },
        };

        const detach = attachMakeMdBridge(mockApp, vault);
        try {
            const testEntry = pathsIndex.get('Test');
            assert.strictEqual(testEntry.type, 'file');
            assert.strictEqual(testEntry.subtype, 'md');
            assert.strictEqual(testEntry.file.isFolder, false);
            assert.strictEqual(testEntry.metadata.isFolder, false);
            assert.strictEqual(testEntry.label.sticker, '');
            assert.strictEqual(testEntry.label.thumbnail, '');

            const regularEntry = pathsIndex.get('RegularFolder');
            assert.strictEqual(regularEntry.type, 'space');
            assert.strictEqual(regularEntry.metadata.isFolder, true);
            assert.strictEqual(regularEntry.label.sticker, 'ui//mk-ui-folder');

            assert.strictEqual(spacesIndex.has('Test'), false);
            assert.strictEqual(spacesIndex.has('RegularFolder'), true);
            assert.deepStrictEqual(expandedSpaces, ['RegularFolder']);

            assert.strictEqual(pathsIndex.get('Test/Test.apnote').hidden, true);
            assert.strictEqual(pathsIndex.get('Test/Test.md').hidden, true);
            assert.strictEqual(pathsIndex.get('Test/Test.c1.svg').hidden, true);
            assert.ok(dispatchedEvents.includes('superstateUpdated'));

            // Second sync without changes is idempotent and returns false
            assert.strictEqual(syncMakeMdBundleState(mockApp, vault), false);

            // openPath redirection on both makeMd and superstate.ui
            const mockLeaf = { id: 'leaf-1' };
            void makeMd.openPath(mockLeaf, 'Test', false);
            void superstate.ui.openPath('Test', true);
            void makeMd.openPath(mockLeaf, 'RegularFolder', false);
            assert.deepStrictEqual(pluginOpenCalls, [
                { leaf: mockLeaf, path: 'Test/Test.md', flow: false },
                { leaf: mockLeaf, path: 'RegularFolder', flow: false },
            ]);
            assert.deepStrictEqual(uiOpenCalls, [
                { path: 'Test/Test.md', flow: true },
            ]);

            // Simulate Make.md reloading cache back into folder state and firing pathStateUpdated
            testEntry.type = 'space';
            testEntry.metadata.isFolder = true;
            spacesIndex.set('Test', { name: 'Test' });
            for (const fn of listeners.get('pathStateUpdated') ?? []) {
                fn({ path: 'Test' });
            }
            assert.strictEqual(testEntry.type, 'file');
            assert.strictEqual(testEntry.metadata.isFolder, false);
            assert.strictEqual(spacesIndex.has('Test'), false);
        } finally {
            detach();
            clearKnownApnotes();
        }

        assert.strictEqual(makeMd.openPath, origOpenPath);
        assert.strictEqual(superstate.ui.openPath, origUiOpenPath);
        void makeMd.openPath({ id: 'leaf-2' }, 'Test', false);
        assert.strictEqual(pluginOpenCalls[pluginOpenCalls.length - 1].path, 'Test');
    });
});
