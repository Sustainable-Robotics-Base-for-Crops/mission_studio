import { COLOR } from '../design-system/tokens';

export const MAP_STYLE = {
    /**
     * Neon orange: the mission geofence and the field boundary are often drawn on
     * top of each other, and the catalogue green (`field.line`) made them merge.
     */
    geofenceLine: '#FF7A00',
    geofenceWidth: 3,
    work: COLOR.planned,
    workWidth: 3,
    coveragePreview: COLOR.planned,
    coveragePreviewWidth: 3,
    coverageHeadland: COLOR.warning,
    coverageHeadlandWidth: 3,
    /** Non-worked (wz 0): same solid magenta as headland turns. */
    transit: '#FF2EC8',
    transitWidth: 3,
    /** Manoeuvres (U-turn, square): solid magenta. */
    turn: '#FF2EC8',
    turnWidth: 3,
    /**
     * Selection: neon yellow halo only. The inner stroke keeps work blue /
     * turn/transit magenta so the operator still reads the section type.
     */
    selectedHalo: '#E8FF00',
    selectedHaloWidth: 14,
    selectedHaloOpacity: 0.5,
    satelliteHalo: '#FFFFFF',
    satelliteHaloExtra: 2,
    fillWorkable: COLOR.valid,
    fillOpacity: 0.12,
    envelopeFill: COLOR.autonomy,
    envelopeLine: COLOR.autonomy,
    envelopeWidth: 1,
    envelopeFillOpacity: 0.12,
    poseVehicleFill: COLOR.primary100,
    poseVehicleLine: COLOR.primary700,
    poseImplementFill: '#CFFAFE',
    poseImplementLine: COLOR.autonomy,
    poseFootprintWidth: 2,
    poseFootprintFillOpacity: 0.55,
    /** Session-only imported survey files (not catalogue). */
    imported: '#C2410C',
    importedFillOpacity: 0.16,
    importedPointRadius: 6,
} as const;

export type BasemapId = 'plan' | 'satellite' | 'terrain';

export const SEARCH_ZOOM = 15;
export const GEOLOCATION_ZOOM = 17;
export const MAP_MAX_ZOOM = 22;

export const BASEMAPS: Record<
    BasemapId,
    {
        tiles: string[];
        labels?: string[];
        attribution: string;
        tileSize: number;
        maxzoom: number;
    }
> = {
    plan: {
        /**
         * Carto `light_all` now watermarks tiles without an API key
         * (carto.com/basemaps/apikey, 2026). Esri Light Gray stays key-free
         * and keeps the desaturated plan look.
         */
        tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        ],
        labels: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        ],
        attribution: '© Esri © OpenStreetMap',
        tileSize: 256,
        maxzoom: 16,
    },
    satellite: {
        tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        attribution: '© Esri, Maxar, Earthstar Geographics',
        tileSize: 256,
        /** Same as Leaflet `/app`: Esri native tiles stop ~19; higher zooms overzoom. */
        maxzoom: 19,
    },
    terrain: {
        tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
        attribution: '© OpenTopoMap © OpenStreetMap',
        tileSize: 256,
        maxzoom: 17,
    },
};

export const DEFAULT_CENTER: [number, number] = [1.8883, 46.6034];
export const DEFAULT_ZOOM = 6;

export interface MapView {
    lat: number;
    lon: number;
    zoom: number;
}

/**
 * Camera to open the map on: the farm start view when it is usable, the national
 * fallback otherwise (L13 §8). Coordinates out of range fall back too — a farm file
 * edited by hand must never send the map into the void.
 */
export function initialView(view: MapView | null | undefined): {
    center: [number, number];
    zoom: number;
} {
    const fallback = { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
    if (!view) {
        return fallback;
    }
    const { lat, lon, zoom } = view;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(zoom)) {
        return fallback;
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || zoom < 0 || zoom > MAP_MAX_ZOOM) {
        return fallback;
    }
    return { center: [lon, lat], zoom };
}

export const LAYER_CATALOG = [
    { id: 'trajectories', lot: null },
    { id: 'geofence', lot: null },
    { id: 'parcels', lot: null },
    { id: 'zones', lot: null },
    { id: 'obstacles', lot: null },
    { id: 'rows', lot: null },
    { id: 'guidance', lot: null },
    { id: 'traffic', lot: null },
    { id: 'landmarks', lot: null },
    { id: 'labels', lot: null },
    { id: 'envelopes', lot: 'L10' },
    { id: 'slopes', lot: 'L3' },
    { id: 'prescriptions', lot: 'L12' },
    { id: 'simulation', lot: 'L10' },
    { id: 'executed', lot: 'L12' },
] as const;

export type OverlayId = (typeof LAYER_CATALOG)[number]['id'];
