/**
 * Line offsetting and swept bands.
 *
 * Kept free of any other catalogue module so both the edit tools and the map
 * rendering can derive a band from a line without importing each other.
 */
import { latLngToLocal, localToLatLng, offsetXY } from '../domain/geometry';
import type { GeoJSONLineString, GeoJSONPolygon } from './types';

export function offsetLineString(line: GeoJSONLineString, meters: number): GeoJSONLineString {
    const first = line.coordinates[0];
    if (!first || line.coordinates.length < 2) {
        return line;
    }
    const origin = { lat: Number(first[1]), lon: Number(first[0]) };
    const xy = line.coordinates.map((pair) => {
        const local = latLngToLocal({ lng: Number(pair[0]), lat: Number(pair[1]) }, origin);
        return [local.x, local.y] as [number, number];
    });
    return {
        type: 'LineString',
        coordinates: offsetXY(xy, meters).map((point) => {
            const latLng = localToLatLng({ x: point[0], y: point[1] }, origin);
            return [latLng.lng, latLng.lat];
        }),
    };
}

export function duplicateLineString(
    line: GeoJSONLineString,
    count: number,
    spacingM: number,
    side: 'left' | 'right',
): GeoJSONLineString[] {
    const copies: GeoJSONLineString[] = [line];
    const sign = side === 'left' ? 1 : -1;
    for (let index = 1; index <= Math.max(0, count); index += 1) {
        copies.push(offsetLineString(line, sign * spacingM * index));
    }
    return copies;
}

/** Band of `widthM` metres centred on the line, or null when the input is unusable. */
export function sweepPolygonFromLine(
    line: GeoJSONLineString,
    widthM: number,
): GeoJSONPolygon | null {
    if (!(widthM > 0) || line.coordinates.length < 2) {
        return null;
    }
    const left = offsetLineString(line, widthM / 2).coordinates;
    const right = offsetLineString(line, -widthM / 2)
        .coordinates.slice()
        .reverse();
    const ring = [...left, ...right];
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
        ring.push([Number(first[0]), Number(first[1])]);
    }
    if (ring.length < 4) {
        return null;
    }
    return { type: 'Polygon', coordinates: [ring] };
}
