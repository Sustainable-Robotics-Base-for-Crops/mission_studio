/**
 * Mission publications of the open farm (L11, D15-04): immutable versions kept in
 * `mission_order/.versions/`. No server round trip.
 */

import type { AgriDocument } from '../domain/agri';
import type { SimAttestation } from '../domain/publication';
import { currentSession, requireSession } from '../farmstore/session';

export interface PublicationMobile {
    synced_at: string | null;
    downloaded_at: string | null;
    received_at: string | null;
    preflight_at: string | null;
    activated_at: string | null;
}

export interface PublicationRecord {
    id: string;
    source_path: string;
    version: number;
    status: 'published' | 'obsolete' | string;
    checksum: string;
    byte_size: number;
    simulation: Record<string, unknown>;
    approver: string;
    published_at: string;
    expires_at: string | null;
    vehicle_id: string | null;
    field_id: string | null;
    combination_id: string | null;
    mobile: PublicationMobile;
    snapshot?: AgriDocument;
}

export async function fetchPublicationHealth(): Promise<boolean> {
    return currentSession() !== null;
}

export async function listPublications(sourcePath?: string | null): Promise<PublicationRecord[]> {
    return requireSession().publications.list(sourcePath);
}

export async function createPublication(payload: {
    source_path: string;
    document: AgriDocument;
    simulation: SimAttestation;
    stale: boolean;
    approver: string;
    expires_at: string | null;
    vehicle_id?: string | null;
    field_id?: string | null;
    combination_id?: string | null;
}): Promise<PublicationRecord> {
    return requireSession().publications.create({
        ...payload,
        document: payload.document as unknown as Record<string, unknown>,
        simulation: payload.simulation as unknown as Record<string, unknown>,
    });
}
