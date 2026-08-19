import type { AgriSection } from './agri';
import { latLngToLocal, localToLatLng, type LatLng, type Wgs84Origin } from './geometry';
import { generateRowLineFromLatLngs } from './section';

/** Default row spacing in the legacy fill-parcel dialog. */
export const DEFAULT_ROW_SPACING_M = 2.5;

/**
 * Parallel rows inside a polygon, same sweep as TrajectoryEditor.generateParallelLines.
 * Studio writes Agri `row_line` (intersection vertices only) for nav_line_matcher —
 * `/app` still densifies the same sweep to `row_path` at 0.1 m.
 */
export function generateParallelRowLines(
    parcelPoints: LatLng[],
    origin: Wgs84Origin,
    spacing = DEFAULT_ROW_SPACING_M,
): AgriSection[] {
    if (parcelPoints.length < 3 || !(spacing > 0)) {
        return [];
    }
    const first = parcelPoints[0];
    const second = parcelPoints[1];
    if (!first || !second) {
        return [];
    }
    const polylines = sweepParallelPolylines(parcelPoints, first, second, origin, spacing, true);
    const sections: AgriSection[] = [];
    for (const latLngPoints of polylines) {
        const section = generateRowLineFromLatLngs(latLngPoints, origin);
        if (section) {
            sections.push(section);
        }
    }
    return sections;
}

/** Permanent numbered rows (L6): heading from an AB axis, no bounce. */
export const MAX_CATALOGUE_ROWS = 200;

export function generateCatalogueRowPolylines(
    parcelPoints: LatLng[],
    axisStart: LatLng,
    axisEnd: LatLng,
    origin: Wgs84Origin,
    spacing = DEFAULT_ROW_SPACING_M,
): LatLng[][] {
    return sweepParallelPolylines(parcelPoints, axisStart, axisEnd, origin, spacing, false);
}

function sweepParallelPolylines(
    parcelPoints: LatLng[],
    axisStart: LatLng,
    axisEnd: LatLng,
    origin: Wgs84Origin,
    spacing: number,
    reverseOdd: boolean,
): LatLng[][] {
    if (parcelPoints.length < 3 || !(spacing > 0)) {
        return [];
    }
    const parcelXY = parcelPoints.map((point) => latLngToLocal(point, origin));
    const start = latLngToLocal(axisStart, origin);
    const next = latLngToLocal(axisEnd, origin);
    const dx = next.x - start.x;
    const dy = next.y - start.y;
    const axisLength = Math.sqrt(dx * dx + dy * dy);
    if (axisLength < 1e-9) {
        return [];
    }
    const dirX = dx / axisLength;
    const dirY = dy / axisLength;
    const perpX = -dirY;
    const perpY = dirX;

    let minPerp = Infinity;
    let maxPerp = -Infinity;
    for (const point of parcelXY) {
        const perpDist = point.x * perpX + point.y * perpY;
        minPerp = Math.min(minPerp, perpDist);
        maxPerp = Math.max(maxPerp, perpDist);
    }

    const polylines: LatLng[][] = [];
    let currentPerp = minPerp + spacing / 2;
    let lineIndex = 0;

    while (currentPerp < maxPerp) {
        if (polylines.length >= MAX_CATALOGUE_ROWS) {
            break;
        }
        const intersections: Array<{ x: number; y: number }> = [];
        for (let index = 0; index < parcelXY.length; index += 1) {
            const p1 = parcelXY[index];
            const p2 = parcelXY[(index + 1) % parcelXY.length];
            if (!p1 || !p2) {
                continue;
            }
            const d1 = p1.x * perpX + p1.y * perpY - currentPerp;
            const d2 = p2.x * perpX + p2.y * perpY - currentPerp;
            if (d1 * d2 < 0) {
                const t = d1 / (d1 - d2);
                intersections.push({
                    x: p1.x + t * (p2.x - p1.x),
                    y: p1.y + t * (p2.y - p1.y),
                });
            }
        }
        if (intersections.length >= 2) {
            let sorted = intersections.sort((a, b) => (a.x - b.x) * dirX + (a.y - b.y) * dirY);
            if (reverseOdd && lineIndex % 2 === 1) {
                sorted = sorted.reverse();
            }
            polylines.push(sorted.map((point) => localToLatLng(point, origin)));
            lineIndex += 1;
        }
        currentPerp += spacing;
    }
    return polylines;
}
