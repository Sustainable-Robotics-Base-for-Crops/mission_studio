export type ImportedGeometry = {
    type: string;
    coordinates: unknown;
};

export type ImportedFeature = {
    type: 'Feature';
    properties: Record<string, unknown> | null;
    geometry: ImportedGeometry | null;
};

export type ImportedCollection = {
    type: 'FeatureCollection';
    features: ImportedFeature[];
};

export type ImportedLayer = {
    id: string;
    name: string;
    visible: boolean;
    collection: ImportedCollection;
    bounds: [[number, number], [number, number]] | null;
};

export type ParseImportedResult =
    { layer: ImportedLayer } | { error: 'map.imports.invalid' | 'map.imports.emptyFeatures' };

const SUPPORTED_TYPES = new Set([
    'Point',
    'MultiPoint',
    'LineString',
    'MultiLineString',
    'Polygon',
    'MultiPolygon',
]);

/** Sentinel GNSS placeholders (NO_FIX indoor) must not pull the camera to Null Island. */
export function isUsableSurveyCoordinate(lng: number, lat: number): boolean {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return false;
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return false;
    }
    return !(lng === 0 && lat === 0);
}

function visitCoordinates(value: unknown, visit: (lng: number, lat: number) => void): void {
    if (!Array.isArray(value) || value.length === 0) {
        return;
    }
    if (typeof value[0] === 'number') {
        const lng = Number(value[0]);
        const lat = Number(value[1]);
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
            visit(lng, lat);
        }
        return;
    }
    for (const item of value) {
        visitCoordinates(item, visit);
    }
}

export function boundsOfImportedCollection(
    collection: ImportedCollection,
): [[number, number], [number, number]] | null {
    const accumulate = (usableOnly: boolean): [[number, number], [number, number]] | null => {
        let minLng = Infinity;
        let minLat = Infinity;
        let maxLng = -Infinity;
        let maxLat = -Infinity;
        for (const feature of collection.features) {
            if (!feature.geometry) {
                continue;
            }
            visitCoordinates(feature.geometry.coordinates, (lng, lat) => {
                if (usableOnly && !isUsableSurveyCoordinate(lng, lat)) {
                    return;
                }
                minLng = Math.min(minLng, lng);
                minLat = Math.min(minLat, lat);
                maxLng = Math.max(maxLng, lng);
                maxLat = Math.max(maxLat, lat);
            });
        }
        if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) {
            return null;
        }
        return [
            [minLng, minLat],
            [maxLng, maxLat],
        ];
    };
    return accumulate(true) ?? accumulate(false);
}

export function layerNameFromFile(fileName: string, existing: readonly string[]): string {
    const trimmed = fileName.trim();
    const base =
        trimmed.replace(/\.(geojson|json|zip|shp|xml|kml|gpkg)$/i, '') || trimmed || 'import';
    if (!existing.includes(base)) {
        return base;
    }
    let index = 2;
    while (existing.includes(`${base} (${index})`)) {
        index += 1;
    }
    return `${base} (${index})`;
}

function asFeature(value: unknown): ImportedFeature | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value as {
        type?: unknown;
        geometry?: unknown;
        properties?: unknown;
    };
    if (candidate.type !== 'Feature') {
        return null;
    }
    const geometry = candidate.geometry;
    if (!geometry || typeof geometry !== 'object') {
        return null;
    }
    const typed = geometry as { type?: unknown; coordinates?: unknown };
    if (typeof typed.type !== 'string' || !SUPPORTED_TYPES.has(typed.type)) {
        return null;
    }
    const properties =
        candidate.properties && typeof candidate.properties === 'object'
            ? (candidate.properties as Record<string, unknown>)
            : null;
    return {
        type: 'Feature',
        properties,
        geometry: { type: typed.type, coordinates: typed.coordinates },
    };
}

/**
 * A FeatureCollection becomes an overlay layer. Shared by the local GeoJSON
 * reader and by the collections an import adapter normalises server-side, so
 * both paths get the same validation, naming and camera bounds.
 */
export function layerFromCollection(
    document: unknown,
    fileName: string,
    options: { id: string; existingNames: readonly string[] },
): ParseImportedResult {
    const parsed = document;
    const typed = parsed as { type?: unknown; features?: unknown };
    if (!parsed || typeof parsed !== 'object' || typed.type !== 'FeatureCollection') {
        return { error: 'map.imports.invalid' };
    }
    const rawFeatures = typed.features;
    if (!Array.isArray(rawFeatures)) {
        return { error: 'map.imports.invalid' };
    }
    const features = rawFeatures
        .map(asFeature)
        .filter((feature): feature is ImportedFeature => Boolean(feature));
    if (features.length === 0) {
        return { error: 'map.imports.emptyFeatures' };
    }
    const collection: ImportedCollection = { type: 'FeatureCollection', features };
    const bounds = boundsOfImportedCollection(collection);
    if (!bounds) {
        return { error: 'map.imports.emptyFeatures' };
    }
    return {
        layer: {
            id: options.id,
            name: layerNameFromFile(fileName, options.existingNames),
            visible: true,
            collection,
            bounds,
        },
    };
}

export function parseImportedGeoJSON(
    text: string,
    fileName: string,
    options: { id: string; existingNames: readonly string[] },
): ParseImportedResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { error: 'map.imports.invalid' };
    }
    return layerFromCollection(parsed, fileName, options);
}
