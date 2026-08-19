import type { AgriDocument } from '../domain/agri';
import type { SimAttestation } from '../domain/publication';

export interface PublicationMobile {
    synced_at: string | null;
    downloaded_at: string | null;
    received_at: string | null;
    preflight_at: string | null;
    activated_at: string | null;
}

export interface PublicationRecord {
    id: string;
    source_path: string;
    version: number;
    status: 'published' | 'obsolete' | string;
    checksum: string;
    byte_size: number;
    simulation: Record<string, unknown>;
    approver: string;
    published_at: string;
    expires_at: string | null;
    vehicle_id: string | null;
    field_id: string | null;
    combination_id: string | null;
    mobile: PublicationMobile;
    snapshot?: AgriDocument;
}

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
        // HTTP fallback.
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

export async function fetchPublicationHealth(): Promise<boolean> {
    const response = await fetch('/api/v1/health');
    if (!response.ok) {
        return false;
    }
    const body: unknown = await response.json();
    return (
        body !== null && typeof body === 'object' && (body as { sqlite?: unknown }).sqlite === true
    );
}

export async function listPublications(sourcePath?: string | null): Promise<PublicationRecord[]> {
    const query = sourcePath ? `?source_path=${encodeURIComponent(sourcePath)}` : '';
    const body = await request<{ publications?: PublicationRecord[] }>(
        `/api/v1/publications${query}`,
    );
    return Array.isArray(body.publications) ? body.publications : [];
}

export async function createPublication(payload: {
    source_path: string;
    document: AgriDocument;
    simulation: SimAttestation;
    stale: boolean;
    approver: string;
    expires_at: string | null;
    vehicle_id?: string | null;
    field_id?: string | null;
    combination_id?: string | null;
}): Promise<PublicationRecord> {
    return request<PublicationRecord>('/api/v1/publications', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}
