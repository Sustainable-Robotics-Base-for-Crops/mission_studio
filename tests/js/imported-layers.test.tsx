import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { StudioProviders } from '../../frontend/src/design-system';
import { translate } from '../../frontend/src/i18n/adapter';
import { LayersPopover } from '../../frontend/src/map/LayersPopover';
import {
    layerFromCollection,
    layerNameFromFile,
    parseImportedGeoJSON,
    type ImportedLayer,
} from '../../frontend/src/map/imported-layers';
import { MAP_STYLE } from '../../frontend/src/map/styles';

const survey = {
    type: 'FeatureCollection',
    features: [
        {
            type: 'Feature',
            properties: {
                srbc_kind: 'landmark',
                survey_kind: 'parcel_boundary',
                name: 'P1',
            },
            geometry: { type: 'Point', coordinates: [3.17, 45.85] },
        },
        {
            type: 'Feature',
            properties: { srbc_kind: 'landmark', survey_kind: 'row_start', name: 'R1' },
            geometry: { type: 'Point', coordinates: [3.171, 45.851] },
        },
    ],
};

describe('imported GeoJSON layers', () => {
    it('parses a survey pole FeatureCollection and names the layer after the file', () => {
        const parsed = parseImportedGeoJSON(JSON.stringify(survey), 'sabi-expe.geojson', {
            id: 'i1',
            existingNames: [],
        });
        expect('layer' in parsed).toBe(true);
        if (!('layer' in parsed)) {
            return;
        }
        expect(parsed.layer.name).toBe('sabi-expe');
        expect(parsed.layer.visible).toBe(true);
        expect(parsed.layer.collection.features).toHaveLength(2);
        expect(parsed.layer.bounds).toEqual([
            [3.17, 45.85],
            [3.171, 45.851],
        ]);
    });

    it('ignores a NO_FIX 0,0 placeholder when fitting the camera', () => {
        const parsed = parseImportedGeoJSON(
            JSON.stringify({
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        properties: { fix_quality: 'NO_FIX', name: 'p1-indoor' },
                        geometry: { type: 'Point', coordinates: [0.0, 0.0] },
                    },
                    {
                        type: 'Feature',
                        properties: { fix_quality: 'FIX', name: 'row_start' },
                        geometry: { type: 'Point', coordinates: [3.165665, 45.8505786] },
                    },
                    {
                        type: 'Feature',
                        properties: { fix_quality: 'FIX', name: 'row_end' },
                        geometry: { type: 'Point', coordinates: [3.165636, 45.850574] },
                    },
                ],
            }),
            'essai-mac-ethernet.geojson',
            { id: 'i2', existingNames: [] },
        );
        expect('layer' in parsed).toBe(true);
        if (!('layer' in parsed)) {
            return;
        }
        expect(parsed.layer.bounds?.[0][0]).toBeGreaterThan(3);
        expect(parsed.layer.bounds?.[0][1]).toBeGreaterThan(45);
        expect(parsed.layer.collection.features).toHaveLength(3);
    });

    it('rejects empty or invalid documents', () => {
        expect(parseImportedGeoJSON('{', 'a.geojson', { id: 'i1', existingNames: [] })).toEqual({
            error: 'map.imports.invalid',
        });
        expect(
            parseImportedGeoJSON(
                JSON.stringify({ type: 'FeatureCollection', features: [] }),
                'a.geojson',
                { id: 'i1', existingNames: [] },
            ),
        ).toEqual({ error: 'map.imports.emptyFeatures' });
    });

    it('uniquifies duplicate file names', () => {
        expect(layerNameFromFile('sabi-expe.geojson', ['sabi-expe'])).toBe('sabi-expe (2)');
        expect(layerNameFromFile('sabi-expe.geojson', ['sabi-expe', 'sabi-expe (2)'])).toBe(
            'sabi-expe (3)',
        );
    });

    it('names a layer after a vendor archive, not after its extension', () => {
        expect(layerNameFromFile('96515576_shape_Avize Retraite.zip', [])).toBe(
            '96515576_shape_Avize Retraite',
        );
    });

    it('turns an adapter collection into a layer without going through text', () => {
        const parsed = layerFromCollection(
            {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        properties: { srbc_import: { kind: 'row', vendor: 'naio' } },
                        geometry: {
                            type: 'LineString',
                            coordinates: [
                                [6.75, 43.616],
                                [6.751, 43.616],
                            ],
                        },
                    },
                ],
            },
            '101-106-traces.geojson',
            { id: 'i3', existingNames: [] },
        );
        expect('layer' in parsed).toBe(true);
        if (!('layer' in parsed)) {
            return;
        }
        expect(parsed.layer.name).toBe('101-106-traces');
        expect(parsed.layer.collection.features[0].properties?.srbc_import).toEqual({
            kind: 'row',
            vendor: 'naio',
        });
    });

    it('lists imported files in Couches with a visibility toggle and a trash action', () => {
        const onImportedVisible = vi.fn();
        const onImportedRemove = vi.fn();
        const layers: ImportedLayer[] = [
            {
                id: 'i1',
                name: 'sabi-expe',
                visible: true,
                collection: survey,
                bounds: [
                    [3.17, 45.85],
                    [3.171, 45.851],
                ],
            },
        ];
        const element: ReactElement = (
            <StudioProviders>
                <LayersPopover
                    t={(key) => translate(key, {}, 'fr')}
                    basemap="plan"
                    onBasemap={vi.fn()}
                    overlays={{}}
                    onOverlay={vi.fn()}
                    importedLayers={layers}
                    onImportedVisible={onImportedVisible}
                    onImportedRemove={onImportedRemove}
                />
            </StudioProviders>
        );
        render(element);
        fireEvent.click(screen.getByRole('button', { name: 'Couches' }));
        expect(screen.getByText('Fichiers importés')).toBeDefined();
        expect(screen.getByText('sabi-expe')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: /sabi-expe/ }));
        expect(onImportedVisible).toHaveBeenCalledWith('i1', false);
        fireEvent.click(screen.getByRole('button', { name: 'Retirer ce calque' }));
        expect(onImportedRemove).toHaveBeenCalledWith('i1');
        expect(MAP_STYLE.imported).toBe('#C2410C');
    });
});
