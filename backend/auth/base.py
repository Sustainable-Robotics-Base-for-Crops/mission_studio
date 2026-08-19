"""
Authentication interfaces for the public layer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol, Tuple


@dataclass
class AuthUser:
    """
    Represents an authenticated user in a provider-agnostic way.
    """

    uid: str
    email: Optional[str] = None


class AuthProvider(Protocol):
    """
    Minimal contract to plug in an external auth provider.
    """

    def verify_id_token(self, id_token: str) -> Optional[dict]:
        """Verifies an ID token and returns the claims."""

    def verify_session_cookie(self, session_cookie: str) -> Optional[dict]:
        """Verifies a session cookie and returns the claims."""

    def create_session_cookie(
        self, id_token: str, expires_in: Optional[int] = None
    ) -> Optional[Tuple[str, int]]:
        """Creates a session cookie from an ID token."""

    def get_user_from_token(self, id_token: str) -> Optional[AuthUser]:
        """Returns a user from a Bearer token."""

    def get_user_from_session_cookie(self, session_cookie: str) -> Optional[AuthUser]:
        """Returns a user from a session cookie."""
