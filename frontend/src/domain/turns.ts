/**
 * Connect-turns domain — port of TrajectoryEditor.js connectTurnsWithParams
 * / createUTurn / createSquareTurn. Studio keeps Agri `row_line` (nav_line_matcher);
 * generated connectors are densified `turn_path` / `turn_square` at 0.1 m (nav_turn).
 */
import {
    cloneJson,
    cloneSectionValueRow,
    getSectionTypeString,
    getTotalPointsCount,
    isTurnSection,
    MAX_POINTS_PER_SECTION,
    MAX_POINTS_PER_TRAJECTORY,
    reverseSection,
    type AgriDocument,
    type AgriSection,
    type Cell,
    type SectionRow,
} from './agri';
import { distance, round3, TURN_PATH_SPACING_M } from './geometry';
import { addSpeed } from './speed';
import { densifyRowLineSectionToRowPath } from './section';
import { GEOFENCE_SAFETY_M } from './equipment';

/** Endpoint tolerance used to recognize an already generated turn (2 cm). */
export const TURN_CONNECTION_MATCH_TOLERANCE_M = 0.02;
/** Row length used to estimate a stable tangent at each end of a U-turn (m). */
export const U_TURN_DIRECTION_SAMPLE_M = 1.5;
/** Requested lateral offset on the headland when closing a loop (m). */
export const LOOP_HEADLAND_LATERAL_M = 0.3;

export type TurnKind = 'square' | 'u_turn';
export type TurnOrderType = 'normal' | 'snake' | 'corkscrew';

export interface ConnectTurnsParams {
    turnType: TurnKind;
    rowSpeed: number;
    spaceIn: number;
    spaceOut: number;
    headlandSpace: number;
    reverseRows: boolean;
    reverseSide: boolean;
    skipRows: number;
    orderType: TurnOrderType;
    corkscrewJump: number;
    loop: boolean;
    /** `/app` densifies rows to `row_path`; Studio keeps `row_line`. */
    densifyRows: boolean;
}

export const DEFAULT_CONNECT_TURNS: ConnectTurnsParams = {
    turnType: 'square',
    rowSpeed: 0.5,
    spaceIn: 1,
    spaceOut: 1,
    headlandSpace: 2,
    reverseRows: false,
    reverseSide: false,
    skipRows: 0,
    orderType: 'normal',
    corkscrewJump: 2,
    loop: false,
    densifyRows: false,
};

/** Keep at least this much working length after pulling row ends back for a turn. */
export const MIN_ROW_LENGTH_AFTER_TURN_RESERVE_M = 0.5;

export interface TurnReserveOptions {
    vehicleWidthM?: number | null;
    implementWidthM?: number | null;
    vehicleLengthM?: number | null;
    /** Precomputed geofence margin (includes safety). Wins over width/length. */
    clearanceM?: number | null;
    alreadyReservedM?: number | null;
}

/** How far to pull row ends so the turn + combination hull stay inside the parcel. */
export function rowEndTrimMeters(params: ConnectTurnsParams, options?: TurnReserveOptions): number {
    const pathOverhang =
        params.turnType === 'u_turn'
            ? Math.max(params.spaceIn, params.spaceOut, params.headlandSpace)
            : Math.max(params.spaceIn, params.spaceOut);
    const explicit = options?.clearanceM;
    let body = 0;
    if (explicit != null && Number.isFinite(explicit) && explicit > 0) {
        body = explicit;
    } else {
        const halfWidth = Math.max(options?.vehicleWidthM ?? 0, options?.implementWidthM ?? 0) / 2;
        const forward =
            options?.vehicleLengthM && options.vehicleLengthM > 0 ? options.vehicleLengthM / 2 : 0;
        if (halfWidth > 0 || forward > 0) {
            body = Math.max(halfWidth, forward) + GEOFENCE_SAFETY_M;
        }
    }
    const reserved =
        options?.alreadyReservedM && options.alreadyReservedM > 0 ? options.alreadyReservedM : 0;
    return Math.max(0, pathOverhang + body - reserved);
}

function setRowXY(section: AgriSection, valueIndex: number, x: number, y: number): void {
    const xi = section.columns.indexOf('x');
    const yi = section.columns.indexOf('y');
    const row = section.values[valueIndex];
    if (!row || xi < 0 || yi < 0) {
        return;
    }
    row[xi] = round3(x);
    row[yi] = round3(y);
}

/**
 * Pull `row_line` endpoints inward so a subsequent square / U-turn stays
 * inside the envelope the swaths already occupy (the parcel, after clip).
 */
export function reserveTurnSpaceOnRowLines(sections: AgriSection[], trimM: number): AgriSection[] {
    if (!(trimM > 0)) {
        return sections.map((section) => cloneJson(section));
    }
    return sections.map((section) => {
        const next = cloneJson(section);
        if (getSectionTypeString(next) !== 'row_line' || next.values.length < 2) {
            return next;
        }
        const first = rowXY(next.values[0], next.columns);
        const last = rowXY(next.values[next.values.length - 1], next.columns);
        if (!first || !last) {
            return next;
        }
        const dx = last.x - first.x;
        const dy = last.y - first.y;
        const length = Math.hypot(dx, dy);
        if (!(length > 0)) {
            return next;
        }
        let trimStart = trimM;
        let trimEnd = trimM;
        const needed = trimStart + trimEnd + MIN_ROW_LENGTH_AFTER_TURN_RESERVE_M;
        if (length < needed) {
            const budget = Math.max(0, length - MIN_ROW_LENGTH_AFTER_TURN_RESERVE_M);
            if (!(budget > 0)) {
                return next;
            }
            const scale = budget / (trimStart + trimEnd);
            trimStart *= scale;
            trimEnd *= scale;
        }
        const ux = dx / length;
        const uy = dy / length;
        setRowXY(next, 0, first.x + ux * trimStart, first.y + uy * trimStart);
        setRowXY(next, next.values.length - 1, last.x - ux * trimEnd, last.y - uy * trimEnd);
        return next;
    });
}

export type UTurnFailureCode =
    | 'invalidSection'
    | 'missingCoordinates'
    | 'directionUnavailable'
    | 'headlandTooSmall'
    | 'noSmoothConnection'
    | 'unknown';

export interface UTurnFailure {
    from: number;
    to: number;
    code: UTurnFailureCode;
}

export type ConnectTurnsFailure =
    'too_few_rows' | 'invalid_params' | 'section_limit' | 'trajectory_limit';

export type ConnectTurnsResult =
    | { ok: true; document: AgriDocument; turns: number; failures: UTurnFailure[] }
    | { ok: false; reason: ConnectTurnsFailure };

function rowValueAt(row: SectionRow, columns: string[], col: string): Cell | undefined {
    const index = columns.indexOf(col);
    if (index < 0 || index >= row.length) {
        return undefined;
    }
    return row[index];
}

function rowXY(row: SectionRow | undefined, columns: string[]): { x: number; y: number } | null {
    if (!row) {
        return null;
    }
    const xi = columns.indexOf('x');
    const yi = columns.indexOf('y');
    if (xi < 0 || yi < 0) {
        return null;
    }
    const x = Number(row[xi]);
    const y = Number(row[yi]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
    }
    return { x, y };
}

function makeTurnRow(
    columns: string[],
    x: number,
    y: number,
    speed: number,
    punctual: Record<string, unknown> = {},
    source?: { row: SectionRow; columns: string[] },
): SectionRow {
    return columns.map((col) => {
        if (col === 'x') {
            return round3(x);
        }
        if (col === 'y') {
            return round3(y);
        }
        if (col === 'speed') {
            return speed;
        }
        if (col === 'working_zone') {
            return 0;
        }
        if (col === 'punctual') {
            return punctual;
        }
        if (source) {
            const value = rowValueAt(source.row, source.columns, col);
            return value !== undefined ? value : 0;
        }
        return 0;
    });
}

function addPointsAlongSegment(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    spacing: number,
    points: SectionRow[],
    columns: string[],
    speed: number,
): void {
    const length = distance(x1, y1, x2, y2);
    if (length < 1e-9) {
        return;
    }
    for (let step = 1; step * spacing < length; step += 1) {
        const t = (step * spacing) / length;
        points.push(makeTurnRow(columns, x1 + t * (x2 - x1), y1 + t * (y2 - y1), speed));
    }
}

function getDirectedArcSweep(startAngle: number, endAngle: number, clockwise: boolean): number {
    const twoPi = 2 * Math.PI;
    const normalizedStart = ((startAngle % twoPi) + twoPi) % twoPi;
    const normalizedEnd = ((endAngle % twoPi) + twoPi) % twoPi;
    return clockwise
        ? -((normalizedStart - normalizedEnd + twoPi) % twoPi)
        : (normalizedEnd - normalizedStart + twoPi) % twoPi;
}

function addCircleArc(
    startAngle: number,
    endAngle: number,
    radius: number,
    centerX: number,
    centerY: number,
    clockwise: boolean,
    points: SectionRow[],
    columns: string[],
    speed: number,
): void {
    const sweep = getDirectedArcSweep(startAngle, endAngle, clockwise);
    const maxStep = (Math.PI / 180) * 5;
    const stepCount = Math.max(1, Math.ceil(Math.abs(sweep) / maxStep));
    for (let stepIndex = 1; stepIndex <= stepCount; stepIndex += 1) {
        const theta = startAngle + (sweep * stepIndex) / stepCount;
        points.push(
            makeTurnRow(
                columns,
                centerX + Math.cos(theta) * radius,
                centerY + Math.sin(theta) * radius,
                speed,
            ),
        );
    }
}

export function estimateSectionEndpointDirection(
    section: AgriSection,
    columns: string[],
    atEnd: boolean,
    sampleDistance: number,
): [number, number] | null {
    const values = section.values || [];
    if (values.length < 2) {
        return null;
    }
    const samples: [number, number][] = [];
    const endpointIndex = atEnd ? values.length - 1 : 0;
    const step = atEnd ? -1 : 1;
    let currentIndex = endpointIndex;
    let travelledDistance = 0;
    let previousPoint = rowXY(values[currentIndex], columns);
    if (!previousPoint) {
        return null;
    }
    samples.push([previousPoint.x, previousPoint.y]);
    while (travelledDistance < sampleDistance) {
        const nextIndex = currentIndex + step;
        if (nextIndex < 0 || nextIndex >= values.length) {
            break;
        }
        const nextPoint = rowXY(values[nextIndex], columns);
        if (!nextPoint) {
            break;
        }
        travelledDistance += distance(previousPoint.x, previousPoint.y, nextPoint.x, nextPoint.y);
        samples.push([nextPoint.x, nextPoint.y]);
        previousPoint = nextPoint;
        currentIndex = nextIndex;
    }
    if (atEnd) {
        samples.reverse();
    }
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last) {
        return null;
    }
    const chordX = last[0] - first[0];
    const chordY = last[1] - first[1];
    if (Math.sqrt(chordX * chordX + chordY * chordY) <= 1e-9) {
        return null;
    }
    const meanX = samples.reduce((sum, point) => sum + point[0], 0) / samples.length;
    const meanY = samples.reduce((sum, point) => sum + point[1], 0) / samples.length;
    let covarianceXX = 0;
    let covarianceXY = 0;
    let covarianceYY = 0;
    for (const point of samples) {
        const offsetX = point[0] - meanX;
        const offsetY = point[1] - meanY;
        covarianceXX += offsetX * offsetX;
        covarianceXY += offsetX * offsetY;
        covarianceYY += offsetY * offsetY;
    }
    const angle = 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY);
    let directionX = Math.cos(angle);
    let directionY = Math.sin(angle);
    if (directionX * chordX + directionY * chordY < 0) {
        directionX *= -1;
        directionY *= -1;
    }
    return [directionX, directionY];
}

export function haveSameDirection(section1: AgriSection, section2: AgriSection): boolean {
    if (
        !section1.values ||
        !section2.values ||
        section1.values.length < 2 ||
        section2.values.length < 2
    ) {
        return false;
    }
    const start1 = rowXY(section1.values[0], section1.columns);
    const end1 = rowXY(section1.values[section1.values.length - 1], section1.columns);
    const start2 = rowXY(section2.values[0], section2.columns);
    const end2 = rowXY(section2.values[section2.values.length - 1], section2.columns);
    if (!start1 || !end1 || !start2 || !end2) {
        return false;
    }
    const v1x = end1.x - start1.x;
    const v1y = end1.y - start1.y;
    const v2x = end2.x - start2.x;
    const v2y = end2.y - start2.y;
    return v1x * v2x + v1y * v2y > 0;
}

export function applySnakeOrder(sections: AgriSection[]): AgriSection[] {
    const rowsInOrder: AgriSection[] = [];
    sections.forEach((row, index) => {
        if (index % 2 === 0) {
            rowsInOrder.unshift(row);
        } else {
            rowsInOrder.push(row);
        }
    });
    for (let index = 1; index < rowsInOrder.length; index += 1) {
        const previous = rowsInOrder[index - 1];
        const current = rowsInOrder[index];
        if (previous && current && haveSameDirection(previous, current)) {
            rowsInOrder[index] = reverseSection(current);
        }
    }
    return rowsInOrder;
}

export function applyCorkscrewOrder(sections: AgriSection[], jump: number): AgriSection[] {
    const result: AgriSection[] = [];
    const usedIndices = new Set<number>();
    let currentIndex = 0;
    let direction = 1;
    while (result.length < sections.length) {
        if (currentIndex >= 0 && currentIndex < sections.length && !usedIndices.has(currentIndex)) {
            const section = sections[currentIndex];
            if (section) {
                result.push(section);
            }
            usedIndices.add(currentIndex);
        }
        currentIndex += jump * direction;
        if (currentIndex >= sections.length || currentIndex < 0) {
            direction = -direction;
            currentIndex += direction;
            if (result.length < sections.length) {
                for (let index = 0; index < sections.length; index += 1) {
                    if (!usedIndices.has(index)) {
                        currentIndex = index;
                        break;
                    }
                }
            }
        }
    }
    return result;
}

function mergeConnectTurnColumns(sections: AgriSection[]): string[] {
    const preferredOrder = ['x', 'y', 'speed', 'working_zone', 'punctual'];
    const seen = new Set<string>();
    const extras: string[] = [];
    for (const section of sections) {
        for (const column of section.columns || []) {
            if (!seen.has(column)) {
                seen.add(column);
                if (!preferredOrder.includes(column)) {
                    extras.push(column);
                }
            }
        }
    }
    return preferredOrder.filter((column) => seen.has(column)).concat(extras);
}

function ensureConnectTurnOutputColumns(mergedColumns: string[]): string[] {
    if (mergedColumns.includes('speed')) {
        return mergedColumns;
    }
    const preferredOrder = ['x', 'y', 'speed', 'working_zone', 'punctual'];
    const set = new Set(mergedColumns);
    set.add('speed');
    const extras = mergedColumns.filter((column) => !preferredOrder.includes(column));
    return preferredOrder.filter((column) => set.has(column)).concat(extras);
}

function findExistingTurnBetween(
    existingTurns: AgriSection[],
    usedIndexes: Set<number>,
    section1: AgriSection,
    section2: AgriSection,
): { section: AgriSection; index: number } | null {
    const row1End = rowXY(section1.values[section1.values.length - 1], section1.columns);
    const row2Start = rowXY(section2.values[0], section2.columns);
    if (!row1End || !row2Start) {
        return null;
    }
    for (let index = 0; index < existingTurns.length; index += 1) {
        if (usedIndexes.has(index)) {
            continue;
        }
        const turn = existingTurns[index];
        if (!turn || turn.values.length < 2) {
            continue;
        }
        const turnStart = rowXY(turn.values[0], turn.columns);
        const turnEnd = rowXY(turn.values[turn.values.length - 1], turn.columns);
        if (!turnStart || !turnEnd) {
            continue;
        }
        const startsAtRow1 =
            distance(turnStart.x, turnStart.y, row1End.x, row1End.y) <=
            TURN_CONNECTION_MATCH_TOLERANCE_M;
        const endsAtRow2 =
            distance(turnEnd.x, turnEnd.y, row2Start.x, row2Start.y) <=
            TURN_CONNECTION_MATCH_TOLERANCE_M;
        if (startsAtRow1 && endsAtRow2) {
            return { section: turn, index };
        }
    }
    return null;
}

export function createSquareTurn(
    section1: AgriSection,
    section2: AgriSection,
    columns: string[],
    spaceIn: number,
    spaceOut: number,
    speed: number,
): AgriSection | null {
    if (section1.values.length < 2 || section2.values.length < 2) {
        return null;
    }
    const a = section1.values[section1.values.length - 1];
    const c = section2.values[0];
    const out = rowXY(a, section1.columns);
    const inn = rowXY(c, section2.columns);
    if (!a || !c || !out || !inn) {
        return null;
    }
    const stepBackOut = Math.max(1, Math.min(15, section1.values.length - 2));
    const b = rowXY(section1.values[section1.values.length - 1 - stepBackOut], section1.columns);
    const stepAheadIn = Math.max(1, Math.min(15, section2.values.length - 1));
    const d = rowXY(section2.values[stepAheadIn], section2.columns);
    if (!b || !d) {
        return null;
    }
    const angleOut = Math.atan2(out.y - b.y, out.x - b.x);
    const angleIn = Math.atan2(d.y - inn.y, d.x - inn.x);
    const pointOutX = out.x + Math.cos(angleOut) * spaceOut;
    const pointOutY = out.y + Math.sin(angleOut) * spaceOut;
    const pointInX = inn.x - Math.cos(angleIn) * spaceIn;
    const pointInY = inn.y - Math.sin(angleIn) * spaceIn;
    const courseOut = Math.atan2(pointInY - pointOutY, pointInX - pointOutX);
    const courseIn = Math.atan2(inn.y - pointInY, inn.x - pointInX);
    const values = [
        makeTurnRow(columns, out.x, out.y, speed, {}, { row: a, columns: section1.columns }),
        makeTurnRow(columns, pointOutX, pointOutY, speed, { course: round3(courseOut) }),
        makeTurnRow(columns, pointInX, pointInY, speed, { course: round3(courseIn) }),
        makeTurnRow(columns, inn.x, inn.y, speed, {}, { row: c, columns: section2.columns }),
    ];
    return { section_type: 'turn_square', columns, values };
}

interface FittedConnection {
    firstCenterX: number;
    firstCenterY: number;
    secondCenterX: number;
    secondCenterY: number;
    centersDistance: number;
    firstStartAngle: number;
    secondEndAngle: number;
    firstTangentX?: number;
    firstTangentY?: number;
    secondTangentX?: number;
    secondTangentY?: number;
    firstEndAngle?: number;
    secondStartAngle?: number;
    firstArcSweep: number;
    secondArcSweep: number;
    firstClockwise: boolean;
    secondClockwise: boolean;
    pathLength: number;
}

export function createUTurn(
    section1: AgriSection,
    section2: AgriSection,
    columns: string[],
    spaceIn: number,
    spaceOut: number,
    headlandSpace: number,
    speed: number,
): { section: AgriSection } | { error: UTurnFailureCode } {
    if (section1.values.length < 2 || section2.values.length < 2) {
        return { error: 'invalidSection' };
    }
    const a = section1.values[section1.values.length - 1];
    const c = section2.values[0];
    const out = rowXY(a, section1.columns);
    const inn = rowXY(c, section2.columns);
    if (!a || !c || !out || !inn) {
        return { error: 'missingCoordinates' };
    }
    const directionOut = estimateSectionEndpointDirection(
        section1,
        section1.columns,
        true,
        U_TURN_DIRECTION_SAMPLE_M,
    );
    const directionIn = estimateSectionEndpointDirection(
        section2,
        section2.columns,
        false,
        U_TURN_DIRECTION_SAMPLE_M,
    );
    if (!directionOut || !directionIn) {
        return { error: 'directionUnavailable' };
    }
    const pointOutX = out.x + directionOut[0] * spaceOut;
    const pointOutY = out.y + directionOut[1] * spaceOut;
    const pointInX = inn.x - directionIn[0] * spaceIn;
    const pointInY = inn.y - directionIn[1] * spaceIn;
    const commonForwardX = directionOut[0] - directionIn[0];
    const commonForwardY = directionOut[1] - directionIn[1];
    const commonForwardLength = Math.sqrt(
        commonForwardX * commonForwardX + commonForwardY * commonForwardY,
    );
    const turnForwardX =
        commonForwardLength > 1e-9 ? commonForwardX / commonForwardLength : directionOut[0];
    const turnForwardY =
        commonForwardLength > 1e-9 ? commonForwardY / commonForwardLength : directionOut[1];
    const lateralX = pointInX - pointOutX;
    const lateralY = pointInY - pointOutY;
    const preferredClockwise = turnForwardX * lateralY - turnForwardY * lateralX <= 0;
    let clockwise = preferredClockwise;
    let clockwiseSign = clockwise ? -1 : 1;
    const maximumRadius = Math.max(
        0,
        Math.abs(headlandSpace) - Math.max(Math.abs(spaceOut), Math.abs(spaceIn)),
    );
    if (maximumRadius <= 1e-9) {
        return { error: 'headlandTooSmall' };
    }
    const leftOutX = -directionOut[1];
    const leftOutY = directionOut[0];
    const leftInX = -directionIn[1];
    const leftInY = directionIn[0];

    const calculateConnection = (
        candidateRadius: number,
        endClockwise = clockwise,
    ): FittedConnection | null => {
        const endClockwiseSign = endClockwise ? -1 : 1;
        const firstCenterX = pointOutX + clockwiseSign * leftOutX * candidateRadius;
        const firstCenterY = pointOutY + clockwiseSign * leftOutY * candidateRadius;
        const secondCenterX = pointInX + endClockwiseSign * leftInX * candidateRadius;
        const secondCenterY = pointInY + endClockwiseSign * leftInY * candidateRadius;
        const centersX = secondCenterX - firstCenterX;
        const centersY = secondCenterY - firstCenterY;
        const centersDistance = Math.sqrt(centersX * centersX + centersY * centersY);
        const firstStartAngle = Math.atan2(pointOutY - firstCenterY, pointOutX - firstCenterX);
        const secondEndAngle = Math.atan2(pointInY - secondCenterY, pointInX - secondCenterX);
        if (centersDistance <= 1e-9 && clockwise === endClockwise) {
            const sharedCircleSweep = Math.abs(
                getDirectedArcSweep(firstStartAngle, secondEndAngle, clockwise),
            );
            return {
                firstCenterX,
                firstCenterY,
                secondCenterX,
                secondCenterY,
                centersDistance,
                firstStartAngle,
                secondEndAngle,
                firstArcSweep: sharedCircleSweep,
                secondArcSweep: 0,
                firstClockwise: clockwise,
                secondClockwise: endClockwise,
                pathLength: sharedCircleSweep * candidateRadius,
            };
        }
        if (centersDistance <= 1e-9) {
            return null;
        }
        const tangentOffset =
            ((endClockwiseSign - clockwiseSign) * candidateRadius) / centersDistance;
        if (Math.abs(tangentOffset) > 1) {
            return null;
        }
        const centersAngle = Math.atan2(centersY, centersX);
        const tangentAngle = centersAngle - Math.asin(tangentOffset);
        const tangentDirectionX = Math.cos(tangentAngle);
        const tangentDirectionY = Math.sin(tangentAngle);
        const tangentLeftX = -tangentDirectionY;
        const tangentLeftY = tangentDirectionX;
        const firstTangentX = firstCenterX - clockwiseSign * tangentLeftX * candidateRadius;
        const firstTangentY = firstCenterY - clockwiseSign * tangentLeftY * candidateRadius;
        const secondTangentX = secondCenterX - endClockwiseSign * tangentLeftX * candidateRadius;
        const secondTangentY = secondCenterY - endClockwiseSign * tangentLeftY * candidateRadius;
        const firstEndAngle = Math.atan2(
            firstTangentY - firstCenterY,
            firstTangentX - firstCenterX,
        );
        const secondStartAngle = Math.atan2(
            secondTangentY - secondCenterY,
            secondTangentX - secondCenterX,
        );
        const firstArcSweep = Math.abs(
            getDirectedArcSweep(firstStartAngle, firstEndAngle, clockwise),
        );
        const secondArcSweep = Math.abs(
            getDirectedArcSweep(secondStartAngle, secondEndAngle, endClockwise),
        );
        const tangentLength = distance(
            firstTangentX,
            firstTangentY,
            secondTangentX,
            secondTangentY,
        );
        return {
            firstCenterX,
            firstCenterY,
            secondCenterX,
            secondCenterY,
            centersDistance,
            firstStartAngle,
            secondEndAngle,
            firstTangentX,
            firstTangentY,
            secondTangentX,
            secondTangentY,
            firstEndAngle,
            secondStartAngle,
            firstArcSweep,
            secondArcSweep,
            firstClockwise: clockwise,
            secondClockwise: endClockwise,
            pathLength: (firstArcSweep + secondArcSweep) * candidateRadius + tangentLength,
        };
    };

    const maximumArcSweep = Math.PI + 1e-6;
    const findLoopFreeConnection = (
        endClockwise = clockwise,
    ): { radius: number; connection: FittedConnection } | null => {
        let candidateRadius = maximumRadius;
        let candidateConnection = calculateConnection(candidateRadius, endClockwise);
        for (
            let attempt = 0;
            attempt < 40 &&
            (!candidateConnection ||
                candidateConnection.firstArcSweep > maximumArcSweep ||
                candidateConnection.secondArcSweep > maximumArcSweep);
            attempt += 1
        ) {
            candidateRadius *= 0.9;
            candidateConnection = calculateConnection(candidateRadius, endClockwise);
        }
        if (
            candidateRadius <= 1e-9 ||
            !candidateConnection ||
            candidateConnection.firstArcSweep > maximumArcSweep ||
            candidateConnection.secondArcSweep > maximumArcSweep
        ) {
            return null;
        }
        return { radius: candidateRadius, connection: candidateConnection };
    };

    let fittedConnection = findLoopFreeConnection();
    if (!fittedConnection) {
        clockwise = !clockwise;
        clockwiseSign = clockwise ? -1 : 1;
        fittedConnection = findLoopFreeConnection();
    }
    if (!fittedConnection) {
        const halfEightCandidates: Array<{ radius: number; connection: FittedConnection }> = [];
        clockwise = preferredClockwise;
        clockwiseSign = clockwise ? -1 : 1;
        const preferredHalfEight = findLoopFreeConnection(!clockwise);
        if (preferredHalfEight) {
            halfEightCandidates.push(preferredHalfEight);
        }
        clockwise = !preferredClockwise;
        clockwiseSign = clockwise ? -1 : 1;
        const alternateHalfEight = findLoopFreeConnection(preferredClockwise);
        if (alternateHalfEight) {
            halfEightCandidates.push(alternateHalfEight);
        }
        fittedConnection =
            halfEightCandidates.sort(
                (first, second) => first.connection.pathLength - second.connection.pathLength,
            )[0] || null;
    }
    if (!fittedConnection) {
        return { error: 'noSmoothConnection' };
    }
    const { radius, connection } = fittedConnection;
    const values: SectionRow[] = [
        makeTurnRow(columns, out.x, out.y, speed, {}, { row: a, columns: section1.columns }),
    ];
    addPointsAlongSegment(
        out.x,
        out.y,
        pointOutX,
        pointOutY,
        TURN_PATH_SPACING_M,
        values,
        columns,
        speed,
    );
    values.push(makeTurnRow(columns, pointOutX, pointOutY, speed));
    if (connection.centersDistance <= 1e-9) {
        addCircleArc(
            connection.firstStartAngle,
            connection.secondEndAngle,
            radius,
            connection.firstCenterX,
            connection.firstCenterY,
            connection.firstClockwise,
            values,
            columns,
            speed,
        );
    } else {
        addCircleArc(
            connection.firstStartAngle,
            connection.firstEndAngle ?? connection.firstStartAngle,
            radius,
            connection.firstCenterX,
            connection.firstCenterY,
            connection.firstClockwise,
            values,
            columns,
            speed,
        );
        addPointsAlongSegment(
            connection.firstTangentX ?? pointOutX,
            connection.firstTangentY ?? pointOutY,
            connection.secondTangentX ?? pointInX,
            connection.secondTangentY ?? pointInY,
            TURN_PATH_SPACING_M,
            values,
            columns,
            speed,
        );
        values.push(
            makeTurnRow(
                columns,
                connection.secondTangentX ?? pointInX,
                connection.secondTangentY ?? pointInY,
                speed,
            ),
        );
        addCircleArc(
            connection.secondStartAngle ?? connection.secondEndAngle,
            connection.secondEndAngle,
            radius,
            connection.secondCenterX,
            connection.secondCenterY,
            connection.secondClockwise,
            values,
            columns,
            speed,
        );
    }
    addPointsAlongSegment(
        pointInX,
        pointInY,
        inn.x,
        inn.y,
        TURN_PATH_SPACING_M,
        values,
        columns,
        speed,
    );
    values.push(
        makeTurnRow(columns, inn.x, inn.y, speed, {}, { row: c, columns: section2.columns }),
    );
    return { section: { section_type: 'turn_path', columns, values } };
}

function trimLoopClosingTurnEnd(
    loopTurn: AgriSection,
    firstSection: AgriSection,
    gapMeters: number,
): AgriSection {
    const columns = loopTurn.columns;
    const values = loopTurn.values;
    const first = rowXY(firstSection.values[0], firstSection.columns);
    const lastPoint = rowXY(values[values.length - 1], columns);
    const xi = columns.indexOf('x');
    const yi = columns.indexOf('y');
    if (!first || !lastPoint || xi < 0 || yi < 0 || values.length < 2) {
        return loopTurn;
    }
    if (distance(lastPoint.x, lastPoint.y, first.x, first.y) > gapMeters * 2) {
        return loopTurn;
    }
    let remainingGap = gapMeters;
    for (let index = values.length - 1; index > 0; index -= 1) {
        const point = rowXY(values[index], columns);
        const previousPoint = rowXY(values[index - 1], columns);
        if (!point || !previousPoint) {
            continue;
        }
        const segmentLength = distance(previousPoint.x, previousPoint.y, point.x, point.y);
        if (segmentLength < 1e-9) {
            continue;
        }
        if (remainingGap <= segmentLength) {
            const t = (segmentLength - remainingGap) / segmentLength;
            const trimmedX = previousPoint.x + t * (point.x - previousPoint.x);
            const trimmedY = previousPoint.y + t * (point.y - previousPoint.y);
            const trimmedValues = values.slice(0, index).map((row) => cloneSectionValueRow(row));
            const source = values[index];
            if (!source) {
                return loopTurn;
            }
            const trimmedRow = cloneSectionValueRow(source);
            trimmedRow[xi] = round3(trimmedX);
            trimmedRow[yi] = round3(trimmedY);
            const lastKept = rowXY(trimmedValues[trimmedValues.length - 1], columns);
            if (
                lastKept &&
                distance(lastKept.x, lastKept.y, Number(trimmedRow[xi]), Number(trimmedRow[yi])) >
                    1e-6
            ) {
                trimmedValues.push(trimmedRow);
            }
            return { ...loopTurn, values: trimmedValues };
        }
        remainingGap -= segmentLength;
    }
    return loopTurn;
}

function createLoopClosingHeadland(
    sectionLast: AgriSection,
    sectionFirst: AgriSection,
    columns: string[],
    opts: { spaceIn: number; spaceOut: number; speed: number; headlandSpace: number },
): AgriSection | null {
    if (sectionLast.values.length < 2 || sectionFirst.values.length < 2) {
        return null;
    }
    const a = sectionLast.values[sectionLast.values.length - 1];
    const stepBackOut = Math.max(1, Math.min(15, sectionLast.values.length - 2));
    const bBk = rowXY(
        sectionLast.values[sectionLast.values.length - 1 - stepBackOut],
        sectionLast.columns,
    );
    const out = rowXY(a, sectionLast.columns);
    if (!a || !bBk || !out) {
        return null;
    }
    const v1x = out.x - bBk.x;
    const v1y = out.y - bBk.y;
    const v1Len = Math.hypot(v1x, v1y);
    if (v1Len < 1e-9) {
        return null;
    }
    const vnx = v1x / v1Len;
    const vny = v1y / v1Len;
    const c = sectionFirst.values[0];
    const inn = rowXY(c, sectionFirst.columns);
    const d = rowXY(
        sectionFirst.values[Math.min(1, sectionFirst.values.length - 1)],
        sectionFirst.columns,
    );
    if (!c || !inn || !d) {
        return null;
    }
    const angleRow = Math.atan2(out.y - bBk.y, out.x - bBk.x);
    const aExtX = out.x + Math.cos(angleRow) * opts.spaceOut;
    const aExtY = out.y + Math.sin(angleRow) * opts.spaceOut;
    const toSx = inn.x - aExtX;
    const toSy = inn.y - aExtY;
    const perpAx = -vny;
    const perpAy = vnx;
    let nxs = perpAx;
    let nys = perpAy;
    if (nxs * toSx + nys * toSy > 0) {
        nxs = -perpAx;
        nys = -perpAy;
    }
    const nlen = Math.hypot(nxs, nys);
    nxs /= nlen;
    nys /= nlen;
    const approachGap = Math.max(opts.spaceIn, opts.spaceOut, opts.headlandSpace, 2);
    let lastRowLengthM = 0;
    for (let index = 1; index < sectionLast.values.length; index += 1) {
        const p0 = rowXY(sectionLast.values[index - 1], sectionLast.columns);
        const p1 = rowXY(sectionLast.values[index], sectionLast.columns);
        if (p0 && p1) {
            lastRowLengthM += distance(p0.x, p0.y, p1.x, p1.y);
        }
    }
    if (lastRowLengthM < 1e-6) {
        lastRowLengthM = v1Len * Math.max(1, sectionLast.values.length - 1);
    }
    const parallelRunM = lastRowLengthM + 2 * opts.spaceOut;
    const q1x = aExtX + nxs * opts.spaceOut;
    const q1y = aExtY + nys * opts.spaceOut;
    const qLatX = q1x + nxs * LOOP_HEADLAND_LATERAL_M;
    const qLatY = q1y + nys * LOOP_HEADLAND_LATERAL_M;
    const q5x = qLatX - vnx * parallelRunM;
    const q5y = qLatY - vny * parallelRunM;
    const toCx = inn.x - q5x;
    const toCy = inn.y - q5y;
    const ndot = nxs * toCx + nys * toCy;
    let q6x = q5x;
    let q6y = q5y;
    if (Math.abs(ndot) >= 1e-4) {
        const alignSign = ndot >= 0 ? 1 : -1;
        q6x = q5x + nxs * approachGap * alignSign;
        q6y = q5y + nys * approachGap * alignSign;
    }
    const angleFirst = Math.atan2(d.y - inn.y, d.x - inn.x);
    const pointInX = inn.x - Math.cos(angleFirst) * opts.spaceIn;
    const pointInY = inn.y - Math.sin(angleFirst) * opts.spaceIn;
    const values: SectionRow[] = [
        makeTurnRow(
            columns,
            out.x,
            out.y,
            opts.speed,
            {},
            { row: a, columns: sectionLast.columns },
        ),
    ];
    const pushCorner = (px: number, py: number, course: number) => {
        values.push(makeTurnRow(columns, px, py, opts.speed, { course: round3(course) }));
    };
    addPointsAlongSegment(
        out.x,
        out.y,
        aExtX,
        aExtY,
        TURN_PATH_SPACING_M,
        values,
        columns,
        opts.speed,
    );
    pushCorner(aExtX, aExtY, Math.atan2(nys, nxs));
    addPointsAlongSegment(aExtX, aExtY, q1x, q1y, TURN_PATH_SPACING_M, values, columns, opts.speed);
    pushCorner(q1x, q1y, Math.atan2(nys, nxs));
    addPointsAlongSegment(q1x, q1y, qLatX, qLatY, TURN_PATH_SPACING_M, values, columns, opts.speed);
    pushCorner(qLatX, qLatY, Math.atan2(-vny, -vnx));
    addPointsAlongSegment(qLatX, qLatY, q5x, q5y, TURN_PATH_SPACING_M, values, columns, opts.speed);
    const approachDx = q6x - q5x;
    const approachDy = q6y - q5y;
    const hasApproachNudge = approachDx * approachDx + approachDy * approachDy > 1e-8;
    if (hasApproachNudge) {
        pushCorner(q5x, q5y, Math.atan2(approachDy, approachDx));
        addPointsAlongSegment(q5x, q5y, q6x, q6y, TURN_PATH_SPACING_M, values, columns, opts.speed);
        pushCorner(q6x, q6y, Math.atan2(pointInY - q6y, pointInX - q6x));
    } else {
        pushCorner(q5x, q5y, Math.atan2(pointInY - q5y, pointInX - q5x));
    }
    const fromAx = hasApproachNudge ? q6x : q5x;
    const fromAy = hasApproachNudge ? q6y : q5y;
    addPointsAlongSegment(
        fromAx,
        fromAy,
        pointInX,
        pointInY,
        TURN_PATH_SPACING_M,
        values,
        columns,
        opts.speed,
    );
    pushCorner(pointInX, pointInY, Math.atan2(inn.y - pointInY, inn.x - pointInX));
    addPointsAlongSegment(
        pointInX,
        pointInY,
        inn.x,
        inn.y,
        TURN_PATH_SPACING_M,
        values,
        columns,
        opts.speed,
    );
    values.push(
        makeTurnRow(
            columns,
            inn.x,
            inn.y,
            opts.speed,
            {},
            { row: c, columns: sectionFirst.columns },
        ),
    );
    return { section_type: 'turn_path', columns, values };
}

function generateTurn(
    section1: AgriSection,
    section2: AgriSection,
    columns: string[],
    params: ConnectTurnsParams,
): { section: AgriSection | null; error?: UTurnFailureCode } {
    if (params.turnType === 'square') {
        return {
            section: createSquareTurn(
                section1,
                section2,
                columns,
                params.spaceIn,
                params.spaceOut,
                params.rowSpeed,
            ),
        };
    }
    const result = createUTurn(
        section1,
        section2,
        columns,
        params.spaceIn,
        params.spaceOut,
        params.headlandSpace,
        params.rowSpeed,
    );
    if ('error' in result) {
        return { section: null, error: result.error };
    }
    return { section: result.section };
}

export function connectTurns(
    document: AgriDocument | null | undefined,
    params: ConnectTurnsParams,
): ConnectTurnsResult {
    if (
        !(params.rowSpeed > 0) ||
        !(params.spaceIn > 0) ||
        !(params.spaceOut > 0) ||
        !(params.headlandSpace > 0) ||
        params.skipRows < 0 ||
        params.corkscrewJump < 1
    ) {
        return { ok: false, reason: 'invalid_params' };
    }
    const sourceSections = document?.points ?? [];
    const sourceRowSections = sourceSections.filter((section) => !isTurnSection(section));
    if (sourceRowSections.length < 2) {
        return { ok: false, reason: 'too_few_rows' };
    }
    const existingTurnSections = sourceSections.filter((section) => isTurnSection(section));
    const usedExistingTurnIndexes = new Set<number>();
    let workingSections = sourceRowSections.map((section) => cloneJson(section));
    if (params.reverseRows) {
        workingSections = workingSections.map((section) => reverseSection(section));
    }
    if (params.reverseSide) {
        workingSections = workingSections.reverse();
    }
    if (params.skipRows > 0) {
        workingSections = workingSections.filter((_, index) => index % (params.skipRows + 1) === 0);
        if (params.skipRows % 2 === 1) {
            workingSections = workingSections.map((section, index) =>
                index % 2 === 1 ? reverseSection(section) : section,
            );
        }
    }
    if (workingSections.length < 2) {
        return { ok: false, reason: 'too_few_rows' };
    }
    if (params.orderType === 'snake') {
        workingSections = applySnakeOrder(workingSections);
    } else if (params.orderType === 'corkscrew') {
        workingSections = applyCorkscrewOrder(workingSections, params.corkscrewJump);
    }
    if (params.densifyRows) {
        workingSections = workingSections.map((section) =>
            densifyRowLineSectionToRowPath(section, TURN_PATH_SPACING_M),
        );
    }
    let mergedColumns = mergeConnectTurnColumns(workingSections);
    if (mergedColumns.length === 0) {
        mergedColumns = ['x', 'y', 'speed', 'working_zone', 'punctual'];
    } else {
        mergedColumns = ensureConnectTurnOutputColumns(mergedColumns);
    }
    const finalSections: AgriSection[] = [];
    const failures: UTurnFailure[] = [];
    let turns = 0;
    for (let index = 0; index < workingSections.length - 1; index += 1) {
        const section1 = workingSections[index];
        const section2 = workingSections[index + 1];
        if (!section1 || !section2) {
            continue;
        }
        finalSections.push(addSpeed(section1, mergedColumns, params.rowSpeed));
        const existing = findExistingTurnBetween(
            existingTurnSections,
            usedExistingTurnIndexes,
            section1,
            section2,
        );
        if (existing) {
            usedExistingTurnIndexes.add(existing.index);
            finalSections.push(addSpeed(existing.section, mergedColumns, params.rowSpeed));
            turns += 1;
            continue;
        }
        const generated = generateTurn(section1, section2, mergedColumns, params);
        if (generated.section) {
            finalSections.push(generated.section);
            turns += 1;
        } else if (params.turnType === 'u_turn') {
            failures.push({
                from: index + 1,
                to: index + 2,
                code: generated.error ?? 'unknown',
            });
        }
    }
    const lastSection = workingSections[workingSections.length - 1];
    if (lastSection) {
        finalSections.push(addSpeed(lastSection, mergedColumns, params.rowSpeed));
    }
    if (params.loop && workingSections.length >= 2) {
        const secLast = workingSections[workingSections.length - 1];
        const secFirst = workingSections[0];
        if (secLast && secFirst) {
            const existingLoop = findExistingTurnBetween(
                existingTurnSections,
                usedExistingTurnIndexes,
                secLast,
                secFirst,
            );
            let loopTurn: AgriSection | null = null;
            if (existingLoop) {
                usedExistingTurnIndexes.add(existingLoop.index);
                loopTurn = addSpeed(existingLoop.section, mergedColumns, params.rowSpeed);
            } else if (!haveSameDirection(secLast, secFirst)) {
                const generated = generateTurn(secLast, secFirst, mergedColumns, params);
                loopTurn = generated.section;
                if (!loopTurn && params.turnType === 'u_turn') {
                    failures.push({
                        from: workingSections.length,
                        to: 1,
                        code: generated.error ?? 'unknown',
                    });
                }
            } else {
                loopTurn = createLoopClosingHeadland(secLast, secFirst, mergedColumns, {
                    spaceIn: params.spaceIn,
                    spaceOut: params.spaceOut,
                    speed: params.rowSpeed,
                    headlandSpace: params.headlandSpace,
                });
            }
            if (loopTurn) {
                finalSections.push(trimLoopClosingTurnEnd(loopTurn, secFirst, TURN_PATH_SPACING_M));
                turns += 1;
            }
        }
    }
    for (const section of finalSections) {
        if (section.values.length > MAX_POINTS_PER_SECTION) {
            return { ok: false, reason: 'section_limit' };
        }
    }
    const nextDocument: AgriDocument = {
        ...(document as AgriDocument),
        points: finalSections,
    };
    if (getTotalPointsCount(nextDocument) > MAX_POINTS_PER_TRAJECTORY) {
        return { ok: false, reason: 'trajectory_limit' };
    }
    return { ok: true, document: nextDocument, turns, failures };
}

/**
 * Insert turns between a freshly generated block of `row_line` sections only.
 * Existing rows of another parcel are not passed in — they would otherwise
 * skip auto-connect (or stitch the two fields together).
 */
export function connectNewRowLines(
    sections: AgriSection[],
    params: ConnectTurnsParams,
    reserve?: TurnReserveOptions,
): { sections: AgriSection[]; turns: number } {
    const rows = reserveTurnSpaceOnRowLines(
        sections.filter((section) => getSectionTypeString(section) === 'row_line'),
        rowEndTrimMeters(params, reserve),
    );
    const others = sections.filter((section) => getSectionTypeString(section) !== 'row_line');
    if (rows.length < 2) {
        return { sections: [...others.map((section) => cloneJson(section)), ...rows], turns: 0 };
    }
    const result = connectTurns({ points: rows }, params);
    if (!result.ok) {
        return {
            sections: [...others.map((section) => cloneJson(section)), ...rows],
            turns: 0,
        };
    }
    return {
        sections: [...others.map((section) => cloneJson(section)), ...result.document.points],
        turns: result.turns,
    };
}

/** Connect only Agri `row_line` rows so fourrière `row_path` contours stay intact. */
export function connectRowLinesPreservingOthers(
    document: AgriDocument | null | undefined,
    params: ConnectTurnsParams,
): ConnectTurnsResult {
    const source = document?.points ?? [];
    const preserved = source.filter(
        (section) => getSectionTypeString(section) !== 'row_line' && !isTurnSection(section),
    );
    const rowsAndTurns = source.filter(
        (section) => getSectionTypeString(section) === 'row_line' || isTurnSection(section),
    );
    const subset: AgriDocument = document
        ? { ...document, points: rowsAndTurns }
        : { points: rowsAndTurns };
    const result = connectTurns(subset, params);
    if (!result.ok) {
        return result;
    }
    return {
        ...result,
        document: {
            ...result.document,
            points: [...preserved.map((section) => cloneJson(section)), ...result.document.points],
        },
    };
}
