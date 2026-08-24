import { getSectionTypeString, reverseSection, type AgriDocument, type AgriSection } from './agri';
import { documentOrigin } from './draft';
import {
    distance,
    latLngToLocal,
    localToLatLng,
    pointInPolygon,
    segmentIntersectsPolygon,
    type LatLng,
} from './geometry';
import { polygonLocalFromLatLngs } from './working-zone';

/** Click-to-row threshold in local metres (field scale, ~3 row spacings). */
export const PICK_SECTION_MAX_M = 8;

function sectionLocalPolyline(section: AgriSection): [number, number][] {
    const xIndex = section.columns.indexOf('x');
    const yIndex = section.columns.indexOf('y');
    if (xIndex < 0 || yIndex < 0) {
        return [];
    }
    const points: [number, number][] = [];
    for (const row of section.values) {
        if (!Array.isArray(row)) {
            continue;
        }
        const x = Number(row[xIndex]);
        const y = Number(row[yIndex]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
        }
        points.push([x, y]);
    }
    return points;
}

function distancePointToLocalSegment(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
): number {
    const ex = bx - ax;
    const ey = by - ay;
    const length2 = ex * ex + ey * ey;
    if (length2 === 0) {
        return distance(px, py, ax, ay);
    }
    const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / length2));
    return distance(px, py, ax + t * ex, ay + t * ey);
}

function distancePointToLocalPolyline(
    px: number,
    py: number,
    polyline: [number, number][],
): number {
    if (polyline.length === 0) {
        return Infinity;
    }
    if (polyline.length === 1) {
        const only = polyline[0];
        return only ? distance(px, py, only[0], only[1]) : Infinity;
    }
    let minDistance = Infinity;
    for (let index = 0; index < polyline.length - 1; index += 1) {
        const start = polyline[index];
        const end = polyline[index + 1];
        if (!start || !end) {
            continue;
        }
        minDistance = Math.min(
            minDistance,
            distancePointToLocalSegment(px, py, start[0], start[1], end[0], end[1]),
        );
    }
    return minDistance;
}

/** True if a vertex is inside, or a segment crosses, the polygon (row_line-safe). */
export function sectionIntersectsPolygon(
    section: AgriSection,
    polygon: [number, number][],
): boolean {
    const polyline = sectionLocalPolyline(section);
    if (polyline.length === 0) {
        return false;
    }
    for (const point of polyline) {
        if (pointInPolygon(point[0], point[1], polygon)) {
            return true;
        }
    }
    for (let index = 0; index < polyline.length - 1; index += 1) {
        const start = polyline[index];
        const end = polyline[index + 1];
        if (!start || !end) {
            continue;
        }
        if (segmentIntersectsPolygon(start, end, polygon)) {
            return true;
        }
    }
    return false;
}

export type RowEnd = 'start' | 'end';

export interface RowEndpointHit {
    sectionIndex: number;
    end: RowEnd;
}

export function pickRowEndpoint(
    document: AgriDocument | null | undefined,
    click: LatLng,
    maxDistanceM = PICK_SECTION_MAX_M,
): RowEndpointHit | null {
    const origin = documentOrigin(document);
    if (!origin || !document) {
        return null;
    }
    const local = latLngToLocal(click, origin);
    let best: RowEndpointHit | null = null;
    let bestDistance = Infinity;
    document.points.forEach((section, index) => {
        if (getSectionTypeString(section) !== 'row_line') {
            return;
        }
        const polyline = sectionLocalPolyline(section);
        const first = polyline[0];
        const last = polyline[polyline.length - 1];
        if (first) {
            const distanceM = distance(local.x, local.y, first[0], first[1]);
            if (distanceM < bestDistance) {
                bestDistance = distanceM;
                best = { sectionIndex: index, end: 'start' };
            }
        }
        if (last) {
            const distanceM = distance(local.x, local.y, last[0], last[1]);
            if (distanceM < bestDistance) {
                bestDistance = distanceM;
                best = { sectionIndex: index, end: 'end' };
            }
        }
    });
    return best && bestDistance <= maxDistanceM ? best : null;
}

export function listRowEndpoints(
    document: AgriDocument | null | undefined,
): Array<{ hit: RowEndpointHit; latlng: LatLng }> {
    const origin = documentOrigin(document);
    if (!origin || !document) {
        return [];
    }
    const ends: Array<{ hit: RowEndpointHit; latlng: LatLng }> = [];
    document.points.forEach((section, index) => {
        if (getSectionTypeString(section) !== 'row_line') {
            return;
        }
        const polyline = sectionLocalPolyline(section);
        const first = polyline[0];
        const last = polyline[polyline.length - 1];
        if (first) {
            ends.push({
                hit: { sectionIndex: index, end: 'start' },
                latlng: localToLatLng({ x: first[0], y: first[1] }, origin),
            });
        }
        if (last) {
            ends.push({
                hit: { sectionIndex: index, end: 'end' },
                latlng: localToLatLng({ x: last[0], y: last[1] }, origin),
            });
        }
    });
    return ends;
}

export function pickSectionByProximity(
    document: AgriDocument | null | undefined,
    click: LatLng,
    maxDistanceM = PICK_SECTION_MAX_M,
): number | null {
    const origin = documentOrigin(document);
    if (!origin || !document) {
        return null;
    }
    const local = latLngToLocal(click, origin);
    let bestIndex: number | null = null;
    let bestDistance = Infinity;
    document.points.forEach((section, index) => {
        const distanceM = distancePointToLocalPolyline(
            local.x,
            local.y,
            sectionLocalPolyline(section),
        );
        if (distanceM < bestDistance) {
            bestDistance = distanceM;
            bestIndex = index;
        }
    });
    return bestIndex !== null && bestDistance <= maxDistanceM ? bestIndex : null;
}

export function selectSectionsIntersectingPolygon(
    document: AgriDocument | null | undefined,
    latLngs: LatLng[],
): number[] {
    const origin = documentOrigin(document);
    if (!origin || !document) {
        return [];
    }
    const polygon = polygonLocalFromLatLngs(latLngs, origin);
    if (!polygon) {
        return [];
    }
    const indices: number[] = [];
    document.points.forEach((section, index) => {
        if (sectionIntersectsPolygon(section, polygon)) {
            indices.push(index);
        }
    });
    return indices;
}

export function toggleSelectedIndex(
    selected: readonly number[],
    index: number,
    additive: boolean,
): number[] {
    if (!additive) {
        return selected.length === 1 && selected[0] === index ? [] : [index];
    }
    if (selected.includes(index)) {
        return selected.filter((current) => current !== index);
    }
    return [...selected, index].sort((left, right) => left - right);
}

export function deleteSelectedSections(
    document: AgriDocument,
    indices: readonly number[],
): AgriDocument {
    if (indices.length === 0) {
        return document;
    }
    const drop = new Set(indices);
    return {
        ...document,
        points: document.points.filter((_, index) => !drop.has(index)),
    };
}

export function reverseSelectedSections(
    document: AgriDocument,
    indices: readonly number[],
): AgriDocument {
    if (indices.length === 0) {
        return document;
    }
    const flip = new Set(indices);
    return {
        ...document,
        points: document.points.map((section, index) =>
            flip.has(index) ? reverseSection(section) : section,
        ),
    };
}
