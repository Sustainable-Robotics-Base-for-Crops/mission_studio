import type { ReactElement } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw, RotateCw } from 'lucide-react';

import { Button, IconButton } from '../design-system/Button';
import { Input, Select } from '../design-system/Field';
import { ICON_SIZE, STROKE } from '../design-system/icons';
import { AdvancedModeLink } from '../app/AdvancedModeLink';
import { isAdvancedUi, type UiMode } from '../app/farm-api';

export type DuplicateSide = 'left' | 'right';
export type ExtendDirection = 'start' | 'end';

interface SectionEditPanelProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    uiMode?: UiMode;
    selectedCount: number;
    moveStep: string;
    onMoveStep: (value: string) => void;
    onMove: (direction: 'n' | 's' | 'e' | 'w') => void;
    rotationStep: string;
    onRotationStep: (value: string) => void;
    onRotate: (sign: 1 | -1) => void;
    duplicateCount: string;
    onDuplicateCount: (value: string) => void;
    duplicateDistance: string;
    onDuplicateDistance: (value: string) => void;
    duplicateSide: DuplicateSide;
    onDuplicateSide: (value: DuplicateSide) => void;
    onDuplicate: () => void;
    extendDirection: ExtendDirection | null;
    onStartExtend: (direction: ExtendDirection) => void;
    onCancelExtend: () => void;
    locked?: boolean;
}

export function SectionEditPanel({
    t,
    uiMode,
    selectedCount,
    moveStep,
    onMoveStep,
    onMove,
    rotationStep,
    onRotationStep,
    onRotate,
    duplicateCount,
    onDuplicateCount,
    duplicateDistance,
    onDuplicateDistance,
    duplicateSide,
    onDuplicateSide,
    onDuplicate,
    extendDirection,
    onStartExtend,
    onCancelExtend,
    locked = false,
}: SectionEditPanelProps): ReactElement {
    const canExtend = selectedCount === 1 && !locked;
    const advanced = isAdvancedUi(uiMode);

    return (
        <>
            <fieldset className="studio-section-edit" disabled={locked}>
                <section className="studio-section-edit-block">
                    <h3>{t('inspector.edit.move')}</h3>
                    <Input
                        id="studio-move-step"
                        label={t('inspector.edit.moveStep')}
                        unit="m"
                        type="number"
                        min={0.01}
                        max={10}
                        step={0.01}
                        value={moveStep}
                        onChange={(event) => onMoveStep(event.target.value)}
                    />
                    <div
                        className="studio-move-pad"
                        role="group"
                        aria-label={t('inspector.edit.move')}
                    >
                        <span />
                        <IconButton label={t('inspector.edit.north')} onClick={() => onMove('n')}>
                            <ArrowUp
                                size={ICON_SIZE.button}
                                strokeWidth={STROKE}
                                aria-hidden="true"
                            />
                        </IconButton>
                        <span />
                        <IconButton label={t('inspector.edit.west')} onClick={() => onMove('w')}>
                            <ArrowLeft
                                size={ICON_SIZE.button}
                                strokeWidth={STROKE}
                                aria-hidden="true"
                            />
                        </IconButton>
                        <span className="studio-move-pad-value">{moveStep} m</span>
                        <IconButton label={t('inspector.edit.east')} onClick={() => onMove('e')}>
                            <ArrowRight
                                size={ICON_SIZE.button}
                                strokeWidth={STROKE}
                                aria-hidden="true"
                            />
                        </IconButton>
                        <span />
                        <IconButton label={t('inspector.edit.south')} onClick={() => onMove('s')}>
                            <ArrowDown
                                size={ICON_SIZE.button}
                                strokeWidth={STROKE}
                                aria-hidden="true"
                            />
                        </IconButton>
                        <span />
                    </div>
                </section>

                {advanced ? (
                    <>
                        <section className="studio-section-edit-block">
                            <h3>{t('inspector.edit.rotate')}</h3>
                            <Input
                                id="studio-rotation-step"
                                label={t('inspector.edit.rotationStep')}
                                unit="°"
                                type="number"
                                min={1}
                                max={90}
                                step={1}
                                value={rotationStep}
                                onChange={(event) => onRotationStep(event.target.value)}
                            />
                            <div className="studio-rotate-row">
                                <IconButton
                                    label={t('inspector.edit.rotateCcw')}
                                    onClick={() => onRotate(1)}
                                >
                                    <RotateCcw
                                        size={ICON_SIZE.button}
                                        strokeWidth={STROKE}
                                        aria-hidden="true"
                                    />
                                </IconButton>
                                <span className="studio-move-pad-value">{rotationStep}°</span>
                                <IconButton
                                    label={t('inspector.edit.rotateCw')}
                                    onClick={() => onRotate(-1)}
                                >
                                    <RotateCw
                                        size={ICON_SIZE.button}
                                        strokeWidth={STROKE}
                                        aria-hidden="true"
                                    />
                                </IconButton>
                            </div>
                        </section>

                        <section className="studio-section-edit-block">
                            <h3>{t('inspector.edit.duplicate')}</h3>
                            <Input
                                id="studio-duplicate-count"
                                label={t('inspector.edit.duplicateCount')}
                                type="number"
                                min={1}
                                max={100}
                                step={1}
                                value={duplicateCount}
                                onChange={(event) => onDuplicateCount(event.target.value)}
                            />
                            <Input
                                id="studio-duplicate-distance"
                                label={t('inspector.edit.duplicateDistance')}
                                unit="m"
                                type="number"
                                min={0.01}
                                max={100}
                                step={0.01}
                                value={duplicateDistance}
                                onChange={(event) => onDuplicateDistance(event.target.value)}
                            />
                            <Select
                                id="studio-duplicate-side"
                                label={t('inspector.edit.duplicateSide')}
                                value={duplicateSide}
                                onValueChange={(value) => onDuplicateSide(value as DuplicateSide)}
                                options={[
                                    { value: 'left', label: t('inspector.edit.duplicateLeft') },
                                    { value: 'right', label: t('inspector.edit.duplicateRight') },
                                ]}
                            />
                            <Button type="button" variant="primary" onClick={onDuplicate}>
                                {t('inspector.edit.duplicateBtn')}
                            </Button>
                        </section>

                        <section className="studio-section-edit-block">
                            <h3>{t('inspector.edit.extend')}</h3>
                            {canExtend ? (
                                <p className="studio-section-edit-hint">
                                    {t('inspector.edit.extendHint')}
                                </p>
                            ) : (
                                <p className="studio-section-edit-hint">
                                    {t('inspector.edit.extendNeedOne')}
                                </p>
                            )}
                            <div className="studio-extend-row">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    aria-pressed={extendDirection === 'start'}
                                    className={
                                        extendDirection === 'start' ? 'is-active' : undefined
                                    }
                                    disabled={!canExtend}
                                    onClick={() => onStartExtend('start')}
                                >
                                    {t('inspector.edit.extendStart')}
                                </Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    aria-pressed={extendDirection === 'end'}
                                    className={extendDirection === 'end' ? 'is-active' : undefined}
                                    disabled={!canExtend}
                                    onClick={() => onStartExtend('end')}
                                >
                                    {t('inspector.edit.extendEnd')}
                                </Button>
                            </div>
                            {extendDirection ? (
                                <Button type="button" variant="ghost" onClick={onCancelExtend}>
                                    {t('inspector.edit.extendCancel')}
                                </Button>
                            ) : null}
                        </section>
                    </>
                ) : null}
            </fieldset>
            {advanced ? null : <AdvancedModeLink t={t} />}
        </>
    );
}
