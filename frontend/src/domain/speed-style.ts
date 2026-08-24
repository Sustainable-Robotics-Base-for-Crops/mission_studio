/**
 * Trajectory colour by declared speed. A single speed keeps the work blue;
 * mixed speeds interpolate the farm thresholds (km/h) stored in farm.json.
 */

export const SPEED_COLOR_LOW = '#7F9C96';
export const SPEED_COLOR_MID = '#4D7C8A';
export const SPEED_COLOR_HIGH = '#1B4079';

export const DEFAULT_SPEED_LOW_KMH = 0.5;
export const DEFAULT_SPEED_MID_KMH = 1.75;
export const DEFAULT_SPEED_HIGH_KMH = 3;

export interface SpeedColorStops {
    lowKmh: number;
    midKmh: number;
    highKmh: number;
}

export const DEFAULT_SPEED_STOPS: SpeedColorStops = {
    lowKmh: DEFAULT_SPEED_LOW_KMH,
    midKmh: DEFAULT_SPEED_MID_KMH,
    highKmh: DEFAULT_SPEED_HIGH_KMH,
};

export function resolveSpeedStops(input?: Partial<SpeedColorStops> | null): SpeedColorStops {
    const lowKmh = input?.lowKmh ?? DEFAULT_SPEED_LOW_KMH;
    const midKmh = input?.midKmh ?? DEFAULT_SPEED_MID_KMH;
    const highKmh = input?.highKmh ?? DEFAULT_SPEED_HIGH_KMH;
    return { lowKmh, midKmh, highKmh };
}

export function mpsToKmh(mps: number): number {
    return mps * 3.6;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function mixHex(from: string, to: string, t: number): string {
    const parse = (hex: string) => [
        Number.parseInt(hex.slice(1, 3), 16),
        Number.parseInt(hex.slice(3, 5), 16),
        Number.parseInt(hex.slice(5, 7), 16),
    ];
    const a = parse(from);
    const b = parse(to);
    const channel = (index: number) =>
        Math.round((a[index] ?? 0) + ((b[index] ?? 0) - (a[index] ?? 0)) * clamp01(t));
    return `#${[channel(0), channel(1), channel(2)]
        .map((value) => value.toString(16).padStart(2, '0').toUpperCase())
        .join('')}`;
}

export function speedColor(mps: number, stops: SpeedColorStops = DEFAULT_SPEED_STOPS): string {
    const kmh = mpsToKmh(mps);
    if (kmh <= stops.lowKmh) {
        return SPEED_COLOR_LOW;
    }
    if (kmh >= stops.highKmh) {
        return SPEED_COLOR_HIGH;
    }
    if (kmh <= stops.midKmh) {
        const span = stops.midKmh - stops.lowKmh;
        return mixHex(
            SPEED_COLOR_LOW,
            SPEED_COLOR_MID,
            span <= 0 ? 1 : (kmh - stops.lowKmh) / span,
        );
    }
    const span = stops.highKmh - stops.midKmh;
    return mixHex(SPEED_COLOR_MID, SPEED_COLOR_HIGH, span <= 0 ? 1 : (kmh - stops.midKmh) / span);
}

/** Distinct speeds, rounded to 1 cm/s so GNSS noise does not trigger the gradient. */
export function distinctSpeedsMps(values: readonly number[], decimals = 2): number[] {
    const unique = new Set(values.map((value) => Number(value.toFixed(decimals))));
    return [...unique].sort((left, right) => left - right);
}
