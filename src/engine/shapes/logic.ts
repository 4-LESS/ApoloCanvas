/**
 * src/engine/shapes/logic.ts
 *
 * Standard ANSI/IEEE digital logic gate plugins for Apolo Canvas 2.0:
 * - Basic gates: AND, OR, NOT, NAND, NOR
 * - Exclusive gates: XOR, XNOR
 *
 * Every gate exposes terminal snap ports ('in'/'in1'/'in2', 'out') with outward
 * unit normals so magnetic connectors route perpendicularly and follow rotations.
 */

import type {
    CustomShapePortSpec,
    CustomShapeSubpath,
    ShapePlugin,
} from './types.ts';
import { createCustomShapePlugin } from './custom.ts';
import { circleSubpath, polylineSubpath } from './electrical.ts';

interface LogicGateConfig {
    id:
        | 'gate-and'
        | 'gate-or'
        | 'gate-not'
        | 'gate-nand'
        | 'gate-nor'
        | 'gate-xor'
        | 'gate-xnor';
    name: string;
    twoInputs: boolean;
    hasBubble: boolean;
    inputLeadEndX: number;
    bodySubpath: CustomShapeSubpath;
    extraSubpaths?: CustomShapeSubpath[];
    iconSvgPaths: readonly string[];
}

function createLogicGatePlugin(cfg: LogicGateConfig): ShapePlugin {
    const subpaths: CustomShapeSubpath[] = [];
    const snapPorts: CustomShapePortSpec[] = [];

    if (cfg.twoInputs) {
        subpaths.push(
            polylineSubpath([[0, 0.3], [cfg.inputLeadEndX, 0.3]]),
            polylineSubpath([[0, 0.7], [cfg.inputLeadEndX, 0.7]]),
        );
        snapPorts.push(
            { id: 'in1', u: 0, v: 0.3, nx: -1, ny: 0 },
            { id: 'in2', u: 0, v: 0.7, nx: -1, ny: 0 },
        );
    } else {
        subpaths.push(polylineSubpath([[0, 0.5], [cfg.inputLeadEndX, 0.5]]));
        snapPorts.push({ id: 'in', u: 0, v: 0.5, nx: -1, ny: 0 });
    }

    if (cfg.extraSubpaths) {
        subpaths.push(...cfg.extraSubpaths);
    }

    subpaths.push(cfg.bodySubpath);

    if (cfg.hasBubble) {
        subpaths.push(circleSubpath(0.8, 0.5, 0.06, 0.08, { isFilled: false, isStroked: true }));
        subpaths.push(polylineSubpath([[0.86, 0.5], [1, 0.5]]));
    } else {
        subpaths.push(polylineSubpath([[0.82, 0.5], [1, 0.5]]));
    }

    snapPorts.push({ id: 'out', u: 1, v: 0.5, nx: 1, ny: 0 });

    return createCustomShapePlugin({
        id: cfg.id,
        name: cfg.name,
        isClosed: true,
        category: 'electrical-logic',
        subpaths,
        snapPorts,
        iconSvgPaths: cfg.iconSvgPaths,
    });
}

function makeAndBody(leftX: number, shoulderX: number, noseX: number): CustomShapeSubpath {
    const k = 0.55228475;
    const rx = noseX - shoulderX;
    const ry = 0.38;
    const kx = Number((k * rx).toFixed(4));
    const ky = Number((k * ry).toFixed(4));
    return {
        commands: [
            { type: 'M', args: [leftX, 0.12] },
            { type: 'L', args: [shoulderX, 0.12] },
            { type: 'C', args: [shoulderX + kx, 0.12, noseX, 0.5 - ky, noseX, 0.5] },
            { type: 'C', args: [noseX, 0.5 + ky, shoulderX + kx, 0.88, shoulderX, 0.88] },
            { type: 'L', args: [leftX, 0.88] },
            { type: 'Z', args: [] },
        ],
        isClosed: true,
        isFilled: true,
        isStroked: true,
    };
}

function makeOrBody(leftX: number, ctrlBackX: number, upperMid1X: number, upperMid2X: number, noseX: number): CustomShapeSubpath {
    return {
        commands: [
            { type: 'M', args: [leftX, 0.12] },
            { type: 'C', args: [upperMid1X, 0.12, upperMid2X, 0.28, noseX, 0.5] },
            { type: 'C', args: [upperMid2X, 0.72, upperMid1X, 0.88, leftX, 0.88] },
            { type: 'Q', args: [ctrlBackX, 0.5, leftX, 0.12] },
            { type: 'Z', args: [] },
        ],
        isClosed: true,
        isFilled: true,
        isStroked: true,
    };
}

function makeShieldSubpath(x: number, ctrlX: number): CustomShapeSubpath {
    return {
        commands: [
            { type: 'M', args: [x, 0.12] },
            { type: 'Q', args: [ctrlX, 0.5, x, 0.88] },
        ],
        isClosed: false,
        isFilled: false,
        isStroked: true,
    };
}

export const gateAndShapePlugin: ShapePlugin = createLogicGatePlugin({
    id: 'gate-and',
    name: 'Puerta AND',
    twoInputs: true,
    hasBubble: false,
    inputLeadEndX: 0.18,
    bodySubpath: makeAndBody(0.18, 0.5, 0.82),
    iconSvgPaths: ['M 1 8 H 5', 'M 1 16 H 5', 'M 5 4 H 12 A 7 8 0 0 1 12 20 H 5 Z', 'M 19 12 H 23'],
});

export const gateOrShapePlugin: ShapePlugin = createLogicGatePlugin({
    id: 'gate-or',
    name: 'Puerta OR',
    twoInputs: true,
    hasBubble: false,
    inputLeadEndX: 0.218,
    bodySubpath: makeOrBody(0.16, 0.32, 0.48, 0.68, 0.82),
    iconSvgPaths: [
        'M 1 8 H 6.2',
        'M 1 16 H 6.2',
        'M 4.5 4.5 C 11 4.5, 16 7.5, 19.5 12 C 16 16.5, 11 19.5, 4.5 19.5 Q 8.5 12 4.5 4.5 Z',
        'M 19.5 12 H 23',
    ],
});

export const gateNotShapePlugin: ShapePlugin = createLogicGatePlugin({
    id: 'gate-not',
    name: 'Puerta NOT',
    twoInputs: false,
    hasBubble: true,
    inputLeadEndX: 0.2,
    bodySubpath: polylineSubpath([[0.2, 0.14], [0.74, 0.5], [0.2, 0.86]], {
        isClosed: true,
        isFilled: true,
        isStroked: true,
    }),
    iconSvgPaths: [
        'M 1 12 H 5.5',
        'M 5.5 4.5 L 17 12 L 5.5 19.5 Z',
        'M 20.6 12 A 1.8 1.8 0 1 0 17 12 A 1.8 1.8 0 1 0 20.6 12 Z',
        'M 20.6 12 H 23',
    ],
});

export const gateNandShapePlugin: ShapePlugin = createLogicGatePlugin({
    id: 'gate-nand',
    name: 'Puerta NAND',
    twoInputs: true,
    hasBubble: true,
    inputLeadEndX: 0.16,
    bodySubpath: makeAndBody(0.16, 0.45, 0.74),
    iconSvgPaths: [
        'M 1 8 H 4.5',
        'M 1 16 H 4.5',
        'M 4.5 4.5 H 10.5 A 6.5 7.5 0 0 1 10.5 19.5 H 4.5 Z',
        'M 20.6 12 A 1.8 1.8 0 1 0 17 12 A 1.8 1.8 0 1 0 20.6 12 Z',
        'M 20.6 12 H 23',
    ],
});

export const gateNorShapePlugin: ShapePlugin = createLogicGatePlugin({
    id: 'gate-nor',
    name: 'Puerta NOR',
    twoInputs: true,
    hasBubble: true,
    inputLeadEndX: 0.218,
    bodySubpath: makeOrBody(0.16, 0.32, 0.44, 0.62, 0.74),
    iconSvgPaths: [
        'M 1 8 H 5.8',
        'M 1 16 H 5.8',
        'M 4 4.5 C 10 4.5, 14 7.5, 17 12 C 14 16.5, 10 19.5, 4 19.5 Q 8 12 4 4.5 Z',
        'M 20.6 12 A 1.8 1.8 0 1 0 17 12 A 1.8 1.8 0 1 0 20.6 12 Z',
        'M 20.6 12 H 23',
    ],
});

export const gateXorShapePlugin: ShapePlugin = createLogicGatePlugin({
    id: 'gate-xor',
    name: 'Puerta XOR',
    twoInputs: true,
    hasBubble: false,
    inputLeadEndX: 0.178,
    extraSubpaths: [makeShieldSubpath(0.12, 0.28)],
    bodySubpath: makeOrBody(0.22, 0.38, 0.5, 0.7, 0.82),
    iconSvgPaths: [
        'M 1 8 H 4.8',
        'M 1 16 H 4.8',
        'M 3.2 4.5 Q 7 12 3.2 19.5',
        'M 6 4.5 C 11.5 4.5, 16.5 7.5, 19.5 12 C 16.5 16.5, 11.5 19.5, 6 19.5 Q 9.8 12 6 4.5 Z',
        'M 19.5 12 H 23',
    ],
});

export const gateXnorShapePlugin: ShapePlugin = createLogicGatePlugin({
    id: 'gate-xnor',
    name: 'Puerta XNOR',
    twoInputs: true,
    hasBubble: true,
    inputLeadEndX: 0.178,
    extraSubpaths: [makeShieldSubpath(0.12, 0.28)],
    bodySubpath: makeOrBody(0.22, 0.38, 0.46, 0.62, 0.74),
    iconSvgPaths: [
        'M 1 8 H 4.5',
        'M 1 16 H 4.5',
        'M 3 4.5 Q 6.6 12 3 19.5',
        'M 5.6 4.5 C 10.5 4.5, 14.5 7.5, 17 12 C 14.5 16.5, 10.5 19.5, 5.6 19.5 Q 9 12 5.6 4.5 Z',
        'M 20.6 12 A 1.8 1.8 0 1 0 17 12 A 1.8 1.8 0 1 0 20.6 12 Z',
        'M 20.6 12 H 23',
    ],
});
