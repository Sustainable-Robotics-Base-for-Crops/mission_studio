"""
Farm working folder persistence (L13, CdC technique §2.4 and §2.7).

Chicken and egg: the root of a farm cannot live inside the farm. It is therefore
resolved from `FARM_ROOT`, then from `backend/data/app.json`. That file is the only
application state outside a farm folder — do not put anything else in it.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

from backend.config.settings import Settings
from backend.farm.layout import (
    FARM_DIR_EXTENSIONS,
    FARM_DIRS,
    default_farm_json,
    ensure_farm,
    is_farm,
    now_iso,
    read_farm_json,
    validate_farm_json,
    write_farm_json,
)
from backend.fields.geometry import polygon_area_m2

APP_STATE_FILE = "app.json"

#: Most recently opened farms, most recent first.
RECENT_LIMIT = 5

#: Fields a client may change through the API. Anything else is server-owned.
WRITABLE_KEYS = (
    "name",
    "farm_type",
    "start_view",
    "language",
    "theme",
    "ui_mode",
    "units",
    "field_geofence_inset_cm",
    "speed_color_low_kmh",
    "speed_color_mid_kmh",
    "speed_color_high_kmh",
)

_EMPTY_APP_STATE: Dict[str, Any] = {"current_root": None, "recent_roots": []}


def default_app_state_path() -> str:
    """Overridable with APP_STATE_PATH so tests never touch the developer's state."""
    raw = (os.getenv("APP_STATE_PATH") or "").strip()
    if raw:
        return raw
    return os.path.join(Settings.DATA_DIR, APP_STATE_FILE)


def _normalise_root(root: str) -> str:
    return os.path.abspath(os.path.expanduser(root.strip()))


class FarmRepository:
    """Reads and writes the current farm, and remembers the recent ones."""

    def __init__(self, app_state_path: Optional[str] = None):
        self._app_state_path = app_state_path

    @property
    def app_state_path(self) -> str:
        return self._app_state_path or default_app_state_path()

    # -- application state (outside any farm) --------------------------------

    def read_app_state(self) -> Dict[str, Any]:
        path = self.app_state_path
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, json.JSONDecodeError):
            return dict(_EMPTY_APP_STATE)
        if not isinstance(data, dict):
            return dict(_EMPTY_APP_STATE)
        current = data.get("current_root")
        recent = data.get("recent_roots")
        return {
            "current_root": current if isinstance(current, str) and current else None,
            "recent_roots": [item for item in recent if isinstance(item, str)]
            if isinstance(recent, list)
            else [],
        }

    def write_app_state(self, state: Dict[str, Any]) -> Dict[str, Any]:
        path = self.app_state_path
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        payload = {
            "current_root": state.get("current_root"),
            "recent_roots": list(state.get("recent_roots") or [])[:RECENT_LIMIT],
        }
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        return payload

    # -- current farm --------------------------------------------------------

    def resolve_root(self) -> Optional[str]:
        """`FARM_ROOT`, then the remembered root, then nothing."""
        env_root = (os.getenv("FARM_ROOT") or "").strip()
        if env_root:
            return _normalise_root(env_root)
        remembered = self.read_app_state().get("current_root")
        return _normalise_root(remembered) if remembered else None

    def recent_roots(self) -> List[str]:
        return self.read_app_state().get("recent_roots") or []

    def _remember_root(self, absolute: str) -> None:
        state = self.read_app_state()
        recent = [item for item in state.get("recent_roots") or [] if item != absolute]
        recent.insert(0, absolute)
        self.write_app_state({"current_root": absolute, "recent_roots": recent})

    def open_farm(self, root: str, name: Optional[str] = None) -> Dict[str, Any]:
        """Legacy operation: initialise if needed, make current, and remember."""
        if not root or not root.strip():
            raise ValueError("farm root must not be empty")

        absolute = _normalise_root(root)
        farm = ensure_farm(absolute, name)
        self._remember_root(absolute)
        return farm

    def open_existing_farm(self, root: str) -> Dict[str, Any]:
        """Open a folder that already contains a valid ``farm.json``."""
        if not root or not root.strip():
            raise ValueError("farm root must not be empty")
        absolute = _normalise_root(root)
        if not is_farm(absolute):
            raise ValueError("this folder is not a farm; create a farm there first")
        farm = read_farm_json(absolute)
        if farm is None:
            raise ValueError("farm.json is unreadable")
        problems = validate_farm_json(farm)
        if problems:
            raise ValueError("; ".join(problems))
        self._remember_root(absolute)
        return farm

    def create_farm(self, root: str, name: Optional[str] = None) -> Dict[str, Any]:
        """Create a new farm only in a new or empty directory."""
        if not root or not root.strip():
            raise ValueError("farm root must not be empty")
        absolute = _normalise_root(root)
        if is_farm(absolute):
            raise ValueError("this folder already contains a farm")
        if os.path.exists(absolute):
            if not os.path.isdir(absolute):
                raise ValueError("farm root must be a directory")
            if os.listdir(absolute):
                raise ValueError("a new farm must be created in an empty folder")
        farm = ensure_farm(absolute, name)
        self._remember_root(absolute)
        return farm

    def read_farm(self) -> Optional[Dict[str, Any]]:
        root = self.resolve_root()
        if not root or not is_farm(root):
            return None
        return read_farm_json(root)

    def write_farm(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        """
        Merge a client patch into `farm.json`.

        `schema`, `created_at` and `updated_at` are server-owned: a client cannot
        backdate a farm or claim another schema.
        """
        root = self.resolve_root()
        if not root:
            raise ValueError("no farm is open; open one before saving its settings")
        if not isinstance(patch, dict):
            raise ValueError("payload must be a JSON object")

        current = read_farm_json(root) or default_farm_json()
        merged = dict(current)

        for key in WRITABLE_KEYS:
            if key not in patch:
                continue
            if key == "start_view" and isinstance(patch[key], dict):
                view = dict(current.get("start_view") or {})
                view.update(patch[key])
                merged[key] = view
            else:
                merged[key] = patch[key]

        merged["schema"] = current.get("schema") or default_farm_json()["schema"]
        merged["created_at"] = current.get("created_at") or now_iso()
        merged["updated_at"] = now_iso()

        problems = validate_farm_json(merged)
        if problems:
            raise ValueError("; ".join(problems))
        return write_farm_json(root, merged)

    # -- counters ------------------------------------------------------------

    def counts(self) -> Dict[str, Any]:
        """
        Figures for the home dashboard.

        `hectares` is None when no field carries a usable polygon: the dashboard must
        show a dash and its reason, never a misleading zero.
        """
        empty: Dict[str, Any] = {
            "fields": 0,
            "missions": 0,
            "work_performed": 0,
            "equipment": 0,
            "hectares": None,
        }
        root = self.resolve_root()
        if not root or not is_farm(root):
            return empty

        result = dict(empty)
        for folder in FARM_DIRS:
            extensions = FARM_DIR_EXTENSIONS[folder]
            path = os.path.join(root, folder)
            try:
                names = [name for name in os.listdir(path) if name.lower().endswith(extensions)]
            except OSError:
                names = []
            key = {"parcel_map": "fields", "mission_order": "missions"}.get(folder, folder)
            result[key] = len(names)

        result["hectares"] = self._hectares(os.path.join(root, "parcel_map"))
        return result

    @staticmethod
    def _hectares(parcel_map_dir: str) -> Optional[float]:
        try:
            names = sorted(os.listdir(parcel_map_dir))
        except OSError:
            return None

        total_m2 = 0.0
        measured = False
        for name in names:
            if not name.lower().endswith(".geojson"):
                continue
            try:
                with open(os.path.join(parcel_map_dir, name), "r", encoding="utf-8") as handle:
                    document = json.load(handle)
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(document, dict):
                continue
            for feature in document.get("features") or []:
                if not isinstance(feature, dict):
                    continue
                properties = feature.get("properties") or {}
                if not isinstance(properties, dict) or properties.get("kind") != "field":
                    continue
                area = polygon_area_m2(feature.get("geometry"))
                if area:
                    total_m2 += area
                    measured = True

        if not measured:
            return None
        return round(total_m2 / 10_000.0, 2)
