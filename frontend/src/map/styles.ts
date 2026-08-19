import { COLOR } from '../design-system/tokens';

export const MAP_STYLE = {
    geofenceLine: COLOR.primary800,
    geofenceWidth: 2,
    work: COLOR.planned,
    workWidth: 3,
    coveragePreview: COLOR.planned,
    coveragePreviewWidth: 3,
    coverageHeadland: COLOR.warning,
    coverageHeadlandWidth: 3,
    /** Non-worked (wz 0): CdCF slate was too close to work blue; neon magenta, still dashed. */
    transit: '#FF2EC8',
    transitWidth: 3,
    transitDash: [8 / 3, 6 / 3] as [number, number],
    /** Manoeuvres: same magenta family as transit, solid (dash is what marks wz 0). */
    turn: '#FF2EC8',
    turnWidth: 3,
    /**
     * Selection: neon yellow halo only. The inner stroke keeps work blue /
     * transit-turn magenta so the operator still reads the section type.
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
} as const;

export type BasemapId = 'plan' | 'satellite' | 'terrain';

export const SEARCH_ZOOM = 15;
export const GEOLOCATION_ZOOM = 17;
export const MAP_MAX_ZOOM = 22;

export const BASEMAPS: Record<
    BasemapId,
    { tiles: string[]; attribution: string; tileSize: number; maxzoom: number }
> = {
    plan: {
        tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'],
        attribution: '© CARTO © OpenStreetMap',
        tileSize: 256,
        maxzoom: 18,
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

export const LAYER_CATALOG = [
    { id: 'trajectories', lot: null },
    { id: 'parcels', lot: null },
    { id: 'zones', lot: null },
    { id: 'obstacles', lot: null },
    { id: 'rows', lot: null },
    { id: 'guidance', lot: null },
    { id: 'traffic', lot: null },
    { id: 'labels', lot: null },
    { id: 'envelopes', lot: 'L10' },
    { id: 'slopes', lot: 'L3' },
    { id: 'prescriptions', lot: 'L12' },
    { id: 'simulation', lot: 'L10' },
    { id: 'executed', lot: 'L12' },
] as const;

export type OverlayId = (typeof LAYER_CATALOG)[number]['id'];
