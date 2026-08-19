import { describe, expect, it } from 'vitest';

import {
    defaultExpiryIso,
    missionLifecycle,
    publishBlockReason,
    readPublicationStamp,
} from '../../frontend/src/domain/publication';

describe('publishBlockReason', () => {
    const ok = {
        hasDocument: true,
        sectionCount: 2,
        hasBackend: true,
        sim: {
            passCount: 4,
            warnCount: 0,
            blockCount: 0,
            length_m: 10,
            duration_s: 20,
            fingerprint: 'abc',
        },
        stale: false,
    };

    it('allows publish when simulation is fresh and green', () => {
        expect(publishBlockReason(ok)).toBeNull();
    });

    it('blocks without FastAPI/SQLite, without a sim, when stale, or with blockers', () => {
        expect(publishBlockReason({ ...ok, hasBackend: false })).toBe('no_backend');
        expect(publishBlockReason({ ...ok, sim: null })).toBe('no_sim');
        expect(publishBlockReason({ ...ok, stale: true })).toBe('stale');
        expect(publishBlockReason({ ...ok, sim: { ...ok.sim, blockCount: 1 } })).toBe('blocked');
        expect(publishBlockReason({ ...ok, sectionCount: 0 })).toBe('empty');
    });
});

describe('missionLifecycle', () => {
    const stamp = {
        id: 'p1',
        version: 3,
        checksum: 'deadbeef',
        published_at: '2026-08-19T18:00:00Z',
        expires_at: '2026-11-17',
    };

    it('maps draft → ready → blocked → validated → published → obsolete', () => {
        expect(
            missionLifecycle({
                hasDocument: false,
                sectionCount: 0,
                sim: null,
                stale: false,
                stamp: null,
                dirty: false,
            }),
        ).toBe('draft');
        expect(
            missionLifecycle({
                hasDocument: true,
                sectionCount: 2,
                sim: null,
                stale: false,
                stamp: null,
                dirty: false,
            }),
        ).toBe('ready_to_simulate');
        expect(
            missionLifecycle({
                hasDocument: true,
                sectionCount: 2,
                sim: {
                    passCount: 1,
                    warnCount: 0,
                    blockCount: 1,
                    length_m: 1,
                    duration_s: 1,
                    fingerprint: 'x',
                },
                stale: false,
                stamp: null,
                dirty: false,
            }),
        ).toBe('simulation_blocked');
        expect(
            missionLifecycle({
                hasDocument: true,
                sectionCount: 2,
                sim: {
                    passCount: 4,
                    warnCount: 1,
                    blockCount: 0,
                    length_m: 1,
                    duration_s: 1,
                    fingerprint: 'x',
                },
                stale: false,
                stamp: null,
                dirty: false,
            }),
        ).toBe('validated');
        expect(
            missionLifecycle({
                hasDocument: true,
                sectionCount: 2,
                sim: {
                    passCount: 4,
                    warnCount: 0,
                    blockCount: 0,
                    length_m: 1,
                    duration_s: 1,
                    fingerprint: 'x',
                },
                stale: false,
                stamp,
                dirty: false,
            }),
        ).toBe('published');
        expect(
            missionLifecycle({
                hasDocument: true,
                sectionCount: 2,
                sim: {
                    passCount: 4,
                    warnCount: 0,
                    blockCount: 0,
                    length_m: 1,
                    duration_s: 1,
                    fingerprint: 'x',
                },
                stale: true,
                stamp,
                dirty: true,
            }),
        ).toBe('obsolete');
    });
});

describe('readPublicationStamp', () => {
    it('reads metadata.srbc_publication without a v4 schema', () => {
        expect(
            readPublicationStamp({
                metadata: {
                    srbc_publication: {
                        id: 'abc',
                        version: 2,
                        checksum: 'ff',
                        published_at: '2026-08-19T00:00:00Z',
                    },
                },
            }),
        ).toMatchObject({ id: 'abc', version: 2, checksum: 'ff' });
        expect(readPublicationStamp({ metadata: {} })).toBeNull();
    });

    it('defaults expiry to 90 days as YYYY-MM-DD', () => {
        expect(defaultExpiryIso(new Date('2026-08-19T12:00:00Z'))).toBe('2026-11-17');
    });
});
