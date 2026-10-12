import test from 'node:test';
import assert from 'node:assert/strict';
import { findCanvasInsertionLine, formatCanvasDivTag, insertCanvasIntoMarkdown } from '../src/editor/CanvasInsertion.ts';

test('CanvasInsertion (Step c1) - Block Boundaries Detection', async (t) => {
    await t.test('Inserts at the end of the note when no cursor is provided', () => {
        const doc = 'Línea 1\nLínea 2\nLínea 3';
        const targetLine = findCanvasInsertionLine(doc, undefined);
        assert.equal(targetLine, 2, 'Must target the last line of the document');

        const { updatedContent } = insertCanvasIntoMarkdown(doc, 'c_test1', 280, undefined);
        assert.ok(updatedContent.includes('\n\n<div data-apolo-space="c_test1" data-h="280"></div>'));
    });

    await t.test('Inserts after Frontmatter when cursor is inside frontmatter', () => {
        const doc = [
            '---',
            'title: Mi Nota',
            'tags: [canvas, fisica]',
            '---',
            '# Primer Encabezado',
            'Texto de introducción',
        ].join('\n');

        // Cursor on line 1 ("title: Mi Nota")
        const targetLine = findCanvasInsertionLine(doc, 1);
        assert.equal(targetLine, 3, 'Must target line 3 (the closing ---)');

        const { updatedContent } = insertCanvasIntoMarkdown(doc, 'c_fm', 280, 1);
        const expected = [
            '---',
            'title: Mi Nota',
            'tags: [canvas, fisica]',
            '---',
            '',
            '<div data-apolo-space="c_fm" data-h="280"></div>',
            '',
            '# Primer Encabezado',
            'Texto de introducción',
        ].join('\n');
        assert.equal(updatedContent, expected);
    });

    await t.test('Inserts after Code Block when cursor is inside code block', () => {
        const doc = [
            'Texto antes',
            '```typescript',
            'const a = 1;',
            'console.log(a);',
            '```',
            'Texto después',
        ].join('\n');

        // Cursor on line 2 ("const a = 1;")
        const targetLine = findCanvasInsertionLine(doc, 2);
        assert.equal(targetLine, 4, 'Must target line 4 (closing ```)');

        const { updatedContent } = insertCanvasIntoMarkdown(doc, 'c_code', 280, 2);
        assert.ok(updatedContent.includes('```\n\n<div data-apolo-space="c_code" data-h="280"></div>\n\nTexto después'));
    });

    await t.test('Inserts after Callout / Blockquote when cursor is inside it', () => {
        const doc = [
            'Párrafo inicial',
            '> [!NOTE] Título del callout',
            '> Primera línea de contenido',
            '> Segunda línea de contenido',
            'Párrafo siguiente fuera del callout',
        ].join('\n');

        // Cursor on line 1 ("> [!NOTE]...")
        const targetLine = findCanvasInsertionLine(doc, 1);
        assert.equal(targetLine, 3, 'Must target line 3 (last line of callout)');

        const { updatedContent } = insertCanvasIntoMarkdown(doc, 'c_callout', 280, 1);
        assert.ok(updatedContent.includes('> Segunda línea de contenido\n\n<div data-apolo-space="c_callout" data-h="280"></div>\n\nPárrafo siguiente'));
    });

    await t.test('Inserts after Table when cursor is inside any table row', () => {
        const doc = [
            'Texto previo',
            '| Columna A | Columna B |',
            '| --- | --- |',
            '| Dato 1 | Dato 2 |',
            '| Dato 3 | Dato 4 |',
            'Texto posterior',
        ].join('\n');

        // Cursor on line 2 ("| --- | --- |")
        const targetLine = findCanvasInsertionLine(doc, 2);
        assert.equal(targetLine, 4, 'Must target line 4 (last row of table)');

        const { updatedContent } = insertCanvasIntoMarkdown(doc, 'c_table', 280, 2);
        assert.ok(updatedContent.includes('| Dato 3 | Dato 4 |\n\n<div data-apolo-space="c_table" data-h="280"></div>\n\nTexto posterior'));
    });

    await t.test('Inserts after List when cursor is inside a list item or child item', () => {
        const doc = [
            'Introducción',
            '- Item 1',
            '- Item 2',
            '  - Sub-item 2.1',
            '- Item 3',
            'Párrafo fuera de la lista',
        ].join('\n');

        // Cursor on line 2 ("- Item 2")
        const targetLine = findCanvasInsertionLine(doc, 2);
        assert.equal(targetLine, 4, 'Must target line 4 (last item of list)');

        const { updatedContent } = insertCanvasIntoMarkdown(doc, 'c_list', 280, 2);
        assert.ok(updatedContent.includes('- Item 3\n\n<div data-apolo-space="c_list" data-h="280"></div>\n\nPárrafo fuera de la lista'));
    });

    await t.test('Inserts after regular paragraph when cursor is inside a paragraph', () => {
        const doc = [
            'Primer párrafo línea 1',
            'Primer párrafo línea 2',
            '',
            'Segundo párrafo',
        ].join('\n');

        // Cursor on line 0
        const targetLine = findCanvasInsertionLine(doc, 0);
        assert.equal(targetLine, 1, 'Must target end of first paragraph (line 1)');

        const { updatedContent } = insertCanvasIntoMarkdown(doc, 'c_p', 280, 0);
        assert.ok(updatedContent.includes('Primer párrafo línea 2\n\n<div data-apolo-space="c_p" data-h="280"></div>\n\nSegundo párrafo'));
    });

    await t.test('Inserts at blank line directly when cursor is already on a blank line', () => {
        const doc = [
            'Párrafo 1',
            '',
            'Párrafo 2',
        ].join('\n');

        // Cursor on line 1 (the blank line)
        const targetLine = findCanvasInsertionLine(doc, 1);
        assert.equal(targetLine, 1);

        const { updatedContent } = insertCanvasIntoMarkdown(doc, 'c_blank', 280, 1);
        assert.ok(updatedContent.includes('Párrafo 1\n\n<div data-apolo-space="c_blank" data-h="280"></div>\n\nPárrafo 2'));
    });
});
