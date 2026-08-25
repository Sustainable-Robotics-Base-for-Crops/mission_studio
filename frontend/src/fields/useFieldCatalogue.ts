import { useCallback, useEffect, useRef, useState } from 'react';

import { getDistanceMeters, type LatLng } from '../domain/geometry';
import { insertDraftVertex, moveDraftVertex } from '../map/draft-hit';
import {
    addGuidanceLine,
    addLandmark,
    addObstacle,
    addRow,
    addTrafficNode,
    addTrafficWay,
    addZone,
    createField,
    createRowSet,
    deleteField,
    deleteGuidanceLine,
    deleteLandmark,
    deleteObstacle,
    deleteRow,
    deleteRowSet,
    deleteTrafficNode,
    deleteTrafficWay,
    deleteZone,
    fetchFieldsHealth,
    getField,
    getImpact,
    exportField,
    importGeoJSON,
    linkMission,
    listFields,
    listVersions,
    patchField,
    patchGuidanceLine,
    patchLandmark,
    patchObstacle,
    patchRow,
    patchTrafficNode,
    patchTrafficWay,
    patchZone,
    diffVersions,
} from './api';
import { fieldsDrawKind, fieldsDrawTarget } from './draw-target';
import { drawKindFromGeometry, toolFromDrawKind, verticesFromGeometry } from './edit-geometry';
import {
    EMPTY_FIELDS_HISTORY,
    recordFieldsAction,
    takeFieldsRedo,
    takeFieldsUndo,
    type FieldsAction,
    type FieldsHistory,
} from './history';
import {
    childrenFromField,
    emptyFieldChildren,
    geojsonDownloadName,
    hitCatalogue,
    lineFromDraft,
    pointFromDraft,
    ringFromDraft,
    type FieldChildren,
} from './geojson';
import { rowsFromFieldAndAxis, bedsFromFieldAndAxis, DEFAULT_BED_WIDTH_M } from './rows';
import { duplicateLineString } from './sweep';
import { DEFAULT_PATH_WIDTH_M } from './useFieldsFollowUpForm';
import {
    FIELD_GEOFENCE_KIND,
    fieldLineDraftName,
    findGeofenceZone,
    lassoHitsInRing,
    nextFreeRowNumber,
    resolveFieldDraftCommit,
    type FieldLassoHit,
    type FieldsLineKind,
} from './edit-tools';
import { cutGeometryByLasso, lassoRingToLatLngs } from './lasso-cut';
import { offsetLatLngRing } from '../domain/polygon-offset';
import { ringFromPolygon } from '../missions/brief';
import { DEFAULT_FIELD_GEOFENCE_INSET_CM } from '../missions/from-field';
import {
    canPinLandmark,
    circleRing,
    DEFAULT_CIRCLE_RADIUS_M,
    formatLandmarkMeters,
    applyLandmarkClick,
    circleCenterFromGeometry,
    circlePolygon,
    landmarkDefaultName,
    landmarkGeometry,
    landmarkLiveMeasure,
    previewDraft,
} from './landmarks';
import type {
    FieldDetail,
    FieldDiff,
    FieldGuidanceLine,
    FieldImpact,
    FieldLandmark,
    FieldRow,
    FieldSummary,
    FieldVersion,
    FieldsNavId,
    GeoJSONLineString,
    GeoJSONPoint,
    GeoJSONPolygon,
    LandmarkKind,
    TrafficDrawKind,
    ZoneKind,
} from './types';

export type FieldsTool =
    'select' | 'select_polygon' | 'draw_polygon' | 'draw_line' | 'draw_point' | 'ruler';

export type FieldsEditIntent =
    'none' | 'geofence' | 'surface' | 'polyline' | 'lasso' | 'create_field' | 'landmark';

export type FieldsFollowUp = 'duplicate_row' | 'duplicate_bed' | 'path_width' | null;

export type FieldFocus =
    | { kind: 'field'; id: string }
    | { kind: 'zone'; fieldId: string; id: string }
    | { kind: 'obstacle'; fieldId: string; id: string }
    | { kind: 'guidance'; fieldId: string; id: string }
    | { kind: 'row'; fieldId: string; rowSetId: string; id: string }
    | { kind: 'traffic_way'; fieldId: string; id: string }
    | { kind: 'traffic_node'; fieldId: string; id: string }
    | { kind: 'landmark'; fieldId: string; id: string }
    | {
          kind: 'draft';
          target:
              | 'field'
              | 'zone'
              | 'obstacle'
              | 'guidance'
              | 'traffic_way'
              | 'traffic_node'
              | 'landmark';
      };

function catalogueError(reason: unknown): string {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (message === 'field not found' || message.includes('field not found')) {
        return 'fields.error.notFound';
    }
    return message;
}

function defaultDraftName(nav: FieldsNavId, trafficKind: TrafficDrawKind = 'path'): string {
    if (nav === 'zones') {
        return 'Nouvelle zone';
    }
    if (nav === 'obstacles') {
        return 'Nouvel obstacle';
    }
    if (nav === 'guidance') {
        return 'Nouvelle ligne AB';
    }
    if (nav === 'traffic') {
        if (trafficKind === 'path') {
            return 'Nouveau chemin';
        }
        if (trafficKind === 'gate') {
            return 'Nouvelle porte';
        }
        if (trafficKind === 'service') {
            return 'Point de service';
        }
        if (trafficKind === 'stop') {
            return 'Nouvel arrêt';
        }
        return 'Nouvelle intersection';
    }
    return 'Nouvelle parcelle';
}

function featureIdFromFocus(focus: FieldFocus | null): string | null {
    if (!focus || focus.kind === 'draft') {
        return null;
    }
    return focus.id;
}

function focusFromHit(hit: {
    type: string;
    fieldId: string;
    id?: string;
    rowSetId?: string;
}): FieldFocus {
    if (hit.type === 'field') {
        return { kind: 'field', id: hit.fieldId };
    }
    if (hit.type === 'row') {
        return {
            kind: 'row',
            fieldId: hit.fieldId,
            rowSetId: hit.rowSetId as string,
            id: hit.id as string,
        };
    }
    return {
        kind: hit.type as
            'zone' | 'obstacle' | 'guidance' | 'traffic_way' | 'traffic_node' | 'landmark',
        fieldId: hit.fieldId,
        id: hit.id as string,
    };
}

function geometryOfFocus(
    current: FieldFocus,
    listed: FieldSummary[],
    detail: FieldDetail | null,
    childrenByField: Record<string, FieldChildren>,
): { type?: string; coordinates?: unknown } | null {
    if (current.kind === 'draft') {
        return null;
    }
    if (current.kind === 'field') {
        return (
            listed.find((field) => field.id === current.id)?.geometry ??
            (detail?.id === current.id ? detail.geometry : null)
        );
    }
    const children =
        childrenByField[current.fieldId] ??
        (detail?.id === current.fieldId ? childrenFromField(detail) : null);
    if (!children) {
        return null;
    }
    if (current.kind === 'zone') {
        return children.zones.find((zone) => zone.id === current.id)?.geometry ?? null;
    }
    if (current.kind === 'obstacle') {
        return children.obstacles.find((item) => item.id === current.id)?.geometry ?? null;
    }
    if (current.kind === 'guidance') {
        return children.guidance_lines?.find((item) => item.id === current.id)?.geometry ?? null;
    }
    if (current.kind === 'traffic_way') {
        return children.traffic_ways?.find((item) => item.id === current.id)?.geometry ?? null;
    }
    if (current.kind === 'traffic_node') {
        return children.traffic_nodes?.find((item) => item.id === current.id)?.geometry ?? null;
    }
    if (current.kind === 'landmark') {
        return children.landmarks?.find((item) => item.id === current.id)?.geometry ?? null;
    }
    for (const rowSet of children.row_sets ?? []) {
        const row = (rowSet.rows ?? []).find((item) => item.id === current.id);
        if (row) {
            return row.geometry;
        }
    }
    return null;
}

export function useFieldCatalogue(): {
    available: boolean;
    loading: boolean;
    error: string | null;
    nav: FieldsNavId;
    setNav: (id: FieldsNavId) => void;
    fields: FieldSummary[];
    selectedId: string | null;
    selected: FieldDetail | null;
    focus: FieldFocus | null;
    selectedFeatureId: string | null;
    versions: FieldVersion[];
    diff: FieldDiff | null;
    impact: FieldImpact | null;
    tool: FieldsTool;
    draft: LatLng[];
    newName: string;
    setNewName: (value: string) => void;
    zoneKind: ZoneKind;
    setZoneKind: (kind: ZoneKind) => void;
    trafficKind: TrafficDrawKind;
    setTrafficKind: (kind: TrafficDrawKind) => void;
    select: (id: string | null, options?: { fit?: boolean; focus?: FieldFocus }) => void;
    setTool: (tool: FieldsTool) => void;
    startDraw: () => boolean;
    beginEditGeometry: (nextFocus?: FieldFocus | null) => boolean;
    setInteractive: (value: boolean) => void;
    handleMapClick: (lngLat: [number, number]) => void;
    handleMapDblClick: (lngLat: [number, number]) => void;
    insertVertex: (afterIndex: number, lngLat: [number, number]) => void;
    moveVertex: (index: number, lngLat: [number, number]) => void;
    finishDraft: (fromPoints?: LatLng[]) => Promise<void>;
    cancelDraft: () => void;
    saveSelected: (patch: Record<string, unknown>) => Promise<boolean>;
    deleteFocused: () => Promise<void>;
    /** Delete one object of the tree; undoable for everything but a whole field. */
    deleteEntity: (target?: FieldFocus | null) => Promise<void>;
    importFile: (file: File) => Promise<void>;
    exportSelected: () => Promise<void>;
    linkCurrentMission: (path: string) => Promise<void>;
    addAutonomyZone: () => Promise<void>;
    generateRowSet: (options: {
        axisLineId: string;
        spacingM?: number;
        name?: string;
        kind?: 'rows' | 'beds';
        widthM?: number;
        pathM?: number;
        count?: number;
    }) => Promise<void>;
    deleteFocusedRowSet: () => Promise<void>;
    reload: () => Promise<void>;
    cameraTargetId: string | null;
    cameraNonce: number;
    childrenByField: Record<string, FieldChildren>;
    editingGeometry: boolean;
    editIntent: FieldsEditIntent;
    lineKind: FieldsLineKind;
    setLineKind: (kind: FieldsLineKind) => void;
    cropName: string;
    setCropName: (value: string) => void;
    lassoHits: FieldLassoHit[];
    lassoOverlay: LatLng[];
    followUp: FieldsFollowUp;
    geofenceZoneId: string | null;
    startCreateField: (name: string) => boolean;
    startSelectEntity: () => void;
    startLasso: () => boolean;
    startPolyline: () => boolean;
    startSurface: () => boolean;
    /** Draw a forbidden island inside the geofence, as the mission tree does. */
    startExclusionZone: () => boolean;
    startGeofenceDraw: () => boolean;
    startRuler: () => boolean;
    landmarkKind: LandmarkKind;
    setLandmarkKind: (kind: LandmarkKind) => void;
    circleRadiusM: string;
    setCircleRadiusM: (value: string) => void;
    previewDraft: LatLng[];
    landmarkMeasure: ReturnType<typeof landmarkLiveMeasure>;
    landmarkCaption: string | null;
    circlePreview: LatLng[];
    landmarkHover: LatLng | null;
    canPinLandmark: boolean;
    pinLandmark: () => Promise<void>;
    handleMapHover: (lngLat: [number, number] | null) => void;
    updateCircleRadius: (value: string) => void;
    applyGeofenceFromBoundary: (insetCm?: number) => Promise<void>;
    deleteGeofence: () => Promise<void>;
    selectExistingGeofence: () => boolean;
    applyFollowUp: (options: {
        count: number;
        spacingM: number;
        side: 'left' | 'right';
        bedWidthM?: number;
        pathWidthM?: number;
    }) => Promise<void>;
    dismissFollowUp: () => void;
    deleteLassoHits: () => Promise<void>;
    cutLassoHits: () => Promise<void>;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    /** What Ctrl+Z would take back, once the draft itself is empty. */
    undoLabelKey: string | null;
    /** Objects the operator hid from the map; the catalogue itself is untouched. */
    hiddenIds: string[];
    /** Objects the operator locked: still visible, no longer editable. */
    lockedIds: string[];
    toggleHidden: (id: string) => void;
    toggleLocked: (id: string) => void;
} {
    const [available, setAvailable] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [nav, setNavState] = useState<FieldsNavId>('parcels');
    const [fields, setFields] = useState<FieldSummary[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selected, setSelected] = useState<FieldDetail | null>(null);
    const [focus, setFocus] = useState<FieldFocus | null>(null);
    const [versions, setVersions] = useState<FieldVersion[]>([]);
    const [diff, setDiff] = useState<FieldDiff | null>(null);
    const [impact, setImpact] = useState<FieldImpact | null>(null);
    const [tool, setTool] = useState<FieldsTool>('select');
    const [draft, setDraft] = useState<LatLng[]>([]);
    const [newName, setNewName] = useState('Nouvelle parcelle');
    const [zoneKind, setZoneKind] = useState<ZoneKind>('agronomic_boundary');
    const [trafficKind, setTrafficKindState] = useState<TrafficDrawKind>('path');
    const [cameraTargetId, setCameraTargetId] = useState<string | null>(null);
    const [cameraNonce, setCameraNonce] = useState(0);
    const [childrenByField, setChildrenByField] = useState<Record<string, FieldChildren>>({});
    const [editingGeometry, setEditingGeometry] = useState(false);
    const [editIntent, setEditIntent] = useState<FieldsEditIntent>('none');
    const [landmarkKind, setLandmarkKindState] = useState<LandmarkKind>('measure');
    const [landmarkReady, setLandmarkReady] = useState(false);
    const [circleRadiusM, setCircleRadiusM] = useState(String(DEFAULT_CIRCLE_RADIUS_M));
    const [hoverLngLat, setHoverLngLat] = useState<LatLng | null>(null);
    const [lineKind, setLineKindState] = useState<FieldsLineKind>('perennial');
    const [cropName, setCropName] = useState('Vigne');
    const [lassoHits, setLassoHits] = useState<FieldLassoHit[]>([]);
    const [lassoRing, setLassoRing] = useState<GeoJSONPolygon | null>(null);
    const [hiddenIds, setHiddenIds] = useState<string[]>([]);
    const [lockedIds, setLockedIds] = useState<string[]>([]);
    const [followUp, setFollowUp] = useState<FieldsFollowUp>(null);
    const [followUpLine, setFollowUpLine] = useState<GeoJSONLineString | null>(null);
    /** Entity the follow-up applies to: the traffic way to widen, or the drawn guidance line. */
    const [followUpId, setFollowUpId] = useState<string | null>(null);
    const [draftRedo, setDraftRedo] = useState<LatLng[]>([]);
    const [history, setHistory] = useState<FieldsHistory>(EMPTY_FIELDS_HISTORY);
    const interactiveRef = useRef(true);
    const finishingRef = useRef(false);
    const fieldsRef = useRef(fields);
    fieldsRef.current = fields;
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const historyRef = useRef(history);
    historyRef.current = history;
    /** One compensating call at a time: undo hits the server, spamming Ctrl+Z must not. */
    const historyBusyRef = useRef(false);
    /** Identity of the line the pending follow-up works on, kept fresh across undo/redo. */
    const followUpHandleRef = useRef<{ id: string } | null>(null);

    const reload = useCallback(async () => {
        const health = await fetchFieldsHealth();
        if (!health?.sqlite) {
            setAvailable(false);
            setFields([]);
            setSelected(null);
            setLoading(false);
            return;
        }
        setAvailable(true);
        const listed = await listFields();
        setFields(listed);
        setLoading(false);
    }, []);

    useEffect(() => {
        reload().catch((reason: unknown) => {
            setError(catalogueError(reason));
            setLoading(false);
        });
    }, [reload]);

    const setNav = useCallback(
        (id: FieldsNavId) => {
            setNavState(id);
            setNewName(defaultDraftName(id, trafficKind));
            setError(null);
            setDraft([]);
            setTool('select');
            setEditingGeometry(false);
            setEditIntent('none');
            setLassoHits([]);
            setLassoRing(null);
            setFollowUp(null);
            setFocus((current) => (current?.kind === 'draft' ? null : current));
        },
        [trafficKind],
    );

    const setTrafficKind = useCallback((kind: TrafficDrawKind) => {
        setTrafficKindState(kind);
        setNewName(defaultDraftName('traffic', kind));
    }, []);

    /** Switching the polyline type renames the draft, so a path is never a "parcelle". */
    const setLineKind = useCallback((kind: FieldsLineKind) => {
        setLineKindState(kind);
        setNewName(fieldLineDraftName(kind));
        setFocus((current) =>
            current?.kind === 'draft' &&
            (current.target === 'guidance' || current.target === 'traffic_way')
                ? { kind: 'draft', target: kind === 'path' ? 'traffic_way' : 'guidance' }
                : current,
        );
    }, []);

    const select = useCallback(
        async (id: string | null, options?: { fit?: boolean; focus?: FieldFocus }) => {
            setSelectedId(id);
            setDiff(null);
            setError(null);
            if (options?.focus) {
                setFocus(options.focus);
            } else if (id) {
                setFocus({ kind: 'field', id });
            } else {
                setFocus(null);
            }
            if (options?.fit && id) {
                const cameraId =
                    options.focus && options.focus.kind !== 'draft' ? options.focus.id : id;
                setCameraTargetId(cameraId);
                setCameraNonce((value) => value + 1);
            }
            if (!id) {
                setSelected(null);
                setVersions([]);
                setImpact(null);
                return;
            }
            try {
                const [field, vers, nextImpact] = await Promise.all([
                    getField(id),
                    listVersions(id),
                    getImpact(id),
                ]);
                setSelected(field);
                setChildrenByField((current) => ({
                    ...current,
                    [field.id]: childrenFromField(field),
                }));
                setVersions(vers);
                setImpact(nextImpact);
                if (vers.length >= 2) {
                    const latest = vers[vers.length - 1]?.version;
                    const previous = vers[vers.length - 2]?.version;
                    if (latest && previous) {
                        setDiff(await diffVersions(id, previous, latest));
                    }
                }
            } catch (reason: unknown) {
                const message = catalogueError(reason);
                setError(message);
                if (
                    message === 'fields.error.notFound' &&
                    !fieldsRef.current.some((field) => field.id === id)
                ) {
                    setSelected(null);
                    setSelectedId(null);
                    setFocus(null);
                    setVersions([]);
                    setImpact(null);
                }
            }
        },
        [],
    );

    const recordAction = useCallback((action: FieldsAction) => {
        setHistory((current) => recordFieldsAction(current, action));
    }, []);

    /**
     * Undo a creation by deleting it, redo by creating it again. The server hands
     * out a new identifier on every redo, so the returned handle — shared with the
     * follow-up recorded just after — is what every closure reads.
     */
    const recordCreation = useCallback(
        (creation: {
            labelKey: string;
            fieldId: string;
            id: string;
            kind: 'zone' | 'obstacle' | 'guidance' | 'traffic_way' | 'traffic_node' | 'landmark';
            create: () => Promise<{ id: string }>;
            remove: (fieldId: string, id: string) => Promise<unknown>;
        }): { id: string } => {
            const handle = { id: creation.id };
            recordAction({
                labelKey: creation.labelKey,
                undo: async () => {
                    await creation.remove(creation.fieldId, handle.id);
                    await select(creation.fieldId, {
                        focus: { kind: 'field', id: creation.fieldId },
                    });
                },
                redo: async () => {
                    const again = await creation.create();
                    handle.id = again.id;
                    await select(creation.fieldId, {
                        focus: { kind: creation.kind, fieldId: creation.fieldId, id: again.id },
                    });
                },
            });
            return handle;
        },
        [recordAction, select],
    );

    const runHistory = useCallback(async (direction: 'undo' | 'redo') => {
        if (historyBusyRef.current) {
            return;
        }
        const taken =
            direction === 'undo'
                ? takeFieldsUndo(historyRef.current)
                : takeFieldsRedo(historyRef.current);
        if (!taken.action) {
            return;
        }
        historyBusyRef.current = true;
        historyRef.current = taken.history;
        setHistory(taken.history);
        setFollowUp(null);
        setFollowUpLine(null);
        setFollowUpId(null);
        try {
            await (direction === 'undo' ? taken.action.undo() : taken.action.redo());
            setError(null);
        } catch (reason: unknown) {
            setError(catalogueError(reason));
        } finally {
            historyBusyRef.current = false;
        }
    }, []);

    const startDraw = useCallback((): boolean => {
        const target = fieldsDrawTarget(nav, trafficKind);
        if (target === null) {
            setError('fields.error.notDrawable');
            return false;
        }
        if (target !== 'field' && !selectedId) {
            setError('fields.error.needField');
            return false;
        }
        const kind = fieldsDrawKind(nav, trafficKind);
        setError(null);
        setEditingGeometry(false);
        setTool(kind === 'line' ? 'draw_line' : kind === 'point' ? 'draw_point' : 'draw_polygon');
        setFocus({ kind: 'draft', target });
        setEditIntent(target === 'field' ? 'create_field' : 'none');
        return true;
    }, [nav, selectedId, trafficKind]);

    const startCreateField = useCallback((name: string) => {
        setNewName(name);
        setNavState('parcels');
        setError(null);
        setEditingGeometry(false);
        setFollowUp(null);
        setLassoHits([]);
        setLassoRing(null);
        setDraft([]);
        setDraftRedo([]);
        setEditIntent('create_field');
        setTool('draw_polygon');
        setFocus({ kind: 'draft', target: 'field' });
        return true;
    }, []);

    const startSelectEntity = useCallback(() => {
        setTool('select');
        setEditIntent('none');
        setDraft([]);
        setFollowUp(null);
        setLassoHits([]);
        setLassoRing(null);
        setLandmarkReady(false);
        setEditingGeometry(false);
    }, []);

    const startLasso = useCallback(() => {
        if (!selectedId) {
            setError('fields.error.needField');
            return false;
        }
        setError(null);
        setFollowUp(null);
        setLassoHits([]);
        setLassoRing(null);
        setDraft([]);
        setDraftRedo([]);
        setEditingGeometry(false);
        setEditIntent('lasso');
        setTool('select_polygon');
        return true;
    }, [selectedId]);

    const startPolyline = useCallback(() => {
        if (!selectedId) {
            setError('fields.error.needField');
            return false;
        }
        setError(null);
        setFollowUp(null);
        setDraft([]);
        setDraftRedo([]);
        setEditingGeometry(false);
        setEditIntent('polyline');
        setTool('draw_line');
        setNewName(fieldLineDraftName(lineKind));
        setFocus({ kind: 'draft', target: lineKind === 'path' ? 'traffic_way' : 'guidance' });
        return true;
    }, [lineKind, selectedId]);

    const startSurface = useCallback(() => {
        if (!selectedId) {
            setError('fields.error.needField');
            return false;
        }
        setError(null);
        setFollowUp(null);
        setDraft([]);
        setDraftRedo([]);
        setEditingGeometry(false);
        setEditIntent('surface');
        setZoneKind('workable');
        setNewName(defaultDraftName('zones'));
        setTool('draw_polygon');
        setFocus({ kind: 'draft', target: 'zone' });
        return true;
    }, [selectedId]);

    /**
     * Parcellaire twin of the mission geofence exclusion: an island the robot must
     * avoid inside the fence is stored as a forbidden zone, which is what
     * `exclusionRingsFromField` turns back into an exclusion when a mission is composed.
     */
    const startExclusionZone = useCallback(() => {
        if (!selectedId) {
            setError('fields.error.needField');
            return false;
        }
        setError(null);
        setFollowUp(null);
        setDraft([]);
        setDraftRedo([]);
        setEditingGeometry(false);
        setEditIntent('surface');
        setZoneKind('forbidden');
        setNewName('Zone d’exclusion');
        setTool('draw_polygon');
        setFocus({ kind: 'draft', target: 'zone' });
        return true;
    }, [selectedId]);

    const startGeofenceDraw = useCallback(() => {
        if (!selectedId) {
            setError('fields.error.needField');
            return false;
        }
        setError(null);
        setFollowUp(null);
        setDraft([]);
        setDraftRedo([]);
        setEditingGeometry(false);
        setEditIntent('geofence');
        setZoneKind(FIELD_GEOFENCE_KIND);
        setNewName('Géo-clôture');
        setTool('draw_polygon');
        setFocus({ kind: 'draft', target: 'zone' });
        return true;
    }, [selectedId]);

    const startRuler = useCallback(() => {
        if (!selectedId) {
            setError('fields.error.needField');
            return false;
        }
        setError(null);
        setFollowUp(null);
        setDraft([]);
        setDraftRedo([]);
        setHoverLngLat(null);
        setLandmarkReady(false);
        setEditingGeometry(false);
        setEditIntent('landmark');
        setLandmarkKindState('measure');
        setNewName(landmarkDefaultName('measure'));
        setTool('ruler');
        setFocus({ kind: 'draft', target: 'landmark' });
        return true;
    }, [selectedId]);

    const setLandmarkKind = useCallback((kind: LandmarkKind) => {
        setLandmarkKindState(kind);
        setDraft([]);
        setDraftRedo([]);
        setHoverLngLat(null);
        setLandmarkReady(false);
        setNewName(landmarkDefaultName(kind));
        setFocus({ kind: 'draft', target: 'landmark' });
    }, []);

    const applyGeofenceFromBoundary = useCallback(
        async (insetCm = DEFAULT_FIELD_GEOFENCE_INSET_CM) => {
            if (!selectedId || !selected) {
                setError('fields.error.needField');
                return;
            }
            const boundary = ringFromPolygon(selected.geometry);
            if (boundary.length < 3) {
                setError('fields.error.notEditable');
                return;
            }
            const insetM = Math.max(0, insetCm) / 100;
            const exterior =
                insetM > 0 ? (offsetLatLngRing(boundary, insetM) ?? boundary) : boundary;
            const geometry = ringFromDraft(exterior);
            if (!geometry) {
                setError('fields.error.tooFewPoints');
                return;
            }
            try {
                setZoneKind(FIELD_GEOFENCE_KIND);
                const zone = await addZone(selectedId, {
                    kind: FIELD_GEOFENCE_KIND,
                    geometry,
                    name: 'Géo-clôture',
                });
                await select(selectedId, {
                    focus: { kind: 'zone', fieldId: selectedId, id: zone.id },
                });
                setEditIntent('geofence');
                setTool('select');
            } catch (reason: unknown) {
                setError(catalogueError(reason));
            }
        },
        [select, selected, selectedId],
    );

    const deleteGeofence = useCallback(async () => {
        const zone = findGeofenceZone(selected?.zones);
        if (!selectedId || !zone) {
            return;
        }
        try {
            await deleteZone(selectedId, zone.id);
            setEditIntent('none');
            await select(selectedId, { focus: { kind: 'field', id: selectedId } });
        } catch (reason: unknown) {
            setError(catalogueError(reason));
        }
    }, [select, selected, selectedId]);

    const finishDraftRef = useRef<(fromPoints?: LatLng[]) => Promise<void>>(async () => undefined);
    const pinLandmarkFromRef = useRef<
        (kind: LandmarkKind, points: LatLng[], radiusM: number) => Promise<void>
    >(async () => undefined);
    const saveSelectedRef = useRef<(patch: Record<string, unknown>) => Promise<boolean>>(
        async () => false,
    );

    const setInteractive = useCallback((value: boolean) => {
        interactiveRef.current = value;
    }, []);

    const toggleHidden = useCallback((id: string) => {
        setHiddenIds((current) =>
            current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
        );
    }, []);

    const toggleLocked = useCallback((id: string) => {
        setLockedIds((current) =>
            current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
        );
    }, []);

    const beginEditGeometry = useCallback(
        (nextFocus?: FieldFocus | null): boolean => {
            if (!interactiveRef.current) {
                return false;
            }
            const current = nextFocus && nextFocus.kind !== 'draft' ? nextFocus : focus;
            if (!current || current.kind === 'draft') {
                setError('fields.error.needSelection');
                return false;
            }
            if (lockedIds.includes(current.id)) {
                setError('fields.error.locked');
                return false;
            }
            const fieldId = current.kind === 'field' ? current.id : current.fieldId;
            if (current.kind === 'landmark') {
                const landmark = (
                    childrenByField[current.fieldId]?.landmarks ??
                    selected?.landmarks ??
                    []
                ).find((item) => item.id === current.id);
                if (landmark?.kind === 'circle') {
                    const center = circleCenterFromGeometry(landmark.geometry);
                    if (!center) {
                        setError('fields.error.notEditable');
                        return false;
                    }
                    setFocus(current);
                    setSelectedId(fieldId);
                    setDraft([center]);
                    setCircleRadiusM(
                        landmark.radius_m != null && landmark.radius_m > 0
                            ? String(landmark.radius_m)
                            : String(DEFAULT_CIRCLE_RADIUS_M),
                    );
                    setNewName(landmark.name ?? landmarkDefaultName('circle'));
                    setLandmarkKindState('circle');
                    setLandmarkReady(true);
                    setHoverLngLat(null);
                    setTool('ruler');
                    setEditIntent('landmark');
                    setEditingGeometry(true);
                    setError(null);
                    return true;
                }
            }
            const geometry = geometryOfFocus(current, fields, selected, childrenByField);
            const vertices = verticesFromGeometry(geometry);
            const kind = drawKindFromGeometry(geometry);
            if (!vertices || !kind) {
                setError('fields.error.notEditable');
                return false;
            }
            setFocus(current);
            setSelectedId(fieldId);
            setDraft(vertices);
            setTool(toolFromDrawKind(kind));
            setEditingGeometry(true);
            setEditIntent('none');
            setError(null);
            return true;
        },
        [childrenByField, fields, focus, lockedIds, selected],
    );

    const handleMapClick = useCallback(
        (lngLat: [number, number]) => {
            if (!interactiveRef.current) {
                return;
            }
            if (tool === 'ruler') {
                const point = { lng: lngLat[0], lat: lngLat[1] };
                const next = applyLandmarkClick(
                    landmarkKind,
                    draft,
                    point,
                    Number(circleRadiusM),
                    landmarkReady,
                    !editingGeometry,
                );
                setDraft(next.draft);
                setDraftRedo([]);
                setLandmarkReady(next.ready);
                if (landmarkKind === 'circle') {
                    setCircleRadiusM(next.radiusM.toFixed(1));
                }
                return;
            }
            if (tool === 'draw_polygon' || tool === 'draw_line' || tool === 'select_polygon') {
                setDraft((current) => [...current, { lng: lngLat[0], lat: lngLat[1] }]);
                setDraftRedo([]);
                return;
            }
            if (tool === 'draw_point') {
                if (editingGeometry) {
                    return;
                }
                void finishDraftRef.current([{ lng: lngLat[0], lat: lngLat[1] }]);
                return;
            }
            const hit = hitCatalogue(fields, childrenByField, lngLat[0], lngLat[1]);
            if (!hit) {
                return;
            }
            if (hit.type === 'field') {
                void select(hit.fieldId, { focus: { kind: 'field', id: hit.fieldId } });
                return;
            }
            if (hit.type === 'row') {
                void select(hit.fieldId, {
                    focus: {
                        kind: 'row',
                        fieldId: hit.fieldId,
                        rowSetId: hit.rowSetId,
                        id: hit.id,
                    },
                });
                return;
            }
            void select(hit.fieldId, {
                focus: { kind: hit.type, fieldId: hit.fieldId, id: hit.id },
            });
        },
        [
            childrenByField,
            circleRadiusM,
            draft,
            editingGeometry,
            fields,
            landmarkKind,
            landmarkReady,
            select,
            tool,
        ],
    );

    const handleMapDblClick = useCallback(
        (lngLat: [number, number]) => {
            if (!interactiveRef.current || tool !== 'select') {
                return;
            }
            const hit = hitCatalogue(fields, childrenByField, lngLat[0], lngLat[1]);
            if (!hit) {
                return;
            }
            beginEditGeometry(focusFromHit(hit));
        },
        [beginEditGeometry, childrenByField, fields, tool],
    );

    const insertVertex = useCallback((afterIndex: number, lngLat: [number, number]) => {
        if (!interactiveRef.current) {
            return;
        }
        setDraft((points) =>
            insertDraftVertex(points, afterIndex, { lat: lngLat[1], lng: lngLat[0] }),
        );
    }, []);

    const moveVertex = useCallback((index: number, lngLat: [number, number]) => {
        if (!interactiveRef.current) {
            return;
        }
        setDraft((points) => moveDraftVertex(points, index, { lat: lngLat[1], lng: lngLat[0] }));
    }, []);

    const finishDraft = useCallback(
        async (fromPoints?: LatLng[]) => {
            if (!interactiveRef.current || finishingRef.current) {
                return;
            }
            finishingRef.current = true;
            try {
                const points = fromPoints ?? draft;
                const commit = resolveFieldDraftCommit({
                    editingGeometry,
                    focusKind: focus?.kind,
                    editIntent,
                    selectedId,
                });
                if (commit.kind === 'patch-focus' || commit.kind === 'patch-selected') {
                    const geometry =
                        tool === 'draw_point'
                            ? pointFromDraft(points)
                            : tool === 'draw_line'
                              ? lineFromDraft(points)
                              : ringFromDraft(points);
                    if (!geometry) {
                        setError(
                            tool === 'draw_point'
                                ? 'fields.error.tooFewPoint'
                                : tool === 'draw_line'
                                  ? 'fields.error.tooFewLinePoints'
                                  : 'fields.error.tooFewPoints',
                        );
                        return;
                    }
                    try {
                        const saved = await saveSelectedRef.current({ geometry });
                        if (!saved) {
                            return;
                        }
                        setEditingGeometry(false);
                        setDraft([]);
                        setTool('select');
                        setError(null);
                    } catch (reason: unknown) {
                        setError(catalogueError(reason));
                    }
                    return;
                }
                if (tool === 'select_polygon') {
                    const ring = ringFromDraft(points);
                    if (!ring || !selectedId) {
                        setError('fields.error.tooFewPoints');
                        return;
                    }
                    setLassoHits(lassoHitsInRing(selectedId, childrenByField[selectedId], ring));
                    setLassoRing(ring);
                    setDraft([]);
                    setTool('select');
                    setEditIntent('lasso');
                    return;
                }
                const target =
                    focus?.kind === 'draft'
                        ? focus.target
                        : editIntent === 'surface' || editIntent === 'geofence'
                          ? 'zone'
                          : editIntent === 'polyline'
                            ? lineKind === 'path'
                                ? 'traffic_way'
                                : 'guidance'
                            : fieldsDrawTarget(nav, trafficKind);
                if (target === null) {
                    setError('fields.error.notDrawable');
                    return;
                }
                const name = newName.trim() || undefined;
                try {
                    if (target === 'guidance' || target === 'traffic_way') {
                        const geometry = lineFromDraft(points);
                        if (!geometry) {
                            setError('fields.error.tooFewLinePoints');
                            return;
                        }
                        if (!selectedId) {
                            setError('fields.error.needField');
                            return;
                        }
                        if (target === 'traffic_way') {
                            const wayName = name || defaultDraftName('traffic', 'path');
                            const way = await addTrafficWay(selectedId, {
                                geometry,
                                name: wayName,
                                kind: 'path',
                            });
                            const stored = {
                                ...way,
                                geometry:
                                    way.geometry?.type === 'LineString' ? way.geometry : geometry,
                            };
                            const nextFocus: FieldFocus = {
                                kind: 'traffic_way',
                                fieldId: selectedId,
                                id: stored.id,
                            };
                            setSelected((current) =>
                                current
                                    ? {
                                          ...current,
                                          traffic_ways: [...(current.traffic_ways ?? []), stored],
                                      }
                                    : current,
                            );
                            setChildrenByField((current) => {
                                const previous = current[selectedId] ?? emptyFieldChildren();
                                return {
                                    ...current,
                                    [selectedId]: {
                                        ...previous,
                                        traffic_ways: [...(previous.traffic_ways ?? []), stored],
                                    },
                                };
                            });
                            setFocus(nextFocus);
                            setDraft([]);
                            setTool('select');
                            setError(null);
                            followUpHandleRef.current = recordCreation({
                                labelKey: 'fields.history.path',
                                fieldId: selectedId,
                                id: stored.id,
                                kind: 'traffic_way',
                                create: () =>
                                    addTrafficWay(selectedId, {
                                        geometry,
                                        name: wayName,
                                        kind: 'path',
                                    }),
                                remove: deleteTrafficWay,
                            });
                            if (editIntent === 'polyline') {
                                setFollowUpLine(geometry);
                                setFollowUpId(stored.id);
                                setFollowUp('path_width');
                            } else {
                                setEditIntent('none');
                            }
                            void select(selectedId, { focus: nextFocus });
                            return;
                        }
                        const lineName = name || defaultDraftName('guidance');
                        const line = await addGuidanceLine(selectedId, {
                            geometry,
                            name: lineName,
                        });
                        const stored = {
                            ...line,
                            geometry:
                                line.geometry?.type === 'LineString' ? line.geometry : geometry,
                        };
                        const nextFocus: FieldFocus = {
                            kind: 'guidance',
                            fieldId: selectedId,
                            id: stored.id,
                        };
                        setSelected((current) =>
                            current
                                ? {
                                      ...current,
                                      guidance_lines: [...(current.guidance_lines ?? []), stored],
                                  }
                                : current,
                        );
                        setChildrenByField((current) => {
                            const previous = current[selectedId] ?? emptyFieldChildren();
                            return {
                                ...current,
                                [selectedId]: {
                                    ...previous,
                                    guidance_lines: [...(previous.guidance_lines ?? []), stored],
                                },
                            };
                        });
                        setFocus(nextFocus);
                        setDraft([]);
                        setTool('select');
                        setError(null);
                        followUpHandleRef.current = recordCreation({
                            labelKey: 'fields.history.line',
                            fieldId: selectedId,
                            id: stored.id,
                            kind: 'guidance',
                            create: () => addGuidanceLine(selectedId, { geometry, name: lineName }),
                            remove: deleteGuidanceLine,
                        });
                        if (editIntent === 'polyline' && lineKind === 'perennial') {
                            setFollowUpLine(geometry);
                            setFollowUpId(stored.id);
                            setFollowUp('duplicate_row');
                        } else if (editIntent === 'polyline' && lineKind === 'bed') {
                            setFollowUpLine(geometry);
                            setFollowUpId(stored.id);
                            setFollowUp('duplicate_bed');
                        } else {
                            setEditIntent('none');
                        }
                        void select(selectedId, { focus: nextFocus });
                        return;
                    }
                    if (target === 'traffic_node') {
                        const geometry = pointFromDraft(points);
                        if (!geometry) {
                            setError('fields.error.tooFewPoint');
                            return;
                        }
                        if (!selectedId) {
                            setError('fields.error.needField');
                            return;
                        }
                        const nodeName = name || defaultDraftName('traffic', trafficKind);
                        const nodePayload = {
                            geometry,
                            name: nodeName,
                            kind: trafficKind,
                        };
                        const node = await addTrafficNode(selectedId, nodePayload);
                        const stored = {
                            ...node,
                            geometry: node.geometry?.type === 'Point' ? node.geometry : geometry,
                        };
                        const nextFocus: FieldFocus = {
                            kind: 'traffic_node',
                            fieldId: selectedId,
                            id: stored.id,
                        };
                        setSelected((current) =>
                            current
                                ? {
                                      ...current,
                                      traffic_nodes: [...(current.traffic_nodes ?? []), stored],
                                  }
                                : current,
                        );
                        setChildrenByField((current) => {
                            const previous = current[selectedId] ?? emptyFieldChildren();
                            return {
                                ...current,
                                [selectedId]: {
                                    ...previous,
                                    traffic_nodes: [...(previous.traffic_nodes ?? []), stored],
                                },
                            };
                        });
                        setFocus(nextFocus);
                        setDraft([]);
                        setTool('select');
                        setError(null);
                        recordCreation({
                            labelKey: 'fields.history.trafficNode',
                            fieldId: selectedId,
                            id: stored.id,
                            kind: 'traffic_node',
                            create: () => addTrafficNode(selectedId, nodePayload),
                            remove: deleteTrafficNode,
                        });
                        void select(selectedId, { focus: nextFocus });
                        return;
                    }
                    const geometry = ringFromDraft(points);
                    if (!geometry) {
                        setError('fields.error.tooFewPoints');
                        return;
                    }
                    if (target === 'field') {
                        if (commit.kind !== 'create-field') {
                            setError('fields.error.notEditable');
                            return;
                        }
                        const fieldPayload = {
                            name: name || defaultDraftName('parcels'),
                            geometry,
                        };
                        const created = await createField(fieldPayload);
                        const fieldGeometry =
                            created.geometry?.type === 'Polygon' ? created.geometry : geometry;
                        const stored = { ...created, geometry: fieldGeometry };
                        setFields((current) =>
                            current.some((field) => field.id === stored.id)
                                ? current.map((field) => (field.id === stored.id ? stored : field))
                                : [...current, stored],
                        );
                        setSelectedId(stored.id);
                        setSelected(stored);
                        setFocus({ kind: 'field', id: stored.id });
                        setChildrenByField((current) => ({
                            ...current,
                            [stored.id]: childrenFromField({
                                zones: stored.zones ?? [],
                                obstacles: stored.obstacles ?? [],
                                guidance_lines: stored.guidance_lines ?? [],
                                row_sets: stored.row_sets ?? [],
                                traffic_ways: stored.traffic_ways ?? [],
                                traffic_nodes: stored.traffic_nodes ?? [],
                            }),
                        }));
                        setDraft([]);
                        setTool('select');
                        setEditIntent('none');
                        setNewName(defaultDraftName('parcels'));
                        setError(null);
                        const fieldHandle = { id: stored.id };
                        recordAction({
                            labelKey: 'fields.history.field',
                            undo: async () => {
                                await deleteField(fieldHandle.id);
                                setFields((current) =>
                                    current.filter((item) => item.id !== fieldHandle.id),
                                );
                                await select(null);
                                await reload();
                            },
                            redo: async () => {
                                const again = await createField(fieldPayload);
                                fieldHandle.id = again.id;
                                await reload();
                                await select(again.id, { fit: true });
                            },
                        });
                        return;
                    }
                    if (!selectedId) {
                        setError('fields.error.needField');
                        return;
                    }
                    if (target === 'zone') {
                        const zonePayload = { kind: zoneKind, geometry, name };
                        const zone = await addZone(selectedId, zonePayload);
                        const stored = {
                            ...zone,
                            kind: zone.kind || zoneKind,
                            geometry: zone.geometry?.type === 'Polygon' ? zone.geometry : geometry,
                        };
                        const nextFocus: FieldFocus = {
                            kind: 'zone',
                            fieldId: selectedId,
                            id: stored.id,
                        };
                        setSelected((current) =>
                            current ? { ...current, zones: [...current.zones, stored] } : current,
                        );
                        setChildrenByField((current) => {
                            const previous = current[selectedId] ?? emptyFieldChildren();
                            return {
                                ...current,
                                [selectedId]: { ...previous, zones: [...previous.zones, stored] },
                            };
                        });
                        setFocus(nextFocus);
                        setDraft([]);
                        setTool('select');
                        setError(null);
                        recordCreation({
                            labelKey: 'fields.history.zone',
                            fieldId: selectedId,
                            id: stored.id,
                            kind: 'zone',
                            create: () => addZone(selectedId, zonePayload),
                            remove: deleteZone,
                        });
                        void select(selectedId, { focus: nextFocus });
                        return;
                    }
                    const obstaclePayload = {
                        geometry,
                        name,
                        category: 'unspecified',
                    };
                    const obstacle = await addObstacle(selectedId, obstaclePayload);
                    const stored = {
                        ...obstacle,
                        geometry:
                            obstacle.geometry?.type === 'Polygon' ? obstacle.geometry : geometry,
                    };
                    const nextFocus: FieldFocus = {
                        kind: 'obstacle',
                        fieldId: selectedId,
                        id: stored.id,
                    };
                    setSelected((current) =>
                        current
                            ? { ...current, obstacles: [...current.obstacles, stored] }
                            : current,
                    );
                    setChildrenByField((current) => {
                        const previous = current[selectedId] ?? emptyFieldChildren();
                        return {
                            ...current,
                            [selectedId]: {
                                ...previous,
                                obstacles: [...previous.obstacles, stored],
                            },
                        };
                    });
                    setFocus(nextFocus);
                    setDraft([]);
                    setTool('select');
                    setError(null);
                    recordCreation({
                        labelKey: 'fields.history.obstacle',
                        fieldId: selectedId,
                        id: stored.id,
                        kind: 'obstacle',
                        create: () => addObstacle(selectedId, obstaclePayload),
                        remove: deleteObstacle,
                    });
                    void select(selectedId, { focus: nextFocus });
                } catch (reason: unknown) {
                    setError(catalogueError(reason));
                }
            } finally {
                finishingRef.current = false;
            }
        },
        [
            draft,
            editingGeometry,
            focus,
            childrenByField,
            editIntent,
            focus,
            lineKind,
            nav,
            newName,
            recordAction,
            recordCreation,
            reload,
            select,
            selectedId,
            tool,
            trafficKind,
            zoneKind,
        ],
    );
    finishDraftRef.current = finishDraft;

    const saveSelected = useCallback(
        async (patch: Record<string, unknown>): Promise<boolean> => {
            try {
                if (focus?.kind === 'zone') {
                    await patchZone(focus.fieldId, focus.id, patch);
                    await select(focus.fieldId, { focus });
                    return true;
                }
                if (focus?.kind === 'obstacle') {
                    await patchObstacle(focus.fieldId, focus.id, patch);
                    await select(focus.fieldId, { focus });
                    return true;
                }
                if (focus?.kind === 'guidance') {
                    await patchGuidanceLine(focus.fieldId, focus.id, patch);
                    await select(focus.fieldId, { focus });
                    return true;
                }
                if (focus?.kind === 'traffic_way') {
                    await patchTrafficWay(focus.fieldId, focus.id, patch);
                    await select(focus.fieldId, { focus });
                    return true;
                }
                if (focus?.kind === 'traffic_node') {
                    await patchTrafficNode(focus.fieldId, focus.id, patch);
                    await select(focus.fieldId, { focus });
                    return true;
                }
                if (focus?.kind === 'row') {
                    await patchRow(focus.fieldId, focus.id, patch);
                    await select(focus.fieldId, { focus });
                    return true;
                }
                if (focus?.kind === 'landmark') {
                    await patchLandmark(focus.fieldId, focus.id, patch);
                    await select(focus.fieldId, { focus });
                    return true;
                }
                const fieldId = focus?.kind === 'field' ? focus.id : selectedId;
                if (!fieldId) {
                    return false;
                }
                const updated = await patchField(fieldId, patch);
                const geometry =
                    updated.geometry?.type === 'Polygon' ? updated.geometry : undefined;
                setSelected((current) =>
                    current?.id === fieldId
                        ? { ...current, ...updated, geometry: geometry ?? current.geometry }
                        : { ...updated, geometry: geometry ?? updated.geometry },
                );
                setFields((current) =>
                    current.map((field) =>
                        field.id === fieldId
                            ? {
                                  ...field,
                                  ...updated,
                                  geometry: geometry ?? field.geometry,
                              }
                            : field,
                    ),
                );
                setFocus({ kind: 'field', id: fieldId });
                return true;
            } catch (reason: unknown) {
                setError(catalogueError(reason));
                return false;
            }
        },
        [focus, select, selectedId],
    );
    saveSelectedRef.current = saveSelected;

    /**
     * Mirror of `recordCreation`: undo puts the object back — with a new identifier,
     * which the handle carries so a later redo deletes the right one.
     */
    const recordRemoval = useCallback(
        (removal: {
            labelKey: string;
            fieldId: string;
            restore: () => Promise<{ id: string }>;
            remove: (fieldId: string, id: string) => Promise<unknown>;
            focusFor: (id: string) => FieldFocus;
        }) => {
            const handle = { id: '' };
            recordAction({
                labelKey: removal.labelKey,
                undo: async () => {
                    const again = await removal.restore();
                    handle.id = again.id;
                    await select(removal.fieldId, { focus: removal.focusFor(again.id) });
                },
                redo: async () => {
                    await removal.remove(removal.fieldId, handle.id);
                    await select(removal.fieldId, {
                        focus: { kind: 'field', id: removal.fieldId },
                    });
                },
            });
        },
        [recordAction, select],
    );

    /**
     * Deleting a child is undoable, so the tree needs no confirmation dialog. Deleting
     * a whole field cascades and cannot be replayed: the caller confirms that one.
     */
    const deleteEntity = useCallback(
        async (target?: FieldFocus | null) => {
            const current = target && target.kind !== 'draft' ? target : focus;
            if (current && current.kind !== 'draft' && lockedIds.includes(current.id)) {
                setError('fields.error.locked');
                return;
            }
            try {
                if (current?.kind === 'zone') {
                    const fieldId = current.fieldId;
                    const children = childrenByField[fieldId];
                    const zone = (children?.zones ?? selected?.zones ?? []).find(
                        (item) => item.id === current.id,
                    );
                    await deleteZone(fieldId, current.id);
                    if (zone) {
                        recordRemoval({
                            labelKey: 'fields.history.delete',
                            fieldId,
                            restore: () =>
                                addZone(fieldId, {
                                    kind: zone.kind,
                                    geometry: zone.geometry,
                                    name: zone.name ?? undefined,
                                }),
                            remove: deleteZone,
                            focusFor: (id) => ({ kind: 'zone', fieldId, id }),
                        });
                    }
                    await select(fieldId, { focus: { kind: 'field', id: fieldId } });
                    return;
                }
                if (current?.kind === 'obstacle') {
                    const fieldId = current.fieldId;
                    const children = childrenByField[fieldId];
                    const obstacle = (children?.obstacles ?? selected?.obstacles ?? []).find(
                        (item) => item.id === current.id,
                    );
                    await deleteObstacle(fieldId, current.id);
                    if (obstacle) {
                        recordRemoval({
                            labelKey: 'fields.history.delete',
                            fieldId,
                            restore: () =>
                                addObstacle(fieldId, {
                                    geometry: obstacle.geometry as GeoJSONPolygon,
                                    name: obstacle.name ?? undefined,
                                    category: obstacle.category,
                                }),
                            remove: deleteObstacle,
                            focusFor: (id) => ({ kind: 'obstacle', fieldId, id }),
                        });
                    }
                    await select(fieldId, { focus: { kind: 'field', id: fieldId } });
                    return;
                }
                if (current?.kind === 'guidance') {
                    const fieldId = current.fieldId;
                    const children = childrenByField[fieldId];
                    const line = (children?.guidance_lines ?? selected?.guidance_lines ?? []).find(
                        (item) => item.id === current.id,
                    );
                    await deleteGuidanceLine(fieldId, current.id);
                    if (line) {
                        recordRemoval({
                            labelKey: 'fields.history.delete',
                            fieldId,
                            restore: () =>
                                addGuidanceLine(fieldId, {
                                    geometry: line.geometry as GeoJSONLineString,
                                    name: line.name ?? undefined,
                                }),
                            remove: deleteGuidanceLine,
                            focusFor: (id) => ({ kind: 'guidance', fieldId, id }),
                        });
                    }
                    await select(fieldId, { focus: { kind: 'field', id: fieldId } });
                    return;
                }
                if (current?.kind === 'traffic_way') {
                    const fieldId = current.fieldId;
                    const children = childrenByField[fieldId];
                    const way = (children?.traffic_ways ?? selected?.traffic_ways ?? []).find(
                        (item) => item.id === current.id,
                    );
                    await deleteTrafficWay(fieldId, current.id);
                    if (way) {
                        recordRemoval({
                            labelKey: 'fields.history.delete',
                            fieldId,
                            restore: () =>
                                addTrafficWay(fieldId, {
                                    geometry: way.geometry as GeoJSONLineString,
                                    name: way.name ?? undefined,
                                    kind: way.kind,
                                    oneway: way.oneway,
                                    speed_mps: way.speed_mps,
                                    width_m: way.width_m,
                                }),
                            remove: deleteTrafficWay,
                            focusFor: (id) => ({ kind: 'traffic_way', fieldId, id }),
                        });
                    }
                    await select(fieldId, { focus: { kind: 'field', id: fieldId } });
                    return;
                }
                if (current?.kind === 'traffic_node') {
                    const fieldId = current.fieldId;
                    const children = childrenByField[fieldId];
                    const node = (children?.traffic_nodes ?? selected?.traffic_nodes ?? []).find(
                        (item) => item.id === current.id,
                    );
                    await deleteTrafficNode(fieldId, current.id);
                    if (node) {
                        recordRemoval({
                            labelKey: 'fields.history.delete',
                            fieldId,
                            restore: () =>
                                addTrafficNode(fieldId, {
                                    geometry: node.geometry as GeoJSONPoint,
                                    name: node.name ?? undefined,
                                    kind: node.kind,
                                }),
                            remove: deleteTrafficNode,
                            focusFor: (id) => ({ kind: 'traffic_node', fieldId, id }),
                        });
                    }
                    await select(fieldId, { focus: { kind: 'field', id: fieldId } });
                    return;
                }
                if (current?.kind === 'landmark') {
                    const fieldId = current.fieldId;
                    const children = childrenByField[fieldId];
                    const landmark = (children?.landmarks ?? selected?.landmarks ?? []).find(
                        (item) => item.id === current.id,
                    );
                    await deleteLandmark(fieldId, current.id);
                    if (landmark) {
                        recordRemoval({
                            labelKey: 'fields.history.delete',
                            fieldId,
                            restore: () =>
                                addLandmark(fieldId, {
                                    kind: landmark.kind,
                                    geometry: landmark.geometry as
                                        GeoJSONLineString | GeoJSONPolygon | GeoJSONPoint,
                                    name: landmark.name ?? undefined,
                                    radius_m: landmark.radius_m,
                                }),
                            remove: deleteLandmark,
                            focusFor: (id) => ({ kind: 'landmark', fieldId, id }),
                        });
                    }
                    await select(fieldId, { focus: { kind: 'field', id: fieldId } });
                    return;
                }
                if (current?.kind === 'row') {
                    const fieldId = current.fieldId;
                    const rowSetId = current.rowSetId;
                    const children = childrenByField[fieldId];
                    const rowSet = (children?.row_sets ?? selected?.row_sets ?? []).find(
                        (item) => item.id === rowSetId,
                    );
                    const row = (rowSet?.rows ?? []).find((item) => item.id === current.id);
                    await deleteRow(fieldId, current.id);
                    if (row) {
                        recordRemoval({
                            labelKey: 'fields.history.delete',
                            fieldId,
                            restore: () =>
                                addRow(fieldId, rowSetId, {
                                    geometry: row.geometry as GeoJSONLineString,
                                    number: row.number,
                                    name: row.name,
                                }),
                            remove: (owner, id) => deleteRow(owner, id),
                            focusFor: (id) => ({ kind: 'row', fieldId, rowSetId, id }),
                        });
                    }
                    await select(fieldId, { focus: { kind: 'field', id: fieldId } });
                    return;
                }
                const fieldId = current?.kind === 'field' ? current.id : selectedId;
                if (!fieldId) {
                    return;
                }
                await deleteField(fieldId);
                setFields((currentFields) => currentFields.filter((item) => item.id !== fieldId));
                setChildrenByField((currentChildren) => {
                    const next = { ...currentChildren };
                    delete next[fieldId];
                    return next;
                });
                await select(null);
                await reload();
            } catch (reason: unknown) {
                setError(catalogueError(reason));
            }
        },
        [childrenByField, focus, lockedIds, recordRemoval, reload, select, selected, selectedId],
    );

    const deleteFocused = useCallback(async () => {
        await deleteEntity(focus);
    }, [deleteEntity, focus]);

    const importFile = useCallback(
        async (file: File) => {
            const text = await file.text();
            const geojson = JSON.parse(text) as Record<string, unknown>;
            const report = await importGeoJSON(geojson);
            if (!report.ok) {
                throw new Error('import failed');
            }
            await reload();
            if (report.field?.id) {
                await select(report.field.id);
            }
        },
        [reload, select],
    );

    const exportSelected = useCallback(async () => {
        if (!selectedId) {
            setError('fields.error.needField');
            return;
        }
        try {
            const payload = await exportField(selectedId);
            const blob = new Blob([JSON.stringify(payload, null, 2)], {
                type: 'application/geo+json',
            });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = geojsonDownloadName(selected?.name ?? 'parcelle');
            link.click();
            URL.revokeObjectURL(url);
            setError(null);
        } catch (reason: unknown) {
            setError(catalogueError(reason));
        }
    }, [selected?.name, selectedId]);

    const linkCurrentMission = useCallback(
        async (path: string) => {
            if (!selectedId || !path) {
                return;
            }
            await linkMission(selectedId, path);
            await select(selectedId, focus ? { focus } : undefined);
        },
        [focus, select, selectedId],
    );

    const addAutonomyZone = useCallback(async () => {
        if (!selected) {
            return;
        }
        const zone = await addZone(selected.id, {
            kind: 'autonomy',
            geometry: selected.geometry,
            name: 'ODD',
        });
        await select(selected.id, {
            focus: { kind: 'zone', fieldId: selected.id, id: zone.id },
        });
        await reload();
    }, [reload, select, selected]);

    const generateRowSet = useCallback(
        async (options: {
            axisLineId: string;
            spacingM?: number;
            name?: string;
            kind?: 'rows' | 'beds';
            widthM?: number;
            pathM?: number;
            count?: number;
        }) => {
            if (!selectedId || !selected) {
                setError('fields.error.needField');
                return;
            }
            const axis = selected.guidance_lines.find((line) => line.id === options.axisLineId);
            const axisGeometry =
                axis?.geometry?.type === 'LineString' ? (axis.geometry as GeoJSONLineString) : null;
            if (!axisGeometry) {
                setError('fields.error.needAxis');
                return;
            }
            const asBeds = options.kind === 'beds';
            const fieldId = selectedId;
            const recordGenerated = (
                labelKey: string,
                payload: Parameters<typeof createRowSet>[1],
                id: string,
            ) => {
                const handle = { id };
                recordAction({
                    labelKey,
                    undo: async () => {
                        await deleteRowSet(fieldId, handle.id);
                        await select(fieldId);
                    },
                    redo: async () => {
                        const again = await createRowSet(fieldId, payload);
                        handle.id = again.id;
                        await select(fieldId);
                    },
                });
            };
            try {
                if (asBeds) {
                    const widthM = options.widthM ?? 0;
                    const pathM = options.pathM ?? 0;
                    if (!(widthM > 0) || pathM < 0) {
                        setError('fields.error.invalidBed');
                        return;
                    }
                    const geometries = bedsFromFieldAndAxis(selected.geometry, axisGeometry, {
                        widthM,
                        pathM,
                        count: options.count,
                    });
                    if (geometries.length === 0) {
                        setError('fields.error.noBedsGenerated');
                        return;
                    }
                    const payload = {
                        name: options.name?.trim() || 'Planches',
                        kind: 'beds' as const,
                        spacing_m: widthM + pathM,
                        width_m: widthM,
                        axis_line_id: options.axisLineId,
                        rows: geometries.map((geometry, index) => ({
                            number: index + 1,
                            geometry,
                            name: `Planche ${index + 1}`,
                        })),
                    };
                    const created = await createRowSet(selectedId, payload);
                    recordGenerated('fields.history.beds', payload, created.id);
                    const first = created.rows[0];
                    const nextFocus: FieldFocus = first
                        ? {
                              kind: 'row',
                              fieldId: selectedId,
                              rowSetId: created.id,
                              id: first.id,
                          }
                        : { kind: 'field', id: selectedId };
                    setError(null);
                    await select(selectedId, { focus: nextFocus });
                    return;
                }
                const spacingM = options.spacingM ?? 0;
                if (!(spacingM > 0)) {
                    setError('fields.error.invalidSpacing');
                    return;
                }
                const geometries = rowsFromFieldAndAxis(selected.geometry, axisGeometry, spacingM);
                if (geometries.length === 0) {
                    setError('fields.error.noRowsGenerated');
                    return;
                }
                const payload = {
                    name: options.name?.trim() || 'Rangs',
                    kind: 'rows' as const,
                    spacing_m: spacingM,
                    axis_line_id: options.axisLineId,
                    rows: geometries.map((geometry, index) => ({
                        number: index + 1,
                        geometry,
                        name: `Rang ${index + 1}`,
                    })),
                };
                const created = await createRowSet(selectedId, payload);
                recordGenerated('fields.history.rows', payload, created.id);
                const first = created.rows[0];
                const nextFocus: FieldFocus = first
                    ? {
                          kind: 'row',
                          fieldId: selectedId,
                          rowSetId: created.id,
                          id: first.id,
                      }
                    : { kind: 'field', id: selectedId };
                setError(null);
                await select(selectedId, { focus: nextFocus });
            } catch (reason: unknown) {
                setError(catalogueError(reason));
            }
        },
        [recordAction, select, selected, selectedId],
    );

    const deleteFocusedRowSet = useCallback(async () => {
        if (focus?.kind !== 'row') {
            return;
        }
        try {
            await deleteRowSet(focus.fieldId, focus.rowSetId);
            await select(focus.fieldId, { focus: { kind: 'field', id: focus.fieldId } });
        } catch (reason: unknown) {
            setError(catalogueError(reason));
        }
    }, [focus, select]);

    const selectExistingGeofence = useCallback((): boolean => {
        const zone = findGeofenceZone(selected?.zones);
        if (!selectedId || !zone) {
            return false;
        }
        setEditIntent('geofence');
        setTool('select');
        void select(selectedId, { focus: { kind: 'zone', fieldId: selectedId, id: zone.id } });
        return beginEditGeometry({ kind: 'zone', fieldId: selectedId, id: zone.id });
    }, [beginEditGeometry, select, selected, selectedId]);

    const applyFollowUp = useCallback(
        async (options: {
            count: number;
            spacingM: number;
            side: 'left' | 'right';
            bedWidthM?: number;
            pathWidthM?: number;
        }) => {
            if (!selectedId || !followUpLine) {
                setFollowUp(null);
                return;
            }
            const fieldId = selectedId;
            const lineHandle =
                followUpHandleRef.current ?? (followUpId ? { id: followUpId } : null);
            try {
                if (followUp === 'path_width') {
                    if (lineHandle) {
                        const width = options.pathWidthM ?? DEFAULT_PATH_WIDTH_M;
                        const previous =
                            selected?.traffic_ways?.find((way) => way.id === lineHandle.id)
                                ?.width_m ?? null;
                        const applyWidth = async (value: number | null) => {
                            await patchTrafficWay(fieldId, lineHandle.id, { width_m: value });
                            await select(fieldId, {
                                focus: {
                                    kind: 'traffic_way',
                                    fieldId,
                                    id: lineHandle.id,
                                },
                            });
                        };
                        await patchTrafficWay(fieldId, lineHandle.id, { width_m: width });
                        recordAction({
                            labelKey: 'fields.history.pathWidth',
                            undo: () => applyWidth(previous),
                            redo: () => applyWidth(width),
                        });
                    }
                } else if (followUp === 'duplicate_row' || followUp === 'duplicate_bed') {
                    const beds = followUp === 'duplicate_bed';
                    const lines = duplicateLineString(
                        followUpLine,
                        options.count,
                        options.spacingM,
                        options.side,
                    );
                    const label = beds ? 'Planche' : cropName.trim() || 'Rang';
                    const payload = {
                        name: beds ? 'Planches' : cropName.trim() || 'Rangs',
                        kind: beds ? ('beds' as const) : ('rows' as const),
                        spacing_m: options.spacingM,
                        ...(beds ? { width_m: options.bedWidthM ?? DEFAULT_BED_WIDTH_M } : {}),
                        rows: lines.map((geometry, index) => ({
                            number: index + 1,
                            geometry,
                            name: `${label} ${index + 1}`,
                        })),
                    };
                    const created = await createRowSet(fieldId, payload);
                    // The drawn line is now row 1 of the set: drop the temporary guidance line.
                    const axisName =
                        selected?.guidance_lines?.find((line) => line.id === lineHandle?.id)
                            ?.name ?? null;
                    if (lineHandle) {
                        await deleteGuidanceLine(fieldId, lineHandle.id);
                    }
                    const setHandle = { id: created.id };
                    const axisGeometry = followUpLine;
                    recordAction({
                        labelKey: beds ? 'fields.history.beds' : 'fields.history.rows',
                        undo: async () => {
                            await deleteRowSet(fieldId, setHandle.id);
                            if (lineHandle) {
                                // Give the drawn line back, so undoing once more removes it.
                                const restored = await addGuidanceLine(fieldId, {
                                    geometry: axisGeometry,
                                    name: axisName ?? undefined,
                                });
                                lineHandle.id = restored.id;
                            }
                            await select(fieldId);
                        },
                        redo: async () => {
                            const again = await createRowSet(fieldId, payload);
                            setHandle.id = again.id;
                            if (lineHandle) {
                                await deleteGuidanceLine(fieldId, lineHandle.id);
                            }
                            await select(fieldId);
                        },
                    });
                }
                followUpHandleRef.current = null;
                setFollowUp(null);
                setFollowUpLine(null);
                setFollowUpId(null);
                setEditIntent('none');
                await select(fieldId);
            } catch (reason: unknown) {
                setError(catalogueError(reason));
            }
        },
        [cropName, followUp, followUpId, followUpLine, recordAction, select, selected, selectedId],
    );

    const findLassoRow = useCallback(
        (hit: FieldLassoHit): FieldRow | null => {
            if (hit.kind !== 'row') {
                return null;
            }
            const children = childrenByField[hit.fieldId];
            for (const rowSet of children?.row_sets ?? []) {
                const row = (rowSet.rows ?? []).find((item) => item.id === hit.id);
                if (row) {
                    return row;
                }
            }
            return null;
        },
        [childrenByField],
    );

    const findLassoGuidance = useCallback(
        (hit: FieldLassoHit): FieldGuidanceLine | null => {
            if (hit.kind !== 'guidance') {
                return null;
            }
            return (
                (childrenByField[hit.fieldId]?.guidance_lines ?? []).find(
                    (item) => item.id === hit.id,
                ) ?? null
            );
        },
        [childrenByField],
    );

    const clearLasso = useCallback(() => {
        setLassoHits([]);
        setLassoRing(null);
        setEditIntent('none');
    }, []);

    const deleteLassoHits = useCallback(async () => {
        if (!selectedId || lassoHits.length === 0) {
            return;
        }
        const snapshots = lassoHits.map((hit) => ({
            hit,
            row: findLassoRow(hit),
            line: findLassoGuidance(hit),
        }));
        const handles = snapshots.map((item) => ({ id: item.hit.id }));
        try {
            for (const item of snapshots) {
                if (item.hit.kind === 'row') {
                    await deleteRow(item.hit.fieldId, item.hit.id);
                } else {
                    await deleteGuidanceLine(item.hit.fieldId, item.hit.id);
                }
            }
            clearLasso();
            recordAction({
                labelKey: 'fields.history.lassoDelete',
                undo: async () => {
                    for (const [index, item] of snapshots.entries()) {
                        const handle = handles[index];
                        if (!handle) {
                            continue;
                        }
                        if (item.hit.kind === 'row' && item.row) {
                            const again = await addRow(item.hit.fieldId, item.hit.rowSetId, {
                                geometry: item.row.geometry as GeoJSONLineString | GeoJSONPolygon,
                                number: item.row.number,
                                name: item.row.name,
                            });
                            handle.id = again.id;
                        } else if (item.line) {
                            const again = await addGuidanceLine(item.hit.fieldId, {
                                geometry: item.line.geometry as GeoJSONLineString,
                                name: item.line.name ?? undefined,
                            });
                            handle.id = again.id;
                        }
                    }
                    await select(selectedId);
                },
                redo: async () => {
                    for (const [index, item] of snapshots.entries()) {
                        const handle = handles[index];
                        if (!handle) {
                            continue;
                        }
                        if (item.hit.kind === 'row') {
                            await deleteRow(item.hit.fieldId, handle.id);
                        } else {
                            await deleteGuidanceLine(item.hit.fieldId, handle.id);
                        }
                    }
                    await select(selectedId);
                },
            });
            await select(selectedId);
        } catch (reason: unknown) {
            setError(catalogueError(reason));
        }
    }, [clearLasso, findLassoGuidance, findLassoRow, lassoHits, recordAction, select, selectedId]);

    const cutLassoHits = useCallback(async () => {
        if (!selectedId || lassoHits.length === 0 || !lassoRing) {
            return;
        }
        const ring = lassoRing;
        type Extra = {
            id: string;
            fieldId: string;
            rowSetId?: string;
            kind: FieldLassoHit['kind'];
        };
        const extras: Extra[] = [];
        const takenNumbers = new Set<number>();
        for (const rowSet of [
            ...(childrenByField[selectedId]?.row_sets ?? []),
            ...(selected?.row_sets ?? []),
        ]) {
            for (const row of rowSet.rows ?? []) {
                takenNumbers.add(row.number);
            }
        }
        const originals = lassoHits.map((hit) => ({
            hit,
            row: findLassoRow(hit),
            line: findLassoGuidance(hit),
            handle: { id: hit.id },
        }));
        const applyPieces = async (restoreOriginals: boolean) => {
            if (restoreOriginals) {
                for (const extra of extras) {
                    if (extra.kind === 'row') {
                        await deleteRow(extra.fieldId, extra.id);
                    } else {
                        await deleteGuidanceLine(extra.fieldId, extra.id);
                    }
                }
                extras.length = 0;
                for (const item of originals) {
                    if (item.hit.kind === 'row' && item.row) {
                        if (item.handle.id) {
                            await patchRow(item.hit.fieldId, item.handle.id, {
                                geometry: item.row.geometry,
                            });
                        } else {
                            const again = await addRow(item.hit.fieldId, item.hit.rowSetId, {
                                geometry: item.row.geometry as GeoJSONLineString | GeoJSONPolygon,
                                number: item.row.number,
                                name: item.row.name,
                            });
                            item.handle.id = again.id;
                        }
                    } else if (item.line) {
                        if (item.handle.id) {
                            await patchGuidanceLine(item.hit.fieldId, item.handle.id, {
                                geometry: item.line.geometry,
                            });
                        } else {
                            const again = await addGuidanceLine(item.hit.fieldId, {
                                geometry: item.line.geometry as GeoJSONLineString,
                                name: item.line.name ?? undefined,
                            });
                            item.handle.id = again.id;
                        }
                    }
                }
                return;
            }
            for (const item of originals) {
                const geometry = item.row?.geometry ?? item.line?.geometry;
                if (!geometry) {
                    continue;
                }
                const result = cutGeometryByLasso(geometry, ring);
                if (result.action === 'unchanged') {
                    continue;
                }
                if (result.action === 'delete') {
                    if (item.hit.kind === 'row') {
                        await deleteRow(item.hit.fieldId, item.handle.id);
                    } else {
                        await deleteGuidanceLine(item.hit.fieldId, item.handle.id);
                    }
                    item.handle.id = '';
                    continue;
                }
                const [first, ...rest] = result.geometries;
                if (!first) {
                    continue;
                }
                if (item.hit.kind === 'row' && item.row) {
                    if (!item.handle.id) {
                        const restored = await addRow(item.hit.fieldId, item.hit.rowSetId, {
                            geometry: first as GeoJSONLineString | GeoJSONPolygon,
                            number: item.row.number,
                            name: item.row.name,
                        });
                        item.handle.id = restored.id;
                    } else {
                        await patchRow(item.hit.fieldId, item.handle.id, { geometry: first });
                    }
                    for (const piece of rest) {
                        const number = nextFreeRowNumber(takenNumbers);
                        takenNumbers.add(number);
                        const created = await addRow(item.hit.fieldId, item.hit.rowSetId, {
                            geometry: piece as GeoJSONLineString | GeoJSONPolygon,
                            number,
                            name: item.row.name,
                        });
                        extras.push({
                            id: created.id,
                            fieldId: item.hit.fieldId,
                            rowSetId: item.hit.rowSetId,
                            kind: 'row',
                        });
                    }
                } else if (item.line) {
                    if (!item.handle.id) {
                        const restored = await addGuidanceLine(item.hit.fieldId, {
                            geometry: first as GeoJSONLineString,
                            name: item.line.name ?? undefined,
                        });
                        item.handle.id = restored.id;
                    } else {
                        await patchGuidanceLine(item.hit.fieldId, item.handle.id, {
                            geometry: first,
                        });
                    }
                    for (const piece of rest) {
                        if (piece.type !== 'LineString') {
                            continue;
                        }
                        const created = await addGuidanceLine(item.hit.fieldId, {
                            geometry: piece,
                            name: item.line.name ?? undefined,
                        });
                        extras.push({
                            id: created.id,
                            fieldId: item.hit.fieldId,
                            kind: 'guidance',
                        });
                    }
                }
            }
        };
        try {
            await applyPieces(false);
            clearLasso();
            recordAction({
                labelKey: 'fields.history.lassoCut',
                undo: async () => {
                    await applyPieces(true);
                    await select(selectedId);
                },
                redo: async () => {
                    await applyPieces(false);
                    await select(selectedId);
                },
            });
            await select(selectedId);
        } catch (reason: unknown) {
            setError(catalogueError(reason));
        }
    }, [
        childrenByField,
        clearLasso,
        findLassoGuidance,
        findLassoRow,
        lassoHits,
        lassoRing,
        selected,
        recordAction,
        select,
        selectedId,
    ]);

    /** While drawing, step back one point; once nothing is being drawn, undo the last action. */
    const undo = useCallback(() => {
        if (draftRef.current.length === 0) {
            void runHistory('undo');
            return;
        }
        setDraft((current) => {
            const last = current[current.length - 1];
            if (!last) {
                return current;
            }
            setDraftRedo((redo) => [...redo, last]);
            return current.slice(0, -1);
        });
    }, [runHistory]);

    const redo = useCallback(() => {
        if (draftRedo.length === 0) {
            void runHistory('redo');
            return;
        }
        setDraftRedo((current) => {
            const last = current[current.length - 1];
            if (!last) {
                return current;
            }
            setDraft((draftPoints) => [...draftPoints, last]);
            return current.slice(0, -1);
        });
    }, [draftRedo.length, runHistory]);

    const handleMapHover = useCallback(
        (lngLat: [number, number] | null) => {
            if (tool !== 'ruler') {
                return;
            }
            setHoverLngLat(lngLat ? { lng: lngLat[0], lat: lngLat[1] } : null);
        },
        [tool],
    );

    const rememberLandmark = useCallback((item: FieldLandmark, replace = false) => {
        const merge = (list: FieldLandmark[]): FieldLandmark[] => {
            if (replace && list.some((entry) => entry.id === item.id)) {
                return list.map((entry) => (entry.id === item.id ? item : entry));
            }
            return [...list, item];
        };
        setSelected((current) =>
            current && current.id === item.field_id
                ? { ...current, landmarks: merge(current.landmarks ?? []) }
                : current,
        );
        setChildrenByField((current) => {
            const previous = current[item.field_id] ?? emptyFieldChildren();
            return {
                ...current,
                [item.field_id]: {
                    ...previous,
                    landmarks: merge(previous.landmarks ?? []),
                },
            };
        });
    }, []);

    const pinLandmarkFrom = useCallback(
        async (kind: LandmarkKind, points: LatLng[], radiusM: number) => {
            if (!selectedId) {
                setError('fields.error.needField');
                return;
            }
            if (!canPinLandmark(kind, points, radiusM)) {
                setError('fields.error.tooFewPoints');
                return;
            }
            const geometry = landmarkGeometry(kind, points, radiusM);
            if (!geometry) {
                setError('fields.error.tooFewPoints');
                return;
            }
            try {
                if (editingGeometry && focus?.kind === 'landmark') {
                    const updated = await patchLandmark(selectedId, focus.id, {
                        kind,
                        geometry,
                        name: newName.trim() || landmarkDefaultName(kind),
                        radius_m: kind === 'circle' ? radiusM : null,
                    });
                    rememberLandmark(updated, true);
                    setDraft([]);
                    setDraftRedo([]);
                    setHoverLngLat(null);
                    setLandmarkReady(false);
                    setEditingGeometry(false);
                    setTool('select');
                    setEditIntent('none');
                    setFocus({ kind: 'landmark', fieldId: selectedId, id: updated.id });
                    setError(null);
                    return;
                }
                const created = await addLandmark(selectedId, {
                    kind,
                    geometry,
                    name: newName.trim() || landmarkDefaultName(kind),
                    radius_m: kind === 'circle' ? radiusM : null,
                });
                recordCreation({
                    labelKey: 'fields.history.landmark',
                    fieldId: selectedId,
                    id: created.id,
                    kind: 'landmark',
                    create: () =>
                        addLandmark(selectedId, {
                            kind,
                            geometry,
                            name: created.name ?? undefined,
                            radius_m: created.radius_m,
                        }),
                    remove: deleteLandmark,
                });
                rememberLandmark(created);
                setDraft([]);
                setDraftRedo([]);
                setHoverLngLat(null);
                setLandmarkReady(false);
                setNewName(landmarkDefaultName(kind));
                setFocus({ kind: 'landmark', fieldId: selectedId, id: created.id });
                setError(null);
            } catch (reason: unknown) {
                setError(catalogueError(reason));
            }
        },
        [editingGeometry, focus, newName, recordCreation, rememberLandmark, selectedId],
    );
    pinLandmarkFromRef.current = pinLandmarkFrom;

    const pinLandmark = useCallback(async () => {
        await pinLandmarkFrom(landmarkKind, draft, Number(circleRadiusM));
    }, [circleRadiusM, draft, landmarkKind, pinLandmarkFrom]);

    const updateCircleRadius = useCallback(
        (value: string) => {
            setCircleRadiusM(value);
            const radius = Number(value);
            if (!Number.isFinite(radius) || radius <= 0 || draft.length > 0) {
                return;
            }
            if (focus?.kind !== 'landmark' || !selectedId) {
                return;
            }
            const current = (selected?.landmarks ?? []).find((item) => item.id === focus.id);
            if (!current || current.kind !== 'circle') {
                return;
            }
            const center = circleCenterFromGeometry(current.geometry);
            const geometry = center ? circlePolygon(center, radius) : null;
            if (!geometry) {
                return;
            }
            const next = { ...current, radius_m: radius, geometry };
            setSelected((field) =>
                field && field.id === selectedId
                    ? {
                          ...field,
                          landmarks: (field.landmarks ?? []).map((item) =>
                              item.id === next.id ? next : item,
                          ),
                      }
                    : field,
            );
            setChildrenByField((fieldsMap) => {
                const previous = fieldsMap[selectedId] ?? emptyFieldChildren();
                return {
                    ...fieldsMap,
                    [selectedId]: {
                        ...previous,
                        landmarks: (previous.landmarks ?? []).map((item) =>
                            item.id === next.id ? next : item,
                        ),
                    },
                };
            });
            void patchLandmark(selectedId, current.id, { radius_m: radius, geometry }).catch(
                (reason: unknown) => {
                    setError(catalogueError(reason));
                },
            );
        },
        [draft.length, focus, selected, selectedId],
    );

    const cancelDraft = useCallback(() => {
        setDraft([]);
        setDraftRedo([]);
        setHoverLngLat(null);
        setLandmarkReady(false);
        setTool('select');
        setError(null);
        setEditingGeometry(false);
        if (editIntent !== 'lasso') {
            setEditIntent('none');
        }
        setFocus((current) =>
            current?.kind === 'draft' && selectedId ? { kind: 'field', id: selectedId } : current,
        );
    }, [editIntent, selectedId]);

    const radiusValue = Number(circleRadiusM);
    const previewPoints =
        tool === 'ruler' ? previewDraft(landmarkKind, draft, hoverLngLat, landmarkReady) : draft;
    const liveMeasure = landmarkLiveMeasure(landmarkKind, draft, hoverLngLat, landmarkReady);
    const center = draft[0];
    const liveCircleRadius =
        tool === 'ruler' && landmarkKind === 'circle' && center && hoverLngLat && !landmarkReady
            ? Math.max(getDistanceMeters(center, hoverLngLat), 0)
            : radiusValue;
    const circlePreview =
        tool === 'ruler' &&
        landmarkKind === 'circle' &&
        center &&
        Number.isFinite(liveCircleRadius) &&
        liveCircleRadius > 0
            ? circleRing(center, liveCircleRadius)
            : [];
    const captionMeters =
        landmarkKind === 'circle' && (landmarkReady || liveMeasure.lastSegmentM === null)
            ? radiusValue
            : liveMeasure.lastSegmentM;

    return {
        available,
        loading,
        error,
        nav,
        setNav,
        fields,
        selectedId,
        selected,
        focus,
        selectedFeatureId: featureIdFromFocus(focus) ?? (editingGeometry ? selectedId : null),
        versions,
        diff,
        impact,
        tool,
        draft,
        newName,
        setNewName,
        zoneKind,
        setZoneKind,
        trafficKind,
        setTrafficKind,
        select: (id, options) => {
            void select(id, options);
        },
        setTool,
        startDraw,
        beginEditGeometry,
        setInteractive,
        handleMapClick,
        handleMapDblClick,
        insertVertex,
        moveVertex,
        finishDraft,
        cancelDraft,
        saveSelected,
        deleteFocused,
        deleteEntity,
        importFile,
        exportSelected,
        linkCurrentMission,
        addAutonomyZone,
        generateRowSet,
        deleteFocusedRowSet,
        reload,
        cameraTargetId,
        cameraNonce,
        childrenByField,
        editingGeometry,
        editIntent,
        lineKind,
        setLineKind,
        cropName,
        setCropName,
        lassoHits,
        lassoOverlay: lassoRingToLatLngs(lassoRing),
        followUp,
        geofenceZoneId: findGeofenceZone(selected?.zones)?.id ?? null,
        startCreateField,
        startSelectEntity,
        startLasso,
        startPolyline,
        startSurface,
        startExclusionZone,
        startGeofenceDraw,
        startRuler,
        landmarkKind,
        setLandmarkKind,
        circleRadiusM,
        setCircleRadiusM,
        updateCircleRadius,
        previewDraft: previewPoints,
        landmarkMeasure: liveMeasure,
        landmarkCaption: formatLandmarkMeters(captionMeters),
        circlePreview,
        landmarkHover: hoverLngLat,
        canPinLandmark: canPinLandmark(landmarkKind, draft, radiusValue),
        pinLandmark,
        handleMapHover,
        applyGeofenceFromBoundary,
        deleteGeofence,
        selectExistingGeofence,
        applyFollowUp,
        dismissFollowUp: () => {
            setFollowUp(null);
            setFollowUpLine(null);
            setFollowUpId(null);
        },
        deleteLassoHits,
        cutLassoHits,
        undo,
        redo,
        canUndo: draft.length > 0 || history.past.length > 0,
        canRedo: draftRedo.length > 0 || history.future.length > 0,
        undoLabelKey: history.past[history.past.length - 1]?.labelKey ?? null,
        hiddenIds,
        lockedIds,
        toggleHidden,
        toggleLocked,
    };
}
