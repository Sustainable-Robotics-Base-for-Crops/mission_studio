/** Versioned publication eligibility (lot L11). Pure, no DOM, no Agri mutation. */

export const PUBLISH_IMMUTABLE = [
    'trajectory',
    'geofence',
    'twin',
    'odd',
    'simulation',
    'checksum',
    'version',
    'expiry',
] as const;

export type PublishImmutableItem = (typeof PUBLISH_IMMUTABLE)[number];

export type MissionLifecycle =
    | 'draft'
    | 'incomplete'
    | 'ready_to_simulate'
    | 'simulation_blocked'
    | 'validated'
    | 'published'
    | 'obsolete';

export type PublishBlockReason =
    'no_document' | 'empty' | 'no_sim' | 'stale' | 'blocked' | 'no_backend';

export interface PublicationStamp {
    id: string;
    version: number;
    checksum: string;
    published_at: string;
    expires_at: string | null;
}

export interface SimAttestation {
    passCount: number;
    warnCount: number;
    blockCount: number;
    length_m: number;
    duration_s: number;
    fingerprint: string;
    coveragePct?: number | null;
    gapPct?: number | null;
    overlapPct?: number | null;
    work_s?: number | null;
    maneuver_s?: number | null;
    transit_s?: number | null;
}

export function defaultExpiryIso(now = new Date(), days = 90): string {
    const next = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return next.toISOString().slice(0, 10);
}

export function readPublicationStamp(document: unknown): PublicationStamp | null {
    if (document === null || typeof document !== 'object') {
        return null;
    }
    const metadata = (document as { metadata?: unknown }).metadata;
    if (metadata === null || typeof metadata !== 'object') {
        return null;
    }
    const raw = (metadata as { srbc_publication?: unknown }).srbc_publication;
    if (raw === null || typeof raw !== 'object') {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const version = Number(record.version);
    if (typeof record.id !== 'string' || !record.id) {
        return null;
    }
    if (!Number.isInteger(version) || version < 1) {
        return null;
    }
    if (typeof record.checksum !== 'string' || !record.checksum) {
        return null;
    }
    if (typeof record.published_at !== 'string' || !record.published_at) {
        return null;
    }
    return {
        id: record.id,
        version,
        checksum: record.checksum,
        published_at: record.published_at,
        expires_at: typeof record.expires_at === 'string' ? record.expires_at : null,
    };
}

export function publishBlockReason(input: {
    hasDocument: boolean;
    sectionCount: number;
    hasBackend: boolean;
    sim: SimAttestation | null;
    stale: boolean;
}): PublishBlockReason | null {
    if (!input.hasBackend) {
        return 'no_backend';
    }
    if (!input.hasDocument) {
        return 'no_document';
    }
    if (input.sectionCount <= 0) {
        return 'empty';
    }
    if (!input.sim) {
        return 'no_sim';
    }
    if (input.stale) {
        return 'stale';
    }
    if (input.sim.blockCount > 0) {
        return 'blocked';
    }
    return null;
}

export function missionLifecycle(input: {
    hasDocument: boolean;
    sectionCount: number;
    sim: SimAttestation | null;
    stale: boolean;
    stamp: PublicationStamp | null;
    dirty: boolean;
}): MissionLifecycle {
    if (input.stamp && !input.dirty && !input.stale) {
        return 'published';
    }
    if (input.stamp && (input.dirty || input.stale)) {
        return 'obsolete';
    }
    if (!input.hasDocument || input.sectionCount <= 0) {
        return input.hasDocument ? 'incomplete' : 'draft';
    }
    if (!input.sim) {
        return 'ready_to_simulate';
    }
    if (input.stale) {
        return 'ready_to_simulate';
    }
    if (input.sim.blockCount > 0) {
        return 'simulation_blocked';
    }
    return 'validated';
}
