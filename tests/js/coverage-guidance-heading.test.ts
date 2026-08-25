import { describe, expect, it } from 'vitest';

import {
    headingRadFromLineString,
    usableGuidanceLines,
} from '../../frontend/src/coverage/guidance-heading';
import type { FieldGuidanceLine } from '../../frontend/src/fields/types';

function line(id: string, coordinates: number[][]): FieldGuidanceLine {
    return {
        id,
        field_id: 'field-1',
        name: id,
        geometry: { type: 'LineString', coordinates },
        provenance: {},
        created_at: '2026-08-24T00:00:00Z',
    };
}

describe('headingRadFromLineString', () => {
    it('reads east as heading 0 and north as +π/2', () => {
        expect(headingRadFromLineString({ type: 'LineString', coordinates: [[3, 45], [3.001, 45]] })).toBeCloseTo(
            0,
            2,
        );
        expect(
            headingRadFromLineString({ type: 'LineString', coordinates: [[3, 45], [3, 45.001]] }),
        ).toBeCloseTo(Math.PI / 2, 2);
    });

    it('uses the first-to-last chord of a bent line', () => {
        const heading = headingRadFromLineString({
            type: 'LineString',
            coordinates: [
                [3, 45],
                [3.0005, 45.0004],
                [3.001, 45],
            ],
        });
        expect(heading).toBeCloseTo(0, 2);
    });

    it('rejects a degenerate or missing line', () => {
        expect(headingRadFromLineString({ type: 'LineString', coordinates: [[3, 45]] })).toBeNull();
        expect(headingRadFromLineString({ type: 'Point', coordinates: [3, 45] })).toBeNull();
    });
});

describe('usableGuidanceLines', () => {
    it('keeps only lines that yield a heading', () => {
        const kept = usableGuidanceLines([
            line('ab', [
                [3, 45],
                [3.001, 45],
            ]),
            line('dot', [[3, 45]]),
        ]);
        expect(kept.map((item) => item.id)).toEqual(['ab']);
    });
});
