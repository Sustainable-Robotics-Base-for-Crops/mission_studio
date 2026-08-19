/** Planned / authorised / executed reports (lot L12a, CdCF UX §8.9). Pure. */

import { getSectionTypeString, isTurnSection, type AgriDocument, type AgriSection } from './agri';
import { distance } from './geometry';
import type { SimulationCheck, SimulationReport } from './simulation';

const DEFAULT_SPEED_MPS = 0.5;

function sectionLengthM(section: AgriSection): number {
    const xIndex = section.columns.indexOf('x');
    const yIndex = section.columns.indexOf('y');
    if (xIndex < 0 || yIndex < 0 || section.values.length < 2) {
        return 0;
    }
    let total = 0;
    for (let index = 1; index < section.values.length; index += 1) {
        const previous = section.values[index - 1];
        const current = section.values[index];
        if (!previous || !current) {
            continue;
        }
        const x0 = Number(previous[xIndex]);
        const y0 = Number(previous[yIndex]);
        const x1 = Number(current[xIndex]);
        const y1 = Number(current[yIndex]);
        if (![x0, y0, x1, y1].every(Number.isFinite)) {
            continue;
        }
        total += distance(x0, y0, x1, y1);
    }
    return total;
}

function sectionMeanSpeedMps(section: AgriSection): number {
    const speedIndex = section.columns.indexOf('speed');
    if (speedIndex < 0) {
        return DEFAULT_SPEED_MPS;
    }
    let sum = 0;
    let count = 0;
    for (const row of section.values) {
        const speed = Number(row[speedIndex]);
        if (speed > 0 && Number.isFinite(speed)) {
            sum += speed;
            count += 1;
        }
    }
    return count > 0 ? sum / count : DEFAULT_SPEED_MPS;
}

export const REPORT_LAYERS = ['planned', 'authorized', 'executed', 'comparison'] as const;
export type ReportLayer = (typeof REPORT_LAYERS)[number];

export const REPORT_KPI_IDS = [
    'coveragePct',
    'gapPct',
    'overlapPct',
    'work_s',
    'maneuver_s',
    'transit_s',
    'wait_s',
    'length_m',
    'dose',
    'energy',
] as const;
export type ReportKpiId = (typeof REPORT_KPI_IDS)[number];

export interface ReportKpis {
    coveragePct: number | null;
    gapPct: number | null;
    overlapPct: number | null;
    work_s: number | null;
    maneuver_s: number | null;
    transit_s: number | null;
    wait_s: number | null;
    length_m: number | null;
    dose: number | null;
    energy: number | null;
}

export interface ReportAnomaly {
    id: string;
    status: 'warn' | 'block';
    sampleIndex: number | null;
}

export type ReportUnavailable = 'no_document' | 'no_publication' | 'no_runtime';

export interface ReportSnapshot {
    layer: ReportLayer;
    available: boolean;
    reason: ReportUnavailable | null;
    kpis: ReportKpis;
    anomalies: ReportAnomaly[];
    version: number | null;
}

export function emptyKpis(): ReportKpis {
    return {
        coveragePct: null,
        gapPct: null,
        overlapPct: null,
        work_s: null,
        maneuver_s: null,
        transit_s: null,
        wait_s: null,
        length_m: null,
        dose: null,
        energy: null,
    };
}

export function splitDurations(document: AgriDocument | null | undefined): {
    work_s: number;
    maneuver_s: number;
    transit_s: number;
    length_m: number;
} {
    let work_s = 0;
    let maneuver_s = 0;
    let transit_s = 0;
    let length_m = 0;
    for (const section of document?.points ?? []) {
        const length = sectionLengthM(section);
        const speed = sectionMeanSpeedMps(section);
        const dt = speed > 0 ? length / speed : 0;
        length_m += length;
        if (isTurnSection(section)) {
            maneuver_s += dt;
        } else if (getSectionTypeString(section) === 'row_line') {
            work_s += dt;
        } else {
            transit_s += dt;
        }
    }
    return { work_s, maneuver_s, transit_s, length_m };
}

function anomaliesFromChecks(checks: readonly SimulationCheck[]): ReportAnomaly[] {
    const anomalies: ReportAnomaly[] = [];
    for (const check of checks) {
        if (check.status !== 'warn' && check.status !== 'block') {
            continue;
        }
        anomalies.push({
            id: check.id,
            status: check.status,
            sampleIndex: check.sampleIndex,
        });
    }
    return anomalies;
}

function kpisFromPlan(
    document: AgriDocument | null | undefined,
    sim: SimulationReport | null,
): ReportKpis {
    const split = splitDurations(document);
    return {
        coveragePct: sim?.coverage ? Number(sim.coverage.coveragePct.toFixed(1)) : null,
        gapPct: sim?.coverage ? Number(sim.coverage.gapPct.toFixed(1)) : null,
        overlapPct: sim?.coverage ? Number(sim.coverage.overlapPct.toFixed(1)) : null,
        work_s: split.work_s,
        maneuver_s: split.maneuver_s,
        transit_s: split.transit_s,
        wait_s: null,
        length_m: sim?.length_m ?? split.length_m,
        dose: null,
        energy: null,
    };
}

function asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

export function kpisFromStoredSimulation(raw: Record<string, unknown> | null): ReportKpis {
    if (!raw) {
        return emptyKpis();
    }
    const nested =
        raw.coverage !== null && typeof raw.coverage === 'object'
            ? (raw.coverage as Record<string, unknown>)
            : {};
    return {
        coveragePct: asNumber(raw.coveragePct) ?? asNumber(nested.coveragePct),
        gapPct: asNumber(raw.gapPct) ?? asNumber(nested.gapPct),
        overlapPct: asNumber(raw.overlapPct) ?? asNumber(nested.overlapPct),
        work_s: asNumber(raw.work_s),
        maneuver_s: asNumber(raw.maneuver_s),
        transit_s: asNumber(raw.transit_s),
        wait_s: null,
        length_m: asNumber(raw.length_m),
        dose: null,
        energy: null,
    };
}

function delta(left: number | null, right: number | null): number | null {
    if (left === null || right === null) {
        return null;
    }
    return Number((left - right).toFixed(2));
}

export function compareKpis(planned: ReportKpis, authorized: ReportKpis): ReportKpis {
    return {
        coveragePct: delta(planned.coveragePct, authorized.coveragePct),
        gapPct: delta(planned.gapPct, authorized.gapPct),
        overlapPct: delta(planned.overlapPct, authorized.overlapPct),
        work_s: delta(planned.work_s, authorized.work_s),
        maneuver_s: delta(planned.maneuver_s, authorized.maneuver_s),
        transit_s: delta(planned.transit_s, authorized.transit_s),
        wait_s: null,
        length_m: delta(planned.length_m, authorized.length_m),
        dose: null,
        energy: null,
    };
}

export function buildMissionReports(input: {
    document: AgriDocument | null | undefined;
    sim: SimulationReport | null;
    authorized: { version: number; simulation: Record<string, unknown> } | null;
}): Record<ReportLayer, ReportSnapshot> {
    const hasDocument = Boolean(input.document && (input.document.points?.length ?? 0) > 0);
    const planned: ReportSnapshot = {
        layer: 'planned',
        available: hasDocument,
        reason: hasDocument ? null : 'no_document',
        kpis: hasDocument ? kpisFromPlan(input.document, input.sim) : emptyKpis(),
        anomalies: input.sim ? anomaliesFromChecks(input.sim.checks) : [],
        version: null,
    };
    const authorized: ReportSnapshot = input.authorized
        ? {
              layer: 'authorized',
              available: true,
              reason: null,
              kpis: kpisFromStoredSimulation(input.authorized.simulation),
              anomalies: [],
              version: input.authorized.version,
          }
        : {
              layer: 'authorized',
              available: false,
              reason: 'no_publication',
              kpis: emptyKpis(),
              anomalies: [],
              version: null,
          };
    const executed: ReportSnapshot = {
        layer: 'executed',
        available: false,
        reason: 'no_runtime',
        kpis: emptyKpis(),
        anomalies: [],
        version: null,
    };
    const comparison: ReportSnapshot = {
        layer: 'comparison',
        available: planned.available && authorized.available,
        reason: !planned.available
            ? 'no_document'
            : !authorized.available
              ? 'no_publication'
              : null,
        kpis:
            planned.available && authorized.available
                ? compareKpis(planned.kpis, authorized.kpis)
                : emptyKpis(),
        anomalies: planned.anomalies,
        version: authorized.version,
    };
    return { planned, authorized, executed, comparison };
}
