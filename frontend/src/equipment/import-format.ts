/**
 * Farm-folder equipment file format `srbc.equipment/1` (CdC §2.6).
 * One file = one vehicle or one implement. Combinations stay in the UI.
 */

import {
    isImplementKind,
    isKinematics,
    type HitchMode,
    type ImplementTwin,
    type Kinematics,
    type VehicleTwin,
} from '../domain/equipment';

export const EQUIPMENT_SCHEMA = 'srbc.equipment/1';

export type EquipmentFileKind = 'vehicle' | 'implement';

export type EquipmentIssueCode =
    | 'not_object'
    | 'invalid_schema'
    | 'invalid_kind'
    | 'missing'
    | 'invalid_number'
    | 'invalid_enum';

export interface EquipmentIssue {
    field: string;
    code: EquipmentIssueCode;
    /** Human-readable: says what to fix, never a generic "parse error". */
    message: string;
}

export interface EquipmentFile {
    schema: typeof EQUIPMENT_SCHEMA;
    kind: EquipmentFileKind;
    id: string;
    name: string;
    manufacturer: string | null;
    kinematics: Kinematics | null;
    hitch_mode: HitchMode | null;
    length_m: number;
    width_m: number;
    working_width_m: number | null;
    drawbar_length_m: number | null;
    mass_kg: number | null;
    icon: string | null;
}

export type EquipmentParseResult =
    { ok: true; file: EquipmentFile } | { ok: false; problems: EquipmentIssue[] };

function issue(field: string, code: EquipmentIssueCode, message: string): EquipmentIssue {
    return { field, code, message };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function requiredString(
    record: Record<string, unknown>,
    field: string,
    problems: EquipmentIssue[],
): string | null {
    const raw = record[field];
    if (typeof raw !== 'string' || !raw.trim()) {
        problems.push(
            issue(
                field,
                'missing',
                `Missing required field « ${field} » — add a non-empty string.`,
            ),
        );
        return null;
    }
    return raw.trim();
}

function requiredPositive(
    record: Record<string, unknown>,
    field: string,
    problems: EquipmentIssue[],
): number | null {
    if (!(field in record) || record[field] === null || record[field] === undefined) {
        problems.push(
            issue(
                field,
                'missing',
                `Missing required field « ${field} » — add a strictly positive number in metres.`,
            ),
        );
        return null;
    }
    const value = Number(record[field]);
    if (!Number.isFinite(value) || value <= 0) {
        problems.push(
            issue(
                field,
                'invalid_number',
                `Field « ${field} » must be a strictly positive number in metres (got ${String(record[field])}).`,
            ),
        );
        return null;
    }
    return value;
}

function optionalNumber(
    record: Record<string, unknown>,
    field: string,
    problems: EquipmentIssue[],
): number | null {
    if (!(field in record) || record[field] === null) {
        return null;
    }
    const value = Number(record[field]);
    if (!Number.isFinite(value) || value < 0) {
        problems.push(
            issue(
                field,
                'invalid_number',
                `Field « ${field} » must be a number ≥ 0, or null (got ${String(record[field])}).`,
            ),
        );
        return null;
    }
    return value;
}

function optionalString(record: Record<string, unknown>, field: string): string | null {
    const raw = record[field];
    if (typeof raw !== 'string' || !raw.trim()) {
        return null;
    }
    return raw.trim();
}

export function parseEquipmentFile(raw: unknown): EquipmentParseResult {
    const record = asRecord(raw);
    if (!record) {
        return {
            ok: false,
            problems: [
                issue(
                    '',
                    'not_object',
                    'The file must be a JSON object, not an array or a primitive.',
                ),
            ],
        };
    }
    const problems: EquipmentIssue[] = [];
    if (record.schema !== EQUIPMENT_SCHEMA) {
        problems.push(
            issue(
                'schema',
                'invalid_schema',
                `Field « schema » must be "${EQUIPMENT_SCHEMA}" (got ${JSON.stringify(record.schema)}).`,
            ),
        );
    }
    const kindRaw = record.kind;
    if (kindRaw !== 'vehicle' && kindRaw !== 'implement') {
        problems.push(
            issue(
                'kind',
                'invalid_kind',
                'Field « kind » must be "vehicle" or "implement" — combinations are built in the software, not in files.',
            ),
        );
    }
    const id = requiredString(record, 'id', problems);
    const name = requiredString(record, 'name', problems);
    const lengthM = requiredPositive(record, 'length_m', problems);
    const widthM = requiredPositive(record, 'width_m', problems);
    const massKg = optionalNumber(record, 'mass_kg', problems);
    const drawbar = optionalNumber(record, 'drawbar_length_m', problems);
    let kinematics: Kinematics | null = null;
    let hitchMode: HitchMode | null = null;
    let workingWidth: number | null = null;
    if (kindRaw === 'vehicle') {
        const kine = record.kinematics;
        if (typeof kine !== 'string' || !isKinematics(kine)) {
            problems.push(
                issue(
                    'kinematics',
                    'invalid_enum',
                    'Field « kinematics » is required for a vehicle: "skid_steer" or "ackermann".',
                ),
            );
        } else {
            kinematics = kine;
        }
    }
    if (kindRaw === 'implement') {
        const hitch = record.hitch_mode;
        if (hitch !== 'mounted' && hitch !== 'trailed') {
            problems.push(
                issue(
                    'hitch_mode',
                    'invalid_enum',
                    'Field « hitch_mode » is required for an implement: "mounted" or "trailed".',
                ),
            );
        } else {
            hitchMode = hitch;
        }
        workingWidth = requiredPositive(record, 'working_width_m', problems);
        if (hitch === 'trailed' && drawbar === null && record.drawbar_length_m !== null) {
            // optional; trailed defaults later on the twin
        }
    }
    if (problems.length > 0) {
        return { ok: false, problems };
    }
    return {
        ok: true,
        file: {
            schema: EQUIPMENT_SCHEMA,
            kind: kindRaw as EquipmentFileKind,
            id: id as string,
            name: name as string,
            manufacturer: optionalString(record, 'manufacturer'),
            kinematics,
            hitch_mode: hitchMode,
            length_m: lengthM as number,
            width_m: widthM as number,
            working_width_m: workingWidth,
            drawbar_length_m: drawbar,
            mass_kg: massKg,
            icon: optionalString(record, 'icon'),
        },
    };
}

export function toEquipmentFile(
    twin: VehicleTwin | ImplementTwin,
    extras?: { manufacturer?: string | null; icon?: string | null },
): EquipmentFile {
    const manufacturer = extras?.manufacturer ?? null;
    const icon = extras?.icon ?? null;
    if ('kinematics' in twin) {
        return {
            schema: EQUIPMENT_SCHEMA,
            kind: 'vehicle',
            id: twin.id,
            name: twin.name,
            manufacturer,
            kinematics: twin.kinematics,
            hitch_mode: null,
            length_m: twin.length_m,
            width_m: twin.width_m,
            working_width_m: null,
            drawbar_length_m: null,
            mass_kg: twin.mass_kg,
            icon,
        };
    }
    return {
        schema: EQUIPMENT_SCHEMA,
        kind: 'implement',
        id: twin.id,
        name: twin.name,
        manufacturer,
        kinematics: null,
        hitch_mode: twin.kind === 'trailer' ? 'trailed' : 'mounted',
        length_m: twin.length_m,
        width_m: twin.physical_width_m,
        working_width_m: twin.working_width_m,
        drawbar_length_m: twin.drawbar_length_m,
        mass_kg: null,
        icon,
    };
}

export function equipmentFileToVehicle(file: EquipmentFile): VehicleTwin {
    const kinematics =
        file.kinematics && isKinematics(file.kinematics) ? file.kinematics : 'skid_steer';
    return {
        id: file.id,
        name: file.name,
        kinematics,
        length_m: file.length_m,
        width_m: file.width_m,
        height_m: null,
        wheelbase_m: null,
        track_width_m: null,
        front_overhang_m: null,
        rear_overhang_m: null,
        mass_kg: file.mass_kg,
        max_speed_mps: null,
        min_turn_radius_m: null,
        can_reverse: true,
        nav_ref_x_m: 0,
        nav_ref_y_m: 0,
        hitch_x_m: null,
        hitch_y_m: 0,
        ground_clearance_m: null,
        sources: {},
        origin: 'local',
    };
}

export function equipmentFileToImplement(file: EquipmentFile): ImplementTwin {
    const hitch = file.hitch_mode === 'trailed' ? 'trailer' : 'tool';
    const kind = isImplementKind(hitch) ? hitch : 'tool';
    return {
        id: file.id,
        name: file.name,
        kind,
        physical_width_m: file.width_m,
        working_width_m: file.working_width_m ?? file.width_m,
        length_m: file.length_m,
        offset_x_m: 0,
        offset_y_m: 0,
        work_point_x_m: 0,
        work_point_y_m: 0,
        drawbar_length_m:
            kind === 'trailer' ? (file.drawbar_length_m ?? 1.5) : file.drawbar_length_m,
        sections: null,
        sources: {},
        origin: 'local',
    };
}

export function pngMatchesEquipmentIcon(
    jsonFileName: string,
    pngFileName: string,
    icon: string | null,
): boolean {
    const jsonStem = jsonFileName.replace(/\.json$/i, '');
    const pngStem = pngFileName.replace(/\.png$/i, '');
    if (pngStem === jsonStem) {
        return true;
    }
    if (icon && (pngFileName === icon || pngStem === icon.replace(/\.png$/i, ''))) {
        return true;
    }
    return false;
}

export type ManualVehicleDraft = {
    name: string;
    kinematics: Kinematics;
    length_m: number;
    width_m: number;
    mass_kg: number | null;
};

export type ManualImplementDraft = {
    name: string;
    hitch_mode: HitchMode;
    length_m: number;
    width_m: number;
    working_width_m: number;
    drawbar_length_m: number | null;
};

export type ManualCombinationDraft = {
    name: string;
    vehicle_id: string;
    implement_id: string | null;
};
