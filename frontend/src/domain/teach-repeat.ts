/** Teach-and-repeat (lot L12b): import a trace, simplify, emit Agri. Pure. */

import { parseAgriDocument, type AgriDocument, type AgriSection } from './agri';
import { createEmptyDocument, roundOriginLatLon } from './draft';
import type { CombinationEnvelope } from './equipment';
import {
    distance,
    latLngToLocal,
    localToLatLng,
    round3,
    type LatLng,
    type LocalXy,
    type Wgs84Origin,
} from './geometry';
import { simulateMission } from './simulation';

export const TEACH_SIMPLIFY_M = 0.25;

export function perpendicularDistance(point: LocalXy, start: LocalXy, end: LocalXy): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) {
        return distance(point.x, point.y, start.x, start.y);
    }
    return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length;
}

export function ramerDouglasPeucker(points: LocalXy[], epsilonM: number): LocalXy[] {
    if (points.length <= 2) {
        return points.slice();
    }
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) {
        return points.slice();
    }
    let maxDist = -1;
    let maxIndex = 0;
    for (let index = 1; index < points.length - 1; index += 1) {
        const point = points[index];
        if (!point) {
            continue;
        }
        const dist = perpendicularDistance(point, first, last);
        if (dist > maxDist) {
            maxDist = dist;
            maxIndex = index;
        }
    }
    if (maxDist <= epsilonM) {
        return [first, last];
    }
    const left = ramerDouglasPeucker(points.slice(0, maxIndex + 1), epsilonM);
    const right = ramerDouglasPeucker(points.slice(maxIndex), epsilonM);
    return [...left.slice(0, -1), ...right];
}

function pairToLatLng(pair: unknown): LatLng | null {
    if (!Array.isArray(pair) || pair.length < 2) {
        return null;
    }
    const a = Number(pair[0]);
    const b = Number(pair[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
        return null;
    }
    return { lng: a, lat: b };
}

function collectLineCoordinates(raw: unknown, into: LatLng[]): void {
    if (Array.isArray(raw) && raw.length >= 2 && typeof raw[0] === 'number') {
        const point = pairToLatLng(raw);
        if (point) {
            into.push(point);
        }
        return;
    }
    if (!Array.isArray(raw)) {
        return;
    }
    for (const item of raw) {
        collectLineCoordinates(item, into);
    }
}

function latLngsFromAgri(document: AgriDocument): LatLng[] {
    const originLat = Number(document.origin?.coordinates?.lat);
    const originLon = Number(document.origin?.coordinates?.lon);
    if (!Number.isFinite(originLat) || !Number.isFinite(originLon)) {
        return [];
    }
    const origin: Wgs84Origin = { lat: originLat, lon: originLon };
    const points: LatLng[] = [];
    for (const section of document.points) {
        const xIndex = section.columns.indexOf('x');
        const yIndex = section.columns.indexOf('y');
        if (xIndex < 0 || yIndex < 0) {
            continue;
        }
        for (const row of section.values) {
            const x = Number(row[xIndex]);
            const y = Number(row[yIndex]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                continue;
            }
            points.push(localToLatLng({ x, y }, origin));
        }
    }
    return points;
}

export function latLngsFromUnknown(raw: unknown): LatLng[] {
    const agri = parseAgriDocument(raw);
    if (agri && agri.points.length > 0) {
        const fromAgri = latLngsFromAgri(agri);
        if (fromAgri.length >= 2) {
            return fromAgri;
        }
    }
    const points: LatLng[] = [];
    if (raw !== null && typeof raw === 'object') {
        const record = raw as Record<string, unknown>;
        if (record.type === 'FeatureCollection' && Array.isArray(record.features)) {
            for (const feature of record.features) {
                latLngsFromUnknown(feature).forEach((point) => points.push(point));
            }
            return points;
        }
        if (record.type === 'Feature') {
            return latLngsFromUnknown(record.geometry);
        }
        if (record.type === 'LineString' || record.type === 'MultiLineString') {
            collectLineCoordinates(record.coordinates, points);
            return points;
        }
        if (Array.isArray(record.coordinates)) {
            collectLineCoordinates(record.coordinates, points);
            return points;
        }
    }
    if (Array.isArray(raw)) {
        collectLineCoordinates(raw, points);
    }
    return points;
}

function pathSection(points: LocalXy[], speed = 0.5): AgriSection {
    return {
        section_type: 'row_path',
        columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
        values: points.map((point) => [round3(point.x), round3(point.y), speed, 1, {}]),
    };
}

export function teachRepeatDocument(
    raw: unknown,
    options: { epsilonM?: number; speedMps?: number } = {},
): AgriDocument | null {
    const latLngs = latLngsFromUnknown(raw);
    if (latLngs.length < 2) {
        return null;
    }
    const first = latLngs[0];
    if (!first) {
        return null;
    }
    const origin = roundOriginLatLon(first.lat, first.lng);
    const local = latLngs.map((point) => latLngToLocal(point, origin));
    const simplified = ramerDouglasPeucker(local, options.epsilonM ?? TEACH_SIMPLIFY_M);
    if (simplified.length < 2) {
        return null;
    }
    const document = createEmptyDocument();
    document.origin = {
        type: 'WGS84',
        coordinates: { lat: origin.lat, lon: origin.lon, alt: 0 },
    };
    document.points = [pathSection(simplified, options.speedMps ?? 0.5)];
    const metadata =
        document.metadata !== null && typeof document.metadata === 'object'
            ? { ...(document.metadata as Record<string, unknown>) }
            : {};
    metadata.srbc_teach_repeat = {
        source_points: latLngs.length,
        simplified_points: simplified.length,
        epsilon_m: options.epsilonM ?? TEACH_SIMPLIFY_M,
    };
    document.metadata = metadata;
    return document;
}

export function teachRepeatKinematicOk(
    document: AgriDocument,
    envelope: CombinationEnvelope | null,
): { ok: boolean; blockCount: number; tooTight: boolean } {
    const report = simulateMission({ document, envelope, sampleM: 0.5 });
    const tooTight = report.checks.some(
        (check) => check.id === 'kinematics.turnRadius' && check.status === 'block',
    );
    return { ok: report.blockCount === 0, blockCount: report.blockCount, tooTight };
}
