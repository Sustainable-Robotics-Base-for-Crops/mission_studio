import { describe, expect, it } from 'vitest';

import type { CoveragePlanResult } from '../../frontend/src/coverage/api';
import {
    briefToMetadata,
    defaultMissionBrief,
    missingBriefGates,
    readMissionContext,
    ringFromPolygon,
} from '../../frontend/src/missions/brief';
import { composeGeneratedMission } from '../../frontend/src/missions/compose';
import { documentOrigin, roundOriginLatLon } from '../../frontend/src/domain/draft';
import { localToLatLng } from '../../frontend/src/domain/geometry';

const RING = [
    { lat: 45.85, lng: 3.17 },
    { lat: 45.85, lng: 3.171 },
    { lat: 45.851, lng: 3.171 },
    { lat: 45.851, lng: 3.17 },
];

function planOf(count: number): CoveragePlanResult {
    const sections = Array.from({ length: count }, (_, index) => ({
        section_type: 'row_line',
        columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
        values: [
            [0, index * 2, 0.5, 1, {}],
            [10, index * 2, 0.5, 1, {}],
        ],
    }));
    return {
        engine: 'parallel_fallback',
        sections,
        headland_sections: [
            {
                section_type: 'row_path',
                columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
                values: [
                    [0, -2, 0.5, 1, {}],
                    [12, -2, 0.5, 1, {}],
                    [12, 8, 0.5, 1, {}],
                ],
            },
        ],
        variants: [
            {
                strategy: 'boustrophedon',
                heading_rad: 0,
                swath_count: count,
                length_m: 40,
                sections,
            },
        ],
        metrics: { swath_count: count, length_m: 40, heading_rad: 0, headland_laps: 1 },
        srbc_coverage: {
            engine: 'parallel_fallback',
            strategy: 'boustrophedon',
            swath_count: count,
        },
        origin: { lat: 45.85, lon: 3.17 },
    };
}

describe('mission brief', () => {
    it('lists the gates required before generation', () => {
        const brief = defaultMissionBrief(new Date('2026-08-19T12:00:00Z'));
        expect(brief.campaign).toBe('2026');
        expect(missingBriefGates(brief)).toEqual(['field', 'combination']);
        expect(
            missingBriefGates({
                ...brief,
                field_id: 'f1',
                combination_id: 'c1',
                overlap_m: 2,
                working_width_m: 1.2,
            }),
        ).toEqual(['overlap']);
    });

    it('drops the closing vertex of a GeoJSON ring', () => {
        const points = ringFromPolygon({
            type: 'Polygon',
            coordinates: [
                [
                    [3.17, 45.85],
                    [3.171, 45.85],
                    [3.171, 45.851],
                    [3.17, 45.85],
                ],
            ],
        });
        expect(points).toHaveLength(3);
        expect(points[0]).toEqual({ lat: 45.85, lng: 3.17 });
    });

    it('projects the brief into metadata.srbc_mission_brief', () => {
        const metadata = briefToMetadata({
            ...defaultMissionBrief(),
            field_id: 'grave',
            combination_id: 'srbc-hoe',
        });
        expect(metadata.field_id).toBe('grave');
        expect(metadata.combination_id).toBe('srbc-hoe');
        expect(metadata.window).toEqual({ from: null, to: null });
    });

    it('reads the brief back from an Agri document', () => {
        const context = readMissionContext({
            points: [],
            metadata: {
                srbc_mission_brief: briefToMetadata({
                    ...defaultMissionBrief(),
                    operation: 'seeding',
                    campaign: '2026',
                    field_id: 'grave',
                    combination_id: 'srbc-hoe',
                    working_width_m: 1.2,
                }),
            },
        });
        expect(context).toEqual({
            operation: 'seeding',
            campaign: '2026',
            field_id: 'grave',
            combination_id: 'srbc-hoe',
            working_width_m: 1.2,
        });
        expect(readMissionContext({ points: [] })).toBeNull();
    });
});

describe('composeGeneratedMission', () => {
    it('writes geofence, fourrière first, interior rows and brief metadata', () => {
        const result = composeGeneratedMission({
            ring: RING,
            plan: planOf(2),
            brief: {
                ...defaultMissionBrief(),
                field_id: 'f1',
                combination_id: 'c1',
            },
            equipment: { vehicle: { id: 'srbc' } },
            strategy: 'boustrophedon',
            connectTurns: false,
            turnType: 'square',
        });
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.document.points[0]?.section_type).toBe('row_path');
        expect(result.document.points.map((section) => section.section_type)).toEqual([
            'row_path',
            'row_line',
            'row_line',
        ]);
        expect(result.document.geofencing).toBeTruthy();
        expect(result.document.metadata).toMatchObject({
            srbc_mission_brief: { field_id: 'f1' },
            srbc_equipment: { vehicle: { id: 'srbc' } },
            srbc_coverage: { engine: 'parallel_fallback' },
        });
    });

    it('can insert square pivots between interior row_line sections', () => {
        const result = composeGeneratedMission({
            ring: RING,
            plan: planOf(2),
            brief: defaultMissionBrief(),
            equipment: null,
            strategy: 'boustrophedon',
            connectTurns: true,
            turnType: 'square',
        });
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.turns).toBeGreaterThanOrEqual(1);
        expect(
            result.document.points.some((section) => section.section_type === 'turn_square'),
        ).toBe(true);
        expect(result.document.points[0]?.section_type).toBe('row_path');
        const interiorXs = result.document.points
            .filter((section) => section.section_type !== 'row_path')
            .flatMap((section) => section.values.map((row) => Number(row[0])));
        expect(Math.min(...interiorXs)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...interiorXs)).toBeLessThanOrEqual(10);
    });

    it('keeps the implement hull inside the original row envelope', () => {
        const result = composeGeneratedMission({
            ring: RING,
            plan: planOf(2),
            brief: defaultMissionBrief(),
            equipment: null,
            strategy: 'boustrophedon',
            connectTurns: true,
            turnType: 'square',
            geofenceMarginM: 0.6,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        const interiorXs = result.document.points
            .filter((section) => section.section_type !== 'row_path')
            .flatMap((section) => section.values.map((row) => Number(row[0])));
        expect(Math.max(...interiorXs) + 0.6).toBeLessThanOrEqual(10 + 1e-6);
    });

    it('reprojects planner XY onto the Agri origin rounded to two decimals', () => {
        const fine = { lat: 45.85321, lng: 3.17234 };
        const ring = [
            fine,
            { lat: fine.lat, lng: fine.lng + 0.001 },
            { lat: fine.lat + 0.001, lng: fine.lng + 0.001 },
            { lat: fine.lat + 0.001, lng: fine.lng },
        ];
        const plan = planOf(2);
        plan.origin = { lat: fine.lat, lon: fine.lng };
        const result = composeGeneratedMission({
            ring,
            plan,
            brief: defaultMissionBrief(),
            equipment: null,
            strategy: 'boustrophedon',
            connectTurns: false,
            turnType: 'square',
        });
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(documentOrigin(result.document)).toEqual(roundOriginLatLon(fine.lat, fine.lng));
        const firstRow = result.document.points.find(
            (section) => section.section_type === 'row_line',
        );
        const origin = documentOrigin(result.document);
        expect(firstRow && origin).toBeTruthy();
        if (!firstRow || !origin) {
            return;
        }
        const geo = localToLatLng(
            { x: Number(firstRow.values[0]?.[0]), y: Number(firstRow.values[0]?.[1]) },
            origin,
        );
        expect(geo.lat).toBeCloseTo(fine.lat, 5);
        expect(geo.lng).toBeCloseTo(fine.lng, 5);
    });
});
