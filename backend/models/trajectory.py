"""
Data model for a trajectory
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field

from ..constants import LATITUDE_MIN, LATITUDE_MAX, LONGITUDE_MIN, LONGITUDE_MAX


@dataclass
class Trajectory:
    """
    Model representing a complete trajectory
    
    Attributes:
        version: Trajectory format version
        filename: File name
        vehicle_id: Vehicle identifier
        file_type: File type (draft, mission_order, parcel_map, work_performed)
        origin: Geographic origin (WGS84 coordinates)
        points: List of sections with their points
        metadata: Additional metadata
        geofencing: Geofencing data (optional)
    """
    version: str
    filename: str
    vehicle_id: str
    file_type: str
    origin: Dict[str, Any]
    points: List[Dict[str, Any]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    geofencing: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the model to a JSON dictionary
        Note: The 'filename' field is not included in the JSON as it is managed by the storage system
        
        Returns:
            Dictionary representing the trajectory
        """
        result = {
            'version': self.version,
            'vehicle_id': self.vehicle_id,
            'file_type': self.file_type,
            'origin': self.origin,
            'points': self.points,
            'metadata': self.metadata
        }
        
        if self.geofencing is not None:
            result['geofencing'] = self.geofencing
            
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Trajectory':
        """
        Create a Trajectory instance from a dictionary
        
        Args:
            data: Dictionary containing the trajectory data
            
        Returns:
            Instance of Trajectory
        """
        return cls(
            version=data.get('version', '3'),
            filename=data.get('filename', 'new_trajectory.json'),
            vehicle_id=data.get('vehicle_id', 'v1'),
            file_type=data.get('file_type', 'draft'),
            origin=data.get('origin', {
                'type': 'WGS84',
                'coordinates': {'lat': 48.8566, 'lon': 2.3522, 'alt': 0.0}
            }),
            points=data.get('points', []),
            metadata=data.get('metadata', {}),
            geofencing=data.get('geofencing')
        )

    def validate(self) -> List[str]:
        """
        Validate the trajectory data
        
        Returns:
            List of validation errors (empty if valid)
        """
        errors = []
        
        # Check required fields
        if not self.version:
            errors.append("The 'version' field is required")
        
        if not self.filename:
            errors.append("The 'filename' field is required")
        
        if not self.vehicle_id:
            errors.append("The 'vehicle_id' field is required")
        
        if not self.file_type:
            errors.append("The 'file_type' field is required")
        
        # Check version format
        supported_versions = ['3']
        if self.version not in supported_versions:
            errors.append(f"Version '{self.version}' not supported. Accepted versions: {supported_versions}")
        
        # Check file type. `work_performed` is read-only for the editor: the robot
        # writes it, the studio loads it from the farm folder (CdC L13 §2.5).
        allowed_types = ['draft', 'mission_order', 'parcel_map', 'work_performed']
        if self.file_type not in allowed_types:
            errors.append(f"File type '{self.file_type}' not allowed. Accepted types: {allowed_types}")
        
        # Check origin
        if not self.origin or 'coordinates' not in self.origin:
            errors.append("Origin must contain coordinates")
        else:
            coords = self.origin.get('coordinates', {})
            lat = coords.get('lat', 0)
            lon = coords.get('lon', 0)
            
            if not (LATITUDE_MIN <= lat <= LATITUDE_MAX):
                errors.append(f"Invalid latitude (must be between {LATITUDE_MIN} and {LATITUDE_MAX})")
            
            if not (LONGITUDE_MIN <= lon <= LONGITUDE_MAX):
                errors.append(f"Invalid longitude (must be between {LONGITUDE_MIN} and {LONGITUDE_MAX})")
        
        return errors
