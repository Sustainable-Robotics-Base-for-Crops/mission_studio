"""Coverage planner: Fields2Cover when present, parallel fallback, row-set complement."""

from __future__ import annotations

import logging
import math
from typing import Any

from backend.coverage import fields2cover_engine, parallel
from backend.coverage.agri import paths_to_sections, swaths_to_sections, total_length_m
from backend.coverage.geometry import (
    first_edge_heading,
    geojson_ring_to_xy,
    ring_to_xy,
)
from backend.coverage.headland import headland_paths, inset_ring
from backend.coverage.rowset import swaths_from_row_set

logger = logging.getLogger("trajectory_editor")

STRATEGIES = {"boustrophedon", "snake", "perpendicular", "best_nswath", "guidance"}
ENGINE_FIELDS2COVER = "fields2cover"
ENGINE_PARALLEL = "parallel_fallback"
ENGINE_ROW_SET = "row_set"


def engine_status() -> dict[str, Any]:
    f2c = fields2cover_engine.available()
    return {
        "fields2cover": f2c,
        "engine": ENGINE_FIELDS2COVER if f2c else ENGINE_PARALLEL,
        "strategies": sorted(STRATEGIES),
    }


def plan(payload: dict[str, Any], fields_repo: Any | None = None) -> dict[str, Any]:
    working_width = _positive(payload.get("working_width_m"), "working_width_m")
    strategy = str(payload.get("strategy") or "boustrophedon").strip()
    if strategy not in STRATEGIES:
        raise ValueError(f"unknown strategy: {strategy}")
    vehicle_width = float(payload.get("vehicle_width_m") or working_width)
    if not (vehicle_width > 0):
        vehicle_width = working_width
    headland = float(payload.get("headland_width_m") or 0)
    if headland < 0:
        raise ValueError("headland_width_m must be >= 0")
    keepout = float(payload.get("geofence_margin_m") or 0)
    if keepout < 0:
        raise ValueError("geofence_margin_m must be >= 0")
    overlap = float(payload.get("overlap_m") or 0)
    if overlap < 0:
        raise ValueError("overlap_m must be >= 0")
    spacing = working_width - overlap
    if not (spacing > 0):
        raise ValueError("working_width_m must be greater than overlap_m")

    origin = _origin(payload)
    row_set_id = str(payload.get("row_set_id") or "").strip()
    field_id = str(payload.get("field_id") or "").strip()
    if row_set_id:
        if fields_repo is None:
            raise ValueError("row_set_id requires the field catalogue")
        return _plan_row_set(
            fields_repo,
            field_id,
            row_set_id,
            origin,
            strategy,
            working_width,
            vehicle_width,
        )

    outer, holes, origin = _polygon(payload, origin)
    guidance_heading = payload.get("guidance_heading_rad")
    if guidance_heading is not None:
        guidance_heading = float(guidance_heading)
    heading = payload.get("heading_rad")
    if strategy == "guidance":
        chosen = guidance_heading if guidance_heading is not None else heading
        if chosen is None:
            raise ValueError("guidance strategy requires guidance_heading_rad")
        heading = float(chosen)
    elif heading is None:
        heading = first_edge_heading(outer)
    else:
        heading = float(heading)
    if strategy == "perpendicular":
        heading = heading + math.pi / 2.0

    interior, contours = headland_paths(outer, headland, spacing)
    note_parts: list[str] = []
    if headland > 0 and interior is None:
        interior = outer
        contours = []
        note_parts.append("headland inset failed; covering the full polygon")
    if keepout > headland + 1e-9:
        inset_cell = inset_ring(outer, keepout)
        if inset_cell is None:
            note_parts.append("geofence inset failed; covering the current interior")
        else:
            interior = inset_cell
    work_cell = interior or outer
    headland_sections = paths_to_sections(contours)

    want_variants = bool(payload.get("variants"))
    variants = (
        _variant_plans(
            work_cell,
            holes,
            spacing,
            vehicle_width,
            first_edge_heading(outer),
            guidance_heading if isinstance(guidance_heading, float) else None,
        )
        if want_variants
        else []
    )

    if variants:
        chosen = next((item for item in variants if item["strategy"] == strategy), variants[0])
        sections = list(chosen["sections"])
        heading_used = float(chosen["heading_rad"])
        engine = engine_status()["engine"]
        gen_note = None
        length_m = float(chosen["length_m"])
    else:
        swaths, engine, heading_used, gen_note = _generate(
            work_cell,
            holes,
            spacing,
            heading,
            vehicle_width,
            0.0,
            strategy,
        )
        sections = swaths_to_sections(swaths)
        length_m = total_length_m(swaths)
    if gen_note:
        note_parts.append(gen_note)
    if not sections:
        raise ValueError("empty coverage — enlarge the polygon or reduce working_width_m")
    metadata = {
        "engine": engine,
        "strategy": strategy,
        "working_width_m": working_width,
        "overlap_m": overlap,
        "headland_width_m": headland,
        "geofence_margin_m": keepout,
        "headland_laps": len(headland_sections),
        "vehicle_width_m": vehicle_width,
        "heading_rad": heading_used,
        "guidance_heading_rad": guidance_heading if isinstance(guidance_heading, float) else None,
        "swath_count": len(sections),
        "length_m": length_m,
        "variants": [
            {
                "strategy": item["strategy"],
                "heading_rad": item["heading_rad"],
                "swath_count": item["swath_count"],
                "length_m": item["length_m"],
            }
            for item in variants
        ],
        "headland_first": True,
    }
    if note_parts:
        metadata["note"] = "; ".join(note_parts)
    return {
        "engine": engine,
        "sections": sections,
        "headland_sections": headland_sections,
        "variants": variants,
        "metrics": {
            "swath_count": len(sections),
            "length_m": length_m,
            "heading_rad": heading_used,
            "headland_laps": len(headland_sections),
        },
        "srbc_coverage": metadata,
        "origin": {"lat": origin[0], "lon": origin[1]},
    }


def _generate(
    outer: list[tuple[float, float]],
    holes: list[list[tuple[float, float]]],
    spacing: float,
    heading: float,
    vehicle_width: float,
    headland: float,
    strategy: str,
) -> tuple[list[tuple[tuple[float, float], tuple[float, float]]], str, float, str | None]:
    if fields2cover_engine.available():
        try:
            if strategy == "best_nswath":
                swaths = fields2cover_engine.generate_swaths(
                    outer, holes, spacing, heading, vehicle_width, headland, "best_nswath"
                )
                used = heading if swaths else heading
            else:
                f2c_strategy = "snake" if strategy == "snake" else "boustrophedon"
                swaths = fields2cover_engine.generate_swaths(
                    outer, holes, spacing, heading, vehicle_width, headland, f2c_strategy
                )
                used = heading
            if swaths:
                return swaths, ENGINE_FIELDS2COVER, used, None
        except Exception:
            logger.exception("Fields2Cover failed; using parallel fallback")
    note = None
    if holes:
        note = "holes ignored by parallel_fallback; install Fields2Cover for islands"
    if strategy == "best_nswath":
        edge = first_edge_heading(outer)
        candidates = [edge + math.radians(step) for step in (0, 30, 45, 60, 90)]
        used, swaths = parallel.best_heading(outer, spacing, candidates)
        return swaths, ENGINE_PARALLEL, used, note
    bounce = strategy != "snake"
    swaths = parallel.generate_swaths(outer, spacing, heading, reverse_odd=bounce)
    return swaths, ENGINE_PARALLEL, heading, note


def _variant_plans(
    outer: list[tuple[float, float]],
    holes: list[list[tuple[float, float]]],
    spacing: float,
    vehicle_width: float,
    edge_heading: float,
    guidance_heading: float | None = None,
) -> list[dict[str, Any]]:
    variants: list[dict[str, Any]] = []
    headings: list[tuple[str, float | None]] = [
        ("boustrophedon", edge_heading),
        ("perpendicular", edge_heading + math.pi / 2.0),
        ("best_nswath", None),
    ]
    if guidance_heading is not None:
        headings.append(("guidance", guidance_heading))
    for label, heading in headings:
        used = heading if heading is not None else edge_heading
        swaths, _engine, used, _note = _generate(
            outer, holes, spacing, used, vehicle_width, 0.0, label
        )
        sections = swaths_to_sections(swaths)
        variants.append(
            {
                "strategy": label,
                "heading_rad": used,
                "swath_count": len(sections),
                "length_m": total_length_m(swaths),
                "sections": sections,
            }
        )
    return variants


def _plan_row_set(
    fields_repo: Any,
    field_id: str,
    row_set_id: str,
    origin: tuple[float, float] | None,
    strategy: str,
    working_width: float,
    vehicle_width: float,
) -> dict[str, Any]:
    if not field_id:
        raise ValueError("field_id is required with row_set_id")
    field = fields_repo.get_field(field_id)
    if field is None:
        raise KeyError(field_id)
    row_set = next(
        (item for item in (field.get("row_sets") or []) if item["id"] == row_set_id),
        None,
    )
    if row_set is None:
        raise KeyError(row_set_id)
    if origin is None:
        origin = _origin_from_geometry(field.get("geometry"))
    if origin is None:
        raise ValueError("origin is required")
    bounce = strategy != "snake"
    swaths = swaths_from_row_set(row_set, origin[0], origin[1], reverse_odd=bounce)
    sections = swaths_to_sections(swaths)
    if not sections:
        raise ValueError("row set produced no swaths")
    metadata = {
        "engine": ENGINE_ROW_SET,
        "strategy": strategy,
        "working_width_m": working_width,
        "vehicle_width_m": vehicle_width,
        "field_id": field_id,
        "row_set_id": row_set_id,
        "swath_count": len(sections),
        "length_m": total_length_m(swaths),
        "variants": [],
    }
    return {
        "engine": ENGINE_ROW_SET,
        "sections": sections,
        "headland_sections": [],
        "variants": [],
        "metrics": {
            "swath_count": len(sections),
            "length_m": metadata["length_m"],
            "heading_rad": None,
        },
        "srbc_coverage": metadata,
        "origin": {"lat": origin[0], "lon": origin[1]},
    }


def _polygon(
    payload: dict[str, Any], origin: tuple[float, float] | None
) -> tuple[list[tuple[float, float]], list[list[tuple[float, float]]], tuple[float, float]]:
    geometry = payload.get("geometry")
    ring = payload.get("ring")
    if isinstance(geometry, dict) and geometry.get("type") == "Polygon":
        coords = geometry.get("coordinates") or []
        if not coords or not coords[0]:
            raise ValueError("polygon geometry is empty")
        if origin is None:
            first = coords[0][0]
            origin = (float(first[1]), float(first[0]))
        outer = geojson_ring_to_xy(coords[0], origin[0], origin[1])
        holes = [geojson_ring_to_xy(item, origin[0], origin[1]) for item in coords[1:]]
    elif isinstance(ring, list):
        if origin is None:
            first = ring[0] if ring else None
            if not isinstance(first, dict):
                raise ValueError("ring needs at least one vertex")
            origin = (float(first["lat"]), float(first.get("lng", first.get("lon"))))
        outer = ring_to_xy(ring, origin[0], origin[1])
        holes = [
            ring_to_xy(item, origin[0], origin[1])
            for item in (payload.get("holes") or [])
            if isinstance(item, list)
        ]
    else:
        raise ValueError("geometry Polygon or ring is required")
    if len(outer) < 3:
        raise ValueError("polygon needs at least 3 vertices")
    return outer, [hole for hole in holes if len(hole) >= 3], origin


def _origin(payload: dict[str, Any]) -> tuple[float, float] | None:
    raw = payload.get("origin")
    if not isinstance(raw, dict):
        return None
    lat = raw.get("lat")
    lon = raw.get("lon", raw.get("lng"))
    if lat is None or lon is None:
        return None
    return (float(lat), float(lon))


def _origin_from_geometry(geometry: dict[str, Any] | None) -> tuple[float, float] | None:
    if not geometry or geometry.get("type") != "Polygon":
        return None
    coords = geometry.get("coordinates") or []
    if not coords or not coords[0]:
        return None
    first = coords[0][0]
    return (float(first[1]), float(first[0]))


def _positive(value: Any, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a positive number") from exc
    if not (number > 0) or not math.isfinite(number):
        raise ValueError(f"{name} must be a positive number")
    return number
