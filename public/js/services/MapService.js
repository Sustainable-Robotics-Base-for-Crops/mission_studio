/**
 * Leaflet map management service
 * Handles initialization, location search, and geolocation
 */
class MapService {
    constructor(notificationService) {
        this.map = null;
        this.notificationService = notificationService;
        this.searchMarker = null;
        this.userLocationMarker = null;
        this.tileLayer = null;
        this.activeTileLayerConfig = null;
        this.searchDebounceTimer = null;
        this.searchSuggestions = [];
        this.selectedSearchSuggestionIndex = -1;
    }

    /**
     * Initialize the Leaflet map
     * @param {string} containerId - HTML container ID for the map
     * @param {Function} onMapClick - Callback called on map click
     * @returns {L.Map} Leaflet map instance
     */
    initializeMap(containerId, onMapClick) {
        // Default coordinates: center of France
        const defaultCenter = [46.6034, 1.8883];
        const defaultZoom = 7.5;

        // Create the map with default values
        this.map = L.map(containerId, {
            zoomControl: false,
            maxZoom: 22,
            minZoom: 1,
            zoomDelta: 0.5,
            zoomSnap: 0.5
        }).setView(defaultCenter, defaultZoom);

        // Load the tile layer according to the runtime configuration.
        // If the config is missing/invalid, keep historical behavior (Esri).
        this.activeTileLayerConfig = this.resolveTileLayerConfig();
        this.setupTileLayer(this.activeTileLayerConfig);

        // Map click handler
        if (onMapClick) {
            this.map.on('click', (e) => {
                onMapClick(e.latlng);
            });
        }

        // Double-click to zoom
        this.map.on('dblclick', (e) => {
            this.map.zoomIn(2, {animate: true});
            L.DomEvent.stopPropagation(e);
        });

        // Zoom controls
        const zoomControl = L.control.zoom({
            zoomInTitle: 'Zoom in (+)',
            zoomOutTitle: 'Zoom out (-)',
            zoomInText: '+',
            zoomOutText: '-'
        }).addTo(this.map);

        // Remove focus from zoom buttons after click
        setTimeout(() => {
            const zoomButtons = document.querySelectorAll('.leaflet-control-zoom a');
            zoomButtons.forEach(button => {
                button.addEventListener('click', function(e) {
                    setTimeout(() => {
                        this.blur();
                    }, 150);
                });
            });
        }, 100);

        // Scale control
        L.control.scale({
            imperial: false,
            metric: true,
            position: 'bottomright'
        }).addTo(this.map);

        // Keyboard shortcuts for zoom
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch(e.key) {
                case '+':
                case '=':
                    e.preventDefault();
                    this.map.zoomIn();
                    break;
                case '-':
                    e.preventDefault();
                    this.map.zoomOut();
                    break;
                case '0':
                    e.preventDefault();
                    this.map.setZoom(18);
                    break;
            }
        });

        // Update zoom display
        const updateZoomDisplay = () => {
            const zoomElement = document.getElementById('currentZoom');
            if (zoomElement) {
                zoomElement.textContent = this.map.getZoom();
            }
        };

        // Update the initial zoom immediately
        updateZoomDisplay();

        // Update the zoom during changes
        this.map.on('zoomend', updateZoomDisplay);
        this.map.on('zoom', updateZoomDisplay); // Real-time update while zooming

        // Position search configuration
        this.setupSearchControls();

        return this.map;
    }

    /**
     * Return the historical Esri configuration used as fallback.
     * @returns {{provider: string, url: string, attribution: string, maxZoom: number, maxNativeZoom: number}}
     */
    getDefaultTileConfig() {
        return {
            provider: 'esri',
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: '© Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
            maxZoom: 22,
            maxNativeZoom: 19
        };
    }

    /**
     * Create and display a Leaflet tile layer.
     * @param {Object} config - Resolved tile configuration
     */
    applyTileLayerConfig(config) {
        if (this.tileLayer && this.map.hasLayer(this.tileLayer)) {
            this.map.removeLayer(this.tileLayer);
        }

        this.activeTileLayerConfig = config;
        this.tileLayer = L.tileLayer(config.url, {
            attribution: config.attribution,
            maxZoom: config.maxZoom,
            maxNativeZoom: config.maxNativeZoom
        }).addTo(this.map);
    }

    /**
     * Initialize the tile layer, with a prior session for Google.
     * @param {Object} config - Resolved tile configuration
     */
    setupTileLayer(config) {
        if (config.provider === 'google' && config.requiresSession) {
            // Show Esri immediately to avoid a blank screen while creating the Google session.
            this.applyTileLayerConfig(this.getDefaultTileConfig());
            this.initializeGoogleTileLayer(config);
            return;
        }

        this.applyTileLayerConfig(config);
    }

    /**
     * Add a query string parameter without relying on URL(), which misinterprets Leaflet placeholders.
     * @param {string} url - Tile URL that may contain {z}/{x}/{y}
     * @param {string} key - Parameter name
     * @param {string} value - Parameter value
     * @returns {string} Enriched URL
     */
    appendQueryParam(url, key, value) {
        if (!value || new RegExp(`[?&]${key}=`).test(url)) {
            return url;
        }
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    }

    /**
     * Create a Google Map Tiles API session.
     * @param {Object} config - Google configuration
     * @returns {Promise<string>} Google session token
     */
    async createGoogleTileSession(config) {
        const requestBody = {
            mapType: config.googleMapType || 'satellite',
            language: config.googleLanguage || 'fr-FR',
            region: config.googleRegion || 'FR'
        };

        const response = await fetch(
            `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(config.apiKey)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`createSession HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        if (!data.session) {
            throw new Error('Google createSession response without session field');
        }
        return data.session;
    }

    /**
     * Resolve the final Google URL after session creation.
     * @param {Object} config - Google configuration
     * @param {string} sessionToken - Google session token
     * @returns {string} Leaflet-compatible URL
     */
    buildGoogleTileUrl(config, sessionToken) {
        let url = config.url
            .replace('{apiKey}', encodeURIComponent(config.apiKey))
            .replace('{session}', encodeURIComponent(sessionToken));

        url = this.appendQueryParam(url, 'session', sessionToken);
        url = this.appendQueryParam(url, 'key', config.apiKey);
        return url;
    }

    /**
     * Create the Google session, then replace the fallback with Google tiles.
     * @param {Object} config - Google configuration
     */
    async initializeGoogleTileLayer(config) {
        try {
            const sessionToken = await this.createGoogleTileSession(config);
            const googleConfig = {
                ...config,
                url: this.buildGoogleTileUrl(config, sessionToken),
                requiresSession: false
            };
            this.applyTileLayerConfig(googleConfig);
        } catch (error) {
            console.error('[MapService] Unable to initialize Google tiles, keeping Esri fallback:', error);
            if (this.notificationService) {
                this.notificationService.show(
                    `Unable to load Google tiles, Esri fallback used: ${error.message}`,
                    'warning',
                    5000
                );
            }
        }
    }

    /**
     * Build the tile configuration for the requested provider.
     * Natively supported providers: esri, google, osm.
     * Custom providers: custom, xyz, other (URL required).
     * @returns {{provider: string, url: string, attribution: string, maxZoom: number, maxNativeZoom: number}}
     */
    resolveTileLayerConfig() {
        const fallbackConfig = this.getDefaultTileConfig();
        // The configuration is injected by `index.html` from Settings.get_map_config().
        // Keep the old name as a fallback to avoid breaking a possible external plugin.
        const injectedConfig = window.TRAJECTORY_EDITOR_MAP_CONFIG || window.TRAJECTORY_MAP_CONFIG;
        const runtimeConfig = (injectedConfig && typeof injectedConfig === 'object')
            ? injectedConfig
            : {};

        const provider = typeof runtimeConfig.provider === 'string'
            ? runtimeConfig.provider.trim().toLowerCase()
            : fallbackConfig.provider;
        const apiKey = typeof runtimeConfig.apiKey === 'string' ? runtimeConfig.apiKey.trim() : '';
        const customUrl = typeof runtimeConfig.url === 'string' ? runtimeConfig.url.trim() : '';
        const customAttribution = typeof runtimeConfig.attribution === 'string'
            ? runtimeConfig.attribution.trim()
            : '';
        const googleMapType = typeof runtimeConfig.googleMapType === 'string'
            ? runtimeConfig.googleMapType.trim().toLowerCase()
            : 'satellite';
        const googleLanguage = typeof runtimeConfig.googleLanguage === 'string'
            ? runtimeConfig.googleLanguage.trim()
            : 'fr-FR';
        const googleRegion = typeof runtimeConfig.googleRegion === 'string'
            ? runtimeConfig.googleRegion.trim().toUpperCase()
            : 'FR';
        const maxZoom = Number.isFinite(Number(runtimeConfig.maxZoom))
            ? Number(runtimeConfig.maxZoom)
            : fallbackConfig.maxZoom;
        const maxNativeZoom = Number.isFinite(Number(runtimeConfig.maxNativeZoom))
            ? Number(runtimeConfig.maxNativeZoom)
            : fallbackConfig.maxNativeZoom;

        // Local helper to avoid duplicating shared metadata.
        const createConfig = (resolvedProvider, url, attribution) => ({
            provider: resolvedProvider,
            url,
            attribution,
            maxZoom,
            maxNativeZoom
        });

        if (provider === 'esri' || provider === '') {
            return createConfig(
                'esri',
                customUrl || fallbackConfig.url,
                customAttribution || fallbackConfig.attribution
            );
        }

        if (provider === 'osm' || provider === 'openstreetmap') {
            return createConfig(
                'osm',
                customUrl || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                customAttribution || '&copy; OpenStreetMap contributors'
            );
        }

        if (provider === 'google') {
            if (!apiKey) {
                console.warn('[MapService] Provider google without MAP_TILE_API_KEY. Fallback to Esri.');
                return fallbackConfig;
            }

            // Google Map Tiles API requires a session created through createSession before 2dtiles calls.
            const config = createConfig(
                'google',
                customUrl || 'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}',
                customAttribution || '&copy; Google'
            );
            return {
                ...config,
                apiKey,
                googleMapType,
                googleLanguage,
                googleRegion,
                requiresSession: true
            };
        }

        if (provider === 'custom' || provider === 'xyz' || provider === 'other') {
            if (!customUrl) {
                console.warn('[MapService] Custom provider without MAP_TILE_URL. Fallback to Esri.');
                return fallbackConfig;
            }
            return createConfig(
                provider,
                customUrl.replace('{apiKey}', encodeURIComponent(apiKey)),
                customAttribution || fallbackConfig.attribution
            );
        }

        // Unknown provider: accept the custom URL if provided, otherwise use a safe fallback.
        if (customUrl) {
            return createConfig(
                provider,
                customUrl.replace('{apiKey}', encodeURIComponent(apiKey)),
                customAttribution || fallbackConfig.attribution
            );
        }

        console.warn(`[MapService] Unknown tile provider (${provider}). Fallback to Esri.`);
        return fallbackConfig;
    }

    /**
     * Configure position search controls
     */
    setupSearchControls() {
        const searchBox = document.getElementById('searchBox');
        const searchToggle = document.getElementById('searchToggle');
        const locationSearch = document.getElementById('locationSearch');
        const searchBtn = document.getElementById('searchBtn');
        const geolocationBtn = document.getElementById('geolocationBtn');
        const suggestionsContainer = document.getElementById('searchSuggestions');

        if (!searchBox || !locationSearch || !searchBtn) return;

        // Function to toggle the search field state
        const toggleSearchExpanded = () => {
            if (window.innerWidth <= 1440) {
                searchBox.classList.toggle('expanded');
                if (searchBox.classList.contains('expanded')) {
                    setTimeout(() => locationSearch.focus(), 100);
                }
            }
        };

        // Click on the search icon or searchBox (for small screens)
        if (searchToggle) {
            searchToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                toggleSearchExpanded();
            });
        }

        // On small screens, also allow clicking the searchBox itself
        searchBox.addEventListener('click', (e) => {
            // If clicking the searchBox but not the input or search button
            if (window.innerWidth <= 1440 && 
                !searchBox.classList.contains('expanded') &&
                !e.target.closest('.search-input-wrapper') &&
                !e.target.closest('.search-btn')) {
                e.stopPropagation();
                e.preventDefault();
                toggleSearchExpanded();
            }
        });

        // Location search
        searchBtn.addEventListener('click', () => {
            this.searchLocation();
        });

        // Geolocation button
        if (geolocationBtn) {
            geolocationBtn.addEventListener('click', () => {
                this.requestUserLocation();
            });
        }

        // Live suggestions: the request is debounced to limit provider calls.
        locationSearch.addEventListener('input', () => {
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = setTimeout(() => {
                this.searchLocation({ showEmptyWarning: false });
            }, 350);
        });

        // Keyboard search: arrows to choose, Enter to validate.
        locationSearch.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.moveSearchSelection(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.moveSearchSelection(-1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (this.selectedSearchSuggestionIndex >= 0) {
                    this.selectSearchResult(this.searchSuggestions[this.selectedSearchSuggestionIndex]);
                    return;
                }
                this.searchLocation();
            } else if (e.key === 'Escape') {
                this.clearSearchSuggestions();
            }
        });

        // Collapse when clicking outside
        let isSearchFocused = false;
        locationSearch.addEventListener('focus', () => {
            isSearchFocused = true;
        });
        locationSearch.addEventListener('blur', () => {
            setTimeout(() => {
                isSearchFocused = false;
            }, 200);
        });

        document.addEventListener('mousedown', (e) => {
            if (suggestionsContainer &&
                !searchBox.contains(e.target) &&
                !suggestionsContainer.contains(e.target)) {
                this.clearSearchSuggestions();
            }

            if (window.innerWidth <= 1440 && 
                searchBox.classList.contains('expanded') &&
                !searchBox.contains(e.target) &&
                !(suggestionsContainer && suggestionsContainer.contains(e.target)) &&
                !isSearchFocused) {
                
                const target = e.target;
                const isInteractive = target.tagName === 'BUTTON' ||
                                    target.tagName === 'A' ||
                                    target.tagName === 'INPUT' ||
                                    target.tagName === 'SELECT' ||
                                    target.tagName === 'TEXTAREA' ||
                                    target.closest('button') ||
                                    target.closest('a') ||
                                    target.closest('.btn') ||
                                    target.closest('#map') ||
                                    target.closest('.left-panel') ||
                                    target.closest('.instruction-card');
                
                if (isInteractive) {
                    searchBox.classList.remove('expanded');
                }
            }
        });

        // Handle window resizing
        let resizeTimeout;
        let lastWindowHeight = window.innerHeight;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                const currentHeight = window.innerHeight;
                const heightDiff = Math.abs(currentHeight - lastWindowHeight);
                
                if (window.innerWidth >= 1441) {
                    searchBox.classList.remove('expanded');
                }
                
                if (heightDiff > 150 && isSearchFocused) {
                    return;
                }
                
                lastWindowHeight = currentHeight;
            }, 250);
        });
    }

    /**
     * Search locations through the server-configured provider.
     * @param {Object} options - Options for displaying warnings
     */
    async searchLocation(options = { showEmptyWarning: true }) {
        const locationSearch = document.getElementById('locationSearch');
        if (!locationSearch) return;

        const query = locationSearch.value.trim();
        if (!query) {
            this.clearSearchSuggestions();
            if (options.showEmptyWarning && this.notificationService) {
                this.notificationService.show('notification.searchEmpty', 'warning');
            }
            return;
        }

        if (query.length < 2) {
            this.clearSearchSuggestions();
            return;
        }

        try {
            const authHeaders = window.apiService && typeof window.apiService.getAuthHeaders === 'function'
                ? await window.apiService.getAuthHeaders()
                : {};
            const response = await fetch(`/api/geocoding/search?q=${encodeURIComponent(query)}`, {
                headers: authHeaders,
                credentials: 'include'
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Connection error to geolocation service');
            }

            const payload = await response.json();
            const results = Array.isArray(payload.results) ? payload.results : [];

            if (results.length === 0) {
                this.clearSearchSuggestions();
                if (options.showEmptyWarning && this.notificationService) {
                    this.notificationService.show('notification.searchNoResults', 'warning', 4000, { query });
                }
                return;
            }

            this.renderSearchSuggestions(results);

        } catch (error) {
            console.error('Error during location search:', error);
            this.clearSearchSuggestions();
            if (this.notificationService) {
                this.notificationService.show('notification.searchError', 'error', 5000, { error: error.message });
            }
        }
    }

    /**
     * Display address suggestions below the search field.
     * @param {Array<Object>} results - Normalized backend results
     */
    renderSearchSuggestions(results) {
        const suggestionsContainer = document.getElementById('searchSuggestions');
        if (!suggestionsContainer) return;

        this.searchSuggestions = results;
        this.selectedSearchSuggestionIndex = -1;
        suggestionsContainer.innerHTML = '';
        suggestionsContainer.style.display = 'block';

        results.forEach((result, index) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'search-suggestion-item';
            item.setAttribute('role', 'option');
            item.dataset.index = String(index);

            const title = document.createElement('span');
            title.className = 'search-suggestion-title';
            title.textContent = result.label || 'Unnamed result';

            const meta = document.createElement('span');
            meta.className = 'search-suggestion-meta';
            meta.textContent = `${Number(result.lat).toFixed(5)}, ${Number(result.lon).toFixed(5)}${result.provider ? ` · ${result.provider}` : ''}`;

            item.appendChild(title);
            item.appendChild(meta);
            item.addEventListener('mousedown', (event) => {
                // mousedown prevents the field blur from hiding the list before selection.
                event.preventDefault();
                this.selectSearchResult(result);
            });

            suggestionsContainer.appendChild(item);
        });
    }

    /**
     * Move the keyboard selection in the suggestions list.
     * @param {number} direction - +1 for down, -1 for up
     */
    moveSearchSelection(direction) {
        const suggestionsContainer = document.getElementById('searchSuggestions');
        if (!suggestionsContainer || this.searchSuggestions.length === 0) return;

        const maxIndex = this.searchSuggestions.length - 1;
        const nextIndex = this.selectedSearchSuggestionIndex + direction;
        this.selectedSearchSuggestionIndex = Math.max(0, Math.min(maxIndex, nextIndex));

        suggestionsContainer.querySelectorAll('.search-suggestion-item').forEach((item, index) => {
            item.classList.toggle('selected', index === this.selectedSearchSuggestionIndex);
        });
    }

    /**
     * Clean up visible suggestions.
     */
    clearSearchSuggestions() {
        const suggestionsContainer = document.getElementById('searchSuggestions');
        if (suggestionsContainer) {
            suggestionsContainer.innerHTML = '';
            suggestionsContainer.style.display = 'none';
        }
        this.searchSuggestions = [];
        this.selectedSearchSuggestionIndex = -1;
    }

    /**
     * Center the map on the result chosen by the user.
     * @param {Object} result - Normalized geocoding result
     */
    selectSearchResult(result) {
        const locationSearch = document.getElementById('locationSearch');
        const searchBox = document.getElementById('searchBox');
        const lat = Number(result.lat);
        const lon = Number(result.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        this.map.setView([lat, lon], 15);
        if (locationSearch) {
            locationSearch.value = result.label || '';
        }
        this.clearSearchSuggestions();

        if (this.searchMarker) {
            this.map.removeLayer(this.searchMarker);
        }

        this.searchMarker = L.marker([lat, lon])
            .addTo(this.map)
            .bindPopup(() => {
                const latLabel = window.i18n ? window.i18n.t('map.latitude') : 'Lat';
                const lonLabel = window.i18n ? window.i18n.t('map.longitude') : 'Lon';
                return `<b>${result.label || 'Selected location'}</b><br/>${latLabel}: ${lat.toFixed(6)}<br/>${lonLabel}: ${lon.toFixed(6)}`;
            })
            .openPopup();

        if (window.innerWidth <= 1440 && searchBox) {
            searchBox.classList.remove('expanded');
        }

        setTimeout(() => {
            if (this.searchMarker) {
                this.map.removeLayer(this.searchMarker);
                this.searchMarker = null;
            }
        }, 10000);
    }

    /**
     * Request the user position (geolocation)
     * Does nothing if the position cannot be retrieved
     */
    requestUserLocation() {
        if (!navigator.geolocation) {
            if (this.notificationService) {
                this.notificationService.show('notification.geolocationNotSupported', 'warning');
            }
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                // Validate that the position is valid
                if (!position || !position.coords) {
                    console.error('Invalid position received');
                    if (this.notificationService) {
                        this.notificationService.show('notification.geolocationUnavailable', 'error');
                    }
                    return;
                }

                const lat = position.coords.latitude;
                const lon = position.coords.longitude;

                // Validate that coordinates are valid (not NaN, not null, within reasonable bounds)
                if (isNaN(lat) || isNaN(lon) || lat === null || lon === null) {
                    console.error('Invalid coordinates:', { lat, lon });
                    if (this.notificationService) {
                        this.notificationService.show('notification.geolocationUnavailable', 'error');
                    }
                    return;
                }

                // Validate that coordinates are within reasonable geographic bounds
                if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                    console.error('Coordinates out of bounds:', { lat, lon });
                    if (this.notificationService) {
                        this.notificationService.show('notification.geolocationUnavailable', 'error');
                    }
                    return;
                }

                const userPosition = [lat, lon];
                const userZoom = 17;
                
                this.map.setView(userPosition, userZoom);
                
                if (this.userLocationMarker) {
                    this.map.removeLayer(this.userLocationMarker);
                }

                this.userLocationMarker = L.marker(userPosition)
                .addTo(this.map)
                .bindPopup(() => {
                    const yourPosition = window.i18n ? window.i18n.t('map.yourPosition') : 'Your position';
                    const latLabel = window.i18n ? window.i18n.t('map.latitude') : 'Lat';
                    const lonLabel = window.i18n ? window.i18n.t('map.longitude') : 'Lon';
                    return `<b>${yourPosition}</b><br/>${latLabel}: ${lat.toFixed(6)}<br/>${lonLabel}: ${lon.toFixed(6)}`;
                })
                .openPopup();

                setTimeout(() => {
                    if (this.userLocationMarker) {
                        this.map.removeLayer(this.userLocationMarker);
                        this.userLocationMarker = null;
                    }
                }, 10000);

            },
            (error) => {
                let errorKey = 'notification.geolocationError';
                let errorParams = {};
                
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        errorKey = 'notification.geolocationPermissionDenied';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorKey = 'notification.geolocationUnavailable';
                        break;
                    case error.TIMEOUT:
                        errorKey = 'notification.geolocationTimeout';
                        break;
                    default:
                        errorKey = 'notification.geolocationUnavailable';
                        errorParams = { error: error.message || 'Unknown error' };
                        break;
                }
                
                console.error('Geolocation error:', error);
                if (this.notificationService) {
                    this.notificationService.show(errorKey, 'error', 5000, errorParams);
                }
                // Do nothing - do not center the map, do not use a default position
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0 // Do not use a cached position - force a new position
            }
        );
    }

    /**
     * Center and zoom the map on bounds
     * @param {L.LatLngBounds} bounds - Bounds to display
     * @param {Object} options - Options for fitBounds
     */
    fitBounds(bounds, options = { padding: [50, 50] }) {
        if (this.map && bounds) {
            this.map.fitBounds(bounds, options);
        }
    }

    /**
     * Get the map instance
     * @returns {L.Map} Map instance
     */
    getMap() {
        return this.map;
    }
}

// Export for global use
window.MapService = MapService;
