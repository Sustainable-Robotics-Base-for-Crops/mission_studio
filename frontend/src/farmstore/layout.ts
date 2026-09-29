/**
 * Shape of a farm working folder (L13, CdC technique §2), browser side.
 *
 * Mirrors `backend/farm/layout.py`: the folder is the source of truth and is meant to
 * be byte-identical on the robot.
 *
 *     farm.json · parcel_map/ · mission_order/ · work_performed/ · equipment/ · .studio/
 */

import type { FarmDirectory } from './fs';
import { readJsonObject, writeJson } from './fs';

export const FARM_SCHEMA = 'srbc.farm/1';
export const FARM_FILE = 'farm.json';
export const STUDIO_DIR = '.studio';

export const FARM_DIRS = ['parcel_map', 'mission_order', 'work_performed', 'equipment'] as const;
export type FarmDir = (typeof FARM_DIRS)[number];

export const FARM_TYPES = [
    'market_garden',
    'vineyard',
    'open_field',
    'livestock',
    'mixed',
] as const;
/** Kept in sync with SUPPORTED_LANGUAGES in frontend/src/i18n/adapter.ts. */
export const LANGUAGES = ['fr', 'en', 'it', 'es', 'pl', 'nl', 'de'] as const;
export const THEMES = ['light', 'dark'] as const;
export const UI_MODES = ['basic', 'advanced'] as const;
export const UNITS = ['metric'] as const;

export const DEFAULT_FARM_NAME = 'Ma ferme';
/** Mirrors DEFAULT_CENTER / DEFAULT_ZOOM of frontend/src/map/styles.ts (metropolitan France). */
export const DEFAULT_START_VIEW = { lat: 46.6034, lon: 1.8883, zoom: 6 };

const CROP_PACK_BY_FARM_TYPE: Record<string, string> = {
    market_garden: 'market_garden',
    vineyard: 'vineyard',
    open_field: 'open_field',
    livestock: 'open_field',
    mixed: 'open_field',
};

/** Fields a client may change. `schema`, `created_at` and `updated_at` are owned here. */
export const WRITABLE_KEYS = [
    'name',
    'farm_type',
    'start_view',
    'language',
    'theme',
    'ui_mode',
    'units',
    'field_geofence_inset_cm',
    'speed_color_low_kmh',
    'speed_color_mid_kmh',
    'speed_color_high_kmh',
] as const;

export function nowIso(now = new Date()): string {
    return `${now.toISOString().slice(0, 19)}Z`;
}

export function cropPackFor(farmType: unknown): string {
    return CROP_PACK_BY_FARM_TYPE[String(farmType)] ?? 'open_field';
}

export function defaultFarmJson(name?: string | null, now = new Date()): Record<string, unknown> {
    const stamp = nowIso(now);
    return {
        schema: FARM_SCHEMA,
        name: (name ?? '').trim() || DEFAULT_FARM_NAME,
        farm_type: 'market_garden',
        start_view: { ...DEFAULT_START_VIEW },
        language: 'fr',
        theme: 'light',
        ui_mode: 'basic',
        units: 'metric',
        field_geofence_inset_cm: 25,
        speed_color_low_kmh: 0.5,
        speed_color_mid_kmh: 1.75,
        speed_color_high_kmh: 3.0,
        created_at: stamp,
        updated_at: stamp,
    };
}

function isNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/** Problems of a `farm.json`, empty when valid. Messages say what to fix. */
export function validateFarmJson(data: unknown): string[] {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return ['farm.json must be a JSON object'];
    }
    const record = data as Record<string, unknown>;
    const problems: string[] = [];
    if (record.schema !== FARM_SCHEMA) {
        problems.push(`schema must be '${FARM_SCHEMA}'`);
    }
    if (typeof record.name !== 'string' || !record.name.trim()) {
        problems.push('name must be a non-empty string');
    }
    const enums: Array<[string, readonly string[]]> = [
        ['farm_type', FARM_TYPES],
        ['language', LANGUAGES],
        ['theme', THEMES],
        ['ui_mode', UI_MODES],
        ['units', UNITS],
    ];
    for (const [key, allowed] of enums) {
        if (!allowed.includes(record[key] as string)) {
            problems.push(`${key} must be one of ${allowed.join(', ')}`);
        }
    }
    const view = record.start_view;
    if (view === null || typeof view !== 'object' || Array.isArray(view)) {
        problems.push('start_view must be an object with lat, lon and zoom');
    } else {
        const bounds: Array<[string, number, number]> = [
            ['lat', -90, 90],
            ['lon', -180, 180],
            ['zoom', 0, 24],
        ];
        for (const [key, low, high] of bounds) {
            const value = (view as Record<string, unknown>)[key];
            if (!isNumber(value)) {
                problems.push(`start_view.${key} must be a number`);
            } else if (value < low || value > high) {
                problems.push(`start_view.${key} must be between ${low} and ${high}`);
            }
        }
    }
    const optionalNonNegative = [
        'field_geofence_inset_cm',
        'speed_color_low_kmh',
        'speed_color_mid_kmh',
        'speed_color_high_kmh',
    ];
    for (const key of optionalNonNegative) {
        const value = record[key];
        if (value === undefined || value === null) {
            continue;
        }
        if (!isNumber(value)) {
            problems.push(`${key} must be a number`);
        } else if (value < 0) {
            problems.push(`${key} must be greater than or equal to 0`);
        }
    }
    const { speed_color_low_kmh: low, speed_color_mid_kmh: mid } = record;
    const high = record.speed_color_high_kmh;
    if (isNumber(low) && isNumber(mid) && isNumber(high) && !(low <= mid && mid <= high)) {
        problems.push('speed colour thresholds must satisfy low ≤ mid ≤ high');
    }
    return problems;
}

export async function readFarmJson(dir: FarmDirectory): Promise<Record<string, unknown> | null> {
    return readJsonObject(dir, FARM_FILE);
}

export async function isFarm(dir: FarmDirectory): Promise<boolean> {
    return (await dir.readBytes(FARM_FILE)) !== null;
}

export async function writeFarmJson(
    dir: FarmDirectory,
    data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const problems = validateFarmJson(data);
    if (problems.length) {
        throw new Error(problems.join('; '));
    }
    await writeJson(dir, FARM_FILE, data);
    return data;
}

/** Create the folders and `farm.json` when missing. Never overwrites an existing farm. */
export async function ensureFarm(
    dir: FarmDirectory,
    name?: string | null,
): Promise<Record<string, unknown>> {
    for (const folder of FARM_DIRS) {
        await dir.makeDirectory(folder);
    }
    const existing = (await isFarm(dir)) ? await readFarmJson(dir) : null;
    if (existing) {
        return existing;
    }
    return writeFarmJson(dir, defaultFarmJson(name));
}

/** Merge a client patch into the current farm document. */
export function mergeFarmPatch(
    current: Record<string, unknown>,
    patch: Record<string, unknown>,
    now = new Date(),
): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...current };
    for (const key of WRITABLE_KEYS) {
        if (!(key in patch)) {
            continue;
        }
        const value = patch[key];
        if (key === 'start_view' && value !== null && typeof value === 'object') {
            const view = (current.start_view ?? {}) as Record<string, unknown>;
            merged.start_view = { ...view, ...(value as Record<string, unknown>) };
        } else {
            merged[key] = value;
        }
    }
    merged.schema = current.schema || FARM_SCHEMA;
    merged.created_at = current.created_at || nowIso(now);
    merged.updated_at = nowIso(now);
    return merged;
}

/** `AAAA-MM-JJ_<slug>` tokens: lowercase, hyphens, no accent (CdC §2.3). */
export function slugify(value: string, fallback: string, max = 40): string {
    const slug = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, max)
        .replace(/-+$/g, '');
    return slug || fallback;
}
