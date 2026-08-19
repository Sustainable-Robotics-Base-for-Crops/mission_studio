import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { Dialog } from '../design-system/Overlay';
import type { OddProfile } from '../domain/odd';
import type { FieldSummary } from '../fields/types';
import type { MissionBrief } from '../missions/brief';
import { applyCoverageToFields } from './apply-to-fields';

interface ApplyToFieldsDialogProps {
    open: boolean;
    fields: FieldSummary[];
    currentFieldId: string;
    brief: MissionBrief;
    equipment: Record<string, unknown> | null;
    odd: OddProfile | null;
    vehicleWidthM: number | null;
    geofenceMarginM: number | null;
    skipEveryN: number;
    onOpenChange: (open: boolean) => void;
    t: (key: string, params?: Record<string, string | number>) => string;
}

export function ApplyToFieldsDialog({
    open,
    fields,
    currentFieldId,
    brief,
    equipment,
    odd,
    vehicleWidthM,
    geofenceMarginM,
    skipEveryN,
    onOpenChange,
    t,
}: ApplyToFieldsDialogProps): ReactElement {
    const initial = useMemo(() => (currentFieldId ? [currentFieldId] : []), [currentFieldId]);
    const [selected, setSelected] = useState<string[]>(initial);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setSelected(currentFieldId ? [currentFieldId] : []);
            setStatus(null);
        }
    }, [open, currentFieldId]);

    const toggle = (id: string) => {
        setSelected((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
        );
    };

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={t('pack.applyFields.title')}
            className="studio-pack-dialog"
        >
            <p className="studio-muted">{t('pack.applyFields.hint')}</p>
            <ul className="studio-pack-field-list">
                {fields.map((field) => (
                    <li key={field.id}>
                        <label>
                            <input
                                type="checkbox"
                                checked={selected.includes(field.id)}
                                onChange={() => toggle(field.id)}
                            />
                            <span>{field.name}</span>
                        </label>
                    </li>
                ))}
            </ul>
            {fields.length === 0 ? (
                <p className="studio-muted">{t('pack.applyFields.empty')}</p>
            ) : null}
            {status ? <p className="studio-assist-summary">{status}</p> : null}
            <div className="studio-publish-actions">
                <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                    {t('pack.applyFields.cancel')}
                </Button>
                <Button
                    type="button"
                    variant="primary"
                    disabled={busy || selected.length === 0}
                    onClick={() => {
                        setBusy(true);
                        setStatus(t('pack.applyFields.running', { count: selected.length }));
                        void applyCoverageToFields({
                            fieldIds: selected,
                            fields,
                            brief,
                            equipment,
                            odd,
                            vehicleWidthM,
                            geofenceMarginM,
                            skipEveryN,
                        })
                            .then((result) => {
                                setStatus(
                                    t('pack.applyFields.done', {
                                        saved: result.saved.length,
                                        failed: result.errors.length,
                                    }),
                                );
                            })
                            .finally(() => {
                                setBusy(false);
                            });
                    }}
                >
                    {t('pack.applyFields.confirm')}
                </Button>
            </div>
        </Dialog>
    );
}
