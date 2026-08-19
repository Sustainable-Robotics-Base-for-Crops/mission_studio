import type {
    FieldDetail,
    FieldDiff,
    FieldGuidanceLine,
    FieldImpact,
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
} from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

async function readError(response: Response, fallback: string): Promise<string> {
    try {
        const body: unknown = await response.json();
        const record = asRecord(body);
        if (typeof record?.error === 'string' && record.error) {
            return record.error;
        }
    } catch {
        // Keep the HTTP fallback.
    }
    return `${fallback} (${response.status})`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers ?? {}),
        },
    });
    if (!response.ok) {
        throw new Error(await readError(response, `${init?.method ?? 'GET'} ${path} failed`));
    }
    return (await response.json()) as T;
}

export async function fetchFieldsHealth(): Promise<{ sqlite: boolean; jobs: boolean } | null> {
    const response = await fetch('/api/v1/health');
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        return null;
    }
    const body = asRecord(await response.json());
    return {
        sqlite: body?.sqlite === true,
        jobs: body?.jobs === true,
    };
}

export async function listFields(): Promise<FieldSummary[]> {
    const body = await request<{ fields: FieldSummary[] }>('/api/v1/fields');
    return Array.isArray(body.fields) ? body.fields : [];
}

export async function getField(id: string): Promise<FieldDetail> {
    return request<FieldDetail>(`/api/v1/fields/${encodeURIComponent(id)}`);
}

export async function createField(payload: {
    name: string;
    geometry: GeoJSONPolygon;
    campaign?: string;
    provenance?: Record<string, unknown>;
}): Promise<FieldDetail> {
    return request<FieldDetail>('/api/v1/fields', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function patchField(
    id: string,
    payload: Record<string, unknown>,
): Promise<FieldDetail> {
    return request<FieldDetail>(`/api/v1/fields/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    });
}

export async function importGeoJSON(
    geojson: Record<string, unknown>,
    name?: string,
): Promise<{ ok: boolean; field?: FieldDetail; errors?: unknown[] }> {
    return request('/api/v1/fields/import', {
        method: 'POST',
        body: JSON.stringify({ format: 'geojson', geojson, name }),
    });
}

export async function listVersions(id: string): Promise<FieldVersion[]> {
    const body = await request<{ versions: FieldVersion[] }>(
        `/api/v1/fields/${encodeURIComponent(id)}/versions`,
    );
    return Array.isArray(body.versions) ? body.versions : [];
}

export async function diffVersions(id: string, from: number, to: number): Promise<FieldDiff> {
    return request(`/api/v1/fields/${encodeURIComponent(id)}/versions/${from}/diff/${to}`);
}

export async function getImpact(id: string): Promise<FieldImpact> {
    return request(`/api/v1/fields/${encodeURIComponent(id)}/impact`);
}

export async function exportField(id: string): Promise<Record<string, unknown>> {
    return request(`/api/v1/fields/${encodeURIComponent(id)}/export`);
}

export async function linkMission(id: string, path: string): Promise<void> {
    await request(`/api/v1/fields/${encodeURIComponent(id)}/missions`, {
        method: 'POST',
        body: JSON.stringify({ path }),
    });
}

export async function addZone(
    id: string,
    payload: { kind: string; geometry: GeoJSONPolygon; name?: string },
): Promise<FieldZone> {
    return request(`/api/v1/fields/${encodeURIComponent(id)}/zones`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function addObstacle(
    id: string,
    payload: { geometry: GeoJSONPolygon; name?: string; category?: string },
): Promise<FieldObstacle> {
    return request(`/api/v1/fields/${encodeURIComponent(id)}/obstacles`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function patchZone(
    fieldId: string,
    zoneId: string,
    payload: Record<string, unknown>,
): Promise<FieldZone> {
    return request(
        `/api/v1/fields/${encodeURIComponent(fieldId)}/zones/${encodeURIComponent(zoneId)}`,
        { method: 'PATCH', body: JSON.stringify(payload) },
    );
}

export async function patchObstacle(
    fieldId: string,
    obstacleId: string,
    payload: Record<string, unknown>,
): Promise<FieldObstacle> {
    return request(
        `/api/v1/fields/${encodeURIComponent(fieldId)}/obstacles/${encodeURIComponent(obstacleId)}`,
        { method: 'PATCH', body: JSON.stringify(payload) },
    );
}

export async function deleteField(id: string): Promise<void> {
    await request(`/api/v1/fields/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function deleteZone(fieldId: string, zoneId: string): Promise<void> {
    await request(
        `/api/v1/fields/${encodeURIComponent(fieldId)}/zones/${encodeURIComponent(zoneId)}`,
        { method: 'DELETE' },
    );
}

export async function deleteObstacle(fieldId: string, obstacleId: string): Promise<void> {
    await request(
        `/api/v1/fields/${encodeURIComponent(fieldId)}/obstacles/${encodeURIComponent(obstacleId)}`,
        { method: 'DELETE' },
    );
}

export async function addGuidanceLine(
    id: string,
    payload: { geometry: GeoJSONLineString; name?: string },
): Promise<FieldGuidanceLine> {
    return request(`/api/v1/fields/${encodeURIComponent(id)}/guidance-lines`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function patchGuidanceLine(
    fieldId: string,
    lineId: string,
    payload: Record<string, unknown>,
): Promise<FieldGuidanceLine> {
    return request(
        `/api/v1/fields/${encodeURIComponent(fieldId)}/guidance-lines/${encodeURIComponent(lineId)}`,
        { method: 'PATCH', body: JSON.stringify(payload) },
    );
}

export async function deleteGuidanceLine(fieldId: string, lineId: string): Promise<void> {
    await request(
        `/api/v1/fields/${encodeURIComponent(fieldId)}/guidance-lines/${encodeURIComponent(lineId)}`,
        { method: 'DELETE' },
    );
}

export async function addTrafficWay(
    id: string,
    payload: {
        geometry: GeoJSONLineString;
        name?: string;
        kind?: string;
        oneway?: boolean;
        speed_mps?: number | null;
    },
): Promise<FieldTrafficWay> {
    return request(`/api/v1/fields/${encodeURIComponent(id)}/traffic-ways`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function patchTrafficWay(
    fieldId: string,
    wayId: string,
    payload: Record<string, unknown>,
): Promise<FieldTrafficWay> {
    return request(
        `/api/v1/fields/${encodeURIComponent(fieldId)}/traffic-ways/${encodeURIComponent(wayId)}`,
        { method: 'PATCH', body: JSON.stringify(payload) },
    );
}

export async function deleteTrafficWay(fieldId: string, wayId: string): Promise<void> {
    await request(
        `/api/v1/fields/${encodeURIComponent(fieldId)}/traffic-ways/${encodeURIComponent(wayId)}`,
        { method: 'DELETE' },
    );
}

export async function addTrafficNode(
    id: string,
    payload: { geometry: GeoJSONPoint; name?: string; kind?: string },
): Promise<FieldTrafficNode> {
    return request(`/api/v1/fields/${encodeURIComponent(id)}/traffic-nodes`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function patchTrafficNode(
    fieldId: string,
    nodeId: string,
    payload: Record<string, unknown>,
): Promise<FieldTrafficNode> {
    return request(
        `/api/v1/fields/${encodeURIComponent(fieldId)}/traffic-nodes/${encodeURIComponent(nodeId)}`,
        { method: 'PATCH', body: JSON.stringify(payload) },
    );
}

export async function deleteTrafficNode(fieldId: string, nodeId: string): Promise<void> {
    await request(
        `/api/v1/fields/${encodeURIComponent(fieldId)}/traffic-nodes/${encodeURIComponent(nodeId)}`,
        { method: 'DELETE' },
    );
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
    return request(`/api/v1/fields/${encodeURIComponent(fieldId)}/row-sets`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function deleteRowSet(fieldId: string, setId: string): Promise<void> {
    await request(
        `/api/v1/fields/${encodeURIComponent(fieldId)}/row-sets/${encodeURIComponent(setId)}`,
        { method: 'DELETE' },
    );
}

export async function patchRow(
    fieldId: string,
    rowId: string,
    payload: Record<string, unknown>,
): Promise<FieldRow> {
    return request(
        `/api/v1/fields/${encodeURIComponent(fieldId)}/rows/${encodeURIComponent(rowId)}`,
        { method: 'PATCH', body: JSON.stringify(payload) },
    );
}

export async function deleteRow(fieldId: string, rowId: string): Promise<void> {
    await request(
        `/api/v1/fields/${encodeURIComponent(fieldId)}/rows/${encodeURIComponent(rowId)}`,
        { method: 'DELETE' },
    );
}
