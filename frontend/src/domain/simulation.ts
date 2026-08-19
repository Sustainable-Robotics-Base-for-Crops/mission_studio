/** Browser kinematic simulation (lot L10a). Pure geometry, no DOM, no Agri mutation. */

import type { AgriDocument, AgriSection } from './agri';
import type { Aabb, CombinationEnvelope } from './equipment';
import { GEOFENCE_SAFETY_M } from './equipment';
import { pointInPolygon, type LocalXy, type Wgs84Origin, localToLngLat } from './geometry';
import { evaluateOddChecks, oddFingerprint, type OddContext } from './odd';
import {
    COVERAGE_OVERLAP_WARN_PCT,
    gradeCoverageGap,
    gradeCoverageOverlap,
    scoreCoverage,
    workSegmentsFromDocument,
    type CoverageScore,
} from './coverage-score';

export const SIMULATION_SAMPLE_M = 0.5;
export const SIMULATION_MAX_SAMPLES = 4000;

export const CHECK_GROUPS = [
    'kinematics',
    'collisions',
    'coverage',
    'limits',
    'odd',
    'resources',
    'tool',
    'comms',
    'fleet',
    'incidents',
] as const;

export type CheckGroup = (typeof CHECK_GROUPS)[number];
export type CheckStatus = 'pass' | 'warn' | 'block' | 'skip';

export interface SimulationCheck {
    id: string;
    group: CheckGroup;
    status: CheckStatus;
    measured: string | number | null;
    threshold: string | number | null;
    sampleIndex: number | null;
    at: LocalXy | null;
    source?: string | null;
    freshness?: 'declared' | 'missing' | null;
}

export interface PoseSample {
    s: number;
    t: number;
    x: number;
    y: number;
    heading: number;
    speed: number;
    curvature: number;
    sectionIndex: number;
}

/** Last sample whose timestamp is ≤ `t`, clamped to the path. */
export function playbackIndexAtTime(samples: readonly PoseSample[], t: number): number {
    if (samples.length === 0) {
        return 0;
    }
    let lo = 0;
    let hi = samples.length - 1;
    let result = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const sample = samples[mid];
        if (!sample) {
            break;
        }
        if (sample.t <= t) {
            result = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return result;
}

export interface SimulationReport {
    samples: PoseSample[];
    length_m: number;
    duration_s: number;
    minMarginM: number | null;
    sweptHull: LocalXy[];
    coverage: CoverageScore | null;
    checks: SimulationCheck[];
    passCount: number;
    warnCount: number;
    blockCount: number;
}

export interface SimulateMissionInput {
    document: AgriDocument | null | undefined;
    envelope: CombinationEnvelope | null;
    maxSpeedMps?: number | null;
    sampleM?: number;
    workingWidthM?: number | null;
    /** Omit to skip ODD (unit tests). Pass an object from Studio (L10c). */
    odd?: OddContext | null;
}

interface PathVertex {
    x: number;
    y: number;
    speed: number;
    sectionIndex: number;
}

function columnIndex(columns: unknown, name: string): number {
    return Array.isArray(columns) ? columns.indexOf(name) : -1;
}

function wrapPi(angle: number): number {
    let value = angle;
    while (value > Math.PI) {
        value -= 2 * Math.PI;
    }
    while (value < -Math.PI) {
        value += 2 * Math.PI;
    }
    return value;
}

export function geofenceRing(document: AgriDocument | null | undefined): [number, number][] {
    const geofencing = document?.geofencing;
    if (geofencing === null || typeof geofencing !== 'object') {
        return [];
    }
    const section = geofencing as AgriSection;
    const xIndex = columnIndex(section.columns, 'x');
    const yIndex = columnIndex(section.columns, 'y');
    if (xIndex < 0 || yIndex < 0 || !Array.isArray(section.values)) {
        return [];
    }
    const ring: [number, number][] = [];
    for (const row of section.values) {
        const x = Number(row[xIndex]);
        const y = Number(row[yIndex]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
        }
        ring.push([x, y]);
    }
    return ring.length >= 3 ? ring : [];
}

function pathVertices(document: AgriDocument): PathVertex[] {
    const vertices: PathVertex[] = [];
    document.points.forEach((section, sectionIndex) => {
        const xIndex = columnIndex(section.columns, 'x');
        const yIndex = columnIndex(section.columns, 'y');
        const speedIndex = columnIndex(section.columns, 'speed');
        if (xIndex < 0 || yIndex < 0 || !Array.isArray(section.values)) {
            return;
        }
        for (const row of section.values) {
            const x = Number(row[xIndex]);
            const y = Number(row[yIndex]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                continue;
            }
            const speed = speedIndex >= 0 ? Number(row[speedIndex]) : 0.5;
            const last = vertices[vertices.length - 1];
            if (last && last.x === x && last.y === y) {
                continue;
            }
            vertices.push({
                x,
                y,
                speed: Number.isFinite(speed) && speed > 0 ? speed : 0.5,
                sectionIndex,
            });
        }
    });
    return vertices;
}

function samplePath(vertices: PathVertex[], sampleM: number): PoseSample[] {
    if (vertices.length === 0) {
        return [];
    }
    const first = vertices[0];
    if (!first) {
        return [];
    }
    const samples: PoseSample[] = [
        {
            s: 0,
            t: 0,
            x: first.x,
            y: first.y,
            heading: 0,
            speed: first.speed,
            curvature: 0,
            sectionIndex: first.sectionIndex,
        },
    ];
    if (vertices.length === 1) {
        return samples;
    }
    const step = Math.max(sampleM, 0.05);
    let distance = 0;
    let time = 0;
    let nextAt = step;
    const push = (
        s: number,
        t: number,
        x: number,
        y: number,
        heading: number,
        speed: number,
        sectionIndex: number,
        ds: number,
    ) => {
        const prev = samples[samples.length - 1];
        const dHeading = prev ? wrapPi(heading - prev.heading) : 0;
        const curvature = ds > 0.05 ? dHeading / ds : (prev?.curvature ?? 0);
        samples.push({ s, t, x, y, heading, speed, curvature, sectionIndex });
    };
    for (let index = 1; index < vertices.length; index += 1) {
        const start = vertices[index - 1];
        const end = vertices[index];
        if (!start || !end) {
            continue;
        }
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (length < 1e-6) {
            continue;
        }
        const heading = Math.atan2(dy, dx);
        if (samples.length === 1) {
            const origin = samples[0];
            if (origin) {
                origin.heading = heading;
            }
        }
        while (nextAt <= distance + length + 1e-9) {
            const along = nextAt - distance;
            const ratio = along / length;
            const ds = nextAt - (samples[samples.length - 1]?.s ?? 0);
            time += ds / start.speed;
            push(
                nextAt,
                time,
                start.x + dx * ratio,
                start.y + dy * ratio,
                heading,
                start.speed,
                end.sectionIndex,
                ds,
            );
            nextAt += step;
        }
        const dsEnd = distance + length - (samples[samples.length - 1]?.s ?? 0);
        distance += length;
        time += dsEnd / start.speed;
        push(distance, time, end.x, end.y, heading, end.speed, end.sectionIndex, dsEnd);
    }
    return samples;
}

export function aabbCorners(box: Aabb): LocalXy[] {
    return [
        { x: box.minX, y: box.minY },
        { x: box.minX, y: box.maxY },
        { x: box.maxX, y: box.maxY },
        { x: box.maxX, y: box.minY },
    ];
}

export function bodyToWorld(
    point: LocalXy,
    pose: { x: number; y: number; heading: number },
    navRef: LocalXy,
): LocalXy {
    const bodyX = point.x - navRef.x;
    const bodyY = point.y - navRef.y;
    const cos = Math.cos(pose.heading);
    const sin = Math.sin(pose.heading);
    return {
        x: pose.x + cos * bodyX - sin * bodyY,
        y: pose.y + sin * bodyX + cos * bodyY,
    };
}

function aabbRingWorld(
    box: Aabb,
    pose: { x: number; y: number; heading: number },
    navRef: LocalXy,
): LocalXy[] {
    const corners = aabbCorners(box).map((corner) => bodyToWorld(corner, pose, navRef));
    const first = corners[0];
    return first ? [...corners, first] : [];
}

/** Vehicle and implement rectangles in the world frame at a pose (same heading; rigid hitch). */
export function poseFootprintRings(
    envelope: CombinationEnvelope,
    pose: { x: number; y: number; heading: number },
): { kind: 'vehicle' | 'implement'; ring: LocalXy[] }[] {
    const rings: { kind: 'vehicle' | 'implement'; ring: LocalXy[] }[] = [
        { kind: 'vehicle', ring: aabbRingWorld(envelope.vehicle, pose, envelope.navRef) },
    ];
    if (envelope.implement) {
        rings.push({
            kind: 'implement',
            ring: aabbRingWorld(envelope.implement, pose, envelope.navRef),
        });
    }
    return rings;
}

function cross(origin: LocalXy, a: LocalXy, b: LocalXy): number {
    return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

export function convexHull(points: LocalXy[]): LocalXy[] {
    const unique = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
    if (unique.length <= 2) {
        return unique;
    }
    const lower: LocalXy[] = [];
    for (const point of unique) {
        while (
            lower.length >= 2 &&
            cross(lower[lower.length - 2] as LocalXy, lower[lower.length - 1] as LocalXy, point) <=
                0
        ) {
            lower.pop();
        }
        lower.push(point);
    }
    const upper: LocalXy[] = [];
    for (let index = unique.length - 1; index >= 0; index -= 1) {
        const point = unique[index];
        if (!point) {
            continue;
        }
        while (
            upper.length >= 2 &&
            cross(upper[upper.length - 2] as LocalXy, upper[upper.length - 1] as LocalXy, point) <=
                0
        ) {
            upper.pop();
        }
        upper.push(point);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
}

function pointToSegmentDistance(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
): number {
    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    if (length2 === 0) {
        return Math.hypot(px - ax, py - ay);
    }
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function signedDistanceToRing(point: LocalXy, ring: [number, number][]): number {
    if (ring.length < 3) {
        return Number.POSITIVE_INFINITY;
    }
    let min = Number.POSITIVE_INFINITY;
    for (let index = 0; index < ring.length; index += 1) {
        const start = ring[index];
        const end = ring[(index + 1) % ring.length];
        if (!start || !end) {
            continue;
        }
        min = Math.min(
            min,
            pointToSegmentDistance(point.x, point.y, start[0], start[1], end[0], end[1]),
        );
    }
    const inside = pointInPolygon(point.x, point.y, ring);
    return inside ? min : -min;
}

function check(
    partial: Omit<SimulationCheck, 'measured' | 'threshold' | 'sampleIndex' | 'at'> &
        Partial<Pick<SimulationCheck, 'measured' | 'threshold' | 'sampleIndex' | 'at'>>,
): SimulationCheck {
    return {
        measured: null,
        threshold: null,
        sampleIndex: null,
        at: null,
        ...partial,
    };
}

function summarise(
    checks: SimulationCheck[],
    rest: Omit<SimulationReport, 'checks' | 'passCount' | 'warnCount' | 'blockCount'>,
): SimulationReport {
    return {
        ...rest,
        checks,
        passCount: checks.filter((item) => item.status === 'pass').length,
        warnCount: checks.filter((item) => item.status === 'warn').length,
        blockCount: checks.filter((item) => item.status === 'block').length,
    };
}

export function simulateMission(input: SimulateMissionInput): SimulationReport {
    const empty: Omit<SimulationReport, 'checks' | 'passCount' | 'warnCount' | 'blockCount'> = {
        samples: [],
        length_m: 0,
        duration_s: 0,
        minMarginM: null,
        sweptHull: [],
        coverage: null,
    };
    const document = input.document;
    if (!document || document.points.length === 0) {
        return summarise(
            [
                check({
                    id: 'mission.empty',
                    group: 'limits',
                    status: 'block',
                }),
                ...CHECK_GROUPS.filter((group) => group !== 'limits').map((group) =>
                    check({ id: 'pending', group, status: 'skip' }),
                ),
            ],
            empty,
        );
    }
    const vertices = pathVertices(document);
    const lengthHint = vertices.reduce((sum, vertex, index) => {
        const previous = vertices[index - 1];
        return previous ? sum + Math.hypot(vertex.x - previous.x, vertex.y - previous.y) : sum;
    }, 0);
    const requested = input.sampleM ?? SIMULATION_SAMPLE_M;
    const sampleM =
        lengthHint > 0 ? Math.max(requested, lengthHint / SIMULATION_MAX_SAMPLES) : requested;
    const samples = samplePath(vertices, sampleM);
    const length_m = samples[samples.length - 1]?.s ?? 0;
    const duration_s = samples[samples.length - 1]?.t ?? 0;
    const ring = geofenceRing(document);
    const envelope = input.envelope;
    const corners: LocalXy[] = [];
    let minMarginM: number | null = ring.length >= 3 ? Number.POSITIVE_INFINITY : null;
    let firstOutside: { sampleIndex: number; at: LocalXy } | null = null;
    if (envelope) {
        const boxCorners = aabbCorners(envelope.collision);
        for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
            const sample = samples[sampleIndex];
            if (!sample) {
                continue;
            }
            for (const corner of boxCorners) {
                const world = bodyToWorld(corner, sample, envelope.navRef);
                corners.push(world);
                if (ring.length < 3) {
                    continue;
                }
                const signed = signedDistanceToRing(world, ring);
                if (minMarginM !== null) {
                    minMarginM = Math.min(minMarginM, signed);
                }
                if (signed < 0 && firstOutside === null) {
                    firstOutside = { sampleIndex, at: world };
                }
            }
        }
    } else {
        for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
            const sample = samples[sampleIndex];
            if (!sample) {
                continue;
            }
            corners.push({ x: sample.x, y: sample.y });
            if (ring.length < 3) {
                continue;
            }
            const signed = signedDistanceToRing(sample, ring);
            if (minMarginM !== null) {
                minMarginM = Math.min(minMarginM, signed);
            }
            if (signed < 0 && firstOutside === null) {
                firstOutside = { sampleIndex, at: sample };
            }
        }
    }
    const sweptHull = convexHull(corners);
    if (minMarginM !== null && !Number.isFinite(minMarginM)) {
        minMarginM = null;
    }
    const coverageScore = scoreCoverage({
        ring,
        segments: workSegmentsFromDocument(document),
        workingWidthM: input.workingWidthM ?? 0,
    });

    const maxAbsCurvature = samples.reduce(
        (max, sample) => Math.max(max, Math.abs(sample.curvature)),
        0,
    );
    const minRadiusAllowed = envelope?.minTurnRadiusM ?? 0;
    const kinematicsKind = envelope?.kinematics ?? 'skid_steer';
    const tooTight =
        kinematicsKind === 'ackermann' &&
        minRadiusAllowed > 0 &&
        maxAbsCurvature > 1 / minRadiusAllowed + 1e-6;
    const tightSample = tooTight
        ? samples.find((sample) => Math.abs(sample.curvature) > 1 / minRadiusAllowed)
        : undefined;
    const maxSpeed = input.maxSpeedMps;
    const peakSpeed = samples.reduce((max, sample) => Math.max(max, sample.speed), 0);
    const overSpeed =
        maxSpeed != null &&
        Number.isFinite(maxSpeed) &&
        maxSpeed > 0 &&
        peakSpeed > maxSpeed + 1e-6;

    const checks: SimulationCheck[] = [
        check({
            id: tooTight ? 'kinematics.turnRadius' : 'kinematics.turnRadius',
            group: 'kinematics',
            status: kinematicsKind === 'skid_steer' ? 'pass' : tooTight ? 'block' : 'pass',
            measured: maxAbsCurvature > 0 ? 1 / maxAbsCurvature : null,
            threshold: kinematicsKind === 'ackermann' ? minRadiusAllowed : 0,
            sampleIndex: tightSample ? samples.indexOf(tightSample) : null,
            at: tightSample ? { x: tightSample.x, y: tightSample.y } : null,
        }),
        check({
            id: firstOutside ? 'collisions.geofence' : 'collisions.geofence',
            group: 'collisions',
            status: ring.length < 3 ? 'skip' : firstOutside ? 'block' : 'pass',
            measured: minMarginM,
            threshold: GEOFENCE_SAFETY_M,
            sampleIndex: firstOutside?.sampleIndex ?? null,
            at: firstOutside?.at ?? null,
        }),
        check({
            id: 'coverage.gap',
            group: 'coverage',
            status: coverageScore ? gradeCoverageGap(coverageScore.gapPct) : 'skip',
            measured: coverageScore ? Number(coverageScore.gapPct.toFixed(1)) : null,
            threshold: null,
        }),
        check({
            id: 'coverage.overlap',
            group: 'coverage',
            status: coverageScore ? gradeCoverageOverlap(coverageScore.overlapPct) : 'skip',
            measured: coverageScore ? Number(coverageScore.overlapPct.toFixed(1)) : null,
            threshold: COVERAGE_OVERLAP_WARN_PCT,
        }),
        check({
            id: ring.length < 3 ? 'limits.noGeofence' : 'limits.geofence',
            group: 'limits',
            status: ring.length < 3 ? 'block' : 'pass',
            measured: ring.length,
            threshold: 3,
        }),
        ...(input.odd === undefined
            ? [check({ id: 'odd.notModelled', group: 'odd', status: 'skip' })]
            : evaluateOddChecks({
                  context: input.odd ?? {
                      profile: null,
                      fieldQualified: null,
                      declaredSlopePct: null,
                      weatherNote: '',
                      operation: null,
                      autonomyRings: [],
                      forbiddenRings: [],
                  },
                  samples,
              }).map((item) =>
                  check({
                      id: item.id,
                      group: 'odd',
                      status: item.status,
                      measured: item.measured,
                      threshold: item.threshold,
                      sampleIndex: item.sampleIndex,
                      at: item.at,
                      source: item.source,
                      freshness: item.freshness,
                  }),
              )),
        check({ id: 'resources.notModelled', group: 'resources', status: 'skip' }),
        check({
            id: envelope ? 'tool.envelope' : 'tool.missingTwin',
            group: 'tool',
            status: envelope ? 'pass' : 'warn',
        }),
        check({ id: 'comms.notModelled', group: 'comms', status: 'skip' }),
        check({ id: 'fleet.notModelled', group: 'fleet', status: 'skip' }),
        check({ id: 'incidents.notModelled', group: 'incidents', status: 'skip' }),
    ];
    if (overSpeed) {
        checks.push(
            check({
                id: 'kinematics.speed',
                group: 'kinematics',
                status: 'warn',
                measured: peakSpeed,
                threshold: maxSpeed,
            }),
        );
    }
    if (minMarginM !== null && minMarginM >= 0 && minMarginM < GEOFENCE_SAFETY_M && !firstOutside) {
        checks.push(
            check({
                id: 'collisions.margin',
                group: 'collisions',
                status: 'warn',
                measured: minMarginM,
                threshold: GEOFENCE_SAFETY_M,
            }),
        );
    }

    return summarise(checks, {
        samples,
        length_m,
        duration_s,
        minMarginM,
        sweptHull,
        coverage: coverageScore,
    });
}

export function hullToLngLatRing(hull: LocalXy[], origin: Wgs84Origin): [number, number][] {
    if (hull.length < 3) {
        return [];
    }
    const ring = hull.map((point) => localToLngLat(point.x, point.y, origin));
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
        ring.push(first);
    }
    return ring;
}

export function simulationFingerprint(
    document: AgriDocument | null | undefined,
    envelope: CombinationEnvelope | null,
    workingWidthM?: number | null,
    odd?: OddContext | null,
): string {
    if (!document) {
        return 'empty';
    }
    const geo = document.geofencing as AgriSection | undefined;
    return [
        document.points.length,
        document.points.reduce((sum, section) => sum + (section.values?.length ?? 0), 0),
        geo?.values?.length ?? 0,
        envelope?.sweptRadiusM ?? 'none',
        envelope?.collision.maxX ?? 0,
        envelope?.collision.maxY ?? 0,
        envelope?.kinematics ?? '',
        workingWidthM ?? 'none',
        oddFingerprint(odd),
    ].join('#');
}
