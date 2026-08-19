"""
Repository for accessing trajectories on plugin storage backends.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional
from urllib.parse import unquote

from ..models.trajectory import Trajectory

logger = logging.getLogger("trajectory_editor")


class TrajectoryRepository:
    """
    Backend-agnostic repository for storage.
    """

    def __init__(self, storage_backends: Dict[str, object]):
        self.storage_backends = storage_backends

    def save(
        self, trajectory: Trajectory, user_id: str, storage_mode: str = "local"
    ) -> Dict[str, Any]:
        """
        Save a trajectory

        Args:
            trajectory: Trajectory instance to save
            user_id: User identifier (used for validation, not in the path)
            storage_mode: Storage mode ('local', plugin backend name, or 'both')

        Returns:
            Dictionary with save status
        """
        # S3 key / local path: file_type / vehicle (robot) identifier / file.json
        # (Objects already saved under the old vehicle_id/file_type/ order remain listable and loadable.)
        filepath = f"{trajectory.file_type}/{trajectory.vehicle_id}/{trajectory.filename}"

        # Prepare JSON data
        json_data = json.dumps(trajectory.to_dict(), ensure_ascii=False, indent=2)

        requested_targets: List[str]
        if storage_mode == "both":
            requested_targets = list(self.storage_backends.keys())
        else:
            requested_targets = [storage_mode]

        results: Dict[str, bool] = {}
        for backend_name in requested_targets:
            backend = self.storage_backends.get(backend_name)
            if backend is None:
                results[backend_name] = False
                continue
            results[backend_name] = bool(backend.save(filepath, json_data))

        return {
            "success": any(results.values()),
            "filename": trajectory.filename,
            "path": filepath,
            "mode": storage_mode,
            "targets": results,
        }

    def load(
        self,
        filepath: str,
        user_id: Optional[str] = None,
        storage_filter: Optional[str] = None,
    ) -> Optional[Trajectory]:
        """
        Load a trajectory

        Args:
            filepath: Relative file path
            user_id: User identifier (optional, for validation)
            storage_filter: Forced backend ('local', plugin backend name, etc.) if known from the UI.

        Returns:
            Trajectory instance or None if error
        """
        # Decode URL if needed
        decoded_path = unquote(filepath)
        logger.info(
            "[repo] load request filepath=%s decoded=%s user=%s storage_filter=%s",
            filepath,
            decoded_path,
            user_id,
            storage_filter,
        )

        # If the frontend already knows the backend source, use it as a priority.
        backend_order = []
        if storage_filter:
            preferred = self.storage_backends.get(storage_filter)
            if preferred is not None:
                backend_order.append((storage_filter, preferred))
        for backend_name, backend in self.storage_backends.items():
            if storage_filter and backend_name == storage_filter:
                continue
            backend_order.append((backend_name, backend))

        logger.info(
            "[repo] load backend_order=%s for path=%s",
            [name for name, _backend in backend_order],
            decoded_path,
        )

        last_error: Optional[str] = None
        for backend_name, backend in backend_order:
            logger.info("[repo] load try backend=%s path=%s", backend_name, decoded_path)
            content = backend.load(decoded_path)
            if content is None:
                logger.info("[repo] load miss backend=%s path=%s", backend_name, decoded_path)
                continue
            try:
                data = json.loads(content)

                # Automatically migrate old formats if needed.
                if "sections" in data or "fileType" in data or "vehicleId" in data:
                    data = self._migrate_trajectory_format(data)

                trajectory = Trajectory.from_dict(data)

                # If a backend returns a business-invalid JSON, try with the next one.
                errors = trajectory.validate()
                if errors:
                    last_error = f"{backend_name}: {', '.join(errors)}"
                    logger.warning(
                        "Invalid trajectory from %s for %s: %s",
                        backend_name,
                        decoded_path,
                        ", ".join(errors),
                    )
                    continue

                return trajectory
            except json.JSONDecodeError as e:
                last_error = f"{backend_name}: Invalid JSON ({e})"
                logger.warning("Invalid JSON from %s for %s: %s", backend_name, decoded_path, e)
                continue
            except Exception as e:
                last_error = f"{backend_name}: {e}"
                logger.warning("Error loading from %s for %s: %s", backend_name, decoded_path, e)
                continue

        if last_error:
            logger.error("No backend could load %s (%s)", decoded_path, last_error)
        else:
            logger.warning(f"File not found: {decoded_path}")
        return None

    def delete(self, filepath: str, user_id: Optional[str] = None) -> Dict[str, bool]:
        """
        Delete a trajectory

        Args:
            filepath: Relative file path
            user_id: User identifier (optional, for validation)

        Returns:
            Dictionary with delete status per backend.
        """
        decoded_path = unquote(filepath)

        results: Dict[str, bool] = {}
        for backend_name, backend in self.storage_backends.items():
            if backend_name == "local" or user_id:
                results[backend_name] = bool(backend.delete(decoded_path))
            else:
                # In anonymous mode without user, avoid non-explicit deletions on cloud plugins.
                results[backend_name] = False

        return {"success": any(results.values()), **results}

    def list(
        self,
        user_id: Optional[str] = None,
        storage_filter: Optional[str] = None,
        metadata_only: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        List trajectories

        Args:
            user_id: User identifier (optional, for filtering)
            storage_filter: Filter by storage ('local', plugin backend name, or None for all)
            metadata_only: If True, return only metadata

        Returns:
            List of trajectories organized by hierarchical structure
        """
        logger.info(
            "[repo] list request user=%s storage_filter=%s metadata_only=%s",
            user_id,
            storage_filter,
            metadata_only,
        )
        type_folders = {}

        for backend_name, backend in self.storage_backends.items():
            if storage_filter and backend_name != storage_filter:
                continue
            rows = backend.list(metadata_only=metadata_only)
            logger.info(
                "[repo] list backend=%s returned_rows=%s",
                backend_name,
                len(rows),
            )
            for file_info in rows:
                normalized = self._normalize_file_info(file_info, backend_name)
                if normalized is None:
                    continue
                self._add_file_to_structure(normalized, type_folders, backend_name)

        # Convert to frontend-expected format
        result = []
        for file_type, type_data in type_folders.items():
            result.append({
                'type': file_type,
                'vehicles': type_data['vehicles']
            })
        logger.info(
            "[repo] list result_groups=%s storage_filter=%s",
            len(result),
            storage_filter,
        )

        return result

    def _normalize_file_info(
        self, file_info: Dict[str, Any], backend_name: str
    ) -> Optional[Dict[str, Any]]:
        """
        Normalize heterogeneous formats into `file_type/vehicle_id/filename`.
        """
        row = dict(file_info)
        full_path = row.get("fullPath") or row.get("Key")
        if not full_path:
            return None
        # Keep the real object key for GET/DELETE operations.
        # Some old data is stored with a different order
        # (e.g.: vehicle/type/file) and cannot be read via a normalized path.
        row["actualPath"] = str(full_path).replace("\\", "/")
        parts = str(full_path).replace("\\", "/").split("/")
        parts = [part for part in parts if part]
        if len(parts) >= 3:
            file_type, vehicle_id, filename = parts[-3], parts[-2], parts[-1]
        elif len(parts) == 2:
            file_type, vehicle_id, filename = "draft", parts[0], parts[1]
        else:
            file_type, vehicle_id, filename = "draft", "unknown", parts[0]

        row["filename"] = row.get("filename", filename)
        row["fullPath"] = f"{file_type}/{vehicle_id}/{filename}"
        row["storage"] = backend_name
        if "Size" in row and "size" not in row:
            row["size"] = row["Size"]
        return row

    def _add_file_to_structure(
        self, file_info: Dict[str, Any], type_folders: Dict[str, Any], storage: str
    ) -> None:
        """
        Add a file to the hierarchical structure

        Args:
            file_info: File information
            type_folders: Hierarchical structure to update
            storage: Storage type ('local' or plugin backend name)
        """
        full_path = file_info.get('fullPath', '')
        path_parts = full_path.split('/')

        if len(path_parts) >= 2:
            file_type = path_parts[0]
            vehicle_id = path_parts[1]
            filename = file_info.get('filename', path_parts[-1] if path_parts else '')

            # Initialize the structure if needed
            if file_type not in type_folders:
                type_folders[file_type] = {'vehicles': {}}

            if vehicle_id not in type_folders[file_type]['vehicles']:
                type_folders[file_type]['vehicles'][vehicle_id] = []

            # Check if this file already exists
            existing = next(
                (f for f in type_folders[file_type]['vehicles'][vehicle_id]
                 if f.get('filename') == filename and f.get('storage') == storage),
                None
            )

            if not existing:
                type_folders[file_type]['vehicles'][vehicle_id].append(file_info)

    def _migrate_trajectory_format(self, old_trajectory: Dict[str, Any]) -> Dict[str, Any]:
        """
        Migrate a trajectory from the old format to the new Android format

        Args:
            old_trajectory: Trajectory in the old format

        Returns:
            Trajectory in the new format
        """
        # Note: The 'filename' field is not included in the JSON as it is managed by the storage system
        new_trajectory = {
            "version": old_trajectory.get("version", "3"),
            "file_type": old_trajectory.get("file_type", old_trajectory.get("fileType", {}).get("value", "draft")),
            "vehicle_id": old_trajectory.get("vehicle_id", old_trajectory.get("vehicleId", "v1")),
            "metadata": old_trajectory.get("metadata", {}),
            "origin": old_trajectory.get("origin", {
                "type": "WGS84",
                "coordinates": {"lat": 48.8566, "lon": 2.3522, "alt": 0.0}
            }),
            "points": [],
            "geofencing": old_trajectory.get("geofencing")
        }

        # Convert sections to points if they exist
        if "sections" in old_trajectory:
            for section in old_trajectory["sections"]:
                android_section = {
                    "section_type": section.get("sectionType", {}).get("value", "row_path"),
                    "columns": section.get("columns", ["x", "y", "speed", "working_zone", "punctual"]),
                    "values": []
                }

                if "points" in section:
                    for point in section["points"]:
                        point_values = []
                        for col in android_section["columns"]:
                            if col in point:
                                val = point[col]
                                if isinstance(val, dict) and "value" in val:
                                    point_values.append(val["value"])
                                else:
                                    point_values.append(val)
                            else:
                                point_values.append(0.0 if col != "punctual" else {})
                        android_section["values"].append(point_values)

                new_trajectory["points"].append(android_section)
        elif "points" in old_trajectory:
            # Already in the correct format
            new_trajectory["points"] = old_trajectory["points"]

        return new_trajectory
