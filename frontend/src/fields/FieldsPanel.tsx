import { useEffect, useRef, useState, type ReactElement } from 'react';

import { AdvancedModeLink } from '../app/AdvancedModeLink';
import { isAdvancedUi, type UiMode } from '../app/farm-api';
import { Button } from '../design-system/Button';
import { Input } from '../design-system/Field';
import { Tabs } from '../design-system/Disclosure';
import { Dialog, Tooltip } from '../design-system/Overlay';
import { nextFieldDraftName } from './edit-tools';
import { FieldGeometryTree } from './FieldGeometryTree';
import { FieldRowsGenerator, FieldsImportExport } from './FieldsEditExtras';
import { polygonAreaM2 } from './geojson';
import type { FieldSummary } from './types';
import type { useFieldCatalogue } from './useFieldCatalogue';

type Catalogue = ReturnType<typeof useFieldCatalogue>;
type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface FieldsPanelProps {
    t: Translate;
    catalogue: Catalogue;
    overlay?: boolean;
    onDrawStarted?: () => void;
    uiMode?: UiMode;
    tab?: string;
    onTabChange?: (tab: string) => void;
}

export interface FieldNavigationGroup {
    id: string;
    fields: FieldSummary[];
}

/** Flat today (D13-04), ready to receive island groups without changing the list UI. */
export function fieldNavigationGroups(fields: FieldSummary[]): FieldNavigationGroup[] {
    return [{ id: 'all', fields }];
}

function formatHectares(areaM2: number | null): string {
    if (areaM2 === null) {
        return '—';
    }
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(areaM2 / 10_000)} ha`;
}

function FieldNavigator({ t, catalogue }: { t: Translate; catalogue: Catalogue }): ReactElement {
    if (catalogue.loading) {
        return <p className="studio-muted">{t('fields.loading')}</p>;
    }
    if (!catalogue.available) {
        return <p className="studio-muted">{t('fields.unavailable')}</p>;
    }
    if (catalogue.fields.length === 0) {
        return <p className="studio-muted">{t('fields.navigate.empty')}</p>;
    }
    return (
        <ul className="studio-fields-navigator" aria-label={t('fields.list')}>
            {fieldNavigationGroups(catalogue.fields).flatMap((group) =>
                group.fields.map((field) => (
                    <li key={`${group.id}:${field.id}`}>
                        <button
                            type="button"
                            className={field.id === catalogue.selectedId ? 'is-active' : undefined}
                            onClick={() => catalogue.select(field.id, { fit: true })}
                        >
                            <span>{field.name}</span>
                            <span className="studio-muted">
                                {formatHectares(polygonAreaM2(field.geometry))}
                            </span>
                        </button>
                    </li>
                )),
            )}
        </ul>
    );
}

export function FieldsPanel({
    t,
    catalogue,
    overlay = false,
    onDrawStarted,
    uiMode,
    tab,
    onTabChange,
}: FieldsPanelProps): ReactElement {
    const advanced = isAdvancedUi(uiMode);
    const [internalTab, setInternalTab] = useState('explore');
    const [pendingName, setPendingName] = useState('');
    const [nameOpen, setNameOpen] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [renameDraft, setRenameDraft] = useState('');
    const creatingRef = useRef(false);
    const activeTab = tab ?? internalTab;
    const changeTab = (next: string) => {
        setInternalTab(next);
        onTabChange?.(next);
    };
    const chipField =
        catalogue.selected ??
        catalogue.fields.find((field) => field.id === catalogue.selectedId) ??
        null;
    const selectedName = chipField?.name ?? '';
    useEffect(() => {
        if (creatingRef.current && catalogue.selectedId && catalogue.tool === 'select') {
            creatingRef.current = false;
            changeTab('edit');
        }
    }, [catalogue.selectedId, catalogue.tool]);

    const startFromMap = () => {
        setPendingName(nextFieldDraftName(catalogue.fields));
        setNameOpen(true);
    };
    const confirmFromMap = () => {
        const name = pendingName.trim();
        if (!name) {
            return;
        }
        creatingRef.current = true;
        catalogue.startCreateField(name);
        setNameOpen(false);
        onDrawStarted?.();
    };
    const commitRename = () => {
        const name = renameDraft.trim();
        setRenaming(false);
        if (!chipField || !name || name === selectedName) {
            return;
        }
        void catalogue.saveSelected({ name });
    };

    const tabs = [
        {
            value: 'explore',
            label: t('fields.tab.explore'),
            content: (
                <div className="studio-panel-tab">
                    <section
                        className="studio-mission-create-menu"
                        aria-labelledby="fields-create-heading"
                    >
                        <h3 id="fields-create-heading">{t('fields.create.heading')}</h3>
                        <Button type="button" variant="secondary" onClick={startFromMap}>
                            {t('fields.create.fromMap')}
                        </Button>
                        <Tooltip content={t('fields.create.fromFile.comingSoon')}>
                            <span className="studio-mission-create-coming">
                                <Button type="button" variant="secondary" disabled>
                                    {t('fields.create.fromFile')}
                                </Button>
                            </span>
                        </Tooltip>
                    </section>
                    <section
                        className="studio-mission-explore-list"
                        aria-labelledby="fields-explore-heading"
                    >
                        <h3 id="fields-explore-heading">{t('fields.explore.heading')}</h3>
                        <FieldNavigator t={t} catalogue={catalogue} />
                    </section>
                </div>
            ),
        },
        {
            value: 'edit',
            label: t('fields.tab.edit'),
            disabled: !catalogue.selectedId && catalogue.editIntent !== 'create_field',
            tooltip:
                !catalogue.selectedId && catalogue.editIntent !== 'create_field'
                    ? t('fields.edit.needField')
                    : undefined,
            content: (
                <div className="studio-panel-tab">
                    <p className="studio-muted">{t('fields.edit.hint')}</p>
                    {catalogue.error ? (
                        <p className="studio-muted" role="alert">
                            {catalogue.error.startsWith('fields.')
                                ? t(catalogue.error)
                                : catalogue.error}
                        </p>
                    ) : null}
                    <FieldGeometryTree t={t} catalogue={catalogue} />
                    {advanced ? <FieldRowsGenerator t={t} catalogue={catalogue} /> : null}
                    <FieldsImportExport t={t} catalogue={catalogue} />
                </div>
            ),
        },
    ];
    return (
        <aside
            className={overlay ? 'studio-context is-overlay' : 'studio-context'}
            aria-label={t('nav.fields')}
        >
            <header className="studio-panel-header">
                <h2>{t('nav.fields')}</h2>
                {renaming && chipField ? (
                    <input
                        aria-label={t('fields.active.name')}
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
                            chipField
                                ? 'studio-mission-active-name'
                                : 'studio-mission-active-name is-empty'
                        }
                        disabled={!chipField}
                        title={chipField ? t('fields.active.renameHint') : undefined}
                        onDoubleClick={() => {
                            if (chipField) {
                                setRenameDraft(selectedName);
                                setRenaming(true);
                            }
                        }}
                    >
                        {chipField ? selectedName : t('fields.active.none')}
                    </button>
                )}
            </header>
            {advanced ? null : <AdvancedModeLink t={t} />}
            <Tabs defaultValue="explore" value={activeTab} onValueChange={changeTab} items={tabs} />
            <Dialog
                open={nameOpen}
                onOpenChange={setNameOpen}
                title={t('fields.create.nameDialog.title')}
                className="studio-mission-name-dialog"
            >
                <Input
                    id="fields-new-name"
                    label={t('fields.create.nameDialog.label')}
                    value={pendingName}
                    autoFocus
                    onChange={(event) => setPendingName(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && pendingName.trim()) {
                            confirmFromMap();
                        }
                    }}
                />
                <p className="studio-muted">{t('fields.create.nameDialog.hint')}</p>
                <div className="studio-publish-actions">
                    <Button type="button" variant="secondary" onClick={() => setNameOpen(false)}>
                        {t('pub.cancel')}
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        disabled={!pendingName.trim()}
                        onClick={confirmFromMap}
                    >
                        {t('fields.create.nameDialog.confirm')}
                    </Button>
                </div>
            </Dialog>
        </aside>
    );
}
