"""
Contracts for permission providers.
"""

from __future__ import annotations

from typing import Any, Dict, Protocol


class PermissionProvider(Protocol):
    """
    Public interface to plug in a permission engine.
    """

    def get_permissions(self, user_id: str) -> Dict[str, Any]:
        """Returns the raw permissions of the user."""

    def get_ui_config(self, user_id: str) -> Dict[str, Any]:
        """Returns the UI configuration derived from permissions."""

    def has_storage_access(self, user_id: str, storage_name: str) -> bool:
        """Checks if a given storage is authorized."""
   
