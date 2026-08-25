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
import { Dialog, Tooltip } from '../design-system/Overlay';
import type { AgriDocument } from '../domain/agri';
import { createEmptyDocument } from '../domain/draft';
import type { VehicleTwin } from '../domain/equipment';
import { getField } from '../fields/api';
import type { FieldSummary } from '../fields/types';
import { composeMissionFromField } from './from-field';
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
import { missionNameTimestamp, readMissionContext, withMissionName } from './brief';
import { MissionMetaEditor } from './MissionMetaEditor';

export type MissionPanelProps = Omit<MissionAssistantProps, 'view'> & {
    onLoadFarmMission: (path: string, document: unknown) => void;
    onStartNewDocument?: (document: ReturnType<typeof createEmptyDocument>) => void;
    vehicles: VehicleTwin[];
    publications: ReturnType<typeof usePublications>;
    onPublish: () => void;
    uiMode?: UiMode;
    fieldGeofenceInsetCm?: number;
    onTabChange?: (tab: string) => void;
    onSelectField?: (id: string, options?: { fit?: boolean }) => void;
};

function displayName(entry: FarmEntry, fields: FieldSummary[], t: MissionPanelProps['t']): string {
    const explicit = entry.display_name?.trim();
    if (explicit) {
        return explicit;
    }
    const fieldName =
        entry.field_name || fields.find((field) => field.id === entry.field_id)?.name || null;
    if (fieldName && entry.operation) {
        return `${t(`assist.operation.${entry.operation}`)} — ${fieldName}`;
    }
    return entry.name.replace(/\.json$/i, '');
}

function displayDate(entry: FarmEntry): string {
    const namedDate = /^(\d{4}-\d{2}-\d{2})/.exec(entry.name)?.[1];
    if (namedDate) {
        return namedDate;
    }
    return new Date(entry.modified).toLocaleDateString();
}

function activeMissionLabel(
    document: AgriDocument | null | undefined,
    activePath: string | null | undefined,
    t: MissionPanelProps['t'],
): string {
    if (!document) {
        return t('mission.active.none');
    }
    const explicit = readMissionContext(document)?.name;
    if (explicit) {
        return explicit;
    }
    const filename = activePath
        ?.split('/')
        .pop()
        ?.replace(/\.json$/i, '');
    return filename || t('mission.active.unnamed');
}

function MissionExplorer({
    entries,
    loading,
    error,
    activePath,
    loadingPath,
    onLoadMission,
    fields,
    t,
}: {
    entries: FarmEntry[];
    loading: boolean;
    error: string | null;
    activePath: string | null;
    loadingPath: string | null;
    onLoadMission: (path: string) => void;
    fields: FieldSummary[];
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
                        <span
                            className="studio-mission-explorer-title"
                            title={displayName(entry, fields, t)}
                        >
                            {displayName(entry, fields, t)}
                        </span>
                        <span className="studio-mission-explorer-context">
                            <span>{displayDate(entry)}</span>
                            <span>
                                {entry.field_name ||
                                fields.find((field) => field.id === entry.field_id)?.name ||
                                entry.field_id
                                    ? t('mission.load.field', {
                                          field:
                                              entry.field_name ||
                                              fields.find((field) => field.id === entry.field_id)
                                                  ?.name ||
                                              entry.field_id ||
                                              '',
                                      })
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
        assistant,
        onApplyDocument,
        onStartNewDocument,
        activePath,
        onLoadFarmMission,
        document,
        combinations = [],
        fields = [],
        fieldsAvailable = false,
        implements: implementsList = [],
        vehicles = [],
        publications,
        onPublish,
        uiMode,
        fieldGeofenceInsetCm,
        onTabChange,
        onSelectField,
    } = props;
    const advanced = isAdvancedUi(uiMode);
    const [defaultTab, setDefaultTab] = useState('explore');
    const [tabRevision, setTabRevision] = useState(0);
    const [entries, setEntries] = useState<FarmEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [loadingPath, setLoadingPath] = useState<string | null>(null);
    const [saveAsOpen, setSaveAsOpen] = useState(false);
    const [saveAsName, setSaveAsName] = useState('');
    const [publishError, setPublishError] = useState<string | null>(null);
    const [busyAction, setBusyAction] = useState<'save' | 'saveAs' | 'duplicate' | null>(null);
    const [pickingField, setPickingField] = useState(false);
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [loadingFieldId, setLoadingFieldId] = useState<string | null>(null);
    const [pendingDocument, setPendingDocument] = useState<AgriDocument | null>(null);
    const [pendingName, setPendingName] = useState('');
    const [renaming, setRenaming] = useState(false);
    const [renameDraft, setRenameDraft] = useState('');

    const existingNames = entries.map((entry) => entry.name);
    const missionLabel = activeMissionLabel(document, activePath, t);

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

    useEffect(() => {
        if (!document && defaultTab === 'edit') {
            changeTab('explore');
        }
    }, [document, defaultTab]);

    const changeTab = (tab: string) => {
        setDefaultTab(tab);
        onTabChange?.(tab);
    };

    const goToEditor = () => {
        if (advanced) {
            changeTab('edit');
            setTabRevision((value) => value + 1);
        }
    };

    const applyCreatedDocument = (document: ReturnType<typeof createEmptyDocument>) => {
        if (onStartNewDocument) {
            onStartNewDocument(document);
        } else {
            onApplyDocument?.(document);
        }
        goToEditor();
    };

    const startFromScratch = () => {
        setPickingField(false);
        setFieldError(null);
        assistant.close();
        setPendingName(`${t('mission.create.defaultScratchName')} — ${missionNameTimestamp()}`);
        setPendingDocument(createEmptyDocument());
    };

    const startWithAssistant = () => {
        setPickingField(false);
        setFieldError(null);
        assistant.start();
    };

    const startFromField = async (field: FieldSummary) => {
        setLoadingFieldId(field.id);
        setFieldError(null);
        try {
            let source: FieldSummary | Awaited<ReturnType<typeof getField>> = field;
            try {
                source = await getField(field.id);
            } catch {
                // Summary geometry is enough to open the editor; holes/zones are a bonus.
            }
            const document = composeMissionFromField(source, {
                geofenceInsetCm: fieldGeofenceInsetCm,
            });
            if (!document) {
                setFieldError(t('mission.create.fromField.invalid'));
                return;
            }
            assistant.close();
            setPickingField(false);
            onSelectField?.(source.id, { fit: true });
            setPendingName(
                `${source.name} — ${t('mission.create.defaultMission')} — ${missionNameTimestamp()}`,
            );
            setPendingDocument(document);
        } catch (cause: unknown) {
            setFieldError(cause instanceof Error ? cause.message : t('mission.load.unknownError'));
        } finally {
            setLoadingFieldId(null);
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

    const confirmPendingMission = () => {
        const name = pendingName.trim();
        if (!pendingDocument || !name) {
            return;
        }
        applyCreatedDocument(withMissionName(pendingDocument, name));
        setPendingDocument(null);
        setPendingName('');
    };

    const commitRename = () => {
        const name = renameDraft.trim();
        setRenaming(false);
        if (!document || !name || name === missionLabel) {
            return;
        }
        onApplyDocument?.(withMissionName(document, name));
    };

    return (
        <aside
            className={overlay ? 'studio-context is-overlay' : 'studio-context'}
            aria-label={t('nav.missions')}
        >
            <header className="studio-panel-header">
                <h2>{t('nav.missions')}</h2>
                {renaming && document ? (
                    <input
                        id="mission-active-name"
                        aria-label={t('mission.active.name')}
                        className="ds-input studio-mission-active-input"
                        value={renameDraft}
                        autoFocus
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.currentTarget.blur();
                            } else if (event.key === 'Escape') {
                                setRenaming(false);
                            }
                        }}
                    />
                ) : (
                    <button
                        type="button"
                        className={
                            document
                                ? 'studio-mission-active-name'
                                : 'studio-mission-active-name is-empty'
                        }
                        disabled={!document}
                        title={document ? t('mission.active.renameHint') : undefined}
                        onDoubleClick={() => {
                            if (document) {
                                setRenameDraft(missionLabel);
                                setRenaming(true);
                            }
                        }}
                    >
                        {missionLabel}
                    </button>
                )}
            </header>
            {advanced ? null : <AdvancedModeLink t={t} />}
            <Tabs
                key={tabRevision}
                defaultValue={defaultTab}
                value={defaultTab}
                onValueChange={changeTab}
                items={[
                    {
                        value: 'explore',
                        label: t('mission.tab.explore'),
                        content: (
                            <div className="studio-panel-tab">
                                <section
                                    className="studio-mission-create-menu"
                                    aria-labelledby="mission-create-heading"
                                >
                                    <h3 id="mission-create-heading">
                                        {t('mission.create.heading')}
                                    </h3>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={startFromScratch}
                                    >
                                        {t('mission.create.scratch')}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        aria-expanded={pickingField}
                                        onClick={() => {
                                            setFieldError(null);
                                            assistant.close();
                                            setPickingField((open) => !open);
                                        }}
                                    >
                                        {t('mission.create.fromField')}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="primary"
                                        onClick={startWithAssistant}
                                    >
                                        {t('mission.create.assistant')}
                                    </Button>
                                    <Tooltip content={t('mission.create.fromFile.comingSoon')}>
                                        <span className="studio-mission-create-coming">
                                            <Button type="button" variant="secondary" disabled>
                                                {t('mission.create.fromFile')}
                                            </Button>
                                        </span>
                                    </Tooltip>
                                </section>
                                {pickingField ? (
                                    <div className="studio-mission-field-picker">
                                        <p className="studio-muted">
                                            {t('mission.create.fromField.help')}
                                        </p>
                                        {!fieldsAvailable ? (
                                            <p className="studio-muted">
                                                {t('fields.unavailable')}
                                            </p>
                                        ) : fields.length === 0 ? (
                                            <p className="studio-muted">
                                                {t('mission.create.fromField.empty')}
                                            </p>
                                        ) : (
                                            <ul className="studio-mission-explorer">
                                                {fields.map((field) => (
                                                    <li key={field.id}>
                                                        <button
                                                            type="button"
                                                            disabled={loadingFieldId !== null}
                                                            onClick={() =>
                                                                void startFromField(field)
                                                            }
                                                        >
                                                            <span className="studio-mission-explorer-title">
                                                                {field.name}
                                                            </span>
                                                            {field.campaign ? (
                                                                <span className="studio-mission-explorer-context">
                                                                    {field.campaign}
                                                                </span>
                                                            ) : null}
                                                            {loadingFieldId === field.id ? (
                                                                <span className="studio-muted">
                                                                    {t(
                                                                        'mission.create.fromField.loading',
                                                                    )}
                                                                </span>
                                                            ) : null}
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                ) : null}
                                {fieldError ? (
                                    <p className="ds-field-error" role="alert">
                                        {fieldError}
                                    </p>
                                ) : null}
                                {assistant.open ? (
                                    <MissionAssistant {...props} overlay={false} view="create" />
                                ) : null}
                                <section
                                    className="studio-mission-explore-list"
                                    aria-labelledby="mission-explore-heading"
                                >
                                    <h3 id="mission-explore-heading">
                                        {t('mission.explore.heading')}
                                    </h3>
                                    <MissionExplorer
                                        entries={entries}
                                        loading={loading}
                                        error={error}
                                        activePath={activePath}
                                        loadingPath={loadingPath}
                                        onLoadMission={(path) => void loadMission(path)}
                                        fields={fields}
                                        t={t}
                                    />
                                </section>
                            </div>
                        ),
                    },
                    {
                        value: 'edit',
                        label: t('mission.tab.edit'),
                        disabled: !document,
                        tooltip: !document ? t('mission.edit.needDocument') : undefined,
                        content: (
                            <div className="studio-panel-tab">
                                <MissionAssistant {...props} overlay={false} view="edit" />
                                <MissionMetaEditor
                                    t={t}
                                    document={document}
                                    combinations={combinations}
                                    fields={fields}
                                    vehicles={vehicles}
                                    implements={implementsList}
                                    onApplyDocument={onApplyDocument}
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
            <Dialog
                open={pendingDocument !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingDocument(null);
                        setPendingName('');
                    }
                }}
                title={t('mission.create.nameDialog.title')}
                className="studio-mission-name-dialog"
            >
                <Input
                    id="mission-new-name"
                    label={t('mission.create.nameDialog.label')}
                    value={pendingName}
                    autoFocus
                    onChange={(event) => setPendingName(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && pendingName.trim()) {
                            confirmPendingMission();
                        }
                    }}
                />
                <p className="studio-muted">{t('mission.create.nameDialog.hint')}</p>
                <div className="studio-publish-actions">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                            setPendingDocument(null);
                            setPendingName('');
                        }}
                    >
                        {t('pub.cancel')}
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        disabled={!pendingName.trim()}
                        onClick={confirmPendingMission}
                    >
                        {t('mission.create.nameDialog.confirm')}
                    </Button>
                </div>
            </Dialog>
        </aside>
    );
}
