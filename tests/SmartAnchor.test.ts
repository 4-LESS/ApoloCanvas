import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    cleanAnchorText,
    textSimilarity,
    findBestMatchingLine,
    findBestMatchingPreviewBlock,
} from '../src/engine/anchoring/SmartAnchor.ts';
import type { PreviewBlockInfo } from '../src/engine/anchoring/SmartAnchor.ts';

describe('SmartAnchor - cleanAnchorText', () => {
    test('strips heading markdown prefixes', () => {
        assert.strictEqual(cleanAnchorText('# Título principal'), 'Título principal');
        assert.strictEqual(cleanAnchorText('### Subtítulo H3'), 'Subtítulo H3');
        assert.strictEqual(cleanAnchorText('###### H6 profundo'), 'H6 profundo');
    });

    test('strips list markers and task checkboxes', () => {
        assert.strictEqual(cleanAnchorText('- Elemento de lista'), 'Elemento de lista');
        assert.strictEqual(cleanAnchorText('* Elemento con asterisco'), 'Elemento con asterisco');
        assert.strictEqual(cleanAnchorText('1. Primer paso'), 'Primer paso');
        assert.strictEqual(cleanAnchorText('12. Paso doce'), 'Paso doce');
        assert.strictEqual(cleanAnchorText('- [ ] Tarea pendiente'), 'Tarea pendiente');
        assert.strictEqual(cleanAnchorText('- [x] Tarea completada'), 'Tarea completada');
    });

    test('strips blockquotes and inline styles', () => {
        assert.strictEqual(cleanAnchorText('> Una cita célebre'), 'Una cita célebre');
        assert.strictEqual(cleanAnchorText('**Texto en negrita**'), 'Texto en negrita');
        assert.strictEqual(cleanAnchorText('*Texto en cursiva*'), 'Texto en cursiva');
        assert.strictEqual(cleanAnchorText('`código inline`'), 'código inline');
        assert.strictEqual(cleanAnchorText('==destacado=='), 'destacado');
    });

    test('strips wikilinks and markdown links', () => {
        assert.strictEqual(cleanAnchorText('[[MiNota|Enlace bonito]]'), 'Enlace bonito');
        assert.strictEqual(cleanAnchorText('[[MiNota]]'), 'MiNota');
        assert.strictEqual(cleanAnchorText('[Obsidian](https://obsidian.md)'), 'Obsidian');
    });
});

describe('SmartAnchor - textSimilarity', () => {
    test('returns 1.0 for exact matches', () => {
        assert.strictEqual(textSimilarity('Hola mundo', 'Hola mundo'), 1.0);
    });

    test('returns 1.0 when comparing markdown raw vs clean text', () => {
        assert.strictEqual(textSimilarity('### Mi Título', 'Mi Título'), 1.0);
        assert.strictEqual(textSimilarity('- [ ] Comprar leche', 'Comprar leche'), 1.0);
    });

    test('returns high similarity for minor edits or additions', () => {
        const sim = textSimilarity('Proyecto', 'Proyecto Alfa');
        assert.ok(sim >= 0.6, `Expected >= 0.6, got ${sim}`);
    });

    test('returns low similarity for unrelated text', () => {
        const sim = textSimilarity('Introducción', 'Conclusiones finales');
        assert.ok(sim < 0.4, `Expected < 0.4, got ${sim}`);
    });
});

describe('SmartAnchor - findBestMatchingLine', () => {
    test('picks the NEAREST match when duplicate headings exist (prevents teleporting)', () => {
        const lines = [
            '---',
            'title: Test',
            '---',
            '# Introducción', // line 3
            '### Notas',      // line 4 (first duplicate)
            'Texto A',
            'Texto B',
            'Texto C',
            '### Notas',      // line 8 (second duplicate)
            'Texto D',
        ];

        // If stroke was drawn near line 8 (second duplicate):
        const matchNear8 = findBestMatchingLine(lines, '### Notas', 7);
        assert.ok(matchNear8 !== null);
        assert.strictEqual(matchNear8.line, 8, 'Must choose line 8 because it is closest to expectedLine 7');

        // If stroke was drawn near line 4 (first duplicate):
        const matchNear4 = findBestMatchingLine(lines, '### Notas', 3);
        assert.ok(matchNear4 !== null);
        assert.strictEqual(matchNear4.line, 4, 'Must choose line 4 because it is closest to expectedLine 3');
    });

    test('matches line even if markdown prefixes differ (e.g. editor vs reading representation)', () => {
        const lines = [
            'Inicio',
            '### Sección importante',
            'Fin',
        ];

        const match = findBestMatchingLine(lines, 'Sección importante', 1);
        assert.ok(match !== null);
        assert.strictEqual(match.line, 1);
    });

    test('recovers anchor when line was slightly edited', () => {
        const lines = [
            'Párrafo uno',
            'Párrafo dos',
            'Proyecto Orion (en desarrollo)', // edited from 'Proyecto Orion'
            'Párrafo tres',
        ];

        const match = findBestMatchingLine(lines, 'Proyecto Orion', 2);
        assert.ok(match !== null);
        assert.strictEqual(match.line, 2);
        assert.ok(match.confidence >= 0.65);
    });

    test('returns null when anchor text is completely absent', () => {
        const lines = ['Línea uno', 'Línea dos', 'Línea tres'];
        const match = findBestMatchingLine(lines, 'Texto inexistente', 1, 10);
        assert.strictEqual(match, null);
    });
});

describe('SmartAnchor - findBestMatchingPreviewBlock', () => {
    test('matches preview block with clean text when anchorText has markdown heading prefix', () => {
        const mockEl1 = { id: 'el-1' } as unknown as HTMLElement;
        const mockEl2 = { id: 'el-2' } as unknown as HTMLElement;

        const blocks: PreviewBlockInfo[] = [
            { el: mockEl1, start: 0, end: 2, text: 'Introducción al proyecto' },
            { el: mockEl2, start: 3, end: 5, text: 'Notas y acuerdos' }, // DOM has clean text
        ];

        // Anchor text was stored in edit mode with '### '
        const matched = findBestMatchingPreviewBlock(blocks, '### Notas y acuerdos', 3);
        assert.strictEqual(matched, mockEl2);
    });

    test('prevents false substring matches on short words (e.g. "Si" matching "diseño")', () => {
        const mockEl1 = { id: 'el-1' } as unknown as HTMLElement;
        const mockEl2 = { id: 'el-2' } as unknown as HTMLElement;

        const blocks: PreviewBlockInfo[] = [
            { el: mockEl1, start: 4, end: 4, text: 'El diseño arquitectónico es clave' },
            { el: mockEl2, start: 10, end: 10, text: 'Si' },
        ];

        const matched = findBestMatchingPreviewBlock(blocks, 'Si', 10);
        assert.strictEqual(matched, mockEl2, 'Must match exact "Si", not "El diseño..."');
    });
});
