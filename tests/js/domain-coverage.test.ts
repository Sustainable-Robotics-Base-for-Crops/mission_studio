import { describe, expect, it } from 'vitest';

import { generateParallelRowLines } from '../../frontend/src/domain/coverage';
import { METERS_PER_DEGREE } from '../../frontend/src/domain/geometry';

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

describe('generateParallelRowLines', () => {
    it('returns nothing for fewer than three vertices or non-positive spacing', () => {
        expect(generateParallelRowLines(squareParcel(10).slice(0, 2), ORIGIN, 2.5)).toEqual([]);
        expect(generateParallelRowLines(squareParcel(10), ORIGIN, 0)).toEqual([]);
    });

    it('fills a 20 m square at 5 m spacing with alternating row_line sections', () => {
        const rows = generateParallelRowLines(squareParcel(20), ORIGIN, 5);
        expect(rows.length).toBeGreaterThanOrEqual(3);
        expect(rows.every((section) => section.section_type === 'row_line')).toBe(true);
        expect(rows.every((section) => section.values.length === 2)).toBe(true);
        const firstY = Number(rows[0]?.values[0]?.[1]);
        const secondY = Number(rows[1]?.values[0]?.[1]);
        expect(Math.abs(secondY - firstY)).toBeGreaterThan(0);
    });
});
