import { describe, expect, it } from 'vitest';

import {
    labelAnchorLngLat,
    numberedMapLabel,
    ROW_LABEL_MIN_ZOOM,
    shouldShowCatalogueLabel,
    userMapLabel,
} from '../../frontend/src/map/catalogue-labels';

describe('catalogue map labels', () => {
    it('keeps user names and falls back to the agronomic number', () => {
        expect(userMapLabel('  parcelle 2 ')).toBe('parcelle 2');
        expect(userMapLabel('')).toBe('');
        expect(userMapLabel(null)).toBe('');
        expect(numberedMapLabel('Rang 12', 12)).toBe('Rang 12');
        expect(numberedMapLabel(null, 3)).toBe('3');
    });

    it('hides row numbers until field-scale zoom', () => {
        expect(ROW_LABEL_MIN_ZOOM).toBe(18);
        expect(
            shouldShowCatalogueLabel({
                labelsVisible: true,
                overlayVisible: true,
                kind: 'field',
                zoom: 12,
                label: 'parcelle 2',
            }),
        ).toBe(true);
        expect(
            shouldShowCatalogueLabel({
                labelsVisible: true,
                overlayVisible: true,
                kind: 'row',
                zoom: 17,
                label: 'Rang 1',
            }),
        ).toBe(false);
        expect(
            shouldShowCatalogueLabel({
                labelsVisible: true,
                overlayVisible: true,
                kind: 'bed',
                zoom: 18,
                label: 'Planche 3',
            }),
        ).toBe(true);
        expect(
            shouldShowCatalogueLabel({
                labelsVisible: false,
                overlayVisible: true,
                kind: 'field',
                zoom: 18,
                label: 'parcelle 2',
            }),
        ).toBe(false);
        expect(
            shouldShowCatalogueLabel({
                labelsVisible: true,
                overlayVisible: false,
                kind: 'field',
                zoom: 18,
                label: 'parcelle 2',
            }),
        ).toBe(false);
    });

    it('anchors polygons at the ring centroid, lines at mid-length, points as-is', () => {
        expect(
            labelAnchorLngLat({
                type: 'Polygon',
                coordinates: [
                    [
                        [0, 0],
                        [2, 0],
                        [2, 2],
                        [0, 2],
                        [0, 0],
                    ],
                ],
            }),
        ).toEqual([1, 1]);
        expect(
            labelAnchorLngLat({
                type: 'LineString',
                coordinates: [
                    [0, 0],
                    [2, 0],
                    [2, 2],
                ],
            }),
        ).toEqual([2, 0]);
        expect(labelAnchorLngLat({ type: 'Point', coordinates: [4, 5] })).toEqual([4, 5]);
    });
});
