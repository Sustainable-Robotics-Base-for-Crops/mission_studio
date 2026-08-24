import { cloneJson, type AgriDocument, type AgriSection } from './agri';
import { latLngToLocal, localToLatLng, round3, type LatLng, type Wgs84Origin } from './geometry';

export const GEOFENCE_EXCLUSIONS_KEY = 'srbc_geofence_exclusions';

export type GeofenceId = 'outer' | `exclusion:${number}`;
export type LocalRing = [number, number][];

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function originOf(document: AgriDocument): Wgs84Origin | null {
    const lat = Number(document.origin?.coordinates?.lat);
    const lon = Number(document.origin?.coordinates?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function readTableRing(value: unknown): LocalRing {
    const table = asRecord(value);
    const columns = Array.isArray(table?.columns) ? table.columns : [];
    const values = Array.isArray(table?.values) ? table.values : [];
    const xIndex = columns.indexOf('x');
    const yIndex = columns.indexOf('y');
    if (xIndex < 0 || yIndex < 0) {
        return [];
    }
    return values
        .map((row) => {
            if (!Array.isArray(row)) {
                return null;
            }
            const x = Number(row[xIndex]);
            const y = Number(row[yIndex]);
            return Number.isFinite(x) && Number.isFinite(y) ? ([x, y] as [number, number]) : null;
        })
        .filter((point): point is [number, number] => point !== null);
}

function readMetadata(document: AgriDocument): Record<string, unknown> {
    return asRecord(document.metadata) ?? {};
}

export function readGeofenceExterior(document: AgriDocument | null | undefined): LocalRing {
    return document ? readTableRing(document.geofencing) : [];
}

export function readGeofenceExclusions(document: AgriDocument | null | undefined): LocalRing[] {
    if (!document) {
        return [];
    }
    const raw = readMetadata(document)[GEOFENCE_EXCLUSIONS_KEY];
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .map((ring) => {
            if (!Array.isArray(ring)) {
                return [];
            }
            return ring
                .map((point) => {
                    if (!Array.isArray(point) || point.length < 2) {
                        return null;
                    }
                    const x = Number(point[0]);
                    const y = Number(point[1]);
                    return Number.isFinite(x) && Number.isFinite(y)
                        ? ([x, y] as [number, number])
                        : null;
                })
                .filter((point): point is [number, number] => point !== null);
        })
        .filter((ring) => ring.length >= 3);
}

export function geofenceRing(document: AgriDocument | null | undefined, id: GeofenceId): LocalRing {
    if (id === 'outer') {
        return readGeofenceExterior(document);
    }
    const index = Number(id.split(':')[1]);
    return Number.isInteger(index) ? (readGeofenceExclusions(document)[index] ?? []) : [];
}

export function localRingToLatLng(
    document: AgriDocument | null | undefined,
    ring: LocalRing,
): LatLng[] {
    if (!document) {
        return [];
    }
    const origin = originOf(document);
    return origin ? ring.map(([x, y]) => localToLatLng({ x, y }, origin)) : [];
}

export function polygonAreaM2(ring: LocalRing): number {
    if (ring.length < 3) {
        return 0;
    }
    let twiceArea = 0;
    for (let index = 0; index < ring.length; index += 1) {
        const current = ring[index];
        const next = ring[(index + 1) % ring.length];
        if (current && next) {
            twiceArea += current[0] * next[1] - next[0] * current[1];
        }
    }
    return Math.abs(twiceArea) / 2;
}

function pointInRing(point: [number, number], ring: LocalRing): boolean {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
        const a = ring[index];
        const b = ring[previous];
        if (!a || !b) {
            continue;
        }
        const crosses =
            a[1] > point[1] !== b[1] > point[1] &&
            point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
        if (crosses) {
            inside = !inside;
        }
    }
    return inside;
}

function ringInside(ring: LocalRing, exterior: LocalRing): boolean {
    return exterior.length >= 3 && ring.every((point) => pointInRing(point, exterior));
}

function distanceToSegment(
    point: [number, number],
    a: [number, number],
    b: [number, number],
): number {
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const lengthSquared = ex * ex + ey * ey;
    const t =
        lengthSquared === 0
            ? 0
            : Math.max(
                  0,
                  Math.min(1, ((point[0] - a[0]) * ex + (point[1] - a[1]) * ey) / lengthSquared),
              );
    return Math.hypot(point[0] - (a[0] + t * ex), point[1] - (a[1] + t * ey));
}

function distanceToRing(point: [number, number], ring: LocalRing): number {
    let best = Infinity;
    for (let index = 0; index < ring.length; index += 1) {
        const a = ring[index];
        const b = ring[(index + 1) % ring.length];
        if (a && b) {
            best = Math.min(best, distanceToSegment(point, a, b));
        }
    }
    return best;
}

/** Click-to-geofence threshold in local metres, aligned with row picking. */
export const PICK_GEOFENCE_MAX_M = 8;

/**
 * Picks the geofence under a click: an exclusion when the click falls inside or
 * near it, the exterior only near its outline so clicking inside the plot still
 * reaches the passes.
 */
export function pickGeofenceByProximity(
    document: AgriDocument | null | undefined,
    click: LatLng,
    maxDistanceM = PICK_GEOFENCE_MAX_M,
): GeofenceId | null {
    const origin = document ? originOf(document) : null;
    if (!document || !origin) {
        return null;
    }
    const local = latLngToLocal(click, origin);
    const point: [number, number] = [local.x, local.y];
    let best: GeofenceId | null = null;
    let bestDistance = Infinity;
    readGeofenceExclusions(document).forEach((ring, index) => {
        const distance = pointInRing(point, ring) ? 0 : distanceToRing(point, ring);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = `exclusion:${index}`;
        }
    });
    const exterior = readGeofenceExterior(document);
    if (exterior.length >= 3) {
        const distance = distanceToRing(point, exterior);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = 'outer';
        }
    }
    return bestDistance <= maxDistanceM ? best : null;
}

export function setGeofenceRing(
    document: AgriDocument,
    id: GeofenceId,
    points: LatLng[],
): AgriDocument | null {
    const origin = originOf(document);
    if (!origin || points.length < 3) {
        return null;
    }
    const ring: LocalRing = points.map((point) => {
        const local = latLngToLocal(point, origin);
        return [round3(local.x), round3(local.y)];
    });
    if (id === 'outer') {
        if (readGeofenceExclusions(document).some((exclusion) => !ringInside(exclusion, ring))) {
            return null;
        }
        return {
            ...cloneJson(document),
            geofencing: { columns: ['x', 'y'], values: ring } satisfies AgriSection,
        };
    }
    const index = Number(id.split(':')[1]);
    if (!Number.isInteger(index)) {
        return null;
    }
    const exclusions = readGeofenceExclusions(document);
    if (index < 0 || index >= exclusions.length) {
        return null;
    }
    if (!ringInside(ring, readGeofenceExterior(document))) {
        return null;
    }
    exclusions[index] = ring;
    return withExclusions(document, exclusions);
}

export function appendGeofenceExclusion(
    document: AgriDocument,
    points: LatLng[],
): AgriDocument | null {
    const origin = originOf(document);
    if (!origin || readGeofenceExterior(document).length < 3 || points.length < 3) {
        return null;
    }
    const ring: LocalRing = points.map((point) => {
        const local = latLngToLocal(point, origin);
        return [round3(local.x), round3(local.y)];
    });
    if (!ringInside(ring, readGeofenceExterior(document))) {
        return null;
    }
    return withExclusions(document, [...readGeofenceExclusions(document), ring]);
}

/** The exterior fence defines the mission and cannot be dropped; islands can. */
export function removeGeofenceExclusion(
    document: AgriDocument,
    id: GeofenceId,
): AgriDocument | null {
    if (id === 'outer') {
        return null;
    }
    const index = Number(id.split(':')[1]);
    if (!Number.isInteger(index)) {
        return null;
    }
    const exclusions = readGeofenceExclusions(document);
    if (index < 0 || index >= exclusions.length) {
        return null;
    }
    return withExclusions(
        document,
        exclusions.filter((_, current) => current !== index),
    );
}

function withExclusions(document: AgriDocument, exclusions: LocalRing[]): AgriDocument {
    const metadata = readMetadata(document);
    return {
        ...cloneJson(document),
        metadata: {
            ...metadata,
            [GEOFENCE_EXCLUSIONS_KEY]: exclusions,
        },
    };
}

export function rebaseGeofenceExclusions(
    document: AgriDocument,
    previous: Wgs84Origin,
    next: Wgs84Origin,
): AgriDocument {
    const exclusions = readGeofenceExclusions(document);
    if (exclusions.length === 0) {
        return document;
    }
    return withExclusions(
        document,
        exclusions.map((ring) =>
            ring.map(([x, y]) => {
                const geo = localToLatLng({ x, y }, previous);
                const local = latLngToLocal(geo, next);
                return [round3(local.x), round3(local.y)];
            }),
        ),
    );
}
