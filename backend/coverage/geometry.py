"""Planar ENU approximation — same scale as Studio ``geometry.ts``."""

from __future__ import annotations

import math
from typing import Any

METERS_PER_DEGREE = 111320.0
MIN_SWATH_M = 0.05


def round3(value: float) -> float:
    return round(value * 1000.0) / 1000.0


def latlng_to_local(
    lat: float, lng: float, origin_lat: float, origin_lon: float
) -> tuple[float, float]:
    x = (lng - origin_lon) * METERS_PER_DEGREE * math.cos(math.radians(origin_lat))
    y = (lat - origin_lat) * METERS_PER_DEGREE
    return (x, y)


def local_to_latlng(
    x: float, y: float, origin_lat: float, origin_lon: float
) -> tuple[float, float]:
    lat = origin_lat + y / METERS_PER_DEGREE
    lng = origin_lon + x / (METERS_PER_DEGREE * math.cos(math.radians(origin_lat)))
    return (lat, lng)


def ring_to_xy(
    ring: list[dict[str, Any]], origin_lat: float, origin_lon: float
) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for item in ring:
        if not isinstance(item, dict):
            continue
        lat = item.get("lat")
        lng = item.get("lng", item.get("lon"))
        if lat is None or lng is None:
            continue
        points.append(latlng_to_local(float(lat), float(lng), origin_lat, origin_lon))
    return _dedupe_close(points)


def geojson_ring_to_xy(
    ring: list[Any], origin_lat: float, origin_lon: float
) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for pair in ring:
        if not isinstance(pair, (list, tuple)) or len(pair) < 2:
            continue
        lng, lat = float(pair[0]), float(pair[1])
        points.append(latlng_to_local(lat, lng, origin_lat, origin_lon))
    return _dedupe_close(points)


def _dedupe_close(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    cleaned: list[tuple[float, float]] = []
    for point in points:
        if cleaned:
            dx = point[0] - cleaned[-1][0]
            dy = point[1] - cleaned[-1][1]
            if math.hypot(dx, dy) < 1e-6:
                continue
        cleaned.append(point)
    if len(cleaned) >= 2:
        dx = cleaned[0][0] - cleaned[-1][0]
        dy = cleaned[0][1] - cleaned[-1][1]
        if math.hypot(dx, dy) < 1e-6:
            cleaned.pop()
    return cleaned


def first_edge_heading(points: list[tuple[float, float]]) -> float:
    if len(points) < 2:
        return 0.0
    dx = points[1][0] - points[0][0]
    dy = points[1][1] - points[0][1]
    if math.hypot(dx, dy) < 1e-9:
        return 0.0
    return math.atan2(dy, dx)


def swath_length(start: tuple[float, float], end: tuple[float, float]) -> float:
    return math.hypot(end[0] - start[0], end[1] - start[1])
