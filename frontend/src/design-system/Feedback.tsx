import type { ReactElement, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { ICON_SIZE, STROKE } from './icons';

type ChipTone = 'neutral' | 'valid' | 'warning' | 'danger' | 'info';
type BannerTone = 'warning' | 'danger' | 'info';

interface ChipProps {
    tone?: ChipTone;
    icon: LucideIcon;
    children: ReactNode;
}

/** Status chip: icon + label are mandatory — colour is never the only signal. */
export function Chip({ tone = 'neutral', icon: Icon, children }: ChipProps): ReactElement {
    const toneClass = tone === 'neutral' ? '' : `ds-chip-${tone}`;
    return (
        <span className={['ds-chip', toneClass].filter(Boolean).join(' ')}>
            <Icon size={ICON_SIZE.table} strokeWidth={STROKE} aria-hidden="true" />
            {children}
        </span>
    );
}

interface BannerProps {
    tone?: BannerTone;
    icon: LucideIcon;
    children: ReactNode;
    className?: string;
}

export function Banner({
    tone = 'warning',
    icon: Icon,
    children,
    className,
}: BannerProps): ReactElement {
    return (
        <div
            className={['ds-banner', `ds-banner-${tone}`, className].filter(Boolean).join(' ')}
            role="status"
        >
            <Icon size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
            <div>{children}</div>
        </div>
    );
}
