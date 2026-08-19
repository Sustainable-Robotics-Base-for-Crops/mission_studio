"""Collision and pivot-swept envelopes for a vehicle–implement pair (L7a)."""

from __future__ import annotations

import math
from typing import Any

DEFAULT_DRAWBAR_M = 1.5


def _aabb(min_x: float, min_y: float, max_x: float, max_y: float) -> dict[str, float]:
    return {"min_x": min_x, "min_y": min_y, "max_x": max_x, "max_y": max_y}


def _union(left: dict[str, float], right: dict[str, float]) -> dict[str, float]:
    return _aabb(
        min(left["min_x"], right["min_x"]),
        min(left["min_y"], right["min_y"]),
        max(left["max_x"], right["max_x"]),
        max(left["max_y"], right["max_y"]),
    )


def _farthest(box: dict[str, float], origin_x: float, origin_y: float) -> float:
    radius = 0.0
    for x in (box["min_x"], box["max_x"]):
        for y in (box["min_y"], box["max_y"]):
            radius = max(radius, math.hypot(x - origin_x, y - origin_y))
    return radius


def vehicle_aabb(vehicle: dict[str, Any]) -> dict[str, float]:
    half_l = float(vehicle["length_m"]) / 2
    half_w = float(vehicle["width_m"]) / 2
    nav_x = float(vehicle.get("nav_ref_x_m") or 0)
    nav_y = float(vehicle.get("nav_ref_y_m") or 0)
    return _aabb(nav_x - half_l, nav_y - half_w, nav_x + half_l, nav_y + half_w)


def hitch_point(vehicle: dict[str, Any]) -> dict[str, float] | None:
    hitch_x = vehicle.get("hitch_x_m")
    if hitch_x is None:
        return None
    return {"x": float(hitch_x), "y": float(vehicle.get("hitch_y_m") or 0)}


def is_trailed(implement: dict[str, Any]) -> bool:
    return implement.get("kind") == "trailer"


def drawbar_length_m(implement: dict[str, Any]) -> float:
    if not is_trailed(implement):
        return 0.0
    raw = implement.get("drawbar_length_m")
    if raw is None:
        return DEFAULT_DRAWBAR_M
    length = float(raw)
    return length if length > 0 else DEFAULT_DRAWBAR_M


def min_turn_radius_m(vehicle: dict[str, Any]) -> float:
    if vehicle.get("kinematics") == "skid_steer":
        return 0.0
    raw = vehicle.get("min_turn_radius_m")
    if raw is not None:
        return max(0.0, float(raw))
    wheelbase = vehicle.get("wheelbase_m")
    if wheelbase:
        return float(wheelbase)
    return float(vehicle["length_m"])


def combination_envelope(
    vehicle: dict[str, Any], implement: dict[str, Any] | None = None
) -> dict[str, Any]:
    vehicle_box = vehicle_aabb(vehicle)
    hitch = hitch_point(vehicle)
    implement_box = None
    axle = None
    work_point = None
    trailer_swing = None
    hitch_mode = None
    if implement is not None:
        hitch = hitch or {"x": -float(vehicle["length_m"]) / 2, "y": 0.0}
        hitch_mode = "trailed" if is_trailed(implement) else "mounted"
        along = -drawbar_length_m(implement) if is_trailed(implement) else 0.0
        axle = {"x": hitch["x"] + along, "y": hitch["y"]}
        center_x = axle["x"] + float(implement.get("offset_x_m") or 0)
        center_y = axle["y"] + float(implement.get("offset_y_m") or 0)
        half_l = float(implement.get("length_m") or 0) / 2
        half_w = float(implement["physical_width_m"]) / 2
        implement_box = _aabb(
            center_x - half_l, center_y - half_w, center_x + half_l, center_y + half_w
        )
        work_point = {
            "x": axle["x"] + float(implement.get("work_point_x_m") or 0),
            "y": axle["y"] + float(implement.get("work_point_y_m") or 0),
        }
        if is_trailed(implement):
            trailer_swing = _farthest(implement_box, hitch["x"], hitch["y"])
    collision = _union(vehicle_box, implement_box) if implement_box else vehicle_box
    origin_x = float(vehicle.get("nav_ref_x_m") or 0)
    origin_y = float(vehicle.get("nav_ref_y_m") or 0)
    swept = _farthest(vehicle_box, origin_x, origin_y)
    if implement_box and hitch_mode == "mounted":
        swept = max(swept, _farthest(implement_box, origin_x, origin_y))
    if hitch is not None and trailer_swing is not None:
        swept = max(
            swept,
            math.hypot(hitch["x"] - origin_x, hitch["y"] - origin_y) + trailer_swing,
        )
    return {
        "vehicle": vehicle_box,
        "implement": implement_box,
        "collision": collision,
        "hitch": hitch,
        "axle": axle,
        "work_point": work_point,
        "nav_ref": {"x": origin_x, "y": origin_y},
        "hitch_mode": hitch_mode,
        "swept_radius_m": swept,
        "trailer_swing_radius_m": trailer_swing,
        "min_turn_radius_m": min_turn_radius_m(vehicle),
        "kinematics": vehicle.get("kinematics") or "skid_steer",
        "collision_length_m": collision["max_x"] - collision["min_x"],
        "collision_width_m": collision["max_y"] - collision["min_y"],
    }


def project_srbc_equipment(
    vehicle: dict[str, Any], implement: dict[str, Any] | None = None
) -> dict[str, Any]:
    hitch = hitch_point(vehicle) or {"x": -float(vehicle["length_m"]) / 2, "y": 0.0}
    payload: dict[str, Any] = {
        "vehicle": {
            "id": vehicle["id"],
            "length_m": vehicle["length_m"],
            "width_m": vehicle["width_m"],
            "kinematics": vehicle["kinematics"],
        },
        "implement": None,
        "trailer": None,
    }
    if implement is None:
        return payload
    if implement.get("kind") == "trailer":
        payload["trailer"] = {
            "id": implement["id"],
            "kind": "trailer",
            "width_m": implement["working_width_m"],
            "hitch": hitch,
            "drawbar_length_m": drawbar_length_m(implement),
        }
        return payload
    payload["implement"] = {
        "id": implement["id"],
        "kind": "tool",
        "width_m": implement["working_width_m"],
    }
    return payload
