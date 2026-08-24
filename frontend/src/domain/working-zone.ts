import { latLngToLocal, pointInPolygon, round3, type LatLng, type Wgs84Origin } from './geometry';
import type { AgriDocument, AgriSection } from './agri';
import { applyWorkingZoneSplit } from './section';

/** Studio-only rings (Agri `metadata` is a free object). Robot ignores them. */
export const WORKING_ZONE_RINGS_KEY = 'srbc_working_zone_rings';

export type WorkingZoneRing = {
    value: 0 | 1;
    values: [number, number][];
};

export function polygonLocalFromLatLngs(
    latLngs: LatLng[] | null | undefined,
    origin: Wgs84Origin,
): [number, number][] | null {
    if (!latLngs || latLngs.length < 3) {
        return null;
    }
    return latLngs.map((point) => {
        const local = latLngToLocal(point, origin);
        return [round3(local.x), round3(local.y)];
    });
}

export function applyWorkingZoneInPolygon(
    document: AgriDocument,
    polygon: [number, number][] | null,
    value: 0 | 1,
): { count: number; document: AgriDocument } {
    if (!polygon) {
        return { count: 0, document };
    }
    const result = applyWorkingZoneSplit(document.points, polygon, value);
    return { count: result.count, document: { ...document, points: result.sections } };
}

export function getPointsInPolygon(
    sections: AgriSection[],
    polygon: [number, number][] | null,
): Array<{ sectionIndex: number; pointIndex: number }> {
    if (!polygon) {
        return [];
    }
    const list: Array<{ sectionIndex: number; pointIndex: number }> = [];
    sections.forEach((section, sectionIndex) => {
        const xIndex = section.columns.indexOf('x');
        const yIndex = section.columns.indexOf('y');
        if (xIndex < 0 || yIndex < 0) {
            return;
        }
        section.values.forEach((row, pointIndex) => {
            if (pointInPolygon(Number(row[xIndex]), Number(row[yIndex]), polygon)) {
                list.push({ sectionIndex, pointIndex });
            }
        });
    });
    return list;
}

function asRing(value: unknown): WorkingZoneRing | null {
    if (value === null || typeof value !== 'object') {
        return null;
    }
    const record = value as Record<string, unknown>;
    const rawValue = record.value === 0 ? 0 : record.value === 1 ? 1 : null;
    if (rawValue === null || !Array.isArray(record.values)) {
        return null;
    }
    const values: [number, number][] = [];
    for (const row of record.values) {
        if (!Array.isArray(row) || row.length < 2) {
            continue;
        }
        const x = Number(row[0]);
        const y = Number(row[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            values.push([x, y]);
        }
    }
    if (values.length < 3) {
        return null;
    }
    return { value: rawValue, values };
}

export function readWorkingZoneRings(document: AgriDocument | null | undefined): WorkingZoneRing[] {
    const metadata = document?.metadata;
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return [];
    }
    const raw = (metadata as Record<string, unknown>)[WORKING_ZONE_RINGS_KEY];
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.map(asRing).filter((ring): ring is WorkingZoneRing => ring !== null);
}

export function appendWorkingZoneRing(
    document: AgriDocument,
    polygon: [number, number][] | null,
    value: 0 | 1,
): AgriDocument {
    if (!polygon || polygon.length < 3) {
        return document;
    }
    const metadata =
        document.metadata !== null &&
        typeof document.metadata === 'object' &&
        !Array.isArray(document.metadata)
            ? { ...(document.metadata as Record<string, unknown>) }
            : {};
    const rings = [...readWorkingZoneRings(document), { value, values: polygon }];
    metadata[WORKING_ZONE_RINGS_KEY] = rings;
    return { ...document, metadata };
}

export function rebaseWorkingZoneRings(
    document: AgriDocument,
    rebasePair: (x: number, y: number) => [number, number],
): AgriDocument {
    const rings = readWorkingZoneRings(document);
    if (rings.length === 0) {
        return document;
    }
    const metadata =
        document.metadata !== null &&
        typeof document.metadata === 'object' &&
        !Array.isArray(document.metadata)
            ? { ...(document.metadata as Record<string, unknown>) }
            : {};
    metadata[WORKING_ZONE_RINGS_KEY] = rings.map((ring) => ({
        value: ring.value,
        values: ring.values.map(([x, y]) => rebasePair(x, y)),
    }));
    return { ...document, metadata };
}
