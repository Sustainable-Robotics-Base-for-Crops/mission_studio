import { useCallback, useEffect, useRef, useState } from 'react';

import {
    getSectionTypeString,
    getTotalPointsCount,
    MAX_POINTS_PER_TRAJECTORY,
    parseAgriDocument,
    reorderSection,
    type AgriDocument,
} from '../domain/agri';
import {
    appendConnectedCoverage,
    appendDrawnLine,
    applyDrawnSpeed,
    applyDrawnWorkingZone,
    deleteDrawnPointsInPolygon,
    documentOrigin,
    ensureWorkingDocument,
    fillDrawnParcel,
    setDrawnGeofence,
    type DrawLineFailure,
    type FillParcelFailure,
} from '../domain/draft';
import { DEFAULT_ROW_SPACING_M } from '../domain/coverage';
import {
    connectRowLinesPreservingOthers,
    connectSelectedRowLines,
    DEFAULT_CONNECT_TURNS,
    type ConnectTurnsFailure,
    type ConnectTurnsParams,
} from '../domain/turns';
import {
    formatDistanceMeters,
    getDistanceMeters,
    latLngToLocal,
    localDelta,
    type LatLng,
} from '../domain/geometry';
import {
    duplicateSectionsInDocument,
    extendSectionSmart,
    moveSections,
    offsetSections,
    rotateSections,
} from '../domain/section';
import {
    deleteSelectedSections,
    pickRowEndpoint,
    pickSectionByProximity,
    reverseSelectedSections,
    selectSectionsIntersectingPolygon,
    toggleSelectedIndex,
    type RowEndpointHit,
} from '../domain/selection';
import {
    connectTwoRowEnds,
    connectTwoRowEndsFree,
    type EndConnectionKind,
    type FreeLinkStyle,
} from '../domain/connect-ends';
import { applySpeedToAllPoints, getCurrentTrajectorySpeed } from '../domain/speed';
import {
    appendGeofenceExclusion,
    geofenceRing,
    localRingToLatLng,
    readGeofenceExterior,
    pickGeofenceByProximity,
    removeGeofenceExclusion,
    setGeofenceRing,
    type GeofenceId,
} from '../domain/geofence';
import { insertDraftVertex, moveDraftVertex } from './draft-hit';
import {
    planCoverage,
    type CoveragePreview,
    type CoverageStrategy,
    type CoverageVariant,
} from '../coverage/api';
import type { DuplicateSide, ExtendDirection } from './SectionEditPanel';
import { CommandStack, createAutosave } from '../store/commands';
import { useStudioMissions } from './useStudioMissions';
import { remapIndexList, remapIndexListAfterDelete, indexListIntersects } from '../missions/tree';
import { newFarmMissionPath, saveMissionDocument } from './missions-api';
import type { Kinematics } from '../domain/equipment';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'blocked';

export type MissionEditorOptions = {
    workingWidthM?: number | null;
    vehicleWidthM?: number | null;
    geofenceMarginM?: number | null;
    kinematics?: Kinematics | null;
};

function snapshotDocument(document: AgriDocument | null): string {
    return JSON.stringify(document);
}

export type EditTool =
    | 'none'
    | 'draw_line'
    | 'draw_polygon'
    | 'edit_geofence'
    | 'draw_geofence_exclusion'
    | 'draw_parcel'
    | 'edit_working_zone'
    | 'delete_points_zone'
    | 'select_zone'
    | 'select_sections_polygon'
    | 'connect_ends'
    | 'ruler';

export type ZonePanelMode = 'choose' | 'entities' | 'portions';

export function isPolygonTool(tool: EditTool): boolean {
    return (
        tool === 'draw_polygon' ||
        tool === 'edit_geofence' ||
        tool === 'draw_geofence_exclusion' ||
        tool === 'draw_parcel' ||
        tool === 'edit_working_zone' ||
        tool === 'delete_points_zone' ||
        tool === 'select_sections_polygon'
    );
}

export function engineDrawTool(tool: EditTool): 'none' | 'draw_line' | 'draw_polygon' {
    if (tool === 'none' || tool === 'select_zone' || tool === 'connect_ends') {
        return 'none';
    }
    return tool === 'draw_line' || tool === 'ruler' ? 'draw_line' : 'draw_polygon';
}

function toolBlocksAutosave(tool: EditTool): boolean {
    return tool !== 'none' && tool !== 'select_zone';
}

const DRAWING_HINT: Record<Exclude<EditTool, 'none'>, string> = {
    draw_line: 'tool.drawLineHint',
    draw_polygon: 'tool.drawPolygonHint',
    edit_geofence: 'tool.editGeofenceHint',
    draw_geofence_exclusion: 'tool.drawGeofenceExclusionHint',
    draw_parcel: 'tool.fillParcelHint',
    edit_working_zone: 'tool.workingZoneHint',
    delete_points_zone: 'tool.deleteZoneHint',
    select_zone: 'tool.selectZoneHint',
    select_sections_polygon: 'tool.selectPolygonHint',
    connect_ends: 'tool.connectEndsHint',
    ruler: 'tool.rulerHint',
};

const FILL_FAILURE_KEYS: Record<FillParcelFailure, string> = {
    too_few_points: 'tool.tooFewPolygonPoints',
    no_origin: 'tool.needMission',
    invalid_spacing: 'tool.invalidSpacing',
    empty_fill: 'tool.fillParcelEmpty',
    section_limit: 'tool.sectionLimit',
    trajectory_limit: 'tool.trajectoryLimit',
};

const TURNS_FAILURE_KEYS: Record<ConnectTurnsFailure, string> = {
    too_few_rows: 'tool.connectTurnsNeedRows',
    invalid_params: 'tool.invalidSpacing',
    section_limit: 'tool.sectionLimit',
    trajectory_limit: 'tool.trajectoryLimit',
};

const FAILURE_KEYS: Record<DrawLineFailure, string> = {
    too_few_points: 'tool.tooFewPoints',
    section_limit: 'tool.sectionLimit',
    trajectory_limit: 'tool.trajectoryLimit',
};

export function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function useMissionEditor(options: MissionEditorOptions = {}) {
    const workingWidthM = options.workingWidthM;
    const vehicleWidthM = options.vehicleWidthM;
    const geofenceMarginM = options.geofenceMarginM;
    const kinematics = options.kinematics;
    const missions = useStudioMissions();
    const stackRef = useRef(new CommandStack<AgriDocument | null>());
    const [working, setWorking] = useState<AgriDocument | null>(null);
    const [missionFitNonce, setMissionFitNonce] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [tool, setTool] = useState<EditTool>('none');
    const [draft, setDraft] = useState<LatLng[]>([]);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);
    /** Off while another module owns the keyboard, e.g. the parcellaire page. */
    const interactiveRef = useRef(true);
    const setInteractive = useCallback((value: boolean) => {
        interactiveRef.current = value;
    }, []);
    const [noticeKey, setNoticeKey] = useState<string | null>(null);
    const [noticeParams, setNoticeParams] = useState<Record<string, string | number>>({});
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [parcelDialogOpen, setParcelDialogOpen] = useState(false);
    const [rowSpacing, setRowSpacing] = useState(String(DEFAULT_ROW_SPACING_M));
    const [coverageStrategy, setCoverageStrategy] = useState<CoverageStrategy>('boustrophedon');
    const [headlandWidth, setHeadlandWidth] = useState('0');
    const [connectAfterFill, setConnectAfterFill] = useState(true);
    const [coverageVariants, setCoverageVariants] = useState<CoverageVariant[]>([]);
    const [coveragePreview, setCoveragePreview] = useState<CoveragePreview | null>(null);
    const [coverageVariantsLoading, setCoverageVariantsLoading] = useState(false);
    const coveragePlanRef = useRef<Awaited<ReturnType<typeof planCoverage>> | null>(null);
    const coverageStrategyRef = useRef(coverageStrategy);
    const [turnsDialogOpen, setTurnsDialogOpen] = useState(false);
    const [turnsParams, setTurnsParams] = useState<ConnectTurnsParams>(DEFAULT_CONNECT_TURNS);
    const [speedDialogOpen, setSpeedDialogOpen] = useState(false);
    const [speedValue, setSpeedValue] = useState('0.5');
    const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
    const [hiddenIndices, setHiddenIndices] = useState<number[]>([]);
    const [lockedIndices, setLockedIndices] = useState<number[]>([]);
    const [selectedGeofenceId, setSelectedGeofenceId] = useState<GeofenceId | null>(null);
    const [hiddenGeofenceIds, setHiddenGeofenceIds] = useState<GeofenceId[]>([]);
    const [lockedGeofenceIds, setLockedGeofenceIds] = useState<GeofenceId[]>([]);
    const [moveStep, setMoveStep] = useState('0.5');
    const [rotationStep, setRotationStep] = useState('5');
    const [duplicateCount, setDuplicateCount] = useState('1');
    const [duplicateDistance, setDuplicateDistance] = useState('2.5');
    const [duplicateSide, setDuplicateSide] = useState<DuplicateSide>('left');
    const [extendDirection, setExtendDirection] = useState<ExtendDirection | null>(null);
    const [offsetDialogOpen, setOffsetDialogOpen] = useState(false);
    const [offsetDistance, setOffsetDistance] = useState('0.5');
    const [offsetSide, setOffsetSide] = useState<DuplicateSide>('left');
    const [zoneRing, setZoneRing] = useState<LatLng[]>([]);
    const [zoneMode, setZoneMode] = useState<ZonePanelMode | null>(null);
    const [zoneWorkingOn, setZoneWorkingOn] = useState(true);
    const [zoneSpeedDraft, setZoneSpeedDraft] = useState('0.5');
    const [fillGeofencePrompt, setFillGeofencePrompt] = useState(false);
    const [connectFirst, setConnectFirst] = useState<RowEndpointHit | null>(null);
    const [connectSecond, setConnectSecond] = useState<RowEndpointHit | null>(null);
    const [connectKind, setConnectKind] = useState<EndConnectionKind | null>(null);
    const [freeStyleOpen, setFreeStyleOpen] = useState(false);

    const workingRef = useRef(working);
    const draftRef = useRef(draft);
    const toolRef = useRef(tool);
    const dirtyRef = useRef(dirty);
    const selectedRef = useRef(selectedIndices);
    const lockedRef = useRef(lockedIndices);
    const lockedGeofenceRef = useRef(lockedGeofenceIds);
    const geofenceEditRef = useRef<GeofenceId | null>(null);
    const selectGeofenceRef = useRef<((id: GeofenceId) => void) | null>(null);
    const extendDirectionRef = useRef(extendDirection);
    const selectionDragRef = useRef<{
        start: LatLng;
        baseline: AgriDocument;
        indices: number[];
    } | null>(null);
    const appliedPathRef = useRef<string | null>(null);
    const activePathRef = useRef<string | null>(null);
    const lastSavedRef = useRef<string>(snapshotDocument(null));
    const savingRef = useRef(false);
    workingRef.current = working;
    draftRef.current = draft;
    toolRef.current = tool;
    dirtyRef.current = dirty;
    selectedRef.current = selectedIndices;
    lockedRef.current = lockedIndices;
    lockedGeofenceRef.current = lockedGeofenceIds;
    extendDirectionRef.current = extendDirection;
    coverageStrategyRef.current = coverageStrategy;
    activePathRef.current = missions.activePath;
    const parcelDialogOpenRef = useRef(false);
    parcelDialogOpenRef.current = parcelDialogOpen;
    const turnsDialogOpenRef = useRef(false);
    turnsDialogOpenRef.current = turnsDialogOpen;
    const speedDialogOpenRef = useRef(false);
    speedDialogOpenRef.current = speedDialogOpen;
    const offsetDialogOpenRef = useRef(false);
    offsetDialogOpenRef.current = offsetDialogOpen;

    const syncButtons = useCallback(() => {
        setCanUndo(stackRef.current.canUndo);
        setCanRedo(stackRef.current.canRedo);
    }, []);

    const rejectIfLocked = useCallback((indices: number[] = selectedRef.current) => {
        if (!indexListIntersects(indices, lockedRef.current)) {
            return false;
        }
        setNoticeKey('tree.lockedBlocked');
        return true;
    }, []);

    useEffect(() => {
        const pathChanged = missions.activePath !== appliedPathRef.current;
        if (!pathChanged && dirtyRef.current) {
            return;
        }
        const parsed = parseAgriDocument(missions.document);
        const incoming = snapshotDocument(parsed);
        if (
            incoming === lastSavedRef.current &&
            incoming === snapshotDocument(workingRef.current)
        ) {
            appliedPathRef.current = missions.activePath;
            return;
        }
        appliedPathRef.current = missions.activePath;
        setWorking(parsed);
        setMissionFitNonce((value) => value + 1);
        lastSavedRef.current = incoming;
        setDirty(false);
        setSaveState('idle');
        setTool('none');
        setDraft([]);
        setSelectedIndices([]);
        setHiddenIndices([]);
        setLockedIndices([]);
        setSelectedGeofenceId(null);
        setHiddenGeofenceIds([]);
        setLockedGeofenceIds([]);
        geofenceEditRef.current = null;
        setExtendDirection(null);
        setNoticeKey(null);
        setParcelDialogOpen(false);
        setTurnsDialogOpen(false);
        setSpeedDialogOpen(false);
        setOffsetDialogOpen(false);
        stackRef.current.clear();
        setCanUndo(false);
        setCanRedo(false);
    }, [missions.activePath, missions.document]);

    useEffect(() => {
        setConnectAfterFill(kinematics !== 'ackermann');
    }, [kinematics]);

    useEffect(() => {
        if (!parcelDialogOpen) {
            setCoveragePreview(null);
            setCoverageVariants([]);
            setCoverageVariantsLoading(false);
            coveragePlanRef.current = null;
            return;
        }
        const spacing = Number(rowSpacing);
        const headland = Number(headlandWidth);
        const first = draftRef.current[0];
        const prepared = first ? ensureWorkingDocument(workingRef.current, first) : null;
        const origin = prepared ? documentOrigin(prepared) : null;
        if (!(spacing > 0) || !first || !origin || draftRef.current.length < 3) {
            return;
        }
        const headlandM = Number.isFinite(headland) && headland > 0 ? headland : 0;
        let cancelled = false;
        const timer = window.setTimeout(() => {
            setCoverageVariantsLoading(true);
            void planCoverage({
                ring: draftRef.current,
                origin: { lat: origin.lat, lon: origin.lon },
                working_width_m: spacing,
                vehicle_width_m: vehicleWidthM ?? undefined,
                strategy: coverageStrategyRef.current,
                variants: true,
                headland_width_m: headlandM,
                geofence_margin_m:
                    geofenceMarginM && geofenceMarginM > 0 ? geofenceMarginM : undefined,
            })
                .then((plan) => {
                    if (cancelled) {
                        return;
                    }
                    coveragePlanRef.current = plan;
                    setCoverageVariants(plan.variants);
                    const chosen =
                        plan.variants.find(
                            (item) => item.strategy === coverageStrategyRef.current,
                        ) ?? plan;
                    setCoveragePreview({
                        origin: plan.origin,
                        work: 'sections' in chosen ? chosen.sections : plan.sections,
                        headlands: plan.headland_sections,
                    });
                })
                .catch(() => {
                    if (cancelled) {
                        return;
                    }
                    coveragePlanRef.current = null;
                    setCoverageVariants([]);
                    setCoveragePreview(null);
                })
                .finally(() => {
                    if (!cancelled) {
                        setCoverageVariantsLoading(false);
                    }
                });
        }, 280);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [geofenceMarginM, headlandWidth, parcelDialogOpen, rowSpacing, vehicleWidthM]);

    useEffect(() => {
        const plan = coveragePlanRef.current;
        if (!plan || !parcelDialogOpen) {
            return;
        }
        const chosen = plan.variants.find((item) => item.strategy === coverageStrategy);
        setCoveragePreview({
            origin: plan.origin,
            work: chosen?.sections ?? plan.sections,
            headlands: plan.headland_sections,
        });
    }, [coverageStrategy, parcelDialogOpen]);

    const clearZoneSession = useCallback(() => {
        setZoneRing([]);
        setZoneMode(null);
        setZoneWorkingOn(true);
        setConnectFirst(null);
        setConnectSecond(null);
        setConnectKind(null);
        setFillGeofencePrompt(false);
        setFreeStyleOpen(false);
    }, []);

    const startTool = useCallback(
        (next: Exclude<EditTool, 'none'>) => {
            if (selectionDragRef.current) {
                setWorking(selectionDragRef.current.baseline);
                selectionDragRef.current = null;
            }
            if (tool === next) {
                setTool('none');
                setDraft([]);
                setSelectedIndices([]);
                setSelectedGeofenceId(null);
                geofenceEditRef.current = null;
                setExtendDirection(null);
                setNoticeKey(null);
                setParcelDialogOpen(false);
                clearZoneSession();
                return;
            }
            setTool(next);
            setDraft([]);
            setSelectedIndices([]);
            setSelectedGeofenceId(null);
            geofenceEditRef.current = null;
            setExtendDirection(null);
            setNoticeKey(DRAWING_HINT[next]);
            setParcelDialogOpen(false);
            setTurnsDialogOpen(false);
            setSpeedDialogOpen(false);
            setOffsetDialogOpen(false);
            clearZoneSession();
        },
        [clearZoneSession, tool],
    );

    const startDrawLine = useCallback(() => {
        startTool('draw_line');
    }, [startTool]);

    const startDrawPolygon = useCallback(() => {
        startTool('draw_polygon');
    }, [startTool]);

    const startWorkingZone = useCallback(() => {
        startTool('edit_working_zone');
    }, [startTool]);

    const startDeleteZone = useCallback(() => {
        startTool('delete_points_zone');
    }, [startTool]);

    const startFillParcel = useCallback(() => {
        if (workingWidthM != null && workingWidthM > 0) {
            setRowSpacing(String(workingWidthM));
        }
        const exterior = readGeofenceExterior(workingRef.current);
        if (exterior.length >= 3) {
            setFillGeofencePrompt(true);
            setTool('none');
            setDraft([]);
            setNoticeKey('tool.fillUseGeofenceHint');
            return;
        }
        startTool('draw_parcel');
    }, [startTool, workingWidthM]);

    const acceptFillGeofence = useCallback(() => {
        const current = workingRef.current;
        const ring = localRingToLatLng(current, readGeofenceExterior(current));
        setFillGeofencePrompt(false);
        if (ring.length < 3) {
            startTool('draw_parcel');
            return;
        }
        draftRef.current = ring;
        setDraft(ring);
        setTool('draw_parcel');
        setNoticeKey('tool.fillParcelHint');
        setParcelDialogOpen(true);
    }, [startTool]);

    const declineFillGeofence = useCallback(() => {
        setFillGeofencePrompt(false);
        startTool('draw_parcel');
    }, [startTool]);

    const startConnectEnds = useCallback(() => {
        startTool('connect_ends');
    }, [startTool]);

    const startRuler = useCallback(() => {
        startTool('ruler');
    }, [startTool]);

    const startSelectZone = useCallback(() => {
        startTool('select_zone');
    }, [startTool]);

    const startSelectPolygon = useCallback(() => {
        startTool('select_sections_polygon');
    }, [startTool]);

    const addVertex = useCallback((lngLat: [number, number]) => {
        const nextPoint = { lat: lngLat[1], lng: lngLat[0] };
        setDraft((points) => {
            if (toolRef.current === 'ruler' && points.length >= 2) {
                return [nextPoint];
            }
            return [...points, nextPoint];
        });
        const current = toolRef.current;
        if (current !== 'none') {
            setNoticeKey(DRAWING_HINT[current]);
        }
    }, []);

    const handleMapClick = useCallback(
        (lngLat: [number, number], mods?: { shiftKey: boolean }) => {
            const direction = extendDirectionRef.current;
            if (direction) {
                const currentWorking = workingRef.current;
                const indices = selectedRef.current;
                const sectionIndex = indices.length === 1 ? indices[0] : undefined;
                if (!currentWorking || sectionIndex === undefined) {
                    setExtendDirection(null);
                    return;
                }
                if (rejectIfLocked([sectionIndex])) {
                    return;
                }
                const origin = documentOrigin(currentWorking);
                if (!origin) {
                    setNoticeKey('tool.needMission');
                    return;
                }
                const local = latLngToLocal({ lat: lngLat[1], lng: lngLat[0] }, origin);
                const result = extendSectionSmart(currentWorking, sectionIndex, direction, local);
                if (result.added === -1) {
                    setNoticeKey('tool.sectionLimit');
                    return;
                }
                if (result.added === 0) {
                    setNoticeKey('inspector.edit.extendTooClose');
                    return;
                }
                stackRef.current.push(currentWorking);
                setWorking(result.document);
                setDirty(true);
                setExtendDirection(null);
                if (result.mode === 'densify') {
                    setNoticeKey('inspector.edit.extendedDensify');
                    setNoticeParams({ count: result.added });
                } else {
                    setNoticeKey('inspector.edit.extended');
                }
                syncButtons();
                return;
            }
            if (toolRef.current === 'connect_ends') {
                if (connectFirst && connectSecond && connectKind === 'free') {
                    addVertex(lngLat);
                    return;
                }
                const picked = pickRowEndpoint(workingRef.current, {
                    lat: lngLat[1],
                    lng: lngLat[0],
                });
                if (!picked) {
                    setNoticeKey('tool.connectEndsHint');
                    return;
                }
                if (!connectFirst) {
                    setConnectFirst(picked);
                    setSelectedIndices([picked.sectionIndex]);
                    setNoticeKey('tool.connectEndsHint');
                    return;
                }
                if (!connectSecond) {
                    setConnectSecond(picked);
                    setSelectedIndices([connectFirst.sectionIndex, picked.sectionIndex]);
                    setNoticeKey('connect.kindHint');
                    return;
                }
                return;
            }
            if (toolRef.current === 'select_zone') {
                const picked = pickSectionByProximity(workingRef.current, {
                    lat: lngLat[1],
                    lng: lngLat[0],
                });
                if (picked === null) {
                    const geofence = mods?.shiftKey
                        ? null
                        : pickGeofenceByProximity(workingRef.current, {
                              lat: lngLat[1],
                              lng: lngLat[0],
                          });
                    if (geofence !== null) {
                        selectGeofenceRef.current?.(geofence);
                        return;
                    }
                    if (!mods?.shiftKey) {
                        setSelectedIndices([]);
                        setZoneRing([]);
                        setZoneMode(null);
                    }
                    return;
                }
                setSelectedIndices((current) =>
                    toggleSelectedIndex(current, picked, mods?.shiftKey === true),
                );
                return;
            }
            addVertex(lngLat);
        },
        [addVertex, connectFirst, connectKind, connectSecond, rejectIfLocked, syncButtons],
    );

    const insertVertex = useCallback((afterIndex: number, lngLat: [number, number]) => {
        if (
            toolRef.current === 'ruler' ||
            toolRef.current === 'select_zone' ||
            toolRef.current === 'connect_ends'
        ) {
            return;
        }
        setDraft((points) =>
            insertDraftVertex(points, afterIndex, { lat: lngLat[1], lng: lngLat[0] }),
        );
        const current = toolRef.current;
        if (current !== 'none') {
            setNoticeKey(DRAWING_HINT[current]);
        }
    }, []);

    const moveVertex = useCallback((index: number, lngLat: [number, number]) => {
        setDraft((points) => moveDraftVertex(points, index, { lat: lngLat[1], lng: lngLat[0] }));
        const current = toolRef.current;
        if (current !== 'none') {
            setNoticeKey(DRAWING_HINT[current]);
        }
    }, []);

    const cancelTool = useCallback(() => {
        if (selectionDragRef.current) {
            setWorking(selectionDragRef.current.baseline);
            selectionDragRef.current = null;
        }
        setTool('none');
        setDraft([]);
        setSelectedIndices([]);
        setSelectedGeofenceId(null);
        geofenceEditRef.current = null;
        setExtendDirection(null);
        setNoticeKey(null);
        setParcelDialogOpen(false);
        setTurnsDialogOpen(false);
        setSpeedDialogOpen(false);
        setOffsetDialogOpen(false);
        clearZoneSession();
    }, [clearZoneSession]);

    const finishDrawLine = useCallback(() => {
        const currentDraft = draftRef.current;
        const currentWorking = workingRef.current;
        const result = appendDrawnLine(currentWorking, currentDraft);
        if (!result.ok) {
            setNoticeKey(FAILURE_KEYS[result.reason]);
            return;
        }
        stackRef.current.push(currentWorking);
        setWorking(result.document);
        setDraft([]);
        setDirty(true);
        setTool('none');
        setNoticeKey('tool.lineAdded');
        setNoticeParams({ count: result.added });
        syncButtons();
    }, [syncButtons]);

    const finishDrawPolygon = useCallback(() => {
        const currentDraft = draftRef.current;
        const currentWorking = workingRef.current;
        const result = setDrawnGeofence(currentWorking, currentDraft);
        if (!result.ok) {
            setNoticeKey('tool.tooFewPolygonPoints');
            return;
        }
        stackRef.current.push(currentWorking);
        setWorking(result.document);
        setDraft([]);
        setDirty(true);
        setTool('none');
        setNoticeKey('tool.geofenceAdded');
        setNoticeParams({ count: result.added });
        syncButtons();
    }, [syncButtons]);

    const finishGeofenceEdit = useCallback(() => {
        const currentWorking = workingRef.current;
        const currentDraft = draftRef.current;
        if (!currentWorking || currentDraft.length < 3) {
            setNoticeKey('tool.tooFewPolygonPoints');
            return;
        }
        const id = geofenceEditRef.current;
        const addingExclusion = toolRef.current === 'draw_geofence_exclusion';
        const next = addingExclusion
            ? appendGeofenceExclusion(currentWorking, currentDraft)
            : id
              ? setGeofenceRing(currentWorking, id, currentDraft)
              : null;
        if (!next) {
            setNoticeKey('tool.geofenceEditFailed');
            return;
        }
        stackRef.current.push(currentWorking);
        setWorking(next);
        setDirty(true);
        setDraft([]);
        setTool('none');
        geofenceEditRef.current = null;
        if (addingExclusion) {
            setNoticeKey('tool.geofenceExclusionAdded');
        } else {
            setNoticeKey('tool.geofenceUpdated');
        }
        syncButtons();
    }, [syncButtons]);

    const finishWorkingZone = useCallback(
        (value: 0 | 1) => {
            const currentDraft = draftRef.current;
            const currentWorking = workingRef.current;
            const result = applyDrawnWorkingZone(currentWorking, currentDraft, value);
            if (!result.ok) {
                setNoticeKey(
                    result.reason === 'no_origin' ? 'tool.needMission' : 'tool.tooFewPolygonPoints',
                );
                return;
            }
            if (result.count === 0) {
                setNoticeKey('tool.workingZoneEmpty');
            } else {
                setNoticeKey(value === 1 ? 'tool.workingZoneWork' : 'tool.workingZoneTransit');
                setNoticeParams({ count: result.count });
            }
            stackRef.current.push(currentWorking);
            setWorking(result.document);
            setDraft([]);
            setDirty(true);
            setTool('none');
            syncButtons();
        },
        [syncButtons],
    );

    const finishDeleteZone = useCallback(() => {
        const currentDraft = draftRef.current;
        const currentWorking = workingRef.current;
        const result = deleteDrawnPointsInPolygon(currentWorking, currentDraft);
        if (!result.ok) {
            setNoticeKey(
                result.reason === 'no_origin' ? 'tool.needMission' : 'tool.tooFewPolygonPoints',
            );
            return;
        }
        if (result.count === 0) {
            setNoticeKey('tool.deleteZoneEmpty');
            setDraft([]);
            setTool('none');
            return;
        }
        stackRef.current.push(currentWorking);
        setWorking(result.document);
        setDraft([]);
        setDirty(true);
        setTool('none');
        setNoticeKey('tool.pointsDeleted');
        setNoticeParams({ count: result.count });
        syncButtons();
    }, [syncButtons]);

    const finishFillParcel = useCallback(
        (spacing: number) => {
            const currentDraft = draftRef.current;
            const currentWorking = workingRef.current;
            const first = currentDraft[0];
            if (!first) {
                setNoticeKey(FILL_FAILURE_KEYS.too_few_points);
                return;
            }
            const headlandM = Number(headlandWidth);
            const apply = (
                result: ReturnType<typeof fillDrawnParcel>,
                engine?: string,
                turns = 0,
            ) => {
                if (!result.ok) {
                    setNoticeKey(FILL_FAILURE_KEYS[result.reason]);
                    return;
                }
                stackRef.current.push(currentWorking);
                setWorking(result.document);
                setMissionFitNonce((value) => value + 1);
                setDraft([]);
                setDirty(true);
                setTool('none');
                setParcelDialogOpen(false);
                setCoveragePreview(null);
                if (turns > 0) {
                    setNoticeKey(
                        engine
                            ? `tool.fillParcelAdded.withTurns.${engine}`
                            : 'tool.fillParcelAdded.withTurns',
                    );
                    setNoticeParams({
                        rows: result.rows,
                        points: result.points,
                        turns,
                        engine: engine ?? '',
                    });
                } else {
                    setNoticeKey(
                        engine ? `tool.fillParcelAdded.${engine}` : 'tool.fillParcelAdded',
                    );
                    setNoticeParams({
                        rows: result.rows,
                        points: result.points,
                        engine: engine ?? '',
                    });
                }
                syncButtons();
            };
            const fallback = () => apply(fillDrawnParcel(currentWorking, currentDraft, spacing));
            const prepared = ensureWorkingDocument(currentWorking, first);
            const origin = documentOrigin(prepared);
            if (!prepared || !origin) {
                fallback();
                return;
            }
            void planCoverage({
                ring: currentDraft,
                origin: { lat: origin.lat, lon: origin.lon },
                working_width_m: spacing,
                vehicle_width_m: vehicleWidthM ?? undefined,
                strategy: coverageStrategy,
                variants: true,
                headland_width_m: Number.isFinite(headlandM) && headlandM > 0 ? headlandM : 0,
                geofence_margin_m:
                    geofenceMarginM && geofenceMarginM > 0 ? geofenceMarginM : undefined,
            })
                .then((plan) => {
                    const chosen =
                        plan.variants.find((item) => item.strategy === coverageStrategy) ?? plan;
                    const interior = 'sections' in chosen ? chosen.sections : plan.sections;
                    const connected = appendConnectedCoverage(
                        prepared,
                        first,
                        interior,
                        plan.headland_sections,
                        plan.srbc_coverage,
                        connectAfterFill
                            ? {
                                  ...DEFAULT_CONNECT_TURNS,
                                  turnType: kinematics === 'ackermann' ? 'u_turn' : 'square',
                                  densifyRows: false,
                              }
                            : null,
                        plan.origin,
                        connectAfterFill
                            ? {
                                  clearanceM: geofenceMarginM,
                                  alreadyReservedM: Math.max(
                                      Number.isFinite(headlandM) && headlandM > 0 ? headlandM : 0,
                                      geofenceMarginM && geofenceMarginM > 0 ? geofenceMarginM : 0,
                                  ),
                              }
                            : undefined,
                    );
                    apply(connected, plan.engine, connected.ok ? connected.turns : 0);
                })
                .catch(() => {
                    fallback();
                });
        },
        [
            connectAfterFill,
            coverageStrategy,
            geofenceMarginM,
            headlandWidth,
            kinematics,
            syncButtons,
            vehicleWidthM,
        ],
    );

    const startConnectTurns = useCallback(() => {
        const current = workingRef.current;
        const selectedRows = (current?.points ?? []).filter(
            (section, index) =>
                selectedRef.current.includes(index) && getSectionTypeString(section) === 'row_line',
        );
        const rows =
            selectedRows.length >= 2
                ? selectedRows
                : (current?.points ?? []).filter(
                      (section) => getSectionTypeString(section) === 'row_line',
                  );
        if (rows.length < 2) {
            setNoticeKey('tool.connectTurnsNeedRows');
            return;
        }
        setExtendDirection(null);
        setTurnsDialogOpen(true);
        setSpeedDialogOpen(false);
        setOffsetDialogOpen(false);
    }, []);

    const finishConnectTurns = useCallback(
        (params: ConnectTurnsParams) => {
            const currentWorking = workingRef.current;
            const selectedRows = (currentWorking?.points ?? []).filter(
                (section, index) =>
                    selectedRef.current.includes(index) &&
                    getSectionTypeString(section) === 'row_line',
            );
            const result =
                selectedRows.length >= 2
                    ? connectSelectedRowLines(currentWorking, selectedRef.current, {
                          ...params,
                          densifyRows: false,
                      })
                    : connectRowLinesPreservingOthers(currentWorking, {
                          ...params,
                          densifyRows: false,
                      });
            if (!result.ok) {
                setNoticeKey(TURNS_FAILURE_KEYS[result.reason]);
                return;
            }
            stackRef.current.push(currentWorking);
            setWorking(result.document);
            setDirty(true);
            setTurnsDialogOpen(false);
            setSelectedIndices([]);
            if (result.failures.length > 0) {
                setNoticeKey('tool.connectTurnsPartial');
                setNoticeParams({ turns: result.turns, failed: result.failures.length });
            } else {
                setNoticeKey('tool.connectTurnsAdded');
                setNoticeParams({ turns: result.turns });
            }
            syncButtons();
        },
        [syncButtons],
    );

    const startEditSpeed = useCallback(() => {
        const currentWorking = workingRef.current;
        if (!currentWorking || currentWorking.points.length === 0) {
            setNoticeKey('tool.needMission');
            return;
        }
        const current = getCurrentTrajectorySpeed(currentWorking);
        setSpeedValue(String(current ?? 0.5));
        setTool('none');
        setDraft([]);
        setSelectedIndices([]);
        setExtendDirection(null);
        setSpeedDialogOpen(true);
        setTurnsDialogOpen(false);
        setOffsetDialogOpen(false);
    }, []);

    const finishEditSpeed = useCallback(
        (value: number) => {
            const currentWorking = workingRef.current;
            if (!currentWorking) {
                setNoticeKey('tool.needMission');
                return;
            }
            const result = applySpeedToAllPoints(currentWorking, value);
            if (result.count === 0) {
                setNoticeKey('tool.speedNoPoints');
                setSpeedDialogOpen(false);
                return;
            }
            stackRef.current.push(currentWorking);
            setWorking(result.document);
            setDirty(true);
            setSpeedDialogOpen(false);
            setNoticeKey('tool.speedUpdated');
            setNoticeParams({ count: result.count, value });
            syncButtons();
        },
        [syncButtons],
    );

    const openFillParcelDialog = useCallback(() => {
        if (draftRef.current.length < 3) {
            setNoticeKey('tool.tooFewPolygonPoints');
            return;
        }
        setParcelDialogOpen(true);
    }, []);

    const finishSelectPolygon = useCallback(() => {
        const currentDraft = draftRef.current;
        if (currentDraft.length < 3) {
            setNoticeKey('tool.tooFewPolygonPoints');
            return;
        }
        const currentWorking = workingRef.current;
        if (!currentWorking) {
            setNoticeKey('tool.needMission');
            return;
        }
        const indices = selectSectionsIntersectingPolygon(currentWorking, currentDraft);
        setZoneRing(currentDraft);
        setZoneMode('choose');
        setZoneWorkingOn(true);
        setSelectedIndices(indices);
        setDraft([]);
        setTool('select_zone');
        if (indices.length === 0) {
            setNoticeKey('tool.selectEmpty');
        } else {
            setNoticeKey('tool.sectionsSelected');
            setNoticeParams({ count: indices.length });
        }
    }, []);

    const applyZoneCut = useCallback(() => {
        const currentWorking = workingRef.current;
        const result = deleteDrawnPointsInPolygon(currentWorking, zoneRing);
        if (!result.ok) {
            setNoticeKey(
                result.reason === 'no_origin' ? 'tool.needMission' : 'tool.tooFewPolygonPoints',
            );
            return;
        }
        if (result.count === 0) {
            setNoticeKey('tool.deleteZoneEmpty');
            return;
        }
        stackRef.current.push(currentWorking);
        setWorking(result.document);
        setDirty(true);
        setNoticeKey('tool.pointsDeleted');
        setNoticeParams({ count: result.count });
        syncButtons();
    }, [syncButtons, zoneRing]);

    const applyZoneWorking = useCallback(
        (value: 0 | 1) => {
            const currentWorking = workingRef.current;
            const result = applyDrawnWorkingZone(currentWorking, zoneRing, value);
            if (!result.ok) {
                setNoticeKey(
                    result.reason === 'no_origin' ? 'tool.needMission' : 'tool.tooFewPolygonPoints',
                );
                return;
            }
            setZoneWorkingOn(value === 1);
            if (result.count === 0) {
                setNoticeKey('tool.workingZoneEmpty');
            } else {
                setNoticeKey(value === 1 ? 'tool.workingZoneWork' : 'tool.workingZoneTransit');
                setNoticeParams({ count: result.count });
            }
            stackRef.current.push(currentWorking);
            setWorking(result.document);
            setDirty(true);
            syncButtons();
        },
        [syncButtons, zoneRing],
    );

    const applyZoneSpeed = useCallback(() => {
        const value = Number(zoneSpeedDraft);
        if (!Number.isFinite(value) || value < 0 || value > 50) {
            setNoticeKey('tool.speedInvalid');
            return;
        }
        const currentWorking = workingRef.current;
        const result = applyDrawnSpeed(currentWorking, zoneRing, value);
        if (!result.ok) {
            setNoticeKey(
                result.reason === 'no_origin' ? 'tool.needMission' : 'tool.tooFewPolygonPoints',
            );
            return;
        }
        if (result.count === 0) {
            setNoticeKey('tool.speedNoPoints');
            return;
        }
        stackRef.current.push(currentWorking);
        setWorking(result.document);
        setDirty(true);
        setNoticeKey('tool.speedUpdated');
        setNoticeParams({ count: result.count, value });
        syncButtons();
    }, [syncButtons, zoneRing, zoneSpeedDraft]);

    const finishConnectEnds = useCallback(
        (style: FreeLinkStyle = 'segments') => {
            const currentWorking = workingRef.current;
            if (!currentWorking || !connectFirst || !connectSecond || !connectKind) {
                setNoticeKey('connect.needEnds');
                return;
            }
            const origin = documentOrigin(currentWorking);
            const speed = getCurrentTrajectorySpeed(currentWorking) ?? 0.5;
            let result: ReturnType<typeof connectTwoRowEnds>;
            if (connectKind === 'free' || connectKind === 'direct') {
                const waypoints: Array<[number, number]> =
                    connectKind === 'free' && origin
                        ? draftRef.current.map((point) => {
                              const local = latLngToLocal(point, origin);
                              return [local.x, local.y];
                          })
                        : [];
                result = connectTwoRowEndsFree(
                    currentWorking,
                    connectFirst,
                    connectSecond,
                    waypoints,
                    speed,
                    style,
                );
            } else {
                result = connectTwoRowEnds(
                    currentWorking,
                    connectFirst,
                    connectSecond,
                    connectKind,
                    speed,
                );
            }
            if (!result.ok) {
                setNoticeKey('connect.needEnds');
                return;
            }
            stackRef.current.push(currentWorking);
            setWorking(result.document);
            setDirty(true);
            setDraft([]);
            setConnectFirst(null);
            setConnectSecond(null);
            setConnectKind(null);
            setFreeStyleOpen(false);
            setTool('none');
            setSelectedIndices([]);
            setNoticeKey('connect.added');
            syncButtons();
        },
        [connectFirst, connectKind, connectSecond, syncButtons],
    );

    const requestConnectEnds = useCallback(() => {
        if (!connectFirst || !connectSecond) {
            setNoticeKey('connect.needEnds');
            return;
        }
        if (connectKind === 'free') {
            setFreeStyleOpen(true);
            return;
        }
        finishConnectEnds('segments');
    }, [connectFirst, connectKind, connectSecond, finishConnectEnds]);

    const selectIndices = useCallback((indices: number[], additive = false) => {
        if (selectionDragRef.current) {
            setWorking(selectionDragRef.current.baseline);
            selectionDragRef.current = null;
        }
        if (toolRef.current !== 'select_zone') {
            setTool('select_zone');
            setDraft([]);
            setExtendDirection(null);
            setParcelDialogOpen(false);
            setTurnsDialogOpen(false);
            setSpeedDialogOpen(false);
            setOffsetDialogOpen(false);
        }
        setSelectedIndices((current) => {
            if (additive && indices.length === 1) {
                const picked = indices[0];
                if (picked === undefined) {
                    return current;
                }
                return toggleSelectedIndex(current, picked, true);
            }
            return indices;
        });
        setSelectedGeofenceId(null);
        geofenceEditRef.current = null;
        setNoticeKey('tool.sectionsSelected');
        setNoticeParams({ count: additive ? Math.max(indices.length, 1) : indices.length });
    }, []);

    const selectGeofence = useCallback((id: GeofenceId) => {
        const currentWorking = workingRef.current;
        if (!currentWorking) {
            return;
        }
        setSelectedIndices([]);
        setSelectedGeofenceId(id);
        setExtendDirection(null);
        setParcelDialogOpen(false);
        setTurnsDialogOpen(false);
        setSpeedDialogOpen(false);
        setOffsetDialogOpen(false);
        if (lockedGeofenceRef.current.includes(id)) {
            setTool('none');
            setDraft([]);
            geofenceEditRef.current = null;
            setNoticeKey('tree.geofence.locked');
            return;
        }
        const points = localRingToLatLng(currentWorking, geofenceRing(currentWorking, id));
        if (points.length < 3) {
            return;
        }
        geofenceEditRef.current = id;
        setDraft(points);
        setTool('edit_geofence');
        setNoticeKey('tool.editGeofenceHint');
    }, []);

    selectGeofenceRef.current = selectGeofence;

    const startGeofenceExclusion = useCallback(() => {
        const currentWorking = workingRef.current;
        if (!currentWorking || geofenceRing(currentWorking, 'outer').length < 3) {
            setNoticeKey('tool.needGeofence');
            return;
        }
        if (lockedGeofenceRef.current.includes('outer')) {
            setNoticeKey('tree.geofence.locked');
            return;
        }
        setSelectedIndices([]);
        setSelectedGeofenceId('outer');
        geofenceEditRef.current = null;
        setDraft([]);
        setTool('draw_geofence_exclusion');
        setNoticeKey('tool.drawGeofenceExclusionHint');
    }, []);

    const reorderTo = useCallback(
        (fromIndex: number, toIndex: number) => {
            const currentWorking = workingRef.current;
            if (!currentWorking) {
                return;
            }
            const clamped = Math.max(0, Math.min(toIndex, currentWorking.points.length - 1));
            if (rejectIfLocked([fromIndex])) {
                return;
            }
            const next = reorderSection(currentWorking, fromIndex, clamped);
            if (next === currentWorking) {
                return;
            }
            stackRef.current.push(currentWorking);
            setWorking(next);
            setSelectedIndices((current) => remapIndexList(current, fromIndex, clamped));
            setHiddenIndices((current) => remapIndexList(current, fromIndex, clamped));
            setLockedIndices((current) => remapIndexList(current, fromIndex, clamped));
            setDirty(true);
            setNoticeKey('tree.reordered');
            syncButtons();
        },
        [rejectIfLocked, syncButtons],
    );

    const reorderSelected = useCallback(
        (delta: -1 | 1) => {
            const currentWorking = workingRef.current;
            const indices = selectedRef.current;
            if (!currentWorking || indices.length !== 1) {
                return;
            }
            const fromIndex = indices[0];
            if (fromIndex === undefined) {
                return;
            }
            const toIndex = Math.max(
                0,
                Math.min(fromIndex + delta, currentWorking.points.length - 1),
            );
            reorderTo(fromIndex, toIndex);
        },
        [reorderTo],
    );

    const toggleHidden = useCallback((index: number) => {
        setHiddenIndices((current) =>
            current.includes(index)
                ? current.filter((item) => item !== index)
                : [...current, index],
        );
    }, []);

    const toggleLocked = useCallback((index: number) => {
        setLockedIndices((current) =>
            current.includes(index)
                ? current.filter((item) => item !== index)
                : [...current, index],
        );
    }, []);

    const toggleGeofenceHidden = useCallback((id: GeofenceId) => {
        setHiddenGeofenceIds((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
        );
    }, []);

    const toggleGeofenceLocked = useCallback((id: GeofenceId) => {
        setLockedGeofenceIds((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
        );
        if (geofenceEditRef.current === id) {
            geofenceEditRef.current = null;
            setTool('none');
            setDraft([]);
            setNoticeKey('tree.geofence.locked');
        }
    }, []);

    const reverseSelected = useCallback(() => {
        const currentWorking = workingRef.current;
        const indices = selectedRef.current;
        if (!currentWorking || indices.length === 0) {
            return;
        }
        if (rejectIfLocked(indices)) {
            return;
        }
        stackRef.current.push(currentWorking);
        setWorking(reverseSelectedSections(currentWorking, indices));
        setDirty(true);
        setNoticeKey('tool.reverseSelectedDone');
        setNoticeParams({ count: indices.length });
        syncButtons();
    }, [rejectIfLocked, syncButtons]);

    const deleteSelected = useCallback(() => {
        const currentWorking = workingRef.current;
        const indices = selectedRef.current;
        if (!currentWorking || indices.length === 0) {
            return;
        }
        if (rejectIfLocked(indices)) {
            return;
        }
        stackRef.current.push(currentWorking);
        setWorking(deleteSelectedSections(currentWorking, indices));
        setSelectedIndices([]);
        setHiddenIndices((current) => remapIndexListAfterDelete(current, indices));
        setLockedIndices((current) => remapIndexListAfterDelete(current, indices));
        setExtendDirection(null);
        setDirty(true);
        setNoticeKey('tool.deletedSelected');
        setNoticeParams({ count: indices.length });
        syncButtons();
    }, [rejectIfLocked, syncButtons]);

    /** Delete straight from the tree, whatever the current selection is. */
    const deleteSection = useCallback(
        (index: number) => {
            const currentWorking = workingRef.current;
            if (!currentWorking || index < 0) {
                return;
            }
            if (rejectIfLocked([index])) {
                return;
            }
            stackRef.current.push(currentWorking);
            setWorking(deleteSelectedSections(currentWorking, [index]));
            setSelectedIndices([]);
            setHiddenIndices((current) => remapIndexListAfterDelete(current, [index]));
            setLockedIndices((current) => remapIndexListAfterDelete(current, [index]));
            setExtendDirection(null);
            setDirty(true);
            setNoticeKey('tool.deletedSelected');
            setNoticeParams({ count: 1 });
            syncButtons();
        },
        [rejectIfLocked, syncButtons],
    );

    const deleteGeofenceExclusion = useCallback(
        (id: GeofenceId) => {
            const currentWorking = workingRef.current;
            if (!currentWorking || lockedGeofenceRef.current.includes(id)) {
                return;
            }
            const next = removeGeofenceExclusion(currentWorking, id);
            if (!next) {
                return;
            }
            stackRef.current.push(currentWorking);
            setWorking(next);
            setSelectedGeofenceId(null);
            setHiddenGeofenceIds((current) => current.filter((value) => value !== id));
            setLockedGeofenceIds((current) => current.filter((value) => value !== id));
            setDirty(true);
            syncButtons();
        },
        [syncButtons],
    );

    const moveSelected = useCallback(
        (direction: 'n' | 's' | 'e' | 'w') => {
            const step = Number(moveStep);
            if (!Number.isFinite(step) || step < 0.01 || step > 10) {
                setNoticeKey('inspector.edit.moveInvalid');
                return;
            }
            const currentWorking = workingRef.current;
            const indices = selectedRef.current;
            if (!currentWorking || indices.length === 0) {
                return;
            }
            if (rejectIfLocked(indices)) {
                return;
            }
            const dx = direction === 'e' ? step : direction === 'w' ? -step : 0;
            const dy = direction === 'n' ? step : direction === 's' ? -step : 0;
            stackRef.current.push(currentWorking);
            setWorking(moveSections(currentWorking, indices, dx, dy));
            setDirty(true);
            syncButtons();
        },
        [moveStep, rejectIfLocked, syncButtons],
    );

    const rotateSelected = useCallback(
        (sign: 1 | -1) => {
            const step = Number(rotationStep);
            if (!Number.isFinite(step) || step < 1 || step > 90) {
                setNoticeKey('inspector.edit.rotationInvalid');
                return;
            }
            const currentWorking = workingRef.current;
            const indices = selectedRef.current;
            if (!currentWorking || indices.length === 0) {
                return;
            }
            if (rejectIfLocked(indices)) {
                return;
            }
            stackRef.current.push(currentWorking);
            setWorking(rotateSections(currentWorking, indices, sign * step));
            setDirty(true);
            syncButtons();
        },
        [rotationStep, rejectIfLocked, syncButtons],
    );

    const duplicateSelected = useCallback(() => {
        const count = Math.floor(Number(duplicateCount));
        const distance = Number(duplicateDistance);
        if (
            !Number.isFinite(count) ||
            count < 1 ||
            count > 100 ||
            !Number.isFinite(distance) ||
            distance <= 0
        ) {
            setNoticeKey('inspector.edit.duplicateInvalid');
            return;
        }
        const currentWorking = workingRef.current;
        const indices = selectedRef.current;
        if (!currentWorking || indices.length === 0) {
            return;
        }
        if (rejectIfLocked(indices)) {
            return;
        }
        const next = duplicateSectionsInDocument(
            currentWorking,
            indices,
            distance,
            duplicateSide,
            count,
        );
        if (getTotalPointsCount(next) > MAX_POINTS_PER_TRAJECTORY) {
            setNoticeKey('tool.trajectoryLimit');
            return;
        }
        stackRef.current.push(currentWorking);
        setWorking(next);
        setDirty(true);
        setNoticeKey('inspector.edit.duplicated');
        setNoticeParams({ count: next.points.length - currentWorking.points.length });
        syncButtons();
    }, [duplicateCount, duplicateDistance, duplicateSide, rejectIfLocked, syncButtons]);

    const startExtend = useCallback(
        (direction: ExtendDirection) => {
            if (selectedRef.current.length !== 1) {
                setNoticeKey('inspector.edit.extendNeedOne');
                return;
            }
            if (rejectIfLocked(selectedRef.current)) {
                return;
            }
            if (extendDirectionRef.current === direction) {
                setExtendDirection(null);
                setNoticeKey(DRAWING_HINT.select_zone);
                return;
            }
            setExtendDirection(direction);
            setNoticeKey('inspector.edit.extendHint');
        },
        [rejectIfLocked],
    );

    const cancelExtend = useCallback(() => {
        setExtendDirection(null);
        setNoticeKey(DRAWING_HINT.select_zone);
    }, []);

    const beginSelectionDrag = useCallback(
        (lngLat: [number, number]) => {
            if (extendDirectionRef.current || toolRef.current !== 'select_zone') {
                return false;
            }
            const currentWorking = workingRef.current;
            const indices = selectedRef.current;
            if (!currentWorking || indices.length === 0) {
                return false;
            }
            const picked = pickSectionByProximity(currentWorking, {
                lat: lngLat[1],
                lng: lngLat[0],
            });
            if (picked === null || !indices.includes(picked)) {
                return false;
            }
            if (rejectIfLocked(indices)) {
                return false;
            }
            selectionDragRef.current = {
                start: { lat: lngLat[1], lng: lngLat[0] },
                baseline: currentWorking,
                indices: [...indices],
            };
            return true;
        },
        [rejectIfLocked],
    );

    const updateSelectionDrag = useCallback((lngLat: [number, number]) => {
        const drag = selectionDragRef.current;
        if (!drag) {
            return;
        }
        const origin = documentOrigin(drag.baseline);
        if (!origin) {
            return;
        }
        const delta = localDelta(origin, drag.start, { lat: lngLat[1], lng: lngLat[0] });
        setWorking(moveSections(drag.baseline, drag.indices, delta.x, delta.y));
    }, []);

    const finishSelectionDrag = useCallback(
        (lngLat: [number, number]) => {
            const drag = selectionDragRef.current;
            selectionDragRef.current = null;
            if (!drag) {
                return 'none' as const;
            }
            const origin = documentOrigin(drag.baseline);
            if (!origin) {
                setWorking(drag.baseline);
                return 'none' as const;
            }
            const delta = localDelta(origin, drag.start, { lat: lngLat[1], lng: lngLat[0] });
            if (Math.hypot(delta.x, delta.y) < 0.05) {
                setWorking(drag.baseline);
                return 'click' as const;
            }
            stackRef.current.push(drag.baseline);
            setWorking(moveSections(drag.baseline, drag.indices, delta.x, delta.y));
            setDirty(true);
            setNoticeKey(null);
            syncButtons();
            return 'moved' as const;
        },
        [syncButtons],
    );

    const cancelSelectionDrag = useCallback(() => {
        const drag = selectionDragRef.current;
        if (!drag) {
            return false;
        }
        selectionDragRef.current = null;
        setWorking(drag.baseline);
        return true;
    }, []);

    const hitSelectedSection = useCallback((lngLat: [number, number]) => {
        if (extendDirectionRef.current || toolRef.current !== 'select_zone') {
            return false;
        }
        const currentWorking = workingRef.current;
        const indices = selectedRef.current;
        if (!currentWorking || indices.length === 0) {
            return false;
        }
        const picked = pickSectionByProximity(currentWorking, {
            lat: lngLat[1],
            lng: lngLat[0],
        });
        return picked !== null && indices.includes(picked);
    }, []);

    const startOffset = useCallback(() => {
        if (!workingRef.current || selectedRef.current.length === 0) {
            setNoticeKey('tool.offsetNeedSelection');
            return;
        }
        if (rejectIfLocked(selectedRef.current)) {
            return;
        }
        setOffsetDialogOpen(true);
        setTurnsDialogOpen(false);
        setSpeedDialogOpen(false);
        setParcelDialogOpen(false);
    }, [rejectIfLocked]);

    const finishOffset = useCallback(
        (distance: number, side: DuplicateSide) => {
            const currentWorking = workingRef.current;
            const indices = selectedRef.current;
            if (!currentWorking || indices.length === 0) {
                setNoticeKey('tool.offsetNeedSelection');
                setOffsetDialogOpen(false);
                return;
            }
            if (!Number.isFinite(distance) || distance < 0.01 || distance > 100) {
                setNoticeKey('tool.offsetInvalid');
                return;
            }
            if (rejectIfLocked(indices)) {
                return;
            }
            stackRef.current.push(currentWorking);
            setWorking(offsetSections(currentWorking, indices, distance, side));
            setDirty(true);
            setOffsetDialogOpen(false);
            setNoticeKey('tool.offsetApplied');
            setNoticeParams({ count: indices.length, distance });
            syncButtons();
        },
        [rejectIfLocked, syncButtons],
    );

    const finishCurrent = useCallback(() => {
        const current = toolRef.current;
        if (current === 'draw_polygon') {
            finishDrawPolygon();
            return;
        }
        if (current === 'edit_geofence' || current === 'draw_geofence_exclusion') {
            finishGeofenceEdit();
            return;
        }
        if (current === 'draw_parcel') {
            openFillParcelDialog();
            return;
        }
        if (current === 'edit_working_zone') {
            finishWorkingZone(1);
            return;
        }
        if (current === 'delete_points_zone') {
            finishDeleteZone();
            return;
        }
        if (current === 'select_sections_polygon') {
            finishSelectPolygon();
            return;
        }
        if (current === 'connect_ends') {
            requestConnectEnds();
            return;
        }
        if (current === 'select_zone' || current === 'ruler') {
            return;
        }
        finishDrawLine();
    }, [
        finishConnectEnds,
        finishDeleteZone,
        requestConnectEnds,
        finishDrawLine,
        finishDrawPolygon,
        finishGeofenceEdit,
        finishSelectPolygon,
        finishWorkingZone,
        openFillParcelDialog,
    ]);

    const saveNow = useCallback(
        async (document?: AgriDocument | null) => {
            const current = document ?? workingRef.current;
            if (!current) {
                return;
            }
            const path =
                activePathRef.current ??
                (await newFarmMissionPath(current as unknown as Record<string, unknown>));
            savingRef.current = true;
            setSaveState('saving');
            try {
                const savedPath = await saveMissionDocument(
                    current as unknown as Record<string, unknown>,
                    path,
                );
                lastSavedRef.current = snapshotDocument(current);
                setDirty(false);
                setSaveState('saved');
                setNoticeKey('tool.savedToDisk');
                setNoticeParams({ path: savedPath });
                if (activePathRef.current !== savedPath) {
                    missions.adopt(savedPath, current);
                }
                await missions.refresh();
            } catch (cause: unknown) {
                setSaveState('error');
                setNoticeKey('tool.saveFailed');
                setNoticeParams({
                    error: cause instanceof Error ? cause.message : 'save failed',
                });
            } finally {
                savingRef.current = false;
            }
        },
        [missions],
    );

    const applyGeneratedDocument = useCallback(
        (
            document: AgriDocument,
            notice?: { key: string; params: Record<string, string | number> },
        ) => {
            stackRef.current.push(workingRef.current);
            setWorking(document);
            setMissionFitNonce((value) => value + 1);
            setDraft([]);
            setSelectedIndices([]);
            setExtendDirection(null);
            setDirty(true);
            setTool('none');
            setCoveragePreview(null);
            if (notice) {
                setNoticeKey(notice.key);
                setNoticeParams(notice.params);
            } else {
                setNoticeKey('assist.applied');
                setNoticeParams({});
            }
            syncButtons();
            void saveNow(document);
        },
        [saveNow, syncButtons],
    );

    const startNewDocument = useCallback(
        (
            document: AgriDocument,
            notice?: { key: string; params: Record<string, string | number> },
        ) => {
            // A creation flow must never overwrite the mission that happened to be open before it.
            activePathRef.current = null;
            applyGeneratedDocument(document, notice);
        },
        [applyGeneratedDocument],
    );

    const undo = useCallback(() => {
        if (selectionDragRef.current) {
            setWorking(selectionDragRef.current.baseline);
            selectionDragRef.current = null;
            return;
        }
        if (tool !== 'none' && draft.length > 0) {
            setDraft((points) => points.slice(0, -1));
            return;
        }
        const before = stackRef.current.undoCount;
        const restored = stackRef.current.undo(working);
        if (stackRef.current.undoCount === before) {
            return;
        }
        setWorking(restored);
        setSelectedIndices([]);
        setExtendDirection(null);
        setDirty(snapshotDocument(restored) !== lastSavedRef.current);
        setNoticeKey(null);
        syncButtons();
    }, [draft.length, syncButtons, tool, working]);

    useEffect(() => {
        if (selectedIndices.length !== 1) {
            setExtendDirection((current) => (current === null ? current : null));
        }
    }, [selectedIndices.length]);

    const redo = useCallback(() => {
        if (toolBlocksAutosave(tool)) {
            return;
        }
        const before = stackRef.current.redoCount;
        const restored = stackRef.current.redo(working);
        if (stackRef.current.redoCount === before) {
            return;
        }
        setWorking(restored);
        setSelectedIndices([]);
        setExtendDirection(null);
        setDirty(snapshotDocument(restored) !== lastSavedRef.current);
        setNoticeKey(null);
        syncButtons();
    }, [syncButtons, tool, working]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!interactiveRef.current || isTypingTarget(event.target)) {
                return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                if (event.shiftKey) {
                    redo();
                } else {
                    undo();
                }
                return;
            }
            // Mac keyboards send Backspace for the key labelled "delete".
            if (
                (event.key === 'Delete' || event.key === 'Backspace') &&
                toolRef.current === 'none' &&
                selectedRef.current.length > 0
            ) {
                event.preventDefault();
                deleteSelected();
                return;
            }
            if (event.key === 'Enter' && toolRef.current === 'connect_ends') {
                event.preventDefault();
                event.stopPropagation();
                requestConnectEnds();
                return;
            }
            if (
                event.key === 'Enter' &&
                toolRef.current !== 'none' &&
                toolRef.current !== 'ruler' &&
                toolRef.current !== 'select_zone'
            ) {
                const minimum = isPolygonTool(toolRef.current) ? 3 : 2;
                if (draftRef.current.length >= minimum) {
                    event.preventDefault();
                    event.stopPropagation();
                    finishCurrent();
                }
                return;
            }
            if (event.key === 'Escape') {
                if (cancelSelectionDrag()) {
                    event.preventDefault();
                    return;
                }
                if (toolRef.current === 'none') {
                    return;
                }
                if (
                    parcelDialogOpenRef.current ||
                    turnsDialogOpenRef.current ||
                    speedDialogOpenRef.current ||
                    offsetDialogOpenRef.current
                ) {
                    return;
                }
                event.preventDefault();
                const current = toolRef.current;
                if (extendDirectionRef.current) {
                    setExtendDirection(null);
                    setNoticeKey(DRAWING_HINT[current]);
                    return;
                }
                if (current === 'select_sections_polygon' && draftRef.current.length > 0) {
                    setDraft([]);
                    return;
                }
                if (
                    (current === 'select_zone' || current === 'select_sections_polygon') &&
                    selectedRef.current.length > 0
                ) {
                    setSelectedIndices([]);
                    setNoticeKey(DRAWING_HINT[current]);
                    return;
                }
                cancelTool();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [
        cancelSelectionDrag,
        cancelTool,
        deleteSelected,
        finishCurrent,
        redo,
        requestConnectEnds,
        undo,
    ]);

    const autosaveRef = useRef(createAutosave(() => undefined, 800));

    useEffect(() => {
        const persist = async () => {
            const document = workingRef.current;
            const path = activePathRef.current;
            if (!document || !path) {
                setSaveState(document ? 'blocked' : 'idle');
                return;
            }
            try {
                await saveMissionDocument(document, path);
                if (snapshotDocument(workingRef.current) !== snapshotDocument(document)) {
                    return;
                }
                lastSavedRef.current = snapshotDocument(document);
                setDirty(false);
                setSaveState('saved');
            } catch (cause: unknown) {
                setSaveState('error');
                setNoticeKey('tool.saveFailed');
                setNoticeParams({
                    error: cause instanceof Error ? cause.message : 'save failed',
                });
            }
        };
        const autosave = createAutosave(() => {
            void persist();
        }, 800);
        autosaveRef.current = autosave;
        return () => autosave.cancel();
    }, []);

    useEffect(() => {
        if (!dirty || toolBlocksAutosave(tool) || selectionDragRef.current) {
            return;
        }
        if (!working) {
            setSaveState('idle');
            return;
        }
        if (!missions.activePath) {
            if (!savingRef.current) {
                setSaveState('blocked');
            }
            return;
        }
        setSaveState('saving');
        autosaveRef.current.schedule();
    }, [dirty, missions.activePath, tool, working]);

    const sectionCount = working?.points.length ?? 0;
    useEffect(() => {
        const clamp = (current: number[]) => {
            const next = current.filter((index) => index >= 0 && index < sectionCount);
            return next.length === current.length ? current : next;
        };
        setHiddenIndices(clamp);
        setLockedIndices(clamp);
    }, [sectionCount]);
    const pointCount = getTotalPointsCount(working);
    const start = draft[0];
    const end = draft[1];
    const rulerDistance =
        tool === 'ruler' && start && end
            ? formatDistanceMeters(getDistanceMeters(start, end))
            : null;

    const adopt = useCallback(
        (path: string, payload?: unknown) => {
            missions.adopt(path, payload);
            setMissionFitNonce((value) => value + 1);
        },
        [missions],
    );

    return {
        ...missions,
        adopt,
        document: working,
        missionFitNonce,
        dirty,
        saveState,
        tool,
        draft,
        selectedIndices,
        hiddenIndices,
        lockedIndices,
        selectedGeofenceId,
        hiddenGeofenceIds,
        lockedGeofenceIds,
        extendDirection,
        moveStep,
        rotationStep,
        duplicateCount,
        duplicateDistance,
        duplicateSide,
        rulerDistance,
        canUndo,
        canRedo,
        setInteractive,
        noticeKey,
        noticeParams,
        sectionCount,
        pointCount,
        startDrawLine,
        startDrawPolygon,
        startFillParcel,
        acceptFillGeofence,
        declineFillGeofence,
        fillGeofencePrompt,
        setFillGeofencePrompt,
        startWorkingZone,
        startDeleteZone,
        startConnectTurns,
        startConnectEnds,
        startSelectZone,
        zoneRing,
        zoneMode,
        setZoneMode,
        zoneWorkingOn,
        zoneSpeedDraft,
        setZoneSpeedDraft,
        applyZoneCut,
        applyZoneWorking,
        applyZoneSpeed,
        connectPicked: [connectFirst, connectSecond].filter(Boolean).length,
        connectFirst,
        connectSecond,
        connectKind,
        setConnectKind,
        requestConnectEnds,
        finishConnectEnds,
        freeStyleOpen,
        setFreeStyleOpen,
        selectIndices,
        reorderSelected,
        reorderTo,
        toggleHidden,
        toggleLocked,
        selectGeofence,
        toggleGeofenceHidden,
        toggleGeofenceLocked,
        startGeofenceExclusion,
        startSelectPolygon,
        startRuler,
        startEditSpeed,
        addVertex,
        handleMapClick,
        insertVertex,
        moveVertex,
        finishDrawLine,
        finishDrawPolygon,
        finishGeofenceEdit,
        finishFillParcel,
        finishWorkingZone,
        finishDeleteZone,
        finishConnectTurns,
        finishEditSpeed,
        finishCurrent,
        reverseSelected,
        deleteSelected,
        deleteSection,
        deleteGeofenceExclusion,
        moveSelected,
        rotateSelected,
        duplicateSelected,
        startExtend,
        cancelExtend,
        beginSelectionDrag,
        updateSelectionDrag,
        finishSelectionDrag,
        cancelSelectionDrag,
        hitSelectedSection,
        startOffset,
        finishOffset,
        applyGeneratedDocument,
        startNewDocument,
        saveNow,
        cancelTool,
        undo,
        redo,
        parcelDialogOpen,
        setParcelDialogOpen,
        rowSpacing,
        setRowSpacing,
        coverageStrategy,
        setCoverageStrategy,
        headlandWidth,
        setHeadlandWidth,
        connectAfterFill,
        setConnectAfterFill,
        coverageVariants,
        coverageVariantsLoading,
        coveragePreview,
        turnsDialogOpen,
        setTurnsDialogOpen,
        turnsParams,
        setTurnsParams,
        speedDialogOpen,
        setSpeedDialogOpen,
        speedValue,
        setSpeedValue,
        offsetDialogOpen,
        setOffsetDialogOpen,
        offsetDistance,
        setOffsetDistance,
        offsetSide,
        setOffsetSide,
        setMoveStep,
        setRotationStep,
        setDuplicateCount,
        setDuplicateDistance,
        setDuplicateSide,
    };
}
