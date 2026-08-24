/**
 * Connect two picked row ends with a square, a U-turn, or a free densified path.
 */

import {
    cloneJson,
    getSectionTypeString,
    reverseSection,
    type AgriDocument,
    type AgriSection,
    type SectionRow,
} from './agri';
import { densifyXY, round3, smoothPathXY, TURN_PATH_SPACING_M } from './geometry';
import type { RowEndpointHit } from './selection';
import { createSquareTurn, createUTurn } from './turns';

export type EndConnectionKind = 'square' | 'u_turn' | 'direct' | 'free';
export type FreeLinkStyle = 'segments' | 'curve';

export type ConnectEndsFailure = 'need_ends' | 'same_end' | 'invalid_turn';

function orientedRow(section: AgriSection, end: RowEndpointHit['end']): AgriSection {
    return end === 'end' ? cloneJson(section) : reverseSection(cloneJson(section));
}

function turnColumns(left: AgriSection, right: AgriSection): string[] {
    const columns = new Set<string>(['x', 'y', 'speed', 'working_zone', 'punctual']);
    for (const name of [...left.columns, ...right.columns]) {
        columns.add(name);
    }
    return [...columns];
}

function xyOf(section: AgriSection, row: SectionRow | undefined): [number, number] | null {
    if (!row) {
        return null;
    }
    const xIndex = section.columns.indexOf('x');
    const yIndex = section.columns.indexOf('y');
    if (xIndex < 0 || yIndex < 0) {
        return null;
    }
    return [Number(row[xIndex]), Number(row[yIndex])];
}

function rowHeading(section: AgriSection, at: 'start' | 'end'): [number, number] | undefined {
    if (section.values.length < 2) {
        return undefined;
    }
    const first = xyOf(
        section,
        at === 'end' ? section.values[section.values.length - 2] : section.values[0],
    );
    const second = xyOf(
        section,
        at === 'end' ? section.values[section.values.length - 1] : section.values[1],
    );
    if (!first || !second) {
        return undefined;
    }
    const heading: [number, number] = [second[0] - first[0], second[1] - first[1]];
    if (Math.hypot(heading[0], heading[1]) < 1e-9) {
        return undefined;
    }
    return heading;
}

function insertTurn(document: AgriDocument, afterIndex: number, turn: AgriSection): AgriDocument {
    const points = document.points.map((section) => cloneJson(section));
    points.splice(afterIndex + 1, 0, turn);
    return { ...document, points };
}

export function connectTwoRowEnds(
    document: AgriDocument,
    first: RowEndpointHit,
    second: RowEndpointHit,
    kind: Exclude<EndConnectionKind, 'free' | 'direct'>,
    speed = 0.5,
): { ok: true; document: AgriDocument } | { ok: false; reason: ConnectEndsFailure } {
    if (first.sectionIndex === second.sectionIndex && first.end === second.end) {
        return { ok: false, reason: 'same_end' };
    }
    const left = document.points[first.sectionIndex];
    const right = document.points[second.sectionIndex];
    if (
        !left ||
        !right ||
        getSectionTypeString(left) !== 'row_line' ||
        getSectionTypeString(right) !== 'row_line'
    ) {
        return { ok: false, reason: 'need_ends' };
    }
    const from = orientedRow(left, first.end);
    const to = orientedRow(right, second.end === 'start' ? 'end' : 'start');
    const columns = turnColumns(from, to);
    const turn =
        kind === 'square'
            ? createSquareTurn(from, to, columns, 1, 1, speed)
            : (() => {
                  const result = createUTurn(from, to, columns, 1, 1, 2, speed);
                  return 'section' in result ? result.section : null;
              })();
    if (!turn) {
        return { ok: false, reason: 'invalid_turn' };
    }
    return { ok: true, document: insertTurn(document, first.sectionIndex, turn) };
}

export function connectTwoRowEndsFree(
    document: AgriDocument,
    first: RowEndpointHit,
    second: RowEndpointHit,
    waypoints: Array<[number, number]>,
    speed = 0.5,
    style: FreeLinkStyle = 'segments',
): { ok: true; document: AgriDocument } | { ok: false; reason: ConnectEndsFailure } {
    const left = document.points[first.sectionIndex];
    const right = document.points[second.sectionIndex];
    if (!left || !right) {
        return { ok: false, reason: 'need_ends' };
    }
    const from = orientedRow(left, first.end);
    const to = orientedRow(right, second.end === 'start' ? 'end' : 'start');
    const xIndex = from.columns.indexOf('x');
    const yIndex = from.columns.indexOf('y');
    const startRow = from.values[from.values.length - 1];
    const endRow = to.values[0];
    if (xIndex < 0 || yIndex < 0 || !startRow || !endRow) {
        return { ok: false, reason: 'need_ends' };
    }
    const start: [number, number] = [Number(startRow[xIndex]), Number(startRow[yIndex])];
    const finish: [number, number] = [Number(endRow[xIndex]), Number(endRow[yIndex])];
    const raw = [start, ...waypoints, finish];
    const densified =
        style === 'curve'
            ? smoothPathXY(raw, TURN_PATH_SPACING_M, {
                  start: rowHeading(from, 'end'),
                  end: rowHeading(to, 'start'),
              })
            : densifyXY(raw, TURN_PATH_SPACING_M);
    const columns = turnColumns(from, to);
    const values: SectionRow[] = densified.map(([x, y]) =>
        columns.map((name) => {
            if (name === 'x') {
                return round3(x);
            }
            if (name === 'y') {
                return round3(y);
            }
            if (name === 'speed') {
                return speed;
            }
            if (name === 'working_zone') {
                return 0;
            }
            if (name === 'punctual') {
                return {};
            }
            return null;
        }),
    );
    return {
        ok: true,
        document: insertTurn(document, first.sectionIndex, {
            section_type: 'turn_path',
            columns,
            values,
        }),
    };
}
