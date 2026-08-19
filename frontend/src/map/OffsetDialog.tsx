import type { FormEvent, ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { Input } from '../design-system/Field';
import { Dialog } from '../design-system/Overlay';
import type { DuplicateSide } from './SectionEditPanel';

interface OffsetDialogProps {
    open: boolean;
    distance: string;
    side: DuplicateSide;
    onDistance: (value: string) => void;
    onSide: (value: DuplicateSide) => void;
    onOpenChange: (open: boolean) => void;
    onConfirm: (distance: number, side: DuplicateSide) => void;
    t: (key: string, params?: Record<string, string | number>) => string;
}

export function OffsetDialog({
    open,
    distance,
    side,
    onDistance,
    onSide,
    onOpenChange,
    onConfirm,
    t,
}: OffsetDialogProps): ReactElement {
    const parsed = Number(distance);
    const valid = Number.isFinite(parsed) && parsed >= 0.01 && parsed <= 100;
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (valid) {
            onConfirm(parsed, side);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title={t('tool.offset')}>
            <form className="studio-fill-dialog" onSubmit={submit}>
                <h2 className="studio-fill-dialog-title">{t('tool.offset')}</h2>
                <p className="studio-fill-dialog-hint">{t('tool.offsetHint')}</p>
                <Input
                    id="studio-offset-distance"
                    label={t('tool.offsetDistance')}
                    unit="m"
                    type="number"
                    step="0.01"
                    min={0.01}
                    max={100}
                    value={distance}
                    onChange={(event) => onDistance(event.target.value)}
                    error={valid ? undefined : t('tool.offsetInvalid')}
                />
                <div className="ds-field">
                    <span className="ds-label" id="studio-offset-side-label">
                        {t('tool.offsetSide')}
                    </span>
                    <div
                        className="studio-extend-row"
                        role="group"
                        aria-labelledby="studio-offset-side-label"
                    >
                        <Button
                            type="button"
                            variant="secondary"
                            aria-pressed={side === 'left'}
                            className={side === 'left' ? 'is-active' : undefined}
                            onClick={() => onSide('left')}
                        >
                            {t('inspector.edit.duplicateLeft')}
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            aria-pressed={side === 'right'}
                            className={side === 'right' ? 'is-active' : undefined}
                            onClick={() => onSide('right')}
                        >
                            {t('inspector.edit.duplicateRight')}
                        </Button>
                    </div>
                </div>
                <div className="studio-fill-dialog-actions">
                    <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                        {t('ds.ghost')}
                    </Button>
                    <Button type="submit" variant="primary" disabled={!valid}>
                        {t('tool.offsetConfirm')}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}
