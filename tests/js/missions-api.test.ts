import { describe, expect, it } from 'vitest';

import {
    farmMissionFilename,
    farmMissionPathFromName,
    isFarmMissionPath,
    slugifyFarmToken,
    storageIdentityFromPath,
    suggestedMissionPath,
    toAgriDocument,
    toSaveRequest,
    uniquifyFarmFilename,
} from '../../frontend/src/map/missions-api';

describe('storageIdentityFromPath', () => {
    it('reads file_type / vehicle / filename, ignoring an uploads prefix', () => {
        expect(storageIdentityFromPath('uploads/draft/v1/demo.json')).toEqual({
            fileType: 'draft',
            vehicleId: 'v1',
            filename: 'demo.json',
        });
        expect(storageIdentityFromPath('mission_order/robot-a/parcelle.json')).toEqual({
            fileType: 'mission_order',
            vehicleId: 'robot-a',
            filename: 'parcelle.json',
        });
    });

    it('rejects paths that cannot identify a storage key', () => {
        expect(storageIdentityFromPath('demo.json')).toBeNull();
        expect(storageIdentityFromPath('')).toBeNull();
    });
});

describe('suggestedMissionPath', () => {
    it('builds file_type/vehicle/field-timestamp.json from the brief', () => {
        expect(
            suggestedMissionPath(
                {
                    file_type: 'mission_order',
                    vehicle_id: 'v1',
                    metadata: { srbc_mission_brief: { field_id: 'Sabi Expe' } },
                },
                new Date('2026-08-19T17:02:00'),
            ),
        ).toBe('mission_order/v1/sabi-expe-20260819-1702.json');
    });
});

describe('toAgriDocument / toSaveRequest', () => {
    it('drops filename and null geofencing, and fills origin.alt', () => {
        const agri = toAgriDocument({
            version: '3',
            filename: 'secret.json',
            file_type: 'draft',
            vehicle_id: 'v1',
            origin: { type: 'WGS84', coordinates: { lat: 45.8, lon: 3.1 } },
            points: [],
            geofencing: null,
            extra: 'nope',
        });
        expect(agri).toEqual({
            version: '3',
            file_type: 'draft',
            vehicle_id: 'v1',
            origin: { type: 'WGS84', coordinates: { lat: 45.8, lon: 3.1, alt: 0 } },
            points: [],
            metadata: {},
        });
        expect(agri).not.toHaveProperty('filename');
        expect(agri).not.toHaveProperty('geofencing');
        expect(agri).not.toHaveProperty('extra');
    });

    it('keeps geofencing when present and stamps filename from the path', () => {
        const request = toSaveRequest(
            {
                version: '3',
                file_type: 'mission_order',
                vehicle_id: 'other',
                origin: { type: 'WGS84', coordinates: { lat: 1, lon: 2, alt: 3 } },
                points: [],
                geofencing: { columns: ['x', 'y'], values: [[0, 0]] },
            },
            'draft/v1/demo.json',
        );
        expect(request?.filename).toBe('demo.json');
        expect(request?.file_type).toBe('draft');
        expect(request?.vehicle_id).toBe('v1');
        expect(request?.geofencing).toEqual({ columns: ['x', 'y'], values: [[0, 0]] });
    });
});

describe('farm mission naming (CdC §2.3)', () => {
    it('slugifies tokens: lowercase, hyphens, no accent', () => {
        expect(slugifyFarmToken('Champ Nord')).toBe('champ-nord');
        expect(slugifyFarmToken('Semis d automne')).toBe('semis-d-automne');
    });

    it('builds AAAA-MM-DD_parcelle_operation.json and suffixes collisions', () => {
        const document = {
            metadata: { srbc_mission_brief: { field_id: 'Parcelle 04', operation: 'semis' } },
        };
        const now = new Date('2026-08-20T09:00:00');
        expect(farmMissionFilename(document, [], now)).toBe('2026-08-20_parcelle-04_semis.json');
        expect(farmMissionFilename(document, ['2026-08-20_parcelle-04_semis.json'], now)).toBe(
            '2026-08-20_parcelle-04_semis-2.json',
        );
        expect(
            farmMissionFilename(
                document,
                ['2026-08-20_parcelle-04_semis.json', '2026-08-20_parcelle-04_semis-2.json'],
                now,
            ),
        ).toBe('2026-08-20_parcelle-04_semis-3.json');
    });

    it('treats only two-segment mission_order paths as farm files', () => {
        expect(isFarmMissionPath('mission_order/demo.json')).toBe(true);
        expect(isFarmMissionPath('mission_order/v1/demo.json')).toBe(false);
        expect(farmMissionPathFromName('demo')).toBe('mission_order/demo.json');
        expect(uniquifyFarmFilename('demo.json', ['demo.json'])).toBe('demo-2.json');
    });
});
