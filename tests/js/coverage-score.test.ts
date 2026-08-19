import { describe, expect, it } from 'vitest';

import type { AgriDocument } from '../../frontend/src/domain/agri';
import {
    gradeCoverageGap,
    scoreCoverage,
    workSegmentsFromDocument,
} from '../../frontend/src/domain/coverage-score';
import { simulateMission } from '../../frontend/src/domain/simulation';

function fieldDoc(rows: number[][], geofence: number[][]): AgriDocument {
    return {
        version: '3',
        origin: { type: 'WGS84', coordinates: { lat: 45.85, lon: 3.17 } },
        points: rows.map((pair) => ({
            section_type: 'row_line',
            columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
            values: [
                [pair[0], pair[1], 0.5, 1, {}],
                [pair[2], pair[3], 0.5, 1, {}],
            ],
        })),
        geofencing: { columns: ['x', 'y'], values: geofence },
    };
}

const SQUARE: number[][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
];

describe('scoreCoverage', () => {
    it('scores a tight parallel fill with little gap', () => {
        const rows: number[][] = [];
        for (let y = 0.6; y <= 9.4; y += 1.2) {
            rows.push([0.6, y, 9.4, y]);
        }
        const document = fieldDoc(rows, SQUARE);
        const score = scoreCoverage({
            ring: SQUARE as [number, number][],
            segments: workSegmentsFromDocument(document),
            workingWidthM: 1.2,
        });
        expect(score).not.toBeNull();
        expect(score?.gapPct).toBeLessThan(8);
        expect(gradeCoverageGap(score?.gapPct ?? 100)).toBe('pass');
    });

    it('records a large gap without blocking (partial coverage is a valid plan)', () => {
        const document = fieldDoc([[1, 5, 9, 5]], SQUARE);
        const score = scoreCoverage({
            ring: SQUARE as [number, number][],
            segments: workSegmentsFromDocument(document),
            workingWidthM: 1.2,
        });
        expect(score?.gapPct).toBeGreaterThan(25);
        expect(gradeCoverageGap(score?.gapPct ?? 0)).toBe('pass');
    });

    it('detects overlap when two wide passes sit on top of each other', () => {
        const document = fieldDoc(
            [
                [1, 5, 9, 5],
                [1, 5.15, 9, 5.15],
            ],
            SQUARE,
        );
        const score = scoreCoverage({
            ring: SQUARE as [number, number][],
            segments: workSegmentsFromDocument(document),
            workingWidthM: 2,
        });
        expect(score?.overlapPct).toBeGreaterThan(8);
    });

    it('skips turn sections', () => {
        const document: AgriDocument = {
            points: [
                {
                    section_type: 'turn_path',
                    columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
                    values: [
                        [0, 0, 0.5, 0, {}],
                        [4, 0, 0.5, 0, {}],
                    ],
                },
            ],
        };
        expect(workSegmentsFromDocument(document)).toEqual([]);
    });
});

describe('simulateMission coverage checks', () => {
    it('skips coverage when no working width is provided', () => {
        const report = simulateMission({
            document: fieldDoc([[1, 5, 9, 5]], SQUARE),
            envelope: null,
        });
        const gap = report.checks.find((check) => check.id === 'coverage.gap');
        expect(gap?.status).toBe('skip');
        expect(report.coverage).toBeNull();
    });

    it('records gap percent when a working width is set', () => {
        const report = simulateMission({
            document: fieldDoc([[1, 5, 9, 5]], SQUARE),
            envelope: null,
            workingWidthM: 1.2,
            sampleM: 1,
        });
        const gap = report.checks.find((check) => check.id === 'coverage.gap');
        expect(gap?.status).toBe('pass');
        expect(report.coverage?.gapPct).toBeGreaterThan(25);
        expect(report.blockCount).toBe(0);
    });
});
