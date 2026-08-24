/**
 * Geometry tree of the selected field — the parcellaire twin of the mission tree.
 *
 * Pure model: it reads a field detail and returns the groups and leaves to draw,
 * each leaf carrying the focus the panel must select. Labels stay out of here so
 * the component owns the wording and this file stays testable without i18n.
 */
import { FIELD_GEOFENCE_KIND } from './edit-tools';
import { lineLengthM, polygonAreaM2 } from './geojson';
import type { FieldDetail, GeoJSONLineString, GeoJSONPolygon } from './types';
import type { FieldFocus } from './useFieldCatalogue';

export type FieldTreeGroupKind =
    'boundary' | 'geofence' | 'zones' | 'rows' | 'guidance' | 'traffic' | 'obstacles' | 'landmarks';

/** Mirrors the mission tree, which shows a length on a pass and an area on a geofence. */
export interface FieldTreeMeasure {
    kind: 'length' | 'area';
    value: number;
}

export interface FieldTreeLeaf {
    id: string;
    /** User given name, or null when the object was never named. */
    name: string | null;
    /** Ordinal of a row inside its set, for the fallback label. */
    number: number | null;
    /** Zone kind, traffic node kind… — whatever qualifies the object. */
    kind: string | null;
    /** Null for a point, which measures nothing. */
    measure: FieldTreeMeasure | null;
    focus: FieldFocus;
}

function measureOf(
    geometry: { type: string; coordinates: unknown } | null,
): FieldTreeMeasure | null {
    if (geometry?.type === 'Polygon') {
        const value = polygonAreaM2(geometry as GeoJSONPolygon);
        return value === null ? null : { kind: 'area', value };
    }
    if (geometry?.type === 'LineString') {
        const value = lineLengthM(geometry as GeoJSONLineString);
        return value === null ? null : { kind: 'length', value };
    }
    return null;
}

export interface FieldTreeGroup {
    /** Unique across the tree: a field can hold several row sets. */
    id: string;
    kind: FieldTreeGroupKind;
    /** Row set name, when the group is one row set. */
    name: string | null;
    /** Beds and perennial rows share a group kind but not a label. */
    beds: boolean;
    leaves: FieldTreeLeaf[];
}

export function fieldGeometryTree(field: FieldDetail | null): FieldTreeGroup[] {
    if (!field) {
        return [];
    }
    const groups: FieldTreeGroup[] = [
        {
            id: 'boundary',
            kind: 'boundary',
            name: field.name,
            beds: false,
            leaves: [
                {
                    id: field.id,
                    name: field.name,
                    number: null,
                    kind: null,
                    measure: measureOf(field.geometry),
                    focus: { kind: 'field', id: field.id },
                },
            ],
        },
    ];
    const geofence = field.zones.filter((zone) => zone.kind === FIELD_GEOFENCE_KIND);
    if (geofence.length > 0) {
        groups.push({
            id: 'geofence',
            kind: 'geofence',
            name: null,
            beds: false,
            leaves: geofence.map((zone) => ({
                id: zone.id,
                name: zone.name,
                number: null,
                kind: zone.kind,
                measure: measureOf(zone.geometry),
                focus: { kind: 'zone', fieldId: field.id, id: zone.id },
            })),
        });
    }
    const zones = field.zones.filter((zone) => zone.kind !== FIELD_GEOFENCE_KIND);
    if (zones.length > 0) {
        groups.push({
            id: 'zones',
            kind: 'zones',
            name: null,
            beds: false,
            leaves: zones.map((zone) => ({
                id: zone.id,
                name: zone.name,
                number: null,
                kind: zone.kind,
                measure: measureOf(zone.geometry),
                focus: { kind: 'zone', fieldId: field.id, id: zone.id },
            })),
        });
    }
    for (const rowSet of field.row_sets) {
        if ((rowSet.rows ?? []).length === 0) {
            continue;
        }
        groups.push({
            id: `rows:${rowSet.id}`,
            kind: 'rows',
            name: rowSet.name,
            beds: rowSet.kind === 'beds',
            leaves: rowSet.rows.map((row) => ({
                id: row.id,
                name: row.name,
                number: row.number,
                kind: rowSet.kind,
                measure: measureOf(row.geometry),
                focus: { kind: 'row', fieldId: field.id, rowSetId: rowSet.id, id: row.id },
            })),
        });
    }
    if (field.guidance_lines.length > 0) {
        groups.push({
            id: 'guidance',
            kind: 'guidance',
            name: null,
            beds: false,
            leaves: field.guidance_lines.map((line) => ({
                id: line.id,
                name: line.name,
                number: null,
                kind: null,
                measure: measureOf(line.geometry),
                focus: { kind: 'guidance', fieldId: field.id, id: line.id },
            })),
        });
    }
    const traffic: FieldTreeLeaf[] = [
        ...field.traffic_ways.map((way) => ({
            id: way.id,
            name: way.name,
            number: null,
            kind: 'path',
            measure: measureOf(way.geometry),
            focus: { kind: 'traffic_way' as const, fieldId: field.id, id: way.id },
        })),
        ...field.traffic_nodes.map((node) => ({
            id: node.id,
            name: node.name,
            number: null,
            kind: node.kind,
            measure: null,
            focus: { kind: 'traffic_node' as const, fieldId: field.id, id: node.id },
        })),
    ];
    if (traffic.length > 0) {
        groups.push({ id: 'traffic', kind: 'traffic', name: null, beds: false, leaves: traffic });
    }
    const landmarks = field.landmarks ?? [];
    if (landmarks.length > 0) {
        groups.push({
            id: 'landmarks',
            kind: 'landmarks',
            name: null,
            beds: false,
            leaves: landmarks.map((item) => ({
                id: item.id,
                name: item.name,
                number: null,
                kind: item.kind,
                measure: measureOf(item.geometry),
                focus: { kind: 'landmark', fieldId: field.id, id: item.id },
            })),
        });
    }
    if (field.obstacles.length > 0) {
        groups.push({
            id: 'obstacles',
            kind: 'obstacles',
            name: null,
            beds: false,
            leaves: field.obstacles.map((obstacle) => ({
                id: obstacle.id,
                name: obstacle.name,
                number: null,
                kind: obstacle.category,
                measure: measureOf(obstacle.geometry),
                focus: { kind: 'obstacle', fieldId: field.id, id: obstacle.id },
            })),
        });
    }
    return groups;
}

/** Same object as the tree leaf currently focused by the catalogue? */
export function isFieldTreeLeafFocused(leaf: FieldTreeLeaf, focus: FieldFocus | null): boolean {
    if (!focus || focus.kind === 'draft') {
        return false;
    }
    return focus.kind === leaf.focus.kind && focus.id === leaf.id;
}
