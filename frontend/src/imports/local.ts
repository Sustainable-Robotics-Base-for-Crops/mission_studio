import { parseImportedGeoJSON } from '../map/imported-layers';
import { ImportRefused, type ImportAdapter, type ImportPreview } from './types';

/**
 * Fallback for builds served by the legacy `http.server`, where `/api/v1` does
 * not exist. Plain GeoJSON still becomes a layer, so turning FastAPI off never
 * takes a working import away; vendor dialects need the backend and say so.
 */
export const LOCAL_ADAPTER: ImportAdapter = {
    id: 'geojson_local',
    label: 'GeoJSON',
    vendor: 'generic',
    extensions: ['.geojson', '.json'],
    kinds: ['landmark'],
};

export async function localPreview(file: File): Promise<ImportPreview> {
    let text: string;
    try {
        text = await file.text();
    } catch {
        throw new ImportRefused('map.imports.readError');
    }
    const parsed = parseImportedGeoJSON(text, file.name, { id: 'local', existingNames: [] });
    if ('error' in parsed) {
        throw new ImportRefused(parsed.error);
    }
    const features = parsed.layer.collection.features;
    const geometryTypes: Record<string, number> = {};
    for (const feature of features) {
        const name = feature.geometry?.type ?? 'Unknown';
        geometryTypes[name] = (geometryTypes[name] ?? 0) + 1;
    }
    return {
        source: { filename: file.name, bytes: file.size },
        adapters: [LOCAL_ADAPTER],
        candidates: [
            {
                adapter: LOCAL_ADAPTER.id,
                confidence: 0.35,
                reason: 'imports.reason.geojson',
                params: { count: features.length },
            },
        ],
        adapter: LOCAL_ADAPTER.id,
        report: {
            adapter: LOCAL_ADAPTER.id,
            label: LOCAL_ADAPTER.label,
            vendor: LOCAL_ADAPTER.vendor,
            feature_count: features.length,
            kinds: { landmark: features.length },
            geometry_types: geometryTypes,
            metrics: [{ key: 'imports.metric.features', value: features.length, unit: null }],
            notices: [{ key: 'imports.notice.localOnly', params: {} }],
            members: [],
            promotions: [],
        },
        collection: parsed.layer.collection,
    };
}
