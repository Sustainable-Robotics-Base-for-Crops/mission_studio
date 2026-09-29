/**
 * Farm folder access from the browser (lot L15a, D15-01).
 *
 * The farm folder lives on the visitor's device. Three backings share one contract:
 * a real folder picked by the user (File System Access, Chrome / Edge desktop), a
 * private browser store (IndexedDB, every browser) and memory (tests, demo).
 * Paths are always relative to the farm root and use `/`.
 */

export type FarmDirectoryKind = 'device' | 'browser' | 'memory';

export interface FarmDirEntry {
    name: string;
    kind: 'file' | 'directory';
    size: number;
    /** Milliseconds since the epoch; 0 for directories. */
    modified: number;
}

export interface FarmDirectory {
    readonly kind: FarmDirectoryKind;
    /** Folder name shown to the user. Never an absolute path. */
    readonly label: string;
    readBytes(path: string): Promise<Uint8Array | null>;
    writeBytes(path: string, data: Uint8Array): Promise<void>;
    /** True when something was removed. Directories are removed recursively. */
    remove(path: string): Promise<boolean>;
    /** Direct children of `dir` (`''` = root). A missing directory lists as empty. */
    list(dir: string): Promise<FarmDirEntry[]>;
    makeDirectory(dir: string): Promise<void>;
}

const MAX_PATH_LENGTH = 512;

/** Split a farm-relative path, refusing anything that could escape the farm. */
export function farmPathSegments(path: string, { allowRoot = false } = {}): string[] {
    if (typeof path !== 'string') {
        throw new Error('path must be a string');
    }
    if (path.length > MAX_PATH_LENGTH) {
        throw new Error('path is too long');
    }
    if (path.includes('\\') || path.includes('\0')) {
        throw new Error('path must use "/" separators');
    }
    if (path.startsWith('/') || path.startsWith('~') || /^[a-zA-Z]:/.test(path)) {
        throw new Error('path must be relative to the farm folder');
    }
    const segments = path.split('/').filter((segment) => segment !== '');
    if (!allowRoot && segments.length === 0) {
        throw new Error('path must not be empty');
    }
    for (const segment of segments) {
        if (segment === '.' || segment === '..') {
            throw new Error('path must not contain "." or ".."');
        }
    }
    return segments;
}

export function joinFarmPath(...parts: string[]): string {
    return parts.filter((part) => part !== '').join('/');
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

export async function readText(dir: FarmDirectory, path: string): Promise<string | null> {
    const bytes = await dir.readBytes(path);
    return bytes === null ? null : decoder.decode(bytes);
}

export async function writeText(dir: FarmDirectory, path: string, text: string): Promise<void> {
    await dir.writeBytes(path, encoder.encode(text));
}

/** Parsed JSON object, or null when the file is absent, unreadable or not an object. */
export async function readJsonObject(
    dir: FarmDirectory,
    path: string,
): Promise<Record<string, unknown> | null> {
    const text = await readText(dir, path);
    if (text === null) {
        return null;
    }
    try {
        const value: unknown = JSON.parse(text);
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

/** Same layout as the Python backend: two-space indent and a trailing newline. */
export async function writeJson(dir: FarmDirectory, path: string, value: unknown): Promise<void> {
    await writeText(dir, path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Every file below `dir`, as farm-relative paths, depth first. */
export async function walkFiles(root: FarmDirectory, dir = ''): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await root.list(dir)) {
        const path = joinFarmPath(dir, entry.name);
        if (entry.kind === 'directory') {
            found.push(...(await walkFiles(root, path)));
        } else {
            found.push(path);
        }
    }
    return found;
}

// -- memory ------------------------------------------------------------------

interface MemoryFile {
    data: Uint8Array;
    modified: number;
}

export class MemoryDirectory implements FarmDirectory {
    readonly kind = 'memory' as const;
    private readonly files = new Map<string, MemoryFile>();
    private readonly dirs = new Set<string>();

    constructor(
        readonly label = 'ferme',
        private readonly clock: () => number = () => Date.now(),
    ) {}

    async readBytes(path: string): Promise<Uint8Array | null> {
        const file = this.files.get(farmPathSegments(path).join('/'));
        return file ? file.data.slice() : null;
    }

    async writeBytes(path: string, data: Uint8Array): Promise<void> {
        const segments = farmPathSegments(path);
        const key = segments.join('/');
        if (this.dirs.has(key)) {
            throw new Error(`${key} is a directory`);
        }
        for (let index = 1; index < segments.length; index += 1) {
            this.dirs.add(segments.slice(0, index).join('/'));
        }
        this.files.set(key, { data: data.slice(), modified: this.clock() });
    }

    async remove(path: string): Promise<boolean> {
        const key = farmPathSegments(path).join('/');
        if (this.files.delete(key)) {
            return true;
        }
        if (!this.dirs.has(key)) {
            return false;
        }
        const prefix = `${key}/`;
        for (const name of [...this.files.keys()]) {
            if (name.startsWith(prefix)) {
                this.files.delete(name);
            }
        }
        for (const name of [...this.dirs]) {
            if (name === key || name.startsWith(prefix)) {
                this.dirs.delete(name);
            }
        }
        return true;
    }

    async list(dir: string): Promise<FarmDirEntry[]> {
        const key = farmPathSegments(dir, { allowRoot: true }).join('/');
        const prefix = key ? `${key}/` : '';
        const entries = new Map<string, FarmDirEntry>();
        for (const name of this.dirs) {
            if (name.startsWith(prefix) && !name.slice(prefix.length).includes('/')) {
                const child = name.slice(prefix.length);
                if (child) {
                    entries.set(child, { name: child, kind: 'directory', size: 0, modified: 0 });
                }
            }
        }
        for (const [name, file] of this.files) {
            if (name.startsWith(prefix) && !name.slice(prefix.length).includes('/')) {
                const child = name.slice(prefix.length);
                entries.set(child, {
                    name: child,
                    kind: 'file',
                    size: file.data.byteLength,
                    modified: file.modified,
                });
            }
        }
        return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    async makeDirectory(dir: string): Promise<void> {
        const segments = farmPathSegments(dir);
        for (let index = 1; index <= segments.length; index += 1) {
            this.dirs.add(segments.slice(0, index).join('/'));
        }
    }
}

// -- real folder (File System Access) ------------------------------------------

function isNotFound(reason: unknown): boolean {
    return (
        reason instanceof DOMException &&
        (reason.name === 'NotFoundError' || reason.name === 'TypeMismatchError')
    );
}

export class HandleDirectory implements FarmDirectory {
    readonly kind = 'device' as const;

    constructor(readonly handle: FileSystemDirectoryHandle) {}

    get label(): string {
        return this.handle.name;
    }

    private async folder(
        segments: string[],
        create: boolean,
    ): Promise<FileSystemDirectoryHandle | null> {
        let current = this.handle;
        for (const segment of segments) {
            try {
                current = await current.getDirectoryHandle(segment, { create });
            } catch (reason) {
                if (!create && isNotFound(reason)) {
                    return null;
                }
                throw reason;
            }
        }
        return current;
    }

    async readBytes(path: string): Promise<Uint8Array | null> {
        const segments = farmPathSegments(path);
        const parent = await this.folder(segments.slice(0, -1), false);
        if (!parent) {
            return null;
        }
        try {
            const handle = await parent.getFileHandle(segments[segments.length - 1] ?? '');
            const file = await handle.getFile();
            return new Uint8Array(await file.arrayBuffer());
        } catch (reason) {
            if (isNotFound(reason)) {
                return null;
            }
            throw reason;
        }
    }

    async writeBytes(path: string, data: Uint8Array): Promise<void> {
        const segments = farmPathSegments(path);
        const parent = await this.folder(segments.slice(0, -1), true);
        if (!parent) {
            throw new Error(`cannot create ${path}`);
        }
        const handle = await parent.getFileHandle(segments[segments.length - 1] ?? '', {
            create: true,
        });
        const writable = await handle.createWritable();
        try {
            await writable.write(data as unknown as FileSystemWriteChunkType);
        } finally {
            await writable.close();
        }
    }

    async remove(path: string): Promise<boolean> {
        const segments = farmPathSegments(path);
        const parent = await this.folder(segments.slice(0, -1), false);
        if (!parent) {
            return false;
        }
        try {
            await parent.removeEntry(segments[segments.length - 1] ?? '', { recursive: true });
            return true;
        } catch (reason) {
            if (isNotFound(reason)) {
                return false;
            }
            throw reason;
        }
    }

    async list(dir: string): Promise<FarmDirEntry[]> {
        const folder = await this.folder(farmPathSegments(dir, { allowRoot: true }), false);
        if (!folder) {
            return [];
        }
        const entries: FarmDirEntry[] = [];
        for await (const [name, handle] of folder.entries()) {
            if (handle.kind === 'directory') {
                entries.push({ name, kind: 'directory', size: 0, modified: 0 });
                continue;
            }
            const file = await (handle as FileSystemFileHandle).getFile();
            entries.push({ name, kind: 'file', size: file.size, modified: file.lastModified });
        }
        return entries.sort((a, b) => a.name.localeCompare(b.name));
    }

    async makeDirectory(dir: string): Promise<void> {
        await this.folder(farmPathSegments(dir), true);
    }
}

// -- private browser store (IndexedDB) ----------------------------------------------

const DB_NAME = 'mission-studio-farms';
const DB_VERSION = 1;
const FILES = 'files';
const DIRS = 'dirs';
const FARMS = 'farms';
const HANDLES = 'handles';

export interface BrowserFarmRecord {
    id: string;
    name: string;
    created_at: string;
}

function promised<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
}

function completed(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
            reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
        transaction.onerror = () =>
            reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    });
}

let databasePromise: Promise<IDBDatabase> | null = null;

export function browserStoreAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
    if (!databasePromise) {
        databasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(FILES)) {
                    db.createObjectStore(FILES);
                }
                if (!db.objectStoreNames.contains(DIRS)) {
                    db.createObjectStore(DIRS);
                }
                if (!db.objectStoreNames.contains(FARMS)) {
                    db.createObjectStore(FARMS, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(HANDLES)) {
                    db.createObjectStore(HANDLES, { keyPath: 'id' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                databasePromise = null;
                reject(request.error ?? new Error('IndexedDB is unavailable'));
            };
        });
    }
    return databasePromise;
}

/** Test hook: forget the cached connection (fake-indexeddb is reset between tests). */
export function resetBrowserStoreConnection(): void {
    databasePromise = null;
}

interface StoredFile {
    data: Uint8Array;
    modified: number;
}

export class BrowserDirectory implements FarmDirectory {
    readonly kind = 'browser' as const;

    constructor(
        readonly farmId: string,
        readonly label: string,
    ) {}

    private key(path: string): [string, string] {
        return [this.farmId, path];
    }

    private range(prefix: string): IDBKeyRange {
        return IDBKeyRange.bound([this.farmId, prefix], [this.farmId, `${prefix}\uffff`]);
    }

    async readBytes(path: string): Promise<Uint8Array | null> {
        const key = farmPathSegments(path).join('/');
        const db = await openDatabase();
        const stored = (await promised(
            db.transaction(FILES, 'readonly').objectStore(FILES).get(this.key(key)),
        )) as StoredFile | undefined;
        return stored ? new Uint8Array(stored.data) : null;
    }

    async writeBytes(path: string, data: Uint8Array): Promise<void> {
        const segments = farmPathSegments(path);
        const db = await openDatabase();
        const transaction = db.transaction([FILES, DIRS], 'readwrite');
        const dirs = transaction.objectStore(DIRS);
        for (let index = 1; index < segments.length; index += 1) {
            dirs.put(true, this.key(segments.slice(0, index).join('/')));
        }
        const record: StoredFile = { data: data.slice(), modified: Date.now() };
        transaction.objectStore(FILES).put(record, this.key(segments.join('/')));
        await completed(transaction);
    }

    async remove(path: string): Promise<boolean> {
        const key = farmPathSegments(path).join('/');
        const db = await openDatabase();
        const transaction = db.transaction([FILES, DIRS], 'readwrite');
        const files = transaction.objectStore(FILES);
        const dirs = transaction.objectStore(DIRS);
        const [fileCount, dirCount, childFiles, childDirs] = await Promise.all([
            promised(files.count(this.key(key))),
            promised(dirs.count(this.key(key))),
            promised(files.count(this.range(`${key}/`))),
            promised(dirs.count(this.range(`${key}/`))),
        ]);
        files.delete(this.key(key));
        dirs.delete(this.key(key));
        files.delete(this.range(`${key}/`));
        dirs.delete(this.range(`${key}/`));
        await completed(transaction);
        return fileCount + dirCount + childFiles + childDirs > 0;
    }

    async list(dir: string): Promise<FarmDirEntry[]> {
        const key = farmPathSegments(dir, { allowRoot: true }).join('/');
        const prefix = key ? `${key}/` : '';
        const db = await openDatabase();
        const transaction = db.transaction([FILES, DIRS], 'readonly');
        const range = this.range(prefix);
        const [fileKeys, fileValues, dirKeys] = await Promise.all([
            promised(transaction.objectStore(FILES).getAllKeys(range)),
            promised(transaction.objectStore(FILES).getAll(range)),
            promised(transaction.objectStore(DIRS).getAllKeys(range)),
        ]);
        const entries = new Map<string, FarmDirEntry>();
        dirKeys.forEach((raw) => {
            const rest = String((raw as [string, string])[1]).slice(prefix.length);
            if (rest && !rest.includes('/')) {
                entries.set(rest, { name: rest, kind: 'directory', size: 0, modified: 0 });
            }
        });
        fileKeys.forEach((raw, index) => {
            const rest = String((raw as [string, string])[1]).slice(prefix.length);
            if (!rest || rest.includes('/')) {
                return;
            }
            const stored = fileValues[index] as StoredFile;
            entries.set(rest, {
                name: rest,
                kind: 'file',
                size: stored.data.byteLength,
                modified: stored.modified,
            });
        });
        return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    async makeDirectory(dir: string): Promise<void> {
        const segments = farmPathSegments(dir);
        const db = await openDatabase();
        const transaction = db.transaction(DIRS, 'readwrite');
        const store = transaction.objectStore(DIRS);
        for (let index = 1; index <= segments.length; index += 1) {
            store.put(true, this.key(segments.slice(0, index).join('/')));
        }
        await completed(transaction);
    }
}

export async function listBrowserFarms(): Promise<BrowserFarmRecord[]> {
    if (!browserStoreAvailable()) {
        return [];
    }
    const db = await openDatabase();
    const records = (await promised(
        db.transaction(FARMS, 'readonly').objectStore(FARMS).getAll(),
    )) as BrowserFarmRecord[];
    return records.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function registerBrowserFarm(record: BrowserFarmRecord): Promise<BrowserDirectory> {
    const db = await openDatabase();
    const transaction = db.transaction(FARMS, 'readwrite');
    transaction.objectStore(FARMS).put(record);
    await completed(transaction);
    return new BrowserDirectory(record.id, record.name);
}

export async function renameBrowserFarm(id: string, name: string): Promise<void> {
    const db = await openDatabase();
    const transaction = db.transaction(FARMS, 'readwrite');
    const store = transaction.objectStore(FARMS);
    const current = (await promised(store.get(id))) as BrowserFarmRecord | undefined;
    if (current) {
        store.put({ ...current, name });
    }
    await completed(transaction);
}

/** A real folder the user opened before. Chrome keeps the handle, not the path. */
export interface DeviceFarmRecord {
    id: string;
    name: string;
    opened_at: string;
    handle: FileSystemDirectoryHandle;
}

export async function rememberDeviceFarm(record: DeviceFarmRecord): Promise<void> {
    const db = await openDatabase();
    const transaction = db.transaction(HANDLES, 'readwrite');
    transaction.objectStore(HANDLES).put(record);
    await completed(transaction);
}

export async function listDeviceFarms(): Promise<DeviceFarmRecord[]> {
    if (!browserStoreAvailable()) {
        return [];
    }
    const db = await openDatabase();
    const records = (await promised(
        db.transaction(HANDLES, 'readonly').objectStore(HANDLES).getAll(),
    )) as DeviceFarmRecord[];
    return records.sort((a, b) => b.opened_at.localeCompare(a.opened_at));
}

export async function forgetDeviceFarm(id: string): Promise<void> {
    const db = await openDatabase();
    const transaction = db.transaction(HANDLES, 'readwrite');
    transaction.objectStore(HANDLES).delete(id);
    await completed(transaction);
}

export async function deleteBrowserFarm(id: string): Promise<void> {
    const db = await openDatabase();
    const transaction = db.transaction([FARMS, FILES, DIRS], 'readwrite');
    transaction.objectStore(FARMS).delete(id);
    const range = IDBKeyRange.bound([id, ''], [id, '\uffff']);
    transaction.objectStore(FILES).delete(range);
    transaction.objectStore(DIRS).delete(range);
    await completed(transaction);
}
