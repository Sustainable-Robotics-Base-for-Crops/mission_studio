import type { AgriSection } from '../domain/agri';

export type CoverageStrategy = 'boustrophedon' | 'snake' | 'perpendicular' | 'best_nswath';

export interface CoveragePlanRequest {
    ring?: Array<{ lat: number; lng: number }>;
    origin: { lat: number; lon: number };
    working_width_m: number;
    vehicle_width_m?: number;
    strategy?: CoverageStrategy;
    variants?: boolean;
    headland_width_m?: number;
    geofence_margin_m?: number;
    overlap_m?: number;
    field_id?: string;
    row_set_id?: string;
}

export interface CoverageVariant {
    strategy: CoverageStrategy;
    heading_rad: number | null;
    swath_count: number;
    length_m: number;
    sections: AgriSection[];
}

export interface CoveragePreview {
    origin: { lat: number; lon: number };
    work: AgriSection[];
    headlands: AgriSection[];
}

export interface CoveragePlanResult {
    engine: string;
    sections: AgriSection[];
    headland_sections: AgriSection[];
    variants: CoverageVariant[];
    metrics: {
        swath_count: number;
        length_m: number;
        heading_rad: number | null;
        headland_laps: number;
    };
    srbc_coverage: Record<string, unknown>;
    origin: { lat: number; lon: number };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export async function planCoverage(request: CoveragePlanRequest): Promise<CoveragePlanResult> {
    const response = await fetch('/api/v1/coverage/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });
    const body: unknown = await response.json().catch(() => null);
    const record = asRecord(body);
    if (!response.ok) {
        const error =
            typeof record?.error === 'string' ? record.error : `coverage ${response.status}`;
        throw new Error(error);
    }
    const sections = Array.isArray(record?.sections) ? (record.sections as AgriSection[]) : [];
    const headlandSections = Array.isArray(record?.headland_sections)
        ? (record.headland_sections as AgriSection[])
        : [];
    const variants = Array.isArray(record?.variants)
        ? (record.variants as CoverageVariant[]).map((item) => ({
              strategy: item.strategy,
              heading_rad: item.heading_rad == null ? null : Number(item.heading_rad),
              swath_count: Number(item.swath_count) || (item.sections?.length ?? 0),
              length_m: Number(item.length_m) || 0,
              sections: Array.isArray(item.sections) ? item.sections : [],
          }))
        : [];
    const metrics = asRecord(record?.metrics) ?? {};
    const origin = asRecord(record?.origin) ?? {};
    return {
        engine: String(record?.engine ?? 'parallel_fallback'),
        sections,
        headland_sections: headlandSections,
        variants,
        metrics: {
            swath_count: Number(metrics.swath_count) || sections.length,
            length_m: Number(metrics.length_m) || 0,
            heading_rad:
                metrics.heading_rad == null || metrics.heading_rad === ''
                    ? null
                    : Number(metrics.heading_rad),
            headland_laps: Number(metrics.headland_laps) || headlandSections.length,
        },
        srbc_coverage: asRecord(record?.srbc_coverage) ?? {},
        origin: {
            lat: Number(origin.lat),
            lon: Number(origin.lon),
        },
    };
}
