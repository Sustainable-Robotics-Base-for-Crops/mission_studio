import { describe, expect, it } from 'vitest';

import { connectTwoRowEnds, connectTwoRowEndsFree } from '../../frontend/src/domain/connect-ends';
import type { AgriDocument, AgriSection } from '../../frontend/src/domain/agri';

const COLUMNS = ['x', 'y', 'speed', 'working_zone', 'punctual'];

function rowLine(start: [number, number], end: [number, number]): AgriSection {
    return {
        section_type: 'row_line',
        columns: [...COLUMNS],
        values: [
            [start[0], start[1], 0.5, 1, {}],
            [end[0], end[1], 0.5, 1, {}],
        ],
    };
}

function documentOf(points: AgriSection[]): AgriDocument {
    return { origin: { coordinates: { lat: 45.85, lon: 3.17 } }, points };
}

describe('connectTwoRowEnds', () => {
    const document = documentOf([rowLine([0, 0], [10, 0]), rowLine([10, 5], [0, 5])]);

    it('inserts a square turn between two picked ends', () => {
        const result = connectTwoRowEnds(
            document,
            { sectionIndex: 0, end: 'end' },
            { sectionIndex: 1, end: 'start' },
            'square',
        );
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.document.points).toHaveLength(3);
        expect(result.document.points[1]?.section_type).toBe('turn_square');
    });

    it('rejects the same end twice', () => {
        expect(
            connectTwoRowEnds(
                document,
                { sectionIndex: 0, end: 'end' },
                { sectionIndex: 0, end: 'end' },
                'u_turn',
            ),
        ).toEqual({ ok: false, reason: 'same_end' });
    });
});

describe('connectTwoRowEndsFree', () => {
    const document = documentOf([rowLine([0, 0], [10, 0]), rowLine([10, 5], [0, 5])]);

    it('densifies a free path to at least 10 cm', () => {
        const result = connectTwoRowEndsFree(
            document,
            { sectionIndex: 0, end: 'end' },
            { sectionIndex: 1, end: 'start' },
            [[10, 2.5]],
        );
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        const turn = result.document.points[1];
        expect(turn?.section_type).toBe('turn_path');
        expect((turn?.values.length ?? 0) > 10).toBe(true);
    });

    it('direct link is a densified straight segment', () => {
        const result = connectTwoRowEndsFree(
            document,
            { sectionIndex: 0, end: 'end' },
            { sectionIndex: 1, end: 'start' },
            [],
            0.5,
            'segments',
        );
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        const turn = result.document.points[1];
        expect(turn?.section_type).toBe('turn_path');
        const xs = (turn?.values ?? []).map((row) => Number(row[0]));
        expect(xs.every((x) => Math.abs(x - 10) < 0.05)).toBe(true);
        expect((turn?.values.length ?? 0) > 10).toBe(true);
    });

    it('curve interpolates the waypoints instead of treating them as controls', () => {
        const waypoint: [number, number] = [16, 2.5];
        const result = connectTwoRowEndsFree(
            document,
            { sectionIndex: 0, end: 'end' },
            { sectionIndex: 1, end: 'start' },
            [waypoint],
            0.5,
            'curve',
        );
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        const turn = result.document.points[1];
        const points = (turn?.values ?? []).map((row) => [Number(row[0]), Number(row[1])] as const);
        const nearest = Math.min(
            ...points.map((point) => Math.hypot(point[0] - waypoint[0], point[1] - waypoint[1])),
        );
        expect(nearest).toBeLessThan(0.05);
        expect(points.length).toBeGreaterThan(20);
    });

    it('leaves and arrives tangent to the work rows', () => {
        const result = connectTwoRowEndsFree(
            document,
            { sectionIndex: 0, end: 'end' },
            { sectionIndex: 1, end: 'start' },
            [[16, 2.5]],
            0.5,
            'curve',
        );
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        const points = (result.document.points[1]?.values ?? []).map(
            (row) => [Number(row[0]), Number(row[1])] as const,
        );
        const first = points[0];
        const second = points[1];
        const penultimate = points[points.length - 2];
        const last = points[points.length - 1];
        expect(first && second && penultimate && last).toBeTruthy();
        if (!first || !second || !penultimate || !last) {
            return;
        }
        const leave = Math.hypot(second[0] - first[0], second[1] - first[1]) || 1;
        const arrive = Math.hypot(last[0] - penultimate[0], last[1] - penultimate[1]) || 1;
        expect((second[0] - first[0]) / leave).toBeGreaterThan(0.95);
        expect(Math.abs((second[1] - first[1]) / leave)).toBeLessThan(0.2);
        expect((last[0] - penultimate[0]) / arrive).toBeLessThan(-0.95);
        expect(Math.abs((last[1] - penultimate[1]) / arrive)).toBeLessThan(0.2);
    });
});
