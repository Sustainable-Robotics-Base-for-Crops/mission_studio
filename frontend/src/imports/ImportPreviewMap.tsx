import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { COLOR } from '../design-system/tokens';
import type { ImportedCollection, ImportedFeature } from '../map/imported-layers';
import { MAP_STYLE } from '../map/styles';
import { previewGeometry, type PreviewShape } from './preview-shapes';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export const PREVIEW_KIND_COLOR: Record<string, string> = {
    boundary: MAP_STYLE.geofenceLine,
    row: COLOR.valid,
    guidance_line: COLOR.planned,
    obstacle: COLOR.danger,
    track: COLOR.selected,
    coverage_cell: COLOR.autonomy,
    landmark: COLOR.transit,
};

const ORIGINAL_COLOR = '#64748b';
const MAX_ZOOM = 24;

interface Frame {
    minX: number;
    minY: number;
    width: number;
    height: number;
}

function colorOf(kind: string): string {
    return PREVIEW_KIND_COLOR[kind] ?? COLOR.transit;
}

function asOriginal(feature: ImportedFeature): ImportedFeature {
    return {
        ...feature,
        properties: { ...(feature.properties ?? {}), srbc_preview_role: 'original' },
    };
}

/** Shrink or grow the visible window, keeping `focus` under the pointer. */
export function zoomFrame(
    frame: Frame,
    focusX: number,
    focusY: number,
    factor: number,
    full: Frame,
): Frame {
    const nextWidth = Math.min(full.width, Math.max(full.width / MAX_ZOOM, frame.width / factor));
    if (nextWidth >= full.width - 0.01) {
        return { minX: 0, minY: 0, width: full.width, height: full.height };
    }
    const nextHeight = frame.height * (nextWidth / frame.width);
    const relX = (focusX - frame.minX) / frame.width;
    const relY = (focusY - frame.minY) / frame.height;
    return {
        minX: focusX - relX * nextWidth,
        minY: focusY - relY * nextHeight,
        width: nextWidth,
        height: nextHeight,
    };
}

export function ImportPreviewMap({
    t,
    collection,
    reference = null,
    fitKey = '',
}: {
    t: Translate;
    collection: ImportedCollection | null;
    reference?: ImportedCollection | null;
    fitKey?: string;
}): ReactElement | null {
    const drawn = useMemo<ImportedCollection | null>(() => {
        if (!collection) {
            return null;
        }
        return {
            type: 'FeatureCollection',
            features: [...(reference?.features ?? []).map(asOriginal), ...collection.features],
        };
    }, [collection, reference]);
    const geometry = useMemo(() => previewGeometry(drawn), [drawn]);
    const full = useMemo<Frame>(
        () => ({
            minX: 0,
            minY: 0,
            width: geometry?.width ?? 1,
            height: geometry?.height ?? 1,
        }),
        [geometry?.width, geometry?.height],
    );
    const frameRef = useRef<Frame>(full);
    const [frame, setFrame] = useState<Frame>(full);
    const drag = useRef<{ x: number; y: number; frame: Frame } | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const apply = (next: Frame) => {
        frameRef.current = next;
        setFrame(next);
    };

    useEffect(() => {
        apply({ minX: 0, minY: 0, width: full.width, height: full.height });
    }, [fitKey, full.width, full.height]);

    useEffect(() => {
        const node = svgRef.current;
        if (!node) {
            return;
        }
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            const rect = node.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) {
                return;
            }
            const current = frameRef.current;
            const focusX =
                current.minX + ((event.clientX - rect.left) / rect.width) * current.width;
            const focusY =
                current.minY + ((event.clientY - rect.top) / rect.height) * current.height;
            apply(zoomFrame(current, focusX, focusY, event.deltaY < 0 ? 1.2 : 1 / 1.2, full));
        };
        node.addEventListener('wheel', onWheel, { passive: false });
        return () => node.removeEventListener('wheel', onWheel);
    }, [full, geometry]);

    if (!collection || !geometry) {
        return <p className="studio-muted">{t('imports.preview.empty')}</p>;
    }

    const { width, height, scale } = geometry;
    const shapes = [...geometry.shapes].sort(
        (left, right) => Number(right.ghost) - Number(left.ghost),
    );
    const fitted =
        Math.abs(frame.minX) < 0.01 &&
        Math.abs(frame.minY) < 0.01 &&
        Math.abs(frame.width - width) < 0.01;

    const zoomBy = (factor: number) => {
        const current = frameRef.current;
        apply(
            zoomFrame(
                current,
                current.minX + current.width / 2,
                current.minY + current.height / 2,
                factor,
                full,
            ),
        );
    };

    return (
        <div className="studio-import-preview">
            <div className="studio-import-preview-stage">
                <svg
                    ref={svgRef}
                    viewBox={`${frame.minX} ${frame.minY} ${frame.width} ${frame.height}`}
                    role="img"
                    aria-label={t('imports.preview.alt', { count: geometry.total })}
                    preserveAspectRatio="xMidYMid meet"
                    onPointerDown={(event) => {
                        if (event.button !== 0) {
                            return;
                        }
                        if ((event.target as Element).closest('button')) {
                            return;
                        }
                        event.currentTarget.setPointerCapture(event.pointerId);
                        drag.current = {
                            x: event.clientX,
                            y: event.clientY,
                            frame: frameRef.current,
                        };
                    }}
                    onPointerMove={(event) => {
                        const start = drag.current;
                        const rect = svgRef.current?.getBoundingClientRect();
                        if (!start || !rect || rect.width === 0 || rect.height === 0) {
                            return;
                        }
                        const dx = ((event.clientX - start.x) / rect.width) * start.frame.width;
                        const dy = ((event.clientY - start.y) / rect.height) * start.frame.height;
                        apply({
                            ...start.frame,
                            minX: start.frame.minX - dx,
                            minY: start.frame.minY - dy,
                        });
                    }}
                    onPointerUp={() => {
                        drag.current = null;
                    }}
                    onPointerCancel={() => {
                        drag.current = null;
                    }}
                >
                    {shapes.map((shape) => (
                        <PreviewPath key={shape.id} shape={shape} />
                    ))}
                    {geometry.points.map((point) => (
                        <circle
                            key={point.id}
                            cx={point.cx}
                            cy={point.cy}
                            r={2.2}
                            fill={colorOf(point.kind)}
                        />
                    ))}
                    {scale && fitted ? (
                        <g className="studio-import-preview-scale" aria-hidden="true">
                            <path
                                d={`M8 ${height - 8}h${scale.length}`}
                                stroke={COLOR.textSecondary}
                                strokeWidth={1.5}
                            />
                            <text
                                x={8}
                                y={height - 12}
                                fill={COLOR.textSecondary}
                                fontSize={9}
                                stroke="#ffffff"
                                strokeWidth={2.5}
                                paintOrder="stroke"
                            >
                                {scale.label}
                            </text>
                        </g>
                    ) : null}
                </svg>
                <div
                    className="studio-import-preview-zoom"
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <button type="button" onClick={() => zoomBy(1.25)} aria-label={t('map.zoomIn')}>
                        +
                    </button>
                    <button
                        type="button"
                        onClick={() => zoomBy(1 / 1.25)}
                        aria-label={t('map.zoomOut')}
                    >
                        −
                    </button>
                    <button
                        type="button"
                        onClick={() => apply({ minX: 0, minY: 0, width, height })}
                        aria-label={t('imports.preview.refit')}
                    >
                        {t('imports.preview.refit')}
                    </button>
                </div>
            </div>
            <p className="studio-muted">
                {t(reference ? 'imports.preview.zoomHint' : 'imports.preview.zoomHintPlain')}
            </p>
            <ul className="studio-import-legend">
                {reference ? (
                    <li>
                        <span aria-hidden="true" style={{ background: ORIGINAL_COLOR }} />
                        {t('imports.preview.original')}
                    </li>
                ) : null}
                {geometry.kinds.map((kind) => (
                    <li key={kind}>
                        <span aria-hidden="true" style={{ background: colorOf(kind) }} />
                        {t(`imports.kind.${kind}`)}
                    </li>
                ))}
            </ul>
            {geometry.drawn < geometry.total ? (
                <p className="studio-muted">
                    {t('imports.preview.truncated', {
                        shown: geometry.drawn,
                        total: geometry.total,
                    })}
                </p>
            ) : null}
        </div>
    );
}

function PreviewPath({ shape }: { shape: PreviewShape }): ReactElement {
    return (
        <path
            d={shape.d}
            fill={shape.filled && !shape.ghost ? colorOf(shape.kind) : 'none'}
            fillOpacity={shape.filled && !shape.ghost ? 0.35 : undefined}
            stroke={shape.ghost ? ORIGINAL_COLOR : colorOf(shape.kind)}
            strokeWidth={shape.ghost ? 1 : shape.filled ? 0.4 : 1.2}
            strokeDasharray={shape.ghost ? '4 3' : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
        />
    );
}
