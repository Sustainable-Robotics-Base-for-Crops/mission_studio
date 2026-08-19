import { describe, expect, it } from 'vitest';

import {
    drawKindFromGeometry,
    toolFromDrawKind,
    verticesFromGeometry,
} from '../../frontend/src/fields/edit-geometry';

describe('verticesFromGeometry', () => {
    it('drops the closing vertex of a polygon ring', () => {
        expect(
            verticesFromGeometry({
                type: 'Polygon',
                coordinates: [
                    [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 0],
                    ],
                ],
            }),
        ).toEqual([
            { lng: 0, lat: 0 },
            { lng: 1, lat: 0 },
            { lng: 1, lat: 1 },
        ]);
    });

    it('keeps line and point vertices', () => {
        expect(
            verticesFromGeometry({
                type: 'LineString',
                coordinates: [
                    [0, 0],
                    [2, 1],
                ],
            }),
        ).toEqual([
            { lng: 0, lat: 0 },
            { lng: 2, lat: 1 },
        ]);
        expect(verticesFromGeometry({ type: 'Point', coordinates: [4, 5] })).toEqual([
            { lng: 4, lat: 5 },
        ]);
    });

    it('maps geometry types to draw tools', () => {
        expect(drawKindFromGeometry({ type: 'Polygon' })).toBe('polygon');
        expect(drawKindFromGeometry({ type: 'LineString' })).toBe('line');
        expect(drawKindFromGeometry({ type: 'Point' })).toBe('point');
        expect(toolFromDrawKind('line')).toBe('draw_line');
        expect(toolFromDrawKind('point')).toBe('draw_point');
    });
});
