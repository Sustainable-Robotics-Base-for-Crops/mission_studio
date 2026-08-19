import { describe, expect, it } from 'vitest';

import type { CoveragePlanResult } from '../../frontend/src/coverage/api';
import { skipEveryNthWorkSection, workSectionIndices } from '../../frontend/src/domain/crop-pack';
import type { AgriDocument } from '../../frontend/src/domain/agri';
import type { FieldSummary } from '../../frontend/src/fields/types';
import { defaultMissionBrief } from '../../frontend/src/missions/brief';
import { applyCoverageToFields } from '../../frontend/src/packs/apply-to-fields';

const SQUARE = {
    type: 'Polygon' as const,
    coordinates: [
        [
            [3.17, 45.85],
            [3.171, 45.85],
            [3.171, 45.851],
            [3.17, 45.851],
            [3.17, 45.85],
        ],
    ],
};

function field(id: string, name: string): FieldSummary {
    return {
        id,
        name,
        campaign: null,
        geometry: SQUARE,
        crs: 'EPSG:4326',
        provenance: {},
        qualified_for_autonomy: false,
        created_at: '2026-08-19T00:00:00Z',
        updated_at: '2026-08-19T00:00:00Z',
    };
}

function rows(count: number): AgriDocument {
    return {
        version: '3',
        points: Array.from({ length: count }, (_, index) => ({
            section_type: 'row_line',
            columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
            values: [
                [0, index, 0.5, 1, {}],
                [10, index, 0.5, 1, {}],
            ],
        })),
        metadata: {},
    };
}

function planOf(count: number): CoveragePlanResult {
    const document = rows(count);
    return {
        engine: 'parallel_fallback',
        sections: document.points,
        headland_sections: [],
        variants: [],
        metrics: { swath_count: count, length_m: 40, heading_rad: 0, headland_laps: 0 },
        srbc_coverage: { engine: 'parallel_fallback' },
        origin: { lat: 45.85, lon: 3.17 },
    };
}

describe('applyCoverageToFields', () => {
    it('saves one mission per field and can skip every other work row', async () => {
        const saved: string[] = [];
        const skipped: number[] = [];
        const result = await applyCoverageToFields(
            {
                fieldIds: ['a', 'b'],
                fields: [field('a', 'Nord'), field('b', 'Sud')],
                brief: { ...defaultMissionBrief(), crop_pack: 'open_field' },
                equipment: null,
                odd: null,
                vehicleWidthM: 1.2,
                geofenceMarginM: null,
                skipEveryN: 1,
            },
            {
                planFn: async () => planOf(4),
                composeFn: (input) => {
                    const document = rows(4);
                    document.metadata = {
                        srbc_mission_brief: { field_id: input.brief.field_id },
                    };
                    return { ok: true, document, rows: 4, points: 4, turns: 0 };
                },
                saveFn: async (document, path) => {
                    skipped.push(workSectionIndices(document as AgriDocument).length);
                    saved.push(path);
                    return path;
                },
                pathFn: (document) => {
                    const brief = (
                        document.metadata as
                            { srbc_mission_brief?: { field_id?: string } } | undefined
                    )?.srbc_mission_brief;
                    return String(brief?.field_id ?? 'x');
                },
            },
        );
        expect(result.saved).toHaveLength(2);
        expect(result.errors).toHaveLength(0);
        expect(
            skipped.every((count) => count === skipEveryNthWorkSection(rows(4), 1).points.length),
        ).toBe(true);
        expect(saved).toEqual(['a', 'b']);
    });

    it('records a missing field without calling the planner', async () => {
        let planned = 0;
        const result = await applyCoverageToFields(
            {
                fieldIds: ['missing'],
                fields: [field('a', 'Nord')],
                brief: defaultMissionBrief(),
                equipment: null,
                odd: null,
                vehicleWidthM: null,
                geofenceMarginM: null,
                skipEveryN: 0,
            },
            {
                planFn: async () => {
                    planned += 1;
                    return planOf(1);
                },
            },
        );
        expect(planned).toBe(0);
        expect(result.errors[0]?.message).toBe('missing');
    });
});
