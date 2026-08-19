/**
 * Runtime registry for frontend plugins.
 * This file is loaded before the rest to provide fallback implementations.
 */
(function initcustom_plugins(global) {
    class NoOpAuthManager {
        constructor() {
            // Even without a private plugin, the public app should work in anonymous mode.
            this.isInitialized = true;
        }

        async isAuthenticated() {
            return true;
        }

        async getAuthHeaders() {
            return { "Content-Type": "application/json" };
        }

        async logout() {
            // In anonymous OSS mode, logout = screen refresh.
            return true;
        }
    }

    const registry = {
        authManager: new NoOpAuthManager(),
        cloudStorages: {},
        extraButtons: [],
        listeners: {},

        registerAuthManager(authImpl) {
            this.authManager = authImpl;
            this.emit("auth:ready", authImpl);
        },

        registerCloudStorage(name, impl) {
            this.cloudStorages[name] = impl;
        },

        registerExtraButton(buttonDef) {
            this.extraButtons.push(buttonDef);
            this.emit("ui:extra-button-registered", buttonDef);
        },

        getExtraButtons() {
            return [...this.extraButtons];
        },

        on(eventName, callback) {
            if (!this.listeners[eventName]) {
                this.listeners[eventName] = [];
            }
            this.listeners[eventName].push(callback);
        },

        emit(eventName, payload) {
            (this.listeners[eventName] || []).forEach((cb) => {
                try {
                    cb(payload);
                } catch (error) {
                    console.error("[custom_plugins] listener error:", error);
                }
            });
        }
    };

    global.custom_plugins = registry;
    // Backward compatibility: old modules expect window.authManager.
    global.authManager = registry.authManager;
})(window);
