export const DEFAULT_SECTION_COLUMNS = ['x', 'y', 'speed', 'working_zone', 'punctual'] as const;

export const MAX_POINTS_PER_SECTION = 50_000;
export const MAX_POINTS_PER_TRAJECTORY = 1_000_000;

export type Cell = string | number | boolean | Record<string, unknown> | null;
export type SectionRow = Cell[];

export interface AgriSection {
    section_type?: string;
    sectionType?: { value?: string } | string;
    columns: string[];
    values: SectionRow[];
}

export interface AgriOrigin {
    type?: string;
    coordinates?: { lat: number; lon: number; alt?: number };
}

export interface AgriDocument {
    origin?: AgriOrigin;
    points: AgriSection[];
    [key: string]: unknown;
}

export function parseAgriDocument(value: unknown): AgriDocument | null {
    if (value === null || typeof value !== 'object') {
        return null;
    }
    const record = value as Record<string, unknown>;
    const points = Array.isArray(record.points) ? (record.points as AgriSection[]) : [];
    return { ...record, points };
}

export function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export function getSectionTypeString(section: AgriSection | null | undefined): string {
    if (!section) {
        return 'row_path';
    }
    if (section.section_type != null && section.section_type !== '') {
        return String(section.section_type);
    }
    const typed = section.sectionType;
    if (typed && typeof typed === 'object' && typed.value != null && typed.value !== '') {
        return String(typed.value);
    }
    if (typeof typed === 'string' && typed !== '') {
        return typed;
    }
    return 'row_path';
}

export function isTurnSection(section: AgriSection): boolean {
    return getSectionTypeString(section).startsWith('turn_');
}

export function cloneSectionValueRow(row: SectionRow | undefined): SectionRow {
    if (!row || !Array.isArray(row)) {
        return [];
    }
    return row.map((cell) => {
        if (cell !== null && typeof cell === 'object' && !Array.isArray(cell)) {
            return { ...(cell as Record<string, unknown>) };
        }
        return cell;
    });
}

export function getTotalPointsCount(document: AgriDocument | null | undefined): number {
    let total = 0;
    const sections = document?.points;
    if (!Array.isArray(sections)) {
        return 0;
    }
    for (const section of sections) {
        if (Array.isArray(section.values)) {
            total += section.values.length;
        }
    }
    return total;
}

export function deleteSection(document: AgriDocument, index: number): AgriDocument {
    return {
        ...document,
        points: document.points.filter((_, current) => current !== index),
    };
}

export function reverseSection(section: AgriSection): AgriSection {
    return { ...section, values: [...section.values].reverse() };
}

export function reverseSectionInDocument(document: AgriDocument, index: number): AgriDocument {
    if (index < 0 || index >= document.points.length) {
        return document;
    }
    const section = document.points[index];
    if (!section) {
        return document;
    }
    return {
        ...document,
        points: document.points.map((entry, current) =>
            current === index ? reverseSection(entry) : entry,
        ),
    };
}

export function reorderSection(
    document: AgriDocument,
    fromIndex: number,
    toIndex: number,
): AgriDocument {
    if (!Array.isArray(document.points)) {
        return document;
    }
    const length = document.points.length;
    if (fromIndex < 0 || fromIndex >= length) {
        return document;
    }
    const clamped = Math.max(0, Math.min(toIndex, length - 1));
    if (clamped === fromIndex) {
        return document;
    }
    const next = document.points.slice();
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) {
        return document;
    }
    next.splice(clamped, 0, moved);
    return { ...document, points: next };
}

export function remapIndexAfterReorder(index: number, fromIndex: number, toIndex: number): number {
    if (index === fromIndex) {
        return toIndex;
    }
    if (fromIndex < index && index <= toIndex) {
        return index - 1;
    }
    if (toIndex <= index && index < fromIndex) {
        return index + 1;
    }
    return index;
}
