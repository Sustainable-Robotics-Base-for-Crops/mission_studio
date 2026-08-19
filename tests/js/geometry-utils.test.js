/**
 * Unit tests for GeometryUtils, the only dependency-free geometry module today.
 *
 * These functions are the ones the future domain layer will absorb, so their
 * behaviour is pinned here before TrajectoryEditor.js is split apart.
 */

import { describe, expect, it } from 'vitest';

import GeometryUtils from '../../public/js/utils/GeometryUtils.js';

// Reference origin: the coarse WGS84 origin used by the golden fixtures.
const ORIGIN = { lat: 45.85, lon: 3.17 };

// Metres per degree of latitude used throughout the editor's planar approximation.
const METRES_PER_DEGREE = 111320;

describe('round3', () => {
    it('rounds to three decimals', () => {
        expect(GeometryUtils.round3(1.23456)).toBe(1.235);
        expect(GeometryUtils.round3(1.2344)).toBe(1.234);
    });

    it('leaves already-rounded values untouched', () => {
        expect(GeometryUtils.round3(2.5)).toBe(2.5);
        expect(GeometryUtils.round3(0)).toBe(0);
    });

    it('keeps the sign of negative values', () => {
        expect(GeometryUtils.round3(-1.23456)).toBe(-1.235);
    });
});

describe('distance', () => {
    it('measures a 3-4-5 triangle', () => {
        expect(GeometryUtils.distance(0, 0, 3, 4)).toBe(5);
    });

    it('returns zero for identical points', () => {
        expect(GeometryUtils.distance(2, 2, 2, 2)).toBe(0);
    });

    it('is symmetric', () => {
        expect(GeometryUtils.distance(1, 2, 5, 7)).toBeCloseTo(
            GeometryUtils.distance(5, 7, 1, 2),
            12,
        );
    });
});

describe('normalize', () => {
    it('produces a unit vector', () => {
        const [x, y] = GeometryUtils.normalize(3, 4);
        expect(x).toBeCloseTo(0.6, 12);
        expect(y).toBeCloseTo(0.8, 12);
        expect(Math.hypot(x, y)).toBeCloseTo(1, 12);
    });

    it('falls back to the x axis for a null vector', () => {
        expect(GeometryUtils.normalize(0, 0)).toEqual([1.0, 0.0]);
    });
});

describe('normalizeAngleToPi', () => {
    it('leaves angles already in range untouched', () => {
        expect(GeometryUtils.normalizeAngleToPi(0)).toBe(0);
        expect(GeometryUtils.normalizeAngleToPi(1)).toBe(1);
    });

    it('wraps angles above pi', () => {
        expect(GeometryUtils.normalizeAngleToPi(1.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI, 12);
    });

    it('wraps angles below minus pi', () => {
        expect(GeometryUtils.normalizeAngleToPi(-1.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 12);
    });

    it('wraps several turns', () => {
        expect(GeometryUtils.normalizeAngleToPi(5 * Math.PI)).toBeCloseTo(Math.PI, 12);
    });
});

describe('getLineCoefs and projectPointOnLine', () => {
    it('describes a horizontal line', () => {
        // Line y = 0 through (0,0) and (1,0): 0x - 1y + 0 = 0
        expect(GeometryUtils.getLineCoefs(0, 0, 1, 0)).toEqual([0, -1, 0]);
    });

    it('projects a point onto a horizontal line', () => {
        const coefs = GeometryUtils.getLineCoefs(0, 0, 10, 0);
        const [x, y] = GeometryUtils.projectPointOnLine(4, 7, coefs);
        expect(x).toBeCloseTo(4, 9);
        expect(y).toBeCloseTo(0, 9);
    });

    it('projects a point onto a vertical line', () => {
        const coefs = GeometryUtils.getLineCoefs(5, 0, 5, 10);
        const [x, y] = GeometryUtils.projectPointOnLine(1, 3, coefs);
        expect(x).toBeCloseTo(5, 9);
        expect(y).toBeCloseTo(3, 9);
    });

    it('returns the point unchanged for a degenerate line', () => {
        const coefs = GeometryUtils.getLineCoefs(2, 2, 2, 2);
        expect(GeometryUtils.projectPointOnLine(7, 9, coefs)).toEqual([7, 9]);
    });

    it('leaves a point already on the line in place', () => {
        const coefs = GeometryUtils.getLineCoefs(0, 0, 10, 10);
        const [x, y] = GeometryUtils.projectPointOnLine(3, 3, coefs);
        expect(x).toBeCloseTo(3, 9);
        expect(y).toBeCloseTo(3, 9);
    });
});

describe('calculateBearing', () => {
    it('reads 0 degrees due north', () => {
        expect(GeometryUtils.calculateBearing(45.0, 3.0, 46.0, 3.0)).toBeCloseTo(0, 6);
    });

    it('reads 90 degrees due east', () => {
        expect(GeometryUtils.calculateBearing(0.0, 0.0, 0.0, 1.0)).toBeCloseTo(90, 6);
    });

    it('reads 180 degrees due south', () => {
        expect(GeometryUtils.calculateBearing(46.0, 3.0, 45.0, 3.0)).toBeCloseTo(180, 6);
    });

    it('reads 270 degrees due west', () => {
        expect(GeometryUtils.calculateBearing(0.0, 1.0, 0.0, 0.0)).toBeCloseTo(270, 6);
    });

    it('always returns a value within [0, 360)', () => {
        const samples = [
            [45.85, 3.17, 45.86, 3.18],
            [45.85, 3.17, 45.84, 3.16],
            [45.85, 3.17, 45.85, 3.16],
        ];
        for (const [lat1, lon1, lat2, lon2] of samples) {
            const bearing = GeometryUtils.calculateBearing(lat1, lon1, lat2, lon2);
            expect(bearing).toBeGreaterThanOrEqual(0);
            expect(bearing).toBeLessThan(360);
        }
    });
});

describe('latLngToLocal and localToLatLng', () => {
    it('places the origin at zero', () => {
        const local = GeometryUtils.latLngToLocal({ lat: ORIGIN.lat, lng: ORIGIN.lon }, ORIGIN);
        expect(local.x).toBeCloseTo(0, 9);
        expect(local.y).toBeCloseTo(0, 9);
    });

    it('converts one degree of latitude to the editor constant', () => {
        const local = GeometryUtils.latLngToLocal({ lat: ORIGIN.lat + 1, lng: ORIGIN.lon }, ORIGIN);
        expect(local.y).toBeCloseTo(METRES_PER_DEGREE, 6);
    });

    it('shrinks longitude by the cosine of the latitude', () => {
        const local = GeometryUtils.latLngToLocal({ lat: ORIGIN.lat, lng: ORIGIN.lon + 1 }, ORIGIN);
        const expected = METRES_PER_DEGREE * Math.cos((ORIGIN.lat * Math.PI) / 180);
        expect(local.x).toBeCloseTo(expected, 6);
    });

    it('round-trips a point back to its coordinates', () => {
        const point = { lat: 45.8612, lng: 3.1789 };
        const local = GeometryUtils.latLngToLocal(point, ORIGIN);
        const restored = GeometryUtils.localToLatLng(local, ORIGIN);
        expect(restored.lat).toBeCloseTo(point.lat, 10);
        expect(restored.lng).toBeCloseTo(point.lng, 10);
    });

    it('round-trips local metres back to metres', () => {
        const local = { x: 123.456, y: -78.9 };
        const geo = GeometryUtils.localToLatLng(local, ORIGIN);
        const restored = GeometryUtils.latLngToLocal({ lat: geo.lat, lng: geo.lng }, ORIGIN);
        expect(restored.x).toBeCloseTo(local.x, 6);
        expect(restored.y).toBeCloseTo(local.y, 6);
    });
});

describe('getDistanceMeters', () => {
    it('returns zero for identical points', () => {
        const point = { lat: 45.85, lng: 3.17 };
        expect(GeometryUtils.getDistanceMeters(point, point)).toBe(0);
    });

    it('matches the latitude constant over one degree', () => {
        const distance = GeometryUtils.getDistanceMeters(
            { lat: 45.0, lng: 3.0 },
            { lat: 46.0, lng: 3.0 },
        );
        expect(distance).toBeCloseTo(METRES_PER_DEGREE, 6);
    });

    it('is consistent with the local projection over short distances', () => {
        const p1 = { lat: 45.85, lng: 3.17 };
        const p2 = { lat: 45.8509, lng: 3.1712 };
        const a = GeometryUtils.latLngToLocal(p1, ORIGIN);
        const b = GeometryUtils.latLngToLocal(p2, ORIGIN);
        expect(GeometryUtils.getDistanceMeters(p1, p2)).toBeCloseTo(
            GeometryUtils.distance(a.x, a.y, b.x, b.y),
            2,
        );
    });
});

describe('distancePointToSegment', () => {
    it('returns zero for a point on the segment', () => {
        const distance = GeometryUtils.distancePointToSegment(
            { lat: 45.85, lng: 3.17 },
            [45.84, 3.17],
            [45.86, 3.17],
        );
        expect(distance).toBeCloseTo(0, 3);
    });

    it('clamps to the start point when the projection falls before it', () => {
        const start = [45.85, 3.17];
        const distance = GeometryUtils.distancePointToSegment(
            { lat: 45.84, lng: 3.17 },
            start,
            [45.86, 3.17],
        );
        const expected = GeometryUtils.getDistanceMeters(
            { lat: 45.84, lng: 3.17 },
            { lat: start[0], lng: start[1] },
        );
        expect(distance).toBeCloseTo(expected, 1);
    });

    it('handles a degenerate segment reduced to a point', () => {
        const distance = GeometryUtils.distancePointToSegment(
            { lat: 45.86, lng: 3.17 },
            [45.85, 3.17],
            [45.85, 3.17],
        );
        expect(distance).toBeGreaterThan(0);
        expect(Number.isFinite(distance)).toBe(true);
    });
});

describe('distancePointToPolyline', () => {
    const polyline = [
        [45.85, 3.17],
        [45.86, 3.17],
        [45.86, 3.18],
    ];

    it('returns Infinity for a polyline with fewer than two points', () => {
        expect(GeometryUtils.distancePointToPolyline({ lat: 45.85, lng: 3.17 }, [])).toBe(Infinity);
        expect(
            GeometryUtils.distancePointToPolyline({ lat: 45.85, lng: 3.17 }, [[45.85, 3.17]]),
        ).toBe(Infinity);
    });

    it('returns Infinity for a missing polyline', () => {
        expect(GeometryUtils.distancePointToPolyline({ lat: 45.85, lng: 3.17 }, null)).toBe(
            Infinity,
        );
    });

    it('returns zero for a vertex of the polyline', () => {
        expect(
            GeometryUtils.distancePointToPolyline({ lat: 45.86, lng: 3.17 }, polyline),
        ).toBeCloseTo(0, 3);
    });

    it('never exceeds the distance to the closest segment', () => {
        const point = { lat: 45.855, lng: 3.175 };
        const polylineDistance = GeometryUtils.distancePointToPolyline(point, polyline);
        const segmentDistances = [
            GeometryUtils.distancePointToSegment(point, polyline[0], polyline[1]),
            GeometryUtils.distancePointToSegment(point, polyline[1], polyline[2]),
        ];
        expect(polylineDistance).toBeCloseTo(Math.min(...segmentDistances), 9);
    });
});

describe('estimatePointsForSegment', () => {
    it('returns zero for fewer than two points', () => {
        expect(GeometryUtils.estimatePointsForSegment([], 0.1, ORIGIN)).toBe(0);
        expect(
            GeometryUtils.estimatePointsForSegment([{ lat: 45.85, lng: 3.17 }], 0.1, ORIGIN),
        ).toBe(0);
    });

    it('estimates a 100 m segment densified every metre', () => {
        const start = { lat: ORIGIN.lat, lng: ORIGIN.lon };
        const end = { lat: ORIGIN.lat + 100 / METRES_PER_DEGREE, lng: ORIGIN.lon };
        // 100 points along the segment, plus first and last.
        expect(GeometryUtils.estimatePointsForSegment([start, end], 1, ORIGIN)).toBe(102);
    });

    it('grows as the spacing shrinks', () => {
        const points = [
            { lat: ORIGIN.lat, lng: ORIGIN.lon },
            { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lon },
        ];
        const coarse = GeometryUtils.estimatePointsForSegment(points, 1, ORIGIN);
        const fine = GeometryUtils.estimatePointsForSegment(points, 0.1, ORIGIN);
        expect(fine).toBeGreaterThan(coarse);
    });

    it('stays under the editor cap for a realistic row', () => {
        // 500 m row densified at the editor's 0.1 m spacing.
        const points = [
            { lat: ORIGIN.lat, lng: ORIGIN.lon },
            { lat: ORIGIN.lat + 500 / METRES_PER_DEGREE, lng: ORIGIN.lon },
        ];
        expect(GeometryUtils.estimatePointsForSegment(points, 0.1, ORIGIN)).toBeLessThan(50000);
    });
});
