import { useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { ICON_SIZE, STROKE } from './icons';
import { Tooltip } from './Overlay';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    icon?: LucideIcon;
    children: ReactNode;
    /** Destructive: first click arms, second click confirms (CdCF §4.5). */
    confirmLabel?: string;
}

export function Button({
    variant = 'primary',
    icon: Icon,
    children,
    confirmLabel,
    className,
    onClick,
    type = 'button',
    ...rest
}: ButtonProps): ReactElement {
    const [armed, setArmed] = useState(false);
    const destructiveArmed = variant === 'destructive' && armed;
    const classes = ['ds-btn', `ds-btn-${variant}`, className].filter(Boolean).join(' ');

    return (
        <button
            type={type}
            className={classes}
            data-confirm={destructiveArmed ? 'true' : undefined}
            onClick={(event) => {
                if (variant === 'destructive' && confirmLabel && !armed) {
                    event.preventDefault();
                    setArmed(true);
                    window.setTimeout(() => setArmed(false), 4000);
                    return;
                }
                setArmed(false);
                onClick?.(event);
            }}
            {...rest}
        >
            {Icon ? <Icon size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" /> : null}
            {destructiveArmed && confirmLabel ? confirmLabel : children}
        </button>
    );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    label: string;
    tooltip?: string;
    tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
    children: ReactNode;
}

export function IconButton({
    label,
    tooltip,
    tooltipSide = 'right',
    children,
    className,
    type = 'button',
    ...rest
}: IconButtonProps): ReactElement {
    const classes = ['ds-icon-btn', className].filter(Boolean).join(' ');
    return (
        <Tooltip content={tooltip ?? label} side={tooltipSide}>
            <button type={type} className={classes} aria-label={label} {...rest}>
                {children}
            </button>
        </Tooltip>
    );
}
