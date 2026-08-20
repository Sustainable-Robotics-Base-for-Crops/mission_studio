import {
    GeoJSONSource,
    Map as MapLibreMap,
    Marker,
    NavigationControl,
    Popup,
    ScaleControl,
    type FilterSpecification,
    type StyleSpecification,
} from 'maplibre-gl';

import {
    emptyLineCollection,
    emptyPolygonCollection,
    type MissionGeoJSON,
} from './agri-to-geojson';
import {
    labelAnchorLngLat,
    POINT_LABEL_OFFSET_PX,
    shouldShowCatalogueLabel,
} from './catalogue-labels';
import {
    CATALOGUE_OVERLAY_SWATCH,
    catalogueKindPaint,
    catalogueOverlayForKind,
    catalogueOverlayRank,
} from './catalogue-style';
import type { MapEngine, RowLabelMode } from './engine';
import {
    BASEMAPS,
    initialView,
    MAP_MAX_ZOOM,
    MAP_STYLE,
    type BasemapId,
    type MapView,
    type OverlayId,
} from './styles';
import { hitTestDraftPolyline } from './draft-hit';
import {
    coordinatesToSvgPath,
    createMapSvgOverlay,
    ensureForbiddenHatchPattern,
    lineFeaturesToSvgPath,
    polygonFeaturesToSvgPath,
    removeSvgPathsByPrefix,
    sizeMapSvgOverlay,
    svgById,
    upsertSvgPath,
    upsertSvgText,
} from './svg-overlay';

const SOURCE = {
    work: 'mission-work',
    transit: 'mission-transit',
    turn: 'mission-turn',
    selected: 'mission-selected',
    geofence: 'mission-geofence',
    catalogue: 'field-catalogue',
    draft: 'mission-draft',
} as const;

type DraftCollection = {
    type: 'FeatureCollection';
    features: Array<{
        type: 'Feature';
        properties: { kind: 'line' | 'vertices' };
        geometry:
            | { type: 'LineString'; coordinates: [number, number][] }
            | { type: 'Point'; coordinates: [number, number] };
    }>;
};

function emptyDraftCollection(): DraftCollection {
    return { type: 'FeatureCollection', features: [] };
}

function draftCollection(vertices: [number, number][]): DraftCollection {
    const features: DraftCollection['features'] = [];
    if (vertices.length >= 2) {
        features.push({
            type: 'Feature',
            properties: { kind: 'line' },
            geometry: { type: 'LineString', coordinates: vertices },
        });
    }
    for (const coordinates of vertices) {
        features.push({
            type: 'Feature',
            properties: { kind: 'vertices' },
            geometry: { type: 'Point', coordinates },
        });
    }
    return { type: 'FeatureCollection', features };
}

type SettableGeoJSON = MissionGeoJSON['work'] | MissionGeoJSON['geofence'] | DraftCollection;

/**
 * Push GeoJSON as soon as the source exists. Do not wait for `isStyleLoaded()`:
 * MapLibre reports false while raster tiles (satellite) or a previous setData
 * are in flight, which would drop both the draft polyline and the densified
 * work line after Valider.
 */
function setSourceData(map: MapLibreMap | null, id: string, data: SettableGeoJSON): boolean {
    const source = map?.getSource(id);
    if (source?.type !== 'geojson' || typeof (source as GeoJSONSource).setData !== 'function') {
        return false;
    }
    (source as GeoJSONSource).setData(data);
    return true;
}

function createVertexElement(index: number): HTMLDivElement {
    const element = document.createElement('div');
    element.className = 'studio-draft-vertex';
    element.dataset.index = String(index);
    element.setAttribute('aria-hidden', 'true');
    return element;
}

function createCaptionElement(text: string): HTMLDivElement {
    const element = document.createElement('div');
    element.className = 'studio-ruler-label';
    element.textContent = text;
    return element;
}

function createPoseElement(): HTMLDivElement {
    const element = document.createElement('div');
    element.className = 'studio-sim-pose';
    element.setAttribute('aria-hidden', 'true');
    return element;
}

function rasterStyle(): StyleSpecification {
    return {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
            'basemap-plan': {
                type: 'raster',
                tiles: BASEMAPS.plan.tiles,
                tileSize: BASEMAPS.plan.tileSize,
                attribution: BASEMAPS.plan.attribution,
                maxzoom: BASEMAPS.plan.maxzoom,
            },
            'basemap-satellite': {
                type: 'raster',
                tiles: BASEMAPS.satellite.tiles,
                tileSize: BASEMAPS.satellite.tileSize,
                attribution: BASEMAPS.satellite.attribution,
                maxzoom: BASEMAPS.satellite.maxzoom,
            },
            'basemap-terrain': {
                type: 'raster',
                tiles: BASEMAPS.terrain.tiles,
                tileSize: BASEMAPS.terrain.tileSize,
                attribution: BASEMAPS.terrain.attribution,
                maxzoom: BASEMAPS.terrain.maxzoom,
            },
        },
        layers: [
            {
                id: 'basemap-plan',
                type: 'raster',
                source: 'basemap-plan',
                paint: { 'raster-resampling': 'linear' },
            },
            {
                id: 'basemap-satellite',
                type: 'raster',
                source: 'basemap-satellite',
                layout: { visibility: 'none' },
                paint: { 'raster-resampling': 'linear' },
            },
            {
                id: 'basemap-terrain',
                type: 'raster',
                source: 'basemap-terrain',
                layout: { visibility: 'none' },
                paint: { 'raster-resampling': 'linear' },
            },
        ],
    };
}

function forbiddenHatchImage(): {
    width: number;
    height: number;
    data: Uint8Array;
} {
    const size = 8;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const on = (x + y) % 4 < 2;
            const index = (y * size + x) * 4;
            if (on) {
                data[index] = 0xb9;
                data[index + 1] = 0x1c;
                data[index + 2] = 0x1c;
                data[index + 3] = 170;
            }
        }
    }
    return { width: size, height: size, data };
}

function addMissionLayers(map: MapLibreMap): void {
    const emptyLines = emptyLineCollection();
    map.addSource(SOURCE.geofence, { type: 'geojson', data: emptyPolygonCollection() });
    map.addSource(SOURCE.work, { type: 'geojson', data: emptyLines });
    map.addSource(SOURCE.transit, { type: 'geojson', data: emptyLineCollection() });
    map.addSource(SOURCE.turn, { type: 'geojson', data: emptyLineCollection() });
    map.addSource(SOURCE.selected, { type: 'geojson', data: emptyLineCollection() });

    map.addLayer({
        id: 'geofence-fill',
        type: 'fill',
        source: SOURCE.geofence,
        paint: { 'fill-color': MAP_STYLE.geofenceLine, 'fill-opacity': 0 },
    });
    map.addLayer({
        id: 'geofence-halo',
        type: 'line',
        source: SOURCE.geofence,
        layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': MAP_STYLE.satelliteHalo,
            'line-width': MAP_STYLE.geofenceWidth + MAP_STYLE.satelliteHaloExtra,
        },
    });
    map.addLayer({
        id: 'geofence-line',
        type: 'line',
        source: SOURCE.geofence,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': MAP_STYLE.geofenceLine,
            'line-width': MAP_STYLE.geofenceWidth,
        },
    });

    map.addSource(SOURCE.catalogue, { type: 'geojson', data: emptyPolygonCollection() });
    try {
        if (!map.hasImage('forbidden-hatch')) {
            const hatch = forbiddenHatchImage();
            map.addImage('forbidden-hatch', {
                width: hatch.width,
                height: hatch.height,
                data: new Uint8ClampedArray(hatch.data),
            });
        }
    } catch {
        // Hatch is optional; catalogue fill/line layers must still mount.
    }
    const catalogueGroups: Array<{ overlay: 'parcels' | 'zones' | 'obstacles' }> = [
        { overlay: 'parcels' },
        { overlay: 'zones' },
        { overlay: 'obstacles' },
    ];
    for (const group of catalogueGroups) {
        const filter: FilterSpecification = ['==', ['get', 'overlay'], group.overlay];
        map.addLayer({
            id: `catalogue-${group.overlay}-fill`,
            type: 'fill',
            source: SOURCE.catalogue,
            filter,
            layout: { visibility: 'none' },
            paint: {
                'fill-color': CATALOGUE_OVERLAY_SWATCH[group.overlay],
                'fill-opacity': 0.12,
            },
        });
        map.addLayer({
            id: `catalogue-${group.overlay}-line`,
            type: 'line',
            source: SOURCE.catalogue,
            filter,
            layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': CATALOGUE_OVERLAY_SWATCH[group.overlay],
                'line-width': 2,
            },
        });
    }
    map.addLayer({
        id: 'catalogue-traversable-dash',
        type: 'line',
        source: SOURCE.catalogue,
        filter: ['==', ['get', 'kind'], 'traversable'],
        layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': '#64748B',
            'line-width': 2,
            'line-dasharray': [2, 2],
        },
    });
    map.addLayer({
        id: 'catalogue-forbidden-hatch',
        type: 'fill',
        source: SOURCE.catalogue,
        filter: ['==', ['get', 'kind'], 'forbidden'],
        layout: { visibility: 'none' },
        paint: { 'fill-pattern': 'forbidden-hatch' },
    });
    map.addLayer({
        id: 'catalogue-selected',
        type: 'line',
        source: SOURCE.catalogue,
        filter: ['==', ['get', 'selected'], true],
        layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': MAP_STYLE.selectedHalo,
            'line-width': 4,
        },
    });

    map.addLayer({
        id: 'selected-halo',
        type: 'line',
        source: SOURCE.selected,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': MAP_STYLE.selectedHalo,
            'line-width': MAP_STYLE.selectedHaloWidth,
            'line-opacity': MAP_STYLE.selectedHaloOpacity,
        },
    });

    const lineLayers: Array<{
        source: string;
        prefix: string;
        color: string;
        width: number;
        dash?: [number, number];
    }> = [
        { source: SOURCE.work, prefix: 'work', color: MAP_STYLE.work, width: MAP_STYLE.workWidth },
        {
            source: SOURCE.transit,
            prefix: 'transit',
            color: MAP_STYLE.transit,
            width: MAP_STYLE.transitWidth,
            dash: MAP_STYLE.transitDash,
        },
        { source: SOURCE.turn, prefix: 'turn', color: MAP_STYLE.turn, width: MAP_STYLE.turnWidth },
    ];

    for (const layer of lineLayers) {
        map.addLayer({
            id: `${layer.prefix}-halo`,
            type: 'line',
            source: layer.source,
            layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': MAP_STYLE.satelliteHalo,
                'line-width': layer.width + MAP_STYLE.satelliteHaloExtra,
            },
        });
        map.addLayer({
            id: `${layer.prefix}-line`,
            type: 'line',
            source: layer.source,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': layer.color,
                'line-width': layer.width,
                ...(layer.dash ? { 'line-dasharray': layer.dash } : {}),
            },
        });
    }

    map.addSource(SOURCE.draft, { type: 'geojson', data: emptyDraftCollection() });
    map.addLayer({
        id: 'draft-line',
        type: 'line',
        source: SOURCE.draft,
        filter: ['==', ['get', 'kind'], 'line'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': MAP_STYLE.work,
            'line-width': MAP_STYLE.workWidth,
            'line-dasharray': [2, 1.5],
        },
    });
    map.addLayer({
        id: 'draft-vertices',
        type: 'circle',
        source: SOURCE.draft,
        filter: ['==', ['get', 'kind'], 'vertices'],
        paint: {
            'circle-radius': 5,
            'circle-color': MAP_STYLE.work,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF',
        },
    });
}

export function createMapLibreEngine(): MapEngine {
    let map: MapLibreMap | null = null;
    let overlay: SVGSVGElement | null = null;
    let basemap: BasemapId = 'plan';
    let lastMission: MissionGeoJSON | null = null;
    let lastCatalogue: MissionGeoJSON['geofence'] | null = null;
    let lastDraft: [number, number][] = [];
    let lastCoveragePreview: {
        work: MissionGeoJSON['work'];
        headlands: MissionGeoJSON['work'];
    } | null = null;
    let lastSweptEnvelope: MissionGeoJSON['geofence'] | null = null;
    let lastPoseFootprint: MissionGeoJSON['geofence'] | null = null;
    let lastPose: [number, number] | null = null;
    let pin: Marker | null = null;
    let poseMarker: Marker | null = null;
    let pinTimer: number | null = null;
    let drawTool: 'none' | 'draw_line' | 'draw_polygon' = 'none';
    const draftMarkers: Marker[] = [];
    let captionMarker: Marker | null = null;
    let draftCaption: string | null = null;
    let draggingVertex: number | null = null;
    let vertexDragHandler: ((index: number, lngLat: [number, number]) => void) | null = null;
    const clickHandlers = new Set<(lngLat: [number, number]) => void>();
    const overlayVisible: Partial<Record<OverlayId, boolean>> = {
        trajectories: true,
        parcels: true,
        zones: true,
        obstacles: true,
        guidance: true,
        rows: true,
        traffic: true,
        labels: true,
        envelopes: true,
        simulation: true,
    };
    let rowLabelMode: RowLabelMode = 'off';

    const applyBasemap = () => {
        if (!map) {
            return;
        }
        for (const id of ['plan', 'satellite', 'terrain'] as const) {
            const visibility = id === basemap ? 'visible' : 'none';
            if (map.getLayer(`basemap-${id}`)) {
                map.setLayoutProperty(`basemap-${id}`, 'visibility', visibility);
            }
        }
        const haloOn = basemap === 'satellite';
        const trajHalo = haloOn && overlayVisible.trajectories !== false ? 'visible' : 'none';
        const parcelHalo = haloOn && overlayVisible.parcels !== false ? 'visible' : 'none';
        for (const id of ['work-halo', 'transit-halo', 'turn-halo']) {
            if (map.getLayer(id)) {
                map.setLayoutProperty(id, 'visibility', trajHalo);
            }
        }
        if (map.getLayer('geofence-halo')) {
            map.setLayoutProperty('geofence-halo', 'visibility', parcelHalo);
        }
    };

    const applyOverlays = () => {
        if (!map) {
            return;
        }
        const instance = map;
        const setVisibility = (ids: string[], visible: boolean) => {
            const value = visible ? 'visible' : 'none';
            for (const id of ids) {
                if (instance.getLayer(id)) {
                    instance.setLayoutProperty(id, 'visibility', value);
                }
            }
        };
        setVisibility(
            ['work-line', 'transit-line', 'turn-line', 'selected-halo'],
            overlayVisible.trajectories !== false,
        );
        setVisibility(['geofence-line', 'geofence-fill'], overlayVisible.parcels !== false);
        applyBasemap();
    };

    const applyCursor = () => {
        if (!map) {
            return;
        }
        const cursor = drawTool === 'none' ? '' : 'crosshair';
        map.getCanvas().style.cursor = cursor;
        map.getCanvasContainer().style.cursor = cursor;
    };

    const clearDraftMarkers = () => {
        for (const marker of draftMarkers) {
            marker.remove();
        }
        draftMarkers.length = 0;
    };

    const syncCaption = () => {
        captionMarker?.remove();
        captionMarker = null;
        if (!map || !draftCaption || lastDraft.length < 2) {
            return;
        }
        const start = lastDraft[0];
        const end = lastDraft[lastDraft.length - 1];
        if (!start || !end) {
            return;
        }
        captionMarker = new Marker({
            element: createCaptionElement(draftCaption),
            anchor: 'bottom',
        })
            .setLngLat([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2])
            .addTo(map);
    };

    const syncPoseMarker = () => {
        poseMarker?.remove();
        poseMarker = null;
        if (!map || !lastPose || overlayVisible.simulation === false) {
            return;
        }
        poseMarker = new Marker({ element: createPoseElement(), anchor: 'center' })
            .setLngLat(lastPose)
            .addTo(map);
    };

    const projectLngLat = (lng: number, lat: number) => {
        if (!map) {
            return null;
        }
        const point = map.project({ lng, lat });
        return { x: point.x, y: point.y };
    };

    const paintSvgLine = (
        id: string,
        d: string,
        color: string,
        width: number,
        dash?: string,
        halo = false,
    ) => {
        if (!overlay) {
            return;
        }
        if (halo && d) {
            upsertSvgPath(
                overlay,
                `${id}-halo`,
                d,
                {
                    stroke: MAP_STYLE.satelliteHalo,
                    'stroke-width': String(width + MAP_STYLE.satelliteHaloExtra),
                },
                { beforeId: id },
            );
        } else if (overlay.querySelector(`#${id}-halo`)) {
            upsertSvgPath(overlay, `${id}-halo`, '', { stroke: MAP_STYLE.satelliteHalo });
        }
        upsertSvgPath(overlay, id, d, {
            stroke: color,
            'stroke-width': String(width),
            'stroke-dasharray': dash ?? 'none',
            fill: 'none',
            'fill-opacity': '0',
        });
    };

    const paintSvgPolygon = (
        id: string,
        d: string,
        color: string,
        options: {
            halo?: boolean;
            dash?: string;
            fillOpacity?: number;
            fill?: string;
            strokeWidth?: number;
            dataFill?: boolean;
        } = {},
    ) => {
        if (!overlay) {
            return;
        }
        const halo = options.halo === true;
        const strokeWidth = options.strokeWidth ?? MAP_STYLE.geofenceWidth;
        if (halo && d) {
            upsertSvgPath(
                overlay,
                `${id}-halo`,
                d,
                {
                    stroke: MAP_STYLE.satelliteHalo,
                    'stroke-width': String(strokeWidth + MAP_STYLE.satelliteHaloExtra),
                    fill: 'none',
                },
                { beforeId: id },
            );
        } else if (svgById(overlay, `${id}-halo`)) {
            upsertSvgPath(overlay, `${id}-halo`, '', { stroke: MAP_STYLE.satelliteHalo });
        }
        const fillOpacity = d ? (options.fillOpacity ?? MAP_STYLE.fillOpacity) : 0;
        const attrs: Record<string, string> = {
            stroke: color,
            'stroke-width': String(strokeWidth),
            'stroke-dasharray': options.dash ?? 'none',
            fill: options.fill ?? color,
            'fill-opacity': String(fillOpacity),
            'fill-rule': 'nonzero',
            'data-fill': options.dataFill === true && fillOpacity > 0 ? '1' : '0',
        };
        upsertSvgPath(overlay, id, d, attrs);
    };

    const paintCatalogueOverlay = () => {
        if (!overlay) {
            return;
        }
        ensureForbiddenHatchPattern(overlay);
        const halo = basemap === 'satellite';
        const features = [...(lastCatalogue?.features ?? [])].sort((left, right) => {
            const leftOverlay = String(left.properties?.overlay ?? '');
            const rightOverlay = String(right.properties?.overlay ?? '');
            return catalogueOverlayRank(leftOverlay) - catalogueOverlayRank(rightOverlay);
        });
        const kept = new Set<string>();
        const labelled: Array<{
            id: string;
            kind: string;
            label: string;
            geometry: { type?: string; coordinates?: unknown };
        }> = [];
        let index = 0;
        for (const feature of features) {
            const geometry = feature.geometry as {
                type?: string;
                coordinates?: unknown;
            };
            const kind = String(feature.properties?.kind ?? 'field');
            const overlayId = String(feature.properties?.overlay ?? catalogueOverlayForKind(kind));
            if (overlayId === 'parcels' && overlayVisible.parcels === false) {
                continue;
            }
            if (overlayId === 'zones' && overlayVisible.zones === false) {
                continue;
            }
            if (overlayId === 'obstacles' && overlayVisible.obstacles === false) {
                continue;
            }
            if (overlayId === 'guidance' && overlayVisible.guidance === false) {
                continue;
            }
            if (overlayId === 'rows' && overlayVisible.rows === false) {
                continue;
            }
            if (overlayId === 'traffic' && overlayVisible.traffic === false) {
                continue;
            }
            const paint = catalogueKindPaint(kind);
            const id = `svg-cat-${index}`;
            if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
                const projected = projectLngLat(
                    Number(geometry.coordinates[0]),
                    Number(geometry.coordinates[1]),
                );
                if (!projected) {
                    continue;
                }
                const radius = 6;
                const d = `M${(projected.x - radius).toFixed(1)} ${projected.y.toFixed(1)} a ${radius} ${radius} 0 1 0 ${(radius * 2).toFixed(1)} 0 a ${radius} ${radius} 0 1 0 ${(-radius * 2).toFixed(1)} 0`;
                index += 1;
                kept.add(id);
                kept.add(`${id}-halo`);
                paintSvgPolygon(id, d, paint.line, {
                    halo,
                    fill: paint.fill,
                    fillOpacity: paint.fillOpacity,
                    strokeWidth: paint.lineWidth,
                    dataFill: paint.fillOpacity > 0,
                });
                if (feature.properties?.selected === true) {
                    const selectedId = `${id}-selected`;
                    kept.add(selectedId);
                    paintSvgPolygon(selectedId, d, MAP_STYLE.selectedHalo, {
                        fill: 'none',
                        fillOpacity: 0,
                        strokeWidth: 4,
                    });
                }
                labelled.push({
                    id,
                    kind,
                    label: String(feature.properties?.label ?? '').trim(),
                    geometry,
                });
                continue;
            }
            if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
                const d = coordinatesToSvgPath(
                    geometry.coordinates as Array<[number, number]>,
                    projectLngLat,
                );
                if (!d) {
                    continue;
                }
                const dash = paint.dash ? `${paint.dash[0]} ${paint.dash[1]}` : undefined;
                index += 1;
                kept.add(id);
                kept.add(`${id}-halo`);
                paintSvgLine(id, d, paint.line, paint.lineWidth, dash, halo);
                if (feature.properties?.selected === true) {
                    const selectedId = `${id}-selected`;
                    kept.add(selectedId);
                    paintSvgLine(selectedId, d, MAP_STYLE.selectedHalo, 4, undefined, false);
                }
                labelled.push({
                    id,
                    kind,
                    label: String(feature.properties?.label ?? '').trim(),
                    geometry,
                });
                continue;
            }
            if (geometry.type !== 'Polygon') {
                continue;
            }
            const ring = (geometry.coordinates as number[][][] | undefined)?.[0];
            if (!Array.isArray(ring)) {
                continue;
            }
            const d = coordinatesToSvgPath(ring as Array<[number, number]>, projectLngLat, true);
            if (!d) {
                continue;
            }
            index += 1;
            kept.add(id);
            kept.add(`${id}-halo`);
            paintSvgPolygon(id, d, paint.line, {
                halo,
                dash: paint.dash ? '6 4.5' : undefined,
                fill: paint.fill,
                fillOpacity: paint.fillOpacity,
                strokeWidth: paint.lineWidth,
                dataFill: paint.fillOpacity > 0,
            });
            if (paint.hatch) {
                const hatchId = `${id}-hatch`;
                kept.add(hatchId);
                upsertSvgPath(overlay, hatchId, d, {
                    fill: 'url(#studio-hatch-forbidden)',
                    'fill-opacity': '1',
                    stroke: 'none',
                    'data-fill': '1',
                });
            }
            if (feature.properties?.selected === true) {
                const selectedId = `${id}-selected`;
                kept.add(selectedId);
                upsertSvgPath(overlay, selectedId, d, {
                    stroke: MAP_STYLE.selectedHalo,
                    'stroke-width': '4',
                    fill: 'none',
                });
            }
            labelled.push({
                id,
                kind,
                label: String(feature.properties?.label ?? '').trim(),
                geometry,
            });
        }
        const zoom = map?.getZoom() ?? 0;
        const labelsOn = overlayVisible.labels !== false;
        for (const item of labelled) {
            if (
                !shouldShowCatalogueLabel({
                    labelsVisible: labelsOn,
                    overlayVisible: true,
                    kind: item.kind,
                    zoom,
                    label: item.label,
                })
            ) {
                continue;
            }
            const anchor = labelAnchorLngLat(item.geometry);
            if (!anchor) {
                continue;
            }
            const projected = projectLngLat(anchor[0], anchor[1]);
            if (!projected) {
                continue;
            }
            const labelId = `${item.id}-label`;
            kept.add(labelId);
            upsertSvgText(
                overlay,
                labelId,
                item.label,
                projected.x,
                item.geometry.type === 'Point' ? projected.y - POINT_LABEL_OFFSET_PX : projected.y,
            );
        }
        removeSvgPathsByPrefix(overlay, 'svg-cat-', kept);
    };

    const paintRowLabels = () => {
        const svg = overlay;
        if (!svg) {
            return;
        }
        const kept = new Set<string>();
        const zoom = map?.getZoom() ?? 0;
        const minZoom = rowLabelMode === 'large' ? 15 : 17;
        const show =
            rowLabelMode !== 'off' &&
            overlayVisible.trajectories !== false &&
            zoom >= minZoom &&
            lastMission !== null;
        if (show && lastMission) {
            const seen = new Set<number>();
            lastMission.work.features.forEach((feature) => {
                const label = String(feature.properties.label ?? '').trim();
                const sectionIndex = Number(feature.properties.sectionIndex);
                if (!label || !Number.isFinite(sectionIndex) || seen.has(sectionIndex)) {
                    return;
                }
                seen.add(sectionIndex);
                const anchor = labelAnchorLngLat(feature.geometry);
                if (!anchor) {
                    return;
                }
                const projected = projectLngLat(anchor[0], anchor[1]);
                if (!projected) {
                    return;
                }
                const id = `svg-row-${sectionIndex}`;
                kept.add(id);
                upsertSvgText(svg, id, label, projected.x, projected.y, {
                    class:
                        rowLabelMode === 'large' ? 'studio-row-label is-large' : 'studio-row-label',
                });
            });
        }
        removeSvgPathsByPrefix(svg, 'svg-row-', kept);
    };

    const syncOverlay = () => {
        if (!map || !overlay) {
            return;
        }
        const canvas = map.getContainer();
        sizeMapSvgOverlay(overlay, canvas.clientWidth, canvas.clientHeight);
        const halo = basemap === 'satellite';
        const trajOn = overlayVisible.trajectories !== false;
        const parcelOn = overlayVisible.parcels !== false;
        const geofence =
            parcelOn && lastMission
                ? polygonFeaturesToSvgPath(lastMission.geofence.features, projectLngLat)
                : '';
        const workable =
            trajOn && lastMission
                ? polygonFeaturesToSvgPath(lastMission.workable.features, projectLngLat)
                : '';
        const traversable =
            trajOn && lastMission
                ? polygonFeaturesToSvgPath(lastMission.traversable.features, projectLngLat)
                : '';
        const work =
            trajOn && lastMission
                ? lineFeaturesToSvgPath(lastMission.work.features, projectLngLat)
                : '';
        const transit =
            trajOn && lastMission
                ? lineFeaturesToSvgPath(lastMission.transit.features, projectLngLat)
                : '';
        const turn =
            trajOn && lastMission
                ? lineFeaturesToSvgPath(lastMission.turn.features, projectLngLat)
                : '';
        const closeDraft = drawTool === 'draw_polygon' && lastDraft.length >= 3;
        const draft =
            lastDraft.length >= 2 ? coordinatesToSvgPath(lastDraft, projectLngLat, closeDraft) : '';
        paintSvgPolygon('svg-geofence', geofence, MAP_STYLE.geofenceLine, { halo });
        paintCatalogueOverlay();
        paintSvgPolygon('svg-workable', workable, MAP_STYLE.fillWorkable, { halo });
        paintSvgPolygon('svg-traversable', traversable, MAP_STYLE.transit, {
            halo,
            dash: '6 4.5',
            fillOpacity: 0.1,
        });
        const selected =
            trajOn && lastMission?.selected
                ? lineFeaturesToSvgPath(lastMission.selected.features, projectLngLat)
                : '';
        if (overlay) {
            upsertSvgPath(
                overlay,
                'svg-selected-halo',
                selected,
                {
                    stroke: MAP_STYLE.selectedHalo,
                    'stroke-width': String(MAP_STYLE.selectedHaloWidth),
                    'stroke-opacity': selected ? String(MAP_STYLE.selectedHaloOpacity) : '0',
                    fill: 'none',
                },
                { beforeId: 'svg-work' },
            );
            upsertSvgPath(overlay, 'svg-selected', '', { stroke: MAP_STYLE.selectedHalo });
        }
        paintSvgLine('svg-work', work, MAP_STYLE.work, MAP_STYLE.workWidth, undefined, halo);
        paintSvgLine(
            'svg-transit',
            transit,
            MAP_STYLE.transit,
            MAP_STYLE.transitWidth,
            '8 6',
            halo,
        );
        paintSvgLine('svg-turn', turn, MAP_STYLE.turn, MAP_STYLE.turnWidth, undefined, halo);
        if (drawTool === 'draw_polygon') {
            paintSvgPolygon('svg-draft', draft, MAP_STYLE.geofenceLine, {
                halo,
                dash: '6 4.5',
            });
        } else {
            paintSvgLine('svg-draft', draft, MAP_STYLE.work, MAP_STYLE.workWidth, '6 4.5', halo);
        }
        const coverageWork =
            lastCoveragePreview != null
                ? lineFeaturesToSvgPath(lastCoveragePreview.work.features, projectLngLat)
                : '';
        const coverageHeadlands =
            lastCoveragePreview != null
                ? lineFeaturesToSvgPath(lastCoveragePreview.headlands.features, projectLngLat)
                : '';
        paintSvgLine(
            'svg-coverage-work',
            coverageWork,
            MAP_STYLE.coveragePreview,
            MAP_STYLE.coveragePreviewWidth,
            '10 6',
            halo,
        );
        paintSvgLine(
            'svg-coverage-headland',
            coverageHeadlands,
            MAP_STYLE.coverageHeadland,
            MAP_STYLE.coverageHeadlandWidth,
            '4 4',
            halo,
        );
        const envelopeOn = overlayVisible.envelopes !== false;
        const swept =
            envelopeOn && lastSweptEnvelope
                ? polygonFeaturesToSvgPath(lastSweptEnvelope.features, projectLngLat)
                : '';
        paintSvgPolygon('svg-swept', swept, MAP_STYLE.envelopeLine, {
            halo,
            fill: MAP_STYLE.envelopeFill,
            fillOpacity: MAP_STYLE.envelopeFillOpacity,
            strokeWidth: MAP_STYLE.envelopeWidth,
        });
        const simOn = overlayVisible.simulation !== false;
        const poseVehicle =
            simOn && lastPoseFootprint
                ? polygonFeaturesToSvgPath(
                      lastPoseFootprint.features.filter(
                          (feature) => feature.properties.kind === 'vehicle',
                      ),
                      projectLngLat,
                  )
                : '';
        const poseImplement =
            simOn && lastPoseFootprint
                ? polygonFeaturesToSvgPath(
                      lastPoseFootprint.features.filter(
                          (feature) => feature.properties.kind === 'implement',
                      ),
                      projectLngLat,
                  )
                : '';
        paintSvgPolygon('svg-pose-vehicle', poseVehicle, MAP_STYLE.poseVehicleLine, {
            halo,
            fill: MAP_STYLE.poseVehicleFill,
            fillOpacity: MAP_STYLE.poseFootprintFillOpacity,
            strokeWidth: MAP_STYLE.poseFootprintWidth,
        });
        paintSvgPolygon('svg-pose-implement', poseImplement, MAP_STYLE.poseImplementLine, {
            halo,
            fill: MAP_STYLE.poseImplementFill,
            fillOpacity: MAP_STYLE.poseFootprintFillOpacity,
            strokeWidth: MAP_STYLE.poseFootprintWidth,
        });
        paintRowLabels();
    };

    const mountOverlay = () => {
        if (!map || !overlay) {
            return;
        }
        const host = map.getCanvasContainer();
        if (overlay.parentElement !== host) {
            host.appendChild(overlay);
        }
    };

    const onStyleReady = (engine: MapEngine) => {
        if (!map) {
            return;
        }
        mountOverlay();
        if (!map.getSource(SOURCE.work)) {
            addMissionLayers(map);
        }
        if (lastMission) {
            engine.renderMission(lastMission);
        }
        if (lastCatalogue) {
            engine.renderCatalogue(lastCatalogue);
        }
        engine.setDraftVertices(lastDraft);
        applyOverlays();
        applyCursor();
        syncOverlay();
    };

    return {
        attach(container: HTMLElement, view?: MapView | null) {
            if (map) {
                this.detach();
            }
            const camera = initialView(view);
            const instance = new MapLibreMap({
                container,
                style: rasterStyle(),
                center: camera.center,
                zoom: camera.zoom,
                attributionControl: { compact: true },
                maxZoom: MAP_MAX_ZOOM,
            });
            map = instance;
            overlay = createMapSvgOverlay();
            instance.getCanvasContainer().appendChild(overlay);
            instance.doubleClickZoom.disable();
            instance.addControl(
                new NavigationControl({ showCompass: true, visualizePitch: true }),
                'bottom-right',
            );
            instance.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
            instance.on('mousemove', applyCursor);
            instance.on('move', syncOverlay);
            instance.on('resize', syncOverlay);
            instance.once('load', () => onStyleReady(this));
            if (instance.isStyleLoaded() === true) {
                onStyleReady(this);
            }
            syncOverlay();
        },
        detach() {
            if (pinTimer !== null) {
                window.clearTimeout(pinTimer);
                pinTimer = null;
            }
            pin?.remove();
            pin = null;
            poseMarker?.remove();
            poseMarker = null;
            overlay?.remove();
            overlay = null;
            clearDraftMarkers();
            captionMarker?.remove();
            captionMarker = null;
            map?.off('mousemove', applyCursor);
            map?.off('move', syncOverlay);
            map?.off('resize', syncOverlay);
            map?.remove();
            map = null;
        },
        resize() {
            map?.resize();
        },
        getView() {
            if (!map) {
                return null;
            }
            const center = map.getCenter();
            return { lat: center.lat, lon: center.lng, zoom: map.getZoom() };
        },
        setBasemap(id: BasemapId) {
            basemap = id;
            applyBasemap();
            syncOverlay();
        },
        getBasemap() {
            return basemap;
        },
        setOverlayVisible(id: OverlayId, visible: boolean) {
            overlayVisible[id] = visible;
            applyOverlays();
            syncOverlay();
            syncPoseMarker();
        },
        setRowLabelMode(mode: RowLabelMode) {
            rowLabelMode = mode;
            syncOverlay();
        },
        renderMission(geojson: MissionGeoJSON) {
            lastMission = geojson;
            setSourceData(map, SOURCE.work, geojson.work);
            setSourceData(map, SOURCE.transit, geojson.transit);
            setSourceData(map, SOURCE.turn, geojson.turn);
            setSourceData(map, SOURCE.selected, geojson.selected);
            setSourceData(map, SOURCE.geofence, geojson.geofence);
            syncOverlay();
        },
        renderCatalogue(collection: MissionGeoJSON['geofence']) {
            lastCatalogue = collection;
            setSourceData(map, SOURCE.catalogue, collection);
            syncOverlay();
        },
        fitBounds(bounds: [[number, number], [number, number]] | null) {
            if (!map || !bounds) {
                return;
            }
            const [sw, ne] = bounds;
            if (sw[0] === ne[0] && sw[1] === ne[1]) {
                map.easeTo({ center: sw, zoom: 18 });
                return;
            }
            map.fitBounds([sw, ne], { padding: 48, maxZoom: 20, duration: 400 });
        },
        fitToMission() {
            if (!map || !lastMission?.bounds) {
                return;
            }
            const [sw, ne] = lastMission.bounds;
            if (sw[0] === ne[0] && sw[1] === ne[1]) {
                map.easeTo({ center: sw, zoom: 18 });
                return;
            }
            map.fitBounds([sw, ne], { padding: 48, maxZoom: 20, duration: 400 });
        },
        flyTo(lngLat, zoom) {
            map?.easeTo({ center: lngLat, zoom, duration: 600 });
        },
        showPin(lngLat, label) {
            if (!map) {
                return;
            }
            if (pinTimer !== null) {
                window.clearTimeout(pinTimer);
            }
            pin?.remove();
            pin = new Marker()
                .setLngLat(lngLat)
                .setPopup(new Popup({ closeButton: false }).setText(label))
                .addTo(map);
            pin.togglePopup();
            pinTimer = window.setTimeout(() => {
                pin?.remove();
                pin = null;
                pinTimer = null;
            }, 10000);
        },
        onClick(handler) {
            clickHandlers.add(handler);
            return () => {
                clickHandlers.delete(handler);
            };
        },
        unproject(clientX, clientY) {
            if (!map) {
                return null;
            }
            const rect = map.getContainer().getBoundingClientRect();
            const lngLat = map.unproject([clientX - rect.left, clientY - rect.top]);
            return [lngLat.lng, lngLat.lat];
        },
        setDragPanEnabled(enabled) {
            if (enabled) {
                map?.dragPan.enable();
            } else {
                map?.dragPan.disable();
            }
        },
        hitTestDraft(clientX, clientY) {
            const instance = map;
            if (!instance || lastDraft.length === 0) {
                return null;
            }
            const rect = instance.getContainer().getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;
            const projected = lastDraft.flatMap((coordinates) => {
                const lng = coordinates[0];
                const lat = coordinates[1];
                if (lng === undefined || lat === undefined) {
                    return [];
                }
                const point = instance.project({ lng, lat });
                return [{ x: point.x, y: point.y }];
            });
            const hit = hitTestDraftPolyline(projected, x, y, {
                closed: drawTool === 'draw_polygon',
                vertexRadius: 14,
                edgeRadius: 12,
            });
            if (!hit) {
                return null;
            }
            if (hit.kind === 'vertex') {
                return hit;
            }
            const start = lastDraft[hit.afterIndex];
            const end = lastDraft[(hit.afterIndex + 1) % lastDraft.length];
            if (!start || !end || start[0] === undefined || start[1] === undefined) {
                return null;
            }
            const endLng = end[0];
            const endLat = end[1];
            if (endLng === undefined || endLat === undefined) {
                return null;
            }
            return {
                kind: 'edge',
                afterIndex: hit.afterIndex,
                lngLat: [
                    start[0] + hit.t * (endLng - start[0]),
                    start[1] + hit.t * (endLat - start[1]),
                ],
            };
        },
        onDraftVertexDrag(handler) {
            vertexDragHandler = handler;
            return () => {
                if (vertexDragHandler === handler) {
                    vertexDragHandler = null;
                }
            };
        },
        setDraftVertices(vertices) {
            if (draggingVertex !== null) {
                lastDraft = vertices.slice();
                syncOverlay();
                syncCaption();
                return;
            }
            lastDraft = vertices.slice();
            clearDraftMarkers();
            const instance = map;
            if (!instance) {
                return;
            }
            lastDraft.forEach((coordinates, index) => {
                const lng = coordinates[0];
                const lat = coordinates[1];
                if (lng === undefined || lat === undefined) {
                    return;
                }
                const marker = new Marker({
                    element: createVertexElement(index),
                    anchor: 'center',
                    draggable: true,
                })
                    .setLngLat([lng, lat])
                    .addTo(instance);
                marker.on('dragstart', () => {
                    draggingVertex = index;
                    map?.dragPan.disable();
                });
                marker.on('drag', () => {
                    const lngLat = marker.getLngLat();
                    lastDraft[index] = [lngLat.lng, lngLat.lat];
                    syncOverlay();
                    syncCaption();
                });
                marker.on('dragend', () => {
                    const lngLat = marker.getLngLat();
                    lastDraft[index] = [lngLat.lng, lngLat.lat];
                    draggingVertex = null;
                    map?.dragPan.enable();
                    syncOverlay();
                    vertexDragHandler?.(index, [lngLat.lng, lngLat.lat]);
                });
                draftMarkers.push(marker);
            });
            setSourceData(instance, SOURCE.draft, draftCollection(lastDraft));
            syncOverlay();
            syncCaption();
        },
        setCoveragePreview(preview) {
            lastCoveragePreview = preview;
            syncOverlay();
        },
        setSweptEnvelope(collection) {
            lastSweptEnvelope = collection;
            syncOverlay();
        },
        setPoseFootprint(collection) {
            lastPoseFootprint = collection;
            syncOverlay();
        },
        setPoseMarker(lngLat) {
            lastPose = lngLat;
            syncPoseMarker();
        },
        setDraftCaption(caption) {
            draftCaption = caption && caption.trim() !== '' ? caption : null;
            syncCaption();
        },
        setDrawTool(tool) {
            drawTool = tool;
            applyCursor();
            syncOverlay();
            if (!map) {
                return;
            }
            map.doubleClickZoom.disable();
        },
    };
}
