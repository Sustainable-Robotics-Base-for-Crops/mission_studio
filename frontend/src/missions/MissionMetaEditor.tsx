import type { ReactElement } from 'react';

import { Input, Select } from '../design-system/Field';
import { cloneJson, type AgriDocument } from '../domain/agri';
import { CROP_PACKS, readCropPack, type CropPackId } from '../domain/crop-pack';
import {
    projectSrbcEquipment,
    type CombinationTwin,
    type ImplementTwin,
    type VehicleTwin,
} from '../domain/equipment';
import {
    defaultOddProfile,
    parseOddProfile,
    ODD_CROP,
    ODD_LOCALIZATION,
    ODD_VISIBILITY,
    ODD_WEATHER,
    type OddProfile,
} from '../domain/odd';
import type { TurnKind } from '../domain/turns';
import type { FieldSummary } from '../fields/types';
import {
    OPERATIONS,
    PRIORITIES,
    briefToMetadata,
    defaultMissionBrief,
    type MissionBrief,
    type MissionOperation,
    type MissionPriority,
} from './brief';

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function metadataOf(document: AgriDocument): Record<string, unknown> {
    return asRecord(document.metadata) ?? {};
}

function briefFromDocument(document: AgriDocument): MissionBrief {
    const raw = asRecord(metadataOf(document).srbc_mission_brief) ?? {};
    const fallback = defaultMissionBrief();
    const window = asRecord(raw.window);
    const operation = raw.operation;
    const priority = raw.priority;
    return {
        ...fallback,
        operation: OPERATIONS.includes(operation as MissionOperation)
            ? (operation as MissionOperation)
            : fallback.operation,
        campaign: typeof raw.campaign === 'string' ? raw.campaign : fallback.campaign,
        window_from:
            typeof window?.from === 'string'
                ? window.from
                : typeof raw.window_from === 'string'
                  ? raw.window_from
                  : fallback.window_from,
        window_to:
            typeof window?.to === 'string'
                ? window.to
                : typeof raw.window_to === 'string'
                  ? raw.window_to
                  : fallback.window_to,
        priority: PRIORITIES.includes(priority as MissionPriority)
            ? (priority as MissionPriority)
            : fallback.priority,
        name: typeof raw.name === 'string' ? raw.name : fallback.name,
        field_id: typeof raw.field_id === 'string' ? raw.field_id : fallback.field_id,
        field_name: typeof raw.field_name === 'string' ? raw.field_name : fallback.field_name,
        row_set_id: typeof raw.row_set_id === 'string' ? raw.row_set_id : fallback.row_set_id,
        combination_id:
            typeof raw.combination_id === 'string' ? raw.combination_id : fallback.combination_id,
        working_width_m:
            Number.isFinite(Number(raw.working_width_m)) && Number(raw.working_width_m) > 0
                ? Number(raw.working_width_m)
                : fallback.working_width_m,
        overlap_m: Number.isFinite(Number(raw.overlap_m))
            ? Number(raw.overlap_m)
            : fallback.overlap_m,
        speed_mps:
            Number.isFinite(Number(raw.speed_mps)) && Number(raw.speed_mps) > 0
                ? Number(raw.speed_mps)
                : fallback.speed_mps,
        recipe_note: typeof raw.recipe_note === 'string' ? raw.recipe_note : fallback.recipe_note,
        strategy:
            raw.strategy === 'boustrophedon' ||
            raw.strategy === 'perpendicular' ||
            raw.strategy === 'best_nswath'
                ? raw.strategy
                : fallback.strategy,
        headland_width_m: Number.isFinite(Number(raw.headland_width_m))
            ? Number(raw.headland_width_m)
            : fallback.headland_width_m,
        connect_turns:
            raw.connect_turns === true || raw.connect_turns === false
                ? raw.connect_turns
                : fallback.connect_turns,
        turn_type:
            raw.turn_type === 'u_turn' || raw.turn_type === 'square'
                ? (raw.turn_type as TurnKind)
                : fallback.turn_type,
        transit_note:
            typeof raw.transit_note === 'string' ? raw.transit_note : fallback.transit_note,
        service_node_id:
            typeof raw.service_node_id === 'string'
                ? raw.service_node_id
                : fallback.service_node_id,
        weather_note:
            typeof raw.weather_note === 'string' ? raw.weather_note : fallback.weather_note,
        crop_pack: CROP_PACKS.includes(raw.crop_pack as CropPackId)
            ? (raw.crop_pack as CropPackId)
            : readCropPack(document),
    };
}

function identityName(document: AgriDocument): string {
    const raw = asRecord(metadataOf(document).srbc_mission_brief);
    return typeof raw?.name === 'string' ? raw.name : '';
}

function writeMetadata(document: AgriDocument, patch: Record<string, unknown>): AgriDocument {
    const next = cloneJson(document);
    next.metadata = { ...metadataOf(next), ...patch };
    return next;
}

function writeBrief(document: AgriDocument, brief: MissionBrief, name: string): AgriDocument {
    return writeMetadata(document, {
        srbc_mission_brief: { ...briefToMetadata(brief), name: name || null },
    });
}

export function MissionMetaEditor({
    t,
    document,
    combinations,
    fields,
    vehicles,
    implements: implementsList,
    onApplyDocument,
}: {
    t: (key: string, params?: Record<string, string | number>) => string;
    document: AgriDocument | null | undefined;
    combinations: CombinationTwin[];
    fields: FieldSummary[];
    vehicles: VehicleTwin[];
    implements: ImplementTwin[];
    onApplyDocument?: (document: AgriDocument) => void;
}): ReactElement {
    if (!document) {
        return (
            <section className="studio-mission-meta" aria-label={t('mission.edit.metadata')}>
                <p className="studio-muted">{t('mission.edit.needDocument')}</p>
            </section>
        );
    }

    const brief = briefFromDocument(document);
    const odd = parseOddProfile(metadataOf(document).srbc_odd ?? defaultOddProfile());
    const name = identityName(document);

    const apply = (next: AgriDocument) => {
        onApplyDocument?.(next);
    };

    const patchBrief = (partial: Partial<MissionBrief> & { name?: string }) => {
        const { name: nextName, ...briefPatch } = partial;
        apply(
            writeBrief(
                document,
                { ...brief, ...briefPatch },
                nextName === undefined ? name : nextName,
            ),
        );
    };

    const patchOdd = (partial: Partial<OddProfile>) => {
        apply(writeMetadata(document, { srbc_odd: { ...odd, ...partial } }));
    };

    const applyCombination = (combinationId: string) => {
        const combination = combinations.find((item) => item.id === combinationId);
        const vehicle = combination
            ? vehicles.find((item) => item.id === combination.vehicle_id)
            : undefined;
        const implement = combination?.implement_id
            ? (implementsList.find((item) => item.id === combination.implement_id) ?? null)
            : null;
        let next = writeBrief(document, { ...brief, combination_id: combinationId }, name);
        if (vehicle) {
            next = writeMetadata(next, {
                srbc_equipment: projectSrbcEquipment(vehicle, implement),
            });
        }
        apply(next);
    };

    const applyField = (fieldId: string) => {
        const field = fields.find((item) => item.id === fieldId);
        patchBrief({
            field_id: field?.id ?? '',
            field_name: field?.name ?? '',
            ...(field?.campaign ? { campaign: field.campaign } : {}),
        });
    };

    return (
        <section className="studio-mission-meta" aria-label={t('mission.edit.metadata')}>
            <h3>{t('mission.edit.field')}</h3>
            <Select
                id="mission-meta-field"
                label={t('assist.field.parcel')}
                help={t('mission.edit.field.hint')}
                value={brief.field_id}
                onValueChange={applyField}
                options={[
                    { value: '', label: t('assist.choose') },
                    ...(brief.field_id && !fields.some((field) => field.id === brief.field_id)
                        ? [
                              {
                                  value: brief.field_id,
                                  label: brief.field_name || brief.field_id,
                              },
                          ]
                        : []),
                    ...fields.map((field) => ({ value: field.id, label: field.name })),
                ]}
            />

            <h3>{t('mission.edit.equipment')}</h3>
            <Select
                id="mission-meta-combination"
                label={t('assist.field.combination')}
                help={t('assist.help.combination')}
                value={brief.combination_id}
                onValueChange={applyCombination}
                options={[
                    { value: '', label: t('assist.choose') },
                    ...combinations.map((item) => ({ value: item.id, label: item.name })),
                ]}
            />

            <h3>{t('equipment.odd.title')}</h3>
            <Input
                id="mission-meta-slope"
                label={t('equipment.odd.slope')}
                unit="%"
                type="number"
                min="0"
                step="0.1"
                value={odd.max_slope_pct === null ? '' : String(odd.max_slope_pct)}
                onChange={(event) => {
                    const value = event.target.value.trim();
                    if (!value) {
                        patchOdd({ max_slope_pct: null });
                        return;
                    }
                    const parsed = Number(value);
                    patchOdd({ max_slope_pct: Number.isFinite(parsed) ? parsed : null });
                }}
            />
            <Select
                id="mission-meta-weather"
                label={t('equipment.odd.weather')}
                value={odd.weather}
                onValueChange={(value) => patchOdd({ weather: value as OddProfile['weather'] })}
                options={ODD_WEATHER.map((item) => ({
                    value: item,
                    label: t(`equipment.odd.weather.${item}`),
                }))}
            />
            <Select
                id="mission-meta-visibility"
                label={t('equipment.odd.visibility')}
                value={odd.visibility}
                onValueChange={(value) =>
                    patchOdd({ visibility: value as OddProfile['visibility'] })
                }
                options={ODD_VISIBILITY.map((item) => ({
                    value: item,
                    label: t(`equipment.odd.visibility.${item}`),
                }))}
            />
            <Select
                id="mission-meta-crop"
                label={t('equipment.odd.crop')}
                value={odd.crop}
                onValueChange={(value) => patchOdd({ crop: value as OddProfile['crop'] })}
                options={ODD_CROP.map((item) => ({
                    value: item,
                    label: t(`equipment.odd.crop.${item}`),
                }))}
            />
            <Select
                id="mission-meta-localization"
                label={t('equipment.odd.localization')}
                value={odd.localization}
                onValueChange={(value) =>
                    patchOdd({ localization: value as OddProfile['localization'] })
                }
                options={ODD_LOCALIZATION.map((item) => ({
                    value: item,
                    label: t(`equipment.odd.localization.${item}`),
                }))}
            />
            <Select
                id="mission-meta-connectivity"
                label={t('mission.odd.connectivity')}
                value={odd.connectivity_required ? 'yes' : 'no'}
                onValueChange={(value) => patchOdd({ connectivity_required: value === 'yes' })}
                options={[
                    { value: 'no', label: t('mission.odd.connectivity.no') },
                    { value: 'yes', label: t('mission.odd.connectivity.yes') },
                ]}
            />

            <h3>{t('mission.edit.identity')}</h3>
            <Input
                id="mission-meta-name"
                label={t('mission.identity.name')}
                value={name}
                onChange={(event) => patchBrief({ name: event.target.value })}
            />
            <Select
                id="mission-meta-operation"
                label={t('assist.field.operation')}
                value={brief.operation}
                onValueChange={(value) => patchBrief({ operation: value as MissionOperation })}
                options={OPERATIONS.map((item) => ({
                    value: item,
                    label: t(`assist.operation.${item}`),
                }))}
            />
            <Input
                id="mission-meta-campaign"
                label={t('assist.field.campaign')}
                value={brief.campaign}
                onChange={(event) => patchBrief({ campaign: event.target.value })}
            />
            <Input
                id="mission-meta-from"
                label={t('assist.field.windowFrom')}
                type="date"
                value={brief.window_from}
                onChange={(event) => patchBrief({ window_from: event.target.value })}
            />
            <Input
                id="mission-meta-to"
                label={t('assist.field.windowTo')}
                type="date"
                value={brief.window_to}
                onChange={(event) => patchBrief({ window_to: event.target.value })}
            />
            <Select
                id="mission-meta-priority"
                label={t('assist.field.priority')}
                value={brief.priority}
                onValueChange={(value) => patchBrief({ priority: value as MissionPriority })}
                options={PRIORITIES.map((item) => ({
                    value: item,
                    label: t(`assist.priority.${item}`),
                }))}
            />
            <Input
                id="mission-meta-recipe"
                label={t('assist.field.recipeNote')}
                value={brief.recipe_note}
                onChange={(event) => patchBrief({ recipe_note: event.target.value })}
            />
        </section>
    );
}
