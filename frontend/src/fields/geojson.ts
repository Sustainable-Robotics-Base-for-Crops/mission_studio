import { METERS_PER_DEGREE, getDistanceMeters } from '../domain/geometry';
import { numberedMapLabel, userMapLabel } from '../map/catalogue-labels';
import { catalogueOverlayForKind } from '../map/catalogue-style';
import { sweepPolygonFromLine } from './sweep';
import type { FieldDetail, GeoJSONLineString, GeoJSONPoint, GeoJSONPolygon } from './types';

export type LngLat = [number, number];

export type FeatureCollection = {
    type: 'FeatureCollection';
    features: Array<{
        type: 'Feature';
        id?: string;
        properties: Record<string, unknown>;
        geometry: GeoJSONPolygon | GeoJSONLineString | { type: 'Point'; coordinates: LngLat };
    }>;
};

export function ringFromDraft(points: Array<{ lat: number; lng: number }>): GeoJSONPolygon | null {
    if (points.length < 3) {
        return null;
    }
    const ring: number[][] = points.map((point) => [point.lng, point.lat]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first && last) {
        const closeLng = Number(first[0]);
        const closeLat = Number(first[1]);
        const lastLng = Number(last[0]);
        const lastLat = Number(last[1]);
        if (closeLng !== lastLng || closeLat !== lastLat) {
            ring.push([closeLng, closeLat]);
        }
    }
    return { type: 'Polygon', coordinates: [ring] };
}

export function lineFromDraft(
    points: Array<{ lat: number; lng: number }>,
): GeoJSONLineString | null {
    if (points.length < 2) {
        return null;
    }
    return {
        type: 'LineString',
        coordinates: points.map((point) => [point.lng, point.lat]),
    };
}

export function pointFromDraft(points: Array<{ lat: number; lng: number }>): GeoJSONPoint | null {
    const first = points[0];
    if (!first) {
        return null;
    }
    return { type: 'Point', coordinates: [first.lng, first.lat] };
}

export function polygonAreaM2(geometry: GeoJSONPolygon | undefined): number | null {
    const ring = geometry?.coordinates?.[0];
    if (!ring || ring.length < 4) {
        return null;
    }
    const originLat = Number(ring[0]?.[1]);
    if (!Number.isFinite(originLat)) {
        return null;
    }
    const scaleX = METERS_PER_DEGREE * Math.cos((originLat * Math.PI) / 180);
    let sum = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
        const current = ring[index];
        const next = ring[index + 1];
        if (!current || !next) {
            continue;
        }
        const x1 = Number(current[0]) * scaleX;
        const y1 = Number(current[1]) * METERS_PER_DEGREE;
        const x2 = Number(next[0]) * scaleX;
        const y2 = Number(next[1]) * METERS_PER_DEGREE;
        sum += x1 * y2 - x2 * y1;
    }
    return Math.abs(sum) / 2;
}

export function geojsonDownloadName(fieldName: string): string {
    const stem = fieldName
        .trim()
        .replace(/[/\\?%*:|"<>]+/g, '-')
        .replace(/\s+/g, '_');
    return `${stem || 'parcelle'}.geojson`;
}

export function lineLengthM(geometry: GeoJSONLineString | undefined): number | null {
    const coords = geometry?.coordinates;
    if (!coords || coords.length < 2) {
        return null;
    }
    let sum = 0;
    for (let index = 0; index < coords.length - 1; index += 1) {
        const current = coords[index];
        const next = coords[index + 1];
        if (!current || !next) {
            continue;
        }
        sum += getDistanceMeters(
            { lng: Number(current[0]), lat: Number(current[1]) },
            { lng: Number(next[0]), lat: Number(next[1]) },
        );
    }
    return Number.isFinite(sum) ? sum : null;
}

/** Ray-cast on a WGS84 ring (lng/lat). Good enough to pick a field on the map. */
export function polygonContainsLngLat(geometry: GeoJSONPolygon, lng: number, lat: number): boolean {
    const ring = geometry.coordinates?.[0];
    if (!ring || ring.length < 4) {
        return false;
    }
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const xi = Number(ring[i]?.[0]);
        const yi = Number(ring[i]?.[1]);
        const xj = Number(ring[j]?.[0]);
        const yj = Number(ring[j]?.[1]);
        const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
        if (intersect) {
            inside = !inside;
        }
    }
    return inside;
}

export function collectionBounds(
    collection: FeatureCollection,
): [[number, number], [number, number]] | null {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    const visit = (pair: number[]) => {
        const lng = Number(pair[0]);
        const lat = Number(pair[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return;
        }
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
    };
    for (const feature of collection.features) {
        const geometry = feature.geometry;
        if (geometry.type === 'Point') {
            visit(geometry.coordinates);
            continue;
        }
        if (geometry.type === 'LineString') {
            for (const pair of geometry.coordinates) {
                visit(pair);
            }
            continue;
        }
        for (const ring of geometry.coordinates) {
            for (const pair of ring) {
                visit(pair);
            }
        }
    }
    if (!Number.isFinite(minLng)) {
        return null;
    }
    return [
        [minLng, minLat],
        [maxLng, maxLat],
    ];
}

function isPolygon(geometry: { type?: string } | undefined): geometry is GeoJSONPolygon {
    return geometry?.type === 'Polygon';
}

function isLineString(
    geometry: { type?: string; coordinates?: unknown } | undefined,
): geometry is GeoJSONLineString {
    return geometry?.type === 'LineString' && Array.isArray(geometry.coordinates);
}

function isPoint(
    geometry: { type?: string; coordinates?: unknown } | undefined,
): geometry is GeoJSONPoint {
    return geometry?.type === 'Point' && Array.isArray(geometry.coordinates);
}

export type FieldChildren = Pick<FieldDetail, 'zones' | 'obstacles'> &
    Partial<
        Pick<
            FieldDetail,
            'guidance_lines' | 'row_sets' | 'traffic_ways' | 'traffic_nodes' | 'landmarks'
        >
    >;

export function emptyFieldChildren(): FieldChildren {
    return {
        zones: [],
        obstacles: [],
        guidance_lines: [],
        row_sets: [],
        traffic_ways: [],
        traffic_nodes: [],
        landmarks: [],
    };
}

export function childrenFromField(
    field: Pick<FieldDetail, 'zones' | 'obstacles'> &
        Partial<
            Pick<
                FieldDetail,
                'guidance_lines' | 'row_sets' | 'traffic_ways' | 'traffic_nodes' | 'landmarks'
            >
        >,
): FieldChildren {
    return {
        zones: field.zones ?? [],
        obstacles: field.obstacles ?? [],
        guidance_lines: field.guidance_lines ?? [],
        row_sets: field.row_sets ?? [],
        traffic_ways: field.traffic_ways ?? [],
        traffic_nodes: field.traffic_nodes ?? [],
        landmarks: field.landmarks ?? [],
    };
}

function polygonFeature(
    id: string,
    name: string,
    geometry: GeoJSONPolygon,
    kind: string,
    selected: boolean,
    label: string,
): FeatureCollection['features'][number] {
    return {
        type: 'Feature',
        id,
        properties: {
            id,
            name,
            label,
            kind,
            overlay: catalogueOverlayForKind(kind),
            selected,
        },
        geometry,
    };
}

function lineFeature(
    id: string,
    name: string,
    geometry: GeoJSONLineString,
    selected: boolean,
    kind: 'guidance_line' | 'row' | 'bed' | 'traffic_way' | 'landmark_measure',
    label: string,
): FeatureCollection['features'][number] {
    return {
        type: 'Feature',
        id,
        properties: {
            id,
            name,
            label,
            kind,
            overlay: catalogueOverlayForKind(kind),
            selected,
        },
        geometry,
    };
}

function pointFeature(
    id: string,
    name: string,
    geometry: GeoJSONPoint,
    selected: boolean,
    kind: 'traffic_node' | 'landmark_point',
    label: string,
): FeatureCollection['features'][number] {
    return {
        type: 'Feature',
        id,
        properties: {
            id,
            name,
            label,
            kind,
            overlay: catalogueOverlayForKind(kind),
            selected,
        },
        geometry: {
            type: 'Point',
            coordinates: [Number(geometry.coordinates[0]), Number(geometry.coordinates[1])],
        },
    };
}

/**
 * Bands are derived from the line and its width: they are never stored, so
 * editing the line keeps the swept area in sync. The line keeps the label.
 */
function pushBand(
    features: FeatureCollection['features'],
    ownerId: string,
    name: string,
    line: GeoJSONLineString,
    options: { widthM: number | null | undefined; kind: 'bed_band' | 'traffic_band' },
): void {
    const width = Number(options.widthM);
    if (!(width > 0)) {
        return;
    }
    const band = sweepPolygonFromLine(line, width);
    if (!band) {
        return;
    }
    features.push(polygonFeature(`${ownerId}:band`, name, band, options.kind, false, ''));
}

/**
 * Hiding an object from the tree also hides what is derived from it: a bed band
 * carries the id of its median line suffixed by `:band`.
 */
export function withoutHiddenFeatures(
    collection: FeatureCollection,
    hiddenIds: readonly string[],
): FeatureCollection {
    if (hiddenIds.length === 0) {
        return collection;
    }
    const hidden = new Set(hiddenIds);
    return {
        type: 'FeatureCollection',
        features: collection.features.filter((feature) => {
            const id = String(feature.properties.id ?? feature.id ?? '');
            return !hidden.has(id) && !hidden.has(id.replace(/:band$/, ''));
        }),
    };
}

export function boundsForFeatureId(
    collection: FeatureCollection,
    featureId: string,
): [[number, number], [number, number]] | null {
    const match = collection.features.filter(
        (feature) =>
            String(feature.id) === featureId || String(feature.properties.id) === featureId,
    );
    return collectionBounds({ type: 'FeatureCollection', features: match });
}

function appendChildren(
    features: FeatureCollection['features'],
    children: FieldChildren | undefined,
    selectedFeatureId: string | null,
    hideFeatureId: string | null,
): void {
    for (const zone of children?.zones ?? []) {
        if (hideFeatureId && zone.id === hideFeatureId) {
            continue;
        }
        if (isPolygon(zone.geometry)) {
            features.push(
                polygonFeature(
                    zone.id,
                    zone.name ?? zone.kind,
                    zone.geometry,
                    zone.kind,
                    zone.id === selectedFeatureId,
                    userMapLabel(zone.name),
                ),
            );
        }
    }
    for (const obstacle of children?.obstacles ?? []) {
        if (hideFeatureId && obstacle.id === hideFeatureId) {
            continue;
        }
        if (isPolygon(obstacle.geometry)) {
            features.push(
                polygonFeature(
                    obstacle.id,
                    obstacle.name ?? obstacle.category,
                    obstacle.geometry,
                    'obstacle',
                    obstacle.id === selectedFeatureId,
                    userMapLabel(obstacle.name),
                ),
            );
        }
    }
    for (const line of children?.guidance_lines ?? []) {
        if (hideFeatureId && line.id === hideFeatureId) {
            continue;
        }
        if (isLineString(line.geometry)) {
            features.push(
                lineFeature(
                    line.id,
                    line.name ?? 'guidance',
                    line.geometry,
                    line.id === selectedFeatureId,
                    'guidance_line',
                    userMapLabel(line.name),
                ),
            );
        }
    }
    for (const rowSet of children?.row_sets ?? []) {
        const asBed = rowSet.kind === 'beds';
        for (const row of rowSet.rows ?? []) {
            if (hideFeatureId && row.id === hideFeatureId) {
                continue;
            }
            if (isPolygon(row.geometry)) {
                features.push(
                    polygonFeature(
                        row.id,
                        row.name ?? `row ${row.number}`,
                        row.geometry,
                        asBed ? 'bed_band' : 'row',
                        row.id === selectedFeatureId,
                        numberedMapLabel(row.name, row.number),
                    ),
                );
                continue;
            }
            if (isLineString(row.geometry)) {
                if (asBed) {
                    pushBand(features, row.id, row.name ?? `row ${row.number}`, row.geometry, {
                        widthM: rowSet.width_m,
                        kind: 'bed_band',
                    });
                }
                features.push(
                    lineFeature(
                        row.id,
                        row.name ?? `row ${row.number}`,
                        row.geometry,
                        row.id === selectedFeatureId,
                        asBed ? 'bed' : 'row',
                        numberedMapLabel(row.name, row.number),
                    ),
                );
            }
        }
    }
    for (const way of children?.traffic_ways ?? []) {
        if (hideFeatureId && way.id === hideFeatureId) {
            continue;
        }
        if (isLineString(way.geometry)) {
            pushBand(features, way.id, way.name ?? 'path', way.geometry, {
                widthM: way.width_m,
                kind: 'traffic_band',
            });
            features.push(
                lineFeature(
                    way.id,
                    way.name ?? 'path',
                    way.geometry,
                    way.id === selectedFeatureId,
                    'traffic_way',
                    userMapLabel(way.name),
                ),
            );
        }
    }
    for (const node of children?.traffic_nodes ?? []) {
        if (hideFeatureId && node.id === hideFeatureId) {
            continue;
        }
        if (isPoint(node.geometry)) {
            features.push(
                pointFeature(
                    node.id,
                    node.name ?? node.kind,
                    node.geometry,
                    node.id === selectedFeatureId,
                    'traffic_node',
                    userMapLabel(node.name),
                ),
            );
        }
    }
    for (const landmark of children?.landmarks ?? []) {
        if (hideFeatureId && landmark.id === hideFeatureId) {
            continue;
        }
        const label = userMapLabel(landmark.name);
        if (isPolygon(landmark.geometry)) {
            features.push(
                polygonFeature(
                    landmark.id,
                    landmark.name ?? landmark.kind,
                    landmark.geometry,
                    landmark.kind === 'circle' ? 'landmark_circle' : 'landmark_polygon',
                    landmark.id === selectedFeatureId,
                    label,
                ),
            );
        } else if (isLineString(landmark.geometry)) {
            features.push(
                lineFeature(
                    landmark.id,
                    landmark.name ?? landmark.kind,
                    landmark.geometry,
                    landmark.id === selectedFeatureId,
                    'landmark_measure',
                    label,
                ),
            );
        } else if (isPoint(landmark.geometry)) {
            features.push(
                pointFeature(
                    landmark.id,
                    landmark.name ?? landmark.kind,
                    landmark.geometry,
                    landmark.id === selectedFeatureId,
                    'landmark_point',
                    label,
                ),
            );
        }
    }
}

export function fieldsToCollection(
    fields: Array<{ id: string; name: string; geometry: GeoJSONPolygon }>,
    selectedFeatureId: string | null,
    childrenByField: Record<string, FieldChildren> = {},
    hideFeatureId: string | null = null,
): FeatureCollection {
    const features: FeatureCollection['features'] = [];
    for (const field of fields) {
        if (!isPolygon(field.geometry)) {
            continue;
        }
        if (hideFeatureId && field.id === hideFeatureId) {
            continue;
        }
        features.push(
            polygonFeature(
                field.id,
                field.name,
                field.geometry,
                'field',
                field.id === selectedFeatureId,
                userMapLabel(field.name),
            ),
        );
    }
    const seen = new Set(fields.map((field) => field.id));
    for (const field of fields) {
        appendChildren(features, childrenByField[field.id], selectedFeatureId, hideFeatureId);
    }
    for (const [fieldId, children] of Object.entries(childrenByField)) {
        if (!seen.has(fieldId)) {
            appendChildren(features, children, selectedFeatureId, hideFeatureId);
        }
    }
    return { type: 'FeatureCollection', features };
}

export type CatalogueHit =
    | { type: 'field'; fieldId: string }
    | { type: 'zone'; fieldId: string; id: string }
    | { type: 'obstacle'; fieldId: string; id: string }
    | { type: 'guidance'; fieldId: string; id: string }
    | { type: 'row'; fieldId: string; rowSetId: string; id: string }
    | { type: 'traffic_way'; fieldId: string; id: string }
    | { type: 'traffic_node'; fieldId: string; id: string }
    | { type: 'landmark'; fieldId: string; id: string };

const HIT_RANK = { obstacle: 0, zone: 1, field: 2 } as const;
const HIT_LINE_M = 12;

function pointToSegmentDistanceM(
    lng: number,
    lat: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
): number {
    const scaleX = METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
    const px = lng * scaleX;
    const py = lat * METERS_PER_DEGREE;
    const x1 = ax * scaleX;
    const y1 = ay * METERS_PER_DEGREE;
    const x2 = bx * scaleX;
    const y2 = by * METERS_PER_DEGREE;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length2 = dx * dx + dy * dy;
    if (length2 === 0) {
        return Math.hypot(px - x1, py - y1);
    }
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / length2));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function lineDistanceM(geometry: GeoJSONLineString, lng: number, lat: number): number {
    let best = Number.POSITIVE_INFINITY;
    const coords = geometry.coordinates;
    for (let index = 0; index < coords.length - 1; index += 1) {
        const start = coords[index];
        const end = coords[index + 1];
        if (!start || !end) {
            continue;
        }
        best = Math.min(
            best,
            pointToSegmentDistanceM(
                lng,
                lat,
                Number(start[0]),
                Number(start[1]),
                Number(end[0]),
                Number(end[1]),
            ),
        );
    }
    return best;
}

/** Smallest containing polygon wins; a nearby line or traffic point beats polygons. */
export function hitCatalogue(
    fields: Array<{ id: string; geometry: GeoJSONPolygon }>,
    childrenByField: Record<string, FieldChildren>,
    lng: number,
    lat: number,
): CatalogueHit | null {
    type LineHit =
        | { type: 'guidance'; fieldId: string; id: string; dist: number }
        | { type: 'row'; fieldId: string; rowSetId: string; id: string; dist: number }
        | { type: 'traffic_way'; fieldId: string; id: string; dist: number }
        | { type: 'traffic_node'; fieldId: string; id: string; dist: number }
        | { type: 'landmark'; fieldId: string; id: string; dist: number };
    const lineHits: LineHit[] = [];
    for (const field of fields) {
        for (const line of childrenByField[field.id]?.guidance_lines ?? []) {
            if (!isLineString(line.geometry)) {
                continue;
            }
            lineHits.push({
                type: 'guidance',
                fieldId: field.id,
                id: line.id,
                dist: lineDistanceM(line.geometry, lng, lat),
            });
        }
        for (const rowSet of childrenByField[field.id]?.row_sets ?? []) {
            for (const row of rowSet.rows ?? []) {
                if (!isLineString(row.geometry)) {
                    continue;
                }
                lineHits.push({
                    type: 'row',
                    fieldId: field.id,
                    rowSetId: row.row_set_id || rowSet.id,
                    id: row.id,
                    dist: lineDistanceM(row.geometry, lng, lat),
                });
            }
        }
        for (const way of childrenByField[field.id]?.traffic_ways ?? []) {
            if (!isLineString(way.geometry)) {
                continue;
            }
            lineHits.push({
                type: 'traffic_way',
                fieldId: field.id,
                id: way.id,
                dist: lineDistanceM(way.geometry, lng, lat),
            });
        }
        for (const landmark of childrenByField[field.id]?.landmarks ?? []) {
            if (isLineString(landmark.geometry)) {
                lineHits.push({
                    type: 'landmark',
                    fieldId: field.id,
                    id: landmark.id,
                    dist: lineDistanceM(landmark.geometry, lng, lat),
                });
            } else if (isPoint(landmark.geometry)) {
                lineHits.push({
                    type: 'landmark',
                    fieldId: field.id,
                    id: landmark.id,
                    dist: getDistanceMeters(
                        { lng, lat },
                        {
                            lng: Number(landmark.geometry.coordinates[0]),
                            lat: Number(landmark.geometry.coordinates[1]),
                        },
                    ),
                });
            }
        }
        for (const node of childrenByField[field.id]?.traffic_nodes ?? []) {
            if (!isPoint(node.geometry)) {
                continue;
            }
            lineHits.push({
                type: 'traffic_node',
                fieldId: field.id,
                id: node.id,
                dist: getDistanceMeters(
                    { lng, lat },
                    {
                        lng: Number(node.geometry.coordinates[0]),
                        lat: Number(node.geometry.coordinates[1]),
                    },
                ),
            });
        }
    }
    const bestLine = lineHits
        .filter((item) => item.dist <= HIT_LINE_M)
        .sort((left, right) => left.dist - right.dist)[0];
    if (bestLine) {
        if (bestLine.type === 'row') {
            return {
                type: 'row',
                fieldId: bestLine.fieldId,
                rowSetId: bestLine.rowSetId,
                id: bestLine.id,
            };
        }
        return { type: bestLine.type, fieldId: bestLine.fieldId, id: bestLine.id };
    }
    const candidates: Array<
        Extract<CatalogueHit, { type: 'field' | 'zone' | 'obstacle' | 'row' | 'landmark' }> & {
            area: number;
            rank: number;
        }
    > = [];
    for (const field of fields) {
        const children = childrenByField[field.id];
        for (const obstacle of children?.obstacles ?? []) {
            if (
                isPolygon(obstacle.geometry) &&
                polygonContainsLngLat(obstacle.geometry, lng, lat)
            ) {
                candidates.push({
                    type: 'obstacle',
                    fieldId: field.id,
                    id: obstacle.id,
                    area: polygonAreaM2(obstacle.geometry) ?? Number.POSITIVE_INFINITY,
                    rank: HIT_RANK.obstacle,
                });
            }
        }
        for (const landmark of children?.landmarks ?? []) {
            if (
                isPolygon(landmark.geometry) &&
                polygonContainsLngLat(landmark.geometry, lng, lat)
            ) {
                candidates.push({
                    type: 'landmark',
                    fieldId: field.id,
                    id: landmark.id,
                    area: polygonAreaM2(landmark.geometry) ?? Number.POSITIVE_INFINITY,
                    rank: HIT_RANK.obstacle,
                });
            }
        }
        for (const zone of children?.zones ?? []) {
            if (isPolygon(zone.geometry) && polygonContainsLngLat(zone.geometry, lng, lat)) {
                candidates.push({
                    type: 'zone',
                    fieldId: field.id,
                    id: zone.id,
                    area: polygonAreaM2(zone.geometry) ?? Number.POSITIVE_INFINITY,
                    rank: HIT_RANK.zone,
                });
            }
        }
        for (const rowSet of children?.row_sets ?? []) {
            for (const row of rowSet.rows ?? []) {
                if (isPolygon(row.geometry) && polygonContainsLngLat(row.geometry, lng, lat)) {
                    candidates.push({
                        type: 'row',
                        fieldId: field.id,
                        rowSetId: row.row_set_id || rowSet.id,
                        id: row.id,
                        area: polygonAreaM2(row.geometry) ?? Number.POSITIVE_INFINITY,
                        rank: HIT_RANK.obstacle,
                    });
                }
            }
        }
        if (isPolygon(field.geometry) && polygonContainsLngLat(field.geometry, lng, lat)) {
            candidates.push({
                type: 'field',
                fieldId: field.id,
                area: polygonAreaM2(field.geometry) ?? Number.POSITIVE_INFINITY,
                rank: HIT_RANK.field,
            });
        }
    }
    const best = candidates.sort(
        (left, right) => left.area - right.area || left.rank - right.rank,
    )[0];
    if (!best) {
        return null;
    }
    if (best.type === 'field') {
        return { type: 'field', fieldId: best.fieldId };
    }
    if (best.type === 'row') {
        return {
            type: 'row',
            fieldId: best.fieldId,
            rowSetId: best.rowSetId,
            id: best.id,
        };
    }
    return { type: best.type, fieldId: best.fieldId, id: best.id };
}
