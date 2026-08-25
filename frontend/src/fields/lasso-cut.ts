import {
    clipPolylineOutsidePolygon,
    latLngToLocal,
    localToLatLng,
    pointInPolygon,
    segmentIntersectsPolygon,
    splitPolylineByPolygon,
    type Wgs84Origin,
} from '../domain/geometry';
import type { GeoJSONLineString, GeoJSONPolygon } from './types';

const JOIN_EPS_M = 0.02;
const MIN_LINE_M = 0.05;
const MIN_AREA_M2 = 0.05;

export type CutGeometryResult =
    | { action: 'unchanged' }
    | { action: 'delete' }
    | { action: 'replace'; geometries: Array<GeoJSONLineString | GeoJSONPolygon> };

type XY = [number, number];

function asLngLatPair(pair: unknown): XY | null {
    if (!Array.isArray(pair) || pair.length < 2) {
        return null;
    }
    const lng = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return null;
    }
    return [lng, lat];
}

function openRing(coordinates: unknown): XY[] {
    if (!Array.isArray(coordinates)) {
        return [];
    }
    const points = coordinates
        .map((pair) => asLngLatPair(pair))
        .filter((pair): pair is XY => pair !== null);
    if (points.length >= 2) {
        const first = points[0];
        const last = points[points.length - 1];
        if (first && last && first[0] === last[0] && first[1] === last[1]) {
            points.pop();
        }
    }
    return points;
}

function originFromPairs(pairs: XY[]): Wgs84Origin | null {
    const first = pairs[0];
    if (!first) {
        return null;
    }
    return { lat: first[1], lon: first[0] };
}

function toLocal(pairs: XY[], origin: Wgs84Origin): XY[] {
    return pairs.map((pair) => {
        const xy = latLngToLocal({ lng: pair[0], lat: pair[1] }, origin);
        return [xy.x, xy.y];
    });
}

function fromLocal(points: XY[], origin: Wgs84Origin): XY[] {
    return points.map((point) => {
        const geo = localToLatLng({ x: point[0], y: point[1] }, origin);
        return [geo.lng, geo.lat];
    });
}

function asClosed(points: XY[]): XY[] {
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || points.length < 2) {
        return points;
    }
    if (last && last[0] === first[0] && last[1] === first[1]) {
        return points;
    }
    return [...points, first];
}

function almostSame(a: XY | undefined, b: XY | undefined, eps = JOIN_EPS_M): boolean {
    return Boolean(a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps);
}

function polylineLength(points: XY[]): number {
    let sum = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        if (start && end) {
            sum += Math.hypot(end[0] - start[0], end[1] - start[1]);
        }
    }
    return sum;
}

function ringArea(points: XY[]): number {
    const open = openRing(points);
    let sum = 0;
    for (let index = 0; index < open.length; index += 1) {
        const current = open[index];
        const next = open[(index + 1) % open.length];
        if (!current || !next) {
            continue;
        }
        sum += current[0] * next[1] - next[0] * current[1];
    }
    return Math.abs(sum) / 2;
}

function ringContains(outer: XY[], inner: XY[]): boolean {
    const clip = openRing(outer);
    return openRing(inner).every((point) => pointInPolygon(point[0], point[1], clip));
}

function clipInside(points: XY[], polygon: XY[]): XY[][] {
    return splitPolylineByPolygon(points, polygon)
        .filter((run) => run.inside)
        .map((run) => run.points);
}

function stitchRings(pieces: XY[][]): XY[][] {
    const remaining = pieces
        .filter((piece) => piece.length >= 2)
        .map((piece) => piece.map((point) => [point[0], point[1]] as XY));
    const rings: XY[][] = [];
    while (remaining.length > 0) {
        const started = remaining.pop();
        if (!started) {
            break;
        }
        let chain = started;
        let grew = true;
        while (grew) {
            grew = false;
            for (let index = remaining.length - 1; index >= 0; index -= 1) {
                const piece = remaining[index];
                if (!piece) {
                    continue;
                }
                const chainStart = chain[0];
                const chainEnd = chain[chain.length - 1];
                const pieceStart = piece[0];
                const pieceEnd = piece[piece.length - 1];
                if (almostSame(chainEnd, pieceStart)) {
                    chain.push(...piece.slice(1));
                    remaining.splice(index, 1);
                    grew = true;
                } else if (almostSame(chainEnd, pieceEnd)) {
                    chain.push(...[...piece].reverse().slice(1));
                    remaining.splice(index, 1);
                    grew = true;
                } else if (almostSame(chainStart, pieceEnd)) {
                    chain = [...piece.slice(0, -1), ...chain];
                    remaining.splice(index, 1);
                    grew = true;
                } else if (almostSame(chainStart, pieceStart)) {
                    chain = [...[...piece].reverse().slice(0, -1), ...chain];
                    remaining.splice(index, 1);
                    grew = true;
                }
            }
        }
        if (chain.length >= 3 && almostSame(chain[0], chain[chain.length - 1], JOIN_EPS_M * 4)) {
            rings.push(asClosed(chain.slice(0, -1)));
        } else if (chain.length >= 3) {
            rings.push(asClosed(chain));
        }
    }
    return rings.filter((ring) => ringArea(ring) >= MIN_AREA_M2);
}

function lineUnchanged(original: XY[], pieces: XY[][]): boolean {
    return (
        pieces.length === 1 &&
        Boolean(pieces[0]) &&
        pieces[0]!.length === original.length &&
        pieces[0]!.every((point, index) => almostSame(point, original[index], 1e-3))
    );
}

function lassoLocal(lasso: GeoJSONPolygon): { origin: Wgs84Origin; ring: XY[] } | null {
    const lngLat = openRing(lasso.coordinates?.[0]);
    const origin = originFromPairs(lngLat);
    if (!origin || lngLat.length < 3) {
        return null;
    }
    return { origin, ring: toLocal(lngLat, origin) };
}

export function geometryIntersectsLasso(
    geometry: { type?: string; coordinates?: unknown },
    lasso: GeoJSONPolygon,
): boolean {
    const prepared = lassoLocal(lasso);
    if (!prepared) {
        return false;
    }
    if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
        const line = openRing(geometry.coordinates);
        if (line.length < 2) {
            return false;
        }
        const local = toLocal(line, prepared.origin);
        return local.some((point, index) => {
            const next = local[index + 1];
            if (pointInPolygon(point[0], point[1], prepared.ring)) {
                return true;
            }
            return Boolean(next && segmentIntersectsPolygon(point, next, prepared.ring));
        });
    }
    if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
        const subject = openRing(geometry.coordinates[0]);
        if (subject.length < 3) {
            return false;
        }
        const local = toLocal(subject, prepared.origin);
        if (local.some((point) => pointInPolygon(point[0], point[1], prepared.ring))) {
            return true;
        }
        if (prepared.ring.some((point) => pointInPolygon(point[0], point[1], local))) {
            return true;
        }
        return local.some((point, index) => {
            const next = local[(index + 1) % local.length];
            return Boolean(next && segmentIntersectsPolygon(point, next, prepared.ring));
        });
    }
    return false;
}

function cutLine(coordinates: unknown, origin: Wgs84Origin, lasso: XY[]): CutGeometryResult {
    const line = openRing(coordinates);
    if (line.length < 2) {
        return { action: 'unchanged' };
    }
    const local = toLocal(line, origin);
    const pieces = clipPolylineOutsidePolygon(local, lasso).filter(
        (piece) => piece.length >= 2 && polylineLength(piece) >= MIN_LINE_M,
    );
    if (pieces.length === 0) {
        return { action: 'delete' };
    }
    if (lineUnchanged(local, pieces)) {
        return { action: 'unchanged' };
    }
    return {
        action: 'replace',
        geometries: pieces.map((piece) => ({
            type: 'LineString' as const,
            coordinates: fromLocal(piece, origin),
        })),
    };
}

function cutPolygon(coordinates: unknown, origin: Wgs84Origin, lasso: XY[]): CutGeometryResult {
    const subjectLngLat = openRing(Array.isArray(coordinates) ? coordinates[0] : []);
    if (subjectLngLat.length < 3) {
        return { action: 'unchanged' };
    }
    const subject = toLocal(subjectLngLat, origin);
    const closedSubject = asClosed(subject);
    const closedLasso = asClosed(lasso);
    const outside = clipPolylineOutsidePolygon(closedSubject, lasso);
    const subjectInside = subject.every((point) => pointInPolygon(point[0], point[1], lasso));
    if (outside.length === 0 && subjectInside) {
        return { action: 'delete' };
    }
    const insideLasso = clipInside(closedLasso, subject);
    const rings = stitchRings([...outside, ...insideLasso]);
    if (rings.length === 0) {
        return subjectInside ? { action: 'delete' } : { action: 'unchanged' };
    }
    if (rings.length === 1 && lineUnchanged(closedSubject, rings)) {
        return { action: 'unchanged' };
    }
    const byArea = [...rings].sort((left, right) => ringArea(right) - ringArea(left));
    const outer = byArea[0];
    const holes = byArea.slice(1).filter((ring) => outer && ringContains(outer, ring));
    const leftovers = byArea.slice(1).filter((ring) => !outer || !ringContains(outer, ring));
    const polygons: GeoJSONPolygon[] = [];
    if (outer) {
        polygons.push({
            type: 'Polygon',
            coordinates: [fromLocal(asClosed(openRing(outer)), origin)].concat(
                holes.map((hole) => fromLocal(asClosed(openRing(hole)), origin)),
            ),
        });
    }
    for (const ring of leftovers) {
        polygons.push({
            type: 'Polygon',
            coordinates: [fromLocal(asClosed(openRing(ring)), origin)],
        });
    }
    return { action: 'replace', geometries: polygons };
}

/** Keep the parts of a catalogue line or bed that lie outside the lasso. */
export function cutGeometryByLasso(
    geometry: { type?: string; coordinates?: unknown },
    lasso: GeoJSONPolygon,
): CutGeometryResult {
    const prepared = lassoLocal(lasso);
    if (!prepared) {
        return { action: 'unchanged' };
    }
    if (geometry.type === 'LineString') {
        return cutLine(geometry.coordinates, prepared.origin, prepared.ring);
    }
    if (geometry.type === 'Polygon') {
        return cutPolygon(geometry.coordinates, prepared.origin, prepared.ring);
    }
    return { action: 'unchanged' };
}

export function lassoRingToLatLngs(
    lasso: GeoJSONPolygon | null,
): Array<{ lat: number; lng: number }> {
    if (!lasso) {
        return [];
    }
    return openRing(lasso.coordinates?.[0]).map((pair) => ({ lng: pair[0], lat: pair[1] }));
}
