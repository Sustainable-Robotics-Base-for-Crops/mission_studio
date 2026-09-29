/**
 * Field catalogue of the open farm, browser side (port of `backend/fields/repository.py`).
 *
 * `parcel_map/*.geojson` is the truth: the catalogue loads every file on open and
 * rewrites the file of a field after each change. Versions, diffs and mission links
 * live for the session only (D15-05).
 */

import type {
    FieldDetail,
    FieldDiff,
    FieldGuidanceLine,
    FieldImpact,
    FieldLandmark,
    FieldObstacle,
    FieldRow,
    FieldRowSet,
    FieldSummary,
    FieldTrafficNode,
    FieldTrafficWay,
    FieldVersion,
    FieldZone,
    GeoJSONPolygon,
} from '../fields/types';
import {
    canonicalTrafficNodeKind,
    canonicalZoneKind,
    exportFieldGeoJSON,
    LANDMARK_KINDS,
    newId,
    provenanceQualified,
    readFieldFeatures,
    safeId,
    TRAFFIC_NODE_KINDS,
    TRAFFIC_WAY_KINDS,
    ZONE_KINDS,
    type FeatureIssue,
} from './field-geojson';
import { joinFarmPath, readJsonObject, writeJson, type FarmDirectory } from './fs';
import { polygonAreaM2, quickHash } from './geometry';
import { nowIso, slugify } from './layout';

type Json = Record<string, unknown>;
type StoredField = Omit<FieldDetail, 'version'>;

const PARCEL_DIR = 'parcel_map';
const MAX_ROWS_PER_SET = 200;

/** A request the catalogue refuses; the message says what to fix. */
export class CatalogueError extends Error {}
/** The addressed object does not exist. */
export class NotFoundError extends CatalogueError {}

function asLineString(geometry: unknown): FieldGuidanceLine['geometry'] {
    const record = geometry as { type?: unknown; coordinates?: unknown } | null;
    if (!record || record.type !== 'LineString') {
        throw new CatalogueError('geometry must be a LineString');
    }
    if (!Array.isArray(record.coordinates) || record.coordinates.length < 2) {
        throw new CatalogueError('LineString needs at least 2 vertices');
    }
    return record as FieldGuidanceLine['geometry'];
}

function asPoint(geometry: unknown): FieldTrafficNode['geometry'] {
    const record = geometry as { type?: unknown; coordinates?: unknown } | null;
    if (!record || record.type !== 'Point') {
        throw new CatalogueError('geometry must be a Point');
    }
    if (!Array.isArray(record.coordinates) || record.coordinates.length < 2) {
        throw new CatalogueError('Point needs [lng, lat]');
    }
    return record as FieldTrafficNode['geometry'];
}

function asRowGeometry(geometry: unknown): FieldRow['geometry'] {
    const record = geometry as { type?: unknown; coordinates?: unknown } | null;
    if (!record || typeof record !== 'object') {
        throw new CatalogueError('geometry must be a LineString or Polygon');
    }
    if (record.type === 'LineString') {
        return asLineString(record);
    }
    if (record.type === 'Polygon') {
        const rings = record.coordinates;
        if (!Array.isArray(rings) || rings.length === 0) {
            throw new CatalogueError('Polygon needs a ring');
        }
        if (!Array.isArray(rings[0]) || rings[0].length < 4) {
            throw new CatalogueError('Polygon ring needs at least 4 positions');
        }
        return record as FieldRow['geometry'];
    }
    throw new CatalogueError('geometry must be a LineString or Polygon');
}

function positiveWidth(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') {
        return null;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
        throw new CatalogueError('width_m must be greater than 0');
    }
    return value;
}

function optionalNumber(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') {
        return null;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new CatalogueError('expected a number');
    }
    return value;
}

function has(patch: Json, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(patch, key);
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

export function fieldFileName(field: { id: string; name: string }): string {
    return `${slugify(field.name, 'parcelle')}-${field.id}.geojson`;
}

interface SessionVersion extends FieldVersion {
    snapshot: StoredField;
}

export interface CatalogueLoadReport {
    imported: number;
    errors: Array<{ path: string; reason: unknown }>;
}

export interface ImportReport {
    ok: boolean;
    field?: FieldDetail;
    created: Record<string, number>;
    errors: FeatureIssue[];
    warnings: FeatureIssue[];
}

export class FieldCatalogue {
    private readonly fields = new Map<string, StoredField>();
    /** Current file name of each field, so a rename removes the old file. */
    private readonly files = new Map<string, string>();
    private readonly versions = new Map<string, SessionVersion[]>();
    private readonly links = new Map<string, Map<string, string>>();

    constructor(
        private readonly dir: FarmDirectory,
        private readonly clock: () => Date = () => new Date(),
    ) {}

    private now(): string {
        return nowIso(this.clock());
    }

    // -- loading ----------------------------------------------------------------

    /** Replace the in-memory catalogue with the files of `parcel_map/`. */
    async load(): Promise<CatalogueLoadReport> {
        this.fields.clear();
        this.files.clear();
        this.versions.clear();
        this.links.clear();
        const errors: CatalogueLoadReport['errors'] = [];
        let imported = 0;
        for (const entry of await this.dir.list(PARCEL_DIR)) {
            if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.geojson')) {
                continue;
            }
            const path = joinFarmPath(PARCEL_DIR, entry.name);
            const document = await readJsonObject(this.dir, path);
            if (!document) {
                errors.push({ path: entry.name, reason: 'unreadable' });
                continue;
            }
            try {
                const { field } = readFieldFeatures(document, { now: this.clock() });
                if (this.fields.has(field.id)) {
                    errors.push({ path: entry.name, reason: `duplicate field id ${field.id}` });
                    continue;
                }
                this.fields.set(field.id, field);
                this.files.set(field.id, entry.name);
                this.snapshot(field.id);
                imported += 1;
            } catch (reason) {
                errors.push({
                    path: entry.name,
                    reason: reason instanceof Error ? reason.message : String(reason),
                });
            }
        }
        return { imported, errors };
    }

    // -- reads ------------------------------------------------------------------

    listFields(): FieldSummary[] {
        return [...this.fields.values()]
            .map((field) => this.summary(field))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    getField(fieldId: string): FieldDetail | null {
        const field = this.fields.get(fieldId);
        if (!field) {
            return null;
        }
        return { ...clone(field), version: this.latestVersion(fieldId) };
    }

    exportField(fieldId: string): Json {
        return exportFieldGeoJSON(this.require(fieldId));
    }

    private summary(field: StoredField): FieldSummary {
        return clone({
            id: field.id,
            name: field.name,
            campaign: field.campaign,
            geometry: field.geometry,
            crs: field.crs,
            provenance: field.provenance,
            qualified_for_autonomy: field.qualified_for_autonomy,
            created_at: field.created_at,
            updated_at: field.updated_at,
        });
    }

    private require(fieldId: string): StoredField {
        const field = this.fields.get(fieldId);
        if (!field) {
            throw new NotFoundError('field not found');
        }
        return field;
    }

    // -- persistence --------------------------------------------------------------

    private async persist(fieldId: string): Promise<void> {
        const field = this.require(fieldId);
        const name = fieldFileName(field);
        const previous = this.files.get(fieldId);
        await writeJson(this.dir, joinFarmPath(PARCEL_DIR, name), exportFieldGeoJSON(field));
        if (previous && previous !== name) {
            await this.dir.remove(joinFarmPath(PARCEL_DIR, previous));
        }
        this.files.set(fieldId, name);
    }

    /** After every change: stamp, version, invalidate linked missions, write the file. */
    private async touch(fieldId: string): Promise<void> {
        const field = this.require(fieldId);
        field.updated_at = this.now();
        this.snapshot(fieldId);
        this.invalidateMissions(fieldId);
        await this.persist(fieldId);
    }

    // -- fields -------------------------------------------------------------------

    async createField(payload: {
        name: string;
        geometry: GeoJSONPolygon;
        campaign?: string | null;
        provenance?: Json;
        crs?: string;
        id?: string | null;
    }): Promise<FieldDetail> {
        const name = String(payload.name ?? '').trim();
        if (!name) {
            throw new CatalogueError('name is required');
        }
        if (!payload.geometry || payload.geometry.type !== 'Polygon') {
            throw new CatalogueError('geometry must be a Polygon');
        }
        let fieldId = safeId(payload.id ?? undefined);
        if (this.fields.has(fieldId)) {
            fieldId = newId();
        }
        const provenance = payload.provenance ?? {};
        const now = this.now();
        this.fields.set(fieldId, {
            id: fieldId,
            name,
            campaign: payload.campaign ?? null,
            geometry: clone(payload.geometry),
            crs: payload.crs ?? 'EPSG:4326',
            provenance: clone(provenance),
            qualified_for_autonomy: provenanceQualified(provenance),
            created_at: now,
            updated_at: now,
            zones: [],
            obstacles: [],
            guidance_lines: [],
            row_sets: [],
            traffic_ways: [],
            traffic_nodes: [],
            landmarks: [],
        });
        this.snapshot(fieldId);
        await this.persist(fieldId);
        return this.getField(fieldId) as FieldDetail;
    }

    async updateField(fieldId: string, patch: Json): Promise<FieldDetail> {
        const field = this.require(fieldId);
        if (has(patch, 'name')) {
            const name = String(patch.name ?? '').trim();
            if (!name) {
                throw new CatalogueError('name must not be empty');
            }
            field.name = name;
        }
        if (has(patch, 'campaign')) {
            field.campaign = (patch.campaign as string | null) ?? null;
        }
        if (has(patch, 'geometry')) {
            field.geometry = clone(patch.geometry as GeoJSONPolygon);
        }
        if (has(patch, 'provenance')) {
            field.provenance = clone((patch.provenance as Json) ?? {});
            field.qualified_for_autonomy = provenanceQualified(field.provenance);
        }
        await this.touch(fieldId);
        return this.getField(fieldId) as FieldDetail;
    }

    async deleteField(fieldId: string): Promise<boolean> {
        if (!this.fields.has(fieldId)) {
            return false;
        }
        const file = this.files.get(fieldId);
        this.fields.delete(fieldId);
        this.files.delete(fieldId);
        this.versions.delete(fieldId);
        this.links.delete(fieldId);
        if (file) {
            await this.dir.remove(joinFarmPath(PARCEL_DIR, file));
        }
        return true;
    }

    /** Import a user GeoJSON as a new field. Ids of the file are not trusted here. */
    async importGeoJSON(document: Json, name?: string | null): Promise<ImportReport> {
        const created = {
            zones: 0,
            obstacles: 0,
            guidance_lines: 0,
            rows: 0,
            traffic_ways: 0,
            traffic_nodes: 0,
            landmarks: 0,
        };
        let parsed;
        try {
            parsed = readFieldFeatures(document, { name, now: this.clock() });
        } catch (reason) {
            return {
                ok: false,
                created,
                errors: [
                    {
                        index: null,
                        reason: reason instanceof Error ? reason.message : String(reason),
                    },
                ],
                warnings: [],
            };
        }
        const field = parsed.field;
        const fieldId = this.fields.has(field.id) ? newId() : field.id;
        const now = this.now();
        const own = <T extends { id: string; field_id: string; created_at: string }>(item: T) => ({
            ...item,
            id: newId(),
            field_id: fieldId,
            created_at: now,
        });
        const rowSets = field.row_sets.map((set) => {
            const setId = newId();
            return {
                ...set,
                id: setId,
                field_id: fieldId,
                axis_line_id: null,
                created_at: now,
                rows: set.rows.map((row) => ({ ...own(row), row_set_id: setId })),
            };
        });
        const stored: StoredField = {
            ...field,
            id: fieldId,
            created_at: now,
            updated_at: now,
            zones: field.zones.map(own),
            obstacles: field.obstacles.map(own),
            guidance_lines: field.guidance_lines.map(own),
            row_sets: rowSets,
            traffic_ways: field.traffic_ways.map(own),
            traffic_nodes: field.traffic_nodes.map(own),
            landmarks: field.landmarks.map(own),
        };
        this.fields.set(fieldId, stored);
        this.snapshot(fieldId);
        await this.persist(fieldId);
        created.zones = stored.zones.length;
        created.obstacles = stored.obstacles.length;
        created.guidance_lines = stored.guidance_lines.length;
        created.rows = stored.row_sets.reduce((sum, set) => sum + set.rows.length, 0);
        created.traffic_ways = stored.traffic_ways.length;
        created.traffic_nodes = stored.traffic_nodes.length;
        created.landmarks = stored.landmarks.length;
        return {
            ok: true,
            field: this.getField(fieldId) as FieldDetail,
            created,
            errors: parsed.errors,
            warnings: parsed.warnings,
        };
    }

    // -- children -------------------------------------------------------------------

    private base(fieldId: string, name: unknown, provenance: unknown) {
        return {
            id: newId(),
            field_id: fieldId,
            name: typeof name === 'string' && name ? name : null,
            provenance: clone((provenance as Json) ?? {}),
            created_at: this.now(),
        };
    }

    private findChild<T extends { id: string }>(items: T[], id: string): T {
        const item = items.find((candidate) => candidate.id === id);
        if (!item) {
            throw new NotFoundError('not found');
        }
        return item;
    }

    private async removeChild<T extends { id: string }>(
        fieldId: string,
        items: T[],
        id: string,
    ): Promise<boolean> {
        const index = items.findIndex((candidate) => candidate.id === id);
        if (index < 0) {
            return false;
        }
        items.splice(index, 1);
        await this.touch(fieldId);
        return true;
    }

    async addZone(
        fieldId: string,
        payload: {
            kind: string;
            geometry: GeoJSONPolygon;
            name?: string | null;
            provenance?: Json;
        },
    ): Promise<FieldZone> {
        const field = this.require(fieldId);
        const kind = canonicalZoneKind(String(payload.kind ?? ''));
        if (!(ZONE_KINDS as readonly string[]).includes(kind)) {
            throw new CatalogueError(`unknown zone kind: ${kind}`);
        }
        const zone: FieldZone = {
            ...this.base(fieldId, payload.name, payload.provenance),
            kind,
            geometry: clone(payload.geometry),
        };
        field.zones.push(zone);
        await this.touch(fieldId);
        return clone(zone);
    }

    async updateZone(fieldId: string, zoneId: string, patch: Json): Promise<FieldZone> {
        const zone = this.findChild(this.require(fieldId).zones, zoneId);
        const kind = canonicalZoneKind(String(has(patch, 'kind') ? patch.kind : zone.kind));
        if (!(ZONE_KINDS as readonly string[]).includes(kind)) {
            throw new CatalogueError(`unknown zone kind: ${kind}`);
        }
        zone.kind = kind;
        if (has(patch, 'name')) {
            zone.name = (patch.name as string | null) ?? null;
        }
        if (has(patch, 'geometry')) {
            zone.geometry = clone(patch.geometry as GeoJSONPolygon);
        }
        await this.touch(fieldId);
        return clone(zone);
    }

    deleteZone(fieldId: string, zoneId: string): Promise<boolean> {
        return this.removeChild(fieldId, this.require(fieldId).zones, zoneId);
    }

    async addObstacle(
        fieldId: string,
        payload: {
            geometry: FieldObstacle['geometry'];
            name?: string | null;
            category?: string;
            margin_m?: number;
            height_m?: number | null;
            valid_from?: string | null;
            valid_until?: string | null;
            crossable?: boolean;
            provenance?: Json;
        },
    ): Promise<FieldObstacle> {
        const field = this.require(fieldId);
        const obstacle: FieldObstacle = {
            ...this.base(fieldId, payload.name, payload.provenance),
            category: String(payload.category ?? 'unspecified'),
            geometry: clone(payload.geometry),
            margin_m: Number(payload.margin_m ?? 0) || 0,
            height_m: optionalNumber(payload.height_m),
            valid_from: payload.valid_from ?? null,
            valid_until: payload.valid_until ?? null,
            crossable: Boolean(payload.crossable),
        };
        field.obstacles.push(obstacle);
        await this.touch(fieldId);
        return clone(obstacle);
    }

    async updateObstacle(fieldId: string, obstacleId: string, patch: Json): Promise<FieldObstacle> {
        const obstacle = this.findChild(this.require(fieldId).obstacles, obstacleId);
        if (has(patch, 'name')) {
            obstacle.name = (patch.name as string | null) ?? null;
        }
        if (has(patch, 'category')) {
            obstacle.category = String(patch.category);
        }
        if (has(patch, 'geometry')) {
            obstacle.geometry = clone(patch.geometry as FieldObstacle['geometry']);
        }
        if (has(patch, 'margin_m')) {
            obstacle.margin_m = Number(patch.margin_m ?? 0) || 0;
        }
        if (has(patch, 'height_m')) {
            obstacle.height_m = optionalNumber(patch.height_m);
        }
        if (has(patch, 'valid_from')) {
            obstacle.valid_from = (patch.valid_from as string | null) ?? null;
        }
        if (has(patch, 'valid_until')) {
            obstacle.valid_until = (patch.valid_until as string | null) ?? null;
        }
        if (has(patch, 'crossable')) {
            obstacle.crossable = Boolean(patch.crossable);
        }
        await this.touch(fieldId);
        return clone(obstacle);
    }

    deleteObstacle(fieldId: string, obstacleId: string): Promise<boolean> {
        return this.removeChild(fieldId, this.require(fieldId).obstacles, obstacleId);
    }

    async addLandmark(
        fieldId: string,
        payload: {
            kind: string;
            geometry: FieldLandmark['geometry'];
            name?: string | null;
            radius_m?: number | null;
            provenance?: Json;
        },
    ): Promise<FieldLandmark> {
        const field = this.require(fieldId);
        if (!(LANDMARK_KINDS as readonly string[]).includes(payload.kind)) {
            throw new CatalogueError(`unknown landmark kind: ${payload.kind}`);
        }
        if (!payload.geometry || typeof payload.geometry !== 'object' || !payload.geometry.type) {
            throw new CatalogueError('geometry is required');
        }
        const landmark: FieldLandmark = {
            ...this.base(fieldId, payload.name, payload.provenance),
            kind: payload.kind as FieldLandmark['kind'],
            geometry: clone(payload.geometry),
            radius_m: optionalNumber(payload.radius_m),
        };
        field.landmarks.push(landmark);
        await this.persist(fieldId);
        return clone(landmark);
    }

    async updateLandmark(fieldId: string, landmarkId: string, patch: Json): Promise<FieldLandmark> {
        const landmark = this.findChild(this.require(fieldId).landmarks, landmarkId);
        if (has(patch, 'name')) {
            landmark.name = (patch.name as string | null) ?? null;
        }
        if (has(patch, 'geometry')) {
            landmark.geometry = clone(patch.geometry as FieldLandmark['geometry']);
        }
        if (has(patch, 'radius_m')) {
            landmark.radius_m = optionalNumber(patch.radius_m);
        }
        await this.persist(fieldId);
        return clone(landmark);
    }

    /** Landmarks are measuring aids: no version, no mission invalidation. */
    async deleteLandmark(fieldId: string, landmarkId: string): Promise<boolean> {
        const field = this.require(fieldId);
        const before = field.landmarks.length;
        field.landmarks = field.landmarks.filter((item) => item.id !== landmarkId);
        if (field.landmarks.length === before) {
            return false;
        }
        await this.persist(fieldId);
        return true;
    }

    async addGuidanceLine(
        fieldId: string,
        payload: { geometry: unknown; name?: string | null; provenance?: Json },
    ): Promise<FieldGuidanceLine> {
        const field = this.require(fieldId);
        const line: FieldGuidanceLine = {
            ...this.base(fieldId, payload.name, payload.provenance),
            geometry: clone(asLineString(payload.geometry)),
        };
        field.guidance_lines.push(line);
        await this.touch(fieldId);
        return clone(line);
    }

    async updateGuidanceLine(
        fieldId: string,
        lineId: string,
        patch: Json,
    ): Promise<FieldGuidanceLine> {
        const line = this.findChild(this.require(fieldId).guidance_lines, lineId);
        if (has(patch, 'name')) {
            line.name = (patch.name as string | null) ?? null;
        }
        if (has(patch, 'geometry')) {
            line.geometry = clone(asLineString(patch.geometry));
        }
        await this.touch(fieldId);
        return clone(line);
    }

    deleteGuidanceLine(fieldId: string, lineId: string): Promise<boolean> {
        return this.removeChild(fieldId, this.require(fieldId).guidance_lines, lineId);
    }

    async addTrafficWay(
        fieldId: string,
        payload: {
            geometry: unknown;
            name?: string | null;
            kind?: string;
            oneway?: boolean;
            speed_mps?: number | null;
            width_m?: number | null;
            provenance?: Json;
        },
    ): Promise<FieldTrafficWay> {
        const field = this.require(fieldId);
        const kind =
            String(payload.kind ?? 'path')
                .trim()
                .toLowerCase() || 'path';
        if (!(TRAFFIC_WAY_KINDS as readonly string[]).includes(kind)) {
            throw new CatalogueError(`unknown traffic way kind: ${kind}`);
        }
        const way: FieldTrafficWay = {
            ...this.base(fieldId, payload.name, payload.provenance),
            kind,
            oneway: Boolean(payload.oneway),
            speed_mps: optionalNumber(payload.speed_mps),
            width_m: positiveWidth(payload.width_m),
            geometry: clone(asLineString(payload.geometry)),
        };
        field.traffic_ways.push(way);
        await this.touch(fieldId);
        return clone(way);
    }

    async updateTrafficWay(fieldId: string, wayId: string, patch: Json): Promise<FieldTrafficWay> {
        const way = this.findChild(this.require(fieldId).traffic_ways, wayId);
        const kind =
            String(has(patch, 'kind') ? (patch.kind ?? 'path') : way.kind)
                .trim()
                .toLowerCase() || 'path';
        if (!(TRAFFIC_WAY_KINDS as readonly string[]).includes(kind)) {
            throw new CatalogueError(`unknown traffic way kind: ${kind}`);
        }
        way.kind = kind;
        if (has(patch, 'name')) {
            way.name = (patch.name as string | null) ?? null;
        }
        if (has(patch, 'oneway')) {
            way.oneway = Boolean(patch.oneway);
        }
        if (has(patch, 'speed_mps')) {
            way.speed_mps = optionalNumber(patch.speed_mps);
        }
        if (has(patch, 'width_m')) {
            way.width_m = positiveWidth(patch.width_m);
        }
        if (has(patch, 'geometry')) {
            way.geometry = clone(asLineString(patch.geometry));
        }
        await this.touch(fieldId);
        return clone(way);
    }

    deleteTrafficWay(fieldId: string, wayId: string): Promise<boolean> {
        return this.removeChild(fieldId, this.require(fieldId).traffic_ways, wayId);
    }

    async addTrafficNode(
        fieldId: string,
        payload: { geometry: unknown; name?: string | null; kind?: string; provenance?: Json },
    ): Promise<FieldTrafficNode> {
        const field = this.require(fieldId);
        const kind = canonicalTrafficNodeKind(String(payload.kind ?? 'gate'));
        if (!(TRAFFIC_NODE_KINDS as readonly string[]).includes(kind)) {
            throw new CatalogueError(`unknown traffic node kind: ${kind}`);
        }
        const node: FieldTrafficNode = {
            ...this.base(fieldId, payload.name, payload.provenance),
            kind,
            geometry: clone(asPoint(payload.geometry)),
        };
        field.traffic_nodes.push(node);
        await this.touch(fieldId);
        return clone(node);
    }

    async updateTrafficNode(
        fieldId: string,
        nodeId: string,
        patch: Json,
    ): Promise<FieldTrafficNode> {
        const node = this.findChild(this.require(fieldId).traffic_nodes, nodeId);
        const kind = canonicalTrafficNodeKind(
            String(has(patch, 'kind') ? (patch.kind ?? 'gate') : node.kind),
        );
        if (!(TRAFFIC_NODE_KINDS as readonly string[]).includes(kind)) {
            throw new CatalogueError(`unknown traffic node kind: ${kind}`);
        }
        node.kind = kind;
        if (has(patch, 'name')) {
            node.name = (patch.name as string | null) ?? null;
        }
        if (has(patch, 'geometry')) {
            node.geometry = clone(asPoint(patch.geometry));
        }
        await this.touch(fieldId);
        return clone(node);
    }

    deleteTrafficNode(fieldId: string, nodeId: string): Promise<boolean> {
        return this.removeChild(fieldId, this.require(fieldId).traffic_nodes, nodeId);
    }

    async createRowSet(
        fieldId: string,
        payload: {
            rows: Array<{ number?: number | null; geometry: unknown; name?: string | null }>;
            name?: string | null;
            spacing_m?: number;
            axis_line_id?: string | null;
            kind?: string;
            width_m?: number | null;
            preferred_direction?: string | null;
            provenance?: Json;
        },
    ): Promise<FieldRowSet> {
        const field = this.require(fieldId);
        const rows = payload.rows;
        if (!Array.isArray(rows) || rows.length === 0) {
            throw new CatalogueError('row set needs at least one row');
        }
        if (rows.length > MAX_ROWS_PER_SET) {
            throw new CatalogueError(`row set cannot exceed ${MAX_ROWS_PER_SET} rows`);
        }
        const spacing = Number(payload.spacing_m ?? 2.5);
        if (!(spacing > 0)) {
            throw new CatalogueError('spacing_m must be positive');
        }
        if (payload.axis_line_id) {
            this.findChildOr(
                field.guidance_lines,
                payload.axis_line_id,
                'axis_line_id not on this field',
            );
        }
        const setId = newId();
        const now = this.now();
        const used = new Set<number>();
        const parsed: FieldRow[] = rows.map((item, index) => {
            if (item === null || typeof item !== 'object') {
                throw new CatalogueError('each row must be an object');
            }
            const geometry = asRowGeometry(item.geometry);
            const number = Math.trunc(Number(item.number || index + 1));
            if (number < 1) {
                throw new CatalogueError('row number must be >= 1');
            }
            if (used.has(number)) {
                throw new CatalogueError(`duplicate row number: ${number}`);
            }
            used.add(number);
            return {
                id: newId(),
                row_set_id: setId,
                field_id: fieldId,
                number,
                name: item.name ? String(item.name) : null,
                geometry: clone(geometry),
                state: 'active',
                created_at: now,
            };
        });
        const set: FieldRowSet = {
            id: setId,
            field_id: fieldId,
            name: payload.name ?? null,
            kind: payload.kind || 'rows',
            spacing_m: spacing,
            width_m: optionalNumber(payload.width_m),
            preferred_direction: payload.preferred_direction ?? null,
            axis_line_id: payload.axis_line_id ?? null,
            geometry: null,
            provenance: clone(payload.provenance ?? {}),
            created_at: now,
            rows: parsed.sort((a, b) => a.number - b.number),
        };
        field.row_sets.push(set);
        await this.touch(fieldId);
        return clone(set);
    }

    private findChildOr<T extends { id: string }>(items: T[], id: string, message: string): T {
        const item = items.find((candidate) => candidate.id === id);
        if (!item) {
            throw new CatalogueError(message);
        }
        return item;
    }

    deleteRowSet(fieldId: string, setId: string): Promise<boolean> {
        return this.removeChild(fieldId, this.require(fieldId).row_sets, setId);
    }

    /** Put one row back into an existing set — the inverse of `deleteRow`. */
    async addRow(
        fieldId: string,
        setId: string,
        payload: { geometry: unknown; number?: number | null; name?: string | null },
    ): Promise<FieldRow> {
        const set = this.findChild(this.require(fieldId).row_sets, setId);
        const geometry = asRowGeometry(payload.geometry);
        const taken = new Set(set.rows.map((row) => row.number));
        if (taken.size >= MAX_ROWS_PER_SET) {
            throw new CatalogueError(`row set cannot exceed ${MAX_ROWS_PER_SET} rows`);
        }
        const wanted =
            payload.number !== null && payload.number !== undefined
                ? Math.trunc(Number(payload.number))
                : taken.size
                  ? Math.max(...taken) + 1
                  : 1;
        if (wanted < 1) {
            throw new CatalogueError('row number must be >= 1');
        }
        if (taken.has(wanted)) {
            throw new CatalogueError(`duplicate row number: ${wanted}`);
        }
        const row: FieldRow = {
            id: newId(),
            row_set_id: setId,
            field_id: fieldId,
            number: wanted,
            name: payload.name ? String(payload.name) : null,
            geometry: clone(geometry),
            state: 'active',
            created_at: this.now(),
        };
        set.rows.push(row);
        set.rows.sort((a, b) => a.number - b.number);
        await this.touch(fieldId);
        return clone(row);
    }

    private locateRow(fieldId: string, rowId: string): { set: FieldRowSet; row: FieldRow } {
        for (const set of this.require(fieldId).row_sets) {
            const row = set.rows.find((candidate) => candidate.id === rowId);
            if (row) {
                return { set, row };
            }
        }
        throw new NotFoundError('row not found');
    }

    async updateRow(fieldId: string, rowId: string, patch: Json): Promise<FieldRow> {
        const { row } = this.locateRow(fieldId, rowId);
        if (has(patch, 'name')) {
            row.name = (patch.name as string | null) ?? null;
        }
        if (has(patch, 'state')) {
            row.state = String(patch.state);
        }
        if (has(patch, 'geometry')) {
            row.geometry = clone(asRowGeometry(patch.geometry));
        }
        await this.touch(fieldId);
        return clone(row);
    }

    async deleteRow(fieldId: string, rowId: string): Promise<boolean> {
        let located;
        try {
            located = this.locateRow(fieldId, rowId);
        } catch (reason) {
            if (reason instanceof NotFoundError) {
                return false;
            }
            throw reason;
        }
        located.set.rows = located.set.rows.filter((row) => row.id !== rowId);
        await this.touch(fieldId);
        return true;
    }

    // -- session history (D15-05) ---------------------------------------------------

    private latestVersion(fieldId: string): number {
        const list = this.versions.get(fieldId);
        return list?.[list.length - 1]?.version ?? 0;
    }

    private snapshot(fieldId: string): void {
        const field = this.require(fieldId);
        const list = this.versions.get(fieldId) ?? [];
        const geometry = {
            field: field.geometry,
            zones: field.zones.map((item) => item.geometry),
            obstacles: field.obstacles.map((item) => item.geometry),
            guidance_lines: field.guidance_lines.map((item) => item.geometry),
            rows: field.row_sets.flatMap((set) => set.rows.map((row) => row.geometry)),
            traffic_ways: field.traffic_ways.map((item) => item.geometry),
            traffic_nodes: field.traffic_nodes.map((item) => item.geometry),
        };
        list.push({
            version: this.latestVersion(fieldId) + 1,
            geometry_hash: quickHash(geometry),
            area_m2: polygonAreaM2(field.geometry),
            created_at: this.now(),
            author: null,
            snapshot: clone(field),
        });
        this.versions.set(fieldId, list);
    }

    listVersions(fieldId: string): FieldVersion[] {
        this.require(fieldId);
        return (this.versions.get(fieldId) ?? []).map(
            ({ version, geometry_hash, area_m2, created_at, author }) => ({
                version,
                geometry_hash,
                area_m2,
                created_at,
                author,
            }),
        );
    }

    diffVersions(fieldId: string, from: number, to: number): FieldDiff {
        const list = this.versions.get(fieldId) ?? [];
        const left = list.find((item) => item.version === from);
        const right = list.find((item) => item.version === to);
        if (!left || !right) {
            throw new NotFoundError('version not found');
        }
        return {
            from,
            to,
            geometry_changed: left.geometry_hash !== right.geometry_hash,
            area_m2_from: left.area_m2,
            area_m2_to: right.area_m2,
            zones_from: left.snapshot.zones.length,
            zones_to: right.snapshot.zones.length,
            obstacles_from: left.snapshot.obstacles.length,
            obstacles_to: right.snapshot.obstacles.length,
        };
    }

    // -- mission links (session) ---------------------------------------------------

    linkMission(fieldId: string, missionPath: string) {
        this.require(fieldId);
        const map = this.links.get(fieldId) ?? new Map<string, string>();
        map.set(missionPath, 'current');
        this.links.set(fieldId, map);
        return { field_id: fieldId, mission_path: missionPath, status: 'current' };
    }

    private invalidateMissions(fieldId: string): void {
        const map = this.links.get(fieldId);
        if (!map) {
            return;
        }
        for (const path of map.keys()) {
            map.set(path, 'needs_revalidation');
        }
    }

    impact(fieldId: string): FieldImpact {
        this.require(fieldId);
        const missions = [...(this.links.get(fieldId) ?? new Map()).entries()].map(
            ([mission_path, status]) => ({ mission_path, status: String(status) }),
        );
        const invalidated = missions.filter((item) => item.status === 'needs_revalidation');
        return {
            field_id: fieldId,
            missions,
            invalidated_count: invalidated.length,
            banner: invalidated.length
                ? `Simulation invalidée — ${invalidated.length} mission(s) impactée(s).`
                : null,
        };
    }
}
