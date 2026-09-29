import { describe, expect, it } from 'vitest';

import { EquipmentStore } from '../../frontend/src/farmstore/equipment-store';
import { FieldCatalogue } from '../../frontend/src/farmstore/field-catalogue';
import {
    MemoryDirectory,
    readJsonObject,
    walkFiles,
    writeJson,
} from '../../frontend/src/farmstore/fs';
import { checksumOf, PublicationStore } from '../../frontend/src/farmstore/publication-store';
import { FarmSession } from '../../frontend/src/farmstore/session';

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
const LINE = {
    type: 'LineString' as const,
    coordinates: [
        [3.1701, 45.8501],
        [3.1709, 45.8501],
    ],
};

async function richField(catalogue: FieldCatalogue) {
    const field = await catalogue.createField({
        name: 'Vigne du haut',
        geometry: SQUARE,
        provenance: { source: 'rtk', method: 'walk', h_accuracy_m: 0.02 },
    });
    await catalogue.addZone(field.id, { kind: 'interdite', geometry: SQUARE, name: 'Mare' });
    await catalogue.addObstacle(field.id, {
        geometry: { type: 'Point', coordinates: [3.1705, 45.8505] },
        category: 'pole',
        margin_m: 0.5,
        height_m: 2,
        crossable: false,
    });
    const line = await catalogue.addGuidanceLine(field.id, { geometry: LINE, name: 'AB' });
    await catalogue.createRowSet(field.id, {
        name: 'Rangs 2026',
        spacing_m: 1.8,
        axis_line_id: line.id,
        rows: [
            { number: 1, geometry: LINE },
            { number: 2, geometry: LINE, name: 'R2' },
        ],
    });
    await catalogue.addTrafficWay(field.id, { geometry: LINE, width_m: 3, speed_mps: 1 });
    await catalogue.addTrafficNode(field.id, {
        geometry: { type: 'Point', coordinates: [3.17, 45.85] },
        kind: 'porte',
    });
    await catalogue.addLandmark(field.id, {
        kind: 'circle',
        geometry: { type: 'Point', coordinates: [3.1702, 45.8502] },
        radius_m: 4,
    });
    return field.id;
}

describe('field catalogue on parcel_map files (D13-01)', () => {
    it('reloads from the files to an identical catalogue, ids included', async () => {
        const dir = new MemoryDirectory();
        const catalogue = new FieldCatalogue(dir);
        const id = await richField(catalogue);
        const before = catalogue.getField(id);

        const files = await walkFiles(dir);
        expect(files).toEqual([`parcel_map/vigne-du-haut-${id}.geojson`]);

        const reopened = new FieldCatalogue(dir);
        const report = await reopened.load();
        expect(report).toEqual({ imported: 1, errors: [] });
        const after = reopened.getField(id);
        expect({ ...after, version: 0 }).toEqual({ ...before, version: 0 });
        expect(after?.zones[0]?.kind).toBe('forbidden');
        expect(after?.obstacles[0]).toMatchObject({ margin_m: 0.5, height_m: 2 });
        expect(after?.row_sets[0]).toMatchObject({ name: 'Rangs 2026', spacing_m: 1.8 });
        expect(after?.traffic_nodes[0]?.kind).toBe('gate');
        expect(after?.qualified_for_autonomy).toBe(true);
    });

    it('renames the file with the field and deletes it with the field', async () => {
        const dir = new MemoryDirectory();
        const catalogue = new FieldCatalogue(dir);
        const field = await catalogue.createField({ name: 'Parcelle 4', geometry: SQUARE });
        await catalogue.updateField(field.id, { name: 'Parcelle Nord' });
        expect(await walkFiles(dir)).toEqual([`parcel_map/parcelle-nord-${field.id}.geojson`]);
        expect(await catalogue.deleteField(field.id)).toBe(true);
        expect(await walkFiles(dir)).toEqual([]);
    });

    it('loads files written by the Python backend', async () => {
        const dir = new MemoryDirectory();
        await writeJson(dir, 'parcel_map/p.geojson', {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: { srbc_kind: 'field', id: 'p1', name: 'P' },
                    geometry: SQUARE,
                },
                { type: 'Feature', properties: { srbc_kind: 'row', number: 3 }, geometry: LINE },
                {
                    type: 'Feature',
                    properties: { srbc_kind: 'zone', zone_kind: 'headland' },
                    geometry: SQUARE,
                },
            ],
        });
        await dir.writeBytes('parcel_map/broken.geojson', new TextEncoder().encode('{'));
        const catalogue = new FieldCatalogue(dir);
        const report = await catalogue.load();
        expect(report.imported).toBe(1);
        expect(report.errors).toEqual([{ path: 'broken.geojson', reason: 'unreadable' }]);
        const field = catalogue.getField('p1');
        expect(field?.row_sets[0]?.rows[0]?.number).toBe(3);
        expect(field?.zones[0]?.kind).toBe('headland');
    });

    it('keeps a session history and marks linked missions for revalidation', async () => {
        const catalogue = new FieldCatalogue(new MemoryDirectory());
        const field = await catalogue.createField({ name: 'P', geometry: SQUARE });
        catalogue.linkMission(field.id, 'mission_order/m.json');
        await catalogue.addZone(field.id, { kind: 'workable', geometry: SQUARE });
        expect(catalogue.listVersions(field.id).map((item) => item.version)).toEqual([1, 2]);
        expect(catalogue.diffVersions(field.id, 1, 2)).toMatchObject({
            zones_from: 0,
            zones_to: 1,
        });
        expect(catalogue.impact(field.id).invalidated_count).toBe(1);
    });

    it('validates like the backend', async () => {
        const catalogue = new FieldCatalogue(new MemoryDirectory());
        const field = await catalogue.createField({ name: 'P', geometry: SQUARE });
        await expect(
            catalogue.addZone(field.id, { kind: 'lava', geometry: SQUARE }),
        ).rejects.toThrow('unknown zone kind');
        await expect(
            catalogue.addGuidanceLine(field.id, {
                geometry: { type: 'Point', coordinates: [0, 0] },
            }),
        ).rejects.toThrow('LineString');
        await expect(
            catalogue.createRowSet(field.id, {
                rows: [
                    { number: 1, geometry: LINE },
                    { number: 1, geometry: LINE },
                ],
            }),
        ).rejects.toThrow('duplicate row number');
        await expect(
            catalogue.addTrafficWay(field.id, { geometry: LINE, width_m: 0 }),
        ).rejects.toThrow('width_m');
        await expect(catalogue.updateField('nope', { name: 'x' })).rejects.toThrow('not found');
    });

    it('imports a user GeoJSON as a new field with fresh ids', async () => {
        const dir = new MemoryDirectory();
        const catalogue = new FieldCatalogue(dir);
        const id = await richField(catalogue);
        const again = await catalogue.importGeoJSON(catalogue.exportField(id));
        expect(again.ok).toBe(true);
        expect(again.field?.id).not.toBe(id);
        expect(again.created.rows).toBe(2);
        expect(catalogue.listFields()).toHaveLength(2);
        const bad = await catalogue.importGeoJSON({ type: 'FeatureCollection', features: [] });
        expect(bad.ok).toBe(false);
    });
});

describe('equipment: standard library + farm folder (D15-06, D15-07)', () => {
    it('shows the standard library on a new farm without writing it', async () => {
        const dir = new MemoryDirectory();
        const store = new EquipmentStore(dir);
        await store.load();
        const catalogue = store.catalogue();
        expect(catalogue.vehicles.map((item) => item.id)).toEqual(['srbc-001']);
        expect(catalogue.implements.map((item) => item.id).sort()).toEqual([
            'hoe-120',
            'trailer-140',
        ]);
        expect(catalogue.combinations.find((item) => item.id === 'srbc-hoe')).toMatchObject({
            vehicle_id: 'srbc-001',
            implement_id: 'hoe-120',
            origin: 'oem',
        });
        expect(await walkFiles(dir)).toEqual([]);
        await expect(store.deleteVehicle('srbc-001')).rejects.toThrow('OEM');
    });

    it('stores a farm item in its own folder and references it from a combination', async () => {
        const dir = new MemoryDirectory();
        const store = new EquipmentStore(dir);
        await store.load();
        const hoe = await store.createImplement({
            name: 'Bineuse voisin',
            physical_width_m: 1.8,
            working_width_m: 1.65,
        });
        expect(hoe.id).toBe('bineuse-voisin');
        const combination = await store.createCombination({
            name: 'SRBC + bineuse voisin',
            vehicle_id: 'srbc-001',
            implement_id: hoe.id,
        });
        const file = await readJsonObject(dir, `equipment/${combination.id}/equipment.json`);
        expect(file).toMatchObject({ vehicle: 'srbc:srbc-001', implement: 'farm:bineuse-voisin' });
        await expect(store.deleteImplement(hoe.id)).rejects.toThrow('used by a combination');

        const reopened = new EquipmentStore(dir);
        await reopened.load();
        expect(reopened.catalogue().implements.find((item) => item.id === hoe.id)).toMatchObject({
            working_width_m: 1.65,
            origin: 'local',
        });
        expect(await reopened.deleteCombination(combination.id)).toBe(true);
        expect(await reopened.deleteImplement(hoe.id)).toBe(true);
        expect(await walkFiles(dir)).toEqual([]);
    });

    it('records a change to a standard item as a small override', async () => {
        const dir = new MemoryDirectory();
        const store = new EquipmentStore(dir);
        await store.load();
        const patched = await store.patchVehicle('srbc-001', { mass_kg: 280, name: 'SRBC' });
        expect(patched.sources.mass_kg).toBe('modified');
        expect(await readJsonObject(dir, 'equipment/srbc-001/equipment.json')).toEqual({
            schema: 'srbc.equipment/2',
            kind: 'vehicle',
            id: 'srbc-001',
            base: 'srbc:srbc-001',
            mass_kg: 280,
        });
        const reopened = new EquipmentStore(dir);
        await reopened.load();
        const vehicle = reopened.catalogue().vehicles[0];
        expect(vehicle).toMatchObject({ mass_kg: 280, length_m: 1.1, origin: 'oem' });
    });
});

describe('publications in mission_order/.versions (D15-04)', () => {
    const document = {
        version: '3',
        file_type: 'mission_order',
        vehicle_id: 'v1',
        origin: { type: 'WGS84', coordinates: { lat: 45, lon: 3, alt: 0 } },
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
        metadata: {},
    };

    it('writes immutable versions and keeps the latest as published', async () => {
        const dir = new MemoryDirectory();
        const store = new PublicationStore(dir);
        const first = await store.create({
            source_path: 'mission_order/a.json',
            document,
            approver: 'Alex',
        });
        const second = await store.create({ source_path: 'mission_order/a.json', document });
        expect([first.version, second.version]).toEqual([1, 2]);
        expect(first.checksum).toMatch(/^[0-9a-f]{64}$/);
        expect(second.checksum).toBe(first.checksum);
        expect(await walkFiles(dir)).toEqual([
            'mission_order/.versions/a/v1.json',
            'mission_order/.versions/a/v2.json',
        ]);
        const listed = await store.list('mission_order/a.json');
        expect(listed.map((item) => [item.version, item.status])).toEqual([
            [2, 'published'],
            [1, 'obsolete'],
        ]);
        expect(listed[1]?.approver).toBe('Alex');
        expect((await store.list()).length).toBe(2);
    });

    it('ignores its own stamp in the checksum and refuses unsafe publications', async () => {
        const stamped = { ...document, metadata: { srbc_publication: { version: 9 } } };
        expect((await checksumOf(stamped)).checksum).toBe((await checksumOf(document)).checksum);
        const store = new PublicationStore(new MemoryDirectory());
        await expect(
            store.create({ source_path: 'mission_order/a.json', document, stale: true }),
        ).rejects.toThrow('stale');
        await expect(
            store.create({
                source_path: 'mission_order/a.json',
                document,
                simulation: { blockCount: 1 },
            }),
        ).rejects.toThrow('blockers');
        await expect(
            store.create({
                source_path: 'mission_order/a.json',
                document: { ...document, points: [] },
            }),
        ).rejects.toThrow('no sections');
    });

    it('stays invisible in the mission list of the session', async () => {
        const session = await FarmSession.create(new MemoryDirectory(), 'Ferme');
        await session.writeMission('mission_order/a.json', document);
        await session.publications.create({ source_path: 'mission_order/a.json', document });
        const tree = await session.tree('mission_order');
        expect((tree.mission_order ?? []).map((entry) => entry.name)).toEqual(['a.json']);
    });
});
