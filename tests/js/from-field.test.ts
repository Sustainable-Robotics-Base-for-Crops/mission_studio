import { describe, expect, it } from 'vitest';

import type { AgriDocument } from '../../frontend/src/domain/agri';
import {
    polygonAreaM2,
    readGeofenceExclusions,
    readGeofenceExterior,
} from '../../frontend/src/domain/geofence';
import { latLngToLocal } from '../../frontend/src/domain/geometry';
import type { FieldDetail } from '../../frontend/src/fields/types';
import {
    composeMissionFromField,
    DEFAULT_FIELD_GEOFENCE_INSET_CM,
} from '../../frontend/src/missions/from-field';

function square(west: number, south: number, east: number, north: number): number[][] {
    return [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
    ];
}

function sizeOf(ring: [number, number][]): { width: number; height: number } {
    const xs = ring.map(([x]) => x);
    const ys = ring.map(([, y]) => y);
    return {
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
    };
}

/** Size of a raw lon/lat ring, in metres, before any geofence margin is applied. */
function boundarySizeM(ring: number[][]): { width: number; height: number } {
    const origin = { lat: ring[0]?.[1] ?? 0, lon: ring[0]?.[0] ?? 0 };
    return sizeOf(
        ring.map((pair) => {
            const local = latLngToLocal({ lat: pair[1] ?? 0, lng: pair[0] ?? 0 }, origin);
            return [local.x, local.y];
        }),
    );
}

const field: FieldDetail = {
    id: 'champ-nord',
    name: 'Champ Nord',
    campaign: '2026',
    geometry: {
        type: 'Polygon',
        coordinates: [square(3.17, 45.85, 3.172, 45.851), square(3.1705, 45.8503, 3.1708, 45.8505)],
    },
    crs: 'EPSG:4326',
    provenance: {},
    qualified_for_autonomy: true,
    created_at: '2026-08-20T00:00:00Z',
    updated_at: '2026-08-20T00:00:00Z',
    zones: [
        {
            id: 'zone-interdit',
            field_id: 'champ-nord',
            kind: 'forbidden',
            name: 'Mare',
            geometry: { type: 'Polygon', coordinates: [square(3.171, 45.8504, 3.1712, 45.8506)] },
            provenance: {},
            created_at: '2026-08-20T00:00:00Z',
        },
        {
            id: 'zone-tete',
            field_id: 'champ-nord',
            kind: 'headland',
            name: 'Fourrière',
            geometry: { type: 'Polygon', coordinates: [square(3.17, 45.85, 3.1702, 45.8502)] },
            provenance: {},
            created_at: '2026-08-20T00:00:00Z',
        },
    ],
    obstacles: [],
    guidance_lines: [],
    row_sets: [],
    traffic_ways: [],
    traffic_nodes: [],
    landmarks: [],
    version: 1,
};

describe('composeMissionFromField', () => {
    it('builds an Agri draft whose geofence follows the field and its islands', () => {
        const document = composeMissionFromField(field);
        expect(document).not.toBeNull();
        expect(readGeofenceExterior(document).length).toBeGreaterThanOrEqual(4);
        expect(readGeofenceExclusions(document)).toHaveLength(2);
        const brief = (document as AgriDocument).metadata as {
            srbc_mission_brief: { field_id: string; field_name: string };
        };
        expect(brief.srbc_mission_brief.field_id).toBe('champ-nord');
        expect(brief.srbc_mission_brief.field_name).toBe('Champ Nord');
        expect((document as AgriDocument).points).toEqual([]);
    });

    it('keeps the geofence 25 cm inside the surveyed boundary', () => {
        const document = composeMissionFromField({
            ...field,
            geometry: { type: 'Polygon', coordinates: [square(3.17, 45.85, 3.172, 45.851)] },
            zones: [],
            obstacles: [],
        });
        const ring = readGeofenceExterior(document);
        expect(ring).toHaveLength(4);

        const boundary = boundarySizeM(square(3.17, 45.85, 3.172, 45.851));
        const insetM = DEFAULT_FIELD_GEOFENCE_INSET_CM / 100;
        expect(boundary.width - sizeOf(ring).width).toBeCloseTo(2 * insetM, 2);
        expect(boundary.height - sizeOf(ring).height).toBeCloseTo(2 * insetM, 2);
    });

    it('pushes islands outward so the clearance is identical on every edge', () => {
        const document = composeMissionFromField({ ...field, zones: [], obstacles: [] });
        const [island] = readGeofenceExclusions(document);
        expect(island).toBeDefined();

        const hole = boundarySizeM(square(3.1705, 45.8503, 3.1708, 45.8505));
        expect(sizeOf(island ?? []).width - hole.width).toBeCloseTo(
            (2 * DEFAULT_FIELD_GEOFENCE_INSET_CM) / 100,
            2,
        );
        expect(polygonAreaM2(island ?? [])).toBeGreaterThan(0);
    });

    it('supports no inset and a custom inset', () => {
        const simple = {
            ...field,
            geometry: {
                type: 'Polygon' as const,
                coordinates: [square(3.17, 45.85, 3.172, 45.851)],
            },
            zones: [],
            obstacles: [],
        };
        const boundary = boundarySizeM(simple.geometry.coordinates[0] ?? []);
        const exact = sizeOf(
            readGeofenceExterior(composeMissionFromField(simple, { geofenceInsetCm: 0 })),
        );
        const custom = sizeOf(
            readGeofenceExterior(composeMissionFromField(simple, { geofenceInsetCm: 50 })),
        );

        expect(boundary.width - exact.width).toBeCloseTo(0, 3);
        expect(boundary.height - exact.height).toBeCloseTo(0, 3);
        expect(boundary.width - custom.width).toBeCloseTo(1, 2);
        expect(boundary.height - custom.height).toBeCloseTo(1, 2);
    });

    it('rejects a field without a usable outline', () => {
        expect(
            composeMissionFromField({
                ...field,
                geometry: { type: 'Polygon', coordinates: [[[3.17, 45.85]]] },
            }),
        ).toBeNull();
    });
});
