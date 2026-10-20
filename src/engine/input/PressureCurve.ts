import type { PenProfileId } from '../../core/types.ts';

export interface PressureProfileConfig {
    minScale: number;
    maxScale: number;
    gamma: number; // Exponent for pressure mapping (< 1 expands light pressure)
}

const PROFILE_CONFIGS: Record<PenProfileId, PressureProfileConfig> = {
    // Bolígrafo: entrega de tinta consistente, grosor uniforme y seguro para notas rápidas
    ball: {
        minScale: 0.70,
        maxScale: 1.25,
        gamma: 0.85,
    },
    // Pluma estilográfica: trazos expresivos y caligráficos, fino en subida y grueso en bajada
    fountain: {
        minScale: 0.35,
        maxScale: 1.60,
        gamma: 0.75,
    },
    // Lápiz texturado: respuesta progresiva suave
    pencil: {
        minScale: 0.45,
        maxScale: 1.35,
        gamma: 0.80,
    },
    // Pincel caligráfico: amplio rango dinámico
    calli: {
        minScale: 0.30,
        maxScale: 2.00,
        gamma: 0.70,
    },
    // Resaltador redondo: punta rígida, ancho uniforme
    hlr: {
        minScale: 0.95,
        maxScale: 1.05,
        gamma: 1.00,
    },
    // Resaltador plano: ancho uniforme
    hlf: {
        minScale: 0.95,
        maxScale: 1.05,
        gamma: 1.00,
    },
};

/**
 * Calculates a natural, ergonomic thickness multiplier for S-Pen / stylus input.
 *
 * S-Pen hardware digitizers report raw pressure [0..1] with hardware contact around 0.05.
 * A linear curve feels stiff or unreadable; a power-eased response curve creates
 * effortless handwriting where light contact stays legible and intentional downstrokes
 * feel rich and weighted.
 *
 * @param rawPressure Normalized pressure from PointerEvent [0..1] or undefined.
 * @param profileId Active pen profile ('fountain', 'ball', 'pencil', 'hlr', etc.).
 * @param sensitivity User sensitivity factor [0..1], default 0.75.
 * @returns Stroke thickness scaling multiplier.
 */
export function calculateNaturalPressureScale(
    rawPressure: number | undefined,
    profileId: PenProfileId = 'fountain',
    sensitivity = 0.75,
): number {
    // Fallback for mouse, trackpad, or touch without hardware pressure sensors
    if (rawPressure === undefined || isNaN(rawPressure) || rawPressure <= 0) {
        return 1.0;
    }

    const config = PROFILE_CONFIGS[profileId] || PROFILE_CONFIGS.fountain;

    // Clamp input to hardware bounds
    const p = Math.max(0, Math.min(1, rawPressure));

    // Modulate gamma with user sensitivity (higher sensitivity = lighter touch needed)
    const sensFactor = Math.max(0.2, Math.min(1.5, 0.4 + sensitivity * 0.8));
    const effectiveGamma = config.gamma / sensFactor;

    // Apply power curve mapping
    const curvedT = Math.pow(p, effectiveGamma);

    // Apply smoothstep hermite easing to avoid abrupt threshold jumps
    const easedT = curvedT * curvedT * (3 - 2 * curvedT);

    // Dynamic range modulation based on sensitivity
    const minScale = config.minScale;
    const maxScale = config.maxScale;

    return minScale + easedT * (maxScale - minScale);
}

/**
 * Smooths pressure samples to filter high-frequency sensor noise from S-Pen coils.
 *
 * @param prevPressure Previous smoothed pressure sample.
 * @param currentPressure Current raw pressure reading.
 * @param alpha Weight for current sample [0..1], default 0.70.
 */
export function smoothPressure(
    prevPressure: number,
    currentPressure: number,
    alpha = 0.70,
): number {
    if (prevPressure <= 0) return currentPressure;
    if (currentPressure <= 0) return prevPressure;
    return prevPressure * (1 - alpha) + currentPressure * alpha;
}
