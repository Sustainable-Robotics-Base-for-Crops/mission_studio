import { useEffect, useState, type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';

import {
    fetchFarmMission,
    fetchFarmTree,
    isAdvancedUi,
    type FarmEntry,
    type UiMode,
} from '../app/farm-api';
import { AdvancedModeLink } from '../app/AdvancedModeLink';
import { NativeSelect } from '../design-system/Field';
import { Tabs } from '../design-system/Disclosure';
import type { AgriDocument } from '../domain/agri';
import type { CombinationTwin } from '../domain/equipment';
import {
    defaultOddProfile,
    ODD_CROP,
    ODD_LOCALIZATION,
    ODD_VISIBILITY,
    ODD_WEATHER,
    parseOddProfile,
    type OddProfile,
} from '../domain/odd';
import type { PoseSample, SimulationReport } from '../domain/simulation';
import type { PublicationRecord } from '../publication/api';
import { ReportsPanel } from '../reports/ReportsPanel';
import { SimulationChecks } from './SimulationChecks';

export type SimulationPanelProps = {
    t: (key: string, params?: Record<string, string | number>) => string;
    overlay?: boolean;
    document: AgriDocument | null;
    activePath: string | null;
    combinations: CombinationTwin[];
    selectedCombinationId: string | null;
    onSelectCombination: (id: string) => void;
    onSaveCombination: (patch: Record<string, unknown>) => void;
    onLoadFarmMission: (path: string, document: unknown) => void;
    report: SimulationReport | null;
    publications: PublicationRecord[];
    onLocate: (sample: PoseSample) => void;
    uiMode?: UiMode;
};

function displayName(entry: FarmEntry): string {
    return entry.name.replace(/\.json$/i, '');
}

function currentLabel(path: string | null): string {
    if (!path) {
        return '';
    }
    const leaf = path.split('/').pop() ?? path;
    return leaf.replace(/\.json$/i, '');
}

function SimMissionExplorer({
    t,
    entries,
    loading,
    error,
    activePath,
    loadingPath,
    onLoadMission,
}: {
    t: SimulationPanelProps['t'];
    entries: FarmEntry[];
    loading: boolean;
    error: string | null;
    activePath: string | null;
    loadingPath: string | null;
    onLoadMission: (path: string) => void;
}): ReactElement {
    if (loading) {
        return <p className="studio-muted">{t('sim.config.loading')}</p>;
    }
    if (error) {
        return (
            <p className="ds-field-error" role="alert">
                {t('mission.load.error', { error })}
            </p>
        );
    }
    if (entries.length === 0) {
        return <p className="studio-muted">{t('sim.config.empty')}</p>;
    }
    return (
        <ul className="studio-mission-explorer">
            {entries.map((entry) => (
                <li key={entry.path}>
                    <button
                        type="button"
                        className={entry.path === activePath ? 'is-active' : undefined}
                        disabled={loadingPath === entry.path}
                        onClick={() => onLoadMission(entry.path)}
                    >
                        <span className="studio-mission-explorer-title">{displayName(entry)}</span>
                        <span className="studio-muted">
                            {entry.kind === 'work_performed'
                                ? t('sim.config.workPerformed')
                                : t('sim.config.missionOrder')}
                        </span>
                    </button>
                </li>
            ))}
        </ul>
    );
}

function ConfigureTab({
    t,
    document,
    activePath,
    combinations,
    selectedCombinationId,
    onSelectCombination,
    onSaveCombination,
    onLoadFarmMission,
    uiMode,
}: Omit<SimulationPanelProps, 'overlay' | 'report' | 'publications' | 'onLocate'>): ReactElement {
    const [entries, setEntries] = useState<FarmEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [loadingPath, setLoadingPath] = useState<string | null>(null);
    const combination =
        combinations.find((item) => item.id === selectedCombinationId) ?? combinations[0] ?? null;
    const odd = combination?.odd ?? defaultOddProfile();

    useEffect(() => {
        let cancelled = false;
        void fetchFarmTree()
            .then((tree) => {
                if (cancelled) {
                    return;
                }
                setEntries([...(tree.mission_order ?? []), ...(tree.work_performed ?? [])]);
                setError(null);
            })
            .catch((cause: unknown) => {
                if (!cancelled) {
                    setError(
                        cause instanceof Error ? cause.message : t('mission.load.unknownError'),
                    );
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
    }, [t]);

    const loadMission = async (path: string) => {
        setLoadingPath(path);
        setError(null);
        try {
            onLoadFarmMission(path, await fetchFarmMission(path));
        } catch (cause: unknown) {
            setError(cause instanceof Error ? cause.message : t('mission.load.unknownError'));
        } finally {
            setLoadingPath(null);
        }
    };

    const patchOdd = (partial: Partial<OddProfile>) => {
        const next = parseOddProfile({ ...odd, ...partial });
        onSaveCombination({ odd: next });
    };

    return (
        <div className="studio-panel-tab">
            <p className="studio-muted">{t('sim.config.missionHint')}</p>
            {document ? (
                <p>
                    {t('sim.config.current', {
                        name: activePath ? currentLabel(activePath) : t('sim.config.draft'),
                    })}
                </p>
            ) : (
                <p className="studio-muted">{t('sim.needMission')}</p>
            )}
            <SimMissionExplorer
                t={t}
                entries={entries}
                loading={loading}
                error={error}
                activePath={activePath}
                loadingPath={loadingPath}
                onLoadMission={(path) => void loadMission(path)}
            />
            <NativeSelect
                id="sim-combination"
                label={t('sim.config.equipment')}
                value={combination?.id ?? ''}
                onChange={(event) => {
                    if (event.target.value) {
                        onSelectCombination(event.target.value);
                    }
                }}
            >
                {combinations.length === 0 ? (
                    <option value="">{t('sim.config.noEquipment')}</option>
                ) : (
                    combinations.map((item) => (
                        <option key={item.id} value={item.id}>
                            {item.name}
                        </option>
                    ))
                )}
            </NativeSelect>
            {isAdvancedUi(uiMode) ? (
                <>
                    <p className="studio-muted">{t('equipment.odd.title')}</p>
                    <NativeSelect
                        id="sim-odd-approved"
                        label={t('equipment.odd.approved')}
                        value={odd.approved ? 'yes' : 'no'}
                        onChange={(event) => patchOdd({ approved: event.target.value === 'yes' })}
                    >
                        <option value="no">{t('equipment.odd.draft')}</option>
                        <option value="yes">{t('equipment.odd.ready')}</option>
                    </NativeSelect>
                    <NativeSelect
                        id="sim-odd-weather"
                        label={t('equipment.odd.weather')}
                        value={odd.weather}
                        onChange={(event) =>
                            patchOdd({ weather: event.target.value as OddProfile['weather'] })
                        }
                    >
                        {ODD_WEATHER.map((item) => (
                            <option key={item} value={item}>
                                {t(`equipment.odd.weather.${item}`)}
                            </option>
                        ))}
                    </NativeSelect>
                    <NativeSelect
                        id="sim-odd-visibility"
                        label={t('equipment.odd.visibility')}
                        value={odd.visibility}
                        onChange={(event) =>
                            patchOdd({ visibility: event.target.value as OddProfile['visibility'] })
                        }
                    >
                        {ODD_VISIBILITY.map((item) => (
                            <option key={item} value={item}>
                                {t(`equipment.odd.visibility.${item}`)}
                            </option>
                        ))}
                    </NativeSelect>
                    <NativeSelect
                        id="sim-odd-crop"
                        label={t('equipment.odd.crop')}
                        value={odd.crop}
                        onChange={(event) =>
                            patchOdd({ crop: event.target.value as OddProfile['crop'] })
                        }
                    >
                        {ODD_CROP.map((item) => (
                            <option key={item} value={item}>
                                {t(`equipment.odd.crop.${item}`)}
                            </option>
                        ))}
                    </NativeSelect>
                    <NativeSelect
                        id="sim-odd-loc"
                        label={t('equipment.odd.localization')}
                        value={odd.localization}
                        onChange={(event) =>
                            patchOdd({
                                localization: event.target.value as OddProfile['localization'],
                            })
                        }
                    >
                        {ODD_LOCALIZATION.map((item) => (
                            <option key={item} value={item}>
                                {t(`equipment.odd.localization.${item}`)}
                            </option>
                        ))}
                    </NativeSelect>
                </>
            ) : (
                <AdvancedModeLink t={t} />
            )}
        </div>
    );
}

export function SimulationPanel({
    t,
    overlay = false,
    document,
    activePath,
    combinations,
    selectedCombinationId,
    onSelectCombination,
    onSaveCombination,
    onLoadFarmMission,
    report,
    publications,
    onLocate,
    uiMode,
}: SimulationPanelProps): ReactElement {
    const location = useLocation();
    const defaultTab = location.hash === '#results' ? 'results' : 'configure';
    return (
        <aside
            className={overlay ? 'studio-context is-overlay' : 'studio-context'}
            aria-label={t('nav.simulation')}
        >
            <header className="studio-panel-header">
                <h2>{t('nav.simulation')}</h2>
            </header>
            <Tabs
                key={defaultTab}
                defaultValue={defaultTab}
                items={[
                    {
                        value: 'configure',
                        label: t('sim.tab.configure'),
                        content: (
                            <ConfigureTab
                                t={t}
                                document={document}
                                activePath={activePath}
                                combinations={combinations}
                                selectedCombinationId={selectedCombinationId}
                                onSelectCombination={onSelectCombination}
                                onSaveCombination={onSaveCombination}
                                onLoadFarmMission={onLoadFarmMission}
                                uiMode={uiMode}
                            />
                        ),
                    },
                    {
                        value: 'results',
                        label: t('sim.tab.results'),
                        content: (
                            <div className="studio-panel-tab">
                                {report ? (
                                    <SimulationChecks t={t} report={report} onLocate={onLocate} />
                                ) : (
                                    <p className="studio-muted">{t('sim.needRun')}</p>
                                )}
                            </div>
                        ),
                    },
                    {
                        value: 'report',
                        label: t('sim.tab.report'),
                        content: (
                            <ReportsPanel
                                t={t}
                                document={document}
                                sim={report}
                                publications={publications}
                                overlay={false}
                                onLocate={onLocate}
                            />
                        ),
                    },
                ]}
            />
        </aside>
    );
}
