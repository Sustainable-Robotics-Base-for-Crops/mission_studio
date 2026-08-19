/**
 * Parity pin: the L4 TypeScript geometry module must match GeometryUtils.js
 * bit-for-bit on the cases already covered by tests/js/geometry-utils.test.js.
 */
import { describe, expect, it } from 'vitest';

import GeometryUtils from '../../public/js/utils/GeometryUtils.js';
import * as geom from '../../frontend/src/domain/geometry';

const ORIGIN = { lat: 45.85, lon: 3.17 };

describe('domain/geometry parity with GeometryUtils', () => {
    it('round3 / distance / normalize / normalizeAngleToPi', () => {
        expect(geom.round3(1.23456)).toBe(GeometryUtils.round3(1.23456));
        expect(geom.distance(0, 0, 3, 4)).toBe(GeometryUtils.distance(0, 0, 3, 4));
        expect(geom.normalize(3, 4)).toEqual(GeometryUtils.normalize(3, 4));
        expect(geom.normalize(0, 0)).toEqual(GeometryUtils.normalize(0, 0));
        expect(geom.normalizeAngleToPi(1.5 * Math.PI)).toBe(
            GeometryUtils.normalizeAngleToPi(1.5 * Math.PI),
        );
    });

    it('line projection and bearing', () => {
        expect(geom.getLineCoefs(0, 0, 1, 0)).toEqual(GeometryUtils.getLineCoefs(0, 0, 1, 0));
        expect(geom.projectPointOnLine(4, 7, [0, -1, 0])).toEqual(
            GeometryUtils.projectPointOnLine(4, 7, [0, -1, 0]),
        );
        expect(geom.calculateBearing(45, 3, 46, 3)).toBe(
            GeometryUtils.calculateBearing(45, 3, 46, 3),
        );
    });

    it('WGS84 ↔ local planar origin', () => {
        const point = { lat: 45.8612, lng: 3.1789 };
        expect(geom.latLngToLocal(point, ORIGIN)).toEqual(
            GeometryUtils.latLngToLocal(point, ORIGIN),
        );
        const local = { x: 123.456, y: -78.9 };
        expect(geom.localToLatLng(local, ORIGIN)).toEqual(
            GeometryUtils.localToLatLng(local, ORIGIN),
        );
        const [lng, lat] = geom.localToLngLat(local.x, local.y, ORIGIN);
        const restored = GeometryUtils.localToLatLng(local, ORIGIN);
        expect(lng).toBe(restored.lng);
        expect(lat).toBe(restored.lat);
    });

    it('localDelta is the planar difference of two WGS84 points', () => {
        const origin = ORIGIN;
        const start = { lat: origin.lat, lng: origin.lon };
        const north = { lat: origin.lat + 1 / geom.METERS_PER_DEGREE, lng: origin.lon };
        const delta = geom.localDelta(origin, start, north);
        expect(delta.x).toBeCloseTo(0, 9);
        expect(delta.y).toBeCloseTo(1, 9);
    });

    it('distances to segment and polyline', () => {
        const point = { lat: 45.855, lng: 3.175 };
        const start: [number, number] = [45.84, 3.17];
        const end: [number, number] = [45.86, 3.17];
        expect(geom.distancePointToSegment(point, start, end)).toBe(
            GeometryUtils.distancePointToSegment(point, start, end),
        );
        const polyline: [number, number][] = [
            [45.85, 3.17],
            [45.86, 3.17],
            [45.86, 3.18],
        ];
        expect(geom.distancePointToPolyline(point, polyline)).toBe(
            GeometryUtils.distancePointToPolyline(point, polyline),
        );
        expect(geom.distancePointToPolyline(point, null)).toBe(Infinity);
    });

    it('estimatePointsForSegment', () => {
        const points = [
            { lat: ORIGIN.lat, lng: ORIGIN.lon },
            { lat: ORIGIN.lat + 100 / geom.METERS_PER_DEGREE, lng: ORIGIN.lon },
        ];
        expect(geom.estimatePointsForSegment(points, 1, ORIGIN)).toBe(
            GeometryUtils.estimatePointsForSegment(points, 1, ORIGIN),
        );
    });
});

describe('formatDistanceMeters', () => {
    it('formats metres and kilometres with two decimals', () => {
        expect(geom.formatDistanceMeters(12.4, 'fr-FR')).toBe('12,40 m');
        expect(geom.formatDistanceMeters(1000, 'fr-FR')).toBe('1,00 km');
        expect(geom.formatDistanceMeters(-1, 'fr-FR')).toBe('—');
    });
});

describe('pointInPolygon (ray casting)', () => {
    const square: [number, number][] = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
    ];

    it('detects interior and exterior points', () => {
        expect(geom.pointInPolygon(5, 5, square)).toBe(true);
        expect(geom.pointInPolygon(-1, 5, square)).toBe(false);
        expect(geom.pointInPolygon(5, 11, square)).toBe(false);
    });
});

describe('densifyXY', () => {
    it('inserts 10 cm vertices on a 1 m segment like row_line densify', () => {
        const densified = geom.densifyXY(
            [
                [0, 0],
                [1, 0],
            ],
            0.1,
        );
        expect(densified).toHaveLength(11);
        expect(densified[0]).toEqual([0, 0]);
        expect(densified[densified.length - 1]).toEqual([1, 0]);
        expect(densified[1]?.[0]).toBeCloseTo(0.1, 9);
    });

    it('leaves a single point unchanged', () => {
        expect(geom.densifyXY([[2, 3]])).toEqual([[2, 3]]);
    });
});

describe('offsetXY', () => {
    it('shifts a northbound segment to the left (west) by 2 m', () => {
        const offset = geom.offsetXY(
            [
                [0, 0],
                [0, 10],
            ],
            2,
        );
        expect(offset[0]?.[0]).toBeCloseTo(-2, 9);
        expect(offset[0]?.[1]).toBeCloseTo(0, 9);
        expect(offset[1]?.[0]).toBeCloseTo(-2, 9);
        expect(offset[1]?.[1]).toBeCloseTo(10, 9);
    });

    it('uses the default perpendicular when the segment is degenerate', () => {
        expect(geom.leftPerpendicular(1, 1, 1, 1)).toEqual({ perpX: 1, perpY: 0 });
    });
});

describe('clipPolylineOutsidePolygon', () => {
    const square: [number, number][] = [
        [4, -2],
        [6, -2],
        [6, 2],
        [4, 2],
    ];

    it('splits a line that crosses the polygon with no vertex inside', () => {
        const runs = geom.clipPolylineOutsidePolygon(
            [
                [0, 0],
                [10, 0],
            ],
            square,
        );
        expect(runs).toHaveLength(2);
        expect(runs[0]?.[0]).toEqual([0, 0]);
        expect(runs[0]?.[1]?.[0]).toBeCloseTo(4, 6);
        expect(runs[1]?.[0]?.[0]).toBeCloseTo(6, 6);
        expect(runs[1]?.[1]).toEqual([10, 0]);
        runs.forEach((run) => expect(run).toHaveLength(2));
    });

    it('drops a line entirely inside the polygon', () => {
        expect(
            geom.clipPolylineOutsidePolygon(
                [
                    [4.5, 0],
                    [5.5, 0],
                ],
                square,
            ),
        ).toEqual([]);
    });

    it('leaves a line entirely outside unchanged', () => {
        const line: [number, number][] = [
            [0, 5],
            [10, 5],
        ];
        expect(geom.clipPolylineOutsidePolygon(line, square)).toEqual([line]);
    });
});
