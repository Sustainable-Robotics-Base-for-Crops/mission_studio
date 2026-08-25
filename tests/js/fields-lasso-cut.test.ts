import { describe, expect, it } from 'vitest';

import { lassoHitsInRing, nextFreeRowNumber } from '../../frontend/src/fields/edit-tools';
import { cutGeometryByLasso, geometryIntersectsLasso } from '../../frontend/src/fields/lasso-cut';
import type { FieldChildren } from '../../frontend/src/fields/geojson';
import type { GeoJSONLineString, GeoJSONPolygon } from '../../frontend/src/fields/types';

const ORIGIN = { lng: 3.17, lat: 45.85 };

function lngLat(eastM: number, northM: number): [number, number] {
    const metersPerDegree = 111320;
    const scaleX = metersPerDegree * Math.cos((ORIGIN.lat * Math.PI) / 180);
    return [ORIGIN.lng + eastM / scaleX, ORIGIN.lat + northM / metersPerDegree];
}

function line(points: Array<[number, number]>): GeoJSONLineString {
    return { type: 'LineString', coordinates: points };
}

function polygon(points: Array<[number, number]>): GeoJSONPolygon {
    const ring = [...points];
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
        ring.push(first);
    }
    return { type: 'Polygon', coordinates: [ring] };
}

const LASSO = polygon([lngLat(4, -2), lngLat(6, -2), lngLat(6, 2), lngLat(4, 2)]);

describe('cutGeometryByLasso — rows (CdC §5.2 portions)', () => {
    it('splits a vine row that crosses the lasso with no vertex inside', () => {
        const row = line([lngLat(0, 0), lngLat(10, 0)]);
        expect(geometryIntersectsLasso(row, LASSO)).toBe(true);
        const cut = cutGeometryByLasso(row, LASSO);
        expect(cut.action).toBe('replace');
        if (cut.action !== 'replace') {
            return;
        }
        expect(cut.geometries).toHaveLength(2);
        expect(cut.geometries.every((piece) => piece.type === 'LineString')).toBe(true);
        const first = cut.geometries[0] as GeoJSONLineString;
        const second = cut.geometries[1] as GeoJSONLineString;
        expect(first.coordinates[0]).toEqual(lngLat(0, 0));
        expect(second.coordinates[second.coordinates.length - 1]).toEqual(lngLat(10, 0));
    });

    it('deletes a row entirely inside the lasso', () => {
        const row = line([lngLat(4.5, 0), lngLat(5.5, 0)]);
        expect(cutGeometryByLasso(row, LASSO)).toEqual({ action: 'delete' });
    });

    it('leaves a row entirely outside unchanged', () => {
        const row = line([lngLat(0, 5), lngLat(10, 5)]);
        expect(geometryIntersectsLasso(row, LASSO)).toBe(false);
        expect(cutGeometryByLasso(row, LASSO)).toEqual({ action: 'unchanged' });
    });
});

describe('cutGeometryByLasso — beds', () => {
    it('keeps the parts of a bed that lie outside the lasso', () => {
        const bed = polygon([lngLat(0, -1), lngLat(10, -1), lngLat(10, 1), lngLat(0, 1)]);
        const cut = cutGeometryByLasso(bed, LASSO);
        expect(cut.action).toBe('replace');
        if (cut.action !== 'replace') {
            return;
        }
        expect(cut.geometries.length).toBeGreaterThanOrEqual(1);
        expect(cut.geometries.every((piece) => piece.type === 'Polygon')).toBe(true);
        const rings = cut.geometries.flatMap((piece) =>
            piece.type === 'Polygon' ? piece.coordinates : [],
        );
        const allLng = rings.flat().map((pair) => Number(pair?.[0]));
        expect(Math.min(...allLng)).toBeCloseTo(lngLat(0, 0)[0], 6);
        expect(Math.max(...allLng)).toBeCloseTo(lngLat(10, 0)[0], 6);
    });

    it('deletes a bed entirely inside the lasso', () => {
        const bed = polygon([
            lngLat(4.2, -0.5),
            lngLat(5.8, -0.5),
            lngLat(5.8, 0.5),
            lngLat(4.2, 0.5),
        ]);
        expect(cutGeometryByLasso(bed, LASSO)).toEqual({ action: 'delete' });
    });

    it('punches a hole when the lasso sits inside the bed', () => {
        const bed = polygon([lngLat(0, -8), lngLat(12, -8), lngLat(12, 8), lngLat(0, 8)]);
        const cut = cutGeometryByLasso(bed, LASSO);
        expect(cut.action).toBe('replace');
        if (cut.action !== 'replace') {
            return;
        }
        const hole = cut.geometries.find(
            (piece) => piece.type === 'Polygon' && piece.coordinates.length >= 2,
        );
        expect(hole).toBeDefined();
    });
});

describe('nextFreeRowNumber', () => {
    it('skips numbers already used by the rest of the set', () => {
        expect(nextFreeRowNumber([1, 2, 3, 9])).toBe(10);
        expect(nextFreeRowNumber([])).toBe(1);
    });
});

describe('lassoHitsInRing', () => {
    it('hits a row that only crosses the lasso', () => {
        const children: FieldChildren = {
            zones: [],
            obstacles: [],
            guidance_lines: [],
            row_sets: [
                {
                    id: 'set-1',
                    field_id: 'field-1',
                    name: 'Vigne',
                    kind: 'rows',
                    spacing_m: 2.5,
                    width_m: null,
                    preferred_direction: null,
                    axis_line_id: null,
                    geometry: null,
                    provenance: {},
                    created_at: '',
                    rows: [
                        {
                            id: 'row-1',
                            row_set_id: 'set-1',
                            field_id: 'field-1',
                            number: 1,
                            name: 'Vigne 1',
                            geometry: line([lngLat(0, 0), lngLat(10, 0)]),
                            state: 'active',
                            created_at: '',
                        },
                    ],
                },
            ],
            traffic_ways: [],
            traffic_nodes: [],
            landmarks: [],
        };
        const hits = lassoHitsInRing('field-1', children, LASSO);
        expect(hits).toEqual([
            {
                kind: 'row',
                fieldId: 'field-1',
                rowSetId: 'set-1',
                id: 'row-1',
                label: 'Vigne 1',
            },
        ]);
    });
});
