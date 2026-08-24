import { describe, expect, it } from 'vitest';

import {
    applyLandmarkClick,
    canPinLandmark,
    circleRing,
    DEFAULT_CIRCLE_RADIUS_M,
    formatLandmarkGps,
    formatLandmarkMeters,
    landmarkGeometry,
    landmarkLiveMeasure,
    previewDraft,
} from '../../frontend/src/fields/landmarks';
import { fieldsToCollection } from '../../frontend/src/fields/geojson';

const ORIGIN = { lat: 45.85, lng: 3.17 };
const EAST = { lat: 45.85, lng: 3.171 };

describe('parcellaire landmark tools (CdC §5.2)', () => {
    it('extends the ruler with the cursor so the distance is live', () => {
        const preview = previewDraft('measure', [ORIGIN], EAST);
        expect(preview).toHaveLength(2);
        const live = landmarkLiveMeasure('measure', [ORIGIN], EAST);
        expect(live.lastSegmentM).not.toBeNull();
        expect(live.lastSegmentM ?? 0).toBeGreaterThan(70);
        expect(formatLandmarkMeters(live.lastSegmentM)).toMatch(/m$/);
    });

    it('prepares the ruler on the second click without pinning', () => {
        const first = applyLandmarkClick('measure', [], ORIGIN, 10);
        expect(first.ready).toBe(false);
        expect(first.draft).toEqual([ORIGIN]);
        const second = applyLandmarkClick('measure', first.draft, EAST, 10, first.ready);
        expect(second.ready).toBe(true);
        expect(second.draft).toEqual([ORIGIN, EAST]);
        const again = applyLandmarkClick('measure', second.draft, ORIGIN, 10, second.ready);
        expect(again.ready).toBe(false);
        expect(again.draft).toEqual([ORIGIN]);
    });

    it('stretches the circle like a ruler and only marks it ready', () => {
        expect(previewDraft('circle', [ORIGIN], EAST)).toHaveLength(2);
        expect(previewDraft('circle', [ORIGIN], EAST, true)).toEqual([ORIGIN]);
        const live = landmarkLiveMeasure('circle', [ORIGIN], EAST);
        expect(live.lastSegmentM ?? 0).toBeGreaterThan(70);
        const first = applyLandmarkClick('circle', [], ORIGIN, 10);
        expect(first.ready).toBe(false);
        const second = applyLandmarkClick('circle', first.draft, EAST, 10, first.ready);
        expect(second.ready).toBe(true);
        expect(second.radiusM).toBeGreaterThan(70);
        expect(second.draft).toEqual([ORIGIN]);
        const again = applyLandmarkClick('circle', second.draft, EAST, second.radiusM, true);
        expect(again.ready).toBe(false);
        expect(again.draft).toEqual([EAST]);
        const whileEditing = applyLandmarkClick(
            'circle',
            second.draft,
            EAST,
            second.radiusM,
            true,
            false,
        );
        expect(whileEditing.ready).toBe(true);
        expect(whileEditing.draft).toEqual([ORIGIN]);
        expect(whileEditing.radiusM).toBeGreaterThan(70);
    });

    it('pins a measure only once both ends are down', () => {
        expect(canPinLandmark('measure', [ORIGIN], 10)).toBe(false);
        expect(canPinLandmark('measure', [ORIGIN, EAST], 10)).toBe(true);
        expect(landmarkGeometry('measure', [ORIGIN, EAST], 10)?.type).toBe('LineString');
    });

    it('redraws a circle from the centre and the typed radius', () => {
        expect(canPinLandmark('circle', [ORIGIN], DEFAULT_CIRCLE_RADIUS_M)).toBe(true);
        expect(canPinLandmark('circle', [ORIGIN], 0)).toBe(false);
        const ring = circleRing(ORIGIN, 10);
        expect(ring.length).toBeGreaterThan(8);
        expect(landmarkGeometry('circle', [ORIGIN], 10)?.type).toBe('Polygon');
    });

    it('shows each polygon segment and the area once it can close', () => {
        const third = { lat: 45.851, lng: 3.171 };
        const live = landmarkLiveMeasure('polygon', [ORIGIN, EAST, third], null);
        expect(live.segmentsM).toHaveLength(2);
        expect(live.areaM2).not.toBeNull();
        expect(live.areaM2 ?? 0).toBeGreaterThan(0);
        expect(canPinLandmark('polygon', [ORIGIN, EAST], 10)).toBe(false);
        expect(canPinLandmark('polygon', [ORIGIN, EAST, third], 10)).toBe(true);
    });

    it('keeps the closing edge once the polygon is closed', () => {
        const third = { lat: 45.851, lng: 3.171 };
        const closed = applyLandmarkClick('polygon', [ORIGIN, EAST, third], ORIGIN, 10);
        expect(closed.ready).toBe(true);
        expect(closed.draft).toEqual([ORIGIN, EAST, third]);
        const preview = previewDraft('polygon', closed.draft, null, true);
        expect(preview).toEqual([ORIGIN, EAST, third, ORIGIN]);
        const live = landmarkLiveMeasure('polygon', closed.draft, null, true);
        expect(live.segmentsM).toHaveLength(3);
        expect(previewDraft('polygon', [ORIGIN, EAST, third], ORIGIN)).toEqual([
            ORIGIN,
            EAST,
            third,
            ORIGIN,
        ]);
    });

    it('exposes GPS of a labelled point', () => {
        expect(canPinLandmark('point', [ORIGIN], 10)).toBe(true);
        expect(landmarkGeometry('point', [ORIGIN], 10)?.type).toBe('Point');
        expect(formatLandmarkGps(ORIGIN)).toContain('45.8500000');
    });

    it('puts pinned traces in the field collection as the landmarks overlay', () => {
        const collection = fieldsToCollection(
            [{ id: 'a', name: 'A', geometry: { type: 'Polygon', coordinates: [[]] } }],
            null,
            {
                a: {
                    zones: [],
                    obstacles: [],
                    landmarks: [
                        {
                            id: 'lm-1',
                            field_id: 'a',
                            kind: 'measure',
                            name: 'Règle',
                            geometry: {
                                type: 'LineString',
                                coordinates: [
                                    [3.17, 45.85],
                                    [3.171, 45.85],
                                ],
                            },
                            radius_m: null,
                            provenance: {},
                            created_at: '',
                        },
                    ],
                },
            },
        );
        const landmark = collection.features.find((feature) => feature.id === 'lm-1');
        expect(landmark?.properties.kind).toBe('landmark_measure');
        expect(landmark?.properties.overlay).toBe('landmarks');
    });
});
