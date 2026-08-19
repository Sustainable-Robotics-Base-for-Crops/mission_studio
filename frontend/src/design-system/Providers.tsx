import type { ReactElement, ReactNode } from 'react';

import { ToastProvider, TooltipProvider } from './Overlay';

export function StudioProviders({ children }: { children: ReactNode }): ReactElement {
    return (
        <TooltipProvider>
            <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
    );
}
