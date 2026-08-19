import {
    DEFAULT_ROW_SPACING_M,
    MAX_CATALOGUE_ROWS,
    generateCatalogueRowPolylines,
} from '../domain/coverage';
import { latLngToLocal, localToLatLng, type LatLng } from '../domain/geometry';
import type { GeoJSONLineString, GeoJSONPolygon } from './types';

export const DEFAULT_BED_WIDTH_M = 1.2;
export const DEFAULT_BED_PATH_M = 0.4;
export const DEFAULT_BED_COUNT = 18;

type XY = { x: number; y: number };

function ringVertices(geometry: GeoJSONPolygon): LatLng[] {
    const ring = geometry.coordinates?.[0];
    if (!ring || ring.length < 3) {
        return [];
    }
    const points = ring.map((pair) => ({ lng: Number(pair[0]), lat: Number(pair[1]) }));
    const first = points[0];
    const last = points[points.length - 1];
    if (first && last && first.lat === last.lat && first.lng === last.lng && points.length > 3) {
        points.pop();
    }
    return points;
}

function axisEnds(geometry: GeoJSONLineString): { start: LatLng; end: LatLng } | null {
    const coords = geometry.coordinates;
    if (!coords || coords.length < 2) {
        return null;
    }
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (!first || !last) {
        return null;
    }
    return {
        start: { lng: Number(first[0]), lat: Number(first[1]) },
        end: { lng: Number(last[0]), lat: Number(last[1]) },
    };
}

/** Numbered catalogue rows from an AB axis, clipped to the field polygon. Not Agri sections. */
export function rowsFromFieldAndAxis(
    field: GeoJSONPolygon,
    axis: GeoJSONLineString,
    spacingM = DEFAULT_ROW_SPACING_M,
): GeoJSONLineString[] {
    const parcelPoints = ringVertices(field);
    const axisPoints = axisEnds(axis);
    const originPoint = parcelPoints[0];
    if (!axisPoints || !originPoint || parcelPoints.length < 3) {
        return [];
    }
    const polylines = generateCatalogueRowPolylines(
        parcelPoints,
        axisPoints.start,
        axisPoints.end,
        { lat: originPoint.lat, lon: originPoint.lng },
        spacingM,
    );
    return polylines
        .filter((points) => points.length >= 2)
        .map((points) => ({
            type: 'LineString' as const,
            coordinates: points.map((point) => [point.lng, point.lat]),
        }));
}

function clipHalfPlane(
    polygon: XY[],
    keep: (point: XY) => boolean,
    intersectAt: (from: XY, to: XY) => XY,
): XY[] {
    if (polygon.length < 3) {
        return [];
    }
    const output: XY[] = [];
    for (let index = 0; index < polygon.length; index += 1) {
        const current = polygon[index];
        const previous = polygon[(index + polygon.length - 1) % polygon.length];
        if (!current || !previous) {
            continue;
        }
        const currentIn = keep(current);
        const previousIn = keep(previous);
        if (currentIn) {
            if (!previousIn) {
                output.push(intersectAt(previous, current));
            }
            output.push(current);
        } else if (previousIn) {
            output.push(intersectAt(previous, current));
        }
    }
    return output;
}

function intersectPerp(from: XY, to: XY, bound: number, perpX: number, perpY: number): XY {
    const start = from.x * perpX + from.y * perpY;
    const end = to.x * perpX + to.y * perpY;
    const denom = end - start;
    const t = Math.abs(denom) < 1e-12 ? 0 : (bound - start) / denom;
    return { x: from.x + t * (to.x - from.x), y: from.y + t * (to.y - from.y) };
}

function clipStrip(
    parcel: XY[],
    perpX: number,
    perpY: number,
    minPerp: number,
    maxPerp: number,
): XY[] {
    const clippedMin = clipHalfPlane(
        parcel,
        (point) => point.x * perpX + point.y * perpY >= minPerp - 1e-9,
        (from, to) => intersectPerp(from, to, minPerp, perpX, perpY),
    );
    return clipHalfPlane(
        clippedMin,
        (point) => point.x * perpX + point.y * perpY <= maxPerp + 1e-9,
        (from, to) => intersectPerp(from, to, maxPerp, perpX, perpY),
    );
}

function polygonArea(points: XY[]): number {
    let sum = 0;
    for (let index = 0; index < points.length; index += 1) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        if (!current || !next) {
            continue;
        }
        sum += current.x * next.y - next.x * current.y;
    }
    return Math.abs(sum) / 2;
}

/**
 * Vegetable beds (L6b): strips of `widthM` separated by `pathM`, from the AB axis
 * toward the parcel centroid. `count` caps how many (CdCF: 18-bed template).
 */
export function bedsFromFieldAndAxis(
    field: GeoJSONPolygon,
    axis: GeoJSONLineString,
    options: { widthM: number; pathM: number; count?: number },
): GeoJSONPolygon[] {
    const width = options.widthM;
    const path = options.pathM;
    const count = options.count;
    if (!(width > 0) || path < 0) {
        return [];
    }
    const pitch = width + path;
    if (!(pitch > 0)) {
        return [];
    }
    const parcelPoints = ringVertices(field);
    const axisPoints = axisEnds(axis);
    const originPoint = parcelPoints[0];
    if (!axisPoints || !originPoint || parcelPoints.length < 3) {
        return [];
    }
    const origin = { lat: originPoint.lat, lon: originPoint.lng };
    const parcelXY = parcelPoints.map((point) => latLngToLocal(point, origin));
    const start = latLngToLocal(axisPoints.start, origin);
    const end = latLngToLocal(axisPoints.end, origin);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const axisLength = Math.sqrt(dx * dx + dy * dy);
    if (axisLength < 1e-9) {
        return [];
    }
    let perpX = -dy / axisLength;
    let perpY = dx / axisLength;
    let centroidX = 0;
    let centroidY = 0;
    for (const point of parcelXY) {
        centroidX += point.x;
        centroidY += point.y;
    }
    centroidX /= parcelXY.length;
    centroidY /= parcelXY.length;
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    if ((centroidX - midX) * perpX + (centroidY - midY) * perpY < 0) {
        perpX = -perpX;
        perpY = -perpY;
    }
    let minPerp = Infinity;
    let maxPerp = -Infinity;
    for (const point of parcelXY) {
        const dist = point.x * perpX + point.y * perpY;
        minPerp = Math.min(minPerp, dist);
        maxPerp = Math.max(maxPerp, dist);
    }
    const axisPerp = midX * perpX + midY * perpY;
    const firstCenter = count != null ? axisPerp + width / 2 : minPerp + width / 2;
    const limit = count != null && count > 0 ? count : MAX_CATALOGUE_ROWS;
    const beds: GeoJSONPolygon[] = [];
    for (let index = 0; index < MAX_CATALOGUE_ROWS && beds.length < limit; index += 1) {
        const center = firstCenter + index * pitch;
        if (center - width / 2 > maxPerp + 1e-6) {
            break;
        }
        const strip = clipStrip(parcelXY, perpX, perpY, center - width / 2, center + width / 2);
        if (strip.length < 3 || polygonArea(strip) < 0.5) {
            continue;
        }
        const ring = strip.map((point) => {
            const latLng = localToLatLng(point, origin);
            return [latLng.lng, latLng.lat];
        });
        const firstRing = ring[0];
        const lastRing = ring[ring.length - 1];
        if (
            firstRing &&
            lastRing &&
            (firstRing[0] !== lastRing[0] || firstRing[1] !== lastRing[1])
        ) {
            ring.push([Number(firstRing[0]), Number(firstRing[1])]);
        }
        beds.push({ type: 'Polygon', coordinates: [ring] });
    }
    return beds;
}
