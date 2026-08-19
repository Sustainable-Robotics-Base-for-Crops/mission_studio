import {
    Check,
    CircleDashed,
    CornerDownLeft,
    FlipHorizontal2,
    Gauge,
    LandPlot,
    Lasso,
    MoveHorizontal,
    MousePointer2,
    Pentagon,
    Redo2,
    Ruler,
    Scissors,
    Spline,
    Sprout,
    Trash2,
    Undo2,
} from 'lucide-react';
import type { ReactElement } from 'react';

import { IconButton } from '../design-system/Button';
import { ICON_SIZE, STROKE } from '../design-system/icons';
import { isPolygonTool, type EditTool } from './useMissionEditor';

interface EditToolbarProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    tool: EditTool;
    draftCount: number;
    selectedCount: number;
    canUndo: boolean;
    canRedo: boolean;
    onSelectZone: () => void;
    onSelectPolygon: () => void;
    onDrawLine: () => void;
    onDrawPolygon: () => void;
    onFillParcel: () => void;
    onWorkingZone: () => void;
    onDeleteZone: () => void;
    onConnectTurns: () => void;
    onOffset: () => void;
    onRuler: () => void;
    onEditSpeed: () => void;
    onFinish: () => void;
    onFinishWorkingZone: (value: 0 | 1) => void;
    onReverseSelected: () => void;
    onDeleteSelected: () => void;
    onUndo: () => void;
    onRedo: () => void;
}

export function EditToolbar({
    t,
    tool,
    draftCount,
    selectedCount,
    canUndo,
    canRedo,
    onSelectZone,
    onSelectPolygon,
    onDrawLine,
    onDrawPolygon,
    onFillParcel,
    onWorkingZone,
    onDeleteZone,
    onConnectTurns,
    onOffset,
    onRuler,
    onEditSpeed,
    onFinish,
    onFinishWorkingZone,
    onReverseSelected,
    onDeleteSelected,
    onUndo,
    onRedo,
}: EditToolbarProps): ReactElement {
    const drawing = tool !== 'none';
    const polygon = isPolygonTool(tool);
    const canFinish = polygon ? draftCount >= 3 : draftCount >= 2;
    const showFinishCheck =
        drawing && tool !== 'edit_working_zone' && tool !== 'ruler' && tool !== 'select_zone';
    const finishLabel =
        tool === 'draw_polygon'
            ? t('tool.finishPolygon')
            : tool === 'draw_parcel'
              ? t('tool.finishFillParcel')
              : tool === 'delete_points_zone'
                ? t('tool.finishDeleteZone')
                : tool === 'select_sections_polygon'
                  ? t('tool.finishSelectPolygon')
                  : t('tool.finishLine');
    const showSelectionActions = selectedCount > 0;
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
                <Spline size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
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
                label={t('tool.workingZone')}
                aria-pressed={tool === 'edit_working_zone'}
                className={tool === 'edit_working_zone' ? 'is-active' : undefined}
                data-tool="edit_working_zone"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onWorkingZone}
            >
                <Sprout size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            <IconButton
                label={t('tool.deleteZone')}
                aria-pressed={tool === 'delete_points_zone'}
                className={tool === 'delete_points_zone' ? 'is-active' : undefined}
                data-tool="delete_points_zone"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onDeleteZone}
            >
                <Scissors size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            <IconButton
                label={t('tool.offset')}
                data-tool="offset"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onOffset}
            >
                <MoveHorizontal size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            <IconButton
                label={t('tool.connectTurns')}
                data-tool="connect_turns"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onConnectTurns}
            >
                <CornerDownLeft size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
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
            <IconButton
                label={t('tool.editSpeed')}
                data-tool="edit_speed"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onEditSpeed}
            >
                <Gauge size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            {drawing && tool === 'edit_working_zone' ? (
                <>
                    <IconButton
                        label={t('tool.finishWorkingZoneWork')}
                        disabled={!canFinish}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onFinishWorkingZone(1)}
                    >
                        <Check size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                        label={t('tool.finishWorkingZoneTransit')}
                        disabled={!canFinish}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onFinishWorkingZone(0)}
                    >
                        <CircleDashed
                            size={ICON_SIZE.button}
                            strokeWidth={STROKE}
                            aria-hidden="true"
                        />
                    </IconButton>
                </>
            ) : null}
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
            {showSelectionActions ? (
                <>
                    <IconButton
                        label={t('tool.reverseSelected')}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={onReverseSelected}
                    >
                        <FlipHorizontal2
                            size={ICON_SIZE.button}
                            strokeWidth={STROKE}
                            aria-hidden="true"
                        />
                    </IconButton>
                    <IconButton
                        label={t('tool.deleteSelected')}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={onDeleteSelected}
                    >
                        <Trash2 size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
                    </IconButton>
                </>
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
        </div>
    );
}
