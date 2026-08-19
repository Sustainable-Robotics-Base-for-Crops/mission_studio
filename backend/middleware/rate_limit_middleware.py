"""
Rate limiting middleware
"""

import time
import logging
from collections import defaultdict
from typing import Callable, Optional

from ..constants import RATE_LIMIT_DEFAULT_MAX_ATTEMPTS, RATE_LIMIT_DEFAULT_WINDOW

logger = logging.getLogger('trajectory_editor')


class RateLimitMiddleware:
    """
    Middleware for limiting request rate (rate limiting)
    """
    
    def __init__(self, max_attempts: int = None, window: int = None):
        """
        Initialize the rate limiting middleware
        
        Args:
            max_attempts: Maximum number of attempts per window (default: RATE_LIMIT_DEFAULT_MAX_ATTEMPTS)
            window: Time window in seconds (default: RATE_LIMIT_DEFAULT_WINDOW)
        """
        self.max_attempts = max_attempts or RATE_LIMIT_DEFAULT_MAX_ATTEMPTS
        self.window = window or RATE_LIMIT_DEFAULT_WINDOW
        self.attempts = defaultdict(list)

    def is_allowed(self, ip: str, max_attempts: Optional[int] = None, 
                   window: Optional[int] = None) -> bool:
        """
        Check whether a request is allowed for an IP
        
        Args:
            ip: Client's IP address
            max_attempts: Maximum number of attempts (override)
            window: Time window in seconds (override)
            
        Returns:
            True if allowed, False otherwise
        """
        max_attempts = max_attempts or self.max_attempts
        window = window or self.window
        
        now = time.time()
        # Clean up expired attempts
        self.attempts[ip] = [t for t in self.attempts[ip] if now - t < window]
        
        if len(self.attempts[ip]) >= max_attempts:
            logger.warning(f"Rate limit exceeded for IP: {ip}")
            return False
        
        # Register this attempt
        self.attempts[ip].append(now)
        return True

    def get_client_ip(self, headers: dict, client_address: tuple) -> str:
        """
        Get the client IP from the headers or direct address
        
        Args:
            headers: HTTP request headers
            client_address: Client address (tuple)
            
        Returns:
            Client IP address
        """
        # Try X-Forwarded-For first (proxy), then direct address
        x_forwarded_for = headers.get('X-Forwarded-For', '')
        if x_forwarded_for:
            # Take the first IP (the real client one)
            return x_forwarded_for.split(',')[0].strip()
        return client_address[0] if client_address else 'unknown'
