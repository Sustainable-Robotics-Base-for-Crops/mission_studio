"""
Data validation service
"""

import os
import json
import re
import logging
from pathlib import Path
from typing import Dict, Any

try:
    from jsonschema import Draft202012Validator
    from jsonschema.exceptions import SchemaError
except ImportError:  # pragma: no cover - optional dependency only enabled with AGRI_SCHEMA_PATH
    Draft202012Validator = None
    SchemaError = Exception

from ..constants import (
    MAX_FILE_SIZE,
    LATITUDE_MIN,
    LATITUDE_MAX,
    LONGITUDE_MIN,
    LONGITUDE_MAX,
    ALTITUDE_MIN,
    ALTITUDE_MAX,
    SPEED_MIN,
    SPEED_MAX,
    SUPPORTED_TRAJECTORY_VERSIONS
)

logger = logging.getLogger('trajectory_editor')


class ValidationService:
    """
    Service to validate data and files
    """
    _agri_schema_validator = None
    _agri_schema_checked = False
    _agri_schema_disabled_values = {"", "none", "false", "disabled"}
    
    # R10 - Strict JSON schema for trajectories
    TRAJECTORY_SCHEMA = {
        "type": "object",
        "required": ["version", "filename", "vehicle_id"],
        "properties": {
            "version": {"type": "string"},
            "filename": {"type": "string", "pattern": r".*\.json$"},
            "vehicle_id": {"type": "string"},
            "file_type": {"type": "string", "enum": ["draft", "mission_order", "parcel_map", "work_performed"]},
            "origin": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["WGS84"]},
                    "coordinates": {
                        "type": "object",
                        "properties": {
                            "lat": {"type": "number", "minimum": -90, "maximum": 90},
                            "lon": {"type": "number", "minimum": -180, "maximum": 180},
                            "alt": {"type": "number"}
                        },
                        "required": ["lat", "lon"]
                    }
                }
            }
        }
    }

    @classmethod
    def _get_agri_schema_path(cls) -> Path | None:
        """
        Return the Agri schema path configured by the environment.

        As with plugins, the public core assumes no default location: each deployment explicitly enables this validation.
        """
        schema_path = os.getenv("AGRI_SCHEMA_PATH")
        normalized_path = (schema_path or "").strip()
        if schema_path is None or normalized_path.lower() in cls._agri_schema_disabled_values:
            return None
        return Path(normalized_path).expanduser().resolve()

    @classmethod
    def _get_agri_schema_validator(cls):
        """
        Load and cache the optional Agri JSON Schema validator.

        If the configuration is missing or invalid, schema validation is disabled so as to never block a save because of an external configuration issue.
        """
        if cls._agri_schema_checked:
            return cls._agri_schema_validator

        cls._agri_schema_checked = True
        schema_path = cls._get_agri_schema_path()
        if schema_path is None:
            logger.info("Agri JSON Schema validation disabled: AGRI_SCHEMA_PATH not set")
            return None

        if Draft202012Validator is None:
            logger.warning(
                "Agri JSON Schema validation disabled: jsonschema dependency unavailable"
            )
            return None

        try:
            with schema_path.open("r", encoding="utf-8") as schema_file:
                schema = json.load(schema_file)
            Draft202012Validator.check_schema(schema)
        except FileNotFoundError:
            logger.warning(
                "Agri JSON Schema validation disabled: file not found %s",
                schema_path,
            )
            return None
        except json.JSONDecodeError as exc:
            logger.warning(
                "Agri JSON Schema validation disabled: Invalid JSON in %s (%s)",
                schema_path,
                exc,
            )
            return None
        except SchemaError as exc:
            logger.warning(
                "Agri JSON Schema validation disabled: invalid schema in %s (%s)",
                schema_path,
                exc.message,
            )
            return None

        cls._agri_schema_validator = Draft202012Validator(schema)
        return cls._agri_schema_validator

    @staticmethod
    def _as_agri_document(trajectory: Dict[str, Any]) -> Dict[str, Any]:
        """
        Build the actual Agri document to be saved.

        `filename` is an internal storage metadata of the editor and is not part of the Agri format, which forbids additional properties.
        """
        if not isinstance(trajectory, dict):
            raise ValueError("Trajectory must be a JSON object")

        document = {
            key: value
            for key, value in trajectory.items()
            if key != "filename"
        }

        # `geofencing` is optional for draft/parcel_map: if the editor still sends null, treat as absent before applying schema.
        if document.get("geofencing") is None:
            document.pop("geofencing", None)

        return document

    @classmethod
    def validate_agri_schema(cls, trajectory: Dict[str, Any]) -> None:
        """
        Validate a trajectory with the official Agri schema before saving.

        Raises:
            ValueError: If the document does not comply with `Agri.json`.
        """
        document = cls._as_agri_document(trajectory)
        validator = cls._get_agri_schema_validator()
        if validator is None:
            return

        errors = sorted(validator.iter_errors(document), key=lambda error: list(error.path))
        if errors:
            formatted_errors = []
            for error in errors[:5]:
                path = "/".join(str(part) for part in error.path) or "<root>"
                formatted_errors.append(f"{path}: {error.message}")
            if len(errors) > 5:
                formatted_errors.append(f"... {len(errors) - 5} more error(s)")
            raise ValueError("Invalid Agri schema: " + "; ".join(formatted_errors))

    @staticmethod
    def validate_file_upload(filename: str, content_type: str, content_length: int) -> str:
        """
        R5-R8 - Complete upload validation
        
        Args:
            filename: File name
            content_type: MIME type
            content_length: File size in bytes
            
        Returns:
            Validated file name
            
        Raises:
            ValueError: If validation fails
        """
        # R5: Only .json extension
        if not filename.lower().endswith('.json'):
            raise ValueError("Only .json files are allowed")

        # R6: Real MIME type
        if content_type and not content_type.startswith('application/json'):
            raise ValueError("Invalid MIME type - application/json required")

        # R7: Maximum size (5MB)
        if content_length > MAX_FILE_SIZE:
            raise ValueError(f"File too large (max {MAX_FILE_SIZE // (1024 * 1024)}MB)")

        # Use the original name (hashing disabled at user request)
        return filename

    @staticmethod
    def validate_trajectory_content(trajectory: Dict[str, Any]) -> None:
        """
        R10-R11, R15-R16, R30, R32 - Complete content validation
        
        Args:
            trajectory: Dictionary representing the trajectory
            
        Raises:
            ValueError: If validation fails
        """
        # R11: Forbid HTML/scripts
        json_str = json.dumps(trajectory)
        if re.search(r'<[^>]+>', json_str):
            raise ValueError("HTML/scripts content forbidden")

        # R11: Forbid dangerous commands
        dangerous_patterns = [
            r'\b(rm|del|format|cmd|powershell|bash|sh|exec|eval)\b',
            r'\$\{.*\}',
            r'javascript:',
            r'data:text/html'
        ]
        for pattern in dangerous_patterns:
            if re.search(pattern, json_str, re.IGNORECASE):
                raise ValueError("Potentially dangerous content detected")

        # R15: Validate numeric values and bounds
        ValidationService.validate_numeric_bounds(trajectory)

        # R16: Forbid external references
        ValidationService.validate_external_refs(json_str)

        # R30: Temporal validation
        ValidationService.validate_temporal_order(trajectory)

        # R32: Version required
        if 'version' not in trajectory:
            raise ValueError("Mandatory field 'version' missing")

        version = str(trajectory['version'])
        if version not in SUPPORTED_TRAJECTORY_VERSIONS:
            raise ValueError(f"Version '{version}' not supported. Accepted versions: {SUPPORTED_TRAJECTORY_VERSIONS}")

    @staticmethod
    def validate_numeric_bounds(trajectory: Dict[str, Any]) -> None:
        """
        R15 - Business numeric bounds validation
        
        Args:
            trajectory: Dictionary representing the trajectory
            
        Raises:
            ValueError: If validation fails
        """
        # GPS coordinates
        if 'origin' in trajectory:
            coords = trajectory['origin'].get('coordinates', {})
            lat = coords.get('lat', 0)
            lon = coords.get('lon', 0)
            alt = coords.get('alt', 0)

            if not isinstance(lat, (int, float)) or not (LATITUDE_MIN <= lat <= LATITUDE_MAX):
                raise ValueError(f"Invalid latitude [{LATITUDE_MIN}, {LATITUDE_MAX}]")
            if not isinstance(lon, (int, float)) or not (LONGITUDE_MIN <= lon <= LONGITUDE_MAX):
                raise ValueError(f"Invalid longitude [{LONGITUDE_MIN}, {LONGITUDE_MAX}]")
            if not isinstance(alt, (int, float)) or alt < ALTITUDE_MIN or alt > ALTITUDE_MAX:
                raise ValueError(f"Invalid altitude [{ALTITUDE_MIN}, {ALTITUDE_MAX}]")

        # Sections and points (old format with sections)
        for section in trajectory.get('sections', []):
            for point in section.get('points', []):
                # Speed
                speed = point.get('speed', {}).get('value', 0)
                if not isinstance(speed, (int, float)) or speed < SPEED_MIN or speed > SPEED_MAX:
                    raise ValueError(f"Invalid speed [{SPEED_MIN}-{SPEED_MAX} m/s]")

                # Relative coordinates
                x = point.get('x', {}).get('value', 0)
                y = point.get('y', {}).get('value', 0)
                if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
                    raise ValueError("Coordinates x,y must be numeric")

                # Working zone
                working_zone = point.get('working_zone', {}).get('value', 0)
                if not isinstance(working_zone, (int, float, bool)):
                    raise ValueError("Invalid working zone")

        # Points (new Android format)
        for section in trajectory.get('points', []):
            values = section.get('values', [])
            columns = section.get('columns', [])
            
            for point_values in values:
                if len(point_values) != len(columns):
                    raise ValueError("Number of values incompatible with columns")
                
                # Validate speed if present
                if 'speed' in columns:
                    speed_idx = columns.index('speed')
                    if speed_idx < len(point_values):
                        speed = point_values[speed_idx]
                        if not isinstance(speed, (int, float)) or speed < 0 or speed > 50:
                            raise ValueError("Invalid speed [0-50 m/s]")

    @staticmethod
    def validate_external_refs(json_str: str) -> None:
        """
        R16 - Forbid external references
        
        Args:
            json_str: JSON string to validate
            
        Raises:
            ValueError: If external references are detected
        """
        # URLs
        url_pattern = r'https?://[^\s"\']+'
        if re.search(url_pattern, json_str):
            raise ValueError("External URLs forbidden")

        # Absolute paths
        path_patterns = [
            r'/[^\s"\']+',  # Unix absolute paths
            r'[A-Za-z]:\\[^\s"\']+',  # Windows absolute paths
            r'\$\{.*\}',  # Template literals
            r'file://[^\s"\']+',  # File URLs
        ]

        for pattern in path_patterns:
            if re.search(pattern, json_str):
                raise ValueError("Absolute paths or external references forbidden")

        # JSON Schema $ref
        if '$ref' in json_str:
            raise ValueError("References $ref forbidden")

    @staticmethod
    def validate_temporal_order(trajectory: Dict[str, Any]) -> None:
        """
        R30 - Validate that timestamps are strictly increasing
        
        Args:
            trajectory: Dictionary representing the trajectory
            
        Raises:
            ValueError: If validation fails
        """
        for section in trajectory.get('sections', []):
            previous_time = 0
            for point in section.get('points', []):
                # Check if the point has a timestamp
                if 'time' in point and 'value' in point['time']:
                    time_value = point['time']['value']
                    if not isinstance(time_value, (int, float)):
                        raise ValueError("Timestamp must be numeric")

                    if time_value < 0:
                        raise ValueError("Negative timestamp invalid")
                    
                    if time_value <= previous_time:
                        raise ValueError(f"Non-increasing timestamp: {time_value} <= {previous_time}")
                    
                    previous_time = time_value

    @staticmethod
    def sanitize_path(path: str) -> str:
        """
        R24 - Path traversal prevention
        
        Args:
            path: Path to secure
            
        Returns:
            Secured path
            
        Raises:
            ValueError: If the path is invalid
        """
        if not path:
            raise ValueError("Empty path")

        # Forbid dangerous sequences
        dangerous_sequences = ['..', '%2e%2e', '\\0', '\0', '../', '..\\', '//', '\\\\']

        for seq in dangerous_sequences:
            if seq in path:
                raise ValueError("Forbidden path sequence detected")

        # Normalize the path
        normalized = os.path.normpath(path)

        # Check that it doesn't escape the authorized directory
        if normalized.startswith('..') or normalized.startswith('/') or normalized.startswith('\\'):
            raise ValueError("Unauthorized path")

        # Allow only safe characters
        if not re.match(r'^[a-zA-Z0-9/_.-]+$', path):
            raise ValueError("Non-authorized characters in path")

        return normalized

    @staticmethod
    def validate_json(data: str) -> Dict[str, Any]:
        """
        Validate and parse JSON
        
        Args:
            data: JSON string to validate
            
        Returns:
            Parsed dictionary
            
        Raises:
            ValueError: If the JSON is invalid
        """
        try:
            return json.loads(data)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON: {e}")
