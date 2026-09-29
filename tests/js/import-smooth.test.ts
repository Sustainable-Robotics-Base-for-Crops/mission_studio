import { describe, expect, it } from 'vitest';

import { fieldPlanFromImport, missionFromImport } from '../../frontend/src/imports/convert';
import { smoothLine, smoothToleranceM } from '../../frontend/src/imports/smooth';
import type { ImportedCollection } from '../../frontend/src/map/imported-layers';

function line(coordinates: [number, number][], kind = 'guidance_line'): ImportedCollection {
    return {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                properties: { srbc_import: { kind, group_id: 'a', group_name: 'A' } },
                geometry: { type: 'LineString', coordinates },
            },
        ],
    };
}

describe('agricultural smoothing', () => {
    it('keeps a curve at 0% with about one point every 10 cm', () => {
        const smoothed = smoothLine(
            [
                [2, 48],
                [2.001, 48.0002],
                [2.002, 48],
            ],
            0,
        );
        expect(smoothed.length).toBeGreaterThan(10);
        expect(smoothed[0]).toEqual([2, 48]);
        expect(smoothed[smoothed.length - 1]?.[0]).toBeCloseTo(2.002, 5);
    });

    it('straightens a vibrating row at 100% and keeps a pole bypass', () => {
        const vibrating: [number, number][] = [];
        for (let step = 0; step <= 40; step += 1) {
            const east = step * 2;
            const north = step % 2 === 0 ? 0.2 : -0.2;
            vibrating.push([2 + east / 111320, 48 + north / 111320]);
        }
        const straight = smoothLine(vibrating, 100);
        expect(straight.length).toBeLessThan(8);

        const bypass: [number, number][] = [
            [2, 48],
            [2.0003, 48],
            [2.0003, 48.00003],
            [2.0006, 48.00003],
            [2.0006, 48],
            [2.001, 48],
        ];
        const kept = smoothLine(bypass, 100);
        const lats = kept.map((point) => point[1]);
        expect(Math.max(...lats) - Math.min(...lats)).toBeGreaterThan(0.00002);
    });

    it('stops at 50 cm: a 70 cm jog stays, the recommended factor is 20 cm', () => {
        expect(smoothToleranceM(100)).toBeCloseTo(0.5);
        expect(smoothToleranceM(40)).toBeCloseTo(0.2);
        const jog: [number, number][] = [
            [2, 48],
            [2.0002, 48],
            [2.0002, 48 + 0.7 / 111320],
            [2.0004, 48 + 0.7 / 111320],
            [2.0004, 48],
            [2.0006, 48],
        ];
        const kept = smoothLine(jog, 100);
        const lats = kept.map((point) => point[1]);
        expect(Math.max(...lats) - Math.min(...lats)).toBeGreaterThan(0.5 / 111320);
    });
});

describe('import conversion', () => {
    const request = {
        intent: 'mission' as const,
        name: 'Cerisier',
        smooth: 100,
        kinds: ['guidance_line'],
        groupId: 'a',
        lineTarget: 'rows' as const,
        useEnvelope: false,
        adapter: 'isoxml',
        formatId: 'isoxml',
        filename: 'task.xml',
    };

    it('turns a smoothed line into a mission row and keeps the proposed name', () => {
        const document = missionFromImport(
            line([
                [2, 48],
                [2.00001, 48.000002],
                [2.001, 48],
            ]),
            request,
        );
        expect(document.points.length).toBeGreaterThan(0);
        const brief = (document.metadata as { srbc_mission_brief?: { name?: string } })
            .srbc_mission_brief;
        expect(brief?.name).toBe('Cerisier');
    });

    it('builds a parcel outline from the line envelope when asked', () => {
        const collection: ImportedCollection = {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: { srbc_import: { kind: 'row' } },
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            [2, 48],
                            [2.001, 48],
                        ],
                    },
                },
                {
                    type: 'Feature',
                    properties: { srbc_import: { kind: 'row' } },
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            [2, 48.0002],
                            [2.001, 48.0002],
                        ],
                    },
                },
            ],
        };
        const plan = fieldPlanFromImport(collection, {
            ...request,
            intent: 'field-create',
            kinds: ['row'],
            groupId: null,
            useEnvelope: true,
            lineTarget: 'rows',
        });
        expect(plan.geometry?.type).toBe('Polygon');
        expect(plan.rows).toHaveLength(2);
        expect(plan.rowKind).toBe('rows');
    });
});
