import { fetchFarm, fetchFarmMission, fetchFarmTree, saveFarmMission, type FarmTree } from '../app/farm-api';

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

/** Studio lists only `mission_order/` of the open farm. `/app` keeps `uploads/`. */
export function missionsFromFarmTree(tree: FarmTree): MissionRef[] {
    return (tree.mission_order ?? []).map((entry) => ({
        path: entry.path,
        name: entry.display_name || entry.name,
        type: 'mission_order',
        vehicle: 'v1',
    }));
}

export async function fetchMissionList(): Promise<MissionRef[]> {
    const farm = await fetchFarm();
    if (!farm.farm) {
        return [];
    }
    return missionsFromFarmTree(await fetchFarmTree('mission_order'));
}

export async function fetchMissionDocument(path: string): Promise<unknown> {
    if (isFarmMissionPath(path)) {
        return fetchFarmMission(path);
    }
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

export function suggestedMissionPath(document: Record<string, unknown>, now = new Date()): string {
    const fileType =
        String(document.file_type ?? 'mission_order').replace(/[^\w-]+/g, '') || 'mission_order';
    const vehicleId = String(document.vehicle_id ?? 'v1').replace(/[^\w.-]+/g, '') || 'v1';
    const metadata = asRecord(document.metadata);
    const brief = asRecord(metadata?.srbc_mission_brief);
    const field = String(brief?.field_id || 'mission')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    const stamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        '-',
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
    ].join('');
    const stem = field || 'mission';
    return `${fileType}/${vehicleId}/${stem}-${stamp}.json`;
}

/** CdC L13 §2.3: lowercase, hyphens, no accent, no space. */
export function slugifyFarmToken(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
}

export function uniquifyFarmFilename(filename: string, existing: readonly string[]): string {
    const taken = new Set(existing.map((name) => name.toLowerCase()));
    const withExt = filename.toLowerCase().endsWith('.json') ? filename : `${filename}.json`;
    if (!taken.has(withExt.toLowerCase())) {
        return withExt;
    }
    const stem = withExt.replace(/\.json$/i, '');
    for (let index = 2; index < 1000; index += 1) {
        const candidate = `${stem}-${index}.json`;
        if (!taken.has(candidate.toLowerCase())) {
            return candidate;
        }
    }
    return `${stem}-${Date.now()}.json`;
}

/**
 * `AAAA-MM-DD_<parcelle-slug>_<operation-slug>.json`, with -2, -3 on collision.
 * When the operator named the mission, that name replaces the parcelle/operation pair.
 */
export function farmMissionFilename(
    document: Record<string, unknown>,
    existing: readonly string[] = [],
    now = new Date(),
): string {
    const metadata = asRecord(document.metadata);
    const brief = asRecord(metadata?.srbc_mission_brief);
    const stamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const named = typeof brief?.name === 'string' ? slugifyFarmToken(brief.name) : '';
    if (named) {
        return uniquifyFarmFilename(`${stamp}_${named}.json`, existing);
    }
    const field =
        slugifyFarmToken(String(brief?.field_name || brief?.field_id || 'parcelle')) || 'parcelle';
    const operation = slugifyFarmToken(String(brief?.operation || 'operation')) || 'operation';
    return uniquifyFarmFilename(`${stamp}_${field}_${operation}.json`, existing);
}

export function isFarmMissionPath(path: string | null | undefined): boolean {
    if (!path) {
        return false;
    }
    const parts = path.split(/[\\/]/).filter(Boolean);
    return (
        parts.length === 2 &&
        parts[0] === 'mission_order' &&
        Boolean(parts[1]?.toLowerCase().endsWith('.json'))
    );
}

export function farmMissionPathFromName(filename: string): string {
    const safe = filename.toLowerCase().endsWith('.json') ? filename : `${filename}.json`;
    return `mission_order/${safe.split(/[\\/]/).pop() ?? safe}`;
}

/** First save of a Studio draft: choose a readable, collision-free farm filename. */
export async function newFarmMissionPath(document: Record<string, unknown>): Promise<string> {
    let existing: string[] = [];
    try {
        const tree = await fetchFarmTree('mission_order');
        existing = (tree.mission_order ?? []).map((entry) => entry.name);
    } catch {
        // The write will surface the real farm/API error; naming itself stays deterministic.
    }
    return farmMissionPathFromName(farmMissionFilename(document, existing));
}

export async function saveMissionDocument(
    document: Record<string, unknown>,
    path: string,
): Promise<string> {
    if (isFarmMissionPath(path)) {
        return saveFarmMission(path, toAgriDocument(document));
    }
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

/** Naked Agri v3 download: `filename` is an editor-only key and must not ship. */
export function downloadAgriDocument(agri: Record<string, unknown>, filename: string): void {
    const payload = toAgriDocument(agri);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = globalThis.document.createElement('a');
    link.href = url;
    link.download = filename.toLowerCase().endsWith('.json') ? filename : `${filename}.json`;
    globalThis.document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
