import {
    useCallback,
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
    ChevronUp,
    CircleCheck,
    CircleHelp,
    CirclePlay,
    Clock3,
    Cloud,
    GitCompare,
    Grape,
    House,
    LandPlot,
    LoaderCircle,
    Map,
    PanelLeftClose,
    PanelLeftOpen,
    PanelRightClose,
    PanelRightOpen,
    Route as RouteIcon,
    Search,
    Send,
    Settings,
    Sprout,
    TriangleAlert,
    Wheat,
} from 'lucide-react';

import { CompareDialog } from '../simulation/CompareDialog';
import { SimulationPanel } from '../simulation/SimulationPanel';
import { PublishDialog } from '../publication/PublishDialog';
import { usePublications } from '../publication/usePublications';
import { AdminPanel } from './AdminPanel';
import { CommandPalette } from './CommandPalette';
import { HomeDashboard } from './HomeDashboard';
import type { FarmEntry } from './farm-api';
import {
    DEFAULT_FIELD_GEOFENCE_INSET_CM,
    fetchFarmMission,
    isAdvancedUi,
    type UiMode,
} from './farm-api';
import { useFarm } from './useFarm';
import { breakpointFromWidth, LAYOUT, shellTracks, type Breakpoint } from './layout';
import { MODULES, moduleByPath, redirectFor, type LucideIconName } from './modules';
import { ContextPanel, SimulationDrawer } from './PlaceholderModule';
import { FieldInspector } from '../fields/FieldInspector';
import { FieldsPanel } from '../fields/FieldsPanel';
import { FieldsActionPanel } from '../fields/FieldsActionPanel';
import { FieldsEditToolbar } from '../fields/FieldsEditToolbar';
import { DEFAULT_BED_COUNT, DEFAULT_BED_PATH_M, DEFAULT_BED_WIDTH_M } from '../fields/rows';
import { fieldsCanvasTool, fieldsDrawKind } from '../fields/draw-target';
import { fieldsToCollection, hitCatalogue, withoutHiddenFeatures } from '../fields/geojson';
import { useFieldCatalogue } from '../fields/useFieldCatalogue';
import { useFieldsFollowUpForm } from '../fields/useFieldsFollowUpForm';
import { EquipmentContextPanel } from '../equipment/EquipmentContextPanel';
import { EquipmentInspector } from '../equipment/EquipmentInspector';
import { EquipmentTwinView } from '../equipment/EquipmentTwinView';
import { useEquipmentCatalogue } from '../equipment/useEquipmentCatalogue';
import { geofenceMarginM } from '../domain/equipment';
import { documentOrigin } from '../domain/draft';
import { readCropPack } from '../domain/crop-pack';
import { localToLngLat } from '../domain/geometry';
import { geojsonRingToLocal, readOddFromDocument, type OddContext } from '../domain/odd';
import { splitDurations } from '../domain/report';
import {
    missionLifecycle,
    publishBlockReason,
    readPublicationStamp,
    type SimAttestation,
} from '../domain/publication';
import {
    geofenceRing,
    hullToLngLatRing,
    poseFootprintRings,
    simulateMission,
    simulationFingerprint,
    type PoseSample,
    type SimulationReport,
} from '../domain/simulation';
import { MissionPanel } from '../missions/MissionPanel';
import { useMissionAssistant } from '../missions/useMissionAssistant';
import { readMissionContext, suggestedMissionName } from '../missions/brief';
import {
    buildMissionTree,
    formatDurationCompact,
    formatMetricsDeltaCaption,
    indexListIntersects,
} from '../missions/tree';
import { EditToolbar } from '../map/EditToolbar';
import { FillGeofencePrompt, FillParcelDialog } from '../map/FillParcelDialog';
import { EntitySelectionActions, ZoneActionPanel } from '../map/ZoneActionPanel';
import { ConnectEndsPanel } from '../map/ConnectEndsPanel';
import { ConnectFreeDialog } from '../map/ConnectFreeDialog';
import { listRowEndpoints } from '../domain/selection';
import { resolveSpeedStops } from '../domain/speed-style';
import { ConnectTurnsDialog } from '../map/ConnectTurnsDialog';
import { SpeedDialog } from '../map/SpeedDialog';
import { OffsetDialog } from '../map/OffsetDialog';
import { SectionEditPanel } from '../map/SectionEditPanel';
import { LayersPopover } from '../map/LayersPopover';
import { MapCanvas } from '../map/MapCanvas';
import { useImportedLayers } from '../map/useImportedLayers';
import { ImportDialog } from '../imports/ImportDialog';
import { commitFieldImport } from '../imports/commit-field';
import { fieldPlanFromImport, missionFromImport } from '../imports/convert';
import { useFileImport } from '../imports/useFileImport';
import type { PolygonFeatureCollection } from '../map/agri-to-geojson';
import type { BasemapId, MapView, OverlayId } from '../map/styles';
import { isTypingTarget, useMissionEditor, type SaveState } from '../map/useMissionEditor';
import { suggestedMissionPath } from '../map/missions-api';
import { useI18n } from '../i18n/useI18n';
import { SUPPORTED_LANGUAGES } from '../i18n/adapter';
import { PluginHeaderHost } from '../plugins/PluginHeaderHost';
import {
    Accordion,
    Tabs,
    Banner,
    Button,
    Chip,
    DESIGN_SYSTEM_PATH,
    DesignSystemPage,
    IconButton,
    NativeSelect,
} from '../design-system';
import { ICON_SIZE, Machine, STROKE } from '../design-system/icons';
import { Dialog, Tooltip } from '../design-system/Overlay';

const ICONS: Record<LucideIconName, typeof House> = {
    House,
    Map,
    Machine,
    Route: RouteIcon,
    CirclePlay,
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

function MissionToolsPanel({
    t,
    overlay,
    editor,
    selectionLocked,
    entityTools,
}: {
    t: (key: string, params?: Record<string, string | number>) => string;
    overlay: boolean;
    editor: ReturnType<typeof useMissionEditor>;
    selectionLocked: boolean;
    entityTools: ReactElement;
}): ReactElement {
    const title =
        editor.tool === 'connect_ends'
            ? t('connect.panel')
            : editor.zoneMode
              ? t('zone.panel')
              : t('tools.panel');
    const showPointerTools =
        editor.tool !== 'connect_ends' && !editor.zoneMode && editor.selectedIndices.length > 0;
    return (
        <aside
            className={overlay ? 'studio-inspector is-overlay' : 'studio-inspector'}
            aria-label={title}
        >
            <header className="studio-panel-header">
                <h2>{title}</h2>
            </header>
            {editor.tool === 'connect_ends' ? (
                <ConnectEndsPanel
                    t={t}
                    picked={editor.connectPicked}
                    kind={editor.connectKind}
                    waypointCount={editor.draft.length}
                    onKind={editor.setConnectKind}
                    onConfirm={editor.requestConnectEnds}
                    onCancel={editor.cancelTool}
                />
            ) : null}
            {editor.zoneMode ? (
                <ZoneActionPanel
                    t={t}
                    mode={editor.zoneMode}
                    locked={selectionLocked}
                    workingZoneOn={editor.zoneWorkingOn}
                    speedDraft={editor.zoneSpeedDraft}
                    entityTools={entityTools}
                    onMode={editor.setZoneMode}
                    onCut={editor.applyZoneCut}
                    onWorkingZone={editor.applyZoneWorking}
                    onSpeedDraft={editor.setZoneSpeedDraft}
                    onApplySpeed={editor.applyZoneSpeed}
                    onConnectTurns={editor.startConnectTurns}
                    onReverse={editor.reverseSelected}
                    onDelete={editor.deleteSelected}
                />
            ) : null}
            {showPointerTools ? (
                <div className="studio-inspector-block">
                    <EntitySelectionActions
                        t={t}
                        locked={selectionLocked}
                        onConnectTurns={editor.startConnectTurns}
                        onReverse={editor.reverseSelected}
                        onDelete={editor.deleteSelected}
                    />
                    {entityTools}
                </div>
            ) : null}
            {editor.tool !== 'connect_ends' && !editor.zoneMode && !showPointerTools ? (
                <p className="studio-muted">{t('tools.empty')}</p>
            ) : null}
        </aside>
    );
}

function MissionInspectorBody({
    t,
    editor,
    uiMode,
    selectionLocked,
    selectedSpeedMps,
    comboLabel,
    missionContext,
}: {
    t: (key: string, params?: Record<string, string | number>) => string;
    editor: ReturnType<typeof useMissionEditor>;
    uiMode: UiMode;
    selectionLocked: boolean;
    selectedSpeedMps: number | null;
    comboLabel: string | null;
    missionContext: ReturnType<typeof readMissionContext>;
}): ReactElement {
    return (
        <>
            {editor.selectedIndices.length > 0 && editor.zoneMode !== 'portions' ? (
                <Accordion
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
                                        uiMode={uiMode}
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
                                        onDuplicateDistance={editor.setDuplicateDistance}
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
                                    <p className="studio-muted">{t('inspector.orderHint')}</p>
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
        </>
    );
}

export function AppShell(): ReactElement {
    const { t, language, setLanguage } = useI18n();
    const location = useLocation();
    const navigate = useNavigate();
    const breakpoint = useBreakpoint();
    const fields = useFieldCatalogue();
    const equipment = useEquipmentCatalogue();
    const farm = useFarm();
    const uiMode: UiMode = farm.farm?.ui_mode ?? 'basic';
    const keepoutM = equipment.envelope ? geofenceMarginM(equipment.envelope) : null;
    const editor = useMissionEditor({
        workingWidthM: equipment.preview.implement?.working_width_m ?? null,
        vehicleWidthM: equipment.preview.vehicle?.width_m ?? null,
        geofenceMarginM: keepoutM,
        kinematics: equipment.preview.vehicle?.kinematics ?? null,
        guidanceLines: fields.selected?.guidance_lines ?? [],
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
            const context = readMissionContext(document);
            const field = fields.fields.find((item) => item.id === context?.field_id);
            const operation = context?.operation
                ? t(`assist.operation.${context.operation}`)
                : t('assist.operation.other');
            const metadata =
                document.metadata && typeof document.metadata === 'object'
                    ? { ...(document.metadata as Record<string, unknown>) }
                    : {};
            const brief =
                metadata.srbc_mission_brief && typeof metadata.srbc_mission_brief === 'object'
                    ? { ...(metadata.srbc_mission_brief as Record<string, unknown>) }
                    : {};
            const fieldName = context?.field_name || field?.name || '';
            const namedDocument = {
                ...document,
                metadata: {
                    ...metadata,
                    srbc_mission_brief: {
                        ...brief,
                        field_name: fieldName || null,
                        // The operator may have typed their own name in the assistant.
                        name: context?.name || suggestedMissionName(operation, fieldName),
                    },
                },
            };
            editor.startNewDocument(namedDocument, {
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
        landmarks: true,
        labels: true,
        envelopes: true,
        simulation: true,
    });
    const imported = useImportedLayers();
    const fileImport = useFileImport({
        onAdd: imported.addCollection,
        onConvert: async (request, preview) => {
            if (request.intent === 'mission') {
                editor.startNewDocument(missionFromImport(preview.collection, request), {
                    key: 'imports.created.mission',
                    params: { name: request.name },
                });
                return;
            }
            const plan = fieldPlanFromImport(preview.collection, request);
            const fieldId = await commitFieldImport(
                plan,
                request.intent === 'field-edit' ? fields.selectedId : null,
            );
            await fields.reload();
            fields.select(fieldId, { fit: true });
        },
    });
    const onDesignSystem = location.pathname.replace(/\/+$/, '') === DESIGN_SYSTEM_PATH;
    const current = useMemo(() => moduleByPath(location.pathname), [location.pathname]);
    const onFields = current.id === 'fields' && !onDesignSystem;
    const onEquipment = current.id === 'equipment' && !onDesignSystem;
    const onMissions = current.id === 'missions' && !onDesignSystem;
    const onSimulation = current.id === 'simulation' && !onDesignSystem;
    const onHome = current.id === 'home' && !onDesignSystem;
    const onAdmin = current.id === 'admin' && !onDesignSystem;
    const missionTree = useMemo(() => buildMissionTree(editor.document), [editor.document]);
    const missionContext = useMemo(() => readMissionContext(editor.document), [editor.document]);
    useEffect(() => {
        const fieldId = missionContext?.field_id;
        if (!onMissions || !fieldId || fields.selectedId === fieldId) {
            return;
        }
        fields.select(fieldId);
    }, [fields.select, fields.selectedId, missionContext?.field_id, onMissions]);
    const selectionLocked = indexListIntersects(editor.selectedIndices, editor.lockedIndices);
    const fieldLabel = missionContext?.field_id
        ? (fields.fields.find((item) => item.id === missionContext.field_id)?.name ??
          missionContext.field_id)
        : null;
    const comboLabel = missionContext?.combination_id
        ? (equipment.combinations.find((item) => item.id === missionContext.combination_id)?.name ??
          missionContext.combination_id)
        : null;
    const cropPack = readCropPack(editor.document);
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
    editor.setInteractive(!onFields);
    const fieldsDrawing =
        fields.tool === 'draw_polygon' ||
        fields.tool === 'draw_line' ||
        fields.tool === 'draw_point' ||
        fields.tool === 'select_polygon' ||
        fields.tool === 'ruler';
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
                ? (withoutHiddenFeatures(
                      fieldsToCollection(
                          fields.fields,
                          onFields || onMissions ? fields.selectedFeatureId : null,
                          fields.childrenByField,
                          onFields && fields.editingGeometry ? fields.selectedFeatureId : null,
                      ),
                      fields.hiddenIds,
                  ) as PolygonFeatureCollection)
                : null,
        [
            fields.childrenByField,
            fields.editingGeometry,
            fields.fields,
            fields.hiddenIds,
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
    const [simReport, setSimReport] = useState<SimulationReport | null>(null);
    const [simFingerprint, setSimFingerprint] = useState<string | null>(null);
    const [poseSample, setPoseSample] = useState<PoseSample | null>(null);
    const [poseFlyKey, setPoseFlyKey] = useState(0);
    const autoSimKeyRef = useRef<string | null>(null);
    const onSimCursor = useCallback((sample: PoseSample | null) => {
        setPoseSample(sample);
    }, []);
    const [compareOpen, setCompareOpen] = useState(false);
    const [publishOpen, setPublishOpen] = useState(false);
    const [missionTab, setMissionTab] = useState('explore');
    const [fieldsTab, setFieldsTab] = useState('explore');
    const [fieldsGeofencePrompt, setFieldsGeofencePrompt] = useState(false);
    const [fieldsLassoTab, setFieldsLassoTab] = useState<'entities' | 'portions'>('entities');
    const fieldsFollowUpForm = useFieldsFollowUpForm();
    const [drawerTab, setDrawerTab] = useState('inspector');
    const [simSeekIndex, setSimSeekIndex] = useState<number | null>(null);
    /** Show a check on the map and move the timeline cursor onto it. */
    const locateSample = useCallback(
        (sample: PoseSample) => {
            setSimOpen(true);
            setPoseSample(sample);
            setPoseFlyKey((value) => value + 1);
            const index = simReport?.samples.indexOf(sample) ?? -1;
            if (index >= 0) {
                setSimSeekIndex(index);
            }
        },
        [simReport],
    );
    const publications = usePublications(editor.activePath);
    const workingWidthM = equipment.preview.implement?.working_width_m ?? null;
    const oddContext = useMemo((): OddContext => {
        const combo =
            equipment.selectedCombination ??
            (missionContext?.combination_id
                ? (equipment.combinations.find(
                      (item) => item.id === missionContext.combination_id,
                  ) ?? null)
                : null);
        const profile = combo?.odd ?? readOddFromDocument(editor.document);
        const fieldId = missionContext?.field_id;
        const field = fieldId ? (fields.fields.find((item) => item.id === fieldId) ?? null) : null;
        const children =
            fieldId && fields.selected?.id === fieldId
                ? fields.selected
                : fieldId
                  ? fields.childrenByField[fieldId]
                  : undefined;
        const origin = documentOrigin(editor.document);
        const zones = children?.zones ?? [];
        const autonomyRings = origin
            ? zones
                  .filter((zone) => zone.kind === 'autonomy')
                  .map((zone) => geojsonRingToLocal(zone.geometry, origin))
                  .filter((ring) => ring.length >= 3)
            : [];
        const forbiddenRings = origin
            ? zones
                  .filter((zone) => zone.kind === 'forbidden')
                  .map((zone) => geojsonRingToLocal(zone.geometry, origin))
                  .filter((ring) => ring.length >= 3)
            : [];
        const gnssDegradedRings = origin
            ? zones
                  .filter((zone) => zone.kind === 'gnss_degraded')
                  .map((zone) => geojsonRingToLocal(zone.geometry, origin))
                  .filter((ring) => ring.length >= 3)
            : [];
        const slopeRaw = field?.provenance?.slope_pct;
        const declaredSlopePct = Number(slopeRaw);
        return {
            profile,
            fieldQualified: field ? field.qualified_for_autonomy : null,
            declaredSlopePct: Number.isFinite(declaredSlopePct) ? declaredSlopePct : null,
            weatherNote: missionContext?.weather_note ?? '',
            operation: missionContext?.operation ?? null,
            autonomyRings,
            forbiddenRings,
            gnssDegradedRings,
        };
    }, [
        editor.document,
        equipment.combinations,
        equipment.selectedCombination,
        fields.childrenByField,
        fields.fields,
        fields.selected,
        missionContext,
    ]);
    const liveSimFingerprint = simulationFingerprint(
        editor.document,
        equipment.envelope,
        workingWidthM,
        oddContext,
    );
    const simStale = Boolean(simReport && simFingerprint && simFingerprint !== liveSimFingerprint);
    const durationSplit = splitDurations(editor.document);
    const simAttestation: SimAttestation | null = simReport
        ? {
              passCount: simReport.passCount,
              warnCount: simReport.warnCount,
              blockCount: simReport.blockCount,
              length_m: simReport.length_m,
              duration_s: simReport.duration_s,
              fingerprint: simFingerprint ?? liveSimFingerprint,
              coveragePct: simReport.coverage
                  ? Number(simReport.coverage.coveragePct.toFixed(1))
                  : null,
              gapPct: simReport.coverage ? Number(simReport.coverage.gapPct.toFixed(1)) : null,
              overlapPct: simReport.coverage
                  ? Number(simReport.coverage.overlapPct.toFixed(1))
                  : null,
              work_s: durationSplit.work_s,
              maneuver_s: durationSplit.maneuver_s,
              transit_s: durationSplit.transit_s,
          }
        : null;
    const publicationStamp = readPublicationStamp(editor.document);
    const publishReason = publishBlockReason({
        hasDocument: Boolean(editor.document),
        sectionCount: editor.sectionCount,
        hasBackend: publications.available,
        sim: simAttestation,
        stale: simStale,
    });
    const lifecycle = missionLifecycle({
        hasDocument: Boolean(editor.document),
        sectionCount: editor.sectionCount,
        sim: simAttestation,
        stale: simStale,
        stamp: publicationStamp,
        dirty: editor.dirty,
    });
    const nextPublishVersion =
        Math.max(
            0,
            publicationStamp?.version ?? 0,
            ...publications.items.map((item) => item.version),
        ) + 1;
    const missionOrigin = documentOrigin(editor.document);
    const sweptEnvelope = useMemo(() => {
        if (!simReport || !missionOrigin || simReport.sweptHull.length < 3) {
            return null;
        }
        const ring = hullToLngLatRing(simReport.sweptHull, missionOrigin);
        if (ring.length < 4) {
            return null;
        }
        return {
            type: 'FeatureCollection' as const,
            features: [
                {
                    type: 'Feature' as const,
                    properties: { kind: 'swept' },
                    geometry: { type: 'Polygon' as const, coordinates: [ring] },
                },
            ],
        };
    }, [missionOrigin, simReport]);
    const poseLngLat =
        poseSample && missionOrigin
            ? localToLngLat(poseSample.x, poseSample.y, missionOrigin)
            : null;
    const poseFootprint = useMemo(() => {
        if (!poseSample || !missionOrigin || !equipment.envelope) {
            return null;
        }
        const features = poseFootprintRings(equipment.envelope, poseSample)
            .map((item) => {
                const ring = hullToLngLatRing(item.ring, missionOrigin);
                if (ring.length < 4) {
                    return null;
                }
                return {
                    type: 'Feature' as const,
                    properties: { kind: item.kind },
                    geometry: { type: 'Polygon' as const, coordinates: [ring] },
                };
            })
            .filter((feature): feature is NonNullable<typeof feature> => feature !== null);
        if (features.length === 0) {
            return null;
        }
        return { type: 'FeatureCollection' as const, features };
    }, [equipment.envelope, missionOrigin, poseSample]);
    const runSimulation = useCallback(() => {
        setSimOpen(true);
        setDrawerTab('simulation');
        setOverlays((current) => ({ ...current, envelopes: true, simulation: true }));
        if (!editor.document || editor.sectionCount === 0) {
            return;
        }
        const report = simulateMission({
            document: editor.document,
            envelope: equipment.envelope,
            maxSpeedMps: equipment.preview.vehicle?.max_speed_mps ?? null,
            workingWidthM,
            odd: oddContext,
        });
        setSimReport(report);
        setSimFingerprint(
            simulationFingerprint(editor.document, equipment.envelope, workingWidthM, oddContext),
        );
    }, [
        editor.document,
        editor.sectionCount,
        equipment.envelope,
        equipment.preview.vehicle?.max_speed_mps,
        oddContext,
        workingWidthM,
    ]);

    useEffect(() => {
        if (!onSimulation) {
            autoSimKeyRef.current = null;
            return;
        }
        setSimOpen(true);
        if (!editor.document || editor.sectionCount === 0) {
            return;
        }
        const key = simulationFingerprint(
            editor.document,
            equipment.envelope,
            workingWidthM,
            oddContext,
        );
        if (autoSimKeyRef.current === key) {
            return;
        }
        autoSimKeyRef.current = key;
        runSimulation();
    }, [onSimulation, editor.document, editor.sectionCount, equipment.envelope, runSimulation]);
    const [leftWidth, setLeftWidth] = useState<number>(LAYOUT.contextDefault);
    const [rightWidth, setRightWidth] = useState<number>(LAYOUT.inspectorDefault);

    useEffect(() => {
        if (onFields) {
            return;
        }
        fields.cancelDraft();
    }, [onFields]);

    // Home and administration have nothing worth inspecting, so the inspector starts
    // folded there — and the previous choice comes back on the way out, instead of a
    // panel that stays silently closed.
    const inspectorFolded = onHome || onAdmin;
    const rightBeforeFoldRef = useRef<boolean | null>(null);
    useEffect(() => {
        if (inspectorFolded) {
            rightBeforeFoldRef.current = rightOpen;
            setRightOpen(false);
            return;
        }
        if (rightBeforeFoldRef.current !== null) {
            setRightOpen(rightBeforeFoldRef.current);
            rightBeforeFoldRef.current = null;
        }
    }, [inspectorFolded]);

    /** Farm missions live in the farm folder; the editor still loads from uploads. */
    const openFarmMission = useCallback(
        (entry: FarmEntry) => {
            const name = entry.name.toLowerCase();
            const match = editor.list.find((mission) => mission.name.toLowerCase() === name);
            if (match) {
                editor.select(match.path);
            }
            navigate('/missions');
        },
        [editor, navigate],
    );

    const mapViewReaderRef = useRef<(() => MapView | null) | null>(null);
    const readMapView = useCallback(() => mapViewReaderRef.current?.() ?? null, []);
    const onViewReader = useCallback((read: (() => MapView | null) | null) => {
        mapViewReaderRef.current = read;
    }, []);
    /** Switching farm changes every catalogue, so reload in place — no page reload. */
    const reloadAfterFarmChange = useCallback(() => {
        void fields.reload();
        void equipment.reload();
        void editor.refresh();
    }, [editor, equipment, fields]);

    // Publication, reports and integrations left the rail in L13; their routes still
    // exist so an old link or a bookmark lands on the module that absorbed them.
    useEffect(() => {
        const target = redirectFor(location.pathname);
        if (target) {
            navigate(target, { replace: true });
        }
    }, [location.pathname, navigate]);

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
            if (
                onFields &&
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === 'z' &&
                !isTypingTarget(event.target)
            ) {
                event.preventDefault();
                if (event.shiftKey) {
                    fields.redo();
                } else {
                    fields.undo();
                }
                return;
            }
            // Mac keyboards send Backspace for the key labelled "delete".
            if (
                onFields &&
                !fieldsDrawing &&
                (event.key === 'Delete' || event.key === 'Backspace') &&
                !isTypingTarget(event.target) &&
                fields.focus &&
                fields.focus.kind !== 'draft'
            ) {
                if (fields.focus.kind === 'field' && !window.confirm(t('fields.confirmDelete'))) {
                    return;
                }
                event.preventDefault();
                void fields.deleteEntity(fields.focus);
                return;
            }
            if (event.key === 'Escape' && onFields && fieldsDrawing) {
                event.preventDefault();
                fields.cancelDraft();
                return;
            }
            if (event.key === 'Enter' && onFields && fieldsDrawing) {
                if (fields.tool === 'ruler') {
                    if (fields.canPinLandmark) {
                        event.preventDefault();
                        void fields.pinLandmark();
                    }
                    return;
                }
                if (fields.draft.length >= (fieldsPointDraw ? 1 : fieldsLineDraw ? 2 : 3)) {
                    event.preventDefault();
                    void fields.finishDraft();
                }
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

    useEffect(() => {
        if (editor.zoneMode || editor.tool === 'connect_ends') {
            setRightOpen(true);
            if (breakpoint === 'review') {
                setLeftOpen(false);
            }
        }
    }, [breakpoint, editor.tool, editor.zoneMode]);

    useEffect(() => {
        if (onFields && fields.followUp) {
            setRightOpen(true);
            if (breakpoint === 'review') {
                setLeftOpen(false);
            }
        }
    }, [breakpoint, fields.followUp, onFields]);

    useEffect(() => {
        if (onFields && fields.editIntent === 'landmark') {
            setRightOpen(true);
        }
    }, [fields.editIntent, onFields]);

    const showMissionToolbar =
        onMissions && (isAdvancedUi(uiMode) ? missionTab === 'edit' : Boolean(editor.document));
    const showFieldsToolbar =
        onFields &&
        (fieldsTab === 'edit' || fields.tool !== 'select' || fields.editIntent === 'create_field');

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
                    '--simulation-height': `${LAYOUT.simulationDefault}px`,
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
                    <Chip icon={lifecycle === 'published' ? Send : GitCompare}>
                        {publicationStamp
                            ? lifecycle === 'obsolete'
                                ? `${t('pub.version', { version: publicationStamp.version })} · ${t('pub.status.obsolete')}`
                                : t('pub.version', { version: publicationStamp.version })
                            : t('app.missionDraft')}
                    </Chip>
                    {fieldLabel ? <Chip icon={LandPlot}>{fieldLabel}</Chip> : null}
                    {comboLabel ? <Chip icon={Machine}>{comboLabel}</Chip> : null}
                    <Chip
                        icon={
                            cropPack === 'vineyard'
                                ? Grape
                                : cropPack === 'market_garden'
                                  ? Sprout
                                  : Wheat
                        }
                    >
                        {t(`pack.${cropPack}`)}
                    </Chip>
                    {missionContext?.operation ? (
                        <Chip icon={RouteIcon}>
                            {t(`assist.operation.${missionContext.operation}`)}
                        </Chip>
                    ) : null}
                    {simReport ? (
                        <Chip
                            tone={
                                simStale
                                    ? 'warning'
                                    : simReport.blockCount > 0
                                      ? 'danger'
                                      : simReport.warnCount > 0
                                        ? 'warning'
                                        : 'valid'
                            }
                            icon={simReport.blockCount > 0 ? TriangleAlert : CircleCheck}
                        >
                            {t('app.blockers', {
                                blocks: simReport.blockCount,
                                warns: simReport.warnCount,
                            })}
                        </Chip>
                    ) : null}
                    <Chip tone={statusChip.tone} icon={statusChip.icon}>
                        {t(statusChip.labelKey)}
                    </Chip>
                </nav>
                <div className="studio-appbar-actions">
                    <Button
                        variant="secondary"
                        disabled={!editor.document || geofenceRing(editor.document).length < 3}
                        title={
                            !editor.document || geofenceRing(editor.document).length < 3
                                ? t('compare.needField')
                                : t('app.compareHint')
                        }
                        onClick={() => setCompareOpen(true)}
                    >
                        {t('app.compare')}
                    </Button>
                    <Button
                        variant="secondary"
                        disabled={!editor.document || editor.sectionCount === 0}
                        title={
                            !editor.document || editor.sectionCount === 0
                                ? t('sim.needMission')
                                : t('app.simulateHint')
                        }
                        onClick={runSimulation}
                    >
                        {t('app.simulate')}
                    </Button>
                    <Button
                        variant="secondary"
                        disabled={!editor.document || editor.saveState === 'saving'}
                        title={t('app.saveHint')}
                        onClick={() => {
                            void editor.saveNow();
                        }}
                    >
                        {t('app.save')}
                    </Button>
                    <Button
                        variant="primary"
                        disabled={publishReason !== null}
                        title={
                            publishReason ? t(`pub.block.${publishReason}`) : t('app.publishHint')
                        }
                        onClick={() => setPublishOpen(true)}
                    >
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
                                        onClick={() => {
                                            setLeftOpen(true);
                                            if (module.id === 'simulation') {
                                                runSimulation();
                                            }
                                        }}
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
                onHome ? (
                    <HomeDashboard
                        t={t}
                        language={language}
                        farm={farm}
                        combinationCount={equipment.combinations.length}
                        mappedFields={fields.fields}
                        onOpenMission={openFarmMission}
                        overlay={overlayLeft}
                    />
                ) : onAdmin ? (
                    <AdminPanel
                        t={t}
                        farm={farm}
                        readMapView={readMapView}
                        onFarmChanged={reloadAfterFarmChange}
                        onLanguage={setLanguage}
                        overlay={overlayLeft}
                    />
                ) : onFields ? (
                    <FieldsPanel
                        t={t}
                        catalogue={fields}
                        overlay={overlayLeft}
                        uiMode={uiMode}
                        tab={fieldsTab}
                        onTabChange={setFieldsTab}
                        onImportFile={(file) => fileImport.start(file, 'field-create')}
                        onImportFileEdit={(file) => fileImport.start(file, 'field-edit')}
                        importError={imported.error ? t(imported.error) : null}
                        onDrawStarted={() => {
                            if (breakpoint === 'review') {
                                setLeftOpen(false);
                            }
                        }}
                    />
                ) : onEquipment ? (
                    <EquipmentContextPanel t={t} catalogue={equipment} overlay={overlayLeft} />
                ) : onSimulation ? (
                    <SimulationPanel
                        t={t}
                        overlay={overlayLeft}
                        uiMode={uiMode}
                        document={editor.document}
                        activePath={editor.activePath}
                        combinations={equipment.combinations}
                        selectedCombinationId={equipment.selectedCombinationId}
                        onSelectCombination={equipment.selectCombination}
                        onSaveCombination={equipment.saveCombination}
                        onLoadFarmMission={editor.adopt}
                        report={simReport}
                        publications={publications.items}
                        onLocate={locateSample}
                    />
                ) : onMissions ? (
                    <MissionPanel
                        t={t}
                        overlay={overlayLeft}
                        uiMode={uiMode}
                        onImportFile={(file) => fileImport.start(file, 'mission')}
                        importError={imported.error ? t(imported.error) : null}
                        onTabChange={(tab) => {
                            setMissionTab(tab);
                            if (tab !== 'edit' && editor.tool !== 'none') {
                                editor.cancelTool();
                            }
                        }}
                        fieldGeofenceInsetCm={
                            farm.farm?.field_geofence_inset_cm ?? DEFAULT_FIELD_GEOFENCE_INSET_CM
                        }
                        assistant={assistant}
                        fields={fields.fields}
                        selectedField={fields.selected}
                        onSelectField={(id, options) => fields.select(id, options)}
                        fieldsAvailable={fields.available}
                        combinations={equipment.combinations}
                        implements={equipment.implements}
                        vehicles={equipment.vehicles}
                        missions={editor.list}
                        activePath={editor.activePath}
                        hasWorkingDocument={Boolean(editor.document)}
                        onSelectMission={editor.select}
                        onLoadFarmMission={editor.adopt}
                        onStartNewDocument={editor.startNewDocument}
                        publications={publications}
                        onPublish={() => setPublishOpen(true)}
                        tree={missionTree}
                        selectedIndices={editor.selectedIndices}
                        onSelectSection={(index, additive) =>
                            editor.selectIndices([index], additive)
                        }
                        hiddenIndices={editor.hiddenIndices}
                        lockedIndices={editor.lockedIndices}
                        onToggleHidden={editor.toggleHidden}
                        onToggleLocked={editor.toggleLocked}
                        selectedGeofenceId={editor.selectedGeofenceId}
                        hiddenGeofenceIds={editor.hiddenGeofenceIds}
                        lockedGeofenceIds={editor.lockedGeofenceIds}
                        onSelectGeofence={editor.selectGeofence}
                        onToggleGeofenceHidden={editor.toggleGeofenceHidden}
                        onToggleGeofenceLocked={editor.toggleGeofenceLocked}
                        onAddGeofenceExclusion={editor.startGeofenceExclusion}
                        onDeleteSection={editor.deleteSection}
                        onDeleteGeofenceExclusion={editor.deleteGeofenceExclusion}
                        document={editor.document}
                        envelope={equipment.envelope}
                        equipmentSnapshot={
                            equipment.srbcEquipment
                                ? (equipment.srbcEquipment as unknown as Record<string, unknown>)
                                : null
                        }
                        odd={oddContext.profile}
                        vehicleWidthM={equipment.preview.vehicle?.width_m ?? null}
                        geofenceMarginM={keepoutM}
                        canGenerateBeds={Boolean(fields.selected?.guidance_lines[0])}
                        onGenerate18Beds={() => {
                            const axis = fields.selected?.guidance_lines[0];
                            if (!axis) {
                                navigate('/parcellaire');
                                return;
                            }
                            void fields.generateRowSet({
                                axisLineId: axis.id,
                                kind: 'beds',
                                widthM: DEFAULT_BED_WIDTH_M,
                                pathM: DEFAULT_BED_PATH_M,
                                count: DEFAULT_BED_COUNT,
                            });
                        }}
                        onApplyDocument={(document) => {
                            editor.applyGeneratedDocument(document, {
                                key: 'pack.applied',
                                params: {},
                            });
                        }}
                    />
                ) : (
                    <ContextPanel
                        module={current}
                        t={t}
                        missions={editor.list}
                        activePath={editor.activePath}
                        hasWorkingDocument={Boolean(editor.document)}
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
                        label={t('app.toggleDrawer')}
                        aria-pressed={simOpen}
                        className={
                            simOpen ? 'studio-drawer-toggle is-open' : 'studio-drawer-toggle'
                        }
                        onClick={() => {
                            setSimOpen((open) => !open);
                        }}
                    >
                        <ChevronUp size={ICON_SIZE.button} strokeWidth={STROKE} />
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
                                onFields || !editor.document
                                    ? null
                                    : `${editor.activePath ?? 'draft'}#${editor.missionFitNonce}`
                            }
                            tool={onFields ? fieldsCanvasTool(fields.tool) : editor.tool}
                            extendActive={onFields ? false : editor.extendDirection !== null}
                            draft={onFields ? fields.previewDraft : editor.draft}
                            draftHandleCount={
                                onFields && fields.tool === 'ruler'
                                    ? fields.draft.length
                                    : undefined
                            }
                            selectedIndices={
                                onFields || editor.zoneMode === 'portions'
                                    ? []
                                    : editor.selectedIndices
                            }
                            selectedGeofenceId={onFields ? null : editor.selectedGeofenceId}
                            hiddenGeofenceIds={onFields ? [] : editor.hiddenGeofenceIds}
                            draftCaption={onFields ? fields.landmarkCaption : editor.rulerDistance}
                            catalogueGeoJSON={catalogueGeoJSON}
                            catalogueFitKey={
                                onFields && fields.cameraTargetId && fields.cameraNonce > 0
                                    ? `${fields.cameraTargetId}#${fields.cameraNonce}`
                                    : null
                            }
                            coveragePreview={
                                onFields ? null : (assistant.preview ?? editor.coveragePreview)
                            }
                            onMapClick={
                                onFields
                                    ? fields.handleMapClick
                                    : editor.parcelDialogOpen
                                      ? (lngLat) => {
                                            const hit = hitCatalogue(
                                                fields.fields,
                                                fields.childrenByField,
                                                lngLat[0],
                                                lngLat[1],
                                            );
                                            if (hit?.type !== 'guidance') {
                                                return;
                                            }
                                            editor.setCoverageGuidanceLineId(hit.id);
                                            editor.setCoverageStrategy('guidance');
                                            fields.select(hit.fieldId, {
                                                focus: {
                                                    kind: 'guidance',
                                                    fieldId: hit.fieldId,
                                                    id: hit.id,
                                                },
                                            });
                                        }
                                      : editor.tool === 'none'
                                        ? undefined
                                        : editor.handleMapClick
                            }
                            onMapHover={onFields ? fields.handleMapHover : undefined}
                            onMapDblClick={onFields ? fields.handleMapDblClick : undefined}
                            onInsertVertex={
                                onFields
                                    ? fieldsDrawing && fields.tool !== 'ruler'
                                        ? fields.insertVertex
                                        : undefined
                                    : editor.tool === 'none'
                                      ? undefined
                                      : editor.insertVertex
                            }
                            onMoveVertex={
                                onFields
                                    ? fieldsDrawing &&
                                      (fields.tool !== 'ruler' || fields.landmarkKind === 'circle')
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
                            sweptEnvelope={onFields ? null : sweptEnvelope}
                            poseFootprint={onFields ? null : poseFootprint}
                            poseLngLat={onFields ? null : poseLngLat}
                            poseFlyKey={onFields ? 0 : poseFlyKey}
                            rowLabelMode={
                                cropPack === 'vineyard'
                                    ? 'large'
                                    : overlays.labels !== false
                                      ? 'normal'
                                      : 'off'
                            }
                            startView={farm.farm?.start_view ?? null}
                            onViewReader={onViewReader}
                            speedStops={resolveSpeedStops({
                                lowKmh: farm.farm?.speed_color_low_kmh,
                                midKmh: farm.farm?.speed_color_mid_kmh,
                                highKmh: farm.farm?.speed_color_high_kmh,
                            })}
                            overlayPolygon={
                                onFields && fields.circlePreview.length >= 3
                                    ? fields.circlePreview
                                    : onFields && fields.lassoOverlay.length >= 3
                                      ? fields.lassoOverlay
                                      : editor.zoneMode === 'choose' ||
                                          editor.zoneMode === 'portions'
                                        ? editor.zoneRing
                                        : null
                            }
                            selectionHalo={editor.zoneMode === 'portions' ? 'off' : 'yellow'}
                            endpointMarkers={
                                editor.tool === 'connect_ends'
                                    ? listRowEndpoints(editor.document).map((item) => ({
                                          lngLat: [item.latlng.lng, item.latlng.lat] as [
                                              number,
                                              number,
                                          ],
                                          selected:
                                              (editor.connectFirst?.sectionIndex ===
                                                  item.hit.sectionIndex &&
                                                  editor.connectFirst?.end === item.hit.end) ||
                                              (editor.connectSecond?.sectionIndex ===
                                                  item.hit.sectionIndex &&
                                                  editor.connectSecond?.end === item.hit.end),
                                      }))
                                    : null
                            }
                            importedLayers={imported.layers}
                            importedFitKey={imported.fitKey}
                        />
                        {showFieldsToolbar ? (
                            <FieldsEditToolbar
                                t={t}
                                tool={fields.tool}
                                intent={fields.editIntent}
                                draftCount={fields.draft.length}
                                editingGeometry={fields.editingGeometry}
                                canUndo={fields.canUndo}
                                canRedo={fields.canRedo}
                                undoLabel={fields.undoLabelKey ? t(fields.undoLabelKey) : null}
                                onSelect={fields.startSelectEntity}
                                onLasso={() => {
                                    fields.startLasso();
                                    setRightOpen(true);
                                }}
                                onPolyline={() => {
                                    fields.startPolyline();
                                    setRightOpen(true);
                                }}
                                onGeofence={() => {
                                    if (fields.geofenceZoneId) {
                                        fields.selectExistingGeofence();
                                        setFieldsTab('edit');
                                        setRightOpen(true);
                                        return;
                                    }
                                    setFieldsGeofencePrompt(true);
                                }}
                                onSurface={() => {
                                    fields.startSurface();
                                    setRightOpen(true);
                                }}
                                onRuler={() => {
                                    fields.startRuler();
                                    setRightOpen(true);
                                }}
                                onFinish={() => void fields.finishDraft()}
                                onUndo={fields.undo}
                                onRedo={fields.redo}
                            />
                        ) : showMissionToolbar ? (
                            <EditToolbar
                                t={t}
                                uiMode={uiMode}
                                tool={editor.tool}
                                draftCount={editor.draft.length}
                                canUndo={editor.canUndo}
                                canRedo={editor.canRedo}
                                onSelectZone={editor.startSelectZone}
                                onSelectPolygon={editor.startSelectPolygon}
                                onDrawLine={editor.startDrawLine}
                                onDrawPolygon={editor.startDrawPolygon}
                                onFillParcel={() => {
                                    const fieldId = missionContext?.field_id;
                                    if (fieldId) {
                                        fields.select(fieldId);
                                    }
                                    editor.startFillParcel();
                                }}
                                onConnectEnds={editor.startConnectEnds}
                                onRuler={editor.startRuler}
                                onFinish={editor.finishCurrent}
                                onUndo={editor.undo}
                                onRedo={editor.redo}
                            />
                        ) : null}
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
                                                          : editor.tool === 'connect_ends'
                                                            ? 'tool.connectEndsHint'
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
                            importedLayers={imported.layers}
                            onImportedVisible={imported.setVisible}
                            onImportedRemove={imported.remove}
                        />
                        <ImportDialog t={t} state={fileImport} />
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
                            guidanceLines={editor.coverageGuidanceLines.map((line, index) => ({
                                id: line.id,
                                label:
                                    line.name?.trim() ||
                                    t('tool.coverageGuidanceLine.unnamed', { n: index + 1 }),
                            }))}
                            guidanceLineId={editor.coverageGuidanceLineId}
                            onSpacing={editor.setRowSpacing}
                            onStrategy={editor.setCoverageStrategy}
                            onGuidanceLine={(id) => {
                                editor.setCoverageGuidanceLineId(id);
                                editor.setCoverageStrategy('guidance');
                                const fieldId = fields.selectedId ?? missionContext?.field_id;
                                if (fieldId) {
                                    fields.select(fieldId, {
                                        focus: { kind: 'guidance', fieldId, id },
                                    });
                                }
                            }}
                            onHeadlandWidth={editor.setHeadlandWidth}
                            onConnectTurns={editor.setConnectAfterFill}
                            onOpenChange={editor.setParcelDialogOpen}
                            onConfirm={editor.finishFillParcel}
                        />
                        <FillGeofencePrompt
                            t={t}
                            open={editor.fillGeofencePrompt}
                            onOpenChange={editor.setFillGeofencePrompt}
                            onYes={editor.acceptFillGeofence}
                            onNo={editor.declineFillGeofence}
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
                        <ConnectFreeDialog
                            t={t}
                            open={editor.freeStyleOpen}
                            onOpenChange={editor.setFreeStyleOpen}
                            onConfirm={editor.finishConnectEnds}
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
                        actions={
                            <FieldsActionPanel
                                t={t}
                                catalogue={fields}
                                form={fieldsFollowUpForm}
                                lassoTab={fieldsLassoTab}
                                onLassoTab={setFieldsLassoTab}
                            />
                        }
                        onOpenMission={(path) => {
                            if (path) {
                                const farmFile =
                                    path.startsWith('mission_order/') ||
                                    path.startsWith('work_performed/');
                                if (farmFile) {
                                    void fetchFarmMission(path)
                                        .then((document) => editor.adopt(path, document))
                                        .then(() => navigate('/missions'));
                                    return;
                                }
                                editor.select(path);
                            }
                            navigate('/missions');
                        }}
                    />
                ) : onEquipment ? (
                    <EquipmentInspector
                        t={t}
                        catalogue={equipment}
                        overlay={overlayRight}
                        uiMode={uiMode}
                    />
                ) : (
                    <MissionToolsPanel
                        t={t}
                        overlay={overlayRight}
                        editor={editor}
                        selectionLocked={selectionLocked}
                        entityTools={
                            <MissionInspectorBody
                                t={t}
                                editor={editor}
                                uiMode={uiMode}
                                selectionLocked={selectionLocked}
                                selectedSpeedMps={selectedSpeedMps}
                                comboLabel={comboLabel}
                                missionContext={missionContext}
                            />
                        }
                    />
                )
            ) : null}

            {simOpen && breakpoint !== 'review' ? (
                <section
                    className="studio-simulation studio-drawer"
                    aria-label={t('app.toggleDrawer')}
                >
                    <Tabs
                        defaultValue="inspector"
                        value={drawerTab}
                        onValueChange={setDrawerTab}
                        items={[
                            {
                                value: 'inspector',
                                label: t('inspector.title'),
                                content: (
                                    <>
                                        <p className="studio-muted studio-inspector-block">
                                            {editor.noticeKey
                                                ? t(editor.noticeKey, editor.noticeParams)
                                                : editor.selectedIndices.length > 0
                                                  ? t('inspector.selected', {
                                                        count: editor.selectedIndices.length,
                                                    })
                                                  : editor.document
                                                    ? t('inspector.points', {
                                                          sections: editor.sectionCount,
                                                          points: editor.pointCount,
                                                      })
                                                    : t('map.empty')}
                                        </p>
                                        <MissionInspectorBody
                                            t={t}
                                            editor={editor}
                                            uiMode={uiMode}
                                            selectionLocked={selectionLocked}
                                            selectedSpeedMps={selectedSpeedMps}
                                            comboLabel={comboLabel}
                                            missionContext={missionContext}
                                        />
                                    </>
                                ),
                            },
                            {
                                value: 'simulation',
                                label: t('simulation.title'),
                                content: (
                                    <SimulationDrawer
                                        t={t}
                                        embedded
                                        report={simReport}
                                        stale={simStale}
                                        seekIndex={simSeekIndex}
                                        onRun={runSimulation}
                                        onCursor={onSimCursor}
                                        onLocate={locateSample}
                                        onOpenResults={() =>
                                            navigate({ pathname: '/simulation', hash: 'results' })
                                        }
                                    />
                                ),
                            },
                        ]}
                    />
                </section>
            ) : null}

            <CompareDialog
                open={compareOpen}
                document={editor.document}
                envelope={equipment.envelope}
                workingWidthM={workingWidthM}
                vehicleWidthM={equipment.preview.vehicle?.width_m ?? null}
                geofenceMarginM={keepoutM}
                currentReport={simReport}
                odd={oddContext}
                onOpenChange={setCompareOpen}
                onApply={(sections) => {
                    if (!editor.document) {
                        return;
                    }
                    editor.applyGeneratedDocument(
                        { ...editor.document, points: sections },
                        { key: 'compare.applied', params: {} },
                    );
                    setCompareOpen(false);
                }}
                t={t}
            />

            <Dialog
                open={fieldsGeofencePrompt}
                onOpenChange={setFieldsGeofencePrompt}
                title={t('fields.edit.geofence.promptTitle')}
            >
                <p className="studio-muted">{t('fields.edit.geofence.prompt')}</p>
                <div className="studio-publish-actions">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                            setFieldsGeofencePrompt(false);
                            fields.startGeofenceDraw();
                            setFieldsTab('edit');
                            setRightOpen(true);
                        }}
                    >
                        {t('fields.edit.geofence.draw')}
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        onClick={() => {
                            setFieldsGeofencePrompt(false);
                            void fields.applyGeofenceFromBoundary(
                                farm.farm?.field_geofence_inset_cm ??
                                    DEFAULT_FIELD_GEOFENCE_INSET_CM,
                            );
                            setFieldsTab('edit');
                            setRightOpen(true);
                        }}
                    >
                        {t('fields.edit.geofence.match')}
                    </Button>
                </div>
            </Dialog>
            <PublishDialog
                open={publishOpen}
                document={editor.document}
                sourcePath={editor.activePath}
                nextVersion={nextPublishVersion}
                simulation={simAttestation}
                onOpenChange={setPublishOpen}
                t={t}
                onConfirm={async ({ approver, expires_at }) => {
                    if (!editor.document || !simAttestation) {
                        return;
                    }
                    const sourcePath =
                        editor.activePath ??
                        suggestedMissionPath(editor.document as unknown as Record<string, unknown>);
                    if (!editor.activePath) {
                        await editor.saveNow();
                    }
                    const created = await publications.publish({
                        source_path: sourcePath,
                        document: editor.document,
                        simulation: simAttestation,
                        stale: simStale,
                        approver,
                        expires_at,
                        vehicle_id:
                            typeof editor.document.vehicle_id === 'string'
                                ? editor.document.vehicle_id
                                : null,
                        field_id: missionContext?.field_id ?? null,
                        combination_id: missionContext?.combination_id ?? null,
                    });
                    const stamp = {
                        id: created.id,
                        version: created.version,
                        checksum: created.checksum,
                        published_at: created.published_at,
                        expires_at: created.expires_at,
                    };
                    const metadata =
                        editor.document.metadata !== null &&
                        typeof editor.document.metadata === 'object'
                            ? { ...(editor.document.metadata as Record<string, unknown>) }
                            : {};
                    editor.applyGeneratedDocument(
                        {
                            ...editor.document,
                            metadata: { ...metadata, srbc_publication: stamp },
                        },
                        {
                            key: 'pub.applied',
                            params: { version: created.version },
                        },
                    );
                    setPublishOpen(false);
                }}
            />

            <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} t={t} />
        </div>
    );
}
