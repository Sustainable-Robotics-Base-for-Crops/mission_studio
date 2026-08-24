import { createEmptyDocument, setDrawnGeofence } from '../domain/draft';
import type { AgriDocument } from '../domain/agri';
import { appendGeofenceExclusion } from '../domain/geofence';
import type { LatLng } from '../domain/geometry';
import { offsetLatLngRing } from '../domain/polygon-offset';
import type { FieldDetail, FieldSummary, GeoJSONPolygon } from '../fields/types';
import { briefToMetadata, defaultMissionBrief, ringFromPolygon } from './brief';

export const DEFAULT_FIELD_GEOFENCE_INSET_CM = 25;

export interface MissionFromFieldOptions {
    /** Positive clearance inside the outer boundary and around exclusion islands. */
    geofenceInsetCm?: number;
}

function asPolygon(geometry: { type?: string } | null | undefined): GeoJSONPolygon | null {
    return geometry?.type === 'Polygon' ? (geometry as GeoJSONPolygon) : null;
}

function ringFromCoords(ring: unknown): LatLng[] {
    return ringFromPolygon({ type: 'Polygon', coordinates: [Array.isArray(ring) ? ring : []] });
}

export function interiorRingsFromPolygon(geometry: GeoJSONPolygon | null | undefined): LatLng[][] {
    const holes = geometry?.coordinates?.slice(1) ?? [];
    return holes.map(ringFromCoords).filter((ring) => ring.length >= 3);
}

export function exclusionRingsFromField(field: FieldSummary | FieldDetail): LatLng[][] {
    const exclusions = interiorRingsFromPolygon(field.geometry);
    if (!('zones' in field) || !Array.isArray(field.zones)) {
        return exclusions;
    }
    for (const zone of field.zones) {
        if (zone.kind !== 'forbidden') {
            continue;
        }
        const ring = ringFromPolygon(zone.geometry);
        if (ring.length >= 3) {
            exclusions.push(ring);
        }
    }
    if (!Array.isArray(field.obstacles)) {
        return exclusions;
    }
    for (const obstacle of field.obstacles) {
        const ring = ringFromPolygon(asPolygon(obstacle.geometry));
        if (ring.length >= 3) {
            exclusions.push(ring);
        }
    }
    return exclusions;
}

export function composeMissionFromField(
    field: FieldSummary | FieldDetail,
    options: MissionFromFieldOptions = {},
): AgriDocument | null {
    const boundary = ringFromPolygon(field.geometry);
    if (boundary.length < 3) {
        return null;
    }
    const requestedInset = options.geofenceInsetCm ?? DEFAULT_FIELD_GEOFENCE_INSET_CM;
    const insetM = Math.max(0, Number.isFinite(requestedInset) ? requestedInset : 0) / 100;
    // A plot too small to shrink keeps its raw outline rather than losing its geofence.
    const exterior = insetM > 0 ? (offsetLatLngRing(boundary, insetM) ?? boundary) : boundary;
    const fenced = setDrawnGeofence(createEmptyDocument(), exterior);
    if (!fenced.ok) {
        return null;
    }
    let document = fenced.document;
    for (const ring of exclusionRingsFromField(field)) {
        // Islands grow by the same margin, so the clearance is the same on every edge.
        const grown = insetM > 0 ? offsetLatLngRing(ring, -insetM) : ring;
        document =
            (grown ? appendGeofenceExclusion(document, grown) : null) ??
            appendGeofenceExclusion(document, ring) ??
            document;
    }
    const brief = defaultMissionBrief();
    brief.field_id = field.id;
    brief.field_name = field.name;
    if (field.campaign) {
        brief.campaign = field.campaign;
    }
    const metadata =
        document.metadata !== null && typeof document.metadata === 'object'
            ? { ...(document.metadata as Record<string, unknown>) }
            : {};
    metadata.srbc_mission_brief = briefToMetadata(brief);
    return { ...document, metadata };
}
