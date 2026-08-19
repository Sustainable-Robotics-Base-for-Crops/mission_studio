"""
Request validation middleware
"""

import logging
from typing import Dict, Any, Optional

from ..services.validation_service import ValidationService

logger = logging.getLogger('trajectory_editor')


class ValidationMiddleware:
    """
    Middleware to validate requests
    """
    
    def __init__(self, validation_service: ValidationService):
        """
        Initialize the validation middleware
        
        Args:
            validation_service: Validation service
        """
        self.validation_service = validation_service

    def validate_file_upload(self, filename: str, content_type: str, 
                            content_length: int) -> str:
        """
        Validate a file upload
        
        Args:
            filename: File name
            content_type: MIME type
            content_length: File size
            
        Returns:
            Validated file name
            
        Raises:
            ValueError: If validation fails
        """
        return self.validation_service.validate_file_upload(filename, content_type, content_length)

    def validate_trajectory(self, trajectory_data: Dict[str, Any]) -> None:
        """
        Validate trajectory data
        
        Args:
            trajectory_data: Trajectory data
            
        Raises:
            ValueError: If validation fails
        """
        self.validation_service.validate_trajectory_content(trajectory_data)

    def sanitize_path(self, path: str) -> str:
        """
        Secure a file path
        
        Args:
            path: Path to secure
            
        Returns:
            Secured path
            
        Raises:
            ValueError: If the path is invalid
        """
        return self.validation_service.sanitize_path(path)

    def validate_json(self, data: str) -> Dict[str, Any]:
        """
        Validate and parse JSON
        
        Args:
            data: JSON string to validate
            
        Returns:
            Parsed dictionary
            
        Raises:
            ValueError: If the JSON is invalid
        """
        return self.validation_service.validate_json(data)
