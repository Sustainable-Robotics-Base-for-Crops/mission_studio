"""Headland (fourrière) inset and contour laps — no GEOS required."""

from __future__ import annotations

import math

from backend.coverage.geometry import MIN_SWATH_M

MITER_LIMIT = 4.0
MAX_LAPS = 8
CONTOUR_SPACING_M = 0.5


def signed_area(points: list[tuple[float, float]]) -> float:
    if len(points) < 3:
        return 0.0
    total = 0.0
    count = len(points)
    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % count]
        total += x1 * y2 - x2 * y1
    return total / 2.0


def inset_ring(
    points: list[tuple[float, float]], distance: float
) -> list[tuple[float, float]] | None:
    if len(points) < 3 or not (distance > 0):
        return list(points)
    area = signed_area(points)
    if abs(area) < 1e-6:
        return None
    ccw = area > 0
    count = len(points)
    offset: list[tuple[float, float]] = []
    for index in range(count):
        prev_pt = points[(index - 1) % count]
        curr = points[index]
        nxt = points[(index + 1) % count]
        n1 = _inward_normal(prev_pt, curr, ccw)
        n2 = _inward_normal(curr, nxt, ccw)
        if n1 is None or n2 is None:
            return None
        a1 = (prev_pt[0] + n1[0] * distance, prev_pt[1] + n1[1] * distance)
        a2 = (curr[0] + n1[0] * distance, curr[1] + n1[1] * distance)
        b1 = (curr[0] + n2[0] * distance, curr[1] + n2[1] * distance)
        b2 = (nxt[0] + n2[0] * distance, nxt[1] + n2[1] * distance)
        hit = _intersect(a1, a2, b1, b2)
        if hit is None or math.hypot(hit[0] - curr[0], hit[1] - curr[1]) > MITER_LIMIT * distance:
            nx, ny = n1[0] + n2[0], n1[1] + n2[1]
            length = math.hypot(nx, ny)
            if length < 1e-9:
                return None
            hit = (curr[0] + nx / length * distance, curr[1] + ny / length * distance)
        offset.append(hit)
    if len(offset) < 3:
        return None
    if signed_area(offset) * area <= 0:
        return None
    return offset


def contour_offsets(headland_width_m: float, working_width_m: float) -> list[float]:
    if not (headland_width_m > 0) or not (working_width_m > 0):
        return []
    offsets: list[float] = []
    lap = 0
    while lap < MAX_LAPS:
        centre = (lap + 0.5) * working_width_m
        if centre > headland_width_m + 1e-6:
            break
        offsets.append(centre)
        lap += 1
    if not offsets:
        offsets.append(min(headland_width_m / 2.0, working_width_m / 2.0))
    return offsets


def densify_closed(
    ring: list[tuple[float, float]], spacing: float = CONTOUR_SPACING_M
) -> list[tuple[float, float]]:
    if len(ring) < 2 or not (spacing > 0):
        return list(ring)
    points: list[tuple[float, float]] = []
    count = len(ring)
    for index in range(count):
        start = ring[index]
        end = ring[(index + 1) % count]
        points.append(start)
        length = math.hypot(end[0] - start[0], end[1] - start[1])
        if length < MIN_SWATH_M:
            continue
        steps = max(1, int(length / spacing))
        for step in range(1, steps):
            t = step / steps
            points.append((start[0] + t * (end[0] - start[0]), start[1] + t * (end[1] - start[1])))
    return points


def headland_paths(
    outer: list[tuple[float, float]],
    headland_width_m: float,
    working_width_m: float,
) -> tuple[list[tuple[float, float]] | None, list[list[tuple[float, float]]]]:
    interior = inset_ring(outer, headland_width_m) if headland_width_m > 0 else list(outer)
    contours: list[list[tuple[float, float]]] = []
    for offset in contour_offsets(headland_width_m, working_width_m):
        ring = inset_ring(outer, offset)
        if ring is None:
            continue
        path = densify_closed(ring)
        if len(path) >= 2:
            contours.append(path)
    return interior, contours


def _inward_normal(
    start: tuple[float, float], end: tuple[float, float], ccw: bool
) -> tuple[float, float] | None:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = math.hypot(dx, dy)
    if length < 1e-9:
        return None
    ux, uy = dx / length, dy / length
    if ccw:
        return (-uy, ux)
    return (uy, -ux)


def _intersect(
    a1: tuple[float, float],
    a2: tuple[float, float],
    b1: tuple[float, float],
    b2: tuple[float, float],
) -> tuple[float, float] | None:
    x1, y1 = a1
    x2, y2 = a2
    x3, y3 = b1
    x4, y4 = b2
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(den) < 1e-12:
        return None
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
    return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))
