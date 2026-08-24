import { describe, expect, it } from 'vitest';

import type { AgriDocument, AgriSection } from '../../frontend/src/domain/agri';
import {
    getSectionTypeString,
    remapIndexAfterReorder,
    reorderSection,
} from '../../frontend/src/domain/agri';
import {
    buildMissionTree,
    formatDurationCompact,
    formatMetricsDeltaCaption,
    indexListIntersects,
    remapIndexList,
    remapIndexListAfterDelete,
    sectionLengthM,
    sectionRole,
} from '../../frontend/src/missions/tree';

const COLUMNS = ['x', 'y', 'speed', 'working_zone', 'punctual'];

function row(type: string, start: [number, number], end: [number, number]): AgriSection {
    return {
        section_type: type,
        columns: [...COLUMNS],
        values: [
            [start[0], start[1], 0.5, 1, {}],
            [end[0], end[1], 0.5, 1, {}],
        ],
    };
}

function documentOf(points: AgriSection[]): AgriDocument {
    return { points };
}

describe('mission tree', () => {
    it('classifies fourrière, rang and pivot', () => {
        expect(sectionRole(row('row_path', [0, 0], [10, 0]))).toBe('headland');
        expect(sectionRole(row('row_line', [0, 0], [10, 0]))).toBe('work');
        expect(sectionRole(row('turn_square', [10, 0], [10, 5]))).toBe('turn');
        expect(sectionLengthM(row('row_line', [0, 0], [10, 0]))).toBe(10);
    });

    it('groups consecutive work and turns, then reports live metrics', () => {
        const tree = buildMissionTree(
            documentOf([
                row('row_path', [0, -2], [12, -2]),
                row('row_line', [0, 0], [10, 0]),
                row('turn_square', [10, 0], [10, 5]),
                row('row_line', [10, 5], [0, 5]),
            ]),
        );
        expect(tree.groups.map((group) => group.bucket)).toEqual(['headland', 'work']);
        expect(tree.metrics.rows).toBe(2);
        expect(tree.metrics.turns).toBe(1);
        expect(tree.metrics.headlands).toBe(1);
        expect(tree.metrics.length_m).toBeCloseTo(37, 5);
        expect(tree.metrics.duration_s).toBeCloseTo(74, 5);
        expect(tree.leaves[1]?.ordinal).toBe(1);
        expect(tree.leaves[3]?.ordinal).toBe(2);
    });

    it('adds the outer geofence and exclusion areas to the tree', () => {
        const tree = buildMissionTree({
            points: [],
            geofencing: {
                columns: ['x', 'y'],
                values: [
                    [0, 0],
                    [20, 0],
                    [20, 10],
                    [0, 10],
                ],
            },
            metadata: {
                srbc_geofence_exclusions: [
                    [
                        [2, 2],
                        [4, 2],
                        [4, 5],
                        [2, 5],
                    ],
                ],
            },
        });
        expect(tree.geofence).toEqual([
            { id: 'outer', role: 'outer', ordinal: 1, area_m2: 200 },
            { id: 'exclusion:0', role: 'exclusion', ordinal: 1, area_m2: 6 },
        ]);
    });

    it('keeps selected index after a one-step reorder', () => {
        const doc = documentOf([
            row('row_line', [0, 0], [10, 0]),
            row('turn_square', [10, 0], [10, 5]),
            row('row_line', [10, 5], [0, 5]),
        ]);
        const moved = reorderSection(doc, 1, 2);
        expect(getSectionTypeString(moved.points[2]!)).toBe('turn_square');
        expect(remapIndexAfterReorder(1, 1, 2)).toBe(2);
    });

    it('formats a compact duration', () => {
        expect(formatDurationCompact(74)).toBe('1:14');
        expect(formatDurationCompact(3600 + 5)).toBe('1:00:05');
    });

    it('remaps hidden indices after reorder and delete', () => {
        expect(remapIndexList([0, 2], 0, 2)).toEqual([2, 1]);
        expect(remapIndexListAfterDelete([0, 2, 3], [1])).toEqual([0, 1, 2]);
        expect(remapIndexListAfterDelete([1, 3], [1])).toEqual([2]);
    });

    it('formats a live metrics delta against a baseline', () => {
        const baseline = {
            length_m: 100,
            duration_s: 200,
            rows: 4,
            turns: 3,
            headlands: 1,
            sections: 8,
        };
        expect(
            formatMetricsDeltaCaption({ ...baseline, length_m: 142, duration_s: 218 }, baseline),
        ).toBe('+42 m · +0:18');
        expect(formatMetricsDeltaCaption(baseline, baseline)).toBeNull();
    });

    it('detects a locked selection', () => {
        expect(indexListIntersects([1, 4], [4])).toBe(true);
        expect(indexListIntersects([1], [2])).toBe(false);
        expect(indexListIntersects([], [1])).toBe(false);
    });
});
