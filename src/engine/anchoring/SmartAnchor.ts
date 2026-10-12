/**
 * Smart Anchor module for Apolo Canvas
 * Provides robust text normalization, similarity matching, and distance-aware
 * line resolution across CodeMirror 6 and Obsidian Reading Mode DOM.
 */

export interface PreviewBlockInfo {
    el: HTMLElement;
    start: number;
    end: number;
    text: string;
}

/**
 * Strips common Markdown formatting and structural prefixes from text.
 * Ensures that "### Mi Título", "- [ ] Tarea", "> Cita", and "**Texto**"
 * produce identical plain-text representations in both editor and reading mode.
 */
export function cleanAnchorText(text: string): string {
    if (!text) return '';

    let cleaned = text.trim();

    // 1. Strip Markdown header prefixes: '# ', '## ', '### ', etc.
    cleaned = cleaned.replace(/^#{1,6}\s+/, '');

    // 2. Strip blockquote prefixes: '> ', '>> ', etc.
    cleaned = cleaned.replace(/^>+\s*/, '');

    // 3. Strip unordered list markers: '- ', '* ', '+ '
    cleaned = cleaned.replace(/^[-*+]\s+/, '');

    // 4. Strip ordered list markers: '1. ', '12. ', etc.
    cleaned = cleaned.replace(/^\d+\.\s+/, '');

    // 5. Strip task list checkboxes: '[ ] ', '[x] ', '[X] '
    cleaned = cleaned.replace(/^\[[ xX]\]\s+/, '');

    // 6. Strip callout prefixes: '[!NOTE]', '[!TIP]', etc.
    cleaned = cleaned.replace(/^\[![a-zA-Z0-9_-]+\]\s*/, '');

    // 7. Strip inline Markdown formatting: bold, italic, strikethrough, highlights, code
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
    cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
    cleaned = cleaned.replace(/_([^_]+)_/g, '$1');
    cleaned = cleaned.replace(/==([^=]+)==/g, '$1');
    cleaned = cleaned.replace(/~~([^~]+)~~/g, '$1');
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

    // 8. Strip internal WikiLinks [[Note|Label]] -> Label, [[Note]] -> Note
    cleaned = cleaned.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1');

    // 9. Strip Markdown links [Label](url) -> Label
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    return cleaned.trim();
}

/**
 * Computes a normalized similarity score between 0.0 and 1.0 for two strings.
 * Handles exact matches, cleaned matches, prefixes, and character overlap.
 */
export function textSimilarity(a: string, b: string): number {
    const s1 = a.trim();
    const s2 = b.trim();

    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;

    const c1 = cleanAnchorText(s1).toLowerCase();
    const c2 = cleanAnchorText(s2).toLowerCase();

    if (c1 === c2) return 1.0;
    if (!c1 || !c2) return 0.0;

    const maxLen = Math.max(c1.length, c2.length);
    const minLen = Math.min(c1.length, c2.length);

    // One contains the other: high confidence since the entire base text is present
    if (c1.includes(c2) || c2.includes(c1)) {
        return 0.7 + 0.3 * (minLen / maxLen);
    }

    // Levenshtein distance for typo tolerance
    const dist = levenshteinDistance(c1, c2);
    const similarity = 1 - dist / maxLen;
    return Math.max(0, similarity);
}

function levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;
    if (m === 0) return n;
    if (n === 0) return m;

    let prevRow = new Array<number>(n + 1);
    let currRow = new Array<number>(n + 1);

    for (let j = 0; j <= n; j++) prevRow[j] = j;

    for (let i = 1; i <= m; i++) {
        currRow[0] = i;
        const char1 = s1.charCodeAt(i - 1);
        for (let j = 1; j <= n; j++) {
            const cost = char1 === s2.charCodeAt(j - 1) ? 0 : 1;
            currRow[j] = Math.min(
                currRow[j - 1] + 1,      // insertion
                prevRow[j] + 1,          // deletion
                prevRow[j - 1] + cost,   // substitution
            );
        }
        const temp = prevRow;
        prevRow = currRow;
        currRow = temp;
    }

    return prevRow[n];
}

/**
 * Searches outward from expectedLine to find the line that best matches anchorText.
 * By checking delta = 0, 1, 2, ..., it ALWAYS prioritizes the match closest to
 * where the user originally drew, avoiding teleportation to duplicate headings or phrases.
 */
export function findBestMatchingLine(
    lines: readonly string[],
    anchorText: string,
    expectedLine: number,
    maxRadius = 60,
): { line: number; confidence: number } | null {
    if (!anchorText || lines.length === 0) return null;

    const cleanTarget = cleanAnchorText(anchorText).toLowerCase();
    if (!cleanTarget) return null;

    const clampedExpected = Math.max(0, Math.min(lines.length - 1, expectedLine));
    const radius = Math.min(maxRadius, Math.max(clampedExpected, lines.length - 1 - clampedExpected));

    // Phase 1: Search outward for exact match or exact clean match
    for (let d = 0; d <= radius; d++) {
        // Check downwards and upwards at distance d
        const candidates = d === 0 ? [clampedExpected] : [clampedExpected - d, clampedExpected + d];
        for (const lineIdx of candidates) {
            if (lineIdx < 0 || lineIdx >= lines.length) continue;
            const lineText = lines[lineIdx].trim();
            if (!lineText) continue;

            if (lineText === anchorText) {
                return { line: lineIdx, confidence: 1.0 };
            }

            const cleanCandidate = cleanAnchorText(lineText).toLowerCase();
            if (cleanCandidate === cleanTarget) {
                return { line: lineIdx, confidence: 0.98 };
            }
        }
    }

    // Phase 2: If no exact match found, search outward for high similarity (e.g. edited text / typos)
    let bestLine: number | null = null;
    let bestSim = 0.65; // Minimum confidence threshold

    for (let d = 0; d <= radius; d++) {
        const candidates = d === 0 ? [clampedExpected] : [clampedExpected - d, clampedExpected + d];
        for (const lineIdx of candidates) {
            if (lineIdx < 0 || lineIdx >= lines.length) continue;
            const lineText = lines[lineIdx].trim();
            if (!lineText) continue;

            const sim = textSimilarity(cleanTarget, lineText);
            // Apply a slight distance decay so a very close line with 0.8 beats a far line with 0.85
            const distancePenalty = d * 0.003;
            const effectiveSim = sim - distancePenalty;

            if (effectiveSim > bestSim) {
                bestSim = effectiveSim;
                bestLine = lineIdx;
            }
        }
    }

    if (bestLine !== null) {
        return { line: bestLine, confidence: bestSim };
    }

    return null;
}

/**
 * Resolves the best rendered block element in Reading Mode for a given anchorText and line.
 */
export function findBestMatchingPreviewBlock(
    blocks: readonly PreviewBlockInfo[],
    anchorText: string,
    expectedLine: number,
): HTMLElement | null {
    if (blocks.length === 0) return null;

    // 1. If anchorText is provided, normalize and search for the closest matching block
    if (anchorText) {
        const cleanTarget = cleanAnchorText(anchorText).toLowerCase();
        if (cleanTarget) {
            let bestBlock: HTMLElement | null = null;
            let minDiff = Number.POSITIVE_INFINITY;
            let bestSim = 0.65;

            for (const b of blocks) {
                const blockClean = cleanAnchorText(b.text).toLowerCase();
                const sim = textSimilarity(cleanTarget, blockClean);
                const lineDiff = Math.abs(b.start - expectedLine);

                if (sim >= 0.9) {
                    // High confidence: choose the one closest to expectedLine
                    if (lineDiff < minDiff) {
                        minDiff = lineDiff;
                        bestBlock = b.el;
                    }
                } else if (sim > bestSim && minDiff === Number.POSITIVE_INFINITY) {
                    bestSim = sim;
                    bestBlock = b.el;
                }
            }

            if (bestBlock) return bestBlock;
        }
    }

    // 2. Direct line range match
    for (const b of blocks) {
        if (expectedLine >= b.start && expectedLine <= b.end) {
            return b.el;
        }
    }

    // 3. Nearest block by line distance
    let nearest: HTMLElement | null = null;
    let minLineDiff = Number.POSITIVE_INFINITY;
    for (const b of blocks) {
        const diff = Math.min(Math.abs(b.start - expectedLine), Math.abs(b.end - expectedLine));
        if (diff < minLineDiff) {
            minLineDiff = diff;
            nearest = b.el;
        }
    }

    return nearest;
}
