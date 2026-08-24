import { useState, type FormEvent, type ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { Dialog } from '../design-system/Overlay';
import type { FreeLinkStyle } from '../domain/connect-ends';

interface ConnectFreeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (style: FreeLinkStyle) => void;
    t: (key: string, params?: Record<string, string | number>) => string;
}

export function ConnectFreeDialog({
    open,
    onOpenChange,
    onConfirm,
    t,
}: ConnectFreeDialogProps): ReactElement {
    const [link, setLink] = useState<FreeLinkStyle>('segments');
    const submit = (event: FormEvent) => {
        event.preventDefault();
        onConfirm(link);
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title={t('connect.freeDialog')}>
            <form className="studio-fill-dialog" onSubmit={submit}>
                <h2 className="studio-fill-dialog-title">{t('connect.freeDialog')}</h2>
                <p className="studio-fill-dialog-hint">{t('connect.freeDialogHint')}</p>
                <div className="studio-zone-modes">
                    <Button
                        type="button"
                        variant={link === 'segments' ? 'primary' : 'secondary'}
                        onClick={() => setLink('segments')}
                    >
                        {t('connect.link.segments')}
                    </Button>
                    <Button
                        type="button"
                        variant={link === 'curve' ? 'primary' : 'secondary'}
                        onClick={() => setLink('curve')}
                    >
                        {t('connect.link.curve')}
                    </Button>
                </div>
                <div className="studio-fill-dialog-actions">
                    <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                        {t('pub.cancel')}
                    </Button>
                    <Button type="submit" variant="primary">
                        {t('connect.confirm')}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}
