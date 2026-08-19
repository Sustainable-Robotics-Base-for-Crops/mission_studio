import { useState, type ChangeEvent, type ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { Dialog } from '../design-system/Overlay';
import type { AgriDocument } from '../domain/agri';
import type { CombinationEnvelope } from '../domain/equipment';
import {
    TEACH_SIMPLIFY_M,
    teachRepeatDocument,
    teachRepeatKinematicOk,
} from '../domain/teach-repeat';

interface TeachRepeatDialogProps {
    open: boolean;
    envelope: CombinationEnvelope | null;
    onOpenChange: (open: boolean) => void;
    onApply: (document: AgriDocument) => void;
    t: (key: string, params?: Record<string, string | number>) => string;
}

export function TeachRepeatDialog({
    open,
    envelope,
    onOpenChange,
    onApply,
    t,
}: TeachRepeatDialogProps): ReactElement {
    const [raw, setRaw] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<AgriDocument | null>(null);
    const [kinematic, setKinematic] = useState<{
        ok: boolean;
        blockCount: number;
        tooTight: boolean;
    } | null>(null);

    const parse = (text: string) => {
        setError(null);
        setPreview(null);
        setKinematic(null);
        const trimmed = text.trim();
        if (!trimmed) {
            return;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed) as unknown;
        } catch {
            setError(t('teach.error.json'));
            return;
        }
        const document = teachRepeatDocument(parsed);
        if (!document) {
            setError(t('teach.error.trace'));
            return;
        }
        setPreview(document);
        setKinematic(teachRepeatKinematicOk(document, envelope));
    };

    const onFile = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const text = typeof reader.result === 'string' ? reader.result : '';
            setRaw(text);
            parse(text);
        };
        reader.readAsText(file);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={t('teach.title')}
            className="studio-pack-dialog"
        >
            <p className="studio-muted">{t('teach.hint', { epsilon: TEACH_SIMPLIFY_M })}</p>
            <label className="ds-label" htmlFor="studio-teach-file">
                {t('teach.file')}
            </label>
            <input
                id="studio-teach-file"
                type="file"
                accept=".json,application/json,.geojson"
                onChange={onFile}
            />
            <label className="ds-label" htmlFor="studio-teach-json">
                {t('teach.json')}
            </label>
            <textarea
                id="studio-teach-json"
                className="studio-teach-json"
                rows={8}
                value={raw}
                onChange={(event) => setRaw(event.target.value)}
                onBlur={() => parse(raw)}
            />
            {error ? (
                <p className="ds-field-error" role="alert">
                    {error}
                </p>
            ) : null}
            {preview ? (
                <p className="studio-assist-summary">
                    {t('teach.preview', {
                        source: Number(
                            (preview.metadata as { srbc_teach_repeat?: { source_points: number } })
                                ?.srbc_teach_repeat?.source_points ??
                                preview.points[0]?.values.length,
                        ),
                        simplified: preview.points[0]?.values.length ?? 0,
                    })}
                </p>
            ) : null}
            {kinematic ? (
                <p className={kinematic.ok ? 'studio-muted' : 'ds-field-error'}>
                    {kinematic.ok
                        ? t('teach.kinematic.ok')
                        : kinematic.tooTight
                          ? t('teach.kinematic.tight')
                          : t('teach.kinematic.block', { count: kinematic.blockCount })}
                </p>
            ) : null}
            <p className="studio-muted">{t('teach.skip.live')}</p>
            <div className="studio-publish-actions">
                <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                    {t('teach.cancel')}
                </Button>
                <Button
                    type="button"
                    variant="primary"
                    disabled={!preview}
                    onClick={() => {
                        if (!preview) {
                            return;
                        }
                        onApply(preview);
                        onOpenChange(false);
                    }}
                >
                    {t('teach.apply')}
                </Button>
            </div>
        </Dialog>
    );
}
