import { useEffect, useState, type ReactElement } from 'react';

import { AdvancedModeLink } from '../app/AdvancedModeLink';
import {
    fetchFarmMission,
    fetchFarmTree,
    isAdvancedUi,
    type FarmEntry,
    type UiMode,
} from '../app/farm-api';
import { Button } from '../design-system/Button';
import { Tabs } from '../design-system/Disclosure';
import { Input } from '../design-system/Field';
import { Dialog } from '../design-system/Overlay';
import { createEmptyDocument } from '../domain/draft';
import type { VehicleTwin } from '../domain/equipment';
import {
    downloadAgriDocument,
    farmMissionFilename,
    farmMissionPathFromName,
    isFarmMissionPath,
    saveMissionDocument,
    uniquifyFarmFilename,
} from '../map/missions-api';
import { PublicationPanel } from '../publication/PublicationPanel';
import type { usePublications } from '../publication/usePublications';
import { MissionAssistant, type MissionAssistantProps } from './MissionAssistant';
import { MissionMetaEditor } from './MissionMetaEditor';

export type MissionPanelProps = Omit<MissionAssistantProps, 'view'> & {
    onLoadFarmMission: (path: string, document: unknown) => void;
    vehicles: VehicleTwin[];
    publications: ReturnType<typeof usePublications>;
    onPublish: () => void;
    uiMode?: UiMode;
};

function displayName(entry: FarmEntry): string {
    return entry.name.replace(/\.json$/i, '');
}

function displayDate(entry: FarmEntry): string {
    const namedDate = /^(\d{4}-\d{2}-\d{2})/.exec(entry.name)?.[1];
    if (namedDate) {
        return namedDate;
    }
    return new Date(entry.modified).toLocaleDateString();
}

function MissionExplorer({
    entries,
    loading,
    error,
    activePath,
    loadingPath,
    onLoadMission,
    t,
}: {
    entries: FarmEntry[];
    loading: boolean;
    error: string | null;
    activePath: string | null;
    loadingPath: string | null;
    onLoadMission: (path: string) => void;
    t: MissionPanelProps['t'];
}): ReactElement {
    if (loading) {
        return <p className="studio-muted">{t('mission.load.loading')}</p>;
    }
    if (error) {
        return (
            <p className="ds-field-error" role="alert">
                {t('mission.load.error', { error })}
            </p>
        );
    }
    if (entries.length === 0) {
        return <p className="studio-muted">{t('mission.load.empty')}</p>;
    }
    return (
        <ul className="studio-mission-explorer">
            {entries.map((entry) => (
                <li key={entry.path}>
                    <button
                        type="button"
                        className={entry.path === activePath ? 'is-active' : undefined}
                        disabled={entry.unreadable || loadingPath === entry.path}
                        onClick={() => onLoadMission(entry.path)}
                    >
                        <span className="studio-mission-explorer-title">{displayName(entry)}</span>
                        <span className="studio-mission-explorer-context">
                            <span>{displayDate(entry)}</span>
                            <span>
                                {entry.field_id
                                    ? t('mission.load.field', { field: entry.field_id })
                                    : t('mission.load.fieldUnknown')}
                            </span>
                            <span>
                                {entry.operation
                                    ? t('mission.load.operation', {
                                          operation: t(`assist.operation.${entry.operation}`),
                                      })
                                    : t('mission.load.operationUnknown')}
                            </span>
                        </span>
                        <span
                            className={
                                entry.simulated
                                    ? 'studio-mission-state is-simulated'
                                    : 'studio-mission-state'
                            }
                        >
                            {entry.simulated
                                ? t('mission.load.simulated')
                                : t('mission.load.notSimulated')}
                        </span>
                        {entry.unreadable ? (
                            <span className="ds-field-error">{t('mission.load.unreadable')}</span>
                        ) : loadingPath === entry.path ? (
                            <span className="studio-muted">{t('mission.load.loadingMission')}</span>
                        ) : null}
                    </button>
                </li>
            ))}
        </ul>
    );
}

export function MissionPanel(props: MissionPanelProps): ReactElement {
    const {
        t,
        overlay = false,
        onApplyDocument,
        activePath,
        onLoadFarmMission,
        document,
        combinations = [],
        implements: implementsList = [],
        vehicles = [],
        publications,
        onPublish,
        uiMode,
    } = props;
    const advanced = isAdvancedUi(uiMode);
    const [defaultTab, setDefaultTab] = useState('create');
    const [tabRevision, setTabRevision] = useState(0);
    const [entries, setEntries] = useState<FarmEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [loadingPath, setLoadingPath] = useState<string | null>(null);
    const [saveAsOpen, setSaveAsOpen] = useState(false);
    const [saveAsName, setSaveAsName] = useState('');
    const [publishError, setPublishError] = useState<string | null>(null);
    const [busyAction, setBusyAction] = useState<'save' | 'saveAs' | 'duplicate' | null>(null);

    const existingNames = entries.map((entry) => entry.name);

    const reloadTree = async () => {
        const tree = await fetchFarmTree('mission_order');
        setEntries(tree.mission_order ?? []);
    };

    const persistFarm = async (path: string) => {
        if (!document) {
            return;
        }
        const saved = await saveMissionDocument(
            document as unknown as Record<string, unknown>,
            path,
        );
        onLoadFarmMission(saved, document);
        await reloadTree();
    };

    useEffect(() => {
        let cancelled = false;
        void fetchFarmTree('mission_order')
            .then((tree) => {
                if (!cancelled) {
                    setEntries(tree.mission_order ?? []);
                    setError(null);
                }
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

    const startFromScratch = () => {
        onApplyDocument?.(createEmptyDocument());
        if (advanced) {
            setDefaultTab('edit');
            setTabRevision((value) => value + 1);
        }
    };

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

    return (
        <aside
            className={overlay ? 'studio-context is-overlay' : 'studio-context'}
            aria-label={t('nav.missions')}
        >
            <header className="studio-panel-header">
                <h2>{t('nav.missions')}</h2>
            </header>
            {advanced ? null : <AdvancedModeLink t={t} />}
            <Tabs
                key={tabRevision}
                defaultValue={defaultTab}
                items={[
                    {
                        value: 'create',
                        label: t('mission.tab.create'),
                        content: (
                            <div className="studio-panel-tab">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={startFromScratch}
                                >
                                    {t('mission.create.scratch')}
                                </Button>
                                <MissionAssistant {...props} overlay={false} view="create" />
                            </div>
                        ),
                    },
                    {
                        value: 'edit',
                        label: t('mission.tab.edit'),
                        content: (
                            <div className="studio-panel-tab">
                                <MissionAssistant {...props} overlay={false} view="edit" />
                                <MissionMetaEditor
                                    t={t}
                                    document={document}
                                    combinations={combinations}
                                    vehicles={vehicles}
                                    implements={implementsList}
                                    onApplyDocument={onApplyDocument}
                                />
                            </div>
                        ),
                    },
                    {
                        value: 'load',
                        label: t('mission.tab.load'),
                        content: (
                            <div className="studio-panel-tab">
                                <MissionExplorer
                                    entries={entries}
                                    loading={loading}
                                    error={error}
                                    activePath={activePath}
                                    loadingPath={loadingPath}
                                    onLoadMission={(path) => void loadMission(path)}
                                    t={t}
                                />
                            </div>
                        ),
                    },
                    {
                        value: 'meta',
                        label: t('mission.tab.meta'),
                        content: null,
                        disabled: true,
                        tooltip: t('mission.tab.comingSoon'),
                    },
                    {
                        value: 'compare',
                        label: t('mission.tab.compare'),
                        content: null,
                        disabled: true,
                        tooltip: t('mission.tab.comingSoon'),
                    },
                    {
                        value: 'publish',
                        label: t('mission.tab.publish'),
                        content: (
                            <div className="studio-panel-tab">
                                {!document ? (
                                    <p className="studio-muted">
                                        {t('mission.publish.needDocument')}
                                    </p>
                                ) : (
                                    <div className="studio-mission-publish-actions">
                                        <Button type="button" variant="primary" onClick={onPublish}>
                                            {t('app.publish')}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            disabled={busyAction !== null}
                                            onClick={() => {
                                                setPublishError(null);
                                                setBusyAction('save');
                                                const path = isFarmMissionPath(activePath)
                                                    ? (activePath as string)
                                                    : farmMissionPathFromName(
                                                          farmMissionFilename(
                                                              document as unknown as Record<
                                                                  string,
                                                                  unknown
                                                              >,
                                                              existingNames,
                                                          ),
                                                      );
                                                void persistFarm(path)
                                                    .catch((cause: unknown) => {
                                                        setPublishError(
                                                            cause instanceof Error
                                                                ? cause.message
                                                                : t('mission.load.unknownError'),
                                                        );
                                                    })
                                                    .finally(() => setBusyAction(null));
                                            }}
                                        >
                                            {t('app.save')}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            disabled={busyAction !== null}
                                            onClick={() => {
                                                setSaveAsName(
                                                    farmMissionFilename(
                                                        document as unknown as Record<
                                                            string,
                                                            unknown
                                                        >,
                                                        existingNames,
                                                    ).replace(/\.json$/i, ''),
                                                );
                                                setSaveAsOpen(true);
                                            }}
                                        >
                                            {t('mission.publish.saveAs')}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            disabled={busyAction !== null}
                                            onClick={() => {
                                                const current =
                                                    (isFarmMissionPath(activePath)
                                                        ? activePath?.split('/').pop()
                                                        : null) ??
                                                    farmMissionFilename(
                                                        document as unknown as Record<
                                                            string,
                                                            unknown
                                                        >,
                                                    );
                                                const unique = uniquifyFarmFilename(current, [
                                                    ...existingNames,
                                                    current,
                                                ]);
                                                setPublishError(null);
                                                setBusyAction('duplicate');
                                                void persistFarm(farmMissionPathFromName(unique))
                                                    .catch((cause: unknown) => {
                                                        setPublishError(
                                                            cause instanceof Error
                                                                ? cause.message
                                                                : t('mission.load.unknownError'),
                                                        );
                                                    })
                                                    .finally(() => setBusyAction(null));
                                            }}
                                        >
                                            {t('mission.publish.duplicate')}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            onClick={() => {
                                                const filename = isFarmMissionPath(activePath)
                                                    ? (activePath?.split('/').pop() ??
                                                      'mission.json')
                                                    : farmMissionFilename(
                                                          document as unknown as Record<
                                                              string,
                                                              unknown
                                                          >,
                                                      );
                                                downloadAgriDocument(
                                                    document as unknown as Record<string, unknown>,
                                                    filename,
                                                );
                                            }}
                                        >
                                            {t('mission.publish.export')}
                                        </Button>
                                    </div>
                                )}
                                {publishError ? (
                                    <p className="ds-field-error" role="alert">
                                        {t('mission.publish.error', { error: publishError })}
                                    </p>
                                ) : null}
                                <section
                                    className="studio-mission-publish-history"
                                    aria-label={t('mission.publish.history')}
                                >
                                    <h3>{t('mission.publish.history')}</h3>
                                    <PublicationPanel
                                        t={t}
                                        catalogue={publications}
                                        overlay={false}
                                    />
                                </section>
                                <Dialog
                                    open={saveAsOpen}
                                    onOpenChange={setSaveAsOpen}
                                    title={t('mission.publish.saveAs')}
                                    className="studio-publish-dialog"
                                >
                                    <Input
                                        id="mission-save-as-name"
                                        label={t('mission.publish.saveAsName')}
                                        value={saveAsName}
                                        onChange={(event) => setSaveAsName(event.target.value)}
                                    />
                                    <div className="studio-publish-actions">
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            onClick={() => setSaveAsOpen(false)}
                                        >
                                            {t('pub.cancel')}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="primary"
                                            disabled={!saveAsName.trim() || busyAction !== null}
                                            onClick={() => {
                                                const unique = uniquifyFarmFilename(
                                                    saveAsName.trim(),
                                                    existingNames,
                                                );
                                                setBusyAction('saveAs');
                                                setPublishError(null);
                                                void persistFarm(farmMissionPathFromName(unique))
                                                    .then(() => setSaveAsOpen(false))
                                                    .catch((cause: unknown) => {
                                                        setPublishError(
                                                            cause instanceof Error
                                                                ? cause.message
                                                                : t('mission.load.unknownError'),
                                                        );
                                                    })
                                                    .finally(() => setBusyAction(null));
                                            }}
                                        >
                                            {t('app.save')}
                                        </Button>
                                    </div>
                                </Dialog>
                            </div>
                        ),
                    },
                ].filter((item) => advanced || item.value !== 'edit')}
            />
        </aside>
    );
}
