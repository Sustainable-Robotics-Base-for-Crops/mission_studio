export interface PlaceHit {
    label: string;
    lat: number;
    lon: number;
    type: string;
    provider: string;
}

export function normalizePlaceHits(payload: unknown): PlaceHit[] {
    const rows = Array.isArray(payload)
        ? payload
        : payload !== null &&
            typeof payload === 'object' &&
            Array.isArray((payload as { results?: unknown }).results)
          ? (payload as { results: unknown[] }).results
          : [];
    const hits: PlaceHit[] = [];
    for (const row of rows) {
        if (row === null || typeof row !== 'object') {
            continue;
        }
        const record = row as Record<string, unknown>;
        const lat = Number(record.lat);
        const lon = Number(record.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            continue;
        }
        hits.push({
            label: String(record.label ?? ''),
            lat,
            lon,
            type: String(record.type ?? ''),
            provider: String(record.provider ?? ''),
        });
    }
    return hits;
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceHit[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
        return [];
    }
    const response = await fetch(`/api/geocoding/search?q=${encodeURIComponent(trimmed)}`, {
        signal,
    });
    if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `GET /api/geocoding/search failed (${response.status})`);
    }
    return normalizePlaceHits(await response.json());
}
