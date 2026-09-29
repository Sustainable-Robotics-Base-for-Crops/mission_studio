/**
 * Immutable mission publications (lot L11, D15-04), browser side.
 *
 * The mission file in `mission_order/` carries the stamp of its latest publication
 * (`metadata.srbc_publication`, written by the editor). Every published version is
 * kept, never rewritten, in `mission_order/.versions/<mission>/v<N>.json`: the robot
 * only reads the top of `mission_order/`, so it never sees these copies.
 */

import type { PublicationRecord } from '../publication/api';
import { CatalogueError } from './field-catalogue';
import { joinFarmPath, readJsonObject, writeJson, type FarmDirectory } from './fs';
import { canonicalJson, sha256Hex } from './geometry';
import { nowIso, slugify } from './layout';

const VERSIONS_DIR = 'mission_order/.versions';
const VERSION_FILE = /^v(\d+)\.json$/;

type Json = Record<string, unknown>;

function record(value: unknown): Json {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Json)
        : {};
}

/** Folder of one mission's versions, from its farm path (`mission_order/x.json` → `x`). */
export function versionsFolder(sourcePath: string): string {
    const base = sourcePath.split('/').pop() ?? sourcePath;
    const stem = base.replace(/\.json$/i, '');
    const safe = /^[A-Za-z0-9._-]{1,120}$/.test(stem) && !stem.startsWith('.') ? stem : '';
    return joinFarmPath(VERSIONS_DIR, safe || slugify(stem, 'mission', 80));
}

/** Bytes hashed for the checksum: the document without its own publication stamp. */
export function canonicalBytes(document: Json): Uint8Array {
    const metadata = { ...record(document.metadata) };
    delete metadata.srbc_publication;
    return new TextEncoder().encode(canonicalJson({ ...document, metadata }));
}

export async function checksumOf(document: Json): Promise<{ checksum: string; size: number }> {
    const bytes = canonicalBytes(document);
    return { checksum: await sha256Hex(bytes), size: bytes.byteLength };
}

const EMPTY_MOBILE: PublicationRecord['mobile'] = {
    synced_at: null,
    downloaded_at: null,
    received_at: null,
    preflight_at: null,
    activated_at: null,
};

function toRecord(snapshot: Json, latest: boolean, withSnapshot: boolean): PublicationRecord {
    const stamp = record(record(snapshot.metadata).srbc_publication);
    const packet = record(stamp.packet);
    const result: PublicationRecord = {
        id: String(stamp.id ?? ''),
        source_path: String(stamp.source_path ?? ''),
        version: Number(stamp.version ?? 0),
        status: latest ? 'published' : 'obsolete',
        checksum: String(stamp.checksum ?? ''),
        byte_size: Number(stamp.byte_size ?? 0),
        simulation: record(stamp.simulation),
        approver: String(stamp.approver ?? 'local'),
        published_at: String(stamp.published_at ?? ''),
        expires_at: typeof stamp.expires_at === 'string' ? stamp.expires_at : null,
        vehicle_id: typeof packet.vehicle_id === 'string' ? packet.vehicle_id : null,
        field_id: typeof packet.field_id === 'string' ? packet.field_id : null,
        combination_id: typeof packet.combination_id === 'string' ? packet.combination_id : null,
        mobile: { ...EMPTY_MOBILE },
    };
    if (withSnapshot) {
        result.snapshot = snapshot as unknown as PublicationRecord['snapshot'];
    }
    return result;
}

export interface PublishPayload {
    source_path: string;
    document: Json;
    simulation?: Json;
    stale?: boolean;
    approver?: string;
    expires_at?: string | null;
    vehicle_id?: string | null;
    field_id?: string | null;
    combination_id?: string | null;
}

export class PublicationStore {
    constructor(
        private readonly dir: FarmDirectory,
        private readonly clock: () => Date = () => new Date(),
    ) {}

    private async versionsOf(folder: string): Promise<Array<{ version: number; path: string }>> {
        const found: Array<{ version: number; path: string }> = [];
        for (const entry of await this.dir.list(folder)) {
            const match = entry.kind === 'file' ? VERSION_FILE.exec(entry.name) : null;
            if (match) {
                found.push({ version: Number(match[1]), path: joinFarmPath(folder, entry.name) });
            }
        }
        return found.sort((a, b) => b.version - a.version);
    }

    private async recordsIn(folder: string): Promise<PublicationRecord[]> {
        const versions = await this.versionsOf(folder);
        const records: PublicationRecord[] = [];
        for (const [index, item] of versions.entries()) {
            const snapshot = await readJsonObject(this.dir, item.path);
            if (snapshot) {
                records.push(toRecord(snapshot, index === 0, false));
            }
        }
        return records;
    }

    async list(sourcePath?: string | null): Promise<PublicationRecord[]> {
        if (sourcePath) {
            return this.recordsIn(versionsFolder(sourcePath));
        }
        const all: PublicationRecord[] = [];
        for (const entry of await this.dir.list(VERSIONS_DIR)) {
            if (entry.kind === 'directory') {
                all.push(...(await this.recordsIn(joinFarmPath(VERSIONS_DIR, entry.name))));
            }
        }
        return all.sort(
            (a, b) => b.published_at.localeCompare(a.published_at) || b.version - a.version,
        );
    }

    async create(payload: PublishPayload): Promise<PublicationRecord> {
        const document = payload.document;
        if (document === null || typeof document !== 'object') {
            throw new CatalogueError('document is required');
        }
        if (!Array.isArray(document.points) || document.points.length === 0) {
            throw new CatalogueError('document has no sections');
        }
        if (payload.stale === true) {
            throw new CatalogueError('simulation is stale — re-run Simuler');
        }
        const simulation = record(payload.simulation);
        const blockers = Number(simulation.blockCount ?? simulation.block_count ?? 0);
        if (blockers > 0) {
            throw new CatalogueError('publication blocked while simulation blockers remain');
        }
        const sourcePath = String(payload.source_path ?? '').trim();
        if (!sourcePath) {
            throw new CatalogueError('source_path is required');
        }
        const folder = versionsFolder(sourcePath);
        const version = ((await this.versionsOf(folder))[0]?.version ?? 0) + 1;
        const { checksum, size } = await checksumOf(document);
        const stamp: Json = {
            id: crypto.randomUUID(),
            version,
            checksum,
            published_at: nowIso(this.clock()),
            expires_at: payload.expires_at ? String(payload.expires_at).trim() : null,
            source_path: sourcePath,
            byte_size: size,
            approver: String(payload.approver ?? 'local').trim() || 'local',
            simulation,
            packet: {
                vehicle_id: payload.vehicle_id ?? document.vehicle_id ?? null,
                field_id: payload.field_id ?? null,
                combination_id: payload.combination_id ?? null,
            },
        };
        const snapshot: Json = {
            ...document,
            metadata: { ...record(document.metadata), srbc_publication: stamp },
        };
        await writeJson(this.dir, joinFarmPath(folder, `v${version}.json`), snapshot);
        return toRecord(snapshot, true, true);
    }
}
