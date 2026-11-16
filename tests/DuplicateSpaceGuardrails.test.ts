import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';

import {
    apoloSpaceField,
    applySpaceMutationToMarkdown,
    ApoloSpaceWidget,
    createApoloSpaceExtension,
    findApoloSpaceBlockLineInMarkdown,
    isDuplicatePreviewSpaceElement,
} from '../src/editor/ApoloSpaceExtension.ts';
import { insertCanvasIntoMarkdown } from '../src/editor/CanvasInsertion.ts';
import { syncMarkdownFallbackEmbeds } from '../src/io/PersistenceQueue.ts';

describe('Duplicate apolo-space div guardrails', () => {
    it('findApoloSpaceBlockLineInMarkdown locates existing HTML divs and codeblocks while ignoring unrelated fenced blocks', () => {
        const md = [
            '# Nota',
            '```markdown',
            '<div data-apolo-space="c_fake" data-h="120"></div>',
            '```',
            '<div data-apolo-space="c_real1" data-h="240"></div>',
            '',
            '```apolo-space',
            'height: 200',
            'id: c_real2',
            '```',
        ].join('\n');

        assert.strictEqual(findApoloSpaceBlockLineInMarkdown(md, 'c_fake'), -1);
        assert.strictEqual(findApoloSpaceBlockLineInMarkdown(md, 'c_real1'), 4);
        assert.strictEqual(findApoloSpaceBlockLineInMarkdown(md, 'c_real2'), 6);
    });

    it('insertCanvasIntoMarkdown refuses to insert a duplicate div for an existing boxId', () => {
        const md = [
            'Texto previo',
            '',
            '<div data-apolo-space="c_abc123" data-h="240"></div>',
            '',
            'Texto posterior',
        ].join('\n');

        const res = insertCanvasIntoMarkdown(md, 'c_abc123', 240, 4);
        assert.strictEqual(res.updatedContent, md);
        assert.strictEqual(res.insertedLine, 2);
    });

    it('applySpaceMutationToMarkdown refuses to insert a duplicate div when isNew/insert targets an existing boxId', () => {
        const md = [
            '# Título',
            '<div class="apolo-space" data-apolo-space="c_dup1" style="height:200px;"></div>',
        ].join('\n');

        const updated = applySpaceMutationToMarkdown(md, {
            id: 'c_dup1',
            height: 200,
            isNew: true,
            type: 'insert',
            targetLine: 1,
        });
        assert.strictEqual(updated, md);
    });

    it('syncMarkdownFallbackEmbeds deduplicates duplicate divs and codeblocks with the same boxId', () => {
        const md = [
            'Ecuacion Diferencial Parcial',
            '',
            '<div data-apolo-space="c_edp1" data-h="280"></div>',
            '',
            '![[Nota.c_edp1.svg]]',
            '',
            '<div data-apolo-space="c_edp1" data-h="280"></div>',
            '',
            '![[Nota.c_edp1.svg]]',
            '',
            '<div data-apolo-space="c_other" data-h="160"></div>',
            '',
            '```markdown',
            '<div data-apolo-space="c_edp1" data-h="280"></div>',
            '```',
        ].join('\n');

        const cleaned = syncMarkdownFallbackEmbeds(md, 'Nota', new Set(['c_edp1', 'c_other']));
        const divMatches = cleaned.match(/data-apolo-space="c_edp1"/g) ?? [];
        // One canonical div in the note + one literal example inside ```markdown fenced block
        assert.strictEqual(divMatches.length, 2);
        const embedMatches = cleaned.match(/!\[\[Nota\.c_edp1\.svg\]\]/g) ?? [];
        assert.strictEqual(embedMatches.length, 1);
        assert.ok(cleaned.includes('data-apolo-space="c_other"'));
        assert.ok(cleaned.includes('![[Nota.c_other.svg]]'));
    });

    it('Live Preview apoloSpaceField renders only one widget for duplicate divs', () => {
        const md = [
            '<div data-apolo-space="c_lp1" data-h="240"></div>',
            '',
            '<div data-apolo-space="c_lp1" data-h="240"></div>',
        ].join('\n');

        const state = EditorState.create({
            doc: md,
            extensions: [createApoloSpaceExtension(null)],
        });
        const decos = state.field(apoloSpaceField);
        const iter = decos.iter();
        const found: Array<{ from: number; to: number; hasWidget: boolean }> = [];
        while (iter.value) {
            found.push({
                from: iter.from,
                to: iter.to,
                hasWidget: iter.value.spec.widget instanceof ApoloSpaceWidget,
            });
            iter.next();
        }
        assert.strictEqual(found.length, 1);
        assert.strictEqual(found[0].hasWidget, true);
    });

    it('isDuplicatePreviewSpaceElement detects duplicate boxes in Reading Mode DOM order', () => {
        const makeNode = (id: string, hidden = false) => {
            const classes = new Set<string>(['apolo-space-block']);
            if (hidden) classes.add('apolo-duplicate-space-hidden');
            return {
                dataset: { apoloSpace: id, apoloSpaceId: id },
                classList: {
                    contains: (c: string) => classes.has(c),
                },
                getAttribute: (attr: string) => (attr.includes('apolo-space') ? id : null),
                closest: () => previewRoot,
            } as unknown as HTMLElement;
        };

        const nodes: HTMLElement[] = [];
        const previewRoot = {
            querySelectorAll: () => nodes,
        };

        const first = makeNode('c_read1');
        const secondSame = makeNode('c_read1');
        const distinct = makeNode('c_read2');
        nodes.push(first, secondSame, distinct);

        assert.strictEqual(isDuplicatePreviewSpaceElement(first, 'c_read1'), false);
        assert.strictEqual(isDuplicatePreviewSpaceElement(secondSame, 'c_read1'), true);
        assert.strictEqual(isDuplicatePreviewSpaceElement(distinct, 'c_read2'), false);
    });
});
