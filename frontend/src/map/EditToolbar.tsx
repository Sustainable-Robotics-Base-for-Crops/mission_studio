import { Check, LandPlot, Lasso, MousePointer2, Pentagon, Redo2, Ruler, Undo2 } from 'lucide-react';
import { ConnectUIcon, TrajectoryIcon } from './tool-icons';
import type { ReactElement } from 'react';

import { IconButton } from '../design-system/Button';
import { ICON_SIZE, STROKE } from '../design-system/icons';
import { AdvancedModeLink } from '../app/AdvancedModeLink';
import { isAdvancedUi, type UiMode } from '../app/farm-api';
import { isPolygonTool, type EditTool } from './useMissionEditor';

interface EditToolbarProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    uiMode?: UiMode;
    tool: EditTool;
    draftCount: number;
    canUndo: boolean;
    canRedo: boolean;
    onSelectZone: () => void;
    onSelectPolygon: () => void;
    onDrawLine: () => void;
    onDrawPolygon: () => void;
    onFillParcel: () => void;
    onConnectEnds: () => void;
    onRuler: () => void;
    onFinish: () => void;
    onUndo: () => void;
    onRedo: () => void;
}

export function EditToolbar({
    t,
    uiMode,
    tool,
    draftCount,
    canUndo,
    canRedo,
    onSelectZone,
    onSelectPolygon,
    onDrawLine,
    onDrawPolygon,
    onFillParcel,
    onConnectEnds,
    onRuler,
    onFinish,
    onUndo,
    onRedo,
}: EditToolbarProps): ReactElement {
    const drawing = tool !== 'none';
    const polygon = isPolygonTool(tool);
    const advanced = isAdvancedUi(uiMode);
    const canFinish = polygon ? draftCount >= 3 : draftCount >= 2;
    const showFinishCheck =
        drawing &&
        tool !== 'ruler' &&
        tool !== 'select_zone' &&
        tool !== 'connect_ends' &&
        tool !== 'edit_working_zone';
    const finishLabel =
        tool === 'draw_polygon'
            ? t('tool.finishPolygon')
            : tool === 'edit_geofence'
              ? t('tool.finishGeofenceEdit')
              : tool === 'draw_geofence_exclusion'
                ? t('tool.finishGeofenceExclusion')
                : tool === 'draw_parcel'
                  ? t('tool.finishFillParcel')
                  : tool === 'delete_points_zone'
                    ? t('tool.finishDeleteZone')
                    : tool === 'select_sections_polygon'
                      ? t('tool.finishSelectPolygon')
                      : t('tool.finishLine');
    return (
        <div
            className="studio-map-tools"
            role="toolbar"
            aria-label={t('tool.toolbar')}
            onWheel={(event) => event.stopPropagation()}
        >
            <IconButton
                label={t('tool.selectZone')}
                aria-pressed={tool === 'select_zone'}
                className={tool === 'select_zone' ? 'is-active' : undefined}
                data-tool="select_zone"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onSelectZone}
            >
                <MousePointer2 size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            <IconButton
                label={t('tool.selectPolygon')}
                aria-pressed={tool === 'select_sections_polygon'}
                className={tool === 'select_sections_polygon' ? 'is-active' : undefined}
                data-tool="select_sections_polygon"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onSelectPolygon}
            >
                <Lasso size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            <IconButton
                label={t('tool.drawLine')}
                aria-pressed={tool === 'draw_line'}
                className={tool === 'draw_line' ? 'is-active' : undefined}
                data-tool="draw_line"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onDrawLine}
            >
                <TrajectoryIcon size={ICON_SIZE.button} />
            </IconButton>
            <IconButton
                label={t('tool.fillParcel')}
                aria-pressed={tool === 'draw_parcel'}
                className={tool === 'draw_parcel' ? 'is-active' : undefined}
                data-tool="draw_parcel"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onFillParcel}
            >
                <LandPlot size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            <IconButton
                label={t('tool.drawPolygon')}
                aria-pressed={tool === 'draw_polygon'}
                className={tool === 'draw_polygon' ? 'is-active' : undefined}
                data-tool="draw_polygon"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onDrawPolygon}
            >
                <Pentagon size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            <IconButton
                label={t('tool.connectEnds')}
                aria-pressed={tool === 'connect_ends'}
                className={tool === 'connect_ends' ? 'is-active' : undefined}
                data-tool="connect_ends"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onConnectEnds}
            >
                <ConnectUIcon size={ICON_SIZE.button} />
            </IconButton>
            <IconButton
                label={t('tool.ruler')}
                aria-pressed={tool === 'ruler'}
                className={tool === 'ruler' ? 'is-active' : undefined}
                data-tool="ruler"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onRuler}
            >
                <Ruler size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            {showFinishCheck ? (
                <IconButton
                    label={finishLabel}
                    disabled={!canFinish}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onFinish}
                >
                    <Check size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
                </IconButton>
            ) : null}
            <IconButton
                label={t('ds.undo')}
                disabled={!canUndo && !(drawing && draftCount > 0)}
                onClick={onUndo}
            >
                <Undo2 size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            <IconButton
                label={t('ds.redo')}
                disabled={!canRedo || (drawing && tool !== 'select_zone')}
                onClick={onRedo}
            >
                <Redo2 size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            {advanced ? null : <AdvancedModeLink t={t} />}
        </div>
    );
}
