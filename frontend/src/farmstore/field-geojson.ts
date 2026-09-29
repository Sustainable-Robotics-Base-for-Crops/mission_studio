/**
 * One field ⇄ one GeoJSON FeatureCollection in `parcel_map/` (D13-01).
 *
 * The file is the only truth, so the round trip must be lossless: every property
 * written by `exportFieldGeoJSON` is read back by `readFieldFeatures`, ids included.
 * Files written by the Python backend (fewer properties, no child ids) still load.
 */

import type {
    FieldDetail,
    FieldGuidanceLine,
    FieldLandmark,
    FieldObstacle,
    FieldRow,
    FieldRowSet,
    FieldTrafficNode,
    FieldTrafficWay,
    FieldZone,
    GeoJSONPolygon,
    LandmarkKind,
} from '../fields/types';
import { nowIso } from './layout';

export const ZONE_KINDS = [
    'agronomic_boundary',
    'workable',
    'traversable',
    'forbidden',
    'autonomy',
    'headland',
    'gnss_degraded',
] as const;

const ZONE_ALIASES: Record<string, string> = {
    limite_agronomique: 'agronomic_boundary',
    travaillable: 'workable',
    interdite: 'forbidden',
    autonomie: 'autonomy',
    tournier: 'headland',
    tourniere: 'headland',
    tournière: 'headland',
    gnss_degrade: 'gnss_degraded',
    'gnss degrade': 'gnss_degraded',
    'gnss dégradé': 'gnss_degraded',
};

export const TRAFFIC_WAY_KINDS = ['path'] as const;
export const TRAFFIC_NODE_KINDS = ['gate', 'service', 'stop', 'intersection'] as const;
const TRAFFIC_NODE_ALIASES: Record<string, string> = {
    porte: 'gate',
    arret: 'stop',
    arrêt: 'stop',
};
export const LANDMARK_KINDS: readonly LandmarkKind[] = ['measure', 'circle', 'polygon', 'point'];

const KIND_ALIASES: Record<string, string> = {
    field: 'field',
    parcelle: 'field',
    zone: 'zone',
    obstacle: 'obstacle',
    guidance: 'guidance_line',
    guidance_line: 'guidance_line',
    ligne_guidage: 'guidance_line',
    row: 'row',
    rows: 'row',
    rang: 'row',
    bed: 'bed',
    beds: 'bed',
    planche: 'bed',
    traffic_way: 'traffic_way',
    chemin: 'traffic_way',
    path: 'traffic_way',
    traffic_node: 'traffic_node',
    gate: 'traffic_node',
    porte: 'traffic_node',
    service: 'traffic_node',
    stop: 'traffic_node',
    arret: 'traffic_node',
    arrêt: 'traffic_node',
    intersection: 'traffic_node',
    landmark: 'landmark',
    reperes: 'landmark',
    repères: 'landmark',
};

export function canonicalZoneKind(raw: string): string {
    const token = raw.trim().toLowerCase();
    if (token === 'zone' || token === '') {
        return 'workable';
    }
    return ZONE_ALIASES[token] ?? token;
}

export function canonicalTrafficNodeKind(raw: string): string {
    const token = raw.trim().toLowerCase();
    if (token === 'traffic_node' || token === 'node' || token === '') {
        return 'gate';
    }
    return TRAFFIC_NODE_ALIASES[token] ?? token;
}

export function provenanceQualified(provenance: Record<string, unknown> | null | undefined) {
    return Boolean(
        provenance &&
        provenance.source &&
        provenance.method &&
        provenance.h_accuracy_m !== undefined &&
        provenance.h_accuracy_m !== null,
    );
}

export function newId(): string {
    return crypto.randomUUID().replace(/-/g, '');
}

/** Keep a caller-supplied id when it is a safe token; otherwise mint one. */
export function safeId(raw: unknown): string {
    if (typeof raw !== 'string') {
        return newId();
    }
    const value = raw.trim();
    if (!value || value.length > 80 || !/^[A-Za-z0-9_-]+$/.test(value)) {
        return newId();
    }
    return value;
}

type Json = Record<string, unknown>;

function record(value: unknown): Json {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Json)
        : {};
}

function optionalText(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
}

function optionalNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function classify(properties: Json, geometryType: string): string | null {
    const raw = String(properties.srbc_kind ?? properties.kind ?? '')
        .trim()
        .toLowerCase();
    if (raw in KIND_ALIASES) {
        return KIND_ALIASES[raw] ?? null;
    }
    if ((ZONE_KINDS as readonly string[]).includes(raw) || raw in ZONE_ALIASES) {
        return 'zone';
    }
    if (raw === 'measure' || raw === 'circle' || properties.landmark_kind) {
        return 'landmark';
    }
    if (geometryType === 'Polygon') {
        return properties.zone_kind || properties.zoneKind ? 'zone' : 'field';
    }
    if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
        return 'guidance_line';
    }
    if (geometryType === 'Point' || geometryType === 'MultiPoint') {
        return 'obstacle';
    }
    return null;
}

export interface FeatureIssue {
    index: number | null;
    reason: string;
}

export interface ParsedField {
    field: Omit<FieldDetail, 'version'>;
    errors: FeatureIssue[];
    warnings: FeatureIssue[];
}

function featuresOf(document: Json): Json[] {
    if (document.type === 'Feature') {
        return [document];
    }
    if (document.type === 'FeatureCollection' && Array.isArray(document.features)) {
        return (document.features as unknown[]).filter(
            (item): item is Json => item !== null && typeof item === 'object',
        );
    }
    return [];
}

/**
 * Build a field from a FeatureCollection without touching storage. Throws when the
 * collection has no field polygon: that is not a parcel file.
 */
export function readFieldFeatures(
    document: Json,
    options: { name?: string | null; now?: Date } = {},
): ParsedField {
    const now = nowIso(options.now);
    const errors: FeatureIssue[] = [];
    const warnings: FeatureIssue[] = [];
    const pending: Array<{ index: number; geometry: Json; properties: Json; kind: string }> = [];

    featuresOf(document).forEach((feature, index) => {
        const geometry = record(feature.geometry);
        const properties = record(feature.properties);
        const type = typeof geometry.type === 'string' ? geometry.type : '';
        if (!type) {
            errors.push({ index, reason: 'missing geometry' });
            return;
        }
        if (type.startsWith('Multi')) {
            errors.push({ index, reason: `unsupported geometry type ${type}` });
            return;
        }
        const kind = classify(properties, type);
        if (!kind) {
            errors.push({ index, reason: `cannot classify ${type}` });
            return;
        }
        pending.push({ index, geometry, properties, kind });
    });

    const fields = pending.filter((item) => item.kind === 'field');
    const head = fields[0];
    if (!head) {
        throw new Error('no field polygon in the collection');
    }
    const fieldId = safeId(head.properties.id);
    const provenance = record(head.properties.provenance);
    if (!provenanceQualified(provenance)) {
        warnings.push({
            index: head.index,
            reason: 'missing provenance; not qualified for autonomy',
        });
    }
    const createdAt = optionalText(head.properties.created_at) ?? now;
    const field: Omit<FieldDetail, 'version'> = {
        id: fieldId,
        name: String(options.name || head.properties.name || 'Imported field'),
        campaign: optionalText(head.properties.campaign),
        geometry: head.geometry as unknown as GeoJSONPolygon,
        crs: optionalText(head.properties.crs) ?? 'EPSG:4326',
        provenance,
        qualified_for_autonomy: provenanceQualified(provenance),
        created_at: createdAt,
        updated_at: optionalText(head.properties.updated_at) ?? createdAt,
        zones: [],
        obstacles: [],
        guidance_lines: [],
        row_sets: [],
        traffic_ways: [],
        traffic_nodes: [],
        landmarks: [],
    };

    const common = (properties: Json) => ({
        id: safeId(properties.id),
        field_id: fieldId,
        name: optionalText(properties.name),
        provenance: record(properties.provenance),
        created_at: optionalText(properties.created_at) ?? now,
    });

    for (const extra of fields.slice(1)) {
        field.landmarks.push({
            ...common(extra.properties),
            kind: 'polygon',
            geometry: extra.geometry as FieldLandmark['geometry'],
            radius_m: null,
        });
        warnings.push({ index: extra.index, reason: 'extra polygon stored as landmark' });
    }

    const rowSets = new Map<string, FieldRowSet>();
    const looseRows: Record<'rows' | 'beds', FieldRowSet | null> = { rows: null, beds: null };

    for (const { index, geometry, properties, kind } of pending) {
        if (kind === 'field') {
            continue;
        }
        const base = common(properties);
        if (!provenanceQualified(base.provenance) && kind !== 'row' && kind !== 'bed') {
            warnings.push({ index, reason: 'missing provenance; not qualified for autonomy' });
        }
        if (kind === 'zone') {
            const zoneKind = canonicalZoneKind(
                String(properties.zone_kind ?? properties.kind ?? 'workable'),
            );
            if (!(ZONE_KINDS as readonly string[]).includes(zoneKind)) {
                errors.push({ index, reason: `unknown zone kind: ${zoneKind}` });
                continue;
            }
            field.zones.push({
                ...base,
                kind: zoneKind,
                geometry: geometry as unknown as GeoJSONPolygon,
            } satisfies FieldZone);
        } else if (kind === 'obstacle') {
            field.obstacles.push({
                ...base,
                category: String(properties.category ?? 'unspecified'),
                geometry: geometry as FieldObstacle['geometry'],
                margin_m: optionalNumber(properties.margin_m) ?? 0,
                height_m: optionalNumber(properties.height_m),
                valid_from: optionalText(properties.valid_from),
                valid_until: optionalText(properties.valid_until),
                crossable: Boolean(properties.crossable),
            } satisfies FieldObstacle);
        } else if (kind === 'guidance_line') {
            field.guidance_lines.push({
                ...base,
                geometry: geometry as FieldGuidanceLine['geometry'],
            } satisfies FieldGuidanceLine);
        } else if (kind === 'row' || kind === 'bed') {
            const setKind = kind === 'bed' ? 'beds' : 'rows';
            const setId = optionalText(properties.row_set_id);
            let set = setId ? rowSets.get(setId) : looseRows[setKind];
            if (!set) {
                set = {
                    id: setId ? safeId(setId) : newId(),
                    field_id: fieldId,
                    name:
                        optionalText(properties.row_set_name) ??
                        (setKind === 'beds' ? 'Imported beds' : 'Imported rows'),
                    kind: optionalText(properties.row_set_kind) ?? setKind,
                    spacing_m: optionalNumber(properties.spacing_m) ?? 2.5,
                    width_m: optionalNumber(properties.row_set_width_m),
                    preferred_direction: optionalText(properties.preferred_direction),
                    axis_line_id: optionalText(properties.axis_line_id),
                    geometry: null,
                    provenance: record(properties.row_set_provenance),
                    created_at: optionalText(properties.row_set_created_at) ?? now,
                    rows: [],
                };
                if (setId) {
                    rowSets.set(setId, set);
                } else {
                    looseRows[setKind] = set;
                }
                field.row_sets.push(set);
            }
            const number = Math.trunc(optionalNumber(properties.number) ?? set.rows.length + 1);
            set.rows.push({
                id: base.id,
                row_set_id: set.id,
                field_id: fieldId,
                number,
                name: base.name,
                geometry: geometry as FieldRow['geometry'],
                state: optionalText(properties.state) ?? 'active',
                created_at: base.created_at,
            });
        } else if (kind === 'traffic_way') {
            const rawKind = String(properties.way_kind ?? properties.kind ?? 'path');
            field.traffic_ways.push({
                ...base,
                kind: (TRAFFIC_WAY_KINDS as readonly string[]).includes(rawKind) ? rawKind : 'path',
                oneway: Boolean(properties.oneway),
                speed_mps: optionalNumber(properties.speed_mps),
                width_m: optionalNumber(properties.width_m),
                geometry: geometry as FieldTrafficWay['geometry'],
            } satisfies FieldTrafficWay);
        } else if (kind === 'traffic_node') {
            field.traffic_nodes.push({
                ...base,
                kind: canonicalTrafficNodeKind(
                    String(properties.node_kind ?? properties.kind ?? 'gate'),
                ),
                geometry: geometry as FieldTrafficNode['geometry'],
            } satisfies FieldTrafficNode);
        } else if (kind === 'landmark') {
            let landmarkKind = String(properties.landmark_kind ?? properties.kind ?? '');
            if (!(LANDMARK_KINDS as readonly string[]).includes(landmarkKind)) {
                const type = String(geometry.type ?? '');
                landmarkKind =
                    type === 'Point' ? 'point' : type === 'LineString' ? 'measure' : 'polygon';
            }
            field.landmarks.push({
                ...base,
                kind: landmarkKind as LandmarkKind,
                geometry: geometry as FieldLandmark['geometry'],
                radius_m: optionalNumber(properties.radius_m),
            } satisfies FieldLandmark);
        }
    }
    for (const set of field.row_sets) {
        set.rows.sort((a, b) => a.number - b.number);
    }
    return { field, errors, warnings };
}

function feature(properties: Json, geometry: unknown) {
    return { type: 'Feature', properties, geometry };
}

/** The parcel file. Keys stay compatible with `backend/fields/geojson.py`. */
export function exportFieldGeoJSON(field: Omit<FieldDetail, 'version'>): Json {
    const features: unknown[] = [
        feature(
            {
                srbc_kind: 'field',
                kind: 'field',
                name: field.name,
                id: field.id,
                campaign: field.campaign,
                crs: field.crs,
                provenance: field.provenance,
                qualified_for_autonomy: field.qualified_for_autonomy,
                created_at: field.created_at,
                updated_at: field.updated_at,
            },
            field.geometry,
        ),
    ];
    for (const zone of field.zones) {
        features.push(
            feature(
                {
                    srbc_kind: 'zone',
                    zone_kind: zone.kind,
                    name: zone.name,
                    id: zone.id,
                    provenance: zone.provenance,
                    created_at: zone.created_at,
                },
                zone.geometry,
            ),
        );
    }
    for (const obstacle of field.obstacles) {
        features.push(
            feature(
                {
                    srbc_kind: 'obstacle',
                    category: obstacle.category,
                    name: obstacle.name,
                    id: obstacle.id,
                    crossable: obstacle.crossable,
                    margin_m: obstacle.margin_m,
                    height_m: obstacle.height_m,
                    valid_from: obstacle.valid_from,
                    valid_until: obstacle.valid_until,
                    provenance: obstacle.provenance,
                    created_at: obstacle.created_at,
                },
                obstacle.geometry,
            ),
        );
    }
    for (const line of field.guidance_lines) {
        features.push(
            feature(
                {
                    srbc_kind: 'guidance_line',
                    name: line.name,
                    id: line.id,
                    provenance: line.provenance,
                    created_at: line.created_at,
                },
                line.geometry,
            ),
        );
    }
    for (const set of field.row_sets) {
        for (const row of set.rows) {
            features.push(
                feature(
                    {
                        srbc_kind: set.kind === 'beds' ? 'bed' : 'row',
                        name: row.name,
                        id: row.id,
                        number: row.number,
                        state: row.state,
                        created_at: row.created_at,
                        row_set_id: set.id,
                        row_set_name: set.name,
                        row_set_kind: set.kind,
                        spacing_m: set.spacing_m,
                        row_set_width_m: set.width_m,
                        preferred_direction: set.preferred_direction,
                        axis_line_id: set.axis_line_id,
                        row_set_provenance: set.provenance,
                        row_set_created_at: set.created_at,
                    },
                    row.geometry,
                ),
            );
        }
    }
    for (const way of field.traffic_ways) {
        features.push(
            feature(
                {
                    srbc_kind: 'traffic_way',
                    name: way.name,
                    id: way.id,
                    kind: way.kind,
                    oneway: way.oneway,
                    speed_mps: way.speed_mps,
                    width_m: way.width_m,
                    provenance: way.provenance,
                    created_at: way.created_at,
                },
                way.geometry,
            ),
        );
    }
    for (const node of field.traffic_nodes) {
        features.push(
            feature(
                {
                    srbc_kind: 'traffic_node',
                    name: node.name,
                    id: node.id,
                    kind: node.kind,
                    provenance: node.provenance,
                    created_at: node.created_at,
                },
                node.geometry,
            ),
        );
    }
    for (const landmark of field.landmarks) {
        features.push(
            feature(
                {
                    srbc_kind: 'landmark',
                    landmark_kind: landmark.kind,
                    name: landmark.name,
                    id: landmark.id,
                    radius_m: landmark.radius_m,
                    provenance: landmark.provenance,
                    created_at: landmark.created_at,
                },
                landmark.geometry,
            ),
        );
    }
    return { type: 'FeatureCollection', features };
}
