"""
Dynamic loading of plugins from PLUGINS_DIR.
"""

from __future__ import annotations

import importlib.util
import logging
import os
from types import ModuleType
from typing import List

from .extension_points import AppContext


class PluginRegistry:
    """
    Discovers plugins and calls their `register(ctx)` function.
    """

    def __init__(self, logger: logging.Logger):
        self.logger = logger

    def load(self, context: AppContext, plugins_dir: str) -> List[str]:
        loaded: List[str] = []
        if not plugins_dir:
            self.logger.info("[plugins] No PLUGINS_DIR defined")
            return loaded

        absolute_dir = os.path.abspath(plugins_dir)
        if not os.path.isdir(absolute_dir):
            self.logger.warning("[plugins] Directory not found: %s", absolute_dir)
            return loaded

        for entry in sorted(os.listdir(absolute_dir)):
            plugin_dir = os.path.join(absolute_dir, entry)
            plugin_file = os.path.join(plugin_dir, "plugin.py")
            if not os.path.isdir(plugin_dir) or not os.path.isfile(plugin_file):
                continue
            module = self._import_plugin(entry, plugin_file)
            if module is None:
                continue
            register_fn = getattr(module, "register", None)
            if not callable(register_fn):
                self.logger.warning("[plugins] register(ctx) missing for %s", entry)
                continue
            try:
                register_fn(context)
                loaded.append(entry)
                self.logger.info("[plugins] Loaded: %s", entry)
            except Exception as exc:
                self.logger.exception("[plugins] Error loading %s: %s", entry, exc)
        return loaded

    def _import_plugin(self, name: str, plugin_file: str) -> ModuleType | None:
        module_name = f"trajectory_editor_plugin_{name}"
        plugin_dir = os.path.dirname(plugin_file)
        # submodule_search_locations allows relative imports in plugin.py
        spec = importlib.util.spec_from_file_location(
            module_name, plugin_file, submodule_search_locations=[plugin_dir]
        )
        if spec is None or spec.loader is None:
            self.logger.warning("[plugins] Import not possible: %s", plugin_file)
            return None
        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)
            return module
        except ModuleNotFoundError as exc:
            # A private plugin may depend on libs not installed on the public core side.
            # We ignore this plugin instead of making the server fail.
            self.logger.warning(
                "[plugins] Missing dependency for %s (%s), plugin ignored",
                name,
                exc,
            )
            return None
        except Exception as exc:
            self.logger.exception("[plugins] Import failed for %s: %s", name, exc)
            return None
