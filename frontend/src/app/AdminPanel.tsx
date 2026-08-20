import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-react';

import { Banner, Button, Chip, Input, Select } from '../design-system';
import { SUPPORTED_LANGUAGES } from '../i18n/adapter';
import {
    FARM_TYPES,
    pickFarmFolder,
    type FarmStartView,
    type FarmType,
    type UiMode,
} from './farm-api';
import type { FarmState } from './useFarm';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface AdminPanelProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    farm: FarmState;
    /** Reads the live map camera, so the start view needs no coordinates typed. */
    readMapView?: () => FarmStartView | null;
    /** Reload catalogues and missions after a farm switch, without a page reload. */
    onFarmChanged?: () => void;
    onLanguage?: (code: string) => void;
    overlay?: boolean;
}

function SaveChip({
    t,
    state,
}: {
    t: AdminPanelProps['t'];
    state: SaveState;
}): ReactElement | null {
    if (state === 'idle') {
        return null;
    }
    if (state === 'saving') {
        return (
            <Chip tone="info" icon={LoaderCircle}>
                {t('admin.saving')}
            </Chip>
        );
    }
    if (state === 'error') {
        return (
            <Chip tone="danger" icon={TriangleAlert}>
                {t('admin.saveFailed')}
            </Chip>
        );
    }
    return (
        <Chip tone="valid" icon={CircleCheck}>
            {t('admin.saved')}
        </Chip>
    );
}

/**
 * Administration panel (L13 §8): the farm, its working folder, and the preferences
 * that live in `farm.json`, including `ui_mode` which hides expert tools in the rest
 * of the shell.
 */
export function AdminPanel({
    t,
    farm,
    readMapView,
    onFarmChanged,
    onLanguage,
    overlay = false,
}: AdminPanelProps): ReactElement {
    const document = farm.farm;
    const [name, setName] = useState(document?.name ?? '');
    const [rootDraft, setRootDraft] = useState('');
    const [newFarmName, setNewFarmName] = useState('');
    const [pickingFolder, setPickingFolder] = useState(false);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [problem, setProblem] = useState<string | null>(null);

    // Follow a farm switch: the panel shows the farm that is open, not the one typed.
    useEffect(() => {
        setName(document?.name ?? '');
    }, [document?.name, farm.root]);

    const commit = useCallback(
        async (patch: Parameters<FarmState['save']>[0]) => {
            setProblem(null);
            setSaveState('saving');
            try {
                await farm.save(patch);
                setSaveState('saved');
            } catch (reason: unknown) {
                setSaveState('error');
                setProblem(reason instanceof Error ? reason.message : t('admin.saveFailed'));
            }
        },
        [farm, t],
    );

    const openRoot = useCallback(
        async (root: string) => {
            const trimmed = root.trim();
            if (!trimmed) {
                setProblem(t('admin.folder.required'));
                return;
            }
            setProblem(null);
            setSaveState('saving');
            try {
                await farm.openExisting(trimmed);
                setSaveState('saved');
                setRootDraft('');
                onFarmChanged?.();
            } catch (reason: unknown) {
                setSaveState('error');
                setProblem(reason instanceof Error ? reason.message : t('admin.folder.failed'));
            }
        },
        [farm, onFarmChanged, t],
    );

    const createAtRoot = useCallback(async () => {
        const root = rootDraft.trim();
        const farmName = newFarmName.trim();
        if (!root) {
            setProblem(t('admin.folder.required'));
            return;
        }
        if (!farmName) {
            setProblem(t('admin.create.nameRequired'));
            return;
        }
        setProblem(null);
        setSaveState('saving');
        try {
            await farm.create(root, farmName);
            setSaveState('saved');
            setRootDraft('');
            setNewFarmName('');
            onFarmChanged?.();
        } catch (reason: unknown) {
            setSaveState('error');
            setProblem(reason instanceof Error ? reason.message : t('admin.create.failed'));
        }
    }, [farm, newFarmName, onFarmChanged, rootDraft, t]);

    const chooseRoot = useCallback(async () => {
        setProblem(null);
        setPickingFolder(true);
        try {
            const selected = await pickFarmFolder();
            if (selected) {
                setRootDraft(selected);
            }
        } catch (reason: unknown) {
            setProblem(reason instanceof Error ? reason.message : t('admin.folder.pickFailed'));
        } finally {
            setPickingFolder(false);
        }
    }, [t]);

    const reindex = useCallback(async () => {
        setProblem(null);
        setSaveState('saving');
        try {
            await farm.reindex();
            setSaveState('saved');
        } catch (reason: unknown) {
            setSaveState('error');
            setProblem(reason instanceof Error ? reason.message : t('admin.index.failed'));
        }
    }, [farm, t]);

    const useCurrentView = useCallback(() => {
        const view = readMapView?.();
        if (!view) {
            setProblem(t('admin.startView.unavailable'));
            return;
        }
        void commit({
            start_view: {
                lat: Number(view.lat.toFixed(6)),
                lon: Number(view.lon.toFixed(6)),
                zoom: Number(view.zoom.toFixed(2)),
            },
        });
    }, [commit, readMapView, t]);

    const startView = document?.start_view;

    return (
        <aside
            className={overlay ? 'studio-context is-overlay' : 'studio-context'}
            aria-label={t('nav.admin')}
        >
            <header className="studio-panel-header">
                <h2>{t('nav.admin')}</h2>
                <SaveChip t={t} state={saveState} />
            </header>

            <div className="studio-admin">
                {!farm.available && !farm.loading ? (
                    <Banner tone="warning" icon={TriangleAlert}>
                        {t('farm.unavailable')}
                    </Banner>
                ) : null}
                {problem ? (
                    <Banner tone="danger" icon={TriangleAlert}>
                        {problem}
                    </Banner>
                ) : null}

                {document ? (
                    <section className="studio-admin-section">
                        <h3>{t('admin.farm')}</h3>
                        <Input
                            id="admin-farm-name"
                            label={t('admin.farmName')}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            onBlur={() => {
                                if (name.trim() && name !== document.name) {
                                    void commit({ name: name.trim() });
                                }
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.currentTarget.blur();
                                }
                            }}
                        />
                        <Select
                            id="admin-farm-type"
                            label={t('admin.farmType')}
                            value={document.farm_type}
                            onValueChange={(value) => void commit({ farm_type: value as FarmType })}
                            options={FARM_TYPES.map((type) => ({
                                value: type,
                                label: t(`farm.type.${type}`),
                            }))}
                        />
                        <p className="studio-muted">{t('admin.farmType.hint')}</p>
                    </section>
                ) : null}

                <section className="studio-admin-section">
                    <h3>{t('admin.uiMode')}</h3>
                    {document ? (
                        <>
                            <Select
                                id="admin-ui-mode"
                                label={t('admin.uiMode')}
                                value={document.ui_mode}
                                onValueChange={(value) => void commit({ ui_mode: value as UiMode })}
                                options={[
                                    { value: 'basic', label: t('admin.uiMode.basic') },
                                    { value: 'advanced', label: t('admin.uiMode.advanced') },
                                ]}
                            />
                            <p className="studio-muted">{t('admin.uiMode.hint')}</p>
                        </>
                    ) : (
                        <p className="studio-muted">{t('admin.uiMode.needFarm')}</p>
                    )}
                </section>

                <section className="studio-admin-section">
                    <h3>{t('admin.folder')}</h3>
                    <p className="studio-admin-root" title={farm.root ?? undefined}>
                        {farm.root ?? t('admin.folder.none')}
                    </p>
                    <Input
                        id="admin-farm-root"
                        label={t('admin.folder.selected')}
                        placeholder="/Users/moi/fermes/ferme-xy"
                        value={rootDraft}
                        onChange={(event) => setRootDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                void openRoot(rootDraft);
                            }
                        }}
                    />
                    <p className="studio-muted">{t('admin.folder.hint')}</p>
                    <div className="studio-admin-actions">
                        <Button
                            variant="secondary"
                            disabled={!farm.available || pickingFolder}
                            onClick={() => void chooseRoot()}
                        >
                            {pickingFolder
                                ? t('admin.folder.picking')
                                : t('admin.folder.pickAction')}
                        </Button>
                        <Button
                            variant="secondary"
                            disabled={!farm.available || rootDraft.trim().length === 0}
                            onClick={() => void openRoot(rootDraft)}
                        >
                            {t('admin.folder.openAction')}
                        </Button>
                        <Button
                            variant="secondary"
                            disabled={!farm.available || !farm.root}
                            title={t('admin.index.hint')}
                            onClick={() => void reindex()}
                        >
                            {t('admin.index.rebuild')}
                        </Button>
                    </div>
                    <div className="studio-admin-create">
                        <Input
                            id="admin-new-farm-name"
                            label={t('admin.create.name')}
                            placeholder={t('admin.create.namePlaceholder')}
                            value={newFarmName}
                            onChange={(event) => setNewFarmName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    void createAtRoot();
                                }
                            }}
                        />
                        <Button
                            variant="primary"
                            disabled={
                                !farm.available ||
                                !rootDraft.trim() ||
                                !newFarmName.trim() ||
                                pickingFolder
                            }
                            onClick={() => void createAtRoot()}
                        >
                            {t('admin.create.action')}
                        </Button>
                        <p className="studio-muted">{t('admin.create.hint')}</p>
                    </div>
                    {farm.recent.length > 0 ? (
                        <>
                            <h4>{t('admin.folder.recent')}</h4>
                            <ul className="studio-admin-recent">
                                {farm.recent.map((root) => (
                                    <li key={root}>
                                        <button
                                            type="button"
                                            className={root === farm.root ? 'is-active' : undefined}
                                            onClick={() => void openRoot(root)}
                                        >
                                            {root}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : null}
                </section>

                {document ? (
                    <section className="studio-admin-section">
                        <h3>{t('admin.preferences')}</h3>
                        <p className="studio-admin-view">
                            {startView
                                ? t('admin.startView.value', {
                                      lat: startView.lat.toFixed(5),
                                      lon: startView.lon.toFixed(5),
                                      zoom: startView.zoom,
                                  })
                                : t('admin.startView.none')}
                        </p>
                        <div className="studio-admin-actions">
                            <Button variant="secondary" onClick={useCurrentView}>
                                {t('admin.startView.useCurrent')}
                            </Button>
                        </div>
                        <Select
                            id="admin-language"
                            label={t('app.language')}
                            value={document.language}
                            onValueChange={(value) => {
                                onLanguage?.(value);
                                void commit({ language: value });
                            }}
                            options={SUPPORTED_LANGUAGES.map((code) => ({
                                value: code,
                                label: t(`admin.language.${code}`),
                            }))}
                        />
                        <Select
                            id="admin-theme"
                            label={t('admin.theme')}
                            value={document.theme}
                            onValueChange={(value) =>
                                void commit({ theme: value as 'light' | 'dark' })
                            }
                            options={[
                                { value: 'light', label: t('admin.theme.light') },
                                { value: 'dark', label: t('admin.theme.dark') },
                            ]}
                        />
                        <p className="studio-muted">{t('admin.theme.hint')}</p>
                    </section>
                ) : null}
            </div>
        </aside>
    );
}
