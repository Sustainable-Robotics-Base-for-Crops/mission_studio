import { useEffect, useState, type ReactElement } from 'react';

import { planCoverage, type CoverageStrategy } from '../coverage/api';
import { Button } from '../design-system/Button';
import { Dialog } from '../design-system/Overlay';
import type { AgriDocument, AgriSection } from '../domain/agri';
import { geofenceRing, simulateMission, type SimulationReport } from '../domain/simulation';
import type { CombinationEnvelope } from '../domain/equipment';
import type { OddContext } from '../domain/odd';
import { documentOrigin } from '../domain/draft';
import { localToLngLat } from '../domain/geometry';
import { formatDurationCompact } from '../missions/tree';

export type CompareRow = {
    id: string;
    strategy: CoverageStrategy | 'current';
    current: boolean;
    length_m: number;
    duration_s: number;
    swaths: number;
    gapPct: number | null;
    overlapPct: number | null;
    blockCount: number;
    sections: AgriSection[];
};

interface CompareDialogProps {
    open: boolean;
    document: AgriDocument | null;
    envelope: CombinationEnvelope | null;
    workingWidthM: number | null;
    vehicleWidthM: number | null;
    geofenceMarginM: number | null;
    currentReport: SimulationReport | null;
    odd?: OddContext | null;
    onOpenChange: (open: boolean) => void;
    onApply: (sections: AgriSection[]) => void;
    t: (key: string, params?: Record<string, string | number>) => string;
}

function pct(value: number | null): string {
    if (value == null || !Number.isFinite(value)) {
        return '—';
    }
    return `${value.toFixed(1)} %`;
}

export function CompareDialog({
    open,
    document,
    envelope,
    workingWidthM,
    vehicleWidthM,
    geofenceMarginM,
    currentReport,
    odd,
    onOpenChange,
    onApply,
    t,
}: CompareDialogProps): ReactElement {
    const [rows, setRows] = useState<CompareRow[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open || !document) {
            return;
        }
        const origin = documentOrigin(document);
        const ringLocal = geofenceRing(document);
        if (!origin || ringLocal.length < 3 || !(workingWidthM && workingWidthM > 0)) {
            setRows([]);
            setError(t('compare.needField'));
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        const ring = ringLocal.map(([x, y]) => {
            const [lng, lat] = localToLngLat(x, y, origin);
            return { lat, lng };
        });
        const simulateSections = (sections: AgriSection[]): SimulationReport =>
            simulateMission({
                document: { ...document, points: sections },
                envelope,
                workingWidthM,
                maxSpeedMps: null,
                odd: odd ?? undefined,
            });
        const current: CompareRow = {
            id: 'current',
            strategy: 'current',
            current: true,
            length_m: currentReport?.length_m ?? 0,
            duration_s: currentReport?.duration_s ?? 0,
            swaths: document.points.filter((section) =>
                String(section.section_type ?? '').startsWith('row'),
            ).length,
            gapPct: currentReport?.coverage?.gapPct ?? null,
            overlapPct: currentReport?.coverage?.overlapPct ?? null,
            blockCount: currentReport?.blockCount ?? 0,
            sections: document.points,
        };
        void planCoverage({
            ring,
            origin: { lat: origin.lat, lon: origin.lon },
            working_width_m: workingWidthM,
            vehicle_width_m: vehicleWidthM ?? undefined,
            variants: true,
            geofence_margin_m: geofenceMarginM ?? undefined,
        })
            .then((plan) => {
                if (cancelled) {
                    return;
                }
                const variants =
                    plan.variants.length > 0
                        ? plan.variants.slice(0, 3)
                        : [
                              {
                                  strategy:
                                      (plan.srbc_coverage.strategy as CoverageStrategy) ||
                                      'boustrophedon',
                                  heading_rad: plan.metrics.heading_rad,
                                  swath_count: plan.metrics.swath_count,
                                  length_m: plan.metrics.length_m,
                                  sections: plan.sections,
                              },
                          ];
                const next: CompareRow[] = [current];
                for (const variant of variants) {
                    const sections = [
                        ...(plan.headland_sections ?? []),
                        ...(variant.sections ?? []),
                    ];
                    if (sections.length === 0) {
                        continue;
                    }
                    const report = simulateSections(sections);
                    next.push({
                        id: variant.strategy,
                        strategy: variant.strategy,
                        current: false,
                        length_m: report.length_m,
                        duration_s: report.duration_s,
                        swaths: variant.swath_count || variant.sections.length,
                        gapPct: report.coverage?.gapPct ?? null,
                        overlapPct: report.coverage?.overlapPct ?? null,
                        blockCount: report.blockCount,
                        sections,
                    });
                }
                setRows(next);
            })
            .catch((cause: unknown) => {
                if (!cancelled) {
                    setRows([current]);
                    setError(cause instanceof Error ? cause.message : t('compare.failed'));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [
        currentReport,
        document,
        envelope,
        geofenceMarginM,
        odd,
        open,
        t,
        vehicleWidthM,
        workingWidthM,
    ]);

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={t('compare.title')}
            className="studio-compare-dialog"
        >
            <h2 className="studio-fill-dialog-title">{t('compare.title')}</h2>
            <p className="studio-fill-dialog-hint">{t('compare.hint')}</p>
            {loading ? <p className="studio-muted">{t('compare.loading')}</p> : null}
            {error ? <p className="studio-sim-blocked">{error}</p> : null}
            {rows.length > 0 ? (
                <table className="studio-compare-table">
                    <thead>
                        <tr>
                            <th>{t('compare.col.variant')}</th>
                            <th>{t('compare.col.length')}</th>
                            <th>{t('compare.col.duration')}</th>
                            <th>{t('compare.col.swaths')}</th>
                            <th>{t('compare.col.gap')}</th>
                            <th>{t('compare.col.overlap')}</th>
                            <th>{t('compare.col.blocks')}</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.id} data-current={row.current ? 'true' : undefined}>
                                <td>
                                    {row.current
                                        ? t('compare.current')
                                        : t(`tool.coverageStrategy.${row.strategy}`)}
                                </td>
                                <td>{Math.round(row.length_m)} m</td>
                                <td>{formatDurationCompact(row.duration_s)}</td>
                                <td>{row.swaths}</td>
                                <td>{pct(row.gapPct)}</td>
                                <td>{pct(row.overlapPct)}</td>
                                <td>{row.blockCount}</td>
                                <td>
                                    {row.current ? null : (
                                        <Button
                                            variant="secondary"
                                            onClick={() => onApply(row.sections)}
                                        >
                                            {t('compare.apply')}
                                        </Button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : null}
            <div className="studio-fill-dialog-actions">
                <Button variant="secondary" onClick={() => onOpenChange(false)}>
                    {t('compare.close')}
                </Button>
            </div>
        </Dialog>
    );
}
