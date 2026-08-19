"""Permanent rows / beds (L6) → swaths. Do not run Fields2Cover on planted rows."""

from __future__ import annotations

from typing import Any

from backend.coverage.geometry import geojson_ring_to_xy, latlng_to_local


def swaths_from_row_set(
    row_set: dict[str, Any],
    origin_lat: float,
    origin_lon: float,
    reverse_odd: bool = True,
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    rows = sorted(row_set.get("rows") or [], key=lambda item: int(item.get("number") or 0))
    swaths: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for index, row in enumerate(rows):
        geometry = row.get("geometry") or {}
        ends = _geometry_ends(geometry, origin_lat, origin_lon)
        if ends is None:
            continue
        start, end = ends
        if reverse_odd and index % 2 == 1:
            start, end = end, start
        swaths.append((start, end))
    return swaths


def _geometry_ends(
    geometry: dict[str, Any], origin_lat: float, origin_lon: float
) -> tuple[tuple[float, float], tuple[float, float]] | None:
    kind = geometry.get("type")
    coords = geometry.get("coordinates")
    if kind == "LineString" and isinstance(coords, list) and len(coords) >= 2:
        first, last = coords[0], coords[-1]
        if not isinstance(first, (list, tuple)) or not isinstance(last, (list, tuple)):
            return None
        start = latlng_to_local(float(first[1]), float(first[0]), origin_lat, origin_lon)
        end = latlng_to_local(float(last[1]), float(last[0]), origin_lat, origin_lon)
        return (start, end)
    if kind == "Polygon" and isinstance(coords, list) and coords:
        ring = geojson_ring_to_xy(coords[0], origin_lat, origin_lon)
        if len(ring) < 2:
            return None
        return (ring[0], ring[len(ring) // 2])
    return None
