import { COLOR } from '../design-system/tokens';

export type CatalogueOverlayId =
    'parcels' | 'zones' | 'obstacles' | 'rows' | 'guidance' | 'traffic' | 'landmarks';

export type CatalogueKind =
    | 'field'
    | 'agronomic_boundary'
    | 'workable'
    | 'traversable'
    | 'autonomy'
    | 'forbidden'
    | 'headland'
    | 'gnss_degraded'
    | 'obstacle'
    | 'guidance_line'
    | 'row'
    | 'bed'
    | 'bed_band'
    | 'traffic_way'
    | 'traffic_band'
    | 'traffic_node'
    | 'landmark_measure'
    | 'landmark_circle'
    | 'landmark_polygon'
    | 'landmark_point';

export interface CatalogueKindPaint {
    fill: string;
    fillOpacity: number;
    line: string;
    lineWidth: number;
    dash: [number, number] | null;
    hatch: boolean;
}

/** CdCF UX §5.2 — one paint per kind, never colour alone (dash / hatch / outline). */
export const CATALOGUE_KIND_PAINT: Record<CatalogueKind, CatalogueKindPaint> = {
    field: {
        fill: COLOR.primary800,
        fillOpacity: 0.06,
        line: COLOR.primary800,
        lineWidth: 2,
        dash: null,
        hatch: false,
    },
    agronomic_boundary: {
        fill: COLOR.primary800,
        fillOpacity: 0,
        line: COLOR.primary800,
        lineWidth: 2,
        dash: null,
        hatch: false,
    },
    workable: {
        fill: COLOR.valid,
        fillOpacity: 0.12,
        line: COLOR.valid,
        lineWidth: 2,
        dash: null,
        hatch: false,
    },
    traversable: {
        fill: COLOR.transit,
        fillOpacity: 0.12,
        line: COLOR.transit,
        lineWidth: 2,
        dash: [2, 2],
        hatch: false,
    },
    autonomy: {
        fill: COLOR.autonomy,
        fillOpacity: 0.1,
        line: COLOR.autonomy,
        lineWidth: 2,
        dash: null,
        hatch: false,
    },
    forbidden: {
        fill: COLOR.danger,
        fillOpacity: 0.12,
        line: COLOR.danger,
        lineWidth: 2,
        dash: null,
        hatch: true,
    },
    headland: {
        fill: COLOR.warning,
        fillOpacity: 0.1,
        line: COLOR.warning,
        lineWidth: 1.5,
        dash: null,
        hatch: false,
    },
    gnss_degraded: {
        fill: COLOR.warning,
        fillOpacity: 0.12,
        line: COLOR.warning,
        lineWidth: 2,
        dash: [4, 3],
        hatch: true,
    },
    obstacle: {
        fill: '#7F1D1D',
        fillOpacity: 0.18,
        line: '#7F1D1D',
        lineWidth: 2,
        dash: null,
        hatch: false,
    },
    /** CdCF §5.2 — ligne AB / guidage : gris bleuté 1.5 px. */
    guidance_line: {
        fill: '#5B7C99',
        fillOpacity: 0,
        line: '#5B7C99',
        lineWidth: 1.5,
        dash: null,
        hatch: false,
    },
    /** Permanent vineyard rows (L6): brown, distinct from AB guidance. */
    row: {
        fill: '#78350F',
        fillOpacity: 0,
        line: '#78350F',
        lineWidth: 1.5,
        dash: null,
        hatch: false,
    },
    /** Vegetable beds (L6b): the median line stays readable above its cultivated band. */
    bed: {
        fill: '#8B5E3C',
        fillOpacity: 0,
        line: '#8B5E3C',
        lineWidth: 1.5,
        dash: null,
        hatch: false,
    },
    /** Cultivated width swept around a bed median line: brown wash, no outline. */
    bed_band: {
        fill: '#8B5E3C',
        fillOpacity: 0.14,
        line: '#8B5E3C',
        lineWidth: 0,
        dash: null,
        hatch: false,
    },
    /** Site paths (L6c): teal dashed, distinct from AB grey-blue and row brown. */
    traffic_way: {
        fill: '#0F766E',
        fillOpacity: 0,
        line: '#0F766E',
        lineWidth: 2,
        dash: [4, 3],
        hatch: false,
    },
    /** Width swept around a path line: dark grey wash, no outline. */
    traffic_band: {
        fill: '#334155',
        fillOpacity: 0.14,
        line: '#334155',
        lineWidth: 0,
        dash: null,
        hatch: false,
    },
    /** Gates / service / stops (L6c): filled teal disc. */
    traffic_node: {
        fill: '#0F766E',
        fillOpacity: 0.9,
        line: '#115E59',
        lineWidth: 1.5,
        dash: null,
        hatch: false,
    },
    landmark_measure: {
        fill: '#64748B',
        fillOpacity: 0,
        line: '#64748B',
        lineWidth: 1.5,
        dash: [3, 3],
        hatch: false,
    },
    landmark_circle: {
        fill: '#64748B',
        fillOpacity: 0.08,
        line: '#64748B',
        lineWidth: 1.25,
        dash: [4, 3],
        hatch: false,
    },
    landmark_polygon: {
        fill: '#64748B',
        fillOpacity: 0.08,
        line: '#64748B',
        lineWidth: 1.25,
        dash: [4, 3],
        hatch: false,
    },
    landmark_point: {
        fill: '#64748B',
        fillOpacity: 0.7,
        line: '#475569',
        lineWidth: 1.25,
        dash: null,
        hatch: false,
    },
};

export const CATALOGUE_OVERLAY_SWATCH: Record<CatalogueOverlayId, string> = {
    parcels: CATALOGUE_KIND_PAINT.field.line,
    zones: CATALOGUE_KIND_PAINT.workable.line,
    obstacles: CATALOGUE_KIND_PAINT.obstacle.line,
    rows: CATALOGUE_KIND_PAINT.row.line,
    guidance: CATALOGUE_KIND_PAINT.guidance_line.line,
    traffic: CATALOGUE_KIND_PAINT.traffic_way.line,
    landmarks: CATALOGUE_KIND_PAINT.landmark_measure.line,
};

const KINDS = Object.keys(CATALOGUE_KIND_PAINT) as CatalogueKind[];

export function catalogueOverlayForKind(kind: string): CatalogueOverlayId {
    if (kind === 'field') {
        return 'parcels';
    }
    if (kind === 'obstacle') {
        return 'obstacles';
    }
    if (kind === 'guidance_line') {
        return 'guidance';
    }
    if (kind === 'row' || kind === 'bed' || kind === 'bed_band') {
        return 'rows';
    }
    if (kind === 'traffic_way' || kind === 'traffic_band' || kind === 'traffic_node') {
        return 'traffic';
    }
    if (
        kind === 'landmark_measure' ||
        kind === 'landmark_circle' ||
        kind === 'landmark_polygon' ||
        kind === 'landmark_point'
    ) {
        return 'landmarks';
    }
    return 'zones';
}

export function isCatalogueKind(kind: string): kind is CatalogueKind {
    return kind in CATALOGUE_KIND_PAINT;
}

export function catalogueKindPaint(kind: string): CatalogueKindPaint {
    return isCatalogueKind(kind) ? CATALOGUE_KIND_PAINT[kind] : CATALOGUE_KIND_PAINT.field;
}

const OVERLAY_ORDER: CatalogueOverlayId[] = [
    'parcels',
    'zones',
    'obstacles',
    'rows',
    'guidance',
    'traffic',
    'landmarks',
];

export function catalogueOverlayRank(overlay: string): number {
    const index = OVERLAY_ORDER.indexOf(overlay as CatalogueOverlayId);
    return index === -1 ? OVERLAY_ORDER.length : index;
}

function matchByKind(
    pick: (paint: CatalogueKindPaint) => string | number,
    fallback: string | number,
): unknown[] {
    const expr: unknown[] = ['match', ['get', 'kind']];
    for (const kind of KINDS) {
        expr.push(kind, pick(CATALOGUE_KIND_PAINT[kind]));
    }
    expr.push(fallback);
    return expr;
}

export const CATALOGUE_FILL_COLOR = matchByKind((paint) => paint.fill, COLOR.valid);
export const CATALOGUE_FILL_OPACITY = matchByKind((paint) => paint.fillOpacity, 0.12);
export const CATALOGUE_LINE_COLOR = matchByKind((paint) => paint.line, COLOR.primary800);
export const CATALOGUE_LINE_WIDTH = matchByKind((paint) => paint.lineWidth, 2);

export const CATALOGUE_ZONE_KINDS: CatalogueKind[] = [
    'agronomic_boundary',
    'workable',
    'traversable',
    'autonomy',
    'forbidden',
    'headland',
    'gnss_degraded',
];
