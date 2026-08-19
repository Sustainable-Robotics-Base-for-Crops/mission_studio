"""
Permissive permissions provider for public OSS mode.
"""

from __future__ import annotations

from typing import Any, Dict


class OpenPermissionProvider:
    """
    Default permission values when no private plugin is injected.
    """

    def get_permissions(self, user_id: str) -> Dict[str, Any]:
        # Permissive fallback mode requested: everything is allowed if no
        # permissions plugin is injected (useful in simple private environments).
        return {
            "user_level": 1,
            "cloud_storage_enable": True,
            "show_advanced_features": True,
        }

    def get_ui_config(self, user_id: str) -> Dict[str, Any]:
        return {
            "ui": {
                # Show cloud actions by default without permissions plugin.
                "showCloudButtons": True,
                "showAdvancedFeatures": True,
                "allowedFileTypes": ["draft", "mission_order", "parcel_map"],
                "userLevel": 1,
            }
        }

    def has_storage_access(self, user_id: str, storage_name: str) -> bool:
        # Allow all declared backends (local + cloud plugins) in fallback.
        return True
