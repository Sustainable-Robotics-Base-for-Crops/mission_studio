import { describe, expect, it } from 'vitest';

import { localToLatLng, type LatLng } from '../../frontend/src/domain/geometry';
import {
    PICK_SECTION_MAX_M,
    deleteSelectedSections,
    pickSectionByProximity,
    reverseSelectedSections,
    selectSectionsIntersectingPolygon,
    toggleSelectedIndex,
} from '../../frontend/src/domain/selection';
import type { AgriDocument, AgriSection, SectionRow } from '../../frontend/src/domain/agri';

const COLUMNS = ['x', 'y', 'speed', 'working_zone', 'punctual'];
const ORIGIN = { lat: 45.85, lon: 3.17 };

function row(x: number, y: number): SectionRow {
    return [x, y, 0.5, 1, {}];
}

function section(values: SectionRow[], type = 'row_line'): AgriSection {
    return { section_type: type, columns: [...COLUMNS], values };
}

function documentWithRows(): AgriDocument {
    return {
        origin: { type: 'WGS84', coordinates: { lat: ORIGIN.lat, lon: ORIGIN.lon, alt: 0 } },
        points: [section([row(0, 0), row(10, 0)]), section([row(0, 5), row(10, 5)])],
    };
}

function geo(x: number, y: number): LatLng {
    return localToLatLng({ x, y }, ORIGIN);
}

describe('pickSectionByProximity', () => {
    it('picks the closest row_line in local metres', () => {
        const document = documentWithRows();
        expect(pickSectionByProximity(document, geo(5, 0))).toBe(0);
        expect(pickSectionByProximity(document, geo(5, 5))).toBe(1);
    });

    it('returns null when the click is farther than the threshold', () => {
        const document = documentWithRows();
        expect(pickSectionByProximity(document, geo(5, 5 + PICK_SECTION_MAX_M + 2))).toBeNull();
    });

    it('prefers the first section on a tie', () => {
        const document = documentWithRows();
        expect(pickSectionByProximity(document, geo(5, 2.5))).toBe(0);
    });
});

describe('selectSectionsIntersectingPolygon', () => {
    it('selects a row_line whose segment crosses the polygon even without a vertex inside', () => {
        const document = documentWithRows();
        const zone = [geo(4, -1), geo(6, -1), geo(6, 1), geo(4, 1)];
        expect(selectSectionsIntersectingPolygon(document, zone)).toEqual([0]);
    });

    it('selects every row that crosses the zone', () => {
        const document = documentWithRows();
        const zone = [geo(-1, -1), geo(11, -1), geo(11, 6), geo(-1, 6)];
        expect(selectSectionsIntersectingPolygon(document, zone)).toEqual([0, 1]);
    });
});

describe('toggleSelectedIndex', () => {
    it('replaces the selection without Shift, and deselects a second click on the same row', () => {
        expect(toggleSelectedIndex([], 1, false)).toEqual([1]);
        expect(toggleSelectedIndex([1], 1, false)).toEqual([]);
        expect(toggleSelectedIndex([0], 1, false)).toEqual([1]);
    });

    it('cumulates with Shift', () => {
        expect(toggleSelectedIndex([0], 1, true)).toEqual([0, 1]);
        expect(toggleSelectedIndex([0, 1], 0, true)).toEqual([1]);
    });
});

describe('mutate selected sections', () => {
    it('reverses only the selected rows', () => {
        const document = documentWithRows();
        const reversed = reverseSelectedSections(document, [1]);
        expect(reversed.points[0]?.values[0]?.[0]).toBe(0);
        expect(reversed.points[1]?.values[0]?.[0]).toBe(10);
        expect(reversed.points[1]?.values[1]?.[0]).toBe(0);
    });

    it('deletes selected indices without leaving holes', () => {
        const document = documentWithRows();
        const next = deleteSelectedSections(document, [0]);
        expect(next.points).toHaveLength(1);
        expect(next.points[0]?.values[0]?.[1]).toBe(5);
    });
});
