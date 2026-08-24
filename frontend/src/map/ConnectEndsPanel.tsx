import type { ReactElement } from 'react';

import { Button } from '../design-system/Button';
import type { EndConnectionKind } from '../domain/connect-ends';

interface ConnectEndsPanelProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    picked: number;
    kind: EndConnectionKind | null;
    waypointCount: number;
    onKind: (kind: EndConnectionKind) => void;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConnectEndsPanel({
    t,
    picked,
    kind,
    waypointCount,
    onKind,
    onConfirm,
    onCancel,
}: ConnectEndsPanelProps): ReactElement {
    const turnOpen = kind === 'u_turn' || kind === 'square';
    return (
        <section className="studio-connect-ends" aria-label={t('connect.panel')}>
            <p className="studio-muted">
                {picked < 2 ? t('connect.pickHint', { count: picked }) : t('connect.kindHint')}
            </p>
            {picked >= 2 ? (
                <>
                    <div className="studio-zone-modes">
                        <Button
                            type="button"
                            variant={turnOpen ? 'primary' : 'secondary'}
                            onClick={() => onKind(kind === 'square' ? 'square' : 'u_turn')}
                        >
                            {t('connect.kind.turn')}
                        </Button>
                        <Button
                            type="button"
                            variant={kind === 'direct' ? 'primary' : 'secondary'}
                            onClick={() => onKind('direct')}
                        >
                            {t('connect.kind.direct')}
                        </Button>
                        <Button
                            type="button"
                            variant={kind === 'free' ? 'primary' : 'secondary'}
                            onClick={() => onKind('free')}
                        >
                            {t('connect.kind.free')}
                        </Button>
                    </div>
                    {turnOpen ? (
                        <div className="studio-zone-modes">
                            <Button
                                type="button"
                                variant={kind === 'u_turn' ? 'primary' : 'secondary'}
                                onClick={() => onKind('u_turn')}
                            >
                                {t('connect.kind.uTurn')}
                            </Button>
                            <Button
                                type="button"
                                variant={kind === 'square' ? 'primary' : 'secondary'}
                                onClick={() => onKind('square')}
                            >
                                {t('connect.kind.square')}
                            </Button>
                        </div>
                    ) : null}
                </>
            ) : null}
            {kind === 'free' ? (
                <p className="studio-muted">{t('connect.freeHint', { count: waypointCount })}</p>
            ) : null}
            <div className="studio-publish-actions">
                <Button type="button" variant="secondary" onClick={onCancel}>
                    {t('pub.cancel')}
                </Button>
                <Button
                    type="button"
                    variant="primary"
                    disabled={picked < 2 || !kind}
                    onClick={onConfirm}
                >
                    {t('connect.confirm')}
                </Button>
            </div>
        </section>
    );
}
