"""
Derived index of a farm folder (L13, decision D13-01).

The files are the truth. This index only makes them fast to query — deleting
``.studio/`` and reindexing must rebuild an identical state. It is a database of its
own, stored inside the farm; it has nothing to do with ``backend/data/studio.sqlite``
(schema 7), which keeps the studio's own catalogue.
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
from typing import Any, Dict, List, Optional

from backend.farm.layout import CACHE_DIR, FARM_DIRS, index_path, studio_dir
from backend.farm.tree import AGRI_DIRS, list_kind

INDEX_SCHEMA_VERSION = 1

_SCHEMA = """
CREATE TABLE IF NOT EXISTS index_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS farm_files (
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified REAL NOT NULL,
    checksum TEXT,
    PRIMARY KEY (kind, path)
);

CREATE TABLE IF NOT EXISTS farm_missions (
    path TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    field_id TEXT,
    operation TEXT,
    campaign TEXT,
    modified REAL NOT NULL,
    simulated INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_farm_missions_field ON farm_missions(field_id);
"""


def open_index(root: str) -> sqlite3.Connection:
    """Open ``.studio/index.sqlite``, creating the folder and schema when needed."""
    os.makedirs(os.path.join(studio_dir(root), CACHE_DIR), exist_ok=True)
    connection = sqlite3.connect(index_path(root))
    connection.row_factory = sqlite3.Row
    connection.executescript(_SCHEMA)
    connection.execute(
        "INSERT OR REPLACE INTO index_meta (key, value) VALUES ('schema_version', ?)",
        (str(INDEX_SCHEMA_VERSION),),
    )
    connection.commit()
    return connection


def _checksum(path: str) -> Optional[str]:
    try:
        with open(path, "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest()
    except OSError:
        return None


def reindex(root: str) -> Dict[str, Any]:
    """
    Rebuild the index from scratch. Returns per-folder counters plus ``errors``.

    A corrupted file is counted as an error and still indexed by its file metadata:
    an unreadable mission must stay visible so the user can go fix it.
    """
    connection = open_index(root)
    counts: Dict[str, int] = {}
    errors = 0
    try:
        connection.execute("DELETE FROM farm_files")
        connection.execute("DELETE FROM farm_missions")

        for kind in FARM_DIRS:
            entries: List[Dict[str, Any]] = list_kind(root, kind)
            counts[kind] = len(entries)
            for entry in entries:
                full_path = os.path.join(root, entry["path"])
                connection.execute(
                    "INSERT OR REPLACE INTO farm_files"
                    " (kind, path, name, size, modified, checksum)"
                    " VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        kind,
                        entry["path"],
                        entry["name"],
                        entry["size"],
                        entry["modified"],
                        _checksum(full_path),
                    ),
                )
                if kind not in AGRI_DIRS:
                    continue
                if entry.get("unreadable"):
                    errors += 1
                connection.execute(
                    "INSERT OR REPLACE INTO farm_missions"
                    " (path, kind, name, field_id, operation, campaign, modified,"
                    "  simulated, published)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        entry["path"],
                        kind,
                        entry["name"],
                        entry.get("field_id"),
                        entry.get("operation"),
                        entry.get("campaign"),
                        entry["modified"],
                        1 if entry.get("simulated") else 0,
                        1 if entry.get("published") else 0,
                    ),
                )
        connection.commit()
    finally:
        connection.close()

    return {"schemaVersion": INDEX_SCHEMA_VERSION, "counts": counts, "errors": errors}


def missions_for_field(root: str, field_id: str) -> List[Dict[str, Any]]:
    """
    Missions and performed work attached to a field, newest first.

    Reads the index when it is fresh, and falls back on the files otherwise, so the
    answer never depends on someone having reindexed first.
    """
    if not field_id:
        return []

    if os.path.isfile(index_path(root)):
        connection = open_index(root)
        try:
            rows = connection.execute(
                "SELECT path, kind, name, field_id, operation, campaign, modified,"
                " simulated, published FROM farm_missions WHERE field_id = ?"
                " ORDER BY modified DESC, name ASC",
                (field_id,),
            ).fetchall()
        finally:
            connection.close()
        if rows:
            return [
                {
                    "path": row["path"],
                    "kind": row["kind"],
                    "name": row["name"],
                    "field_id": row["field_id"],
                    "operation": row["operation"],
                    "campaign": row["campaign"],
                    "modified": row["modified"],
                    "simulated": bool(row["simulated"]),
                    "published": bool(row["published"]),
                }
                for row in rows
            ]

    matches: List[Dict[str, Any]] = []
    for kind in AGRI_DIRS:
        for entry in list_kind(root, kind):
            if entry.get("field_id") == field_id:
                matches.append({**entry, "kind": kind})
    matches.sort(key=lambda item: (-item["modified"], item["name"]))
    return matches
