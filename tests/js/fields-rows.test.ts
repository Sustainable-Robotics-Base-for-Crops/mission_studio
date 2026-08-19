import { describe, expect, it } from 'vitest';

import {
    generateCatalogueRowPolylines,
    generateParallelRowLines,
} from '../../frontend/src/domain/coverage';
import { METERS_PER_DEGREE } from '../../frontend/src/domain/geometry';
import { rowsFromFieldAndAxis, bedsFromFieldAndAxis } from '../../frontend/src/fields/rows';

const ORIGIN = { lat: 45.85, lon: 3.17 };

function squareParcel(sizeM: number) {
    const dLat = sizeM / METERS_PER_DEGREE;
    const dLng = sizeM / (METERS_PER_DEGREE * Math.cos((ORIGIN.lat * Math.PI) / 180));
    return [
        { lat: ORIGIN.lat, lng: ORIGIN.lon },
        { lat: ORIGIN.lat, lng: ORIGIN.lon + dLng },
        { lat: ORIGIN.lat + dLat, lng: ORIGIN.lon + dLng },
        { lat: ORIGIN.lat + dLat, lng: ORIGIN.lon },
    ];
}

describe('generateCatalogueRowPolylines', () => {
    it('keeps a constant heading unlike bounce fill-parcel', () => {
        const parcel = squareParcel(20);
        const first = parcel[0];
        const second = parcel[1];
        if (!first || !second) {
            throw new Error('parcel');
        }
        const bounce = generateParallelRowLines(parcel, ORIGIN, 5);
        const catalogue = generateCatalogueRowPolylines(parcel, first, second, ORIGIN, 5);
        expect(catalogue.length).toBe(bounce.length);
        expect(catalogue.length).toBeGreaterThanOrEqual(3);
        const heading = (line: Array<{ lat: number; lng: number }>) => {
            const start = line[0];
            const end = line[line.length - 1];
            if (!start || !end) {
                return 0;
            }
            return Math.atan2(end.lat - start.lat, end.lng - start.lng);
        };
        expect(Math.abs(heading(catalogue[0] ?? []) - heading(catalogue[1] ?? []))).toBeLessThan(
            0.05,
        );
        const bounceFirst = bounce[0]?.values[0];
        const bounceFirstEnd = bounce[0]?.values[1];
        const bounceSecond = bounce[1]?.values[0];
        const bounceSecondEnd = bounce[1]?.values[1];
        if (bounceFirst && bounceFirstEnd && bounceSecond && bounceSecondEnd) {
            const bounceHeading0 = Math.atan2(
                Number(bounceFirstEnd[1]) - Number(bounceFirst[1]),
                Number(bounceFirstEnd[0]) - Number(bounceFirst[0]),
            );
            const bounceHeading1 = Math.atan2(
                Number(bounceSecondEnd[1]) - Number(bounceSecond[1]),
                Number(bounceSecondEnd[0]) - Number(bounceSecond[0]),
            );
            expect(Math.abs(Math.abs(bounceHeading1 - bounceHeading0) - Math.PI)).toBeLessThan(0.2);
        }
    });
});

describe('rowsFromFieldAndAxis', () => {
    it('clips numbered LineStrings to the field polygon', () => {
        const parcel = squareParcel(20);
        const first = parcel[0];
        const second = parcel[1];
        if (!first || !second) {
            throw new Error('parcel');
        }
        const ring = [...parcel, parcel[0]].map((point) => [point.lng, point.lat]);
        const lines = rowsFromFieldAndAxis(
            { type: 'Polygon', coordinates: [ring as number[][]] },
            {
                type: 'LineString',
                coordinates: [
                    [first.lng, first.lat],
                    [second.lng, second.lat],
                ],
            },
            5,
        );
        expect(lines.length).toBeGreaterThanOrEqual(3);
        expect(
            lines.every((line) => line.type === 'LineString' && line.coordinates.length >= 2),
        ).toBe(true);
    });

    it('returns nothing without a usable axis or spacing', () => {
        expect(
            rowsFromFieldAndAxis(
                {
                    type: 'Polygon',
                    coordinates: [
                        [
                            [0, 0],
                            [0.001, 0],
                            [0.001, 0.001],
                            [0, 0.001],
                            [0, 0],
                        ],
                    ],
                },
                { type: 'LineString', coordinates: [[0, 0]] },
                2.5,
            ),
        ).toEqual([]);
        expect(
            rowsFromFieldAndAxis(
                {
                    type: 'Polygon',
                    coordinates: [
                        [
                            [0, 0],
                            [0.001, 0],
                            [0.001, 0.001],
                            [0, 0.001],
                            [0, 0],
                        ],
                    ],
                },
                {
                    type: 'LineString',
                    coordinates: [
                        [0, 0],
                        [0.001, 0],
                    ],
                },
                0,
            ),
        ).toEqual([]);
    });
});

describe('bedsFromFieldAndAxis', () => {
    it('builds 18 clipped bed polygons from an AB axis', () => {
        const parcel = squareParcel(40);
        const first = parcel[0];
        const second = parcel[1];
        if (!first || !second) {
            throw new Error('parcel');
        }
        const ring = [...parcel, parcel[0]].map((point) => [point.lng, point.lat]);
        const beds = bedsFromFieldAndAxis(
            { type: 'Polygon', coordinates: [ring as number[][]] },
            {
                type: 'LineString',
                coordinates: [
                    [first.lng, first.lat],
                    [second.lng, second.lat],
                ],
            },
            { widthM: 0.8, pathM: 0.2, count: 18 },
        );
        expect(beds).toHaveLength(18);
        expect(beds.every((bed) => bed.type === 'Polygon')).toBe(true);
        expect(beds.every((bed) => (bed.coordinates[0]?.length ?? 0) >= 4)).toBe(true);
    });

    it('stops when the parcel cannot fit the requested count', () => {
        const parcel = squareParcel(8);
        const first = parcel[0];
        const second = parcel[1];
        if (!first || !second) {
            throw new Error('parcel');
        }
        const ring = [...parcel, parcel[0]].map((point) => [point.lng, point.lat]);
        const beds = bedsFromFieldAndAxis(
            { type: 'Polygon', coordinates: [ring as number[][]] },
            {
                type: 'LineString',
                coordinates: [
                    [first.lng, first.lat],
                    [second.lng, second.lat],
                ],
            },
            { widthM: 1.2, pathM: 0.4, count: 18 },
        );
        expect(beds.length).toBeGreaterThan(0);
        expect(beds.length).toBeLessThan(18);
    });
});
