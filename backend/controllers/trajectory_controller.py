"""
Controller for managing trajectories
"""

import json
import logging
import os
from http import HTTPStatus
from typing import Tuple, Optional
from urllib.parse import urlparse, parse_qs

from ..services.trajectory_service import TrajectoryService
from ..middleware.validation_middleware import ValidationMiddleware
from ..middleware.error_middleware import ErrorMiddleware
from ..constants import MAX_FILE_SIZE

logger = logging.getLogger('trajectory_editor')


class TrajectoryController:
    """
    Controller for handling trajectory requests
    """
    
    def __init__(
        self,
        trajectory_service: TrajectoryService,
        validation_middleware: ValidationMiddleware,
        permission_provider,
    ):
        """
        Initialize the trajectory controller
        
        Args:
            trajectory_service: Trajectory service
            validation_middleware: Validation middleware
            permission_provider: Injectable permission provider
        """
        self.trajectory_service = trajectory_service
        self.validation_middleware = validation_middleware
        self.permission_provider = permission_provider

    def validate_trajectory(self, request_data: dict) -> Tuple[int, dict]:
        """
        Pre-validate a trajectory without saving it.

        Used by local export on the browser side, which may not
        go through the save endpoint before producing the JSON file.
        """
        try:
            self.trajectory_service.validate_trajectory_data(request_data)
            return (HTTPStatus.OK, {'valid': True})
        except ValueError as e:
            logger.error(f"Erreur validation trajectoire: {e}")
            return (HTTPStatus.BAD_REQUEST, {
                'valid': False,
                'error': str(e)
            })
        except Exception as e:
            code, message = ErrorMiddleware.handle_error(e)
            return (code, {'valid': False, 'error': message})

    def save_trajectory(self, request_data: dict, user_id: str, 
                       headers: dict) -> Tuple[int, dict]:
        """
        Save a trajectory
        
        Args:
            request_data: Trajectory data
            user_id: User identifier
            headers: HTTP headers (to determine storage mode)
            
        Returns:
            Tuple (http_code, response_data)
        """
        try:
            # Determine the storage mode
            storage_mode = headers.get('X-Storage-Mode', 'local')
            
            # Check permissions for non-local operations
            if storage_mode not in ("local", "both") and user_id:
                if not self.permission_provider.has_storage_access(user_id, storage_mode):
                    logger.warning(f"Unauthorized cloud access attempt for user {user_id}")
                    return (HTTPStatus.FORBIDDEN, {
                        'error': 'Cloud storage access not allowed'
                    })
            
            # Validate the file size
            content_length = int(headers.get('Content-Length', 0))
            if content_length > MAX_FILE_SIZE:
                return (HTTPStatus.BAD_REQUEST, {
                    'error': f'File too large (max {MAX_FILE_SIZE // (1024 * 1024)}MB)'
                })
            
            # Validate the filename (basename only: no ../ in the object key)
            filename = request_data.get('filename', 'new_trajectory.json')
            filename = os.path.basename(str(filename).strip()) or 'new_trajectory.json'
            if not filename.endswith('.json'):
                filename += '.json'
            request_data['filename'] = filename
            
            self.validation_middleware.validate_file_upload(
                filename,
                headers.get('Content-Type', ''),
                content_length
            )
            
            # Save via the service
            result = self.trajectory_service.save_trajectory(
                request_data,
                user_id,
                storage_mode
            )
            
            return (HTTPStatus.OK, result)
        except ValueError as e:
            logger.error(f"Erreur validation trajectoire: {e}")
            return (HTTPStatus.BAD_REQUEST, {
                'error': str(e)
            })
        except Exception as e:
            code, message = ErrorMiddleware.handle_error(e)
            return (code, {'error': message})

    def load_trajectory(self, filepath: str, user_id: Optional[str], 
                       query_params: dict) -> Tuple[int, dict]:
        """
        Load a trajectory
        
        Args:
            filepath: File path
            user_id: User identifier (optional)
            query_params: Query parameters (for download)
            
        Returns:
            Tuple (http_code, response_data)
        """
        try:
            logger.info(
                "[api] load_trajectory request filepath=%s user=%s storage=%s query=%s",
                filepath,
                user_id,
                query_params.get('storage', [None])[0],
                query_params,
            )
            # Secure the path
            safe_path = self.validation_middleware.sanitize_path(filepath)

            # Allows the frontend to force the backend source (e.g., a cloud storage plugin).
            storage_filter = query_params.get('storage', [None])[0]
            if storage_filter and storage_filter != "local" and user_id:
                if not self.permission_provider.has_storage_access(user_id, storage_filter):
                    logger.warning(f"Unauthorized cloud load attempt for user {user_id}")
                    return (HTTPStatus.FORBIDDEN, {
                        'error': 'Cloud storage access not allowed'
                    })

            # Load the trajectory
            trajectory = self.trajectory_service.load_trajectory(safe_path, user_id, storage_filter)
            
            if not trajectory:
                logger.warning(
                    "[api] load_trajectory miss filepath=%s safe_path=%s storage=%s user=%s",
                    filepath,
                    safe_path,
                    storage_filter,
                    user_id,
                )
                return (HTTPStatus.NOT_FOUND, {
                    'error': 'File not found'
                })
            
            # If download=True, return the file for download
            is_download = query_params.get('download', [''])[0].lower() == 'true'
            if is_download:
                # The controller will return the raw data for download
                return (HTTPStatus.OK, {
                    'trajectory': trajectory.to_dict(),
                    'download': True,
                    'filename': trajectory.filename
                })
            
            logger.info(
                "[api] load_trajectory OK safe_path=%s storage=%s user=%s",
                safe_path,
                storage_filter,
                user_id,
            )
            return (HTTPStatus.OK, trajectory.to_dict())
        except ValueError as e:
            return (HTTPStatus.BAD_REQUEST, {
                'error': str(e)
            })
        except Exception as e:
            code, message = ErrorMiddleware.handle_error(e)
            return (code, {'error': message})

    def list_trajectories(self, user_id: Optional[str], query_params: dict) -> Tuple[int, dict]:
        """
        List trajectories
        
        Args:
            user_id: User identifier (optional)
            query_params: Query parameters (storage, metadata)
            
        Returns:
            Tuple (http_code, response_data)
        """
        try:
            storage_filter = query_params.get('storage', [None])[0]
            metadata_only = query_params.get('metadata', [''])[0].lower() == 'true'
            logger.info(
                "[api] list_trajectories request user=%s storage=%s metadata_only=%s",
                user_id,
                storage_filter,
                metadata_only,
            )
            
            # Check permissions for explicit plugin storages.
            if storage_filter and storage_filter != "local" and user_id:
                if not self.permission_provider.has_storage_access(user_id, storage_filter):
                    logger.warning(f"Unauthorized cloud list attempt for user {user_id}")
                    return (HTTPStatus.FORBIDDEN, {
                        'error': 'Cloud storage access not allowed'
                    })
            
            trajectories = self.trajectory_service.list_trajectories(
                user_id,
                storage_filter,
                metadata_only
            )

            # Compatibility safeguard: some legacy clients/flows may
            # expect a list even when only one entry is available.
            if isinstance(trajectories, dict):
                logger.warning(
                    "[api] list_trajectories legacy-shape detected (dict), coercing to list. keys=%s",
                    list(trajectories.keys()),
                )
                trajectories = [trajectories]
            elif not isinstance(trajectories, list):
                logger.warning(
                    "[api] list_trajectories unexpected-shape=%s, coercing to empty list",
                    type(trajectories).__name__,
                )
                trajectories = []

            logger.info(
                "[api] list_trajectories OK user=%s storage=%s groups=%s",
                user_id,
                storage_filter,
                len(trajectories),
            )
            
            return (HTTPStatus.OK, trajectories)
        except Exception as e:
            code, message = ErrorMiddleware.handle_error(e)
            return (code, {'error': message})

    def delete_trajectory(self, filepath: str, user_id: Optional[str]) -> Tuple[int, dict]:
        """
        Delete a trajectory
        
        Args:
            filepath: File path
            user_id: User identifier (optional)
            
        Returns:
            Tuple (http_code, response_data)
        """
        try:
            # Secure the path
            safe_path = self.validation_middleware.sanitize_path(filepath)
            
            # Delete via the service
            result = self.trajectory_service.delete_trajectory(safe_path, user_id)
            
            if not result.get('success'):
                return (HTTPStatus.NOT_FOUND, {
                    'error': 'File not found'
                })
            
            return (HTTPStatus.OK, result)
        except ValueError as e:
            return (HTTPStatus.BAD_REQUEST, {
                'error': str(e)
            })
        except Exception as e:
            code, message = ErrorMiddleware.handle_error(e)
            return (code, {'error': message})
