"""
Feature flags for the Mission Studio migration (strangler fig).

A flag at its default value must produce no observable change. Query parameters
win over the environment so a developer can force either shell without editing
`.env` (which is loaded with override=True and would otherwise mask real env vars).
"""

from __future__ import annotations

import os
from typing import Mapping, Sequence

TRUE_VALUES = {"1", "true", "yes", "on"}
FALSE_VALUES = {"0", "false", "no", "off", "none", "disabled", ""}

# Query values that explicitly select the v2 shell on /app.
SHELL_V2_QUERY_VALUES = {"v2", "studio"}
# Query values that force the legacy shell even if the env flag is on.
SHELL_V1_QUERY_VALUES = {"v1", "legacy"}


def is_enabled(name: str, default: bool = False) -> bool:
    """
    Read a boolean flag from the process environment.

    Empty / missing values yield `default`. Recognised truthy tokens: 1, true,
    yes, on (case-insensitive).
    """
    raw = os.getenv(name)
    if raw is None:
        return default
    token = raw.strip().lower()
    if token in TRUE_VALUES:
        return True
    if token in FALSE_VALUES:
        return False
    return default


def _first_query_value(query: Mapping[str, Sequence[str]] | None, key: str) -> str:
    if not query:
        return ""
    values = query.get(key) or []
    return str(values[0]).strip().lower() if values else ""


def wants_ui_shell_v2(query: Mapping[str, Sequence[str]] | None = None) -> bool:
    """
    Decide whether the request should receive the Mission Studio shell.

    Order: explicit `?ui=` query parameter, then `UI_SHELL_V2` env (default false).
    """
    ui = _first_query_value(query, "ui")
    if ui in SHELL_V2_QUERY_VALUES:
        return True
    if ui in SHELL_V1_QUERY_VALUES:
        return False
    return is_enabled("UI_SHELL_V2", default=False)


def registry() -> dict[str, str | bool]:
    """Snapshot of flags exposed to the frontend. Defaults match the roadmap §9."""
    return {
        "UI_SHELL_V2": is_enabled("UI_SHELL_V2", default=False),
        "UI_THEME_V2": is_enabled("UI_THEME_V2", default=False),
        "MAP_ENGINE": os.getenv("MAP_ENGINE", "leaflet").strip() or "leaflet",
        "BACKEND_FASTAPI": is_enabled("BACKEND_FASTAPI", default=False),
        "FEAT_COVERAGE_ENGINE": is_enabled("FEAT_COVERAGE_ENGINE", default=False),
        "FEAT_SIMULATION": is_enabled("FEAT_SIMULATION", default=False),
        "FEAT_PUBLICATION": is_enabled("FEAT_PUBLICATION", default=False),
        "FEAT_ISOBUS": is_enabled("FEAT_ISOBUS", default=False),
        "FEAT_SECTION_CONTROL": is_enabled("FEAT_SECTION_CONTROL", default=False),
        "FEAT_MULTI_ORG_RBAC": is_enabled("FEAT_MULTI_ORG_RBAC", default=False),
        "FEAT_FLEET": is_enabled("FEAT_FLEET", default=False),
        "FEAT_PLANT_LAYER": is_enabled("FEAT_PLANT_LAYER", default=False),
    }
