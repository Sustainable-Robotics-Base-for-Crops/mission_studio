import { describe, expect, it } from 'vitest';

import {
    boundsForFeatureId,
    fieldsToCollection,
    geojsonDownloadName,
    hitCatalogue,
    lineFromDraft,
    lineLengthM,
    polygonAreaM2,
    polygonContainsLngLat,
    ringFromDraft,
} from '../../frontend/src/fields/geojson';

const SQUARE = {
    type: 'Polygon' as const,
    coordinates: [
        [
            [0, 0],
            [0.001, 0],
            [0.001, 0.001],
            [0, 0.001],
            [0, 0],
        ],
    ],
};

describe('field geojson helpers', () => {
    it('closes a draft ring with at least 3 vertices', () => {
        const polygon = ringFromDraft([
            { lat: 45.85, lng: 3.17 },
            { lat: 45.85, lng: 3.171 },
            { lat: 45.851, lng: 3.171 },
        ]);
        expect(polygon).not.toBeNull();
        const ring = polygon?.coordinates[0] ?? [];
        expect(ring).toHaveLength(4);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
    });

    it('rejects a two-point draft', () => {
        expect(
            ringFromDraft([
                { lat: 0, lng: 0 },
                { lat: 1, lng: 1 },
            ]),
        ).toBeNull();
    });

    it('computes a positive planar area', () => {
        const area = polygonAreaM2(SQUARE);
        expect(area).not.toBeNull();
        expect(area ?? 0).toBeGreaterThan(1000);
    });

    it('hit-tests a point inside the polygon', () => {
        expect(polygonContainsLngLat(SQUARE, 0.0005, 0.0005)).toBe(true);
        expect(polygonContainsLngLat(SQUARE, 2, 2)).toBe(false);
    });

    it('marks the selected field in the collection', () => {
        const collection = fieldsToCollection(
            [
                { id: 'a', name: 'A', geometry: SQUARE },
                { id: 'b', name: 'B', geometry: SQUARE },
            ],
            'b',
        );
        expect(collection.features).toHaveLength(2);
        expect(collection.features[1]?.properties.selected).toBe(true);
        expect(collection.features[0]?.properties.selected).toBe(false);
    });

    it('includes polygon zones and obstacles of every known field', () => {
        const collection = fieldsToCollection([{ id: 'a', name: 'A', geometry: SQUARE }], 'b', {
            a: {
                zones: [
                    {
                        id: 'z1',
                        field_id: 'a',
                        kind: 'forbidden',
                        name: 'Haie',
                        geometry: SQUARE,
                        provenance: {},
                        created_at: '',
                    },
                ],
                obstacles: [
                    {
                        id: 'o1',
                        field_id: 'a',
                        category: 'station',
                        name: 'Station',
                        geometry: SQUARE,
                        margin_m: 0,
                        height_m: null,
                        valid_from: null,
                        valid_until: null,
                        crossable: false,
                        provenance: {},
                        created_at: '',
                    },
                ],
            },
        });
        expect(collection.features.map((feature) => feature.properties.kind)).toEqual([
            'field',
            'forbidden',
            'obstacle',
        ]);
        expect(collection.features.map((feature) => feature.properties.overlay)).toEqual([
            'parcels',
            'zones',
            'obstacles',
        ]);
        const withZoneSelected = fieldsToCollection(
            [{ id: 'a', name: 'A', geometry: SQUARE }],
            'z1',
            {
                a: {
                    zones: [
                        {
                            id: 'z1',
                            field_id: 'a',
                            kind: 'forbidden',
                            name: 'Haie',
                            geometry: SQUARE,
                            provenance: {},
                            created_at: '',
                        },
                    ],
                    obstacles: [],
                },
            },
        );
        expect(withZoneSelected.features[0]?.properties.selected).toBe(false);
        expect(withZoneSelected.features[1]?.properties.selected).toBe(true);
    });

    it('fits a single feature instead of the whole catalogue', () => {
        const collection = fieldsToCollection(
            [
                { id: 'near', name: 'Near', geometry: SQUARE },
                {
                    id: 'far',
                    name: 'Far',
                    geometry: {
                        type: 'Polygon',
                        coordinates: [
                            [
                                [3.17, 45.85],
                                [3.18, 45.85],
                                [3.18, 45.86],
                                [3.17, 45.86],
                                [3.17, 45.85],
                            ],
                        ],
                    },
                },
            ],
            'far',
        );
        const bounds = boundsForFeatureId(collection, 'far');
        expect(bounds?.[0][0]).toBeCloseTo(3.17);
        expect(bounds?.[1][0]).toBeCloseTo(3.18);
    });

    it('picks the smallest nested object on a map click', () => {
        const inner = {
            type: 'Polygon' as const,
            coordinates: [
                [
                    [0.0004, 0.0004],
                    [0.0006, 0.0004],
                    [0.0006, 0.0006],
                    [0.0004, 0.0006],
                    [0.0004, 0.0004],
                ],
            ],
        };
        const fields = [{ id: 'a', name: 'A', geometry: SQUARE }];
        const children = {
            a: {
                zones: [
                    {
                        id: 'z1',
                        field_id: 'a',
                        kind: 'workable' as const,
                        name: 'Travail',
                        geometry: SQUARE,
                        provenance: {},
                        created_at: '',
                    },
                ],
                obstacles: [
                    {
                        id: 'o1',
                        field_id: 'a',
                        category: 'tree',
                        name: 'Arbre',
                        geometry: inner,
                        margin_m: 0,
                        height_m: null,
                        valid_from: null,
                        valid_until: null,
                        crossable: false,
                        provenance: {},
                        created_at: '',
                    },
                ],
            },
        };
        expect(hitCatalogue(fields, children, 0.0005, 0.0005)).toEqual({
            type: 'obstacle',
            fieldId: 'a',
            id: 'o1',
        });
        expect(hitCatalogue(fields, children, 0.0001, 0.0001)).toEqual({
            type: 'zone',
            fieldId: 'a',
            id: 'z1',
        });
        expect(hitCatalogue(fields, children, 2, 2)).toBeNull();
    });

    it('closes a two-point draft as a LineString and measures it', () => {
        const line = lineFromDraft([
            { lat: 0, lng: 0 },
            { lat: 0.001, lng: 0 },
        ]);
        expect(line?.type).toBe('LineString');
        expect(line?.coordinates).toHaveLength(2);
        const length = lineLengthM(line ?? undefined);
        expect(length).toBeGreaterThan(100);
        expect(length).toBeLessThan(120);
    });

    it('picks a nearby guidance line over the containing field', () => {
        const ab = {
            type: 'LineString' as const,
            coordinates: [
                [0, 0],
                [0.001, 0.001],
            ],
        };
        const fields = [{ id: 'a', name: 'A', geometry: SQUARE }];
        const children = {
            a: {
                zones: [],
                obstacles: [],
                guidance_lines: [
                    {
                        id: 'g1',
                        field_id: 'a',
                        name: 'AB-Nord',
                        geometry: ab,
                        provenance: {},
                        created_at: '',
                    },
                ],
            },
        };
        expect(hitCatalogue(fields, children, 0.0005, 0.0005)).toEqual({
            type: 'guidance',
            fieldId: 'a',
            id: 'g1',
        });
        const collection = fieldsToCollection(fields, 'g1', children);
        expect(collection.features.map((feature) => feature.properties.kind)).toEqual([
            'field',
            'guidance_line',
        ]);
        expect(collection.features[1]?.properties.overlay).toBe('guidance');
        expect(collection.features[1]?.properties.selected).toBe(true);
        expect(collection.features[1]?.properties.label).toBe('AB-Nord');
    });

    it('picks a nearby catalogue row over the containing field', () => {
        const rowLine = {
            type: 'LineString' as const,
            coordinates: [
                [0, 0.0004],
                [0.001, 0.0004],
            ],
        };
        const fields = [{ id: 'a', name: 'A', geometry: SQUARE }];
        const children = {
            a: {
                zones: [],
                obstacles: [],
                guidance_lines: [],
                row_sets: [
                    {
                        id: 'rs1',
                        field_id: 'a',
                        name: 'Rangs',
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
                                id: 'r1',
                                row_set_id: 'rs1',
                                field_id: 'a',
                                number: 1,
                                name: 'Rang 1',
                                geometry: rowLine,
                                state: 'active',
                                created_at: '',
                            },
                        ],
                    },
                ],
            },
        };
        expect(hitCatalogue(fields, children, 0.0005, 0.0004)).toEqual({
            type: 'row',
            fieldId: 'a',
            rowSetId: 'rs1',
            id: 'r1',
        });
        const collection = fieldsToCollection(fields, 'r1', children);
        expect(collection.features.map((feature) => feature.properties.kind)).toEqual([
            'field',
            'row',
        ]);
        expect(collection.features[1]?.properties.overlay).toBe('rows');
        expect(collection.features[1]?.properties.label).toBe('Rang 1');
    });

    it('picks a nearby traffic path or node over the containing field', () => {
        const path = {
            type: 'LineString' as const,
            coordinates: [
                [0, 0.0003],
                [0.001, 0.0003],
            ],
        };
        const gate = { type: 'Point' as const, coordinates: [0.0002, 0.0002] };
        const fields = [{ id: 'a', name: 'A', geometry: SQUARE }];
        const children = {
            a: {
                zones: [],
                obstacles: [],
                guidance_lines: [],
                traffic_ways: [
                    {
                        id: 'w1',
                        field_id: 'a',
                        name: 'Allée',
                        kind: 'path',
                        oneway: false,
                        speed_mps: null,
                        geometry: path,
                        provenance: {},
                        created_at: '',
                    },
                ],
                traffic_nodes: [
                    {
                        id: 'n1',
                        field_id: 'a',
                        name: 'Porte',
                        kind: 'gate',
                        geometry: gate,
                        provenance: {},
                        created_at: '',
                    },
                ],
            },
        };
        expect(hitCatalogue(fields, children, 0.0005, 0.0003)).toEqual({
            type: 'traffic_way',
            fieldId: 'a',
            id: 'w1',
        });
        expect(hitCatalogue(fields, children, 0.0002, 0.0002)).toEqual({
            type: 'traffic_node',
            fieldId: 'a',
            id: 'n1',
        });
        const collection = fieldsToCollection(fields, 'n1', children);
        expect(collection.features.map((feature) => feature.properties.kind)).toEqual([
            'field',
            'traffic_way',
            'traffic_node',
        ]);
        expect(collection.features[1]?.properties.overlay).toBe('traffic');
        expect(collection.features[2]?.properties.selected).toBe(true);
        expect(collection.features[0]?.properties.label).toBe('A');
        expect(collection.features[1]?.properties.label).toBe('Allée');
        expect(collection.features[2]?.properties.label).toBe('Porte');
    });

    it('hides the feature being re-edited so the draft is not doubled', () => {
        const collection = fieldsToCollection(
            [{ id: 'a', name: 'A', geometry: SQUARE }],
            'w1',
            {
                a: {
                    zones: [],
                    obstacles: [],
                    guidance_lines: [],
                    traffic_ways: [
                        {
                            id: 'w1',
                            field_id: 'a',
                            name: 'Allée',
                            kind: 'path',
                            oneway: false,
                            speed_mps: null,
                            geometry: {
                                type: 'LineString',
                                coordinates: [
                                    [0, 0],
                                    [0.001, 0],
                                ],
                            },
                            provenance: {},
                            created_at: '',
                        },
                    ],
                    traffic_nodes: [],
                },
            },
            'w1',
        );
        expect(collection.features.map((feature) => feature.properties.kind)).toEqual(['field']);
    });

    it('builds a safe GeoJSON download name', () => {
        expect(geojsonDownloadName('Les Graves')).toBe('Les_Graves.geojson');
        expect(geojsonDownloadName('a/b:c')).toBe('a-b-c.geojson');
        expect(geojsonDownloadName('   ')).toBe('parcelle.geojson');
    });
});
