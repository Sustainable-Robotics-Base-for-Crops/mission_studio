/**
 * Controller for coordinating the map and editing
 * Handles edit modes, map clicks, and interactions
 */
class MapController {
    constructor(mapView, panelView, eventBus) {
        this.mapView = mapView;
        this.panelView = panelView;
        this.eventBus = eventBus;
        this.editMode = 'none';
        this.tempPoints = [];
        this.rulerPoints = null;
        this.currentTrajectory = null; // Store the trajectory to calculate distances
        this.onSectionClick = null; // Callback for section clicks
        this.mouseMoveHandler = null; // Handler for mouse movement
        this.mouseOutHandler = null; // Handler for mouse leave
        this.maxDistancePixels = 10; // Maximum distance in pixels (independent from zoom)
        // Anchor used by the 'extend_section' mode (LatLng of the section start/end point).
        // It is rendered as a static marker and never appears in tempPoints so the user
        // can only place / drag the new endpoint while keeping the original boundary visible.
        this.extendAnchor = null;
        this.onTempPointsChange = null;
    }

    /**
     * Configure the anchor (and optional change callback) used in 'extend_section' mode.
     * The anchor LatLng identifies the section endpoint we extend from; it stays fixed on the map.
     * The change callback is invoked whenever the placed endpoint moves (click or drag) so the
     * section edit panel can refresh its distance label and enable the Apply button.
     */
    setExtendAnchor(latLng, onTempPointsChange = null) {
        this.extendAnchor = latLng || null;
        this.onTempPointsChange = typeof onTempPointsChange === 'function' ? onTempPointsChange : null;
    }

    /**
     * Handle a map click
     * @param {L.LatLng} latlng - Click position
     * @param {Function} onModeChange - Callback when changing mode
     */
    handleMapClick(latlng, onModeChange) {
        // Ruler: 2 clicks to place the two points (outside the trajectory)
        if (this.editMode === 'ruler') {
            if (!Array.isArray(this.rulerPoints)) {
                this.rulerPoints = [];
            }
            const preciseLatLng = L.latLng(
                Math.round(latlng.lat * 1000000) / 1000000,
                Math.round(latlng.lng * 1000000) / 1000000
            );
            this.rulerPoints.push(preciseLatLng);
            if (this.rulerPoints.length === 2) {
                this.setEditMode('none', onModeChange);
            }
            this.updateViews();
            return;
        }

        if (this.editMode === 'none') return;

        // In select_zone mode, find the section closest to the click
        if (this.editMode === 'select_zone' && this.currentTrajectory && this.onSectionClick) {
            this.handleSectionSelectionByProximity(latlng);
            return;
        }

        // High precision: round coordinates
        const preciseLatLng = L.latLng(
            Math.round(latlng.lat * 1000000) / 1000000,
            Math.round(latlng.lng * 1000000) / 1000000
        );

        // In 'extend_section' the user places a single point: every click replaces it
        // so the user can refine the position by re-clicking instead of accumulating points.
        if (this.editMode === 'extend_section') {
            this.tempPoints = [preciseLatLng];
            this.updateViews();
            if (this.onTempPointsChange) {
                this.onTempPointsChange(this.tempPoints);
            }
            return;
        }

        this.tempPoints.push(preciseLatLng);

        // Handle according to the mode
        switch (this.editMode) {
            // The select_zone case is handled above
        }

        this.updateViews();
    }

    /**
     * Change edit mode
     * @param {string} mode - New mode
     * @param {Function} onModeChange - Callback when changing mode
     */
    setEditMode(mode, onModeChange) {
        // Deactivate all buttons
        this.deactivateAllActionButtons();

        if (this.editMode === mode) {
            // Deactivate the current mode
            this.editMode = 'none';
            this.tempPoints = [];
            if (mode === 'ruler') {
                this.rulerPoints = null;
            }
            // Always drop the extend anchor when leaving any mode to avoid stale markers.
            this.extendAnchor = null;
            this.onTempPointsChange = null;
            // Clean up the mouse movement handler
            this.cleanupMouseMoveHandler();
        } else {
            // Activate the new mode
            this.editMode = mode;
            this.tempPoints = [];
            if (mode === 'ruler') {
                this.rulerPoints = this.rulerPoints && this.rulerPoints.length === 2 ? this.rulerPoints : [];
            }
            // The anchor is set externally (setExtendAnchor) right after entering 'extend_section'.
            // Reset it for any other mode to keep state coherent.
            if (mode !== 'extend_section') {
                this.extendAnchor = null;
                this.onTempPointsChange = null;
            }
            // Activate the corresponding button
            const modeButton = document.querySelector(`[data-mode="${mode}"]`);
            if (modeButton) {
                modeButton.classList.add('active');
            }
        }

        this.updateViews();
        
        // Set up the mouse movement handler for select_zone mode
        if (this.editMode === 'select_zone') {
            this.setupMouseMoveHandler();
        } else {
            this.cleanupMouseMoveHandler();
        }
        
        if (onModeChange) {
            onModeChange('modeChanged', { mode: this.editMode });
        }
    }

    /**
     * Deactivate all action buttons
     */
    deactivateAllActionButtons() {
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.classList.remove('active');
        });
    }

    /**
     * Remove the ruler
     * @param {Function} onModeChange - Callback
     */
    clearRuler(onModeChange) {
        this.rulerPoints = null;
        if (this.editMode === 'ruler') {
            this.setEditMode('none', onModeChange);
        }
        this.updateViews();
    }

    /**
     * Update all views
     * @param {Object} trajectory - Current trajectory
     * @param {Array<number>} selectedIndices - Selected indices
     * @param {Function} onSectionClick - Callback when clicking a section (optional)
     */
    updateViews(trajectory = null, selectedIndices = [], onSectionClick = null) {
        // Store the trajectory and callback for proximity-based selection
        this.currentTrajectory = trajectory;
        this.onSectionClick = onSectionClick;
        
        // Update the map
        if (trajectory) {
            // No longer pass onSectionClick to renderSections; selection is proximity-based
            this.mapView.renderSections(trajectory, selectedIndices, null);
            // Always call renderGeofencing to clean up when geofencing is null
            this.mapView.renderGeofencing(
                trajectory.geofencing || null, 
                trajectory.origin.coordinates
            );
        }

        // Display temporary points (always call to clean up old layers)
        this.mapView.renderTempPoints(
            this.tempPoints,
            this.editMode,
            (index, newPos, allPoints) => {
                // Callback when dragging a point
                this.tempPoints = allPoints;
                this.updateViews(trajectory, selectedIndices);
                if (this.editMode === 'extend_section' && this.onTempPointsChange) {
                    this.onTempPointsChange(this.tempPoints);
                }
            },
            this.extendAnchor
        );

        // Display the selection zone (always call to clean up if needed)
        if (this.editMode === 'select_zone' && this.tempPoints.length > 0) {
            this.mapView.renderSelectionZone(this.tempPoints);
        } else {
            // Clean up the selection zone if not in select_zone mode or if there are no points
            this.mapView.renderSelectionZone([]);
        }

        // Display the ruler (always call to clean up if rulerPoints is null)
        this.mapView.renderRuler(
            this.rulerPoints || null,
            (index, newPos, allPoints) => {
                this.rulerPoints = allPoints;
                this.updateViews(trajectory, selectedIndices);
            }
        );

        // Update the panel
        const i18n = window.i18n || null;
        this.panelView.updateInstructionCard(this.editMode, this.tempPoints.length, i18n);
        
        // Check whether the section edit panel is open
        const sectionEditPanel = document.getElementById('sectionEditPanel');
        let isSectionEditPanelOpen = false;
        if (sectionEditPanel) {
            // Check both inline style and computed style
            const inlineDisplay = sectionEditPanel.style.display;
            const computedDisplay = window.getComputedStyle(sectionEditPanel).display;
            isSectionEditPanelOpen = inlineDisplay !== 'none' && computedDisplay !== 'none';
        }
        
        this.panelView.updateValidationButtons(
            this.editMode,
            this.tempPoints.length,
            trajectory && trajectory.geofencing ? true : false,
            this.rulerPoints && this.rulerPoints.length === 2,
            selectedIndices ? selectedIndices.length : 0,
            isSectionEditPanelOpen
        );
    }

    /**
     * Get the current edit mode
     * @returns {string} Current mode
     */
    getEditMode() {
        return this.editMode;
    }

    /**
     * Get temporary points
     * @returns {Array<L.LatLng>} Temporary points
     */
    getTempPoints() {
        return this.tempPoints;
    }

    /**
     * Reset temporary points
     */
    resetTempPoints() {
        this.tempPoints = [];
    }

    /**
     * Get ruler points
     * @returns {Array<L.LatLng>|null} Ruler points
     */
    getRulerPoints() {
        return this.rulerPoints;
    }

    /**
     * Get the Leaflet map instance
     * @returns {L.Map} Map instance
     */
    getMap() {
        return this.mapView ? this.mapView.map : null;
    }

    /**
     * Handle section selection by proximity to the click
     * @param {L.LatLng} clickPoint - Click point on the map
     */
    handleSectionSelectionByProximity(clickPoint) {
        if (!this.currentTrajectory || !this.currentTrajectory.points || !this.onSectionClick) {
            return;
        }

        const map = this.getMap();
        if (!map) return;

        const origin = this.currentTrajectory.origin.coordinates;
        const clickLatLng = { lat: clickPoint.lat, lng: clickPoint.lng };
        
        // Convert distance from pixels to meters according to the current zoom
        const maxDistanceMeters = this.pixelsToMeters(this.maxDistancePixels, clickPoint.lat);

        let closestSectionIndex = -1;
        let minDistance = Infinity;

        // Iterate over all sections to find the closest one
        this.currentTrajectory.points.forEach((section, sectionIndex) => {
            // Get the points of the section
            const sectionPoints = this.mapView.getSectionLatLngPoints(section, origin);
            
            if (sectionPoints.length < 2) return;

            // Calculate the distance from the click point to this section
            const distance = window.GeometryUtils.distancePointToPolyline(clickLatLng, sectionPoints);

            if (distance < minDistance && distance <= maxDistanceMeters) {
                minDistance = distance;
                closestSectionIndex = sectionIndex;
            }
        });

        // If a section was found within the maximum distance, select it
        if (closestSectionIndex >= 0) {
            this.onSectionClick(closestSectionIndex);
        }
    }

    /**
     * Convert pixels to meters according to the zoom level
     * @param {number} pixels - Number of pixels
     * @param {number} lat - Latitude for calculation (affects the conversion)
     * @returns {number} Distance in meters
     */
    pixelsToMeters(pixels, lat) {
        const map = this.getMap();
        if (!map) return 5; // Default value

        // Get the resolution in meters per pixel at the current zoom level
        const zoom = map.getZoom();
        const latRad = lat * Math.PI / 180;
        // Leaflet formula for resolution: 156543.03392 meters per pixel at level 0 at the equator
        const metersPerPixel = (156543.03392 * Math.cos(latRad)) / Math.pow(2, zoom);
        
        return pixels * metersPerPixel;
    }

    /**
     * Set up the mouse movement handler to change the cursor in select_zone mode
     */
    setupMouseMoveHandler() {
        const map = this.getMap();
        if (!map || this.mouseMoveHandler) return;

        this.mouseMoveHandler = (e) => {
            if (this.editMode !== 'select_zone' || !this.currentTrajectory) {
                this.resetCursor();
                return;
            }

            const mousePoint = e.latlng;
            const isNearSection = this.isPointNearSection(mousePoint);
            
            if (isNearSection) {
                this.setPointerCursor();
            } else {
                this.resetCursor();
            }
        };

        this.mouseOutHandler = () => this.resetCursor();
        
        map.on('mousemove', this.mouseMoveHandler);
        map.on('mouseout', this.mouseOutHandler);
    }

    /**
     * Clean up the mouse movement handler
     */
    cleanupMouseMoveHandler() {
        const map = this.getMap();
        if (map) {
            if (this.mouseMoveHandler) {
                map.off('mousemove', this.mouseMoveHandler);
                this.mouseMoveHandler = null;
            }
            if (this.mouseOutHandler) {
                map.off('mouseout', this.mouseOutHandler);
                this.mouseOutHandler = null;
            }
            this.resetCursor();
        }
    }

    /**
     * Check if a point is near a section
     * @param {L.LatLng} point - Point to check
     * @returns {boolean} True if the point is near a section
     */
    isPointNearSection(point) {
        if (!this.currentTrajectory || !this.currentTrajectory.points) {
            return false;
        }

        const map = this.getMap();
        if (!map) return false;

        const origin = this.currentTrajectory.origin.coordinates;
        const pointLatLng = { lat: point.lat, lng: point.lng };
            
        // Convert the distance from pixels to meters depending on the current zoom level
        const maxDistanceMeters = this.pixelsToMeters(this.maxDistancePixels, point.lat);

        // Iterate over all sections to see if any is close by
        for (const section of this.currentTrajectory.points) {
            const sectionPoints = this.mapView.getSectionLatLngPoints(section, origin);
            
            if (sectionPoints.length < 2) continue;

            // Calculate the distance from the point to this section
            const distance = window.GeometryUtils.distancePointToPolyline(pointLatLng, sectionPoints);

            if (distance <= maxDistanceMeters) {
                return true;
            }
        }

        return false;
    }

    /**
     * Change the cursor to pointer
     */
    setPointerCursor() {
        const map = this.getMap();
        if (map) {
            const container = map.getContainer();
            if (container) {
                container.style.cursor = 'pointer';
            }
        }
    }

    /**
     * Reset the cursor to default
     */
    resetCursor() {
        const map = this.getMap();
        if (map) {
            const container = map.getContainer();
            if (container) {
                container.style.cursor = '';
            }
        }
    }
}

// Export for global use
window.MapController = MapController;
