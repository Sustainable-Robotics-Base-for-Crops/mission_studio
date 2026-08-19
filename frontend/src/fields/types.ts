export const ZONE_KINDS = [
    'agronomic_boundary',
    'workable',
    'traversable',
    'forbidden',
    'autonomy',
    'headland',
] as const;

export type ZoneKind = (typeof ZONE_KINDS)[number];

export interface GeoJSONPolygon {
    type: 'Polygon';
    coordinates: number[][][];
}

export interface GeoJSONLineString {
    type: 'LineString';
    coordinates: number[][];
}

export interface GeoJSONPoint {
    type: 'Point';
    coordinates: number[];
}

export interface FieldSummary {
    id: string;
    name: string;
    campaign: string | null;
    geometry: GeoJSONPolygon;
    crs: string;
    provenance: Record<string, unknown>;
    qualified_for_autonomy: boolean;
    created_at: string;
    updated_at: string;
}

export interface FieldZone {
    id: string;
    field_id: string;
    kind: string;
    name: string | null;
    geometry: GeoJSONPolygon;
    provenance: Record<string, unknown>;
    created_at: string;
}

export interface FieldObstacle {
    id: string;
    field_id: string;
    category: string;
    name: string | null;
    geometry: { type: string; coordinates: unknown };
    margin_m: number;
    height_m: number | null;
    valid_from: string | null;
    valid_until: string | null;
    crossable: boolean;
    provenance: Record<string, unknown>;
    created_at: string;
}

export interface FieldGuidanceLine {
    id: string;
    field_id: string;
    name: string | null;
    geometry: GeoJSONLineString | { type: string; coordinates: unknown };
    provenance: Record<string, unknown>;
    created_at: string;
}

export interface FieldRow {
    id: string;
    row_set_id: string;
    field_id: string;
    number: number;
    name: string | null;
    geometry: GeoJSONLineString | GeoJSONPolygon | { type: string; coordinates: unknown };
    state: string;
    created_at: string;
}

export interface FieldRowSet {
    id: string;
    field_id: string;
    name: string | null;
    kind: string;
    spacing_m: number;
    width_m: number | null;
    preferred_direction: string | null;
    axis_line_id: string | null;
    geometry: GeoJSONLineString | GeoJSONPolygon | null;
    provenance: Record<string, unknown>;
    created_at: string;
    rows: FieldRow[];
}

export const TRAFFIC_WAY_KINDS = ['path'] as const;
export const TRAFFIC_NODE_KINDS = ['gate', 'service', 'stop', 'intersection'] as const;
export const TRAFFIC_DRAW_KINDS = ['path', ...TRAFFIC_NODE_KINDS] as const;

export type TrafficWayKind = (typeof TRAFFIC_WAY_KINDS)[number];
export type TrafficNodeKind = (typeof TRAFFIC_NODE_KINDS)[number];
export type TrafficDrawKind = (typeof TRAFFIC_DRAW_KINDS)[number];

export interface FieldTrafficWay {
    id: string;
    field_id: string;
    name: string | null;
    kind: string;
    oneway: boolean;
    speed_mps: number | null;
    geometry: GeoJSONLineString | { type: string; coordinates: unknown };
    provenance: Record<string, unknown>;
    created_at: string;
}

export interface FieldTrafficNode {
    id: string;
    field_id: string;
    name: string | null;
    kind: string;
    geometry: GeoJSONPoint | { type: string; coordinates: unknown };
    provenance: Record<string, unknown>;
    created_at: string;
}

export interface FieldDetail extends FieldSummary {
    zones: FieldZone[];
    obstacles: FieldObstacle[];
    guidance_lines: FieldGuidanceLine[];
    row_sets: FieldRowSet[];
    traffic_ways: FieldTrafficWay[];
    traffic_nodes: FieldTrafficNode[];
    version: number;
}

export interface FieldVersion {
    version: number;
    geometry_hash: string;
    area_m2: number | null;
    created_at: string;
    author: string | null;
}

export interface FieldImpact {
    field_id: string;
    missions: Array<{ mission_path: string; status: string }>;
    invalidated_count: number;
    banner: string | null;
}

export interface FieldDiff {
    from: number;
    to: number;
    geometry_changed: boolean;
    area_m2_from: number | null;
    area_m2_to: number | null;
    zones_from: number;
    zones_to: number;
    obstacles_from: number;
    obstacles_to: number;
}

export type FieldsNavId =
    'parcels' | 'zones' | 'rows' | 'guidance' | 'obstacles' | 'traffic' | 'io' | 'history';
