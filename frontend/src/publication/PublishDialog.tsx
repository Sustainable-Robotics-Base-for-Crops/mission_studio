import { useState, type ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { Input } from '../design-system/Field';
import { Dialog } from '../design-system/Overlay';
import type { AgriDocument } from '../domain/agri';
import { PUBLISH_IMMUTABLE, defaultExpiryIso, type SimAttestation } from '../domain/publication';

interface PublishDialogProps {
    open: boolean;
    document: AgriDocument | null;
    sourcePath: string | null;
    nextVersion: number;
    simulation: SimAttestation | null;
    onOpenChange: (open: boolean) => void;
    onConfirm: (input: { approver: string; expires_at: string }) => Promise<void>;
    t: (key: string, params?: Record<string, string | number>) => string;
}

export function PublishDialog({
    open,
    document,
    sourcePath,
    nextVersion,
    simulation,
    onOpenChange,
    onConfirm,
    t,
}: PublishDialogProps): ReactElement {
    const [approver, setApprover] = useState('local');
    const [expires, setExpires] = useState(defaultExpiryIso);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={t('pub.dialogTitle', { version: nextVersion })}
            className="studio-publish-dialog"
        >
            <p className="studio-muted">{t('pub.dialogHint')}</p>
            <p className="studio-muted">
                {sourcePath ?? t('pub.noPath')} · {document?.points.length ?? 0} {t('pub.sections')}
            </p>
            {simulation ? (
                <p className="studio-muted">
                    {t('pub.simSummary', {
                        pass: simulation.passCount,
                        warn: simulation.warnCount,
                        length: Math.round(simulation.length_m),
                    })}
                </p>
            ) : null}
            <h3>{t('pub.immutableTitle')}</h3>
            <ul className="studio-publish-immutable">
                {PUBLISH_IMMUTABLE.map((item) => (
                    <li key={item}>{t(`pub.immutable.${item}`)}</li>
                ))}
            </ul>
            <Input
                id="pub-approver"
                label={t('pub.approver')}
                help={t('pub.help.approver')}
                value={approver}
                onChange={(event) => setApprover(event.target.value)}
            />
            <Input
                id="pub-expires"
                label={t('pub.expires')}
                help={t('pub.help.expires')}
                type="date"
                value={expires}
                onChange={(event) => setExpires(event.target.value)}
            />
            {error ? <p className="studio-muted">{error}</p> : null}
            <div className="studio-publish-actions">
                <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                    {t('pub.cancel')}
                </Button>
                <Button
                    type="button"
                    variant="primary"
                    disabled={busy || !document || !simulation}
                    onClick={() => {
                        setBusy(true);
                        setError(null);
                        void onConfirm({
                            approver: approver.trim() || 'local',
                            expires_at: expires,
                        })
                            .catch((reason: unknown) => {
                                setError(
                                    reason instanceof Error ? reason.message : t('pub.error.save'),
                                );
                            })
                            .finally(() => {
                                setBusy(false);
                            });
                    }}
                >
                    {t('pub.confirm', { version: nextVersion })}
                </Button>
            </div>
        </Dialog>
    );
}
