export interface MissionRef {
    path: string;
    name: string;
    type: string;
    vehicle: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export function flattenMissionList(groups: unknown): MissionRef[] {
    if (!Array.isArray(groups)) {
        return [];
    }
    const result: MissionRef[] = [];
    for (const group of groups) {
        const record = asRecord(group);
        if (!record) {
            continue;
        }
        const type = String(record.type ?? 'draft');
        const vehicles = asRecord(record.vehicles);
        if (!vehicles) {
            continue;
        }
        for (const [vehicle, files] of Object.entries(vehicles)) {
            if (!Array.isArray(files)) {
                continue;
            }
            for (const file of files) {
                const row = asRecord(file);
                if (!row) {
                    continue;
                }
                const path = String(row.actualPath ?? row.fullPath ?? '');
                if (!path) {
                    continue;
                }
                result.push({
                    path,
                    name: String(row.filename ?? path.split('/').pop() ?? path),
                    type,
                    vehicle,
                });
            }
        }
    }
    return result;
}

export async function fetchMissionList(): Promise<MissionRef[]> {
    const response = await fetch('/api/trajectories');
    if (!response.ok) {
        throw new Error(`GET /api/trajectories failed (${response.status})`);
    }
    return flattenMissionList(await response.json());
}

export async function fetchMissionDocument(path: string): Promise<unknown> {
    const response = await fetch(`/api/trajectories/${encodeURIComponent(path)}`);
    if (!response.ok) {
        throw new Error(`GET /api/trajectories/${path} failed (${response.status})`);
    }
    return response.json();
}

export type StorageIdentity = {
    fileType: string;
    vehicleId: string;
    filename: string;
};

/** `file_type/vehicle_id/filename.json`, with an optional `uploads/` prefix. */
export function storageIdentityFromPath(path: string): StorageIdentity | null {
    const parts = path
        .split(/[\\/]/)
        .map((part) => part.trim())
        .filter(Boolean);
    if (parts[0] === 'uploads') {
        parts.shift();
    }
    if (parts.length < 3) {
        return null;
    }
    const fileType = parts[parts.length - 3];
    const vehicleId = parts[parts.length - 2];
    const filename = parts[parts.length - 1];
    if (!fileType || !vehicleId || !filename) {
        return null;
    }
    const safeName = filename.toLowerCase().endsWith('.json') ? filename : `${filename}.json`;
    return { fileType, vehicleId, filename: safeName };
}

export function toAgriDocument(document: Record<string, unknown>): Record<string, unknown> {
    const origin = asRecord(document.origin);
    const coordinates = asRecord(origin?.coordinates);
    const payload: Record<string, unknown> = {
        version: String(document.version ?? '3'),
        file_type: String(document.file_type ?? 'mission_order'),
        vehicle_id: String(document.vehicle_id ?? 'v1'),
        origin: {
            type: String(origin?.type ?? 'WGS84'),
            coordinates: {
                lat: Number(coordinates?.lat),
                lon: Number(coordinates?.lon),
                alt: Number(coordinates?.alt) || 0,
            },
        },
        points: Array.isArray(document.points) ? document.points : [],
        metadata: asRecord(document.metadata) ?? {},
    };
    if (document.geofencing != null) {
        payload.geofencing = document.geofencing;
    }
    return payload;
}

export function toSaveRequest(
    document: Record<string, unknown>,
    path: string,
): Record<string, unknown> | null {
    const identity = storageIdentityFromPath(path);
    if (!identity) {
        return null;
    }
    const agri = toAgriDocument(document);
    agri.file_type = identity.fileType;
    agri.vehicle_id = identity.vehicleId;
    return { ...agri, filename: identity.filename };
}

async function readError(response: Response, fallback: string): Promise<string> {
    try {
        const body: unknown = await response.json();
        const record = asRecord(body);
        if (typeof record?.error === 'string' && record.error) {
            return record.error;
        }
    } catch {
        // Keep the HTTP fallback when the body is not JSON.
    }
    return `${fallback} (${response.status})`;
}

export async function saveMissionDocument(
    document: Record<string, unknown>,
    path: string,
): Promise<string> {
    const request = toSaveRequest(document, path);
    if (!request) {
        throw new Error(`Invalid trajectory path: ${path}`);
    }
    const agri = { ...request };
    delete agri.filename;
    const validate = await fetch('/api/trajectories/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agri),
    });
    if (!validate.ok) {
        throw new Error(await readError(validate, 'POST /api/trajectories/validate failed'));
    }
    const save = await fetch('/api/trajectories', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Storage-Mode': 'local',
        },
        body: JSON.stringify(request),
    });
    if (!save.ok) {
        throw new Error(await readError(save, 'POST /api/trajectories failed'));
    }
    const body = asRecord(await save.json());
    return typeof body?.path === 'string' && body.path
        ? body.path
        : `${String(request.file_type)}/${String(request.vehicle_id)}/${String(request.filename)}`;
}
