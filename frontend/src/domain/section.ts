import {
    cloneJson,
    cloneSectionValueRow,
    getSectionTypeString,
    getTotalPointsCount,
    MAX_POINTS_PER_SECTION,
    MAX_POINTS_PER_TRAJECTORY,
    type AgriDocument,
    type AgriSection,
    type SectionRow,
} from './agri';
import {
    TURN_PATH_SPACING_M,
    clipPolylineOutsidePolygon,
    distance,
    pointInPolygon,
    latLngToLocal,
    leftPerpendicular,
    round3,
    splitPolylineByPolygon,
    type LatLng,
    type PolygonRun,
    type Wgs84Origin,
} from './geometry';

/** Drop numerical slivers left by a previous clip (round3 on the ring). */
const MIN_WORKING_ZONE_RUN_M = 0.02;

function polylineLength(points: [number, number][]): number {
    let length = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
        const a = points[index];
        const b = points[index + 1];
        if (!a || !b) {
            continue;
        }
        length += distance(a[0], a[1], b[0], b[1]);
    }
    return length;
}

function meaningfulWorkingZoneRuns(runs: PolygonRun[]): PolygonRun[] {
    return runs.filter((run) => polylineLength(run.points) >= MIN_WORKING_ZONE_RUN_M);
}

export function interpolateRowLinePoint(
    rowA: SectionRow,
    rowB: SectionRow,
    columns: string[],
    xi: number,
    yi: number,
    t: number,
): SectionRow {
    const x1 = Number(rowA[xi]);
    const y1 = Number(rowA[yi]);
    const x2 = Number(rowB[xi]);
    const y2 = Number(rowB[yi]);
    const x = round3(x1 + t * (x2 - x1));
    const y = round3(y1 + t * (y2 - y1));
    return columns.map((col, cidx) => {
        if (col === 'x') {
            return x;
        }
        if (col === 'y') {
            return y;
        }
        if (col === 'punctual') {
            return {};
        }
        const va = rowA[cidx];
        const vb = rowB[cidx];
        if (
            col === 'working_zone' &&
            typeof va === 'number' &&
            typeof vb === 'number' &&
            Number.isFinite(va) &&
            Number.isFinite(vb)
        ) {
            return Math.round(va + t * (vb - va));
        }
        if (
            typeof va === 'number' &&
            typeof vb === 'number' &&
            Number.isFinite(va) &&
            Number.isFinite(vb)
        ) {
            return round3(va + t * (vb - va));
        }
        if (typeof vb === 'number' && Number.isFinite(vb)) {
            return round3(vb);
        }
        if (typeof va === 'number' && Number.isFinite(va)) {
            return round3(va);
        }
        if (va !== undefined && va !== null) {
            return va;
        }
        return 0;
    });
}

export function densifyRowLineSectionToRowPath(
    section: AgriSection,
    spacing: number = TURN_PATH_SPACING_M,
): AgriSection {
    if (getSectionTypeString(section) !== 'row_line') {
        return section;
    }
    const cols = section.columns || [];
    const xi = cols.indexOf('x');
    const yi = cols.indexOf('y');
    const base: AgriSection = { ...section, columns: cols.slice() };
    delete base.sectionType;
    base.section_type = 'row_path';
    if (xi < 0 || yi < 0) {
        return base;
    }
    const values = section.values || [];
    if (values.length < 2) {
        return base;
    }
    const outVals: SectionRow[] = [];
    for (let index = 0; index < values.length - 1; index += 1) {
        const rowA = values[index];
        const rowB = values[index + 1];
        if (!rowA || !rowB) {
            continue;
        }
        const x1 = Number(rowA[xi]);
        const y1 = Number(rowA[yi]);
        const x2 = Number(rowB[xi]);
        const y2 = Number(rowB[yi]);
        const d = distance(x1, y1, x2, y2);
        if (index === 0) {
            outVals.push(cloneSectionValueRow(rowA));
        }
        if (d < 1e-9) {
            outVals.push(cloneSectionValueRow(rowB));
            continue;
        }
        for (let step = 1; step * spacing < d; step += 1) {
            const t = (step * spacing) / d;
            outVals.push(interpolateRowLinePoint(rowA, rowB, cols, xi, yi, t));
        }
        outVals.push(cloneSectionValueRow(rowB));
    }
    base.values = outVals;
    return base;
}

export function normalizeSectionToColumns(
    section: AgriSection,
    targetColumns: string[],
    opts: { speed?: number } = {},
): AgriSection {
    const srcCols = section.columns || [];
    const values = (section.values || []).map((row) =>
        targetColumns.map((col) => {
            let cell: SectionRow[number];
            if (opts.speed != null && col === 'speed') {
                cell = opts.speed;
            } else {
                const index = srcCols.indexOf(col);
                if (
                    index >= 0 &&
                    index < row.length &&
                    row[index] !== undefined &&
                    row[index] !== null
                ) {
                    cell = row[index] as SectionRow[number];
                } else if (col === 'punctual') {
                    cell = {};
                } else {
                    cell = 0;
                }
            }
            if ((col === 'x' || col === 'y') && typeof cell === 'number' && Number.isFinite(cell)) {
                cell = round3(cell);
            }
            return cell;
        }),
    );
    return { ...section, columns: targetColumns.slice(), values };
}

function cloneRowWithXY(
    row: SectionRow,
    x: number,
    y: number,
    xIdx: number,
    yIdx: number,
): SectionRow {
    const cloned = row.map((cell) => {
        if (cell !== null && typeof cell === 'object') {
            return cloneJson(cell);
        }
        return cell;
    });
    cloned[xIdx] = round3(x);
    cloned[yIdx] = round3(y);
    return cloned;
}

export function extendSection(
    document: AgriDocument,
    sectionIndex: number,
    direction: 'start' | 'end',
    targetLocal: { x: number; y: number },
    spacing = TURN_PATH_SPACING_M,
): { added: number; document: AgriDocument } {
    const section = document.points[sectionIndex];
    if (!section || !Array.isArray(section.values) || section.values.length === 0) {
        return { added: 0, document };
    }
    const xIdx = section.columns.indexOf('x');
    const yIdx = section.columns.indexOf('y');
    if (xIdx < 0 || yIdx < 0) {
        return { added: 0, document };
    }
    const anchorRow =
        direction === 'start' ? section.values[0] : section.values[section.values.length - 1];
    if (!anchorRow) {
        return { added: 0, document };
    }
    const anchorXY = { x: Number(anchorRow[xIdx]), y: Number(anchorRow[yIdx]) };
    const dx = targetLocal.x - anchorXY.x;
    const dy = targetLocal.y - anchorXY.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < spacing) {
        return { added: 0, document };
    }
    const safeSpacing = spacing > 0 ? spacing : TURN_PATH_SPACING_M;
    const numIntermediates = Math.floor(length / safeSpacing);
    const estimatedAdded = numIntermediates + 1;
    if (section.values.length + estimatedAdded > MAX_POINTS_PER_SECTION) {
        return { added: -1, document };
    }
    if (getTotalPointsCount(document) + estimatedAdded > MAX_POINTS_PER_TRAJECTORY) {
        return { added: -1, document };
    }
    const newRows: SectionRow[] = [];
    for (let step = 1; step <= numIntermediates; step += 1) {
        const t = (step * safeSpacing) / length;
        if (t >= 1.0) {
            break;
        }
        newRows.push(
            cloneRowWithXY(anchorRow, anchorXY.x + t * dx, anchorXY.y + t * dy, xIdx, yIdx),
        );
    }
    newRows.push(cloneRowWithXY(anchorRow, targetLocal.x, targetLocal.y, xIdx, yIdx));
    const nextValues =
        direction === 'start'
            ? [...newRows].reverse().concat(section.values)
            : section.values.concat(newRows);
    const nextSection = { ...section, values: nextValues };
    return {
        added: newRows.length,
        document: {
            ...document,
            points: document.points.map((entry, index) =>
                index === sectionIndex ? nextSection : entry,
            ),
        },
    };
}

/** Same as TrajectoryEditor.applySectionExtension, with the target already in local xy. */
export const applySectionExtension = extendSection;

export function sectionKeepsSparseVertices(section: AgriSection): boolean {
    const type = getSectionTypeString(section);
    return type === 'row_line' || type === 'turn_square';
}

/** Studio: row_line / turn_square keep their vertices; densified types gain 0.1 m points. */
export function extendSectionSmart(
    document: AgriDocument,
    sectionIndex: number,
    direction: 'start' | 'end',
    targetLocal: { x: number; y: number },
): { added: number; document: AgriDocument; mode: 'relocate' | 'densify' } {
    const section = document.points[sectionIndex];
    if (!section || !Array.isArray(section.values) || section.values.length === 0) {
        return { added: 0, document, mode: 'relocate' };
    }
    if (!sectionKeepsSparseVertices(section)) {
        const result = extendSection(document, sectionIndex, direction, targetLocal);
        return { ...result, mode: 'densify' };
    }
    const xIdx = section.columns.indexOf('x');
    const yIdx = section.columns.indexOf('y');
    if (xIdx < 0 || yIdx < 0) {
        return { added: 0, document, mode: 'relocate' };
    }
    const endpointIndex = direction === 'start' ? 0 : section.values.length - 1;
    const nextValues = section.values.map((row, index) => {
        if (index !== endpointIndex) {
            return row;
        }
        const next = [...row];
        next[xIdx] = round3(targetLocal.x);
        next[yIdx] = round3(targetLocal.y);
        return next;
    });
    return {
        added: 1,
        mode: 'relocate',
        document: {
            ...document,
            points: document.points.map((entry, index) =>
                index === sectionIndex ? { ...section, values: nextValues } : entry,
            ),
        },
    };
}

export function buildSectionsAfterDelete(
    sections: AgriSection[],
    pointsToDelete: Array<{ sectionIndex: number; pointIndex: number }>,
): AgriSection[] {
    if (pointsToDelete.length === 0) {
        return sections.map((section) => cloneJson(section));
    }
    const toDeleteBySection: Record<number, Set<number>> = {};
    for (const { sectionIndex, pointIndex } of pointsToDelete) {
        if (!toDeleteBySection[sectionIndex]) {
            toDeleteBySection[sectionIndex] = new Set();
        }
        toDeleteBySection[sectionIndex]?.add(pointIndex);
    }
    const newPoints: AgriSection[] = [];
    sections.forEach((section, sectionIndex) => {
        const deleteSet = toDeleteBySection[sectionIndex];
        if (!deleteSet || deleteSet.size === 0) {
            newPoints.push(cloneJson(section));
            return;
        }
        const keptIndices: number[] = [];
        for (let index = 0; index < section.values.length; index += 1) {
            if (!deleteSet.has(index)) {
                keptIndices.push(index);
            }
        }
        if (keptIndices.length === 0) {
            return;
        }
        const runs: Array<{ start: number; end: number }> = [];
        let runStart = keptIndices[0] ?? 0;
        for (let index = 1; index <= keptIndices.length; index += 1) {
            const current = keptIndices[index];
            const previous = keptIndices[index - 1];
            if (index === keptIndices.length || current !== (previous ?? 0) + 1) {
                runs.push({ start: runStart, end: previous ?? runStart });
                if (index < keptIndices.length && current !== undefined) {
                    runStart = current;
                }
            }
        }
        for (const { start, end } of runs) {
            const newValues = section.values.slice(start, end + 1).map((row) => cloneJson(row));
            if (newValues.length >= 1) {
                newPoints.push({ ...cloneJson(section), values: newValues });
            }
        }
    });
    return newPoints;
}

function almostSameXy(a: [number, number], b: [number, number], eps = 1e-4): boolean {
    return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
}

function rowForClippedPoint(
    section: AgriSection,
    xi: number,
    yi: number,
    xy: [number, number][],
    pt: [number, number],
): SectionRow {
    for (let index = 0; index < xy.length; index += 1) {
        const vertex = xy[index];
        const row = section.values[index];
        if (vertex && row && almostSameXy(vertex, pt)) {
            return cloneSectionValueRow(row);
        }
    }
    let bestIndex = 0;
    let bestT = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < xy.length - 1; index += 1) {
        const start = xy[index];
        const end = xy[index + 1];
        if (!start || !end) {
            continue;
        }
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const len2 = dx * dx + dy * dy;
        const t =
            len2 < 1e-18
                ? 0
                : Math.max(
                      0,
                      Math.min(1, ((pt[0] - start[0]) * dx + (pt[1] - start[1]) * dy) / len2),
                  );
        const d = distance(pt[0], pt[1], start[0] + t * dx, start[1] + t * dy);
        if (d < bestDistance) {
            bestDistance = d;
            bestIndex = index;
            bestT = t;
        }
    }
    const rowA = section.values[bestIndex];
    const rowB = section.values[bestIndex + 1];
    if (!rowA || !rowB) {
        return section.columns.map((col) => {
            if (col === 'x') {
                return round3(pt[0]);
            }
            if (col === 'y') {
                return round3(pt[1]);
            }
            if (col === 'punctual') {
                return {};
            }
            return 0;
        });
    }
    const interpolated = interpolateRowLinePoint(rowA, rowB, section.columns, xi, yi, bestT);
    interpolated[xi] = round3(pt[0]);
    interpolated[yi] = round3(pt[1]);
    return interpolated;
}

/**
 * Clip Agri sections against a local-xy polygon: keep only the polyline
 * portions **outside** the ring. A two-vertex `row_line` crossing the ring
 * becomes two `row_line`s of two vertices (entry / exit interpolated).
 * Runs shorter than 2 points are dropped (`row_line` is unusable otherwise).
 */
export function clipSectionsOutsidePolygon(
    sections: AgriSection[],
    polygon: [number, number][],
): { sections: AgriSection[]; changed: number } {
    let changed = 0;
    const out: AgriSection[] = [];
    for (const section of sections) {
        const xi = section.columns.indexOf('x');
        const yi = section.columns.indexOf('y');
        if (xi < 0 || yi < 0 || section.values.length < 2) {
            out.push(cloneJson(section));
            continue;
        }
        const xy = section.values.map(
            (row) => [Number(row[xi]), Number(row[yi])] as [number, number],
        );
        const runs = clipPolylineOutsidePolygon(xy, polygon);
        const unchanged =
            runs.length === 1 &&
            runs[0] !== undefined &&
            runs[0].length === xy.length &&
            runs[0].every((pt, index) => {
                const original = xy[index];
                return original !== undefined && almostSameXy(pt, original, 1e-3);
            });
        if (unchanged) {
            out.push(cloneJson(section));
            continue;
        }
        changed += 1;
        for (const run of runs) {
            if (run.length < 2) {
                continue;
            }
            out.push({
                ...cloneJson(section),
                values: run.map((pt) => rowForClippedPoint(section, xi, yi, xy, pt)),
            });
        }
    }
    return { sections: out, changed };
}

function withWorkingZoneValue(section: AgriSection, value: 0 | 1): AgriSection {
    let columns = section.columns;
    let wzIndex = columns.indexOf('working_zone');
    if (wzIndex < 0) {
        columns = [...columns, 'working_zone'];
        wzIndex = columns.length - 1;
    }
    return {
        ...section,
        columns,
        values: section.values.map((row) => {
            const next = [...row];
            next[wzIndex] = value;
            return next;
        }),
    };
}

/**
 * Recut sections at the polygon boundary and set `working_zone` only on the
 * pieces that lie inside the ring. Crossing a 2-vertex `row_line` yields
 * outside / inside / outside sections instead of marking the whole row.
 */
export function applyWorkingZoneSplit(
    sections: AgriSection[],
    polygon: [number, number][],
    value: 0 | 1,
): { sections: AgriSection[]; count: number } {
    let count = 0;
    const out: AgriSection[] = [];
    for (const section of sections) {
        const xi = section.columns.indexOf('x');
        const yi = section.columns.indexOf('y');
        if (xi < 0 || yi < 0) {
            out.push(cloneJson(section));
            continue;
        }
        if (section.values.length < 2) {
            const row = section.values[0];
            if (row && pointInPolygon(Number(row[xi]), Number(row[yi]), polygon)) {
                const tagged = withWorkingZoneValue(cloneJson(section), value);
                count += tagged.values.length;
                out.push(tagged);
            } else {
                out.push(cloneJson(section));
            }
            continue;
        }
        const xy = section.values.map(
            (row) => [Number(row[xi]), Number(row[yi])] as [number, number],
        );
        const runs = meaningfulWorkingZoneRuns(splitPolylineByPolygon(xy, polygon));
        const onlyOutside = runs.length === 1 && runs[0]?.inside === false;
        if (onlyOutside) {
            out.push(cloneJson(section));
            continue;
        }
        const onlyInside = runs.length === 1 && runs[0]?.inside === true;
        if (onlyInside) {
            const tagged = withWorkingZoneValue(cloneJson(section), value);
            count += tagged.values.length;
            out.push(tagged);
            continue;
        }
        for (const run of runs) {
            if (run.points.length < 2 || polylineLength(run.points) < MIN_WORKING_ZONE_RUN_M) {
                continue;
            }
            let piece: AgriSection = {
                ...cloneJson(section),
                values: run.points.map((pt) => rowForClippedPoint(section, xi, yi, xy, pt)),
            };
            if (run.inside) {
                piece = withWorkingZoneValue(piece, value);
                count += piece.values.length;
            }
            out.push(piece);
        }
    }
    return { sections: out, count };
}

export function moveSections(
    document: AgriDocument,
    selectedIndices: number[],
    dx: number,
    dy: number,
): AgriDocument {
    if (selectedIndices.length === 0) {
        return document;
    }
    return {
        ...document,
        points: document.points.map((section, index) => {
            if (!selectedIndices.includes(index)) {
                return section;
            }
            const xIndex = section.columns.indexOf('x');
            const yIndex = section.columns.indexOf('y');
            if (xIndex < 0 || yIndex < 0) {
                return section;
            }
            return {
                ...section,
                values: section.values.map((row) => {
                    const next = [...row];
                    next[xIndex] = Number(row[xIndex]) + dx;
                    next[yIndex] = Number(row[yIndex]) + dy;
                    return next;
                }),
            };
        }),
    };
}

export function rotateSections(
    document: AgriDocument,
    selectedIndices: number[],
    angleDegrees: number,
): AgriDocument {
    if (selectedIndices.length === 0) {
        return document;
    }
    let sumX = 0;
    let sumY = 0;
    let totalPoints = 0;
    for (const index of selectedIndices) {
        const section = document.points[index];
        if (!section?.values?.length) {
            continue;
        }
        const xIndex = section.columns.indexOf('x');
        const yIndex = section.columns.indexOf('y');
        if (xIndex < 0 || yIndex < 0) {
            continue;
        }
        for (const row of section.values) {
            sumX += Number(row[xIndex]);
            sumY += Number(row[yIndex]);
            totalPoints += 1;
        }
    }
    if (totalPoints === 0) {
        return document;
    }
    const centerX = sumX / totalPoints;
    const centerY = sumY / totalPoints;
    const angleRad = (angleDegrees * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    return {
        ...document,
        points: document.points.map((section, index) => {
            if (!selectedIndices.includes(index)) {
                return section;
            }
            const xIndex = section.columns.indexOf('x');
            const yIndex = section.columns.indexOf('y');
            if (xIndex < 0 || yIndex < 0) {
                return section;
            }
            return {
                ...section,
                values: section.values.map((row) => {
                    const next = [...row];
                    const x = Number(row[xIndex]);
                    const y = Number(row[yIndex]);
                    const dx = x - centerX;
                    const dy = y - centerY;
                    next[xIndex] = round3(dx * cos - dy * sin + centerX);
                    next[yIndex] = round3(dx * sin + dy * cos + centerY);
                    return next;
                }),
            };
        }),
    };
}

export function duplicateSectionsAtDistance(
    sections: AgriSection[],
    selectedIndices: number[],
    distanceM: number,
    side: 'left' | 'right',
    count = 1,
): AgriSection[] {
    const sign = side === 'right' ? -1 : 1;
    const offset = sign * Math.abs(distanceM);
    const duplicateCount = Math.max(1, Math.floor(Number(count) || 1));
    const newSections: AgriSection[] = [];
    for (const index of selectedIndices) {
        const section = sections[index];
        if (!section) {
            continue;
        }
        const cols = section.columns || [];
        const xi = cols.indexOf('x');
        const yi = cols.indexOf('y');
        if (xi < 0 || yi < 0) {
            for (let copyIndex = 1; copyIndex <= duplicateCount; copyIndex += 1) {
                const copied = cloneJson(section);
                if (copyIndex % 2 === 1) {
                    copied.values.reverse();
                }
                newSections.push(copied);
            }
            continue;
        }
        const first = section.values[0];
        const last = section.values[section.values.length - 1];
        const { perpX, perpY } =
            first && last
                ? leftPerpendicular(
                      Number(first[xi]),
                      Number(first[yi]),
                      Number(last[xi]),
                      Number(last[yi]),
                  )
                : { perpX: 1, perpY: 0 };
        for (let copyIndex = 1; copyIndex <= duplicateCount; copyIndex += 1) {
            const shifted = cloneJson(section);
            const copyOffset = offset * copyIndex;
            shifted.values = shifted.values.map((row) => {
                const next = [...row];
                next[xi] = round3(Number(row[xi]) + copyOffset * perpX);
                next[yi] = round3(Number(row[yi]) + copyOffset * perpY);
                return next;
            });
            if (copyIndex % 2 === 1) {
                shifted.values.reverse();
            }
            newSections.push(shifted);
        }
    }
    return newSections;
}

export function duplicateSectionsInDocument(
    document: AgriDocument,
    selectedIndices: number[],
    distanceM: number,
    side: 'left' | 'right',
    count = 1,
): AgriDocument {
    const copies = duplicateSectionsAtDistance(
        document.points,
        selectedIndices,
        distanceM,
        side,
        count,
    );
    return { ...document, points: [...document.points, ...copies] };
}

/** In-place lateral shift. Same translation for every selected section (no zipper on boustrophedon).
 *  Right of a north–south row is east, even if that row is driven southbound. */
export function offsetSections(
    document: AgriDocument,
    selectedIndices: number[],
    distanceM: number,
    side: 'left' | 'right',
): AgriDocument {
    if (selectedIndices.length === 0 || !Number.isFinite(distanceM) || distanceM === 0) {
        return document;
    }
    const reference = selectedIndices
        .map((index) => document.points[index])
        .find((section) => section && section.values.length >= 2);
    if (!reference) {
        return document;
    }
    const xIndex = reference.columns.indexOf('x');
    const yIndex = reference.columns.indexOf('y');
    if (xIndex < 0 || yIndex < 0) {
        return document;
    }
    const first = reference.values[0];
    const last = reference.values[reference.values.length - 1];
    if (!first || !last) {
        return document;
    }
    let x0 = Number(first[xIndex]);
    let y0 = Number(first[yIndex]);
    let x1 = Number(last[xIndex]);
    let y1 = Number(last[yIndex]);
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dy < 0 || (Math.abs(dy) < 1e-9 && dx < 0)) {
        [x0, y0, x1, y1] = [x1, y1, x0, y0];
    }
    const { perpX, perpY } = leftPerpendicular(x0, y0, x1, y1);
    const signed = (side === 'right' ? -1 : 1) * Math.abs(distanceM);
    return moveSections(document, selectedIndices, round3(signed * perpX), round3(signed * perpY));
}

export function generateRowPathFromLatLngs(
    latLngPoints: LatLng[],
    origin: Wgs84Origin,
    spacing = TURN_PATH_SPACING_M,
    speed = 0.5,
): AgriSection | null {
    if (latLngPoints.length < 2) {
        return null;
    }
    const points: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < latLngPoints.length - 1; index += 1) {
        const p1 = latLngPoints[index];
        const p2 = latLngPoints[index + 1];
        if (!p1 || !p2) {
            continue;
        }
        const local1 = latLngToLocal(p1, origin);
        const local2 = latLngToLocal(p2, origin);
        const dx = local2.x - local1.x;
        const dy = local2.y - local1.y;
        const segmentLength = Math.sqrt(dx * dx + dy * dy);
        if (segmentLength <= 0) {
            continue;
        }
        if (index === 0) {
            points.push({ x: round3(local1.x), y: round3(local1.y) });
        }
        const numPoints = Math.floor(segmentLength / spacing);
        for (let step = 1; step <= numPoints; step += 1) {
            const t = (step * spacing) / segmentLength;
            if (t < 1.0) {
                points.push({
                    x: round3(local1.x + t * dx),
                    y: round3(local1.y + t * dy),
                });
            }
        }
    }
    const lastPoint = latLngPoints[latLngPoints.length - 1];
    if (lastPoint) {
        const lastLocal = latLngToLocal(lastPoint, origin);
        points.push({ x: round3(lastLocal.x), y: round3(lastLocal.y) });
    }
    return {
        section_type: 'row_path',
        columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
        values: points.map((point) => [point.x, point.y, speed, 1, {}]),
    };
}

/** Clicked vertices only. Consumed by nav_line_matcher (one LineMatcher goal per pair). */
export function generateRowLineFromLatLngs(
    latLngPoints: LatLng[],
    origin: Wgs84Origin,
    speed = 0.5,
): AgriSection | null {
    if (latLngPoints.length < 2) {
        return null;
    }
    const values: AgriSection['values'] = [];
    for (const point of latLngPoints) {
        const local = latLngToLocal(point, origin);
        const x = round3(local.x);
        const y = round3(local.y);
        const previous = values[values.length - 1];
        if (previous && Number(previous[0]) === x && Number(previous[1]) === y) {
            continue;
        }
        values.push([x, y, speed, 1, {}]);
    }
    if (values.length < 2) {
        return null;
    }
    return {
        section_type: 'row_line',
        columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
        values,
    };
}
