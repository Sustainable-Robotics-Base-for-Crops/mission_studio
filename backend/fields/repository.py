"""Field / zone / obstacle / guidance-line / row-set repository with versions and impact."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from typing import Any

from backend.db import Database, utc_now
from backend.fields.geometry import geometry_hash, polygon_area_m2, provenance_qualified
from backend.fields.types import (
    TRAFFIC_NODE_KINDS,
    TRAFFIC_WAY_KINDS,
    ZONE_KINDS,
    canonical_traffic_node_kind,
    canonical_zone_kind,
)


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _load(raw: str | None, default: Any):
    if not raw:
        return default
    return json.loads(raw)


def _as_linestring(geometry: Any) -> dict[str, Any]:
    if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
        raise ValueError("geometry must be a LineString")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        raise ValueError("LineString needs at least 2 vertices")
    return geometry


def _positive_width(raw: Any) -> float | None:
    """A width is optional; when given it must be a strictly positive number of metres."""
    if raw is None or raw == "":
        return None
    value = float(raw)
    if value <= 0:
        raise ValueError("width_m must be greater than 0")
    return value


def _as_point(geometry: Any) -> dict[str, Any]:
    if not isinstance(geometry, dict) or geometry.get("type") != "Point":
        raise ValueError("geometry must be a Point")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        raise ValueError("Point needs [lng, lat]")
    return geometry


def _as_row_geometry(geometry: Any) -> dict[str, Any]:
    if not isinstance(geometry, dict):
        raise ValueError("geometry must be a LineString or Polygon")
    kind = geometry.get("type")
    if kind == "LineString":
        return _as_linestring(geometry)
    if kind == "Polygon":
        coordinates = geometry.get("coordinates")
        if not isinstance(coordinates, list) or not coordinates:
            raise ValueError("Polygon needs a ring")
        ring = coordinates[0]
        if not isinstance(ring, list) or len(ring) < 4:
            raise ValueError("Polygon ring needs at least 4 positions")
        return geometry
    raise ValueError("geometry must be a LineString or Polygon")


def _field_row(row: Any, extras: dict[str, Any] | None = None) -> dict[str, Any]:
    data = {
        "id": row["id"],
        "name": row["name"],
        "campaign": row["campaign"],
        "geometry": _load(row["geometry"], {}),
        "crs": row["crs"],
        "provenance": _load(row["provenance"], {}),
        "qualified_for_autonomy": bool(row["qualified_for_autonomy"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    if extras:
        data.update(extras)
    return data


def _safe_field_id(raw: str | None) -> str:
    """Keep a caller-supplied id when it is a safe token; otherwise mint a UUID."""
    if raw is None:
        return uuid.uuid4().hex
    value = str(raw).strip()
    if not value or len(value) > 80:
        return uuid.uuid4().hex
    if "/" in value or "\\" in value or ".." in value:
        return uuid.uuid4().hex
    if not all(char.isalnum() or char in "-_" for char in value):
        return uuid.uuid4().hex
    return value


class FieldRepository:
    def __init__(self, database: Database):
        self.db = database
        #: Optional write-through to the farm folder. Tests leave this unset.
        self.on_persist: Callable[..., None] | None = None
        self.persist_enabled = True

    def list_fields(self) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT * FROM fields ORDER BY name").fetchall()
        return [_field_row(row) for row in rows]

    def get_field(self, field_id: str, with_children: bool = True) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM fields WHERE id = ?", (field_id,)).fetchone()
        if row is None:
            return None
        field = _field_row(row)
        if with_children:
            field["zones"] = self.list_zones(field_id)
            field["obstacles"] = self.list_obstacles(field_id)
            field["guidance_lines"] = self.list_guidance_lines(field_id)
            field["row_sets"] = self.list_row_sets(field_id)
            field["traffic_ways"] = self.list_traffic_ways(field_id)
            field["traffic_nodes"] = self.list_traffic_nodes(field_id)
            field["landmarks"] = self.list_landmarks(field_id)
            field["version"] = self.latest_version_number(field_id)
        return field

    def create_field(
        self,
        name: str,
        geometry: dict[str, Any],
        campaign: str | None = None,
        provenance: dict[str, Any] | None = None,
        crs: str = "EPSG:4326",
        author: str | None = None,
        field_id: str | None = None,
    ) -> dict[str, Any]:
        field_id = _safe_field_id(field_id)
        now = utc_now()
        provenance = provenance or {}
        self.db.execute(
            """
            INSERT INTO fields (
                id, name, campaign, geometry, crs, provenance, qualified_for_autonomy,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                field_id,
                name,
                campaign,
                _dump(geometry),
                crs,
                _dump(provenance),
                1 if provenance_qualified(provenance) else 0,
                now,
                now,
            ),
        )
        self._snapshot(field_id, author=author)
        return self.get_field(field_id)  # type: ignore[return-value]

    def update_field(
        self, field_id: str, patch: dict[str, Any], author: str | None = None
    ) -> dict[str, Any] | None:
        current = self.get_field(field_id, with_children=False)
        if current is None:
            return None
        name = patch.get("name", current["name"])
        campaign = patch.get("campaign", current["campaign"])
        geometry = patch.get("geometry", current["geometry"])
        provenance = patch.get("provenance", current["provenance"])
        self.db.execute(
            """
            UPDATE fields SET name = ?, campaign = ?, geometry = ?, provenance = ?,
                qualified_for_autonomy = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                name,
                campaign,
                _dump(geometry),
                _dump(provenance),
                1 if provenance_qualified(provenance) else 0,
                utc_now(),
                field_id,
            ),
        )
        self._snapshot(field_id, author=author)
        self.invalidate_missions(field_id)
        return self.get_field(field_id)

    def delete_field(self, field_id: str) -> bool:
        cursor = self.db.execute("DELETE FROM fields WHERE id = ?", (field_id,))
        deleted = cursor.rowcount > 0
        if deleted:
            self._emit_persist(field_id, deleted=True)
        return deleted

    def clear_fields(self) -> int:
        """Drop every field. Children follow via ON DELETE CASCADE. No persist."""
        count_row = self.db.execute("SELECT COUNT(*) AS n FROM fields").fetchone()
        count = int(count_row["n"] if count_row is not None else 0)
        self.db.execute("DELETE FROM fields")
        return count

    def list_zones(self, field_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT * FROM zones WHERE field_id = ? ORDER BY created_at", (field_id,)
        ).fetchall()
        return [self._zone_row(row) for row in rows]

    def add_zone(
        self,
        field_id: str,
        kind: str,
        geometry: dict[str, Any],
        name: str | None = None,
        provenance: dict[str, Any] | None = None,
        author: str | None = None,
    ) -> dict[str, Any]:
        kind = canonical_zone_kind(kind)
        if kind not in ZONE_KINDS:
            raise ValueError(f"unknown zone kind: {kind}")
        if self.get_field(field_id, with_children=False) is None:
            raise KeyError(field_id)
        zone_id = uuid.uuid4().hex
        provenance = provenance or {}
        self.db.execute(
            """
            INSERT INTO zones (id, field_id, kind, name, geometry, provenance, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (zone_id, field_id, kind, name, _dump(geometry), _dump(provenance), utc_now()),
        )
        self._touch_field(field_id, author=author)
        return self._get_zone(zone_id)

    def update_zone(
        self,
        field_id: str,
        zone_id: str,
        patch: dict[str, Any],
        author: str | None = None,
    ) -> dict[str, Any] | None:
        current = self._find_zone(zone_id)
        if current is None or current["field_id"] != field_id:
            return None
        kind = canonical_zone_kind(str(patch.get("kind", current["kind"])))
        if kind not in ZONE_KINDS:
            raise ValueError(f"unknown zone kind: {kind}")
        name = patch.get("name", current["name"])
        geometry = patch.get("geometry", current["geometry"])
        self.db.execute(
            "UPDATE zones SET kind = ?, name = ?, geometry = ? WHERE id = ? AND field_id = ?",
            (kind, name, _dump(geometry), zone_id, field_id),
        )
        self._touch_field(field_id, author=author)
        return self._get_zone(zone_id)

    def delete_zone(self, field_id: str, zone_id: str) -> bool:
        cursor = self.db.execute(
            "DELETE FROM zones WHERE id = ? AND field_id = ?", (zone_id, field_id)
        )
        if cursor.rowcount:
            self._touch_field(field_id)
        return cursor.rowcount > 0

    def list_obstacles(self, field_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT * FROM obstacles WHERE field_id = ? ORDER BY created_at", (field_id,)
        ).fetchall()
        return [self._obstacle_row(row) for row in rows]

    def add_obstacle(
        self,
        field_id: str,
        geometry: dict[str, Any],
        category: str = "unspecified",
        name: str | None = None,
        margin_m: float = 0,
        height_m: float | None = None,
        valid_from: str | None = None,
        valid_until: str | None = None,
        crossable: bool = False,
        provenance: dict[str, Any] | None = None,
        author: str | None = None,
    ) -> dict[str, Any]:
        if self.get_field(field_id, with_children=False) is None:
            raise KeyError(field_id)
        obstacle_id = uuid.uuid4().hex
        provenance = provenance or {}
        self.db.execute(
            """
            INSERT INTO obstacles (
                id, field_id, category, name, geometry, margin_m, height_m,
                valid_from, valid_until, crossable, provenance, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                obstacle_id,
                field_id,
                category,
                name,
                _dump(geometry),
                margin_m,
                height_m,
                valid_from,
                valid_until,
                1 if crossable else 0,
                _dump(provenance),
                utc_now(),
            ),
        )
        self._touch_field(field_id, author=author)
        return self._get_obstacle(obstacle_id)

    def update_obstacle(
        self,
        field_id: str,
        obstacle_id: str,
        patch: dict[str, Any],
        author: str | None = None,
    ) -> dict[str, Any] | None:
        current = self._find_obstacle(obstacle_id)
        if current is None or current["field_id"] != field_id:
            return None
        name = patch.get("name", current["name"])
        category = str(patch.get("category", current["category"]))
        geometry = patch.get("geometry", current["geometry"])
        margin_m = float(patch.get("margin_m", current["margin_m"] or 0))
        height_m = patch.get("height_m", current["height_m"])
        valid_from = patch.get("valid_from", current["valid_from"])
        valid_until = patch.get("valid_until", current["valid_until"])
        crossable = bool(patch.get("crossable", current["crossable"]))
        self.db.execute(
            """
            UPDATE obstacles SET name = ?, category = ?, geometry = ?, margin_m = ?,
                height_m = ?, valid_from = ?, valid_until = ?, crossable = ?
            WHERE id = ? AND field_id = ?
            """,
            (
                name,
                category,
                _dump(geometry),
                margin_m,
                height_m,
                valid_from,
                valid_until,
                1 if crossable else 0,
                obstacle_id,
                field_id,
            ),
        )
        self._touch_field(field_id, author=author)
        return self._get_obstacle(obstacle_id)

    def delete_obstacle(self, field_id: str, obstacle_id: str) -> bool:
        cursor = self.db.execute(
            "DELETE FROM obstacles WHERE id = ? AND field_id = ?", (obstacle_id, field_id)
        )
        if cursor.rowcount:
            self._touch_field(field_id)
        return cursor.rowcount > 0

    def list_landmarks(self, field_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT * FROM landmarks WHERE field_id = ? ORDER BY created_at", (field_id,)
        ).fetchall()
        return [self._landmark_row(row) for row in rows]

    def add_landmark(
        self,
        field_id: str,
        kind: str,
        geometry: dict[str, Any],
        name: str | None = None,
        radius_m: float | None = None,
        provenance: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if self.get_field(field_id, with_children=False) is None:
            raise KeyError(field_id)
        allowed = {"measure", "circle", "polygon", "point"}
        if kind not in allowed:
            raise ValueError(f"unknown landmark kind: {kind}")
        if not isinstance(geometry, dict) or not geometry.get("type"):
            raise ValueError("geometry is required")
        landmark_id = uuid.uuid4().hex
        self.db.execute(
            """
            INSERT INTO landmarks (
                id, field_id, kind, name, geometry, radius_m, provenance, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                landmark_id,
                field_id,
                kind,
                name,
                _dump(geometry),
                radius_m,
                _dump(provenance or {}),
                utc_now(),
            ),
        )
        self._emit_persist(field_id)
        return self._get_landmark(landmark_id)

    def update_landmark(
        self,
        field_id: str,
        landmark_id: str,
        patch: dict[str, Any],
    ) -> dict[str, Any] | None:
        current = self._find_landmark(landmark_id)
        if current is None or current["field_id"] != field_id:
            return None
        name = patch.get("name", current["name"])
        geometry = patch.get("geometry", current["geometry"])
        radius_raw = patch.get("radius_m", current["radius_m"])
        radius_m = float(radius_raw) if radius_raw is not None and radius_raw != "" else None
        self.db.execute(
            "UPDATE landmarks SET name = ?, geometry = ?, radius_m = ? WHERE id = ? AND field_id = ?",
            (name, _dump(geometry), radius_m, landmark_id, field_id),
        )
        self._emit_persist(field_id)
        return self._get_landmark(landmark_id)

    def delete_landmark(self, field_id: str, landmark_id: str) -> bool:
        cursor = self.db.execute(
            "DELETE FROM landmarks WHERE id = ? AND field_id = ?", (landmark_id, field_id)
        )
        if cursor.rowcount:
            self._emit_persist(field_id)
        return cursor.rowcount > 0

    def list_guidance_lines(self, field_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT * FROM guidance_lines WHERE field_id = ? ORDER BY created_at",
            (field_id,),
        ).fetchall()
        return [self._line_row(row) for row in rows]

    def add_guidance_line(
        self,
        field_id: str,
        geometry: dict[str, Any],
        name: str | None = None,
        provenance: dict[str, Any] | None = None,
        author: str | None = None,
    ) -> dict[str, Any]:
        if self.get_field(field_id, with_children=False) is None:
            raise KeyError(field_id)
        geometry = _as_linestring(geometry)
        line_id = uuid.uuid4().hex
        provenance = provenance or {}
        self.db.execute(
            """
            INSERT INTO guidance_lines (id, field_id, name, geometry, provenance, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (line_id, field_id, name, _dump(geometry), _dump(provenance), utc_now()),
        )
        self._touch_field(field_id, author=author)
        return self._get_line(line_id)

    def update_guidance_line(
        self,
        field_id: str,
        line_id: str,
        patch: dict[str, Any],
        author: str | None = None,
    ) -> dict[str, Any] | None:
        current = self._find_line(line_id)
        if current is None or current["field_id"] != field_id:
            return None
        name = patch.get("name", current["name"])
        geometry = patch.get("geometry", current["geometry"])
        if "geometry" in patch:
            geometry = _as_linestring(geometry)
        self.db.execute(
            "UPDATE guidance_lines SET name = ?, geometry = ? WHERE id = ? AND field_id = ?",
            (name, _dump(geometry), line_id, field_id),
        )
        self._touch_field(field_id, author=author)
        return self._get_line(line_id)

    def delete_guidance_line(self, field_id: str, line_id: str) -> bool:
        cursor = self.db.execute(
            "DELETE FROM guidance_lines WHERE id = ? AND field_id = ?", (line_id, field_id)
        )
        if cursor.rowcount:
            self._touch_field(field_id)
        return cursor.rowcount > 0

    def list_traffic_ways(self, field_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT * FROM traffic_ways WHERE field_id = ? ORDER BY created_at",
            (field_id,),
        ).fetchall()
        return [self._traffic_way_row(row) for row in rows]

    def add_traffic_way(
        self,
        field_id: str,
        geometry: dict[str, Any],
        name: str | None = None,
        kind: str = "path",
        oneway: bool = False,
        speed_mps: float | None = None,
        width_m: float | None = None,
        provenance: dict[str, Any] | None = None,
        author: str | None = None,
    ) -> dict[str, Any]:
        if self.get_field(field_id, with_children=False) is None:
            raise KeyError(field_id)
        way_kind = str(kind or "path").strip().lower() or "path"
        if way_kind not in TRAFFIC_WAY_KINDS:
            raise ValueError(f"unknown traffic way kind: {way_kind}")
        geometry = _as_linestring(geometry)
        way_id = uuid.uuid4().hex
        provenance = provenance or {}
        self.db.execute(
            """
            INSERT INTO traffic_ways (
                id, field_id, name, kind, oneway, speed_mps, width_m,
                geometry, provenance, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                way_id,
                field_id,
                name,
                way_kind,
                1 if oneway else 0,
                speed_mps,
                _positive_width(width_m),
                _dump(geometry),
                _dump(provenance),
                utc_now(),
            ),
        )
        self._touch_field(field_id, author=author)
        return self._get_traffic_way(way_id)

    def update_traffic_way(
        self,
        field_id: str,
        way_id: str,
        patch: dict[str, Any],
        author: str | None = None,
    ) -> dict[str, Any] | None:
        current = self._find_traffic_way(way_id)
        if current is None or current["field_id"] != field_id:
            return None
        name = patch.get("name", current["name"])
        kind = str(patch.get("kind", current["kind"]) or "path").strip().lower() or "path"
        if kind not in TRAFFIC_WAY_KINDS:
            raise ValueError(f"unknown traffic way kind: {kind}")
        oneway = current["oneway"]
        if "oneway" in patch:
            oneway = bool(patch["oneway"])
        speed_mps = current["speed_mps"]
        if "speed_mps" in patch:
            raw = patch["speed_mps"]
            speed_mps = None if raw is None or raw == "" else float(raw)
        width_m = current["width_m"]
        if "width_m" in patch:
            width_m = _positive_width(patch["width_m"])
        geometry = patch.get("geometry", current["geometry"])
        if "geometry" in patch:
            geometry = _as_linestring(geometry)
        self.db.execute(
            """
            UPDATE traffic_ways
            SET name = ?, kind = ?, oneway = ?, speed_mps = ?, width_m = ?, geometry = ?
            WHERE id = ? AND field_id = ?
            """,
            (
                name,
                kind,
                1 if oneway else 0,
                speed_mps,
                width_m,
                _dump(geometry),
                way_id,
                field_id,
            ),
        )
        self._touch_field(field_id, author=author)
        return self._get_traffic_way(way_id)

    def delete_traffic_way(self, field_id: str, way_id: str) -> bool:
        cursor = self.db.execute(
            "DELETE FROM traffic_ways WHERE id = ? AND field_id = ?", (way_id, field_id)
        )
        if cursor.rowcount:
            self._touch_field(field_id)
        return cursor.rowcount > 0

    def list_traffic_nodes(self, field_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT * FROM traffic_nodes WHERE field_id = ? ORDER BY created_at",
            (field_id,),
        ).fetchall()
        return [self._traffic_node_row(row) for row in rows]

    def add_traffic_node(
        self,
        field_id: str,
        geometry: dict[str, Any],
        name: str | None = None,
        kind: str = "gate",
        provenance: dict[str, Any] | None = None,
        author: str | None = None,
    ) -> dict[str, Any]:
        if self.get_field(field_id, with_children=False) is None:
            raise KeyError(field_id)
        node_kind = canonical_traffic_node_kind(str(kind or "gate"))
        if node_kind not in TRAFFIC_NODE_KINDS:
            raise ValueError(f"unknown traffic node kind: {node_kind}")
        geometry = _as_point(geometry)
        node_id = uuid.uuid4().hex
        provenance = provenance or {}
        self.db.execute(
            """
            INSERT INTO traffic_nodes (
                id, field_id, name, kind, geometry, provenance, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (node_id, field_id, name, node_kind, _dump(geometry), _dump(provenance), utc_now()),
        )
        self._touch_field(field_id, author=author)
        return self._get_traffic_node(node_id)

    def update_traffic_node(
        self,
        field_id: str,
        node_id: str,
        patch: dict[str, Any],
        author: str | None = None,
    ) -> dict[str, Any] | None:
        current = self._find_traffic_node(node_id)
        if current is None or current["field_id"] != field_id:
            return None
        name = patch.get("name", current["name"])
        kind = canonical_traffic_node_kind(str(patch.get("kind", current["kind"]) or "gate"))
        if kind not in TRAFFIC_NODE_KINDS:
            raise ValueError(f"unknown traffic node kind: {kind}")
        geometry = patch.get("geometry", current["geometry"])
        if "geometry" in patch:
            geometry = _as_point(geometry)
        self.db.execute(
            "UPDATE traffic_nodes SET name = ?, kind = ?, geometry = ? WHERE id = ? AND field_id = ?",
            (name, kind, _dump(geometry), node_id, field_id),
        )
        self._touch_field(field_id, author=author)
        return self._get_traffic_node(node_id)

    def delete_traffic_node(self, field_id: str, node_id: str) -> bool:
        cursor = self.db.execute(
            "DELETE FROM traffic_nodes WHERE id = ? AND field_id = ?", (node_id, field_id)
        )
        if cursor.rowcount:
            self._touch_field(field_id)
        return cursor.rowcount > 0

    def list_row_sets(self, field_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT * FROM row_sets WHERE field_id = ? ORDER BY created_at",
            (field_id,),
        ).fetchall()
        return [self._row_set_row(row) for row in rows]

    def create_row_set(
        self,
        field_id: str,
        rows: list[dict[str, Any]],
        name: str | None = None,
        spacing_m: float = 2.5,
        axis_line_id: str | None = None,
        kind: str = "rows",
        width_m: float | None = None,
        preferred_direction: str | None = None,
        provenance: dict[str, Any] | None = None,
        author: str | None = None,
    ) -> dict[str, Any]:
        if self.get_field(field_id, with_children=False) is None:
            raise KeyError(field_id)
        if not isinstance(rows, list) or len(rows) == 0:
            raise ValueError("row set needs at least one row")
        if len(rows) > 200:
            raise ValueError("row set cannot exceed 200 rows")
        if not (spacing_m > 0):
            raise ValueError("spacing_m must be positive")
        if axis_line_id:
            axis = self._find_line(axis_line_id)
            if axis is None or axis["field_id"] != field_id:
                raise ValueError("axis_line_id not on this field")
        parsed: list[tuple[int, str | None, dict[str, Any]]] = []
        used_numbers: set[int] = set()
        for index, item in enumerate(rows):
            if not isinstance(item, dict):
                raise ValueError("each row must be an object")
            geometry = _as_row_geometry(item.get("geometry"))
            number = int(item.get("number") or (index + 1))
            if number < 1:
                raise ValueError("row number must be >= 1")
            if number in used_numbers:
                raise ValueError(f"duplicate row number: {number}")
            used_numbers.add(number)
            row_name = item.get("name")
            parsed.append((number, str(row_name) if row_name else None, geometry))
        set_id = uuid.uuid4().hex
        provenance = provenance or {}
        self.db.execute(
            """
            INSERT INTO row_sets (
                id, field_id, name, kind, spacing_m, width_m, preferred_direction,
                axis_line_id, geometry, provenance, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                set_id,
                field_id,
                name,
                kind or "rows",
                spacing_m,
                width_m,
                preferred_direction,
                axis_line_id,
                None,
                _dump(provenance),
                utc_now(),
            ),
        )
        now = utc_now()
        for number, row_name, geometry in parsed:
            self.db.execute(
                """
                INSERT INTO rows (
                    id, row_set_id, field_id, number, name, geometry, state, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    uuid.uuid4().hex,
                    set_id,
                    field_id,
                    number,
                    row_name,
                    _dump(geometry),
                    "active",
                    now,
                ),
            )
        self._touch_field(field_id, author=author)
        return self._get_row_set(set_id)

    def delete_row_set(self, field_id: str, set_id: str) -> bool:
        cursor = self.db.execute(
            "DELETE FROM row_sets WHERE id = ? AND field_id = ?", (set_id, field_id)
        )
        if cursor.rowcount:
            self._touch_field(field_id)
        return cursor.rowcount > 0

    def add_row(
        self,
        field_id: str,
        set_id: str,
        geometry: Any,
        number: int | None = None,
        name: str | None = None,
        author: str | None = None,
    ) -> dict[str, Any] | None:
        """Put one row back into an existing set — the inverse of ``delete_row``."""
        row_set = self.db.execute(
            "SELECT id FROM row_sets WHERE id = ? AND field_id = ?", (set_id, field_id)
        ).fetchone()
        if row_set is None:
            return None
        parsed = _as_row_geometry(geometry)
        taken = {
            int(item["number"])
            for item in self.db.execute(
                "SELECT number FROM rows WHERE row_set_id = ?", (set_id,)
            ).fetchall()
        }
        if len(taken) >= 200:
            raise ValueError("row set cannot exceed 200 rows")
        wanted = int(number) if number is not None else (max(taken) + 1 if taken else 1)
        if wanted < 1:
            raise ValueError("row number must be >= 1")
        if wanted in taken:
            raise ValueError(f"duplicate row number: {wanted}")
        row_id = uuid.uuid4().hex
        self.db.execute(
            """
            INSERT INTO rows (
                id, row_set_id, field_id, number, name, geometry, state, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row_id,
                set_id,
                field_id,
                wanted,
                str(name) if name else None,
                _dump(parsed),
                "active",
                utc_now(),
            ),
        )
        self._touch_field(field_id, author=author)
        return self._get_row(row_id)

    def update_row(
        self,
        field_id: str,
        row_id: str,
        patch: dict[str, Any],
        author: str | None = None,
    ) -> dict[str, Any] | None:
        current = self._find_row(row_id)
        if current is None or current["field_id"] != field_id:
            return None
        name = patch.get("name", current["name"])
        state = str(patch.get("state", current["state"]))
        geometry = patch.get("geometry", current["geometry"])
        if "geometry" in patch:
            geometry = _as_row_geometry(geometry)
        self.db.execute(
            "UPDATE rows SET name = ?, state = ?, geometry = ? WHERE id = ? AND field_id = ?",
            (name, state, _dump(geometry), row_id, field_id),
        )
        self._touch_field(field_id, author=author)
        return self._get_row(row_id)

    def delete_row(self, field_id: str, row_id: str) -> bool:
        cursor = self.db.execute(
            "DELETE FROM rows WHERE id = ? AND field_id = ?", (row_id, field_id)
        )
        if cursor.rowcount:
            self._touch_field(field_id)
        return cursor.rowcount > 0

    def latest_version_number(self, field_id: str) -> int:
        row = self.db.execute(
            "SELECT MAX(version) AS version FROM field_versions WHERE field_id = ?",
            (field_id,),
        ).fetchone()
        return int(row["version"] or 0)

    def list_versions(self, field_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            """
            SELECT version, geometry_hash, area_m2, created_at, author
            FROM field_versions WHERE field_id = ? ORDER BY version
            """,
            (field_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def get_version(self, field_id: str, version: int) -> dict[str, Any] | None:
        row = self.db.execute(
            "SELECT * FROM field_versions WHERE field_id = ? AND version = ?",
            (field_id, version),
        ).fetchone()
        if row is None:
            return None
        return {
            "version": row["version"],
            "geometry_hash": row["geometry_hash"],
            "area_m2": row["area_m2"],
            "created_at": row["created_at"],
            "author": row["author"],
            "snapshot": _load(row["snapshot"], {}),
        }

    def diff_versions(self, field_id: str, from_version: int, to_version: int) -> dict[str, Any]:
        left = self.get_version(field_id, from_version)
        right = self.get_version(field_id, to_version)
        if left is None or right is None:
            raise KeyError("version not found")
        left_snap = left["snapshot"]
        right_snap = right["snapshot"]
        return {
            "from": from_version,
            "to": to_version,
            "geometry_changed": left["geometry_hash"] != right["geometry_hash"],
            "area_m2_from": left["area_m2"],
            "area_m2_to": right["area_m2"],
            "zones_from": len(left_snap.get("zones") or []),
            "zones_to": len(right_snap.get("zones") or []),
            "obstacles_from": len(left_snap.get("obstacles") or []),
            "obstacles_to": len(right_snap.get("obstacles") or []),
        }

    def link_mission(self, field_id: str, mission_path: str) -> dict[str, Any]:
        if self.get_field(field_id, with_children=False) is None:
            raise KeyError(field_id)
        self.db.execute(
            """
            INSERT INTO field_mission_links (field_id, mission_path, status)
            VALUES (?, ?, 'current')
            ON CONFLICT(field_id, mission_path) DO UPDATE SET status = 'current'
            """,
            (field_id, mission_path),
        )
        return {"field_id": field_id, "mission_path": mission_path, "status": "current"}

    def invalidate_missions(self, field_id: str) -> int:
        cursor = self.db.execute(
            """
            UPDATE field_mission_links SET status = 'needs_revalidation'
            WHERE field_id = ? AND status != 'needs_revalidation'
            """,
            (field_id,),
        )
        return cursor.rowcount

    def impact(self, field_id: str) -> dict[str, Any]:
        rows = self.db.execute(
            "SELECT mission_path, status FROM field_mission_links WHERE field_id = ?",
            (field_id,),
        ).fetchall()
        missions = [dict(row) for row in rows]
        invalidated = [item for item in missions if item["status"] == "needs_revalidation"]
        return {
            "field_id": field_id,
            "missions": missions,
            "invalidated_count": len(invalidated),
            "banner": (
                f"Simulation invalidée — {len(invalidated)} mission(s) impactée(s)."
                if invalidated
                else None
            ),
        }

    def _touch_field(self, field_id: str, author: str | None = None) -> None:
        self.db.execute("UPDATE fields SET updated_at = ? WHERE id = ?", (utc_now(), field_id))
        self._snapshot(field_id, author=author)
        self.invalidate_missions(field_id)

    def _emit_persist(self, field_id: str | None, *, deleted: bool = False) -> None:
        if not self.persist_enabled or self.on_persist is None:
            return
        self.on_persist(field_id, deleted=deleted)

    def _snapshot(self, field_id: str, author: str | None = None) -> None:
        field = self.get_field(field_id, with_children=True)
        if field is None:
            return
        snapshot = {
            "field": {
                "id": field["id"],
                "name": field["name"],
                "geometry": field["geometry"],
                "provenance": field["provenance"],
            },
            "zones": field.get("zones") or [],
            "obstacles": field.get("obstacles") or [],
            "guidance_lines": field.get("guidance_lines") or [],
            "row_sets": field.get("row_sets") or [],
            "traffic_ways": field.get("traffic_ways") or [],
            "traffic_nodes": field.get("traffic_nodes") or [],
        }
        digest = geometry_hash(
            {
                "field": field["geometry"],
                "zones": [item["geometry"] for item in snapshot["zones"]],
                "obstacles": [item["geometry"] for item in snapshot["obstacles"]],
                "guidance_lines": [item["geometry"] for item in snapshot["guidance_lines"]],
                "rows": [
                    item["geometry"]
                    for row_set in snapshot["row_sets"]
                    for item in (row_set.get("rows") or [])
                ],
                "traffic_ways": [item["geometry"] for item in snapshot["traffic_ways"]],
                "traffic_nodes": [item["geometry"] for item in snapshot["traffic_nodes"]],
            }
        )
        version = self.latest_version_number(field_id) + 1
        # latest_version_number already counted this? get_field with children reads MAX
        # before insert, so +1 is correct. But get_field includes version which is MAX
        # before this insert. Good.
        # Wait: get_field -> latest_version_number. If we just created field, versions
        # empty, MAX is 0, version=1. Then we insert. Next touch: MAX=1, version=2.
        # BUT get_field with_children calls latest_version_number which during create
        # is 0, then _snapshot inserts 1. Then get_field returns version 1 after insert
        # because create_field calls get_field AFTER _snapshot. Good.
        #
        # Bug: _snapshot calls get_field(with_children=True) which calls
        # latest_version_number. Then we compute version = that + 1. Fine.
        #
        # Infinite recursion? get_field doesn't call _snapshot. Good.
        #
        # Another bug: _snapshot -> get_field -> latest_version_number. Then INSERT.
        # get_field also loads zones. Fine.
        self.db.execute(
            """
            INSERT INTO field_versions (
                field_id, version, snapshot, geometry_hash, area_m2, created_at, author
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                field_id,
                version,
                _dump(snapshot),
                digest,
                polygon_area_m2(field["geometry"]),
                utc_now(),
                author,
            ),
        )
        self._emit_persist(field_id)

    def _zone_row(self, row: Any) -> dict[str, Any]:
        return {
            "id": row["id"],
            "field_id": row["field_id"],
            "kind": row["kind"],
            "name": row["name"],
            "geometry": _load(row["geometry"], {}),
            "provenance": _load(row["provenance"], {}),
            "created_at": row["created_at"],
        }

    def _obstacle_row(self, row: Any) -> dict[str, Any]:
        return {
            "id": row["id"],
            "field_id": row["field_id"],
            "category": row["category"],
            "name": row["name"],
            "geometry": _load(row["geometry"], {}),
            "margin_m": row["margin_m"],
            "height_m": row["height_m"],
            "valid_from": row["valid_from"],
            "valid_until": row["valid_until"],
            "crossable": bool(row["crossable"]),
            "provenance": _load(row["provenance"], {}),
            "created_at": row["created_at"],
        }

    def _landmark_row(self, row: Any) -> dict[str, Any]:
        return {
            "id": row["id"],
            "field_id": row["field_id"],
            "kind": row["kind"],
            "name": row["name"],
            "geometry": _load(row["geometry"], {}),
            "radius_m": row["radius_m"],
            "provenance": _load(row["provenance"], {}),
            "created_at": row["created_at"],
        }

    def _find_landmark(self, landmark_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM landmarks WHERE id = ?", (landmark_id,)).fetchone()
        return self._landmark_row(row) if row else None

    def _get_landmark(self, landmark_id: str) -> dict[str, Any]:
        landmark = self._find_landmark(landmark_id)
        if landmark is None:
            raise KeyError(landmark_id)
        return landmark

    def _line_row(self, row: Any) -> dict[str, Any]:
        return {
            "id": row["id"],
            "field_id": row["field_id"],
            "name": row["name"],
            "geometry": _load(row["geometry"], {}),
            "provenance": _load(row["provenance"], {}),
            "created_at": row["created_at"],
        }

    def _find_zone(self, zone_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM zones WHERE id = ?", (zone_id,)).fetchone()
        return self._zone_row(row) if row else None

    def _get_zone(self, zone_id: str) -> dict[str, Any]:
        zone = self._find_zone(zone_id)
        if zone is None:
            raise KeyError(zone_id)
        return zone

    def _find_obstacle(self, obstacle_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM obstacles WHERE id = ?", (obstacle_id,)).fetchone()
        return self._obstacle_row(row) if row else None

    def _get_obstacle(self, obstacle_id: str) -> dict[str, Any]:
        obstacle = self._find_obstacle(obstacle_id)
        if obstacle is None:
            raise KeyError(obstacle_id)
        return obstacle

    def _find_line(self, line_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM guidance_lines WHERE id = ?", (line_id,)).fetchone()
        return self._line_row(row) if row else None

    def _get_line(self, line_id: str) -> dict[str, Any]:
        line = self._find_line(line_id)
        if line is None:
            raise KeyError(line_id)
        return line

    def _traffic_way_row(self, row: Any) -> dict[str, Any]:
        return {
            "id": row["id"],
            "field_id": row["field_id"],
            "name": row["name"],
            "kind": row["kind"],
            "oneway": bool(row["oneway"]),
            "speed_mps": row["speed_mps"],
            "width_m": row["width_m"],
            "geometry": _load(row["geometry"], {}),
            "provenance": _load(row["provenance"], {}),
            "created_at": row["created_at"],
        }

    def _find_traffic_way(self, way_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM traffic_ways WHERE id = ?", (way_id,)).fetchone()
        return self._traffic_way_row(row) if row else None

    def _get_traffic_way(self, way_id: str) -> dict[str, Any]:
        way = self._find_traffic_way(way_id)
        if way is None:
            raise KeyError(way_id)
        return way

    def _traffic_node_row(self, row: Any) -> dict[str, Any]:
        return {
            "id": row["id"],
            "field_id": row["field_id"],
            "name": row["name"],
            "kind": row["kind"],
            "geometry": _load(row["geometry"], {}),
            "provenance": _load(row["provenance"], {}),
            "created_at": row["created_at"],
        }

    def _find_traffic_node(self, node_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM traffic_nodes WHERE id = ?", (node_id,)).fetchone()
        return self._traffic_node_row(row) if row else None

    def _get_traffic_node(self, node_id: str) -> dict[str, Any]:
        node = self._find_traffic_node(node_id)
        if node is None:
            raise KeyError(node_id)
        return node

    def _list_rows_for_set(self, set_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT * FROM rows WHERE row_set_id = ? ORDER BY number",
            (set_id,),
        ).fetchall()
        return [self._row_item(row) for row in rows]

    def _row_set_row(self, row: Any) -> dict[str, Any]:
        return {
            "id": row["id"],
            "field_id": row["field_id"],
            "name": row["name"],
            "kind": row["kind"],
            "spacing_m": row["spacing_m"],
            "width_m": row["width_m"],
            "preferred_direction": row["preferred_direction"],
            "axis_line_id": row["axis_line_id"],
            "geometry": _load(row["geometry"], None),
            "provenance": _load(row["provenance"], {}),
            "created_at": row["created_at"],
            "rows": self._list_rows_for_set(row["id"]),
        }

    def _row_item(self, row: Any) -> dict[str, Any]:
        return {
            "id": row["id"],
            "row_set_id": row["row_set_id"],
            "field_id": row["field_id"],
            "number": row["number"],
            "name": row["name"],
            "geometry": _load(row["geometry"], {}),
            "state": row["state"],
            "created_at": row["created_at"],
        }

    def _find_row_set(self, set_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM row_sets WHERE id = ?", (set_id,)).fetchone()
        return self._row_set_row(row) if row else None

    def _get_row_set(self, set_id: str) -> dict[str, Any]:
        row_set = self._find_row_set(set_id)
        if row_set is None:
            raise KeyError(set_id)
        return row_set

    def _find_row(self, row_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM rows WHERE id = ?", (row_id,)).fetchone()
        return self._row_item(row) if row else None

    def _get_row(self, row_id: str) -> dict[str, Any]:
        item = self._find_row(row_id)
        if item is None:
            raise KeyError(row_id)
        return item
