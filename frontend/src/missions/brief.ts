import type { CoverageStrategy } from '../coverage/api';
import { cloneJson, type AgriDocument } from '../domain/agri';
import type { CropPackId } from '../domain/crop-pack';
import type { GeoJSONPolygon } from '../fields/types';
import type { LatLng } from '../domain/geometry';
import type { TurnKind } from '../domain/turns';

export const ASSISTANT_STEPS = [
    'objective',
    'parcel',
    'machine',
    'recipe',
    'strategy',
    'logistics',
    'generate',
] as const;

export type AssistantStep = (typeof ASSISTANT_STEPS)[number];

export type MissionOperation =
    'hoeing' | 'seeding' | 'spraying' | 'mowing' | 'inspection' | 'other';

export type MissionPriority = 'low' | 'normal' | 'high';

export interface MissionBrief {
    operation: MissionOperation;
    /** Operator-facing mission name. Empty means "keep the suggested name". */
    name: string;
    /** Field name kept beside its identifier so listings and filenames stay readable. */
    field_name: string;
    campaign: string;
    window_from: string;
    window_to: string;
    priority: MissionPriority;
    field_id: string;
    row_set_id: string;
    combination_id: string;
    working_width_m: number;
    overlap_m: number;
    speed_mps: number;
    recipe_note: string;
    strategy: CoverageStrategy;
    headland_width_m: number;
    connect_turns: boolean;
    turn_type: TurnKind;
    transit_note: string;
    service_node_id: string;
    weather_note: string;
    crop_pack: CropPackId;
}

export type BriefGate = 'field' | 'combination' | 'working_width' | 'overlap' | 'window';

export const OPERATIONS: readonly MissionOperation[] = [
    'hoeing',
    'seeding',
    'spraying',
    'mowing',
    'inspection',
    'other',
];

export const PRIORITIES: readonly MissionPriority[] = ['low', 'normal', 'high'];

export function defaultMissionBrief(now = new Date()): MissionBrief {
    return {
        operation: 'hoeing',
        name: '',
        field_name: '',
        campaign: String(now.getFullYear()),
        window_from: '',
        window_to: '',
        priority: 'normal',
        field_id: '',
        row_set_id: '',
        combination_id: '',
        working_width_m: 1.2,
        overlap_m: 0,
        speed_mps: 0.5,
        recipe_note: '',
        strategy: 'boustrophedon',
        headland_width_m: 0,
        connect_turns: true,
        turn_type: 'square',
        transit_note: '',
        service_node_id: '',
        weather_note: '',
        crop_pack: 'open_field',
    };
}

export function ringFromPolygon(geometry: GeoJSONPolygon | null | undefined): LatLng[] {
    const ring = geometry?.coordinates?.[0];
    if (!Array.isArray(ring)) {
        return [];
    }
    const points: LatLng[] = [];
    for (const pair of ring) {
        if (!Array.isArray(pair) || pair.length < 2) {
            continue;
        }
        const lng = Number(pair[0]);
        const lat = Number(pair[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            continue;
        }
        points.push({ lat, lng });
    }
    if (points.length >= 2) {
        const first = points[0];
        const last = points[points.length - 1];
        if (first && last && first.lat === last.lat && first.lng === last.lng) {
            points.pop();
        }
    }
    return points;
}

export function missingBriefGates(brief: MissionBrief): BriefGate[] {
    const missing: BriefGate[] = [];
    if (!brief.field_id.trim()) {
        missing.push('field');
    }
    if (!brief.combination_id.trim()) {
        missing.push('combination');
    }
    if (!(brief.working_width_m > 0) || !Number.isFinite(brief.working_width_m)) {
        missing.push('working_width');
    }
    if (brief.overlap_m < 0 || brief.overlap_m >= brief.working_width_m) {
        missing.push('overlap');
    }
    if (brief.window_from && brief.window_to && brief.window_from > brief.window_to) {
        missing.push('window');
    }
    return missing;
}

export function briefToMetadata(brief: MissionBrief): Record<string, unknown> {
    return {
        operation: brief.operation,
        name: brief.name.trim() || null,
        campaign: brief.campaign,
        window: { from: brief.window_from || null, to: brief.window_to || null },
        priority: brief.priority,
        field_id: brief.field_id || null,
        field_name: brief.field_name.trim() || null,
        row_set_id: brief.row_set_id || null,
        combination_id: brief.combination_id || null,
        working_width_m: brief.working_width_m,
        overlap_m: brief.overlap_m,
        speed_mps: brief.speed_mps,
        recipe_note: brief.recipe_note || null,
        strategy: brief.strategy,
        headland_width_m: brief.headland_width_m,
        connect_turns: brief.connect_turns,
        turn_type: brief.turn_type,
        transit_note: brief.transit_note || null,
        service_node_id: brief.service_node_id || null,
        weather_note: brief.weather_note || null,
        crop_pack: brief.crop_pack,
    };
}

/** Name proposed to the operator when they do not type one: "Binage — SABI expérience". */
export function suggestedMissionName(operationLabel: string, fieldName: string): string {
    const field = fieldName.trim();
    return field ? `${operationLabel} — ${field}` : operationLabel;
}

/** Change only the operator-facing name and preserve every other mission metadata field. */
export function withMissionName(document: AgriDocument, name: string): AgriDocument {
    const next = cloneJson(document);
    const metadata =
        next.metadata !== null && typeof next.metadata === 'object'
            ? (next.metadata as Record<string, unknown>)
            : {};
    const currentBrief =
        metadata.srbc_mission_brief !== null && typeof metadata.srbc_mission_brief === 'object'
            ? (metadata.srbc_mission_brief as Record<string, unknown>)
            : {};
    next.metadata = {
        ...metadata,
        srbc_mission_brief: {
            ...currentBrief,
            name: name.trim() || null,
        },
    };
    return next;
}

/** Compact local timestamp used in the editable names proposed at mission creation. */
export function missionNameTimestamp(now = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(
        now.getHours(),
    )}:${pad(now.getMinutes())}`;
}

export interface MissionContext {
    operation: string | null;
    name: string | null;
    field_name: string | null;
    campaign: string | null;
    field_id: string | null;
    combination_id: string | null;
    working_width_m: number | null;
    weather_note: string;
}

export function readMissionContext(document: unknown): MissionContext | null {
    if (document === null || typeof document !== 'object') {
        return null;
    }
    const metadata = (document as { metadata?: unknown }).metadata;
    if (metadata === null || typeof metadata !== 'object') {
        return null;
    }
    const brief = (metadata as { srbc_mission_brief?: unknown }).srbc_mission_brief;
    if (brief === null || typeof brief !== 'object') {
        return null;
    }
    const record = brief as Record<string, unknown>;
    const width = Number(record.working_width_m);
    return {
        operation: typeof record.operation === 'string' ? record.operation : null,
        name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : null,
        field_name:
            typeof record.field_name === 'string' && record.field_name.trim()
                ? record.field_name.trim()
                : null,
        campaign: typeof record.campaign === 'string' && record.campaign ? record.campaign : null,
        field_id: typeof record.field_id === 'string' && record.field_id ? record.field_id : null,
        combination_id:
            typeof record.combination_id === 'string' && record.combination_id
                ? record.combination_id
                : null,
        working_width_m: Number.isFinite(width) && width > 0 ? width : null,
        weather_note: typeof record.weather_note === 'string' ? record.weather_note : '',
    };
}
