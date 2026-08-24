"""
Listing of a farm folder, for the file explorers of the studio (L13, CdC §2.8).

A corrupted file never breaks a listing: it comes back with its file metadata only,
so the user sees it exists and can go fix it.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

from backend.farm.layout import FARM_DIR_EXTENSIONS, FARM_DIRS

#: Folders whose files are Agri documents worth reading for context.
AGRI_DIRS = ("mission_order", "work_performed")


def _read_json(path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _mission_context(document: Dict[str, Any]) -> Dict[str, Any]:
    """`field_id`, `operation` and simulation state, read from the Agri metadata."""
    metadata = document.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    brief = metadata.get("srbc_mission_brief")
    brief = brief if isinstance(brief, dict) else {}

    field_id = brief.get("field_id")
    field_name = brief.get("field_name")
    display_name = brief.get("name")
    operation = brief.get("operation")
    campaign = brief.get("campaign")
    return {
        "field_id": field_id if isinstance(field_id, str) and field_id else None,
        "field_name": field_name if isinstance(field_name, str) and field_name else None,
        "display_name": display_name if isinstance(display_name, str) and display_name else None,
        "operation": operation if isinstance(operation, str) and operation else None,
        "campaign": campaign if isinstance(campaign, str) and campaign else None,
        "simulated": bool(metadata.get("srbc_simulation")),
        "published": bool(metadata.get("srbc_publication")),
    }


def _unreadable_context() -> Dict[str, Any]:
    return {
        "field_id": None,
        "field_name": None,
        "display_name": None,
        "operation": None,
        "campaign": None,
        "simulated": False,
        "published": False,
        "unreadable": True,
    }


def list_kind(root: str, kind: str) -> List[Dict[str, Any]]:
    """Entries of one farm folder, newest first."""
    if kind not in FARM_DIRS:
        raise ValueError(f"unknown folder {kind!r}; expected one of {', '.join(FARM_DIRS)}")

    folder = os.path.join(root, kind)
    extensions = FARM_DIR_EXTENSIONS[kind]
    try:
        names = os.listdir(folder)
    except OSError:
        return []

    entries: List[Dict[str, Any]] = []
    for name in names:
        if not name.lower().endswith(extensions):
            continue
        full_path = os.path.join(folder, name)
        if not os.path.isfile(full_path):
            continue
        try:
            stat = os.stat(full_path)
        except OSError:
            continue

        entry: Dict[str, Any] = {
            "name": name,
            "path": f"{kind}/{name}",
            "size": stat.st_size,
            "modified": stat.st_mtime * 1000,
        }
        if kind in AGRI_DIRS:
            document = _read_json(full_path)
            entry.update(_unreadable_context() if document is None else _mission_context(document))
        entries.append(entry)

    entries.sort(key=lambda item: (-item["modified"], item["name"]))
    return entries


def list_tree(root: str, kind: Optional[str] = None) -> Dict[str, List[Dict[str, Any]]]:
    """All four folders, or a single one when `kind` is given."""
    kinds = (kind,) if kind else FARM_DIRS
    return {name: list_kind(root, name) for name in kinds}
