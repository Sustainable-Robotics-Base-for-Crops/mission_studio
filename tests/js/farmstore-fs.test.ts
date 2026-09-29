import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import {
    BrowserDirectory,
    deleteBrowserFarm,
    farmPathSegments,
    listBrowserFarms,
    MemoryDirectory,
    readText,
    registerBrowserFarm,
    resetBrowserStoreConnection,
    walkFiles,
    writeText,
    type FarmDirectory,
} from '../../frontend/src/farmstore/fs';

describe('farm paths', () => {
    it('keeps relative paths inside the farm', () => {
        expect(farmPathSegments('parcel_map/vigne.geojson')).toEqual([
            'parcel_map',
            'vigne.geojson',
        ]);
        expect(farmPathSegments('', { allowRoot: true })).toEqual([]);
    });

    it.each(['../etc/passwd', 'a/../../b', '/abs', '~/x', 'C:/x', 'a\\b', '.', ''])(
        'refuses %s',
        (path) => {
            expect(() => farmPathSegments(path)).toThrow();
        },
    );
});

async function exercise(dir: FarmDirectory) {
    await writeText(dir, 'mission_order/a.json', '{"a":1}');
    await writeText(dir, 'mission_order/.versions/a/v1.json', '{}');
    await dir.makeDirectory('work_performed');

    expect(await readText(dir, 'mission_order/a.json')).toBe('{"a":1}');
    expect(await dir.readBytes('mission_order/missing.json')).toBeNull();

    const root = await dir.list('');
    expect(root.map((entry) => [entry.name, entry.kind])).toEqual([
        ['mission_order', 'directory'],
        ['work_performed', 'directory'],
    ]);
    const missions = await dir.list('mission_order');
    expect(missions.map((entry) => entry.name)).toEqual(['.versions', 'a.json']);
    expect(missions.find((entry) => entry.name === 'a.json')?.size).toBe(7);
    expect(await dir.list('nowhere')).toEqual([]);

    expect(await walkFiles(dir)).toEqual([
        'mission_order/.versions/a/v1.json',
        'mission_order/a.json',
    ]);

    expect(await dir.remove('mission_order/.versions')).toBe(true);
    expect(await walkFiles(dir)).toEqual(['mission_order/a.json']);
    expect(await dir.remove('mission_order/a.json')).toBe(true);
    expect(await dir.remove('mission_order/a.json')).toBe(false);
}

describe('memory directory', () => {
    it('reads, writes, lists and removes', async () => {
        await exercise(new MemoryDirectory());
    });
});

describe('browser directory (IndexedDB)', () => {
    beforeEach(async () => {
        resetBrowserStoreConnection();
        for (const farm of await listBrowserFarms()) {
            await deleteBrowserFarm(farm.id);
        }
    });

    it('behaves like a folder', async () => {
        const dir = await registerBrowserFarm({
            id: 'f1',
            name: 'Ferme',
            created_at: '2026-09-29T10:00:00Z',
        });
        await exercise(dir);
    });

    it('keeps farms apart and forgets a deleted one', async () => {
        const one = await registerBrowserFarm({
            id: 'one',
            name: 'Une',
            created_at: '2026-09-29T10:00:00Z',
        });
        const two = await registerBrowserFarm({
            id: 'two',
            name: 'Deux',
            created_at: '2026-09-29T11:00:00Z',
        });
        await writeText(one, 'farm.json', '1');
        await writeText(two, 'farm.json', '2');
        expect(await readText(one, 'farm.json')).toBe('1');
        expect((await listBrowserFarms()).map((farm) => farm.id)).toEqual(['two', 'one']);

        await deleteBrowserFarm('one');
        expect(await readText(new BrowserDirectory('one', 'Une'), 'farm.json')).toBeNull();
        expect(await readText(two, 'farm.json')).toBe('2');
    });
});
