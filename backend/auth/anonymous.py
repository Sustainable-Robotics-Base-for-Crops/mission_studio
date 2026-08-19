"""
Default anonymous authentication provider.
"""

from __future__ import annotations

from typing import Optional, Tuple

from .base import AuthUser


class AnonymousAuthProvider:
    """
    Fallback mode to run the public repo without private dependencies.
    """

    anonymous_uid = "anonymous"

    def verify_id_token(self, id_token: str) -> Optional[dict]:
        return {"uid": self.anonymous_uid} if id_token else None

    def verify_session_cookie(self, session_cookie: str) -> Optional[dict]:
        return {"uid": self.anonymous_uid} if session_cookie else None

    def create_session_cookie(
        self, id_token: str, expires_in: Optional[int] = None
    ) -> Optional[Tuple[str, int]]:
        # In anonymous mode, we do not issue any real cookie.
        return None

    def get_user_from_token(self, id_token: str) -> Optional[AuthUser]:
        if not id_token:
            return None
        return AuthUser(uid=self.anonymous_uid)

    def get_user_from_session_cookie(self, session_cookie: str) -> Optional[AuthUser]:
        if not session_cookie:
            return None
        return AuthUser(uid=self.anonymous_uid)

    def get_anonymous_user(self) -> AuthUser:
        """
        Convenient utility for the public server.
        """
        return AuthUser(uid=self.anonymous_uid)
