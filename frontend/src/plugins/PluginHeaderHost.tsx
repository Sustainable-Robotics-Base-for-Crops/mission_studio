import { useLayoutEffect, useRef, type ReactElement } from 'react';

const ANCHOR_ID = 'pluginHeaderActions';

/**
 * Relocates the Jinja/plugin DOM anchor into the React app bar without
 * destroying the node, so private plugins that already injected buttons keep
 * their event listeners.
 */
export function PluginHeaderHost(): ReactElement {
    const hostRef = useRef<HTMLSpanElement>(null);

    useLayoutEffect(() => {
        const host = hostRef.current;
        const anchor = document.getElementById(ANCHOR_ID);
        if (!host || !anchor || anchor.parentElement === host) {
            return;
        }
        host.appendChild(anchor);
    }, []);

    return <span ref={hostRef} className="plugin-header-host" />;
}
