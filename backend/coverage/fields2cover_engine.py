"""Optional Fields2Cover 2.x bindings (BSD-3-Clause, Wageningen University).

The library is not on PyPI: it must be built from source (see docs/COVERAGE.md).
This module never static-links GEOS; the C++ library loads libgeos_c dynamically.
"""

from __future__ import annotations

import math
from typing import Any

ENGINE_NAME = "fields2cover"


def available() -> bool:
    try:
        import fields2cover  # noqa: F401
    except ImportError:
        return False
    return True


def generate_swaths(
    outer: list[tuple[float, float]],
    holes: list[list[tuple[float, float]]],
    width_m: float,
    heading: float,
    vehicle_width_m: float,
    headland_width_m: float,
    strategy: str,
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    import fields2cover as f2c

    cells = _cells(f2c, outer, holes)
    robot = _robot(f2c, vehicle_width_m, width_m)
    work = cells
    if headland_width_m > 0:
        work = f2c.HG_Const_gen().generateHeadlands(cells, float(headland_width_m))
    cov = float(robot.getCovWidth()) if hasattr(robot, "getCovWidth") else float(width_m)
    bf = f2c.SG_BruteForce()
    cell0 = work.getGeometry(0) if hasattr(work, "getGeometry") and work.size() else work
    if strategy == "best_nswath":
        objective = _nswath_objective(f2c)
        swaths = bf.generateBestSwaths(objective, cov, cell0)
    else:
        target = work if holes else cell0
        swaths = bf.generateSwaths(float(heading), cov, target)
    sorter = _sorter(f2c, strategy)
    if sorter is not None:
        swaths = sorter.genSortedSwaths(swaths)
    return _extract_swaths(swaths)


def _robot(f2c: Any, vehicle_width_m: float, cov_width_m: float) -> Any:
    try:
        return f2c.Robot(float(vehicle_width_m), float(cov_width_m))
    except TypeError:
        return f2c.Robot(float(cov_width_m))


def _nswath_objective(f2c: Any) -> Any:
    for name in ("OBJ_NSwath", "OBJ_NSwathModified", "NSwath"):
        cls = getattr(f2c, name, None)
        if cls is not None:
            return cls()
    raise RuntimeError("Fields2Cover NSwath objective is missing")


def _sorter(f2c: Any, strategy: str) -> Any | None:
    name = "RP_Snake" if strategy == "snake" else "RP_Boustrophedon"
    cls = getattr(f2c, name, None)
    return cls() if cls is not None else None


def _cells(f2c: Any, outer: list[tuple[float, float]], holes: list[list[tuple[float, float]]]) -> Any:
    cell = f2c.Cell(_linear_ring(f2c, outer))
    cells = f2c.Cells(cell)
    for hole in holes:
        if len(hole) < 3:
            continue
        cells.addRing(0, _linear_ring(f2c, hole))
    return cells


def _linear_ring(f2c: Any, points: list[tuple[float, float]]) -> Any:
    closed = list(points)
    if closed[0] != closed[-1]:
        closed.append(closed[0])
    vector = f2c.VectorPoint([f2c.Point(float(x), float(y)) for x, y in closed])
    return f2c.LinearRing(vector)


def _extract_swaths(swaths: Any) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    extracted: list[tuple[tuple[float, float], tuple[float, float]]] = []
    count = swaths.size() if hasattr(swaths, "size") else len(swaths)
    for index in range(count):
        swath = swaths.at(index) if hasattr(swaths, "at") else swaths[index]
        ends = _swath_ends(swath)
        if ends is not None:
            extracted.append(ends)
    return extracted


def _swath_ends(swath: Any) -> tuple[tuple[float, float], tuple[float, float]] | None:
    start = _call_first(swath, ("startPoint", "getStartPoint", "start_point"))
    end = _call_first(swath, ("endPoint", "getEndPoint", "end_point"))
    if start is None or end is None:
        path = _call_first(swath, ("getPath", "getLine", "getSwath"))
        if path is None:
            return None
        size = path.size() if hasattr(path, "size") else 0
        if size < 2:
            return None
        start = path.getGeometry(0) if hasattr(path, "getGeometry") else path[0]
        end = path.getGeometry(size - 1) if hasattr(path, "getGeometry") else path[size - 1]
    start_xy = _xy(start)
    end_xy = _xy(end)
    if start_xy is None or end_xy is None:
        return None
    if math.hypot(end_xy[0] - start_xy[0], end_xy[1] - start_xy[1]) < 1e-6:
        return None
    return (start_xy, end_xy)


def _call_first(obj: Any, names: tuple[str, ...]) -> Any | None:
    for name in names:
        attr = getattr(obj, name, None)
        if attr is None:
            continue
        return attr() if callable(attr) else attr
    return None


def _xy(point: Any) -> tuple[float, float] | None:
    if point is None:
        return None
    if hasattr(point, "getX"):
        return (float(point.getX()), float(point.getY()))
    if hasattr(point, "X"):
        x = point.X() if callable(point.X) else point.X
        y = point.Y() if callable(point.Y) else point.Y
        return (float(x), float(y))
    if hasattr(point, "x"):
        return (float(point.x), float(point.y))
    return None
