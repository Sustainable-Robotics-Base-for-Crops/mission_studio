"""Boustrophedon sweep used when Fields2Cover is not installed (CI / Mac).

Same intersection logic as Studio ``domain/coverage.ts``. Holes are ignored
here; Fields2Cover handles islands when the C++ library is available.
"""

from __future__ import annotations

import math

MAX_SWATHS = 200


def generate_swaths(
    outer: list[tuple[float, float]],
    spacing: float,
    heading: float,
    reverse_odd: bool = True,
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    if len(outer) < 3 or not (spacing > 0):
        return []
    dir_x = math.cos(heading)
    dir_y = math.sin(heading)
    perp_x = -dir_y
    perp_y = dir_x
    min_perp = math.inf
    max_perp = -math.inf
    for x, y in outer:
        perp = x * perp_x + y * perp_y
        min_perp = min(min_perp, perp)
        max_perp = max(max_perp, perp)

    swaths: list[tuple[tuple[float, float], tuple[float, float]]] = []
    current = min_perp + spacing / 2.0
    line_index = 0
    while current < max_perp:
        if len(swaths) >= MAX_SWATHS:
            break
        hits: list[tuple[float, float]] = []
        count = len(outer)
        for index in range(count):
            p1 = outer[index]
            p2 = outer[(index + 1) % count]
            d1 = p1[0] * perp_x + p1[1] * perp_y - current
            d2 = p2[0] * perp_x + p2[1] * perp_y - current
            if d1 * d2 < 0:
                t = d1 / (d1 - d2)
                hits.append((p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])))
        if len(hits) >= 2:
            hits.sort(key=lambda point: point[0] * dir_x + point[1] * dir_y)
            start, end = hits[0], hits[-1]
            if reverse_odd and line_index % 2 == 1:
                start, end = end, start
            swaths.append((start, end))
            line_index += 1
        current += spacing
    return swaths


def best_heading(
    outer: list[tuple[float, float]],
    spacing: float,
    candidates: list[float],
) -> tuple[float, list[tuple[tuple[float, float], tuple[float, float]]]]:
    best_heading_rad = candidates[0] if candidates else 0.0
    best_swaths: list[tuple[tuple[float, float], tuple[float, float]]] = []
    best_count = math.inf
    for heading in candidates:
        swaths = generate_swaths(outer, spacing, heading)
        if not swaths:
            continue
        if len(swaths) < best_count:
            best_count = len(swaths)
            best_heading_rad = heading
            best_swaths = swaths
    return best_heading_rad, best_swaths
