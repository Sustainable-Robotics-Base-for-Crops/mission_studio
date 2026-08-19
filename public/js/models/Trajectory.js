/**
 * Data model for a trajectory
 */

class Trajectory {
    constructor(data = {}) {
        this.version = data.version || '3';
        this.filename = data.filename || 'new_trajectory.json';
        this.vehicle_id = data.vehicle_id || 'v1';
        this.file_type = data.file_type || 'draft';
        this.origin = data.origin || {
            type: 'WGS84',
            coordinates: { lat: 48.8566, lon: 2.3522, alt: 0.0 }
        };
        this.points = data.points || [];
        this.metadata = data.metadata || {};
        this.geofencing = data.geofencing || null;
    }

    /**
     * Convert the model to a JSON dictionary
     * Note: The 'filename' field is not included in the JSON as it is managed by the storage system
     * @returns {Object} Dictionary representing the trajectory
     */
    toJSON() {
        const result = {
            version: this.version,
            vehicle_id: this.vehicle_id,
            file_type: this.file_type,
            origin: this.origin,
            points: this.points,
            metadata: this.metadata
        };
        
        if (this.geofencing) {
            result.geofencing = this.geofencing;
        }
        
        return result;
    }

    /**
     * Create a new empty trajectory
     * @returns {Trajectory} New trajectory
     */
    static createNew() {
        return new Trajectory();
    }

    /**
     * Create a trajectory from JSON data
     * @param {Object} data - JSON data
     * @returns {Trajectory} Instance of Trajectory
     */
    static fromJSON(data) {
        return new Trajectory(data);
    }

    /**
     * Validate the trajectory data
     * @returns {Array<string>} List of errors (empty if valid)
     */
    validate() {
        const errors = [];
        
        if (!this.version) {
            errors.push("The 'version' field is required");
        }
        
        if (!this.filename) {
            errors.push("The 'filename' field is required");
        }
        
        if (!this.vehicle_id) {
            errors.push("The 'vehicle_id' field is required");
        }
        
        // Check version format
        const supportedVersions = ['3', '2.1', '2.0'];
        if (!supportedVersions.includes(this.version)) {
            errors.push(`Version '${this.version}' not supported. Supported versions: ${supportedVersions.join(', ')}`);
        }
        
        // Check file type
        const allowedTypes = ['draft', 'mission_order', 'parcel_map'];
        if (!allowedTypes.includes(this.file_type)) {
            errors.push(`File type '${this.file_type}' is not allowed. Allowed types: ${allowedTypes.join(', ')}`);
        }
        
        // Check origin
        if (!this.origin || !this.origin.coordinates) {
            errors.push("Origin must contain coordinates");
        } else {
            const coords = this.origin.coordinates;
            const lat = coords.lat || 0;
            const lon = coords.lon || 0;
            
            if (!(lat >= -90 && lat <= 90)) {
                errors.push("Invalid latitude (must be between -90 and 90)");
            }
            
            if (!(lon >= -180 && lon <= 180)) {
                errors.push("Invalid longitude (must be between -180 and 180)");
            }
        }
        
        return errors;
    }
}
