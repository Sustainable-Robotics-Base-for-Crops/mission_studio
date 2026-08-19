import type { ChangeEvent, ReactElement } from 'react';
import { useEffect, useState } from 'react';

import { Button } from '../design-system/Button';
import { Input } from '../design-system/Field';
import { DEFAULT_ROW_SPACING_M } from '../domain/coverage';
import { DEFAULT_BED_COUNT, DEFAULT_BED_PATH_M, DEFAULT_BED_WIDTH_M } from './rows';
import { fieldsDrawKind, fieldsDrawTarget } from './draw-target';
import {
    ZONE_KINDS,
    TRAFFIC_DRAW_KINDS,
    type FieldsNavId,
    type FieldSummary,
    type TrafficDrawKind,
    type ZoneKind,
} from './types';
import type { useFieldCatalogue } from './useFieldCatalogue';

const NAV: Array<{ id: FieldsNavId; key: string; lot: string | null }> = [
    { id: 'parcels', key: 'fields.nav.parcels', lot: null },
    { id: 'zones', key: 'fields.nav.zones', lot: null },
    { id: 'rows', key: 'fields.nav.rows', lot: null },
    { id: 'guidance', key: 'fields.nav.guidance', lot: null },
    { id: 'obstacles', key: 'fields.nav.obstacles', lot: null },
    { id: 'traffic', key: 'fields.nav.traffic', lot: null },
    { id: 'io', key: 'fields.nav.io', lot: null },
    { id: 'history', key: 'fields.nav.history', lot: null },
];

type Catalogue = ReturnType<typeof useFieldCatalogue>;

function errorLabel(
    t: (key: string, params?: Record<string, string | number>) => string,
    error: string,
): string {
    return error.startsWith('fields.') ? t(error) : error;
}

export function FieldsContextPanel({
    t,
    catalogue,
    overlay = false,
    onDrawStarted,
}: {
    t: (key: string, params?: Record<string, string | number>) => string;
    catalogue: Catalogue;
    overlay?: boolean;
    onDrawStarted?: () => void;
}): ReactElement {
    const target = fieldsDrawTarget(catalogue.nav, catalogue.trafficKind);
    const drawKind =
        catalogue.tool === 'draw_point'
            ? 'point'
            : catalogue.tool === 'draw_line'
              ? 'line'
              : catalogue.tool === 'draw_polygon'
                ? 'polygon'
                : fieldsDrawKind(catalogue.nav, catalogue.trafficKind);
    const drawing =
        catalogue.tool === 'draw_polygon' ||
        catalogue.tool === 'draw_line' ||
        catalogue.tool === 'draw_point';
    const canFinish =
        drawKind === 'point'
            ? catalogue.draft.length >= 1
            : drawKind === 'line'
              ? catalogue.draft.length >= 2
              : catalogue.draft.length >= 3;
    const nameKey =
        target === 'zone'
            ? 'fields.newZoneName'
            : target === 'obstacle'
              ? 'fields.newObstacleName'
              : target === 'guidance'
                ? 'fields.newGuidanceName'
                : target === 'traffic_way'
                  ? 'fields.newTrafficWayName'
                  : target === 'traffic_node'
                    ? 'fields.newTrafficNodeName'
                    : 'fields.newName';
    const lines = catalogue.selected?.guidance_lines ?? [];
    const [axisLineId, setAxisLineId] = useState('');
    const [spacingM, setSpacingM] = useState(String(DEFAULT_ROW_SPACING_M));
    const [layoutKind, setLayoutKind] = useState<'rows' | 'beds'>('rows');
    const [bedWidthM, setBedWidthM] = useState(String(DEFAULT_BED_WIDTH_M));
    const [bedPathM, setBedPathM] = useState(String(DEFAULT_BED_PATH_M));
    const [bedCount, setBedCount] = useState(String(DEFAULT_BED_COUNT));
    useEffect(() => {
        const first = catalogue.selected?.guidance_lines[0]?.id ?? '';
        setAxisLineId((current) =>
            catalogue.selected?.guidance_lines.some((line) => line.id === current)
                ? current
                : first,
        );
    }, [catalogue.selected?.guidance_lines, catalogue.selectedId]);
    const onImport = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) {
            void catalogue.importFile(file).catch((reason: unknown) => {
                window.alert(reason instanceof Error ? reason.message : String(reason));
            });
        }
    };

    return (
        <aside
            className={overlay ? 'studio-context is-overlay' : 'studio-context'}
            aria-label={t('nav.fields')}
        >
            <header className="studio-panel-header">
                <h2>{t('nav.fields')}</h2>
            </header>
            <nav className="studio-context-nav" aria-label={t('nav.fields')}>
                <ul>
                    {NAV.map((entry) => (
                        <li key={entry.id}>
                            <button
                                type="button"
                                className={catalogue.nav === entry.id ? 'is-active' : undefined}
                                disabled={entry.lot !== null}
                                title={
                                    entry.lot ? t('module.coming', { lot: entry.lot }) : undefined
                                }
                                onClick={() => catalogue.setNav(entry.id)}
                            >
                                {t(entry.key)}
                                {entry.lot ? (
                                    <span className="studio-muted"> {entry.lot}</span>
                                ) : null}
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>
            {!catalogue.available ? (
                <p className="studio-muted">{t('fields.unavailable')}</p>
            ) : (
                <>
                    {catalogue.error ? (
                        <p className="studio-muted" role="alert">
                            {errorLabel(t, catalogue.error)}
                        </p>
                    ) : null}
                    {target ? (
                        <div className="studio-field-create">
                            <Input
                                id="studio-field-name"
                                label={t(nameKey)}
                                value={catalogue.newName}
                                onChange={(event) => catalogue.setNewName(event.target.value)}
                            />
                            {target === 'zone' ? (
                                <label className="studio-file-label">
                                    <span>{t('fields.zoneKind')}</span>
                                    <select
                                        className="ds-select-trigger"
                                        value={catalogue.zoneKind}
                                        onChange={(event) =>
                                            catalogue.setZoneKind(event.target.value as ZoneKind)
                                        }
                                    >
                                        {ZONE_KINDS.map((kind) => (
                                            <option key={kind} value={kind}>
                                                {t(`fields.kind.${kind}`)}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            ) : null}
                            {catalogue.nav === 'traffic' ? (
                                <label className="studio-file-label">
                                    <span>{t('fields.trafficKind')}</span>
                                    <select
                                        className="ds-select-trigger"
                                        value={catalogue.trafficKind}
                                        onChange={(event) =>
                                            catalogue.setTrafficKind(
                                                event.target.value as TrafficDrawKind,
                                            )
                                        }
                                    >
                                        {TRAFFIC_DRAW_KINDS.map((kind) => (
                                            <option key={kind} value={kind}>
                                                {t(`fields.traffic.${kind}`)}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            ) : null}
                            {(target === 'zone' ||
                                target === 'obstacle' ||
                                target === 'guidance' ||
                                target === 'traffic_way' ||
                                target === 'traffic_node') &&
                            !catalogue.selectedId ? (
                                <p className="studio-muted">{t('fields.error.needField')}</p>
                            ) : null}
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    if (catalogue.startDraw()) {
                                        onDrawStarted?.();
                                    }
                                }}
                            >
                                {t('fields.draw')}
                            </Button>
                            {drawing ? (
                                <div className="studio-field-draw-actions">
                                    <Button
                                        variant="primary"
                                        disabled={!canFinish}
                                        onClick={() => void catalogue.finishDraft()}
                                    >
                                        {drawKind === 'point'
                                            ? t('fields.tool.finishPoint')
                                            : drawKind === 'line'
                                              ? t('fields.tool.finishLine')
                                              : t('fields.tool.finish')}
                                    </Button>
                                    <Button variant="secondary" onClick={catalogue.cancelDraft}>
                                        {t('fields.tool.cancel')}
                                    </Button>
                                </div>
                            ) : null}
                            {target === 'field' ? (
                                <label className="studio-file-label">
                                    <span>{t('fields.importGeojson')}</span>
                                    <input
                                        type="file"
                                        accept=".json,.geojson,application/geo+json"
                                        onChange={onImport}
                                    />
                                </label>
                            ) : null}
                            {catalogue.nav === 'io' ? (
                                <Button
                                    variant="secondary"
                                    disabled={!catalogue.selectedId}
                                    onClick={() => void catalogue.exportSelected()}
                                >
                                    {t('fields.exportGeojson')}
                                </Button>
                            ) : null}
                        </div>
                    ) : catalogue.nav === 'history' ? (
                        <p className="studio-muted">{t('fields.historyHint')}</p>
                    ) : catalogue.nav === 'rows' ? (
                        <div className="studio-field-create">
                            {!catalogue.selectedId ? (
                                <p className="studio-muted">{t('fields.error.needField')}</p>
                            ) : lines.length === 0 ? (
                                <p className="studio-muted">{t('fields.emptyRowsNeedAxis')}</p>
                            ) : (
                                <>
                                    <label className="studio-file-label">
                                        <span>{t('fields.layoutKind')}</span>
                                        <select
                                            className="ds-select-trigger"
                                            value={layoutKind}
                                            onChange={(event) =>
                                                setLayoutKind(
                                                    event.target.value === 'beds' ? 'beds' : 'rows',
                                                )
                                            }
                                        >
                                            <option value="rows">{t('fields.layoutRows')}</option>
                                            <option value="beds">{t('fields.layoutBeds')}</option>
                                        </select>
                                    </label>
                                    <label className="studio-file-label">
                                        <span>{t('fields.axisLine')}</span>
                                        <select
                                            className="ds-select-trigger"
                                            value={axisLineId}
                                            onChange={(event) => setAxisLineId(event.target.value)}
                                        >
                                            {lines.map((line) => (
                                                <option key={line.id} value={line.id}>
                                                    {line.name?.trim() || t('fields.typeGuidance')}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    {layoutKind === 'rows' ? (
                                        <Input
                                            id="studio-row-spacing"
                                            label={t('fields.spacing')}
                                            unit="m"
                                            value={spacingM}
                                            onChange={(event) => setSpacingM(event.target.value)}
                                        />
                                    ) : (
                                        <>
                                            <Input
                                                id="studio-bed-width"
                                                label={t('fields.bedWidth')}
                                                unit="m"
                                                value={bedWidthM}
                                                onChange={(event) =>
                                                    setBedWidthM(event.target.value)
                                                }
                                            />
                                            <Input
                                                id="studio-bed-path"
                                                label={t('fields.bedPath')}
                                                unit="m"
                                                value={bedPathM}
                                                onChange={(event) =>
                                                    setBedPathM(event.target.value)
                                                }
                                            />
                                            <Input
                                                id="studio-bed-count"
                                                label={t('fields.bedCount')}
                                                value={bedCount}
                                                onChange={(event) =>
                                                    setBedCount(event.target.value)
                                                }
                                            />
                                        </>
                                    )}
                                    <Button
                                        variant="secondary"
                                        disabled={!axisLineId}
                                        onClick={() => {
                                            if (layoutKind === 'beds') {
                                                const width = Number(bedWidthM);
                                                const path = Number(bedPathM);
                                                const count = Number(bedCount);
                                                void catalogue.generateRowSet({
                                                    axisLineId,
                                                    kind: 'beds',
                                                    widthM: Number.isFinite(width)
                                                        ? width
                                                        : DEFAULT_BED_WIDTH_M,
                                                    pathM: Number.isFinite(path)
                                                        ? path
                                                        : DEFAULT_BED_PATH_M,
                                                    count:
                                                        Number.isFinite(count) && count > 0
                                                            ? Math.floor(count)
                                                            : undefined,
                                                });
                                                return;
                                            }
                                            const spacing = Number(spacingM);
                                            void catalogue.generateRowSet({
                                                axisLineId,
                                                kind: 'rows',
                                                spacingM: Number.isFinite(spacing)
                                                    ? spacing
                                                    : DEFAULT_ROW_SPACING_M,
                                            });
                                        }}
                                    >
                                        {layoutKind === 'beds'
                                            ? t('fields.generateBeds')
                                            : t('fields.generateRows')}
                                    </Button>
                                    {layoutKind === 'beds' ? (
                                        <Button
                                            variant="secondary"
                                            disabled={!axisLineId}
                                            onClick={() => {
                                                setBedWidthM(String(DEFAULT_BED_WIDTH_M));
                                                setBedPathM(String(DEFAULT_BED_PATH_M));
                                                setBedCount(String(DEFAULT_BED_COUNT));
                                                void catalogue.generateRowSet({
                                                    axisLineId,
                                                    kind: 'beds',
                                                    widthM: DEFAULT_BED_WIDTH_M,
                                                    pathM: DEFAULT_BED_PATH_M,
                                                    count: DEFAULT_BED_COUNT,
                                                });
                                            }}
                                        >
                                            {t('fields.generateBeds18')}
                                        </Button>
                                    ) : null}
                                </>
                            )}
                        </div>
                    ) : (
                        <p className="studio-muted">{t('fields.error.notDrawable')}</p>
                    )}
                    <div className="studio-mission-list">
                        <h3>
                            {catalogue.nav === 'zones'
                                ? t('fields.listZones')
                                : catalogue.nav === 'obstacles'
                                  ? t('fields.listObstacles')
                                  : catalogue.nav === 'guidance'
                                    ? t('fields.listGuidance')
                                    : catalogue.nav === 'traffic'
                                      ? t('fields.listTraffic')
                                      : catalogue.nav === 'rows'
                                        ? t('fields.listRows')
                                        : catalogue.nav === 'history'
                                          ? t('fields.listVersions')
                                          : t('fields.list')}
                        </h3>
                        {catalogue.loading ? (
                            <p className="studio-muted">{t('fields.loading')}</p>
                        ) : catalogue.nav === 'zones' ? (
                            !catalogue.selectedId ? (
                                <p className="studio-muted">{t('fields.error.needField')}</p>
                            ) : (catalogue.selected?.zones ?? []).length === 0 ? (
                                <p className="studio-muted">{t('fields.emptyZones')}</p>
                            ) : (
                                <ul>
                                    {catalogue.selected?.zones.map((zone) => (
                                        <li key={zone.id}>
                                            <button
                                                type="button"
                                                className={
                                                    catalogue.focus?.kind === 'zone' &&
                                                    catalogue.focus.id === zone.id
                                                        ? 'is-active'
                                                        : undefined
                                                }
                                                onClick={() =>
                                                    catalogue.select(catalogue.selectedId, {
                                                        fit: true,
                                                        focus: {
                                                            kind: 'zone',
                                                            fieldId: catalogue.selectedId as string,
                                                            id: zone.id,
                                                        },
                                                    })
                                                }
                                                onDoubleClick={(event) => {
                                                    event.preventDefault();
                                                    catalogue.beginEditGeometry({
                                                        kind: 'zone',
                                                        fieldId: catalogue.selectedId as string,
                                                        id: zone.id,
                                                    });
                                                }}
                                            >
                                                <span>
                                                    {zone.name?.trim() ||
                                                        t(`fields.kind.${zone.kind}`)}
                                                </span>
                                                <span className="studio-muted">
                                                    {t(`fields.kind.${zone.kind}`)}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )
                        ) : catalogue.nav === 'guidance' ? (
                            !catalogue.selectedId ? (
                                <p className="studio-muted">{t('fields.error.needField')}</p>
                            ) : (catalogue.selected?.guidance_lines ?? []).length === 0 ? (
                                <p className="studio-muted">{t('fields.emptyGuidance')}</p>
                            ) : (
                                <ul>
                                    {catalogue.selected?.guidance_lines.map((line) => (
                                        <li key={line.id}>
                                            <button
                                                type="button"
                                                className={
                                                    catalogue.focus?.kind === 'guidance' &&
                                                    catalogue.focus.id === line.id
                                                        ? 'is-active'
                                                        : undefined
                                                }
                                                onClick={() =>
                                                    catalogue.select(catalogue.selectedId, {
                                                        fit: true,
                                                        focus: {
                                                            kind: 'guidance',
                                                            fieldId: catalogue.selectedId as string,
                                                            id: line.id,
                                                        },
                                                    })
                                                }
                                                onDoubleClick={(event) => {
                                                    event.preventDefault();
                                                    catalogue.beginEditGeometry({
                                                        kind: 'guidance',
                                                        fieldId: catalogue.selectedId as string,
                                                        id: line.id,
                                                    });
                                                }}
                                            >
                                                <span>
                                                    {line.name?.trim() || t('fields.typeGuidance')}
                                                </span>
                                                <span className="studio-muted">
                                                    {t('fields.typeGuidance')}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )
                        ) : catalogue.nav === 'rows' ? (
                            !catalogue.selectedId ? (
                                <p className="studio-muted">{t('fields.error.needField')}</p>
                            ) : (catalogue.selected?.row_sets ?? []).every(
                                  (set) => (set.rows ?? []).length === 0,
                              ) ? (
                                <p className="studio-muted">{t('fields.emptyRows')}</p>
                            ) : (
                                <ul>
                                    {(catalogue.selected?.row_sets ?? []).flatMap((rowSet) =>
                                        (rowSet.rows ?? []).map((row) => (
                                            <li key={row.id}>
                                                <button
                                                    type="button"
                                                    className={
                                                        catalogue.focus?.kind === 'row' &&
                                                        catalogue.focus.id === row.id
                                                            ? 'is-active'
                                                            : undefined
                                                    }
                                                    onClick={() =>
                                                        catalogue.select(catalogue.selectedId, {
                                                            fit: true,
                                                            focus: {
                                                                kind: 'row',
                                                                fieldId:
                                                                    catalogue.selectedId as string,
                                                                rowSetId: rowSet.id,
                                                                id: row.id,
                                                            },
                                                        })
                                                    }
                                                    onDoubleClick={(event) => {
                                                        event.preventDefault();
                                                        catalogue.beginEditGeometry({
                                                            kind: 'row',
                                                            fieldId: catalogue.selectedId as string,
                                                            rowSetId: rowSet.id,
                                                            id: row.id,
                                                        });
                                                    }}
                                                >
                                                    <span>
                                                        {row.name?.trim() ||
                                                            t(
                                                                rowSet.kind === 'beds'
                                                                    ? 'fields.typeBed'
                                                                    : 'fields.typeRow',
                                                                { number: row.number },
                                                            )}
                                                    </span>
                                                    <span className="studio-muted">
                                                        {t(
                                                            rowSet.kind === 'beds'
                                                                ? 'fields.typeBed'
                                                                : 'fields.typeRow',
                                                            { number: row.number },
                                                        )}
                                                    </span>
                                                </button>
                                            </li>
                                        )),
                                    )}
                                </ul>
                            )
                        ) : catalogue.nav === 'traffic' ? (
                            !catalogue.selectedId ? (
                                <p className="studio-muted">{t('fields.error.needField')}</p>
                            ) : (catalogue.selected?.traffic_ways ?? []).length === 0 &&
                              (catalogue.selected?.traffic_nodes ?? []).length === 0 ? (
                                <p className="studio-muted">{t('fields.emptyTraffic')}</p>
                            ) : (
                                <ul>
                                    {(catalogue.selected?.traffic_ways ?? []).map((way) => (
                                        <li key={way.id}>
                                            <button
                                                type="button"
                                                className={
                                                    catalogue.focus?.kind === 'traffic_way' &&
                                                    catalogue.focus.id === way.id
                                                        ? 'is-active'
                                                        : undefined
                                                }
                                                onClick={() =>
                                                    catalogue.select(catalogue.selectedId, {
                                                        fit: true,
                                                        focus: {
                                                            kind: 'traffic_way',
                                                            fieldId: catalogue.selectedId as string,
                                                            id: way.id,
                                                        },
                                                    })
                                                }
                                                onDoubleClick={(event) => {
                                                    event.preventDefault();
                                                    catalogue.beginEditGeometry({
                                                        kind: 'traffic_way',
                                                        fieldId: catalogue.selectedId as string,
                                                        id: way.id,
                                                    });
                                                }}
                                            >
                                                <span>
                                                    {way.name?.trim() || t('fields.typeTrafficWay')}
                                                </span>
                                                <span className="studio-muted">
                                                    {t('fields.traffic.path')}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                    {(catalogue.selected?.traffic_nodes ?? []).map((node) => (
                                        <li key={node.id}>
                                            <button
                                                type="button"
                                                className={
                                                    catalogue.focus?.kind === 'traffic_node' &&
                                                    catalogue.focus.id === node.id
                                                        ? 'is-active'
                                                        : undefined
                                                }
                                                onClick={() =>
                                                    catalogue.select(catalogue.selectedId, {
                                                        fit: true,
                                                        focus: {
                                                            kind: 'traffic_node',
                                                            fieldId: catalogue.selectedId as string,
                                                            id: node.id,
                                                        },
                                                    })
                                                }
                                                onDoubleClick={(event) => {
                                                    event.preventDefault();
                                                    catalogue.beginEditGeometry({
                                                        kind: 'traffic_node',
                                                        fieldId: catalogue.selectedId as string,
                                                        id: node.id,
                                                    });
                                                }}
                                            >
                                                <span>
                                                    {node.name?.trim() ||
                                                        t(`fields.traffic.${node.kind}`)}
                                                </span>
                                                <span className="studio-muted">
                                                    {t(`fields.traffic.${node.kind}`)}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )
                        ) : catalogue.nav === 'obstacles' ? (
                            !catalogue.selectedId ? (
                                <p className="studio-muted">{t('fields.error.needField')}</p>
                            ) : (catalogue.selected?.obstacles ?? []).length === 0 ? (
                                <p className="studio-muted">{t('fields.emptyObstacles')}</p>
                            ) : (
                                <ul>
                                    {catalogue.selected?.obstacles.map((obstacle) => (
                                        <li key={obstacle.id}>
                                            <button
                                                type="button"
                                                className={
                                                    catalogue.focus?.kind === 'obstacle' &&
                                                    catalogue.focus.id === obstacle.id
                                                        ? 'is-active'
                                                        : undefined
                                                }
                                                onClick={() =>
                                                    catalogue.select(catalogue.selectedId, {
                                                        fit: true,
                                                        focus: {
                                                            kind: 'obstacle',
                                                            fieldId: catalogue.selectedId as string,
                                                            id: obstacle.id,
                                                        },
                                                    })
                                                }
                                                onDoubleClick={(event) => {
                                                    event.preventDefault();
                                                    catalogue.beginEditGeometry({
                                                        kind: 'obstacle',
                                                        fieldId: catalogue.selectedId as string,
                                                        id: obstacle.id,
                                                    });
                                                }}
                                            >
                                                <span>
                                                    {obstacle.name?.trim() ||
                                                        t('fields.typeObstacle')}
                                                </span>
                                                <span className="studio-muted">
                                                    {t('fields.typeObstacle')}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )
                        ) : catalogue.nav === 'history' ? (
                            !catalogue.selectedId ? (
                                <p className="studio-muted">{t('fields.error.needField')}</p>
                            ) : catalogue.versions.length === 0 ? (
                                <p className="studio-muted">{t('fields.emptyVersions')}</p>
                            ) : (
                                <ul>
                                    {[...catalogue.versions].reverse().map((version) => (
                                        <li key={version.version}>
                                            <button
                                                type="button"
                                                className={
                                                    version.version === catalogue.selected?.version
                                                        ? 'is-active'
                                                        : undefined
                                                }
                                                onClick={() =>
                                                    catalogue.select(catalogue.selectedId, {
                                                        fit: true,
                                                    })
                                                }
                                            >
                                                <span>v{version.version}</span>
                                                <span className="studio-muted">
                                                    {version.created_at
                                                        ? version.created_at
                                                              .slice(0, 16)
                                                              .replace('T', ' ')
                                                        : '—'}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )
                        ) : catalogue.fields.length === 0 ? (
                            <p className="studio-muted">{t('fields.empty')}</p>
                        ) : (
                            <ul>
                                {catalogue.fields.map((field: FieldSummary) => (
                                    <li key={field.id}>
                                        <button
                                            type="button"
                                            className={
                                                catalogue.focus?.kind === 'field' &&
                                                field.id === catalogue.focus.id
                                                    ? 'is-active'
                                                    : field.id === catalogue.selectedId &&
                                                        catalogue.focus?.kind !== 'zone' &&
                                                        catalogue.focus?.kind !== 'obstacle' &&
                                                        catalogue.focus?.kind !== 'guidance' &&
                                                        catalogue.focus?.kind !== 'row' &&
                                                        catalogue.focus?.kind !== 'traffic_way' &&
                                                        catalogue.focus?.kind !== 'traffic_node'
                                                      ? 'is-active'
                                                      : undefined
                                            }
                                            onClick={() =>
                                                catalogue.select(field.id, { fit: true })
                                            }
                                            onDoubleClick={(event) => {
                                                event.preventDefault();
                                                catalogue.beginEditGeometry({
                                                    kind: 'field',
                                                    id: field.id,
                                                });
                                            }}
                                        >
                                            <span>{field.name}</span>
                                            <span className="studio-muted">
                                                {field.campaign || t('fields.noCampaign')}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </>
            )}
        </aside>
    );
}
