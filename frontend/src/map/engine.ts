import type { MissionGeoJSON } from './agri-to-geojson';
import type { ImportedLayer } from './imported-layers';
import type { BasemapId, MapView, OverlayId } from './styles';

export type RowLabelMode = 'off' | 'normal' | 'large';
export type SelectionHaloMode = 'yellow' | 'orange' | 'off';

export interface MapEngine {
    attach(container: HTMLElement, view?: MapView | null): void;
    detach(): void;
    resize(): void;
    /** Live camera, for "use the current view as the farm start view". */
    getView(): MapView | null;
    setBasemap(id: BasemapId): void;
    getBasemap(): BasemapId;
    setOverlayVisible(id: OverlayId, visible: boolean): void;
    setRowLabelMode(mode: RowLabelMode): void;
    renderMission(geojson: MissionGeoJSON): void;
    renderCatalogue(collection: MissionGeoJSON['geofence']): void;
    fitBounds(bounds: [[number, number], [number, number]] | null): void;
    fitToMission(): boolean;
    flyTo(lngLat: [number, number], zoom: number): void;
    showPin(lngLat: [number, number], label: string): void;
    onClick(handler: (lngLat: [number, number]) => void): () => void;
    setDraftVertices(vertices: [number, number][], markerLimit?: number): void;
    setOverlayPolygon(vertices: [number, number][] | null): void;
    setSelectionHalo(mode: SelectionHaloMode): void;
    setEndpointMarkers(
        points: Array<{ lngLat: [number, number]; selected?: boolean }> | null,
    ): void;
    setCoveragePreview(
        preview: {
            work: MissionGeoJSON['work'];
            headlands: MissionGeoJSON['work'];
        } | null,
    ): void;
    setSweptEnvelope(collection: MissionGeoJSON['geofence'] | null): void;
    setPoseFootprint(collection: MissionGeoJSON['geofence'] | null): void;
    setPoseMarker(lngLat: [number, number] | null): void;
    setDraftCaption(caption: string | null): void;
    setDrawTool(tool: 'none' | 'draw_line' | 'draw_polygon'): void;
    hitTestDraft(
        clientX: number,
        clientY: number,
    ):
        | { kind: 'vertex'; index: number }
        | { kind: 'edge'; afterIndex: number; lngLat: [number, number] }
        | null;
    onDraftVertexDrag(handler: (index: number, lngLat: [number, number]) => void): () => void;
    unproject(clientX: number, clientY: number): [number, number] | null;
    setDragPanEnabled(enabled: boolean): void;
    setImportedLayers(layers: ImportedLayer[]): void;
}

export type { BasemapId, MapView, OverlayId };
