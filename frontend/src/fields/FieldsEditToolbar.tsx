import { Check, Lasso, MousePointer2, Pentagon, Redo2, Ruler, Square, Undo2 } from 'lucide-react';
import type { ReactElement } from 'react';

import { IconButton } from '../design-system/Button';
import { ICON_SIZE, STROKE } from '../design-system/icons';
import { TrajectoryIcon } from '../map/tool-icons';
import type { FieldsTool } from './useFieldCatalogue';

export function FieldsEditToolbar({
    t,
    tool,
    intent,
    draftCount,
    canUndo,
    canRedo,
    onSelect,
    onLasso,
    onPolyline,
    onGeofence,
    onSurface,
    onRuler,
    onFinish,
    onUndo,
    onRedo,
    editingGeometry = false,
    undoLabel,
}: {
    t: (key: string, params?: Record<string, string | number>) => string;
    tool: FieldsTool;
    intent: 'none' | 'geofence' | 'surface' | 'polyline' | 'lasso' | 'create_field' | 'landmark';
    editingGeometry?: boolean;
    draftCount: number;
    canUndo: boolean;
    canRedo: boolean;
    onSelect: () => void;
    onLasso: () => void;
    onPolyline: () => void;
    onGeofence: () => void;
    onSurface: () => void;
    onRuler: () => void;
    onFinish: () => void;
    onUndo: () => void;
    onRedo: () => void;
    /** What undo would take back once the draft is empty, e.g. « Duplication des rangs ». */
    undoLabel?: string | null;
}): ReactElement {
    const drawing =
        tool === 'draw_polygon' ||
        tool === 'draw_line' ||
        tool === 'draw_point' ||
        tool === 'select_polygon';
    const polygon = tool === 'draw_polygon' || tool === 'select_polygon';
    const canFinish =
        tool === 'ruler'
            ? false
            : tool === 'draw_point'
              ? draftCount >= 1
              : polygon
                ? draftCount >= 3
                : draftCount >= 2;
    const lockChildTools = intent === 'create_field' || editingGeometry;
    return (
        <div
            className="studio-map-tools"
            role="toolbar"
            aria-label={t('fields.edit.toolbar')}
            data-fields-edit-toolbar="true"
            onWheel={(event) => event.stopPropagation()}
        >
            <IconButton
                label={t('fields.edit.select')}
                aria-pressed={tool === 'select'}
                className={tool === 'select' ? 'is-active' : undefined}
                data-tool="fields_select"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onSelect}
            >
                <MousePointer2 size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            <IconButton
                label={t('fields.edit.lasso')}
                aria-pressed={tool === 'select_polygon'}
                className={tool === 'select_polygon' ? 'is-active' : undefined}
                data-tool="fields_lasso"
                disabled={lockChildTools}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onLasso}
            >
                <Lasso size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            <IconButton
                label={t('fields.edit.polyline')}
                aria-pressed={intent === 'polyline'}
                className={intent === 'polyline' ? 'is-active' : undefined}
                data-tool="fields_polyline"
                disabled={lockChildTools}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onPolyline}
            >
                <TrajectoryIcon size={ICON_SIZE.button} />
            </IconButton>
            <IconButton
                label={t('fields.edit.geofence')}
                aria-pressed={intent === 'geofence'}
                className={intent === 'geofence' ? 'is-active' : undefined}
                data-tool="fields_geofence"
                disabled={lockChildTools}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onGeofence}
            >
                <Pentagon size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            <IconButton
                label={t('fields.edit.surface')}
                aria-pressed={intent === 'surface' || intent === 'create_field'}
                className={
                    intent === 'surface' || intent === 'create_field' ? 'is-active' : undefined
                }
                data-tool="fields_surface"
                disabled={lockChildTools && intent !== 'create_field'}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                    if (lockChildTools) {
                        return;
                    }
                    onSurface();
                }}
            >
                <Square size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            <IconButton
                label={t('fields.edit.ruler')}
                aria-pressed={tool === 'ruler'}
                className={tool === 'ruler' ? 'is-active' : undefined}
                data-tool="fields_ruler"
                disabled={lockChildTools}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onRuler}
            >
                <Ruler size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            {drawing ? (
                <IconButton
                    label={t('fields.tool.finish')}
                    disabled={!canFinish}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onFinish}
                >
                    <Check size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
                </IconButton>
            ) : null}
            <IconButton
                label={
                    undoLabel && draftCount === 0 ? `${t('ds.undo')} · ${undoLabel}` : t('ds.undo')
                }
                disabled={!canUndo}
                onClick={onUndo}
            >
                <Undo2 size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            <IconButton label={t('ds.redo')} disabled={!canRedo} onClick={onRedo}>
                <Redo2 size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
        </div>
    );
}
