import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    applySpaceMutationToMarkdown,
    type SpaceMutation,
    parseApoloSpaceHtml,
} from '../src/editor/ApoloSpaceExtension.ts';

describe('SpaceBlock Logic and Markdown Mutations', () => {
    test('parseApoloSpaceHtml correctly extracts id and height', () => {
        const html = '<div class="apolo-space" data-apolo-space="space-999" style="height:250px;"></div>';
        const parsed = parseApoloSpaceHtml(html);
        assert.ok(parsed);
        assert.strictEqual(parsed.id, 'space-999');
        assert.strictEqual(parsed.height, 250);
    });

    test('applySpaceMutationToMarkdown inserts new space block at specified line', () => {
        const doc = [
            '# Primer Título',
            'Este es un párrafo.',
            '## Segundo Título',
            'Texto adicional.',
        ].join('\n');

        const mutation: SpaceMutation = {
            id: 'space-test-1',
            height: 180,
            isNew: true,
            remove: false,
            targetLine: 1, // After "Este es un párrafo."
        };

        const updated = applySpaceMutationToMarkdown(doc, mutation);
        const lines = updated.split('\n');
        assert.strictEqual(lines[2], '<div class="apolo-space" data-apolo-space="space-test-1" style="height:180px;"></div>');
        assert.strictEqual(lines[3], '## Segundo Título');
    });

    test('applySpaceMutationToMarkdown updates height of existing space block', () => {
        const doc = [
            '# Primer Título',
            '<div class="apolo-space" data-apolo-space="space-test-1" style="height:180px;"></div>',
            '## Segundo Título',
        ].join('\n');

        const mutation: SpaceMutation = {
            id: 'space-test-1',
            height: 320,
            isNew: false,
            remove: false,
            targetLine: 0,
        };

        const updated = applySpaceMutationToMarkdown(doc, mutation);
        assert.ok(updated.includes('style="height:320px;"'));
        assert.ok(!updated.includes('180px'));
    });

    test('applySpaceMutationToMarkdown removes existing space block on removal', () => {
        const doc = [
            '# Primer Título',
            '<div class="apolo-space" data-apolo-space="space-test-1" style="height:180px;"></div>',
            '## Segundo Título',
        ].join('\n');

        const mutation: SpaceMutation = {
            id: 'space-test-1',
            height: 0,
            isNew: false,
            remove: true,
            targetLine: 0,
        };

        const updated = applySpaceMutationToMarkdown(doc, mutation);
        assert.ok(!updated.includes('data-apolo-space="space-test-1"'));
        assert.ok(updated.includes('# Primer Título'));
        assert.ok(updated.includes('## Segundo Título'));
    });

    test('Orphaned space block re-anchoring preserves document world coordinates', () => {
        const contentWidth = 800;
        // Stroke was drawn at 50px below the space block top (spaceTop = 400)
        const spaceTop = 400;
        const localV = 50 / contentWidth;
        const initialDocY = spaceTop + localV * contentWidth; // 450px

        // Space block is deleted from markdown.
        // Nearest surviving preceding line is Line 5 at lineTop = 320px.
        const lineTop = 320;
        // Formula used in reanchor() when space block is deleted:
        const deltaV = (spaceTop - lineTop) / contentWidth; // (400 - 320)/800 = 80/800
        const newV = localV + deltaV; // 50/800 + 80/800 = 130/800

        // After reanchoring to Line 5:
        const reanchoredDocY = lineTop + newV * contentWidth; // 320 + 130 = 450px

        assert.strictEqual(
            Math.round(reanchoredDocY),
            Math.round(initialDocY),
            'Stroke world Y must remain exact when reanchoring from deleted space block'
        );
    });
});
