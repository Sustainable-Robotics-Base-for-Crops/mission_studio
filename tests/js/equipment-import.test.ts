import { describe, expect, it } from 'vitest';

import {
    EQUIPMENT_SCHEMA,
    equipmentFileToImplement,
    equipmentFileToVehicle,
    parseEquipmentFile,
    pngMatchesEquipmentIcon,
    toEquipmentFile,
} from '../../frontend/src/equipment/import-format';

const IMPLEMENT = {
    schema: EQUIPMENT_SCHEMA,
    kind: 'implement',
    id: 'bineuse-180',
    name: 'Bineuse 180',
    manufacturer: 'Exemple SAS',
    hitch_mode: 'mounted',
    length_m: 1.2,
    width_m: 1.8,
    working_width_m: 1.65,
    drawbar_length_m: null,
    mass_kg: 210,
    icon: 'bineuse-180.png',
} as const;

const VEHICLE = {
    schema: EQUIPMENT_SCHEMA,
    kind: 'vehicle',
    id: 'srbc-1',
    name: 'SRBC',
    manufacturer: 'SABI AGRI',
    kinematics: 'skid_steer',
    hitch_mode: null,
    length_m: 1.1,
    width_m: 0.6,
    working_width_m: null,
    drawbar_length_m: null,
    mass_kg: 180,
    icon: 'srbc-1.png',
} as const;

describe('srbc.equipment/1', () => {
    it('accepts a valid implement file from the CdC example', () => {
        const result = parseEquipmentFile(IMPLEMENT);
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.file.id).toBe('bineuse-180');
        expect(result.file.hitch_mode).toBe('mounted');
        expect(result.file.working_width_m).toBe(1.65);
    });

    it('names the missing field instead of a generic parse error', () => {
        const result = parseEquipmentFile({ ...IMPLEMENT, name: '' });
        expect(result.ok).toBe(false);
        if (result.ok) {
            return;
        }
        const problem = result.problems.find((item) => item.field === 'name');
        expect(problem).toBeTruthy();
        expect(problem?.message).toContain('name');
        expect(problem?.message.toLowerCase()).not.toContain('parse error');
        expect(result.problems.some((item) => item.message.includes('name'))).toBe(true);
    });

    it('round-trips a vehicle through parse then export without loss', () => {
        const parsed = parseEquipmentFile(VEHICLE);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) {
            return;
        }
        const twin = equipmentFileToVehicle(parsed.file);
        const exported = toEquipmentFile(twin, {
            manufacturer: parsed.file.manufacturer,
            icon: parsed.file.icon,
        });
        expect(exported).toEqual(parsed.file);
        const again = parseEquipmentFile(exported);
        expect(again).toEqual(parsed);
    });

    it('projects onto VehicleTwin and ImplementTwin', () => {
        const vehicleParsed = parseEquipmentFile(VEHICLE);
        const implementParsed = parseEquipmentFile(IMPLEMENT);
        expect(vehicleParsed.ok && implementParsed.ok).toBe(true);
        if (!vehicleParsed.ok || !implementParsed.ok) {
            return;
        }
        const vehicle = equipmentFileToVehicle(vehicleParsed.file);
        expect(vehicle.kinematics).toBe('skid_steer');
        expect(vehicle.length_m).toBe(1.1);
        expect(vehicle.width_m).toBe(0.6);
        expect(vehicle.mass_kg).toBe(180);
        expect(vehicle.origin).toBe('local');
        const implement = equipmentFileToImplement(implementParsed.file);
        expect(implement.kind).toBe('tool');
        expect(implement.physical_width_m).toBe(1.8);
        expect(implement.working_width_m).toBe(1.65);
        expect(implement.length_m).toBe(1.2);
        expect(implement.origin).toBe('local');
    });

    it('pairs an optional PNG with the JSON stem or the icon field', () => {
        expect(pngMatchesEquipmentIcon('bineuse-180.json', 'bineuse-180.png', null)).toBe(true);
        expect(pngMatchesEquipmentIcon('outil.json', 'bineuse-180.png', 'bineuse-180.png')).toBe(
            true,
        );
        expect(pngMatchesEquipmentIcon('outil.json', 'autre.png', 'bineuse-180.png')).toBe(false);
    });
});
