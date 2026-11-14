import type { PenFavorite, PenProfile, PenProfileId, ShapeFillPattern, ShapeType, StrokePattern } from '../core/types.ts';

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
        rectangle: 'M4 6h16v12H4z',
        ellipse: 'M21 12a9 9 0 11-18 0a9 9 0 0118 0',
        diamond: 'M12 2l10 10-10 10L2 12z',
        hexagon: 'M6 3h12l5 9-5 9H6l-5-9z',
        cylinder: 'M4 6c0-2.2 3.6-4 8-4s8 1.8 8 4v12c0 2.2-3.6 4-8 4s-8-1.8-8-4z',
        blob: 'M 8 4 C 14 2, 21 5, 20 11 C 19 16, 22 19, 16 21 C 10 22, 4 19, 4 13 C 4 8, 5 5, 8 4 Z',
        resistor: 'M1 12H4.5L6.5 6.5L9.5 17.5L12 6.5L14.5 17.5L17.5 6.5L19.5 12H23',
        capacitor: 'M1 12H9.5 M9.5 5V19 M14.5 5V19 M14.5 12H23',
        'power-source': 'M12 1V5 M12 5A7 7 0 1012 19A7 7 0 1012 5Z M12 7.5V11.5 M10 9.5H14 M10 15.2H14 M12 19V23',
        ground: 'M12 2V11 M3 11H21 M6.5 15.5H17.5 M10 20H14',
        'transistor-npn': 'M21 12A8 8 0 105 12A8 8 0 1021 12Z M1 12H9.5 M9.5 6.5V17.5 M9.5 9.5L16.5 5.2V1 M9.5 14.5L16.5 18.8V23 M16 18.5L12.6 18.1L14.1 15.6Z',
        'transistor-pnp': 'M21 12A8 8 0 105 12A8 8 0 1021 12Z M1 12H9.5 M9.5 6.5V17.5 M9.5 9.5L16.5 5.2V1 M9.5 14.5L16.5 18.8V23 M10.6 8.8L12.6 6L14 8.5Z',
        'transistor-mosfet': 'M21 12A8 8 0 105 12A8 8 0 1021 12Z M1 16.5H9V7.5 M11.5 6.5V9.5 M11.5 10.5V13.5 M11.5 14.5V17.5 M11.5 8H17V1 M11.5 16H17V23 M12.2 12H17V16 M12 12L14.8 10.6V13.4Z',
        'gate-and': 'M 1 8 H 5 M 1 16 H 5 M 5 4 H 12 A 7 8 0 0 1 12 20 H 5 Z M 19 12 H 23',
        'gate-or': 'M 1 8 H 6.2 M 1 16 H 6.2 M 4.5 4.5 C 11 4.5, 16 7.5, 19.5 12 C 16 16.5, 11 19.5, 4.5 19.5 Q 8.5 12 4.5 4.5 Z M 19.5 12 H 23',
        'gate-not': 'M 1 12 H 5.5 M 5.5 4.5 L 17 12 L 5.5 19.5 Z M 20.6 12 A 1.8 1.8 0 1 0 17 12 A 1.8 1.8 0 1 0 20.6 12 Z M 20.6 12 H 23',
        'gate-nand': 'M 1 8 H 4.5 M 1 16 H 4.5 M 4.5 4.5 H 10.5 A 6.5 7.5 0 0 1 10.5 19.5 H 4.5 Z M 20.6 12 A 1.8 1.8 0 1 0 17 12 A 1.8 1.8 0 1 0 20.6 12 Z M 20.6 12 H 23',
        'gate-nor': 'M 1 8 H 5.8 M 1 16 H 5.8 M 4 4.5 C 10 4.5, 14 7.5, 17 12 C 14 16.5, 10 19.5, 4 19.5 Q 8 12 4 4.5 Z M 20.6 12 A 1.8 1.8 0 1 0 17 12 A 1.8 1.8 0 1 0 20.6 12 Z M 20.6 12 H 23',
        'gate-xor': 'M 1 8 H 4.8 M 1 16 H 4.8 M 3.2 4.5 Q 7 12 3.2 19.5 M 6 4.5 C 11.5 4.5, 16.5 7.5, 19.5 12 C 16.5 16.5, 11.5 19.5, 6 19.5 Q 9.8 12 6 4.5 Z M 19.5 12 H 23',
        'gate-xnor': 'M 1 8 H 4.5 M 1 16 H 4.5 M 3 4.5 Q 6.6 12 3 19.5 M 5.6 4.5 C 10.5 4.5, 14.5 7.5, 17 12 C 14.5 16.5, 10.5 19.5, 5.6 19.5 Q 9 12 5.6 4.5 Z M 20.6 12 A 1.8 1.8 0 1 0 17 12 A 1.8 1.8 0 1 0 20.6 12 Z M 20.6 12 H 23',
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
    caret: 'M2.5 4.5L6 8l3.5-3.5',
    ratio: 'M4 9V6a2 2 0 012-2h3 M20 9V6a2 2 0 00-2-2h-3 M4 15v3a2 2 0 002 2h3 M20 15v3a2 2 0 01-2 2h-3 M8.5 9.5v5 M12 10v.1 M12 14v.1 M15.5 9.5v5',
    lineSolid: 'M3 12h18',
    lineDashed: 'M3 12h18',
    lineDotted: 'M3 12h18',
    check: 'M5 13l4 4L19 7',
    dragGrip: '<circle cx="4" cy="3" r="1.5"></circle><circle cx="10" cy="3" r="1.5"></circle><circle cx="4" cy="7" r="1.5"></circle><circle cx="10" cy="7" r="1.5"></circle><circle cx="4" cy="11" r="1.5"></circle><circle cx="10" cy="11" r="1.5"></circle>',
    feather: 'M20.24 12.24a6 6 0 00-8.49-8.49L5 10.5V19h8.5z M16 8L2 22 M17.5 15H9',
    highlighterChisel: 'M7 17l-3 4h6l-1-2 M11 4l8 8-6 6-8-8z M15 3l4 4',
    highlighterRound: 'M12 2a4 4 0 00-4 4v7l2 2v6h4v-6l2-2V6a4 4 0 00-4-4z',
    pencil: 'M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z',
    bookmark: 'M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z',
    star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    starOff: 'M8.34 2.69L12 2l3.09 6.26L22 9.27l-3.32 3.24 M18.37 18.36L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01 M2 2l20 20',
    arrowLeft: 'M19 12H5 M12 19l-7-7 7-7',
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

/**
 * Sets an accessible tooltip on an element for Obsidian without triggering
 * duplicate native browser tooltips.
 * In Obsidian WebView, setting `aria-label` triggers Obsidian's rich tooltip.
 * If `title` is also set as a DOM attribute, Chromium spawns a second native tooltip.
 * We set `aria-label` and define a JS `.title` getter so unit tests still pass.
 */
export function setAccessibleTooltip(el: HTMLElement, label: string, jsTitle?: string): void {
    el.setAttribute?.('aria-label', label);
    if (typeof el.removeAttribute === 'function') {
        el.removeAttribute('title');
    }
    const titleVal = jsTitle ?? label;
    try {
        Object.defineProperty(el, 'title', {
            get: () => titleVal,
            set: () => {},
            configurable: true,
        });
    } catch {
        (el as any).title = titleVal;
    }
    if ((el as any).title !== titleVal) {
        (el as any).title = titleVal;
    }
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
    svg.setAttribute('preserveAspectRatio', 'none');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', waveD);
    path.setAttribute('stroke', mapInkColorForDark(color));
    path.setAttribute('stroke-width', String(effWidth));
    path.setAttribute('stroke-linecap', pattern === 'dashed' ? 'butt' : profile.cap);
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-opacity', String(opacity));
    path.setAttribute('vector-effect', 'non-scaling-stroke');

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

const GLYPH_SPACING_LEVELS = [6.5, 5, 4, 3.2, 2.6] as const;

/**
 * Creates the dynamic fill pattern icon used in the tool estuche bar and tray chips.
 * Built entirely with DOM methods (no HTML string injection).
 */
export function createFillGlyph(
    pattern: ShapeFillPattern | 'off',
    density = 3,
    id = 'apolo-fill-glyph',
): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'fg');
    svg.setAttribute('viewBox', '0 0 20 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('aria-hidden', 'true');

    const clampedDensity = Math.max(1, Math.min(5, Math.round(density)));
    const s = GLYPH_SPACING_LEVELS[clampedDensity - 1] ?? 4;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '2');
    rect.setAttribute('y', '2');
    rect.setAttribute('width', '16');
    rect.setAttribute('height', '12');
    rect.setAttribute('rx', '2.5');
    rect.setAttribute('stroke-width', '1.6');

    if (pattern === 'off') {
        rect.setAttribute('fill', 'none');
        svg.appendChild(rect);

        const slash = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        slash.setAttribute('d', 'M3.5 12.5L16.5 3.5');
        slash.setAttribute('stroke-width', '1.6');
        slash.setAttribute('stroke', 'currentColor');
        svg.appendChild(slash);
        return svg;
    }

    if (pattern === 'solid') {
        rect.setAttribute('fill', 'currentColor');
        rect.setAttribute('fill-opacity', '0.45');
        svg.appendChild(rect);
        return svg;
    }

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const pat = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
    pat.setAttribute('id', id);
    pat.setAttribute('width', String(s));
    pat.setAttribute('height', String(s));
    pat.setAttribute('patternUnits', 'userSpaceOnUse');

    if (pattern === 'dots') {
        pat.setAttribute('x', '1');
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(s / 2));
        circle.setAttribute('cy', String(s / 2));
        circle.setAttribute('r', '0.85');
        circle.setAttribute('fill', 'currentColor');
        pat.appendChild(circle);
    } else {
        pat.setAttribute('patternTransform', 'rotate(45)');
        const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = pattern === 'cross-hatch' ? `M0 0H${s} M0 0V${s}` : `M0 0H${s}`;
        linePath.setAttribute('d', d);
        linePath.setAttribute('stroke', 'currentColor');
        linePath.setAttribute('stroke-width', '1.1');
        pat.appendChild(linePath);
    }

    defs.appendChild(pat);
    svg.appendChild(defs);

    rect.setAttribute('fill', `url(#${id})`);
    svg.appendChild(rect);

    return svg;
}

/**
 * Binds both pointerup (with tap-slop and duration check) and click to an element,
 * ensuring robust responsiveness on mobile/tablet stylus/touch while preventing double-firing.
 */
let lastGlobalPointerTap: { time: number; x: number; y: number; el: HTMLElement | null } = {
    time: 0,
    x: 0,
    y: 0,
    el: null,
};

export function bindTapOrClick(
    el: HTMLElement,
    action: (e?: MouseEvent | PointerEvent) => void,
): () => void {
    let downPos: { x: number; y: number; time: number } | null = null;
    let lastTriggerTime = 0;

    const onPointerDown = (e: PointerEvent) => {
        if (typeof e.button === 'number' && e.button !== 0 && e.button !== -1) return;
        downPos = { x: e.clientX, y: e.clientY, time: Date.now() };
    };

    const onPointerUp = (e: PointerEvent) => {
        if (!downPos) return;
        const dx = e.clientX - downPos.x;
        const dy = e.clientY - downPos.y;
        const dt = Date.now() - downPos.time;
        downPos = null;

        // Slop distance for stylus/finger tap: <= 12px, <= 600ms
        if (Math.hypot(dx, dy) <= 12 && dt <= 600) {
            e.preventDefault?.();
            e.stopPropagation?.();
            lastTriggerTime = Date.now();
            lastGlobalPointerTap = { time: lastTriggerTime, x: e.clientX, y: e.clientY, el };
            action(e);
            try {
                if (e.pointerType === 'touch' || e.pointerType === 'pen') {
                    el.blur();
                }
            } catch {
                // ignore
            }
        }
    };

    const onPointerCancel = () => {
        downPos = null;
    };

    const onClick = (e?: MouseEvent) => {
        const now = Date.now();
        if (now - lastTriggerTime < 450) {
            e?.preventDefault?.();
            e?.stopPropagation?.();
            return;
        }
        const cx = e?.clientX ?? 0;
        const cy = e?.clientY ?? 0;
        const sinceGlobal = now - lastGlobalPointerTap.time;
        const hasCoords = cx !== 0 || cy !== 0;
        if (
            lastGlobalPointerTap.el &&
            lastGlobalPointerTap.el !== el &&
            sinceGlobal < 450 &&
            hasCoords &&
            Math.hypot(cx - lastGlobalPointerTap.x, cy - lastGlobalPointerTap.y) <= 8
        ) {
            e?.preventDefault?.();
            e?.stopPropagation?.();
            return;
        }
        lastTriggerTime = now;
        action(e);
        try {
            el.blur();
        } catch {
            // ignore
        }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('click', onClick);
    el.onclick = onClick;

    return () => {
        el.removeEventListener('pointerdown', onPointerDown);
        el.removeEventListener('pointerup', onPointerUp);
        el.removeEventListener('pointercancel', onPointerCancel);
        el.removeEventListener('click', onClick);
        if (el.onclick === onClick) {
            el.onclick = null as any;
        }
    };
}

/** Clamps a numeric opacity percentage into [0, 100], falling back to 100. */
export function normalizeOpacityPercent(value: number | undefined | null, fallback = 100): number {
    return Math.max(0, Math.min(100, Number.isFinite(value) ? Number(value) : fallback));
}

/** Converts #RGB or #RRGGBB hex color + 0..100 opacity percentage into rgba() (or returns input when opacity >= 100). */
export function hexToRgba(hex: string, opacityPercent: number): string {
    const op = normalizeOpacityPercent(opacityPercent, 100) / 100;
    if (op >= 1) return hex;
    const clean = hex.replace('#', '');
    if (clean.length === 3) {
        const r = parseInt(clean[0] + clean[0], 16);
        const g = parseInt(clean[1] + clean[1], 16);
        const b = parseInt(clean[2] + clean[2], 16);
        return `rgba(${r}, ${g}, ${b}, ${op})`;
    }
    if (clean.length === 6) {
        const r = parseInt(clean.slice(0, 2), 16);
        const g = parseInt(clean.slice(2, 4), 16);
        const b = parseInt(clean.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${op})`;
    }
    return hex;
}

export interface SwatchCircleButtonOptions {
    className: string;
    color?: string | null;
    opacity?: number;
    active?: boolean;
    activeClass?: string;
    innerClass?: string;
    emptyClass?: string;
    title?: string;
    ariaLabel?: string;
    onClick?: (e?: MouseEvent | PointerEvent) => void;
    dataset?: Record<string, string>;
    attrs?: Record<string, string>;
}

/** Creates a circular color swatch button using standard DOM APIs for compatibility with mock/test DOMs. */
export function createSwatchCircleButton(options: SwatchCircleButtonOptions): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = options.className;
    btn.style.touchAction = 'manipulation';
    if (options.active) {
        btn.classList.add(options.activeClass ?? 'is-active');
    }
    if (!options.color && options.emptyClass) {
        btn.classList.add(options.emptyClass);
    }
    if (options.title) {
        setAccessibleTooltip(btn, options.ariaLabel ?? options.title, options.title);
    } else if (options.ariaLabel) {
        btn.setAttribute('aria-label', options.ariaLabel);
    }
    if (options.dataset) {
        for (const [k, v] of Object.entries(options.dataset)) {
            btn.dataset[k] = v;
        }
    }
    if (options.attrs) {
        for (const [k, v] of Object.entries(options.attrs)) {
            btn.setAttribute(k, v);
        }
    }
    if (options.color) {
        const op = normalizeOpacityPercent(options.opacity, 100);
        if (op < 100) {
            btn.classList.add('has-transparency');
        }
        btn.style.setProperty('--c', options.color);
        btn.style.setProperty('--swatch-color', options.color);
        const fillColor = hexToRgba(options.color, op);
        const inner = options.innerClass ? document.createElement('span') : null;
        if (inner) {
            inner.className = options.innerClass!;
            inner.style.backgroundColor = fillColor;
            btn.appendChild(inner);
        }
        if (op >= 100 || !inner) {
            btn.style.backgroundColor = fillColor;
        }
    }
    if (options.onClick) {
        bindTapOrClick(btn, options.onClick);
    }
    return btn;
}


