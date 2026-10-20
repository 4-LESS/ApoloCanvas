import type { PenFavorite, PenProfile, PenProfileId, ShapeType, StrokePattern } from '../core/types.ts';

/**
 * Checks whether Obsidian is currently rendering in dark theme.
 */
export function isDarkTheme(): boolean {
    return document.body.classList.contains('theme-dark');
}

/**
 * Maps ink colors in dark mode to guarantee high contrast and readability on dark canvas surfaces.
 */
export function mapInkColorForDark(color: string, isDark = isDarkTheme()): string {
    if (!isDark) return color;
    const normalized = color.toLowerCase();
    const map: Record<string, string> = {
        '#111827': '#E5E7EB',
        '#000000': '#E5E7EB',
        '#1f4fd8': '#6E94FF',
        '#2f6bff': '#6E94FF',
        '#6c3fd1': '#A98BFF',
        '#d9480f': '#FF8A55',
        '#1b7f4d': '#4CC38A',
        '#c92a2a': '#FF7A7A',
        '#6b7280': '#A7AFBD',
    };
    return map[normalized] || color;
}

/**
 * Standard 8-color engineering palette.
 */
export const PRIMARY_PALETTE: readonly string[] = [
    '#111827', // Negro grafito
    '#1F4FD8', // Azul tinta
    '#D9480F', // Naranja térmico
    '#6C3FD1', // Morado enlace
    '#1B7F4D', // Verde esquema
    '#C92A2A', // Rojo corrección
    '#6B7280', // Gris cota
    '#F5C400', // Amarillo resaltador
];

export const PRIMARY_COLOR_NAMES: Record<string, string> = {
    '#111827': 'Negro grafito',
    '#1F4FD8': 'Azul tinta',
    '#D9480F': 'Naranja térmico',
    '#6C3FD1': 'Morado enlace',
    '#1B7F4D': 'Verde esquema',
    '#C92A2A': 'Rojo corrección',
    '#6B7280': 'Gris cota',
    '#F5C400': 'Amarillo resaltador',
};

/**
 * Dedicated fluorescent highlighter palette (Yellow, Green, Cyan, Pink, Orange, Purple).
 */
export const HIGHLIGHTER_PALETTE: readonly string[] = [
    '#F5C400', // Amarillo fluorescente
    '#2ECC71', // Verde neón
    '#48D597', // Verde menta pastel
    '#54C7EC', // Celeste cielo
    '#FF70A6', // Rosa fluorescente
    '#FFA940', // Naranja suave
    '#A388EE', // Violeta pastel
];

export const HIGHLIGHTER_COLOR_NAMES: Record<string, string> = {
    '#F5C400': 'Amarillo fluorescente',
    '#2ECC71': 'Verde neón',
    '#48D597': 'Verde menta pastel',
    '#54C7EC': 'Celeste cielo',
    '#FF70A6': 'Rosa fluorescente',
    '#FFA940': 'Naranja suave',
    '#A388EE': 'Violeta pastel',
};

/**
 * Pen profiles definitions.
 */
export const PEN_PROFILES: Record<PenProfileId, PenProfile> = {
    fountain: { id: 'fountain', name: 'Pluma estilográfica', wm: 1.0, op: 1.0, cap: 'round', dash: '' },
    calli: { id: 'calli', name: 'Pincel caligráfico', wm: 2.2, op: 1.0, cap: 'butt', dash: '' },
    ball: { id: 'ball', name: 'Bolígrafo', wm: 0.85, op: 0.98, cap: 'round', dash: '' },
    pencil: { id: 'pencil', name: 'Lápiz texturado', wm: 1.2, op: 0.75, cap: 'round', dash: '' },
    hlr: { id: 'hlr', name: 'Marcador redondo', wm: 4.5, op: 0.45, cap: 'round', dash: '' },
    hlf: { id: 'hlf', name: 'Marcador plano', wm: 4.5, op: 0.45, cap: 'square', dash: '' },
};

export const DEFAULT_FAVORITES: PenFavorite[] = [
    { profile: 'fountain', color: '#1F4FD8', width: 3 },
    { profile: 'ball', color: '#D9480F', width: 2 },
    { profile: 'fountain', color: '#6C3FD1', width: 2 },
    { profile: 'pencil', color: '#111827', width: 3 },
];

export const DEFAULT_TOOL_PALETTES: Record<'pen' | 'highlighter' | 'shape', { colors: string[]; opacities: number[] }> = {
    pen: {
        colors: ['#E53935', '#1F4FD8', '#10B981', '#111827'],
        opacities: [100, 100, 100, 100],
    },
    highlighter: {
        colors: ['#1E88E5', '#FDD835', '#43A047', '#00ACC1'],
        opacities: [75, 75, 75, 75],
    },
    shape: {
        colors: ['#2F6BFF', '#111827', '#FFA726', '#10B981'],
        opacities: [100, 100, 100, 100],
    },
};

/**
 * 24x24 px linear SVG icons with stroke-width 1.8, stroke-linecap round, stroke-linejoin round.
 */
export const ICONS = {
    pen: 'M4 20l1-4L16 5l3 3L8 19z M14 7l3 3',
    ballpoint: 'M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z M15 5l4 4',
    highlighter: 'M14 4l6 6-7 7-6-6z M9 16l-4 4h5l2-2',
    eraser: 'M5 14l8-8 6 6-6 6H9z M7 20h12',
    lasso: 'M4 10a8 5 0 1016 0a8 5 0 10-16 0 M12 15c0 3-2 4-3 5',
    shapes: {
        line: 'M5 19L19 5',
        arrow: 'M5 19L19 5 M10 5h9v9',
        rect: 'M4 6h16v12H4z',
        circle: 'M21 12a9 9 0 11-18 0a9 9 0 0118 0',
        triangle: 'M12 4l9 16H3z',
    } as Record<ShapeType | 'circle', string>,
    spacer: 'M8 8l4-4 4 4 M8 16l4 4 4-4 M5 12h14',
    insertCanvas: 'M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5z M9 12h6 M12 9v6',
    undo: 'M9 14L4 9l5-5 M4 9h9a6 6 0 010 12h-3',
    redo: 'M15 14l5-5-5-5 M20 9h-9a6 6 0 000 12h3',
    grid: 'M4 4h16v16H4z M4 12h16 M12 4v16',
    snap: 'M4 4v7a8 8 0 0016 0V4 M8 4v7a4 4 0 008 0V4 M4 4h4 M16 4h4',
    more: 'M5 12h.01 M12 12h.01 M19 12h.01',
    keyboardMode: 'M9 4h6 M9 20h6 M12 4v16',
    link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
    close: 'M6 6l12 12 M18 6L6 18',
    check: 'M5 13l4 4L19 7',
    dragGrip: '<circle cx="4" cy="3" r="1.5"></circle><circle cx="10" cy="3" r="1.5"></circle><circle cx="4" cy="7" r="1.5"></circle><circle cx="10" cy="7" r="1.5"></circle><circle cx="4" cy="11" r="1.5"></circle><circle cx="10" cy="11" r="1.5"></circle>',
    feather: 'M20.24 12.24a6 6 0 00-8.49-8.49L5 10.5V19h8.5z M16 8L2 22 M17.5 15H9',
    highlighterChisel: 'M7 17l-3 4h6l-1-2 M11 4l8 8-6 6-8-8z M15 3l4 4',
    highlighterRound: 'M12 2a4 4 0 00-4 4v7l2 2v6h4v-6l2-2V6a4 4 0 00-4-4z',
    pencil: 'M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z',
    bookmark: 'M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z',
    star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    plus: 'M12 5v14 M5 12h14',
    minus: 'M5 12h14',
    clock: 'M12 6v6l4 2 M12 22a10 10 0 100-20 10 10 0 000 20z',
    plusCircle: 'M12 8v8 M8 12h8 M12 22a10 10 0 100-20 10 10 0 000 20z',
    eyedropper: 'M19 3a2.5 2.5 0 010 3.5l-2.5 2.5-3.5-3.5 2.5-2.5a2.5 2.5 0 013.5 0z M11.5 7L3 15.5V19h3.5L15 10.5',
    copy: 'M9 9h11a2 2 0 012 2v9a2 2 0 01-2 2H9a2 2 0 01-2-2v-9a2 2 0 012-2z M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v2',
    paste: 'M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2 M9 2h6a1 1 0 011 1v2a1 1 0 01-1 1H9a1 1 0 01-1-1V3a1 1 0 011-1z',
    bringToFront: 'M12 21V7m-5 5l5-5 5 5 M4 3h16',
    sendToBack: 'M12 3v14m5-5l-5 5-5-5 M4 21h16',
    sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
    trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    chevronUp: 'M6 15l6-6 6 6',
    chevronDown: 'M6 9l6 6 6-6',
    chevronLeft: 'M15 18l-6-6 6-6',
    chevronRight: 'M9 18l6-6-6-6',
};

export interface SvgOptions {
    size?: number;
    width?: number;
    height?: number;
    viewBox?: string;
    stroke?: string;
    strokeWidth?: number;
    fill?: string;
    dash?: string;
    className?: string;
}

export function createDotsIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const positions = [
        { cx: 12, cy: 12, r: 1.5 },
        { cx: 19, cy: 12, r: 1.5 },
        { cx: 5, cy: 12, r: 1.5 },
    ];
    for (const point of positions) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(point.cx));
        circle.setAttribute('cy', String(point.cy));
        circle.setAttribute('r', String(point.r));
        svg.appendChild(circle);
    }
    return svg;
}

function applySvgAttributes(node: Element, attributeString: string): void {
    const attrRegex = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(attributeString)) !== null) {
        const [, name, doubleQuoted, singleQuoted, bare] = attrMatch;
        const value = doubleQuoted ?? singleQuoted ?? bare ?? '';
        node.setAttribute(name, value);
    }
}

function appendSvgMarkup(parent: Element, markup: string): void {
    const tagRegex = /<([A-Za-z0-9:-]+)([^>]*?)\/>|<([A-Za-z0-9:-]+)([^>]*)>([\s\S]*?)<\/\3>|<([A-Za-z0-9:-]+)([^>]*)\s*\/?>/g;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRegex.exec(markup)) !== null) {
        const tagName = tagMatch[1] ?? tagMatch[3] ?? tagMatch[6];
        const attributeString = (tagMatch[2] ?? tagMatch[4] ?? tagMatch[7] ?? '').replace(/\/\s*$/, '');
        const innerMarkup = tagMatch[5] ?? '';
        const node = document.createElementNS('http://www.w3.org/2000/svg', tagName);
        applySvgAttributes(node, attributeString);
        if (innerMarkup) {
            if (/<[A-Za-z0-9:-]+/.test(innerMarkup)) {
                appendSvgMarkup(node, innerMarkup);
            } else {
                node.textContent = innerMarkup;
            }
        }
        parent.appendChild(node);
    }
}

export function createSvgFromMarkup(markup: string): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const rootTag = /^<svg\b/i.test(markup) ? /<svg\b([^>]*)>/i.exec(markup) : null;
    if (rootTag) {
        applySvgAttributes(svg, rootTag[1]);
        const innerMarkup = markup.slice(markup.indexOf('>') + 1, markup.lastIndexOf('</svg>'));
        appendSvgMarkup(svg, innerMarkup);
    } else {
        appendSvgMarkup(svg, markup);
    }
    return svg;
}

export function createSvg(pathD: string, options: SvgOptions = {}): SVGSVGElement {
    const size = options.size ?? 24;
    const w = options.width ?? size;
    const h = options.height ?? size;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', options.viewBox ?? '0 0 24 24');
    svg.setAttribute('fill', options.fill ?? 'none');
    if (options.stroke !== 'none') {
        svg.setAttribute('stroke', options.stroke ?? 'currentColor');
    }
    svg.setAttribute('stroke-width', String(options.strokeWidth ?? 1.8));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (options.className) svg.setAttribute('class', options.className);

    if (pathD.startsWith('<')) {
        const markup = pathD.startsWith('<svg') ? pathD : `<svg xmlns="http://www.w3.org/2000/svg">${pathD}</svg>`;
        const parsedSvg = createSvgFromMarkup(markup);
        for (const child of Array.from(parsedSvg.children ?? [])) {
            svg.appendChild(child);
        }
    } else {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathD);
        if (options.dash) path.setAttribute('stroke-dasharray', options.dash);
        svg.appendChild(path);
    }
    return svg;
}

/**
 * Creates an SVG stroke preview wave for a given profile and color, or for a favorite preset configuration.
 * Supports both modern preset signature (color, width, profileId, opacity, pattern)
 * and legacy signature (profile, baseWidth, color, width, height).
 */
export function createStrokeWavePreview(
    colorOrProfile: string | PenProfile,
    baseWidth: number,
    profileIdOrColor?: PenProfileId | PenProfile | string,
    opacityOrWidth?: number,
    patternOrHeight?: StrokePattern | number,
    width = 150,
    height = 40,
): SVGSVGElement {
    let color: string;
    let profile: PenProfile;
    let opacity: number;
    let pattern: StrokePattern = 'solid';
    let svgW = width;
    let svgH = height;

    if (typeof colorOrProfile === 'object' && colorOrProfile !== null) {
        // Legacy: (profile, baseWidth, color, width?, height?)
        profile = colorOrProfile;
        color = typeof profileIdOrColor === 'string' ? profileIdOrColor : '#1F4FD8';
        if (typeof opacityOrWidth === 'number') svgW = opacityOrWidth;
        if (typeof patternOrHeight === 'number') svgH = patternOrHeight;
        opacity = profile.op;
    } else {
        // Modern: (color, baseWidth, profileId?, opacity?, pattern?, width?, height?)
        color = colorOrProfile;
        const profId = typeof profileIdOrColor === 'string'
            ? (profileIdOrColor as PenProfileId)
            : (typeof profileIdOrColor === 'object' && profileIdOrColor ? profileIdOrColor.id : 'fountain');
        profile = PEN_PROFILES[profId] ?? PEN_PROFILES.fountain;

        if (typeof opacityOrWidth === 'number') {
            opacity = opacityOrWidth > 1 ? opacityOrWidth / 100 : Math.max(0, opacityOrWidth);
        } else {
            opacity = profile.op;
        }

        if (typeof patternOrHeight === 'string') {
            pattern = patternOrHeight as StrokePattern;
        }
    }

    // La onda se define sobre una base de 150x40 y se escala al tamaño pedido,
    // así puede ocupar todo el ancho de la tarjeta sin deformar el trazo.
    const sx = svgW / 150;
    const sy = svgH / 40;
    const pt = (x: number, y: number) => `${+(x * sx).toFixed(1)} ${+(y * sy).toFixed(1)}`;
    const waveD = `M${pt(4, 28)} C${pt(30, 6)} ${pt(50, 38)} ${pt(76, 20)} S${pt(120, 8)} ${pt(146, 24)}`;

    // Grosor efectivo: nunca más del 60% del alto, para que no se recorte.
    const effWidth = Math.min(svgH * 0.6, Math.max(1.5, baseWidth * profile.wm));

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(svgW));
    svg.setAttribute('height', String(svgH));
    svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', waveD);
    path.setAttribute('stroke', mapInkColorForDark(color));
    path.setAttribute('stroke-width', String(effWidth));
    path.setAttribute('stroke-linecap', pattern === 'dashed' ? 'butt' : profile.cap);
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-opacity', String(opacity));

    if (pattern === 'dashed') {
        const dashLen = Math.max(6, Math.round(effWidth * 2.5));
        const gapLen = Math.max(4, Math.round(effWidth * 1.8));
        path.setAttribute('stroke-dasharray', `${dashLen} ${gapLen}`);
    } else if (pattern === 'dotted') {
        const gapLen = Math.max(4, Math.round(effWidth * 2));
        path.setAttribute('stroke-dasharray', `0.1 ${gapLen}`);
        path.setAttribute('stroke-linecap', 'round');
    } else if (profile.dash) {
        path.setAttribute('stroke-dasharray', profile.dash);
    }

    svg.appendChild(path);
    return svg;
}
