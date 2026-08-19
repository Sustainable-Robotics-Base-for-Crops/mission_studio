/** Raster coverage quality (SIM-003): gap and overlap inside the geofence.
 * Gap is reported, never a publication blocker — partial coverage is a valid
 * plan (vineyard rows, strip-till, market-garden beds). Overlap can still warn
 * or block. */

import { getSectionTypeString, isTurnSection, type AgriDocument } from './agri';
import { pointInPolygon } from './geometry';

/** Gap is a metric, never a blocker: vineyard rows, strip-till, beds. */
export const COVERAGE_OVERLAP_WARN_PCT = 20;
export const COVERAGE_OVERLAP_BLOCK_PCT = 50;

export type CoverageScore = {
    cellM: number;
    fieldCells: number;
    coveredCells: number;
    overlapCells: number;
    gapCells: number;
    coveragePct: number;
    overlapPct: number;
    gapPct: number;
};

export type WorkSegment = { x0: number; y0: number; x1: number; y1: number };

function columnIndex(columns: unknown, name: string): number {
    return Array.isArray(columns) ? columns.indexOf(name) : -1;
}

export function workSegmentsFromDocument(document: AgriDocument): WorkSegment[] {
    const segments: WorkSegment[] = [];
    for (const section of document.points) {
        if (isTurnSection(section) || !getSectionTypeString(section).startsWith('row')) {
            continue;
        }
        const xIndex = columnIndex(section.columns, 'x');
        const yIndex = columnIndex(section.columns, 'y');
        const wzIndex = columnIndex(section.columns, 'working_zone');
        if (xIndex < 0 || yIndex < 0 || !Array.isArray(section.values)) {
            continue;
        }
        const points: { x: number; y: number; work: boolean }[] = [];
        for (const row of section.values) {
            const x = Number(row[xIndex]);
            const y = Number(row[yIndex]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                continue;
            }
            const wz = wzIndex >= 0 ? Number(row[wzIndex]) : 1;
            points.push({ x, y, work: !(wzIndex >= 0 && wz < 1) });
        }
        for (let index = 1; index < points.length; index += 1) {
            const start = points[index - 1];
            const end = points[index];
            if (!start || !end || !start.work) {
                continue;
            }
            segments.push({ x0: start.x, y0: start.y, x1: end.x, y1: end.y });
        }
    }
    return segments;
}

function grade(pct: number, warn: number, block: number): 'pass' | 'warn' | 'block' {
    if (pct >= block) {
        return 'block';
    }
    if (pct >= warn) {
        return 'warn';
    }
    return 'pass';
}

export function gradeCoverageGap(_gapPct: number): 'pass' | 'warn' | 'block' {
    return 'pass';
}

export function gradeCoverageOverlap(overlapPct: number): 'pass' | 'warn' | 'block' {
    return grade(overlapPct, COVERAGE_OVERLAP_WARN_PCT, COVERAGE_OVERLAP_BLOCK_PCT);
}

export function scoreCoverage(input: {
    ring: [number, number][];
    segments: WorkSegment[];
    workingWidthM: number;
}): CoverageScore | null {
    const { ring, segments, workingWidthM } = input;
    if (ring.length < 3 || !(workingWidthM > 0) || !Number.isFinite(workingWidthM)) {
        return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    const span = Math.max(maxX - minX, maxY - minY, workingWidthM);
    if (!Number.isFinite(span) || span <= 0) {
        return null;
    }
    let cellM = Math.max(workingWidthM / 6, span / 160);
    let cols = Math.max(1, Math.ceil((maxX - minX) / cellM));
    let rows = Math.max(1, Math.ceil((maxY - minY) / cellM));
    if (cols * rows > 40_000) {
        cellM = Math.sqrt(((maxX - minX) * (maxY - minY)) / 40_000);
        cols = Math.max(1, Math.ceil((maxX - minX) / cellM));
        rows = Math.max(1, Math.ceil((maxY - minY) / cellM));
    }
    const field = new Uint8Array(cols * rows);
    let fieldCells = 0;
    for (let row = 0; row < rows; row += 1) {
        const y = minY + (row + 0.5) * cellM;
        for (let col = 0; col < cols; col += 1) {
            const x = minX + (col + 0.5) * cellM;
            if (pointInPolygon(x, y, ring)) {
                field[row * cols + col] = 1;
                fieldCells += 1;
            }
        }
    }
    if (fieldCells === 0) {
        return null;
    }
    const hits = new Uint8Array(cols * rows);
    const radius = workingWidthM / 2;
    const radiusCells = Math.max(1, Math.ceil(radius / cellM));
    const radius2 = radius * radius;
    const stamp = (x: number, y: number) => {
        const cx = Math.floor((x - minX) / cellM);
        const cy = Math.floor((y - minY) / cellM);
        for (let dy = -radiusCells; dy <= radiusCells; dy += 1) {
            const iy = cy + dy;
            if (iy < 0 || iy >= rows) {
                continue;
            }
            for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
                const ix = cx + dx;
                if (ix < 0 || ix >= cols) {
                    continue;
                }
                const px = minX + (ix + 0.5) * cellM;
                const py = minY + (iy + 0.5) * cellM;
                const dist2 = (px - x) * (px - x) + (py - y) * (py - y);
                if (dist2 > radius2) {
                    continue;
                }
                const index = iy * cols + ix;
                if (!field[index]) {
                    continue;
                }
                const current = hits[index] ?? 0;
                hits[index] = current >= 255 ? 255 : current + 1;
            }
        }
    };
    for (const segment of segments) {
        const dx = segment.x1 - segment.x0;
        const dy = segment.y1 - segment.y0;
        const length = Math.hypot(dx, dy);
        const steps = Math.max(1, Math.ceil(length / cellM));
        for (let step = 0; step <= steps; step += 1) {
            const t = step / steps;
            stamp(segment.x0 + dx * t, segment.y0 + dy * t);
        }
    }
    let coveredCells = 0;
    let overlapCells = 0;
    for (let index = 0; index < field.length; index += 1) {
        if (!field[index]) {
            continue;
        }
        const count = hits[index] ?? 0;
        if (count >= 1) {
            coveredCells += 1;
        }
        if (count >= 2) {
            overlapCells += 1;
        }
    }
    const gapCells = fieldCells - coveredCells;
    const ratio = (value: number) => (100 * value) / fieldCells;
    return {
        cellM,
        fieldCells,
        coveredCells,
        overlapCells,
        gapCells,
        coveragePct: ratio(coveredCells),
        overlapPct: ratio(overlapCells),
        gapPct: ratio(gapCells),
    };
}
