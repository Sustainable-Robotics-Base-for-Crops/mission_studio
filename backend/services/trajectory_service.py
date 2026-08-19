"""
Trajectory management service
"""

import logging
from typing import Optional, List, Dict, Any

from ..models.trajectory import Trajectory
from ..repositories.trajectory_repository import TrajectoryRepository
from .validation_service import ValidationService

logger = logging.getLogger('trajectory_editor')


class TrajectoryService:
    """
    Service to handle business logic for trajectories
    """

    def __init__(self, trajectory_repository: TrajectoryRepository,
                 validation_service: ValidationService):
        """
        Initialize the trajectory service

        Args:
            trajectory_repository: Repository for accessing trajectories
            validation_service: Validation service
        """
        self.trajectory_repository = trajectory_repository
        self.validation_service = validation_service

    def save_trajectory(self, trajectory_data: Dict[str, Any], user_id: str,
                        storage_mode: str = 'local') -> Dict[str, Any]:
        """
        Save a trajectory with validation

        Args:
            trajectory_data: Trajectory data
            user_id: User identifier
            storage_mode: Storage mode ('local', plugin backend name, or 'both')

        Returns:
            Dictionary with the save status

        Raises:
            ValueError: If validation fails
        """
        # Validate the content of the trajectory before any write.
        self.validate_trajectory_data(trajectory_data)

        # Create the Trajectory model
        trajectory = Trajectory.from_dict(trajectory_data)

        # Validate the model
        errors = trajectory.validate()
        if errors:
            raise ValueError(f"Validation errors: {', '.join(errors)}")

        # Save via the repository
        return self.trajectory_repository.save(trajectory, user_id, storage_mode)

    def validate_trajectory_data(self, trajectory_data: Dict[str, Any]) -> None:
        """
        Validate a trajectory with security rules and the Agri schema.

        This method is used by the save endpoint and by prevalidation
        for local export to keep a unique behavior.
        """
        # Keep existing safeguards against dangerous content and business boundaries.
        self.validation_service.validate_trajectory_content(trajectory_data)

        # Then apply the official contract of the generated file format.
        self.validation_service.validate_agri_schema(trajectory_data)

    def load_trajectory(
        self,
        filepath: str,
        user_id: Optional[str] = None,
        storage_filter: Optional[str] = None,
    ) -> Optional[Trajectory]:
        """
        Load a trajectory

        Args:
            filepath: Path of the file
            user_id: User identifier (for access validation)
            storage_filter: Forced backend ('local', plugin backend name, etc.) if known.

        Returns:
            Trajectory instance or None if error
        """
        logger.info(
            "[service] load_trajectory filepath=%s user=%s storage_filter=%s",
            filepath,
            user_id,
            storage_filter,
        )
        # The storage filter avoids ambiguities when the same key exists locally and in the cloud.
        trajectory = self.trajectory_repository.load(filepath, user_id, storage_filter)

        if trajectory:
            # Validate the loaded trajectory
            errors = trajectory.validate()
            if errors:
                logger.error(f"Validation errors for {filepath}: {', '.join(errors)}")
                return None

        return trajectory

    def delete_trajectory(self, filepath: str, user_id: Optional[str] = None) -> Dict[str, bool]:
        """
        Delete a trajectory

        Args:
            filepath: Path of the file
            user_id: User identifier (for access validation)

        Returns:
            Dictionary with the deletion status
        """
        return self.trajectory_repository.delete(filepath, user_id)

    def list_trajectories(self, user_id: Optional[str] = None,
                         storage_filter: Optional[str] = None,
                         metadata_only: bool = False) -> List[Dict[str, Any]]:
        """
        List trajectories

        Args:
            user_id: User identifier (for filtering)
            storage_filter: Filter by storage ('local', plugin backend name, or None)
            metadata_only: If True, returns only metadata

        Returns:
            List of trajectories organized in a hierarchical structure
        """
        logger.info(
            "[service] list_trajectories user=%s storage_filter=%s metadata_only=%s",
            user_id,
            storage_filter,
            metadata_only,
        )
        rows = self.trajectory_repository.list(user_id, storage_filter, metadata_only)
        logger.info(
            "[service] list_trajectories result_groups=%s storage_filter=%s",
            len(rows),
            storage_filter,
        )
        return rows
