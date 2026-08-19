import type { LatLng } from '../domain/geometry';
import type { FieldsDrawKind } from './draw-target';

export function verticesFromGeometry(
    geometry:
        | {
              type?: string;
              coordinates?: unknown;
          }
        | null
        | undefined,
): LatLng[] | null {
    if (!geometry?.type || !Array.isArray(geometry.coordinates)) {
        return null;
    }
    if (geometry.type === 'Point') {
        const lng = Number(geometry.coordinates[0]);
        const lat = Number(geometry.coordinates[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return null;
        }
        return [{ lng, lat }];
    }
    if (geometry.type === 'LineString') {
        const points = pairsToLatLng(geometry.coordinates as unknown[]);
        return points.length >= 2 ? points : null;
    }
    if (geometry.type === 'Polygon') {
        const ring = geometry.coordinates[0];
        if (!Array.isArray(ring)) {
            return null;
        }
        const points = pairsToLatLng(ring as unknown[]);
        if (points.length >= 2) {
            const first = points[0];
            const last = points[points.length - 1];
            if (first && last && first.lng === last.lng && first.lat === last.lat) {
                points.pop();
            }
        }
        return points.length >= 3 ? points : null;
    }
    return null;
}

export function drawKindFromGeometry(
    geometry:
        | {
              type?: string;
          }
        | null
        | undefined,
): FieldsDrawKind | null {
    if (geometry?.type === 'Point') {
        return 'point';
    }
    if (geometry?.type === 'LineString') {
        return 'line';
    }
    if (geometry?.type === 'Polygon') {
        return 'polygon';
    }
    return null;
}

export function toolFromDrawKind(
    kind: FieldsDrawKind,
): 'draw_polygon' | 'draw_line' | 'draw_point' {
    if (kind === 'point') {
        return 'draw_point';
    }
    if (kind === 'line') {
        return 'draw_line';
    }
    return 'draw_polygon';
}

function pairsToLatLng(pairs: unknown[]): LatLng[] {
    const points: LatLng[] = [];
    for (const pair of pairs) {
        if (!Array.isArray(pair) || pair.length < 2) {
            continue;
        }
        const lng = Number(pair[0]);
        const lat = Number(pair[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            continue;
        }
        points.push({ lng, lat });
    }
    return points;
}
