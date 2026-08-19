/**
 * Controller for managing the user interface based on backend configuration
 * The frontend does not know permissions, only the UI config
 */

class UIController {
    constructor() {
        this.uiConfig = null;
        this.initialized = false;
        this.isLoading = false; // Flag to avoid multiple simultaneous calls
        this.authStateListenerRegistered = false; // Flag to avoid registering multiple listeners
    }

    /**
     * Initialize the UI controller
     * Loads configuration from the backend
     */
    async init() {
        // Avoid multiple simultaneous calls
        if (this.isLoading) {
            console.log('[UIController] Initialization already in progress, waiting...');
            return;
        }

        this.isLoading = true;

        try {
            // Wait for authManager to be initialized
            if (window.authManager && !window.authManager.isInitialized) {
                while (!window.authManager.isInitialized) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            // If we are on /app, the HTML has already been generated server-side with the permissions
            // and the full config is injected into window.TRAJECTORY_EDITOR_UI_CONFIG.
            if (window.location.pathname === '/app') {
                this.uiConfig = window.TRAJECTORY_EDITOR_UI_CONFIG || {
                    ui: {
                        showCloudButtons: false,
                        showAdvancedFeatures: false,
                        allowedFileTypes: ['draft'],
                        userLevel: 0
                    }
                };
                this.applyUIConfig();
                this.initialized = true;
                this._registerPluginButtonPermissionRefresh();
                return;
            }
            
            // If we are not on /app, use a default config
            this.uiConfig = {
                ui: {
                    showCloudButtons: false,
                    showAdvancedFeatures: false,
                    allowedFileTypes: ['draft'],
                    userLevel: 0
                }
            };
            this.applyUIConfig();
            this.initialized = true;
            
            // Listen to authentication state changes to reload the config
            // Only register once to avoid loops
            if (window.authManager && !this.authStateListenerRegistered) {
                this.authStateListenerRegistered = true;
                window.authManager.onAuthStateChange(async () => {
                    // Wait a bit to avoid too rapid calls
                    await new Promise(resolve => setTimeout(resolve, 500));
                    // Reload config when authentication state changes
                    if (!this.isLoading) {
                        await this.refresh();
                    }
                });
            }
        } catch (error) {
            console.error('[UIController] Error loading UI config:', error);
            // Use a default config in case of error
            this.uiConfig = {
                ui: {
                    showCloudButtons: false,
                    showAdvancedFeatures: false,
                    allowedFileTypes: ['draft'],
                    userLevel: 0
                }
            };
            this.applyUIConfig();
            this.initialized = true;
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Refresh the UI configuration
     * Since HTML is generated server-side, refreshing means reloading the page
     */
    async refresh() {
        if (window.location.pathname === '/app') {
            // Reload the page to get the new HTML with up-to-date permissions
            window.location.reload();
        } else {
            // If not on /app, re-initialize
            this.initialized = false;
            await this.init();
        }
    }

    /**
     * Apply the UI configuration to the interface
     */
    applyUIConfig() {
        if (!this.uiConfig || !this.uiConfig.ui) {
            return;
        }

        const config = this.uiConfig.ui;

        // Show/hide cloud buttons
        this._toggleCloudButtons(config.showCloudButtons);

        // Filter allowed file types
        this._filterFileTypes(config.allowedFileTypes);

        // Emit an event to notify other modules
        window.eventBus.emit('ui:config:updated', config);
    }

    /**
     * Show/hide cloud buttons
     * @param {boolean} show - If true, show the buttons
     */
    _toggleCloudButtons(show) {
        // Plugins explicitly declare the IDs of buttons that depend on permissions.
        const pluginButtonIds = (window.custom_plugins ? window.custom_plugins.getExtraButtons() : [])
            .filter(btn => btn.requiresPermission === 'showCloudButtons')
            .map(btn => btn.id);

        const cloudButtons = pluginButtonIds
            .map(id => document.getElementById(id))
            .filter(btn => btn !== null);

        cloudButtons.forEach(btn => {
            if (show) {
                btn.style.display = '';
            } else {
                btn.style.display = 'none';
            }
        });
    }

    /**
     * Reapply permissions when a plugin adds its buttons after UI initialization.
     */
    _registerPluginButtonPermissionRefresh() {
        if (!window.custom_plugins || this.pluginButtonListenerRegistered) {
            return;
        }
        this.pluginButtonListenerRegistered = true;
        window.custom_plugins.on('ui:extra-button-registered', () => {
            this.applyUIConfig();
        });
    }


    /**
     * Filter allowed file types
     * @param {Array<string>} allowedTypes - Allowed file types
     */
    _filterFileTypes(allowedTypes) {
        const fileTypeSelect = document.getElementById('fileType');
        if (!fileTypeSelect) return;

        // Disable disallowed options
        Array.from(fileTypeSelect.options).forEach(option => {
            if (allowedTypes.includes(option.value)) {
                option.disabled = false;
            } else {
                option.disabled = true;
            }
        });

        // If the current type is not allowed, change to the first allowed
        if (!allowedTypes.includes(fileTypeSelect.value)) {
            fileTypeSelect.value = allowedTypes[0] || 'draft';
        }
    }

    /**
     * Check whether a feature is available
     * @param {string} feature - Feature name
     * @returns {boolean} True if available
     */
    isFeatureAvailable(feature) {
        if (!this.uiConfig || !this.uiConfig.ui) {
            return false;
        }

        const config = this.uiConfig.ui;

        switch (feature) {
            case 'cloud':
                return config.showCloudButtons === true;
            case 'advanced':
                return config.showAdvancedFeatures === true;
            default:
                return false;
        }
    }

    /**
     * Get the user level
     * @returns {number} User level
     */
    getUserLevel() {
        if (!this.uiConfig || !this.uiConfig.ui) {
            return 0;
        }
        return this.uiConfig.ui.userLevel || 0;
    }
}

// Export the class and create a global instance
window.UIController = UIController;
window.uiController = new UIController();
