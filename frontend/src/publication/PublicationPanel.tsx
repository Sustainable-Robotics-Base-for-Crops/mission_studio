import type { ReactElement } from 'react';
import { Send } from 'lucide-react';

import { Chip } from '../design-system/Feedback';
import type { PublicationRecord } from './api';
import type { usePublications } from './usePublications';

type Catalogue = ReturnType<typeof usePublications>;

export function PublicationPanel({
    t,
    catalogue,
    overlay = false,
}: {
    t: (key: string, params?: Record<string, string | number>) => string;
    catalogue: Catalogue;
    overlay?: boolean;
}): ReactElement {
    const inspectorClass = overlay ? 'studio-context is-overlay' : 'studio-context';
    return (
        <aside className={inspectorClass} aria-label={t('nav.publication')}>
            <header className="studio-panel-header">
                <h2>{t('nav.publication')}</h2>
            </header>
            <p className="studio-muted">{t('pub.panelHint')}</p>
            {!catalogue.available ? (
                <p className="studio-muted">{t('pub.unavailable')}</p>
            ) : catalogue.items.length === 0 ? (
                <p className="studio-muted">{t('pub.empty')}</p>
            ) : (
                <ul className="studio-publish-list">
                    {catalogue.items.map((item) => (
                        <li key={item.id}>
                            <PublicationCard t={t} item={item} />
                        </li>
                    ))}
                </ul>
            )}
            {catalogue.error ? <p className="studio-muted">{catalogue.error}</p> : null}
        </aside>
    );
}

function PublicationCard({
    t,
    item,
}: {
    t: (key: string, params?: Record<string, string | number>) => string;
    item: PublicationRecord;
}): ReactElement {
    return (
        <article className="studio-publish-card">
            <header>
                <Chip tone={item.status === 'published' ? 'valid' : 'neutral'} icon={Send}>
                    {t('pub.version', { version: item.version })} · {t(`pub.status.${item.status}`)}
                </Chip>
            </header>
            <p>{item.source_path}</p>
            <p className="studio-muted">
                {t('pub.checksum')} {item.checksum.slice(0, 12)}… · {item.byte_size} o
            </p>
            <p className="studio-muted">
                {t('pub.approver')}: {item.approver}
                {item.expires_at ? ` · ${t('pub.expires')}: ${item.expires_at}` : ''}
            </p>
            <p className="studio-muted">{t('pub.mobileHint')}</p>
            <dl className="studio-publish-mobile">
                {(
                    [
                        'synced_at',
                        'downloaded_at',
                        'received_at',
                        'preflight_at',
                        'activated_at',
                    ] as const
                ).map((key) => (
                    <div key={key}>
                        <dt>{t(`pub.mobile.${key}`)}</dt>
                        <dd>{item.mobile[key] ?? '—'}</dd>
                    </div>
                ))}
            </dl>
        </article>
    );
}
