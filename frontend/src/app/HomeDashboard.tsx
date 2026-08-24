import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { CloudOff, TriangleAlert } from 'lucide-react';

import { Banner, Button } from '../design-system';
import { polygonAreaM2 } from '../fields/geojson';
import type { FieldSummary } from '../fields/types';
import { farmFolderName, type FarmEntry } from './farm-api';
import type { FarmState } from './useFarm';

const RECENT_LIMIT = 5;
const REVALIDATE_LIMIT = 5;

interface HomeDashboardProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    language: string;
    farm: FarmState;
    /** Combinations come from the equipment catalogue, not from the farm folder. */
    combinationCount: number;
    /** The visible catalogue is authoritative while parcel_map persistence is bridged. */
    mappedFields?: FieldSummary[];
    onOpenMission?: (entry: FarmEntry) => void;
    overlay?: boolean;
}

function hectaresFromFields(fields: FieldSummary[]): number | null {
    if (fields.length === 0) {
        return 0;
    }
    const areas = fields
        .map((field) => polygonAreaM2(field.geometry))
        .filter((area): area is number => area !== null);
    if (areas.length === 0) {
        return null;
    }
    const hectares = areas.reduce((total, area) => total + area, 0) / 10_000;
    return Math.round(hectares * 100) / 100;
}

function formatDate(modified: number, language: string): string {
    const date = new Date(modified);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }
    try {
        return date.toLocaleDateString(language, { day: '2-digit', month: 'short' });
    } catch {
        return date.toISOString().slice(0, 10);
    }
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="studio-home-figure">
            <span className="studio-home-figure-value">{value}</span>
            <span className="studio-home-figure-label">{label}</span>
            {hint ? <span className="studio-home-figure-hint">{hint}</span> : null}
        </div>
    );
}

function MissionList({
    entries,
    language,
    emptyLabel,
    onOpenMission,
}: {
    entries: FarmEntry[];
    language: string;
    emptyLabel: string;
    onOpenMission?: (entry: FarmEntry) => void;
}): ReactElement {
    if (entries.length === 0) {
        return <p className="studio-muted">{emptyLabel}</p>;
    }
    return (
        <ul className="studio-home-list">
            {entries.map((entry) => (
                <li key={entry.path}>
                    <button
                        type="button"
                        disabled={!onOpenMission || entry.unreadable === true}
                        onClick={() => onOpenMission?.(entry)}
                    >
                        <span>{entry.name.replace(/\.json$/i, '')}</span>
                        <span className="studio-muted">
                            {formatDate(entry.modified, language)}
                            {entry.field_id ? ` · ${entry.field_id}` : ''}
                        </span>
                    </button>
                </li>
            ))}
        </ul>
    );
}

/**
 * Home dashboard (L13 §7). A dashboard only earns its place if it is actionable:
 * where am I, four figures, then what to resume and what to fix. No weather, no
 * charts, no score — nothing that has no real data behind it today.
 */
export function HomeDashboard({
    t,
    language,
    farm,
    combinationCount,
    mappedFields,
    onOpenMission,
    overlay = false,
}: HomeDashboardProps): ReactElement {
    const navigate = useNavigate();
    const { available, loading, error, counts, root, missions } = farm;
    const document = farm.farm;

    const recent = missions.slice(0, RECENT_LIMIT);
    const toRevalidate = missions.filter((entry) => !entry.simulated && entry.unreadable !== true);

    // A figure we cannot measure shows a dash and its reason, never a misleading zero.
    const mappedHectares =
        mappedFields === undefined ? counts.hectares : hectaresFromFields(mappedFields);
    const mappedFieldCount = mappedFields === undefined ? counts.fields : mappedFields.length;
    const hectares =
        mappedHectares !== null
            ? t('home.figure.hectares', { value: mappedHectares.toLocaleString(language) })
            : mappedFieldCount === 0
              ? t('home.figure.hectares', { value: 0 })
              : t('home.figure.none');
    const hectaresHint =
        mappedHectares === null && mappedFieldCount > 0
            ? t('home.figure.hectares.hint')
            : undefined;

    return (
        <aside
            className={overlay ? 'studio-context is-overlay' : 'studio-context'}
            aria-label={t('nav.home')}
        >
            <header className="studio-panel-header">
                <h2>{t('nav.home')}</h2>
            </header>

            <div className="studio-home">
                {!available && !loading ? (
                    <Banner tone="warning" icon={CloudOff}>
                        {t('farm.unavailable')}
                    </Banner>
                ) : null}
                {error ? (
                    <Banner tone="danger" icon={TriangleAlert}>
                        {error}
                    </Banner>
                ) : null}

                <section className="studio-home-identity">
                    <h3>{document ? document.name : t('home.noFarm')}</h3>
                    {document ? (
                        <dl className="studio-home-identity-list">
                            <dt>{t('home.farmType')}</dt>
                            <dd>{t(`farm.type.${document.farm_type}`)}</dd>
                            <dt>{t('home.folder')}</dt>
                            <dd title={root ?? undefined}>{farmFolderName(root)}</dd>
                            <dt>{t('home.sync')}</dt>
                            <dd>{t('home.sync.offline')}</dd>
                        </dl>
                    ) : (
                        <>
                            <p className="studio-muted">{t('home.noFarm.hint')}</p>
                            {available ? (
                                <Button
                                    variant="primary"
                                    onClick={() => navigate('/administration')}
                                >
                                    {t('home.openFarm')}
                                </Button>
                            ) : null}
                        </>
                    )}
                </section>

                {document ? (
                    <>
                        <section className="studio-home-figures" aria-label={t('home.figures')}>
                            <Figure
                                label={t('home.figure.fields')}
                                value={hectares}
                                hint={hectaresHint}
                            />
                            <Figure
                                label={t('home.figure.missions')}
                                value={String(counts.missions)}
                            />
                            <Figure
                                label={t('home.figure.equipment')}
                                value={String(combinationCount)}
                            />
                            <Figure
                                label={t('home.figure.hours')}
                                value={t('home.figure.none')}
                                hint={t('home.figure.hours.hint')}
                            />
                        </section>

                        <section className="studio-home-block">
                            <h3>{t('home.resume')}</h3>
                            <MissionList
                                entries={recent}
                                language={language}
                                emptyLabel={loading ? t('home.loading') : t('home.resume.empty')}
                                onOpenMission={onOpenMission}
                            />
                        </section>

                        <section className="studio-home-block">
                            <h3>{t('home.revalidate', { count: toRevalidate.length })}</h3>
                            <MissionList
                                entries={toRevalidate.slice(0, REVALIDATE_LIMIT)}
                                language={language}
                                emptyLabel={t('home.revalidate.empty')}
                                onOpenMission={onOpenMission}
                            />
                        </section>
                    </>
                ) : null}

                <section className="studio-home-block">
                    <h3>{t('home.actions')}</h3>
                    <div className="studio-home-actions">
                        <Button variant="primary" onClick={() => navigate('/missions')}>
                            {t('home.action.mission')}
                        </Button>
                        <Button variant="secondary" onClick={() => navigate('/parcellaire')}>
                            {t('home.action.field')}
                        </Button>
                        <Button variant="secondary" onClick={() => navigate('/materiel')}>
                            {t('home.action.implement')}
                        </Button>
                    </div>
                </section>
            </div>
        </aside>
    );
}
