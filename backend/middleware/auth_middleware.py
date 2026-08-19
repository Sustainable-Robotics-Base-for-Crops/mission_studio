"""
Generic authentication middleware driven by an AuthProvider.
"""

from __future__ import annotations

from typing import Optional

from ..constants import (
    RATE_LIMIT_API_MAX_ATTEMPTS,
    RATE_LIMIT_API_WINDOW,
    RATE_LIMIT_DEFAULT_MAX_ATTEMPTS,
    RATE_LIMIT_DEFAULT_WINDOW,
)


class AuthMiddleware:
    """
    Checks cookie/token authentication or falls back to anonymous mode.
    """

    def __init__(
        self,
        auth_provider,
        rate_limit_middleware=None,
        anonymous_mode: bool = False,
    ):
        self.auth_provider = auth_provider
        self.rate_limit_middleware = rate_limit_middleware
        self.anonymous_mode = anonymous_mode

    def check_auth(self, headers: dict, client_address: tuple, path: str) -> tuple[bool, Optional[str]]:
        static_extensions = [".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".pdf"]
        if any(path.endswith(ext) for ext in static_extensions) or path.startswith("/css/") or path.startswith("/js/"):
            return (True, None)

        # Session/login routes may be exposed by a plugin.
        if path.startswith("/api/auth/"):
            return (True, None)

        session_cookie = self._get_session_cookie(headers)
        if session_cookie:
            user = self.auth_provider.get_user_from_session_cookie(session_cookie)
            if user:
                return (True, user.uid)

        auth_header = headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            user = self.auth_provider.get_user_from_token(auth_header[7:])
            if user:
                return (True, user.uid)

        if self.rate_limit_middleware:
            client_ip = self.rate_limit_middleware.get_client_ip(headers, client_address)
            max_attempts = RATE_LIMIT_API_MAX_ATTEMPTS if path.startswith("/api/") else RATE_LIMIT_DEFAULT_MAX_ATTEMPTS
            window = RATE_LIMIT_API_WINDOW if path.startswith("/api/") else RATE_LIMIT_DEFAULT_WINDOW
            if not self.rate_limit_middleware.is_allowed(client_ip, max_attempts=max_attempts, window=window):
                return (False, None)

        # Public OSS mode allows an anonymous user.
        if self.anonymous_mode:
            return (True, "anonymous")

        return (False, None)

    def _get_session_cookie(self, headers: dict) -> Optional[str]:
        cookie_header = headers.get("Cookie", "")
        if not cookie_header:
            return None
        for cookie in cookie_header.split(";"):
            cookie = cookie.strip()
            if "=" in cookie:
                name, value = cookie.split("=", 1)
                if name.strip() == "session":
                    return value.strip()
        return None
