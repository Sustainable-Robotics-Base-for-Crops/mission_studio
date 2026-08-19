import { describe, expect, it } from 'vitest';

import { getTotalPointsCount } from '../../frontend/src/domain/agri';
import {
    appendConnectedCoverage,
    appendCoverageSections,
    appendDrawnLine,
    applyDrawnWorkingZone,
    createEmptyDocument,
    deleteDrawnPointsInPolygon,
    documentOrigin,
    fillDrawnParcel,
    prependCoverageHeadlands,
    roundOriginLatLon,
    setDrawnGeofence,
} from '../../frontend/src/domain/draft';
import { DEFAULT_CONNECT_TURNS } from '../../frontend/src/domain/turns';
import { WORKING_ZONE_RINGS_KEY } from '../../frontend/src/domain/working-zone';
import { METERS_PER_DEGREE } from '../../frontend/src/domain/geometry';

const ORIGIN = { lat: 45.85, lon: 3.17 };

describe('appendDrawnLine', () => {
    it('rejects fewer than two vertices', () => {
        expect(appendDrawnLine(null, [{ lat: ORIGIN.lat, lng: ORIGIN.lon }])).toEqual({
            ok: false,
            reason: 'too_few_points',
        });
    });

    it('creates a two-vertex row_line and rounds a new origin to two decimals', () => {
        const start = { lat: 45.85123, lng: 3.17891 };
        const end = { lat: start.lat + 1 / METERS_PER_DEGREE, lng: start.lng };
        const result = appendDrawnLine(null, [start, end]);
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(documentOrigin(result.document)).toEqual(roundOriginLatLon(start.lat, start.lng));
        expect(result.document.points).toHaveLength(1);
        expect(result.document.points[0]?.section_type).toBe('row_line');
        expect(result.added).toBe(2);
        expect(getTotalPointsCount(result.document)).toBe(2);
        expect(createEmptyDocument().file_type).toBe('mission_order');
    });

    it('keeps an existing origin when the mission already has sections', () => {
        const first = appendDrawnLine(createEmptyDocument(), [
            { lat: ORIGIN.lat, lng: ORIGIN.lon },
            { lat: ORIGIN.lat + 1 / METERS_PER_DEGREE, lng: ORIGIN.lon },
        ]);
        expect(first.ok).toBe(true);
        if (!first.ok) {
            return;
        }
        const origin = documentOrigin(first.document);
        const second = appendDrawnLine(first.document, [
            { lat: ORIGIN.lat, lng: ORIGIN.lon + 0.001 },
            { lat: ORIGIN.lat + 1 / METERS_PER_DEGREE, lng: ORIGIN.lon + 0.001 },
        ]);
        expect(second.ok).toBe(true);
        if (!second.ok) {
            return;
        }
        expect(documentOrigin(second.document)).toEqual(origin);
        expect(second.document.points).toHaveLength(2);
    });

    it('keeps an empty draft origin rebase and stores only the two vertices', () => {
        const emptyDraft = {
            version: '3',
            origin: { type: 'WGS84', coordinates: { lat: 48, lon: 2, alt: 0 } },
            points: [],
        };
        const start = { lat: 45.85, lng: 3.17 };
        const end = { lat: start.lat + 1 / METERS_PER_DEGREE, lng: start.lng };
        const result = appendDrawnLine(emptyDraft, [start, end]);
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(documentOrigin(result.document)).toEqual(roundOriginLatLon(start.lat, start.lng));
        expect(result.document.points).toHaveLength(1);
        expect(result.added).toBe(2);
        expect(result.document.points[0]?.section_type).toBe('row_line');
    });
});

describe('setDrawnGeofence', () => {
    it('rejects fewer than three vertices', () => {
        expect(
            setDrawnGeofence(null, [
                { lat: ORIGIN.lat, lng: ORIGIN.lon },
                { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lon },
            ]),
        ).toEqual({ ok: false, reason: 'too_few_points' });
    });

    it('writes a closed Agri geofence and rebases an empty draft origin', () => {
        const ring = [
            { lat: 45.85, lng: 3.17 },
            { lat: 45.8504, lng: 3.17 },
            { lat: 45.8504, lng: 3.1705 },
        ];
        const result = setDrawnGeofence(
            {
                version: '3',
                origin: { type: 'WGS84', coordinates: { lat: 48, lon: 2, alt: 0 } },
                points: [],
            },
            ring,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(documentOrigin(result.document)).toEqual(
            roundOriginLatLon(ring[0].lat, ring[0].lng),
        );
        expect(result.added).toBe(3);
        const geofencing = result.document.geofencing as {
            columns: string[];
            values: number[][];
        };
        expect(geofencing.columns).toEqual(['x', 'y']);
        expect(geofencing.values).toHaveLength(3);
    });

    it('replaces a previous geofence like the legacy editor', () => {
        const first = setDrawnGeofence(createEmptyDocument(), [
            { lat: ORIGIN.lat, lng: ORIGIN.lon },
            { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lon },
            { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lon + 0.001 },
        ]);
        expect(first.ok).toBe(true);
        if (!first.ok) {
            return;
        }
        const second = setDrawnGeofence(first.document, [
            { lat: ORIGIN.lat, lng: ORIGIN.lon + 0.002 },
            { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lon + 0.002 },
            { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lon + 0.003 },
            { lat: ORIGIN.lat, lng: ORIGIN.lon + 0.003 },
        ]);
        expect(second.ok).toBe(true);
        if (!second.ok) {
            return;
        }
        const geofencing = second.document.geofencing as { values: number[][] };
        expect(geofencing.values).toHaveLength(4);
    });
});

describe('applyDrawnWorkingZone', () => {
    it('rejects fewer than three vertices and a document without origin', () => {
        expect(
            applyDrawnWorkingZone(
                null,
                [
                    { lat: ORIGIN.lat, lng: ORIGIN.lon },
                    { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lon },
                ],
                0,
            ),
        ).toEqual({ ok: false, reason: 'too_few_points' });
        const ring = [
            { lat: ORIGIN.lat, lng: ORIGIN.lon },
            { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lon },
            { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lon + 0.001 },
        ];
        expect(applyDrawnWorkingZone(null, ring, 0)).toEqual({ ok: false, reason: 'no_origin' });
    });

    it('sets working_zone to 0 on vertices inside the ring', () => {
        const line = appendDrawnLine(createEmptyDocument(), [
            { lat: ORIGIN.lat, lng: ORIGIN.lon },
            { lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lon },
        ]);
        expect(line.ok).toBe(true);
        if (!line.ok) {
            return;
        }
        const ring = [
            { lat: ORIGIN.lat - 0.0001, lng: ORIGIN.lon - 0.0001 },
            { lat: ORIGIN.lat + 0.0004, lng: ORIGIN.lon - 0.0001 },
            { lat: ORIGIN.lat + 0.0004, lng: ORIGIN.lon + 0.0001 },
            { lat: ORIGIN.lat - 0.0001, lng: ORIGIN.lon + 0.0001 },
        ];
        const result = applyDrawnWorkingZone(line.document, ring, 0);
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.count).toBe(2);
        expect(result.document.points[0]?.values[0]?.[3]).toBe(0);
        expect(result.document.points[0]?.values[1]?.[3]).toBe(0);
        const rings = (result.document.metadata as Record<string, unknown>)[WORKING_ZONE_RINGS_KEY];
        expect(Array.isArray(rings)).toBe(true);
        expect((rings as unknown[]).length).toBe(1);
    });
});

describe('deleteDrawnPointsInPolygon', () => {
    it('splits a section when the middle vertex is inside the cut', () => {
        const start = { lat: ORIGIN.lat, lng: ORIGIN.lon };
        const mid = { lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lon };
        const end = { lat: ORIGIN.lat + 0.0004, lng: ORIGIN.lon };
        const line = appendDrawnLine(createEmptyDocument(), [start, mid, end]);
        expect(line.ok).toBe(true);
        if (!line.ok) {
            return;
        }
        const ring = [
            { lat: mid.lat - 0.00005, lng: ORIGIN.lon - 0.0001 },
            { lat: mid.lat + 0.00005, lng: ORIGIN.lon - 0.0001 },
            { lat: mid.lat + 0.00005, lng: ORIGIN.lon + 0.0001 },
            { lat: mid.lat - 0.00005, lng: ORIGIN.lon + 0.0001 },
        ];
        const result = deleteDrawnPointsInPolygon(line.document, ring);
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.count).toBe(1);
        expect(result.document.points).toHaveLength(2);
        expect(result.document.points[0]?.values).toHaveLength(2);
        expect(result.document.points[1]?.values).toHaveLength(2);
        expect(result.document.points.every((section) => section.section_type === 'row_line')).toBe(
            true,
        );
    });

    it('clips a two-vertex row_line when the polygon sits between the endpoints', () => {
        const dLat = 20 / METERS_PER_DEGREE;
        const start = { lat: ORIGIN.lat, lng: ORIGIN.lon };
        const end = { lat: ORIGIN.lat + dLat, lng: ORIGIN.lon };
        const line = appendDrawnLine(createEmptyDocument(), [start, end]);
        expect(line.ok).toBe(true);
        if (!line.ok) {
            return;
        }
        const midLat = ORIGIN.lat + dLat / 2;
        const half = 3 / METERS_PER_DEGREE;
        const dLng = 4 / (METERS_PER_DEGREE * Math.cos((ORIGIN.lat * Math.PI) / 180));
        const ring = [
            { lat: midLat - half, lng: ORIGIN.lon - dLng },
            { lat: midLat + half, lng: ORIGIN.lon - dLng },
            { lat: midLat + half, lng: ORIGIN.lon + dLng },
            { lat: midLat - half, lng: ORIGIN.lon + dLng },
        ];
        const result = deleteDrawnPointsInPolygon(line.document, ring);
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.count).toBe(1);
        expect(result.document.points).toHaveLength(2);
        expect(result.document.points[0]?.values).toHaveLength(2);
        expect(result.document.points[1]?.values).toHaveLength(2);
    });

    it('cuts a hole through filled parcel rows instead of no-op', () => {
        const dLat = 20 / METERS_PER_DEGREE;
        const dLng = 20 / (METERS_PER_DEGREE * Math.cos((ORIGIN.lat * Math.PI) / 180));
        const parcel = [
            { lat: ORIGIN.lat, lng: ORIGIN.lon },
            { lat: ORIGIN.lat, lng: ORIGIN.lon + dLng },
            { lat: ORIGIN.lat + dLat, lng: ORIGIN.lon + dLng },
            { lat: ORIGIN.lat + dLat, lng: ORIGIN.lon },
        ];
        const filled = fillDrawnParcel(createEmptyDocument(), parcel, 5);
        expect(filled.ok).toBe(true);
        if (!filled.ok) {
            return;
        }
        const before = filled.document.points.length;
        expect(before).toBeGreaterThanOrEqual(3);
        const cutHalfLat = 4 / METERS_PER_DEGREE;
        const cutHalfLng = 4 / (METERS_PER_DEGREE * Math.cos((ORIGIN.lat * Math.PI) / 180));
        const centerLat = ORIGIN.lat + dLat / 2;
        const centerLng = ORIGIN.lon + dLng / 2;
        const cut = [
            { lat: centerLat - cutHalfLat, lng: centerLng - cutHalfLng },
            { lat: centerLat + cutHalfLat, lng: centerLng - cutHalfLng },
            { lat: centerLat + cutHalfLat, lng: centerLng + cutHalfLng },
            { lat: centerLat - cutHalfLat, lng: centerLng + cutHalfLng },
        ];
        const result = deleteDrawnPointsInPolygon(filled.document, cut);
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.count).toBeGreaterThan(0);
        expect(result.document.points.length).toBeGreaterThan(before);
        expect(result.document.points.every((section) => section.values.length >= 2)).toBe(true);
    });
});

describe('fillDrawnParcel', () => {
    it('appends row_line sections and rejects a non-positive spacing', () => {
        expect(fillDrawnParcel(null, [{ lat: ORIGIN.lat, lng: ORIGIN.lon }], 2.5)).toEqual({
            ok: false,
            reason: 'too_few_points',
        });
        const dLat = 20 / METERS_PER_DEGREE;
        const dLng = 20 / (METERS_PER_DEGREE * Math.cos((ORIGIN.lat * Math.PI) / 180));
        const ring = [
            { lat: ORIGIN.lat, lng: ORIGIN.lon },
            { lat: ORIGIN.lat, lng: ORIGIN.lon + dLng },
            { lat: ORIGIN.lat + dLat, lng: ORIGIN.lon + dLng },
            { lat: ORIGIN.lat + dLat, lng: ORIGIN.lon },
        ];
        expect(fillDrawnParcel(createEmptyDocument(), ring, 0)).toEqual({
            ok: false,
            reason: 'invalid_spacing',
        });
        const result = fillDrawnParcel(createEmptyDocument(), ring, 5);
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.rows).toBeGreaterThanOrEqual(3);
        expect(result.document.points.every((section) => section.section_type === 'row_line')).toBe(
            true,
        );
    });
});

describe('appendCoverageSections', () => {
    it('merges Agri row_line sections and srbc_coverage metadata', () => {
        const first = { lat: ORIGIN.lat, lng: ORIGIN.lon };
        const section = {
            section_type: 'row_line',
            columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
            values: [
                [0, 0, 0.5, 1, {}],
                [10, 0, 0.5, 1, {}],
            ],
        };
        const result = appendCoverageSections(createEmptyDocument(), first, [section], {
            engine: 'fields2cover',
            swath_count: 1,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.rows).toBe(1);
        expect(result.document.metadata).toMatchObject({
            srbc_coverage: { engine: 'fields2cover', swath_count: 1 },
        });
    });

    it('prepends fourrière row_path ahead of interior row_line', () => {
        const first = { lat: ORIGIN.lat, lng: ORIGIN.lon };
        const interior = {
            section_type: 'row_line',
            columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
            values: [
                [0, 0, 0.5, 1, {}],
                [10, 0, 0.5, 1, {}],
            ],
        };
        const headland = {
            section_type: 'row_path',
            columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
            values: [
                [0, -2, 0.5, 1, {}],
                [12, -2, 0.5, 1, {}],
                [12, 4, 0.5, 1, {}],
            ],
        };
        const filled = appendCoverageSections(createEmptyDocument(), first, [interior], {
            engine: 'parallel_fallback',
        });
        const result = prependCoverageHeadlands(filled, [headland]);
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.document.points.map((section) => section.section_type)).toEqual([
            'row_path',
            'row_line',
        ]);
        expect(result.rows).toBe(2);
    });
});

describe('appendConnectedCoverage', () => {
    const row = (y: number) => ({
        section_type: 'row_line' as const,
        columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
        values: [
            [0, y, 0.5, 1, {}],
            [10, y, 0.5, 1, {}],
        ],
    });

    it('connects a second fill without stitching it to existing rows', () => {
        const first = { lat: ORIGIN.lat, lng: ORIGIN.lon };
        const firstFill = appendConnectedCoverage(
            createEmptyDocument(),
            first,
            [row(0), row(5)],
            [],
            { engine: 'test' },
            DEFAULT_CONNECT_TURNS,
        );
        expect(firstFill.ok).toBe(true);
        if (!firstFill.ok) {
            return;
        }
        expect(firstFill.turns).toBe(1);
        const second = appendConnectedCoverage(
            firstFill.document,
            first,
            [row(20), row(25)],
            [
                {
                    section_type: 'row_path',
                    columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
                    values: [
                        [0, 18, 0.5, 1, {}],
                        [12, 18, 0.5, 1, {}],
                    ],
                },
            ],
            { engine: 'test' },
            DEFAULT_CONNECT_TURNS,
        );
        expect(second.ok).toBe(true);
        if (!second.ok) {
            return;
        }
        expect(second.turns).toBe(1);
        expect(second.document.points.map((section) => section.section_type)).toEqual([
            'row_line',
            'turn_square',
            'row_line',
            'row_path',
            'row_line',
            'turn_square',
            'row_line',
        ]);
    });
});
