"""SQLite connection, lock, and schema migrations for L5."""

from __future__ import annotations

import os
import sqlite3
import threading
from datetime import UTC, datetime

SCHEMA_VERSION = 5

_MIGRATION_1 = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    result TEXT,
    error TEXT,
    progress REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS fields (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    campaign TEXT,
    geometry TEXT NOT NULL,
    crs TEXT NOT NULL DEFAULT 'EPSG:4326',
    provenance TEXT NOT NULL DEFAULT '{}',
    qualified_for_autonomy INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY,
    field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    name TEXT,
    geometry TEXT NOT NULL,
    provenance TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS obstacles (
    id TEXT PRIMARY KEY,
    field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    category TEXT NOT NULL DEFAULT 'unspecified',
    name TEXT,
    geometry TEXT NOT NULL,
    margin_m REAL NOT NULL DEFAULT 0,
    height_m REAL,
    valid_from TEXT,
    valid_until TEXT,
    crossable INTEGER NOT NULL DEFAULT 0,
    provenance TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guidance_lines (
    id TEXT PRIMARY KEY,
    field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    name TEXT,
    geometry TEXT NOT NULL,
    provenance TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS field_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    geometry_hash TEXT NOT NULL,
    area_m2 REAL,
    created_at TEXT NOT NULL,
    author TEXT,
    UNIQUE (field_id, version)
);

CREATE TABLE IF NOT EXISTS field_mission_links (
    field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    mission_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'current',
    PRIMARY KEY (field_id, mission_path)
);
"""

_MIGRATION_2 = """
CREATE TABLE IF NOT EXISTS row_sets (
    id TEXT PRIMARY KEY,
    field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    name TEXT,
    kind TEXT NOT NULL DEFAULT 'rows',
    spacing_m REAL NOT NULL,
    width_m REAL,
    preferred_direction TEXT,
    axis_line_id TEXT REFERENCES guidance_lines(id) ON DELETE SET NULL,
    geometry TEXT,
    provenance TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rows (
    id TEXT PRIMARY KEY,
    row_set_id TEXT NOT NULL REFERENCES row_sets(id) ON DELETE CASCADE,
    field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    name TEXT,
    geometry TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    UNIQUE (row_set_id, number)
);
"""

_MIGRATION_3 = """
CREATE TABLE IF NOT EXISTS traffic_ways (
    id TEXT PRIMARY KEY,
    field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    name TEXT,
    kind TEXT NOT NULL DEFAULT 'path',
    oneway INTEGER NOT NULL DEFAULT 0,
    speed_mps REAL,
    geometry TEXT NOT NULL,
    provenance TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS traffic_nodes (
    id TEXT PRIMARY KEY,
    field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    name TEXT,
    kind TEXT NOT NULL DEFAULT 'gate',
    geometry TEXT NOT NULL,
    provenance TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
"""

_MIGRATION_4 = """
CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kinematics TEXT NOT NULL DEFAULT 'skid_steer',
    length_m REAL NOT NULL,
    width_m REAL NOT NULL,
    height_m REAL,
    wheelbase_m REAL,
    track_width_m REAL,
    front_overhang_m REAL,
    rear_overhang_m REAL,
    mass_kg REAL,
    max_speed_mps REAL,
    min_turn_radius_m REAL,
    can_reverse INTEGER NOT NULL DEFAULT 1,
    nav_ref_x_m REAL NOT NULL DEFAULT 0,
    nav_ref_y_m REAL NOT NULL DEFAULT 0,
    hitch_x_m REAL,
    hitch_y_m REAL NOT NULL DEFAULT 0,
    ground_clearance_m REAL,
    sources TEXT NOT NULL DEFAULT '{}',
    origin TEXT NOT NULL DEFAULT 'local',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS implements (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'tool',
    physical_width_m REAL NOT NULL,
    working_width_m REAL NOT NULL,
    length_m REAL NOT NULL DEFAULT 0,
    offset_x_m REAL NOT NULL DEFAULT 0,
    offset_y_m REAL NOT NULL DEFAULT 0,
    work_point_x_m REAL NOT NULL DEFAULT 0,
    work_point_y_m REAL NOT NULL DEFAULT 0,
    sections INTEGER,
    sources TEXT NOT NULL DEFAULT '{}',
    origin TEXT NOT NULL DEFAULT 'local',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS combinations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    implement_id TEXT REFERENCES implements(id),
    origin TEXT NOT NULL DEFAULT 'local',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


class Database:
    def __init__(self, path: str):
        directory = os.path.dirname(os.path.abspath(path))
        if directory:
            os.makedirs(directory, exist_ok=True)
        self.path = path
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self.migrate()

    def migrate(self) -> None:
        with self._lock:
            self._conn.executescript(_MIGRATION_1)
            self._conn.executescript(_MIGRATION_2)
            self._conn.executescript(_MIGRATION_3)
            self._conn.executescript(_MIGRATION_4)
            columns = {
                row[1]
                for row in self._conn.execute("PRAGMA table_info(implements)").fetchall()
            }
            if "drawbar_length_m" not in columns:
                self._conn.execute(
                    "ALTER TABLE implements ADD COLUMN drawbar_length_m REAL"
                )
            row = self._conn.execute(
                "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
            ).fetchone()
            if row is None or int(row["version"]) < SCHEMA_VERSION:
                self._conn.execute(
                    "INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                    (SCHEMA_VERSION, utc_now()),
                )
            self._conn.commit()

    def execute(self, sql: str, params: tuple | list = ()):
        with self._lock:
            cursor = self._conn.execute(sql, params)
            self._conn.commit()
            return cursor

    def executescript(self, sql: str) -> None:
        with self._lock:
            self._conn.executescript(sql)
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()
