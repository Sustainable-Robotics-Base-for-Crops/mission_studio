import { useState, type ChangeEvent, type ReactElement } from 'react';

import { AdvancedModeLink } from '../app/AdvancedModeLink';
import { isAdvancedUi, type UiMode } from '../app/farm-api';
import { Input, Select } from '../design-system/Field';
import { Tabs } from '../design-system/Disclosure';
import { DEFAULT_ROW_SPACING_M } from '../domain/coverage';
import { latLngToLocal, localToLatLng } from '../domain/geometry';
import { latLngsFromUnknown, ramerDouglasPeucker, TEACH_SIMPLIFY_M } from '../domain/teach-repeat';
import { addGuidanceLine, createRowSet } from './api';
import { FieldsContextPanel } from './FieldsContextPanel';
import { polygonAreaM2 } from './geojson';
import {
    bedsFromFieldAndAxis,
    DEFAULT_BED_COUNT,
    DEFAULT_BED_PATH_M,
    DEFAULT_BED_WIDTH_M,
    rowsFromFieldAndAxis,
} from './rows';
import type { FieldSummary, GeoJSONLineString } from './types';
import type { useFieldCatalogue } from './useFieldCatalogue';

type Catalogue = ReturnType<typeof useFieldCatalogue>;
type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface FieldsPanelProps {
    t: Translate;
    catalogue: Catalogue;
    overlay?: boolean;
    onDrawStarted?: () => void;
    uiMode?: UiMode;
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

function WorkPerformedImporter({
    t,
    catalogue,
}: {
    t: Translate;
    catalogue: Catalogue;
}): ReactElement {
    const [kind, setKind] = useState<'rows' | 'beds'>('rows');
    const [spacingM, setSpacingM] = useState(String(DEFAULT_ROW_SPACING_M));
    const [widthM, setWidthM] = useState(String(DEFAULT_BED_WIDTH_M));
    const [pathM, setPathM] = useState(String(DEFAULT_BED_PATH_M));
    const [count, setCount] = useState(String(DEFAULT_BED_COUNT));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const importTrace = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || !catalogue.selected) {
            setError(t('fields.work.needField'));
            return;
        }
        setBusy(true);
        setError(null);
        setSuccess(null);
        try {
            const raw = JSON.parse(await file.text()) as unknown;
            const latLngs = latLngsFromUnknown(raw);
            const first = latLngs[0];
            if (!first || latLngs.length < 2) {
                throw new Error(t('fields.work.invalidTrace'));
            }
            const origin = { lat: first.lat, lon: first.lng };
            const simplified = ramerDouglasPeucker(
                latLngs.map((point) => latLngToLocal(point, origin)),
                TEACH_SIMPLIFY_M,
            ).map((point) => localToLatLng(point, origin));
            const axis: GeoJSONLineString = {
                type: 'LineString',
                coordinates: simplified.map((point) => [point.lng, point.lat]),
            };
            const asBeds = kind === 'beds';
            const spacing = Number(spacingM);
            const width = Number(widthM);
            const path = Number(pathM);
            const bedCount = Number(count);
            const geometries = asBeds
                ? bedsFromFieldAndAxis(catalogue.selected.geometry, axis, {
                      widthM: width,
                      pathM: path,
                      count: bedCount,
                  })
                : rowsFromFieldAndAxis(catalogue.selected.geometry, axis, spacing);
            if (geometries.length === 0) {
                throw new Error(
                    t(asBeds ? 'fields.error.noBedsGenerated' : 'fields.error.noRowsGenerated'),
                );
            }
            const guidance = await addGuidanceLine(catalogue.selected.id, {
                geometry: axis,
                name: t('fields.work.axisName'),
            });
            await createRowSet(catalogue.selected.id, {
                name: t(asBeds ? 'fields.work.bedsName' : 'fields.work.rowsName'),
                kind,
                spacing_m: asBeds ? width + path : spacing,
                width_m: asBeds ? width : null,
                axis_line_id: guidance.id,
                rows: geometries.map((geometry, index) => ({
                    number: index + 1,
                    geometry,
                    name: t(asBeds ? 'fields.typeBed' : 'fields.typeRow', {
                        number: index + 1,
                    }),
                })),
            });
            await catalogue.reload();
            await catalogue.select(catalogue.selected.id, { fit: true });
            setSuccess(t('fields.work.imported', { count: geometries.length }));
        } catch (cause: unknown) {
            setError(cause instanceof Error ? cause.message : t('fields.work.invalidTrace'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="studio-panel-tab studio-fields-import">
            <p className="studio-muted">{t('fields.work.hint')}</p>
            {!catalogue.selected ? (
                <p className="studio-muted">{t('fields.work.needField')}</p>
            ) : (
                <>
                    <p>{t('fields.work.target', { name: catalogue.selected.name })}</p>
                    <Select
                        id="fields-work-layout"
                        label={t('fields.layoutKind')}
                        value={kind}
                        onValueChange={(value) => setKind(value as 'rows' | 'beds')}
                        options={[
                            { value: 'rows', label: t('fields.layoutRows') },
                            { value: 'beds', label: t('fields.layoutBeds') },
                        ]}
                    />
                    {kind === 'rows' ? (
                        <Input
                            id="fields-work-spacing"
                            label={t('fields.spacing')}
                            unit="m"
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={spacingM}
                            onChange={(event) => setSpacingM(event.target.value)}
                        />
                    ) : (
                        <>
                            <Input
                                id="fields-work-width"
                                label={t('fields.bedWidth')}
                                unit="m"
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={widthM}
                                onChange={(event) => setWidthM(event.target.value)}
                            />
                            <Input
                                id="fields-work-path"
                                label={t('fields.bedPath')}
                                unit="m"
                                type="number"
                                min="0"
                                step="0.01"
                                value={pathM}
                                onChange={(event) => setPathM(event.target.value)}
                            />
                            <Input
                                id="fields-work-count"
                                label={t('fields.bedCount')}
                                type="number"
                                min="1"
                                step="1"
                                value={count}
                                onChange={(event) => setCount(event.target.value)}
                            />
                        </>
                    )}
                    <label className="studio-file-label">
                        <span>{busy ? t('fields.work.importing') : t('fields.work.choose')}</span>
                        <input
                            type="file"
                            accept=".json,.geojson,application/json,application/geo+json"
                            disabled={busy}
                            onChange={(event) => void importTrace(event)}
                        />
                    </label>
                </>
            )}
            {error ? (
                <p className="ds-field-error" role="alert">
                    {error}
                </p>
            ) : null}
            {success ? <p className="studio-muted">{success}</p> : null}
        </div>
    );
}

function ThirdPartyImporter({
    t,
    catalogue,
}: {
    t: Translate;
    catalogue: Catalogue;
}): ReactElement {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const importGeoJson = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await catalogue.importFile(file);
        } catch (cause: unknown) {
            setError(cause instanceof Error ? cause.message : t('fields.thirdParty.invalid'));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="studio-panel-tab studio-fields-import">
            <p className="studio-muted">{t('fields.thirdParty.hint')}</p>
            <label className="studio-file-label">
                <span>{busy ? t('fields.thirdParty.importing') : t('fields.importGeojson')}</span>
                <input
                    type="file"
                    accept=".json,.geojson,application/geo+json"
                    disabled={busy}
                    onChange={(event) => void importGeoJson(event)}
                />
            </label>
            {error ? (
                <p className="ds-field-error" role="alert">
                    {error}
                </p>
            ) : null}
            <ul className="studio-fields-formats" aria-label={t('fields.thirdParty.unavailable')}>
                {['KML', 'Shapefile (.shp + annexes)', 'GeoPackage (.gpkg)'].map((format) => (
                    <li key={format}>
                        <span>{format}</span>
                        <span>{t('fields.thirdParty.notAvailable')}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function FieldsPanel({
    t,
    catalogue,
    overlay = false,
    onDrawStarted,
    uiMode,
}: FieldsPanelProps): ReactElement {
    const advanced = isAdvancedUi(uiMode);
    const tabs = [
        {
            value: 'navigate',
            label: t('fields.tab.navigate'),
            content: (
                <div className="studio-panel-tab">
                    <FieldNavigator t={t} catalogue={catalogue} />
                </div>
            ),
        },
        {
            value: 'edit',
            label: t('fields.tab.edit'),
            content: (
                <FieldsContextPanel
                    t={t}
                    catalogue={catalogue}
                    overlay={false}
                    onDrawStarted={onDrawStarted}
                />
            ),
        },
        {
            value: 'work',
            label: t('fields.tab.workPerformed'),
            content: <WorkPerformedImporter t={t} catalogue={catalogue} />,
        },
        {
            value: 'third-party',
            label: t('fields.tab.thirdParty'),
            content: <ThirdPartyImporter t={t} catalogue={catalogue} />,
        },
    ].filter((item) => advanced || (item.value !== 'work' && item.value !== 'third-party'));
    return (
        <aside
            className={overlay ? 'studio-context is-overlay' : 'studio-context'}
            aria-label={t('nav.fields')}
        >
            <header className="studio-panel-header">
                <h2>{t('nav.fields')}</h2>
            </header>
            {advanced ? null : <AdvancedModeLink t={t} />}
            <Tabs defaultValue="navigate" items={tabs} />
        </aside>
    );
}
