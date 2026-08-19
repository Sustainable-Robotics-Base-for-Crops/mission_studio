import { describe, expect, it } from 'vitest';

import {
    combinationEnvelope,
    type ImplementTwin,
    type VehicleTwin,
} from '../../frontend/src/domain/equipment';
import {
    bodyToWorld,
    convexHull,
    geofenceRing,
    playbackIndexAtTime,
    poseFootprintRings,
    simulateMission,
} from '../../frontend/src/domain/simulation';
import { oemOddProfile } from '../../frontend/src/domain/odd';
import type { AgriDocument } from '../../frontend/src/domain/agri';

const SRBC: VehicleTwin = {
    id: 'srbc-001',
    name: 'SRBC',
    kinematics: 'skid_steer',
    length_m: 1.1,
    width_m: 0.6,
    height_m: null,
    wheelbase_m: 1,
    track_width_m: null,
    front_overhang_m: null,
    rear_overhang_m: null,
    mass_kg: 250,
    max_speed_mps: 1,
    min_turn_radius_m: 0,
    can_reverse: true,
    nav_ref_x_m: 0,
    nav_ref_y_m: 0,
    hitch_x_m: -0.55,
    hitch_y_m: 0,
    ground_clearance_m: null,
    sources: {},
    origin: 'oem',
};

const HOE: ImplementTwin = {
    id: 'hoe-120',
    name: 'Binage 1,20 m',
    kind: 'tool',
    physical_width_m: 1.2,
    working_width_m: 1.2,
    length_m: 0.35,
    offset_x_m: -0.4,
    offset_y_m: 0,
    work_point_x_m: -0.4,
    work_point_y_m: 0,
    drawbar_length_m: null,
    sections: null,
    sources: {},
    origin: 'oem',
};

function mission(
    values: number[][],
    geofence?: number[][],
    extras?: Partial<AgriDocument>,
): AgriDocument {
    return {
        version: '3',
        origin: { type: 'WGS84', coordinates: { lat: 45.85, lon: 3.17 } },
        points: [
            {
                section_type: 'row_line',
                columns: ['x', 'y', 'speed', 'working_zone', 'punctual'],
                values: values.map((row) => [...row, 0.5, 1, {}]),
            },
        ],
        geofencing: geofence ? { columns: ['x', 'y'], values: geofence } : undefined,
        ...extras,
    };
}

describe('playbackIndexAtTime', () => {
    const samples = [0, 1, 2.5].map((t) => ({
        s: t,
        t,
        x: t,
        y: 0,
        heading: 0,
        speed: 1,
        curvature: 0,
        sectionIndex: 0,
    }));

    it('stays on the current pose when dt is smaller than the next sample gap', () => {
        expect(playbackIndexAtTime(samples, 0)).toBe(0);
        expect(playbackIndexAtTime(samples, 0.32)).toBe(0);
        expect(playbackIndexAtTime(samples, 1)).toBe(1);
        expect(playbackIndexAtTime(samples, 1.8)).toBe(1);
        expect(playbackIndexAtTime(samples, 9)).toBe(2);
    });
});

describe('poseFootprintRings', () => {
    it('places the implement behind the chassis and rotates both with heading', () => {
        const envelope = combinationEnvelope(SRBC, HOE);
        const along = poseFootprintRings(envelope, { x: 10, y: 20, heading: 0 });
        const vehicle = along.find((item) => item.kind === 'vehicle')?.ring ?? [];
        const tool = along.find((item) => item.kind === 'implement')?.ring ?? [];
        const vehicleMaxX = Math.max(...vehicle.map((point) => point.x));
        const toolMinX = Math.min(...tool.map((point) => point.x));
        expect(toolMinX).toBeLessThan(10);
        expect(vehicleMaxX).toBeGreaterThan(10);
        const width =
            Math.max(...tool.map((point) => point.y)) - Math.min(...tool.map((point) => point.y));
        expect(width).toBeCloseTo(HOE.physical_width_m, 5);

        const turned = poseFootprintRings(envelope, { x: 0, y: 0, heading: Math.PI / 2 });
        const turnedTool = turned.find((item) => item.kind === 'implement')?.ring ?? [];
        const turnedWidth =
            Math.max(...turnedTool.map((point) => point.x)) -
            Math.min(...turnedTool.map((point) => point.x));
        expect(turnedWidth).toBeCloseTo(HOE.physical_width_m, 5);
    });
});

describe('simulation geometry', () => {
    it('builds a convex hull of a square including interior points', () => {
        const hull = convexHull([
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 2 },
            { x: 0, y: 2 },
            { x: 1, y: 1 },
        ]);
        expect(hull).toHaveLength(4);
    });

    it('rotates the body frame so +x is forward along heading', () => {
        const world = bodyToWorld(
            { x: 1, y: 0 },
            { x: 10, y: 20, heading: Math.PI / 2 },
            { x: 0, y: 0 },
        );
        expect(world.x).toBeCloseTo(10);
        expect(world.y).toBeCloseTo(21);
    });
});

describe('simulateMission', () => {
    const envelope = combinationEnvelope(SRBC, HOE);
    const field: number[][] = [
        [0, 0],
        [40, 0],
        [40, 20],
        [0, 20],
    ];

    it('blocks an empty mission', () => {
        const report = simulateMission({
            document: { points: [] },
            envelope,
        });
        expect(report.blockCount).toBeGreaterThan(0);
        expect(report.checks.some((check) => check.id === 'mission.empty')).toBe(true);
    });

    it('blocks a path without a geofence', () => {
        const report = simulateMission({
            document: mission([
                [5, 5],
                [15, 5],
            ]),
            envelope,
        });
        expect(report.checks.some((check) => check.id === 'limits.noGeofence')).toBe(true);
        expect(report.blockCount).toBeGreaterThan(0);
        expect(
            geofenceRing(
                mission([
                    [5, 5],
                    [15, 5],
                ]),
            ),
        ).toEqual([]);
    });

    it('passes a short row well inside a large parcel for a skid-steer SRBC', () => {
        const report = simulateMission({
            document: mission(
                [
                    [10, 10],
                    [30, 10],
                ],
                field,
            ),
            envelope,
            sampleM: 1,
        });
        expect(report.length_m).toBeCloseTo(20, 5);
        expect(report.blockCount).toBe(0);
        expect(report.sweptHull.length).toBeGreaterThanOrEqual(3);
        expect(report.minMarginM).not.toBeNull();
        expect(report.minMarginM as number).toBeGreaterThan(0);
        const kinematics = report.checks.find((check) => check.group === 'kinematics');
        expect(kinematics?.status).toBe('pass');
    });

    it('blocks when the implement envelope crosses the geofence', () => {
        const report = simulateMission({
            document: mission(
                [
                    [1, 10],
                    [2, 10],
                ],
                field,
            ),
            envelope,
            sampleM: 0.5,
        });
        const collision = report.checks.find((check) => check.id === 'collisions.geofence');
        expect(collision?.status).toBe('block');
        expect(report.blockCount).toBeGreaterThan(0);
        expect(collision?.at).not.toBeNull();
    });

    it('evaluates declared ODD instead of skipping when context is passed', () => {
        const report = simulateMission({
            document: mission(
                [
                    [10, 10],
                    [20, 10],
                ],
                field,
            ),
            envelope,
            sampleM: 1,
            odd: {
                profile: oemOddProfile(),
                fieldQualified: true,
                declaredSlopePct: null,
                weatherNote: '',
                operation: 'hoeing',
                autonomyRings: [],
                forbiddenRings: [],
            },
        });
        expect(report.checks.find((check) => check.id === 'odd.approved')?.status).toBe('pass');
        expect(report.checks.find((check) => check.id === 'odd.notModelled')).toBeUndefined();
        expect(report.checks.find((check) => check.id === 'odd.slope')?.status).toBe('skip');
    });

    it('blocks an Ackermann turn tighter than the min radius, not a skid-steer pivot', () => {
        const tight = mission(
            [
                [10, 10],
                [12, 10],
                [12, 12],
            ],
            field,
        );
        const tractor: VehicleTwin = {
            ...SRBC,
            kinematics: 'ackermann',
            min_turn_radius_m: 8,
        };
        const ackermann = simulateMission({
            document: tight,
            envelope: combinationEnvelope(tractor, HOE),
            sampleM: 0.5,
        });
        expect(
            ackermann.checks.some(
                (check) => check.id === 'kinematics.turnRadius' && check.status === 'block',
            ),
        ).toBe(true);
        const skid = simulateMission({
            document: tight,
            envelope,
            sampleM: 0.5,
        });
        expect(skid.checks.find((check) => check.group === 'kinematics')?.status).toBe('pass');
    });
});
