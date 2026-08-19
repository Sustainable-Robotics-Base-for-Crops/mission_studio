/** Operational Design Domain for a vehicle–implement combination (lot L10c / SIM-005). */

import { latLngToLocal, pointInPolygon, type LocalXy, type Wgs84Origin } from './geometry';

export const ODD_WEATHER = ['any', 'dry', 'no_rain', 'no_wind', 'clear'] as const;
export const ODD_VISIBILITY = ['day', 'day_night', 'any'] as const;
export const ODD_CROP = ['any', 'open_field', 'vine', 'orchard', 'vegetables'] as const;
export const ODD_LOCALIZATION = ['rtk_required', 'gnss_ok', 'degraded_ok'] as const;

export type OddWeather = (typeof ODD_WEATHER)[number];
export type OddVisibility = (typeof ODD_VISIBILITY)[number];
export type OddCrop = (typeof ODD_CROP)[number];
export type OddLocalization = (typeof ODD_LOCALIZATION)[number];
export type OddFreshness = 'declared' | 'missing';

export interface OddProfile {
    approved: boolean;
    max_slope_pct: number | null;
    weather: OddWeather;
    visibility: OddVisibility;
    crop: OddCrop;
    localization: OddLocalization;
    connectivity_required: boolean;
    soil_note: string;
}

export interface OddContext {
    profile: OddProfile | null;
    fieldQualified: boolean | null;
    declaredSlopePct: number | null;
    weatherNote: string;
    operation: string | null;
    autonomyRings: [number, number][][];
    forbiddenRings: [number, number][][];
    gnssDegradedRings?: [number, number][][];
}

export interface OddCheckResult {
    id: string;
    status: 'pass' | 'warn' | 'block' | 'skip';
    measured: string | number | null;
    threshold: string | number | null;
    source: string;
    freshness: OddFreshness;
    sampleIndex: number | null;
    at: LocalXy | null;
}

export function defaultOddProfile(approved = false): OddProfile {
    return {
        approved,
        max_slope_pct: approved ? 15 : null,
        weather: 'any',
        visibility: 'day',
        crop: 'any',
        localization: 'rtk_required',
        connectivity_required: false,
        soil_note: '',
    };
}

/** OEM SRBC declared envelope — no live weather / DEM. */
export function oemOddProfile(): OddProfile {
    return defaultOddProfile(true);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value)
        ? (value as T)
        : fallback;
}

export function parseOddProfile(raw: unknown): OddProfile {
    const record = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const slope = Number(record.max_slope_pct);
    return {
        approved: record.approved === true,
        max_slope_pct: Number.isFinite(slope) && slope >= 0 ? slope : null,
        weather: oneOf(record.weather, ODD_WEATHER, 'any'),
        visibility: oneOf(record.visibility, ODD_VISIBILITY, 'day'),
        crop: oneOf(record.crop, ODD_CROP, 'any'),
        localization: oneOf(record.localization, ODD_LOCALIZATION, 'rtk_required'),
        connectivity_required: record.connectivity_required === true,
        soil_note: typeof record.soil_note === 'string' ? record.soil_note : '',
    };
}

export function readOddFromDocument(document: unknown): OddProfile | null {
    if (document === null || typeof document !== 'object') {
        return null;
    }
    const metadata = (document as { metadata?: unknown }).metadata;
    if (metadata === null || typeof metadata !== 'object') {
        return null;
    }
    const raw = (metadata as { srbc_odd?: unknown }).srbc_odd;
    if (raw === null || raw === undefined) {
        return null;
    }
    return parseOddProfile(raw);
}

export function cropFamilyForOperation(operation: string | null): OddCrop {
    if (operation === 'inspection') {
        return 'any';
    }
    return 'open_field';
}

function result(partial: OddCheckResult): OddCheckResult {
    return partial;
}

function firstOutsideRing(
    samples: ReadonlyArray<LocalXy>,
    rings: [number, number][][],
): { sampleIndex: number; at: LocalXy } | null {
    for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index];
        if (!sample) {
            continue;
        }
        const inside = rings.some((ring) => pointInPolygon(sample.x, sample.y, ring));
        if (!inside) {
            return { sampleIndex: index, at: sample };
        }
    }
    return null;
}

function firstInsideRing(
    samples: ReadonlyArray<LocalXy>,
    rings: [number, number][][],
): { sampleIndex: number; at: LocalXy } | null {
    for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index];
        if (!sample) {
            continue;
        }
        if (rings.some((ring) => pointInPolygon(sample.x, sample.y, ring))) {
            return { sampleIndex: index, at: sample };
        }
    }
    return null;
}

/**
 * SIM-005 / EQP-007 on declared data only.
 * No weather API, no DEM, no live RTK — those stay skip with an explicit source.
 */
export function evaluateOddChecks(input: {
    context: OddContext;
    samples: ReadonlyArray<LocalXy>;
}): OddCheckResult[] {
    const { context, samples } = input;
    const profile = context.profile;
    const checks: OddCheckResult[] = [];

    if (profile === null) {
        checks.push(
            result({
                id: 'odd.profile',
                status: 'block',
                measured: 0,
                threshold: 1,
                source: 'combination',
                freshness: 'missing',
                sampleIndex: null,
                at: null,
            }),
        );
    } else {
        checks.push(
            result({
                id: 'odd.profile',
                status: 'pass',
                measured: 1,
                threshold: 1,
                source: 'combination',
                freshness: 'declared',
                sampleIndex: null,
                at: null,
            }),
        );
        checks.push(
            result({
                id: 'odd.approved',
                status: profile.approved ? 'pass' : 'block',
                measured: profile.approved ? 1 : 0,
                threshold: 1,
                source: 'combination',
                freshness: 'declared',
                sampleIndex: null,
                at: null,
            }),
        );
    }

    if (context.fieldQualified === null) {
        checks.push(
            result({
                id: 'odd.fieldAutonomy',
                status: 'skip',
                measured: null,
                threshold: null,
                source: 'catalogue',
                freshness: 'missing',
                sampleIndex: null,
                at: null,
            }),
        );
    } else {
        checks.push(
            result({
                id: 'odd.fieldAutonomy',
                status: context.fieldQualified ? 'pass' : 'warn',
                measured: context.fieldQualified ? 1 : 0,
                threshold: 1,
                source: 'catalogue',
                freshness: 'declared',
                sampleIndex: null,
                at: null,
            }),
        );
    }

    if (context.autonomyRings.length === 0) {
        checks.push(
            result({
                id: 'odd.autonomyZone',
                status: 'skip',
                measured: 0,
                threshold: 1,
                source: 'catalogue',
                freshness: 'missing',
                sampleIndex: null,
                at: null,
            }),
        );
    } else {
        const outside = firstOutsideRing(samples, context.autonomyRings);
        checks.push(
            result({
                id: 'odd.autonomyZone',
                status: outside ? 'block' : 'pass',
                measured: outside ? 0 : 1,
                threshold: 1,
                source: 'catalogue',
                freshness: 'declared',
                sampleIndex: outside?.sampleIndex ?? null,
                at: outside?.at ?? null,
            }),
        );
    }

    if (context.forbiddenRings.length === 0) {
        checks.push(
            result({
                id: 'odd.forbiddenZone',
                status: 'skip',
                measured: 0,
                threshold: 0,
                source: 'catalogue',
                freshness: 'missing',
                sampleIndex: null,
                at: null,
            }),
        );
    } else {
        const hit = firstInsideRing(samples, context.forbiddenRings);
        checks.push(
            result({
                id: 'odd.forbiddenZone',
                status: hit ? 'block' : 'pass',
                measured: hit ? 1 : 0,
                threshold: 0,
                source: 'catalogue',
                freshness: 'declared',
                sampleIndex: hit?.sampleIndex ?? null,
                at: hit?.at ?? null,
            }),
        );
    }

    const gnssRings = context.gnssDegradedRings ?? [];
    if (gnssRings.length === 0) {
        checks.push(
            result({
                id: 'odd.gnssDegraded',
                status: 'skip',
                measured: 0,
                threshold: 0,
                source: 'catalogue',
                freshness: 'missing',
                sampleIndex: null,
                at: null,
            }),
        );
    } else {
        const hit = firstInsideRing(samples, gnssRings);
        const allowed = profile?.localization === 'degraded_ok';
        checks.push(
            result({
                id: 'odd.gnssDegraded',
                status: !hit ? 'pass' : allowed ? 'pass' : 'warn',
                measured: hit ? 1 : 0,
                threshold: 0,
                source: 'catalogue',
                freshness: 'declared',
                sampleIndex: hit?.sampleIndex ?? null,
                at: hit?.at ?? null,
            }),
        );
    }

    if (profile === null) {
        return checks;
    }

    if (profile.max_slope_pct === null) {
        checks.push(
            result({
                id: 'odd.slope',
                status: 'skip',
                measured: null,
                threshold: null,
                source: 'combination',
                freshness: 'missing',
                sampleIndex: null,
                at: null,
            }),
        );
    } else if (context.declaredSlopePct === null) {
        checks.push(
            result({
                id: 'odd.slope',
                status: 'skip',
                measured: null,
                threshold: profile.max_slope_pct,
                source: 'catalogue',
                freshness: 'missing',
                sampleIndex: null,
                at: null,
            }),
        );
    } else {
        const over = context.declaredSlopePct > profile.max_slope_pct + 1e-6;
        const close = !over && context.declaredSlopePct > profile.max_slope_pct * 0.8;
        checks.push(
            result({
                id: 'odd.slope',
                status: over ? 'block' : close ? 'warn' : 'pass',
                measured: Number(context.declaredSlopePct.toFixed(1)),
                threshold: profile.max_slope_pct,
                source: 'catalogue',
                freshness: 'declared',
                sampleIndex: null,
                at: null,
            }),
        );
    }

    if (profile.weather === 'any') {
        checks.push(
            result({
                id: 'odd.weather',
                status: 'pass',
                measured: profile.weather,
                threshold: 'any',
                source: 'combination',
                freshness: 'declared',
                sampleIndex: null,
                at: null,
            }),
        );
    } else if (!context.weatherNote.trim()) {
        checks.push(
            result({
                id: 'odd.weather',
                status: 'warn',
                measured: 0,
                threshold: profile.weather,
                source: 'brief',
                freshness: 'missing',
                sampleIndex: null,
                at: null,
            }),
        );
    } else {
        checks.push(
            result({
                id: 'odd.weather',
                status: 'pass',
                measured: context.weatherNote.trim().slice(0, 40),
                threshold: profile.weather,
                source: 'brief',
                freshness: 'declared',
                sampleIndex: null,
                at: null,
            }),
        );
    }

    const family = cropFamilyForOperation(context.operation);
    if (profile.crop === 'any' || family === 'any' || profile.crop === family) {
        checks.push(
            result({
                id: 'odd.crop',
                status: 'pass',
                measured: family,
                threshold: profile.crop,
                source: 'brief',
                freshness: context.operation ? 'declared' : 'missing',
                sampleIndex: null,
                at: null,
            }),
        );
    } else {
        checks.push(
            result({
                id: 'odd.crop',
                status: 'warn',
                measured: family,
                threshold: profile.crop,
                source: 'brief',
                freshness: 'declared',
                sampleIndex: null,
                at: null,
            }),
        );
    }

    checks.push(
        result({
            id: 'odd.visibility',
            status: 'pass',
            measured: profile.visibility,
            threshold: profile.visibility,
            source: 'combination',
            freshness: 'declared',
            sampleIndex: null,
            at: null,
        }),
    );
    checks.push(
        result({
            id: 'odd.localization',
            status: 'pass',
            measured: profile.localization,
            threshold: profile.localization,
            source: 'combination',
            freshness: 'declared',
            sampleIndex: null,
            at: null,
        }),
    );

    return checks;
}

export function geojsonRingToLocal(
    geometry: { coordinates?: number[][][] } | null | undefined,
    origin: Wgs84Origin,
): [number, number][] {
    const ring = geometry?.coordinates?.[0];
    if (!Array.isArray(ring)) {
        return [];
    }
    const local: [number, number][] = [];
    for (const pair of ring) {
        if (!Array.isArray(pair) || pair.length < 2) {
            continue;
        }
        const lng = Number(pair[0]);
        const lat = Number(pair[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            continue;
        }
        const point = latLngToLocal({ lat, lng }, origin);
        local.push([point.x, point.y]);
    }
    if (local.length >= 2) {
        const first = local[0];
        const last = local[local.length - 1];
        if (first && last && first[0] === last[0] && first[1] === last[1]) {
            local.pop();
        }
    }
    return local.length >= 3 ? local : [];
}

export function oddFingerprint(context: OddContext | null | undefined): string {
    if (!context) {
        return 'none';
    }
    return JSON.stringify({
        p: context.profile,
        q: context.fieldQualified,
        s: context.declaredSlopePct,
        w: context.weatherNote,
        o: context.operation,
        a: context.autonomyRings.length,
        f: context.forbiddenRings.length,
    });
}
