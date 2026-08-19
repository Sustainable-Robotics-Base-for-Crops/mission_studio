/**
 * TrajectoryEditor - Orchestrates all modular components
 * Fully replaces the legacy monolithic code
 */

/** Point spacing for turns and row_line to row_path densification (10 cm) */
const TURN_PATH_SPACING_M = 0.1;
/** Endpoint tolerance used to recognize an already generated turn (2 cm) */
const TURN_CONNECTION_MATCH_TOLERANCE_M = 0.02;
/** Row length used to estimate a stable tangent at each end of a U-turn (m) */
const U_TURN_DIRECTION_SAMPLE_M = 1.5;
/** Requested lateral offset on the headland when closing a loop (m) */
const LOOP_HEADLAND_LATERAL_M = 0.3;

class TrajectoryEditor {
    constructor() {
        // Services
        this.apiService = window.apiService;
        this.notificationService = window.notificationService;
        this.mapService = null;
        
        // Controllers
        this.trajectoryController = new TrajectoryController(this.apiService, this.notificationService);
        this.sectionController = new SectionController(this.notificationService);
        this.mapController = null;
        
        // Views
        this.mapView = null;
        this.panelView = new PanelView();
        
        // State
        this.currentTrajectory = this.trajectoryController.createNewTrajectory();
        this.selectedSectionIndex = null;
        this.selectedSectionIndices = [];
        this.undoStack = [];
        
        // Section editing parameters
        this.moveStep = 0.5; // Movement step in meters
        this.rotationStep = 5; // Rotation step in degrees
        this.currentRotationAngle = 0; // Current rotation angle
        
        // Limits
        this.MAX_POINTS_PER_SECTION = 50_000;
        this.MAX_POINTS_PER_TRAJECTORY = 1_000_000;
        
        // Initialization
        this.initialize();
    }

    /**
     * Initialize the editor
     */
    async initialize() {
        // Initialize the map
        this.mapService = new MapService(this.notificationService);
        const map = this.mapService.initializeMap('map', (latlng) => {
            this.handleMapClick(latlng);
        });
        
        // Initialize MapView
        this.mapView = new MapView(map, window.GeometryUtils);
        
        // Initialize MapController
        this.mapController = new MapController(
            this.mapView,
            this.panelView,
            window.eventBus
        );
        
        // Configure event listeners
        this.setupEventListeners();
        
        // Update the interface
        this.updateAll();
    }

    /**
     * Configure event listeners
     */
    setupEventListeners() {
        // Main buttons
        const newBtn = document.getElementById('newBtn');
        if (newBtn) {
            newBtn.addEventListener('click', () => this.newTrajectory());
        }
        
        const loadLocalBtn = document.getElementById('loadLocalBtn');
        if (loadLocalBtn) {
            loadLocalBtn.addEventListener('click', () => {
                document.getElementById('localFileInput').click();
            });
        }
        
        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveTrajectoryLocal());
        }
        
        // Cloud buttons and their handlers are entirely provided by plugins.
        this._bindPluginExtraButtons();
        
        // Input file
        const localFileInput = document.getElementById('localFileInput');
        if (localFileInput) {
            localFileInput.addEventListener('change', (e) => this.loadLocalFile(e));
        }
        
        // Trajectory properties
        const fileNameInput = document.getElementById('fileName');
        if (fileNameInput) {
            fileNameInput.addEventListener('input', (e) => {
                this.currentTrajectory.filename = e.target.value.trim() || 'new_trajectory.json';
            });
        }
        
        const vehicleIdInput = document.getElementById('vehicleId');
        if (vehicleIdInput) {
            vehicleIdInput.addEventListener('input', (e) => {
                this.currentTrajectory.vehicle_id = e.target.value.trim() || 'v1';
            });
        }
        
        const fileTypeSelect = document.getElementById('fileType');
        if (fileTypeSelect) {
            fileTypeSelect.addEventListener('change', (e) => {
                this.currentTrajectory.file_type = e.target.value;
            });
        }
        
        // Editing buttons
        const drawLineBtn = document.getElementById('drawLineBtn');
        if (drawLineBtn) {
            drawLineBtn.addEventListener('click', () => {
                this.clearSectionSelection();
                this.mapController.setEditMode('draw_line', () => this.updateAll());
            });
        }
        
        const fillParcelBtn = document.getElementById('fillParcelBtn');
        if (fillParcelBtn) {
            fillParcelBtn.addEventListener('click', () => {
                const mode = this.mapController.getEditMode();
                if (mode === 'draw_parcel') {
                    this.clearSectionSelection();
                    this.mapController.setEditMode('none', () => this.updateAll());
                } else {
                    this.clearSectionSelection();
                    this.mapController.setEditMode('draw_parcel', () => this.updateAll());
                    fillParcelBtn.classList.add('active');
                }
            });
        }
        
        const geofenceBtn = document.getElementById('geofenceBtn');
        if (geofenceBtn) {
            geofenceBtn.addEventListener('click', () => {
                this.clearSectionSelection();
                this.mapController.setEditMode('geofence', () => this.updateAll());
            });
        }
        
        const editWorkingZoneBtn = document.getElementById('editWorkingZoneBtn');
        if (editWorkingZoneBtn) {
            editWorkingZoneBtn.addEventListener('click', () => {
                this.clearSectionSelection();
                this.mapController.setEditMode('edit_working_zone', () => this.updateAll());
            });
        }
        
        const selectZoneBtn = document.getElementById('selectZoneBtn');
        if (selectZoneBtn) {
            selectZoneBtn.addEventListener('click', () => {
                const mode = this.mapController.getEditMode();
                if (mode === 'select_zone') {
                    this.clearSectionSelection();
                    this.mapController.setEditMode('none', () => this.updateAll());
                } else {
                    this.clearSectionSelection();
                    this.mapController.setEditMode('select_zone', () => this.updateAll());
                }
            });
        }
        
        const deletePointsZoneBtn = document.getElementById('deletePointsZoneBtn');
        if (deletePointsZoneBtn) {
            deletePointsZoneBtn.addEventListener('click', () => {
                this.clearSectionSelection();
                this.mapController.setEditMode('delete_points_zone', () => this.updateAll());
            });
        }

        const selectSectionsPolygonBtn = document.getElementById('selectSectionsPolygonBtn');
        if (selectSectionsPolygonBtn) {
            selectSectionsPolygonBtn.addEventListener('click', () => {
                this.clearSectionSelection();
                this.mapController.setEditMode('select_sections_polygon', () => this.updateAll());
            });
        }
        
        const rulerBtn = document.getElementById('rulerBtn');
        if (rulerBtn) {
            rulerBtn.addEventListener('click', () => {
                this.clearSectionSelection();
                this.mapController.setEditMode('ruler', () => this.updateAll());
            });
        }
        
        const clearRulerBtn = document.getElementById('clearRulerBtn');
        if (clearRulerBtn) {
            clearRulerBtn.addEventListener('click', () => {
                this.mapController.clearRuler(() => this.updateAll());
            });
        }
        
        const undoBtn = document.getElementById('undoBtn');
        if (undoBtn) {
            undoBtn.addEventListener('click', () => this.undo());
        }
        
        const connectTurnsBtn = document.getElementById('connectTurnsBtn');
        if (connectTurnsBtn) {
            connectTurnsBtn.addEventListener('click', () => {
                this.showConnectTurnsDialog();
                // Mark as active temporarily
                connectTurnsBtn.classList.add('active');
            });
        }

        const editSpeedBtn = document.getElementById('editSpeedBtn');
        if (editSpeedBtn) {
            editSpeedBtn.addEventListener('click', () => {
                this.clearSectionSelection();
                this.mapController.setEditMode('none', () => this.updateAll());
                this.showEditSpeedDialog();
            });
        }
        
        // Validation buttons
        const finishDrawLineBtn = document.getElementById('finishDrawLineBtn');
        if (finishDrawLineBtn) {
            finishDrawLineBtn.addEventListener('click', () => this.finishCurrentAction());
        }
        
        const finishGeofenceBtn = document.getElementById('finishGeofenceBtn');
        if (finishGeofenceBtn) {
            finishGeofenceBtn.addEventListener('click', () => this.finishGeofence());
        }
        
        const finishEditWorkingZoneBtn = document.getElementById('finishEditWorkingZoneBtn');
        if (finishEditWorkingZoneBtn) {
            finishEditWorkingZoneBtn.addEventListener('click', () => this.finishEditWorkingZone());
        }

        const cancelEditActionBtn = document.getElementById('cancelEditActionBtn');
        if (cancelEditActionBtn) {
            cancelEditActionBtn.addEventListener('click', () => this.cancelCurrentEditAction());
        }
        
        const finishDeletePointsZoneBtn = document.getElementById('finishDeletePointsZoneBtn');
        if (finishDeletePointsZoneBtn) {
            finishDeletePointsZoneBtn.addEventListener('click', () => this.finishDeletePointsZone());
        }
        
        const clearGeofenceBtn = document.getElementById('clearGeofenceBtn');
        if (clearGeofenceBtn) {
            clearGeofenceBtn.addEventListener('click', () => this.clearGeofence());
        }
        
        const finishSelectSectionsBtn = document.getElementById('finishSelectSectionsBtn');
        if (finishSelectSectionsBtn) {
            finishSelectSectionsBtn.addEventListener('click', () => this.finishSelectSections());
        }

        const finishSelectSectionsPolygonBtn = document.getElementById('finishSelectSectionsPolygonBtn');
        if (finishSelectSectionsPolygonBtn) {
            finishSelectSectionsPolygonBtn.addEventListener('click', () => this.finishSelectSectionsPolygon());
        }
        
        const deleteSelectedSectionsBtn = document.getElementById('deleteSelectedSectionsBtn');
        if (deleteSelectedSectionsBtn) {
            deleteSelectedSectionsBtn.addEventListener('click', () => this.deleteSelectedSections());
        }
        
        // Dialogs
        this.setupDialogListeners();
    }

    /**
     * Wire buttons injected dynamically through custom_plugins.
     */
    _bindPluginExtraButtons() {
        if (!window.custom_plugins) {
            return;
        }
        const extraButtons = window.custom_plugins.getExtraButtons();
        extraButtons.forEach((btn) => {
            if (!btn || !btn.id || typeof btn.onClick !== 'function') {
                return;
            }
            const node = document.getElementById(btn.id);
            if (!node || node.dataset.customBound === 'true') {
                return;
            }
            // Mark to prevent double binding during UI refreshes.
            node.dataset.customBound = 'true';
            node.addEventListener('click', () => btn.onClick(this));
        });

        // If a plugin adds a button after initialization, rebind automatically.
        window.custom_plugins.on('ui:extra-button-registered', () => this._bindPluginExtraButtons());
    }

    /**
     * Configure dialog listeners
     */
    setupDialogListeners() {
        // Parcel fill dialog
        const fillParcelConfirm = document.getElementById('fillParcelConfirm');
        if (fillParcelConfirm) {
            fillParcelConfirm.addEventListener('click', () => {
                const spacing = parseFloat(document.getElementById('rowSpacing').value) || 2.5;
                this.finishFillParcel(spacing);
            });
        }
        
        const fillParcelCancel = document.getElementById('fillParcelCancel');
        if (fillParcelCancel) {
            fillParcelCancel.addEventListener('click', () => {
                this.cancelCurrentEditAction();
            });
        }
        
        // Working zone edit dialog
        const workingZoneEditSet1 = document.getElementById('workingZoneEditSet1');
        if (workingZoneEditSet1) {
            workingZoneEditSet1.addEventListener('click', () => this.confirmWorkingZoneEdit(1));
        }
        
        const workingZoneEditSet0 = document.getElementById('workingZoneEditSet0');
        if (workingZoneEditSet0) {
            workingZoneEditSet0.addEventListener('click', () => this.confirmWorkingZoneEdit(0));
        }
        
        const workingZoneEditCancel = document.getElementById('workingZoneEditCancel');
        if (workingZoneEditCancel) {
            workingZoneEditCancel.addEventListener('click', () => {
                this.cancelCurrentEditAction();
            });
        }

        // Edit speed dialog (applies to the whole trajectory)
        const editSpeedConfirm = document.getElementById('editSpeedConfirm');
        if (editSpeedConfirm) {
            editSpeedConfirm.addEventListener('click', () => this.confirmEditSpeed());
        }

        const editSpeedCancel = document.getElementById('editSpeedCancel');
        if (editSpeedCancel) {
            editSpeedCancel.addEventListener('click', () => {
                const dialog = document.getElementById('editSpeedDialog');
                if (dialog) dialog.style.display = 'none';
            });
        }
        
        // Delete-points-by-zone dialog
        const deletePointsZoneConfirm = document.getElementById('deletePointsZoneConfirm');
        if (deletePointsZoneConfirm) {
            deletePointsZoneConfirm.addEventListener('click', () => this.confirmDeletePointsInZone());
        }
        
        const deletePointsZoneCancel = document.getElementById('deletePointsZoneCancel');
        if (deletePointsZoneCancel) {
            deletePointsZoneCancel.addEventListener('click', () => {
                this.cancelCurrentEditAction();
            });
        }
        
        // Turn connection dialog
        const connectTurnsConfirm = document.getElementById('connectTurnsConfirm');
        if (connectTurnsConfirm) {
            connectTurnsConfirm.addEventListener('click', () => this.connectTurnsWithParams());
        }
        
        const connectTurnsCancel = document.getElementById('connectTurnsCancel');
        if (connectTurnsCancel) {
            connectTurnsCancel.addEventListener('click', () => {
                document.getElementById('connectTurnsDialog').style.display = 'none';
                const btn = document.getElementById('connectTurnsBtn');
                if (btn) btn.classList.remove('active');
            });
        }

        // Load dialog
        const loadDialogCancel = document.getElementById('loadDialogCancel');
        if (loadDialogCancel) {
            loadDialogCancel.addEventListener('click', () => {
                document.getElementById('loadDialog').style.display = 'none';
            });
        }

        // Handle turn type changes
        const turnTypeSelect = document.getElementById('turnType');
        if (turnTypeSelect) {
            turnTypeSelect.addEventListener('change', (e) => {
                this.updateTurnTypeParams(e.target.value);
            });
        }

        // Handle traversal order changes
        const orderTypeSelect = document.getElementById('orderType');
        if (orderTypeSelect) {
            orderTypeSelect.addEventListener('change', (e) => {
                this.updateOrderTypeParams(e.target.value);
            });
        }

        // Keep the active turn-connection field visible when a tablet/mobile keyboard reduces the viewport.
        this.setupConnectTurnsAutoScroll();

        // Toggle button configuration
        this.setupToggleButtons();
    }

    /**
     * Automatically scroll the turn connection dialog to the field currently being edited.
     */
    setupConnectTurnsAutoScroll() {
        const dialog = document.getElementById('connectTurnsDialog');
        const scrollContainer = dialog?.querySelector('.dialog-scrollable-content');

        if (!dialog || !scrollContainer || scrollContainer.dataset.autoScrollBound === 'true') {
            return;
        }

        // Mark the container so repeated editor initialization cannot register duplicate listeners.
        scrollContainer.dataset.autoScrollBound = 'true';

        const scrollFieldIntoView = (field) => {
            const target = field.closest('.form-group') || field;
            const containerRect = scrollContainer.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();

            // Center the whole form group in the dialog scroll area, leaving room for the virtual keyboard.
            const targetTop = targetRect.top - containerRect.top + scrollContainer.scrollTop;
            const targetCenter = targetTop - (scrollContainer.clientHeight / 2) + (targetRect.height / 2);

            scrollContainer.scrollTo({
                top: Math.max(0, targetCenter),
                behavior: 'smooth'
            });
        };

        scrollContainer.addEventListener('focusin', (event) => {
            const field = event.target;

            if (!(field instanceof HTMLElement) || !field.matches('input, select, textarea')) {
                return;
            }

            // Scroll once immediately, then again after the mobile keyboard has finished resizing the viewport.
            window.requestAnimationFrame(() => scrollFieldIntoView(field));
            window.setTimeout(() => scrollFieldIntoView(field), 300);
        });
    }

    /**
     * Configure toggle buttons for options
     */
    setupToggleButtons() {
        const buttons = ['reverseRows', 'reverseSide'];

        buttons.forEach(buttonId => {
            const button = document.getElementById(buttonId);
            if (button) {
                button.addEventListener('click', () => {
                    button.classList.toggle('active');
                });
            }
        });
    }

    /**
     * Show the turn connection dialog
     */
    showConnectTurnsDialog() {
        const dialog = document.getElementById('connectTurnsDialog');
        if (dialog) {
            dialog.style.display = 'flex';
            // Reapply i18n labels (for example the loop option) in case the dialog was hidden on the first pass
            this.updateTranslations();
            // Initialize the display based on the selected type
            const turnTypeSelect = document.getElementById('turnType');
            if (turnTypeSelect) {
                this.updateTurnTypeParams(turnTypeSelect.value);
            }
            // Initialize the display based on the selected traversal order
            const orderTypeSelect = document.getElementById('orderType');
            if (orderTypeSelect) {
                this.updateOrderTypeParams(orderTypeSelect.value);
            }
        }
    }

    /**
     * Update parameter display based on turn type
     */
    updateTurnTypeParams(turnType) {
        const headlandGroup = document.getElementById('headlandGroup');
        if (headlandGroup) {
            if (turnType === 'u_turn') {
                headlandGroup.style.display = 'block';
            } else {
                headlandGroup.style.display = 'none';
            }
        }
    }

    /**
     * Update parameter display based on traversal order
     */
    updateOrderTypeParams(orderType) {
        const corkscrewGroup = document.getElementById('corkscrewGroup');
        if (corkscrewGroup) {
            if (orderType === 'corkscrew') {
                corkscrewGroup.style.display = 'block';
            } else {
                corkscrewGroup.style.display = 'none';
            }
        }
    }

    /**
     * Handle a map click
     */
    handleMapClick(latlng) {
        this.mapController.handleMapClick(latlng, (action, data) => {
            if (action === 'finishSelectZone') {
                this.finishSelectZone(data);
            }
            this.updateAll();
        });
    }

    /**
     * Finish zone selection
     */
    finishSelectZone(points) {
        if (!points || points.length < 2) return;
        
        const origin = this.currentTrajectory.origin.coordinates;
        const indices = this.sectionController.getSectionsInBbox(
            this.currentTrajectory,
            points[0],
            points[1],
            (section) => this.mapView.getSectionLatLngPoints(section, origin)
        );
        
        this.selectedSectionIndices = indices;
        this.selectedSectionIndex = indices.length === 1 ? indices[0] : null;
        this.mapController.resetTempPoints();
        this.mapController.setEditMode('none', () => {
            // Show the edit panel if sections have been selected
            if (indices.length > 0) {
                this.panelView.showSectionEditPanelForSelection(indices, () => {
                    // Deselect sections and hide the edit panel
                    this.clearSectionSelection();
                    // Update the display
                    this.updateAll();
                });
            }
            
            // Update the display after showing the panel so buttons are displayed correctly
            this.updateAll();
        });
    }

    /**
     * Finish section selection (new method)
     * Show the edit panel with the selected sections
     */
    finishSelectSections() {
        if (!this.selectedSectionIndices || this.selectedSectionIndices.length === 0) {
            return;
        }
        
        // Exit selection mode
        this.mapController.setEditMode('none', () => {
            // Show the edit panel with the selected sections
            this.panelView.showSectionEditPanelForSelection(this.selectedSectionIndices, () => {
                // Deselect sections and hide the edit panel
                this.clearSectionSelection();
                // Update the display
                this.updateAll();
            });
            
            // Update the display after showing the panel so buttons are displayed correctly
            this.updateAll();
        });
    }

    /**
     * Deselect all sections and hide the edit panel
     */
    clearSectionSelection() {
        // Abort any in-progress 'extend_section' to avoid keeping a stale anchor / temp point
        // on the map once the section it was based on is no longer selected.
        if (this.mapController && this.mapController.getEditMode() === 'extend_section') {
            this.mapController.resetTempPoints();
            this.mapController.setExtendAnchor(null, null);
            this.mapController.setEditMode('none', () => {});
            this.extendDirection = null;
            if (this.panelView && typeof this.panelView.setExtendSectionUIState === 'function') {
                this.panelView.setExtendSectionUIState(false);
            }
        }
        // Hide the edit panel if it is open
        if (this.panelView) {
            this.panelView.hideSectionEditPanel();
        }
        // Deselect sections
        this.selectedSectionIndex = null;
        this.selectedSectionIndices = [];
    }

    /**
     * Update all views
     */
    updateAll() {
        const selectedIndices = this.sectionController.getSelectedIndices(
            this.selectedSectionIndex,
            this.selectedSectionIndices
        );
        
        // Update the panel
        this.panelView.updateTrajectoryProperties(this.currentTrajectory);
        this.panelView.updateSectionsList(
            this.currentTrajectory,
            selectedIndices,
            (index) => this.selectSection(index),
            (index) => this.showSectionEditDialog(index),
            (index) => this.deleteSection(index),
            (from, to) => this.reorderSection(from, to)
        );
        
        // Update the map with a callback for section clicks in select_zone mode
        const onSectionClick = this.mapController.getEditMode() === 'select_zone' 
            ? (index) => this.toggleSectionSelection(index) 
            : null;
        this.mapController.updateViews(this.currentTrajectory, selectedIndices, onSectionClick);
    }

    /**
     * Toggle section selection (select if unselected, deselect if selected)
     * @param {number} index - Section index
     */
    toggleSectionSelection(index) {
        if (!this.selectedSectionIndices) {
            this.selectedSectionIndices = [];
        }
        
        const currentIndex = this.selectedSectionIndices.indexOf(index);
        if (currentIndex === -1) {
            // Add to selection
            this.selectedSectionIndices.push(index);
        } else {
            // Remove from selection
            this.selectedSectionIndices.splice(currentIndex, 1);
        }
        
        // Update selectedSectionIndex if exactly one section is selected
        if (this.selectedSectionIndices.length === 1) {
            this.selectedSectionIndex = this.selectedSectionIndices[0];
        } else {
            this.selectedSectionIndex = null;
        }
        
        // Update the display
        this.updateAll();
    }

    /**
     * Select a section
     */
    selectSection(index) {
        this.selectedSectionIndex = this.selectedSectionIndex === index ? null : index;
        this.selectedSectionIndices = this.selectedSectionIndex !== null ? [this.selectedSectionIndex] : [];
        this.updateAll();
    }

    /**
     * Delete a section
     */
    deleteSection(index) {
        this.saveForUndo();
        this.currentTrajectory = this.sectionController.deleteSection(this.currentTrajectory, index);
        this.selectedSectionIndex = null;
        this.selectedSectionIndices = [];
        this.updateAll();
    }

    /**
     * Reorder sections via drag-and-drop in the side panel.
     * Updates the in-memory selection so a section that was selected before the move
     * stays selected at its new position, which matches the user's mental model.
     * @param {number} fromIndex - Original position of the dragged section
     * @param {number} toIndex - Target position (interpreted in the post-removal array)
     */
    reorderSection(fromIndex, toIndex) {
        if (!this.currentTrajectory || !Array.isArray(this.currentTrajectory.points)) return;
        const len = this.currentTrajectory.points.length;
        if (fromIndex < 0 || fromIndex >= len) return;
        const clampedTo = Math.max(0, Math.min(toIndex, len - 1));
        if (clampedTo === fromIndex) return;

        this.saveForUndo();
        this.currentTrajectory = this.sectionController.reorderSection(
            this.currentTrajectory,
            fromIndex,
            clampedTo
        );

        // Remap selections so they keep tracking the visually moved sections.
        const remap = (i) => {
            if (i === fromIndex) return clampedTo;
            if (fromIndex < i && i <= clampedTo) return i - 1;
            if (clampedTo <= i && i < fromIndex) return i + 1;
            return i;
        };
        if (Array.isArray(this.selectedSectionIndices) && this.selectedSectionIndices.length > 0) {
            this.selectedSectionIndices = this.selectedSectionIndices
                .map(remap)
                .sort((a, b) => a - b);
        }
        if (this.selectedSectionIndex !== null && this.selectedSectionIndex !== undefined) {
            this.selectedSectionIndex = remap(this.selectedSectionIndex);
        }

        this.updateAll();
        this.notificationService.show('notification.sectionReordered', 'success', 2000, {
            from: fromIndex + 1,
            to: clampedTo + 1
        });
    }

    /**
     * Show the section edit dialog
     */
    showSectionEditDialog(index) {
        // Select the section
        this.selectedSectionIndex = index;
        this.selectedSectionIndices = [index];
        
        // Reset rotation angle
        this.currentRotationAngle = 0;
        
        // Show the edit panel in the left panel
        this.panelView.showSectionEditPanel(this.currentTrajectory.points[index], index, () => {
            // Deselect sections and hide the edit panel
            this.clearSectionSelection();
            // Update the display
            this.updateAll();
        });
        
        // Update the display to show the selected section
        this.updateAll();
    }

    /**
     * Create a new trajectory
     */
    newTrajectory() {
        // Deselect sections and close the edit panel
        this.clearSectionSelection();
        
        // Reset edit mode (exit all modes)
        this.mapController.setEditMode('none', () => {});
        
        // Reset temporary points
        this.mapController.resetTempPoints();
        
        // Reset geofencing and the ruler if needed
        if (this.mapController) {
            // Reset geofencing in the trajectory
            if (this.currentTrajectory) {
                this.currentTrajectory.geofencing = null;
            }
            // Reset the ruler
            this.mapController.clearRuler(() => {});
        }
        
        // Create a new empty trajectory
        this.currentTrajectory = this.trajectoryController.createNewTrajectory();
        
        // Reset state
        this.selectedSectionIndex = null;
        this.selectedSectionIndices = [];
        this.undoStack = [];
        
        // Reset editing parameters
        this.moveStep = 0.5;
        this.rotationStep = 5;
        this.currentRotationAngle = 0;
        
        // Update all views
        this.updateAll();
    }

    /**
     * Sync editable panel properties to the current trajectory.
     * This avoids saving a stale in-memory value when the UI shows a default such as "v1".
     */
    syncTrajectoryPropertiesFromUI() {
        const fileNameInput = document.getElementById('fileName');
        let filename = fileNameInput ? fileNameInput.value.trim() : 'new_trajectory.json';
        if (!filename) {
            filename = 'new_trajectory.json';
        }
        // The exported file must always remain usable JSON for the application.
        if (!filename.toLowerCase().endsWith('.json')) {
            filename += '.json';
        }

        const vehicleIdInput = document.getElementById('vehicleId');
        const vehicleId = vehicleIdInput ? vehicleIdInput.value.trim() : '';

        const fileTypeSelect = document.getElementById('fileType');
        const fileType = fileTypeSelect ? fileTypeSelect.value : '';

        this.currentTrajectory.filename = filename;
        this.currentTrajectory.vehicle_id = vehicleId || 'v1';
        this.currentTrajectory.file_type = fileType || 'draft';
    }

    /**
     * Save locally
     */
    async saveTrajectoryLocal() {
        // Reread visible fields just before local export to align the JSON with the UI.
        this.syncTrajectoryPropertiesFromUI();
        // Enforce the origin invariant again because loaded or edited data may predate the creation checks.
        this.verifyAndRecalculateOriginBeforeSave();
        await this.trajectoryController.saveTrajectoryLocal(this.currentTrajectory);
    }

    /**
     * Save to plugin-registered cloud storage.
     */
    async saveTrajectoryCloud(storageType = 'cloud') {
        try {
            // Reread visible fields just before cloud upload to avoid stale in-memory state.
            this.syncTrajectoryPropertiesFromUI();
            // Apply the same origin normalization to every storage backend.
            this.verifyAndRecalculateOriginBeforeSave();

            // Save through the controller on the backend chosen by the plugin.
            await this.trajectoryController.saveTrajectoryCloud(this.currentTrajectory, storageType);
        } catch (error) {
            console.error('Erreur lors de la sauvegarde cloud:', error);
            this.notificationService.show('notification.saveCloudError', 'error', 5000, { error: error.message });
        }
    }

    /**
     * Show the cloud load dialog
     */
    showLoadCloudDialog(storageType = 'cloud') {
        const loadDialog = document.getElementById('loadDialog');
        if (loadDialog) {
            loadDialog.style.display = 'flex';
            // Load the trajectory list
            this.loadTrajectoriesList(storageType);
        }
    }

    /**
     * Load the trajectory list from the cloud
     */
    async loadTrajectoriesList(storageType = 'cloud') {
        const dialog = document.getElementById('loadDialog');
        const dialogTitle = document.querySelector('#loadDialog h3');
        const list = document.getElementById('trajectoriesList');
        const progressContainer = document.getElementById('loadDialogProgress');
        const progressBar = document.getElementById('progressBarFill');
        const progressText = document.getElementById('progressText');

        // Update the title
        if (window.i18n && dialogTitle) {
            if (storageType && storageType !== 'local') {
                dialogTitle.textContent = window.i18n.t('loadDialog.title.cloud');
            } else if (storageType === 'local') {
                dialogTitle.textContent = window.i18n.t('loadDialog.title.local');
            } else {
                dialogTitle.textContent = window.i18n.t('loadDialog.title.default');
            }
        }

        // Show the window and the progress view
        if (dialog) dialog.style.display = 'flex';
        if (list) list.innerHTML = '';
        if (progressContainer) progressContainer.style.display = 'block';
        if (progressBar) progressBar.style.width = '0%';
        if (progressText && window.i18n) {
            progressText.textContent = window.i18n.t('loadDialog.progress.loadingStructure');
        }

        try {
            // Load only metadata (names and structure), without content
            const url = storageType ? `/api/trajectories?storage=${storageType}&metadata=true` : '/api/trajectories?metadata=true';
            
            if (progressBar) progressBar.style.width = '30%';
            if (progressText && window.i18n) {
                progressText.textContent = window.i18n.t('loadDialog.progress.fetchingFiles');
            }

            const rawFolderStructure = await this.apiService.get(url);
            // Frontend tolerance: force a group array even if the response is a single object.
            const folderStructure = Array.isArray(rawFolderStructure)
                ? rawFolderStructure
                : (rawFolderStructure && typeof rawFolderStructure === 'object' ? [rawFolderStructure] : []);
            if (!Array.isArray(rawFolderStructure)) {
                console.warn('[Cloud] list response coerced to array, raw type=', typeof rawFolderStructure, rawFolderStructure);
            }

            if (progressBar) progressBar.style.width = '60%';
            if (progressText && window.i18n) {
                progressText.textContent = window.i18n.t('loadDialog.progress.organizingFiles');
            }

            if (progressBar) progressBar.style.width = '90%';
            if (progressText && window.i18n) {
                progressText.textContent = window.i18n.t('loadDialog.progress.displayingStructure');
            }

            // Build the explorer with progressive loading
            await this.buildFileExplorer(list, folderStructure, storageType, 1); // Level 1 only

            if (progressBar) progressBar.style.width = '100%';
            if (progressText && window.i18n) {
                progressText.textContent = window.i18n.t('loadDialog.progress.completed');
            }
            
            // Hide the progress view after a short delay
            setTimeout(() => {
                if (progressContainer) progressContainer.style.display = 'none';
            }, 500);

        } catch (error) {
            console.error('[Cloud] Erreur loadTrajectoriesList:', error);
            if (error && error.stack) {
                console.error('[Cloud] Stack:', error.stack);
            }
            console.error('[Cloud] storageType=', storageType);
            if (progressContainer) progressContainer.style.display = 'none';
            this.notificationService.show('notification.loadTrajectoriesError', 'error', 5000, { error: error.message });
            if (list) {
                const errorText = window.i18n ? window.i18n.t('notification.loadErrorText') : 'Erreur lors du chargement';
                list.innerHTML = `<p style="text-align: center; color: #e74c3c; padding: 20px;">${errorText}</p>`;
            }
        }
    }

    /**
     * Build the file explorer with progressive level-by-level loading
     */
    async buildFileExplorer(container, folderStructure, storageType, maxDepth = 1) {
        if (!container) return;
        
        container.innerHTML = '';

        if (!folderStructure || folderStructure.length === 0) {
            const noTrajectoriesText = window.i18n ? window.i18n.t('notification.noTrajectories') : 'Aucune trajectoire sauvegardée';
            container.innerHTML = `<p style="text-align: center; color: #7f8c8d; padding: 20px;">${noTrajectoriesText}</p>`;
            return;
        }

        // Build only level 1 (file types + first child level)
        // Each group is isolated so corrupt data does not block the whole list.
        for (const typeFolder of folderStructure) {
            try {
                if (!typeFolder || typeof typeFolder !== 'object') {
                    console.warn('[Cloud] Groupe invalide ignoré:', typeFolder);
                    continue;
                }
            // Create the main folder (file type)
            const typeFolderDiv = document.createElement('div');
            typeFolderDiv.className = 'trajectory-type-folder';

            const vehiclesMap = (typeFolder && typeof typeFolder.vehicles === 'object' && typeFolder.vehicles !== null)
                ? typeFolder.vehicles
                : {};
            const totalFiles = Object.values(vehiclesMap).reduce((sum, files) => {
                if (Array.isArray(files)) {
                    return sum + files.length;
                }
                // Unexpected data: skip cleanly instead of breaking the display.
                return sum;
            }, 0);

            const fileText = window.i18n ? (totalFiles > 1 ? window.i18n.t('fileExplorer.files') : window.i18n.t('fileExplorer.file')) : (totalFiles > 1 ? 'fichiers' : 'fichier');
            typeFolderDiv.innerHTML = `
                <div class="type-folder-header">
                    <i class="material-icons">folder</i>
                    <span class="folder-name">${typeFolder.type}</span>
                    <span class="folder-count">${totalFiles} ${fileText}</span>
                    <i class="material-icons expand-icon">expand_more</i>
                </div>
                <div class="type-folder-content" style="display: none;">
            `;

            const typeContentDiv = typeFolderDiv.querySelector('.type-folder-content');

            // Create subfolders by vehicle
            if (Object.keys(vehiclesMap).length > 0) {
                Object.entries(vehiclesMap).forEach(([vehicleId, files]) => {
                    try {
                    const normalizedFiles = Array.isArray(files)
                        ? files
                        : (files && typeof files === 'object' ? Object.values(files) : []);
                    if (normalizedFiles.length > 0) {
                        const vehicleFolderDiv = document.createElement('div');
                        vehicleFolderDiv.className = 'trajectory-vehicle-folder';

                        const vehicleText = window.i18n ? window.i18n.t('fileExplorer.vehicle', { vehicleId }) : `Véhicule: ${vehicleId}`;
                        const fileText2 = window.i18n ? (normalizedFiles.length > 1 ? window.i18n.t('fileExplorer.files') : window.i18n.t('fileExplorer.file')) : (normalizedFiles.length > 1 ? 'fichiers' : 'fichier');
                        vehicleFolderDiv.innerHTML = `
                            <div class="vehicle-folder-header">
                                <i class="material-icons">subdirectory_arrow_right</i>
                                <span class="folder-name">${vehicleText}</span>
                                <span class="folder-count">${normalizedFiles.length} ${fileText2}</span>
                                <i class="material-icons expand-icon">expand_more</i>
                            </div>
                            <div class="vehicle-folder-content" style="display: none;">
                        `;

                        const vehicleContentDiv = vehicleFolderDiv.querySelector('.vehicle-folder-content');

                        // Add vehicle files (filtered by storageType when specified)
                        normalizedFiles.forEach(traj => {
                            try {
                            if (!traj || typeof traj !== 'object') {
                                return;
                            }
                            // If storageType is specified, filter files
                            if (storageType && traj.storage !== storageType) {
                                return; // Do not display this file
                            }

                            const item = document.createElement('div');
                            item.className = 'trajectory-item';

                            // Display only metadata (not the full content)
                            const fileName = traj.fileName || traj.filename || 'trajectory.json';
                            const fileSize = traj.size ? this.formatFileSize(traj.size) : '';
                            const fileDate = traj.lastModified ? new Date(traj.lastModified).toLocaleDateString() : '';
                            const unknownDateText = window.i18n ? window.i18n.t('fileExplorer.unknownDate') : 'Date inconnue';
                            const loadText = window.i18n ? window.i18n.t('fileExplorer.load') : 'Charger';
                            const deleteText = window.i18n ? window.i18n.t('fileExplorer.delete') : 'Supprimer';

                            item.innerHTML = `
                                <div class="trajectory-info">
                                    <h4>${fileName}</h4>
                                    <p>${fileSize ? fileSize + ' • ' : ''}${fileDate || unknownDateText}</p>
                                </div>
                                <div class="trajectory-actions">
                                    <button class="trajectory-action load-btn" title="${loadText}">
                                        <i class="material-icons">cloud_download</i>
                                        <span class="btn-text">${loadText}</span>
                                    </button>
                                    <button class="trajectory-action delete-btn" title="${deleteText}">
                                        <i class="material-icons">delete</i>
                                        <span class="btn-text">${deleteText}</span>
                                    </button>
                                </div>
                            `;

                            item.querySelector('.load-btn').addEventListener('click', async () => {
                                // Load the full file content only now
                                const pathToUse = traj.actualPath || traj.fullPath || traj.filename;
                                if (pathToUse) {
                                    // Show a loading notification
                                    this.notificationService.show('notification.loadingFile', 'info', 2000);
                                    // Pass the original backend for unambiguous loading.
                                    await this.loadTrajectory(pathToUse, traj.storage || storageType || null);
                                    // Close the dialog after loading
                                    const loadDialog = document.getElementById('loadDialog');
                                    if (loadDialog) loadDialog.style.display = 'none';
                                } else {
                                    this.notificationService.show('notification.filePathError', 'error');
                                }
                            });

                            item.querySelector('.delete-btn').addEventListener('click', async () => {
                                const pathToUse = traj.actualPath || traj.fullPath || traj.filename;
                                if (pathToUse) {
                                    await this.deleteTrajectory(pathToUse, async () => {
                                        // Reload the list after deletion
                                        await this.loadTrajectoriesList(storageType);
                                    });
                                }
                            });

                            vehicleContentDiv.appendChild(item);
                            } catch (itemError) {
                                console.warn('[Cloud] Fichier invalide ignoré:', itemError, traj);
                            }
                        });

                        // Handler for the vehicle folder with on-demand loading
                        const vehicleHeader = vehicleFolderDiv.querySelector('.vehicle-folder-header');
                        const vehicleExpandIcon = vehicleFolderDiv.querySelector('.expand-icon');
                        
                        // Mark whether this folder has already been loaded
                        vehicleFolderDiv.dataset.loaded = 'false';

                        vehicleHeader.setAttribute('aria-expanded', 'false');
                        
                        vehicleHeader.addEventListener('click', async () => {
                            const isExpanded = vehicleContentDiv.style.display !== 'none';
                            
                            if (!isExpanded && vehicleFolderDiv.dataset.loaded === 'false') {
                                // First open: load children if needed
                                // For now, files are already loaded at level 1
                                // But sublevels could be loaded here if needed
                                vehicleFolderDiv.dataset.loaded = 'true';
                            }
                            
                            vehicleContentDiv.style.display = isExpanded ? 'none' : 'block';
                            vehicleExpandIcon.textContent = isExpanded ? 'expand_more' : 'expand_less';
                            vehicleHeader.setAttribute('aria-expanded', !isExpanded);
                        });

                        typeContentDiv.appendChild(vehicleFolderDiv);
                    }
                    } catch (vehicleError) {
                        console.warn('[Cloud] Sous-groupe véhicule invalide ignoré:', vehicleError, vehicleId, files);
                    }
                });
            }

            // Handler for the type folder
            const typeHeader = typeFolderDiv.querySelector('.type-folder-header');
            const typeExpandIcon = typeFolderDiv.querySelector('.expand-icon');
            typeHeader.setAttribute('aria-expanded', 'false');

            typeHeader.addEventListener('click', () => {
                const isExpanded = typeContentDiv.style.display !== 'none';
                typeContentDiv.style.display = isExpanded ? 'none' : 'block';
                typeExpandIcon.textContent = isExpanded ? 'expand_more' : 'expand_less';
                typeHeader.setAttribute('aria-expanded', !isExpanded);
            });

            container.appendChild(typeFolderDiv);
            } catch (groupError) {
                console.warn('[Cloud] Groupe type invalide ignoré:', groupError, typeFolder);
            }
        }
    }

    /**
     * Format a file size
     */
    formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    /**
     * Load a trajectory from the server
     */
    async loadTrajectory(filename, storageMode = null) {
        try {
            // Use the controller to load the trajectory
            this.currentTrajectory = await this.trajectoryController.loadTrajectory(filename, storageMode);
            // filename is defined in TrajectoryController (path basename); updateAll() syncs the panel

            // Update the interface
            this.selectedSectionIndex = null;
            this.selectedSectionIndices = [];
            this.mapController.setEditMode('none', () => {});
            this.mapController.resetTempPoints();
            this.undoStack = [];
            this.updateAll();

            // Center on the trajectory
            this.mapView.zoomToTrajectory(this.currentTrajectory);

        } catch (error) {
            console.error('Erreur lors du chargement:', error);
            // The error message is already handled and displayed in TrajectoryController.
            // Avoid a visual duplicate here.
        }
    }

    /**
     * Delete a trajectory
     */
    async deleteTrajectory(filename, onSuccess = null) {
        try {
            // Use ConfirmDialog (no callback, uses the default modal)
            await this.trajectoryController.deleteTrajectory(filename);
            
            if (onSuccess) {
                await onSuccess();
            }
        } catch (error) {
            console.error('Erreur lors de la suppression:', error);
            // The error is already handled by TrajectoryController
        }
    }

    /**
     * Load a local file
     */
    async loadLocalFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        try {
            const text = await file.text();
            this.currentTrajectory = JSON.parse(text);
            // Displayed name = file chosen on disk (the JSON may not contain filename after API export)
            this.currentTrajectory.filename = (file.name && file.name.trim()) || 'new_trajectory.json';

            // Update the interface
            this.selectedSectionIndex = null;
            this.selectedSectionIndices = [];
            this.mapController.setEditMode('none', () => {});
            this.mapController.resetTempPoints();
            this.undoStack = [];
            this.updateAll();
            
            // Center on the trajectory
            this.mapView.zoomToTrajectory(this.currentTrajectory);
            
            this.notificationService.show('notification.loadSuccess', 'success', 3000, { filename: file.name });
        } catch (error) {
            console.error('Erreur:', error);
            this.notificationService.show('notification.loadError', 'error', 5000, { error: error.message });
        }
    }

    /**
     * Save state for undo
     */
    saveForUndo() {
        this.undoStack.push(JSON.parse(JSON.stringify(this.currentTrajectory)));
    }

    /**
     * Verify the origin immediately before saving and rebase every stored point when needed.
     * A section has priority; when none exists, the first geofence point remains the reference.
     */
    verifyAndRecalculateOriginBeforeSave() {
        const currentOrigin = this.currentTrajectory.origin?.coordinates;
        if (!Number.isFinite(currentOrigin?.lat) || !Number.isFinite(currentOrigin?.lon)) {
            // Local x/y coordinates cannot be converted reliably without their previous origin.
            return;
        }

        const firstSection = this.currentTrajectory.points?.[0];
        const firstSectionRow = firstSection?.values?.[0];
        const sectionXIndex = firstSection?.columns?.indexOf('x') ?? -1;
        const sectionYIndex = firstSection?.columns?.indexOf('y') ?? -1;

        if (
            sectionXIndex >= 0 &&
            sectionYIndex >= 0 &&
            Number.isFinite(firstSectionRow?.[sectionXIndex]) &&
            Number.isFinite(firstSectionRow?.[sectionYIndex])
        ) {
            // Recover the first section point's GPS position before changing its local frame.
            const firstSectionLatLng = window.GeometryUtils.localToLatLng(
                {
                    x: firstSectionRow[sectionXIndex],
                    y: firstSectionRow[sectionYIndex]
                },
                currentOrigin
            );
            this.updateOriginFromFirstPoint(firstSectionLatLng);
            return;
        }

        // A geofence defines the temporary origin only while the trajectory has no section.
        if ((this.currentTrajectory.points || []).length > 0) {
            return;
        }

        const geofencing = this.currentTrajectory.geofencing;
        const firstGeofenceRow = geofencing?.values?.[0];
        const geofenceXIndex = geofencing?.columns?.indexOf('x') ?? -1;
        const geofenceYIndex = geofencing?.columns?.indexOf('y') ?? -1;
        if (
            geofenceXIndex < 0 ||
            geofenceYIndex < 0 ||
            !Number.isFinite(firstGeofenceRow?.[geofenceXIndex]) ||
            !Number.isFinite(firstGeofenceRow?.[geofenceYIndex])
        ) {
            return;
        }

        // Recover the first geofence point and normalize its origin with the same two-decimal rule.
        const firstGeofenceLatLng = window.GeometryUtils.localToLatLng(
            {
                x: firstGeofenceRow[geofenceXIndex],
                y: firstGeofenceRow[geofenceYIndex]
            },
            currentOrigin
        );
        this.updateOriginFromFirstPoint(firstGeofenceLatLng);
    }

    /**
     * Define the trajectory origin from the first geographic point of the new reference geometry.
     * Latitude and longitude intentionally keep the Agri format's existing two-decimal precision.
     * Existing local coordinates are rebased first so changing the reference does not move them.
     * @param {Object} latLng - Geographic point shaped as {lat, lng}
     */
    updateOriginFromFirstPoint(latLng) {
        if (!latLng || !Number.isFinite(latLng.lat) || !Number.isFinite(latLng.lng)) {
            return;
        }

        const currentCoordinates = this.currentTrajectory.origin?.coordinates || {
            lat: 48.8566,
            lon: 2.3522,
            alt: 0.0
        };
        const previousOrigin = {
            lat: currentCoordinates.lat,
            lon: currentCoordinates.lon
        };
        const nextOrigin = {
            lat: Math.round(latLng.lat * 100) / 100,
            lon: Math.round(latLng.lng * 100) / 100
        };

        // Avoid repeated round trips on every save when the reference is already normalized.
        const originChanged = previousOrigin.lat !== nextOrigin.lat || previousOrigin.lon !== nextOrigin.lon;
        if (originChanged) {
            // Preserve every existing geometry at the same GPS position when the local frame changes.
            this.rebaseLocalCoordinates(previousOrigin, nextOrigin);
        }

        this.currentTrajectory.origin = {
            ...(this.currentTrajectory.origin || {}),
            type: this.currentTrajectory.origin?.type || 'WGS84',
            coordinates: {
                ...currentCoordinates,
                lat: nextOrigin.lat,
                lon: nextOrigin.lon,
                alt: Number.isFinite(currentCoordinates.alt) ? currentCoordinates.alt : 0.0
            }
        };
    }

    /**
     * Re-express stored x/y values in a new local coordinate frame.
     * The conversion goes through latitude/longitude to preserve the geometry on the map.
     * @param {Object} previousOrigin - Previous {lat, lon} origin
     * @param {Object} nextOrigin - New {lat, lon} origin
     */
    rebaseLocalCoordinates(previousOrigin, nextOrigin) {
        if (!Number.isFinite(previousOrigin?.lat) || !Number.isFinite(previousOrigin?.lon)) {
            return;
        }

        const rebasePoint = (x, y) => {
            const latLng = window.GeometryUtils.localToLatLng({ x, y }, previousOrigin);
            const local = window.GeometryUtils.latLngToLocal(latLng, nextOrigin);
            return {
                x: window.GeometryUtils.round3(local.x),
                y: window.GeometryUtils.round3(local.y)
            };
        };

        // Sections normally are empty here, but handling them keeps this origin update safe to reuse.
        (this.currentTrajectory.points || []).forEach((section) => {
            const xIndex = section.columns?.indexOf('x') ?? -1;
            const yIndex = section.columns?.indexOf('y') ?? -1;
            if (xIndex < 0 || yIndex < 0 || !Array.isArray(section.values)) {
                return;
            }

            section.values.forEach((row) => {
                if (!Number.isFinite(row[xIndex]) || !Number.isFinite(row[yIndex])) {
                    return;
                }
                const rebased = rebasePoint(row[xIndex], row[yIndex]);
                row[xIndex] = rebased.x;
                row[yIndex] = rebased.y;
            });
        });

        // A geofence can exist before the first section and must not jump when that section changes the origin.
        const geofencing = this.currentTrajectory.geofencing;
        const geofenceXIndex = geofencing?.columns?.indexOf('x') ?? -1;
        const geofenceYIndex = geofencing?.columns?.indexOf('y') ?? -1;
        if (geofenceXIndex < 0 || geofenceYIndex < 0 || !Array.isArray(geofencing.values)) {
            return;
        }

        geofencing.values.forEach((row) => {
            if (!Number.isFinite(row[geofenceXIndex]) || !Number.isFinite(row[geofenceYIndex])) {
                return;
            }
            const rebased = rebasePoint(row[geofenceXIndex], row[geofenceYIndex]);
            row[geofenceXIndex] = rebased.x;
            row[geofenceYIndex] = rebased.y;
        });
    }

    /**
     * Undo the last action
     */
    undo() {
        if (this.undoStack.length > 0) {
            this.currentTrajectory = this.undoStack.pop();
            this.selectedSectionIndex = null;
            this.selectedSectionIndices = [];
            this.updateAll();
        }
    }

    /**
     * Finish the current action
     */
    finishCurrentAction() {
        const mode = this.mapController.getEditMode();
        const tempPoints = this.mapController.getTempPoints();
        
        if (mode === 'draw_line' && tempPoints.length >= 2) {
            this.finishDrawLine();
        } else if (mode === 'draw_parcel' && tempPoints.length >= 3) {
            this.finishDrawParcel();
        }
    }

    /**
     * Finish the line
     */
    finishDrawLine() {
        const tempPoints = this.mapController.getTempPoints();
        if (tempPoints.length < 2) return;
        
        // Check limits
        const estimatedPoints = window.GeometryUtils.estimatePointsForSegment(
            tempPoints,
            0.1,
            this.currentTrajectory.origin.coordinates
        );
        const currentTotal = this.sectionController.getTotalPointsCount(this.currentTrajectory);
        
        if (estimatedPoints > this.MAX_POINTS_PER_SECTION) {
            this.notificationService.show(
                'notification.pointsLimitExceeded',
                'error',
                5000,
                {
                    estimatedPoints: estimatedPoints.toLocaleString(),
                    maxPoints: this.MAX_POINTS_PER_SECTION.toLocaleString()
                }
            );
            return;
        }
        
        if (currentTotal + estimatedPoints > this.MAX_POINTS_PER_TRAJECTORY) {
            this.notificationService.show(
                'notification.trajectoryLimitExceeded',
                'error',
                5000,
                { maxPoints: this.MAX_POINTS_PER_TRAJECTORY.toLocaleString() }
            );
            return;
        }
        
        this.saveForUndo();
        
        // Every new first section defines the origin, including after all previous sections were deleted.
        if (this.currentTrajectory.points.length === 0) {
            this.updateOriginFromFirstPoint(tempPoints[0]);
        }
        
        // Generate points (simplified - use the existing logic if needed)
        try {
            const points = this.generatePointsWithSpacing(tempPoints, 0.1);
            
            const newSection = {
                section_type: "row_path",
                columns: ["x", "y", "speed", "working_zone", "punctual"],
                values: points.map(point => [
                    point.x.value,
                    point.y.value,
                    point.speed.value,
                    point.working_zone.value,
                    point.punctual && point.punctual.value !== undefined ? point.punctual.value : {}
                ])
            };
            
            this.currentTrajectory.points.push(newSection);
            this.mapController.resetTempPoints();
            this.mapController.setEditMode('none', () => {});
            this.updateAll();
        } catch (error) {
            this.notificationService.show('notification.generateError', 'error', 5000, { error: error.message });
        }
    }

    /**
     * Generate points with spacing
     */
    generatePointsWithSpacing(latLngPoints, spacing) {
        if (latLngPoints.length < 2) return [];
        
        const points = [];
        const origin = this.currentTrajectory.origin.coordinates;
        
        for (let i = 0; i < latLngPoints.length - 1; i++) {
            const p1 = latLngPoints[i];
            const p2 = latLngPoints[i + 1];
            
            const local1 = window.GeometryUtils.latLngToLocal(p1, origin);
            const local2 = window.GeometryUtils.latLngToLocal(p2, origin);
            
            const dx = local2.x - local1.x;
            const dy = local2.y - local1.y;
            const segmentLength = Math.sqrt(dx * dx + dy * dy);
            
            if (segmentLength > 0) {
                if (i === 0) {
                    points.push({
                        x: { value: window.GeometryUtils.round3(local1.x) },
                        y: { value: window.GeometryUtils.round3(local1.y) },
                        speed: { value: 0.5 },
                        working_zone: { value: 1 },
                        punctual: { value: {} }
                    });
                }
                
                const numPoints = Math.floor(segmentLength / spacing);
                for (let j = 1; j <= numPoints; j++) {
                    const t = (j * spacing) / segmentLength;
                    if (t < 1.0) {
                        const x = local1.x + t * dx;
                        const y = local1.y + t * dy;
                        points.push({
                            x: { value: window.GeometryUtils.round3(x) },
                            y: { value: window.GeometryUtils.round3(y) },
                            speed: { value: 0.5 },
                            working_zone: { value: 1 },
                            punctual: { value: {} }
                        });
                    }
                }
            }
        }
        
        // Last point
        const lastPoint = latLngPoints[latLngPoints.length - 1];
        const lastLocal = window.GeometryUtils.latLngToLocal(lastPoint, origin);
        points.push({
            x: { value: window.GeometryUtils.round3(lastLocal.x) },
            y: { value: window.GeometryUtils.round3(lastLocal.y) },
            speed: { value: 0.5 },
            working_zone: { value: 1 },
            punctual: { value: {} }
        });
        
        return points;
    }

    /**
     * Finish parcel drawing
     */
    finishDrawParcel() {
        const tempPoints = this.mapController.getTempPoints();
        if (tempPoints.length >= 3) {
            document.getElementById('fillParcelDialog').style.display = 'flex';
        }
    }

    /**
     * Finish parcel fill
     */
    finishFillParcel(spacing) {
        const tempPoints = this.mapController.getTempPoints();
        if (tempPoints.length >= 3) {
            // Check limits before generating
            const origin = this.currentTrajectory.origin.coordinates;
            const parcelXY = tempPoints.map(p => ({
                x: (p.lng - origin.lon) * 111320 * Math.cos(origin.lat * Math.PI / 180),
                y: (p.lat - origin.lat) * 111320
            }));

            // Calculate the direction of the first side
            const dx = parcelXY[1].x - parcelXY[0].x;
            const dy = parcelXY[1].y - parcelXY[0].y;
            const firstSideLength = Math.sqrt(dx * dx + dy * dy);
            const dirX = dx / firstSideLength;
            const dirY = dy / firstSideLength;

            // Perpendicular
            const perpX = -dirY;
            const perpY = dirX;

            // Find the limits
            let minPerp = Infinity;
            let maxPerp = -Infinity;
            parcelXY.forEach(p => {
                const perpDist = p.x * perpX + p.y * perpY;
                minPerp = Math.min(minPerp, perpDist);
                maxPerp = Math.max(maxPerp, perpDist);
            });

            // Estimate the number of lines
            const estimatedLines = Math.floor((maxPerp - minPerp) / spacing);
            const avgLineLength = firstSideLength;
            const estimatedPointsPerLine = Math.floor(avgLineLength / 0.1);
            const totalEstimatedPoints = estimatedLines * estimatedPointsPerLine;
            const currentTotal = this.getTotalPointsCount();

            if (totalEstimatedPoints > this.MAX_POINTS_PER_TRAJECTORY) {
                this.notificationService.show(
                    'notification.parcelFillLimitExceeded',
                    'error',
                    5000,
                    {
                        totalPoints: totalEstimatedPoints.toLocaleString(),
                        maxPoints: this.MAX_POINTS_PER_TRAJECTORY.toLocaleString(),
                        spacing: spacing
                    }
                );
                return;
            }

            if (currentTotal + totalEstimatedPoints > this.MAX_POINTS_PER_TRAJECTORY) {
                this.notificationService.show(
                    'notification.parcelFillTrajectoryLimit',
                    'error',
                    5000,
                    {
                        maxPoints: this.MAX_POINTS_PER_TRAJECTORY.toLocaleString(),
                        currentTotal: currentTotal.toLocaleString()
                    }
                );
                return;
            }

            this.saveForUndo();

            // The first clicked parcel point defines the origin when this creates the first sections.
            if (this.currentTrajectory.points.length === 0) {
                this.updateOriginFromFirstPoint(tempPoints[0]);
            }

            // Generate parallel lines
            try {
                const sections = this.generateParallelLines(tempPoints, spacing);
                const currentTotal = this.getTotalPointsCount();

                sections.forEach(section => {
                    const sectionPoints = section.points ? section.points.length : 0;
                    
                    if (sectionPoints > this.MAX_POINTS_PER_SECTION) {
                        const errorMsg = window.i18n ? window.i18n.t('error.sectionLimitExceeded', {
                            sectionPoints: sectionPoints.toLocaleString(),
                            maxPoints: this.MAX_POINTS_PER_SECTION.toLocaleString()
                        }) : `Une section générerait ${sectionPoints.toLocaleString()} points, ce qui dépasse la limite de ${this.MAX_POINTS_PER_SECTION.toLocaleString()} points par section`;
                        throw new Error(errorMsg);
                    }

                    const newTotal = currentTotal + sectionPoints;
                    if (newTotal > this.MAX_POINTS_PER_TRAJECTORY) {
                        const errorMsg = window.i18n ? window.i18n.t('error.trajectoryLimitExceeded', {
                            maxPoints: this.MAX_POINTS_PER_TRAJECTORY.toLocaleString()
                        }) : `L'ajout de cette section dépasserait la limite de ${this.MAX_POINTS_PER_TRAJECTORY.toLocaleString()} points pour la trajectoire complète`;
                        throw new Error(errorMsg);
                    }

                    // Convert to Android format
                    const androidSection = {
                        section_type: section.sectionType.value,
                        columns: section.columns,
                        values: section.points.map(point => [
                            point.x.value,
                            point.y.value,
                            point.speed.value,
                            point.working_zone.value,
                            point.punctual && point.punctual.value !== undefined ? point.punctual.value : {}
                        ])
                    };
                    this.currentTrajectory.points.push(androidSection);
                });

                this.mapController.resetTempPoints();
                this.mapController.setEditMode('none', () => {});
                this.updateAll();
                document.getElementById('fillParcelDialog').style.display = 'none';
            } catch (error) {
                this.notificationService.show('notification.parcelFillGenerateError', 'error', 5000, { error: error.message });
            }
        }
    }

    /**
     * Finish geofencing
     */
    finishGeofence() {
        const tempPoints = this.mapController.getTempPoints();
        if (tempPoints.length >= 3) {
            this.saveForUndo();

            // Until a section exists, the geofence's first click temporarily defines the local origin.
            // Adding the first section later will replace it and rebase this polygon automatically.
            if (this.currentTrajectory.points.length === 0) {
                this.updateOriginFromFirstPoint(tempPoints[0]);
            }

            const origin = this.currentTrajectory.origin.coordinates;
            const values = tempPoints.map(p => [
                window.GeometryUtils.round3((p.lng - origin.lon) * 111320 * Math.cos(origin.lat * Math.PI / 180)),
                window.GeometryUtils.round3((p.lat - origin.lat) * 111320)
            ]);
            this.currentTrajectory.geofencing = {
                columns: ["x", "y"],
                values: values
            };
            this.mapController.resetTempPoints();
            this.mapController.setEditMode('none', () => {});
            this.updateAll();
        }
    }

    /**
     * Finish working zone editing
     */
    finishEditWorkingZone() {
        const tempPoints = this.mapController.getTempPoints();
        if (tempPoints.length >= 3) {
            document.getElementById('workingZoneEditDialog').style.display = 'flex';
        }
    }

    /**
     * Cancel the current edit action without applying drawn points
     */
    cancelCurrentEditAction() {
        const fillParcelDialog = document.getElementById('fillParcelDialog');
        if (fillParcelDialog) {
            fillParcelDialog.style.display = 'none';
        }

        const workingZoneEditDialog = document.getElementById('workingZoneEditDialog');
        if (workingZoneEditDialog) {
            workingZoneEditDialog.style.display = 'none';
        }

        const deletePointsZoneDialog = document.getElementById('deletePointsZoneDialog');
        if (deletePointsZoneDialog) {
            deletePointsZoneDialog.style.display = 'none';
        }

        // Temporary points are only a preview: removing them is enough to abandon the action.
        this.mapController.resetTempPoints();
        this.mapController.setEditMode('none', () => {});
        this.updateAll();
    }

    /**
     * Open the dialog to edit the speed for the whole trajectory.
     * Pre-fill the input with the speed of the first point that has one (when uniform),
     * otherwise fall back to the input default value already present in the template.
     */
    showEditSpeedDialog() {
        const dialog = document.getElementById('editSpeedDialog');
        if (!dialog) return;

        const input = document.getElementById('editSpeedValue');
        if (input) {
            const currentSpeed = this.getCurrentTrajectorySpeed();
            if (currentSpeed !== null) {
                input.value = currentSpeed;
            }
        }

        dialog.style.display = 'flex';
        this.updateTranslations();
        if (input) {
            // Defer focus so the dialog has time to render before selecting the input contents.
            window.requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
        }
    }

    /**
     * Return the trajectory speed if every point shares the same value, otherwise null.
     * Used to seed the speed dialog with a meaningful default when possible.
     */
    getCurrentTrajectorySpeed() {
        const sections = this.currentTrajectory && this.currentTrajectory.points;
        if (!sections || sections.length === 0) return null;

        let unique = null;
        for (const section of sections) {
            const speedIndex = section.columns ? section.columns.indexOf('speed') : -1;
            if (speedIndex === -1 || !Array.isArray(section.values)) continue;
            for (const row of section.values) {
                const value = row[speedIndex];
                if (typeof value !== 'number') continue;
                if (unique === null) {
                    unique = value;
                } else if (unique !== value) {
                    return null;
                }
            }
        }
        return unique;
    }

    /**
     * Validate the dialog input and apply the new speed to every point.
     */
    confirmEditSpeed() {
        const input = document.getElementById('editSpeedValue');
        const dialog = document.getElementById('editSpeedDialog');
        if (!input) return;

        const value = parseFloat(input.value);
        if (!Number.isFinite(value) || value < 0 || value > 50) {
            this.notificationService.show('notification.speedInvalid', 'warning', 3000);
            return;
        }

        this.saveForUndo();
        const count = this.applySpeedToAllPoints(value);

        if (dialog) dialog.style.display = 'none';
        this.updateAll();

        if (count > 0) {
            this.notificationService.show('notification.speedUpdated', 'success', 3000, { count, value });
        } else {
            this.notificationService.show('notification.speedNoPoints', 'warning', 3000);
        }
    }

    /**
     * Overwrite the 'speed' column on every row of every section that exposes it.
     * Sections without a 'speed' column are ignored to keep the data model untouched.
     */
    applySpeedToAllPoints(value) {
        let count = 0;
        const sections = this.currentTrajectory && this.currentTrajectory.points;
        if (!sections) return 0;

        sections.forEach((section) => {
            const speedIndex = section.columns ? section.columns.indexOf('speed') : -1;
            if (speedIndex === -1 || !Array.isArray(section.values)) return;
            section.values.forEach((row) => {
                row[speedIndex] = value;
                count++;
            });
        });
        return count;
    }

    /**
     * Confirm working zone editing
     */
    confirmWorkingZoneEdit(value) {
        document.getElementById('workingZoneEditDialog').style.display = 'none';
        if (value !== 0 && value !== 1) return;

        this.saveForUndo();
        const tempPoints = this.mapController.getTempPoints();
        const polygon = this.getPolygonLocalFromLatLngs(tempPoints);
        const count = this.applyWorkingZoneInPolygon(polygon, value);

        this.mapController.resetTempPoints();
        this.mapController.setEditMode('none', () => {});
        this.updateAll();

        if (count > 0) {
            this.notificationService.show('notification.workingZoneUpdated', 'success', 3000, { count, value });
        }
    }

    /**
     * Enter the 'extend_section' edit mode for the currently selected section.
     * Resolves the anchor (start or end of the section in lat/lng), wires it on the MapController,
     * and flips the section edit panel into its "active extension" UI so Apply/Cancel become visible.
     * @param {'start'|'end'} direction
     */
    startExtendSection(direction) {
        if (this.selectedSectionIndex === null || this.selectedSectionIndex === undefined) {
            return;
        }
        const section = this.currentTrajectory.points[this.selectedSectionIndex];
        if (!section || !section.columns || !Array.isArray(section.values) || section.values.length === 0) {
            return;
        }
        const xIdx = section.columns.indexOf('x');
        const yIdx = section.columns.indexOf('y');
        if (xIdx === -1 || yIdx === -1) {
            return;
        }

        const anchorRow = direction === 'start'
            ? section.values[0]
            : section.values[section.values.length - 1];
        const origin = this.currentTrajectory.origin.coordinates;
        const anchorLatLng = window.GeometryUtils.localToLatLng(
            { x: anchorRow[xIdx], y: anchorRow[yIdx] },
            origin
        );

        this.extendDirection = direction;
        // Force activation of the mode (toggle behaviour would otherwise turn it off when called twice).
        this.mapController.setEditMode('none', () => {});
        this.mapController.setEditMode('extend_section', () => this.updateAll());
        this.mapController.setExtendAnchor(
            L.latLng(anchorLatLng.lat, anchorLatLng.lng),
            (tempPoints) => this._refreshExtendSectionUI(tempPoints)
        );

        if (this.panelView && typeof this.panelView.setExtendSectionUIState === 'function') {
            this.panelView.setExtendSectionUIState(true);
        }
        this._refreshExtendSectionUI([]);
        this.updateAll();
    }

    /**
     * Cancel the current extension preview without touching the trajectory.
     */
    cancelExtendSection() {
        this.mapController.resetTempPoints();
        this.mapController.setExtendAnchor(null, null);
        this.mapController.setEditMode('none', () => {});
        this.extendDirection = null;
        if (this.panelView && typeof this.panelView.setExtendSectionUIState === 'function') {
            this.panelView.setExtendSectionUIState(false);
        }
        this.updateAll();
    }

    /**
     * Validate the current extension preview: insert the generated points into the section.
     */
    finishExtendSection() {
        if (this.mapController.getEditMode() !== 'extend_section') return;
        if (this.selectedSectionIndex === null || this.selectedSectionIndex === undefined) return;
        if (!this.extendDirection) return;

        const tempPoints = this.mapController.getTempPoints();
        if (!tempPoints || tempPoints.length === 0) return;

        const targetLatLng = tempPoints[0];
        const sectionIndex = this.selectedSectionIndex;
        const direction = this.extendDirection;

        this.saveForUndo();
        const added = this.applySectionExtension(sectionIndex, direction, targetLatLng, 0.1);

        if (added <= 0) {
            // Either too close to the anchor or a hard limit was hit (notification already shown).
            if (added === 0) {
                this.notificationService.show('notification.extendTooShort', 'warning', 3000);
            }
            return;
        }

        this.mapController.resetTempPoints();
        this.mapController.setExtendAnchor(null, null);
        this.mapController.setEditMode('none', () => {});
        this.extendDirection = null;
        if (this.panelView && typeof this.panelView.setExtendSectionUIState === 'function') {
            this.panelView.setExtendSectionUIState(false);
        }
        this.updateAll();

        this.notificationService.show('notification.sectionExtended', 'success', 3000, {
            count: added,
            direction: direction
        });
    }

    /**
     * Insert intermediate points (spacing in meters) between the existing section endpoint and
     * the user-placed target, then add the target as the final new endpoint.
     * Intermediate rows clone the anchor row (so speed / working_zone / punctual stay coherent),
     * only x and y are recomputed.
     * @returns {number} Number of rows added. 0 if too close to the anchor, -1 if a hard limit was hit.
     */
    applySectionExtension(sectionIndex, direction, targetLatLng, spacing = 0.1) {
        const section = this.currentTrajectory.points[sectionIndex];
        if (!section || !section.columns || !Array.isArray(section.values) || section.values.length === 0) {
            return 0;
        }
        const xIdx = section.columns.indexOf('x');
        const yIdx = section.columns.indexOf('y');
        if (xIdx === -1 || yIdx === -1) return 0;

        const anchorRow = direction === 'start'
            ? section.values[0]
            : section.values[section.values.length - 1];
        const anchorXY = { x: anchorRow[xIdx], y: anchorRow[yIdx] };

        const origin = this.currentTrajectory.origin.coordinates;
        const targetLocal = window.GeometryUtils.latLngToLocal(targetLatLng, origin);

        const dx = targetLocal.x - anchorXY.x;
        const dy = targetLocal.y - anchorXY.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < spacing) {
            // Picked point coincides with the anchor: nothing meaningful to add.
            return 0;
        }

        const safeSpacing = spacing > 0 ? spacing : 0.1;
        const numIntermediates = Math.floor(length / safeSpacing);
        const estimatedAdded = numIntermediates + 1; // +1 for the exact target point

        // Hard limits guard: keep this consistent with finishDrawLine behaviour.
        const currentTotal = this.getTotalPointsCount();
        const currentSectionSize = section.values.length;
        if (currentSectionSize + estimatedAdded > this.MAX_POINTS_PER_SECTION) {
            this.notificationService.show(
                'notification.pointsLimitExceeded',
                'error',
                5000,
                {
                    estimatedPoints: (currentSectionSize + estimatedAdded).toLocaleString(),
                    maxPoints: this.MAX_POINTS_PER_SECTION.toLocaleString()
                }
            );
            return -1;
        }
        if (currentTotal + estimatedAdded > this.MAX_POINTS_PER_TRAJECTORY) {
            this.notificationService.show(
                'notification.trajectoryLimitExceeded',
                'error',
                5000,
                { maxPoints: this.MAX_POINTS_PER_TRAJECTORY.toLocaleString() }
            );
            return -1;
        }

        // Build new rows ordered from "closest to anchor" → "target".
        const newRows = [];
        for (let j = 1; j <= numIntermediates; j++) {
            const t = (j * safeSpacing) / length;
            if (t >= 1.0) break;
            const x = anchorXY.x + t * dx;
            const y = anchorXY.y + t * dy;
            newRows.push(this._cloneRowWithXY(anchorRow, x, y, xIdx, yIdx));
        }
        // Always add the exact target so the placed endpoint matches what the user dragged.
        newRows.push(this._cloneRowWithXY(anchorRow, targetLocal.x, targetLocal.y, xIdx, yIdx));

        if (direction === 'start') {
            // Reverse so the target becomes the new very first point of the section.
            section.values = newRows.reverse().concat(section.values);
        } else {
            section.values = section.values.concat(newRows);
        }

        return newRows.length;
    }

    /**
     * Deep-clone a row and overwrite its x/y cells with rounded local coordinates.
     * Object cells (e.g. punctual) are cloned via JSON to avoid sharing references.
     * @private
     */
    _cloneRowWithXY(row, x, y, xIdx, yIdx) {
        const cloned = row.map((cell) => {
            if (cell !== null && typeof cell === 'object') {
                return JSON.parse(JSON.stringify(cell));
            }
            return cell;
        });
        cloned[xIdx] = window.GeometryUtils.round3(x);
        cloned[yIdx] = window.GeometryUtils.round3(y);
        return cloned;
    }

    /**
     * Refresh the distance label and Apply button state in the section edit panel.
     * Called both from MapController click/drag callbacks and from startExtendSection.
     * @private
     */
    _refreshExtendSectionUI(tempPoints) {
        const distanceEl = document.getElementById('panelExtendSectionDistance');
        const applyBtn = document.getElementById('panelExtendSectionApply');

        if (!tempPoints || tempPoints.length === 0) {
            if (distanceEl) distanceEl.textContent = '--';
            if (applyBtn) applyBtn.disabled = true;
            return;
        }

        const anchor = this.mapController.extendAnchor;
        if (!anchor) {
            if (distanceEl) distanceEl.textContent = '--';
            if (applyBtn) applyBtn.disabled = true;
            return;
        }

        const dist = window.GeometryUtils.getDistanceMeters
            ? window.GeometryUtils.getDistanceMeters(anchor, tempPoints[0])
            : 0;
        if (distanceEl) distanceEl.textContent = `${dist.toFixed(2)} m`;
        if (applyBtn) applyBtn.disabled = dist <= 0;
    }

    /**
     * Finish delete-points-by-zone
     */
    finishDeletePointsZone() {
        const tempPoints = this.mapController.getTempPoints();
        if (tempPoints.length < 3) return;
        const polygon = this.getPolygonLocalFromLatLngs(tempPoints);
        const pointsInZone = this.getPointsInPolygon(polygon);
        const count = pointsInZone.length;
        document.getElementById('deletePointsZoneCount').textContent = count;
        document.getElementById('deletePointsZoneDialog').style.display = 'flex';
    }

    /**
     * Confirm deleting points inside the zone
     */
    confirmDeletePointsInZone() {
        document.getElementById('deletePointsZoneDialog').style.display = 'none';
        const tempPoints = this.mapController.getTempPoints();
        const polygon = this.getPolygonLocalFromLatLngs(tempPoints);
        const pointsToDelete = this.getPointsInPolygon(polygon);
        if (pointsToDelete.length === 0) {
            this.mapController.resetTempPoints();
            this.mapController.setEditMode('none', () => {});
            this.updateAll();
            return;
        }
        this.saveForUndo();
        this.currentTrajectory.points = this.buildSectionsAfterDelete(pointsToDelete);
        this.mapController.resetTempPoints();
        this.mapController.setEditMode('none', () => {});
        this.selectedSectionIndex = null;
        this.selectedSectionIndices = [];
        this.updateAll();
        this.notificationService.show('notification.pointsDeleted', 'success', 3000, { count: pointsToDelete.length });
    }

    /**
     * Finish the polygon-based section selection: turn every section that has at least one point
     * inside the drawn polygon into a selected section, then switch to the standard 'select_zone'
     * mode so the existing "Finish Selection (X)" / "Delete Selected" buttons appear and the user
     * can refine the selection by clicking individual sections if needed.
     */
    finishSelectSectionsPolygon() {
        if (this.mapController.getEditMode() !== 'select_sections_polygon') return;

        const tempPoints = this.mapController.getTempPoints();
        if (!tempPoints || tempPoints.length < 3) return;

        const polygon = this.getPolygonLocalFromLatLngs(tempPoints);
        const pointsInZone = this.getPointsInPolygon(polygon);

        // Sections with at least one point inside the zone are considered selected.
        const selected = new Set();
        pointsInZone.forEach(({ sectionIndex }) => selected.add(sectionIndex));
        this.selectedSectionIndices = Array.from(selected).sort((a, b) => a - b);
        this.selectedSectionIndex = this.selectedSectionIndices.length === 1
            ? this.selectedSectionIndices[0]
            : null;

        // Drop the temporary polygon and switch to the regular select_zone mode so the existing
        // validation UI takes over (finish selection / delete selected).
        this.mapController.resetTempPoints();
        this.mapController.setEditMode('select_zone', () => this.updateAll());
        this.updateAll();

        if (this.selectedSectionIndices.length === 0) {
            this.notificationService.show('notification.sectionsSelectedZoneEmpty', 'warning', 3000);
        } else {
            this.notificationService.show(
                'notification.sectionsSelectedByZone',
                'success',
                3000,
                { count: this.selectedSectionIndices.length }
            );
        }
    }

    /**
     * Clear geofencing
     */
    clearGeofence() {
        this.saveForUndo();
        this.currentTrajectory.geofencing = null;
        this.mapController.resetTempPoints();
        this.updateAll();
    }

    /**
     * Connect turns with parameters
     */
    connectTurnsWithParams() {
        // Existing turn sections are connectors, not rows. Count only non-turn
        // sections when deciding whether another connection pass is possible.
        const sourceSections = this.currentTrajectory.points || [];
        const sourceRowSections = sourceSections.filter(
            (section) => !this.isTurnSection(section)
        );
        if (sourceRowSections.length < 2) {
            this.notificationService.show('notification.minSectionsRequired', 'warning');
            return;
        }

        this.saveForUndo();

        const loopCheckbox = document.getElementById('connectTurnsLoop');
        const params = {
            turnType: document.getElementById('turnType').value,
            rowSpeed: parseFloat(document.getElementById('rowSpeed').value) || 0.5,
            spaceIn: parseFloat(document.getElementById('spaceIn').value) || 1.0,
            spaceOut: parseFloat(document.getElementById('spaceOut').value) || 1.0,
            headlandSpace: parseFloat(document.getElementById('headlandSpace').value) || 2.0,
            reverseRows: document.getElementById('reverseRows').classList.contains('active'),
            reverseSide: document.getElementById('reverseSide').classList.contains('active'),
            skipRows: parseInt(document.getElementById('skipRows').value) || 0,
            orderType: document.getElementById('orderType').value,
            corkscrewJump: parseInt(document.getElementById('corkscrewJump').value) || 2,
            // Loop: false by default (checkbox unchecked)
            loop: loopCheckbox ? loopCheckbox.checked : false
        };

        // Keep existing connectors aside: transformations and ordering apply only
        // to actual rows. A compatible connector is reinserted later when its two
        // endpoint rows are still consecutive.
        const existingTurnSections = sourceSections.filter(
            (section) => this.isTurnSection(section)
        );
        const usedExistingTurnIndexes = new Set();

        // Apply transformations
        let workingSections = sourceRowSections.map(section => ({ ...section }));

        // Reverse rows when requested
        if (params.reverseRows) {
            workingSections = workingSections.map(section => this.reverseSection(section));
        }

        // Reverse order when requested
        if (params.reverseSide) {
            workingSections = workingSections.reverse();
        }

        // Skip rows
        if (params.skipRows > 0) {
            workingSections = workingSections.filter((_, index) => index % (params.skipRows + 1) === 0);
            if (params.skipRows % 2 === 1) {
                workingSections = workingSections.map((section, index) =>
                    index % 2 === 1 ? this.reverseSection(section) : section
                );
            }
        }

        // Apply traversal order (snake or corkscrew)
        if (params.orderType === 'snake') {
            workingSections = this.applySnakeOrder(workingSections);
        } else if (params.orderType === 'corkscrew') {
            workingSections = this.applyCorkscrewOrder(workingSections, params.corkscrewJump);
        }

        // Row lines: convert row_line to row_path with intermediate points every 10 cm (like turn_path)
        workingSections = workingSections.map((s) =>
            this.densifyRowLineSectionToRowPath(s, TURN_PATH_SPACING_M)
        );

        // Generate turns: unified column order (union) so working_zone is not overwritten
        // when file column order differs (e.g. working_zone before speed on row_path).
        const finalSections = [];
        // Collect every failed U-turn so one actionable notification can summarize
        // all missing connections without interrupting generation at the first error.
        const uTurnFailures = [];
        let mergedColumns = this.mergeConnectTurnColumns(workingSections);
        // Guard when sections lack columns metadata (minimal file).
        if (mergedColumns.length === 0) {
            mergedColumns = ['x', 'y', 'speed', 'working_zone', 'punctual'];
        } else {
            // Files without speed column: mergeConnectTurnColumns does not add it (union of declared columns).
            // Without speed in mergedColumns, addSpeed/normalizeSectionToColumns cannot inject it.
            mergedColumns = this.ensureConnectTurnOutputColumns(mergedColumns);
        }

        for (let i = 0; i < workingSections.length - 1; i++) {
            const section1 = workingSections[i];
            const section2 = workingSections[i + 1];

            // Add the section with parameters
            const updatedSection1 = this.addSpeed(section1, mergedColumns, params.rowSpeed);
            finalSections.push(updatedSection1);

            // Reuse a connector whose endpoints already match these consecutive
            // rows, preventing duplicate U-turns on repeated generation passes.
            const existingTurnMatch = this.findExistingTurnBetween(
                existingTurnSections,
                usedExistingTurnIndexes,
                section1,
                section2
            );
            if (existingTurnMatch) {
                usedExistingTurnIndexes.add(existingTurnMatch.index);
                finalSections.push(this.normalizeSectionToColumns(
                    existingTurnMatch.section,
                    mergedColumns,
                    { speed: params.rowSpeed }
                ));
                continue;
            }

            // Generate the turn
            if (params.turnType === 'square') {
                const turnSection = this.createSquareTurn(section1, section2, mergedColumns, params.spaceIn, params.spaceOut, params.rowSpeed);
                if (turnSection) {
                    finalSections.push(turnSection);
                }
            } else if (params.turnType === 'u_turn') {
                const turnSection = this.createUTurn(section1, section2, mergedColumns, params.spaceIn, params.spaceOut, params.headlandSpace, params.rowSpeed);
                if (turnSection) {
                    finalSections.push(turnSection);
                } else {
                    uTurnFailures.push({
                        from: i + 1,
                        to: i + 2,
                        error: this.lastUTurnGenerationError || { code: 'unknown' }
                    });
                }
            }
        }

        // Add the last section
        const lastSection = workingSections[workingSections.length - 1];
        const updatedLastSection = this.addSpeed(lastSection, mergedColumns, params.rowSpeed);
        finalSections.push(updatedLastSection);

        // Loop option: last point -> first point of the first row
        if (params.loop && workingSections.length >= 2) {
            const secLast = workingSections[workingSections.length - 1];
            const secFirst = workingSections[0];
            const existingLoopMatch = this.findExistingTurnBetween(
                existingTurnSections,
                usedExistingTurnIndexes,
                secLast,
                secFirst
            );
            let loopTurn = existingLoopMatch
                ? this.normalizeSectionToColumns(
                    existingLoopMatch.section,
                    mergedColumns,
                    { speed: params.rowSpeed }
                )
                : null;
            if (existingLoopMatch) {
                usedExistingTurnIndexes.add(existingLoopMatch.index);
            } else {
                // Classic case (serpentine: successive rows in opposite directions): same logic as between two rows
                // (createSquareTurn / createUTurn with spaceIn, spaceOut) - proven and consistent with the dialog.
                if (!this.haveSameDirection(secLast, secFirst)) {
                    if (params.turnType === 'square') {
                        loopTurn = this.createSquareTurn(
                            secLast,
                            secFirst,
                            mergedColumns,
                            params.spaceIn,
                            params.spaceOut,
                            params.rowSpeed
                        );
                    } else if (params.turnType === 'u_turn') {
                        loopTurn = this.createUTurn(
                            secLast,
                            secFirst,
                            mergedColumns,
                            params.spaceIn,
                            params.spaceOut,
                            params.headlandSpace,
                            params.rowSpeed
                        );
                        if (!loopTurn) {
                            uTurnFailures.push({
                                from: workingSections.length,
                                to: 1,
                                error: this.lastUTurnGenerationError || { code: 'unknown' }
                            });
                        }
                    }
                } else {
                    // Same geometric direction: a direct square/U would often cut through the interior -> dedicated headland
                    loopTurn = this.createLoopClosingHeadland(secLast, secFirst, mergedColumns, {
                        spaceIn: params.spaceIn,
                        spaceOut: params.spaceOut,
                        speed: params.rowSpeed,
                        headlandSpace: params.headlandSpace
                    });
                }
            }
            if (loopTurn) {
                const trimmedLoopTurn = this.trimLoopClosingTurnEnd(loopTurn, secFirst, TURN_PATH_SPACING_M);
                finalSections.push(trimmedLoopTurn);
            }
        }

        // Check limits before replacing the trajectory
        let totalPoints = 0;
        for (const section of finalSections) {
            if (section.values && Array.isArray(section.values)) {
                const sectionPoints = section.values.length;
                if (sectionPoints > this.MAX_POINTS_PER_SECTION) {
                    this.notificationService.show(
                        'notification.sectionLimitExceeded',
                        'error',
                        5000,
                        {
                            sectionPoints: sectionPoints.toLocaleString(),
                            maxPoints: this.MAX_POINTS_PER_SECTION.toLocaleString()
                        }
                    );
                    return;
                }
                totalPoints += sectionPoints;
            }
        }

        if (totalPoints > this.MAX_POINTS_PER_TRAJECTORY) {
            this.notificationService.show(
                'notification.trajectoryGeneratedLimitExceeded',
                'error',
                5000,
                {
                    totalPoints: totalPoints.toLocaleString(),
                    maxPoints: this.MAX_POINTS_PER_TRAJECTORY.toLocaleString()
                }
            );
            return;
        }

        this.currentTrajectory.points = finalSections;
        this.updateAll();
        document.getElementById('connectTurnsDialog').style.display = 'none';
        const btn = document.getElementById('connectTurnsBtn');
        if (btn) btn.classList.remove('active');
        if (uTurnFailures.length > 0) {
            this.notifyUTurnGenerationFailures(uTurnFailures);
        }
    }

    /**
     * Display one localized summary for every U-turn that could not be generated.
     */
    notifyUTurnGenerationFailures(failures) {
        const reasonCounts = new Map();
        failures.forEach((failure) => {
            const code = failure.error && failure.error.code
                ? failure.error.code
                : 'unknown';
            reasonCounts.set(code, (reasonCounts.get(code) || 0) + 1);
        });

        const translate = (key, params = {}) => (
            window.i18n ? window.i18n.t(key, params) : key
        );
        const causes = Array.from(reasonCounts.entries()).map(([code, count]) => {
            const reason = translate(`notification.uTurnFailureReason.${code}`);
            return count > 1 ? `${reason} (${count})` : reason;
        }).join(' ; ');

        // Keep a long batch readable while still identifying the first affected rows.
        const displayedConnections = failures.slice(0, 10)
            .map((failure) => `${failure.from}→${failure.to}`);
        if (failures.length > displayedConnections.length) {
            displayedConnections.push('…');
        }

        this.notificationService.show(
            'notification.uTurnGenerationFailed',
            'error',
            10000,
            {
                count: failures.length,
                connections: displayedConnections.join(', '),
                causes
            }
        );
    }

    // ========== Parcel fill helper methods ==========

    /**
     * Generate parallel lines inside a parcel
     */
    generateParallelLines(parcelPoints, spacing) {
        const origin = this.currentTrajectory.origin.coordinates;
        const parcelXY = parcelPoints.map(p => ({
            x: (p.lng - origin.lon) * 111320 * Math.cos(origin.lat * Math.PI / 180),
            y: (p.lat - origin.lat) * 111320
        }));

        // Calculate the direction of the first side
        const dx = parcelXY[1].x - parcelXY[0].x;
        const dy = parcelXY[1].y - parcelXY[0].y;
        const firstSideLength = Math.sqrt(dx * dx + dy * dy);
        const dirX = dx / firstSideLength;
        const dirY = dy / firstSideLength;

        // Perpendiculaire
        const perpX = -dirY;
        const perpY = dirX;

        // Find the limits
        let minPerp = Infinity;
        let maxPerp = -Infinity;
        parcelXY.forEach(p => {
            const perpDist = p.x * perpX + p.y * perpY;
            minPerp = Math.min(minPerp, perpDist);
            maxPerp = Math.max(maxPerp, perpDist);
        });

        const sections = [];
        let currentPerp = minPerp + spacing / 2;
        let lineIndex = 0;

        while (currentPerp < maxPerp) {
            const intersections = [];

            for (let i = 0; i < parcelXY.length; i++) {
                const j = (i + 1) % parcelXY.length;
                const p1 = parcelXY[i];
                const p2 = parcelXY[j];

                const d1 = p1.x * perpX + p1.y * perpY - currentPerp;
                const d2 = p2.x * perpX + p2.y * perpY - currentPerp;

                if (d1 * d2 < 0) {
                    const t = d1 / (d1 - d2);
                    const ix = p1.x + t * (p2.x - p1.x);
                    const iy = p1.y + t * (p2.y - p1.y);
                    intersections.push({ x: ix, y: iy });
                }
            }

            if (intersections.length >= 2) {
                let sorted = intersections.sort((a, b) =>
                    (a.x - b.x) * dirX + (a.y - b.y) * dirY
                );

                // Reverse even lines
                if (lineIndex % 2 === 1) {
                    sorted = sorted.reverse();
                }

                // Convert intersection points to lat/lng for generatePointsWithSpacing
                const latLngPoints = sorted.map(p => ({
                    lat: origin.lat + (p.y / 111320),
                    lng: origin.lon + (p.x / (111320 * Math.cos(origin.lat * Math.PI / 180)))
                }));
                
                const spacedPoints = this.generatePointsWithSpacing(latLngPoints, 0.1);

                sections.push({
                    sectionType: { value: "row_path" },
                    columns: ["x", "y", "speed", "working_zone", "punctual"],
                    points: spacedPoints
                });

                lineIndex++;
            }

            currentPerp += spacing;
        }

        return sections;
    }

    /**
     * Get the total number of points in the trajectory
     */
    getTotalPointsCount() {
        if (this.sectionController) {
            return this.sectionController.getTotalPointsCount(this.currentTrajectory);
        }
        let total = 0;
        this.currentTrajectory.points.forEach(section => {
            if (section.values && Array.isArray(section.values)) {
                total += section.values.length;
            }
        });
        return total;
    }

    /**
     * Save state for undo
     */
    saveForUndo() {
        this.undoStack.push(JSON.parse(JSON.stringify(this.currentTrajectory)));
    }

    // ========== Turn helper methods ==========

    /**
     * Merge column lists from all sections for Connect Turns.
     * Order: x, y, speed, working_zone, punctual when present, then any other column
     * in first-appearance order - avoids mixing indices across heterogeneous files.
     */
    mergeConnectTurnColumns(sections) {
        const preferredOrder = ['x', 'y', 'speed', 'working_zone', 'punctual'];
        const seen = new Set();
        const extras = [];
        sections.forEach((s) => {
            (s.columns || []).forEach((c) => {
                if (!seen.has(c)) {
                    seen.add(c);
                    if (!preferredOrder.includes(c)) {
                        extras.push(c);
                    }
                }
            });
        });
        return preferredOrder.filter((c) => seen.has(c)).concat(extras);
    }

    /**
     * After merging row columns, ensure speed for Connect Turns
     * (speed driven by rowSpeed) while keeping canonical order x,y,speed,... then extras.
     * @param {string[]} mergedColumns - Result of mergeConnectTurnColumns (non-empty)
     * @returns {string[]}
     */
    ensureConnectTurnOutputColumns(mergedColumns) {
        if (mergedColumns.includes('speed')) {
            return mergedColumns;
        }
        const preferredOrder = ['x', 'y', 'speed', 'working_zone', 'punctual'];
        const set = new Set(mergedColumns);
        set.add('speed');
        const extras = mergedColumns.filter((c) => !preferredOrder.includes(c));
        return preferredOrder.filter((c) => set.has(c)).concat(extras);
    }

    /**
     * Read section type regardless of format (flat section_type or sectionType.value).
     * @param {Object} section
     * @returns {string}
     */
    getSectionTypeString(section) {
        if (!section) {
            return 'row_path';
        }
        if (section.section_type != null && section.section_type !== '') {
            return String(section.section_type);
        }
        const st = section.sectionType;
        if (st && typeof st === 'object' && st.value != null && st.value !== '') {
            return String(st.value);
        }
        return 'row_path';
    }

    /**
     * Return whether a section is a generated turn rather than a traversed row.
     */
    isTurnSection(section) {
        return this.getSectionTypeString(section).startsWith('turn_');
    }

    /**
     * Find an unused existing turn that already connects two row endpoints.
     *
     * Matching geometry instead of array position keeps reuse valid after row_line
     * densification while rejecting stale turns when rows are reversed or reordered.
     */
    findExistingTurnBetween(existingTurns, usedIndexes, section1, section2) {
        const values1 = section1.values || [];
        const values2 = section2.values || [];
        const columns1 = section1.columns || [];
        const columns2 = section2.columns || [];
        if (
            values1.length === 0
            || values2.length === 0
            || columns1.indexOf('x') === -1
            || columns1.indexOf('y') === -1
            || columns2.indexOf('x') === -1
            || columns2.indexOf('y') === -1
        ) {
            return null;
        }

        const row1End = this.rowXY(values1[values1.length - 1], columns1);
        const row2Start = this.rowXY(values2[0], columns2);

        for (let index = 0; index < existingTurns.length; index += 1) {
            if (usedIndexes.has(index)) continue;
            const turn = existingTurns[index];

            const turnValues = turn.values || [];
            const turnColumns = turn.columns || [];
            if (
                turnValues.length < 2
                || turnColumns.indexOf('x') === -1
                || turnColumns.indexOf('y') === -1
            ) {
                continue;
            }

            const turnStart = this.rowXY(turnValues[0], turnColumns);
            const turnEnd = this.rowXY(
                turnValues[turnValues.length - 1],
                turnColumns
            );
            const startsAtRow1 = this.distance(
                turnStart.x,
                turnStart.y,
                row1End.x,
                row1End.y
            ) <= TURN_CONNECTION_MATCH_TOLERANCE_M;
            const endsAtRow2 = this.distance(
                turnEnd.x,
                turnEnd.y,
                row2Start.x,
                row2Start.y
            ) <= TURN_CONNECTION_MATCH_TOLERANCE_M;

            if (startsAtRow1 && endsAtRow2) {
                return { section: turn, index };
            }
        }
        return null;
    }

    /**
     * Copy a values[] row by duplicating objects (e.g. punctual) to avoid shared references.
     */
    cloneSectionValueRow(row) {
        if (!row || !Array.isArray(row)) {
            return [];
        }
        return row.map((cell) => {
            if (cell !== null && typeof cell === 'object' && !Array.isArray(cell)) {
                return { ...cell };
            }
            return cell;
        });
    }

    /**
     * Interpolated point on segment A->B at distance fraction t (0 < t < 1) in the x,y plane.
     * Common numeric columns: linear interpolation; punctual: {} on inserted points.
     */
    interpolateRowLinePoint(rowA, rowB, columns, xi, yi, t) {
        const x1 = rowA[xi];
        const y1 = rowA[yi];
        const x2 = rowB[xi];
        const y2 = rowB[yi];
        const x = window.GeometryUtils.round3(x1 + t * (x2 - x1));
        const y = window.GeometryUtils.round3(y1 + t * (y2 - y1));
        return columns.map((col, cidx) => {
            if (col === 'x') {
                return x;
            }
            if (col === 'y') {
                return y;
            }
            if (col === 'punctual') {
                return {};
            }
            const va = rowA[cidx];
            const vb = rowB[cidx];
            if (col === 'working_zone' && typeof va === 'number' && typeof vb === 'number'
                && Number.isFinite(va) && Number.isFinite(vb)) {
                return Math.round(va + t * (vb - va));
            }
            if (typeof va === 'number' && typeof vb === 'number' && Number.isFinite(va) && Number.isFinite(vb)) {
                return window.GeometryUtils.round3(va + t * (vb - va));
            }
            if (typeof vb === 'number' && Number.isFinite(vb)) {
                return window.GeometryUtils.round3(vb);
            }
            if (typeof va === 'number' && Number.isFinite(va)) {
                return window.GeometryUtils.round3(va);
            }
            if (va !== undefined && va !== null) {
                return va;
            }
            return 0;
        });
    }

    /**
     * If the section is row_line: becomes row_path and inserts points every `spacing` m on each segment.
     * Turns and column merging then behave like rows that are already path.
     * @param {Object} section
     * @param {number} spacing - Step in meters (e.g. 0.1 for 10 cm)
     */
    densifyRowLineSectionToRowPath(section, spacing = TURN_PATH_SPACING_M) {
        if (this.getSectionTypeString(section) !== 'row_line') {
            return section;
        }
        const cols = section.columns || [];
        const xi = cols.indexOf('x');
        const yi = cols.indexOf('y');
        const base = { ...section, columns: cols.slice() };
        delete base.sectionType;
        base.section_type = 'row_path';

        if (xi < 0 || yi < 0) {
            return base;
        }
        const values = section.values || [];
        if (values.length < 2) {
            return base;
        }

        const outVals = [];
        for (let i = 0; i < values.length - 1; i++) {
            const rowA = values[i];
            const rowB = values[i + 1];
            const x1 = rowA[xi];
            const y1 = rowA[yi];
            const x2 = rowB[xi];
            const y2 = rowB[yi];
            const d = this.distance(x1, y1, x2, y2);

            if (i === 0) {
                outVals.push(this.cloneSectionValueRow(rowA));
            }
            if (d < 1e-9) {
                outVals.push(this.cloneSectionValueRow(rowB));
                continue;
            }
            for (let j = 1; j * spacing < d; j++) {
                const t = (j * spacing) / d;
                outVals.push(this.interpolateRowLinePoint(rowA, rowB, cols, xi, yi, t));
            }
            outVals.push(this.cloneSectionValueRow(rowB));
        }

        base.values = outVals;
        return base;
    }

    /**
     * Reindex section rows to a target column name array.
     * @param {Object} opts - speed: when set, force the speed column to this value.
     */
    normalizeSectionToColumns(section, targetColumns, opts = {}) {
        const srcCols = section.columns || [];
        const speedOverride = opts.speed;
        const values = (section.values || []).map((row) =>
            targetColumns.map((col) => {
                let cell;
                if (speedOverride != null && col === 'speed') {
                    cell = speedOverride;
                } else {
                    const i = srcCols.indexOf(col);
                    if (i >= 0 && i < row.length && row[i] !== undefined && row[i] !== null) {
                        cell = row[i];
                    } else if (col === 'punctual') {
                        cell = {};
                    } else if (col === 'working_zone') {
                        cell = 0;
                    } else {
                        cell = 0;
                    }
                }
                // Same precision as the rest of the editor (GeometryUtils.round3) for local x,y in meters
                if ((col === 'x' || col === 'y') && typeof cell === 'number' && Number.isFinite(cell)) {
                    cell = window.GeometryUtils.round3(cell);
                }
                return cell;
            })
        );
        return { ...section, columns: targetColumns.slice(), values };
    }

    /**
     * Read x and y from a row using the source section column list (not a fixed order).
     */
    rowXY(row, columns) {
        const cols = columns || [];
        const xi = cols.indexOf('x');
        const yi = cols.indexOf('y');
        return { x: row[xi], y: row[yi] };
    }

    /**
     * Raw column value from a row (values array), or undefined.
     */
    rowValueAt(row, sourceColumns, col) {
        const i = (sourceColumns || []).indexOf(col);
        if (i < 0 || i >= row.length) {
            return undefined;
        }
        return row[i];
    }

    /**
     * Convert a turn point ({ col: { value } }) into a values[] row for columns.
     */
    turnPointObjectToRow(point, columns) {
        return columns.map((col) => {
            const cell = point[col];
            let v;
            if (cell && Object.prototype.hasOwnProperty.call(cell, 'value')) {
                v = cell.value;
            } else {
                v = col === 'punctual' ? {} : 0;
            }
            if ((col === 'x' || col === 'y') && typeof v === 'number' && Number.isFinite(v)) {
                v = window.GeometryUtils.round3(v);
            }
            return v;
        });
    }

    /**
     * Reverse a section
     */
    reverseSection(section) {
        const reversedValues = [...section.values].reverse();
        return { ...section, values: reversedValues };
    }

    /**
     * Apply serpentine order
     */
    applySnakeOrder(sections) {
        const result = [];
        const rowsInOrder = [];

        sections.forEach((row, i) => {
            if (i % 2 === 0) {
                rowsInOrder.unshift(row);
            } else {
                rowsInOrder.push(row);
            }
        });

        // Reverse sections that share the same direction
        for (let i = 1; i < rowsInOrder.length; i++) {
            if (this.haveSameDirection(rowsInOrder[i - 1], rowsInOrder[i])) {
                rowsInOrder[i] = this.reverseSection(rowsInOrder[i]);
            }
        }

        return rowsInOrder;
    }

    /**
     * Apply corkscrew order
     */
    applyCorkscrewOrder(sections, jump) {
        const result = [];
        const usedIndices = new Set();
        let currentIndex = 0;
        let direction = 1;

        while (result.length < sections.length) {
            if (currentIndex >= 0 && currentIndex < sections.length && !usedIndices.has(currentIndex)) {
                result.push(sections[currentIndex]);
                usedIndices.add(currentIndex);
            }

            currentIndex += jump * direction;

            if (currentIndex >= sections.length || currentIndex < 0) {
                direction = -direction;
                currentIndex += direction;

                if (result.length < sections.length) {
                    for (let i = 0; i < sections.length; i++) {
                        if (!usedIndices.has(i)) {
                            currentIndex = i;
                            break;
                        }
                    }
                }
            }
        }

        return result;
    }

    /**
     * Check whether two sections share the same direction
     */
    haveSameDirection(section1, section2) {
        if (!section1.values || !section2.values || section1.values.length < 2 || section2.values.length < 2) return false;

        const cols1 = section1.columns || [];
        const cols2 = section2.columns || [];
        const x1 = cols1.indexOf('x');
        const y1 = cols1.indexOf('y');
        const x2 = cols2.indexOf('x');
        const y2 = cols2.indexOf('y');
        if (x1 === -1 || y1 === -1 || x2 === -1 || y2 === -1) return false;

        const p1Start = section1.values[0];
        const p1End = section1.values[section1.values.length - 1];
        const p2Start = section2.values[0];
        const p2End = section2.values[section2.values.length - 1];

        const v1x = p1End[x1] - p1Start[x1];
        const v1y = p1End[y1] - p1Start[y1];
        const v2x = p2End[x2] - p2Start[x2];
        const v2y = p2End[y2] - p2Start[y2];

        const dot = v1x * v2x + v1y * v2y;
        return dot > 0;
    }

    /**
     * Add speed, punctual, and working_zone to a section
     */
    addSpeedAndWorkingZone(section, columns, speed, workingZone) {
        const newValues = section.values.map(pointValues => {
            const newPointValues = [...pointValues];
            const speedIndex = columns.indexOf('speed');
            const workingZoneIndex = columns.indexOf('working_zone');
            const punctualIndex = columns.indexOf('punctual');

            if (speedIndex !== -1) {
                newPointValues[speedIndex] = speed;
            }
            if (workingZoneIndex !== -1) {
                newPointValues[workingZoneIndex] = workingZone;
            }
            if (punctualIndex !== -1 && (newPointValues[punctualIndex] === undefined || newPointValues[punctualIndex] === null)) {
                newPointValues[punctualIndex] = {};
            }

            return newPointValues;
        });

        return { ...section, columns: columns, values: newValues };
    }

    /**
     * Add speed and punctual to a section
     */
    addSpeed(section, columns, speed) {
        // Reindex by column name: legacy code assumed `columns` and each row
        // used the same order as ['x','y','speed','working_zone','punctual'], which overwrote
        // working_zone when the file used a different column order (e.g. rows / row_path).
        return this.normalizeSectionToColumns(section, columns, { speed });
    }

    /**
     * Keep the loop closure from duplicating the first row point.
     * The generated turn naturally ends on the first point of the first section; for loop mode we stop
     * `gapMeters` earlier along the generated path so the last section does not overlap the first one.
     */
    trimLoopClosingTurnEnd(loopTurn, firstSection, gapMeters) {
        const columns = loopTurn.columns || [];
        const firstColumns = firstSection.columns || [];
        const xi = columns.indexOf('x');
        const yi = columns.indexOf('y');
        const firstXi = firstColumns.indexOf('x');
        const firstYi = firstColumns.indexOf('y');
        const values = loopTurn.values || [];

        if (xi < 0 || yi < 0 || firstXi < 0 || firstYi < 0 || values.length < 2 || !firstSection.values || firstSection.values.length === 0) {
            return loopTurn;
        }

        const targetX = firstSection.values[0][firstXi];
        const targetY = firstSection.values[0][firstYi];
        const lastPoint = this.rowXY(values[values.length - 1], columns);
        if (!Number.isFinite(targetX) || !Number.isFinite(targetY) || this.distance(lastPoint.x, lastPoint.y, targetX, targetY) > gapMeters * 2) {
            return loopTurn;
        }

        let remainingGap = gapMeters;
        for (let i = values.length - 1; i > 0; i--) {
            const point = this.rowXY(values[i], columns);
            const previousPoint = this.rowXY(values[i - 1], columns);
            const segmentLength = this.distance(previousPoint.x, previousPoint.y, point.x, point.y);

            if (segmentLength < 1e-9) {
                continue;
            }

            if (remainingGap <= segmentLength) {
                const t = (segmentLength - remainingGap) / segmentLength;
                const trimmedX = previousPoint.x + t * (point.x - previousPoint.x);
                const trimmedY = previousPoint.y + t * (point.y - previousPoint.y);
                const trimmedValues = values.slice(0, i).map((row) => this.cloneSectionValueRow(row));
                const trimmedRow = this.cloneSectionValueRow(values[i]);
                trimmedRow[xi] = window.GeometryUtils.round3(trimmedX);
                trimmedRow[yi] = window.GeometryUtils.round3(trimmedY);

                const lastKeptPoint = this.rowXY(trimmedValues[trimmedValues.length - 1], columns);
                if (this.distance(lastKeptPoint.x, lastKeptPoint.y, trimmedRow[xi], trimmedRow[yi]) > 1e-6) {
                    trimmedValues.push(trimmedRow);
                }

                return { ...loopTurn, values: trimmedValues };
            }

            remainingGap -= segmentLength;
        }

        return loopTurn;
    }

    /**
     * Headland loop closure: does not cross row interiors (unlike a direct square/U).
     * Sequence: (1) spaceOut along row direction, (2) perpendicular spaceOut, (3) 0.3 m along n,
     * (4) segment parallel to the row with length = last row length + 2*spaceOut,
     * (5) approach the start point of the first row.
     */
    createLoopClosingHeadland(sectionLast, sectionFirst, columns, opts) {
        const spaceIn = opts.spaceIn != null ? opts.spaceIn : 1.0;
        const spaceOut = opts.spaceOut != null ? opts.spaceOut : 1.0;
        const speed = opts.speed != null ? opts.speed : 0.5;
        const headlandSpace = opts.headlandSpace != null ? opts.headlandSpace : 2.0;

        if (!sectionLast.values || !sectionFirst.values || sectionLast.values.length < 2 || sectionFirst.values.length < 2) {
            return null;
        }
        const colsL = sectionLast.columns || [];
        const colsF = sectionFirst.columns || [];
        if (colsL.indexOf('x') === -1 || colsL.indexOf('y') === -1 || colsF.indexOf('x') === -1 || colsF.indexOf('y') === -1) {
            return null;
        }

        const a = sectionLast.values[sectionLast.values.length - 1];
        const stepBackOut = Math.max(1, Math.min(15, sectionLast.values.length - 2));
        const bBk = sectionLast.values[sectionLast.values.length - 1 - stepBackOut];
        const { x: ax, y: ay } = this.rowXY(a, colsL);
        const { x: bx, y: by } = this.rowXY(bBk, colsL);

        const v1x = ax - bx;
        const v1y = ay - by;
        const v1Len = Math.hypot(v1x, v1y);
        if (v1Len < 1e-9) {
            return null;
        }
        const vnx = v1x / v1Len;
        const vny = v1y / v1Len;

        const c = sectionFirst.values[0];
        const d = sectionFirst.values[Math.min(1, sectionFirst.values.length - 1)];
        const { x: cx, y: cy } = this.rowXY(c, colsF);
        const { x: dx, y: dy } = this.rowXY(d, colsF);

        // Same axial extension as createSquareTurn (angleOut = direction b -> last point)
        const angleRow = Math.atan2(ay - by, ax - bx);
        const aExtX = ax + Math.cos(angleRow) * spaceOut;
        const aExtY = ay + Math.sin(angleRow) * spaceOut;

        const toSx = cx - aExtX;
        const toSy = cy - aExtY;
        const perpAx = -vny;
        const perpAy = vnx;
        let nxs = perpAx;
        let nys = perpAy;
        if (nxs * toSx + nys * toSy > 0) {
            nxs = -perpAx;
            nys = -perpAy;
        }
        const nlen = Math.hypot(nxs, nys);
        nxs /= nlen;
        nys /= nlen;

        const approachGap = Math.max(spaceIn, spaceOut, headlandSpace, 2.0);

        // Actual last row length (sum of steps between points)
        let lastRowLengthM = 0;
        const valsL = sectionLast.values;
        for (let i = 1; i < valsL.length; i++) {
            const p0 = this.rowXY(valsL[i - 1], colsL);
            const p1 = this.rowXY(valsL[i], colsL);
            lastRowLengthM += this.distance(p0.x, p0.y, p1.x, p1.y);
        }
        if (lastRowLengthM < 1e-6) {
            lastRowLengthM = v1Len * Math.max(1, valsL.length - 1);
        }
        const parallelRunM = lastRowLengthM + 2 * spaceOut;

        const q1x = aExtX + nxs * spaceOut;
        const q1y = aExtY + nys * spaceOut;
        const qLatX = q1x + nxs * LOOP_HEADLAND_LATERAL_M;
        const qLatY = q1y + nys * LOOP_HEADLAND_LATERAL_M;
        const q5x = qLatX - vnx * parallelRunM;
        const q5y = qLatY - vny * parallelRunM;

        // Step along n: choose the sign that moves toward the start (avoids an outward hook)
        const toCx = cx - q5x;
        const toCy = cy - q5y;
        const ndot = nxs * toCx + nys * toCy;
        let q6x;
        let q6y;
        if (Math.abs(ndot) < 1e-4) {
            q6x = q5x;
            q6y = q5y;
        } else {
            const alignSign = ndot >= 0 ? 1 : -1;
            q6x = q5x + nxs * approachGap * alignSign;
            q6y = q5y + nys * approachGap * alignSign;
        }

        const angleFirst = Math.atan2(dy - cy, dx - cx);
        const pointInX = cx - Math.cos(angleFirst) * spaceIn;
        const pointInY = cy - Math.sin(angleFirst) * spaceIn;

        const turnPoints = [];

        const pushLabeledCorner = (px, py, punctualCourse) => {
            const o = {};
            columns.forEach((col) => {
                if (col === 'x') o[col] = { value: window.GeometryUtils.round3(px) };
                else if (col === 'y') o[col] = { value: window.GeometryUtils.round3(py) };
                else if (col === 'speed') o[col] = { value: speed };
                else if (col === 'working_zone') o[col] = { value: 0 };
                else if (col === 'punctual') {
                    o[col] = {
                        value: punctualCourse !== undefined ? { course: window.GeometryUtils.round3(punctualCourse) } : {}
                    };
                } else o[col] = { value: 0 };
            });
            turnPoints.push(o);
        };

        const lastEnd = {};
        columns.forEach((col) => {
            if (col === 'x') lastEnd[col] = { value: window.GeometryUtils.round3(ax) };
            else if (col === 'y') lastEnd[col] = { value: window.GeometryUtils.round3(ay) };
            else if (col === 'speed') lastEnd[col] = { value: speed };
            else if (col === 'working_zone') lastEnd[col] = { value: 0 };
            else if (col === 'punctual') lastEnd[col] = { value: {} };
            else {
                const v = this.rowValueAt(a, colsL, col);
                lastEnd[col] = { value: v !== undefined ? v : 0 };
            }
        });
        turnPoints.push(lastEnd);

        this.addPointsAlongSegment(ax, ay, aExtX, aExtY, TURN_PATH_SPACING_M, turnPoints, columns, speed);
        pushLabeledCorner(aExtX, aExtY, Math.atan2(nys, nxs));

        this.addPointsAlongSegment(aExtX, aExtY, q1x, q1y, TURN_PATH_SPACING_M, turnPoints, columns, speed);
        pushLabeledCorner(q1x, q1y, Math.atan2(nys, nxs));

        this.addPointsAlongSegment(q1x, q1y, qLatX, qLatY, TURN_PATH_SPACING_M, turnPoints, columns, speed);
        pushLabeledCorner(qLatX, qLatY, Math.atan2(-vny, -vnx));

        this.addPointsAlongSegment(qLatX, qLatY, q5x, q5y, TURN_PATH_SPACING_M, turnPoints, columns, speed);

        const approachDx = q6x - q5x;
        const approachDy = q6y - q5y;
        const hasApproachNudge = approachDx * approachDx + approachDy * approachDy > 1e-8;
        if (hasApproachNudge) {
            pushLabeledCorner(q5x, q5y, Math.atan2(approachDy, approachDx));
            this.addPointsAlongSegment(q5x, q5y, q6x, q6y, TURN_PATH_SPACING_M, turnPoints, columns, speed);
            pushLabeledCorner(q6x, q6y, Math.atan2(pointInY - q6y, pointInX - q6x));
        } else {
            pushLabeledCorner(q5x, q5y, Math.atan2(pointInY - q5y, pointInX - q5x));
        }

        const fromAx = hasApproachNudge ? q6x : q5x;
        const fromAy = hasApproachNudge ? q6y : q5y;
        this.addPointsAlongSegment(fromAx, fromAy, pointInX, pointInY, TURN_PATH_SPACING_M, turnPoints, columns, speed);
        pushLabeledCorner(pointInX, pointInY, Math.atan2(cy - pointInY, cx - pointInX));

        this.addPointsAlongSegment(pointInX, pointInY, cx, cy, TURN_PATH_SPACING_M, turnPoints, columns, speed);

        const depPoint = {};
        columns.forEach((col) => {
            if (col === 'x') depPoint[col] = { value: window.GeometryUtils.round3(cx) };
            else if (col === 'y') depPoint[col] = { value: window.GeometryUtils.round3(cy) };
            else if (col === 'speed') depPoint[col] = { value: speed };
            else if (col === 'working_zone') depPoint[col] = { value: 0 };
            else if (col === 'punctual') depPoint[col] = { value: {} };
            else {
                const v = this.rowValueAt(c, colsF, col);
                depPoint[col] = { value: v !== undefined ? v : 0 };
            }
        });
        turnPoints.push(depPoint);

        return {
            section_type: 'turn_path',
            columns,
            values: turnPoints.map((p) => this.turnPointObjectToRow(p, columns))
        };
    }

    /**
     * Create a square turn
     */
    createSquareTurn(section1, section2, columns, spaceIn, spaceOut, speed) {
        if (!section1.values || !section2.values || section1.values.length < 2 || section2.values.length < 2) return null;

        const cols1 = section1.columns || [];
        const cols2 = section2.columns || [];
        if (cols1.indexOf('x') === -1 || cols1.indexOf('y') === -1 || cols2.indexOf('x') === -1 || cols2.indexOf('y') === -1) {
            return null;
        }

        const a = section1.values[section1.values.length - 1];
        const c = section2.values[0];
        const { x: ax, y: ay } = this.rowXY(a, cols1);
        const { x: cx, y: cy } = this.rowXY(c, cols2);

        const stepBackOut = Math.max(1, Math.min(15, section1.values.length - 2));
        const b = section1.values[section1.values.length - 1 - stepBackOut];
        const { x: bx, y: by } = this.rowXY(b, cols1);
        const angleOut = Math.atan2(ay - by, ax - bx);

        const stepAheadIn = Math.max(1, Math.min(15, section2.values.length - 1));
        const d = section2.values[stepAheadIn];
        const { x: dx, y: dy } = this.rowXY(d, cols2);
        const angleIn = Math.atan2(dy - cy, dx - cx);

        const pointOutX = ax + Math.cos(angleOut) * spaceOut;
        const pointOutY = ay + Math.sin(angleOut) * spaceOut;
        const pointInX = cx - Math.cos(angleIn) * spaceIn;
        const pointInY = cy - Math.sin(angleIn) * spaceIn;

        const courseOut = Math.atan2(pointInY - pointOutY, pointInX - pointOutX);
        const courseIn = Math.atan2(cy - pointInY, cx - pointInX);

        const turnPoints = [];

        // Copy non-geometric columns from end of row 1 / start of row 2 when relevant.
        const lastPoint1 = {};
        columns.forEach((col) => {
            if (col === 'x') lastPoint1[col] = { value: window.GeometryUtils.round3(ax) };
            else if (col === 'y') lastPoint1[col] = { value: window.GeometryUtils.round3(ay) };
            else if (col === 'speed') lastPoint1[col] = { value: speed };
            else if (col === 'working_zone') lastPoint1[col] = { value: 0 };
            else if (col === 'punctual') lastPoint1[col] = { value: {} };
            else {
                const v = this.rowValueAt(a, cols1, col);
                lastPoint1[col] = { value: v !== undefined ? v : 0 };
            }
        });
        turnPoints.push(lastPoint1);

        const turnPointOut = {};
        columns.forEach((col) => {
            if (col === 'x') turnPointOut[col] = { value: window.GeometryUtils.round3(pointOutX) };
            else if (col === 'y') turnPointOut[col] = { value: window.GeometryUtils.round3(pointOutY) };
            else if (col === 'speed') turnPointOut[col] = { value: speed };
            else if (col === 'working_zone') turnPointOut[col] = { value: 0 };
            else if (col === 'punctual') turnPointOut[col] = { value: { course: window.GeometryUtils.round3(courseOut) } };
            else turnPointOut[col] = { value: 0 };
        });
        turnPoints.push(turnPointOut);

        const turnPointIn = {};
        columns.forEach((col) => {
            if (col === 'x') turnPointIn[col] = { value: window.GeometryUtils.round3(pointInX) };
            else if (col === 'y') turnPointIn[col] = { value: window.GeometryUtils.round3(pointInY) };
            else if (col === 'speed') turnPointIn[col] = { value: speed };
            else if (col === 'working_zone') turnPointIn[col] = { value: 0 };
            else if (col === 'punctual') turnPointIn[col] = { value: { course: window.GeometryUtils.round3(courseIn) } };
            else turnPointIn[col] = { value: 0 };
        });
        turnPoints.push(turnPointIn);

        const firstPoint2 = {};
        columns.forEach((col) => {
            if (col === 'x') firstPoint2[col] = { value: window.GeometryUtils.round3(cx) };
            else if (col === 'y') firstPoint2[col] = { value: window.GeometryUtils.round3(cy) };
            else if (col === 'speed') firstPoint2[col] = { value: speed };
            else if (col === 'working_zone') firstPoint2[col] = { value: 0 };
            else if (col === 'punctual') firstPoint2[col] = { value: {} };
            else {
                const v = this.rowValueAt(c, cols2, col);
                firstPoint2[col] = { value: v !== undefined ? v : 0 };
            }
        });
        turnPoints.push(firstPoint2);

        return {
            section_type: 'turn_square',
            columns: columns,
            values: turnPoints.map((point) => this.turnPointObjectToRow(point, columns))
        };
    }

    /**
     * Create an early-turning U-turn with two variable circular arcs.
     *
     * The arcs are joined by their common external tangent. Unlike two fixed 90°
     * arcs, this construction immediately aims toward a staggered next row.
     */
    createUTurn(section1, section2, columns, spaceIn, spaceOut, headlandSpace, speed) {
        // Expose a structured reason to the batch orchestrator whenever this method
        // returns null, without changing its existing section-or-null public contract.
        this.lastUTurnGenerationError = null;
        const fail = (code) => {
            this.lastUTurnGenerationError = { code };
            return null;
        };

        if (!section1.values || !section2.values || section1.values.length < 2 || section2.values.length < 2) {
            return fail('invalidSection');
        }

        const cols1 = section1.columns || [];
        const cols2 = section2.columns || [];
        if (cols1.indexOf('x') === -1 || cols1.indexOf('y') === -1 || cols2.indexOf('x') === -1 || cols2.indexOf('y') === -1) {
            return fail('missingCoordinates');
        }

        const a = section1.values[section1.values.length - 1];
        const c = section2.values[0];
        const { x: ax, y: ay } = this.rowXY(a, cols1);
        const { x: cx, y: cy } = this.rowXY(c, cols2);

        // Estimate each tangent from several local points instead of the last 10 cm
        // segment, which may contain coordinate noise or a small terminal kink.
        const directionOut = this.estimateSectionEndpointDirection(
            section1,
            cols1,
            true,
            U_TURN_DIRECTION_SAMPLE_M
        );
        const directionIn = this.estimateSectionEndpointDirection(
            section2,
            cols2,
            false,
            U_TURN_DIRECTION_SAMPLE_M
        );
        if (!directionOut || !directionIn) return fail('directionUnavailable');

        const v1nx = directionOut[0] * spaceOut;
        const v1ny = directionOut[1] * spaceOut;
        // pointIn is placed before the second row, opposite to its travel direction.
        const v2nx = -directionIn[0] * spaceIn;
        const v2ny = -directionIn[1] * spaceIn;

        // These points remain at the requested distances from the row ends. The old
        // projection step could move pointOut many metres and postpone the first turn.
        const pointOutX = ax + v1nx;
        const pointOutY = ay + v1ny;
        const pointInX = cx + v2nx;
        const pointInY = cy + v2ny;

        // A U-turn normally joins opposite travel directions. Combining the outgoing
        // tangent with the reversed incoming tangent uses both rows to determine the
        // forward axis; the cross product then identifies which side contains row 2.
        const commonForwardX = directionOut[0] - directionIn[0];
        const commonForwardY = directionOut[1] - directionIn[1];
        const commonForwardLength = Math.sqrt(
            commonForwardX * commonForwardX + commonForwardY * commonForwardY
        );
        const turnForwardX = commonForwardLength > 1e-9
            ? commonForwardX / commonForwardLength
            : directionOut[0];
        const turnForwardY = commonForwardLength > 1e-9
            ? commonForwardY / commonForwardLength
            : directionOut[1];
        const lateralX = pointInX - pointOutX;
        const lateralY = pointInY - pointOutY;
        // Prefer the side containing the next row, but keep these values mutable:
        // complex non-parallel rows may only admit a loop-free tangent on the other side.
        const preferredClockwise = turnForwardX * lateralY - turnForwardY * lateralX <= 0;
        let clockwise = preferredClockwise;
        let clockwiseSign = clockwise ? -1.0 : 1.0;

        // First compute the largest radius that fits both the row spacing and the
        // remaining headland after the exact exit/entry distances have been used.
        const radiusInsideHeadland = Math.max(
            0,
            Math.abs(headlandSpace) - Math.max(Math.abs(spaceOut), Math.abs(spaceIn))
        );
        // For non-parallel rows, the projected lateral gap can be zero even though
        // the endpoints are far apart and a valid smooth connection exists. The
        // headland—not that projection—is the actual radius constraint; the angle
        // validation below reduces the radius only when geometry requires it.
        const maximumRadius = radiusInsideHeadland;
        if (maximumRadius <= 1e-9) return fail('headlandTooSmall');

        // Build the two circle centers and their external tangent before generating
        // any point. This lets us validate both arc angles and reject full loops.
        const leftOutX = -directionOut[1];
        const leftOutY = directionOut[0];
        const leftInX = -directionIn[1];
        const leftInY = directionIn[0];
        const calculateConnection = (candidateRadius, endClockwise = clockwise) => {
            const endClockwiseSign = endClockwise ? -1.0 : 1.0;
            const firstCenterX = pointOutX + clockwiseSign * leftOutX * candidateRadius;
            const firstCenterY = pointOutY + clockwiseSign * leftOutY * candidateRadius;
            const secondCenterX = pointInX + endClockwiseSign * leftInX * candidateRadius;
            const secondCenterY = pointInY + endClockwiseSign * leftInY * candidateRadius;
            const centersX = secondCenterX - firstCenterX;
            const centersY = secondCenterY - firstCenterY;
            const centersDistance = Math.sqrt(
                centersX * centersX + centersY * centersY
            );
            const firstStartAngle = Math.atan2(
                pointOutY - firstCenterY,
                pointOutX - firstCenterX
            );
            const secondEndAngle = Math.atan2(
                pointInY - secondCenterY,
                pointInX - secondCenterX
            );

            // Coincident centers represent the ideal adjacent-row semicircle.
            if (centersDistance <= 1e-9 && clockwise === endClockwise) {
                const sharedCircleSweep = Math.abs(this.getDirectedArcSweep(
                    firstStartAngle,
                    secondEndAngle,
                    clockwise
                ));
                return {
                    firstCenterX,
                    firstCenterY,
                    secondCenterX,
                    secondCenterY,
                    centersX,
                    centersY,
                    centersDistance,
                    firstStartAngle,
                    secondEndAngle,
                    firstArcSweep: sharedCircleSweep,
                    secondArcSweep: 0,
                    firstClockwise: clockwise,
                    secondClockwise: endClockwise,
                    pathLength: sharedCircleSweep * candidateRadius
                };
            }
            if (centersDistance <= 1e-9) return null;

            // Same-side circles use an external tangent. Opposite-side circles use
            // an internal tangent, producing the requested smooth half-eight shape.
            const tangentOffset = (endClockwiseSign - clockwiseSign)
                * candidateRadius / centersDistance;
            if (Math.abs(tangentOffset) > 1.0) return null;
            const centersAngle = Math.atan2(centersY, centersX);
            const tangentAngle = centersAngle - Math.asin(tangentOffset);
            const tangentDirectionX = Math.cos(tangentAngle);
            const tangentDirectionY = Math.sin(tangentAngle);
            const tangentLeftX = -tangentDirectionY;
            const tangentLeftY = tangentDirectionX;
            const firstTangentX = firstCenterX
                - clockwiseSign * tangentLeftX * candidateRadius;
            const firstTangentY = firstCenterY
                - clockwiseSign * tangentLeftY * candidateRadius;
            const secondTangentX = secondCenterX
                - endClockwiseSign * tangentLeftX * candidateRadius;
            const secondTangentY = secondCenterY
                - endClockwiseSign * tangentLeftY * candidateRadius;
            const firstEndAngle = Math.atan2(
                firstTangentY - firstCenterY,
                firstTangentX - firstCenterX
            );
            const secondStartAngle = Math.atan2(
                secondTangentY - secondCenterY,
                secondTangentX - secondCenterX
            );

            const firstArcSweep = Math.abs(this.getDirectedArcSweep(
                firstStartAngle,
                firstEndAngle,
                clockwise
            ));
            const secondArcSweep = Math.abs(this.getDirectedArcSweep(
                secondStartAngle,
                secondEndAngle,
                endClockwise
            ));
            const tangentLength = this.distance(
                firstTangentX,
                firstTangentY,
                secondTangentX,
                secondTangentY
            );

            return {
                firstCenterX,
                firstCenterY,
                secondCenterX,
                secondCenterY,
                centersX,
                centersY,
                centersDistance,
                firstStartAngle,
                secondEndAngle,
                firstTangentX,
                firstTangentY,
                secondTangentX,
                secondTangentY,
                firstEndAngle,
                secondStartAngle,
                firstArcSweep,
                secondArcSweep,
                firstClockwise: clockwise,
                secondClockwise: endClockwise,
                pathLength: (firstArcSweep + secondArcSweep) * candidateRadius
                    + tangentLength
            };
        };

        const maximumArcSweep = Math.PI + 1e-6;

        /**
         * Find the largest radius on the current turning side that keeps each arc
         * below 180°. Exact entry and exit points remain unchanged during the search.
         */
        const findLoopFreeConnection = (endClockwise = clockwise) => {
            let candidateRadius = maximumRadius;
            let candidateConnection = calculateConnection(candidateRadius, endClockwise);

            for (
                let attempt = 0;
                attempt < 40
                    && (!candidateConnection
                        || candidateConnection.firstArcSweep > maximumArcSweep
                        || candidateConnection.secondArcSweep > maximumArcSweep);
                attempt += 1
            ) {
                candidateRadius *= 0.9;
                candidateConnection = calculateConnection(candidateRadius, endClockwise);
            }

            if (
                candidateRadius <= 1e-9
                || !candidateConnection
                || candidateConnection.firstArcSweep > maximumArcSweep
                || candidateConnection.secondArcSweep > maximumArcSweep
            ) {
                return null;
            }
            return { radius: candidateRadius, connection: candidateConnection };
        };

        let fittedConnection = findLoopFreeConnection();
        if (!fittedConnection) {
            // For sharply staggered or near-perpendicular rows, the geometrically
            // preferred side may require a loop. Try the opposite pair of circles
            // before deciding that no smooth U-turn can be generated.
            clockwise = !clockwise;
            clockwiseSign = clockwise ? -1.0 : 1.0;
            fittedConnection = findLoopFreeConnection();
        }
        if (!fittedConnection) {
            // Last resort for complex geometry: test both internal tangents. Their
            // opposite arc directions create a half-eight that gains longitudinal
            // room before aligning with the final section.
            const halfEightCandidates = [];

            clockwise = preferredClockwise;
            clockwiseSign = clockwise ? -1.0 : 1.0;
            const preferredHalfEight = findLoopFreeConnection(!clockwise);
            if (preferredHalfEight) halfEightCandidates.push(preferredHalfEight);

            clockwise = !preferredClockwise;
            clockwiseSign = clockwise ? -1.0 : 1.0;
            const alternateHalfEight = findLoopFreeConnection(preferredClockwise);
            if (alternateHalfEight) halfEightCandidates.push(alternateHalfEight);

            // If both half-eights fit, retain the shortest smooth connection.
            fittedConnection = halfEightCandidates.sort(
                (first, second) =>
                    first.connection.pathLength - second.connection.pathLength
            )[0] || null;
        }
        if (!fittedConnection) return fail('noSmoothConnection');

        const { radius, connection } = fittedConnection;

        const {
            firstCenterX,
            firstCenterY,
            secondCenterX,
            secondCenterY,
            centersDistance
        } = connection;

        const turnPoints = [];

        const lastPoint1 = {};
        columns.forEach((col) => {
            if (col === 'x') lastPoint1[col] = { value: window.GeometryUtils.round3(ax) };
            else if (col === 'y') lastPoint1[col] = { value: window.GeometryUtils.round3(ay) };
            else if (col === 'speed') lastPoint1[col] = { value: speed };
            else if (col === 'working_zone') lastPoint1[col] = { value: 0 };
            else if (col === 'punctual') lastPoint1[col] = { value: {} };
            else {
                const v = this.rowValueAt(a, cols1, col);
                lastPoint1[col] = { value: v !== undefined ? v : 0 };
            }
        });
        turnPoints.push(lastPoint1);


        // Points every 10 cm on the straight row-exit segment (last section point -> point_out)
        this.addPointsAlongSegment(ax, ay, pointOutX, pointOutY, TURN_PATH_SPACING_M, turnPoints, columns, speed);


        const turnPointOut = {};
        columns.forEach(col => {
            if (col === 'x') turnPointOut[col] = { value: window.GeometryUtils.round3(pointOutX) };
            else if (col === 'y') turnPointOut[col] = { value: window.GeometryUtils.round3(pointOutY) };
            else if (col === 'speed') turnPointOut[col] = { value: speed };
            else if (col === 'working_zone') turnPointOut[col] = { value: 0 };
            else if (col === 'punctual') turnPointOut[col] = { value: {} };
            else turnPointOut[col] = { value: 0.0 };
        });
        turnPoints.push(turnPointOut);

        const { firstStartAngle, secondEndAngle } = connection;

        if (centersDistance <= 1e-9) {
            // Adjacent parallel rows at exactly 2R share one center: the shortest
            // solution is a single semicircle with no intermediate straight line.
            this.addCircleArc(
                firstStartAngle,
                secondEndAngle,
                radius,
                firstCenterX,
                firstCenterY,
                connection.firstClockwise,
                turnPoints,
                columns,
                speed
            );
        } else {
            const {
                firstTangentX,
                firstTangentY,
                secondTangentX,
                secondTangentY,
                firstEndAngle,
                secondStartAngle
            } = connection;

            // The first arc ends exactly on the tangent, then the straight segment
            // heads directly toward the second circle instead of following row 1.
            this.addCircleArc(
                firstStartAngle,
                firstEndAngle,
                radius,
                firstCenterX,
                firstCenterY,
                connection.firstClockwise,
                turnPoints,
                columns,
                speed
            );
            this.addPointsAlongSegment(
                firstTangentX,
                firstTangentY,
                secondTangentX,
                secondTangentY,
                TURN_PATH_SPACING_M,
                turnPoints,
                columns,
                speed
            );

            // addPointsAlongSegment excludes endpoints, so retain the exact second
            // tangent point before generating the final alignment arc.
            turnPoints.push(this.createGeneratedTurnPoint(
                secondTangentX,
                secondTangentY,
                columns,
                speed
            ));
            this.addCircleArc(
                secondStartAngle,
                secondEndAngle,
                radius,
                secondCenterX,
                secondCenterY,
                connection.secondClockwise,
                turnPoints,
                columns,
                speed
            );
        }


        // Points every 10 cm on the straight row-entry segment (point_in -> first point of section2)
        this.addPointsAlongSegment(pointInX, pointInY, cx, cy, TURN_PATH_SPACING_M, turnPoints, columns, speed);

        const firstPoint2 = {};
        columns.forEach((col) => {
            if (col === 'x') firstPoint2[col] = { value: window.GeometryUtils.round3(cx) };
            else if (col === 'y') firstPoint2[col] = { value: window.GeometryUtils.round3(cy) };
            else if (col === 'speed') firstPoint2[col] = { value: speed };
            else if (col === 'working_zone') firstPoint2[col] = { value: 0 };
            else if (col === 'punctual') firstPoint2[col] = { value: {} };
            else {
                const v = this.rowValueAt(c, cols2, col);
                firstPoint2[col] = { value: v !== undefined ? v : 0 };
            }
        });
        turnPoints.push(firstPoint2);

        return {
            section_type: 'turn_path',
            columns: columns,
            values: turnPoints.map((point) => this.turnPointObjectToRow(point, columns))
        };
    }

    /**
     * Estimate the travel tangent at a section endpoint with a local PCA fit.
     *
     * Points are collected over a metric window so the estimate remains stable
     * regardless of point density. The fitted axis is oriented from section start
     * to section end to preserve the actual travel direction.
     */
    estimateSectionEndpointDirection(section, columns, atEnd, sampleDistance) {
        const values = section.values || [];
        if (values.length < 2) return null;

        const samples = [];
        const endpointIndex = atEnd ? values.length - 1 : 0;
        const step = atEnd ? -1 : 1;
        let currentIndex = endpointIndex;
        let travelledDistance = 0;
        let previousPoint = this.rowXY(values[currentIndex], columns);
        samples.push([previousPoint.x, previousPoint.y]);

        // Collect consecutive points until the requested local row length is covered.
        while (travelledDistance < sampleDistance) {
            const nextIndex = currentIndex + step;
            if (nextIndex < 0 || nextIndex >= values.length) break;

            const nextPoint = this.rowXY(values[nextIndex], columns);
            travelledDistance += this.distance(
                previousPoint.x,
                previousPoint.y,
                nextPoint.x,
                nextPoint.y
            );
            samples.push([nextPoint.x, nextPoint.y]);
            previousPoint = nextPoint;
            currentIndex = nextIndex;
        }

        // Restore start-to-end order before orienting the otherwise unsigned PCA axis.
        if (atEnd) samples.reverse();

        const first = samples[0];
        const last = samples[samples.length - 1];
        const chordX = last[0] - first[0];
        const chordY = last[1] - first[1];
        if (Math.sqrt(chordX * chordX + chordY * chordY) <= 1e-9) return null;

        const meanX = samples.reduce((sum, point) => sum + point[0], 0) / samples.length;
        const meanY = samples.reduce((sum, point) => sum + point[1], 0) / samples.length;
        let covarianceXX = 0;
        let covarianceXY = 0;
        let covarianceYY = 0;

        samples.forEach((point) => {
            const offsetX = point[0] - meanX;
            const offsetY = point[1] - meanY;
            covarianceXX += offsetX * offsetX;
            covarianceXY += offsetX * offsetY;
            covarianceYY += offsetY * offsetY;
        });

        // The principal covariance axis gives the least-squares local row direction.
        const angle = 0.5 * Math.atan2(
            2 * covarianceXY,
            covarianceXX - covarianceYY
        );
        let directionX = Math.cos(angle);
        let directionY = Math.sin(angle);
        if (directionX * chordX + directionY * chordY < 0) {
            directionX *= -1;
            directionY *= -1;
        }

        return [directionX, directionY];
    }

    /**
     * Build a generated turn point with consistent metadata and coordinate rounding.
     */
    createGeneratedTurnPoint(x, y, columns, speed) {
        const point = {};
        columns.forEach((col) => {
            if (col === 'x') point[col] = { value: window.GeometryUtils.round3(x) };
            else if (col === 'y') point[col] = { value: window.GeometryUtils.round3(y) };
            else if (col === 'speed') point[col] = { value: speed };
            else if (col === 'working_zone') point[col] = { value: 0 };
            else if (col === 'punctual') point[col] = { value: {} };
            else point[col] = { value: 0.0 };
        });
        return point;
    }

    /**
     * Add intermediate points every `spacing` meters on segment (x1,y1)->(x2,y2), excluding endpoints
     */
    addPointsAlongSegment(x1, y1, x2, y2, spacing, points, columns, speed) {
        const d = this.distance(x1, y1, x2, y2);
        if (d < 1e-9) return;
        for (let j = 1; j * spacing < d; j++) {
            const t = (j * spacing) / d;
            const x = x1 + t * (x2 - x1);
            const y = y1 + t * (y2 - y1);
            const point = {};
            columns.forEach(col => {
                // GeometryUtils.round3: this class does not expose this.round3 (see createUTurn / addCircleArc)
                if (col === 'x') point[col] = { value: window.GeometryUtils.round3(x) };
                else if (col === 'y') point[col] = { value: window.GeometryUtils.round3(y) };
                else if (col === 'speed') point[col] = { value: speed };
                else if (col === 'working_zone') point[col] = { value: 0 };
                else if (col === 'punctual') point[col] = { value: {} };
                else point[col] = { value: 0.0 };
            });
            points.push(point);
        }
    }

    /**
     * Get line coefficients
     */
    getLineCoefs(x1, y1, x2, y2) {
        const a = y2 - y1;
        const b = x1 - x2;
        const c = x2 * y1 - x1 * y2;
        return [a, b, c];
    }

    /**
     * Project a point onto a line
     */
    projectPointOnLine(px, py, coefs) {
        const [a, b, c] = coefs;
        const denom = a * a + b * b;
        if (denom === 0.0) return [px, py];
        const x = (b * (b * px - a * py) - a * c) / denom;
        const y = (a * (-b * px + a * py) - b * c) / denom;
        return [x, y];
    }

    /**
     * Normalize a vector
     */
    normalize(x, y) {
        const len = Math.sqrt(x * x + y * y);
        return len > 0 ? [x / len, y / len] : [1.0, 0.0];
    }

    /**
     * Distance between two points
     */
    distance(x1, y1, x2, y2) {
        return Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
    }

    /**
     * Normalize an angle to [-pi, pi]
     */
    normalizeAngleToPi(angle) {
        let normalized = angle;
        while (normalized > Math.PI) normalized -= 2.0 * Math.PI;
        while (normalized < -Math.PI) normalized += 2.0 * Math.PI;
        return normalized;
    }

    /**
     * Return the signed angular sweep from start to end in the requested direction.
     */
    getDirectedArcSweep(startAngle, endAngle, clockwise) {
        const twoPi = 2.0 * Math.PI;
        const normalizedStart = (startAngle % twoPi + twoPi) % twoPi;
        const normalizedEnd = (endAngle % twoPi + twoPi) % twoPi;
        return clockwise
            ? -((normalizedStart - normalizedEnd + twoPi) % twoPi)
            : (normalizedEnd - normalizedStart + twoPi) % twoPi;
    }

    /**
     * Add a circular arc with a maximum 5° angular step, including its endpoint.
     *
     * Dividing the exact signed sweep avoids the endless loop caused when a
     * variable end angle is not an exact multiple of the previous fixed 5° step.
     */
    addCircleArc(startAngle, endAngle, radius, centerX, centerY, clockwise, points, columns, speed) {
        const sweep = this.getDirectedArcSweep(startAngle, endAngle, clockwise);
        const maxStep = Math.PI / 180.0 * 5.0;
        const stepCount = Math.max(1, Math.ceil(Math.abs(sweep) / maxStep));

        for (let stepIndex = 1; stepIndex <= stepCount; stepIndex += 1) {
            const theta = startAngle + sweep * stepIndex / stepCount;
            const x = centerX + Math.cos(theta) * radius;
            const y = centerY + Math.sin(theta) * radius;
            points.push(this.createGeneratedTurnPoint(x, y, columns, speed));
        }
    }

    // ========== Working zone and point-deletion helper methods ==========

    /**
     * Point-in-polygon test (ray casting)
     */
    pointInPolygon(px, py, polygon) {
        const n = polygon.length;
        let inside = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = polygon[i][0], yi = polygon[i][1];
            const xj = polygon[j][0], yj = polygon[j][1];
            if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    /**
     * Polygon in local coordinates (meters) from lat/lng points
     */
    getPolygonLocalFromLatLngs(latLngs) {
        if (!latLngs || latLngs.length < 3) return null;
        const origin = this.currentTrajectory.origin.coordinates;
        return latLngs.map(p => [
            window.GeometryUtils.round3((p.lng - origin.lon) * 111320 * Math.cos(origin.lat * Math.PI / 180)),
            window.GeometryUtils.round3((p.lat - origin.lat) * 111320)
        ]);
    }

    /**
     * Apply working_zone (1 or 0) to all points whose (x,y) lies inside the polygon (local)
     */
    applyWorkingZoneInPolygon(polygon, value) {
        if (!polygon) return 0;
        let count = 0;
        this.currentTrajectory.points.forEach((section) => {
            const xIndex = section.columns.indexOf('x');
            const yIndex = section.columns.indexOf('y');
            const wzIndex = section.columns.indexOf('working_zone');
            if (xIndex === -1 || yIndex === -1 || wzIndex === -1) return;
            section.values.forEach((row) => {
                const x = row[xIndex];
                const y = row[yIndex];
                if (this.pointInPolygon(x, y, polygon)) {
                    row[wzIndex] = value;
                    count++;
                }
            });
        });
        return count;
    }

    /**
     * Return the list of points (sectionIndex, pointIndex) inside the polygon (local)
     */
    getPointsInPolygon(polygon) {
        if (!polygon) return [];
        const list = [];
        this.currentTrajectory.points.forEach((section, sectionIndex) => {
            const xIndex = section.columns.indexOf('x');
            const yIndex = section.columns.indexOf('y');
            if (xIndex === -1 || yIndex === -1) return;
            section.values.forEach((row, pointIndex) => {
                const x = row[xIndex];
                const y = row[yIndex];
                if (this.pointInPolygon(x, y, polygon)) {
                    list.push({ sectionIndex, pointIndex });
                }
            });
        });
        return list;
    }

    /**
     * Build the new section list after deleting points (split / trim)
     */
    buildSectionsAfterDelete(pointsToDelete) {
        if (pointsToDelete.length === 0) return this.currentTrajectory.points.slice();

        const toDeleteBySection = {};
        pointsToDelete.forEach(({ sectionIndex, pointIndex }) => {
            if (!toDeleteBySection[sectionIndex]) toDeleteBySection[sectionIndex] = new Set();
            toDeleteBySection[sectionIndex].add(pointIndex);
        });

        const newPoints = [];
        this.currentTrajectory.points.forEach((section, sectionIndex) => {
            const deleteSet = toDeleteBySection[sectionIndex];
            if (!deleteSet || deleteSet.size === 0) {
                newPoints.push(JSON.parse(JSON.stringify(section)));
                return;
            }
            const numPoints = section.values.length;
            const keptIndices = [];
            for (let i = 0; i < numPoints; i++) {
                if (!deleteSet.has(i)) keptIndices.push(i);
            }
            if (keptIndices.length === 0) return;
            // Split into consecutive runs
            const runs = [];
            let runStart = keptIndices[0];
            for (let i = 1; i <= keptIndices.length; i++) {
                if (i === keptIndices.length || keptIndices[i] !== keptIndices[i - 1] + 1) {
                    runs.push({ start: runStart, end: keptIndices[i - 1] });
                    if (i < keptIndices.length) runStart = keptIndices[i];
                }
            }
            runs.forEach(({ start, end }) => {
                const newValues = section.values.slice(start, end + 1).map(row => JSON.parse(JSON.stringify(row)));
                if (newValues.length >= 1) {
                    newPoints.push({
                        ...JSON.parse(JSON.stringify(section)),
                        values: newValues
                    });
                }
            });
        });
        return newPoints;
    }

    /**
     * Update all interface translations
     * Called when the language changes
     */
    updateTranslations() {
        if (!window.i18n) return;
        
        const t = (key, params = {}) => window.i18n.t(key, params);
        
        // Automatically translate all elements with data-i18n
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            if (key) {
                element.textContent = t(key);
            }
        });
        
        // Translate title attributes with data-i18n-title
        document.querySelectorAll('[data-i18n-title]').forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            if (key) {
                element.setAttribute('title', t(key));
            }
        });
        
        // Translate aria-label attributes with data-i18n-aria-label
        document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
            const key = element.getAttribute('data-i18n-aria-label');
            if (key) {
                element.setAttribute('aria-label', t(key));
            }
        });
        
        // Translate placeholder attributes with data-i18n-placeholder
        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            if (key) {
                element.setAttribute('placeholder', t(key));
            }
        });
        
        // Translate select options that have data-i18n
        document.querySelectorAll('select option[data-i18n]').forEach(option => {
            const key = option.getAttribute('data-i18n');
            if (key) {
                option.textContent = t(key);
            }
        });
        

        
        // Update instructions through PanelView when available
        if (this.panelView) {
            this.panelView.updateInstructionCard(this.mapController?.editMode || 'none', this.mapController?.tempPoints?.length || 0, window.i18n);
        }
    }

    /**
     * Get the move step
     * @returns {number} Move step in meters
     */
    getMoveStep() {
        return this.moveStep;
    }

    /**
     * Set the move step
     * @param {number} step - Step in meters
     */
    setMoveStep(step) {
        this.moveStep = step || 0.5;
    }

    /**
     * Get the rotation step
     * @returns {number} Rotation step in degrees
     */
    getRotationStep() {
        return this.rotationStep;
    }

    /**
     * Set the rotation step
     * @param {number} step - Step in degrees
     */
    setRotationStep(step) {
        this.rotationStep = step || 5;
    }

    /**
     * Move selected sections
     * @param {number} dx - X displacement (meters)
     * @param {number} dy - Y displacement (meters)
     */
    moveSelectedSections(dx, dy) {
        if (!this.selectedSectionIndices || this.selectedSectionIndices.length === 0) {
            return;
        }

        this.saveForUndo();

        const origin = this.currentTrajectory.origin?.coordinates;
        if (!origin) {
            console.warn('[TrajectoryEditor] Pas d\'origine définie pour le déplacement');
            return;
        }

        // Convert displacement to local coordinates
        const localDx = dx;
        const localDy = dy;

        // Apply displacement to all selected sections
        const newPoints = this.currentTrajectory.points.map((section, index) => {
            if (!this.selectedSectionIndices.includes(index)) {
                return section;
            }

            // Move all points in the section
            const newValues = section.values.map(pointValues => {
                const newPointValues = [...pointValues];
                const xIndex = section.columns.indexOf('x');
                const yIndex = section.columns.indexOf('y');

                if (xIndex !== -1 && yIndex !== -1) {
                    newPointValues[xIndex] += localDx;
                    newPointValues[yIndex] += localDy;
                }

                return newPointValues;
            });

            return { ...section, values: newValues };
        });

        this.currentTrajectory = { ...this.currentTrajectory, points: newPoints };
        this.updateAll();
    }

    /**
     * Rotate selected sections around their shared centroid
     * @param {number} angleDegrees - Rotation angle in degrees
     */
    rotateSelectedSections(angleDegrees) {
        if (!this.selectedSectionIndices || this.selectedSectionIndices.length === 0) {
            return;
        }

        this.saveForUndo();

        // Compute the centroid of all selected sections
        let sumX = 0;
        let sumY = 0;
        let totalPoints = 0;

        this.selectedSectionIndices.forEach(index => {
            const section = this.currentTrajectory.points[index];
            if (!section || !section.values || section.values.length === 0) {
                return;
            }

            const xIndex = section.columns.indexOf('x');
            const yIndex = section.columns.indexOf('y');
            if (xIndex === -1 || yIndex === -1) {
                return;
            }

            section.values.forEach(pointValues => {
                sumX += pointValues[xIndex];
                sumY += pointValues[yIndex];
                totalPoints++;
            });
        });

        if (totalPoints === 0) {
            console.warn('[TrajectoryEditor] Aucun point trouvé pour la rotation');
            return;
        }

        // Shared centroid of all selected sections
        const centerX = sumX / totalPoints;
        const centerY = sumY / totalPoints;

// Convert angle to radians
        const angleRad = (angleDegrees * Math.PI) / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);

        // Update the current rotation angle
        this.currentRotationAngle = (this.currentRotationAngle + angleDegrees + 360) % 360;
        const rotationValue = document.getElementById('panelRotationValue');
        if (rotationValue) {
            rotationValue.textContent = `${this.currentRotationAngle}°`;
        }

        // Apply rotation to all selected sections around the shared centroid
        const newPoints = this.currentTrajectory.points.map((section, index) => {
            if (!this.selectedSectionIndices.includes(index)) {
                return section;
            }

            const xIndex = section.columns.indexOf('x');
            const yIndex = section.columns.indexOf('y');
            if (xIndex === -1 || yIndex === -1) {
                return section;
            }

            // Rotate all section points around the centroid
            const newValues = section.values.map(pointValues => {
                const newPointValues = [...pointValues];
                const x = pointValues[xIndex];
                const y = pointValues[yIndex];

                // Translate to center on the centroid origin
                const dx = x - centerX;
                const dy = y - centerY;

                // Rotate around the origin
                const rotatedX = dx * cos - dy * sin;
                const rotatedY = dx * sin + dy * cos;

                // Translate back
                const newX = rotatedX + centerX;
                const newY = rotatedY + centerY;

                newPointValues[xIndex] = GeometryUtils.round3(newX);
                newPointValues[yIndex] = GeometryUtils.round3(newY);

                return newPointValues;
            });

            return { ...section, values: newValues };
        });

        this.currentTrajectory = { ...this.currentTrajectory, points: newPoints };
        this.updateAll();
    }

    /**
     * Reverse points in a section
     * @param {number} index - Section index to reverse
     */
    reverseSectionPoints(index) {
        if (index < 0 || index >= this.currentTrajectory.points.length) {
            return;
        }

        this.saveForUndo();

        const newTrajectory = this.sectionController.reverseSectionPoints(this.currentTrajectory, index);
        this.currentTrajectory = newTrajectory;
        this.updateAll();
    }

    /**
     * Get the normalized perpendicular direction of a section
     * Left side relative to first point -> last point direction
     * @param {Object} section - Trajectory section
     * @returns {{perpX: number, perpY: number}} Normalized perpendicular vector
     */
    getSectionPerpendicular(section) {
        const cols = section.columns || [];
        const vals = section.values;
        const xi = cols.indexOf('x');
        const yi = cols.indexOf('y');
        
        // If x or y columns are missing, or the section has fewer than 2 points, return a default vector
        if (xi === -1 || yi === -1 || !vals || vals.length < 2) {
            return { perpX: 1, perpY: 0 };
        }
        
        // Get the first and last points
        const x0 = vals[0][xi];
        const y0 = vals[0][yi];
        const x1 = vals[vals.length - 1][xi];
        const y1 = vals[vals.length - 1][yi];
        
        // Compute the direction vector
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.sqrt(dx * dx + dy * dy);
        
        // If length is too small, return a default vector
        if (len < 1e-9) {
            return { perpX: 1, perpY: 0 };
        }
        
        // Left perpendicular: (-dy, dx) normalized
        const perpX = -dy / len;
        const perpY = dx / len;
        
        return { perpX, perpY };
    }

    /**
     * Duplicate the selected section(s) at the given distance (m)
     * Side 'left' or 'right', then append to the end of the trajectory
     * @param {number} distanceM - Distance in meters
     * @param {string} side - Side: 'left' or 'right'
     * @param {number} count - Number of sections to create from each selected section
     */
    duplicateSectionAtDistance(distanceM, side, count = 1) {
        // Ensure sections are selected
        if (!this.selectedSectionIndices || this.selectedSectionIndices.length === 0) {
            if (this.notificationService) {
                this.notificationService.show('notification.selectSections', 'warning');
            }
            return;
        }

        // Save for undo
        this.saveForUndo();

        // Determine offset sign from side
        // 'right' = -1 (opposite left perpendicular)
        // 'left' = 1 (same direction as left perpendicular)
        const sign = (side === 'right') ? -1 : 1;
        const offset = sign * Math.abs(distanceM);
        // Clamp the requested count so the duplication loop always works with whole, positive rows.
        const duplicateCount = Math.max(1, Math.floor(Number(count) || 1));

        // Iterate over each selected section
        const newSections = [];
        
        this.selectedSectionIndices.forEach(index => {
            if (index < 0 || index >= this.currentTrajectory.points.length) {
                return; // Skip invalid indices
            }

            // Deep-copy the selected section
            const section = JSON.parse(JSON.stringify(this.currentTrajectory.points[index]));
            const cols = section.columns || [];
            const xi = cols.indexOf('x');
            const yi = cols.indexOf('y');

            // If x or y columns are missing, preserve the old behavior shape but still honor the count.
            if (xi === -1 || yi === -1) {
                for (let copyIndex = 1; copyIndex <= duplicateCount; copyIndex += 1) {
                    const copiedSection = JSON.parse(JSON.stringify(section));
                    if (copyIndex % 2 === 1) {
                        copiedSection.values.reverse();
                    }
                    newSections.push(copiedSection);
                }
                return;
            }

            // Get the normalized perpendicular vector for this section
            const { perpX, perpY } = this.getSectionPerpendicular(section);

            for (let copyIndex = 1; copyIndex <= duplicateCount; copyIndex += 1) {
                const shiftedSection = JSON.parse(JSON.stringify(section));
                const copyOffset = offset * copyIndex;

                // Each generated section is shifted one additional spacing from the original section.
                shiftedSection.values = shiftedSection.values.map(row => {
                    const r = [...row];
                    r[xi] = window.GeometryUtils.round3(row[xi] + copyOffset * perpX);
                    r[yi] = window.GeometryUtils.round3(row[yi] + copyOffset * perpY);
                    return r;
                });

                // Copy 1 must be opposite to the base section; copies then alternate direction.
                if (copyIndex % 2 === 1) {
                    shiftedSection.values.reverse();
                }

                newSections.push(shiftedSection);
            }
        });

        // Append all duplicated sections to the end of the trajectory
        this.currentTrajectory.points.push(...newSections);

        // Update the display
        this.updateAll();
    }

    /**
     * Delete selected sections
     * Show a confirmation before deleting
     */
    async deleteSelectedSections() {
        // Ensure sections are selected
        if (!this.selectedSectionIndices || this.selectedSectionIndices.length === 0) {
            return;
        }

        const count = this.selectedSectionIndices.length;
        const plural = count > 1 ? 's' : '';

        // Show confirmation
        let confirmed = false;
        if (window.ConfirmDialog) {
            confirmed = await ConfirmDialog.show(
                'confirm.deleteSections.message',
                'confirm.deleteSections.title',
                { count, plural }
            );
        } else {
            // Fall back to window.confirm if ConfirmDialog is not available
            const t = window.i18n ? window.i18n.t.bind(window.i18n) : (key, params) => key;
            const message = t('confirm.deleteSections.message', { count, plural });
            const title = t('confirm.deleteSections.title');
            confirmed = confirm(`${title}\n\n${message}`);
        }

        if (!confirmed) {
            return;
        }

        // Save for undo
        this.saveForUndo();

        // Delete sections by descending index to avoid index shifts
        const sortedIndices = [...this.selectedSectionIndices].sort((a, b) => b - a);
        sortedIndices.forEach(index => {
            if (index >= 0 && index < this.currentTrajectory.points.length) {
                this.currentTrajectory.points.splice(index, 1);
            }
        });

        // Deselect sections and hide the edit panel
        this.clearSectionSelection();

        // Exit selection mode and return to the initial state
        this.mapController.setEditMode('none', () => {
            // Update the display
            this.updateAll();
        });

        // Show a success notification
        if (this.notificationService) {
            this.notificationService.show('notification.sectionsDeleted', 'success', 3000, { count, plural });
        }
    }
}

// Export for global use
window.TrajectoryEditor = TrajectoryEditor;
