/**
 * Listing of a farm folder for the explorers (CdC §2.8), browser side.
 *
 * A corrupted file never breaks a listing: it comes back with its file metadata
 * only, so the user sees it exists and can go fix it. Only files at the top of each
 * folder count, so `mission_order/.versions/` stays invisible to the robot and here.
 */

import type { FarmEntry, FarmKind, FarmTree } from '../app/farm-api';
import { joinFarmPath, readJsonObject, type FarmDirectory } from './fs';
import { polygonAreaM2 } from './geometry';
import { FARM_DIRS, type FarmDir } from './layout';

const EXTENSIONS: Record<FarmDir, string> = {
    parcel_map: '.geojson',
    mission_order: '.json',
    work_performed: '.json',
    equipment: '.json',
};

const AGRI_DIRS: readonly FarmDir[] = ['mission_order', 'work_performed'];

function text(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
}

export function missionContext(document: Record<string, unknown>): Partial<FarmEntry> {
    const rawMetadata = document.metadata;
    const metadata =
        rawMetadata !== null && typeof rawMetadata === 'object'
            ? (rawMetadata as Record<string, unknown>)
            : {};
    const rawBrief = metadata.srbc_mission_brief;
    const brief =
        rawBrief !== null && typeof rawBrief === 'object'
            ? (rawBrief as Record<string, unknown>)
            : {};
    return {
        field_id: text(brief.field_id),
        field_name: text(brief.field_name),
        display_name: text(brief.name),
        operation: text(brief.operation),
        campaign: text(brief.campaign),
        simulated: Boolean(metadata.srbc_simulation),
        published: Boolean(metadata.srbc_publication),
    };
}

const UNREADABLE: Partial<FarmEntry> = {
    field_id: null,
    field_name: null,
    display_name: null,
    operation: null,
    campaign: null,
    simulated: false,
    published: false,
    unreadable: true,
};

function isFarmDir(kind: string): kind is FarmDir {
    return (FARM_DIRS as readonly string[]).includes(kind);
}

/** Folder entries, newest first. Equipment lists one entry per item folder. */
export async function listKind(dir: FarmDirectory, kind: string): Promise<FarmEntry[]> {
    if (!isFarmDir(kind)) {
        throw new Error(`unknown folder '${kind}'; expected one of ${FARM_DIRS.join(', ')}`);
    }
    const entries: FarmEntry[] = [];
    for (const item of await dir.list(kind)) {
        if (item.name.startsWith('.')) {
            continue;
        }
        if (kind === 'equipment' && item.kind === 'directory') {
            const path = joinFarmPath(kind, item.name, 'equipment.json');
            const stat = (await dir.list(joinFarmPath(kind, item.name))).find(
                (child) => child.name === 'equipment.json',
            );
            if (stat) {
                entries.push({
                    name: item.name,
                    path,
                    size: stat.size,
                    modified: stat.modified,
                    kind,
                });
            }
            continue;
        }
        if (item.kind !== 'file' || !item.name.toLowerCase().endsWith(EXTENSIONS[kind])) {
            continue;
        }
        const entry: FarmEntry = {
            name: item.name,
            path: joinFarmPath(kind, item.name),
            size: item.size,
            modified: item.modified,
        };
        if (AGRI_DIRS.includes(kind)) {
            const document = await readJsonObject(dir, entry.path);
            Object.assign(entry, document ? missionContext(document) : UNREADABLE);
        }
        entries.push(entry);
    }
    return entries.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
}

export async function listTree(dir: FarmDirectory, kind?: FarmKind): Promise<FarmTree> {
    const kinds: readonly FarmDir[] = kind ? [kind] : FARM_DIRS;
    const tree: FarmTree = {};
    for (const name of kinds) {
        tree[name] = await listKind(dir, name);
    }
    return tree;
}

/** Missions and performed work attached to a field, newest first. */
export async function missionsForField(dir: FarmDirectory, fieldId: string): Promise<FarmEntry[]> {
    if (!fieldId) {
        return [];
    }
    const matches: FarmEntry[] = [];
    for (const kind of AGRI_DIRS) {
        for (const entry of await listKind(dir, kind)) {
            if (entry.field_id === fieldId) {
                matches.push({ ...entry, kind });
            }
        }
    }
    return matches.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
}

function featureIsField(feature: unknown): feature is { geometry?: unknown } {
    if (feature === null || typeof feature !== 'object') {
        return false;
    }
    const properties = (feature as { properties?: unknown }).properties;
    if (properties === null || typeof properties !== 'object') {
        return false;
    }
    const record = properties as Record<string, unknown>;
    return (record.srbc_kind ?? record.kind) === 'field';
}

export interface FarmCountsResult {
    fields: number;
    missions: number;
    work_performed: number;
    equipment: number;
    hectares: number | null;
}

/**
 * Figures for the home dashboard. `hectares` is null when no field carries a usable
 * polygon: the dashboard must show a dash and its reason, never a misleading zero.
 */
export async function farmCounts(dir: FarmDirectory): Promise<FarmCountsResult> {
    const tree = await listTree(dir);
    let total = 0;
    let measured = false;
    for (const entry of tree.parcel_map ?? []) {
        const document = await readJsonObject(dir, entry.path);
        const features = Array.isArray(document?.features) ? (document.features as unknown[]) : [];
        for (const feature of features) {
            if (!featureIsField(feature)) {
                continue;
            }
            const area = polygonAreaM2(feature.geometry);
            if (area) {
                total += area;
                measured = true;
            }
        }
    }
    return {
        fields: tree.parcel_map?.length ?? 0,
        missions: tree.mission_order?.length ?? 0,
        work_performed: tree.work_performed?.length ?? 0,
        equipment: tree.equipment?.length ?? 0,
        hectares: measured ? Math.round((total / 10_000) * 100) / 100 : null,
    };
}
