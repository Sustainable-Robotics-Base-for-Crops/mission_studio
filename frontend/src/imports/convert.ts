import { createEmptyDocument, roundOriginLatLon, setDrawnGeofence } from '../domain/draft';
import type { AgriDocument } from '../domain/agri';
import { generateRowLineFromLatLngs, generateRowPathFromLatLngs } from '../domain/section';
import type { LatLng } from '../domain/geometry';
import { getDistanceMeters } from '../domain/geometry';
import { withMissionName } from '../missions/brief';
import type { ImportedCollection, ImportedFeature } from '../map/imported-layers';
import type { GeoJSONLineString, GeoJSONPoint, GeoJSONPolygon } from '../fields/types';
import { smoothLine } from './smooth';
import { ImportRefused } from './types';

export type ImportIntent = 'overlay' | 'mission' | 'field-create' | 'field-edit';

export type LineTarget = 'rows' | 'beds' | 'guidance';

/** Kinds the operator can send to a mission or a parcel. Coverage cells stay on the overlay. */
export const CONVERTIBLE_KINDS = [
    'boundary',
    'row',
    'guidance_line',
    'track',
    'obstacle',
    'landmark',
] as const;

const LINE_KINDS = new Set(['row', 'guidance_line', 'track']);

export interface ConvertRequest {
    intent: Exclude<ImportIntent, 'overlay'>;
    name: string;
    /** 0 follows the shape. 100 straightens jitter up to 1 m. */
    smooth: number;
    kinds: string[];
    /** Required when the file holds more than one parcel. */
    groupId: string | null;
    lineTarget: LineTarget;
    /** Explicit outline built from the selected lines, when the file has no ring. */
    useEnvelope: boolean;
    adapter: string;
    formatId: string | null;
    filename: string;
}

export interface FieldImportPlan {
    name: string;
    /** Set when creating a parcel. Absent when only adding to the parcel being edited. */
    geometry: GeoJSONPolygon | null;
    rows: Array<{ geometry: GeoJSONLineString; name: string | null }>;
    rowKind: 'rows' | 'beds';
    spacingM: number;
    guidance: Array<{ geometry: GeoJSONLineString; name: string | null }>;
    obstacles: Array<{ geometry: GeoJSONPolygon; name: string | null }>;
    landmarks: Array<{
        kind: 'point' | 'polygon' | 'measure';
        geometry: GeoJSONPoint | GeoJSONPolygon | GeoJSONLineString;
        name: string | null;
    }>;
    zones: Array<{ geometry: GeoJSONPolygon; name: string | null }>;
    provenance: Record<string, unknown>;
}

type LngLat = [number, number];

function markerOf(feature: ImportedFeature): Record<string, unknown> {
    const properties = feature.properties;
    const marker = properties?.srbc_import;
    return marker !== null && typeof marker === 'object' ? (marker as Record<string, unknown>) : {};
}

function kindOf(feature: ImportedFeature): string {
    const kind = markerOf(feature).kind;
    return typeof kind === 'string' ? kind : 'landmark';
}

function labelOf(feature: ImportedFeature, fallback: string): string | null {
    const label = markerOf(feature).label;
    return typeof label === 'string' && label.trim() ? label.trim() : fallback;
}

function groupIdOf(feature: ImportedFeature): string | null {
    const groupId = markerOf(feature).group_id;
    return typeof groupId === 'string' && groupId ? groupId : null;
}

export function featuresInScope(
    collection: ImportedCollection,
    groupId: string | null,
    kinds: readonly string[] | null,
): ImportedFeature[] {
    return collection.features.filter((feature) => {
        if (groupId && groupIdOf(feature) !== groupId) {
            return false;
        }
        if (kinds && !kinds.includes(kindOf(feature))) {
            return false;
        }
        return true;
    });
}

function pair(value: unknown): LngLat | null {
    if (!Array.isArray(value) || value.length < 2) {
        return null;
    }
    const lon = Number(value[0]);
    const lat = Number(value[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return null;
    }
    return [lon, lat];
}

function lineParts(geometry: ImportedFeature['geometry']): LngLat[][] {
    if (!geometry) {
        return [];
    }
    const coordinates = geometry.coordinates;
    if (geometry.type === 'LineString' && Array.isArray(coordinates)) {
        const line = coordinates.map(pair).filter((point): point is LngLat => point !== null);
        return line.length >= 2 ? [line] : [];
    }
    if (geometry.type === 'MultiLineString' && Array.isArray(coordinates)) {
        return coordinates.flatMap((part) => {
            if (!Array.isArray(part)) {
                return [];
            }
            const line = part.map(pair).filter((point): point is LngLat => point !== null);
            return line.length >= 2 ? [line] : [];
        });
    }
    return [];
}

function ringsOf(geometry: ImportedFeature['geometry']): LngLat[][] {
    if (!geometry || !Array.isArray(geometry.coordinates)) {
        return [];
    }
    const polygons =
        geometry.type === 'Polygon'
            ? [geometry.coordinates]
            : geometry.type === 'MultiPolygon'
              ? geometry.coordinates
              : [];
    const rings: LngLat[][] = [];
    for (const polygon of polygons) {
        if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) {
            continue;
        }
        const ring = (polygon[0] as unknown[])
            .map(pair)
            .filter((point): point is LngLat => point !== null);
        if (ring.length >= 4) {
            rings.push(ring);
        }
    }
    return rings;
}

function closeRing(ring: LngLat[]): LngLat[] {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!first || !last) {
        return ring;
    }
    if (first[0] === last[0] && first[1] === last[1]) {
        return ring;
    }
    return [...ring, first];
}

function asLine(coordinates: LngLat[]): GeoJSONLineString {
    return { type: 'LineString', coordinates };
}

function asPolygon(ring: LngLat[]): GeoJSONPolygon {
    return { type: 'Polygon', coordinates: [closeRing(ring)] };
}

function toLatLng(point: LngLat): LatLng {
    return { lng: point[0], lat: point[1] };
}

function provenanceOf(request: ConvertRequest): Record<string, unknown> {
    return {
        source: 'import',
        method: request.formatId || request.adapter,
        file: request.filename,
        smooth_percent: request.smooth,
    };
}

function smoothedLines(features: ImportedFeature[], smooth: number): LngLat[][] {
    return features.flatMap((feature) =>
        lineParts(feature.geometry).map((line) => smoothLine(line, smooth)),
    );
}

function ringArea(ring: LngLat[]): number {
    if (ring.length < 4) {
        return 0;
    }
    const origin = ring[0];
    if (!origin) {
        return 0;
    }
    let area = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
        const current = ring[index];
        const next = ring[index + 1];
        if (!current || !next) {
            continue;
        }
        const latMid = ((current[1] + origin[1]) / 2) * (Math.PI / 180);
        const x1 = (current[0] - origin[0]) * 111320 * Math.cos(latMid);
        const y1 = (current[1] - origin[1]) * 111320;
        const latMid2 = ((next[1] + origin[1]) / 2) * (Math.PI / 180);
        const x2 = (next[0] - origin[0]) * 111320 * Math.cos(latMid2);
        const y2 = (next[1] - origin[1]) * 111320;
        area += x1 * y2 - x2 * y1;
    }
    return Math.abs(area) / 2;
}

/** Monotone chain in local metres. Enough for one field, not for a continent. */
function convexHull(points: LngLat[]): LngLat[] {
    const unique = new Map<string, LngLat>();
    for (const point of points) {
        unique.set(`${point[0].toFixed(7)},${point[1].toFixed(7)}`, point);
    }
    const origin = points[0];
    if (!origin || unique.size < 3) {
        return [];
    }
    const local = [...unique.values()]
        .map((point) => {
            const latMid = ((point[1] + origin[1]) / 2) * (Math.PI / 180);
            return {
                point,
                x: (point[0] - origin[0]) * 111320 * Math.cos(latMid),
                y: (point[1] - origin[1]) * 111320,
            };
        })
        .sort((left, right) => left.x - right.x || left.y - right.y);
    const cross = (
        a: (typeof local)[number],
        b: (typeof local)[number],
        c: (typeof local)[number],
    ) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const lower: typeof local = [];
    for (const point of local) {
        while (lower.length >= 2) {
            const before = lower[lower.length - 2];
            const previous = lower[lower.length - 1];
            if (!before || !previous || cross(before, previous, point) > 0) {
                break;
            }
            lower.pop();
        }
        lower.push(point);
    }
    const upper: typeof local = [];
    for (let index = local.length - 1; index >= 0; index -= 1) {
        const point = local[index];
        if (!point) {
            continue;
        }
        while (upper.length >= 2) {
            const before = upper[upper.length - 2];
            const previous = upper[upper.length - 1];
            if (!before || !previous || cross(before, previous, point) > 0) {
                break;
            }
            upper.pop();
        }
        upper.push(point);
    }
    upper.pop();
    lower.pop();
    const hull = [...lower, ...upper].map((item) => item.point);
    return hull.length >= 3 ? closeRing(hull) : [];
}

function spacingOf(lines: LngLat[][]): number {
    if (lines.length < 2) {
        return 2;
    }
    const gaps: number[] = [];
    const mids = lines
        .map((line) => line[Math.floor(line.length / 2)])
        .filter((point): point is LngLat => Boolean(point));
    for (let index = 0; index < mids.length; index += 1) {
        let best = Number.POSITIVE_INFINITY;
        for (let other = 0; other < mids.length; other += 1) {
            if (other === index) {
                continue;
            }
            const here = mids[index];
            const there = mids[other];
            if (!here || !there) {
                continue;
            }
            best = Math.min(best, getDistanceMeters(toLatLng(here), toLatLng(there)));
        }
        if (Number.isFinite(best)) {
            gaps.push(best);
        }
    }
    gaps.sort((left, right) => left - right);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (median === undefined || median < 0.4 || median > 15) {
        return 2;
    }
    return Math.round(median * 100) / 100;
}

export function missionFromImport(
    collection: ImportedCollection,
    request: ConvertRequest,
): AgriDocument {
    const selected = featuresInScope(collection, request.groupId, request.kinds);
    const lines = smoothedLines(
        selected.filter((feature) => LINE_KINDS.has(kindOf(feature))),
        request.smooth,
    ).filter((line) => line.length >= 2);
    const rings = selected
        .filter((feature) => kindOf(feature) === 'boundary')
        .flatMap((feature) => ringsOf(feature.geometry))
        .map((ring) => smoothLine(ring, request.smooth))
        .filter((ring) => ring.length >= 4);
    const first = lines[0]?.[0] ?? rings[0]?.[0];
    if (!first) {
        throw new ImportRefused('imports.convert.needFamily');
    }
    const origin = roundOriginLatLon(first[1], first[0]);
    let document = createEmptyDocument();
    document = {
        ...document,
        origin: {
            type: 'WGS84',
            coordinates: { lat: origin.lat, lon: origin.lon, alt: 0 },
        },
        metadata: {
            srbc_import: provenanceOf(request),
        },
    };
    for (const line of lines) {
        const latLngs = line.map(toLatLng);
        const section =
            latLngs.length <= 2
                ? generateRowLineFromLatLngs(latLngs, origin)
                : generateRowPathFromLatLngs(latLngs, origin);
        if (section) {
            document = { ...document, points: [...document.points, section] };
        }
    }
    const ring = rings.sort((left, right) => ringArea(right) - ringArea(left))[0];
    if (ring) {
        const fenced = setDrawnGeofence(document, ring.slice(0, -1).map(toLatLng));
        if (fenced.ok) {
            document = fenced.document;
        }
    }
    if (document.points.length === 0 && !document.geofencing) {
        throw new ImportRefused('imports.convert.needFamily');
    }
    return withMissionName(document, request.name.trim());
}

export function fieldPlanFromImport(
    collection: ImportedCollection,
    request: ConvertRequest,
): FieldImportPlan {
    const selected = featuresInScope(collection, request.groupId, request.kinds);
    const lineFeatures = selected.filter((feature) => LINE_KINDS.has(kindOf(feature)));
    const lines = smoothedLines(lineFeatures, request.smooth).filter((line) => line.length >= 2);
    const boundaryRings = selected
        .filter((feature) => kindOf(feature) === 'boundary')
        .flatMap((feature) =>
            ringsOf(feature.geometry).map((ring) => ({
                ring: smoothLine(ring, request.smooth),
                name: labelOf(feature, request.name),
            })),
        )
        .filter((item) => item.ring.length >= 4)
        .sort((left, right) => ringArea(right.ring) - ringArea(left.ring));
    let geometry: GeoJSONPolygon | null = null;
    const zones: FieldImportPlan['zones'] = [];
    if (request.intent === 'field-create') {
        if (boundaryRings[0]) {
            geometry = asPolygon(boundaryRings[0].ring);
            for (const extra of boundaryRings.slice(1)) {
                zones.push({ geometry: asPolygon(extra.ring), name: extra.name });
            }
        } else if (request.useEnvelope) {
            const hull = convexHull(lines.flat());
            if (hull.length >= 4) {
                geometry = asPolygon(hull);
            }
        }
        if (!geometry) {
            throw new ImportRefused('imports.convert.needContour');
        }
    } else {
        for (const item of boundaryRings) {
            zones.push({ geometry: asPolygon(item.ring), name: item.name });
        }
    }
    const namedLines = lineFeatures.flatMap((feature) =>
        lineParts(feature.geometry).map((line) => ({
            geometry: asLine(smoothLine(line, request.smooth)),
            name: labelOf(feature, ''),
        })),
    );
    const asRows = request.lineTarget !== 'guidance';
    const obstacles = selected
        .filter((feature) => kindOf(feature) === 'obstacle')
        .flatMap((feature) =>
            ringsOf(feature.geometry).map((ring) => ({
                geometry: asPolygon(smoothLine(ring, request.smooth)),
                name: labelOf(feature, ''),
            })),
        );
    const landmarks: FieldImportPlan['landmarks'] = [];
    for (const feature of selected.filter((item) => kindOf(item) === 'landmark')) {
        const name = labelOf(feature, '');
        const geometry = feature.geometry;
        if (!geometry) {
            continue;
        }
        if (geometry.type === 'Point') {
            const point = pair(geometry.coordinates);
            if (point) {
                landmarks.push({
                    kind: 'point',
                    geometry: { type: 'Point', coordinates: point },
                    name,
                });
            }
        } else if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
            for (const ring of ringsOf(geometry)) {
                landmarks.push({ kind: 'polygon', geometry: asPolygon(ring), name });
            }
        } else {
            for (const line of lineParts(geometry)) {
                landmarks.push({
                    kind: 'measure',
                    geometry: asLine(smoothLine(line, request.smooth)),
                    name,
                });
            }
        }
    }
    const plan: FieldImportPlan = {
        name: request.name.trim(),
        geometry,
        rows: asRows ? namedLines : [],
        rowKind: request.lineTarget === 'beds' ? 'beds' : 'rows',
        spacingM: spacingOf(lines),
        guidance: asRows ? [] : namedLines,
        obstacles,
        landmarks,
        zones,
        provenance: provenanceOf(request),
    };
    const hasObject =
        plan.rows.length > 0 ||
        plan.guidance.length > 0 ||
        plan.obstacles.length > 0 ||
        plan.landmarks.length > 0 ||
        plan.zones.length > 0 ||
        plan.geometry !== null;
    if (!hasObject) {
        throw new ImportRefused('imports.convert.needFamily');
    }
    return plan;
}

/** Preview geometry: selected parcel, and smoothing once the operator converts. */
export function collectionForPreview(
    collection: ImportedCollection,
    options: { groupId: string | null; smooth: number; kinds: readonly string[] | null },
): ImportedCollection {
    const features = featuresInScope(collection, options.groupId, null).map((feature) => {
        const kind = kindOf(feature);
        const apply =
            options.smooth > 0 && (options.kinds === null || options.kinds.includes(kind));
        if (!apply || !feature.geometry) {
            return feature;
        }
        if (feature.geometry.type === 'LineString' && Array.isArray(feature.geometry.coordinates)) {
            const line = (feature.geometry.coordinates as unknown[])
                .map(pair)
                .filter((point): point is LngLat => point !== null);
            return {
                ...feature,
                geometry: { type: 'LineString', coordinates: smoothLine(line, options.smooth) },
            };
        }
        if (feature.geometry.type === 'Polygon') {
            const rings = ringsOf(feature.geometry).map((ring) => smoothLine(ring, options.smooth));
            return {
                ...feature,
                geometry: { type: 'Polygon', coordinates: rings.map(closeRing) },
            };
        }
        return feature;
    });
    return { type: 'FeatureCollection', features };
}
