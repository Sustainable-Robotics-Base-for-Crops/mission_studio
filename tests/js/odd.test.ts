import { describe, expect, it } from 'vitest';

import {
    cropFamilyForOperation,
    defaultOddProfile,
    evaluateOddChecks,
    oemOddProfile,
    parseOddProfile,
    readOddFromDocument,
    type OddContext,
    type OddProfile,
} from '../../frontend/src/domain/odd';

function context(overrides: Partial<OddContext> = {}): OddContext {
    return {
        profile: oemOddProfile(),
        fieldQualified: null,
        declaredSlopePct: null,
        weatherNote: '',
        operation: 'hoeing',
        autonomyRings: [],
        forbiddenRings: [],
        ...overrides,
    };
}

const PATH = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
];

describe('parseOddProfile', () => {
    it('fills defaults and ignores unknown keys', () => {
        const parsed = parseOddProfile({ approved: true, weather: 'no_rain', junk: 1 });
        expect(parsed.approved).toBe(true);
        expect(parsed.weather).toBe('no_rain');
        expect(parsed.crop).toBe('any');
        expect(parsed.localization).toBe('rtk_required');
    });

    it('reads metadata.srbc_odd without touching Agri v3', () => {
        expect(readOddFromDocument({ metadata: { srbc_odd: { approved: true } } })?.approved).toBe(
            true,
        );
        expect(readOddFromDocument({ metadata: {} })).toBeNull();
    });
});

describe('evaluateOddChecks', () => {
    it('blocks when the combination has no ODD', () => {
        const checks = evaluateOddChecks({ context: context({ profile: null }), samples: PATH });
        expect(checks.find((item) => item.id === 'odd.profile')?.status).toBe('block');
        expect(checks.some((item) => item.id === 'odd.approved')).toBe(false);
    });

    it('blocks an unapproved profile (EQP-007)', () => {
        const profile: OddProfile = { ...defaultOddProfile(), approved: false };
        const checks = evaluateOddChecks({ context: context({ profile }), samples: PATH });
        expect(checks.find((item) => item.id === 'odd.approved')?.status).toBe('block');
        expect(checks.find((item) => item.id === 'odd.profile')?.status).toBe('pass');
    });

    it('passes the OEM SRBC envelope without inventing weather or slope', () => {
        const checks = evaluateOddChecks({ context: context(), samples: PATH });
        expect(checks.find((item) => item.id === 'odd.profile')?.status).toBe('pass');
        expect(checks.find((item) => item.id === 'odd.approved')?.status).toBe('pass');
        expect(checks.find((item) => item.id === 'odd.slope')?.status).toBe('skip');
        expect(checks.find((item) => item.id === 'odd.weather')?.status).toBe('pass');
        expect(checks.find((item) => item.id === 'odd.crop')?.status).toBe('pass');
        expect(checks.every((item) => item.status !== 'block')).toBe(true);
    });

    it('warns when ODD weather is constrained and the brief has no note', () => {
        const profile: OddProfile = { ...oemOddProfile(), weather: 'no_rain' };
        const empty = evaluateOddChecks({ context: context({ profile }), samples: PATH });
        expect(empty.find((item) => item.id === 'odd.weather')?.status).toBe('warn');
        const noted = evaluateOddChecks({
            context: context({ profile, weatherNote: 'sec, pas de vent' }),
            samples: PATH,
        });
        expect(noted.find((item) => item.id === 'odd.weather')?.status).toBe('pass');
    });

    it('blocks declared slope above the combination max', () => {
        const profile: OddProfile = { ...oemOddProfile(), max_slope_pct: 15 };
        const over = evaluateOddChecks({
            context: context({ profile, declaredSlopePct: 22 }),
            samples: PATH,
        });
        expect(over.find((item) => item.id === 'odd.slope')?.status).toBe('block');
        const ok = evaluateOddChecks({
            context: context({ profile, declaredSlopePct: 8 }),
            samples: PATH,
        });
        expect(ok.find((item) => item.id === 'odd.slope')?.status).toBe('pass');
    });

    it('blocks a path leaving the autonomy zone and a path entering a forbidden zone', () => {
        const square: [number, number][] = [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
        ];
        const outside = evaluateOddChecks({
            context: context({ autonomyRings: [square] }),
            samples: [
                { x: 1, y: 1 },
                { x: 9, y: 1 },
            ],
        });
        expect(outside.find((item) => item.id === 'odd.autonomyZone')?.status).toBe('block');
        expect(outside.find((item) => item.id === 'odd.autonomyZone')?.at).toEqual({ x: 9, y: 1 });

        const forbidden = evaluateOddChecks({
            context: context({ forbiddenRings: [square] }),
            samples: PATH,
        });
        expect(forbidden.find((item) => item.id === 'odd.forbiddenZone')?.status).toBe('block');
    });

    it('warns when the path enters a GNSS-degraded zone unless ODD allows it', () => {
        const square: [number, number][] = [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
        ];
        const warn = evaluateOddChecks({
            context: context({ gnssDegradedRings: [square] }),
            samples: PATH,
        });
        expect(warn.find((item) => item.id === 'odd.gnssDegraded')?.status).toBe('warn');
        const allowed = evaluateOddChecks({
            context: context({
                gnssDegradedRings: [square],
                profile: { ...oemOddProfile(), localization: 'degraded_ok' },
            }),
            samples: PATH,
        });
        expect(allowed.find((item) => item.id === 'odd.gnssDegraded')?.status).toBe('pass');
        const missing = evaluateOddChecks({ context: context(), samples: PATH });
        expect(missing.find((item) => item.id === 'odd.gnssDegraded')?.status).toBe('skip');
    });

    it('warns when the linked field is not qualified for autonomy', () => {
        const checks = evaluateOddChecks({
            context: context({ fieldQualified: false }),
            samples: PATH,
        });
        expect(checks.find((item) => item.id === 'odd.fieldAutonomy')?.status).toBe('warn');
    });

    it('warns on a crop family mismatch', () => {
        const profile: OddProfile = { ...oemOddProfile(), crop: 'vine' };
        const checks = evaluateOddChecks({
            context: context({ profile, operation: 'hoeing' }),
            samples: PATH,
        });
        expect(cropFamilyForOperation('hoeing')).toBe('open_field');
        expect(checks.find((item) => item.id === 'odd.crop')?.status).toBe('warn');
    });
});
