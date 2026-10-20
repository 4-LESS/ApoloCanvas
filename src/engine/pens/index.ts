/**
 * src/engine/pens/index.ts
 *
 * Registro central y punto de entrada único para las herramientas de dibujo de ApoloCanvas.
 * Para añadir una nueva herramienta en el futuro, basta con crear su módulo `.ts` e
 * incluirlo en `PEN_REGISTRY`.
 */

import type { PenProfileId } from '../../core/types.ts';
import type { PenToolPlugin } from './types.ts';
import { ballPenPlugin } from './ball.ts';
import { fountainPenPlugin } from './fountain.ts';
import { calliPenPlugin } from './calli.ts';
import { pencilPenPlugin } from './pencil.ts';

export * from './types.ts';
export * from './common.ts';
export {
    ballPenPlugin,
    fountainPenPlugin,
    calliPenPlugin,
    pencilPenPlugin,
};

export const PEN_REGISTRY: Record<string, PenToolPlugin> = {
    ball: ballPenPlugin,
    fountain: fountainPenPlugin,
    calli: calliPenPlugin,
    pencil: pencilPenPlugin,
};

/**
 * Obtiene el plugin de herramienta para el `profileId` indicado (con fallback a `fountain`).
 */
export function getPenPlugin(profileId?: PenProfileId | string): PenToolPlugin {
    if (profileId && profileId in PEN_REGISTRY) {
        return PEN_REGISTRY[profileId];
    }
    return fountainPenPlugin;
}
