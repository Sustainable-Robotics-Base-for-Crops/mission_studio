import {
    getSectionTypeString,
    isTurnSection,
    remapIndexAfterReorder,
    type AgriDocument,
    type AgriSection,
} from '../domain/agri';
import { distance } from '../domain/geometry';
import {
    polygonAreaM2,
    readGeofenceExclusions,
    readGeofenceExterior,
    type GeofenceId,
} from '../domain/geofence';

export type MissionRole = 'headland' | 'work' | 'turn' | 'other';
export type MissionBucket = 'headland' | 'work' | 'other';

export interface MissionLeaf {
    kind: 'leaf';
    id: string;
    index: number;
    role: MissionRole;
    ordinal: number;
    length_m: number;
    speed_mps: number;
    points: number;
}

export interface MissionGroup {
    kind: 'group';
    id: string;
    bucket: MissionBucket;
    children: MissionLeaf[];
    length_m: number;
}

export interface MissionMetrics {
    length_m: number;
    duration_s: number;
    rows: number;
    turns: number;
    headlands: number;
    sections: number;
}

export interface GeofenceLeaf {
    id: GeofenceId;
    role: 'outer' | 'exclusion';
    ordinal: number;
    area_m2: number;
}

export interface MissionTreeModel {
    groups: MissionGroup[];
    leaves: MissionLeaf[];
    geofence: GeofenceLeaf[];
    metrics: MissionMetrics;
}

const DEFAULT_SPEED_MPS = 0.5;

export function sectionRole(section: AgriSection): MissionRole {
    if (isTurnSection(section)) {
        return 'turn';
    }
    const type = getSectionTypeString(section);
    if (type === 'row_line') {
        return 'work';
    }
    if (type === 'row_path') {
        return 'headland';
    }
    return 'other';
}

function bucketOf(role: MissionRole): MissionBucket {
    return role === 'turn' || role === 'work' ? 'work' : role === 'headland' ? 'headland' : 'other';
}

export function sectionLengthM(section: AgriSection): number {
    const xIndex = section.columns.indexOf('x');
    const yIndex = section.columns.indexOf('y');
    if (xIndex < 0 || yIndex < 0 || section.values.length < 2) {
        return 0;
    }
    let total = 0;
    for (let index = 1; index < section.values.length; index += 1) {
        const previous = section.values[index - 1];
        const current = section.values[index];
        if (!previous || !current) {
            continue;
        }
        const x0 = Number(previous[xIndex]);
        const y0 = Number(previous[yIndex]);
        const x1 = Number(current[xIndex]);
        const y1 = Number(current[yIndex]);
        if (![x0, y0, x1, y1].every(Number.isFinite)) {
            continue;
        }
        total += distance(x0, y0, x1, y1);
    }
    return total;
}

export function sectionMeanSpeedMps(section: AgriSection): number {
    const speedIndex = section.columns.indexOf('speed');
    if (speedIndex < 0) {
        return DEFAULT_SPEED_MPS;
    }
    let sum = 0;
    let count = 0;
    for (const row of section.values) {
        const speed = Number(row[speedIndex]);
        if (speed > 0 && Number.isFinite(speed)) {
            sum += speed;
            count += 1;
        }
    }
    return count > 0 ? sum / count : DEFAULT_SPEED_MPS;
}

export function formatDurationCompact(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '—';
    }
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
    }
    return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function buildMissionTree(document: AgriDocument | null | undefined): MissionTreeModel {
    const sections = document?.points ?? [];
    const leaves: MissionLeaf[] = [];
    const ordinals: Record<MissionRole, number> = {
        headland: 0,
        work: 0,
        turn: 0,
        other: 0,
    };
    for (let index = 0; index < sections.length; index += 1) {
        const section = sections[index];
        if (!section) {
            continue;
        }
        const role = sectionRole(section);
        ordinals[role] += 1;
        const length_m = sectionLengthM(section);
        const speed_mps = sectionMeanSpeedMps(section);
        leaves.push({
            kind: 'leaf',
            id: `s:${index}`,
            index,
            role,
            ordinal: ordinals[role],
            length_m,
            speed_mps,
            points: section.values.length,
        });
    }
    const groups: MissionGroup[] = [];
    for (const leaf of leaves) {
        const bucket = bucketOf(leaf.role);
        const last = groups[groups.length - 1];
        if (!last || last.bucket !== bucket) {
            groups.push({
                kind: 'group',
                id: `g:${groups.length}:${bucket}`,
                bucket,
                children: [leaf],
                length_m: leaf.length_m,
            });
            continue;
        }
        last.children.push(leaf);
        last.length_m += leaf.length_m;
    }
    let duration_s = 0;
    let length_m = 0;
    for (const leaf of leaves) {
        length_m += leaf.length_m;
        duration_s += leaf.speed_mps > 0 ? leaf.length_m / leaf.speed_mps : 0;
    }
    const geofence: GeofenceLeaf[] = [];
    const exterior = readGeofenceExterior(document);
    if (exterior.length >= 3) {
        geofence.push({
            id: 'outer',
            role: 'outer',
            ordinal: 1,
            area_m2: polygonAreaM2(exterior),
        });
    }
    readGeofenceExclusions(document).forEach((ring, index) => {
        geofence.push({
            id: `exclusion:${index}`,
            role: 'exclusion',
            ordinal: index + 1,
            area_m2: polygonAreaM2(ring),
        });
    });
    return {
        groups,
        leaves,
        geofence,
        metrics: {
            length_m,
            duration_s,
            rows: ordinals.work,
            turns: ordinals.turn,
            headlands: ordinals.headland,
            sections: leaves.length,
        },
    };
}

export function remapIndexList(
    indices: readonly number[],
    fromIndex: number,
    toIndex: number,
): number[] {
    return [...new Set(indices.map((index) => remapIndexAfterReorder(index, fromIndex, toIndex)))];
}

export function remapIndexListAfterDelete(
    indices: readonly number[],
    deleted: readonly number[],
): number[] {
    const gone = new Set(deleted);
    const ordered = [...deleted].sort((left, right) => left - right);
    return indices
        .filter((index) => !gone.has(index))
        .map((index) => index - ordered.filter((item) => item < index).length);
}

export function formatMetricsDeltaCaption(
    current: MissionMetrics,
    baseline: MissionMetrics,
): string | null {
    const lengthDelta = Math.round(current.length_m - baseline.length_m);
    const durationDelta = Math.round(current.duration_s - baseline.duration_s);
    const parts: string[] = [];
    if (lengthDelta !== 0) {
        parts.push(`${lengthDelta > 0 ? '+' : ''}${lengthDelta} m`);
    }
    if (durationDelta !== 0) {
        const compact = formatDurationCompact(Math.abs(durationDelta));
        parts.push(`${durationDelta > 0 ? '+' : '-'}${compact}`);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
}

export function indexListIntersects(left: readonly number[], right: readonly number[]): boolean {
    if (left.length === 0 || right.length === 0) {
        return false;
    }
    const lookup = new Set(right);
    return left.some((index) => lookup.has(index));
}
