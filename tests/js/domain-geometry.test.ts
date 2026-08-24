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

    it('splitPolylineByPolygon keeps the inside run between the exits', () => {
        const runs = geom.splitPolylineByPolygon(
            [
                [0, 0],
                [10, 0],
            ],
            square,
        );
        expect(runs).toHaveLength(3);
        expect(runs[0]?.inside).toBe(false);
        expect(runs[1]?.inside).toBe(true);
        expect(runs[1]?.points[0]?.[0]).toBeCloseTo(4, 6);
        expect(runs[1]?.points[1]?.[0]).toBeCloseTo(6, 6);
        expect(runs[2]?.inside).toBe(false);
    });
});

describe('curvePathXY', () => {
    it('degree 1 densifies the polyline', () => {
        const path = geom.curvePathXY(
            [
                [0, 0],
                [1, 0],
            ],
            1,
            0.1,
        );
        expect(path.length).toBeGreaterThan(5);
        expect(path[0]).toEqual([0, 0]);
        expect(path[path.length - 1]).toEqual([1, 0]);
    });

    it('degree 2 samples a quadratic that leaves the chord', () => {
        const path = geom.curvePathXY(
            [
                [0, 0],
                [1, 2],
                [2, 0],
            ],
            2,
            0.1,
        );
        const peak = Math.max(...path.map((point) => point[1]));
        expect(peak).toBeGreaterThan(0.8);
        expect(peak).toBeLessThan(2);
        expect(path.length).toBeGreaterThan(10);
    });
});

describe('smoothPathXY', () => {
    it('passes through every vertex and keeps C1 corners', () => {
        const knots: [number, number][] = [
            [0, 0],
            [2, 1],
            [4, 0],
        ];
        const path = geom.smoothPathXY(knots, 0.1);
        for (const knot of knots) {
            const nearest = Math.min(
                ...path.map((point) => Math.hypot(point[0] - knot[0], point[1] - knot[1])),
            );
            expect(nearest).toBeLessThan(1e-6);
        }
        expect(path.length).toBeGreaterThan(20);
    });

    it('densifies two points as a straight segment', () => {
        const path = geom.smoothPathXY(
            [
                [0, 0],
                [1, 0],
            ],
            0.1,
        );
        expect(path[0]).toEqual([0, 0]);
        expect(path[path.length - 1]).toEqual([1, 0]);
        expect(path.every((point) => Math.abs(point[1]) < 1e-9)).toBe(true);
        expect(path.length).toBeGreaterThan(5);
    });

    it('honours start and end headings on a two-point U', () => {
        const path = geom.smoothPathXY(
            [
                [0, 0],
                [0, 4],
            ],
            0.1,
            { start: [1, 0], end: [-1, 0] },
        );
        const first = path[1];
        const last = path[path.length - 2];
        expect(first).toBeTruthy();
        expect(last).toBeTruthy();
        expect(first![0]).toBeGreaterThan(0.05);
        expect(Math.abs(first![1])).toBeLessThan(0.08);
        expect(last![0]).toBeGreaterThan(0.05);
        expect(Math.abs(last![1] - 4)).toBeLessThan(0.08);
        expect(Math.max(...path.map((point) => point[0]))).toBeGreaterThan(0.5);
    });
});
