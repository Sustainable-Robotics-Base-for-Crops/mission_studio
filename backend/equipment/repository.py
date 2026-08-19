"""Equipment catalogue (SQLite). Separate from Agri v3 export."""

from __future__ import annotations

import json
import uuid
from typing import Any

from backend.db import Database, utc_now
from backend.equipment.envelope import combination_envelope, project_srbc_equipment
from backend.equipment.seed import seed_oem_if_empty

KINEMATICS = ("skid_steer", "ackermann")
IMPLEMENT_KINDS = ("tool", "trailer")
VEHICLE_NUMBERS = (
    "length_m",
    "width_m",
    "height_m",
    "wheelbase_m",
    "track_width_m",
    "front_overhang_m",
    "rear_overhang_m",
    "mass_kg",
    "max_speed_mps",
    "min_turn_radius_m",
    "nav_ref_x_m",
    "nav_ref_y_m",
    "hitch_x_m",
    "hitch_y_m",
    "ground_clearance_m",
)
IMPLEMENT_NUMBERS = (
    "physical_width_m",
    "working_width_m",
    "length_m",
    "offset_x_m",
    "offset_y_m",
    "work_point_x_m",
    "work_point_y_m",
    "drawbar_length_m",
    "sections",
)


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _load(raw: str | None, default: Any):
    if not raw:
        return default
    return json.loads(raw)


def _optional_float(value: Any):
    if value is None or value == "":
        return None
    return float(value)


def _required_positive(value: Any, name: str) -> float:
    number = float(value)
    if number <= 0:
        raise ValueError(f"{name} must be > 0")
    return number


def _mark_sources(
    current: dict[str, str],
    origin: str,
    keys: tuple[str, ...],
    before: dict[str, Any],
    patch: dict[str, Any],
) -> dict[str, str]:
    sources = dict(current)
    for key in keys:
        if key not in patch:
            continue
        if before.get(key) == patch[key]:
            continue
        previous = sources.get(key, origin)
        sources[key] = "modified" if previous == "oem" else previous
    return sources


def _vehicle_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "kinematics": row["kinematics"],
        "length_m": row["length_m"],
        "width_m": row["width_m"],
        "height_m": row["height_m"],
        "wheelbase_m": row["wheelbase_m"],
        "track_width_m": row["track_width_m"],
        "front_overhang_m": row["front_overhang_m"],
        "rear_overhang_m": row["rear_overhang_m"],
        "mass_kg": row["mass_kg"],
        "max_speed_mps": row["max_speed_mps"],
        "min_turn_radius_m": row["min_turn_radius_m"],
        "can_reverse": bool(row["can_reverse"]),
        "nav_ref_x_m": row["nav_ref_x_m"],
        "nav_ref_y_m": row["nav_ref_y_m"],
        "hitch_x_m": row["hitch_x_m"],
        "hitch_y_m": row["hitch_y_m"],
        "ground_clearance_m": row["ground_clearance_m"],
        "sources": _load(row["sources"], {}),
        "origin": row["origin"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _implement_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "kind": row["kind"],
        "physical_width_m": row["physical_width_m"],
        "working_width_m": row["working_width_m"],
        "length_m": row["length_m"],
        "offset_x_m": row["offset_x_m"],
        "offset_y_m": row["offset_y_m"],
        "work_point_x_m": row["work_point_x_m"],
        "work_point_y_m": row["work_point_y_m"],
        "drawbar_length_m": row["drawbar_length_m"] if "drawbar_length_m" in row.keys() else None,
        "sections": row["sections"],
        "sources": _load(row["sources"], {}),
        "origin": row["origin"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _combination_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "vehicle_id": row["vehicle_id"],
        "implement_id": row["implement_id"],
        "origin": row["origin"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


class EquipmentRepository:
    def __init__(self, database: Database):
        self._db = database
        seed_oem_if_empty(database)

    def catalogue(self) -> dict[str, Any]:
        return {
            "vehicles": self.list_vehicles(),
            "implements": self.list_implements(),
            "combinations": self.list_combinations(),
        }

    def list_vehicles(self) -> list[dict[str, Any]]:
        rows = self._db.execute("SELECT * FROM vehicles ORDER BY name COLLATE NOCASE").fetchall()
        return [_vehicle_row(row) for row in rows]

    def get_vehicle(self, vehicle_id: str) -> dict[str, Any] | None:
        row = self._db.execute("SELECT * FROM vehicles WHERE id = ?", (vehicle_id,)).fetchone()
        return None if row is None else _vehicle_row(row)

    def create_vehicle(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValueError("name is required")
        kinematics = str(payload.get("kinematics") or "skid_steer")
        if kinematics not in KINEMATICS:
            raise ValueError("kinematics must be skid_steer or ackermann")
        vehicle_id = str(payload.get("id") or uuid.uuid4())
        now = utc_now()
        self._db.execute(
            """
            INSERT INTO vehicles (
                id, name, kinematics, length_m, width_m, height_m, wheelbase_m,
                track_width_m, front_overhang_m, rear_overhang_m, mass_kg,
                max_speed_mps, min_turn_radius_m, can_reverse, nav_ref_x_m,
                nav_ref_y_m, hitch_x_m, hitch_y_m, ground_clearance_m, sources,
                origin, created_at, updated_at
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}',
                'local', ?, ?
            )
            """,
            (
                vehicle_id,
                name,
                kinematics,
                _required_positive(payload.get("length_m"), "length_m"),
                _required_positive(payload.get("width_m"), "width_m"),
                _optional_float(payload.get("height_m")),
                _optional_float(payload.get("wheelbase_m")),
                _optional_float(payload.get("track_width_m")),
                _optional_float(payload.get("front_overhang_m")),
                _optional_float(payload.get("rear_overhang_m")),
                _optional_float(payload.get("mass_kg")),
                _optional_float(payload.get("max_speed_mps")),
                _optional_float(payload.get("min_turn_radius_m")),
                0 if payload.get("can_reverse") is False else 1,
                float(payload.get("nav_ref_x_m") or 0),
                float(payload.get("nav_ref_y_m") or 0),
                _optional_float(payload.get("hitch_x_m")),
                float(payload.get("hitch_y_m") or 0),
                _optional_float(payload.get("ground_clearance_m")),
                now,
                now,
            ),
        )
        created = self.get_vehicle(vehicle_id)
        if created is None:
            raise RuntimeError("vehicle insert failed")
        return created

    def patch_vehicle(self, vehicle_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        current = self.get_vehicle(vehicle_id)
        if current is None:
            return None
        next_row = dict(current)
        if "name" in payload and str(payload["name"]).strip():
            next_row["name"] = str(payload["name"]).strip()
        if "kinematics" in payload:
            kinematics = str(payload["kinematics"])
            if kinematics not in KINEMATICS:
                raise ValueError("kinematics must be skid_steer or ackermann")
            next_row["kinematics"] = kinematics
        if "can_reverse" in payload:
            next_row["can_reverse"] = bool(payload["can_reverse"])
        for key in VEHICLE_NUMBERS:
            if key not in payload:
                continue
            if key in {"length_m", "width_m"}:
                next_row[key] = _required_positive(payload[key], key)
            else:
                next_row[key] = _optional_float(payload[key])
        sources = _mark_sources(current["sources"], current["origin"], VEHICLE_NUMBERS + ("kinematics",), current, next_row)
        self._db.execute(
            """
            UPDATE vehicles SET
                name=?, kinematics=?, length_m=?, width_m=?, height_m=?, wheelbase_m=?,
                track_width_m=?, front_overhang_m=?, rear_overhang_m=?, mass_kg=?,
                max_speed_mps=?, min_turn_radius_m=?, can_reverse=?, nav_ref_x_m=?,
                nav_ref_y_m=?, hitch_x_m=?, hitch_y_m=?, ground_clearance_m=?,
                sources=?, updated_at=?
            WHERE id=?
            """,
            (
                next_row["name"],
                next_row["kinematics"],
                next_row["length_m"],
                next_row["width_m"],
                next_row["height_m"],
                next_row["wheelbase_m"],
                next_row["track_width_m"],
                next_row["front_overhang_m"],
                next_row["rear_overhang_m"],
                next_row["mass_kg"],
                next_row["max_speed_mps"],
                next_row["min_turn_radius_m"],
                1 if next_row["can_reverse"] else 0,
                next_row["nav_ref_x_m"],
                next_row["nav_ref_y_m"],
                next_row["hitch_x_m"],
                next_row["hitch_y_m"],
                next_row["ground_clearance_m"],
                _dump(sources),
                utc_now(),
                vehicle_id,
            ),
        )
        return self.get_vehicle(vehicle_id)

    def delete_vehicle(self, vehicle_id: str) -> bool:
        current = self.get_vehicle(vehicle_id)
        if current is None:
            return False
        if current["origin"] == "oem":
            raise ValueError("OEM profiles cannot be deleted")
        used = self._db.execute(
            "SELECT COUNT(*) AS n FROM combinations WHERE vehicle_id = ?", (vehicle_id,)
        ).fetchone()
        if used is not None and int(used["n"]) > 0:
            raise ValueError("vehicle is used by a combination")
        self._db.execute("DELETE FROM vehicles WHERE id = ?", (vehicle_id,))
        return True

    def list_implements(self) -> list[dict[str, Any]]:
        rows = self._db.execute("SELECT * FROM implements ORDER BY name COLLATE NOCASE").fetchall()
        return [_implement_row(row) for row in rows]

    def get_implement(self, implement_id: str) -> dict[str, Any] | None:
        row = self._db.execute("SELECT * FROM implements WHERE id = ?", (implement_id,)).fetchone()
        return None if row is None else _implement_row(row)

    def create_implement(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValueError("name is required")
        kind = str(payload.get("kind") or "tool")
        if kind not in IMPLEMENT_KINDS:
            raise ValueError("kind must be tool or trailer")
        implement_id = str(payload.get("id") or uuid.uuid4())
        now = utc_now()
        drawbar = _optional_float(payload.get("drawbar_length_m"))
        if kind == "trailer" and drawbar is None:
            drawbar = 1.5
        self._db.execute(
            """
            INSERT INTO implements (
                id, name, kind, physical_width_m, working_width_m, length_m,
                offset_x_m, offset_y_m, work_point_x_m, work_point_y_m, sections,
                sources, origin, created_at, updated_at, drawbar_length_m
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 'local', ?, ?, ?)
            """,
            (
                implement_id,
                name,
                kind,
                _required_positive(payload.get("physical_width_m"), "physical_width_m"),
                _required_positive(
                    payload.get("working_width_m", payload.get("physical_width_m")),
                    "working_width_m",
                ),
                float(payload.get("length_m") or 0),
                float(payload.get("offset_x_m") or 0),
                float(payload.get("offset_y_m") or 0),
                float(payload.get("work_point_x_m") or 0),
                float(payload.get("work_point_y_m") or 0),
                None if payload.get("sections") in (None, "") else int(payload["sections"]),
                now,
                now,
                drawbar,
            ),
        )
        created = self.get_implement(implement_id)
        if created is None:
            raise RuntimeError("implement insert failed")
        return created

    def patch_implement(self, implement_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        current = self.get_implement(implement_id)
        if current is None:
            return None
        next_row = dict(current)
        if "name" in payload and str(payload["name"]).strip():
            next_row["name"] = str(payload["name"]).strip()
        if "kind" in payload:
            kind = str(payload["kind"])
            if kind not in IMPLEMENT_KINDS:
                raise ValueError("kind must be tool or trailer")
            next_row["kind"] = kind
        for key in IMPLEMENT_NUMBERS:
            if key not in payload:
                continue
            if key in {"physical_width_m", "working_width_m"}:
                next_row[key] = _required_positive(payload[key], key)
            elif key == "sections":
                next_row[key] = None if payload[key] in (None, "") else int(payload[key])
            elif key == "drawbar_length_m":
                next_row[key] = _optional_float(payload[key])
            else:
                next_row[key] = float(payload[key])
        if next_row["kind"] == "trailer" and not next_row.get("drawbar_length_m"):
            next_row["drawbar_length_m"] = 1.5
        sources = _mark_sources(
            current["sources"], current["origin"], IMPLEMENT_NUMBERS + ("kind",), current, next_row
        )
        self._db.execute(
            """
            UPDATE implements SET
                name=?, kind=?, physical_width_m=?, working_width_m=?, length_m=?,
                offset_x_m=?, offset_y_m=?, work_point_x_m=?, work_point_y_m=?,
                sections=?, sources=?, updated_at=?, drawbar_length_m=?
            WHERE id=?
            """,
            (
                next_row["name"],
                next_row["kind"],
                next_row["physical_width_m"],
                next_row["working_width_m"],
                next_row["length_m"],
                next_row["offset_x_m"],
                next_row["offset_y_m"],
                next_row["work_point_x_m"],
                next_row["work_point_y_m"],
                next_row["sections"],
                _dump(sources),
                utc_now(),
                next_row.get("drawbar_length_m"),
                implement_id,
            ),
        )
        return self.get_implement(implement_id)

    def delete_implement(self, implement_id: str) -> bool:
        current = self.get_implement(implement_id)
        if current is None:
            return False
        if current["origin"] == "oem":
            raise ValueError("OEM profiles cannot be deleted")
        used = self._db.execute(
            "SELECT COUNT(*) AS n FROM combinations WHERE implement_id = ?", (implement_id,)
        ).fetchone()
        if used is not None and int(used["n"]) > 0:
            raise ValueError("implement is used by a combination")
        self._db.execute("DELETE FROM implements WHERE id = ?", (implement_id,))
        return True

    def list_combinations(self) -> list[dict[str, Any]]:
        rows = self._db.execute(
            "SELECT * FROM combinations ORDER BY name COLLATE NOCASE"
        ).fetchall()
        return [_combination_row(row) for row in rows]

    def get_combination(self, combination_id: str) -> dict[str, Any] | None:
        row = self._db.execute(
            "SELECT * FROM combinations WHERE id = ?", (combination_id,)
        ).fetchone()
        return None if row is None else _combination_row(row)

    def create_combination(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = str(payload.get("name") or "").strip()
        vehicle_id = str(payload.get("vehicle_id") or "").strip()
        if not name or not vehicle_id:
            raise ValueError("name and vehicle_id are required")
        if self.get_vehicle(vehicle_id) is None:
            raise ValueError("vehicle not found")
        implement_id = payload.get("implement_id")
        if implement_id:
            implement_id = str(implement_id)
            if self.get_implement(implement_id) is None:
                raise ValueError("implement not found")
        else:
            implement_id = None
        combination_id = str(payload.get("id") or uuid.uuid4())
        now = utc_now()
        self._db.execute(
            """
            INSERT INTO combinations (
                id, name, vehicle_id, implement_id, origin, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'local', ?, ?)
            """,
            (combination_id, name, vehicle_id, implement_id, now, now),
        )
        created = self.get_combination(combination_id)
        if created is None:
            raise RuntimeError("combination insert failed")
        return created

    def patch_combination(self, combination_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        current = self.get_combination(combination_id)
        if current is None:
            return None
        name = current["name"]
        vehicle_id = current["vehicle_id"]
        implement_id = current["implement_id"]
        if "name" in payload and str(payload["name"]).strip():
            name = str(payload["name"]).strip()
        if "vehicle_id" in payload:
            vehicle_id = str(payload["vehicle_id"])
            if self.get_vehicle(vehicle_id) is None:
                raise ValueError("vehicle not found")
        if "implement_id" in payload:
            implement_id = payload["implement_id"]
            if implement_id:
                implement_id = str(implement_id)
                if self.get_implement(implement_id) is None:
                    raise ValueError("implement not found")
            else:
                implement_id = None
        self._db.execute(
            """
            UPDATE combinations SET name=?, vehicle_id=?, implement_id=?, updated_at=?
            WHERE id=?
            """,
            (name, vehicle_id, implement_id, utc_now(), combination_id),
        )
        return self.get_combination(combination_id)

    def delete_combination(self, combination_id: str) -> bool:
        current = self.get_combination(combination_id)
        if current is None:
            return False
        if current["origin"] == "oem":
            raise ValueError("OEM profiles cannot be deleted")
        self._db.execute("DELETE FROM combinations WHERE id = ?", (combination_id,))
        return True

    def resolved_combination(self, combination_id: str) -> dict[str, Any] | None:
        combination = self.get_combination(combination_id)
        if combination is None:
            return None
        vehicle = self.get_vehicle(combination["vehicle_id"])
        if vehicle is None:
            raise ValueError("vehicle not found")
        implement = (
            self.get_implement(combination["implement_id"]) if combination["implement_id"] else None
        )
        envelope = combination_envelope(vehicle, implement)
        return {
            "combination": combination,
            "vehicle": vehicle,
            "implement": implement,
            "envelope": envelope,
            "srbc_equipment": project_srbc_equipment(vehicle, implement),
        }
