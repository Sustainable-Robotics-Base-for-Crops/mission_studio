/**
 * Parallel offset of a closed ring, in local metres. Used to keep a geofence a
 * few centimetres inside a field boundary instead of exactly on it.
 */

import { latLngToLocal, localToLatLng, pointInPolygon, type LatLng } from './geometry';

type LocalRing = [number, number][];

/** Miter spikes explode on sharp corners; past this ratio we cut back to the plain offset. */
const MITER_LIMIT = 4;

function signedArea(ring: LocalRing): number {
    let twice = 0;
    for (let index = 0; index < ring.length; index += 1) {
        const current = ring[index];
        const next = ring[(index + 1) % ring.length];
        if (current && next) {
            twice += current[0] * next[1] - next[0] * current[1];
        }
    }
    return twice / 2;
}

function unitNormal(from: [number, number], to: [number, number]): [number, number] | null {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    return length < 1e-9 ? null : [-dy / length, dx / length];
}

/**
 * Offsets `ring` by `meters`, positive meaning inward. Returns null when the
 * result would be degenerate (ring thinner than twice the offset, collapsed
 * corners), so callers can keep the original outline rather than a broken one.
 */
export function offsetLocalRing(ring: LocalRing, meters: number): LocalRing | null {
    if (ring.length < 3 || !Number.isFinite(meters)) {
        return null;
    }
    const area = signedArea(ring);
    if (Math.abs(area) < 1e-9) {
        return null;
    }
    // Interior sits on the left of each directed edge only when the ring is CCW.
    const inward = area > 0 ? 1 : -1;
    const shift = meters * inward;

    const edges: Array<{ from: [number, number]; to: [number, number] } | null> = ring.map(
        (point, index) => {
            const next = ring[(index + 1) % ring.length];
            const normal = next ? unitNormal(point, next) : null;
            if (!next || !normal) {
                return null;
            }
            return {
                from: [point[0] + normal[0] * shift, point[1] + normal[1] * shift],
                to: [next[0] + normal[0] * shift, next[1] + normal[1] * shift],
            };
        },
    );

    const result: LocalRing = [];
    for (let index = 0; index < ring.length; index += 1) {
        const vertex = ring[index];
        const previous = edges[(index - 1 + ring.length) % ring.length];
        const current = edges[index];
        if (!vertex) {
            return null;
        }
        if (!previous || !current) {
            result.push(vertex);
            continue;
        }
        const p = previous.from;
        const r: [number, number] = [previous.to[0] - p[0], previous.to[1] - p[1]];
        const q = current.from;
        const s: [number, number] = [current.to[0] - q[0], current.to[1] - q[1]];
        const denominator = r[0] * s[1] - r[1] * s[0];
        let corner: [number, number];
        if (Math.abs(denominator) < 1e-9) {
            corner = [previous.to[0], previous.to[1]];
        } else {
            const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / denominator;
            corner = [p[0] + t * r[0], p[1] + t * r[1]];
            const reach = Math.hypot(corner[0] - vertex[0], corner[1] - vertex[1]);
            if (reach > Math.abs(meters) * MITER_LIMIT) {
                corner = [previous.to[0], previous.to[1]];
            }
        }
        result.push(corner);
    }

    const offsetArea = signedArea(result);
    if (Math.sign(offsetArea) !== Math.sign(area) || Math.abs(offsetArea) < 1e-6) {
        return null;
    }
    if (meters > 0 && result.some((point) => !pointInPolygon(point[0], point[1], ring))) {
        return null;
    }
    return result;
}

/** Same offset, expressed on WGS84 points; the ring's own first point is the local origin. */
export function offsetLatLngRing(ring: LatLng[], meters: number): LatLng[] | null {
    const first = ring[0];
    if (!first || ring.length < 3) {
        return null;
    }
    const origin = { lat: first.lat, lon: first.lng };
    const local = ring.map((point) => {
        const xy = latLngToLocal(point, origin);
        return [xy.x, xy.y] as [number, number];
    });
    const offset = offsetLocalRing(local, meters);
    return offset ? offset.map(([x, y]) => localToLatLng({ x, y }, origin)) : null;
}
