import { describe, expect, it } from 'vitest';

import type { ImportedCollection, ImportedFeature } from '../../frontend/src/map/imported-layers';
import {
    MAX_PREVIEW_SHAPES,
    PREVIEW_MAX_HEIGHT,
    PREVIEW_MIN_HEIGHT,
    PREVIEW_WIDTH,
    previewGeometry,
} from '../../frontend/src/imports/preview-shapes';

function feature(kind: string, type: string, coordinates: unknown): ImportedFeature {
    return {
        type: 'Feature',
        properties: { srbc_import: { kind } },
        geometry: { type, coordinates },
    };
}

function collection(features: ImportedFeature[]): ImportedCollection {
    return { type: 'FeatureCollection', features };
}

/** Two rows 2 m apart, running 100 m east, near Avize. */
const ROWS = collection([
    feature('row', 'LineString', [
        [4.0, 48.97],
        [4.001369, 48.97],
    ]),
    feature('row', 'LineString', [
        [4.0, 48.96998],
        [4.001369, 48.96998],
    ]),
]);

describe('import preview geometry', () => {
    it('fits the drawing inside the frame and keeps north up', () => {
        const preview = previewGeometry(ROWS);
        expect(preview).not.toBeNull();
        if (!preview) {
            return;
        }
        const numbers = preview.shapes
            .flatMap((shape) => shape.d.split(/[ML]/).slice(1))
            .flatMap((pair) => pair.replace('Z', '').trim().split(' ').map(Number));
        expect(numbers.every((value) => Number.isFinite(value))).toBe(true);
        const xs = numbers.filter((_value, index) => index % 2 === 0);
        const ys = numbers.filter((_value, index) => index % 2 === 1);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...xs)).toBeLessThanOrEqual(PREVIEW_WIDTH);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...ys)).toBeLessThanOrEqual(preview.height);
        // The northern row (higher latitude) must be drawn above the other.
        expect(ys[0]).toBeLessThan(ys[ys.length - 1]);
    });

    it('reports a round scale bar that stays a third of the frame wide', () => {
        const preview = previewGeometry(ROWS);
        // The two rows span 100 m, so a 20 m bar is the largest round fit.
        expect(preview?.scale?.label).toBe('20 m');
        expect(preview?.scale?.length).toBeGreaterThan(0);
        expect(preview?.scale?.length).toBeLessThan(PREVIEW_WIDTH / 3);
    });

    it('shapes the frame after the plot, within bounds', () => {
        expect(previewGeometry(ROWS)?.height).toBe(PREVIEW_MIN_HEIGHT);
        const narrow = previewGeometry(
            collection([
                feature('row', 'LineString', [
                    [4.0, 48.97],
                    [4.0, 48.9727],
                ]),
                feature('row', 'LineString', [
                    [4.00014, 48.97],
                    [4.00014, 48.9727],
                ]),
            ]),
        );
        expect(narrow?.height).toBe(PREVIEW_MAX_HEIGHT);
    });

    it('closes polygons and leaves lines open', () => {
        const preview = previewGeometry(
            collection([
                feature('coverage_cell', 'Polygon', [
                    [
                        [4.0, 48.97],
                        [4.0001, 48.97],
                        [4.0001, 48.9701],
                        [4.0, 48.9701],
                        [4.0, 48.97],
                    ],
                ]),
                feature('guidance_line', 'LineString', [
                    [4.0, 48.97],
                    [4.0001, 48.9701],
                ]),
            ]),
        );
        const polygon = preview?.shapes.find((shape) => shape.kind === 'coverage_cell');
        const line = preview?.shapes.find((shape) => shape.kind === 'guidance_line');
        expect(polygon?.filled).toBe(true);
        expect(polygon?.d.endsWith('Z')).toBe(true);
        expect(line?.filled).toBe(false);
        expect(line?.d).not.toContain('Z');
    });

    it('lists the kinds it drew, in the order they appear', () => {
        const preview = previewGeometry(
            collection([
                feature('coverage_cell', 'Polygon', [
                    [
                        [4.0, 48.97],
                        [4.0001, 48.97],
                        [4.0001, 48.9701],
                        [4.0, 48.97],
                    ],
                ]),
                feature('guidance_line', 'LineString', [
                    [4.0, 48.97],
                    [4.0001, 48.9701],
                ]),
            ]),
        );
        expect(preview?.kinds).toEqual(['coverage_cell', 'guidance_line']);
    });

    it('draws points as circles and ignores the NO_FIX placeholder', () => {
        const preview = previewGeometry(
            collection([
                feature('landmark', 'Point', [0, 0]),
                feature('landmark', 'Point', [3.17, 45.85]),
                feature('landmark', 'Point', [3.1701, 45.8501]),
            ]),
        );
        expect(preview?.points).toHaveLength(2);
        expect(preview?.shapes).toHaveLength(0);
    });

    it('samples a very large collection instead of drawing every figure', () => {
        const many = collection(
            Array.from({ length: MAX_PREVIEW_SHAPES * 3 }, (_item, index) =>
                feature('coverage_cell', 'Polygon', [
                    [
                        [4.0 + index * 0.00001, 48.97],
                        [4.00001 + index * 0.00001, 48.97],
                        [4.00001 + index * 0.00001, 48.97001],
                        [4.0 + index * 0.00001, 48.97],
                    ],
                ]),
            ),
        );
        const preview = previewGeometry(many);
        expect(preview?.total).toBe(MAX_PREVIEW_SHAPES * 3);
        expect(preview?.drawn).toBeLessThanOrEqual(MAX_PREVIEW_SHAPES);
        expect(preview?.drawn).toBeGreaterThan(MAX_PREVIEW_SHAPES / 2);
    });

    it('still frames a single point without collapsing the scale', () => {
        const preview = previewGeometry(collection([feature('landmark', 'Point', [3.17, 45.85])]));
        expect(preview?.points[0].cx).toBeGreaterThan(0);
        expect(preview?.points[0].cy).toBeGreaterThan(0);
        expect(preview?.scale).not.toBeNull();
    });

    it('returns nothing when there is no usable geometry', () => {
        expect(previewGeometry(null)).toBeNull();
        expect(previewGeometry(collection([]))).toBeNull();
        expect(
            previewGeometry(collection([{ type: 'Feature', properties: null, geometry: null }])),
        ).toBeNull();
    });
});
