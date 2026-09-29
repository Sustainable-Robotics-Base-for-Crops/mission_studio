import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import {
    MemoryDirectory,
    readJsonObject,
    walkFiles,
    writeJson,
} from '../../frontend/src/farmstore/fs';
import {
    createBrowserFarm,
    currentSession,
    FarmSession,
    importBrowserFarm,
    listRecentFarms,
    openBrowserFarm,
    restoreLastFarm,
    setCurrentSession,
} from '../../frontend/src/farmstore/session';
import { resetBrowserStoreConnection } from '../../frontend/src/farmstore/fs';
import { exportFarmZip, importFarmZip } from '../../frontend/src/farmstore/zip';
import { zipSync } from 'fflate';

const SQUARE = {
    type: 'Polygon' as const,
    coordinates: [
        [
            [3.17, 45.85],
            [3.171, 45.85],
            [3.171, 45.851],
            [3.17, 45.851],
            [3.17, 45.85],
        ],
    ],
};

function mission(fieldId: string, name: string) {
    return {
        version: '3',
        file_type: 'mission_order',
        vehicle_id: 'v1',
        origin: { type: 'WGS84', coordinates: { lat: 45.85, lon: 3.17, alt: 0 } },
        points: [
            {
                section_type: 'row_line',
                columns: ['x', 'y'],
                values: [
                    [0, 0],
                    [1, 0],
                ],
            },
        ],
        metadata: { srbc_mission_brief: { field_id: fieldId, name } },
        filename: 'editor-only.json',
    };
}

describe('farm session on a device folder', () => {
    it('creates the five entries of a farm in an empty folder only', async () => {
        const dir = new MemoryDirectory('ferme-xy');
        const session = await FarmSession.create(dir, 'Ferme XY');
        expect((await session.readFarm())?.name).toBe('Ferme XY');
        expect((await dir.list('')).map((entry) => entry.name)).toEqual([
            'equipment',
            'farm.json',
            'mission_order',
            'parcel_map',
            'work_performed',
        ]);
        await expect(FarmSession.create(dir, 'Encore')).rejects.toThrow('already contains a farm');

        const busy = new MemoryDirectory();
        await writeJson(busy, 'notes.json', {});
        await expect(FarmSession.create(busy, 'X')).rejects.toThrow('empty folder');
        await expect(FarmSession.open(busy)).rejects.toThrow('not a farm');
    });

    it('merges settings and keeps server-owned keys', async () => {
        const session = await FarmSession.create(new MemoryDirectory(), 'Ferme');
        const before = await session.readFarm();
        const after = await session.writeFarm({
            name: 'Vignoble',
            farm_type: 'vineyard',
            start_view: { zoom: 17 },
            schema: 'hack',
            created_at: '1999-01-01T00:00:00Z',
        });
        expect(after.name).toBe('Vignoble');
        expect(after.schema).toBe('srbc.farm/1');
        expect(after.created_at).toBe(before?.created_at);
        expect(after.start_view).toMatchObject({ zoom: 17, lat: 46.6034 });
        await expect(session.writeFarm({ farm_type: 'moon' })).rejects.toThrow('farm_type');
    });

    it('reads and writes missions inside mission_order only', async () => {
        const session = await FarmSession.create(new MemoryDirectory(), 'Ferme');
        const saved = await session.writeMission(
            'mission_order/2026-09-29_a.json',
            mission('f1', 'A'),
        );
        expect(saved).not.toHaveProperty('filename');
        expect(
            (await session.readMission('mission_order/2026-09-29_a.json')).metadata,
        ).toBeDefined();
        await expect(
            session.writeMission('parcel_map/x.json', mission('f1', 'A')),
        ).rejects.toThrow();
        await expect(session.writeMission('mission_order/../farm.json', {})).rejects.toThrow();
        await expect(session.readMission('mission_order/none.json')).rejects.toThrow('not found');
    });

    it('lists the tree, hides published versions and links missions to fields', async () => {
        const dir = new MemoryDirectory();
        const session = await FarmSession.create(dir, 'Ferme');
        await session.writeMission('mission_order/a.json', mission('f1', 'Binage'));
        await writeJson(dir, 'mission_order/.versions/a/v1.json', mission('f1', 'Binage'));
        await dir.writeBytes('mission_order/broken.json', new TextEncoder().encode('{nope'));

        const tree = await session.tree();
        const names = (tree.mission_order ?? []).map((entry) => entry.name).sort();
        expect(names).toEqual(['a.json', 'broken.json']);
        expect(tree.mission_order?.find((entry) => entry.name === 'broken.json')?.unreadable).toBe(
            true,
        );
        expect((await session.missionsForField('f1')).map((entry) => entry.path)).toEqual([
            'mission_order/a.json',
        ]);
    });

    it('counts hectares only from field polygons', async () => {
        const session = await FarmSession.create(new MemoryDirectory(), 'Ferme');
        expect((await session.counts()).hectares).toBeNull();
        await session.fields.createField({ name: 'Carré', geometry: SQUARE });
        const counts = await session.counts();
        expect(counts.fields).toBe(1);
        expect(counts.hectares).toBeGreaterThan(0.8);
        expect(counts.hectares).toBeLessThan(0.9);
    });
});

describe('farm archive', () => {
    it('round-trips a farm through a zip, without .studio', async () => {
        const dir = new MemoryDirectory();
        const session = await FarmSession.create(dir, 'Ferme');
        await session.fields.createField({ name: 'Carré', geometry: SQUARE });
        await writeJson(dir, '.studio/cache/x.json', {});

        const copy = new MemoryDirectory();
        await importFarmZip(copy, await exportFarmZip(dir));
        const files = await walkFiles(copy);
        expect(files).toContain('farm.json');
        expect(files.some((path) => path.startsWith('parcel_map/'))).toBe(true);
        expect(files.some((path) => path.startsWith('.studio'))).toBe(false);
        expect((await copy.list('')).map((entry) => entry.name)).toContain('work_performed');
    });

    it('accepts a farm wrapped in one folder and refuses anything else', async () => {
        const encoder = new TextEncoder();
        const farm = encoder.encode(
            JSON.stringify({
                schema: 'srbc.farm/1',
                name: 'Zip',
                farm_type: 'open_field',
                start_view: { lat: 45, lon: 3, zoom: 10 },
                language: 'fr',
                theme: 'light',
                ui_mode: 'basic',
                units: 'metric',
            }),
        );
        const wrapped = zipSync({
            'ferme-zip/farm.json': farm,
            'ferme-zip/../evil.json': encoder.encode('{}'),
            'ferme-zip/mission_order/m.json': encoder.encode('{}'),
        });
        const target = new MemoryDirectory();
        const report = await importFarmZip(target, wrapped);
        expect(report.files).toBe(2);
        expect(await readJsonObject(target, 'farm.json')).toMatchObject({ name: 'Zip' });
        expect(await walkFiles(target)).not.toContain('evil.json');

        await expect(
            importFarmZip(new MemoryDirectory(), zipSync({ 'a.txt': encoder.encode('x') })),
        ).rejects.toThrow('does not contain a farm');
    });
});

describe('farms stored in the browser', () => {
    beforeEach(() => {
        resetBrowserStoreConnection();
        localStorage.clear();
        setCurrentSession(null);
    });

    it('creates, lists, reopens after a reload and imports a zip', async () => {
        const created = await createBrowserFarm('Ferme du navigateur');
        await created.fields.createField({ name: 'Carré', geometry: SQUARE });
        const id = created.location.id as string;
        expect(created.location.kind).toBe('browser');

        setCurrentSession(null);
        localStorage.setItem('mission-studio.last-farm', JSON.stringify({ kind: 'browser', id }));
        const restored = await restoreLastFarm();
        expect(restored?.fields.listFields().map((field) => field.name)).toEqual(['Carré']);
        expect(currentSession()).toBe(restored);

        const imported = await importBrowserFarm(await created.exportZip(), 'Copie');
        expect(imported.location.id).not.toBe(id);
        expect(imported.fields.listFields()).toHaveLength(1);

        const recent = await listRecentFarms();
        expect(recent.filter((item) => item.kind === 'browser').length).toBeGreaterThanOrEqual(2);
        await expect(openBrowserFarm('missing')).rejects.toThrow('no longer exists');
    });
});
