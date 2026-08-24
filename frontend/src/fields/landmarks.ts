/**
 * Landmark traces of the parcellaire ruler: a measure, a circle, a free polygon
 * or a labelled point. Pure so the panel and the hook share one set of rules.
 */
import { getDistanceMeters, METERS_PER_DEGREE, type LatLng } from '../domain/geometry';
import { lineFromDraft, pointFromDraft, polygonAreaM2, ringFromDraft } from './geojson';
import type { GeoJSONLineString, GeoJSONPoint, GeoJSONPolygon } from './types';

export const LANDMARK_KINDS = ['measure', 'circle', 'polygon', 'point'] as const;
export type LandmarkKind = (typeof LANDMARK_KINDS)[number];

export const DEFAULT_CIRCLE_RADIUS_M = 10;
export const LANDMARK_CLOSE_M = 2;

export interface LandmarkLiveMeasure {
    /** Last open segment, or the finished ruler. */
    lastSegmentM: number | null;
    /** Every committed segment of a polygon. */
    segmentsM: number[];
    areaM2: number | null;
}

export function landmarkDefaultName(kind: LandmarkKind): string {
    if (kind === 'measure') {
        return 'Règle';
    }
    if (kind === 'circle') {
        return 'Cercle';
    }
    if (kind === 'polygon') {
        return 'Polygone';
    }
    return 'Point';
}

export function offsetLngLat(center: LatLng, eastM: number, northM: number): LatLng {
    const scaleX = METERS_PER_DEGREE * Math.cos((center.lat * Math.PI) / 180);
    return {
        lng: center.lng + eastM / scaleX,
        lat: center.lat + northM / METERS_PER_DEGREE,
    };
}

/** Regular polygon that reads as a circle at field scale. */
export function circleRing(center: LatLng, radiusM: number, steps = 48): LatLng[] {
    const safe = Number.isFinite(radiusM) && radiusM > 0 ? radiusM : 0;
    if (safe <= 0) {
        return [];
    }
    const ring: LatLng[] = [];
    for (let index = 0; index < steps; index += 1) {
        const angle = (index / steps) * Math.PI * 2;
        ring.push(offsetLngLat(center, Math.sin(angle) * safe, Math.cos(angle) * safe));
    }
    return ring;
}

export function circlePolygon(center: LatLng, radiusM: number): GeoJSONPolygon | null {
    return ringFromDraft(circleRing(center, radiusM));
}

export function nearFirstPoint(
    points: LatLng[],
    candidate: LatLng,
    toleranceM = LANDMARK_CLOSE_M,
): boolean {
    const first = points[0];
    return Boolean(first && getDistanceMeters(first, candidate) <= toleranceM);
}

function closePolygonPreview(draft: LatLng[]): LatLng[] {
    const first = draft[0];
    const last = draft[draft.length - 1];
    if (!first || draft.length < 3) {
        return draft;
    }
    if (last && last.lat === first.lat && last.lng === first.lng) {
        return draft;
    }
    return [...draft, first];
}

export function previewDraft(
    kind: LandmarkKind,
    draft: LatLng[],
    hover: LatLng | null,
    ready = false,
): LatLng[] {
    if (kind === 'polygon' && ready && draft.length >= 3) {
        return closePolygonPreview(draft);
    }
    if (ready || !hover) {
        return draft;
    }
    if ((kind === 'measure' || kind === 'circle') && draft.length === 1) {
        return [...draft, hover];
    }
    if (kind === 'polygon' && draft.length >= 1) {
        if (draft.length >= 3 && nearFirstPoint(draft, hover)) {
            return closePolygonPreview(draft);
        }
        return [...draft, hover];
    }
    return draft;
}

export interface LandmarkClickResult {
    draft: LatLng[];
    radiusM: number;
    /** Draft is complete: Tracer persists it; another map click starts over. */
    ready: boolean;
}

/**
 * Map clicks only prepare a draft. Persistence is the « Tracer sur la carte » button.
 * A click after `ready` starts a new draft, unless `restartIfReady` is false (circle edit).
 */
export function applyLandmarkClick(
    kind: LandmarkKind,
    draft: LatLng[],
    point: LatLng,
    radiusM: number,
    ready = false,
    restartIfReady = true,
): LandmarkClickResult {
    if (ready && restartIfReady) {
        if (kind === 'point') {
            return { draft: [point], radiusM, ready: true };
        }
        return { draft: [point], radiusM, ready: false };
    }
    if (kind === 'point') {
        return { draft: [point], radiusM, ready: true };
    }
    if (kind === 'circle') {
        const center = draft[0];
        if (!center) {
            return { draft: [point], radiusM, ready: false };
        }
        const radius = getDistanceMeters(center, point);
        if (radius <= LANDMARK_CLOSE_M) {
            return { draft, radiusM, ready };
        }
        return { draft: [center], radiusM: radius, ready: true };
    }
    if (kind === 'polygon') {
        if (draft.length >= 3 && nearFirstPoint(draft, point)) {
            return { draft, radiusM, ready: true };
        }
        return { draft: [...draft, point], radiusM, ready: false };
    }
    const origin = draft[0];
    if (!origin) {
        return { draft: [point], radiusM, ready: false };
    }
    if (getDistanceMeters(origin, point) <= LANDMARK_CLOSE_M) {
        return { draft, radiusM, ready };
    }
    return { draft: [origin, point], radiusM, ready: true };
}

export function circleCenterFromGeometry(geometry: {
    type?: string;
    coordinates?: unknown;
}): LatLng | null {
    if (geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) {
        return null;
    }
    const ring = geometry.coordinates[0];
    if (!Array.isArray(ring) || ring.length < 3) {
        return null;
    }
    const open = ring.slice(0, -1);
    if (open.length === 0) {
        return null;
    }
    let east = 0;
    let north = 0;
    for (const pair of open) {
        if (!Array.isArray(pair)) {
            return null;
        }
        east += Number(pair[0]);
        north += Number(pair[1]);
    }
    return { lng: east / open.length, lat: north / open.length };
}

export function landmarkLiveMeasure(
    kind: LandmarkKind,
    draft: LatLng[],
    hover: LatLng | null,
    ready = false,
): LandmarkLiveMeasure {
    const points = previewDraft(kind, draft, hover, ready);
    const segmentsM: number[] = [];
    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        if (start && end) {
            segmentsM.push(getDistanceMeters(start, end));
        }
    }
    const lastSegmentM = segmentsM[segmentsM.length - 1] ?? null;
    const closed = kind === 'polygon' && draft.length >= 3 ? ringFromDraft(draft) : null;
    return {
        lastSegmentM,
        segmentsM,
        areaM2: closed ? polygonAreaM2(closed) : null,
    };
}

export function canPinLandmark(kind: LandmarkKind, draft: LatLng[], radiusM: number): boolean {
    if (kind === 'measure') {
        return draft.length >= 2;
    }
    if (kind === 'circle') {
        return draft.length >= 1 && Number.isFinite(radiusM) && radiusM > 0;
    }
    if (kind === 'polygon') {
        return draft.length >= 3;
    }
    return draft.length >= 1;
}

export function landmarkGeometry(
    kind: LandmarkKind,
    draft: LatLng[],
    radiusM: number,
): GeoJSONLineString | GeoJSONPolygon | GeoJSONPoint | null {
    if (kind === 'measure') {
        return lineFromDraft(draft);
    }
    if (kind === 'circle') {
        const center = draft[0];
        return center ? circlePolygon(center, radiusM) : null;
    }
    if (kind === 'polygon') {
        return ringFromDraft(draft);
    }
    return pointFromDraft(draft);
}

export function formatLandmarkMeters(meters: number | null): string | null {
    if (meters === null || !Number.isFinite(meters)) {
        return null;
    }
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${meters.toFixed(1)} m`;
}

export function formatLandmarkGps(point: LatLng): string {
    return `${point.lat.toFixed(7)}°, ${point.lng.toFixed(7)}°`;
}
