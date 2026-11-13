/**
 * src/engine/shapes/electrical.ts
 *
 * Modular electrical & electronic schematic symbols for Apolo Canvas 2.0:
 * - Basic components ('resistor', 'capacitor', 'power-source', 'ground')
 * - Transistors ('transistor-npn', 'transistor-pnp', 'transistor-mosfet')
 *
 * Every component defines explicit terminal snap ports with outward unit normals
 * so magnetic lines/arrows snap directly onto pins and rotate seamlessly.
 */

import type {
    CustomPathSegment,
    CustomShapeDefinition,
    CustomShapePortSpec,
    CustomShapeSubpath,
    ShapePlugin,
} from './types.ts';
import { createCustomShapePlugin } from './custom.ts';

export function polylineSubpath(
    points: ReadonlyArray<readonly [number, number]>,
    options: { isClosed?: boolean; isFilled?: boolean; isStroked?: boolean; fillWithStroke?: boolean } = {},
): CustomShapeSubpath {
    const commands: CustomPathSegment[] = [
        { type: 'M', args: [points[0][0], points[0][1]] },
        ...points.slice(1).map(([x, y]): CustomPathSegment => ({ type: 'L', args: [x, y] })),
    ];
    if (options.isClosed) {
        commands.push({ type: 'Z', args: [] });
    }
    return {
        commands,
        isClosed: options.isClosed ?? false,
        isFilled: options.isFilled ?? false,
        isStroked: options.isStroked ?? true,
        fillWithStroke: options.fillWithStroke,
    };
}

export function circleSubpath(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    options: { isFilled?: boolean; isStroked?: boolean } = {},
): CustomShapeSubpath {
    const k = 0.55228475;
    const kx = Number((k * rx).toFixed(4));
    const ky = Number((k * ry).toFixed(4));
    return {
        commands: [
            { type: 'M', args: [cx + rx, cy] },
            { type: 'C', args: [cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry] },
            { type: 'C', args: [cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy] },
            { type: 'C', args: [cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry] },
            { type: 'C', args: [cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy] },
            { type: 'Z', args: [] },
        ],
        isClosed: true,
        isFilled: options.isFilled ?? true,
        isStroked: options.isStroked ?? true,
    };
}

export const resistorShapePlugin: ShapePlugin = createCustomShapePlugin({
    id: 'resistor',
    name: 'Resistencia',
    isClosed: true,
    category: 'electrical-basic',
    subpaths: [
        polylineSubpath([
            [0, 0.5],
            [0.16, 0.5],
            [0.22, 0.2],
            [0.33, 0.8],
            [0.44, 0.2],
            [0.56, 0.8],
            [0.67, 0.2],
            [0.78, 0.8],
            [0.84, 0.5],
            [1, 0.5],
        ]),
    ],
    snapPorts: [
        { id: 'w', u: 0, v: 0.5, nx: -1, ny: 0 },
        { id: 'e', u: 1, v: 0.5, nx: 1, ny: 0 },
    ],
    iconSvgPaths: ['M 1 12 H 4.5 L 6.5 6.5 L 9.5 17.5 L 12 6.5 L 14.5 17.5 L 17.5 6.5 L 19.5 12 H 23'],
});

export const capacitorShapePlugin: ShapePlugin = createCustomShapePlugin({
    id: 'capacitor',
    name: 'Capacitor',
    isClosed: true,
    category: 'electrical-basic',
    subpaths: [
        polylineSubpath([[0, 0.5], [0.42, 0.5]]),
        polylineSubpath([[0.42, 0.12], [0.42, 0.88]]),
        polylineSubpath([[0.58, 0.12], [0.58, 0.88]]),
        polylineSubpath([[0.58, 0.5], [1, 0.5]]),
    ],
    snapPorts: [
        { id: 'w', u: 0, v: 0.5, nx: -1, ny: 0 },
        { id: 'e', u: 1, v: 0.5, nx: 1, ny: 0 },
    ],
    iconSvgPaths: ['M 1 12 H 9.5', 'M 9.5 5 V 19', 'M 14.5 5 V 19', 'M 14.5 12 H 23'],
});

export const powerSourceShapePlugin: ShapePlugin = createCustomShapePlugin({
    id: 'power-source',
    name: 'Fuente de poder',
    isClosed: true,
    category: 'electrical-basic',
    subpaths: [
        polylineSubpath([[0.5, 0], [0.5, 0.18]]),
        circleSubpath(0.5, 0.5, 0.32, 0.32, { isFilled: true, isStroked: true }),
        polylineSubpath([[0.5, 0.26], [0.5, 0.42]]),
        polylineSubpath([[0.42, 0.34], [0.58, 0.34]]),
        polylineSubpath([[0.42, 0.66], [0.58, 0.66]]),
        polylineSubpath([[0.5, 0.82], [0.5, 1]]),
    ],
    snapPorts: [
        { id: 'n', u: 0.5, v: 0, nx: 0, ny: -1 },
        { id: 's', u: 0.5, v: 1, nx: 0, ny: 1 },
    ],
    iconSvgPaths: [
        'M 12 1 V 5',
        'M 12 5 A 7 7 0 1 0 12 19 A 7 7 0 1 0 12 5 Z',
        'M 12 7.5 V 11.5',
        'M 10 9.5 H 14',
        'M 10 15.2 H 14',
        'M 12 19 V 23',
    ],
});

export const groundShapePlugin: ShapePlugin = createCustomShapePlugin({
    id: 'ground',
    name: 'Tierra',
    isClosed: true,
    category: 'electrical-basic',
    subpaths: [
        polylineSubpath([[0.5, 0], [0.5, 0.45]]),
        polylineSubpath([[0.1, 0.45], [0.9, 0.45]]),
        polylineSubpath([[0.25, 0.68], [0.75, 0.68]]),
        polylineSubpath([[0.4, 0.91], [0.6, 0.91]]),
    ],
    snapPorts: [
        { id: 'n', u: 0.5, v: 0, nx: 0, ny: -1 },
    ],
    iconSvgPaths: ['M 12 2 V 11', 'M 3 11 H 21', 'M 6.5 15.5 H 17.5', 'M 10 20 H 14'],
});

interface BjtVariantConfig {
    id: 'transistor-npn' | 'transistor-pnp';
    name: string;
    emitterOnTop: boolean;
    arrowTriangle: ReadonlyArray<readonly [number, number]>;
    iconArrow: string;
}

function createBjtDefinition(cfg: BjtVariantConfig): CustomShapeDefinition {
    const topPortId = cfg.emitterOnTop ? 'emitter' : 'collector';
    const bottomPortId = cfg.emitterOnTop ? 'collector' : 'emitter';
    const snapPorts: CustomShapePortSpec[] = [
        { id: 'base', u: 0, v: 0.5, nx: -1, ny: 0 },
        { id: topPortId, u: 0.7, v: 0, nx: 0, ny: -1 },
        { id: bottomPortId, u: 0.7, v: 1, nx: 0, ny: 1 },
    ];

    return {
        id: cfg.id,
        name: cfg.name,
        isClosed: true,
        category: 'electrical-transistor',
        subpaths: [
            circleSubpath(0.55, 0.5, 0.35, 0.35, { isFilled: true, isStroked: true }),
            polylineSubpath([[0, 0.5], [0.4, 0.5]]),
            polylineSubpath([[0.4, 0.28], [0.4, 0.72]]),
            polylineSubpath([[0.4, 0.4], [0.7, 0.22], [0.7, 0]]),
            polylineSubpath([[0.4, 0.6], [0.7, 0.78], [0.7, 1]]),
            polylineSubpath(cfg.arrowTriangle, { isClosed: true, isFilled: false, isStroked: true, fillWithStroke: true }),
        ],
        snapPorts,
        iconSvgPaths: [
            'M 21 12 A 8 8 0 1 0 5 12 A 8 8 0 1 0 21 12 Z',
            'M 1 12 H 9.5',
            'M 9.5 6.5 V 17.5',
            'M 9.5 9.5 L 16.5 5.2 V 1',
            'M 9.5 14.5 L 16.5 18.8 V 23',
            cfg.iconArrow,
        ],
    };
}

export const transistorNpnShapePlugin: ShapePlugin = createCustomShapePlugin(
    createBjtDefinition({
        id: 'transistor-npn',
        name: 'Transistor NPN',
        emitterOnTop: false,
        // Points outward along the bottom-right emitter branch (0.40, 0.60) -> (0.70, 0.78)
        arrowTriangle: [[0.676, 0.766], [0.534, 0.75], [0.595, 0.648]],
        iconArrow: 'M 16 18.5 L 12.6 18.1 L 14.1 15.6 Z',
    }),
);

export const transistorPnpShapePlugin: ShapePlugin = createCustomShapePlugin(
    createBjtDefinition({
        id: 'transistor-pnp',
        name: 'Transistor PNP',
        emitterOnTop: true,
        // Points inward along the top-right emitter branch (0.70, 0.22) -> (0.40, 0.40)
        arrowTriangle: [[0.442, 0.375], [0.522, 0.257], [0.584, 0.359]],
        iconArrow: 'M 10.6 8.8 L 12.6 6 L 14 8.5 Z',
    }),
);

export const transistorMosfetShapePlugin: ShapePlugin = createCustomShapePlugin({
    id: 'transistor-mosfet',
    name: 'Transistor MOSFET',
    isClosed: true,
    category: 'electrical-transistor',
    subpaths: [
        circleSubpath(0.55, 0.5, 0.35, 0.35, { isFilled: true, isStroked: true }),
        // Isolated gate pin + vertical gate plate
        polylineSubpath([[0, 0.68], [0.38, 0.68], [0.38, 0.3]]),
        // 3-segment enhancement-mode channel
        polylineSubpath([[0.48, 0.26], [0.48, 0.4]]),
        polylineSubpath([[0.48, 0.43], [0.48, 0.57]]),
        polylineSubpath([[0.48, 0.6], [0.48, 0.74]]),
        // Drain terminal
        polylineSubpath([[0.48, 0.33], [0.72, 0.33], [0.72, 0]]),
        // Source terminal + bulk return tie
        polylineSubpath([[0.48, 0.67], [0.72, 0.67], [0.72, 1]]),
        polylineSubpath([[0.52, 0.5], [0.72, 0.5], [0.72, 0.67]]),
        // N-channel inward bulk arrow
        polylineSubpath([[0.49, 0.5], [0.6, 0.445], [0.6, 0.555]], {
            isClosed: true,
            isFilled: false,
            isStroked: true,
            fillWithStroke: true,
        }),
    ],
    snapPorts: [
        { id: 'gate', u: 0, v: 0.68, nx: -1, ny: 0 },
        { id: 'drain', u: 0.72, v: 0, nx: 0, ny: -1 },
        { id: 'source', u: 0.72, v: 1, nx: 0, ny: 1 },
    ],
    iconSvgPaths: [
        'M 21 12 A 8 8 0 1 0 5 12 A 8 8 0 1 0 21 12 Z',
        'M 1 16.5 H 9 V 7.5',
        'M 11.5 6.5 V 9.5',
        'M 11.5 10.5 V 13.5',
        'M 11.5 14.5 V 17.5',
        'M 11.5 8 H 17 V 1',
        'M 11.5 16 H 17 V 23',
        'M 12.2 12 H 17 V 16',
        'M 12 12 L 14.8 10.6 V 13.4 Z',
    ],
});
