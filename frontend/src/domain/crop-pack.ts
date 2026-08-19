/** Crop-pack operations (lot L12b). Pure Agri mutations, no DOM. */

import {
    getSectionTypeString,
    isTurnSection,
    reverseSection,
    type AgriDocument,
    type AgriSection,
} from './agri';

export const CROP_PACKS = ['open_field', 'vineyard', 'market_garden'] as const;
export type CropPackId = (typeof CROP_PACKS)[number];

export function isWorkSection(section: AgriSection): boolean {
    return getSectionTypeString(section) === 'row_line';
}

export function readCropPack(document: unknown): CropPackId {
    if (document === null || typeof document !== 'object') {
        return 'open_field';
    }
    const metadata = (document as { metadata?: unknown }).metadata;
    if (metadata === null || typeof metadata !== 'object') {
        return 'open_field';
    }
    const raw = (metadata as { srbc_crop_pack?: unknown }).srbc_crop_pack;
    if (raw === 'vineyard' || raw === 'market_garden' || raw === 'open_field') {
        return raw;
    }
    const brief = (metadata as { srbc_mission_brief?: unknown }).srbc_mission_brief;
    if (brief !== null && typeof brief === 'object') {
        const fromBrief = (brief as { crop_pack?: unknown }).crop_pack;
        if (
            fromBrief === 'vineyard' ||
            fromBrief === 'market_garden' ||
            fromBrief === 'open_field'
        ) {
            return fromBrief;
        }
    }
    return 'open_field';
}

export function writeCropPack(document: AgriDocument, pack: CropPackId): AgriDocument {
    const metadata =
        document.metadata !== null && typeof document.metadata === 'object'
            ? { ...(document.metadata as Record<string, unknown>) }
            : {};
    const brief =
        metadata.srbc_mission_brief !== null && typeof metadata.srbc_mission_brief === 'object'
            ? { ...(metadata.srbc_mission_brief as Record<string, unknown>) }
            : {};
    brief.crop_pack = pack;
    return {
        ...document,
        metadata: { ...metadata, srbc_crop_pack: pack, srbc_mission_brief: brief },
    };
}

export function workSectionIndices(document: AgriDocument | null | undefined): number[] {
    const indices: number[] = [];
    (document?.points ?? []).forEach((section, index) => {
        if (isWorkSection(section)) {
            indices.push(index);
        }
    });
    return indices;
}

/** 1-based ordinal among work (`row_line`) sections. */
export function workOrdinalOf(document: AgriDocument, sectionIndex: number): number | null {
    let ordinal = 0;
    for (let index = 0; index < document.points.length; index += 1) {
        const section = document.points[index];
        if (!section || !isWorkSection(section)) {
            continue;
        }
        ordinal += 1;
        if (index === sectionIndex) {
            return ordinal;
        }
    }
    return null;
}

export function indicesForWorkOrdinalRange(
    document: AgriDocument,
    fromOrdinal: number,
    toOrdinal: number,
): number[] {
    const lo = Math.min(fromOrdinal, toOrdinal);
    const hi = Math.max(fromOrdinal, toOrdinal);
    const indices: number[] = [];
    let ordinal = 0;
    document.points.forEach((section, index) => {
        if (!isWorkSection(section)) {
            return;
        }
        ordinal += 1;
        if (ordinal >= lo && ordinal <= hi) {
            indices.push(index);
        }
    });
    return indices;
}

/** Keep every (n+1)th work row (n=1 → 1,3,5…). Turns are dropped — reconnect after. */
export function skipEveryNthWorkSection(document: AgriDocument, skip: number): AgriDocument {
    const stride = Math.max(0, Math.floor(skip));
    if (stride === 0) {
        return document;
    }
    let workIndex = 0;
    const points = document.points.filter((section) => {
        if (isTurnSection(section)) {
            return false;
        }
        if (!isWorkSection(section)) {
            return true;
        }
        const keep = workIndex % (stride + 1) === 0;
        workIndex += 1;
        return keep;
    });
    return { ...document, points };
}

export function keepWorkOrdinalRange(
    document: AgriDocument,
    fromOrdinal: number,
    toOrdinal: number,
): AgriDocument {
    const keep = new Set(indicesForWorkOrdinalRange(document, fromOrdinal, toOrdinal));
    const points = document.points.filter((section, index) => {
        if (isTurnSection(section)) {
            return false;
        }
        if (!isWorkSection(section)) {
            return true;
        }
        return keep.has(index);
    });
    return { ...document, points };
}

export function reverseWorkTravel(document: AgriDocument): AgriDocument {
    return {
        ...document,
        points: document.points.map((section) =>
            isWorkSection(section) ? reverseSection(section) : section,
        ),
    };
}

/** Alternate heading on even work rows (boustrophedon if the fill was one-way). */
export function alternateWorkDirections(document: AgriDocument): AgriDocument {
    let workIndex = 0;
    return {
        ...document,
        points: document.points.map((section) => {
            if (!isWorkSection(section)) {
                return section;
            }
            const next = workIndex % 2 === 1 ? reverseSection(section) : section;
            workIndex += 1;
            return next;
        }),
    };
}
