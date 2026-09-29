/** Planar helpers on WGS84 GeoJSON, same scale as `backend/fields/geometry.py`. */

const METERS_PER_DEGREE = 111_320;

function ringAreaM2(ring: unknown, originLat: number): number {
    if (!Array.isArray(ring) || ring.length < 3) {
        return 0;
    }
    const scaleX = METERS_PER_DEGREE * Math.cos((originLat * Math.PI) / 180);
    const points: Array<[number, number]> = [];
    for (const pair of ring) {
        if (!Array.isArray(pair) || pair.length < 2) {
            continue;
        }
        points.push([Number(pair[0]) * scaleX, Number(pair[1]) * METERS_PER_DEGREE]);
    }
    if (points.length < 3) {
        return 0;
    }
    let area = 0;
    points.forEach(([x1, y1], index) => {
        const [x2, y2] = points[(index + 1) % points.length] ?? [x1, y1];
        area += x1 * y2 - x2 * y1;
    });
    return Math.abs(area) / 2;
}

export function polygonAreaM2(geometry: unknown): number | null {
    if (geometry === null || typeof geometry !== 'object') {
        return null;
    }
    const record = geometry as { type?: unknown; coordinates?: unknown };
    if (record.type !== 'Polygon' || !Array.isArray(record.coordinates)) {
        return null;
    }
    const rings = record.coordinates as unknown[];
    const outer = rings[0];
    if (!Array.isArray(outer) || outer.length === 0) {
        return null;
    }
    const first = outer[0];
    const originLat = Array.isArray(first) && first.length > 1 ? Number(first[1]) : 0;
    const holes = rings
        .slice(1)
        .reduce<number>((sum, ring) => sum + ringAreaM2(ring, originLat), 0);
    return ringAreaM2(outer, originLat) - holes;
}

/** JSON with sorted keys and no spaces: the form hashed for checksums. */
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record)
            .filter((key) => record[key] !== undefined)
            .sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

/** Session-only fingerprint (FNV-1a, 32 bits): cheap, synchronous, never persisted. */
export function quickHash(value: unknown): string {
    const text = canonicalJson(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
