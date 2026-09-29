"""Distances and bearings for import reports (WGS84, no projection library)."""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from typing import Any

#: IUGG mean Earth radius, the same convention as the coverage planner.
EARTH_RADIUS_M = 6371008.8

Coordinate = Sequence[float]


def _pair(value: Any) -> tuple[float, float] | None:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        return None
    try:
        return float(value[0]), float(value[1])
    except (TypeError, ValueError):
        return None


def distance_m(start: Any, end: Any) -> float:
    """Great-circle distance between two ``[lon, lat]`` pairs."""
    first = _pair(start)
    second = _pair(end)
    if first is None or second is None:
        return 0.0
    lon1, lat1 = first
    lon2, lat2 = second
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    h = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(min(1.0, h)))


def bearing_deg(start: Any, end: Any) -> float | None:
    """Initial bearing in degrees from north, or ``None`` on unusable input."""
    first = _pair(start)
    second = _pair(end)
    if first is None or second is None:
        return None
    lon1, lat1 = first
    lon2, lat2 = second
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_lambda = math.radians(lon2 - lon1)
    x = math.sin(d_lambda) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(d_lambda)
    if x == 0 and y == 0:
        return None
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def polyline_length_m(coordinates: Any) -> float:
    total = 0.0
    if not isinstance(coordinates, (list, tuple)):
        return 0.0
    for index in range(1, len(coordinates)):
        total += distance_m(coordinates[index - 1], coordinates[index])
    return total


def line_parts(geometry: dict[str, Any] | None) -> list[list[Any]]:
    """Every polyline of a LineString or MultiLineString geometry."""
    if not geometry:
        return []
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if kind == "LineString" and isinstance(coordinates, list):
        return [coordinates]
    if kind == "MultiLineString" and isinstance(coordinates, list):
        return [part for part in coordinates if isinstance(part, list)]
    return []


def geometry_length_m(geometry: dict[str, Any] | None) -> float:
    return sum(polyline_length_m(part) for part in line_parts(geometry))


def first_last(geometry: dict[str, Any] | None) -> tuple[Any, Any] | None:
    parts = line_parts(geometry)
    if not parts or len(parts[0]) < 2:
        return None
    return parts[0][0], parts[-1][-1]


def median(values: Iterable[float]) -> float | None:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return None
    middle = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2.0


def rounded(value: float | None, digits: int = 2) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)
