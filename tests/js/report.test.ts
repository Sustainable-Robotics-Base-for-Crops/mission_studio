import { describe, expect, it } from 'vitest';

import type { AgriDocument } from '../../frontend/src/domain/agri';
import {
    buildMissionReports,
    compareKpis,
    kpisFromStoredSimulation,
    splitDurations,
} from '../../frontend/src/domain/report';
import type { SimulationReport } from '../../frontend/src/domain/simulation';

function doc(rows: AgriDocument['points']): AgriDocument {
    return {
        version: '3',
        origin: { type: 'WGS84', coordinates: { lat: 45.85, lon: 3.17 } },
        points: rows,
        geofencing: {
            columns: ['x', 'y'],
            values: [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
            ],
        },
    };
}

const WORK: AgriDocument['points'][number] = {
    section_type: 'row_line',
    columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
    values: [
        [0, 0, 1, 1, {}],
        [10, 0, 1, 1, {}],
    ],
};

const TURN: AgriDocument['points'][number] = {
    section_type: 'turn_path',
    columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
    values: [
        [10, 0, 0.5, 0, {}],
        [10, 2, 0.5, 0, {}],
    ],
};

describe('splitDurations', () => {
    it('splits work, turns and headland/transit', () => {
        const split = splitDurations(doc([WORK, TURN]));
        expect(split.length_m).toBeCloseTo(12, 5);
        expect(split.work_s).toBeCloseTo(10, 5);
        expect(split.maneuver_s).toBeCloseTo(4, 5);
        expect(split.transit_s).toBe(0);
    });
});

describe('buildMissionReports', () => {
    const sim = {
        length_m: 12,
        duration_s: 14,
        coverage: {
            cellM: 1,
            fieldCells: 100,
            coveredCells: 80,
            overlapCells: 5,
            gapCells: 20,
            coveragePct: 80,
            overlapPct: 5,
            gapPct: 20,
        },
        checks: [
            {
                id: 'coverage.overlap',
                group: 'coverage',
                status: 'warn',
                measured: 5,
                threshold: 20,
                sampleIndex: 3,
                at: { x: 1, y: 2 },
            },
            {
                id: 'collisions.geofence',
                group: 'collisions',
                status: 'pass',
                measured: 1,
                threshold: 0.15,
                sampleIndex: null,
                at: null,
            },
        ],
        samples: [],
        minMarginM: 1,
        sweptHull: [],
        passCount: 4,
        warnCount: 1,
        blockCount: 0,
    } as unknown as SimulationReport;

    it('builds planned KPIs from the live sim and keeps executed empty', () => {
        const reports = buildMissionReports({
            document: doc([WORK, TURN]),
            sim,
            authorized: null,
        });
        expect(reports.planned.available).toBe(true);
        expect(reports.planned.kpis.gapPct).toBe(20);
        expect(reports.planned.kpis.coveragePct).toBe(80);
        expect(reports.planned.anomalies).toEqual([
            { id: 'coverage.overlap', status: 'warn', sampleIndex: 3 },
        ]);
        expect(reports.planned.kpis.wait_s).toBeNull();
        expect(reports.planned.kpis.dose).toBeNull();
        expect(reports.executed.available).toBe(false);
        expect(reports.executed.reason).toBe('no_runtime');
        expect(reports.authorized.reason).toBe('no_publication');
        expect(reports.comparison.available).toBe(false);
    });

    it('compares planned vs authorised when a publication exists', () => {
        const reports = buildMissionReports({
            document: doc([WORK]),
            sim,
            authorized: {
                version: 2,
                simulation: {
                    length_m: 10,
                    coveragePct: 90,
                    gapPct: 10,
                    overlapPct: 4,
                    work_s: 8,
                },
            },
        });
        expect(reports.authorized.available).toBe(true);
        expect(reports.authorized.version).toBe(2);
        expect(reports.comparison.available).toBe(true);
        expect(reports.comparison.kpis.gapPct).toBe(10);
        expect(reports.comparison.kpis.length_m).toBe(2);
    });
});

describe('kpisFromStoredSimulation', () => {
    it('reads nested coverage from older packets', () => {
        expect(
            kpisFromStoredSimulation({
                length_m: 42,
                coverage: { coveragePct: 70, gapPct: 30 },
            }),
        ).toMatchObject({ length_m: 42, coveragePct: 70, gapPct: 30 });
    });
});

describe('compareKpis', () => {
    it('returns null when either side is missing', () => {
        const left = kpisFromStoredSimulation({ length_m: 10, gapPct: 8 });
        const right = kpisFromStoredSimulation({ length_m: 10 });
        expect(compareKpis(left, right).gapPct).toBeNull();
        expect(compareKpis(left, right).length_m).toBe(0);
    });
});
