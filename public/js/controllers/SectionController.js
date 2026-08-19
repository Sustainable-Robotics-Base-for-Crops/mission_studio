/**
 * Controller for managing trajectory sections
 * Handles selection, deletion, copy, paste, and modification of sections
 */
class SectionController {
    constructor(notificationService) {
        this.notificationService = notificationService;
    }

    /**
     * Get the indices of selected sections
     * @param {number|null} selectedSectionIndex - Index of selected section (single)
     * @param {Array<number>} selectedSectionIndices - Indices of selected sections (multiple)
     * @returns {Array<number>} Selected indices
     */
    getSelectedIndices(selectedSectionIndex, selectedSectionIndices) {
        if (selectedSectionIndices && selectedSectionIndices.length > 0) {
            return selectedSectionIndices;
        }
        if (selectedSectionIndex !== null) {
            return [selectedSectionIndex];
        }
        return [];
    }

    /**
     * Delete a section
     * @param {Object} trajectory - Trajectory
     * @param {number} index - Index of the section to delete
     * @returns {Object} New trajectory with the deleted section removed
     */
    deleteSection(trajectory, index) {
        const newTrajectory = {
            ...trajectory,
            points: trajectory.points.filter((_, i) => i !== index)
        };
        return newTrajectory;
    }

    /**
     * Reverse the points of a section
     * @param {Object} trajectory - Trajectory
     * @param {number} index - Index of the section to reverse
     * @returns {Object} New trajectory with the section reversed
     */
    reverseSectionPoints(trajectory, index) {
        if (index < 0 || index >= trajectory.points.length) {
            return trajectory;
        }
        const section = trajectory.points[index];
        const reversedValues = [...section.values].reverse();
        const newTrajectory = {
            ...trajectory,
            points: trajectory.points.map((s, i) => 
                i === index ? { ...s, values: reversedValues } : s
            )
        };
        return newTrajectory;
    }

    /**
     * Get the sections where at least one point is inside the bbox
     * @param {Object} trajectory - Trajectory
     * @param {L.LatLng} latLng1 - First point of the bbox
     * @param {L.LatLng} latLng2 - Second point of the bbox
     * @param {Function} getSectionLatLngPoints - Function to get lat/lng points of a section
     * @returns {Array<number>} Indices of sections within the bbox
     */
    getSectionsInBbox(trajectory, latLng1, latLng2, getSectionLatLngPoints) {
        const bounds = L.latLngBounds(latLng1, latLng2);
        const indices = [];
        trajectory.points.forEach((section, sectionIndex) => {
            const points = getSectionLatLngPoints(section);
            if (points.some(pt => bounds.contains([pt[0], pt[1]]))) {
                indices.push(sectionIndex);
            }
        });
        return indices;
    }

    /**
     * Move a section from one index to another.
     * The destination index is interpreted in the post-removal array (so passing the original
     * length as destination means "append at the end"). Returns the original trajectory when
     * the move is a no-op or when either index is out of range.
     * @param {Object} trajectory - Trajectory
     * @param {number} fromIndex - Original position of the section
     * @param {number} toIndex - Target position in the reduced array
     * @returns {Object} New trajectory with reordered sections
     */
    reorderSection(trajectory, fromIndex, toIndex) {
        if (!trajectory || !Array.isArray(trajectory.points)) return trajectory;
        const len = trajectory.points.length;
        if (fromIndex < 0 || fromIndex >= len) return trajectory;
        const clamped = Math.max(0, Math.min(toIndex, len - 1));
        if (clamped === fromIndex) return trajectory;

        const next = trajectory.points.slice();
        const [moved] = next.splice(fromIndex, 1);
        next.splice(clamped, 0, moved);

        return { ...trajectory, points: next };
    }

    /**
     * Count the total number of points in a trajectory
     * @param {Object} trajectory - Trajectory
     * @returns {number} Total number of points
     */
    getTotalPointsCount(trajectory) {
        let total = 0;
        if (trajectory.points && Array.isArray(trajectory.points)) {
            trajectory.points.forEach(section => {
                if (section.values && Array.isArray(section.values)) {
                    total += section.values.length;
                }
            });
        }
        return total;
    }
}

// Export for global use
window.SectionController = SectionController;
