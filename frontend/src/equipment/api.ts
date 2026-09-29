/**
 * Equipment of the open farm (L7a, L15a): the standard library shipped with the
 * software plus the farm's own `equipment/` folder. No server round trip.
 */

import type {
    CombinationTwin,
    FieldSource,
    ImplementKind,
    ImplementTwin,
    Kinematics,
    VehicleTwin,
} from '../domain/equipment';
import { currentSession, requireSession } from '../farmstore/session';

function store() {
    return requireSession().equipment;
}

export async function fetchEquipmentHealth(): Promise<boolean> {
    return currentSession() !== null;
}

export async function fetchCatalogue(): Promise<{
    vehicles: VehicleTwin[];
    implements: ImplementTwin[];
    combinations: CombinationTwin[];
}> {
    return store().catalogue();
}

export async function patchVehicle(
    id: string,
    payload: Record<string, unknown>,
): Promise<VehicleTwin> {
    return store().patchVehicle(id, payload);
}

export async function createVehicle(payload: {
    id?: string;
    name: string;
    kinematics?: Kinematics;
    length_m: number;
    width_m: number;
    mass_kg?: number | null;
}): Promise<VehicleTwin> {
    return store().createVehicle(payload);
}

export async function deleteVehicle(id: string): Promise<void> {
    await store().deleteVehicle(id);
}

export async function patchImplement(
    id: string,
    payload: Record<string, unknown>,
): Promise<ImplementTwin> {
    return store().patchImplement(id, payload);
}

export async function createImplement(payload: {
    id?: string;
    name: string;
    kind?: ImplementKind;
    physical_width_m: number;
    working_width_m: number;
    length_m?: number;
    drawbar_length_m?: number | null;
}): Promise<ImplementTwin> {
    return store().createImplement(payload);
}

export async function deleteImplement(id: string): Promise<void> {
    await store().deleteImplement(id);
}

export async function patchCombination(
    id: string,
    payload: Record<string, unknown>,
): Promise<CombinationTwin> {
    return store().patchCombination(id, payload);
}

export async function createCombination(payload: {
    name: string;
    vehicle_id: string;
    implement_id?: string | null;
}): Promise<CombinationTwin> {
    return store().createCombination(payload);
}

export async function deleteCombination(id: string): Promise<void> {
    await store().deleteCombination(id);
}

export type { FieldSource };
