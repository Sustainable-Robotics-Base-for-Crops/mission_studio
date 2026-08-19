import type { ReactElement, ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as ToastPrimitive from '@radix-ui/react-toast';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { CONTROL } from './tokens';

export function TooltipProvider({ children }: { children: ReactNode }): ReactElement {
    return (
        <TooltipPrimitive.Provider delayDuration={CONTROL.tooltipDelayMs}>
            {children}
        </TooltipPrimitive.Provider>
    );
}

export function Tooltip({
    content,
    children,
    side = 'top',
}: {
    content: string;
    children: ReactElement;
    side?: 'top' | 'right' | 'bottom' | 'left';
}): ReactElement {
    return (
        <TooltipPrimitive.Root>
            <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
            <TooltipPrimitive.Portal>
                <TooltipPrimitive.Content
                    className="ds-tooltip"
                    side={side}
                    sideOffset={8}
                    avoidCollisions={side !== 'right'}
                >
                    {content}
                </TooltipPrimitive.Content>
            </TooltipPrimitive.Portal>
        </TooltipPrimitive.Root>
    );
}

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
    return (
        <ToastPrimitive.Provider duration={CONTROL.toastMs} swipeDirection="right">
            {children}
            <ToastPrimitive.Viewport className="ds-toast-viewport" />
        </ToastPrimitive.Provider>
    );
}

export function Toast({
    open,
    onOpenChange,
    title,
    description,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
}): ReactElement {
    return (
        <ToastPrimitive.Root className="ds-toast" open={open} onOpenChange={onOpenChange}>
            <ToastPrimitive.Title>{title}</ToastPrimitive.Title>
            {description ? (
                <ToastPrimitive.Description>{description}</ToastPrimitive.Description>
            ) : null}
        </ToastPrimitive.Root>
    );
}

export function Dialog({
    open,
    onOpenChange,
    title,
    children,
    className,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    children: ReactNode;
    className?: string;
}): ReactElement {
    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="ds-dialog-overlay" />
                <DialogPrimitive.Content
                    className={['ds-dialog', className].filter(Boolean).join(' ')}
                    aria-describedby={undefined}
                >
                    <DialogPrimitive.Title className="visually-hidden">
                        {title}
                    </DialogPrimitive.Title>
                    {children}
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

export function Popover({
    trigger,
    children,
    label,
}: {
    trigger: ReactElement;
    children: ReactNode;
    label: string;
}): ReactElement {
    return (
        <PopoverPrimitive.Root>
            <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
            <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                    className="ds-popover"
                    sideOffset={8}
                    align="end"
                    aria-label={label}
                >
                    {children}
                </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
    );
}
