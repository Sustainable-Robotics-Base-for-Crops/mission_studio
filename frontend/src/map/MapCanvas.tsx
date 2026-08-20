import { useEffect, useRef, type ReactElement } from 'react';

import 'maplibre-gl/dist/maplibre-gl.css';

import { boundsForFeatureId } from '../fields/geojson';
import type { CoveragePreview } from '../coverage/api';
import { agriToGeoJSON, type PolygonFeatureCollection } from './agri-to-geojson';
import type { MapEngine, RowLabelMode } from './engine';
import { createMapLibreEngine } from './maplibre-engine';
import { PlaceSearch } from './PlaceSearch';
import {
    GEOLOCATION_ZOOM,
    initialView,
    SEARCH_ZOOM,
    type BasemapId,
    type MapView,
    type OverlayId,
} from './styles';
import { useI18n } from '../i18n/useI18n';
import type { LatLng } from '../domain/geometry';
import { engineDrawTool, type EditTool } from './useMissionEditor';

interface MapCanvasProps {
    document: unknown;
    basemap: BasemapId;
    overlays: Partial<Record<OverlayId, boolean>>;
    fitKey?: string | null;
    tool?: EditTool;
    extendActive?: boolean;
    draft?: LatLng[];
    selectedIndices?: number[];
    draftCaption?: string | null;
    catalogueGeoJSON?: PolygonFeatureCollection | null;
    catalogueFitKey?: string | null;
    coveragePreview?: CoveragePreview | null;
    onMapClick?: (lngLat: [number, number], mods?: { shiftKey: boolean }) => void;
    onMapDblClick?: (lngLat: [number, number]) => void;
    onInsertVertex?: (afterIndex: number, lngLat: [number, number]) => void;
    onMoveVertex?: (index: number, lngLat: [number, number]) => void;
    onBeginSelectionDrag?: (lngLat: [number, number]) => boolean;
    onUpdateSelectionDrag?: (lngLat: [number, number]) => void;
    onFinishSelectionDrag?: (lngLat: [number, number]) => 'none' | 'click' | 'moved';
    onCancelSelectionDrag?: () => boolean;
    hitSelectedSection?: (lngLat: [number, number]) => boolean;
    metricsCaption?: string | null;
    hiddenIndices?: number[];
    sweptEnvelope?: PolygonFeatureCollection | null;
    poseFootprint?: PolygonFeatureCollection | null;
    poseLngLat?: [number, number] | null;
    poseFlyKey?: number;
    rowLabelMode?: RowLabelMode;
    /** Farm start view; the map falls back to the national constants without it. */
    startView?: MapView | null;
    /** Publishes the live camera reader upward, and null once the map goes away. */
    onViewReader?: (read: (() => MapView | null) | null) => void;
}

export function MapCanvas({
    document,
    basemap,
    overlays,
    fitKey,
    tool = 'none',
    extendActive = false,
    draft = [],
    selectedIndices = [],
    draftCaption = null,
    catalogueGeoJSON = null,
    catalogueFitKey = null,
    coveragePreview = null,
    onMapClick,
    onMapDblClick,
    onInsertVertex,
    onMoveVertex,
    onBeginSelectionDrag,
    onUpdateSelectionDrag,
    onFinishSelectionDrag,
    onCancelSelectionDrag,
    hitSelectedSection,
    metricsCaption = null,
    hiddenIndices = [],
    sweptEnvelope = null,
    poseFootprint = null,
    poseLngLat = null,
    poseFlyKey = 0,
    rowLabelMode = 'off',
    startView = null,
    onViewReader,
}: MapCanvasProps): ReactElement {
    const { t } = useI18n();
    const hostRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<MapEngine | null>(null);
    const onMapClickRef = useRef(onMapClick);
    const onMapDblClickRef = useRef(onMapDblClick);
    const onInsertVertexRef = useRef(onInsertVertex);
    const onMoveVertexRef = useRef(onMoveVertex);
    const onBeginSelectionDragRef = useRef(onBeginSelectionDrag);
    const onUpdateSelectionDragRef = useRef(onUpdateSelectionDrag);
    const onFinishSelectionDragRef = useRef(onFinishSelectionDrag);
    const onCancelSelectionDragRef = useRef(onCancelSelectionDrag);
    const hitSelectedSectionRef = useRef(hitSelectedSection);
    onMapClickRef.current = onMapClick;
    onMapDblClickRef.current = onMapDblClick;
    onInsertVertexRef.current = onInsertVertex;
    onMoveVertexRef.current = onMoveVertex;
    onBeginSelectionDragRef.current = onBeginSelectionDrag;
    onUpdateSelectionDragRef.current = onUpdateSelectionDrag;
    onFinishSelectionDragRef.current = onFinishSelectionDrag;
    onCancelSelectionDragRef.current = onCancelSelectionDrag;
    hitSelectedSectionRef.current = hitSelectedSection;
    const fittedKeyRef = useRef<string | null | undefined>(undefined);
    const fittedCatalogueRef = useRef<string | null | undefined>(undefined);
    const startViewRef = useRef(startView);
    startViewRef.current = startView;
    const onViewReaderRef = useRef(onViewReader);
    onViewReaderRef.current = onViewReader;
    const appliedStartViewRef = useRef(false);

    useEffect(() => {
        const node = containerRef.current;
        const host = hostRef.current;
        if (!node) {
            return;
        }
        const engine = createMapLibreEngine();
        engineRef.current = engine;
        engine.attach(node, startViewRef.current);
        appliedStartViewRef.current = startViewRef.current !== null;
        onViewReaderRef.current?.(() => engine.getView());
        const unsubscribeClick = engine.onClick((lngLat) =>
            onMapClickRef.current?.(lngLat, { shiftKey: false }),
        );
        const unsubscribeDrag = engine.onDraftVertexDrag((index, lngLat) => {
            onMoveVertexRef.current?.(index, lngLat);
        });
        const observer = new ResizeObserver(() => engine.resize());
        observer.observe(host ?? node);
        const frame = window.requestAnimationFrame(() => engine.resize());
        return () => {
            window.cancelAnimationFrame(frame);
            observer.disconnect();
            unsubscribeClick();
            unsubscribeDrag();
            engine.detach();
            engineRef.current = null;
            onViewReaderRef.current?.(null);
        };
    }, []);

    // The farm arrives after the map is attached, so honour its start view once —
    // and only while no mission is loaded, since a mission fit must always win.
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine || appliedStartViewRef.current || !startView) {
            return;
        }
        appliedStartViewRef.current = true;
        if (document == null) {
            const camera = initialView(startView);
            engine.flyTo(camera.center, camera.zoom);
        }
    }, [document, startView]);

    const dblClickEnabled = Boolean(onMapDblClick);
    useEffect(() => {
        const host = hostRef.current;
        if (!host || !dblClickEnabled) {
            return;
        }
        const onDblClick = (event: MouseEvent) => {
            if (!onMapDblClickRef.current) {
                return;
            }
            const target = event.target;
            if (
                target instanceof Element &&
                Boolean(
                    target.closest(
                        '.studio-place-search, .maplibregl-ctrl, .maplibregl-marker, .studio-draft-vertex, button, input, select, textarea, a',
                    ),
                )
            ) {
                return;
            }
            event.preventDefault();
            const lngLat = engineRef.current?.unproject(event.clientX, event.clientY);
            if (lngLat) {
                onMapDblClickRef.current(lngLat);
            }
        };
        host.addEventListener('dblclick', onDblClick);
        return () => host.removeEventListener('dblclick', onDblClick);
    }, [dblClickEnabled]);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) {
            return;
        }
        const apply = (selector: string, key: string) => {
            const button = host.querySelector(selector);
            if (!(button instanceof HTMLButtonElement)) {
                return;
            }
            const label = t(key);
            button.title = label;
            button.setAttribute('aria-label', label);
        };
        apply('.maplibregl-ctrl-compass', 'map.resetNorth');
        apply('.maplibregl-ctrl-zoom-in', 'map.zoomIn');
        apply('.maplibregl-ctrl-zoom-out', 'map.zoomOut');
    }, [t]);

    useEffect(() => {
        engineRef.current?.setBasemap(basemap);
    }, [basemap]);

    useEffect(() => {
        const engine = engineRef.current;
        if (!engine) {
            return;
        }
        for (const [id, visible] of Object.entries(overlays)) {
            if (typeof visible === 'boolean') {
                engine.setOverlayVisible(id as OverlayId, visible);
            }
        }
    }, [overlays]);

    useEffect(() => {
        engineRef.current?.setRowLabelMode(rowLabelMode);
    }, [rowLabelMode]);

    useEffect(() => {
        const engine = engineRef.current;
        if (!engine) {
            return;
        }
        engine.renderMission(agriToGeoJSON(document, selectedIndices, hiddenIndices));
        if (fitKey && fitKey !== fittedKeyRef.current) {
            fittedKeyRef.current = fitKey;
            engine.fitToMission();
        }
    }, [document, fitKey, hiddenIndices, selectedIndices]);

    useEffect(() => {
        const engine = engineRef.current;
        if (!engine) {
            return;
        }
        if (!catalogueGeoJSON) {
            engine.renderCatalogue({ type: 'FeatureCollection', features: [] });
            return;
        }
        engine.renderCatalogue(catalogueGeoJSON);
        if (catalogueFitKey && catalogueFitKey !== fittedCatalogueRef.current) {
            fittedCatalogueRef.current = catalogueFitKey;
            const featureId = catalogueFitKey.split('#')[0] ?? catalogueFitKey;
            const bounds = boundsForFeatureId(catalogueGeoJSON, featureId);
            if (bounds) {
                engine.fitBounds(bounds);
            }
        }
    }, [catalogueFitKey, catalogueGeoJSON]);

    useEffect(() => {
        const engine = engineRef.current;
        if (!engine) {
            return;
        }
        engine.setDrawTool(engineDrawTool(tool));
        engine.setDraftVertices(draft.map((point) => [point.lng, point.lat]));
        engine.setDraftCaption(tool === 'ruler' ? draftCaption : null);
    }, [draft, draftCaption, tool]);

    useEffect(() => {
        const engine = engineRef.current;
        if (!engine) {
            return;
        }
        if (!coveragePreview) {
            engine.setCoveragePreview(null);
            return;
        }
        const origin = {
            type: 'WGS84',
            coordinates: { lat: coveragePreview.origin.lat, lon: coveragePreview.origin.lon },
        };
        engine.setCoveragePreview({
            work: agriToGeoJSON({ origin, points: coveragePreview.work }).work,
            headlands: agriToGeoJSON({ origin, points: coveragePreview.headlands }).work,
        });
    }, [coveragePreview]);

    useEffect(() => {
        engineRef.current?.setSweptEnvelope(sweptEnvelope);
    }, [sweptEnvelope]);

    useEffect(() => {
        engineRef.current?.setPoseFootprint(poseFootprint ?? null);
    }, [poseFootprint]);

    useEffect(() => {
        engineRef.current?.setPoseMarker(poseLngLat);
    }, [poseLngLat]);

    useEffect(() => {
        if (!poseLngLat || poseFlyKey <= 0) {
            return;
        }
        engineRef.current?.flyTo(poseLngLat, 18);
    }, [poseFlyKey, poseLngLat]);

    const clickEnabled = tool !== 'none' || Boolean(onMapClick);
    useEffect(() => {
        const host = hostRef.current;
        if (!host || !clickEnabled) {
            return;
        }
        const canDragSelection = tool === 'select_zone' && !extendActive;
        let down: { x: number; y: number } | null = null;
        let capturing = false;
        let dragStarted = false;
        let pointerId: number | null = null;
        const ignoreTarget = (event: Event) => {
            const target = event.target;
            return (
                target instanceof Element &&
                Boolean(
                    target.closest(
                        '.studio-place-search, .maplibregl-ctrl, .maplibregl-marker, .studio-draft-vertex, button, input, select, textarea, a',
                    ),
                )
            );
        };
        const releaseCapture = () => {
            capturing = false;
            dragStarted = false;
            engineRef.current?.setDragPanEnabled(true);
            delete host.dataset.selectionDrag;
            if (pointerId !== null && host.hasPointerCapture(pointerId)) {
                host.releasePointerCapture(pointerId);
            }
            pointerId = null;
        };
        const onDown = (event: PointerEvent) => {
            if (event.button !== 0 || ignoreTarget(event)) {
                return;
            }
            down = { x: event.clientX, y: event.clientY };
            if (!canDragSelection || event.shiftKey) {
                return;
            }
            const picked = engineRef.current?.unproject(event.clientX, event.clientY);
            if (!picked || !onBeginSelectionDragRef.current?.(picked)) {
                return;
            }
            capturing = true;
            dragStarted = false;
            pointerId = event.pointerId;
            host.dataset.selectionHit = 'row';
            engineRef.current?.setDragPanEnabled(false);
            host.setPointerCapture(event.pointerId);
            event.preventDefault();
            event.stopPropagation();
        };
        const onMove = (event: PointerEvent) => {
            const hit = engineRef.current?.hitTestDraft(event.clientX, event.clientY);
            host.dataset.draftHit = hit?.kind ?? '';
            const lngLat = engineRef.current?.unproject(event.clientX, event.clientY);
            if (capturing) {
                if (!down) {
                    return;
                }
                const dx = event.clientX - down.x;
                const dy = event.clientY - down.y;
                if (!dragStarted && dx * dx + dy * dy > 64) {
                    dragStarted = true;
                    host.dataset.selectionDrag = 'true';
                }
                if (dragStarted && lngLat) {
                    onUpdateSelectionDragRef.current?.(lngLat);
                }
                return;
            }
            if (canDragSelection && lngLat && hitSelectedSectionRef.current?.(lngLat)) {
                host.dataset.selectionHit = 'row';
            } else {
                delete host.dataset.selectionHit;
            }
        };
        const onUp = (event: PointerEvent) => {
            if (!down) {
                return;
            }
            const dx = event.clientX - down.x;
            const dy = event.clientY - down.y;
            const screenClick = dx * dx + dy * dy <= 64;
            down = null;
            if (capturing) {
                const lngLat = engineRef.current?.unproject(event.clientX, event.clientY);
                const result = lngLat
                    ? (onFinishSelectionDragRef.current?.(lngLat) ?? 'none')
                    : 'none';
                if (!lngLat) {
                    onCancelSelectionDragRef.current?.();
                }
                releaseCapture();
                if (result === 'click' && screenClick && !ignoreTarget(event) && lngLat) {
                    onMapClickRef.current?.(lngLat, { shiftKey: event.shiftKey });
                }
                return;
            }
            if (ignoreTarget(event) || !screenClick) {
                return;
            }
            const hit = engineRef.current?.hitTestDraft(event.clientX, event.clientY);
            if (hit?.kind === 'vertex') {
                return;
            }
            if (hit?.kind === 'edge') {
                if (tool === 'ruler') {
                    return;
                }
                onInsertVertexRef.current?.(hit.afterIndex, hit.lngLat);
                return;
            }
            const picked = engineRef.current?.unproject(event.clientX, event.clientY);
            if (picked) {
                onMapClickRef.current?.(picked, { shiftKey: event.shiftKey });
            }
        };
        const onCancel = () => {
            if (!capturing) {
                down = null;
                return;
            }
            onCancelSelectionDragRef.current?.();
            down = null;
            releaseCapture();
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !capturing) {
                return;
            }
            onCancel();
        };
        host.addEventListener('pointerdown', onDown, true);
        host.addEventListener('pointermove', onMove);
        host.addEventListener('pointercancel', onCancel);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('keydown', onKey);
        return () => {
            if (capturing) {
                onCancelSelectionDragRef.current?.();
                engineRef.current?.setDragPanEnabled(true);
            }
            delete host.dataset.draftHit;
            delete host.dataset.selectionHit;
            delete host.dataset.selectionDrag;
            host.removeEventListener('pointerdown', onDown, true);
            host.removeEventListener('pointermove', onMove);
            host.removeEventListener('pointercancel', onCancel);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('keydown', onKey);
        };
    }, [clickEnabled, extendActive, tool]);

    return (
        <div
            ref={hostRef}
            className="studio-map-host"
            data-tool={tool}
            data-map-tool={tool === 'none' ? undefined : tool}
            data-map-extend={extendActive ? 'true' : undefined}
        >
            <div ref={containerRef} className="studio-map" data-map-engine="maplibre" />
            <PlaceSearch
                t={t}
                metricsCaption={metricsCaption}
                onSelect={(hit) => {
                    const zoom = hit.provider === 'browser' ? GEOLOCATION_ZOOM : SEARCH_ZOOM;
                    engineRef.current?.flyTo([hit.lon, hit.lat], zoom);
                    engineRef.current?.showPin([hit.lon, hit.lat], hit.label);
                }}
            />
        </div>
    );
}
