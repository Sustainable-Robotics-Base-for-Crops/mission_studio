"""
Shape of a farm working folder (L13, CdC technique §2).

The folder is the source of truth and is meant to be byte-identical on the robot:
changing folder changes farm. Sub-folder names follow the Agri `file_type` values so
the robot finds them without translation.

    <FARM_ROOT>/
        farm.json          identity and preferences
        parcel_map/        one GeoJSON FeatureCollection per field
        mission_order/     Agri v3 mission orders, flat
        work_performed/    Agri v3 robot logs
        equipment/         srbc.equipment/1 files (+ optional PNG)
        .studio/           derived, regenerable, ignored by the robot

Nothing outside these entries is ever read.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

FARM_SCHEMA = "srbc.farm/1"
FARM_FILE = "farm.json"

#: Primary data folders, created up front so no code has to handle a missing one.
FARM_DIRS = ("parcel_map", "mission_order", "work_performed", "equipment")

#: Derived state. Deleting it and restarting must rebuild an identical state.
STUDIO_DIR = ".studio"
INDEX_FILE = "index.sqlite"
CACHE_DIR = "cache"

FARM_TYPES = ("market_garden", "vineyard", "open_field", "livestock", "mixed")

#: Farm type drives the crop pack offered by default to new missions.
CROP_PACK_BY_FARM_TYPE = {
    "market_garden": "market_garden",
    "vineyard": "vineyard",
    "open_field": "open_field",
    "livestock": "open_field",
    "mixed": "open_field",
}

#: Kept in sync with SUPPORTED_LANGUAGES in frontend/src/i18n/adapter.ts.
LANGUAGES = ("fr", "en", "it", "es", "pl", "nl", "de")
THEMES = ("light", "dark")
UI_MODES = ("basic", "advanced")
UNITS = ("metric",)

DEFAULT_FARM_NAME = "Ma ferme"
DEFAULT_FARM_TYPE = "market_garden"
DEFAULT_LANGUAGE = "fr"
DEFAULT_THEME = "light"
DEFAULT_UI_MODE = "basic"
DEFAULT_UNITS = "metric"
DEFAULT_FIELD_GEOFENCE_INSET_CM = 25
DEFAULT_SPEED_COLOR_LOW_KMH = 0.5
DEFAULT_SPEED_COLOR_MID_KMH = 1.75
DEFAULT_SPEED_COLOR_HIGH_KMH = 3.0

#: Mirrors DEFAULT_CENTER / DEFAULT_ZOOM of frontend/src/map/styles.ts (metropolitan France).
DEFAULT_START_VIEW = {"lat": 46.6034, "lon": 1.8883, "zoom": 6}

#: File extension expected in each folder, used by the index and the tree listing.
FARM_DIR_EXTENSIONS = {
    "parcel_map": (".geojson",),
    "mission_order": (".json",),
    "work_performed": (".json",),
    "equipment": (".json",),
}


def now_iso() -> str:
    """UTC timestamp, second precision, `Z` suffix."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def crop_pack_for(farm_type: str) -> str:
    return CROP_PACK_BY_FARM_TYPE.get(farm_type, "open_field")


def default_farm_json(name: Optional[str] = None) -> Dict[str, Any]:
    """A valid `farm.json` for a brand new farm."""
    stamp = now_iso()
    label = (name or "").strip() or DEFAULT_FARM_NAME
    return {
        "schema": FARM_SCHEMA,
        "name": label,
        "farm_type": DEFAULT_FARM_TYPE,
        "start_view": dict(DEFAULT_START_VIEW),
        "language": DEFAULT_LANGUAGE,
        "theme": DEFAULT_THEME,
        "ui_mode": DEFAULT_UI_MODE,
        "units": DEFAULT_UNITS,
        "field_geofence_inset_cm": DEFAULT_FIELD_GEOFENCE_INSET_CM,
        "speed_color_low_kmh": DEFAULT_SPEED_COLOR_LOW_KMH,
        "speed_color_mid_kmh": DEFAULT_SPEED_COLOR_MID_KMH,
        "speed_color_high_kmh": DEFAULT_SPEED_COLOR_HIGH_KMH,
        "created_at": stamp,
        "updated_at": stamp,
    }


def _check_start_view(raw: Any, problems: List[str]) -> None:
    if not isinstance(raw, dict):
        problems.append("start_view must be an object with lat, lon and zoom")
        return
    for key, low, high in (("lat", -90.0, 90.0), ("lon", -180.0, 180.0), ("zoom", 0.0, 24.0)):
        value = raw.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            problems.append(f"start_view.{key} must be a number")
            continue
        if not low <= float(value) <= high:
            problems.append(f"start_view.{key} must be between {low} and {high}")


def validate_farm_json(data: Any) -> List[str]:
    """
    Return the list of problems, empty when the document is valid.

    Messages say what to fix: they are surfaced to the user by the API.
    """
    problems: List[str] = []
    if not isinstance(data, dict):
        return ["farm.json must be a JSON object"]

    if data.get("schema") != FARM_SCHEMA:
        problems.append(f"schema must be {FARM_SCHEMA!r}")

    name = data.get("name")
    if not isinstance(name, str) or not name.strip():
        problems.append("name must be a non-empty string")

    for key, allowed in (
        ("farm_type", FARM_TYPES),
        ("language", LANGUAGES),
        ("theme", THEMES),
        ("ui_mode", UI_MODES),
        ("units", UNITS),
    ):
        value = data.get(key)
        if value not in allowed:
            problems.append(f"{key} must be one of {', '.join(allowed)}")

    _check_start_view(data.get("start_view"), problems)
    inset = data.get("field_geofence_inset_cm")
    # Optional for farm folders created before this preference existed.
    if inset is not None:
        if isinstance(inset, bool) or not isinstance(inset, (int, float)):
            problems.append("field_geofence_inset_cm must be a number")
        elif float(inset) < 0:
            problems.append("field_geofence_inset_cm must be greater than or equal to 0")
    for key in ("speed_color_low_kmh", "speed_color_mid_kmh", "speed_color_high_kmh"):
        value = data.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            problems.append(f"{key} must be a number")
        elif float(value) < 0:
            problems.append(f"{key} must be greater than or equal to 0")
    low = data.get("speed_color_low_kmh")
    mid = data.get("speed_color_mid_kmh")
    high = data.get("speed_color_high_kmh")
    if (
        isinstance(low, (int, float))
        and not isinstance(low, bool)
        and isinstance(mid, (int, float))
        and not isinstance(mid, bool)
        and isinstance(high, (int, float))
        and not isinstance(high, bool)
        and not (float(low) <= float(mid) <= float(high))
    ):
        problems.append("speed colour thresholds must satisfy low ≤ mid ≤ high")
    return problems


def farm_file_path(root: str) -> str:
    return os.path.join(root, FARM_FILE)


def studio_dir(root: str) -> str:
    return os.path.join(root, STUDIO_DIR)


def index_path(root: str) -> str:
    return os.path.join(studio_dir(root), INDEX_FILE)


def is_farm(root: Optional[str]) -> bool:
    """A folder without `farm.json` is not a farm and must never be used as one."""
    if not root:
        return False
    return os.path.isfile(farm_file_path(root))


def read_farm_json(root: str) -> Optional[Dict[str, Any]]:
    """Parsed `farm.json`, or None when absent or unreadable."""
    path = farm_file_path(root)
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def write_farm_json(root: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Write `farm.json` after validation. Raises ValueError listing the problems."""
    problems = validate_farm_json(data)
    if problems:
        raise ValueError("; ".join(problems))
    os.makedirs(root, exist_ok=True)
    with open(farm_file_path(root), "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return data


def ensure_farm(root: str, name: Optional[str] = None) -> Dict[str, Any]:
    """
    Create the folders and `farm.json` when missing, then return the farm document.

    Idempotent: an existing `farm.json` is never overwritten, even with a different
    `name`. Renaming a farm goes through the repository, not through initialisation.
    """
    if not root or not root.strip():
        raise ValueError("farm root must not be empty")

    os.makedirs(root, exist_ok=True)
    for folder in FARM_DIRS:
        os.makedirs(os.path.join(root, folder), exist_ok=True)
    os.makedirs(os.path.join(studio_dir(root), CACHE_DIR), exist_ok=True)

    existing = read_farm_json(root) if is_farm(root) else None
    if existing is not None:
        return existing

    return write_farm_json(root, default_farm_json(name))


def safe_farm_path(root: str, relative: str) -> str:
    """
    Resolve `relative` inside `root`.

    Raises ValueError when the result would escape the farm, whether through `..`,
    an absolute path, or a symlink pointing outside.
    """
    if not isinstance(relative, str) or not relative.strip():
        raise ValueError("path must not be empty")
    if relative.startswith("~"):
        raise ValueError("path must not start with '~'")
    if os.path.isabs(relative) or os.path.splitdrive(relative)[0]:
        raise ValueError("path must be relative to the farm folder")

    normalised = relative.replace("\\", "/")
    if any(part == ".." for part in normalised.split("/")):
        raise ValueError("path must not contain '..'")

    candidate = os.path.normpath(os.path.join(root, normalised))

    # Defence in depth: catches symlinked parents that the textual checks cannot see.
    real_root = os.path.realpath(root)
    real_candidate = os.path.realpath(candidate)
    if real_candidate != real_root and not real_candidate.startswith(real_root + os.sep):
        raise ValueError("path must stay inside the farm folder")

    return candidate
