import type {
    CombinationTwin,
    FieldSource,
    ImplementKind,
    ImplementTwin,
    Kinematics,
    VehicleTwin,
} from '../domain/equipment';
import { parseOddProfile } from '../domain/odd';

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
    if (response.status === 204) {
        return undefined as T;
    }
    return (await response.json()) as T;
}

export async function fetchEquipmentHealth(): Promise<boolean> {
    const response = await fetch('/api/v1/health');
    if (!response.ok) {
        return false;
    }
    const body = asRecord(await response.json());
    return body?.sqlite === true;
}

export async function fetchCatalogue(): Promise<{
    vehicles: VehicleTwin[];
    implements: ImplementTwin[];
    combinations: CombinationTwin[];
}> {
    const body = await request<{
        vehicles?: VehicleTwin[];
        implements?: ImplementTwin[];
        combinations?: CombinationTwin[];
    }>('/api/v1/equipment');
    return {
        vehicles: Array.isArray(body.vehicles) ? body.vehicles : [],
        implements: Array.isArray(body.implements) ? body.implements : [],
        combinations: Array.isArray(body.combinations)
            ? body.combinations.map((item) => ({
                  ...item,
                  odd: parseOddProfile(item.odd),
              }))
            : [],
    };
}

export async function patchVehicle(
    id: string,
    payload: Record<string, unknown>,
): Promise<VehicleTwin> {
    return request<VehicleTwin>(`/api/v1/equipment/vehicles/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    });
}

export async function createVehicle(payload: {
    id?: string;
    name: string;
    kinematics?: Kinematics;
    length_m: number;
    width_m: number;
    mass_kg?: number | null;
}): Promise<VehicleTwin> {
    return request<VehicleTwin>('/api/v1/equipment/vehicles', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function deleteVehicle(id: string): Promise<void> {
    await request(`/api/v1/equipment/vehicles/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function patchImplement(
    id: string,
    payload: Record<string, unknown>,
): Promise<ImplementTwin> {
    return request<ImplementTwin>(`/api/v1/equipment/implements/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    });
}

export async function createImplement(payload: {
    id?: string;
    name: string;
    kind?: ImplementKind;
    physical_width_m: number;
    working_width_m: number;
    length_m?: number;
    drawbar_length_m?: number | null;
}): Promise<ImplementTwin> {
    return request<ImplementTwin>('/api/v1/equipment/implements', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function deleteImplement(id: string): Promise<void> {
    await request(`/api/v1/equipment/implements/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

function asCombination(raw: CombinationTwin): CombinationTwin {
    return { ...raw, odd: parseOddProfile(raw.odd) };
}

export async function patchCombination(
    id: string,
    payload: Record<string, unknown>,
): Promise<CombinationTwin> {
    const next = await request<CombinationTwin>(
        `/api/v1/equipment/combinations/${encodeURIComponent(id)}`,
        {
            method: 'PATCH',
            body: JSON.stringify(payload),
        },
    );
    return asCombination(next);
}

export async function createCombination(payload: {
    name: string;
    vehicle_id: string;
    implement_id?: string | null;
}): Promise<CombinationTwin> {
    const next = await request<CombinationTwin>('/api/v1/equipment/combinations', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    return asCombination(next);
}

export async function deleteCombination(id: string): Promise<void> {
    await request(`/api/v1/equipment/combinations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export type { FieldSource };
