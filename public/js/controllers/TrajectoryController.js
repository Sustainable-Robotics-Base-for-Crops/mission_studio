/**
 * Controller for trajectory management
 * Handles trajectory creation, loading, saving, and deletion
 */
class TrajectoryController {
    constructor(apiService, notificationService) {
        this.apiService = apiService;
        this.notificationService = notificationService;
        this.progressService = window.progressService || null;
    }

    /**
     * Build the Agri document that will actually be written to the JSON file.
     * The filename field remains storage metadata and is not part of the Agri format.
     * @param {Object} trajectory - Current editor trajectory
     * @returns {Object} Agri document without internal filename metadata
     */
    _toAgriJsonPayload(trajectory) {
        let payload;
        if (trajectory && typeof trajectory.toJSON === 'function') {
            payload = trajectory.toJSON();
        } else {
            const { filename: _filename, ...trajectoryWithoutFilename } = trajectory || {};
            payload = trajectoryWithoutFilename;
        }

        // A missing optional field is valid, but `null` is not valid for an Agri section.
        if (payload.geofencing == null) {
            delete payload.geofencing;
        }

        return payload;
    }

    /**
     * Prevalidate the Agri document with the official server-side schema.
     * This step blocks any local or cloud save when the generated JSON is not compliant.
     * @param {Object} trajectory - Trajectory to validate before saving
     * @returns {Promise<Object>} Validated Agri document
     */
    async validateTrajectoryBeforeSave(trajectory) {
        const agriPayload = this._toAgriJsonPayload(trajectory);
        await this.apiService.post('/api/trajectories/validate', agriPayload);
        return agriPayload;
    }

    /**
     * Create a new empty trajectory
     * @returns {Object} New trajectory
     */
    createNewTrajectory() {
        return {
            version: "3",
            filename: "new_trajectory.json",
            file_type: "mission_order",
            vehicle_id: "v1",
            metadata: {},
            origin: {
                type: "WGS84",
                coordinates: { lat: 48.8566, lon: 2.3522, alt: 0.0 }
            },
            points: [],
            geofencing: null
        };
    }

    /**
     * Save a trajectory locally (download)
     * Uses the native iOS handler if available, otherwise uses the standard web approach
     * @param {Object} trajectory - Trajectory to save
     * @returns {Promise<void>}
     */
    async saveTrajectoryLocal(trajectory) {
        try {
            const filename = trajectory.filename || 'new_trajectory.json';
            
            if (!filename.toLowerCase().endsWith('.json')) {
                if (this.notificationService) {
                    this.notificationService.show('notification.filenameError', 'error');
                }
                return;
            }

            // Ensure the filename ends with .json
            const finalFilename = filename.toLowerCase().endsWith('.json') ? filename : filename + '.json';
            
            // Validate the final Agri JSON before starting the local download.
            const trajectoryForJson = await this.validateTrajectoryBeforeSave(trajectory);
            const jsonStr = JSON.stringify(trajectoryForJson, null, 2);
            
            // Check whether this is an iOS WebView with a native handler
            const isIOSWebView = /(iPhone|iPod|iPad).*AppleWebKit(?!.*Safari)/i.test(navigator.userAgent);
            const hasNativeHandler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.downloadFile;
            
            if (isIOSWebView && hasNativeHandler) {
                // Use the native iOS handler for the download
                try {
                    // Convert the JSON to base64
                    const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));
                    
                    // Send the message to the native handler
                    window.webkit.messageHandlers.downloadFile.postMessage({
                        filename: finalFilename,
                        data: base64Data,
                        mimeType: 'application/json'
                    });
                    
                    if (this.notificationService) {
                        this.notificationService.show('notification.saveSuccess', 'success', 3000, { filename: finalFilename });
                    }
                } catch (error) {
                    console.error('Error when sending to native handler:', error);
                    if (this.notificationService) {
                        this.notificationService.show('notification.saveError', 'error', 5000, { error: error.message });
                    }
                }
            } else {
                // Standard web approach for browsers and Safari iOS
                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
                const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
                
                if (isIOS || isSafari) {
                    // For Safari iOS, use the server approach
                    try {
                        const authHeaders = await this.apiService.getAuthHeaders();
                        const response = await fetch('/api/trajectories/download', {
                            method: 'POST',
                            headers: {
                                ...authHeaders,
                                'Content-Type': 'application/json'
                            },
                            credentials: 'include',
                            body: JSON.stringify({ trajectory: trajectoryForJson })
                        });
                        
                        if (!response.ok) {
                            throw new Error(`HTTP error: ${response.status}`);
                        }
                        
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = finalFilename;
                        a.style.display = 'none';
                        document.body.appendChild(a);
                        a.click();
                        
                        setTimeout(() => {
                            document.body.removeChild(a);
                            window.URL.revokeObjectURL(url);
                        }, 100);
                        
                        if (this.notificationService) {
                            this.notificationService.show('notification.saveSuccess', 'success', 3000, { filename: finalFilename });
                        }
                    } catch (error) {
                        console.error('Error when downloading via server:', error);
                        // Fallback to blob
                        this._downloadBlob(jsonStr, finalFilename);
                    }
                } else {
                    // Standard blob approach for other browsers
                    this._downloadBlob(jsonStr, finalFilename);
                }
            }
        } catch (error) {
            console.error('Error during saving:', error);
            if (this.notificationService) {
                this.notificationService.show('notification.saveError', 'error', 5000, { error: error.message });
            }
        }
    }

    /**
     * Download a blob (utility method)
     * @param {string} jsonStr - JSON as string
     * @param {string} filename - File name
     * @private
     */
    _downloadBlob(jsonStr, filename) {
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (this.notificationService) {
            this.notificationService.show('notification.saveSuccess', 'success', 3000, { filename });
        }
    }

    /**
     * Save a trajectory to plugin storage.
     * @param {Object} trajectory - Trajectory to save
     * @param {string} storageMode - Storage mode ('local', backend plugin, 'both')
     * @returns {Promise<void>}
     */
    async saveTrajectoryStorage(trajectory, storageMode = 'local') {
        // Displayed name / object key: must reflect the filename field (not only the default).
        let safeFilename = (trajectory.filename || 'new_trajectory.json').trim();
        if (!safeFilename) {
            safeFilename = 'new_trajectory.json';
        }
        // Prevent an accidentally entered path from becoming part of the S3 key (keep only the basename).
        const baseOnly = safeFilename.replace(/^.*[/\\]/, '');
        safeFilename = baseOnly || 'new_trajectory.json';
        if (!safeFilename.toLowerCase().endsWith('.json')) {
            safeFilename += '.json';
        }

        const saveMessage = window.i18n ? window.i18n.t('progress.savingCloud', { filename: safeFilename }) : `Saving ${safeFilename}...`;
        
        try {
            // Show the progress indicator
            if (this.progressService) {
                this.progressService.show(saveMessage, null); // Indeterminate mode
            }
            
            // The backend builds the storage key and validates the name through `filename`.
            const trajectoryData = {
                version: trajectory.version || '3',
                filename: safeFilename,
                vehicle_id: trajectory.vehicle_id || 'v1',
                file_type: trajectory.file_type || 'draft',
                origin: trajectory.origin || {
                    type: "WGS84",
                    coordinates: { lat: 48.8566, lon: 2.3522, alt: 0.0 }
                },
                points: trajectory.points || [],
                metadata: trajectory.metadata || {}
            };
            
            // Add geofencing if present
            if (trajectory.geofencing) {
                trajectoryData.geofencing = trajectory.geofencing;
            }

            // Prevalidate the Agri JSON before the local/cloud write call.
            await this.validateTrajectoryBeforeSave(trajectoryData);

            // Add the header that indicates the storage mode
            const headers = {
                'X-Storage-Mode': storageMode
            };

            // Update progress
            if (this.progressService) {
                this.progressService.updateProgress(30);
                this.progressService.updateMessage(window.i18n ? window.i18n.t('progress.uploading') : 'Uploading data...');
            }

            // Send the trajectory data directly (the backend expects it directly)
            await this.apiService.post('/api/trajectories', trajectoryData, headers);

            // Align the in-memory object with the name that was actually sent (basename + .json).
            trajectory.filename = safeFilename;

            // Update progress
            if (this.progressService) {
                this.progressService.updateProgress(80);
                this.progressService.updateMessage(window.i18n ? window.i18n.t('progress.processing') : 'Processing...');
            }

            // Simulate a short delay for the final progress state
            await new Promise(resolve => setTimeout(resolve, 200));

            // Hide the progress indicator
            if (this.progressService) {
                this.progressService.hide();
            }

            if (this.notificationService) {
                this.notificationService.show('notification.saveCloudSuccess', 'success', 3000, { filename: safeFilename });
            }
        } catch (error) {
            console.error('Error:', error);
            
            // Hide the progress indicator in case of error
            if (this.progressService) {
                this.progressService.hide();
            }
            
            if (this.notificationService) {
                this.notificationService.show('notification.saveCloudError', 'error', 5000, { error: error.message });
            }
            throw error;
        }
    }

    /**
     * Legacy compatibility: keep the historical signature used by some modules/plugins.
     */
    async saveTrajectoryCloud(trajectory, storageMode = 'cloud') {
        return this.saveTrajectoryStorage(trajectory, storageMode);
    }

    /**
     * Last component of a decoded storage key/path for the UI and trajectory.filename.
     * The JSON returned by the API does not include filename: always derive it from the load parameter.
     * @param {string} pathOrKey - Path like "draft/robot/file.json" or simple "file.json"
     * @returns {string}
     */
    _basenameFromStoragePath(pathOrKey) {
        if (!pathOrKey || typeof pathOrKey !== 'string') {
            return 'new_trajectory.json';
        }
        let s = pathOrKey;
        try {
            s = decodeURIComponent(pathOrKey);
        } catch (e) {
            s = pathOrKey;
        }
        s = s.replace(/\\/g, '/');
        const parts = s.split('/').filter(Boolean);
        const base = parts.length > 0 ? parts[parts.length - 1] : s;
        const trimmed = base.trim();
        return trimmed || 'new_trajectory.json';
    }

    /**
     * Load a trajectory from the server
     * @param {string} filename - File name to load
     * @param {string|null} storageMode - Target backend ('local', plugin backend name, etc.)
     * @returns {Promise<Object>} Loaded trajectory
     */
    async loadTrajectory(filename, storageMode = null) {
        const displayFileName = this._basenameFromStoragePath(filename);

        const loadMessage = window.i18n ? window.i18n.t('progress.loadingCloud', { filename: displayFileName }) : `Loading ${displayFileName}...`;
        
        try {
            // Show the progress indicator
            if (this.progressService) {
                this.progressService.show(loadMessage, null); // Indeterminate mode
            }

            // Update progress
            if (this.progressService) {
                this.progressService.updateProgress(30);
                this.progressService.updateMessage(window.i18n ? window.i18n.t('progress.fetching') : 'Fetching data...');
            }

            // Pass the target backend to avoid loading the wrong storage when keys look similar.
            const queryParams = {};
            if (storageMode) {
                queryParams.storage = storageMode;
            }
            const trajectory = await this.apiService.get(
                `/api/trajectories/${encodeURIComponent(filename)}`,
                queryParams
            );

            // Align the client model with the file that was actually loaded (the JSON body has no filename)
            trajectory.filename = displayFileName;

            // Update progress
            if (this.progressService) {
                this.progressService.updateProgress(80);
                this.progressService.updateMessage(window.i18n ? window.i18n.t('progress.processing') : 'Processing...');
            }

            // Simulate a short delay for the final progress state
            await new Promise(resolve => setTimeout(resolve, 200));

            // Hide the progress indicator
            if (this.progressService) {
                this.progressService.hide();
            }

            if (this.notificationService) {
                this.notificationService.show('notification.loadSuccess', 'success', 3000, { filename: displayFileName });
            }

            return trajectory;
        } catch (error) {
            console.error('Error:', error);
            
            // Hide the progress indicator in case of error
            if (this.progressService) {
                this.progressService.hide();
            }
            
            if (this.notificationService) {
                this.notificationService.show('notification.loadError', 'error', 5000, { error: error.message });
            }
            throw error;
        }
    }

    /**
     * Delete a trajectory
     * @param {string} filename - File name to delete
     * @param {Function} confirmCallback - Confirmation callback (optional, uses ConfirmDialog by default)
     * @returns {Promise<void>}
     */
    async deleteTrajectory(filename, confirmCallback = null) {
        let confirmed = false;
        
        if (confirmCallback) {
            // Use the provided callback (for compatibility)
            confirmed = await confirmCallback(
                window.i18n ? window.i18n.t('confirm.deleteTrajectory.message') : 'Are you sure you want to delete this trajectory?',
                window.i18n ? window.i18n.t('confirm.deleteTrajectory.title') : 'Delete trajectory'
            );
        } else {
            // Use ConfirmDialog by default
            if (window.ConfirmDialog) {
                confirmed = await ConfirmDialog.show('confirm.deleteTrajectory.message', 'confirm.deleteTrajectory.title');
            } else {
                // Fall back to window.confirm if ConfirmDialog is not available
                const t = window.i18n ? window.i18n.t.bind(window.i18n) : (key) => key;
                confirmed = confirm(t('confirm.deleteTrajectory.message'));
            }
        }
        
        if (!confirmed) return;

        try {
            await this.apiService.delete(`/api/trajectories/${filename}`);

            if (this.notificationService) {
                this.notificationService.show('notification.deleteSuccess', 'success');
            }
        } catch (error) {
            console.error('Error:', error);
            if (this.notificationService) {
                this.notificationService.show('notification.deleteError', 'error', 5000, { error: error.message });
            }
        }
    }

    /**
     * Get the file type title
     * @param {string} value - Type value
     * @returns {string} Type title
     */
    getFileTypeTitle(value) {
        const titles = {
            'draft': 'Brouillon',
            'mission_order': 'Ordre de mission',
            'parcel_map': 'Carte de parcelle',
            'work_performed': 'Travail effectué'
        };
        return titles[value] || 'Brouillon';
    }
}

// Export for global use
window.TrajectoryController = TrajectoryController;
