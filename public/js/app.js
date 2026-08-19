/**
 * Trajectory editing application
 * Uses only the new modular modules
 */

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    // Wait until all modules are loaded
    while (!window.EventBus || !window.ApiService || !window.NotificationService || 
           !window.GeometryUtils || !window.MapService || !window.MapView || 
           !window.PanelView || !window.TrajectoryController || !window.SectionController ||
           !window.MapController || !window.TrajectoryEditor) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Initialize EventBus
    if (!window.eventBus) {
        window.eventBus = new EventBus();
    }

    // Initialize ApiService
    if (!window.apiService) {
        window.apiService = new ApiService();
    }

    // Initialize NotificationService
    if (!window.notificationService) {
        window.notificationService = new NotificationService();
    }

    // Wait until the auth provider (plugin or fallback) is initialized
    const getAuthManager = () => (window.custom_plugins && window.custom_plugins.authManager) || window.authManager;
    while (!getAuthManager() || !getAuthManager().isInitialized) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    window.authManager = getAuthManager();

    // Wait a bit for authentication to be fully initialized
    // (some plugins check for a cookie/session on the server side)
    await new Promise(resolve => setTimeout(resolve, 500));

    // If we are on /app, the backend has already checked authentication via cookie
    // Don't redirect on the frontend to avoid redirect loops
    // The backend handles HTTP (302) redirects if needed
    if (window.location.pathname === '/app') {
        // Check authentication for the initialization of services, but do not redirect
        const isAuthenticated = await getAuthManager().isAuthenticated();
        
        // If not authenticated on the client side, let the plugin attempt a server-side check.
        if (!isAuthenticated) {
            if (typeof getAuthManager().checkSSOMode === 'function') {
                await getAuthManager().checkSSOMode();
            }
        }

        // Initialize the UIController to load the configuration from the backend
        // The user is now authenticated, or the backend has already redirected
        if (window.uiController) {
            try {
                await window.uiController.init();
            } catch (error) {
                console.error('[App] Error during UIController initialization:', error);
                // Do not redirect on the frontend - the backend handles redirects
                // If a 401 error, the backend should have already redirected
            }
        }
    }

    // Initialize the new trajectory editor
    window.trajectoryEditor = new TrajectoryEditor();

    // Update translations after initialization
    if (window.i18n) {
        // Wait for trajectoryEditor to be initialized
        const updateTranslations = () => {
            if (window.trajectoryEditor && typeof window.trajectoryEditor.updateTranslations === 'function') {
                window.trajectoryEditor.updateTranslations();
            }
        };
        
        // Update initial translations
        updateTranslations();
        
        // Listen for language changes
        window.addEventListener('languageChanged', () => {
            updateTranslations();
        });
    }

    // Listen for EventBus events
    if (window.eventBus) {
        window.eventBus.on('ui:config:updated', (config) => {
            console.log('UI configuration updated:', config);
            // UI configuration is managed by UIController
        });
    }

    // Plugins remain responsible for their own UI actions (auth, cloud, etc.).
});
