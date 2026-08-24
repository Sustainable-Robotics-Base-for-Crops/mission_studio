import { describe, expect, it } from 'vitest';

import { withoutHiddenFeatures } from '../../frontend/src/fields/geojson';
import { fieldGeometryTree, isFieldTreeLeafFocused } from '../../frontend/src/fields/geometry-tree';
import { translate } from '../../frontend/src/i18n/adapter';
import type { FieldDetail } from '../../frontend/src/fields/types';

function field(overrides: Partial<FieldDetail> = {}): FieldDetail {
    return {
        id: 'field-1',
        name: 'Champ Nord',
        campaign: null,
        geometry: { type: 'Polygon', coordinates: [[]] },
        crs: 'EPSG:4326',
        provenance: {},
        qualified_for_autonomy: false,
        created_at: '2026-08-23T08:00:00Z',
        updated_at: '2026-08-23T08:00:00Z',
        version: 1,
        zones: [],
        obstacles: [],
        guidance_lines: [],
        row_sets: [],
        traffic_ways: [],
        traffic_nodes: [],
        landmarks: [],
        ...overrides,
    };
}

function zone(id: string, kind: string): FieldDetail['zones'][number] {
    return {
        id,
        field_id: 'field-1',
        kind,
        name: null,
        geometry: { type: 'Polygon', coordinates: [[]] },
        provenance: {},
        created_at: '2026-08-23T08:00:00Z',
    };
}

describe('field geometry tree (CdC §5.2)', () => {
    it('is empty without a field', () => {
        expect(fieldGeometryTree(null)).toEqual([]);
    });

    it('always opens on the field boundary', () => {
        const tree = fieldGeometryTree(field());
        expect(tree).toHaveLength(1);
        expect(tree[0]?.kind).toBe('boundary');
        expect(tree[0]?.leaves[0]?.focus).toEqual({ kind: 'field', id: 'field-1' });
    });

    it('splits the geofence away from the other zones', () => {
        const tree = fieldGeometryTree(
            field({ zones: [zone('z1', 'autonomy'), zone('z2', 'workable')] }),
        );
        const kinds = tree.map((group) => group.kind);
        expect(kinds).toEqual(['boundary', 'geofence', 'zones']);
        expect(tree[1]?.leaves.map((leaf) => leaf.id)).toEqual(['z1']);
        expect(tree[2]?.leaves.map((leaf) => leaf.id)).toEqual(['z2']);
    });

    it('groups rows by set, keeps lines, traffic and obstacles apart', () => {
        const tree = fieldGeometryTree(
            field({
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
                        created_at: '2026-08-23T08:00:00Z',
                        rows: [
                            {
                                id: 'row-1',
                                row_set_id: 'set-1',
                                field_id: 'field-1',
                                number: 1,
                                name: null,
                                geometry: { type: 'LineString', coordinates: [] },
                                state: 'planned',
                                created_at: '2026-08-23T08:00:00Z',
                            },
                        ],
                    },
                ],
                guidance_lines: [
                    {
                        id: 'line-1',
                        field_id: 'field-1',
                        name: 'AB',
                        geometry: { type: 'LineString', coordinates: [] },
                        provenance: {},
                        created_at: '2026-08-23T08:00:00Z',
                    },
                ],
                traffic_ways: [
                    {
                        id: 'way-1',
                        field_id: 'field-1',
                        name: null,
                        kind: 'path',
                        oneway: false,
                        speed_mps: null,
                        width_m: 3,
                        geometry: { type: 'LineString', coordinates: [] },
                        provenance: {},
                        created_at: '2026-08-23T08:00:00Z',
                    },
                ],
                obstacles: [
                    {
                        id: 'obstacle-1',
                        field_id: 'field-1',
                        category: 'unspecified',
                        name: 'Pylône',
                        geometry: { type: 'Polygon', coordinates: [[]] },
                        margin_m: 1,
                        height_m: null,
                        valid_from: null,
                        valid_until: null,
                        crossable: false,
                        provenance: {},
                        created_at: '2026-08-23T08:00:00Z',
                    },
                ],
            }),
        );

        expect(tree.map((group) => group.id)).toEqual([
            'boundary',
            'rows:set-1',
            'guidance',
            'traffic',
            'obstacles',
        ]);
        expect(tree[1]?.leaves[0]?.focus).toEqual({
            kind: 'row',
            fieldId: 'field-1',
            rowSetId: 'set-1',
            id: 'row-1',
        });
    });

    it('groups landmark traces under their own layer', () => {
        const tree = fieldGeometryTree(
            field({
                landmarks: [
                    {
                        id: 'lm-1',
                        field_id: 'field-1',
                        kind: 'measure',
                        name: 'Règle A',
                        geometry: {
                            type: 'LineString',
                            coordinates: [
                                [3.17, 45.85],
                                [3.171, 45.85],
                            ],
                        },
                        radius_m: null,
                        provenance: {},
                        created_at: '2026-08-23T08:00:00Z',
                    },
                ],
            }),
        );
        expect(tree.map((group) => group.kind)).toEqual(['boundary', 'landmarks']);
        expect(tree[1]?.leaves[0]?.focus).toEqual({
            kind: 'landmark',
            fieldId: 'field-1',
            id: 'lm-1',
        });
        expect(translate('fields.tree.group.landmarks', { count: 1 }, 'fr')).toBe(
            'Tracé de repères (1)',
        );
    });

    it('marks the leaf the catalogue focuses, and only that one', () => {
        const tree = fieldGeometryTree(field({ zones: [zone('z1', 'workable')] }));
        const leaf = tree[1]?.leaves[0];
        expect(leaf).toBeDefined();
        expect(isFieldTreeLeafFocused(leaf!, { kind: 'zone', fieldId: 'field-1', id: 'z1' })).toBe(
            true,
        );
        expect(isFieldTreeLeafFocused(leaf!, { kind: 'field', id: 'field-1' })).toBe(false);
        expect(isFieldTreeLeafFocused(leaf!, { kind: 'draft', target: 'zone' })).toBe(false);
    });

    it('measures a surface in square metres and a line in metres, like the mission tree', () => {
        const tree = fieldGeometryTree(
            field({
                geometry: {
                    type: 'Polygon',
                    coordinates: [
                        [
                            [3.17, 45.85],
                            [3.171, 45.85],
                            [3.171, 45.851],
                            [3.17, 45.851],
                            [3.17, 45.85],
                        ],
                    ],
                },
                guidance_lines: [
                    {
                        id: 'line-1',
                        field_id: 'field-1',
                        name: 'AB',
                        geometry: {
                            type: 'LineString',
                            coordinates: [
                                [3.17, 45.85],
                                [3.171, 45.85],
                            ],
                        },
                        provenance: {},
                        created_at: '2026-08-23T08:00:00Z',
                    },
                ],
                traffic_nodes: [
                    {
                        id: 'node-1',
                        field_id: 'field-1',
                        name: null,
                        kind: 'gate',
                        geometry: { type: 'Point', coordinates: [3.17, 45.85] },
                        provenance: {},
                        created_at: '2026-08-23T08:00:00Z',
                    },
                ],
            }),
        );

        const boundary = tree[0]?.leaves[0]?.measure;
        expect(boundary?.kind).toBe('area');
        expect(Math.round(boundary?.value ?? 0)).toBeGreaterThan(5000);
        const line = tree[1]?.leaves[0]?.measure;
        expect(line?.kind).toBe('length');
        expect(Math.round(line?.value ?? 0)).toBe(78);
        expect(tree[2]?.leaves[0]?.measure).toBeNull();
    });

    it('drops a hidden object from the map, and the band derived from it', () => {
        const collection = {
            type: 'FeatureCollection' as const,
            features: [
                {
                    type: 'Feature' as const,
                    id: 'row-1',
                    properties: { id: 'row-1' },
                    geometry: { type: 'LineString' as const, coordinates: [] },
                },
                {
                    type: 'Feature' as const,
                    id: 'row-1:band',
                    properties: { id: 'row-1:band' },
                    geometry: { type: 'Polygon' as const, coordinates: [[]] },
                },
                {
                    type: 'Feature' as const,
                    id: 'row-2',
                    properties: { id: 'row-2' },
                    geometry: { type: 'LineString' as const, coordinates: [] },
                },
            ],
        };

        expect(withoutHiddenFeatures(collection, []).features).toHaveLength(3);
        expect(
            withoutHiddenFeatures(collection, ['row-1']).features.map((feature) => feature.id),
        ).toEqual(['row-2']);
    });

    it('names every group in French and in English', () => {
        const keys = [
            'fields.tree.title',
            'fields.tree.empty',
            'fields.tree.group.boundary',
            'fields.tree.group.geofence',
            'fields.tree.group.zones',
            'fields.tree.group.rows',
            'fields.tree.group.beds',
            'fields.tree.group.guidance',
            'fields.tree.group.traffic',
            'fields.tree.group.obstacles',
            'fields.options.title',
            'fields.details.title',
            'fields.edit.lineName',
        ];
        for (const key of keys) {
            expect(translate(key, { count: 2 }, 'fr')).not.toBe(key);
            expect(translate(key, { count: 2 }, 'en')).not.toBe(key);
        }
    });
});
