import type { FormEvent, ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { Input } from '../design-system/Field';
import { Dialog } from '../design-system/Overlay';

interface SpeedDialogProps {
    open: boolean;
    speed: string;
    onSpeed: (value: string) => void;
    onOpenChange: (open: boolean) => void;
    onConfirm: (speed: number) => void;
    t: (key: string, params?: Record<string, string | number>) => string;
}

export const SPEED_MIN_MS = 0;
export const SPEED_MAX_MS = 50;

export function SpeedDialog({
    open,
    speed,
    onSpeed,
    onOpenChange,
    onConfirm,
    t,
}: SpeedDialogProps): ReactElement {
    const parsed = Number(speed);
    const valid = Number.isFinite(parsed) && parsed >= SPEED_MIN_MS && parsed <= SPEED_MAX_MS;
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (valid) {
            onConfirm(parsed);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title={t('tool.editSpeed')}>
            <form className="studio-fill-dialog" onSubmit={submit}>
                <h2 className="studio-fill-dialog-title">{t('tool.editSpeed')}</h2>
                <p className="studio-fill-dialog-hint">{t('tool.editSpeedHint')}</p>
                <Input
                    id="studio-speed"
                    label={t('tool.rowSpeed')}
                    unit="m/s"
                    source={t('tool.editSpeedSource')}
                    type="number"
                    step="0.1"
                    min={SPEED_MIN_MS}
                    max={SPEED_MAX_MS}
                    value={speed}
                    onChange={(event) => onSpeed(event.target.value)}
                    error={valid ? undefined : t('tool.speedInvalid')}
                />
                <div className="studio-fill-dialog-actions">
                    <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                        {t('ds.ghost')}
                    </Button>
                    <Button type="submit" variant="primary" disabled={!valid}>
                        {t('tool.editSpeedConfirm')}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}
