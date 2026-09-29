/**
 * Field catalogue of the open farm (L5, L15a). Reads and writes `parcel_map/` on the
 * visitor's device through the farm session; no server round trip.
 */

import { currentSession, requireSession } from '../farmstore/session';
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
    GeoJSONLineString,
    GeoJSONPoint,
    GeoJSONPolygon,
    LandmarkKind,
} from './types';

function catalogue() {
    return requireSession().fields;
}

function found<T>(value: T | null, what = 'field'): T {
    if (value === null) {
        throw new Error(`${what} not found`);
    }
    return value;
}

/** `sqlite` keeps its historical name: true when a farm catalogue is open. */
export async function fetchFieldsHealth(): Promise<{ sqlite: boolean; jobs: boolean } | null> {
    return { sqlite: currentSession() !== null, jobs: false };
}

export async function listFields(): Promise<FieldSummary[]> {
    return catalogue().listFields();
}

export async function getField(id: string): Promise<FieldDetail> {
    return found(catalogue().getField(id));
}

export async function createField(payload: {
    name: string;
    geometry: GeoJSONPolygon;
    campaign?: string;
    provenance?: Record<string, unknown>;
}): Promise<FieldDetail> {
    return catalogue().createField(payload);
}

export async function patchField(
    id: string,
    payload: Record<string, unknown>,
): Promise<FieldDetail> {
    return catalogue().updateField(id, payload);
}

export async function importGeoJSON(
    geojson: Record<string, unknown>,
    name?: string,
): Promise<{ ok: boolean; field?: FieldDetail; errors?: unknown[] }> {
    const report = await catalogue().importGeoJSON(geojson, name);
    if (!report.ok) {
        throw new Error(String(report.errors[0]?.reason ?? 'import failed'));
    }
    return report;
}

export async function listVersions(id: string): Promise<FieldVersion[]> {
    return catalogue().listVersions(id);
}

export async function diffVersions(id: string, from: number, to: number): Promise<FieldDiff> {
    return catalogue().diffVersions(id, from, to);
}

export async function getImpact(id: string): Promise<FieldImpact> {
    return catalogue().impact(id);
}

export async function exportField(id: string): Promise<Record<string, unknown>> {
    return catalogue().exportField(id);
}

export async function linkMission(id: string, path: string): Promise<void> {
    catalogue().linkMission(id, path);
}

export async function addZone(
    id: string,
    payload: { kind: string; geometry: GeoJSONPolygon; name?: string },
): Promise<FieldZone> {
    return catalogue().addZone(id, payload);
}

export async function addLandmark(
    id: string,
    payload: {
        kind: LandmarkKind;
        geometry: GeoJSONLineString | GeoJSONPolygon | GeoJSONPoint;
        name?: string;
        radius_m?: number | null;
    },
): Promise<FieldLandmark> {
    return catalogue().addLandmark(id, payload);
}

export async function patchLandmark(
    fieldId: string,
    landmarkId: string,
    payload: Record<string, unknown>,
): Promise<FieldLandmark> {
    return catalogue().updateLandmark(fieldId, landmarkId, payload);
}

export async function deleteLandmark(fieldId: string, landmarkId: string): Promise<void> {
    await catalogue().deleteLandmark(fieldId, landmarkId);
}

export async function addObstacle(
    id: string,
    payload: { geometry: GeoJSONPolygon; name?: string; category?: string },
): Promise<FieldObstacle> {
    return catalogue().addObstacle(id, payload);
}

export async function patchZone(
    fieldId: string,
    zoneId: string,
    payload: Record<string, unknown>,
): Promise<FieldZone> {
    return catalogue().updateZone(fieldId, zoneId, payload);
}

export async function patchObstacle(
    fieldId: string,
    obstacleId: string,
    payload: Record<string, unknown>,
): Promise<FieldObstacle> {
    return catalogue().updateObstacle(fieldId, obstacleId, payload);
}

export async function deleteField(id: string): Promise<void> {
    await catalogue().deleteField(id);
}

export async function deleteZone(fieldId: string, zoneId: string): Promise<void> {
    await catalogue().deleteZone(fieldId, zoneId);
}

export async function deleteObstacle(fieldId: string, obstacleId: string): Promise<void> {
    await catalogue().deleteObstacle(fieldId, obstacleId);
}

export async function addGuidanceLine(
    id: string,
    payload: { geometry: GeoJSONLineString; name?: string },
): Promise<FieldGuidanceLine> {
    return catalogue().addGuidanceLine(id, payload);
}

export async function patchGuidanceLine(
    fieldId: string,
    lineId: string,
    payload: Record<string, unknown>,
): Promise<FieldGuidanceLine> {
    return catalogue().updateGuidanceLine(fieldId, lineId, payload);
}

export async function deleteGuidanceLine(fieldId: string, lineId: string): Promise<void> {
    await catalogue().deleteGuidanceLine(fieldId, lineId);
}

export async function addTrafficWay(
    id: string,
    payload: {
        geometry: GeoJSONLineString;
        name?: string;
        kind?: string;
        oneway?: boolean;
        speed_mps?: number | null;
        width_m?: number | null;
    },
): Promise<FieldTrafficWay> {
    return catalogue().addTrafficWay(id, payload);
}

export async function patchTrafficWay(
    fieldId: string,
    wayId: string,
    payload: Record<string, unknown>,
): Promise<FieldTrafficWay> {
    return catalogue().updateTrafficWay(fieldId, wayId, payload);
}

export async function deleteTrafficWay(fieldId: string, wayId: string): Promise<void> {
    await catalogue().deleteTrafficWay(fieldId, wayId);
}

export async function addTrafficNode(
    id: string,
    payload: { geometry: GeoJSONPoint; name?: string; kind?: string },
): Promise<FieldTrafficNode> {
    return catalogue().addTrafficNode(id, payload);
}

export async function patchTrafficNode(
    fieldId: string,
    nodeId: string,
    payload: Record<string, unknown>,
): Promise<FieldTrafficNode> {
    return catalogue().updateTrafficNode(fieldId, nodeId, payload);
}

export async function deleteTrafficNode(fieldId: string, nodeId: string): Promise<void> {
    await catalogue().deleteTrafficNode(fieldId, nodeId);
}

export async function createRowSet(
    fieldId: string,
    payload: {
        name?: string;
        spacing_m: number;
        axis_line_id?: string | null;
        rows: Array<{
            number: number;
            geometry: GeoJSONLineString | GeoJSONPolygon;
            name?: string;
        }>;
        kind?: string;
        width_m?: number | null;
    },
): Promise<FieldRowSet> {
    return catalogue().createRowSet(fieldId, payload);
}

export async function deleteRowSet(fieldId: string, setId: string): Promise<void> {
    await catalogue().deleteRowSet(fieldId, setId);
}

export async function addRow(
    fieldId: string,
    setId: string,
    payload: {
        geometry: GeoJSONLineString | GeoJSONPolygon;
        number?: number | null;
        name?: string | null;
    },
): Promise<FieldRow> {
    return catalogue().addRow(fieldId, setId, payload);
}

export async function patchRow(
    fieldId: string,
    rowId: string,
    payload: Record<string, unknown>,
): Promise<FieldRow> {
    return catalogue().updateRow(fieldId, rowId, payload);
}

export async function deleteRow(fieldId: string, rowId: string): Promise<void> {
    await catalogue().deleteRow(fieldId, rowId);
}
