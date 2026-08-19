"""
Assembly of the public application context + plugins.
"""

from __future__ import annotations

import logging

from ..storage.local_backend import LocalStorageBackend
from .extension_points import AppContext
from .plugin_registry import PluginRegistry


class AppFactory:
    """
    Builds an AppContext ready to be consumed by the HTTP server.
    """

    @staticmethod
    def build(settings: object, logger: logging.Logger) -> AppContext:
        context = AppContext(settings=settings, log=logger)

        # The local backend always exists, even without a private plugin.
        local_backend = LocalStorageBackend(settings.UPLOADS_DIR)
        context.register_storage_backend("local", local_backend)

        registry = PluginRegistry(logger)
        loaded_plugins = registry.load(context, settings.PLUGINS_DIR)
        logger.info("[plugins] Active plugins: %s", ", ".join(loaded_plugins) if loaded_plugins else "none")

        return context
 