import { METERS_PER_DEGREE } from '../domain/geometry';
import type { FieldGuidanceLine } from '../fields/types';

/** Planar heading of a guidance LineString, first vertex → last, radians. */
export function headingRadFromLineString(geometry: {
    type?: string;
    coordinates?: unknown;
}): number | null {
    if (geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates)) {
        return null;
    }
    const points = geometry.coordinates.filter(
        (item): item is number[] =>
            Array.isArray(item) &&
            item.length >= 2 &&
            Number.isFinite(Number(item[0])) &&
            Number.isFinite(Number(item[1])),
    );
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last || points.length < 2) {
        return null;
    }
    const lng0 = Number(first[0]);
    const lat0 = Number(first[1]);
    const lng1 = Number(last[0]);
    const lat1 = Number(last[1]);
    const dx = (lng1 - lng0) * METERS_PER_DEGREE * Math.cos((lat0 * Math.PI) / 180);
    const dy = (lat1 - lat0) * METERS_PER_DEGREE;
    if (!(Math.hypot(dx, dy) > 1e-9)) {
        return null;
    }
    return Math.atan2(dy, dx);
}

export function headingRadFromGuidanceLine(line: FieldGuidanceLine): number | null {
    return headingRadFromLineString(line.geometry);
}

export function usableGuidanceLines(lines: readonly FieldGuidanceLine[] | undefined): FieldGuidanceLine[] {
    return (lines ?? []).filter((line) => headingRadFromGuidanceLine(line) != null);
}
