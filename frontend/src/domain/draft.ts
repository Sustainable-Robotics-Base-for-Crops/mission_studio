import {
    cloneJson,
    getTotalPointsCount,
    MAX_POINTS_PER_SECTION,
    MAX_POINTS_PER_TRAJECTORY,
    parseAgriDocument,
    type AgriDocument,
    type AgriSection,
} from './agri';
import { latLngToLocal, localToLatLng, round3, type LatLng, type Wgs84Origin } from './geometry';
import { clipSectionsOutsidePolygon, generateRowLineFromLatLngs } from './section';
import { connectNewRowLines, type ConnectTurnsParams, type TurnReserveOptions } from './turns';
import { generateParallelRowLines } from './coverage';
import {
    applyWorkingZoneInPolygon,
    appendWorkingZoneRing,
    polygonLocalFromLatLngs,
    rebaseWorkingZoneRings,
} from './working-zone';

export type DrawLineFailure = 'too_few_points' | 'section_limit' | 'trajectory_limit';

export type DrawLineResult =
    { ok: true; document: AgriDocument; added: number } | { ok: false; reason: DrawLineFailure };

const DEFAULT_ORIGIN: Wgs84Origin = { lat: 48.8566, lon: 2.3522 };

export function roundOriginLatLon(lat: number, lon: number): Wgs84Origin {
    return {
        lat: Math.round(lat * 100) / 100,
        lon: Math.round(lon * 100) / 100,
    };
}

export function createEmptyDocument(): AgriDocument {
    return {
        version: '3',
        file_type: 'mission_order',
        vehicle_id: 'v1',
        metadata: {},
        origin: {
            type: 'WGS84',
            coordinates: { lat: DEFAULT_ORIGIN.lat, lon: DEFAULT_ORIGIN.lon, alt: 0 },
        },
        points: [],
        geofencing: null,
    };
}

export function documentOrigin(document: AgriDocument | null | undefined): Wgs84Origin | null {
    const lat = Number(document?.origin?.coordinates?.lat);
    const lon = Number(document?.origin?.coordinates?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
    }
    return { lat, lon };
}

function rebaseRows(
    section: { columns: string[]; values: AgriSection['values'] },
    previous: Wgs84Origin,
    next: Wgs84Origin,
): AgriSection['values'] {
    const xIndex = section.columns.indexOf('x');
    const yIndex = section.columns.indexOf('y');
    if (xIndex < 0 || yIndex < 0) {
        return section.values;
    }
    return section.values.map((row) => {
        const x = Number(row[xIndex]);
        const y = Number(row[yIndex]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return row;
        }
        const geo = localToLatLng({ x, y }, previous);
        const local = latLngToLocal(geo, next);
        const nextRow = [...row];
        nextRow[xIndex] = round3(local.x);
        nextRow[yIndex] = round3(local.y);
        return nextRow;
    });
}

export function rebaseDocument(
    document: AgriDocument,
    previous: Wgs84Origin,
    next: Wgs84Origin,
): AgriDocument {
    if (previous.lat === next.lat && previous.lon === next.lon) {
        return document;
    }
    const geofencing = document.geofencing;
    const nextGeofencing =
        geofencing !== null &&
        typeof geofencing === 'object' &&
        Array.isArray((geofencing as AgriSection).values) &&
        Array.isArray((geofencing as AgriSection).columns)
            ? {
                  ...(geofencing as AgriSection),
                  values: rebaseRows(geofencing as AgriSection, previous, next),
              }
            : geofencing;
    const rebased: AgriDocument = {
        ...document,
        origin: {
            ...(document.origin ?? {}),
            type: document.origin?.type ?? 'WGS84',
            coordinates: {
                ...(document.origin?.coordinates ?? {}),
                lat: next.lat,
                lon: next.lon,
                alt: Number(document.origin?.coordinates?.alt) || 0,
            },
        },
        points: document.points.map((section) => ({
            ...section,
            values: rebaseRows(section, previous, next),
        })),
        geofencing: nextGeofencing,
    };
    return rebaseWorkingZoneRings(rebased, (x, y) => {
        const geo = localToLatLng({ x, y }, previous);
        const local = latLngToLocal(geo, next);
        return [round3(local.x), round3(local.y)];
    });
}

function openWorkingDocument(
    document: AgriDocument | null | undefined,
    first: LatLng,
): AgriDocument | null {
    let working = parseAgriDocument(document) ?? createEmptyDocument();
    working = cloneJson(working);
    if (!Array.isArray(working.points)) {
        working.points = [];
    }
    if (working.points.length === 0) {
        const previous = documentOrigin(working) ?? DEFAULT_ORIGIN;
        working = rebaseDocument(working, previous, roundOriginLatLon(first.lat, first.lng));
    }
    return documentOrigin(working) ? working : null;
}

/** Straight polyline for nav_line_matcher: one vertex per click, no 0.1 m densify. */
export function appendDrawnLine(
    document: AgriDocument | null | undefined,
    latLngPoints: LatLng[],
): DrawLineResult {
    if (latLngPoints.length < 2) {
        return { ok: false, reason: 'too_few_points' };
    }
    const first = latLngPoints[0];
    if (!first) {
        return { ok: false, reason: 'too_few_points' };
    }
    const working = openWorkingDocument(document, first);
    const origin = documentOrigin(working);
    if (!working || !origin) {
        return { ok: false, reason: 'too_few_points' };
    }
    const estimated = latLngPoints.length;
    if (estimated > MAX_POINTS_PER_SECTION) {
        return { ok: false, reason: 'section_limit' };
    }
    if (getTotalPointsCount(working) + estimated > MAX_POINTS_PER_TRAJECTORY) {
        return { ok: false, reason: 'trajectory_limit' };
    }
    const section = generateRowLineFromLatLngs(latLngPoints, origin);
    if (!section) {
        return { ok: false, reason: 'too_few_points' };
    }
    return {
        ok: true,
        document: { ...working, points: [...working.points, section] },
        added: section.values.length,
    };
}

export type DrawPolygonResult =
    { ok: true; document: AgriDocument; added: number } | { ok: false; reason: 'too_few_points' };

/** Same as TrajectoryEditor.finishGeofence: one Agri polygon, last draw wins. */
export function setDrawnGeofence(
    document: AgriDocument | null | undefined,
    latLngPoints: LatLng[],
): DrawPolygonResult {
    if (latLngPoints.length < 3) {
        return { ok: false, reason: 'too_few_points' };
    }
    const first = latLngPoints[0];
    if (!first) {
        return { ok: false, reason: 'too_few_points' };
    }
    const working = openWorkingDocument(document, first);
    const origin = documentOrigin(working);
    if (!working || !origin) {
        return { ok: false, reason: 'too_few_points' };
    }
    const values = latLngPoints.map((point) => {
        const local = latLngToLocal(point, origin);
        return [round3(local.x), round3(local.y)];
    });
    return {
        ok: true,
        document: {
            ...working,
            geofencing: { columns: ['x', 'y'], values },
        },
        added: values.length,
    };
}

export type PolygonMutationFailure = 'too_few_points' | 'no_origin';

export type PolygonMutationResult =
    | { ok: true; document: AgriDocument; count: number }
    | { ok: false; reason: PolygonMutationFailure };

function documentForPolygonEdit(
    document: AgriDocument | null | undefined,
): { document: AgriDocument; origin: Wgs84Origin } | null {
    const working = parseAgriDocument(document);
    const origin = documentOrigin(working);
    if (!working || !origin) {
        return null;
    }
    return { document: cloneJson(working), origin };
}

/** Same as TrajectoryEditor.confirmWorkingZoneEdit: 1 = work, 0 = transit. */
export function applyDrawnWorkingZone(
    document: AgriDocument | null | undefined,
    latLngPoints: LatLng[],
    value: 0 | 1,
): PolygonMutationResult {
    if (latLngPoints.length < 3) {
        return { ok: false, reason: 'too_few_points' };
    }
    const opened = documentForPolygonEdit(document);
    if (!opened) {
        return { ok: false, reason: 'no_origin' };
    }
    const polygon = polygonLocalFromLatLngs(latLngPoints, opened.origin);
    const result = applyWorkingZoneInPolygon(opened.document, polygon, value);
    return {
        ok: true,
        document: appendWorkingZoneRing(result.document, polygon, value),
        count: result.count,
    };
}

/**
 * Cut tool: clip polylines against the drawn polygon (keep outside).
 * Vertex-only delete misses Studio `row_line`s (2 endpoints on the parcel
 * edge) when the cut sits in the middle of the rows.
 */
export function deleteDrawnPointsInPolygon(
    document: AgriDocument | null | undefined,
    latLngPoints: LatLng[],
): PolygonMutationResult {
    if (latLngPoints.length < 3) {
        return { ok: false, reason: 'too_few_points' };
    }
    const opened = documentForPolygonEdit(document);
    if (!opened) {
        return { ok: false, reason: 'no_origin' };
    }
    const polygon = polygonLocalFromLatLngs(latLngPoints, opened.origin);
    if (!polygon) {
        return { ok: false, reason: 'too_few_points' };
    }
    const clipped = clipSectionsOutsidePolygon(opened.document.points, polygon);
    return {
        ok: true,
        document: { ...opened.document, points: clipped.sections },
        count: clipped.changed,
    };
}

export type FillParcelFailure =
    | 'too_few_points'
    | 'no_origin'
    | 'invalid_spacing'
    | 'empty_fill'
    | 'section_limit'
    | 'trajectory_limit';

export type FillParcelResult =
    | { ok: true; document: AgriDocument; rows: number; points: number }
    | { ok: false; reason: FillParcelFailure };

export function ensureWorkingDocument(
    document: AgriDocument | null | undefined,
    first: LatLng,
): AgriDocument | null {
    return openWorkingDocument(document, first);
}

export function appendCoverageSections(
    document: AgriDocument | null | undefined,
    first: LatLng,
    sections: AgriSection[],
    coverage: Record<string, unknown>,
): FillParcelResult {
    if (first == null) {
        return { ok: false, reason: 'too_few_points' };
    }
    const working = openWorkingDocument(document, first);
    if (!working || !documentOrigin(working)) {
        return { ok: false, reason: 'no_origin' };
    }
    const usable = sections.filter(
        (section) => Array.isArray(section.values) && section.values.length >= 2,
    );
    if (usable.length === 0) {
        return { ok: false, reason: 'empty_fill' };
    }
    let added = 0;
    for (const section of usable) {
        if (section.values.length > MAX_POINTS_PER_SECTION) {
            return { ok: false, reason: 'section_limit' };
        }
        added += section.values.length;
    }
    if (getTotalPointsCount(working) + added > MAX_POINTS_PER_TRAJECTORY) {
        return { ok: false, reason: 'trajectory_limit' };
    }
    const metadata =
        working.metadata !== null && typeof working.metadata === 'object'
            ? { ...(working.metadata as Record<string, unknown>) }
            : {};
    return {
        ok: true,
        document: {
            ...working,
            points: [...working.points, ...usable],
            metadata: { ...metadata, srbc_coverage: coverage },
        },
        rows: usable.length,
        points: added,
    };
}

export function prependCoverageHeadlands(
    result: FillParcelResult,
    headlands: AgriSection[],
): FillParcelResult {
    if (!result.ok || headlands.length === 0) {
        return result;
    }
    const usable = headlands.filter(
        (section) => Array.isArray(section.values) && section.values.length >= 2,
    );
    if (usable.length === 0) {
        return result;
    }
    let added = 0;
    for (const section of usable) {
        if (section.values.length > MAX_POINTS_PER_SECTION) {
            return { ok: false, reason: 'section_limit' };
        }
        added += section.values.length;
    }
    if (getTotalPointsCount(result.document) + added > MAX_POINTS_PER_TRAJECTORY) {
        return { ok: false, reason: 'trajectory_limit' };
    }
    return {
        ok: true,
        document: {
            ...result.document,
            points: [...usable, ...result.document.points],
        },
        rows: result.rows + usable.length,
        points: result.points + added,
    };
}

/** Reproject coverage XY from the planner origin onto the Agri document origin. */
export function alignCoverageSections(
    sections: AgriSection[],
    from: Wgs84Origin,
    to: Wgs84Origin,
): AgriSection[] {
    if (from.lat === to.lat && from.lon === to.lon) {
        return sections;
    }
    const stub = createEmptyDocument();
    return rebaseDocument(
        {
            ...stub,
            origin: {
                type: 'WGS84',
                coordinates: { lat: from.lat, lon: from.lon, alt: 0 },
            },
            points: sections,
        },
        from,
        to,
    ).points;
}

export type ConnectedCoverageResult =
    | { ok: true; document: AgriDocument; rows: number; points: number; turns: number }
    | { ok: false; reason: FillParcelFailure };

/**
 * Append a new coverage block (optional fourrière + interior rows + turns)
 * without stitching it to rows already present in the document.
 */
export function appendConnectedCoverage(
    document: AgriDocument | null | undefined,
    first: LatLng,
    interior: AgriSection[],
    headlands: AgriSection[],
    coverage: Record<string, unknown>,
    connectParams: ConnectTurnsParams | null,
    planOrigin?: Wgs84Origin | null,
    reserve?: TurnReserveOptions,
): ConnectedCoverageResult {
    if (first == null) {
        return { ok: false, reason: 'too_few_points' };
    }
    const working = openWorkingDocument(document, first);
    const origin = documentOrigin(working);
    if (!working || !origin) {
        return { ok: false, reason: 'no_origin' };
    }
    const from =
        planOrigin && Number.isFinite(planOrigin.lat) && Number.isFinite(planOrigin.lon)
            ? planOrigin
            : origin;
    const alignedInterior = alignCoverageSections(interior, from, origin);
    const alignedHeadlands = alignCoverageSections(headlands, from, origin);
    const usableInterior = alignedInterior.filter(
        (section) => Array.isArray(section.values) && section.values.length >= 2,
    );
    const usableHeadlands = alignedHeadlands.filter(
        (section) => Array.isArray(section.values) && section.values.length >= 2,
    );
    if (usableInterior.length === 0) {
        return { ok: false, reason: 'empty_fill' };
    }
    const stitched = connectParams
        ? connectNewRowLines(usableInterior, connectParams, reserve)
        : { sections: usableInterior, turns: 0 };
    const addedSections = [...usableHeadlands, ...stitched.sections];
    let added = 0;
    for (const section of addedSections) {
        if (section.values.length > MAX_POINTS_PER_SECTION) {
            return { ok: false, reason: 'section_limit' };
        }
        added += section.values.length;
    }
    if (getTotalPointsCount(working) + added > MAX_POINTS_PER_TRAJECTORY) {
        return { ok: false, reason: 'trajectory_limit' };
    }
    const metadata =
        working.metadata !== null && typeof working.metadata === 'object'
            ? { ...(working.metadata as Record<string, unknown>) }
            : {};
    return {
        ok: true,
        document: {
            ...working,
            points: [...working.points, ...addedSections],
            metadata: { ...metadata, srbc_coverage: coverage },
        },
        rows: usableInterior.length,
        points: added,
        turns: stitched.turns,
    };
}

/** Parallel `row_line` sections inside a polygon (Studio). `/app` still densifies. */
export function fillDrawnParcel(
    document: AgriDocument | null | undefined,
    latLngPoints: LatLng[],
    spacing: number,
): FillParcelResult {
    if (latLngPoints.length < 3) {
        return { ok: false, reason: 'too_few_points' };
    }
    if (!(spacing > 0) || !Number.isFinite(spacing)) {
        return { ok: false, reason: 'invalid_spacing' };
    }
    const first = latLngPoints[0];
    if (!first) {
        return { ok: false, reason: 'too_few_points' };
    }
    const working = openWorkingDocument(document, first);
    const origin = documentOrigin(working);
    if (!working || !origin) {
        return { ok: false, reason: 'no_origin' };
    }
    const sections = generateParallelRowLines(latLngPoints, origin, spacing);
    if (sections.length === 0) {
        return { ok: false, reason: 'empty_fill' };
    }
    let added = 0;
    for (const section of sections) {
        if (section.values.length > MAX_POINTS_PER_SECTION) {
            return { ok: false, reason: 'section_limit' };
        }
        added += section.values.length;
    }
    if (getTotalPointsCount(working) + added > MAX_POINTS_PER_TRAJECTORY) {
        return { ok: false, reason: 'trajectory_limit' };
    }
    return {
        ok: true,
        document: { ...working, points: [...working.points, ...sections] },
        rows: sections.length,
        points: added,
    };
}
