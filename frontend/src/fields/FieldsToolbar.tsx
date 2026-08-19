import { Check, MapPin, MousePointer2, Pentagon, Spline, X } from 'lucide-react';
import type { ReactElement } from 'react';

import { IconButton } from '../design-system/Button';
import { ICON_SIZE, STROKE } from '../design-system/icons';
import type { FieldsDrawKind } from './draw-target';
import type { FieldsTool } from './useFieldCatalogue';

export function FieldsToolbar({
    t,
    tool,
    drawKind,
    draftCount,
    showDraw = true,
    onSelect,
    onDraw,
    onFinish,
    onCancel,
}: {
    t: (key: string, params?: Record<string, string | number>) => string;
    tool: FieldsTool;
    drawKind: FieldsDrawKind;
    draftCount: number;
    showDraw?: boolean;
    onSelect: () => void;
    onDraw: () => void;
    onFinish: () => void;
    onCancel: () => void;
}): ReactElement {
    const drawing = tool === 'draw_polygon' || tool === 'draw_line' || tool === 'draw_point';
    const canFinish =
        drawing &&
        (drawKind === 'point'
            ? draftCount >= 1
            : drawKind === 'line'
              ? draftCount >= 2
              : draftCount >= 3);
    const DrawIcon = drawKind === 'point' ? MapPin : drawKind === 'line' ? Spline : Pentagon;
    const drawLabel =
        drawKind === 'point'
            ? t('fields.tool.point')
            : drawKind === 'line'
              ? t('fields.tool.line')
              : t('fields.tool.polygon');
    const finishLabel =
        drawKind === 'point'
            ? t('fields.tool.finishPoint')
            : drawKind === 'line'
              ? t('fields.tool.finishLine')
              : t('fields.tool.finish');
    return (
        <div
            className="studio-map-tools"
            role="toolbar"
            aria-label={t('fields.toolbar')}
            data-fields-toolbar="true"
            onWheel={(event) => event.stopPropagation()}
        >
            <IconButton
                label={t('fields.tool.select')}
                aria-pressed={tool === 'select'}
                className={tool === 'select' ? 'is-active' : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onSelect}
            >
                <MousePointer2 size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            </IconButton>
            {showDraw ? (
                <IconButton
                    label={drawLabel}
                    aria-pressed={drawing}
                    className={drawing ? 'is-active' : undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onDraw}
                >
                    <DrawIcon size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
                </IconButton>
            ) : null}
            {drawing ? (
                <IconButton
                    label={finishLabel}
                    disabled={!canFinish}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onFinish}
                >
                    <Check size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
                </IconButton>
            ) : null}
            {drawing ? (
                <IconButton
                    label={t('fields.tool.cancel')}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onCancel}
                >
                    <X size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
                </IconButton>
            ) : null}
        </div>
    );
}
