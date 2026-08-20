import type { ReactElement } from 'react';
import { ChartColumn, MapPin } from 'lucide-react';

import { Banner, Chip } from '../design-system/Feedback';
import { IconButton } from '../design-system/Button';
import { Tabs } from '../design-system/Disclosure';
import { ICON_SIZE, STROKE } from '../design-system/icons';
import type { AgriDocument } from '../domain/agri';
import {
    REPORT_KPI_IDS,
    REPORT_LAYERS,
    buildMissionReports,
    type ReportKpiId,
    type ReportLayer,
    type ReportSnapshot,
} from '../domain/report';
import type { PoseSample, SimulationReport } from '../domain/simulation';
import { formatDurationCompact } from '../missions/tree';
import type { PublicationRecord } from '../publication/api';

interface ReportsPanelProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    document: AgriDocument | null;
    sim: SimulationReport | null;
    publications: PublicationRecord[];
    overlay?: boolean;
    onLocate: (sample: PoseSample) => void;
}

function latestPublished(items: PublicationRecord[]): PublicationRecord | null {
    return items.find((item) => item.status === 'published') ?? items[0] ?? null;
}

function formatKpi(id: ReportKpiId, value: number | null, layer: ReportLayer): string {
    if (value === null) {
        return '—';
    }
    const signed = layer === 'comparison' && value > 0 ? '+' : '';
    if (id.endsWith('Pct')) {
        return `${signed}${value.toFixed(1)} %`;
    }
    if (id.endsWith('_s')) {
        if (layer === 'comparison') {
            const sign = value > 0 ? '+' : value < 0 ? '−' : '';
            return `${sign}${formatDurationCompact(Math.abs(value))}`;
        }
        return formatDurationCompact(value);
    }
    if (id === 'length_m') {
        return `${signed}${Math.round(value)} m`;
    }
    return `${signed}${value}`;
}

function SnapshotView({
    t,
    snapshot,
    samples,
    onLocate,
}: {
    t: (key: string, params?: Record<string, string | number>) => string;
    snapshot: ReportSnapshot;
    samples: readonly PoseSample[];
    onLocate: (sample: PoseSample) => void;
}): ReactElement {
    if (!snapshot.available && snapshot.reason) {
        return (
            <Banner tone="info" icon={ChartColumn}>
                {t(`rep.reason.${snapshot.reason}`)}
            </Banner>
        );
    }
    return (
        <>
            {snapshot.version ? (
                <Chip tone="valid" icon={ChartColumn}>
                    {t('pub.version', { version: snapshot.version })}
                </Chip>
            ) : null}
            {snapshot.layer === 'comparison' ? (
                <p className="studio-muted">{t('rep.compareHint')}</p>
            ) : null}
            <dl className="studio-report-kpis">
                {REPORT_KPI_IDS.map((id) => (
                    <div key={id}>
                        <dt>{t(`rep.kpi.${id}`)}</dt>
                        <dd>{formatKpi(id, snapshot.kpis[id], snapshot.layer)}</dd>
                    </div>
                ))}
            </dl>
            <h3>{t('rep.anomalies')}</h3>
            {snapshot.anomalies.length === 0 ? (
                <p className="studio-muted">{t('rep.anomalies.empty')}</p>
            ) : (
                <ul className="studio-report-anomalies">
                    {snapshot.anomalies.map((item, index) => {
                        const sample =
                            item.sampleIndex !== null ? samples[item.sampleIndex] : undefined;
                        return (
                            <li key={`${item.id}:${index}`}>
                                <span>
                                    {t(`sim.check.${item.id}`)} · {t(`rep.status.${item.status}`)}
                                </span>
                                <IconButton
                                    label={t('rep.locate')}
                                    disabled={!sample}
                                    onClick={() => {
                                        if (sample) {
                                            onLocate(sample);
                                        }
                                    }}
                                >
                                    <MapPin size={ICON_SIZE.table} strokeWidth={STROKE} />
                                </IconButton>
                            </li>
                        );
                    })}
                </ul>
            )}
        </>
    );
}

export function ReportsPanel({
    t,
    document,
    sim,
    publications,
    overlay = false,
    onLocate,
}: ReportsPanelProps): ReactElement {
    const published = latestPublished(publications);
    const reports = buildMissionReports({
        document,
        sim,
        authorized: published
            ? { version: published.version, simulation: published.simulation }
            : null,
    });
    const inspectorClass = overlay ? 'studio-context is-overlay' : 'studio-context';
    return (
        <aside className={inspectorClass} aria-label={t('sim.tab.report')}>
            <header className="studio-panel-header">
                <h2>{t('sim.tab.report')}</h2>
            </header>
            <p className="studio-muted">{t('rep.panelHint')}</p>
            <Tabs
                defaultValue="planned"
                items={REPORT_LAYERS.map((layer) => ({
                    value: layer,
                    label: t(`rep.layer.${layer}`),
                    content: (
                        <SnapshotView
                            t={t}
                            snapshot={reports[layer]}
                            samples={sim?.samples ?? []}
                            onLocate={onLocate}
                        />
                    ),
                }))}
            />
            <p className="studio-muted">{t('rep.packsHint')}</p>
        </aside>
    );
}
