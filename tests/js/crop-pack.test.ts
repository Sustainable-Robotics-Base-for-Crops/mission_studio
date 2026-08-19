import { describe, expect, it } from 'vitest';

import {
    alternateWorkDirections,
    indicesForWorkOrdinalRange,
    keepWorkOrdinalRange,
    readCropPack,
    reverseWorkTravel,
    skipEveryNthWorkSection,
    workSectionIndices,
    writeCropPack,
} from '../../frontend/src/domain/crop-pack';
import type { AgriDocument } from '../../frontend/src/domain/agri';
import { ramerDouglasPeucker, teachRepeatDocument } from '../../frontend/src/domain/teach-repeat';

function doc(rows: number[][]): AgriDocument {
    return {
        version: '3',
        points: rows.map((pair) => ({
            section_type: 'row_line',
            columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
            values: [
                [pair[0], pair[1], 0.5, 1, {}],
                [pair[2], pair[3], 0.5, 1, {}],
            ],
        })),
        metadata: {},
    };
}

describe('crop pack', () => {
    it('reads and writes metadata.srbc_crop_pack without Agri v4', () => {
        const next = writeCropPack(doc([[0, 0, 10, 0]]), 'vineyard');
        expect(readCropPack(next)).toBe('vineyard');
        expect((next.metadata as { srbc_crop_pack: string }).srbc_crop_pack).toBe('vineyard');
    });

    it('selects a vineyard row range and skips every other pass', () => {
        const rows: number[][] = [];
        for (let y = 0; y < 5; y += 1) {
            rows.push([0, y, 10, y]);
        }
        const source = doc(rows);
        expect(workSectionIndices(source)).toHaveLength(5);
        expect(indicesForWorkOrdinalRange(source, 2, 4)).toEqual([1, 2, 3]);
        expect(keepWorkOrdinalRange(source, 2, 4).points).toHaveLength(3);
        expect(skipEveryNthWorkSection(source, 1).points).toHaveLength(3);
    });

    it('reverses even work rows for an alternate heading', () => {
        const source = doc([
            [0, 0, 10, 0],
            [0, 1, 10, 1],
        ]);
        const next = alternateWorkDirections(source);
        expect(next.points[0]?.values[0]?.[0]).toBe(0);
        expect(next.points[1]?.values[0]?.[0]).toBe(10);
        const reversed = reverseWorkTravel(source);
        expect(reversed.points[0]?.values[0]?.[0]).toBe(10);
    });
});

describe('teach-and-repeat', () => {
    it('simplifies a noisy polyline and keeps endpoints', () => {
        const simplified = ramerDouglasPeucker(
            [
                { x: 0, y: 0 },
                { x: 1, y: 0.01 },
                { x: 2, y: -0.01 },
                { x: 10, y: 0 },
            ],
            0.2,
        );
        expect(simplified[0]).toEqual({ x: 0, y: 0 });
        expect(simplified[simplified.length - 1]).toEqual({ x: 10, y: 0 });
        expect(simplified.length).toBeLessThan(4);
    });

    it('imports a GeoJSON LineString as an Agri row_path', () => {
        const document = teachRepeatDocument({
            type: 'LineString',
            coordinates: [
                [3.17, 45.85],
                [3.1702, 45.85],
                [3.1704, 45.8501],
            ],
        });
        expect(document).not.toBeNull();
        expect(document?.points[0]?.section_type).toBe('row_path');
        expect((document?.points[0]?.values.length ?? 0) >= 2).toBe(true);
        expect(
            (document?.metadata as { srbc_teach_repeat?: { source_points: number } })
                .srbc_teach_repeat?.source_points,
        ).toBe(3);
    });
});
