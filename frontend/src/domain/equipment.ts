/** Digital twin of a vehicle–implement pair (lot L7a). Pure geometry, no DOM. */

export type Kinematics = 'skid_steer' | 'ackermann';
export type ImplementKind = 'tool' | 'trailer';
export type HitchMode = 'mounted' | 'trailed';
export type FieldSource = 'oem' | 'modified' | 'local';

/** Default drawbar length when a trailed implement has none set. */
export const DEFAULT_DRAWBAR_M = 1.5;

export interface Aabb {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface VehicleTwin {
    id: string;
    name: string;
    kinematics: Kinematics;
    length_m: number;
    width_m: number;
    height_m: number | null;
    wheelbase_m: number | null;
    track_width_m: number | null;
    front_overhang_m: number | null;
    rear_overhang_m: number | null;
    mass_kg: number | null;
    max_speed_mps: number | null;
    min_turn_radius_m: number | null;
    can_reverse: boolean;
    nav_ref_x_m: number;
    nav_ref_y_m: number;
    hitch_x_m: number | null;
    hitch_y_m: number;
    ground_clearance_m: number | null;
    sources: Record<string, FieldSource>;
    origin: FieldSource;
}

export interface ImplementTwin {
    id: string;
    name: string;
    kind: ImplementKind;
    physical_width_m: number;
    working_width_m: number;
    length_m: number;
    offset_x_m: number;
    offset_y_m: number;
    work_point_x_m: number;
    work_point_y_m: number;
    /** Hitch-to-axle length. Used when `kind === 'trailer'`. */
    drawbar_length_m: number | null;
    sections: number | null;
    sources: Record<string, FieldSource>;
    origin: FieldSource;
}

export interface CombinationTwin {
    id: string;
    name: string;
    vehicle_id: string;
    implement_id: string | null;
    origin: FieldSource;
}

export interface CombinationEnvelope {
    vehicle: Aabb;
    implement: Aabb | null;
    collision: Aabb;
    hitch: { x: number; y: number } | null;
    axle: { x: number; y: number } | null;
    workPoint: { x: number; y: number } | null;
    navRef: { x: number; y: number };
    hitchMode: HitchMode | null;
    sweptRadiusM: number;
    trailerSwingRadiusM: number | null;
    minTurnRadiusM: number;
    kinematics: Kinematics;
}

export interface SrbcEquipmentMetadata {
    vehicle: {
        id: string;
        length_m: number;
        width_m: number;
        kinematics: Kinematics;
    };
    implement: {
        id: string;
        kind: 'tool';
        width_m: number;
    } | null;
    trailer: {
        id: string;
        kind: 'trailer';
        width_m: number;
        hitch: { x: number; y: number };
        drawbar_length_m: number;
    } | null;
}

const KINEMATICS: readonly Kinematics[] = ['skid_steer', 'ackermann'];
const IMPLEMENT_KINDS: readonly ImplementKind[] = ['tool', 'trailer'];

export function isKinematics(value: string): value is Kinematics {
    return (KINEMATICS as readonly string[]).includes(value);
}

export function isImplementKind(value: string): value is ImplementKind {
    return (IMPLEMENT_KINDS as readonly string[]).includes(value);
}

export function fieldSource(
    sources: Record<string, FieldSource> | undefined,
    origin: FieldSource,
    key: string,
): FieldSource {
    return sources?.[key] ?? origin;
}

function aabb(minX: number, minY: number, maxX: number, maxY: number): Aabb {
    return { minX, minY, maxX, maxY };
}

function unionAabb(left: Aabb, right: Aabb): Aabb {
    return aabb(
        Math.min(left.minX, right.minX),
        Math.min(left.minY, right.minY),
        Math.max(left.maxX, right.maxX),
        Math.max(left.maxY, right.maxY),
    );
}

function farthestCornerRadius(box: Aabb, originX: number, originY: number): number {
    const xs = [box.minX, box.maxX];
    const ys = [box.minY, box.maxY];
    let radius = 0;
    for (const x of xs) {
        for (const y of ys) {
            const dx = x - originX;
            const dy = y - originY;
            radius = Math.max(radius, Math.hypot(dx, dy));
        }
    }
    return radius;
}

/** Vehicle footprint in the nav frame (+x forward, +y left). Nav ref is the origin. */
export function vehicleAabb(vehicle: VehicleTwin): Aabb {
    const halfL = vehicle.length_m / 2;
    const halfW = vehicle.width_m / 2;
    return aabb(
        vehicle.nav_ref_x_m - halfL,
        vehicle.nav_ref_y_m - halfW,
        vehicle.nav_ref_x_m + halfL,
        vehicle.nav_ref_y_m + halfW,
    );
}

export function hitchPoint(vehicle: VehicleTwin): { x: number; y: number } | null {
    if (vehicle.hitch_x_m === null) {
        return null;
    }
    return { x: vehicle.hitch_x_m, y: vehicle.hitch_y_m };
}

export function isTrailed(implement: ImplementTwin): boolean {
    return implement.kind === 'trailer';
}

export function hitchModeOf(implement: ImplementTwin | null): HitchMode | null {
    if (!implement) {
        return null;
    }
    return isTrailed(implement) ? 'trailed' : 'mounted';
}

export function drawbarLengthM(implement: ImplementTwin): number {
    if (!isTrailed(implement)) {
        return 0;
    }
    const length = implement.drawbar_length_m;
    return length !== null && length > 0 ? length : DEFAULT_DRAWBAR_M;
}

export function implementAabb(
    vehicle: VehicleTwin,
    implement: ImplementTwin,
): {
    box: Aabb;
    hitch: { x: number; y: number };
    axle: { x: number; y: number };
    workPoint: { x: number; y: number };
} {
    const hitch = hitchPoint(vehicle) ?? { x: -vehicle.length_m / 2, y: 0 };
    const along = isTrailed(implement) ? -drawbarLengthM(implement) : 0;
    const axle = { x: hitch.x + along, y: hitch.y };
    const centerX = axle.x + implement.offset_x_m;
    const centerY = axle.y + implement.offset_y_m;
    const halfL = implement.length_m / 2;
    const halfW = implement.physical_width_m / 2;
    return {
        box: aabb(centerX - halfL, centerY - halfW, centerX + halfL, centerY + halfW),
        hitch,
        axle,
        workPoint: {
            x: axle.x + implement.work_point_x_m,
            y: axle.y + implement.work_point_y_m,
        },
    };
}

export function minTurnRadiusM(vehicle: VehicleTwin): number {
    if (vehicle.kinematics === 'skid_steer') {
        return 0;
    }
    if (vehicle.min_turn_radius_m !== null && Number.isFinite(vehicle.min_turn_radius_m)) {
        return Math.max(0, vehicle.min_turn_radius_m);
    }
    if (vehicle.wheelbase_m !== null && vehicle.wheelbase_m > 0) {
        return vehicle.wheelbase_m;
    }
    return vehicle.length_m;
}

export function combinationEnvelope(
    vehicle: VehicleTwin,
    implement: ImplementTwin | null,
): CombinationEnvelope {
    const vehicleBox = vehicleAabb(vehicle);
    const attached = implement === null ? null : implementAabb(vehicle, implement);
    const collision = attached ? unionAabb(vehicleBox, attached.box) : vehicleBox;
    const originX = vehicle.nav_ref_x_m;
    const originY = vehicle.nav_ref_y_m;
    const vehicleSwept = farthestCornerRadius(vehicleBox, originX, originY);
    const hitch = attached?.hitch ?? hitchPoint(vehicle);
    const trailed = implement !== null && isTrailed(implement);
    const trailerSwing =
        attached && trailed && hitch ? farthestCornerRadius(attached.box, hitch.x, hitch.y) : null;
    let swept = vehicleSwept;
    if (attached && !trailed) {
        swept = Math.max(swept, farthestCornerRadius(attached.box, originX, originY));
    }
    if (hitch && trailerSwing !== null) {
        swept = Math.max(swept, Math.hypot(hitch.x - originX, hitch.y - originY) + trailerSwing);
    }
    return {
        vehicle: vehicleBox,
        implement: attached?.box ?? null,
        collision,
        hitch,
        axle: attached?.axle ?? null,
        workPoint: attached?.workPoint ?? null,
        navRef: { x: originX, y: originY },
        hitchMode: hitchModeOf(implement),
        sweptRadiusM: swept,
        trailerSwingRadiusM: trailerSwing,
        minTurnRadiusM: minTurnRadiusM(vehicle),
        kinematics: vehicle.kinematics,
    };
}

/** Snapshot stored in Agri `metadata.srbc_equipment` (v3 unchanged). */
export function projectSrbcEquipment(
    vehicle: VehicleTwin,
    implement: ImplementTwin | null,
): SrbcEquipmentMetadata {
    return {
        vehicle: {
            id: vehicle.id,
            length_m: vehicle.length_m,
            width_m: vehicle.width_m,
            kinematics: vehicle.kinematics,
        },
        implement:
            implement && implement.kind === 'tool'
                ? {
                      id: implement.id,
                      kind: 'tool',
                      width_m: implement.working_width_m,
                  }
                : null,
        trailer:
            implement && implement.kind === 'trailer'
                ? {
                      id: implement.id,
                      kind: 'trailer',
                      width_m: implement.working_width_m,
                      hitch: hitchPoint(vehicle) ?? { x: -vehicle.length_m / 2, y: 0 },
                      drawbar_length_m: drawbarLengthM(implement),
                  }
                : null,
    };
}

export function collisionWidthM(envelope: CombinationEnvelope): number {
    return envelope.collision.maxY - envelope.collision.minY;
}

export function collisionLengthM(envelope: CombinationEnvelope): number {
    return envelope.collision.maxX - envelope.collision.minX;
}

/** Extra metres between the collision hull and the parcel (used as geofence). */
export const GEOFENCE_SAFETY_M = 0.15;

/**
 * How far the nav reference must stay inside the parcel so the chassis +
 * implement AABB does not cross the boundary. Worst heading of a 90° pivot:
 * toward the edge (front) or along it (half width). Rear overhang is ignored:
 * the tool sits behind the nav ref when arriving at a headland.
 */
export function geofenceMarginM(envelope: CombinationEnvelope): number {
    const { collision, navRef } = envelope;
    const forward = Math.max(0, collision.maxX - navRef.x);
    const halfWidth = Math.max(
        Math.abs(collision.maxY - navRef.y),
        Math.abs(navRef.y - collision.minY),
    );
    return Math.max(forward, halfWidth) + GEOFENCE_SAFETY_M;
}
