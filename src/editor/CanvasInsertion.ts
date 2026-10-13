/**
 * Logic for locating block boundaries (frontmatter, codeblocks, tables, blockquotes/callouts, lists)
 * and safely inserting drawing canvas boxes (<div data-apolo-space="id" data-h="N"></div>).
 */

import { htmlEscapeAttribute, normalizeBoxId } from './ApoloSpaceExtension.ts';

export function formatCanvasDivTag(boxId: string, height: number): string {
    const cleanId = htmlEscapeAttribute(normalizeBoxId(boxId));
    return `<div data-apolo-space="${cleanId}" data-h="${height}"></div>`;
}

/**
 * Finds the line index (0-indexed) after which the canvas div should be inserted.
 * If cursorLine is inside a complex block (frontmatter, codeblock, table, callout, list),
 * finds the end of that complete block.
 */
export function findCanvasInsertionLine(content: string, cursorLine?: number): number {
    const lines = content.split('\n');
    if (lines.length === 0) return 0;
    if (cursorLine === undefined || cursorLine === null || cursorLine < 0 || cursorLine >= lines.length) {
        return lines.length - 1;
    }

    // 1. Check Frontmatter: lines[0] === '---'
    if (lines[0].trim() === '---') {
        let closingFmLine = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                closingFmLine = i;
                break;
            }
        }
        if (closingFmLine !== -1 && cursorLine <= closingFmLine) {
            return closingFmLine;
        }
    }

    // 2. Check Code Blocks (``` or ~~~)
    let inCodeBlock = false;
    let codeFence = '';
    let codeBlockStart = -1;
    let codeBlockEnd = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fenceMatch = line.match(/^\s*(```|~~~)/);
        if (fenceMatch) {
            const fence = fenceMatch[1];
            if (!inCodeBlock) {
                inCodeBlock = true;
                codeFence = fence;
                codeBlockStart = i;
            } else if (fence === codeFence) {
                inCodeBlock = false;
                codeBlockEnd = i;
                if (cursorLine >= codeBlockStart && cursorLine <= codeBlockEnd) {
                    return codeBlockEnd;
                }
            }
        }
    }
    // If still in unclosed codeblock at cursor:
    if (inCodeBlock && cursorLine >= codeBlockStart) {
        return lines.length - 1;
    }

    const currentLine = lines[cursorLine];

    // If cursor is on a blank line, insert right there
    if (currentLine.trim() === '') {
        return cursorLine;
    }

    // 3. Check Blockquote / Callout (> or > [!...)
    if (/^\s*>/.test(currentLine)) {
        let lastQuoteLine = cursorLine;
        for (let i = cursorLine + 1; i < lines.length; i++) {
            const line = lines[i];
            if (/^\s*>/.test(line)) {
                lastQuoteLine = i;
            } else {
                break;
            }
        }
        return lastQuoteLine;
    }

    // 4. Check Markdown Table (| ... |)
    if (/^\s*\|.*\|\s*$/.test(currentLine) || (currentLine.includes('|') && currentLine.trim().startsWith('|'))) {
        let lastTableLine = cursorLine;
        for (let i = cursorLine + 1; i < lines.length; i++) {
            const line = lines[i];
            if (/^\s*\|.*\|\s*$/.test(line) || (line.includes('|') && line.trim().startsWith('|'))) {
                lastTableLine = i;
            } else {
                break;
            }
        }
        return lastTableLine;
    }

    // 5. Check List item (bullet or numbered)
    const isListLine = (line: string) => /^\s*([-*+]|\d+\.)\s+/.test(line);
    const isIndented = (line: string) => /^\s{2,}\S/.test(line);

    if (isListLine(currentLine) || isIndented(currentLine)) {
        let lastListLine = cursorLine;
        for (let i = cursorLine + 1; i < lines.length; i++) {
            const line = lines[i];
            if (isListLine(line) || isIndented(line)) {
                lastListLine = i;
            } else if (line.trim() === '') {
                // Peek ahead: blank line might be loose list item separation
                if (i + 1 < lines.length && (isListLine(lines[i + 1]) || isIndented(lines[i + 1]))) {
                    continue;
                }
                break;
            } else {
                break;
            }
        }
        return lastListLine;
    }

    // 6. Check Heading (# ... ######)
    if (/^\s*#{1,6}\s+/.test(currentLine)) {
        return cursorLine;
    }

    // 7. Regular paragraph: scan downwards until blank line or next block
    let lastParaLine = cursorLine;
    for (let i = cursorLine + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') break;
        if (/^\s*(#{1,6}\s+|```|~~~|>|[-*+]|\d+\.|\|)/.test(line)) break;
        lastParaLine = i;
    }
    return lastParaLine;
}

/**
 * Inserts a canvas div with blank lines before and after.
 */
export function insertCanvasIntoMarkdown(
    content: string,
    boxId: string,
    height = 280,
    cursorLine?: number,
): { updatedContent: string; insertedLine: number } {
    const lines = content.split('\n');
    const targetLine = findCanvasInsertionLine(content, cursorLine);
    const divTag = formatCanvasDivTag(boxId, height);

    if (lines.length === 0 || (lines.length === 1 && lines[0].trim() === '')) {
        return { updatedContent: `${divTag}\n`, insertedLine: 0 };
    }

    // If target line is an empty line, replace or format around it
    if (lines[targetLine]?.trim() === '') {
        const before = lines.slice(0, targetLine);
        const after = lines.slice(targetLine + 1);

        const newLines = [...before];
        if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== '') {
            newLines.push('');
        }
        const divIndex = newLines.length;
        newLines.push(divTag);
        if (after.length > 0 && after[0].trim() !== '') {
            newLines.push('');
        }
        newLines.push(...after);
        return { updatedContent: newLines.join('\n'), insertedLine: divIndex };
    }

    // Insert after targetLine
    const before = lines.slice(0, targetLine + 1);
    const after = lines.slice(targetLine + 1);

    const newLines = [...before];
    if (newLines[newLines.length - 1].trim() !== '') {
        newLines.push('');
    }
    const divIndex = newLines.length;
    newLines.push(divTag);
    if (after.length > 0 && after[0].trim() !== '') {
        newLines.push('');
    }
    newLines.push(...after);

    return { updatedContent: newLines.join('\n'), insertedLine: divIndex };
}
