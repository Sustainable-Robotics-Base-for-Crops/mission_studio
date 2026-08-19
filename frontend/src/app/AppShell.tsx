import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
    type ReactElement,
} from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
    ChartColumn,
    CircleCheck,
    CircleHelp,
    CirclePlay,
    Clock3,
    Cloud,
    GitCompare,
    House,
    LandPlot,
    LoaderCircle,
    Map,
    PanelLeftClose,
    PanelLeftOpen,
    PanelRightClose,
    PanelRightOpen,
    Plug,
    Route as RouteIcon,
    Search,
    Send,
    Settings,
    TriangleAlert,
} from 'lucide-react';

import { CommandPalette } from './CommandPalette';
import { breakpointFromWidth, LAYOUT, shellTracks, type Breakpoint } from './layout';
import { MODULES, moduleByPath, type LucideIconName } from './modules';
import { ContextPanel, InspectorPanel, SimulationDrawer } from './PlaceholderModule';
import { FieldInspector } from '../fields/FieldInspector';
import { FieldsContextPanel } from '../fields/FieldsContextPanel';
import { FieldsToolbar } from '../fields/FieldsToolbar';
import { fieldsCanvasTool, fieldsDrawKind, fieldsDrawTarget } from '../fields/draw-target';
import { fieldsToCollection } from '../fields/geojson';
import { useFieldCatalogue } from '../fields/useFieldCatalogue';
import { EquipmentContextPanel } from '../equipment/EquipmentContextPanel';
import { EquipmentInspector } from '../equipment/EquipmentInspector';
import { EquipmentTwinView } from '../equipment/EquipmentTwinView';
import { useEquipmentCatalogue } from '../equipment/useEquipmentCatalogue';
import { geofenceMarginM } from '../domain/equipment';
import { MissionAssistant } from '../missions/MissionAssistant';
import { useMissionAssistant } from '../missions/useMissionAssistant';
import { readMissionContext } from '../missions/brief';
import {
    buildMissionTree,
    formatDurationCompact,
    formatMetricsDeltaCaption,
    indexListIntersects,
} from '../missions/tree';
import { EditToolbar } from '../map/EditToolbar';
import { FillParcelDialog } from '../map/FillParcelDialog';
import { ConnectTurnsDialog } from '../map/ConnectTurnsDialog';
import { SpeedDialog } from '../map/SpeedDialog';
import { OffsetDialog } from '../map/OffsetDialog';
import { SectionEditPanel } from '../map/SectionEditPanel';
import { LayersPopover } from '../map/LayersPopover';
import { MapCanvas } from '../map/MapCanvas';
import type { PolygonFeatureCollection } from '../map/agri-to-geojson';
import type { BasemapId, OverlayId } from '../map/styles';
import { useMissionEditor, type SaveState } from '../map/useMissionEditor';
import { useI18n } from '../i18n/useI18n';
import { SUPPORTED_LANGUAGES } from '../i18n/adapter';
import { PluginHeaderHost } from '../plugins/PluginHeaderHost';
import {
    Accordion,
    Banner,
    Button,
    Chip,
    DESIGN_SYSTEM_PATH,
    DesignSystemPage,
    IconButton,
    NativeSelect,
} from '../design-system';
import { ICON_SIZE, Machine, STROKE } from '../design-system/icons';
import { Tooltip } from '../design-system/Overlay';

const ICONS: Record<LucideIconName, typeof House> = {
    House,
    Map,
    Machine,
    Route: RouteIcon,
    CirclePlay,
    Send,
    ChartColumn,
    Plug,
    Settings,
    CircleHelp,
    Cloud,
    Search,
};

function useBreakpoint(): Breakpoint {
    const [breakpoint, setBreakpoint] = useState<Breakpoint>(() =>
        breakpointFromWidth(window.innerWidth),
    );
    useEffect(() => {
        const onResize = () => setBreakpoint(breakpointFromWidth(window.innerWidth));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return breakpoint;
}

function saveChip(state: SaveState): {
    tone: 'neutral' | 'valid' | 'warning' | 'danger' | 'info';
    icon: typeof Clock3;
    labelKey: string;
} {
    if (state === 'saving') {
        return { tone: 'info', icon: LoaderCircle, labelKey: 'tool.saving' };
    }
    if (state === 'saved') {
        return { tone: 'valid', icon: CircleCheck, labelKey: 'tool.saved' };
    }
    if (state === 'error') {
        return { tone: 'danger', icon: TriangleAlert, labelKey: 'tool.saveFailedChip' };
    }
    if (state === 'blocked') {
        return { tone: 'warning', icon: TriangleAlert, labelKey: 'tool.unsavedChip' };
    }
    return { tone: 'valid', icon: Clock3, labelKey: 'app.status' };
}

export function AppShell(): ReactElement {
    const { t, language, setLanguage } = useI18n();
    const location = useLocation();
    const navigate = useNavigate();
    const breakpoint = useBreakpoint();
    const fields = useFieldCatalogue();
    const equipment = useEquipmentCatalogue();
    const keepoutM = equipment.envelope ? geofenceMarginM(equipment.envelope) : null;
    const editor = useMissionEditor({
        workingWidthM: equipment.preview.implement?.working_width_m ?? null,
        vehicleWidthM: equipment.preview.vehicle?.width_m ?? null,
        geofenceMarginM: keepoutM,
        kinematics: equipment.preview.vehicle?.kinematics ?? null,
    });
    const assistant = useMissionAssistant({
        fields: fields.fields,
        selectedField: fields.selected,
        combinations: equipment.combinations,
        vehicles: equipment.vehicles,
        implements: equipment.implements,
        equipmentSnapshot: equipment.srbcEquipment
            ? (equipment.srbcEquipment as unknown as Record<string, unknown>)
            : null,
        vehicleWidthM: equipment.preview.vehicle?.width_m ?? null,
        geofenceMarginM: keepoutM,
        onSelectField: (id, options) => fields.select(id, options),
        onApply: (document, summary) => {
            editor.applyGeneratedDocument(document, {
                key: 'assist.summary',
                params: {
                    rows: summary.rows,
                    turns: summary.turns,
                    length: Math.round(summary.length_m),
                    engine: summary.engine,
                },
            });
        },
    });
    const statusChip = saveChip(editor.saveState);
    const [basemap, setBasemap] = useState<BasemapId>('plan');
    const [overlays, setOverlays] = useState<Partial<Record<OverlayId, boolean>>>({
        trajectories: true,
        parcels: true,
        zones: true,
        obstacles: true,
        guidance: true,
        rows: true,
        traffic: true,
        labels: true,
    });
    const onDesignSystem = location.pathname.replace(/\/+$/, '') === DESIGN_SYSTEM_PATH;
    const current = useMemo(() => moduleByPath(location.pathname), [location.pathname]);
    const onFields = current.id === 'fields' && !onDesignSystem;
    const onEquipment = current.id === 'equipment' && !onDesignSystem;
    const onMissions = current.id === 'missions' && !onDesignSystem;
    const missionTree = useMemo(() => buildMissionTree(editor.document), [editor.document]);
    const missionContext = useMemo(() => readMissionContext(editor.document), [editor.document]);
    const selectionLocked = indexListIntersects(editor.selectedIndices, editor.lockedIndices);
    const fieldLabel = missionContext?.field_id
        ? (fields.fields.find((item) => item.id === missionContext.field_id)?.name ??
          missionContext.field_id)
        : null;
    const comboLabel = missionContext?.combination_id
        ? (equipment.combinations.find((item) => item.id === missionContext.combination_id)?.name ??
          missionContext.combination_id)
        : null;
    const selectedSpeedMps = useMemo(() => {
        const leaves = missionTree.leaves.filter((leaf) =>
            editor.selectedIndices.includes(leaf.index),
        );
        if (leaves.length === 0) {
            return null;
        }
        return leaves.reduce((sum, leaf) => sum + leaf.speed_mps, 0) / leaves.length;
    }, [editor.selectedIndices, missionTree.leaves]);
    const [metricsBaseline, setMetricsBaseline] = useState(missionTree.metrics);
    const metricsBaselineKey = `${editor.activePath ?? ''}#${editor.missionFitNonce}`;
    const metricsBaselineKeyRef = useRef(metricsBaselineKey);
    let baselineMetrics = metricsBaseline;
    if (metricsBaselineKeyRef.current !== metricsBaselineKey) {
        metricsBaselineKeyRef.current = metricsBaselineKey;
        baselineMetrics = missionTree.metrics;
        setMetricsBaseline(missionTree.metrics);
    }
    const metricsDelta = formatMetricsDeltaCaption(missionTree.metrics, baselineMetrics);
    const metricsCaption =
        !onFields && !onEquipment && !onDesignSystem && missionTree.metrics.sections > 0
            ? [
                  t('metrics.strip', {
                      length: Math.round(missionTree.metrics.length_m),
                      duration: formatDurationCompact(missionTree.metrics.duration_s),
                      rows: missionTree.metrics.rows,
                      turns: missionTree.metrics.turns,
                  }),
                  metricsDelta,
              ]
                  .filter(Boolean)
                  .join(' · ')
            : null;
    fields.setInteractive(onFields);
    const fieldsDrawing =
        fields.tool === 'draw_polygon' ||
        fields.tool === 'draw_line' ||
        fields.tool === 'draw_point';
    const fieldsDraw =
        fields.tool === 'draw_point'
            ? 'point'
            : fields.tool === 'draw_line'
              ? 'line'
              : fields.tool === 'draw_polygon'
                ? 'polygon'
                : fieldsDrawKind(fields.nav, fields.trafficKind);
    const fieldsLineDraw = fieldsDraw === 'line';
    const fieldsPointDraw = fieldsDraw === 'point';
    const showCatalogue = !onDesignSystem;
    const catalogueGeoJSON = useMemo(
        () =>
            showCatalogue
                ? (fieldsToCollection(
                      fields.fields,
                      onFields || onMissions ? fields.selectedFeatureId : null,
                      fields.childrenByField,
                      onFields && fields.editingGeometry ? fields.selectedFeatureId : null,
                  ) as PolygonFeatureCollection)
                : null,
        [
            fields.childrenByField,
            fields.editingGeometry,
            fields.fields,
            fields.selectedFeatureId,
            onFields,
            showCatalogue,
        ],
    );

    const [paletteOpen, setPaletteOpen] = useState(false);
    const [leftOpen, setLeftOpen] = useState(
        () => breakpointFromWidth(window.innerWidth) !== 'review',
    );
    const [rightOpen, setRightOpen] = useState(() => {
        const initial = breakpointFromWidth(window.innerWidth);
        return initial === 'full' || initial === 'compact';
    });
    const [simOpen, setSimOpen] = useState(false);
    const [leftWidth, setLeftWidth] = useState<number>(LAYOUT.contextDefault);
    const [rightWidth, setRightWidth] = useState<number>(LAYOUT.inspectorDefault);

    useEffect(() => {
        if (onFields) {
            return;
        }
        fields.cancelDraft();
    }, [onFields]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                setPaletteOpen((open) => !open);
                return;
            }
            if (event.key === 'Escape' && paletteOpen) {
                event.preventDefault();
                setPaletteOpen(false);
                return;
            }
            if (event.key === 'Escape' && onFields && fieldsDrawing) {
                event.preventDefault();
                fields.cancelDraft();
                return;
            }
            if (
                event.key === 'Enter' &&
                onFields &&
                fieldsDrawing &&
                fields.draft.length >= (fieldsPointDraw ? 1 : fieldsLineDraw ? 2 : 3)
            ) {
                event.preventDefault();
                void fields.finishDraft();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [fields, onFields, paletteOpen]);

    useEffect(() => {
        if (breakpoint === 'drawer' || breakpoint === 'review') {
            setRightOpen(false);
        }
        if (breakpoint === 'full') {
            setLeftOpen(true);
            setRightOpen(true);
        }
    }, [breakpoint]);

    const overlayLeft = leftOpen && breakpoint === 'review';
    const overlayRight = rightOpen && (breakpoint === 'review' || breakpoint === 'drawer');
    const showLeft = leftOpen && breakpoint !== 'review';
    const showRight = rightOpen && breakpoint !== 'review' && breakpoint !== 'drawer';
    const tracks = shellTracks(showLeft, showRight);
    const contextWidth = breakpoint === 'compact' ? LAYOUT.contextMin : leftWidth;
    const inspectorWidth = breakpoint === 'compact' ? LAYOUT.inspectorMin : rightWidth;

    const startResize = (side: 'left' | 'right') => (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        const origin = event.clientX;
        const start = side === 'left' ? leftWidth : rightWidth;
        const min = side === 'left' ? LAYOUT.contextMin : LAYOUT.inspectorMin;
        const max = side === 'left' ? LAYOUT.contextMax : LAYOUT.inspectorMax;
        const sign = side === 'left' ? 1 : -1;
        const onMove = (moveEvent: globalThis.PointerEvent) => {
            const next = Math.min(max, Math.max(min, start + sign * (moveEvent.clientX - origin)));
            if (side === 'left') {
                setLeftWidth(next);
            } else {
                setRightWidth(next);
            }
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    return (
        <div
            className="studio-shell"
            data-breakpoint={breakpoint}
            data-tracks={tracks}
            data-sim={simOpen ? 'open' : 'closed'}
            style={
                {
                    '--context-width': `${contextWidth}px`,
                    '--inspector-width': `${inspectorWidth}px`,
                } as CSSProperties
            }
        >
            <header className="studio-appbar">
                <div className="studio-appbar-brand">
                    <span className="studio-appbar-farm">{t('app.farm')}</span>
                    <span className="studio-appbar-title">{t('app.title')}</span>
                </div>
                <IconButton
                    label={t('app.search')}
                    tooltip={`${t('app.search')} (⌘K)`}
                    onClick={() => setPaletteOpen(true)}
                >
                    <Search size={ICON_SIZE.menu} strokeWidth={STROKE} aria-hidden="true" />
                </IconButton>
                <nav className="studio-breadcrumb" aria-label="Fil d'Ariane">
                    <span>{t('app.breadcrumb')}</span>
                    <span aria-hidden="true">/</span>
                    <span>{onDesignSystem ? t('ds.nav') : t(current.labelKey)}</span>
                    <Chip icon={GitCompare}>{t('app.missionDraft')}</Chip>
                    {fieldLabel ? <Chip icon={LandPlot}>{fieldLabel}</Chip> : null}
                    {comboLabel ? <Chip icon={Machine}>{comboLabel}</Chip> : null}
                    {missionContext?.operation ? (
                        <Chip icon={RouteIcon}>
                            {t(`assist.operation.${missionContext.operation}`)}
                        </Chip>
                    ) : null}
                    <Chip tone={statusChip.tone} icon={statusChip.icon}>
                        {t(statusChip.labelKey)}
                    </Chip>
                </nav>
                <div className="studio-appbar-actions">
                    <Button variant="secondary" disabled title={t('app.compareHint')}>
                        {t('app.compare')}
                    </Button>
                    <Button variant="secondary" disabled title={t('app.simulateHint')}>
                        {t('app.simulate')}
                    </Button>
                    <Button variant="primary" disabled title={t('app.publishHint')}>
                        {t('app.publish')}
                    </Button>
                    <NativeSelect
                        id="languageSelect"
                        label={t('app.language')}
                        value={language}
                        onChange={(event) => setLanguage(event.target.value)}
                    >
                        {SUPPORTED_LANGUAGES.map((code) => (
                            <option key={code} value={code}>
                                {code.toUpperCase()}
                            </option>
                        ))}
                    </NativeSelect>
                    <PluginHeaderHost />
                </div>
            </header>

            <nav className="studio-rail" aria-label="Navigation principale">
                <ul>
                    {MODULES.map((module) => {
                        const Icon = ICONS[module.icon];
                        const label = t(module.labelKey);
                        return (
                            <li key={module.id}>
                                <Tooltip content={label} side="right">
                                    <NavLink
                                        to={module.path}
                                        aria-label={label}
                                        className={({ isActive }) =>
                                            isActive ? 'is-active' : undefined
                                        }
                                        end={module.path === '/'}
                                        onClick={() => setLeftOpen(true)}
                                    >
                                        <Icon
                                            size={ICON_SIZE.menu}
                                            strokeWidth={STROKE}
                                            aria-hidden="true"
                                        />
                                        <span className="visually-hidden">{label}</span>
                                    </NavLink>
                                </Tooltip>
                            </li>
                        );
                    })}
                </ul>
                <div className="studio-rail-bottom">
                    <IconButton label={t('app.help')} tooltipSide="right">
                        <CircleHelp size={ICON_SIZE.menu} strokeWidth={STROKE} aria-hidden="true" />
                    </IconButton>
                    <IconButton label={t('app.sync')} tooltipSide="right">
                        <Cloud size={ICON_SIZE.menu} strokeWidth={STROKE} aria-hidden="true" />
                    </IconButton>
                    <span
                        className="studio-avatar"
                        title={t('app.profile')}
                        aria-label={t('app.profile')}
                    >
                        S
                    </span>
                </div>
            </nav>

            {showLeft || overlayLeft ? (
                onFields ? (
                    <FieldsContextPanel
                        t={t}
                        catalogue={fields}
                        overlay={overlayLeft}
                        onDrawStarted={() => {
                            if (breakpoint === 'review') {
                                setLeftOpen(false);
                            }
                        }}
                    />
                ) : onEquipment ? (
                    <EquipmentContextPanel t={t} catalogue={equipment} overlay={overlayLeft} />
                ) : onMissions ? (
                    <MissionAssistant
                        t={t}
                        overlay={overlayLeft}
                        assistant={assistant}
                        fields={fields.fields}
                        selectedField={fields.selected}
                        fieldsAvailable={fields.available}
                        combinations={equipment.combinations}
                        implements={equipment.implements}
                        missions={editor.list}
                        activePath={editor.activePath}
                        onSelectMission={editor.select}
                        tree={missionTree}
                        selectedIndices={editor.selectedIndices}
                        onSelectSection={(index, additive) =>
                            editor.selectIndices([index], additive)
                        }
                        onReorderSelected={editor.reorderSelected}
                        onReorderTo={editor.reorderTo}
                        hiddenIndices={editor.hiddenIndices}
                        lockedIndices={editor.lockedIndices}
                        onToggleHidden={editor.toggleHidden}
                        onToggleLocked={editor.toggleLocked}
                        onReverseSelected={editor.reverseSelected}
                    />
                ) : (
                    <ContextPanel
                        module={current}
                        t={t}
                        missions={editor.list}
                        activePath={editor.activePath}
                        onSelectMission={editor.select}
                        overlay={overlayLeft}
                    />
                )
            ) : null}
            {overlayLeft || overlayRight ? (
                <button
                    type="button"
                    className="studio-context-scrim"
                    aria-label={overlayRight ? t('app.collapseRight') : t('app.collapseLeft')}
                    onClick={() => {
                        setLeftOpen(false);
                        setRightOpen(false);
                    }}
                />
            ) : null}
            {showLeft ? (
                <div
                    className="studio-handle studio-handle-left"
                    role="separator"
                    aria-orientation="vertical"
                    onPointerDown={startResize('left')}
                />
            ) : null}

            <main className="studio-canvas">
                <div className="studio-canvas-toolbar">
                    <IconButton
                        label={leftOpen ? t('app.collapseLeft') : t('app.expandLeft')}
                        onClick={() => {
                            setLeftOpen((value) => {
                                const next = !value;
                                if (next && breakpoint === 'review') {
                                    setRightOpen(false);
                                }
                                return next;
                            });
                        }}
                    >
                        {leftOpen ? (
                            <PanelLeftClose size={ICON_SIZE.button} strokeWidth={STROKE} />
                        ) : (
                            <PanelLeftOpen size={ICON_SIZE.button} strokeWidth={STROKE} />
                        )}
                    </IconButton>
                    <IconButton
                        label={t('app.toggleSimulation')}
                        aria-pressed={simOpen}
                        onClick={() => setSimOpen((value) => !value)}
                    >
                        <CirclePlay size={ICON_SIZE.button} strokeWidth={STROKE} />
                    </IconButton>
                    <IconButton
                        label={rightOpen ? t('app.collapseRight') : t('app.expandRight')}
                        onClick={() => {
                            setRightOpen((value) => {
                                const next = !value;
                                if (next && breakpoint === 'review') {
                                    setLeftOpen(false);
                                }
                                return next;
                            });
                        }}
                    >
                        {rightOpen ? (
                            <PanelRightClose size={ICON_SIZE.button} strokeWidth={STROKE} />
                        ) : (
                            <PanelRightOpen size={ICON_SIZE.button} strokeWidth={STROKE} />
                        )}
                    </IconButton>
                </div>
                {breakpoint === 'review' ? (
                    <Banner tone="warning" icon={TriangleAlert} className="studio-review-banner">
                        {t('app.reviewMode')}
                    </Banner>
                ) : null}
                <Routes>
                    <Route path={DESIGN_SYSTEM_PATH} element={<DesignSystemPage />} />
                    <Route path="*" element={null} />
                </Routes>
                {onDesignSystem ? null : onEquipment ? (
                    <EquipmentTwinView t={t} catalogue={equipment} />
                ) : (
                    <>
                        <MapCanvas
                            document={editor.document}
                            basemap={basemap}
                            overlays={overlays}
                            fitKey={
                                onFields
                                    ? null
                                    : `${editor.activePath ?? 'draft'}#${editor.missionFitNonce}`
                            }
                            tool={onFields ? fieldsCanvasTool(fields.tool) : editor.tool}
                            extendActive={onFields ? false : editor.extendDirection !== null}
                            draft={onFields ? fields.draft : editor.draft}
                            selectedIndices={onFields ? [] : editor.selectedIndices}
                            draftCaption={onFields ? null : editor.rulerDistance}
                            catalogueGeoJSON={catalogueGeoJSON}
                            catalogueFitKey={
                                (onFields || onMissions) &&
                                fields.cameraTargetId &&
                                fields.cameraNonce > 0
                                    ? `${fields.cameraTargetId}#${fields.cameraNonce}`
                                    : null
                            }
                            coveragePreview={
                                onFields ? null : (assistant.preview ?? editor.coveragePreview)
                            }
                            onMapClick={
                                onFields
                                    ? fields.handleMapClick
                                    : editor.tool === 'none'
                                      ? undefined
                                      : editor.handleMapClick
                            }
                            onMapDblClick={onFields ? fields.handleMapDblClick : undefined}
                            onInsertVertex={
                                onFields
                                    ? fieldsDrawing
                                        ? fields.insertVertex
                                        : undefined
                                    : editor.tool === 'none'
                                      ? undefined
                                      : editor.insertVertex
                            }
                            onMoveVertex={
                                onFields
                                    ? fieldsDrawing
                                        ? fields.moveVertex
                                        : undefined
                                    : editor.tool === 'none'
                                      ? undefined
                                      : editor.moveVertex
                            }
                            onBeginSelectionDrag={onFields ? undefined : editor.beginSelectionDrag}
                            onUpdateSelectionDrag={
                                onFields ? undefined : editor.updateSelectionDrag
                            }
                            onFinishSelectionDrag={
                                onFields ? undefined : editor.finishSelectionDrag
                            }
                            onCancelSelectionDrag={
                                onFields ? undefined : editor.cancelSelectionDrag
                            }
                            hitSelectedSection={onFields ? undefined : editor.hitSelectedSection}
                            metricsCaption={metricsCaption}
                            hiddenIndices={onFields ? [] : editor.hiddenIndices}
                        />
                        {onFields ? (
                            <FieldsToolbar
                                t={t}
                                tool={fields.tool}
                                drawKind={fieldsDraw ?? 'polygon'}
                                draftCount={fields.draft.length}
                                showDraw={fieldsDrawTarget(fields.nav, fields.trafficKind) !== null}
                                onSelect={() => fields.setTool('select')}
                                onDraw={() => {
                                    if (fields.startDraw() && breakpoint === 'review') {
                                        setLeftOpen(false);
                                    }
                                }}
                                onFinish={() => void fields.finishDraft()}
                                onCancel={fields.cancelDraft}
                            />
                        ) : (
                            <EditToolbar
                                t={t}
                                tool={editor.tool}
                                draftCount={editor.draft.length}
                                selectedCount={editor.selectedIndices.length}
                                canUndo={editor.canUndo}
                                canRedo={editor.canRedo}
                                onSelectZone={editor.startSelectZone}
                                onSelectPolygon={editor.startSelectPolygon}
                                onDrawLine={editor.startDrawLine}
                                onDrawPolygon={editor.startDrawPolygon}
                                onFillParcel={editor.startFillParcel}
                                onWorkingZone={editor.startWorkingZone}
                                onDeleteZone={editor.startDeleteZone}
                                onConnectTurns={editor.startConnectTurns}
                                onOffset={editor.startOffset}
                                onRuler={editor.startRuler}
                                onEditSpeed={editor.startEditSpeed}
                                onFinish={editor.finishCurrent}
                                onFinishWorkingZone={editor.finishWorkingZone}
                                onReverseSelected={editor.reverseSelected}
                                onDeleteSelected={editor.deleteSelected}
                                onUndo={editor.undo}
                                onRedo={editor.redo}
                            />
                        )}
                        {onFields && fieldsDrawing ? (
                            <p className="studio-tool-hint" role="status">
                                {t(
                                    fields.editingGeometry
                                        ? fieldsPointDraw
                                            ? 'fields.editHintPoint'
                                            : 'fields.editHint'
                                        : fieldsPointDraw
                                          ? 'fields.drawHintPoint'
                                          : fieldsLineDraw
                                            ? 'fields.drawHintLine'
                                            : 'fields.drawHint',
                                )}
                            </p>
                        ) : onFields ? (
                            <p className="studio-tool-hint" role="status">
                                {t('fields.selectHint')}
                            </p>
                        ) : editor.tool === 'none' ? null : (
                            <p className="studio-tool-hint" role="status">
                                {editor.extendDirection
                                    ? t('inspector.edit.extendHint')
                                    : editor.tool === 'ruler' && editor.rulerDistance
                                      ? t('tool.rulerDistance', { distance: editor.rulerDistance })
                                      : t(
                                            editor.tool === 'draw_polygon'
                                                ? 'tool.drawPolygonHint'
                                                : editor.tool === 'draw_parcel'
                                                  ? 'tool.fillParcelHint'
                                                  : editor.tool === 'edit_working_zone'
                                                    ? 'tool.workingZoneHint'
                                                    : editor.tool === 'delete_points_zone'
                                                      ? 'tool.deleteZoneHint'
                                                      : editor.tool === 'select_zone'
                                                        ? 'tool.selectZoneHint'
                                                        : editor.tool === 'select_sections_polygon'
                                                          ? 'tool.selectPolygonHint'
                                                          : editor.tool === 'ruler'
                                                            ? 'tool.rulerHint'
                                                            : 'tool.drawLineHint',
                                        )}
                            </p>
                        )}
                        <LayersPopover
                            t={t}
                            basemap={basemap}
                            onBasemap={setBasemap}
                            overlays={overlays}
                            onOverlay={(id, visible) =>
                                setOverlays((currentOverlays) => ({
                                    ...currentOverlays,
                                    [id]: visible,
                                }))
                            }
                        />
                        <FillParcelDialog
                            t={t}
                            open={editor.parcelDialogOpen}
                            spacing={editor.rowSpacing}
                            strategy={editor.coverageStrategy}
                            spacingSource={
                                equipment.preview.implement
                                    ? t('tool.rowSpacingSourceEquipment', {
                                          width: equipment.preview.implement.working_width_m,
                                          name: equipment.preview.implement.name,
                                      })
                                    : t('tool.rowSpacingSource')
                            }
                            headlandWidth={editor.headlandWidth}
                            connectTurns={editor.connectAfterFill}
                            variants={editor.coverageVariants}
                            variantsLoading={editor.coverageVariantsLoading}
                            onSpacing={editor.setRowSpacing}
                            onStrategy={editor.setCoverageStrategy}
                            onHeadlandWidth={editor.setHeadlandWidth}
                            onConnectTurns={editor.setConnectAfterFill}
                            onOpenChange={editor.setParcelDialogOpen}
                            onConfirm={editor.finishFillParcel}
                        />
                        <ConnectTurnsDialog
                            t={t}
                            open={editor.turnsDialogOpen}
                            params={editor.turnsParams}
                            onParams={editor.setTurnsParams}
                            onOpenChange={editor.setTurnsDialogOpen}
                            onConfirm={editor.finishConnectTurns}
                        />
                        <SpeedDialog
                            t={t}
                            open={editor.speedDialogOpen}
                            speed={editor.speedValue}
                            onSpeed={editor.setSpeedValue}
                            onOpenChange={editor.setSpeedDialogOpen}
                            onConfirm={editor.finishEditSpeed}
                        />
                        <OffsetDialog
                            t={t}
                            open={editor.offsetDialogOpen}
                            distance={editor.offsetDistance}
                            side={editor.offsetSide}
                            onDistance={editor.setOffsetDistance}
                            onSide={editor.setOffsetSide}
                            onOpenChange={editor.setOffsetDialogOpen}
                            onConfirm={editor.finishOffset}
                        />
                    </>
                )}
            </main>

            {showRight ? (
                <div
                    className="studio-handle studio-handle-right"
                    role="separator"
                    aria-orientation="vertical"
                    onPointerDown={startResize('right')}
                />
            ) : null}
            {showRight || overlayRight ? (
                onFields ? (
                    <FieldInspector
                        t={t}
                        language={language}
                        catalogue={fields}
                        overlay={overlayRight}
                        missionPath={editor.activePath}
                        onOpenMission={(path) => {
                            if (path) {
                                editor.select(path);
                            }
                            navigate('/missions');
                        }}
                    />
                ) : onEquipment ? (
                    <EquipmentInspector t={t} catalogue={equipment} overlay={overlayRight} />
                ) : (
                    <InspectorPanel
                        t={t}
                        overlay={overlayRight}
                        message={
                            editor.noticeKey
                                ? t(editor.noticeKey, editor.noticeParams)
                                : editor.error
                                  ? editor.error
                                  : editor.selectedIndices.length > 0
                                    ? t('inspector.selected', {
                                          count: editor.selectedIndices.length,
                                      })
                                    : editor.document
                                      ? t('inspector.points', {
                                            sections: editor.sectionCount,
                                            points: editor.pointCount,
                                        })
                                      : t('map.empty')
                        }
                        detail={
                            editor.saveState === 'saving'
                                ? t('tool.savingDetail')
                                : editor.saveState === 'error'
                                  ? t('tool.saveFailed', editor.noticeParams)
                                  : editor.saveState === 'blocked'
                                    ? t('tool.unsaved')
                                    : editor.activePath
                        }
                    >
                        {editor.selectedIndices.length > 0 ? (
                            <Accordion
                                defaultValue="geometry"
                                items={[
                                    {
                                        value: 'geometry',
                                        title: t('inspector.accordion.geometry'),
                                        content: (
                                            <>
                                                {selectionLocked ? (
                                                    <p className="studio-muted studio-inspector-block">
                                                        {t('tree.lockedHint')}
                                                    </p>
                                                ) : null}
                                                <SectionEditPanel
                                                    t={t}
                                                    locked={selectionLocked}
                                                    selectedCount={editor.selectedIndices.length}
                                                    moveStep={editor.moveStep}
                                                    onMoveStep={editor.setMoveStep}
                                                    onMove={editor.moveSelected}
                                                    rotationStep={editor.rotationStep}
                                                    onRotationStep={editor.setRotationStep}
                                                    onRotate={editor.rotateSelected}
                                                    duplicateCount={editor.duplicateCount}
                                                    onDuplicateCount={editor.setDuplicateCount}
                                                    duplicateDistance={editor.duplicateDistance}
                                                    onDuplicateDistance={
                                                        editor.setDuplicateDistance
                                                    }
                                                    duplicateSide={editor.duplicateSide}
                                                    onDuplicateSide={editor.setDuplicateSide}
                                                    onDuplicate={editor.duplicateSelected}
                                                    extendDirection={editor.extendDirection}
                                                    onStartExtend={editor.startExtend}
                                                    onCancelExtend={editor.cancelExtend}
                                                />
                                            </>
                                        ),
                                    },
                                    {
                                        value: 'order',
                                        title: t('inspector.accordion.order'),
                                        content: (
                                            <div className="studio-inspector-block">
                                                <p className="studio-muted">
                                                    {t('inspector.orderHint')}
                                                </p>
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    disabled={selectionLocked}
                                                    onClick={editor.reverseSelected}
                                                >
                                                    {t('tree.reverse')}
                                                </Button>
                                            </div>
                                        ),
                                    },
                                    {
                                        value: 'speed',
                                        title: t('inspector.accordion.speed'),
                                        content: (
                                            <p className="studio-muted studio-inspector-block">
                                                {t('inspector.speedHint', {
                                                    speed:
                                                        selectedSpeedMps == null
                                                            ? '—'
                                                            : selectedSpeedMps.toFixed(2),
                                                })}
                                            </p>
                                        ),
                                    },
                                    {
                                        value: 'tool',
                                        title: t('inspector.accordion.tool'),
                                        content: (
                                            <p className="studio-muted studio-inspector-block">
                                                {t('inspector.toolHint', {
                                                    combo: comboLabel ?? t('assist.none'),
                                                    width:
                                                        missionContext?.working_width_m == null
                                                            ? '—'
                                                            : missionContext.working_width_m,
                                                })}
                                            </p>
                                        ),
                                    },
                                    {
                                        value: 'metadata',
                                        title: t('inspector.accordion.metadata'),
                                        content: (
                                            <p className="studio-muted studio-inspector-block">
                                                {missionContext
                                                    ? t('inspector.briefHint', {
                                                          campaign: missionContext.campaign ?? '—',
                                                          operation: missionContext.operation
                                                              ? t(
                                                                    `assist.operation.${missionContext.operation}`,
                                                                )
                                                              : '—',
                                                      })
                                                    : t('inspector.noBrief')}
                                            </p>
                                        ),
                                    },
                                ]}
                            />
                        ) : null}
                    </InspectorPanel>
                )
            ) : null}

            {simOpen && breakpoint !== 'review' ? <SimulationDrawer t={t} /> : null}

            <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} t={t} />
        </div>
    );
}
