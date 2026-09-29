/**
 * The farm open in this browser tab (D15-01, D15-02).
 *
 * One session = one farm folder on the visitor's device, plus the catalogues loaded
 * from it. The server never sees the farm. Switching farm replaces the session.
 */

import type { FarmEntry, FarmKind, FarmTree } from '../app/farm-api';
import { EquipmentStore } from './equipment-store';
import { FieldCatalogue } from './field-catalogue';
import {
    BrowserDirectory,
    browserStoreAvailable,
    forgetDeviceFarm,
    HandleDirectory,
    listBrowserFarms,
    listDeviceFarms,
    MemoryDirectory,
    readJsonObject,
    registerBrowserFarm,
    rememberDeviceFarm,
    renameBrowserFarm,
    writeJson,
    type FarmDirectory,
    type FarmDirectoryKind,
} from './fs';
import {
    cropPackFor,
    ensureFarm,
    FARM_FILE,
    isFarm,
    mergeFarmPatch,
    nowIso,
    readFarmJson,
    validateFarmJson,
    writeFarmJson,
} from './layout';
import { PublicationStore } from './publication-store';
import { farmCounts, listTree, missionsForField, type FarmCountsResult } from './tree';
import { exportFarmZip, importFarmZip } from './zip';

type Json = Record<string, unknown>;

export interface FarmLocation {
    kind: FarmDirectoryKind;
    /** Folder or farm name, never an absolute path. */
    label: string;
    /** Browser store id or remembered folder id; null in memory. */
    id: string | null;
}

export interface FarmRecent extends FarmLocation {
    id: string;
    /** A real folder the browser needs the user to allow again (one click). */
    needsPermission?: boolean;
}

export interface ReindexReport {
    errors: number;
    fields: number;
}

export class FarmSession {
    readonly fields: FieldCatalogue;
    readonly equipment: EquipmentStore;
    readonly publications: PublicationStore;

    private constructor(
        readonly dir: FarmDirectory,
        readonly id: string | null,
    ) {
        this.fields = new FieldCatalogue(dir);
        this.equipment = new EquipmentStore(dir);
        this.publications = new PublicationStore(dir);
    }

    get location(): FarmLocation {
        return { kind: this.dir.kind, label: this.dir.label, id: this.id };
    }

    /** Open a folder that already holds a valid `farm.json`. */
    static async open(dir: FarmDirectory, id: string | null = null): Promise<FarmSession> {
        if (!(await isFarm(dir))) {
            throw new Error('this folder is not a farm; create a farm there first');
        }
        const farm = await readFarmJson(dir);
        if (!farm) {
            throw new Error('farm.json is unreadable');
        }
        const problems = validateFarmJson(farm);
        if (problems.length) {
            throw new Error(problems.join('; '));
        }
        const session = new FarmSession(dir, id);
        await ensureFarm(dir);
        await session.reindex();
        return session;
    }

    /** Create a farm in a new or empty folder. */
    static async create(
        dir: FarmDirectory,
        name: string,
        id: string | null = null,
    ): Promise<FarmSession> {
        if (await isFarm(dir)) {
            throw new Error('this folder already contains a farm');
        }
        const visible = (await dir.list('')).filter((entry) => !entry.name.startsWith('.'));
        if (visible.length) {
            throw new Error('a new farm must be created in an empty folder');
        }
        await ensureFarm(dir, name);
        return FarmSession.open(dir, id);
    }

    async readFarm(): Promise<Json | null> {
        return readFarmJson(this.dir);
    }

    async writeFarm(patch: Json): Promise<Json> {
        if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
            throw new Error('payload must be a JSON object');
        }
        const current = (await readFarmJson(this.dir)) ?? {};
        const merged = mergeFarmPatch(current, patch);
        await writeFarmJson(this.dir, merged);
        if (this.dir instanceof BrowserDirectory && typeof merged.name === 'string') {
            await renameBrowserFarm(this.dir.farmId, merged.name);
        }
        return merged;
    }

    counts(): Promise<FarmCountsResult> {
        return farmCounts(this.dir);
    }

    tree(kind?: FarmKind): Promise<FarmTree> {
        return listTree(this.dir, kind);
    }

    missionsForField(fieldId: string): Promise<FarmEntry[]> {
        return missionsForField(this.dir, fieldId);
    }

    private static agriPath(path: string, allowed: readonly string[]): string {
        const parts = path.split('/');
        if (
            parts.length !== 2 ||
            !allowed.includes(parts[0] ?? '') ||
            !parts[1]?.endsWith('.json')
        ) {
            throw new Error(`path must be inside ${allowed.join(' or ')}`);
        }
        return path;
    }

    async readMission(path: string): Promise<Json> {
        const safe = FarmSession.agriPath(path, ['mission_order', 'work_performed']);
        if ((await this.dir.readBytes(safe)) === null) {
            throw new Error('mission file not found');
        }
        const document = await readJsonObject(this.dir, safe);
        if (!document) {
            throw new Error('mission file is unreadable');
        }
        return document;
    }

    /** Write one Agri mission into `mission_order/`. `filename` is editor-only. */
    async writeMission(path: string, document: Json): Promise<Json> {
        const safe = FarmSession.agriPath(path, ['mission_order']);
        if (document === null || typeof document !== 'object') {
            throw new Error('document must be a JSON object');
        }
        const payload = { ...document };
        delete payload.filename;
        await writeJson(this.dir, safe, payload);
        return payload;
    }

    /** Reload every catalogue from the files: the in-memory state is only an index. */
    async reindex(): Promise<ReindexReport> {
        const fields = await this.fields.load();
        const equipment = await this.equipment.load();
        return {
            errors: fields.errors.length + equipment.errors.length,
            fields: fields.imported,
        };
    }

    exportZip(): Promise<Uint8Array> {
        return exportFarmZip(this.dir);
    }
}

// -- current session ---------------------------------------------------------------

let current: FarmSession | null = null;
const listeners = new Set<(session: FarmSession | null) => void>();
const LAST_FARM_KEY = 'mission-studio.last-farm';

export function currentSession(): FarmSession | null {
    return current;
}

export function requireSession(): FarmSession {
    if (!current) {
        throw new Error('no farm is open; open one from Administration first');
    }
    return current;
}

export function onSessionChange(listener: (session: FarmSession | null) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function remember(location: FarmLocation | null): void {
    try {
        if (location && location.id && location.kind !== 'memory') {
            globalThis.localStorage?.setItem(
                LAST_FARM_KEY,
                JSON.stringify({ kind: location.kind, id: location.id }),
            );
        } else {
            globalThis.localStorage?.removeItem(LAST_FARM_KEY);
        }
    } catch {
        // Private browsing without storage: the farm simply is not reopened next time.
    }
}

export function setCurrentSession(session: FarmSession | null): void {
    current = session;
    remember(session?.location ?? null);
    for (const listener of listeners) {
        listener(session);
    }
}

// -- capabilities -------------------------------------------------------------------

interface PermissionHandle {
    queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
}

type DirectoryPicker = (options?: {
    id?: string;
    mode?: 'readwrite';
}) => Promise<FileSystemDirectoryHandle>;

function directoryPicker(): DirectoryPicker | null {
    const picker = (globalThis as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
    return typeof picker === 'function' ? picker.bind(globalThis) : null;
}

/** Real folders on disk: Chrome / Edge desktop. Other browsers use the browser store. */
export function deviceFoldersSupported(): boolean {
    return directoryPicker() !== null;
}

export function browserFarmsSupported(): boolean {
    return browserStoreAvailable();
}

async function allowed(handle: FileSystemDirectoryHandle, ask: boolean): Promise<boolean> {
    const permissions = handle as unknown as PermissionHandle;
    if (!permissions.queryPermission) {
        return true;
    }
    if ((await permissions.queryPermission({ mode: 'readwrite' })) === 'granted') {
        return true;
    }
    if (!ask || !permissions.requestPermission) {
        return false;
    }
    return (await permissions.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Ask the user for a folder. Null when they cancel. */
export async function pickDeviceFolder(): Promise<FileSystemDirectoryHandle | null> {
    const picker = directoryPicker();
    if (!picker) {
        throw new Error('this browser cannot open a folder; use a farm stored in the browser');
    }
    try {
        return await picker({ id: 'mission-studio-farm', mode: 'readwrite' });
    } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') {
            return null;
        }
        throw reason;
    }
}

async function adoptDevice(
    handle: FileSystemDirectoryHandle,
    build: (dir: HandleDirectory, id: string) => Promise<FarmSession>,
): Promise<FarmSession> {
    if (!(await allowed(handle, true))) {
        throw new Error('permission to write in this folder was refused');
    }
    const known = (await listDeviceFarms()).find((record) => record.name === handle.name);
    let id: string = crypto.randomUUID();
    if (known && (await known.handle.isSameEntry(handle))) {
        id = known.id;
    }
    const session = await build(new HandleDirectory(handle), id);
    await rememberDeviceFarm({ id, name: handle.name, opened_at: nowIso(), handle });
    setCurrentSession(session);
    return session;
}

export function openDeviceFarm(handle: FileSystemDirectoryHandle): Promise<FarmSession> {
    return adoptDevice(handle, (dir, id) => FarmSession.open(dir, id));
}

export function createDeviceFarm(
    handle: FileSystemDirectoryHandle,
    name: string,
): Promise<FarmSession> {
    return adoptDevice(handle, (dir, id) => FarmSession.create(dir, name, id));
}

export async function createBrowserFarm(name: string): Promise<FarmSession> {
    const dir = await registerBrowserFarm({
        id: crypto.randomUUID(),
        name: name.trim() || 'Ma ferme',
        created_at: nowIso(),
    });
    const session = await FarmSession.create(dir, name, dir.farmId);
    setCurrentSession(session);
    return session;
}

export async function openBrowserFarm(id: string): Promise<FarmSession> {
    const record = (await listBrowserFarms()).find((item) => item.id === id);
    if (!record) {
        throw new Error('this farm no longer exists in this browser');
    }
    const session = await FarmSession.open(new BrowserDirectory(record.id, record.name), id);
    setCurrentSession(session);
    return session;
}

/** A shared or exported farm (.zip) becomes a new farm stored in this browser. */
export async function importBrowserFarm(archive: Uint8Array, fallbackName: string) {
    const id = crypto.randomUUID();
    const staging = new MemoryDirectory();
    await importFarmZip(staging, archive);
    const farm = await readFarmJson(staging);
    const name = typeof farm?.name === 'string' && farm.name ? farm.name : fallbackName;
    const dir = await registerBrowserFarm({ id, name, created_at: nowIso() });
    await importFarmZip(dir, archive);
    const session = await FarmSession.open(dir, id);
    setCurrentSession(session);
    return session;
}

/** Tests and the demo farm: a farm that lives only as long as the page. */
export async function openMemoryFarm(dir: MemoryDirectory): Promise<FarmSession> {
    if ((await dir.readBytes(FARM_FILE)) === null) {
        await ensureFarm(dir, dir.label);
    }
    const session = await FarmSession.open(dir, null);
    setCurrentSession(session);
    return session;
}

export async function listRecentFarms(): Promise<FarmRecent[]> {
    const recent: FarmRecent[] = [];
    for (const record of await listDeviceFarms()) {
        recent.push({
            kind: 'device',
            id: record.id,
            label: record.name,
            needsPermission: !(await allowed(record.handle, false)),
        });
    }
    for (const record of await listBrowserFarms()) {
        recent.push({ kind: 'browser', id: record.id, label: record.name });
    }
    return recent;
}

export async function openRecentFarm(recent: FarmRecent): Promise<FarmSession> {
    if (recent.kind === 'browser') {
        return openBrowserFarm(recent.id);
    }
    const record = (await listDeviceFarms()).find((item) => item.id === recent.id);
    if (!record) {
        throw new Error('this folder is no longer known to the browser; open it again');
    }
    try {
        return await openDeviceFarm(record.handle);
    } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'NotFoundError') {
            await forgetDeviceFarm(record.id);
            throw new Error('this folder was moved or deleted; open it again', { cause: reason });
        }
        throw reason;
    }
}

/**
 * Reopen the farm of the previous visit when the browser still allows it without a
 * click. A real folder that needs the permission again stays in the recent list.
 */
export async function restoreLastFarm(): Promise<FarmSession | null> {
    let last: { kind?: unknown; id?: unknown } | null = null;
    try {
        last = JSON.parse(globalThis.localStorage?.getItem(LAST_FARM_KEY) ?? 'null');
    } catch {
        last = null;
    }
    if (!last || typeof last.id !== 'string') {
        return null;
    }
    try {
        if (last.kind === 'browser') {
            return await openBrowserFarm(last.id);
        }
        if (last.kind === 'device') {
            const record = (await listDeviceFarms()).find((item) => item.id === last?.id);
            if (record && (await allowed(record.handle, false))) {
                return await openDeviceFarm(record.handle);
            }
        }
    } catch {
        // A farm that cannot be reopened must not block the start of the studio.
    }
    return null;
}

export function snapshotCropPack(farm: Json | null): string | null {
    return farm ? cropPackFor(farm.farm_type) : null;
}
