import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { agriToGeoJSON, localToLngLat } from '../../frontend/src/map/agri-to-geojson';
import { flattenMissionList } from '../../frontend/src/map/missions-api';
import { normalizePlaceHits } from '../../frontend/src/map/geocoding-api';
import { COLOR } from '../../frontend/src/design-system/tokens';
import { LAYER_CATALOG, MAP_STYLE, BASEMAPS } from '../../frontend/src/map/styles';
import { CATALOGUE_KIND_PAINT } from '../../frontend/src/map/catalogue-style';
import {
    appendDrawnLine,
    applyDrawnWorkingZone,
    createEmptyDocument,
    setDrawnGeofence,
} from '../../frontend/src/domain/draft';
import {
    coordinatesToSvgPath,
    createMapSvgOverlay,
    lineFeaturesToSvgPath,
    polygonFeaturesToSvgPath,
    upsertSvgPath,
    upsertSvgText,
    removeSvgPathsByPrefix,
} from '../../frontend/src/map/svg-overlay';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function loadGolden(name: string): unknown {
    return JSON.parse(readFileSync(resolve(ROOT, 'tests/golden', name), 'utf8'));
}

describe('localToLngLat', () => {
    it('matches GeometryUtils.localToLatLng (origin + planar 111320 m/°)', () => {
        const origin = { lat: 45.85, lon: 3.17 };
        expect(localToLngLat(0, 0, origin)).toEqual([3.17, 45.85]);
        const [lng, lat] = localToLngLat(0, 1, origin);
        expect(lat).toBeCloseTo(45.85 + 1 / 111320, 10);
        expect(lng).toBeCloseTo(3.17, 10);
    });
});

describe('agriToGeoJSON', () => {
    it('returns an empty mission without a document or origin', () => {
        expect(agriToGeoJSON(null).bounds).toBeNull();
        expect(agriToGeoJSON({ points: [] }).work.features).toHaveLength(0);
    });

    it('projects the minimal golden fixture to a work line', () => {
        const geojson = agriToGeoJSON(loadGolden('synthetic_minimal.v3.json'));
        expect(geojson.work.features).toHaveLength(1);
        expect(geojson.transit.features).toHaveLength(0);
        expect(geojson.turn.features).toHaveLength(0);
        expect(geojson.geofence.features).toHaveLength(0);
        expect(geojson.bounds).not.toBeNull();
        const geometry = geojson.work.features[0]?.geometry;
        expect(geometry?.type).toBe('LineString');
        expect(geometry?.coordinates).toHaveLength(3);
        expect(geojson.work.features[0]?.properties.label).toBe(1);
    });

    it('fits the camera on the trajectory, not a larger geofence', () => {
        const origin = { lat: 45.85, lon: 3.17 };
        const empty = createEmptyDocument();
        empty.origin = { coordinates: { lat: origin.lat, lon: origin.lon } };
        const withLine = appendDrawnLine(empty, [
            { lat: origin.lat, lng: origin.lon },
            { lat: origin.lat + 5 / 111320, lng: origin.lon },
        ]);
        expect(withLine.ok).toBe(true);
        if (!withLine.ok) {
            return;
        }
        const withFence = setDrawnGeofence(withLine.document, [
            { lat: origin.lat - 200 / 111320, lng: origin.lon - 200 / 111320 },
            { lat: origin.lat + 200 / 111320, lng: origin.lon - 200 / 111320 },
            { lat: origin.lat + 200 / 111320, lng: origin.lon + 200 / 111320 },
            { lat: origin.lat - 200 / 111320, lng: origin.lon + 200 / 111320 },
        ]);
        expect(withFence.ok).toBe(true);
        if (!withFence.ok) {
            return;
        }
        const geojson = agriToGeoJSON(withFence.document);
        expect(geojson.geofence.features).toHaveLength(1);
        const [sw, ne] = geojson.bounds ?? [
            [0, 0],
            [0, 0],
        ];
        const heightM = (ne[1] - sw[1]) * 111320;
        expect(heightM).toBeLessThan(20);
        expect(heightM).toBeGreaterThan(1);
    });

    it('copies selected section features into the selection halo collection', () => {
        const document = loadGolden('synthetic_minimal.v3.json');
        const none = agriToGeoJSON(document);
        expect(none.selected.features).toHaveLength(0);
        const selected = agriToGeoJSON(document, [0]);
        expect(selected.selected.features.length).toBeGreaterThan(0);
        expect(
            selected.selected.features.every((feature) => feature.properties.sectionIndex === 0),
        ).toBe(true);
    });

    it('omits hidden sections from the mission GeoJSON', () => {
        const document = loadGolden('synthetic_all_section_types.v3.json');
        const full = agriToGeoJSON(document);
        const hidden = agriToGeoJSON(document, [], [0]);
        expect(hidden.work.features.length + hidden.turn.features.length).toBeLessThan(
            full.work.features.length + full.turn.features.length,
        );
    });

    it('splits the all-section-types golden into work, turns and geofence', () => {
        const geojson = agriToGeoJSON(loadGolden('synthetic_all_section_types.v3.json'));
        expect(geojson.work.features).toHaveLength(2);
        expect(geojson.transit.features).toHaveLength(0);
        expect(geojson.turn.features).toHaveLength(2);
        expect(geojson.geofence.features).toHaveLength(1);
        expect(geojson.geofence.features[0]?.geometry.type).toBe('Polygon');
        const geofenceGeometry = geojson.geofence.features[0]?.geometry;
        const ring =
            geofenceGeometry?.type === 'Polygon' ? geofenceGeometry.coordinates[0] : undefined;
        expect(ring).toHaveLength(5);
        expect(ring?.[0]).toEqual(ring?.[ring.length - 1]);
    });

    it('splits a field section on working_zone like MapView.renderSections', () => {
        const geojson = agriToGeoJSON({
            origin: { coordinates: { lat: 45.85, lon: 3.17 } },
            points: [
                {
                    section_type: 'row_path',
                    columns: ['x', 'y', 'working_zone'],
                    values: [
                        [0, 0, 1],
                        [0, 1, 1],
                        [0, 2, 0],
                        [0, 3, 0],
                    ],
                },
            ],
        });
        expect(geojson.work.features).toHaveLength(1);
        expect(geojson.transit.features).toHaveLength(1);
        expect(geojson.work.features[0]?.geometry.coordinates).toHaveLength(2);
        expect(geojson.transit.features[0]?.geometry.coordinates).toHaveLength(2);
    });

    it('colours work lines by speed only when several speeds coexist', () => {
        const mixed = agriToGeoJSON({
            origin: { coordinates: { lat: 45.85, lon: 3.17 } },
            points: [
                {
                    section_type: 'row_line',
                    columns: ['x', 'y', 'speed', 'working_zone'],
                    values: [
                        [0, 0, 0.1, 1],
                        [0, 1, 0.1, 1],
                    ],
                },
                {
                    section_type: 'row_line',
                    columns: ['x', 'y', 'speed', 'working_zone'],
                    values: [
                        [2, 0, 1, 1],
                        [2, 1, 1, 1],
                    ],
                },
            ],
        });
        expect(mixed.work.features).toHaveLength(2);
        expect(mixed.work.features[0]?.properties.lineColor).toBe('#7F9C96');
        expect(mixed.work.features[1]?.properties.lineColor).toBe('#1B4079');

        const uniform = agriToGeoJSON({
            origin: { coordinates: { lat: 45.85, lon: 3.17 } },
            points: [
                {
                    section_type: 'row_line',
                    columns: ['x', 'y', 'speed', 'working_zone'],
                    values: [
                        [0, 0, 1, 1],
                        [0, 1, 1, 1],
                    ],
                },
            ],
        });
        expect(uniform.work.features[0]?.properties.lineColor).toBeUndefined();
    });

    it('projects a line drawn on an empty draft (origin 48,2) back onto the clicks', () => {
        const start = { lat: 45.85, lng: 3.17 };
        const end = { lat: start.lat + 1 / 111320, lng: start.lng };
        const result = appendDrawnLine(
            {
                version: '3',
                origin: { type: 'WGS84', coordinates: { lat: 48, lon: 2, alt: 0 } },
                points: [],
            },
            [start, end],
        );
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        const geojson = agriToGeoJSON(result.document);
        expect(geojson.work.features).toHaveLength(1);
        const coordinates = geojson.work.features[0]?.geometry.coordinates;
        expect(coordinates?.length).toBe(2);
        expect(coordinates?.[0]?.[0]).toBeCloseTo(start.lng, 4);
        expect(coordinates?.[0]?.[1]).toBeCloseTo(start.lat, 4);
        expect(coordinates?.[coordinates.length - 1]?.[0]).toBeCloseTo(end.lng, 4);
        expect(coordinates?.[coordinates.length - 1]?.[1]).toBeCloseTo(end.lat, 4);
    });

    it('projects a drawn geofence onto a closed polygon', () => {
        const ring = [
            { lat: 45.85, lng: 3.17 },
            { lat: 45.8504, lng: 3.17 },
            { lat: 45.8504, lng: 3.1705 },
        ];
        const result = setDrawnGeofence(
            {
                version: '3',
                origin: { type: 'WGS84', coordinates: { lat: 45.85, lon: 3.17, alt: 0 } },
                points: [],
            },
            ring,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        const geojson = agriToGeoJSON(result.document);
        expect(geojson.geofence.features).toHaveLength(1);
        const polygonRing =
            geojson.geofence.features[0]?.geometry.type === 'Polygon'
                ? geojson.geofence.features[0].geometry.coordinates[0]
                : undefined;
        expect(polygonRing?.length).toBeGreaterThanOrEqual(4);
        expect(polygonRing?.[0]).toEqual(polygonRing?.[polygonRing.length - 1]);
    });

    it('renders geofence exclusions and applies their eye visibility independently', () => {
        const document = {
            origin: { coordinates: { lat: 45.85, lon: 3.17 } },
            points: [],
            geofencing: {
                columns: ['x', 'y'],
                values: [
                    [0, 0],
                    [20, 0],
                    [20, 10],
                    [0, 10],
                ],
            },
            metadata: {
                srbc_geofence_exclusions: [
                    [
                        [2, 2],
                        [4, 2],
                        [4, 5],
                        [2, 5],
                    ],
                ],
            },
        };
        const visible = agriToGeoJSON(document, [], [], { selectedId: 'exclusion:0' });
        expect(visible.geofence.features).toHaveLength(2);
        expect(visible.geofence.features[1]?.properties.selected).toBe(true);

        const hidden = agriToGeoJSON(document, [], [], { hiddenIds: ['exclusion:0'] });
        expect(hidden.geofence.features).toHaveLength(1);

        const outerHidden = agriToGeoJSON(document, [], [], { hiddenIds: ['outer'] });
        expect(outerHidden.geofence.features).toHaveLength(0);
    });

    it('does not keep a working-zone polygon overlay after apply', () => {
        const line = appendDrawnLine(createEmptyDocument(), [
            { lat: 45.85, lng: 3.17 },
            { lat: 45.8502, lng: 3.17 },
        ]);
        expect(line.ok).toBe(true);
        if (!line.ok) {
            return;
        }
        const ring = [
            { lat: 45.8499, lng: 3.1699 },
            { lat: 45.8504, lng: 3.1699 },
            { lat: 45.8504, lng: 3.1702 },
            { lat: 45.8499, lng: 3.1702 },
        ];
        const result = applyDrawnWorkingZone(line.document, ring, 0);
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        const geojson = agriToGeoJSON(result.document);
        expect(geojson.traversable.features).toHaveLength(0);
        expect(geojson.workable.features).toHaveLength(0);
        expect(geojson.transit.features.length + geojson.work.features.length).toBeGreaterThan(0);
    });
});

describe('svg overlay paths', () => {
    it('builds an SVG path from projected vertices', () => {
        expect(
            coordinatesToSvgPath(
                [
                    [1, 2],
                    [3, 4],
                    [5, 6],
                ],
                (lng, lat) => ({ x: lng * 10, y: lat * 10 }),
            ),
        ).toBe('M10.0 20.0L30.0 40.0L50.0 60.0');
    });

    it('joins several LineString features', () => {
        expect(
            lineFeaturesToSvgPath(
                [
                    {
                        geometry: {
                            type: 'LineString',
                            coordinates: [
                                [0, 0],
                                [1, 0],
                            ],
                        },
                    },
                    { geometry: { type: 'Point', coordinates: [9, 9] } },
                    {
                        geometry: {
                            type: 'LineString',
                            coordinates: [
                                [2, 2],
                                [3, 2],
                            ],
                        },
                    },
                ],
                (lng, lat) => ({ x: lng, y: lat }),
            ),
        ).toBe('M0.0 0.0L1.0 0.0M2.0 2.0L3.0 2.0');
    });

    it('paints each catalogue polygon as its own SVG path', () => {
        const svg = createMapSvgOverlay();
        upsertSvgPath(svg, 'svg-cat-0', 'M0 0L10 0L10 10Z', {
            fill: '#B91C1C',
            'fill-opacity': '0.12',
            'data-fill': '1',
            stroke: '#B91C1C',
        });
        upsertSvgPath(svg, 'svg-cat-1', 'M20 20L30 20L30 30Z', {
            fill: '#14532D',
            'fill-opacity': '0.06',
            'data-fill': '1',
            stroke: '#14532D',
        });
        expect(svg.querySelectorAll('path[id^="svg-cat-"]')).toHaveLength(2);
        expect(svg.querySelector('#svg-cat-0')?.getAttribute('data-fill')).toBe('1');
    });

    it('upserts catalogue labels and removes stale text with the path prefix', () => {
        const svg = createMapSvgOverlay();
        upsertSvgPath(svg, 'svg-cat-0', 'M0 0L10 0', { stroke: '#14532D' });
        upsertSvgText(svg, 'svg-cat-0-label', 'parcelle 2', 5, 4);
        expect(svg.querySelector('#svg-cat-0-label')?.textContent).toBe('parcelle 2');
        upsertSvgPath(svg, 'svg-cat-1', 'M20 20L30 20', { stroke: '#0F766E' });
        upsertSvgText(svg, 'svg-cat-0-label', 'parcelle 2', 5, 4);
        expect([...svg.querySelectorAll('path, text')].map((node) => node.id).at(-1)).toBe(
            'svg-cat-0-label',
        );
        removeSvgPathsByPrefix(svg, 'svg-cat-', new Set(['svg-cat-1']));
        expect(svg.querySelector('#svg-cat-0')).toBeNull();
        expect(svg.querySelector('#svg-cat-0-label')).toBeNull();
        expect(svg.querySelector('#svg-cat-1')).not.toBeNull();
    });

    it('closes a polygon ring', () => {
        expect(
            coordinatesToSvgPath(
                [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                ],
                (lng, lat) => ({ x: lng, y: lat }),
                true,
            ),
        ).toBe('M0.0 0.0L1.0 0.0L1.0 1.0Z');
        expect(
            polygonFeaturesToSvgPath(
                [
                    {
                        geometry: {
                            type: 'Polygon',
                            coordinates: [
                                [
                                    [0, 0],
                                    [2, 0],
                                    [2, 2],
                                    [0, 0],
                                ],
                            ],
                        },
                    },
                ],
                (lng, lat) => ({ x: lng, y: lat }),
            ),
        ).toBe('M0.0 0.0L2.0 0.0L2.0 2.0L0.0 0.0Z');
    });

    it('inserts a satellite halo behind an already painted stroke', () => {
        const svg = createMapSvgOverlay();
        upsertSvgPath(svg, 'svg-work', 'M0 0L10 0', { stroke: '#2563EB' });
        upsertSvgPath(
            svg,
            'svg-work-halo',
            'M0 0L10 0',
            { stroke: '#FFFFFF' },
            { beforeId: 'svg-work' },
        );
        expect([...svg.querySelectorAll('path')].map((path) => path.id)).toEqual([
            'svg-work-halo',
            'svg-work',
        ]);
    });
});

describe('MAP_STYLE (CdCF §5.2)', () => {
    it('uses the design-system tokens for work, transit, turn and geofence', () => {
        expect(MAP_STYLE.work).toBe('#2563EB');
        expect(MAP_STYLE.work).toBe(COLOR.planned);
        expect(MAP_STYLE.workWidth).toBe(3);
        expect(MAP_STYLE.transit).toBe('#FF2EC8');
        expect(MAP_STYLE.transitWidth).toBe(3);
        expect(MAP_STYLE.turn).toBe('#FF2EC8');
        expect(MAP_STYLE.turnWidth).toBe(3);
        expect(MAP_STYLE.selectedHalo).toBe('#E8FF00');
        expect(MAP_STYLE.selectedHaloWidth).toBe(14);
        // Neon orange, distinct from the catalogue field boundary they overlap with.
        expect(MAP_STYLE.geofenceLine).toBe('#FF7A00');
        expect(MAP_STYLE.geofenceLine).not.toBe(CATALOGUE_KIND_PAINT.field.line);
        expect(MAP_STYLE.geofenceWidth).toBe(3);
        expect(MAP_STYLE.satelliteHalo).toBe('#FFFFFF');
        expect(MAP_STYLE.satelliteHaloExtra).toBe(2);
    });

    it('overzooms Esri satellite past native zoom 19 like Leaflet maxNativeZoom', () => {
        expect(BASEMAPS.satellite.maxzoom).toBe(19);
        expect(BASEMAPS.plan.maxzoom).toBeLessThanOrEqual(20);
        expect(BASEMAPS.terrain.maxzoom).toBeLessThanOrEqual(17);
    });

    it('paints typed zones from CdCF §5.2', () => {
        expect(CATALOGUE_KIND_PAINT.workable.fill).toBe('#15803D');
        expect(CATALOGUE_KIND_PAINT.traversable.fill).toBe('#64748B');
        expect(CATALOGUE_KIND_PAINT.traversable.fillOpacity).toBeLessThanOrEqual(0.15);
        expect(CATALOGUE_KIND_PAINT.autonomy.fill).toBe('#0E7490');
        expect(CATALOGUE_KIND_PAINT.forbidden.fill).toBe('#B91C1C');
        expect(CATALOGUE_KIND_PAINT.headland.fill).toBe('#B45309');
        expect(CATALOGUE_KIND_PAINT.gnss_degraded.hatch).toBe(true);
        expect(CATALOGUE_KIND_PAINT.gnss_degraded.dash).toEqual([4, 3]);
        expect(CATALOGUE_KIND_PAINT.forbidden.hatch).toBe(true);
        expect(CATALOGUE_KIND_PAINT.traversable.dash).toEqual([2, 2]);
        expect(CATALOGUE_KIND_PAINT.field.fill).toBe(COLOR.primary800);
    });

    it('enables trajectories, parcels, zones, obstacles, rows and guidance', () => {
        const live = LAYER_CATALOG.filter((layer) => layer.lot === null).map((layer) => layer.id);
        expect(live).toEqual([
            'trajectories',
            'geofence',
            'parcels',
            'zones',
            'obstacles',
            'rows',
            'guidance',
            'traffic',
            'landmarks',
            'labels',
        ]);
        expect(CATALOGUE_KIND_PAINT.guidance_line.lineWidth).toBe(1.5);
        expect(CATALOGUE_KIND_PAINT.guidance_line.fillOpacity).toBe(0);
        expect(CATALOGUE_KIND_PAINT.row.line).toBe('#78350F');
        expect(CATALOGUE_KIND_PAINT.bed.line).toBe('#8B5E3C');
        expect(CATALOGUE_KIND_PAINT.bed.lineWidth).toBeGreaterThan(0);
        expect(CATALOGUE_KIND_PAINT.traffic_way.dash).toEqual([4, 3]);
        expect(CATALOGUE_KIND_PAINT.traffic_way.line).toBe('#0F766E');
    });

    it('paints swept bands without an outline', () => {
        for (const band of [CATALOGUE_KIND_PAINT.bed_band, CATALOGUE_KIND_PAINT.traffic_band]) {
            expect(band.lineWidth).toBe(0);
            expect(band.dash).toBeNull();
            expect(band.fillOpacity).toBeGreaterThan(0);
            expect(band.fillOpacity).toBeLessThanOrEqual(0.2);
        }
        expect(CATALOGUE_KIND_PAINT.bed_band.fill).toBe('#8B5E3C');
        expect(CATALOGUE_KIND_PAINT.traffic_band.fill).toBe('#334155');
    });
});

describe('flattenMissionList', () => {
    it('flattens the grouped /api/trajectories payload', () => {
        const refs = flattenMissionList([
            {
                type: 'draft',
                vehicles: {
                    v1: [
                        {
                            filename: 'demo.json',
                            actualPath: 'uploads/draft/v1/demo.json',
                        },
                    ],
                },
            },
        ]);
        expect(refs).toEqual([
            {
                path: 'uploads/draft/v1/demo.json',
                name: 'demo.json',
                type: 'draft',
                vehicle: 'v1',
            },
        ]);
    });

    it('ignores malformed groups', () => {
        expect(flattenMissionList(null)).toEqual([]);
        expect(flattenMissionList([{ type: 'draft' }])).toEqual([]);
    });
});

describe('normalizePlaceHits', () => {
    const paris = {
        label: 'Paris, Île-de-France, France',
        lat: 48.8566,
        lon: 2.3522,
        type: 'city',
        provider: 'nominatim',
    };

    it('unwraps the { results } envelope used by GET /api/geocoding/search', () => {
        expect(normalizePlaceHits({ results: [paris] })).toEqual([paris]);
    });

    it('keeps nominatim-shaped rows and drops invalid coordinates', () => {
        expect(
            normalizePlaceHits([
                {
                    label: 'Sabi Agri, Saint-Beauzire',
                    lat: 45.85046,
                    lon: 3.16572,
                    type: 'company',
                    provider: 'nominatim',
                },
                { label: 'bad', lat: 'x', lon: 1 },
            ]),
        ).toEqual([
            {
                label: 'Sabi Agri, Saint-Beauzire',
                lat: 45.85046,
                lon: 3.16572,
                type: 'company',
                provider: 'nominatim',
            },
        ]);
    });
});

describe('map canvas layout', () => {
    it('sizes the MapLibre node at 100% so .maplibregl-map { position:relative } cannot collapse it', () => {
        const css = readFileSync(resolve(ROOT, 'frontend/src/styles/shell.css'), 'utf8');
        expect(css).toContain('.studio-map-host');
        expect(css).toContain('.studio-map.maplibregl-map');
        expect(css).toMatch(/\.studio-map-host\s*\{[^}]*position:\s*absolute/s);
        expect(css).toMatch(/\.studio-map\.maplibregl-map\s*\{[^}]*height:\s*100%/s);
        expect(css).toMatch(
            /\.studio-map-host\[data-map-tool\][\s\S]*cursor:\s*crosshair\s*!important/s,
        );
        expect(css).toContain('[data-map-tool]');
        expect(css).toContain('.studio-draft-vertex');
        expect(css).toContain('cursor: grab');
        expect(css).toContain('cursor: grabbing');
        expect(css).toContain("[data-draft-hit='edge']");
        expect(css).toContain("[data-selection-hit='row']");
        expect(css).toContain("[data-selection-drag='true']");
        expect(css).toContain('.studio-map-svg');
        expect(css).toContain("[data-fill='1']");
        expect(css).toContain('.studio-map .maplibregl-marker');
        expect(css).toContain('.maplibregl-ctrl-compass');
        expect(css).toMatch(/\.studio-map \.maplibregl-ctrl-compass\s*\{[^}]*order:\s*-1/s);
    });

    it('draws draft and work lines on an SVG overlay, not only GeoJSON layers', () => {
        const source = readFileSync(resolve(ROOT, 'frontend/src/map/maplibre-engine.ts'), 'utf8');
        expect(source).toContain('createMapSvgOverlay');
        expect(source).toContain('syncOverlay');
        expect(source).toContain('paintCatalogueOverlay');
        expect(source).toContain('svg-cat-');
        expect(source).toContain('hitTestDraft');
        expect(source).toContain('setDragPanEnabled');
        expect(source).toContain('draggable: true');
        expect(source).toContain('showCompass: true');
        expect(source).toContain('visualizePitch: true');
        expect(source).not.toMatch(/if\s*\(\s*!map\?\.isStyleLoaded\(\)\s*\)\s*\{/);
        expect(source).not.toContain("once('load', apply)");
        expect(source).toContain("instance.once('idle', apply)");
        expect(source).not.toContain('instanceof GeoJSONSource');
        const overlay = readFileSync(resolve(ROOT, 'frontend/src/map/svg-overlay.ts'), 'utf8');
        expect(overlay).toContain('studio-map-svg');
        expect(overlay).toContain('coordinatesToSvgPath');
    });

    it('fits the camera on the rendered trajectory when a mission fitKey arrives', () => {
        const canvas = readFileSync(resolve(ROOT, 'frontend/src/map/MapCanvas.tsx'), 'utf8');
        expect(canvas).toContain('engine.renderMission(geojson)');
        expect(canvas).toContain('engine.fitBounds(geojson.bounds)');
        expect(canvas).toContain('if (fitKey)');
        const shell = readFileSync(resolve(ROOT, 'frontend/src/app/AppShell.tsx'), 'utf8');
        expect(shell).toContain('editor.missionFitNonce');
        expect(shell).toContain("editor.activePath ?? 'draft'");
        const editor = readFileSync(resolve(ROOT, 'frontend/src/map/useMissionEditor.ts'), 'utf8');
        expect(editor).toMatch(
            /missions\.adopt\(path, payload\);\s*setMissionFitNonce\(\(value\) => value \+ 1\);/s,
        );
    });
});
