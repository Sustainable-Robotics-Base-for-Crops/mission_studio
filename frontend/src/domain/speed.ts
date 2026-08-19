import type { AgriDocument, AgriSection } from './agri';
import { normalizeSectionToColumns } from './section';

export function getCurrentTrajectorySpeed(
    document: AgriDocument | null | undefined,
): number | null {
    const sections = document?.points;
    if (!sections || sections.length === 0) {
        return null;
    }
    let unique: number | null = null;
    for (const section of sections) {
        const speedIndex = section.columns ? section.columns.indexOf('speed') : -1;
        if (speedIndex < 0 || !Array.isArray(section.values)) {
            continue;
        }
        for (const row of section.values) {
            const value = row[speedIndex];
            if (typeof value !== 'number') {
                continue;
            }
            if (unique === null) {
                unique = value;
            } else if (unique !== value) {
                return null;
            }
        }
    }
    return unique;
}

export function applySpeedToAllPoints(
    document: AgriDocument,
    value: number,
): { count: number; document: AgriDocument } {
    let count = 0;
    const points = document.points.map((section) => {
        const speedIndex = section.columns ? section.columns.indexOf('speed') : -1;
        if (speedIndex < 0 || !Array.isArray(section.values)) {
            return section;
        }
        return {
            ...section,
            values: section.values.map((row) => {
                const next = [...row];
                next[speedIndex] = value;
                count += 1;
                return next;
            }),
        };
    });
    return { count, document: { ...document, points } };
}

/** Same as TrajectoryEditor.addSpeed: reindex columns and force the speed cell. */
export function addSpeed(section: AgriSection, columns: string[], speed: number): AgriSection {
    return normalizeSectionToColumns(section, columns, { speed });
}
