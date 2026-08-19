import { describe, expect, it } from 'vitest';

import { isTurnSection, type AgriDocument, type AgriSection } from '../../frontend/src/domain/agri';
import {
    applyCorkscrewOrder,
    connectRowLinesPreservingOthers,
    connectNewRowLines,
    connectTurns,
    createSquareTurn,
    DEFAULT_CONNECT_TURNS,
    haveSameDirection,
} from '../../frontend/src/domain/turns';

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

const SNAKE_PAIR = documentOf([rowLine([0, 0], [10, 0]), rowLine([10, 5], [0, 5])]);

describe('haveSameDirection / corkscrew', () => {
    it('detects opposite snake rows', () => {
        expect(haveSameDirection(SNAKE_PAIR.points[0]!, SNAKE_PAIR.points[1]!)).toBe(false);
    });

    it('walks rows with a jump of 2', () => {
        const rows = [0, 1, 2, 3, 4].map((index) => rowLine([0, index], [10, index]));
        const ordered = applyCorkscrewOrder(rows, 2);
        expect(ordered.map((section) => section.values[0]?.[1])).toEqual([0, 2, 4, 1, 3]);
    });
});

describe('createSquareTurn', () => {
    it('builds a four-vertex turn_square between opposite row_line ends', () => {
        const turn = createSquareTurn(
            SNAKE_PAIR.points[0]!,
            SNAKE_PAIR.points[1]!,
            [...COLUMNS],
            1,
            1,
            0.5,
        );
        expect(turn?.section_type).toBe('turn_square');
        expect(turn?.values).toHaveLength(4);
        expect(turn?.values[0]?.slice(0, 2)).toEqual([10, 0]);
        expect(turn?.values[3]?.slice(0, 2)).toEqual([10, 5]);
        expect(turn?.values[1]?.[3]).toBe(0);
    });
});

describe('connectTurns', () => {
    it('rejects fewer than two rows', () => {
        expect(connectTurns(documentOf([rowLine([0, 0], [1, 0])]), DEFAULT_CONNECT_TURNS)).toEqual({
            ok: false,
            reason: 'too_few_rows',
        });
    });

    it('inserts square turns and keeps row_line vertices', () => {
        const result = connectTurns(SNAKE_PAIR, DEFAULT_CONNECT_TURNS);
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.turns).toBe(1);
        expect(result.document.points).toHaveLength(3);
        expect(result.document.points[0]?.section_type).toBe('row_line');
        expect(result.document.points[0]?.values).toHaveLength(2);
        expect(result.document.points[1]?.section_type).toBe('turn_square');
        expect(isTurnSection(result.document.points[1]!)).toBe(true);
        expect(result.document.points[2]?.section_type).toBe('row_line');
    });

    it('inserts a densified U-turn without converting the rows', () => {
        const result = connectTurns(SNAKE_PAIR, {
            ...DEFAULT_CONNECT_TURNS,
            turnType: 'u_turn',
            headlandSpace: 4,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.failures).toEqual([]);
        expect(result.document.points[0]?.section_type).toBe('row_line');
        expect(result.document.points[0]?.values).toHaveLength(2);
        expect(result.document.points[1]?.section_type).toBe('turn_path');
        expect(result.document.points[1]?.values.length).toBeGreaterThan(4);
    });

    it('reuses a connector whose endpoints still match', () => {
        const first = connectTurns(SNAKE_PAIR, DEFAULT_CONNECT_TURNS);
        expect(first.ok).toBe(true);
        if (!first.ok) {
            return;
        }
        const second = connectTurns(first.document, DEFAULT_CONNECT_TURNS);
        expect(second.ok).toBe(true);
        if (!second.ok) {
            return;
        }
        expect(second.document.points).toHaveLength(3);
        expect(second.document.points[1]?.values).toEqual(first.document.points[1]?.values);
    });
});

describe('connectRowLinesPreservingOthers', () => {
    it('connects row_line only and keeps fourrière row_path first', () => {
        const headland = {
            section_type: 'row_path',
            columns: [...COLUMNS],
            values: [
                [0, -2, 0.5, 1, {}],
                [10, -2, 0.5, 1, {}],
                [10, 7, 0.5, 1, {}],
                [0, 7, 0.5, 1, {}],
            ],
        } satisfies AgriSection;
        const result = connectRowLinesPreservingOthers(
            documentOf([headland, ...SNAKE_PAIR.points]),
            DEFAULT_CONNECT_TURNS,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.turns).toBe(1);
        expect(result.document.points[0]?.section_type).toBe('row_path');
        expect(result.document.points[0]?.values).toEqual(headland.values);
        expect(result.document.points.map((section) => section.section_type)).toEqual([
            'row_path',
            'row_line',
            'turn_square',
            'row_line',
        ]);
    });
});

describe('connectNewRowLines', () => {
    it('stitches only the given row_line block', () => {
        const result = connectNewRowLines(SNAKE_PAIR.points, DEFAULT_CONNECT_TURNS);
        expect(result.turns).toBe(1);
        expect(result.sections.map((section) => section.section_type)).toEqual([
            'row_line',
            'turn_square',
            'row_line',
        ]);
    });

    it('pulls row ends back so the square pivot stays within the original swath envelope', () => {
        const result = connectNewRowLines(SNAKE_PAIR.points, DEFAULT_CONNECT_TURNS);
        const xs = result.sections.flatMap((section) =>
            section.values.map((row) => Number(row[0])),
        );
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...xs)).toBeLessThanOrEqual(10);
        const firstRow = result.sections[0];
        expect(firstRow?.values[0]?.[0]).toBe(1);
        expect(firstRow?.values[1]?.[0]).toBe(9);
    });

    it('adds implement clearance so the hull stays inside the original swath envelope', () => {
        const clearance = 0.6;
        const result = connectNewRowLines(SNAKE_PAIR.points, DEFAULT_CONNECT_TURNS, {
            clearanceM: clearance,
        });
        const xs = result.sections.flatMap((section) =>
            section.values.map((row) => Number(row[0])),
        );
        expect(Math.max(...xs) + clearance).toBeLessThanOrEqual(10 + 1e-6);
        expect(result.sections[0]?.values[0]?.[0]).toBe(1.6);
    });
});
