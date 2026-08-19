import { describe, expect, it } from 'vitest';

import {
    storageIdentityFromPath,
    toAgriDocument,
    toSaveRequest,
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
