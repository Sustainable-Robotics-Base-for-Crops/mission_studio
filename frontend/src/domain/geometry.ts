/** Same planar approximation as GeometryUtils.js (legacy editor). */
export const METERS_PER_DEGREE = 111320;

/** Point spacing for turns and row_line → row_path densification (10 cm). */
export const TURN_PATH_SPACING_M = 0.1;

export interface Wgs84Origin {
    lat: number;
    lon: number;
}

export interface LatLng {
    lat: number;
    lng: number;
}

export interface LocalXy {
    x: number;
    y: number;
}

export function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}

export function getDistanceMeters(p1: LatLng, p2: LatLng): number {
    const latMid = ((p1.lat + p2.lat) / 2) * (Math.PI / 180);
    const dx = (p2.lng - p1.lng) * METERS_PER_DEGREE * Math.cos(latMid);
    const dy = (p2.lat - p1.lat) * METERS_PER_DEGREE;
    return Math.sqrt(dx * dx + dy * dy);
}

/** Display string for the ruler — tabular, two decimals, locale-aware. */
export function formatDistanceMeters(meters: number, locale = 'fr-FR'): string {
    if (!Number.isFinite(meters) || meters < 0) {
        return '—';
    }
    const formatter = new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    if (meters >= 1000) {
        return `${formatter.format(meters / 1000)} km`;
    }
    return `${formatter.format(meters)} m`;
}

export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const bearing = Math.atan2(y, x);
    return ((bearing * 180) / Math.PI + 360) % 360;
}

export function getLineCoefs(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
): [number, number, number] {
    const a = y2 - y1;
    const b = x1 - x2;
    const c = x2 * y1 - x1 * y2;
    return [a, b, c];
}

export function projectPointOnLine(
    px: number,
    py: number,
    coefs: [number, number, number],
): [number, number] {
    const [a, b, c] = coefs;
    const denom = a * a + b * b;
    if (denom === 0.0) {
        return [px, py];
    }
    const x = (b * (b * px - a * py) - a * c) / denom;
    const y = (a * (-b * px + a * py) - b * c) / denom;
    return [x, y];
}

export function normalize(x: number, y: number): [number, number] {
    const len = Math.sqrt(x * x + y * y);
    return len > 0 ? [x / len, y / len] : [1.0, 0.0];
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
}

export function normalizeAngleToPi(angle: number): number {
    let normalized = angle;
    while (normalized > Math.PI) {
        normalized -= 2.0 * Math.PI;
    }
    while (normalized < -Math.PI) {
        normalized += 2.0 * Math.PI;
    }
    return normalized;
}

export function latLngToLocal(latLng: LatLng, origin: Wgs84Origin): LocalXy {
    const x =
        (latLng.lng - origin.lon) * METERS_PER_DEGREE * Math.cos((origin.lat * Math.PI) / 180);
    const y = (latLng.lat - origin.lat) * METERS_PER_DEGREE;
    return { x, y };
}

export function localDelta(origin: Wgs84Origin, from: LatLng, to: LatLng): LocalXy {
    const start = latLngToLocal(from, origin);
    const end = latLngToLocal(to, origin);
    return { x: end.x - start.x, y: end.y - start.y };
}

export function localToLatLng(local: LocalXy, origin: Wgs84Origin): LatLng {
    const lat = origin.lat + local.y / METERS_PER_DEGREE;
    const lng = origin.lon + local.x / (METERS_PER_DEGREE * Math.cos((origin.lat * Math.PI) / 180));
    return { lat, lng };
}

/** MapLibre / GeoJSON order [lng, lat]. */
export function localToLngLat(x: number, y: number, origin: Wgs84Origin): [number, number] {
    const geo = localToLatLng({ x, y }, origin);
    return [geo.lng, geo.lat];
}

export function estimatePointsForSegment(
    latLngPoints: LatLng[],
    spacing: number,
    origin: Wgs84Origin,
): number {
    if (latLngPoints.length < 2) {
        return 0;
    }

    let estimatedPoints = 0;
    for (let index = 0; index < latLngPoints.length - 1; index += 1) {
        const p1 = latLngPoints[index];
        const p2 = latLngPoints[index + 1];
        if (!p1 || !p2) {
            continue;
        }
        const a = latLngToLocal(p1, origin);
        const b = latLngToLocal(p2, origin);
        const segmentLength = distance(a.x, a.y, b.x, b.y);
        if (segmentLength > 0) {
            estimatedPoints += Math.floor(segmentLength / spacing);
            if (index === 0) {
                estimatedPoints += 1;
            }
        }
    }
    estimatedPoints += 1;
    return estimatedPoints;
}

export function distancePointToSegment(
    point: LatLng,
    segStart: [number, number],
    segEnd: [number, number],
): number {
    const latMid = ((point.lat + segStart[0] + segEnd[0]) / 3) * (Math.PI / 180);
    const scaleX = METERS_PER_DEGREE * Math.cos(latMid);
    const scaleY = METERS_PER_DEGREE;
    const px = (point.lng - segStart[1]) * scaleX;
    const py = (point.lat - segStart[0]) * scaleY;
    const ex = (segEnd[1] - segStart[1]) * scaleX;
    const ey = (segEnd[0] - segStart[0]) * scaleY;
    const segLen2 = ex * ex + ey * ey;
    if (segLen2 === 0) {
        return distance(px, py, 0, 0);
    }
    const t = Math.max(0, Math.min(1, (px * ex + py * ey) / segLen2));
    return distance(px, py, t * ex, t * ey);
}

export function distancePointToPolyline(
    point: LatLng,
    polylinePoints: [number, number][] | null | undefined,
): number {
    if (!polylinePoints || polylinePoints.length < 2) {
        return Infinity;
    }
    let minDistance = Infinity;
    for (let index = 0; index < polylinePoints.length - 1; index += 1) {
        const p1 = polylinePoints[index];
        const p2 = polylinePoints[index + 1];
        if (!p1 || !p2) {
            continue;
        }
        minDistance = Math.min(minDistance, distancePointToSegment(point, p1, p2));
    }
    return minDistance;
}

/** Ray-casting, same as TrajectoryEditor.pointInPolygon. */
export function pointInPolygon(px: number, py: number, polygon: [number, number][]): boolean {
    const count = polygon.length;
    let inside = false;
    for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
        const current = polygon[i];
        const previous = polygon[j];
        if (!current || !previous) {
            continue;
        }
        const [xi, yi] = current;
        const [xj, yj] = previous;
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

function segmentOrientation(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
): number {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Closed interval intersection, including touching endpoints. */
export function segmentsIntersect(
    a: [number, number],
    b: [number, number],
    c: [number, number],
    d: [number, number],
): boolean {
    const o1 = segmentOrientation(a[0], a[1], b[0], b[1], c[0], c[1]);
    const o2 = segmentOrientation(a[0], a[1], b[0], b[1], d[0], d[1]);
    const o3 = segmentOrientation(c[0], c[1], d[0], d[1], a[0], a[1]);
    const o4 = segmentOrientation(c[0], c[1], d[0], d[1], b[0], b[1]);
    if (o1 === 0 && o2 === 0 && o3 === 0 && o4 === 0) {
        const overlapX =
            Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <=
            Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0]));
        const overlapY =
            Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <=
            Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]));
        return overlapX && overlapY;
    }
    return o1 * o2 <= 0 && o3 * o4 <= 0;
}

/** True if the segment crosses the polygon or has an endpoint inside. */
export function segmentIntersectsPolygon(
    start: [number, number],
    end: [number, number],
    polygon: [number, number][],
): boolean {
    if (pointInPolygon(start[0], start[1], polygon) || pointInPolygon(end[0], end[1], polygon)) {
        return true;
    }
    for (let index = 0; index < polygon.length; index += 1) {
        const current = polygon[index];
        const next = polygon[(index + 1) % polygon.length];
        if (!current || !next) {
            continue;
        }
        if (segmentsIntersect(start, end, current, next)) {
            return true;
        }
    }
    return false;
}

const CLIP_EPS = 1e-9;

/** Parameter t ∈ [0, 1] on AB where AB crosses CD, or null if they miss / are parallel. */
export function segmentIntersectionT(
    a: [number, number],
    b: [number, number],
    c: [number, number],
    d: [number, number],
): number | null {
    const rx = b[0] - a[0];
    const ry = b[1] - a[1];
    const sx = d[0] - c[0];
    const sy = d[1] - c[1];
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) < CLIP_EPS) {
        return null;
    }
    const qpx = c[0] - a[0];
    const qpy = c[1] - a[1];
    const t = (qpx * sy - qpy * sx) / denom;
    const u = (qpx * ry - qpy * rx) / denom;
    if (t < -CLIP_EPS || t > 1 + CLIP_EPS || u < -CLIP_EPS || u > 1 + CLIP_EPS) {
        return null;
    }
    return Math.min(1, Math.max(0, t));
}

function uniqueSortedTs(values: number[]): number[] {
    const sorted = [...values].sort((left, right) => left - right);
    const out: number[] = [];
    for (const value of sorted) {
        const last = out[out.length - 1];
        if (last === undefined || value - last > CLIP_EPS) {
            out.push(value);
        }
    }
    return out;
}

function lerpPoint(p: [number, number], q: [number, number], t: number): [number, number] {
    return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
}

/**
 * Keep the parts of a polyline that lie **outside** `polygon`.
 * A `row_line` of two endpoints is split at the polygon boundary — not only
 * when a vertex sits inside (the fill-parcel / cut-tool case).
 */
export function clipPolylineOutsidePolygon(
    points: [number, number][],
    polygon: [number, number][],
): [number, number][][] {
    if (points.length < 2 || polygon.length < 3) {
        return points.length >= 2 ? [points.map((point) => [point[0], point[1]])] : [];
    }
    const runs: [number, number][][] = [];
    let current: [number, number][] = [];

    const pushPoint = (pt: [number, number]) => {
        const last = current[current.length - 1];
        if (last && Math.abs(last[0] - pt[0]) < 1e-6 && Math.abs(last[1] - pt[1]) < 1e-6) {
            return;
        }
        current.push(pt);
    };
    const flush = () => {
        if (current.length >= 2) {
            runs.push(current);
        }
        current = [];
    };

    for (let index = 0; index < points.length - 1; index += 1) {
        const p = points[index];
        const q = points[index + 1];
        if (!p || !q) {
            continue;
        }
        const ts = [0, 1];
        for (let edge = 0; edge < polygon.length; edge += 1) {
            const c = polygon[edge];
            const d = polygon[(edge + 1) % polygon.length];
            if (!c || !d) {
                continue;
            }
            const t = segmentIntersectionT(p, q, c, d);
            if (t !== null) {
                ts.push(t);
            }
        }
        const sorted = uniqueSortedTs(ts);
        for (let k = 0; k < sorted.length - 1; k += 1) {
            const t0 = sorted[k];
            const t1 = sorted[k + 1];
            if (t0 === undefined || t1 === undefined || t1 - t0 < CLIP_EPS) {
                continue;
            }
            const mid = lerpPoint(p, q, (t0 + t1) / 2);
            if (pointInPolygon(mid[0], mid[1], polygon)) {
                flush();
            } else {
                pushPoint(lerpPoint(p, q, t0));
                pushPoint(lerpPoint(p, q, t1));
            }
        }
    }
    flush();
    return runs;
}

/**
 * Insert vertices every `spacing` m, matching densifyRowLineSectionToRowPath
 * for the (x, y) columns.
 */
export function densifyXY(
    points: [number, number][],
    spacing: number = TURN_PATH_SPACING_M,
): [number, number][] {
    if (points.length < 2) {
        return points.map((point) => [point[0], point[1]]);
    }
    const out: [number, number][] = [];
    for (let index = 0; index < points.length - 1; index += 1) {
        const a = points[index];
        const b = points[index + 1];
        if (!a || !b) {
            continue;
        }
        const d = distance(a[0], a[1], b[0], b[1]);
        if (index === 0) {
            out.push([a[0], a[1]]);
        }
        if (d < 1e-9) {
            out.push([b[0], b[1]]);
            continue;
        }
        for (let step = 1; step * spacing < d; step += 1) {
            const t = (step * spacing) / d;
            out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        }
        out.push([b[0], b[1]]);
    }
    return out;
}

/** Left perpendicular of first→last, same as TrajectoryEditor.getSectionPerpendicular. */
export function leftPerpendicular(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
): { perpX: number; perpY: number } {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-9) {
        return { perpX: 1, perpY: 0 };
    }
    return { perpX: -dy / len, perpY: dx / len };
}

/** Rigid lateral offset of a polyline (one perpendicular from endpoints). */
export function offsetXY(points: [number, number][], distanceM: number): [number, number][] {
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last || points.length < 2) {
        return points.map((point) => [round3(point[0]), round3(point[1])]);
    }
    const { perpX, perpY } = leftPerpendicular(first[0], first[1], last[0], last[1]);
    return points.map((point) => [
        round3(point[0] + distanceM * perpX),
        round3(point[1] + distanceM * perpY),
    ]);
}
