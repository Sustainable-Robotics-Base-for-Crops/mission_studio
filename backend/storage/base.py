"""
Pluggable storage interfaces.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Protocol


class StorageBackend(Protocol):
    """
    Contract implemented by all storage backends.
    """

    name: str

    def save(self, filepath: str, data: str) -> bool:
        """Saves a file to the backend."""

    def load(self, filepath: str) -> Optional[str]:
        """Loads a file from the backend."""

    def delete(self, filepath: str) -> bool:
        """Deletes a file from the backend."""

    def list(self, metadata_only: bool = False) -> List[Dict[str, Any]]:
        """Lists files in the backend."""
   
