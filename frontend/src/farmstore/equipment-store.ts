/**
 * Equipment of the open farm (D13-07, D15-06, D15-07), browser side.
 *
 * Two catalogues, shown as one:
 * - the standard library shipped with the software (`frontend/src/equipment/library/`),
 *   read-only, never copied into a farm, always the latest version;
 * - the farm's own items, one folder each: `equipment/<id>/equipment.json`
 *   (`srbc.equipment/2`, images added later next to it).
 *
 * Changing a standard item writes a small override in the farm (`base: "srbc:<id>"`
 * plus the changed keys only), so a software update still reaches the other keys.
 * Combinations reference items as `srbc:<id>` (library) or `farm:<id>` (this farm).
 */

import {
    DEFAULT_DRAWBAR_M,
    type CombinationTwin,
    type FieldSource,
    type ImplementKind,
    type ImplementTwin,
    type Kinematics,
    type VehicleTwin,
} from '../domain/equipment';
import { defaultOddProfile, parseOddProfile } from '../domain/odd';
import { CatalogueError, NotFoundError } from './field-catalogue';
import { joinFarmPath, readJsonObject, writeJson, type FarmDirectory } from './fs';
import { slugify } from './layout';

export const EQUIPMENT_SCHEMA_V2 = 'srbc.equipment/2';
export const LIBRARY_PREFIX = 'srbc:';
export const FARM_PREFIX = 'farm:';
const EQUIPMENT_DIR = 'equipment';
const EQUIPMENT_FILE = 'equipment.json';

type Json = Record<string, unknown>;
export type EquipmentKind = 'vehicle' | 'implement' | 'combination';

const KINEMATICS: readonly Kinematics[] = ['skid_steer', 'ackermann'];
const IMPLEMENT_KINDS: readonly ImplementKind[] = ['tool', 'trailer'];

const VEHICLE_NUMBERS = [
    'length_m',
    'width_m',
    'height_m',
    'wheelbase_m',
    'track_width_m',
    'front_overhang_m',
    'rear_overhang_m',
    'mass_kg',
    'max_speed_mps',
    'min_turn_radius_m',
    'nav_ref_x_m',
    'nav_ref_y_m',
    'hitch_x_m',
    'hitch_y_m',
    'ground_clearance_m',
] as const;

const IMPLEMENT_NUMBERS = [
    'physical_width_m',
    'working_width_m',
    'length_m',
    'offset_x_m',
    'offset_y_m',
    'work_point_x_m',
    'work_point_y_m',
    'drawbar_length_m',
    'sections',
] as const;

/** Keys a vehicle file may carry (besides schema / kind / id). */
const VEHICLE_KEYS = ['name', 'kinematics', 'can_reverse', ...VEHICLE_NUMBERS] as const;
const IMPLEMENT_KEYS = ['name', 'implement_kind', ...IMPLEMENT_NUMBERS] as const;
const COMBINATION_KEYS = ['name', 'vehicle', 'implement', 'odd'] as const;

function has(record: Json, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function optionalFloat(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new CatalogueError('expected a number');
    }
    return number;
}

function requiredPositive(value: unknown, name: string): number {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new CatalogueError(`${name} must be > 0`);
    }
    return number;
}

function numberOr(value: unknown, fallback: number): number {
    const number = optionalFloat(value);
    return number === null ? fallback : number;
}

// -- standard library -------------------------------------------------------------

const LIBRARY_FILES = import.meta.glob('../equipment/library/*/equipment.json', {
    eager: true,
    import: 'default',
}) as Record<string, Json>;

export function libraryItems(): Json[] {
    return Object.values(LIBRARY_FILES).filter(
        (item) => item.schema === EQUIPMENT_SCHEMA_V2 && typeof item.id === 'string',
    );
}

// -- file → twin -------------------------------------------------------------------

function vehicleFrom(file: Json, origin: FieldSource, sources: Record<string, FieldSource>) {
    const kinematics = KINEMATICS.includes(file.kinematics as Kinematics)
        ? (file.kinematics as Kinematics)
        : 'skid_steer';
    return {
        id: String(file.id),
        name: String(file.name ?? file.id),
        kinematics,
        length_m: numberOr(file.length_m, 1),
        width_m: numberOr(file.width_m, 1),
        height_m: optionalFloat(file.height_m),
        wheelbase_m: optionalFloat(file.wheelbase_m),
        track_width_m: optionalFloat(file.track_width_m),
        front_overhang_m: optionalFloat(file.front_overhang_m),
        rear_overhang_m: optionalFloat(file.rear_overhang_m),
        mass_kg: optionalFloat(file.mass_kg),
        max_speed_mps: optionalFloat(file.max_speed_mps),
        min_turn_radius_m: optionalFloat(file.min_turn_radius_m),
        can_reverse: file.can_reverse !== false,
        nav_ref_x_m: numberOr(file.nav_ref_x_m, 0),
        nav_ref_y_m: numberOr(file.nav_ref_y_m, 0),
        hitch_x_m: optionalFloat(file.hitch_x_m),
        hitch_y_m: numberOr(file.hitch_y_m, 0),
        ground_clearance_m: optionalFloat(file.ground_clearance_m),
        sources,
        origin,
    } satisfies VehicleTwin;
}

function implementFrom(file: Json, origin: FieldSource, sources: Record<string, FieldSource>) {
    const kind = IMPLEMENT_KINDS.includes(file.implement_kind as ImplementKind)
        ? (file.implement_kind as ImplementKind)
        : 'tool';
    const sections = optionalFloat(file.sections);
    return {
        id: String(file.id),
        name: String(file.name ?? file.id),
        kind,
        physical_width_m: numberOr(file.physical_width_m, 1),
        working_width_m: numberOr(file.working_width_m, numberOr(file.physical_width_m, 1)),
        length_m: numberOr(file.length_m, 0),
        offset_x_m: numberOr(file.offset_x_m, 0),
        offset_y_m: numberOr(file.offset_y_m, 0),
        work_point_x_m: numberOr(file.work_point_x_m, 0),
        work_point_y_m: numberOr(file.work_point_y_m, 0),
        drawbar_length_m:
            optionalFloat(file.drawbar_length_m) ?? (kind === 'trailer' ? DEFAULT_DRAWBAR_M : null),
        sections: sections === null ? null : Math.trunc(sections),
        sources,
        origin,
    } satisfies ImplementTwin;
}

function stripRef(ref: unknown): string | null {
    if (typeof ref !== 'string' || !ref) {
        return null;
    }
    if (ref.startsWith(LIBRARY_PREFIX)) {
        return ref.slice(LIBRARY_PREFIX.length);
    }
    if (ref.startsWith(FARM_PREFIX)) {
        return ref.slice(FARM_PREFIX.length);
    }
    return ref;
}

function combinationFrom(file: Json, origin: FieldSource): CombinationTwin {
    return {
        id: String(file.id),
        name: String(file.name ?? file.id),
        vehicle_id: stripRef(file.vehicle) ?? '',
        implement_id: stripRef(file.implement),
        origin,
        odd: parseOddProfile(file.odd),
    };
}

// -- store --------------------------------------------------------------------------

interface Item {
    kind: EquipmentKind;
    /** Resolved document (library merged with the farm override, if any). */
    file: Json;
    origin: FieldSource;
    sources: Record<string, FieldSource>;
    /** True when the standard library provides the item. */
    standard: boolean;
    /** Keys stored in the farm override of a standard item. */
    override: Json | null;
}

export interface EquipmentCatalogueSnapshot {
    vehicles: VehicleTwin[];
    implements: ImplementTwin[];
    combinations: CombinationTwin[];
}

function fileKind(file: Json): EquipmentKind | null {
    const kind = file.kind;
    return kind === 'vehicle' || kind === 'implement' || kind === 'combination' ? kind : null;
}

export class EquipmentStore {
    private readonly items = new Map<string, Item>();

    constructor(
        private readonly dir: FarmDirectory,
        private readonly library: () => Json[] = libraryItems,
    ) {}

    async load(): Promise<{ errors: Array<{ path: string; reason: string }> }> {
        this.items.clear();
        const errors: Array<{ path: string; reason: string }> = [];
        for (const standard of this.library()) {
            const kind = fileKind(standard);
            if (kind) {
                this.items.set(String(standard.id), {
                    kind,
                    file: { ...standard },
                    origin: 'oem',
                    sources: {},
                    standard: true,
                    override: null,
                });
            }
        }
        for (const entry of await this.dir.list(EQUIPMENT_DIR)) {
            if (entry.kind !== 'directory' || entry.name.startsWith('.')) {
                continue;
            }
            const path = joinFarmPath(EQUIPMENT_DIR, entry.name, EQUIPMENT_FILE);
            const file = await readJsonObject(this.dir, path);
            if (!file || file.schema !== EQUIPMENT_SCHEMA_V2) {
                errors.push({ path, reason: 'not a srbc.equipment/2 file' });
                continue;
            }
            const base = stripRef(file.base);
            const standard = base ? this.items.get(base) : undefined;
            if (base && standard?.standard) {
                this.applyOverride(standard, file);
                continue;
            }
            const kind = fileKind(file);
            const id = typeof file.id === 'string' ? file.id : entry.name;
            if (!kind || this.items.get(id)?.standard) {
                errors.push({ path, reason: 'unknown kind or id taken by the standard library' });
                continue;
            }
            this.items.set(id, {
                kind,
                file: { ...file, id },
                origin: 'local',
                sources: {},
                standard: false,
                override: null,
            });
        }
        return { errors };
    }

    private applyOverride(item: Item, override: Json): void {
        const keys = this.keysOf(item.kind).filter((key) => has(override, key));
        const kept: Json = {};
        for (const key of keys) {
            kept[key] = override[key];
            item.file[key] = override[key];
            item.sources[key === 'implement_kind' ? 'kind' : key] = 'modified';
        }
        item.override = kept;
    }

    private keysOf(kind: EquipmentKind): readonly string[] {
        return kind === 'vehicle'
            ? VEHICLE_KEYS
            : kind === 'implement'
              ? IMPLEMENT_KEYS
              : COMBINATION_KEYS;
    }

    // -- reads ----------------------------------------------------------------------

    private twin(item: Item): VehicleTwin | ImplementTwin | CombinationTwin {
        if (item.kind === 'vehicle') {
            return vehicleFrom(item.file, item.origin, { ...item.sources });
        }
        if (item.kind === 'implement') {
            return implementFrom(item.file, item.origin, { ...item.sources });
        }
        return combinationFrom(item.file, item.origin);
    }

    private byKind<T>(kind: EquipmentKind): T[] {
        return [...this.items.values()]
            .filter((item) => item.kind === kind)
            .map((item) => this.twin(item) as T)
            .sort((a, b) =>
                String((a as { name: string }).name).localeCompare(
                    String((b as { name: string }).name),
                    undefined,
                    { sensitivity: 'base' },
                ),
            );
    }

    catalogue(): EquipmentCatalogueSnapshot {
        return {
            vehicles: this.byKind<VehicleTwin>('vehicle'),
            implements: this.byKind<ImplementTwin>('implement'),
            combinations: this.byKind<CombinationTwin>('combination'),
        };
    }

    private item(id: string, kind: EquipmentKind): Item {
        const item = this.items.get(id);
        if (!item || item.kind !== kind) {
            throw new NotFoundError(`${kind} not found`);
        }
        return item;
    }

    // -- writes -----------------------------------------------------------------------

    private folderFor(id: string): string {
        return joinFarmPath(EQUIPMENT_DIR, id);
    }

    private async save(id: string, item: Item): Promise<void> {
        const path = joinFarmPath(this.folderFor(id), EQUIPMENT_FILE);
        if (item.standard) {
            await writeJson(this.dir, path, {
                schema: EQUIPMENT_SCHEMA_V2,
                kind: item.kind,
                id,
                base: `${LIBRARY_PREFIX}${id}`,
                ...(item.override ?? {}),
            });
            return;
        }
        await writeJson(this.dir, path, item.file);
    }

    private newId(requested: unknown, name: string): string {
        const safe =
            typeof requested === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(requested)
                ? requested
                : slugify(name, 'materiel');
        let candidate = safe;
        for (let index = 2; this.items.has(candidate); index += 1) {
            candidate = `${safe}-${index}`;
        }
        return candidate;
    }

    private ref(id: string): string {
        return this.items.get(id)?.standard ? `${LIBRARY_PREFIX}${id}` : `${FARM_PREFIX}${id}`;
    }

    /** Apply a patch; standard items record the changed keys as a farm override. */
    private async patch(item: Item, id: string, next: Json): Promise<void> {
        const keys = this.keysOf(item.kind);
        if (item.standard) {
            const override: Json = { ...(item.override ?? {}) };
            for (const key of keys) {
                if (!has(next, key)) {
                    continue;
                }
                if (JSON.stringify(item.file[key]) === JSON.stringify(next[key])) {
                    continue;
                }
                override[key] = next[key];
                item.file[key] = next[key];
                item.sources[key === 'implement_kind' ? 'kind' : key] = 'modified';
            }
            item.override = override;
        } else {
            for (const key of keys) {
                if (has(next, key)) {
                    item.file[key] = next[key];
                }
            }
        }
        await this.save(id, item);
    }

    async createVehicle(payload: Json): Promise<VehicleTwin> {
        const name = String(payload.name ?? '').trim();
        if (!name) {
            throw new CatalogueError('name is required');
        }
        const kinematics = String(payload.kinematics ?? 'skid_steer');
        if (!KINEMATICS.includes(kinematics as Kinematics)) {
            throw new CatalogueError('kinematics must be skid_steer or ackermann');
        }
        const id = this.newId(payload.id, name);
        const file: Json = {
            schema: EQUIPMENT_SCHEMA_V2,
            kind: 'vehicle',
            id,
            name,
            kinematics,
            length_m: requiredPositive(payload.length_m, 'length_m'),
            width_m: requiredPositive(payload.width_m, 'width_m'),
            can_reverse: payload.can_reverse !== false,
            visual: null,
        };
        for (const key of VEHICLE_NUMBERS) {
            if (key !== 'length_m' && key !== 'width_m' && has(payload, key)) {
                file[key] = optionalFloat(payload[key]);
            }
        }
        const item: Item = {
            kind: 'vehicle',
            file,
            origin: 'local',
            sources: {},
            standard: false,
            override: null,
        };
        this.items.set(id, item);
        await this.save(id, item);
        return this.twin(item) as VehicleTwin;
    }

    async patchVehicle(id: string, payload: Json): Promise<VehicleTwin> {
        const item = this.item(id, 'vehicle');
        const next: Json = {};
        if (has(payload, 'name') && String(payload.name).trim()) {
            next.name = String(payload.name).trim();
        }
        if (has(payload, 'kinematics')) {
            if (!KINEMATICS.includes(String(payload.kinematics) as Kinematics)) {
                throw new CatalogueError('kinematics must be skid_steer or ackermann');
            }
            next.kinematics = payload.kinematics;
        }
        if (has(payload, 'can_reverse')) {
            next.can_reverse = Boolean(payload.can_reverse);
        }
        for (const key of VEHICLE_NUMBERS) {
            if (!has(payload, key)) {
                continue;
            }
            next[key] =
                key === 'length_m' || key === 'width_m'
                    ? requiredPositive(payload[key], key)
                    : optionalFloat(payload[key]);
        }
        await this.patch(item, id, next);
        return this.twin(item) as VehicleTwin;
    }

    private usedBy(id: string, key: 'vehicle_id' | 'implement_id'): boolean {
        return this.catalogue().combinations.some((combination) => combination[key] === id);
    }

    private async removeFarmItem(id: string, kind: EquipmentKind): Promise<boolean> {
        const item = this.items.get(id);
        if (!item || item.kind !== kind) {
            return false;
        }
        if (item.standard) {
            throw new CatalogueError('OEM profiles cannot be deleted');
        }
        this.items.delete(id);
        await this.dir.remove(this.folderFor(id));
        return true;
    }

    async deleteVehicle(id: string): Promise<boolean> {
        if (this.items.get(id)?.kind === 'vehicle' && !this.items.get(id)?.standard) {
            if (this.usedBy(id, 'vehicle_id')) {
                throw new CatalogueError('vehicle is used by a combination');
            }
        }
        return this.removeFarmItem(id, 'vehicle');
    }

    async createImplement(payload: Json): Promise<ImplementTwin> {
        const name = String(payload.name ?? '').trim();
        if (!name) {
            throw new CatalogueError('name is required');
        }
        const kind = String(payload.kind ?? 'tool');
        if (!IMPLEMENT_KINDS.includes(kind as ImplementKind)) {
            throw new CatalogueError('kind must be tool or trailer');
        }
        const id = this.newId(payload.id, name);
        const physical = requiredPositive(payload.physical_width_m, 'physical_width_m');
        const drawbar = optionalFloat(payload.drawbar_length_m);
        const sections = optionalFloat(payload.sections);
        const file: Json = {
            schema: EQUIPMENT_SCHEMA_V2,
            kind: 'implement',
            id,
            name,
            implement_kind: kind,
            physical_width_m: physical,
            working_width_m: requiredPositive(
                payload.working_width_m ?? payload.physical_width_m,
                'working_width_m',
            ),
            length_m: numberOr(payload.length_m, 0),
            offset_x_m: numberOr(payload.offset_x_m, 0),
            offset_y_m: numberOr(payload.offset_y_m, 0),
            work_point_x_m: numberOr(payload.work_point_x_m, 0),
            work_point_y_m: numberOr(payload.work_point_y_m, 0),
            drawbar_length_m: kind === 'trailer' && drawbar === null ? DEFAULT_DRAWBAR_M : drawbar,
            sections: sections === null ? null : Math.trunc(sections),
            visual: null,
        };
        const item: Item = {
            kind: 'implement',
            file,
            origin: 'local',
            sources: {},
            standard: false,
            override: null,
        };
        this.items.set(id, item);
        await this.save(id, item);
        return this.twin(item) as ImplementTwin;
    }

    async patchImplement(id: string, payload: Json): Promise<ImplementTwin> {
        const item = this.item(id, 'implement');
        const next: Json = {};
        if (has(payload, 'name') && String(payload.name).trim()) {
            next.name = String(payload.name).trim();
        }
        if (has(payload, 'kind')) {
            if (!IMPLEMENT_KINDS.includes(String(payload.kind) as ImplementKind)) {
                throw new CatalogueError('kind must be tool or trailer');
            }
            next.implement_kind = payload.kind;
        }
        for (const key of IMPLEMENT_NUMBERS) {
            if (!has(payload, key)) {
                continue;
            }
            if (key === 'physical_width_m' || key === 'working_width_m') {
                next[key] = requiredPositive(payload[key], key);
            } else if (key === 'sections') {
                const value = optionalFloat(payload[key]);
                next[key] = value === null ? null : Math.trunc(value);
            } else if (key === 'drawbar_length_m') {
                next[key] = optionalFloat(payload[key]);
            } else {
                next[key] = numberOr(payload[key], 0);
            }
        }
        const kind = (next.implement_kind ?? item.file.implement_kind) as string;
        const drawbar = has(next, 'drawbar_length_m')
            ? next.drawbar_length_m
            : item.file.drawbar_length_m;
        if (kind === 'trailer' && !drawbar) {
            next.drawbar_length_m = DEFAULT_DRAWBAR_M;
        }
        await this.patch(item, id, next);
        return this.twin(item) as ImplementTwin;
    }

    async deleteImplement(id: string): Promise<boolean> {
        if (this.items.get(id)?.kind === 'implement' && !this.items.get(id)?.standard) {
            if (this.usedBy(id, 'implement_id')) {
                throw new CatalogueError('implement is used by a combination');
            }
        }
        return this.removeFarmItem(id, 'implement');
    }

    private requireKind(id: string, kind: 'vehicle' | 'implement', label: string): void {
        if (this.items.get(id)?.kind !== kind) {
            throw new CatalogueError(`${label} not found`);
        }
    }

    async createCombination(payload: Json): Promise<CombinationTwin> {
        const name = String(payload.name ?? '').trim();
        const vehicleId = String(payload.vehicle_id ?? '').trim();
        if (!name || !vehicleId) {
            throw new CatalogueError('name and vehicle_id are required');
        }
        this.requireKind(vehicleId, 'vehicle', 'vehicle');
        const implementId = payload.implement_id ? String(payload.implement_id) : null;
        if (implementId) {
            this.requireKind(implementId, 'implement', 'implement');
        }
        const id = this.newId(payload.id, name);
        const file: Json = {
            schema: EQUIPMENT_SCHEMA_V2,
            kind: 'combination',
            id,
            name,
            vehicle: this.ref(vehicleId),
            implement: implementId ? this.ref(implementId) : null,
            odd: parseOddProfile(payload.odd ?? defaultOddProfile()),
        };
        const item: Item = {
            kind: 'combination',
            file,
            origin: 'local',
            sources: {},
            standard: false,
            override: null,
        };
        this.items.set(id, item);
        await this.save(id, item);
        return this.twin(item) as CombinationTwin;
    }

    async patchCombination(id: string, payload: Json): Promise<CombinationTwin> {
        const item = this.item(id, 'combination');
        const next: Json = {};
        if (has(payload, 'name') && String(payload.name).trim()) {
            next.name = String(payload.name).trim();
        }
        if (has(payload, 'vehicle_id')) {
            const vehicleId = String(payload.vehicle_id);
            this.requireKind(vehicleId, 'vehicle', 'vehicle');
            next.vehicle = this.ref(vehicleId);
        }
        if (has(payload, 'implement_id')) {
            const implementId = payload.implement_id ? String(payload.implement_id) : null;
            if (implementId) {
                this.requireKind(implementId, 'implement', 'implement');
            }
            next.implement = implementId ? this.ref(implementId) : null;
        }
        if (has(payload, 'odd')) {
            next.odd = parseOddProfile(payload.odd);
        }
        await this.patch(item, id, next);
        return this.twin(item) as CombinationTwin;
    }

    async deleteCombination(id: string): Promise<boolean> {
        return this.removeFarmItem(id, 'combination');
    }
}
