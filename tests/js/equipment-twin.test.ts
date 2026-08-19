import { describe, expect, it } from 'vitest';

import {
    combinationEnvelope,
    fieldSource,
    geofenceMarginM,
    GEOFENCE_SAFETY_M,
    projectSrbcEquipment,
    type ImplementTwin,
    type VehicleTwin,
} from '../../frontend/src/domain/equipment';

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
    sources: { length_m: 'oem', width_m: 'oem' },
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
    sources: { physical_width_m: 'oem', working_width_m: 'oem' },
    origin: 'oem',
};

const TRAILER: ImplementTwin = {
    id: 'trailer-140',
    name: 'Remorque 1,40 m',
    kind: 'trailer',
    physical_width_m: 1.4,
    working_width_m: 1.4,
    length_m: 1.8,
    offset_x_m: 0,
    offset_y_m: 0,
    work_point_x_m: 0,
    work_point_y_m: 0,
    drawbar_length_m: 1.5,
    sections: null,
    sources: { physical_width_m: 'oem', drawbar_length_m: 'oem' },
    origin: 'oem',
};

describe('equipment twin (L7a)', () => {
    it('gives a zero min-turn radius for skid-steer and a pivot swept circle', () => {
        const envelope = combinationEnvelope(SRBC, HOE);
        expect(envelope.minTurnRadiusM).toBe(0);
        expect(envelope.kinematics).toBe('skid_steer');
        expect(envelope.hitchMode).toBe('mounted');
        expect(envelope.collision.maxY - envelope.collision.minY).toBeCloseTo(1.2);
        expect(envelope.sweptRadiusM).toBeGreaterThan(0.55);
        expect(envelope.hitch?.x).toBeCloseTo(-0.55);
        expect(envelope.axle?.x).toBeCloseTo(-0.55);
        expect(envelope.workPoint?.x).toBeCloseTo(-0.95);
        expect(geofenceMarginM(envelope)).toBeCloseTo(0.6 + GEOFENCE_SAFETY_M);
    });

    it('places a trailed implement behind a drawbar hinged at the hitch', () => {
        const envelope = combinationEnvelope(SRBC, TRAILER);
        expect(envelope.hitchMode).toBe('trailed');
        expect(envelope.hitch?.x).toBeCloseTo(-0.55);
        expect(envelope.axle?.x).toBeCloseTo(-2.05);
        expect(envelope.trailerSwingRadiusM).toBeGreaterThan(2);
        expect(envelope.sweptRadiusM).toBeGreaterThan(envelope.trailerSwingRadiusM ?? 0);
        const meta = projectSrbcEquipment(SRBC, TRAILER);
        expect(meta.implement).toBeNull();
        expect(meta.trailer).toEqual({
            id: 'trailer-140',
            kind: 'trailer',
            width_m: 1.4,
            hitch: { x: -0.55, y: 0 },
            drawbar_length_m: 1.5,
        });
    });

    it('projects Agri metadata.srbc_equipment without a v4 schema', () => {
        const meta = projectSrbcEquipment(SRBC, HOE);
        expect(meta.vehicle).toEqual({
            id: 'srbc-001',
            length_m: 1.1,
            width_m: 0.6,
            kinematics: 'skid_steer',
        });
        expect(meta.implement).toEqual({
            id: 'hoe-120',
            kind: 'tool',
            width_m: 1.2,
        });
        expect(meta.trailer).toBeNull();
    });

    it('keeps working width distinct from the physical collision width', () => {
        const narrowWork: ImplementTwin = { ...HOE, working_width_m: 1.0 };
        const meta = projectSrbcEquipment(SRBC, narrowWork);
        const envelope = combinationEnvelope(SRBC, narrowWork);
        expect(meta.implement?.width_m).toBe(1);
        expect(envelope.collision.maxY - envelope.collision.minY).toBeCloseTo(1.2);
    });

    it('badges OEM values until they are locally edited', () => {
        expect(fieldSource(SRBC.sources, 'oem', 'length_m')).toBe('oem');
        expect(fieldSource({ width_m: 'modified' }, 'oem', 'width_m')).toBe('modified');
        expect(fieldSource({}, 'local', 'length_m')).toBe('local');
    });
});
