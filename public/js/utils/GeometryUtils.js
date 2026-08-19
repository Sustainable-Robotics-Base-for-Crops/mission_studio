/**
 * Geometry utilities for trajectory calculations
 * Pure dependency-free functions
 */

class GeometryUtils {
    /**
     * Round a value to 3 decimals
     * @param {number} value - Value to round
     * @returns {number} Value rounded to 3 decimals
     */
    static round3(value) {
        return Math.round(value * 1000) / 1000;
    }

    /**
     * Distance in meters between two lat/lng points (local planar approximation)
     * @param {Object} p1 - Point 1 {lat, lng}
     * @param {Object} p2 - Point 2 {lat, lng}
     * @returns {number} Distance in meters
     */
    static getDistanceMeters(p1, p2) {
        const latMid = (p1.lat + p2.lat) / 2 * Math.PI / 180;
        const dx = (p2.lng - p1.lng) * 111320 * Math.cos(latMid);
        const dy = (p2.lat - p1.lat) * 111320;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Calculate the bearing between two points while accounting for Earth's curvature
     * @param {number} lat1 - Latitude point 1
     * @param {number} lon1 - Longitude point 1
     * @param {number} lat2 - Latitude point 2
     * @param {number} lon2 - Longitude point 2
     * @returns {number} Angle in degrees (0° = North, 90° = East, 180° = South, 270° = West)
     */
    static calculateBearing(lat1, lon1, lat2, lon2) {
        // Convert degrees to radians
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        // Bearing formula that accounts for the Earth's curvature
        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
        const bearing = Math.atan2(y, x);

        // Convert to degrees and normalize between 0 and 360
        return (bearing * 180 / Math.PI + 360) % 360;
    }

    /**
     * Get the coefficients of the line passing through two points
     * @param {number} x1 - x coordinate of point 1
     * @param {number} y1 - y coordinate of point 1
     * @param {number} x2 - x coordinate of point 2
     * @param {number} y2 - y coordinate of point 2
     * @returns {Array<number>} [a, b, c] coefficients of the line ax + by + c = 0
     */
    static getLineCoefs(x1, y1, x2, y2) {
        const a = y2 - y1;
        const b = x1 - x2;
        const c = x2 * y1 - x1 * y2;
        return [a, b, c];
    }

    /**
     * Project a point onto a line
     * @param {number} px - Point x coordinate
     * @param {number} py - Point y coordinate
     * @param {Array<number>} coefs - Coefficients of the line [a, b, c]
     * @returns {Array<number>} [x, y] projected point coordinates
     */
    static projectPointOnLine(px, py, coefs) {
        const [a, b, c] = coefs;
        const denom = a * a + b * b;
        if (denom === 0.0) return [px, py];
        const x = (b * (b * px - a * py) - a * c) / denom;
        const y = (a * (-b * px + a * py) - b * c) / denom;
        return [x, y];
    }

    /**
     * Normalize a vector
     * @param {number} x - x component
     * @param {number} y - y component
     * @returns {Array<number>} [x, y] normalized vector
     */
    static normalize(x, y) {
        const len = Math.sqrt(x * x + y * y);
        return len > 0 ? [x / len, y / len] : [1.0, 0.0];
    }

    /**
     * Euclidean distance between two points
     * @param {number} x1 - x coordinate of point 1
     * @param {number} y1 - y coordinate of point 1
     * @param {number} x2 - x coordinate of point 2
     * @param {number} y2 - y coordinate of point 2
     * @returns {number} Distance
     */
    static distance(x1, y1, x2, y2) {
        return Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
    }

    /**
     * Normalize an angle between -π and π
     * @param {number} angle - Angle in radians
     * @returns {number} Normalized angle
     */
    static normalizeAngleToPi(angle) {
        let normalized = angle;
        while (normalized > Math.PI) normalized -= 2.0 * Math.PI;
        while (normalized < -Math.PI) normalized += 2.0 * Math.PI;
        return normalized;
    }

    /**
     * Estimate the number of points that will be generated for a given segment
     * @param {Array<Object>} latLngPoints - Lat/lng points
     * @param {number} spacing - Spacing in meters
     * @param {Object} origin - Origin {lat, lon}
     * @returns {number} Estimated point count
     */
    static estimatePointsForSegment(latLngPoints, spacing, origin) {
        if (latLngPoints.length < 2) return 0;
        
        let estimatedPoints = 0;

        for (let i = 0; i < latLngPoints.length - 1; i++) {
            const p1 = latLngPoints[i];
            const p2 = latLngPoints[i + 1];

            // Convert to local coordinates
            const x1 = (p1.lng - origin.lon) * 111320 * Math.cos(origin.lat * Math.PI / 180);
            const y1 = (p1.lat - origin.lat) * 111320;
            const x2 = (p2.lng - origin.lon) * 111320 * Math.cos(origin.lat * Math.PI / 180);
            const y2 = (p2.lat - origin.lat) * 111320;

            const dx = x2 - x1;
            const dy = y2 - y1;
            const segmentLength = Math.sqrt(dx * dx + dy * dy);

            if (segmentLength > 0) {
                // Estimate the number of points for this segment
                const numPoints = Math.floor(segmentLength / spacing);
                estimatedPoints += numPoints;
                if (i === 0) estimatedPoints += 1; // First point
            }
        }
        
        estimatedPoints += 1; // Last point
        return estimatedPoints;
    }

    /**
     * Convert lat/lng coordinates to local (x, y) coordinates in meters
     * @param {Object} latLng - Point {lat, lng}
     * @param {Object} origin - Origin {lat, lon}
     * @returns {Object} {x, y} local coordinates in meters
     */
    static latLngToLocal(latLng, origin) {
        const x = (latLng.lng - origin.lon) * 111320 * Math.cos(origin.lat * Math.PI / 180);
        const y = (latLng.lat - origin.lat) * 111320;
        return { x, y };
    }

    /**
     * Convert local (x, y) coordinates in meters to lat/lng coordinates
     * @param {Object} local - Point {x, y} in meters
     * @param {Object} origin - Origin {lat, lon}
     * @returns {Object} {lat, lng} geographic coordinates
     */
    static localToLatLng(local, origin) {
        const lat = origin.lat + local.y / 111320;
        const lng = origin.lon + local.x / (111320 * Math.cos(origin.lat * Math.PI / 180));
        return { lat, lng };
    }

    /**
     * Calculate the minimum distance from a point to a polyline (series of segments)
     * @param {Object} point - Point {lat, lng}
     * @param {Array<Array<number>>} polylinePoints - Points of the polyline [[lat, lng], ...]
     * @returns {number} Minimum distance in meters
     */
    static distancePointToPolyline(point, polylinePoints) {
        if (!polylinePoints || polylinePoints.length < 2) {
            return Infinity;
        }

        let minDistance = Infinity;

        // Iterate over all polyline segments
        for (let i = 0; i < polylinePoints.length - 1; i++) {
            const p1 = polylinePoints[i];
            const p2 = polylinePoints[i + 1];
            
            // Distance from the point to the segment [p1, p2]
            const dist = this.distancePointToSegment(point, p1, p2);
            minDistance = Math.min(minDistance, dist);
        }

        return minDistance;
    }

    /**
     * Calculate the distance from a point to a line segment
     * @param {Object} point - Point {lat, lng}
     * @param {Array<number>} segStart - Segment start point [lat, lng]
     * @param {Array<number>} segEnd - Segment end point [lat, lng]
     * @returns {number} Minimum distance in meters
     */
    static distancePointToSegment(point, segStart, segEnd) {
        // Convert to local coordinates for calculation
        const latMid = ((point.lat + segStart[0] + segEnd[0]) / 3) * Math.PI / 180;
        const scaleX = 111320 * Math.cos(latMid);
        const scaleY = 111320;

        // Convert to local coordinates (meters)
        const px = (point.lng - segStart[1]) * scaleX;
        const py = (point.lat - segStart[0]) * scaleY;
        const sx = 0;
        const sy = 0;
        const ex = (segEnd[1] - segStart[1]) * scaleX;
        const ey = (segEnd[0] - segStart[0]) * scaleY;

        // Segment vector
        const dx = ex - sx;
        const dy = ey - sy;
        const segLen2 = dx * dx + dy * dy;

        if (segLen2 === 0) {
            // Degenerate segment (point)
            return this.distance(px, py, sx, sy);
        }

        // t parameter for projecting the point onto the segment
        const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / segLen2));

        // Projected point on the segment
        const projX = sx + t * dx;
        const projY = sy + t * dy;

        // Distance from the point to the projected point
        return this.distance(px, py, projX, projY);
    }
}

// Export for global use
if (typeof window !== 'undefined') {
    window.GeometryUtils = GeometryUtils;
}

// Named export so the module can be unit-tested outside a browser.
export { GeometryUtils };
export default GeometryUtils;
