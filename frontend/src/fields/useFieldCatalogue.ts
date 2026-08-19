import { useCallback, useEffect, useRef, useState } from 'react';

import type { LatLng } from '../domain/geometry';
import { insertDraftVertex, moveDraftVertex } from '../map/draft-hit';
import {
    addGuidanceLine,
    addObstacle,
    addTrafficNode,
    addTrafficWay,
    addZone,
    createField,
    createRowSet,
    deleteField,
    deleteGuidanceLine,
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
    childrenFromField,
    emptyFieldChildren,
    geojsonDownloadName,
    hitCatalogue,
    lineFromDraft,
    pointFromDraft,
    ringFromDraft,
    type FieldChildren,
} from './geojson';
import { rowsFromFieldAndAxis, bedsFromFieldAndAxis } from './rows';
import type {
    FieldDetail,
    FieldDiff,
    FieldImpact,
    FieldSummary,
    FieldVersion,
    FieldsNavId,
    GeoJSONLineString,
    TrafficDrawKind,
    ZoneKind,
} from './types';

export type FieldsTool = 'select' | 'draw_polygon' | 'draw_line' | 'draw_point';

export type FieldFocus =
    | { kind: 'field'; id: string }
    | { kind: 'zone'; fieldId: string; id: string }
    | { kind: 'obstacle'; fieldId: string; id: string }
    | { kind: 'guidance'; fieldId: string; id: string }
    | { kind: 'row'; fieldId: string; rowSetId: string; id: string }
    | { kind: 'traffic_way'; fieldId: string; id: string }
    | { kind: 'traffic_node'; fieldId: string; id: string }
    | {
          kind: 'draft';
          target: 'field' | 'zone' | 'obstacle' | 'guidance' | 'traffic_way' | 'traffic_node';
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
        kind: hit.type as 'zone' | 'obstacle' | 'guidance' | 'traffic_way' | 'traffic_node',
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
    const interactiveRef = useRef(true);

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
            setFocus((current) => (current?.kind === 'draft' ? null : current));
        },
        [trafficKind],
    );

    const setTrafficKind = useCallback((kind: TrafficDrawKind) => {
        setTrafficKindState(kind);
        setNewName(defaultDraftName('traffic', kind));
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
                if (message === 'fields.error.notFound') {
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
        return true;
    }, [nav, selectedId, trafficKind]);

    const finishDraftRef = useRef<(fromPoints?: LatLng[]) => Promise<void>>(async () => undefined);
    const saveSelectedRef = useRef<(patch: Record<string, unknown>) => Promise<boolean>>(
        async () => false,
    );

    const setInteractive = useCallback((value: boolean) => {
        interactiveRef.current = value;
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
            const geometry = geometryOfFocus(current, fields, selected, childrenByField);
            const vertices = verticesFromGeometry(geometry);
            const kind = drawKindFromGeometry(geometry);
            if (!vertices || !kind) {
                setError('fields.error.notEditable');
                return false;
            }
            const fieldId = current.kind === 'field' ? current.id : current.fieldId;
            setFocus(current);
            setSelectedId(fieldId);
            setDraft(vertices);
            setTool(toolFromDrawKind(kind));
            setEditingGeometry(true);
            setError(null);
            if (nextFocus && nextFocus.kind !== 'draft') {
                void select(fieldId, { focus: current });
            }
            return true;
        },
        [childrenByField, fields, focus, select, selected],
    );

    const handleMapClick = useCallback(
        (lngLat: [number, number]) => {
            if (!interactiveRef.current) {
                return;
            }
            if (tool === 'draw_polygon' || tool === 'draw_line') {
                setDraft((current) => [...current, { lng: lngLat[0], lat: lngLat[1] }]);
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
                void select(null);
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
        [childrenByField, editingGeometry, fields, select, tool],
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
            if (!interactiveRef.current) {
                return;
            }
            const points = fromPoints ?? draft;
            if (editingGeometry && focus && focus.kind !== 'draft') {
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
            const target = fieldsDrawTarget(nav, trafficKind);
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
                        const way = await addTrafficWay(selectedId, {
                            geometry,
                            name: name || defaultDraftName('traffic', 'path'),
                            kind: 'path',
                        });
                        const stored = {
                            ...way,
                            geometry: way.geometry?.type === 'LineString' ? way.geometry : geometry,
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
                        void select(selectedId, { focus: nextFocus });
                        return;
                    }
                    const line = await addGuidanceLine(selectedId, {
                        geometry,
                        name: name || defaultDraftName('guidance'),
                    });
                    const stored = {
                        ...line,
                        geometry: line.geometry?.type === 'LineString' ? line.geometry : geometry,
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
                    const node = await addTrafficNode(selectedId, {
                        geometry,
                        name: name || defaultDraftName('traffic', trafficKind),
                        kind: trafficKind,
                    });
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
                    void select(selectedId, { focus: nextFocus });
                    return;
                }
                const geometry = ringFromDraft(points);
                if (!geometry) {
                    setError('fields.error.tooFewPoints');
                    return;
                }
                if (target === 'field') {
                    const created = await createField({
                        name: name || defaultDraftName('parcels'),
                        geometry,
                    });
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
                    setError(null);
                    void select(stored.id, { focus: { kind: 'field', id: stored.id } });
                    return;
                }
                if (!selectedId) {
                    setError('fields.error.needField');
                    return;
                }
                if (target === 'zone') {
                    const zone = await addZone(selectedId, { kind: zoneKind, geometry, name });
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
                    void select(selectedId, { focus: nextFocus });
                    return;
                }
                const obstacle = await addObstacle(selectedId, {
                    geometry,
                    name,
                    category: 'unspecified',
                });
                const stored = {
                    ...obstacle,
                    geometry: obstacle.geometry?.type === 'Polygon' ? obstacle.geometry : geometry,
                };
                const nextFocus: FieldFocus = {
                    kind: 'obstacle',
                    fieldId: selectedId,
                    id: stored.id,
                };
                setSelected((current) =>
                    current ? { ...current, obstacles: [...current.obstacles, stored] } : current,
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
                void select(selectedId, { focus: nextFocus });
            } catch (reason: unknown) {
                setError(catalogueError(reason));
            }
        },
        [
            draft,
            editingGeometry,
            focus,
            nav,
            newName,
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
                const fieldId = focus?.kind === 'field' ? focus.id : selectedId;
                if (!fieldId) {
                    return false;
                }
                await patchField(fieldId, patch);
                await reload();
                await select(fieldId, { focus: { kind: 'field', id: fieldId } });
                return true;
            } catch (reason: unknown) {
                setError(catalogueError(reason));
                return false;
            }
        },
        [focus, reload, select, selectedId],
    );
    saveSelectedRef.current = saveSelected;

    const deleteFocused = useCallback(async () => {
        try {
            if (focus?.kind === 'zone') {
                await deleteZone(focus.fieldId, focus.id);
                await select(focus.fieldId, { focus: { kind: 'field', id: focus.fieldId } });
                return;
            }
            if (focus?.kind === 'obstacle') {
                await deleteObstacle(focus.fieldId, focus.id);
                await select(focus.fieldId, { focus: { kind: 'field', id: focus.fieldId } });
                return;
            }
            if (focus?.kind === 'guidance') {
                await deleteGuidanceLine(focus.fieldId, focus.id);
                await select(focus.fieldId, { focus: { kind: 'field', id: focus.fieldId } });
                return;
            }
            if (focus?.kind === 'traffic_way') {
                await deleteTrafficWay(focus.fieldId, focus.id);
                await select(focus.fieldId, { focus: { kind: 'field', id: focus.fieldId } });
                return;
            }
            if (focus?.kind === 'traffic_node') {
                await deleteTrafficNode(focus.fieldId, focus.id);
                await select(focus.fieldId, { focus: { kind: 'field', id: focus.fieldId } });
                return;
            }
            if (focus?.kind === 'row') {
                await deleteRow(focus.fieldId, focus.id);
                await select(focus.fieldId, { focus: { kind: 'field', id: focus.fieldId } });
                return;
            }
            const fieldId = focus?.kind === 'field' ? focus.id : selectedId;
            if (!fieldId) {
                return;
            }
            await deleteField(fieldId);
            setFields((current) => current.filter((field) => field.id !== fieldId));
            setChildrenByField((current) => {
                const next = { ...current };
                delete next[fieldId];
                return next;
            });
            await select(null);
            await reload();
        } catch (reason: unknown) {
            setError(catalogueError(reason));
        }
    }, [focus, reload, select, selectedId]);

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
                    const created = await createRowSet(selectedId, {
                        name: options.name?.trim() || 'Planches',
                        kind: 'beds',
                        spacing_m: widthM + pathM,
                        width_m: widthM,
                        axis_line_id: options.axisLineId,
                        rows: geometries.map((geometry, index) => ({
                            number: index + 1,
                            geometry,
                            name: `Planche ${index + 1}`,
                        })),
                    });
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
                const created = await createRowSet(selectedId, {
                    name: options.name?.trim() || 'Rangs',
                    kind: 'rows',
                    spacing_m: spacingM,
                    axis_line_id: options.axisLineId,
                    rows: geometries.map((geometry, index) => ({
                        number: index + 1,
                        geometry,
                        name: `Rang ${index + 1}`,
                    })),
                });
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
        [select, selected, selectedId],
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

    const cancelDraft = useCallback(() => {
        setDraft([]);
        setTool('select');
        setError(null);
        setEditingGeometry(false);
        setFocus((current) =>
            current?.kind === 'draft' && selectedId ? { kind: 'field', id: selectedId } : current,
        );
    }, [selectedId]);

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
        selectedFeatureId: featureIdFromFocus(focus),
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
    };
}
