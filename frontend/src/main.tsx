import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import '@fontsource-variable/inter';
import './design-system/tokens.css';
import './design-system/primitives.css';
import './styles/shell.css';

import { AppShell } from './app/AppShell';
import { StudioProviders } from './design-system/Providers';
import { restoreLastFarm } from './farmstore/session';
import { ensureNativeBridges } from './native/bridges';
import { ensurePluginShim } from './plugins/shim';

ensurePluginShim();
ensureNativeBridges();

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Mission Studio mount point #root is missing');
}
const mountPoint = rootElement;

// Every module reads the open farm on mount: reopen the previous one before rendering.
void restoreLastFarm().finally(() => {
    createRoot(mountPoint).render(
        <StrictMode>
            <StudioProviders>
                <BrowserRouter basename="/studio">
                    <AppShell />
                </BrowserRouter>
            </StudioProviders>
        </StrictMode>,
    );
});
