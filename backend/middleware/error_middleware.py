"""
Error handling middleware
"""

import logging
import traceback
from http import HTTPStatus
from typing import Callable, Any, Optional

logger = logging.getLogger('trajectory_editor')


class ErrorMiddleware:
    """
    Middleware for centralized error management
    """
    
    @staticmethod
    def handle_error(error: Exception, context: dict = None) -> tuple[int, str]:
        """
        Handle an error and return an HTTP code and message
        
        Args:
            error: Exception to handle
            context: Additional context (optional)
            
        Returns:
            Tuple (http_code, message)
        """
        error_type = type(error).__name__
        error_message = str(error)
        
        # Log the error with the context
        logger.error(f"Erreur {error_type}: {error_message}")
        if context:
            logger.debug(f"Contexte: {context}")
        
        # Log the stack trace for unexpected errors
        if not isinstance(error, (ValueError, KeyError, TypeError)):
            logger.debug(traceback.format_exc())
        
        # Determine the appropriate HTTP code
        if isinstance(error, ValueError):
            return (HTTPStatus.BAD_REQUEST, f"Erreur de validation: {error_message}")
        elif isinstance(error, KeyError):
            return (HTTPStatus.BAD_REQUEST, f"Champ manquant: {error_message}")
        elif isinstance(error, PermissionError):
            return (HTTPStatus.FORBIDDEN, f"Permission refusée: {error_message}")
        elif isinstance(error, FileNotFoundError):
            return (HTTPStatus.NOT_FOUND, f"Fichier non trouvé: {error_message}")
        else:
            return (HTTPStatus.INTERNAL_SERVER_ERROR, "Erreur interne du serveur")

    @staticmethod
    def safe_execute(func: Callable, *args, **kwargs) -> tuple[bool, Any, Optional[tuple]]:
        """
        Execute a function safely with error handling
        
        Args:
            func: Function to execute
            *args: Positional arguments
            **kwargs: Keyword arguments
            
        Returns:
            Tuple (success, result, error_response)
        """
        try:
            result = func(*args, **kwargs)
            return (True, result, None)
        except Exception as e:
            code, message = ErrorMiddleware.handle_error(e)
            return (False, None, (code, message))
