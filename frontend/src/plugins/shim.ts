/**
 * Ensure window.custom_plugins exists even when plugins.js was not loaded
 * (Vite dev without the Jinja shell). Production always loads plugins.js first.
 */
export function ensurePluginShim(): void {
    if (window.custom_plugins) {
        return;
    }
    const listeners: Record<string, Array<(payload: unknown) => void>> = {};
    window.custom_plugins = {
        authManager: { isInitialized: true },
        cloudStorages: {},
        extraButtons: [],
        registerAuthManager(impl: unknown) {
            this.authManager = impl;
            this.emit('auth:ready', impl);
        },
        registerCloudStorage(name: string, impl: unknown) {
            this.cloudStorages[name] = impl;
        },
        registerExtraButton(buttonDef: unknown) {
            this.extraButtons.push(buttonDef);
            this.emit('ui:extra-button-registered', buttonDef);
        },
        getExtraButtons() {
            return [...this.extraButtons];
        },
        on(eventName: string, callback: (payload: unknown) => void) {
            if (!listeners[eventName]) {
                listeners[eventName] = [];
            }
            listeners[eventName].push(callback);
        },
        emit(eventName: string, payload?: unknown) {
            for (const callback of listeners[eventName] ?? []) {
                callback(payload);
            }
        },
    };
}
