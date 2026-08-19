/** Map captions (CdCF UX §4.3 « Caption carte »). Not a dedicated MAP-xxx item. */

export const ROW_LABEL_MIN_ZOOM = 18;

export function userMapLabel(name: string | null | undefined): string {
    return (name ?? '').trim();
}

/** Rows / beds: custom name, otherwise the agronomic number. */
export function numberedMapLabel(name: string | null | undefined, number: number): string {
    return userMapLabel(name) || String(number);
}

export function shouldShowCatalogueLabel(options: {
    labelsVisible: boolean;
    overlayVisible: boolean;
    kind: string;
    zoom: number;
    label: string;
}): boolean {
    if (!options.labelsVisible || !options.overlayVisible || !options.label) {
        return false;
    }
    if ((options.kind === 'row' || options.kind === 'bed') && options.zoom < ROW_LABEL_MIN_ZOOM) {
        return false;
    }
    return true;
}

function ringCentroid(ring: Array<[number, number]>): [number, number] | null {
    let sumLng = 0;
    let sumLat = 0;
    let count = 0;
    const last = ring.length - 1;
    for (let index = 0; index < ring.length; index += 1) {
        const pair = ring[index];
        if (!pair || pair.length < 2) {
            continue;
        }
        if (index === last && count > 0 && pair[0] === ring[0]?.[0] && pair[1] === ring[0]?.[1]) {
            break;
        }
        sumLng += Number(pair[0]);
        sumLat += Number(pair[1]);
        count += 1;
    }
    if (count === 0) {
        return null;
    }
    return [sumLng / count, sumLat / count];
}

function lineMidpoint(coordinates: Array<[number, number]>): [number, number] | null {
    const points = coordinates.filter(
        (pair): pair is [number, number] =>
            Array.isArray(pair) &&
            pair.length >= 2 &&
            Number.isFinite(pair[0]) &&
            Number.isFinite(pair[1]),
    );
    const first = points[0];
    if (!first) {
        return null;
    }
    if (points.length === 1) {
        return [first[0], first[1]];
    }
    let total = 0;
    const segments: number[] = [];
    for (let index = 1; index < points.length; index += 1) {
        const prev = points[index - 1];
        const curr = points[index];
        if (!prev || !curr) {
            continue;
        }
        const length = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
        segments.push(length);
        total += length;
    }
    if (total === 0) {
        return [first[0], first[1]];
    }
    let remaining = total / 2;
    for (let index = 1; index < points.length; index += 1) {
        const prev = points[index - 1];
        const curr = points[index];
        const length = segments[index - 1] ?? 0;
        if (!prev || !curr) {
            continue;
        }
        if (remaining <= length) {
            const t = length === 0 ? 0 : remaining / length;
            return [prev[0] + t * (curr[0] - prev[0]), prev[1] + t * (curr[1] - prev[1])];
        }
        remaining -= length;
    }
    const last = points[points.length - 1] ?? first;
    return [last[0], last[1]];
}

export function labelAnchorLngLat(geometry: {
    type?: string;
    coordinates?: unknown;
}): [number, number] | null {
    if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
        const lng = Number(geometry.coordinates[0]);
        const lat = Number(geometry.coordinates[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return null;
        }
        return [lng, lat];
    }
    if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
        return lineMidpoint(geometry.coordinates as Array<[number, number]>);
    }
    if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
        const ring = geometry.coordinates[0];
        if (!Array.isArray(ring)) {
            return null;
        }
        return ringCentroid(ring as Array<[number, number]>);
    }
    return null;
}

export const POINT_LABEL_OFFSET_PX = 12;
