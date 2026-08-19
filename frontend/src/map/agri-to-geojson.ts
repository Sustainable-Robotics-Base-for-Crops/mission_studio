import { localToLngLat, type Wgs84Origin } from '../domain/geometry';
import { readWorkingZoneRings } from '../domain/working-zone';
import type { AgriDocument } from '../domain/agri';

export type { Wgs84Origin };
export { localToLngLat };

export type LineKind = 'work' | 'transit' | 'turn';

export interface LineFeatureCollection {
    type: 'FeatureCollection';
    features: Array<{
        type: 'Feature';
        properties: Record<string, string | number | boolean>;
        geometry: { type: 'LineString'; coordinates: [number, number][] };
    }>;
}

export interface PolygonFeatureCollection {
    type: 'FeatureCollection';
    features: Array<{
        type: 'Feature';
        properties: Record<string, string | number | boolean>;
        geometry: { type: 'Polygon'; coordinates: [number, number][][] };
    }>;
}

export interface MissionGeoJSON {
    work: LineFeatureCollection;
    transit: LineFeatureCollection;
    turn: LineFeatureCollection;
    selected: LineFeatureCollection;
    geofence: PolygonFeatureCollection;
    workable: PolygonFeatureCollection;
    traversable: PolygonFeatureCollection;
    bounds: [[number, number], [number, number]] | null;
}

const EMPTY_LINES: LineFeatureCollection = { type: 'FeatureCollection', features: [] };
const EMPTY_POLYGONS: PolygonFeatureCollection = { type: 'FeatureCollection', features: [] };

const TURN_TYPES = new Set(['turn_path', 'turn_square']);

function emptyMission(): MissionGeoJSON {
    return {
        work: { type: 'FeatureCollection', features: [] },
        transit: { type: 'FeatureCollection', features: [] },
        turn: { type: 'FeatureCollection', features: [] },
        selected: { type: 'FeatureCollection', features: [] },
        geofence: { type: 'FeatureCollection', features: [] },
        workable: { type: 'FeatureCollection', features: [] },
        traversable: { type: 'FeatureCollection', features: [] },
        bounds: null,
    };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readOrigin(doc: Record<string, unknown>): Wgs84Origin | null {
    const origin = asRecord(doc.origin);
    const coordinates = asRecord(origin?.coordinates);
    const lat = Number(coordinates?.lat);
    const lon = Number(coordinates?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
    }
    return { lat, lon };
}

function columnIndex(columns: unknown, name: string): number {
    return Array.isArray(columns) ? columns.indexOf(name) : -1;
}

function extendBounds(
    bounds: [[number, number], [number, number]] | null,
    lng: number,
    lat: number,
): [[number, number], [number, number]] {
    if (!bounds) {
        return [
            [lng, lat],
            [lng, lat],
        ];
    }
    return [
        [Math.min(bounds[0][0], lng), Math.min(bounds[0][1], lat)],
        [Math.max(bounds[1][0], lng), Math.max(bounds[1][1], lat)],
    ];
}

function lineFeature(
    coordinates: [number, number][],
    properties: Record<string, string | number | boolean>,
): LineFeatureCollection['features'][number] {
    return {
        type: 'Feature',
        properties,
        geometry: { type: 'LineString', coordinates },
    };
}

/**
 * Project an Agri v3 document to GeoJSON (lng/lat) using the editor's planar
 * origin. Splits field sections by working_zone like MapView.renderSections.
 */
export function agriToGeoJSON(
    document: unknown,
    selectedIndices: readonly number[] = [],
    hiddenIndices: readonly number[] = [],
): MissionGeoJSON {
    const doc = asRecord(document);
    if (!doc) {
        return emptyMission();
    }
    const origin = readOrigin(doc);
    if (!origin) {
        return emptyMission();
    }

    const result = emptyMission();
    let bounds: MissionGeoJSON['bounds'] = null;

    const pushLine = (kind: LineKind, coords: [number, number][], sectionIndex: number) => {
        if (coords.length < 2) {
            return;
        }
        const feature = lineFeature(coords, { kind, sectionIndex });
        result[kind].features.push(feature);
        for (const [lng, lat] of coords) {
            bounds = extendBounds(bounds, lng, lat);
        }
    };

    const sections = Array.isArray(doc.points) ? doc.points : [];
    const hidden = new Set(hiddenIndices);
    sections.forEach((raw, sectionIndex) => {
        if (hidden.has(sectionIndex)) {
            return;
        }
        const section = asRecord(raw);
        if (!section || !Array.isArray(section.values)) {
            return;
        }
        const xIndex = columnIndex(section.columns, 'x');
        const yIndex = columnIndex(section.columns, 'y');
        const wzIndex = columnIndex(section.columns, 'working_zone');
        if (xIndex < 0 || yIndex < 0) {
            return;
        }
        const isTurn = TURN_TYPES.has(String(section.section_type));
        const points = section.values
            .map((row) => {
                if (!Array.isArray(row)) {
                    return null;
                }
                const x = Number(row[xIndex]);
                const y = Number(row[yIndex]);
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    return null;
                }
                const wzRaw = wzIndex >= 0 ? row[wzIndex] : 1;
                const working = wzRaw === 1 || wzRaw === true;
                return { lngLat: localToLngLat(x, y, origin), working };
            })
            .filter(
                (point): point is { lngLat: [number, number]; working: boolean } => point !== null,
            );

        if (points.length < 2) {
            return;
        }

        const first = points[0];
        if (!first) {
            return;
        }

        if (isTurn) {
            pushLine(
                'turn',
                points.map((point) => point.lngLat),
                sectionIndex,
            );
            return;
        }

        let segment: [number, number][] = [first.lngLat];
        let currentWorking = first.working;
        for (let index = 1; index < points.length; index += 1) {
            const point = points[index];
            if (!point) {
                continue;
            }
            if (point.working === currentWorking) {
                segment.push(point.lngLat);
            } else {
                pushLine(currentWorking ? 'work' : 'transit', segment, sectionIndex);
                segment = [point.lngLat];
                currentWorking = point.working;
            }
        }
        pushLine(currentWorking ? 'work' : 'transit', segment, sectionIndex);
    });

    const pushPolygon = (
        collection: PolygonFeatureCollection,
        localValues: unknown[],
        kind: string,
    ) => {
        const ring: [number, number][] = [];
        for (const row of localValues) {
            if (!Array.isArray(row) || row.length < 2) {
                continue;
            }
            const x = Number(row[0]);
            const y = Number(row[1]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                continue;
            }
            const lngLat = localToLngLat(x, y, origin);
            ring.push(lngLat);
            bounds = extendBounds(bounds, lngLat[0], lngLat[1]);
        }
        if (ring.length < 3) {
            return;
        }
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
            ring.push(first);
        }
        collection.features.push({
            type: 'Feature',
            properties: { kind },
            geometry: { type: 'Polygon', coordinates: [ring] },
        });
    };

    const geofencing = asRecord(doc.geofencing);
    const geoValues = Array.isArray(geofencing?.values) ? geofencing.values : [];
    if (geoValues.length >= 3) {
        pushPolygon(result.geofence, geoValues, 'geofence');
    }

    for (const zone of readWorkingZoneRings({
        origin: doc.origin as AgriDocument['origin'],
        points: Array.isArray(doc.points) ? (doc.points as AgriDocument['points']) : [],
        metadata: doc.metadata,
    })) {
        pushPolygon(
            zone.value === 1 ? result.workable : result.traversable,
            zone.values,
            'working_zone',
        );
    }

    if (selectedIndices.length > 0) {
        const selectedSet = new Set(selectedIndices);
        for (const kind of ['work', 'transit', 'turn'] as const) {
            for (const feature of result[kind].features) {
                if (selectedSet.has(Number(feature.properties.sectionIndex))) {
                    result.selected.features.push(feature);
                }
            }
        }
    }

    result.bounds = bounds;
    return result;
}

export function emptyLineCollection(): LineFeatureCollection {
    return { type: 'FeatureCollection', features: [...EMPTY_LINES.features] };
}

export function emptyPolygonCollection(): PolygonFeatureCollection {
    return { type: 'FeatureCollection', features: [...EMPTY_POLYGONS.features] };
}
