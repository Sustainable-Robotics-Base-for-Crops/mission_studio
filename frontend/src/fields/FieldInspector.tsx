import { useEffect, useState, type ReactElement } from 'react';
import { Pentagon, TriangleAlert } from 'lucide-react';

import { Banner, Button, Chip, Input, Tabs } from '../design-system';
import { formatDistanceMeters } from '../domain/geometry';
import { lineLengthM, polygonAreaM2 } from './geojson';
import { FieldMissionsTab } from './FieldMissionsTab';
import {
    ZONE_KINDS,
    TRAFFIC_NODE_KINDS,
    type GeoJSONLineString,
    type GeoJSONPoint,
    type GeoJSONPolygon,
    type TrafficNodeKind,
    type ZoneKind,
} from './types';
import type { useFieldCatalogue } from './useFieldCatalogue';

type Catalogue = ReturnType<typeof useFieldCatalogue>;

function formatArea(m2: number | null, locale: string): string {
    if (m2 === null || !Number.isFinite(m2)) {
        return '—';
    }
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(m2)} m²`;
}

function missionFileName(path: string): string {
    const trimmed = path.replace(/\/+$/, '');
    const slash = trimmed.lastIndexOf('/');
    return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function asPolygon(geometry: { type?: string } | undefined): GeoJSONPolygon | undefined {
    return geometry?.type === 'Polygon' ? (geometry as GeoJSONPolygon) : undefined;
}

function asLineString(geometry: { type?: string } | undefined): GeoJSONLineString | undefined {
    return geometry?.type === 'LineString' ? (geometry as GeoJSONLineString) : undefined;
}

function asPoint(geometry: { type?: string } | undefined): GeoJSONPoint | undefined {
    return geometry?.type === 'Point' ? (geometry as GeoJSONPoint) : undefined;
}

export function FieldInspector({
    t,
    language,
    catalogue,
    missionPath,
    onOpenMission,
    overlay = false,
}: {
    t: (key: string, params?: Record<string, string | number>) => string;
    language: string;
    catalogue: Catalogue;
    missionPath: string | null;
    onOpenMission?: (path?: string) => void;
    overlay?: boolean;
}): ReactElement {
    const inspectorClass = overlay ? 'studio-inspector is-overlay' : 'studio-inspector';
    const field = catalogue.selected;
    const focus = catalogue.focus;
    const zone =
        focus?.kind === 'zone' ? (field?.zones.find((item) => item.id === focus.id) ?? null) : null;
    const obstacle =
        focus?.kind === 'obstacle'
            ? (field?.obstacles.find((item) => item.id === focus.id) ?? null)
            : null;
    const line =
        focus?.kind === 'guidance'
            ? (field?.guidance_lines.find((item) => item.id === focus.id) ?? null)
            : null;
    const way =
        focus?.kind === 'traffic_way'
            ? (field?.traffic_ways.find((item) => item.id === focus.id) ?? null)
            : null;
    const node =
        focus?.kind === 'traffic_node'
            ? (field?.traffic_nodes.find((item) => item.id === focus.id) ?? null)
            : null;
    const rowSet =
        focus?.kind === 'row'
            ? ((field?.row_sets ?? []).find((set) => set.id === focus.rowSetId) ?? null)
            : null;
    const row =
        focus?.kind === 'row'
            ? (rowSet?.rows.find((item) => item.id === focus.id) ??
              (field?.row_sets ?? [])
                  .flatMap((set) => set.rows)
                  .find((item) => item.id === focus.id) ??
              null)
            : null;
    const drawing = focus?.kind === 'draft';
    const [name, setName] = useState(field?.name ?? '');
    const [campaign, setCampaign] = useState(field?.campaign ?? '');
    const [source, setSource] = useState(String(field?.provenance.source ?? ''));
    const [method, setMethod] = useState(String(field?.provenance.method ?? ''));
    const [accuracy, setAccuracy] = useState(
        field?.provenance.h_accuracy_m != null ? String(field.provenance.h_accuracy_m) : '',
    );
    const [zoneKind, setZoneKind] = useState<ZoneKind>(
        (zone?.kind as ZoneKind) ?? catalogue.zoneKind,
    );
    const [margin, setMargin] = useState(obstacle ? String(obstacle.margin_m) : '0');
    const [nodeKind, setNodeKind] = useState<TrafficNodeKind>(
        (node?.kind as TrafficNodeKind) ?? 'gate',
    );
    const [oneway, setOneway] = useState(way?.oneway ?? false);
    const [speedMps, setSpeedMps] = useState(way?.speed_mps != null ? String(way.speed_mps) : '');

    useEffect(() => {
        if (drawing) {
            setName(catalogue.newName);
            setZoneKind(catalogue.zoneKind);
            return;
        }
        if (zone) {
            setName(zone.name ?? '');
            setZoneKind((zone.kind as ZoneKind) ?? 'agronomic_boundary');
            return;
        }
        if (obstacle) {
            setName(obstacle.name ?? '');
            setMargin(String(obstacle.margin_m));
            return;
        }
        if (line) {
            setName(line.name ?? '');
            return;
        }
        if (way) {
            setName(way.name ?? '');
            setOneway(way.oneway);
            setSpeedMps(way.speed_mps != null ? String(way.speed_mps) : '');
            return;
        }
        if (node) {
            setName(node.name ?? '');
            setNodeKind((node.kind as TrafficNodeKind) ?? 'gate');
            return;
        }
        if (row) {
            setName(row.name ?? '');
            return;
        }
        setName(field?.name ?? '');
        setCampaign(field?.campaign ?? '');
        setSource(String(field?.provenance.source ?? ''));
        setMethod(String(field?.provenance.method ?? ''));
        setAccuracy(
            field?.provenance.h_accuracy_m != null ? String(field.provenance.h_accuracy_m) : '',
        );
    }, [
        catalogue.newName,
        catalogue.zoneKind,
        drawing,
        field,
        line,
        node,
        obstacle,
        row,
        way,
        zone,
    ]);

    if (!catalogue.available) {
        return (
            <aside className={inspectorClass} aria-label={t('inspector.title')}>
                <header className="studio-panel-header">
                    <h2>{t('inspector.title')}</h2>
                </header>
                <p className="studio-muted">{t('fields.unavailable')}</p>
            </aside>
        );
    }

    if (!field && !drawing) {
        return (
            <aside className={inspectorClass} aria-label={t('inspector.title')}>
                <header className="studio-panel-header">
                    <h2>{t('inspector.title')}</h2>
                </header>
                <p className="studio-muted">{t('app.inspectorEmpty')}</p>
            </aside>
        );
    }

    const locale = language === 'en' ? 'en-GB' : 'fr-FR';
    const focusedLine = drawing
        ? undefined
        : (asLineString(line?.geometry) ??
          asLineString(row?.geometry) ??
          asLineString(way?.geometry));
    const focusedPoint = drawing ? undefined : asPoint(node?.geometry);
    const bedGeometry = drawing ? undefined : asPolygon(row?.geometry);
    const focusedGeometry = drawing
        ? undefined
        : zone
          ? zone.geometry
          : obstacle
            ? asPolygon(obstacle.geometry)
            : bedGeometry
              ? bedGeometry
              : line || row || way
                ? undefined
                : field?.geometry;
    const area = formatArea(polygonAreaM2(focusedGeometry), locale);
    const lengthLabel = formatDistanceMeters(lineLengthM(focusedLine) ?? Number.NaN, locale);
    const typeLabel =
        focus?.kind === 'draft'
            ? focus.target === 'zone'
                ? t(`fields.kind.${catalogue.zoneKind}`)
                : focus.target === 'obstacle'
                  ? t('fields.typeObstacle')
                  : focus.target === 'guidance'
                    ? t('fields.typeGuidance')
                    : focus.target === 'traffic_way'
                      ? t('fields.typeTrafficWay')
                      : focus.target === 'traffic_node'
                        ? t(`fields.traffic.${catalogue.trafficKind}`)
                        : t('fields.typeField')
            : zone
              ? t(`fields.kind.${zone.kind}`)
              : obstacle
                ? t('fields.typeObstacle')
                : line
                  ? t('fields.typeGuidance')
                  : way
                    ? t('fields.typeTrafficWay')
                    : node
                      ? t(`fields.traffic.${node.kind}`)
                      : row
                        ? t(
                              rowSet?.kind === 'beds' || bedGeometry
                                  ? 'fields.typeBed'
                                  : 'fields.typeRow',
                              { number: row.number },
                          )
                        : t('fields.typeField');
    const firstObstacle = field?.obstacles[0];
    const canDelete = Boolean(focus && focus.kind !== 'draft');
    const vertexCount = focusedPoint
        ? 1
        : focusedLine
          ? focusedLine.coordinates.length
          : Math.max(0, (focusedGeometry?.coordinates[0]?.length ?? 1) - 1);

    const saveGeneral = () => {
        if (drawing) {
            catalogue.setNewName(name);
            return;
        }
        if (focus?.kind === 'zone') {
            void catalogue.saveSelected({
                name: name.trim() || null,
                kind: zoneKind,
            });
            return;
        }
        if (focus?.kind === 'obstacle') {
            void catalogue.saveSelected({
                name: name.trim() || null,
                margin_m: Number(margin) || 0,
            });
            return;
        }
        if (focus?.kind === 'guidance') {
            void catalogue.saveSelected({
                name: name.trim() || null,
            });
            return;
        }
        if (focus?.kind === 'traffic_way') {
            void catalogue.saveSelected({
                name: name.trim() || null,
                oneway,
                speed_mps: speedMps === '' ? null : Number(speedMps),
            });
            return;
        }
        if (focus?.kind === 'traffic_node') {
            void catalogue.saveSelected({
                name: name.trim() || null,
                kind: nodeKind,
            });
            return;
        }
        if (focus?.kind === 'row') {
            void catalogue.saveSelected({
                name: name.trim() || null,
            });
            return;
        }
        if (!field) {
            return;
        }
        void catalogue.saveSelected({
            name: name.trim() || field.name,
            campaign: campaign.trim() || null,
            provenance: {
                ...field.provenance,
                source: source.trim() || undefined,
                method: method.trim() || undefined,
                h_accuracy_m: accuracy === '' ? undefined : Number(accuracy),
            },
        });
    };

    const onNameChange = (value: string) => {
        setName(value);
        if (drawing) {
            catalogue.setNewName(value);
        }
    };

    return (
        <aside
            className={inspectorClass}
            aria-label={t('inspector.title')}
            data-field-inspector="true"
        >
            <header className="studio-panel-header">
                <h2>{t('inspector.title')}</h2>
            </header>
            {catalogue.impact?.banner ? (
                <Banner tone="warning" icon={TriangleAlert} className="studio-field-banner">
                    {catalogue.impact.banner}
                </Banner>
            ) : null}
            {catalogue.impact?.invalidated_count ? (
                <Button
                    variant="secondary"
                    onClick={() => {
                        const first =
                            catalogue.impact?.missions.find(
                                (item) => item.status === 'needs_revalidation',
                            ) ?? catalogue.impact?.missions[0];
                        onOpenMission?.(first?.mission_path);
                    }}
                >
                    {t('fields.seeMissions')}
                </Button>
            ) : null}
            <Tabs
                defaultValue="general"
                items={[
                    {
                        value: 'general',
                        label: t('fields.tab.general'),
                        content: (
                            <div className="studio-field-tab">
                                <Input
                                    id="field-name"
                                    label={t('fields.name')}
                                    value={name}
                                    onChange={(event) => onNameChange(event.target.value)}
                                />
                                {focus?.kind === 'zone' ||
                                (focus?.kind === 'draft' && focus.target === 'zone') ? (
                                    <label className="studio-file-label">
                                        <span>{t('fields.type')}</span>
                                        <select
                                            className="ds-select-trigger"
                                            value={drawing ? catalogue.zoneKind : zoneKind}
                                            disabled={drawing === false && !zone}
                                            onChange={(event) => {
                                                const next = event.target.value as ZoneKind;
                                                setZoneKind(next);
                                                if (drawing) {
                                                    catalogue.setZoneKind(next);
                                                }
                                            }}
                                        >
                                            {ZONE_KINDS.map((kind) => (
                                                <option key={kind} value={kind}>
                                                    {t(`fields.kind.${kind}`)}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                ) : focus?.kind === 'traffic_node' ||
                                  (focus?.kind === 'draft' && focus.target === 'traffic_node') ? (
                                    <label className="studio-file-label">
                                        <span>{t('fields.type')}</span>
                                        <select
                                            className="ds-select-trigger"
                                            value={
                                                drawing
                                                    ? catalogue.trafficKind === 'path'
                                                        ? 'gate'
                                                        : catalogue.trafficKind
                                                    : nodeKind
                                            }
                                            disabled={drawing}
                                            onChange={(event) => {
                                                const next = event.target.value as TrafficNodeKind;
                                                setNodeKind(next);
                                            }}
                                        >
                                            {TRAFFIC_NODE_KINDS.map((kind) => (
                                                <option key={kind} value={kind}>
                                                    {t(`fields.traffic.${kind}`)}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                ) : (
                                    <Input
                                        id="field-type"
                                        label={t('fields.type')}
                                        value={typeLabel}
                                        readOnly
                                    />
                                )}
                                {focus?.kind === 'obstacle' ||
                                (focus?.kind === 'draft' && focus.target === 'obstacle') ? (
                                    <Input
                                        id="obstacle-margin"
                                        label={t('fields.margin')}
                                        unit="m"
                                        value={margin}
                                        onChange={(event) => setMargin(event.target.value)}
                                        disabled={drawing}
                                    />
                                ) : null}
                                {focus?.kind === 'traffic_way' ? (
                                    <>
                                        <label className="studio-file-label">
                                            <input
                                                type="checkbox"
                                                checked={oneway}
                                                onChange={(event) =>
                                                    setOneway(event.target.checked)
                                                }
                                            />
                                            <span>{t('fields.oneway')}</span>
                                        </label>
                                        <Input
                                            id="traffic-speed"
                                            label={t('fields.speedMps')}
                                            unit="m/s"
                                            value={speedMps}
                                            onChange={(event) => setSpeedMps(event.target.value)}
                                        />
                                    </>
                                ) : null}
                                {!drawing &&
                                !zone &&
                                !obstacle &&
                                !line &&
                                !row &&
                                !way &&
                                !node ? (
                                    <>
                                        <Input
                                            id="field-campaign"
                                            label={t('fields.campaign')}
                                            value={campaign}
                                            onChange={(event) => setCampaign(event.target.value)}
                                        />
                                        <Input
                                            id="field-source"
                                            label={t('fields.source')}
                                            value={source}
                                            onChange={(event) => setSource(event.target.value)}
                                        />
                                        <p className="studio-muted">
                                            {field?.qualified_for_autonomy
                                                ? t('fields.qualified')
                                                : t('fields.unqualified')}
                                        </p>
                                    </>
                                ) : null}
                                {drawing ? (
                                    <p className="studio-muted">
                                        {t(
                                            focus?.kind === 'draft' &&
                                                (focus.target === 'guidance' ||
                                                    focus.target === 'traffic_way')
                                                ? 'fields.drawHintLine'
                                                : focus?.kind === 'draft' &&
                                                    focus.target === 'traffic_node'
                                                  ? 'fields.drawHintPoint'
                                                  : 'fields.drawHint',
                                        )}
                                    </p>
                                ) : (
                                    <div className="studio-field-draw-actions">
                                        <Button variant="secondary" onClick={saveGeneral}>
                                            {t('fields.save')}
                                        </Button>
                                        {canDelete ? (
                                            <Button
                                                variant="secondary"
                                                disabled={catalogue.editingGeometry}
                                                onClick={() => catalogue.beginEditGeometry()}
                                            >
                                                {t('fields.editGeometry')}
                                            </Button>
                                        ) : null}
                                        {canDelete ? (
                                            <Button
                                                variant="secondary"
                                                onClick={() => {
                                                    if (
                                                        focus?.kind === 'field' &&
                                                        !window.confirm(t('fields.confirmDelete'))
                                                    ) {
                                                        return;
                                                    }
                                                    void catalogue.deleteFocused();
                                                }}
                                            >
                                                {t('fields.delete')}
                                            </Button>
                                        ) : null}
                                        {focus?.kind === 'row' ? (
                                            <Button
                                                variant="secondary"
                                                onClick={() => {
                                                    if (
                                                        !window.confirm(
                                                            t('fields.confirmDeleteRowSet'),
                                                        )
                                                    ) {
                                                        return;
                                                    }
                                                    void catalogue.deleteFocusedRowSet();
                                                }}
                                            >
                                                {t('fields.deleteRowSet')}
                                            </Button>
                                        ) : null}
                                    </div>
                                )}
                            </div>
                        ),
                    },
                    {
                        value: 'geometry',
                        label: t('fields.tab.geometry'),
                        content: (
                            <div className="studio-field-tab">
                                <p>
                                    {focusedPoint
                                        ? `${t('fields.typeTrafficNode')}`
                                        : focusedLine && !bedGeometry
                                          ? `${t('fields.length')}: ${lengthLabel}`
                                          : `${t('fields.area')}: ${area}`}
                                </p>
                                <p>
                                    {t('fields.crs')}: {field?.crs ?? 'EPSG:4326'}
                                </p>
                                <p>
                                    {t('fields.vertices')}: {vertexCount}
                                </p>
                                <p>
                                    {t('fields.zones')}: {field?.zones.length ?? 0}
                                </p>
                                <ul className="studio-field-chips">
                                    {(field?.zones ?? []).map((item) => (
                                        <li key={item.id}>
                                            <Chip icon={Pentagon}>
                                                {t(`fields.kind.${item.kind}`)}
                                            </Chip>
                                        </li>
                                    ))}
                                </ul>
                                <Button
                                    variant="secondary"
                                    disabled={!field}
                                    onClick={() => void catalogue.addAutonomyZone()}
                                >
                                    {t('fields.addAutonomy')}
                                </Button>
                            </div>
                        ),
                    },
                    {
                        value: 'safety',
                        label: t('fields.tab.safety'),
                        content: (
                            <div className="studio-field-tab">
                                <Input
                                    id="field-method"
                                    label={t('fields.method')}
                                    value={method}
                                    onChange={(event) => setMethod(event.target.value)}
                                />
                                <Input
                                    id="field-accuracy"
                                    label={t('fields.accuracy')}
                                    unit="m"
                                    value={accuracy}
                                    onChange={(event) => setAccuracy(event.target.value)}
                                />
                                <p>
                                    {t('fields.obstacles')}: {field?.obstacles.length ?? 0}
                                </p>
                                {firstObstacle ? (
                                    <>
                                        <p>
                                            {t('fields.margin')}: {firstObstacle.margin_m} m
                                        </p>
                                        <p>
                                            {t('fields.crossable')}:{' '}
                                            {firstObstacle.crossable
                                                ? t('fields.yes')
                                                : t('fields.no')}
                                        </p>
                                        <p>
                                            {t('fields.period')}: {firstObstacle.valid_from ?? '—'}{' '}
                                            → {firstObstacle.valid_until ?? '—'}
                                        </p>
                                    </>
                                ) : (
                                    <p className="studio-muted">{t('fields.noObstacle')}</p>
                                )}
                                <Button variant="secondary" onClick={saveGeneral}>
                                    {t('fields.save')}
                                </Button>
                            </div>
                        ),
                    },
                    {
                        value: 'history',
                        label: t('fields.tab.history'),
                        content: (
                            <div className="studio-field-tab">
                                <ul>
                                    {catalogue.versions.map((version) => (
                                        <li key={version.version}>
                                            v{version.version}
                                            {version.author ? ` · ${version.author}` : ''}
                                            <span className="studio-muted">
                                                {' '}
                                                {formatArea(version.area_m2, locale)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                                {catalogue.diff ? (
                                    <p>
                                        {t('fields.diff', {
                                            from: catalogue.diff.from,
                                            to: catalogue.diff.to,
                                            changed: catalogue.diff.geometry_changed
                                                ? t('fields.yes')
                                                : t('fields.no'),
                                            zones: catalogue.diff.zones_to,
                                        })}
                                    </p>
                                ) : (
                                    <p className="studio-muted">{t('fields.noDiff')}</p>
                                )}
                            </div>
                        ),
                    },
                    {
                        value: 'impact',
                        label: t('fields.tab.impact'),
                        content: (
                            <div className="studio-field-tab" id="field-impact-missions">
                                <p>
                                    {t('fields.impactCount', {
                                        count: catalogue.impact?.invalidated_count ?? 0,
                                    })}
                                </p>
                                {(catalogue.impact?.missions ?? []).length === 0 ? (
                                    <p className="studio-muted">{t('fields.noLinkedMissions')}</p>
                                ) : (
                                    <ul>
                                        {(catalogue.impact?.missions ?? []).map((item) => (
                                            <li key={item.mission_path}>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        onOpenMission?.(item.mission_path)
                                                    }
                                                >
                                                    <span>
                                                        {missionFileName(item.mission_path)}
                                                    </span>
                                                    <span className="studio-muted">
                                                        {' '}
                                                        ·{' '}
                                                        {item.status === 'needs_revalidation'
                                                            ? t('fields.missionNeedsRevalidation')
                                                            : t('fields.missionCurrent')}
                                                    </span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <div className="studio-field-draw-actions">
                                    <Button
                                        variant="secondary"
                                        disabled={!onOpenMission}
                                        onClick={() => {
                                            const first =
                                                catalogue.impact?.missions.find(
                                                    (item) => item.status === 'needs_revalidation',
                                                ) ?? catalogue.impact?.missions[0];
                                            onOpenMission?.(first?.mission_path);
                                        }}
                                    >
                                        {t('fields.seeMissions')}
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        disabled={!missionPath}
                                        onClick={() =>
                                            missionPath
                                                ? void catalogue.linkCurrentMission(missionPath)
                                                : undefined
                                        }
                                    >
                                        {t('fields.linkMission')}
                                    </Button>
                                </div>
                            </div>
                        ),
                    },
                    {
                        value: 'missions',
                        label: t('fields.tab.missions'),
                        content: (
                            <FieldMissionsTab
                                t={t}
                                language={language}
                                fieldId={field?.id ?? null}
                                onOpenMission={onOpenMission}
                            />
                        ),
                    },
                ]}
            />
        </aside>
    );
}
