import { describe, expect, it } from 'vitest';

import type { AgriDocument } from '../../frontend/src/domain/agri';
import {
    appendGeofenceExclusion,
    geofenceRing,
    localRingToLatLng,
    pickGeofenceByProximity,
    polygonAreaM2,
    readGeofenceExclusions,
    setGeofenceRing,
} from '../../frontend/src/domain/geofence';

const document: AgriDocument = {
    origin: { type: 'WGS84', coordinates: { lat: 45.85, lon: 3.17, alt: 0 } },
    points: [],
    metadata: {},
    geofencing: {
        columns: ['x', 'y'],
        values: [
            [0, 0],
            [20, 0],
            [20, 10],
            [0, 10],
        ],
    },
};

describe('geofence tree editing', () => {
    it('computes the exterior surface in square metres', () => {
        expect(polygonAreaM2(geofenceRing(document, 'outer'))).toBe(200);
    });

    it('adds and edits an exclusion inside the exterior without changing Agri geofencing', () => {
        const inside = localRingToLatLng(document, [
            [2, 2],
            [4, 2],
            [4, 5],
            [2, 5],
        ]);
        const withExclusion = appendGeofenceExclusion(document, inside);
        expect(withExclusion).not.toBeNull();
        expect(withExclusion?.geofencing).toEqual(document.geofencing);
        expect(readGeofenceExclusions(withExclusion)).toHaveLength(1);

        const moved = localRingToLatLng(document, [
            [3, 2],
            [6, 2],
            [6, 5],
            [3, 5],
        ]);
        const edited = withExclusion ? setGeofenceRing(withExclusion, 'exclusion:0', moved) : null;
        expect(polygonAreaM2(geofenceRing(edited, 'exclusion:0'))).toBeCloseTo(9, 2);
    });

    it('rejects an exclusion outside the exterior', () => {
        const outside = localRingToLatLng(document, [
            [30, 30],
            [32, 30],
            [32, 32],
            [30, 32],
        ]);
        expect(appendGeofenceExclusion(document, outside)).toBeNull();
    });
});

describe('picking a geofence from a map click', () => {
    const field: AgriDocument = {
        origin: { type: 'WGS84', coordinates: { lat: 45.85, lon: 3.17, alt: 0 } },
        points: [],
        metadata: {},
        geofencing: {
            columns: ['x', 'y'],
            values: [
                [0, 0],
                [200, 0],
                [200, 100],
                [0, 100],
            ],
        },
    };
    const at = (x: number, y: number) => localRingToLatLng(field, [[x, y]])[0]!;

    it('selects the exterior when clicking near its outline', () => {
        expect(pickGeofenceByProximity(field, at(100, 2))).toBe('outer');
    });

    it('ignores a click well inside the plot so passes stay reachable', () => {
        expect(pickGeofenceByProximity(field, at(100, 50))).toBeNull();
    });

    it('selects an exclusion when clicking inside it', () => {
        const withExclusion = appendGeofenceExclusion(
            field,
            localRingToLatLng(field, [
                [80, 40],
                [120, 40],
                [120, 60],
                [80, 60],
            ]),
        );
        expect(pickGeofenceByProximity(withExclusion, at(100, 50))).toBe('exclusion:0');
    });
});
