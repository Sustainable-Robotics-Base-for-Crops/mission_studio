import { isUsableSurveyCoordinate, type ImportedCollection } from '../map/imported-layers';

/**
 * Turns an import collection into SVG paths, so the dialog can show what the
 * chosen dialect actually read. No basemap and no tiles: the question the
 * operator asks here is "is this the right formalism?", which the shapes and
 * their colours answer on their own, offline and instantly.
 */

const METERS_PER_DEGREE = 111320.0;

export const PREVIEW_WIDTH = 320;
/**
 * The frame follows the shape of the plot between these bounds. A vineyard
 * block is long and narrow: a fixed landscape frame would draw it as a thin
 * thread in the middle of a white field.
 */
export const PREVIEW_MIN_HEIGHT = 120;
export const PREVIEW_MAX_HEIGHT = 220;
const PADDING = 10;

/** A single point, or a file barely wider than the pen, still needs a frame. */
const MIN_SPAN_M = 4;

/**
 * Above this, the browser spends more time laying out paths than the operator
 * spends looking. Sampling keeps every n-th figure, so the drawing keeps its
 * shape and the dialog says how many were left out.
 */
export const MAX_PREVIEW_SHAPES = 1200;

const NICE_SCALE_STEPS_M = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000] as const;

export interface PreviewShape {
    id: string;
    kind: string;
    d: string;
    /** Polygons are filled; lines and points are stroked only. */
    filled: boolean;
    /** Unsmoothed trace, drawn dashed under the result. */
    ghost: boolean;
}

export interface PreviewPoint {
    id: string;
    kind: string;
    cx: number;
    cy: number;
}

export interface PreviewScale {
    /** Length of the bar in viewBox units. */
    length: number;
    /** Ready-to-read label, e.g. "20 m". */
    label: string;
}

export interface ImportPreviewGeometry {
    width: number;
    height: number;
    shapes: PreviewShape[];
    points: PreviewPoint[];
    /** Kinds actually drawn, in first-seen order, for the legend. */
    kinds: string[];
    scale: PreviewScale | null;
    drawn: number;
    total: number;
}

type Ring = [number, number][];

interface FeatureParts {
    kind: string;
    ghost: boolean;
    lines: Ring[];
    rings: Ring[];
    points: [number, number][];
}

function coordinatePair(value: unknown): [number, number] | null {
    if (!Array.isArray(value) || value.length < 2) {
        return null;
    }
    const lng = Number(value[0]);
    const lat = Number(value[1]);
    return isUsableSurveyCoordinate(lng, lat) ? [lng, lat] : null;
}

function ringOf(value: unknown): Ring {
    if (!Array.isArray(value)) {
        return [];
    }
    const ring: Ring = [];
    for (const item of value) {
        const pair = coordinatePair(item);
        if (pair) {
            ring.push(pair);
        }
    }
    return ring;
}

function kindOf(properties: Record<string, unknown> | null): string {
    const marker = properties?.srbc_import;
    if (marker && typeof marker === 'object') {
        const kind = (marker as Record<string, unknown>).kind;
        if (typeof kind === 'string' && kind) {
            return kind;
        }
    }
    return 'landmark';
}

function partsOf(collection: ImportedCollection): FeatureParts[] {
    const parts: FeatureParts[] = [];
    for (const feature of collection.features) {
        const geometry = feature.geometry;
        if (!geometry) {
            continue;
        }
        const entry: FeatureParts = {
            kind: kindOf(feature.properties),
            ghost: feature.properties?.srbc_preview_role === 'original',
            lines: [],
            rings: [],
            points: [],
        };
        const coordinates = geometry.coordinates;
        switch (geometry.type) {
            case 'Point': {
                const pair = coordinatePair(coordinates);
                if (pair) {
                    entry.points.push(pair);
                }
                break;
            }
            case 'MultiPoint':
                entry.points.push(...ringOf(coordinates));
                break;
            case 'LineString':
                entry.lines.push(ringOf(coordinates));
                break;
            case 'MultiLineString':
                if (Array.isArray(coordinates)) {
                    entry.lines.push(...coordinates.map(ringOf));
                }
                break;
            case 'Polygon':
                if (Array.isArray(coordinates)) {
                    entry.rings.push(...coordinates.map(ringOf));
                }
                break;
            case 'MultiPolygon':
                if (Array.isArray(coordinates)) {
                    for (const polygon of coordinates) {
                        if (Array.isArray(polygon)) {
                            entry.rings.push(...polygon.map(ringOf));
                        }
                    }
                }
                break;
            default:
                break;
        }
        if (entry.lines.length || entry.rings.length || entry.points.length) {
            parts.push(entry);
        }
    }
    return parts;
}

function niceScaleLength(metersPerUnit: number, innerWidth: number): PreviewScale | null {
    const target = (innerWidth / 3) * metersPerUnit;
    if (!Number.isFinite(target) || target <= 0) {
        return null;
    }
    // Largest round distance that still fits the third of the frame we allow it:
    // a bar running across the whole drawing would compete with the shapes.
    const meters: number =
        [...NICE_SCALE_STEPS_M].reverse().find((step) => step <= target) ?? NICE_SCALE_STEPS_M[0];
    const length = meters / metersPerUnit;
    if (!Number.isFinite(length) || length <= 0) {
        return null;
    }
    return {
        length: Math.round(length * 10) / 10,
        label: meters >= 1000 ? `${meters / 1000} km` : `${meters} m`,
    };
}

/** Keeps every n-th figure so the sample still covers the whole plot. */
function sampled<T>(items: T[], limit: number): T[] {
    if (items.length <= limit) {
        return items;
    }
    const stride = Math.ceil(items.length / limit);
    return items.filter((_item, index) => index % stride === 0);
}

export function previewGeometry(
    collection: ImportedCollection | null | undefined,
): ImportPreviewGeometry | null {
    if (!collection || !Array.isArray(collection.features) || collection.features.length === 0) {
        return null;
    }
    const parts = partsOf(collection);
    if (parts.length === 0) {
        return null;
    }

    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    const visit = ([lng, lat]: [number, number]) => {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
    };
    for (const entry of parts) {
        entry.points.forEach(visit);
        entry.lines.forEach((line) => line.forEach(visit));
        entry.rings.forEach((ring) => ring.forEach(visit));
    }
    if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) {
        return null;
    }

    // Equirectangular around the centre latitude: at field scale the error is
    // far below one pixel, and working in metres makes the scale bar exact.
    const midLat = (minLat + maxLat) / 2;
    const scaleX = METERS_PER_DEGREE * Math.cos((midLat * Math.PI) / 180);
    const spanX = Math.max((maxLng - minLng) * scaleX, MIN_SPAN_M);
    const spanY = Math.max((maxLat - minLat) * METERS_PER_DEGREE, MIN_SPAN_M);
    const height = Math.round(
        Math.min(Math.max((PREVIEW_WIDTH * spanY) / spanX, PREVIEW_MIN_HEIGHT), PREVIEW_MAX_HEIGHT),
    );
    const innerWidth = PREVIEW_WIDTH - 2 * PADDING;
    const innerHeight = height - 2 * PADDING;
    const unitsPerMeter = Math.min(innerWidth / spanX, innerHeight / spanY);
    const offsetX = PADDING + (innerWidth - spanX * unitsPerMeter) / 2;
    const offsetY = PADDING + (innerHeight - spanY * unitsPerMeter) / 2;

    const project = ([lng, lat]: [number, number]): [number, number] => [
        Math.round((offsetX + (lng - minLng) * scaleX * unitsPerMeter) * 100) / 100,
        // SVG grows downwards; north must stay up.
        Math.round((offsetY + (maxLat - lat) * METERS_PER_DEGREE * unitsPerMeter) * 100) / 100,
    ];

    const pathOf = (ring: Ring, close: boolean): string => {
        const projected = ring.map(project);
        const start = projected[0];
        if (!start || projected.length < 2) {
            return '';
        }
        const body = projected
            .slice(1)
            .map(([x, y]) => `L${x} ${y}`)
            .join('');
        return `M${start[0]} ${start[1]}${body}${close ? 'Z' : ''}`;
    };

    const shapes: PreviewShape[] = [];
    const points: PreviewPoint[] = [];
    const kinds: string[] = [];
    const kept = sampled(parts, MAX_PREVIEW_SHAPES);
    kept.forEach((entry, index) => {
        if (!entry.ghost && !kinds.includes(entry.kind)) {
            kinds.push(entry.kind);
        }
        const rings = entry.rings.map((ring) => pathOf(ring, true)).filter(Boolean);
        if (rings.length) {
            shapes.push({
                id: `p${index}`,
                kind: entry.kind,
                d: rings.join(''),
                filled: true,
                ghost: entry.ghost,
            });
        }
        const lines = entry.lines.map((line) => pathOf(line, false)).filter(Boolean);
        if (lines.length) {
            shapes.push({
                id: `l${index}`,
                kind: entry.kind,
                d: lines.join(''),
                filled: false,
                ghost: entry.ghost,
            });
        }
        entry.points.forEach((point, pointIndex) => {
            const [cx, cy] = project(point);
            points.push({ id: `c${index}-${pointIndex}`, kind: entry.kind, cx, cy });
        });
    });

    return {
        width: PREVIEW_WIDTH,
        height,
        shapes,
        points,
        kinds,
        scale: niceScaleLength(1 / unitsPerMeter, innerWidth),
        drawn: kept.length,
        total: parts.length,
    };
}
