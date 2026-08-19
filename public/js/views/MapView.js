/**
 * View for Leaflet map display
 * Handles rendering trajectories, sections, temporary elements, geofencing, and ruler
 */
class MapView {
    constructor(map, geometryUtils) {
        this.map = map;
        this.geometryUtils = geometryUtils;
        this.layers = {
            sections: [],
            tempShapes: [],
            geofencing: null,
            ruler: null,
            selectionZone: null
        };
    }

    /**
     * Remove all non-tile layers from the map
     */
    clear() {
        this.map.eachLayer((layer) => {
            if (!(layer instanceof L.TileLayer)) {
                this.map.removeLayer(layer);
            }
        });
        this.layers = {
            sections: [],
            tempShapes: [],
            geofencing: null,
            ruler: null,
            selectionZone: null
        };
    }

    /**
     * Get LatLng points for a section
     * @param {Object} section - Trajectory section
     * @param {Object} origin - Origin {lat, lon}
     * @returns {Array<Array<number>>} Points [[lat, lon], ...]
     */
    getSectionLatLngPoints(section, origin) {
        return section.values.map(pointValues => {
            const xIndex = section.columns.indexOf('x');
            const yIndex = section.columns.indexOf('y');
            if (xIndex === -1 || yIndex === -1) return null;

            const x = pointValues[xIndex];
            const y = pointValues[yIndex];
            const lat = origin.lat + (y / 111320);
            const lon = origin.lon + (x / (111320 * Math.cos(origin.lat * Math.PI / 180)));
            return [lat, lon];
        }).filter(point => point !== null);
    }

    /**
     * Get LatLng points with working_zone for a section
     * @param {Object} section - Trajectory section
     * @param {Object} origin - Origin {lat, lon}
     * @returns {Array<Object>} Points [{lat, lon, workingZone}, ...]
     */
    getSectionLatLngPointsWithWorkingZone(section, origin) {
        const wzIndex = section.columns.indexOf('working_zone');
        return section.values.map(pointValues => {
            const xIndex = section.columns.indexOf('x');
            const yIndex = section.columns.indexOf('y');
            if (xIndex === -1 || yIndex === -1) return null;
            const x = pointValues[xIndex];
            const y = pointValues[yIndex];
            const lat = origin.lat + (y / 111320);
            const lon = origin.lon + (x / (111320 * Math.cos(origin.lat * Math.PI / 180)));
            const workingZone = wzIndex >= 0 ? pointValues[wzIndex] : 1;
            return { lat, lon, workingZone: workingZone === 1 || workingZone === true };
        }).filter(point => point !== null);
    }

    /**
     * Get a segment color based on working_zone
     * @param {boolean} workingZone - Working area
     * @param {boolean} isSelected - Selected section
     * @param {boolean} isTurn - Turn
     * @returns {string} Hex color
     */
    getSegmentColor(workingZone, isSelected, isTurn) {
        if (isTurn) return '#FF9800';
        if (isSelected) return '#F44336';
        return workingZone ? '#2196F3' : '#757575';
    }

    /**
     * Create a triangle marker
     * @param {L.LatLng} position - Position
     * @param {number} angle - Angle in degrees
     * @param {string} color - Color
     * @returns {L.Marker} Marker
     */
    createTriangleMarker(position, angle, color) {
        const icon = L.divIcon({
            html: `<div style="
                width: 0;
                height: 0;
                border-left: 8px solid transparent;
                border-right: 8px solid transparent;
                border-bottom: 16px solid ${color};
                transform: rotate(${angle}deg);
            "></div>`,
            className: 'triangle-marker',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });
        return L.marker(position, { icon: icon });
    }

    /**
     * Create a cross marker
     * @param {L.LatLng} position - Position
     * @param {string} color - Color
     * @returns {L.Marker} Marker
     */
    createCrossMarker(position, color) {
        const icon = L.divIcon({
            html: `<div style="
                width: 14px;
                height: 14px;
                position: relative;
            ">
                <div style="
                    position: absolute;
                    top: 6px;
                    left: 0;
                    width: 14px;
                    height: 2px;
                    background-color: ${color};
                "></div>
                <div style="
                    position: absolute;
                    top: 0;
                    left: 6px;
                    width: 2px;
                    height: 14px;
                    background-color: ${color};
                "></div>
            </div>`,
            className: 'cross-marker',
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        });
        return L.marker(position, { icon: icon });
    }

    /**
     * Display trajectory sections on the map
     * @param {Object} trajectory - Trajectory
     * @param {Array<number>} selectedIndices - Selected section indices
     * @param {Function} onSectionClick - Callback for section clicks (deprecated, unused)
     */
    renderSections(trajectory, selectedIndices = [], onSectionClick = null) {
        this.layers.sections.forEach(layer => {
            if (layer && this.map.hasLayer(layer)) {
                this.map.removeLayer(layer);
            }
        });
        this.layers.sections = [];

        if (!trajectory || !trajectory.points || trajectory.points.length === 0) {
            return;
        }

        const origin = trajectory.origin.coordinates;

        trajectory.points.forEach((section, sectionIndex) => {
            const isSelected = selectedIndices.includes(sectionIndex);
            const isTurn = section.section_type === 'turn_path' || section.section_type === 'turn_square';
            const pointsWithWz = this.getSectionLatLngPointsWithWorkingZone(section, origin);
            
            if (pointsWithWz.length < 2) return;

            const points = pointsWithWz.map(p => [p.lat, p.lon]);
            const weight = isSelected ? 6 : 4;

            if (isTurn || isSelected) {
                // Priority: if selected, always red (even for U-turns)
                // Else, if it is a U-turn, orange
                const color = isSelected ? '#F44336' : '#FF9800';
                const polyline = L.polyline(points, { 
                    color, 
                    weight, 
                    opacity: 0.8,
                    interactive: false // Selection is made by proximity in MapController
                });
                polyline.addTo(this.map);
                this.layers.sections.push(polyline);
            } else {
                // Field: split by working_zone
                let segment = [points[0]];
                let currentWz = pointsWithWz[0].workingZone;
                
                for (let i = 1; i < pointsWithWz.length; i++) {
                    const p = pointsWithWz[i];
                    if (p.workingZone === currentWz) {
                        segment.push(points[i]);
                    } else {
                        if (segment.length >= 2) {
                            const color = this.getSegmentColor(currentWz, false, false);
                            const polyline = L.polyline(segment, { 
                                color, 
                                weight, 
                                opacity: 0.8,
                                interactive: false // Selection is made by proximity in MapController
                            });
                            polyline.addTo(this.map);
                            this.layers.sections.push(polyline);
                        }
                        segment = [points[i]];
                        currentWz = p.workingZone;
                    }
                }
                if (segment.length >= 2) {
                    const color = this.getSegmentColor(currentWz, false, false);
                    const polyline = L.polyline(segment, { 
                        color, 
                        weight, 
                        opacity: 0.8,
                        interactive: false // Selection is made by proximity in MapController
                    });
                    polyline.addTo(this.map);
                    this.layers.sections.push(polyline);
                }
            }

            // Start and end markers
            if (points.length >= 2) {
                const p1 = points[0];
                const p2 = points[1];
                const bearing = this.geometryUtils.calculateBearing(p1[0], p1[1], p2[0], p2[1]);
                const startMarker = this.createTriangleMarker(L.latLng(p1[0], p1[1]), bearing, '#4CAF50');
                startMarker.addTo(this.map);
                this.layers.sections.push(startMarker);

                const endMarker = this.createCrossMarker(
                    L.latLng(points[points.length - 1][0], points[points.length - 1][1]),
                    '#F44336'
                );
                endMarker.addTo(this.map);
                this.layers.sections.push(endMarker);
            }
        });
    }

    /**
     * Display geofencing
     * @param {Object} geofencing - Geofencing data
     * @param {Object} origin - Origin {lat, lon}
     */
    renderGeofencing(geofencing, origin) {
        if (this.layers.geofencing) {
            this.map.removeLayer(this.layers.geofencing);
            this.layers.geofencing = null;
        }

        if (!geofencing || !geofencing.values || geofencing.values.length < 3) {
            return;
        }

        const geoPoints = geofencing.values.map(coords => {
            const lat = origin.lat + (coords[1] / 111320);
            const lon = origin.lon + (coords[0] / (111320 * Math.cos(origin.lat * Math.PI / 180)));
            return [lat, lon];
        });

        const polygon = L.polygon(geoPoints, {
            color: '#e74c3c',
            fillColor: '#e74c3c',
            fillOpacity: 0.1,
            weight: 3
        });
        polygon.addTo(this.map);
        this.layers.geofencing = polygon;
    }

    /**
     * Display the selection zone (rectangle)
     * @param {Array<L.LatLng>} points - Selection points (2 points)
     */
    renderSelectionZone(points) {
        // Clean the previous selection zone
        if (this.layers.selectionZone) {
            if (Array.isArray(this.layers.selectionZone)) {
                // If it's an array (markers + rectangle)
                this.layers.selectionZone.forEach(layer => {
                    if (layer && this.map.hasLayer(layer)) {
                        this.map.removeLayer(layer);
                    }
                });
            } else {
                // If it's a single layer
                if (this.map.hasLayer(this.layers.selectionZone)) {
                    this.map.removeLayer(this.layers.selectionZone);
                }
            }
            this.layers.selectionZone = null;
        }

        if (!points || points.length === 0) return;

        if (points.length === 1) {
            const marker = L.circleMarker(points[0], {
                radius: 6,
                color: '#F44336',
                fillOpacity: 0.8
            });
            marker.addTo(this.map);
            this.layers.selectionZone = marker;
        } else if (points.length >= 2) {
            const bounds = L.latLngBounds(points[0], points[1]);
            const rectangle = L.rectangle(bounds, {
                color: '#F44336',
                fillColor: '#F44336',
                fillOpacity: 0.15,
                weight: 2
            });
            rectangle.addTo(this.map);
            
            // Markers at the corners
            const markers = [];
            points.forEach((p, i) => {
                const marker = L.circleMarker(p, {
                    radius: 6,
                    color: '#F44336',
                    fillOpacity: 0.8
                });
                marker.addTo(this.map);
                markers.push(marker);
            });
            
            // Store all selection zone layers
            this.layers.selectionZone = [rectangle, ...markers];
        }
    }

    /**
     * Display temporary points according to edit mode
     * @param {Array<L.LatLng>} tempPoints - Temporary points
     * @param {string} editMode - Edit mode
     * @param {Function} onPointDrag - Callback on point drag
     * @param {L.LatLng|null} extendAnchor - Fixed anchor displayed in 'extend_section' mode
     */
    renderTempPoints(tempPoints, editMode, onPointDrag, extendAnchor = null) {
        // Clean up old temporary elements
        this.layers.tempShapes.forEach(layer => {
            if (layer) {
                try {
                    // Handle layer arrays (such as for markers)
                    if (Array.isArray(layer)) {
                        layer.forEach(l => {
                            if (l) {
                                try {
                                    if (this.map.hasLayer(l)) {
                                        this.map.removeLayer(l);
                                    }
                                } catch (e) {
                                    // Layer already removed or invalid, ignore
                                    console.debug('[MapView] Error removing layer:', e);
                                }
                            }
                        });
                    } else {
                        // Single layer
                        try {
                            if (this.map.hasLayer(layer)) {
                                this.map.removeLayer(layer);
                            }
                        } catch (e) {
                            // Layer already removed or invalid, ignore
                            console.debug('[MapView] Error removing layer:', e);
                        }
                    }
                } catch (e) {
                    // Error during cleanup, ignore
                    console.debug('[MapView] Error cleaning up layer:', e);
                }
            }
        });
        this.layers.tempShapes = [];

        // 'extend_section' mode always renders its anchor, even before the user clicks once.
        // Other modes hide visuals when there is no point.
        if (editMode === 'extend_section') {
            this._renderExtendSection(tempPoints || [], extendAnchor, '#FF9800', onPointDrag);
            return;
        }

        if (!tempPoints || tempPoints.length === 0 || editMode === 'none') {
            return;
        }

        let color = '#4CAF50'; // Default green

        switch (editMode) {
            case 'draw_line':
                this._renderDrawLine(tempPoints, color);
                break;
            case 'draw_parcel':
                this._renderDrawParcel(tempPoints, '#2196F3', onPointDrag);
                break;
            case 'geofence':
                this._renderGeofence(tempPoints, '#FF9800', onPointDrag);
                break;
            case 'edit_working_zone':
                this._renderEditWorkingZone(tempPoints, '#FF9800', onPointDrag);
                break;
            case 'delete_points_zone':
                this._renderDeletePointsZone(tempPoints, '#F44336', onPointDrag);
                break;
            case 'select_sections_polygon':
                this._renderSelectSectionsPolygon(tempPoints, '#3F51B5', onPointDrag);
                break;
        }
    }

    /**
     * Render a drawing line
     * @private
     */
    _renderDrawLine(tempPoints, color) {
        if (tempPoints.length >= 2) {
            const polyline = L.polyline(tempPoints, {
                color: color,
                weight: 5,
                opacity: 0.8
            });
            polyline.addTo(this.map);
            this.layers.tempShapes.push(polyline);
        }

        // Triangle at the start
        if (tempPoints.length >= 2) {
            const p1 = tempPoints[0];
            const p2 = tempPoints[1];
            const bearing = this.geometryUtils.calculateBearing(p1.lat, p1.lng, p2.lat, p2.lng);
            const marker = this.createTriangleMarker(tempPoints[0], bearing, color);
            marker.addTo(this.map);
            this.layers.tempShapes.push(marker);
        }

        // Cross at the end
        if (tempPoints.length >= 1) {
            const marker = this.createCrossMarker(tempPoints[tempPoints.length - 1], color);
            marker.addTo(this.map);
            this.layers.tempShapes.push(marker);
        }

        // Circles at intermediate points
        tempPoints.slice(1, -1).forEach(point => {
            const circle = L.circle(point, {
                color: color,
                fillColor: color,
                fillOpacity: 0.8,
                radius: 0.8
            });
            circle.addTo(this.map);
            this.layers.tempShapes.push(circle);
        });
    }

    /**
     * Render a polygon with draggable markers
     * @private
     */
    _renderPolygonWithMarkers(tempPoints, color, className, onPointDrag, closePolygon = true, fillOpacity = 0.15) {
        // Line between points
        let polyline = null;
        if (tempPoints.length >= 2) {
            const closedPoints = closePolygon 
                ? [...tempPoints, tempPoints[0]]
                : tempPoints;
            polyline = L.polyline(closedPoints, {
                color: color,
                weight: 3,
                opacity: 0.7
            });
            polyline.addTo(this.map);
            this.layers.tempShapes.push(polyline);
        }

        // Polygon if enough points
        let polygon = null;
        if (tempPoints.length >= 3) {
            polygon = L.polygon(tempPoints, {
                color: color,
                fillColor: color,
                fillOpacity: fillOpacity,
                weight: 2
            });
            polygon.addTo(this.map);
            this.layers.tempShapes.push(polygon);
        }

        // Distance labels
        const distanceLabels = [];
        if (tempPoints.length >= 2) {
            const n = tempPoints.length;
            for (let i = 0; i < n; i++) {
                const p1 = tempPoints[i];
                const p2 = tempPoints[(i + 1) % n];
                const dist = this.geometryUtils.getDistanceMeters(p1, p2);
                const midpoint = L.latLng((p1.lat + p2.lat) / 2, (p1.lng + p2.lng) / 2);
                const label = L.marker(midpoint, {
                    icon: L.divIcon({
                        className: `edge-distance-label ${className}`,
                        html: '<span>' + dist.toFixed(1) + ' m</span>',
                        iconSize: [50, 24],
                        iconAnchor: [25, 12]
                    })
                });
                label.addTo(this.map);
                distanceLabels.push(label);
            }
        }
        this.layers.tempShapes.push(...distanceLabels);

        // Draggable markers
        if (onPointDrag) {
            tempPoints.forEach((point, index) => {
                const marker = L.marker(point, {
                    draggable: true,
                    icon: L.divIcon({
                        className: `parcel-point-marker ${className}`,
                        html: '<div class="parcel-point-marker-inner"></div>',
                        iconSize: [16, 16],
                        iconAnchor: [8, 8]
                    })
                });
                marker.on('click', (e) => L.DomEvent.stopPropagation(e));
                
                // Function to update only the visual shapes without recreating markers
                const updateVisualShapes = () => {
                    const newPos = marker.getLatLng();
                    tempPoints[index] = newPos;
                    
                    // Update polyline
                    if (polyline && tempPoints.length >= 2) {
                        const closedPoints = closePolygon 
                            ? [...tempPoints, tempPoints[0]]
                            : tempPoints;
                        polyline.setLatLngs(closedPoints);
                    }
                    
                    // Update polygon
                    if (polygon && tempPoints.length >= 3) {
                        polygon.setLatLngs(tempPoints);
                    }
                    
                    // Update distance labels
                    if (tempPoints.length >= 2) {
                        const n = tempPoints.length;
                        distanceLabels.forEach((label, i) => {
                            if (i < n) {
                                const p1 = tempPoints[i];
                                const p2 = tempPoints[(i + 1) % n];
                                const dist = this.geometryUtils.getDistanceMeters(p1, p2);
                                const midpoint = L.latLng((p1.lat + p2.lat) / 2, (p1.lng + p2.lng) / 2);
                                label.setLatLng(midpoint);
                                // Update the distance text
                                const icon = label.options.icon;
                                if (icon && icon.options) {
                                    label.setIcon(L.divIcon({
                                        className: `edge-distance-label ${className}`,
                                        html: '<span>' + dist.toFixed(1) + ' m</span>',
                                        iconSize: [50, 24],
                                        iconAnchor: [25, 12]
                                    }));
                                }
                            }
                        });
                    }
                };
                
                // While dragging: update only the visuals
                marker.on('drag', () => {
                    updateVisualShapes();
                });
                
                // On drag end: update data and notify the callback
                marker.on('dragend', () => {
                    const precisePos = L.latLng(
                        Math.round(marker.getLatLng().lat * 1000000) / 1000000,
                        Math.round(marker.getLatLng().lng * 1000000) / 1000000
                    );
                    tempPoints[index] = precisePos;
                    // Update visuals one last time with the precise position
                    updateVisualShapes();
                    // Notify the callback to update data in the controller
                    onPointDrag(index, precisePos, tempPoints);
                });
                
                marker.addTo(this.map);
                this.layers.tempShapes.push(marker);
            });
        }
    }

    _renderDrawParcel(tempPoints, color, onPointDrag) {
        this._renderPolygonWithMarkers(tempPoints, color, '', onPointDrag, false, 0.1);
    }

    _renderGeofence(tempPoints, color, onPointDrag) {
        this._renderPolygonWithMarkers(tempPoints, color, 'edge-distance-label-geofence', onPointDrag, true, 0.1);
    }

    _renderEditWorkingZone(tempPoints, color, onPointDrag) {
        this._renderPolygonWithMarkers(tempPoints, color, 'edge-distance-label-wz', onPointDrag, true, 0.15);
    }

    _renderDeletePointsZone(tempPoints, color, onPointDrag) {
        this._renderPolygonWithMarkers(tempPoints, color, 'edge-distance-label-delete', onPointDrag, true, 0.15);
    }

    _renderSelectSectionsPolygon(tempPoints, color, onPointDrag) {
        this._renderPolygonWithMarkers(tempPoints, color, 'edge-distance-label-select-zone', onPointDrag, true, 0.12);
    }

    /**
     * Render the 'extend_section' preview:
     *   - The anchor (existing section endpoint) is shown as a fixed non-draggable marker.
     *   - The first temp point, when set, becomes the new endpoint and is draggable.
     *   - A dashed line + a meters label connects them so the user sees the extension length.
     * @private
     */
    _renderExtendSection(tempPoints, anchorLatLng, color, onPointDrag) {
        if (!anchorLatLng) return;

        // Anchor: static circle marker so the user always sees the boundary they extend from.
        const anchorMarker = L.circleMarker(anchorLatLng, {
            radius: 7,
            color: color,
            fillColor: '#FFFFFF',
            fillOpacity: 0.9,
            weight: 3,
            interactive: false
        });
        anchorMarker.addTo(this.map);
        this.layers.tempShapes.push(anchorMarker);

        if (!tempPoints || tempPoints.length === 0) {
            return;
        }

        const newPoint = tempPoints[0];

        // Dashed line between the anchor and the placed endpoint.
        const polyline = L.polyline([anchorLatLng, newPoint], {
            color: color,
            weight: 3,
            opacity: 0.9,
            dashArray: '8, 4'
        });
        polyline.addTo(this.map);
        this.layers.tempShapes.push(polyline);

        // Distance label in meters, placed at the segment midpoint.
        const dist = this.geometryUtils.getDistanceMeters(anchorLatLng, newPoint);
        const mid = L.latLng((anchorLatLng.lat + newPoint.lat) / 2, (anchorLatLng.lng + newPoint.lng) / 2);
        const label = L.marker(mid, {
            icon: L.divIcon({
                className: 'extend-distance-label',
                html: '<span>' + dist.toFixed(2) + ' m</span>',
                iconSize: [70, 28],
                iconAnchor: [35, 14]
            })
        });
        label.addTo(this.map);
        this.layers.tempShapes.push(label);

        // Draggable marker for the new endpoint. Reuses the parcel marker styling for consistency.
        const marker = L.marker(newPoint, {
            draggable: true,
            icon: L.divIcon({
                className: 'parcel-point-marker',
                html: '<div class="parcel-point-marker-inner"></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            })
        });
        marker.on('click', (e) => L.DomEvent.stopPropagation(e));

        const updateVisualShapes = () => {
            const pos = marker.getLatLng();
            tempPoints[0] = pos;
            polyline.setLatLngs([anchorLatLng, pos]);
            const d = this.geometryUtils.getDistanceMeters(anchorLatLng, pos);
            const m = L.latLng((anchorLatLng.lat + pos.lat) / 2, (anchorLatLng.lng + pos.lng) / 2);
            label.setLatLng(m);
            label.setIcon(L.divIcon({
                className: 'extend-distance-label',
                html: '<span>' + d.toFixed(2) + ' m</span>',
                iconSize: [70, 28],
                iconAnchor: [35, 14]
            }));
        };

        marker.on('drag', updateVisualShapes);
        marker.on('dragend', () => {
            const precisePos = L.latLng(
                Math.round(marker.getLatLng().lat * 1000000) / 1000000,
                Math.round(marker.getLatLng().lng * 1000000) / 1000000
            );
            tempPoints[0] = precisePos;
            updateVisualShapes();
            if (onPointDrag) {
                onPointDrag(0, precisePos, tempPoints);
            }
        });

        marker.addTo(this.map);
        this.layers.tempShapes.push(marker);
    }

    /**
     * Display the ruler (2 points, displayed distance)
     * @param {Array<L.LatLng>} rulerPoints - Ruler points
     * @param {Function} onRulerDrag - Callback on drag
     */
    renderRuler(rulerPoints, onRulerDrag) {
        if (this.layers.ruler) {
            if (this.layers.ruler.polyline) this.map.removeLayer(this.layers.ruler.polyline);
            if (this.layers.ruler.label) this.map.removeLayer(this.layers.ruler.label);
            if (this.layers.ruler.markers) {
                this.layers.ruler.markers.forEach(m => this.map.removeLayer(m));
            }
        }

        if (!rulerPoints || rulerPoints.length === 0) {
            this.layers.ruler = null;
            return;
        }

        if (rulerPoints.length === 1) {
            const marker = L.circleMarker(rulerPoints[0], {
                radius: 8,
                color: '#9C27B0',
                fillColor: '#9C27B0',
                fillOpacity: 0.8,
                weight: 2
            });
            marker.addTo(this.map);
            this.layers.ruler = { markers: [marker] };
            return;
        }

        if (rulerPoints.length === 2) {
            const p1 = rulerPoints[0];
            const p2 = rulerPoints[1];
            const dist = this.geometryUtils.getDistanceMeters(p1, p2);
            const mid = L.latLng((p1.lat + p2.lat) / 2, (p1.lng + p2.lng) / 2);

            const polyline = L.polyline([p1, p2], {
                color: '#9C27B0',
                weight: 3,
                opacity: 0.9,
                dashArray: '8, 4'
            });
            polyline.addTo(this.map);

            const label = L.marker(mid, {
                icon: L.divIcon({
                    className: 'ruler-distance-label',
                    html: '<span>' + dist.toFixed(2) + ' m</span>',
                    iconSize: [70, 28],
                    iconAnchor: [35, 14]
                })
            });
            label.addTo(this.map);

            const markers = [];
            [0, 1].forEach((i) => {
                const marker = L.marker(rulerPoints[i], {
                    draggable: true,
                    icon: L.divIcon({
                        className: 'ruler-point-marker',
                        html: '<div class="ruler-point-marker-inner"></div>',
                        iconSize: [18, 18],
                        iconAnchor: [9, 9]
                    })
                });
                marker.on('click', (e) => L.DomEvent.stopPropagation(e));
                
                if (onRulerDrag) {
                    // Function to update only the visuals during drag
                    const updateVisualShapes = () => {
                        rulerPoints[i] = marker.getLatLng();
                        const a = rulerPoints[0];
                        const b = rulerPoints[1];
                        const d = this.geometryUtils.getDistanceMeters(a, b);
                        const m = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
                        polyline.setLatLngs([a, b]);
                        label.setLatLng(m);
                        label.setIcon(L.divIcon({
                            className: 'ruler-distance-label',
                            html: '<span>' + d.toFixed(2) + ' m</span>',
                            iconSize: [70, 28],
                            iconAnchor: [35, 14]
                        }));
                    };
                    
                    // On drag: update only the visuals
                    marker.on('drag', () => {
                        updateVisualShapes();
                    });
                    
                    // On drag end: update data and notify callback
                    marker.on('dragend', () => {
                        const precisePos = L.latLng(
                            Math.round(marker.getLatLng().lat * 1000000) / 1000000,
                            Math.round(marker.getLatLng().lng * 1000000) / 1000000
                        );
                        rulerPoints[i] = precisePos;
                        // Update visuals a last time with the precise position
                        updateVisualShapes();
                        // Notify the callback to update data in the controller
                        onRulerDrag(i, precisePos, rulerPoints);
                    });
                } else {
                    // If no callback, still allow visual dragging
                    marker.on('drag', () => {
                        rulerPoints[i] = marker.getLatLng();
                        const a = rulerPoints[0];
                        const b = rulerPoints[1];
                        const d = this.geometryUtils.getDistanceMeters(a, b);
                        const m = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
                        polyline.setLatLngs([a, b]);
                        label.setLatLng(m);
                        label.setIcon(L.divIcon({
                            className: 'ruler-distance-label',
                            html: '<span>' + d.toFixed(2) + ' m</span>',
                            iconSize: [70, 28],
                            iconAnchor: [35, 14]
                        }));
                    });
                }
                
                marker.addTo(this.map);
                markers.push(marker);
            });

            this.layers.ruler = { polyline, label, markers };
        }
    }

    /**
     * Center and zoom the map on a trajectory
     * @param {Object} trajectory - Trajectory
     */
    zoomToTrajectory(trajectory) {
        if (!trajectory || !trajectory.points || trajectory.points.length === 0) {
            return;
        }

        const allPoints = [];
        const origin = trajectory.origin.coordinates;

        // Collect all points of sections
        trajectory.points.forEach(section => {
            const points = this.getSectionLatLngPoints(section, origin);
            allPoints.push(...points);
        });

        // Add geofencing points if exists
        if (trajectory.geofencing && trajectory.geofencing.values) {
            trajectory.geofencing.values.forEach(coords => {
                const lat = origin.lat + (coords[1] / 111320);
                const lon = origin.lon + (coords[0] / (111320 * Math.cos(origin.lat * Math.PI / 180)));
                allPoints.push([lat, lon]);
            });
        }

        if (allPoints.length > 0) {
            const bounds = L.latLngBounds(allPoints);
            this.map.fitBounds(bounds, { padding: [50, 50] });
        }
    }
}

// Export for global use
window.MapView = MapView;
