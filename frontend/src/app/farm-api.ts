/**
 * Client for /api/v1/farm (L13). The farm folder is the source of truth.
 *
 * The backend can be absent (legacy http.server without FastAPI). Every call
 * therefore reports "unavailable" explicitly instead of throwing into the UI.
 */

export type FarmType = 'market_garden' | 'vineyard' | 'open_field' | 'livestock' | 'mixed';
export type UiMode = 'basic' | 'advanced';
export type FarmKind = 'parcel_map' | 'mission_order' | 'work_performed' | 'equipment';

export const FARM_TYPES: readonly FarmType[] = [
    'market_garden',
    'vineyard',
    'open_field',
    'livestock',
    'mixed',
];

export const FARM_KINDS: readonly FarmKind[] = [
    'parcel_map',
    'mission_order',
    'work_performed',
    'equipment',
];

export interface FarmStartView {
    lat: number;
    lon: number;
    zoom: number;
}

export interface FarmDocument {
    schema: string;
    name: string;
    farm_type: FarmType;
    start_view: FarmStartView;
    language: string;
    theme: 'light' | 'dark';
    ui_mode: UiMode;
    units: string;
    created_at: string;
    updated_at: string;
}

export interface FarmCounts {
    fields: number;
    missions: number;
    work_performed: number;
    equipment: number;
    /** Null when no field carries a usable polygon: show a dash, never a zero. */
    hectares: number | null;
}

export interface FarmSnapshot {
    farm: FarmDocument | null;
    root: string | null;
    counts: FarmCounts;
    recent: string[];
    cropPack: string | null;
}

export interface FarmEntry {
    name: string;
    path: string;
    size: number;
    modified: number;
    field_id?: string | null;
    operation?: string | null;
    campaign?: string | null;
    simulated?: boolean;
    published?: boolean;
    /** The file exists but could not be parsed. Keep it visible so it can be fixed. */
    unreadable?: boolean;
}

export type FarmTree = Partial<Record<FarmKind, FarmEntry[]>>;

export const EMPTY_COUNTS: FarmCounts = {
    fields: 0,
    missions: 0,
    work_performed: 0,
    equipment: 0,
    hectares: null,
};

export const EMPTY_SNAPSHOT: FarmSnapshot = {
    farm: null,
    root: null,
    counts: EMPTY_COUNTS,
    recent: [],
    cropPack: null,
};

/** Thrown when the server refused the request and said why. */
export class FarmError extends Error {}

async function readError(response: Response, fallback: string): Promise<string> {
    try {
        const body: unknown = await response.json();
        if (body !== null && typeof body === 'object') {
            const error = (body as { error?: unknown }).error;
            if (typeof error === 'string' && error) {
                return error;
            }
        }
    } catch {
        // Not JSON: fall through to the HTTP status.
    }
    return `${fallback} (${response.status})`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
        throw new FarmError(await readError(response, `${init?.method ?? 'GET'} ${path} failed`));
    }
    return (await response.json()) as T;
}

/** True when the versioned backend answers, so the farm routes exist. */
export async function fetchFarmAvailable(): Promise<boolean> {
    try {
        const response = await fetch('/api/v1/health');
        return response.ok;
    } catch {
        return false;
    }
}

export async function fetchFarm(): Promise<FarmSnapshot> {
    return request<FarmSnapshot>('/api/v1/farm');
}

export async function updateFarm(patch: Partial<FarmDocument>): Promise<FarmSnapshot> {
    return request<FarmSnapshot>('/api/v1/farm', {
        method: 'PUT',
        body: JSON.stringify(patch),
    });
}

export async function openFarm(root: string, name?: string): Promise<FarmSnapshot> {
    return request<FarmSnapshot>('/api/v1/farm/open', {
        method: 'POST',
        body: JSON.stringify(name ? { root, name } : { root }),
    });
}

export async function fetchFarmTree(kind?: FarmKind): Promise<FarmTree> {
    const query = kind ? `?kind=${encodeURIComponent(kind)}` : '';
    const body = await request<{ tree?: FarmTree }>(`/api/v1/farm/tree${query}`);
    return body.tree ?? {};
}

export async function reindexFarm(): Promise<{ errors: number }> {
    const body = await request<{ errors?: number }>('/api/v1/farm/reindex', { method: 'POST' });
    return { errors: body.errors ?? 0 };
}

/** Folder name of a root path, for display when the full path is too long. */
export function farmFolderName(root: string | null): string {
    if (!root) {
        return '';
    }
    const parts = root.replace(/[/\\]+$/, '').split(/[/\\]/);
    return parts[parts.length - 1] || root;
}
