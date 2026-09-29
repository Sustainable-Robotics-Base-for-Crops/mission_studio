import { getDistanceMeters, type LatLng } from '../domain/geometry';

/** At 0% the line keeps its shape, with at most one vertex every 10 cm. */
export const SMOOTH_SPACING_M = 0.1;

/**
 * At 100% Douglas-Peucker drops lateral jitter up to this tolerance.
 * A detour wider than 50 cm stays a vertex.
 */
export const SMOOTH_EPSILON_MAX_M = 0.5;

/** 40 % of the maximum: 20 cm. Steering chatter goes, a real bend stays. */
export const SMOOTH_RECOMMENDED_PERCENT = 40;

/** Lateral tolerance in metres for a 0–100 smoothing factor. 0 keeps every resampled vertex. */
export function smoothToleranceM(factor: number): number {
    const clamped = Math.min(100, Math.max(0, factor));
    return (clamped / 100) * SMOOTH_EPSILON_MAX_M;
}

type LngLat = [number, number];

function asLatLng(point: LngLat): LatLng {
    return { lng: point[0], lat: point[1] };
}

function distance(start: LngLat, end: LngLat): number {
    return getDistanceMeters(asLatLng(start), asLatLng(end));
}

function lerp(start: LngLat, end: LngLat, t: number): LngLat {
    return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
}

/** Walk the line and keep a vertex about every `spacing` metres, including both ends. */
export function resampleLine(coordinates: LngLat[], spacing = SMOOTH_SPACING_M): LngLat[] {
    if (coordinates.length < 2 || spacing <= 0) {
        return coordinates;
    }
    const origin = coordinates[0];
    if (!origin) {
        return coordinates;
    }
    const result: LngLat[] = [origin];
    let cursor = origin;
    let accumulated = 0;
    for (let index = 1; index < coordinates.length; index += 1) {
        const vertex = coordinates[index];
        if (!vertex) {
            continue;
        }
        let target = vertex;
        let segment = distance(cursor, target);
        if (segment === 0) {
            continue;
        }
        while (accumulated + segment >= spacing) {
            const remain = spacing - accumulated;
            const t = remain / segment;
            const next = lerp(cursor, target, t);
            result.push(next);
            cursor = next;
            target = vertex;
            segment = distance(cursor, target);
            accumulated = 0;
            if (segment === 0) {
                break;
            }
        }
        accumulated += segment;
        cursor = vertex;
    }
    const end = coordinates[coordinates.length - 1];
    const last = result[result.length - 1];
    if (end && last && distance(last, end) > spacing * 0.25) {
        result.push(end);
    }
    return result;
}

function toLocal(point: LngLat, origin: LngLat): { x: number; y: number } {
    const latMid = ((point[1] + origin[1]) / 2) * (Math.PI / 180);
    return {
        x: (point[0] - origin[0]) * 111320 * Math.cos(latMid),
        y: (point[1] - origin[1]) * 111320,
    };
}

function perpendicularDistance(point: LngLat, start: LngLat, end: LngLat): number {
    const origin = start;
    const a = toLocal(start, origin);
    const b = toLocal(end, origin);
    const p = toLocal(point, origin);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
        return Math.hypot(p.x - a.x, p.y - a.y);
    }
    return Math.abs(dy * p.x - dx * p.y) / length;
}

/** Douglas-Peucker. `epsilon` is a lateral tolerance in metres. */
export function douglasPeucker(coordinates: LngLat[], epsilon: number): LngLat[] {
    if (coordinates.length < 3 || epsilon <= 0) {
        return coordinates;
    }
    const keep = new Array<boolean>(coordinates.length).fill(false);
    keep[0] = true;
    keep[coordinates.length - 1] = true;
    const stack: Array<[number, number]> = [[0, coordinates.length - 1]];
    while (stack.length > 0) {
        const range = stack.pop();
        if (!range) {
            break;
        }
        const [start, end] = range;
        let farthest = start;
        let farthestDistance = 0;
        for (let index = start + 1; index < end; index += 1) {
            const current = coordinates[index];
            const startPoint = coordinates[start];
            const endPoint = coordinates[end];
            if (!current || !startPoint || !endPoint) {
                continue;
            }
            const span = perpendicularDistance(current, startPoint, endPoint);
            if (span > farthestDistance) {
                farthestDistance = span;
                farthest = index;
            }
        }
        if (farthestDistance > epsilon && farthest !== start) {
            keep[farthest] = true;
            stack.push([start, farthest], [farthest, end]);
        }
    }
    return coordinates.filter((_point, index) => keep[index]);
}

function isClosed(coordinates: LngLat[]): boolean {
    if (coordinates.length < 4) {
        return false;
    }
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    return Boolean(first && last && distance(first, last) < 0.05);
}

/**
 * `factor` is 0–100.
 * 0 keeps the shape at 10 cm spacing. 100 straightens jitter inside 50 cm.
 */
export function smoothLine(coordinates: LngLat[], factor: number): LngLat[] {
    if (coordinates.length < 2) {
        return coordinates;
    }
    const closed = isClosed(coordinates);
    const open = closed ? coordinates.slice(0, -1) : coordinates;
    if (open.length < 2) {
        return coordinates;
    }
    const resampled = resampleLine(open, SMOOTH_SPACING_M);
    const epsilon = smoothToleranceM(factor);
    const simplified = epsilon <= 0 ? resampled : douglasPeucker(resampled, epsilon);
    if (simplified.length < 2) {
        return coordinates;
    }
    if (closed && simplified.length >= 3) {
        const first = simplified[0];
        return first ? [...simplified, first] : simplified;
    }
    return simplified;
}
