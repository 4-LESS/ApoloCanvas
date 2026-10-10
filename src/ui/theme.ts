import { PenFavorite, PenProfile, PenProfileId, ShapeType } from '../core/types';

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
 * Pen profiles definitions.
 */
export const PEN_PROFILES: Record<PenProfileId, PenProfile> = {
    fountain: { id: 'fountain', name: 'Pluma estilográfica', wm: 1.0, op: 1.0, cap: 'round', dash: '' },
    calli: { id: 'calli', name: 'Pincel caligráfico', wm: 2.2, op: 1.0, cap: 'butt', dash: '' },
    ball: { id: 'ball', name: 'Bolígrafo', wm: 0.75, op: 0.95, cap: 'round', dash: '' },
    pencil: { id: 'pencil', name: 'Lápiz texturado', wm: 1.2, op: 0.75, cap: 'round', dash: '1.5 2' },
    hlr: { id: 'hlr', name: 'Marcador redondo', wm: 4.5, op: 0.35, cap: 'round', dash: '' },
    hlf: { id: 'hlf', name: 'Marcador plano', wm: 4.5, op: 0.35, cap: 'square', dash: '' },
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
    undo: 'M9 14L4 9l5-5 M4 9h9a6 6 0 010 12h-3',
    redo: 'M15 14l5-5-5-5 M20 9h-9a6 6 0 000 12h3',
    grid: 'M4 4h16v16H4z M4 12h16 M12 4v16',
    more: 'M5 12h.01 M12 12h.01 M19 12h.01',
    keyboardMode: 'M9 4h6 M9 20h6 M12 4v16',
    link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
    close: 'M6 6l12 12 M18 6L6 18',
    check: 'M5 13l4 4L19 7',
    dragGrip: '<circle cx="4" cy="3" r="1.5"></circle><circle cx="10" cy="3" r="1.5"></circle><circle cx="4" cy="7" r="1.5"></circle><circle cx="10" cy="7" r="1.5"></circle><circle cx="4" cy="11" r="1.5"></circle><circle cx="10" cy="11" r="1.5"></circle>',
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

    // If path starts with an SVG tag, inject directly, else create path
    if (pathD.startsWith('<')) {
        svg.innerHTML = pathD;
    } else {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathD);
        if (options.dash) path.setAttribute('stroke-dasharray', options.dash);
        svg.appendChild(path);
    }
    return svg;
}

/**
 * Creates an SVG stroke preview wave for a given profile and color.
 */
export function createStrokeWavePreview(
    profile: PenProfile,
    baseWidth: number,
    color: string,
    width = 150,
    height = 40,
): SVGSVGElement {
    const waveD = 'M4 28 C30 6 50 38 76 20 S120 8 146 24';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', waveD);
    path.setAttribute('stroke', mapInkColorForDark(color));
    path.setAttribute('stroke-width', String(Math.max(1.5, baseWidth * profile.wm)));
    path.setAttribute('stroke-linecap', profile.cap);
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-opacity', String(profile.op));
    if (profile.dash) {
        path.setAttribute('stroke-dasharray', profile.dash);
    }
    svg.appendChild(path);
    return svg;
}
