/** Apply the current coverage brief to N catalogue fields. Network I/O injected. */

import { planCoverage, type CoveragePlanResult } from '../coverage/api';
import type { AgriDocument } from '../domain/agri';
import { skipEveryNthWorkSection } from '../domain/crop-pack';
import { roundOriginLatLon } from '../domain/draft';
import type { OddProfile } from '../domain/odd';
import type { FieldSummary } from '../fields/types';
import { saveMissionDocument, suggestedMissionPath } from '../map/missions-api';
import { ringFromPolygon, type MissionBrief } from '../missions/brief';
import { composeGeneratedMission } from '../missions/compose';

export interface ApplyToFieldsDeps {
    planFn?: typeof planCoverage;
    composeFn?: typeof composeGeneratedMission;
    saveFn?: typeof saveMissionDocument;
    pathFn?: typeof suggestedMissionPath;
}

export interface ApplyToFieldsInput {
    fieldIds: string[];
    fields: FieldSummary[];
    brief: MissionBrief;
    equipment: Record<string, unknown> | null;
    odd: OddProfile | null;
    vehicleWidthM: number | null;
    geofenceMarginM: number | null;
    skipEveryN: number;
}

export interface ApplyToFieldsResult {
    saved: string[];
    errors: Array<{ fieldId: string; name: string; message: string }>;
}

function planRequest(
    brief: MissionBrief,
    ring: Array<{ lat: number; lng: number }>,
    vehicleWidthM: number | null,
    geofenceMarginM: number | null,
): Parameters<typeof planCoverage>[0] | null {
    const first = ring[0];
    if (!first || ring.length < 3 || !(brief.working_width_m > 0)) {
        return null;
    }
    const origin = roundOriginLatLon(first.lat, first.lng);
    return {
        ring,
        origin,
        working_width_m: brief.working_width_m,
        vehicle_width_m: vehicleWidthM ?? undefined,
        strategy: brief.strategy,
        variants: false,
        headland_width_m: brief.headland_width_m,
        overlap_m: brief.overlap_m,
        geofence_margin_m: geofenceMarginM && geofenceMarginM > 0 ? geofenceMarginM : undefined,
        field_id: brief.field_id || undefined,
    };
}

export async function applyCoverageToFields(
    input: ApplyToFieldsInput,
    deps: ApplyToFieldsDeps = {},
): Promise<ApplyToFieldsResult> {
    const planFn = deps.planFn ?? planCoverage;
    const composeFn = deps.composeFn ?? composeGeneratedMission;
    const saveFn = deps.saveFn ?? saveMissionDocument;
    const pathFn = deps.pathFn ?? suggestedMissionPath;
    const saved: string[] = [];
    const errors: ApplyToFieldsResult['errors'] = [];
    const skip = Math.max(0, Math.floor(input.skipEveryN));

    for (const fieldId of input.fieldIds) {
        const field = input.fields.find((item) => item.id === fieldId);
        if (!field) {
            errors.push({ fieldId, name: fieldId, message: 'missing' });
            continue;
        }
        const ring = ringFromPolygon(field.geometry);
        const brief: MissionBrief = { ...input.brief, field_id: field.id, row_set_id: '' };
        const payload = planRequest(brief, ring, input.vehicleWidthM, input.geofenceMarginM);
        if (!payload) {
            errors.push({ fieldId, name: field.name, message: 'field' });
            continue;
        }
        try {
            const plan: CoveragePlanResult = await planFn(payload);
            const composed = composeFn({
                ring,
                plan,
                brief,
                equipment: input.equipment,
                odd: input.odd,
                strategy: brief.strategy,
                connectTurns: brief.connect_turns,
                turnType: brief.turn_type,
                vehicleWidthM: input.vehicleWidthM,
                geofenceMarginM: input.geofenceMarginM,
            });
            if (!composed.ok) {
                errors.push({ fieldId, name: field.name, message: composed.reason });
                continue;
            }
            let document: AgriDocument = composed.document;
            if (skip > 0) {
                document = skipEveryNthWorkSection(document, skip);
            }
            const path = pathFn(document as unknown as Record<string, unknown>);
            const savedPath = await saveFn(document as unknown as Record<string, unknown>, path);
            saved.push(savedPath);
        } catch (reason: unknown) {
            errors.push({
                fieldId,
                name: field.name,
                message: reason instanceof Error ? reason.message : 'plan',
            });
        }
    }
    return { saved, errors };
}
