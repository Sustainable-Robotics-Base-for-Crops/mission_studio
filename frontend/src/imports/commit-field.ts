import {
    addLandmark,
    addObstacle,
    addGuidanceLine,
    addZone,
    createField,
    createRowSet,
} from '../fields/api';
import type { FieldImportPlan } from './convert';
import { ImportRefused } from './types';

/** Writes a conversion plan into a new parcel, or into the parcel being edited. */
export async function commitFieldImport(
    plan: FieldImportPlan,
    fieldId: string | null,
): Promise<string> {
    let id = fieldId;
    if (!id) {
        if (!plan.geometry || !plan.name) {
            throw new ImportRefused('imports.convert.needContour');
        }
        const created = await createField({
            name: plan.name,
            geometry: plan.geometry,
            provenance: plan.provenance,
        });
        id = created.id;
    }
    if (plan.rows.length > 0) {
        await createRowSet(id, {
            name: plan.name || undefined,
            spacing_m: plan.spacingM,
            kind: plan.rowKind,
            rows: plan.rows.map((row, index) => ({
                number: index + 1,
                geometry: row.geometry,
                ...(row.name ? { name: row.name } : {}),
            })),
        });
    }
    for (const line of plan.guidance) {
        await addGuidanceLine(id, {
            geometry: line.geometry,
            ...(line.name ? { name: line.name } : {}),
        });
    }
    for (const zone of plan.zones) {
        await addZone(id, {
            kind: 'agronomic_boundary',
            geometry: zone.geometry,
            ...(zone.name ? { name: zone.name } : {}),
        });
    }
    for (const obstacle of plan.obstacles) {
        await addObstacle(id, {
            geometry: obstacle.geometry,
            ...(obstacle.name ? { name: obstacle.name } : {}),
        });
    }
    for (const landmark of plan.landmarks) {
        await addLandmark(id, {
            kind: landmark.kind,
            geometry: landmark.geometry,
            ...(landmark.name ? { name: landmark.name } : {}),
        });
    }
    return id;
}
