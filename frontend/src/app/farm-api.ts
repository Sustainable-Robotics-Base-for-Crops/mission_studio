/**
 * The open farm (L13, L15a). The farm folder is the source of truth and lives on the
 * visitor's device: a real folder (Chrome / Edge) or the browser's own store. The
 * server never reads nor writes a farm.
 */

import {
    browserFarmsSupported,
    createBrowserFarm,
    createDeviceFarm,
    currentSession,
    deviceFoldersSupported,
    importBrowserFarm,
    listRecentFarms,
    openDeviceFarm,
    openRecentFarm,
    pickDeviceFolder,
    requireSession,
    snapshotCropPack,
    type FarmLocation,
    type FarmRecent,
} from '../farmstore/session';

export type { FarmLocation, FarmRecent };

export type FarmType = 'market_garden' | 'vineyard' | 'open_field' | 'livestock' | 'mixed';
export type UiMode = 'basic' | 'advanced';
export const DEFAULT_FIELD_GEOFENCE_INSET_CM = 25;

/** Expert chrome is shown unless the farm explicitly asks for basic tools. */
export function isAdvancedUi(mode: UiMode | null | undefined): boolean {
    return mode !== 'basic';
}
export type FarmKind = 'parcel_map' | 'mission_order' | 'work_performed' | 'equipment';

export const FARM_TYPES: readonly FarmType[] = [
    'market_garden',
    'vineyard',
    'open_field',
    'livestock',
    'mixed',
];

export const FARM_KINDS: readonly FarmKind[] = [
    'parcel_map',
    'mission_order',
    'work_performed',
    'equipment',
];

export interface FarmStartView {
    lat: number;
    lon: number;
    zoom: number;
}

export interface FarmDocument {
    schema: string;
    name: string;
    farm_type: FarmType;
    start_view: FarmStartView;
    language: string;
    theme: 'light' | 'dark';
    ui_mode: UiMode;
    units: string;
    /** Clearance applied when deriving a new mission geofence from a field. */
    field_geofence_inset_cm?: number;
    speed_color_low_kmh?: number;
    speed_color_mid_kmh?: number;
    speed_color_high_kmh?: number;
    created_at: string;
    updated_at: string;
}

export interface FarmCounts {
    fields: number;
    missions: number;
    work_performed: number;
    equipment: number;
    /** Null when no field carries a usable polygon: show a dash, never a zero. */
    hectares: number | null;
}

export interface FarmSnapshot {
    farm: FarmDocument | null;
    /** Folder or farm name for display. Never an absolute path. */
    root: string | null;
    location: FarmLocation | null;
    counts: FarmCounts;
    recent: FarmRecent[];
    cropPack: string | null;
}

export interface FarmEntry {
    name: string;
    path: string;
    size: number;
    modified: number;
    kind?: FarmKind;
    field_id?: string | null;
    field_name?: string | null;
    display_name?: string | null;
    operation?: string | null;
    campaign?: string | null;
    simulated?: boolean;
    published?: boolean;
    /** The file exists but could not be parsed. Keep it visible so it can be fixed. */
    unreadable?: boolean;
}

export type FarmTree = Partial<Record<FarmKind, FarmEntry[]>>;

export const EMPTY_COUNTS: FarmCounts = {
    fields: 0,
    missions: 0,
    work_performed: 0,
    equipment: 0,
    hectares: null,
};

export const EMPTY_SNAPSHOT: FarmSnapshot = {
    farm: null,
    root: null,
    location: null,
    counts: EMPTY_COUNTS,
    recent: [],
    cropPack: null,
};

/** Raised when a farm operation is refused, with the reason to show. */
export class FarmError extends Error {}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (reason) {
        if (reason instanceof FarmError) {
            throw reason;
        }
        throw new FarmError(reason instanceof Error ? reason.message : String(reason), {
            cause: reason,
        });
    }
}

/** True when this browser can hold a farm (a real folder or its own store). */
export async function fetchFarmAvailable(): Promise<boolean> {
    return browserFarmsSupported() || deviceFoldersSupported();
}

export function farmFoldersOnDevice(): boolean {
    return deviceFoldersSupported();
}

export async function fetchFarm(): Promise<FarmSnapshot> {
    const recent = await listRecentFarms().catch(() => []);
    const session = currentSession();
    if (!session) {
        return { ...EMPTY_SNAPSHOT, recent };
    }
    const farm = (await session.readFarm()) as FarmDocument | null;
    return {
        farm,
        root: session.location.label,
        location: session.location,
        counts: await session.counts(),
        recent,
        cropPack: snapshotCropPack(farm as Record<string, unknown> | null),
    };
}

export async function updateFarm(patch: Partial<FarmDocument>): Promise<FarmSnapshot> {
    await guarded(() => requireSession().writeFarm(patch as Record<string, unknown>));
    return fetchFarm();
}

/** Ask for a folder on this computer and open the farm it holds. Null when cancelled. */
export async function openFarmFromDevice(): Promise<FarmSnapshot | null> {
    return guarded(async () => {
        const handle = await pickDeviceFolder();
        if (!handle) {
            return null;
        }
        await openDeviceFarm(handle);
        return fetchFarm();
    });
}

/** Ask for an empty folder on this computer and create a farm in it. */
export async function createFarmOnDevice(name: string): Promise<FarmSnapshot | null> {
    return guarded(async () => {
        const handle = await pickDeviceFolder();
        if (!handle) {
            return null;
        }
        await createDeviceFarm(handle, name);
        return fetchFarm();
    });
}

export async function createFarmInBrowser(name: string): Promise<FarmSnapshot> {
    return guarded(async () => {
        await createBrowserFarm(name);
        return fetchFarm();
    });
}

export async function openRecent(recent: FarmRecent): Promise<FarmSnapshot> {
    return guarded(async () => {
        await openRecentFarm(recent);
        return fetchFarm();
    });
}

/** A farm archive (.zip) becomes a new farm stored in this browser. */
export async function importFarmArchive(file: Blob & { name?: string }): Promise<FarmSnapshot> {
    return guarded(async () => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const fallback = (file.name ?? 'ferme').replace(/\.zip$/i, '') || 'ferme';
        await importBrowserFarm(bytes, fallback);
        return fetchFarm();
    });
}

/** Download the open farm as a `.zip`, named after the farm. */
export async function exportFarmArchive(): Promise<void> {
    await guarded(async () => {
        const session = requireSession();
        const farm = await session.readFarm();
        const bytes = await session.exportZip();
        const name = String(farm?.name ?? session.location.label ?? 'ferme')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^A-Za-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
        const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const link = globalThis.document.createElement('a');
        link.href = url;
        link.download = `${name || 'ferme'}.zip`;
        globalThis.document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    });
}

export async function fetchFarmTree(kind?: FarmKind): Promise<FarmTree> {
    return guarded(() => requireSession().tree(kind));
}

export async function fetchFarmMissionsForField(fieldId: string): Promise<FarmEntry[]> {
    return guarded(() => requireSession().missionsForField(fieldId));
}

export async function fetchFarmMission(path: string): Promise<unknown> {
    return guarded(() => requireSession().readMission(path));
}

export async function saveFarmMission(
    path: string,
    document: Record<string, unknown>,
): Promise<string> {
    await guarded(() => requireSession().writeMission(path, document));
    return path;
}

export async function reindexFarm(): Promise<{ errors: number }> {
    const report = await guarded(() => requireSession().reindex());
    return { errors: report.errors };
}

/** Folder name of a root, for display when the full value is too long. */
export function farmFolderName(root: string | null): string {
    if (!root) {
        return '';
    }
    const parts = root.replace(/[/\\]+$/, '').split(/[/\\]/);
    return parts[parts.length - 1] || root;
}
