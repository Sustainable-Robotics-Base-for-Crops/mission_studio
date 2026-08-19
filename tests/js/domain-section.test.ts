/**
 * Parity pin: L4 second-cut domain modules vs TrajectoryEditor.js / SectionController.js.
 * /app is not rewired; these tests lock the extracted behaviour before Studio tools call it.
 */
import { describe, expect, it } from 'vitest';

import {
    cloneSectionValueRow,
    deleteSection,
    getSectionTypeString,
    getTotalPointsCount,
    isTurnSection,
    MAX_POINTS_PER_SECTION,
    remapIndexAfterReorder,
    reorderSection,
    reverseSectionInDocument,
    type AgriDocument,
    type AgriSection,
    type SectionRow,
} from '../../frontend/src/domain/agri';
import {
    densifyRowLineSectionToRowPath,
    duplicateSectionsInDocument,
    extendSection,
    extendSectionSmart,
    offsetSections,
    generateRowLineFromLatLngs,
    generateRowPathFromLatLngs,
    moveSections,
    normalizeSectionToColumns,
    rotateSections,
    buildSectionsAfterDelete,
    clipSectionsOutsidePolygon,
} from '../../frontend/src/domain/section';
import { applySpeedToAllPoints, getCurrentTrajectorySpeed } from '../../frontend/src/domain/speed';
import {
    applyWorkingZoneInPolygon,
    getPointsInPolygon,
    polygonLocalFromLatLngs,
} from '../../frontend/src/domain/working-zone';
import { METERS_PER_DEGREE, round3 } from '../../frontend/src/domain/geometry';

const COLUMNS = ['x', 'y', 'speed', 'working_zone', 'punctual'];
const ORIGIN = { lat: 45.85, lon: 3.17 };

function row(x: number, y: number, speed = 0.5, wz: 0 | 1 = 1): SectionRow {
    return [x, y, speed, wz, {}];
}

function section(values: SectionRow[], type = 'row_path'): AgriSection {
    return { section_type: type, columns: [...COLUMNS], values };
}

function documentOf(points: AgriSection[]): AgriDocument {
    return { origin: { coordinates: { ...ORIGIN } }, points };
}

describe('agri primitives', () => {
    it('reads section_type then sectionType.value then sectionType string', () => {
        expect(getSectionTypeString({ columns: COLUMNS, values: [] })).toBe('row_path');
        expect(
            getSectionTypeString({ section_type: 'row_line', columns: COLUMNS, values: [] }),
        ).toBe('row_line');
        expect(
            getSectionTypeString({
                sectionType: { value: 'turn_path' },
                columns: COLUMNS,
                values: [],
            }),
        ).toBe('turn_path');
        expect(
            getSectionTypeString({ sectionType: 'turn_square', columns: COLUMNS, values: [] }),
        ).toBe('turn_square');
        expect(isTurnSection(section([row(0, 0)], 'turn_path'))).toBe(true);
        expect(isTurnSection(section([row(0, 0)], 'row_path'))).toBe(false);
    });

    it('clones punctual objects so later edits do not alias', () => {
        const original = row(1, 2);
        const cloned = cloneSectionValueRow(original);
        (cloned[4] as Record<string, unknown>).flag = true;
        expect(original[4]).toEqual({});
    });

    it('deletes, reverses and counts points like SectionController', () => {
        const doc = documentOf([section([row(0, 0), row(1, 0)]), section([row(2, 0)])]);
        expect(getTotalPointsCount(doc)).toBe(3);
        expect(deleteSection(doc, 0).points).toHaveLength(1);
        expect(reverseSectionInDocument(doc, 0).points[0]?.values.map((entry) => entry[0])).toEqual(
            [1, 0],
        );
    });

    it('reorders with a post-removal destination index and remaps selection', () => {
        const doc = documentOf([section([row(0, 0)]), section([row(1, 0)]), section([row(2, 0)])]);
        const moved = reorderSection(doc, 0, 2);
        expect(moved.points.map((entry) => entry.values[0]?.[0])).toEqual([1, 2, 0]);
        expect(remapIndexAfterReorder(0, 0, 2)).toBe(2);
        expect(remapIndexAfterReorder(1, 0, 2)).toBe(0);
        expect(remapIndexAfterReorder(2, 0, 2)).toBe(1);
        expect(reorderSection(doc, -1, 1)).toBe(doc);
        expect(reorderSection(doc, 1, 1)).toBe(doc);
    });
});

describe('densify and normalize', () => {
    it('turns a 1 m row_line into a 11-point row_path at 0.1 m', () => {
        const line = section([row(0, 0), row(1, 0)], 'row_line');
        const path = densifyRowLineSectionToRowPath(line);
        expect(path.section_type).toBe('row_path');
        expect(path.sectionType).toBeUndefined();
        expect(path.values).toHaveLength(11);
        expect(path.values[0]?.[0]).toBe(0);
        expect(path.values[1]?.[0]).toBe(0.1);
        expect(path.values[10]?.[0]).toBe(1);
        expect(densifyRowLineSectionToRowPath(section([row(0, 0)], 'row_path'))).toEqual(
            section([row(0, 0)], 'row_path'),
        );
    });

    it('reindexes columns and can force speed', () => {
        const source: AgriSection = {
            section_type: 'row_path',
            columns: ['y', 'x'],
            values: [[4, 3]],
        };
        const normalized = normalizeSectionToColumns(source, COLUMNS, { speed: 1.2 });
        expect(normalized.columns).toEqual(COLUMNS);
        expect(normalized.values[0]).toEqual([3, 4, 1.2, 0, {}]);
    });
});

describe('extendSection', () => {
    it('returns added 0 when the target is closer than the spacing', () => {
        const doc = documentOf([section([row(0, 0), row(0, 1)])]);
        expect(extendSection(doc, 0, 'end', { x: 0, y: 1.05 }).added).toBe(0);
    });

    it('appends interpolated clones of the anchor row, then the exact target', () => {
        const doc = documentOf([section([row(0, 0, 0.8, 0), row(0, 1, 0.8, 0)])]);
        const result = extendSection(doc, 0, 'end', { x: 0, y: 1.5 });
        expect(result.added).toBeGreaterThan(0);
        const values = result.document.points[0]?.values ?? [];
        expect(values[values.length - 1]?.[1]).toBe(round3(1.5));
        expect(values[values.length - 1]?.[2]).toBe(0.8);
        expect(values[values.length - 1]?.[3]).toBe(0);
        expect(doc.points[0]?.values).toHaveLength(2);
    });

    it('prepends when extending the start', () => {
        const doc = documentOf([section([row(0, 0), row(0, 1)])]);
        const result = extendSection(doc, 0, 'start', { x: 0, y: -0.5 });
        expect(result.document.points[0]?.values[0]?.[1]).toBe(round3(-0.5));
    });

    it('returns added -1 when the section would exceed MAX_POINTS_PER_SECTION', () => {
        const values = Array.from({ length: MAX_POINTS_PER_SECTION - 1 }, () => row(0, 0));
        const doc = documentOf([section(values)]);
        expect(extendSection(doc, 0, 'end', { x: 0, y: 1 }).added).toBe(-1);
        expect(doc.points[0]?.values).toHaveLength(MAX_POINTS_PER_SECTION - 1);
    });
});

describe('extendSectionSmart', () => {
    it('relocates a row_line endpoint and keeps two vertices', () => {
        const doc = documentOf([section([row(0, 0), row(0, 1)], 'row_line')]);
        const result = extendSectionSmart(doc, 0, 'end', { x: 0, y: 12 });
        expect(result.mode).toBe('relocate');
        expect(result.added).toBe(1);
        expect(result.document.points[0]?.values).toHaveLength(2);
        expect(result.document.points[0]?.values[1]?.slice(0, 2)).toEqual([0, 12]);
        expect(doc.points[0]?.values).toHaveLength(2);
    });

    it('relocates a turn_square start vertex without densifying', () => {
        const doc = documentOf([
            section([row(0, 0), row(1, 0), row(1, 1), row(0, 1)], 'turn_square'),
        ]);
        const result = extendSectionSmart(doc, 0, 'start', { x: -4, y: 0 });
        expect(result.mode).toBe('relocate');
        expect(result.document.points[0]?.values).toHaveLength(4);
        expect(result.document.points[0]?.values[0]?.slice(0, 2)).toEqual([-4, 0]);
    });

    it('still densifies a row_path at 0.1 m', () => {
        const doc = documentOf([section([row(0, 0), row(0, 1)], 'row_path')]);
        const result = extendSectionSmart(doc, 0, 'end', { x: 0, y: 1.5 });
        expect(result.mode).toBe('densify');
        expect(result.added).toBeGreaterThan(1);
        expect(result.document.points[0]?.values.length).toBeGreaterThan(2);
    });
});

describe('buildSectionsAfterDelete', () => {
    it('splits a section on a hole and drops empty remnants', () => {
        const sections = [section([row(0, 0), row(1, 0), row(2, 0), row(3, 0), row(4, 0)])];
        const split = buildSectionsAfterDelete(sections, [{ sectionIndex: 0, pointIndex: 2 }]);
        expect(split).toHaveLength(2);
        expect(split[0]?.values.map((entry) => entry[0])).toEqual([0, 1]);
        expect(split[1]?.values.map((entry) => entry[0])).toEqual([3, 4]);
        expect(
            buildSectionsAfterDelete(
                sections,
                [0, 1, 2, 3, 4].map((pointIndex) => ({ sectionIndex: 0, pointIndex })),
            ),
        ).toEqual([]);
    });
});

describe('clipSectionsOutsidePolygon', () => {
    it('turns a two-vertex row_line into two row_lines when the cut has no vertex hit', () => {
        const sections = [section([row(0, 0), row(10, 0)], 'row_line')];
        const ring: [number, number][] = [
            [4, -2],
            [6, -2],
            [6, 2],
            [4, 2],
        ];
        const { sections: clipped, changed } = clipSectionsOutsidePolygon(sections, ring);
        expect(changed).toBe(1);
        expect(clipped).toHaveLength(2);
        expect(clipped[0]?.values).toHaveLength(2);
        expect(clipped[1]?.values).toHaveLength(2);
        expect(clipped[0]?.values[0]?.[0]).toBe(0);
        expect(clipped[0]?.values[1]?.[0]).toBeCloseTo(4, 3);
        expect(clipped[1]?.values[0]?.[0]).toBeCloseTo(6, 3);
        expect(clipped[1]?.values[1]?.[0]).toBe(10);
    });
});

describe('move, rotate, offset', () => {
    it('translates only the selected sections', () => {
        const doc = documentOf([section([row(0, 0)]), section([row(10, 0)])]);
        const moved = moveSections(doc, [1], 2, -3);
        expect(moved.points[0]?.values[0]?.slice(0, 2)).toEqual([0, 0]);
        expect(moved.points[1]?.values[0]?.slice(0, 2)).toEqual([12, -3]);
        const line = documentOf([section([row(0, 0), row(0, 10)], 'row_line')]);
        const shifted = moveSections(line, [0], 1, 0);
        expect(shifted.points[0]?.section_type).toBe('row_line');
        expect(shifted.points[0]?.values).toHaveLength(2);
    });

    it('rotates selected sections around their shared centroid', () => {
        const doc = documentOf([section([row(0, 0), row(2, 0)])]);
        const rotated = rotateSections(doc, [0], 90);
        expect(rotated.points[0]?.values[0]?.[0]).toBe(1);
        expect(rotated.points[0]?.values[0]?.[1]).toBe(-1);
        expect(rotated.points[0]?.values[1]?.[0]).toBe(1);
        expect(rotated.points[0]?.values[1]?.[1]).toBe(1);
    });

    it('duplicates to the left, reversing odd copies, and appends at the end', () => {
        const doc = documentOf([section([row(0, 0), row(0, 10)])]);
        const duplicated = duplicateSectionsInDocument(doc, [0], 2.5, 'left', 2);
        expect(duplicated.points).toHaveLength(3);
        const firstCopy = duplicated.points[1];
        const secondCopy = duplicated.points[2];
        expect(firstCopy?.values[0]?.[0]).toBeCloseTo(-2.5, 9);
        expect(firstCopy?.values[0]?.[1]).toBe(10);
        expect(firstCopy?.values[1]?.[1]).toBe(0);
        expect(secondCopy?.values[0]?.[0]).toBeCloseTo(-5, 9);
        expect(secondCopy?.values[0]?.[1]).toBe(0);
    });

    it('offsets a row_line in place without densifying or copying', () => {
        const doc = documentOf([section([row(0, 0), row(0, 10)], 'row_line')]);
        const offset = offsetSections(doc, [0], 2, 'left');
        expect(offset.points).toHaveLength(1);
        expect(offset.points[0]?.section_type).toBe('row_line');
        expect(offset.points[0]?.values).toHaveLength(2);
        expect(offset.points[0]?.values[0]?.slice(0, 2)).toEqual([-2, 0]);
        expect(offset.points[0]?.values[1]?.slice(0, 2)).toEqual([-2, 10]);
        expect(doc.points[0]?.values[0]?.slice(0, 2)).toEqual([0, 0]);
        expect(offsetSections(doc, [0], 2, 'right').points[0]?.values[0]?.[0]).toBe(2);
    });

    it('shifts opposite-direction rows together so right is east on a north–south block', () => {
        const northbound = section([row(0, 0), row(0, 10)], 'row_line');
        const southbound = section([row(2.5, 10), row(2.5, 0)], 'row_line');
        const doc = documentOf([northbound, southbound]);
        const offset = offsetSections(doc, [0, 1], 2, 'right');
        expect(offset.points[0]?.values[0]?.slice(0, 2)).toEqual([2, 0]);
        expect(offset.points[1]?.values[0]?.slice(0, 2)).toEqual([4.5, 10]);
        expect(offset.points[1]?.values[1]?.slice(0, 2)).toEqual([4.5, 0]);
    });
});

describe('generateRowPathFromLatLngs', () => {
    it('matches finishDrawLine spacing (0.1 m, speed 0.5, wz 1)', () => {
        const start = { lat: ORIGIN.lat, lng: ORIGIN.lon };
        const end = { lat: ORIGIN.lat + 1 / METERS_PER_DEGREE, lng: ORIGIN.lon };
        const generated = generateRowPathFromLatLngs([start, end], ORIGIN);
        expect(generated).not.toBeNull();
        expect(generated?.section_type).toBe('row_path');
        expect(generated?.values.length).toBeGreaterThanOrEqual(11);
        expect(generated?.values[0]).toEqual([0, 0, 0.5, 1, {}]);
        const last = generated?.values[generated.values.length - 1];
        expect(last?.[0]).toBe(0);
        expect(last?.[1]).toBe(1);
        expect(generateRowPathFromLatLngs([start], ORIGIN)).toBeNull();
    });
});

describe('generateRowLineFromLatLngs', () => {
    it('keeps a straight segment as two vertices for nav_line_matcher', () => {
        const start = { lat: ORIGIN.lat, lng: ORIGIN.lon };
        const end = { lat: ORIGIN.lat + 1 / METERS_PER_DEGREE, lng: ORIGIN.lon };
        const generated = generateRowLineFromLatLngs([start, end], ORIGIN);
        expect(generated?.section_type).toBe('row_line');
        expect(generated?.values).toEqual([
            [0, 0, 0.5, 1, {}],
            [0, 1, 0.5, 1, {}],
        ]);
        expect(generateRowLineFromLatLngs([start], ORIGIN)).toBeNull();
    });
});

describe('working zone', () => {
    const square: [number, number][] = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
    ];

    it('sets working_zone on vertices inside the polygon', () => {
        const doc = documentOf([section([row(5, 5, 0.5, 1)]), section([row(20, 20, 0.5, 1)])]);
        const result = applyWorkingZoneInPolygon(doc, square, 0);
        expect(result.count).toBe(1);
        expect(result.document.points[0]?.values[0]?.[3]).toBe(0);
        expect(result.document.points[1]?.values[0]?.[3]).toBe(1);
        expect(getPointsInPolygon(doc.points, square)).toEqual([
            { sectionIndex: 0, pointIndex: 0 },
        ]);
    });

    it('also tags the two vertices of a row_line whose segment crosses the polygon', () => {
        const doc = documentOf([section([row(0, 0, 0.5, 1), row(20, 0, 0.5, 1)])]);
        const belt: [number, number][] = [
            [8, -2],
            [12, -2],
            [12, 2],
            [8, 2],
        ];
        const result = applyWorkingZoneInPolygon(doc, belt, 0);
        expect(result.count).toBe(2);
        expect(result.document.points[0]?.values[0]?.[3]).toBe(0);
        expect(result.document.points[0]?.values[1]?.[3]).toBe(0);
        expect(getPointsInPolygon(doc.points, belt)).toEqual([]);
    });

    it('builds a local polygon from lat/lng the same way as getPolygonLocalFromLatLngs', () => {
        expect(polygonLocalFromLatLngs([{ lat: ORIGIN.lat, lng: ORIGIN.lon }], ORIGIN)).toBeNull();
        const polygon = polygonLocalFromLatLngs(
            [
                { lat: ORIGIN.lat, lng: ORIGIN.lon },
                { lat: ORIGIN.lat + 10 / METERS_PER_DEGREE, lng: ORIGIN.lon },
                {
                    lat: ORIGIN.lat,
                    lng:
                        ORIGIN.lon +
                        10 / (METERS_PER_DEGREE * Math.cos((ORIGIN.lat * Math.PI) / 180)),
                },
            ],
            ORIGIN,
        );
        expect(polygon).toHaveLength(3);
        expect(polygon?.[0]).toEqual([0, 0]);
        expect(polygon?.[1]?.[1]).toBe(10);
        expect(polygon?.[2]?.[0]).toBe(10);
    });
});

describe('speed', () => {
    it('returns the unique speed, or null when values mix', () => {
        expect(
            getCurrentTrajectorySpeed(documentOf([section([row(0, 0, 0.5), row(1, 0, 0.5)])])),
        ).toBe(0.5);
        expect(
            getCurrentTrajectorySpeed(documentOf([section([row(0, 0, 0.5), row(1, 0, 1)])])),
        ).toBeNull();
        expect(getCurrentTrajectorySpeed(documentOf([]))).toBeNull();
    });

    it('skips sections without a speed column and rewrites every other row', () => {
        const mixed = documentOf([
            { section_type: 'row_path', columns: ['x', 'y'], values: [[0, 0]] },
            section([row(1, 0, 0.5), row(2, 0, 0.8)]),
        ]);
        expect(getCurrentTrajectorySpeed(mixed)).toBeNull();
        const applied = applySpeedToAllPoints(mixed, 1.1);
        expect(applied.count).toBe(2);
        expect(applied.document.points[0]?.values[0]).toEqual([0, 0]);
        expect(applied.document.points[1]?.values[0]?.[2]).toBe(1.1);
        expect(applied.document.points[1]?.values[1]?.[2]).toBe(1.1);
    });
});
