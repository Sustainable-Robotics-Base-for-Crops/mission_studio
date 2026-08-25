import { getDistanceMeters, type LatLng } from '../domain/geometry';
import type { FieldChildren } from './geojson';
import { geometryIntersectsLasso } from './lasso-cut';
import type { FieldSummary, FieldZone, GeoJSONPolygon } from './types';

export const FIELD_GEOFENCE_KIND = 'autonomy';

export type FieldsLineKind = 'perennial' | 'bed' | 'guidance' | 'path';

export type FieldLassoHit =
    | { kind: 'row'; fieldId: string; rowSetId: string; id: string; label: string }
    | { kind: 'guidance'; fieldId: string; id: string; label: string };

export function nextFieldDraftName(fields: FieldSummary[]): string {
    const used = new Set(fields.map((field) => field.name));
    let index = fields.length + 1;
    let name = `Nouvelle parcelle n°${index}`;
    while (used.has(name)) {
        index += 1;
        name = `Nouvelle parcelle n°${index}`;
    }
    return name;
}

/** Default name proposed for a polyline, so a path is never called "Nouvelle parcelle". */
export function fieldLineDraftName(kind: FieldsLineKind): string {
    if (kind === 'perennial') {
        return 'Nouveau rang';
    }
    if (kind === 'bed') {
        return 'Nouvelle planche';
    }
    if (kind === 'path') {
        return 'Nouveau chemin';
    }
    return 'Nouvelle ligne de guidage';
}

export function findGeofenceZone(zones: FieldZone[] | undefined): FieldZone | null {
    return zones?.find((zone) => zone.kind === FIELD_GEOFENCE_KIND) ?? null;
}

/** Next unused catalogue row number in a set (the API rejects duplicates). */
export function nextFreeRowNumber(taken: Iterable<number>): number {
    let max = 0;
    for (const value of taken) {
        if (Number.isFinite(value) && value > max) {
            max = value;
        }
    }
    return max + 1;
}

export function lassoHitsInRing(
    fieldId: string,
    children: FieldChildren | undefined,
    ring: GeoJSONPolygon,
): FieldLassoHit[] {
    if (!children) {
        return [];
    }
    const hits: FieldLassoHit[] = [];
    for (const rowSet of children.row_sets ?? []) {
        const kind = rowSet.kind === 'beds' ? 'planche' : 'rang';
        for (const row of rowSet.rows ?? []) {
            if (!geometryIntersectsLasso(row.geometry, ring)) {
                continue;
            }
            hits.push({
                kind: 'row',
                fieldId,
                rowSetId: row.row_set_id || rowSet.id,
                id: row.id,
                label: row.name || `${kind} ${row.number}`,
            });
        }
    }
    for (const line of children.guidance_lines ?? []) {
        if (!geometryIntersectsLasso(line.geometry, ring)) {
            continue;
        }
        hits.push({
            kind: 'guidance',
            fieldId,
            id: line.id,
            label: line.name || 'Ligne A/B',
        });
    }
    return hits;
}

export type FieldDraftCommit =
    | { kind: 'patch-focus' }
    | { kind: 'patch-selected' }
    | { kind: 'create-field' }
    | { kind: 'continue' };

const CHILD_FIELD_INTENTS = new Set(['surface', 'geofence', 'polyline', 'lasso']);

/** Decide whether validating a draft creates a field, patches one, or continues as a child. */
export function resolveFieldDraftCommit(input: {
    editingGeometry: boolean;
    focusKind?: string;
    editIntent: string;
    selectedId: string | null;
}): FieldDraftCommit {
    const childIntent = CHILD_FIELD_INTENTS.has(input.editIntent);
    if (input.editingGeometry && input.focusKind && input.focusKind !== 'draft') {
        return { kind: 'patch-focus' };
    }
    if (
        input.editingGeometry &&
        !childIntent &&
        input.selectedId &&
        (!input.focusKind || input.focusKind === 'draft')
    ) {
        return { kind: 'patch-selected' };
    }
    if (input.editIntent === 'create_field' && !input.editingGeometry) {
        return { kind: 'create-field' };
    }
    return { kind: 'continue' };
}

export function formatRulerDistance(draft: LatLng[]): string | null {
    if (draft.length < 2) {
        return null;
    }
    const start = draft[0];
    const end = draft[1];
    if (!start || !end) {
        return null;
    }
    const meters = getDistanceMeters(start, end);
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${meters.toFixed(1)} m`;
}
