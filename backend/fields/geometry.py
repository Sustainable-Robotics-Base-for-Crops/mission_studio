"""Planar helpers for GeoJSON stored in SQLite (WGS84, same scale as Studio)."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

METERS_PER_DEGREE = 111320.0


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def geometry_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def provenance_qualified(provenance: dict[str, Any] | None) -> bool:
    if not provenance:
        return False
    return bool(
        provenance.get("source")
        and provenance.get("method")
        and provenance.get("h_accuracy_m") is not None
    )


def _ring_area_m2(ring: list, origin_lat: float) -> float:
    if len(ring) < 3:
        return 0.0
    scale_x = METERS_PER_DEGREE * math.cos(math.radians(origin_lat))
    points = []
    for pair in ring:
        if not isinstance(pair, (list, tuple)) or len(pair) < 2:
            continue
        lng, lat = float(pair[0]), float(pair[1])
        points.append(((lng) * scale_x, lat * METERS_PER_DEGREE))
    if len(points) < 3:
        return 0.0
    area = 0.0
    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % len(points)]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def polygon_area_m2(geometry: dict[str, Any] | None) -> float | None:
    if not geometry or geometry.get("type") != "Polygon":
        return None
    rings = geometry.get("coordinates") or []
    if not rings or not rings[0]:
        return None
    origin_lat = float(rings[0][0][1]) if len(rings[0][0]) > 1 else 0.0
    outer = _ring_area_m2(rings[0], origin_lat)
    holes = sum(_ring_area_m2(ring, origin_lat) for ring in rings[1:])
    return outer - holes
