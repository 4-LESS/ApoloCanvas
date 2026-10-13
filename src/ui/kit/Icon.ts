/**
 * Apolo Canvas 2.0 – Unified Icon Registry & Pure DOM SVG Factory
 *
 * Implements Architecture Rule 8:
 * "Una sola función que crea SVG por DOM a partir de un registro de íconos
 *  (cuadrícula de 24 px, trazo 1,8, extremos redondeados). Sin innerHTML;
 *  sin estilos en línea salvo variables CSS de posición."
 */

export type IconName =
    | 'pen'
    | 'highlighter'
    | 'eraser'
    | 'lasso'
    | 'shapes'
    | 'line'
    | 'arrow'
    | 'rect'
    | 'circle'
    | 'triangle'
    | 'insertCanvas'
    | 'undo'
    | 'redo'
    | 'grid'
    | 'snap'
    | 'keyboardMode'
    | 'link'
    | 'close'
    | 'check'
    | 'compress'
    | 'trash'
    | 'dragGrip'
    | 'plus'
    | 'minus'
    | 'chevronDown'
    | 'chevronUp'
    | 'dots'
    | 'gridTile'
    | 'ruled'
    | 'blank'
    | 'favorite'
    | 'colorPicker';

export interface IconOptions {
    size?: number;
    width?: number;
    height?: number;
    stroke?: string;
    strokeWidth?: number;
    fill?: string;
    dash?: string;
    className?: string;
}

interface PathDef {
    type: 'path';
    d: string;
    dash?: string;
    fill?: string;
}

interface CircleDef {
    type: 'circle';
    cx: number;
    cy: number;
    r: number;
    fill?: string;
}

interface LineDef {
    type: 'line';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

type SvgElementDef = PathDef | CircleDef | LineDef;

/**
 * Pure data definitions for 24x24 icons.
 */
const ICON_DEFINITIONS: Record<IconName, SvgElementDef[]> = {
    pen: [
        { type: 'path', d: 'M4 20l1-4L16 5l3 3L8 19z' },
        { type: 'path', d: 'M14 7l3 3' },
    ],
    highlighter: [
        { type: 'path', d: 'M14 4l6 6-7 7-6-6z' },
        { type: 'path', d: 'M9 16l-4 4h5l2-2' },
    ],
    eraser: [
        { type: 'path', d: 'M5 14l8-8 6 6-6 6H9z' },
        { type: 'path', d: 'M7 20h12' },
    ],
    lasso: [
        { type: 'path', d: 'M4 10a8 5 0 1016 0a8 5 0 10-16 0 M12 15c0 3-2 4-3 5', dash: '3 2.5' },
    ],
    shapes: [
        { type: 'path', d: 'M4 6h16v12H4z' },
        { type: 'circle', cx: 12, cy: 12, r: 4 },
    ],
    line: [
        { type: 'line', x1: 5, y1: 19, x2: 19, y2: 5 },
    ],
    arrow: [
        { type: 'line', x1: 5, y1: 19, x2: 19, y2: 5 },
        { type: 'path', d: 'M10 5h9v9' },
    ],
    rect: [
        { type: 'path', d: 'M4 6h16v12H4z' },
    ],
    circle: [
        { type: 'circle', cx: 12, cy: 12, r: 9 },
    ],
    triangle: [
        { type: 'path', d: 'M12 4l9 16H3z' },
    ],
    insertCanvas: [
        { type: 'path', d: 'M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5z' },
        { type: 'line', x1: 9, y1: 12, x2: 15, y2: 12 },
        { type: 'line', x1: 12, y1: 9, x2: 12, y2: 15 },
    ],
    undo: [
        { type: 'path', d: 'M9 14L4 9l5-5' },
        { type: 'path', d: 'M4 9h9a6 6 0 010 12h-3' },
    ],
    redo: [
        { type: 'path', d: 'M15 14l5-5-5-5' },
        { type: 'path', d: 'M20 9h-9a6 6 0 000 12h3' },
    ],
    grid: [
        { type: 'path', d: 'M4 4h16v16H4z' },
        { type: 'line', x1: 4, y1: 12, x2: 20, y2: 12 },
        { type: 'line', x1: 12, y1: 4, x2: 12, y2: 20 },
    ],
    snap: [
        { type: 'path', d: 'M4 4v7a8 8 0 0016 0V4' },
        { type: 'path', d: 'M8 4v7a4 4 0 008 0V4' },
        { type: 'line', x1: 4, y1: 4, x2: 8, y2: 4 },
        { type: 'line', x1: 16, y1: 4, x2: 20, y2: 4 },
    ],
    keyboardMode: [
        { type: 'line', x1: 9, y1: 4, x2: 15, y2: 4 },
        { type: 'line', x1: 9, y1: 20, x2: 15, y2: 20 },
        { type: 'line', x1: 12, y1: 4, x2: 12, y2: 20 },
    ],
    link: [
        { type: 'path', d: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1' },
        { type: 'path', d: 'M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1' },
    ],
    close: [
        { type: 'line', x1: 6, y1: 6, x2: 18, y2: 18 },
        { type: 'line', x1: 18, y1: 6, x2: 6, y2: 18 },
    ],
    check: [
        { type: 'path', d: 'M5 13l4 4L19 7' },
    ],
    compress: [
        { type: 'path', d: 'M4 14h6v6 M20 10h-6V4 M14 10l7-7 M10 14L3 21' },
    ],
    trash: [
        { type: 'path', d: 'M3 6h18 M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2' },
        { type: 'line', x1: 10, y1: 11, x2: 10, y2: 17 },
        { type: 'line', x1: 14, y1: 11, x2: 14, y2: 17 },
    ],
    dragGrip: [
        { type: 'circle', cx: 8, cy: 6, r: 1.5, fill: 'currentColor' },
        { type: 'circle', cx: 16, cy: 6, r: 1.5, fill: 'currentColor' },
        { type: 'circle', cx: 8, cy: 12, r: 1.5, fill: 'currentColor' },
        { type: 'circle', cx: 16, cy: 12, r: 1.5, fill: 'currentColor' },
        { type: 'circle', cx: 8, cy: 18, r: 1.5, fill: 'currentColor' },
        { type: 'circle', cx: 16, cy: 18, r: 1.5, fill: 'currentColor' },
    ],
    plus: [
        { type: 'line', x1: 12, y1: 5, x2: 12, y2: 19 },
        { type: 'line', x1: 5, y1: 12, x2: 19, y2: 12 },
    ],
    minus: [
        { type: 'line', x1: 5, y1: 12, x2: 19, y2: 12 },
    ],
    chevronDown: [
        { type: 'path', d: 'M6 9l6 6 6-6' },
    ],
    chevronUp: [
        { type: 'path', d: 'M18 15l-6-6-6 6' },
    ],
    dots: [
        { type: 'circle', cx: 7, cy: 7, r: 1.5, fill: 'currentColor' },
        { type: 'circle', cx: 17, cy: 7, r: 1.5, fill: 'currentColor' },
        { type: 'circle', cx: 7, cy: 17, r: 1.5, fill: 'currentColor' },
        { type: 'circle', cx: 17, cy: 17, r: 1.5, fill: 'currentColor' },
    ],
    gridTile: [
        { type: 'line', x1: 4, y1: 9, x2: 20, y2: 9 },
        { type: 'line', x1: 4, y1: 15, x2: 20, y2: 15 },
        { type: 'line', x1: 9, y1: 4, x2: 9, y2: 20 },
        { type: 'line', x1: 15, y1: 4, x2: 15, y2: 20 },
    ],
    ruled: [
        { type: 'line', x1: 4, y1: 7, x2: 20, y2: 7 },
        { type: 'line', x1: 4, y1: 12, x2: 20, y2: 12 },
        { type: 'line', x1: 4, y1: 17, x2: 20, y2: 17 },
    ],
    blank: [
        { type: 'path', d: 'M5 5h14v14H5z', dash: '3 3' },
    ],
    favorite: [
        { type: 'path', d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' },
    ],
    colorPicker: [
        { type: 'path', d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.38 0 2.5-1.12 2.5-2.5 0-.61-.23-1.2-.64-1.67-.4-.46-.64-1.04-.64-1.67 0-1.38 1.12-2.5 2.5-2.5H18c2.21 0 4-1.79 4-4 0-5.52-4.48-9.66-10-9.66z' },
        { type: 'circle', cx: 6.5, cy: 11.5, r: 1.5, fill: 'currentColor' },
        { type: 'circle', cx: 9.5, cy: 7.5, r: 1.5, fill: 'currentColor' },
        { type: 'circle', cx: 14.5, cy: 7.5, r: 1.5, fill: 'currentColor' },
        { type: 'circle', cx: 17.5, cy: 11.5, r: 1.5, fill: 'currentColor' },
    ],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Creates a pure DOM SVG element from the icon registry.
 * Absolutely ZERO innerHTML used.
 */
export function createSvgIcon(name: IconName, options: IconOptions = {}): SVGSVGElement {
    const size = options.size ?? 24;
    const w = options.width ?? size;
    const h = options.height ?? size;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', options.fill ?? 'none');

    const defaultStroke = options.stroke ?? 'currentColor';
    if (options.stroke !== 'none') {
        svg.setAttribute('stroke', defaultStroke);
    }
    svg.setAttribute('stroke-width', String(options.strokeWidth ?? 1.8));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (options.className) svg.setAttribute('class', options.className);

    const defs = ICON_DEFINITIONS[name];
    if (defs) {
        for (const def of defs) {
            if (def.type === 'path') {
                const pathEl = document.createElementNS(SVG_NS, 'path');
                pathEl.setAttribute('d', def.d);
                if (def.dash || options.dash) {
                    pathEl.setAttribute('stroke-dasharray', def.dash || options.dash || '');
                }
                if (def.fill) pathEl.setAttribute('fill', def.fill);
                svg.appendChild(pathEl);
            } else if (def.type === 'circle') {
                const circleEl = document.createElementNS(SVG_NS, 'circle');
                circleEl.setAttribute('cx', String(def.cx));
                circleEl.setAttribute('cy', String(def.cy));
                circleEl.setAttribute('r', String(def.r));
                if (def.fill) {
                    circleEl.setAttribute('fill', def.fill);
                    circleEl.setAttribute('stroke', 'none');
                }
                svg.appendChild(circleEl);
            } else if (def.type === 'line') {
                const lineEl = document.createElementNS(SVG_NS, 'line');
                lineEl.setAttribute('x1', String(def.x1));
                lineEl.setAttribute('y1', String(def.y1));
                lineEl.setAttribute('x2', String(def.x2));
                lineEl.setAttribute('y2', String(def.y2));
                svg.appendChild(lineEl);
            }
        }
    }

    return svg;
}
