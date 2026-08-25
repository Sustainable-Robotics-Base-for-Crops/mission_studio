"""
Write-through of the field catalogue into ``parcel_map/`` (D13-01).

The GeoJSON files of the current farm are the truth. SQLite is a cache of that
farm only: opening, creating or reindexing a farm wipes the cache and rebuilds
it from the files. Mutations then write the file back.

No farm open → persist is a no-op, so catalogue unit tests stay file-free.
"""

from __future__ import annotations

import json
import logging
import os
import re
import unicodedata
from typing import Any

from backend.farm.layout import is_farm
from backend.fields.geojson import export_geojson, import_geojson
from backend.fields.repository import FieldRepository

logger = logging.getLogger("trajectory_editor")

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify_field_name(name: str) -> str:
    folded = unicodedata.normalize("NFD", name or "")
    folded = "".join(char for char in folded if unicodedata.category(char) != "Mn")
    slug = _SLUG_RE.sub("-", folded.lower()).strip("-")
    return (slug or "parcelle")[:40]


def parcel_map_dir(root: str) -> str:
    return os.path.join(root, "parcel_map")


def field_filename(field: dict[str, Any]) -> str:
    field_id = str(field.get("id") or "field")
    return f"{slugify_field_name(str(field.get('name') or ''))}-{field_id}.geojson"


def _feature_field_id(document: dict[str, Any]) -> str | None:
    features: list[Any]
    if document.get("type") == "Feature":
        features = [document]
    else:
        raw = document.get("features")
        features = raw if isinstance(raw, list) else []
    for feature in features:
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties") or {}
        if not isinstance(properties, dict):
            continue
        kind = properties.get("srbc_kind") or properties.get("kind")
        if kind != "field":
            continue
        raw_id = properties.get("id")
        if isinstance(raw_id, str) and raw_id.strip():
            return raw_id.strip()
    return None


def _read_json(path: str) -> dict[str, Any] | None:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def list_parcel_files(root: str) -> list[str]:
    folder = parcel_map_dir(root)
    try:
        names = os.listdir(folder)
    except OSError:
        return []
    paths = [
        os.path.join(folder, name)
        for name in names
        if name.lower().endswith(".geojson") and os.path.isfile(os.path.join(folder, name))
    ]
    paths.sort()
    return paths


def remove_field_file(root: str, field_id: str) -> None:
    for path in list_parcel_files(root):
        document = _read_json(path)
        matches_id = document is not None and _feature_field_id(document) == field_id
        matches_name = os.path.splitext(os.path.basename(path))[0] == field_id
        if not matches_id and not matches_name:
            continue
        try:
            os.remove(path)
        except OSError:
            logger.exception("could not remove field file %s", path)


def write_field_file(root: str, field: dict[str, Any]) -> str:
    if not field.get("id"):
        raise ValueError("field must have an id")
    folder = parcel_map_dir(root)
    os.makedirs(folder, exist_ok=True)
    field_id = str(field["id"])
    dest = os.path.join(folder, field_filename(field))
    for path in list_parcel_files(root):
        if os.path.abspath(path) == os.path.abspath(dest):
            continue
        document = _read_json(path)
        if document is not None and _feature_field_id(document) == field_id:
            try:
                os.remove(path)
            except OSError:
                logger.exception("could not remove stale field file %s", path)
    payload = export_geojson(field)
    with open(dest, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return dest


def rebuild_fields_from_parcel_map(repository: FieldRepository, root: str) -> dict[str, Any]:
    """Replace the SQLite catalogue with the GeoJSON files of this farm."""
    imported = 0
    errors: list[dict[str, Any]] = []
    was_enabled = repository.persist_enabled
    repository.persist_enabled = False
    try:
        repository.clear_fields()
        for path in list_parcel_files(root):
            document = _read_json(path)
            if document is None:
                errors.append({"path": os.path.basename(path), "reason": "unreadable"})
                continue
            try:
                report = import_geojson(repository, document)
            except (ValueError, KeyError, TypeError) as exc:
                errors.append({"path": os.path.basename(path), "reason": str(exc)})
                continue
            if not report.get("ok"):
                errors.append({"path": os.path.basename(path), "reason": report.get("errors")})
                continue
            imported += 1
    finally:
        repository.persist_enabled = was_enabled
    return {"imported": imported, "errors": errors}


def sync_farm_catalogue(runtime: Any) -> dict[str, Any] | None:
    """Wipe and rebuild the cache when a farm is open. No-op otherwise."""
    fields = getattr(runtime, "fields", None)
    farm = getattr(runtime, "farm", None)
    if fields is None or farm is None:
        return None
    root = farm.resolve_root()
    if not root or not is_farm(root):
        return None
    return rebuild_fields_from_parcel_map(fields, root)


def bind_farm_catalogue(runtime: Any) -> None:
    """Attach write-through and rebuild from the current farm (if any)."""
    fields = getattr(runtime, "fields", None)
    if fields is None:
        return

    def persist(field_id: str | None, *, deleted: bool = False) -> None:
        farm = getattr(runtime, "farm", None)
        root = farm.resolve_root() if farm is not None else None
        if not root or not is_farm(root):
            return
        if deleted and field_id:
            remove_field_file(root, field_id)
            return
        if not field_id:
            return
        field = fields.get_field(field_id)
        if field:
            write_field_file(root, field)

    fields.on_persist = persist
    sync_farm_catalogue(runtime)
