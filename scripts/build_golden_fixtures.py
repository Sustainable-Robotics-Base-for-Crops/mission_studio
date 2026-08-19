#!/usr/bin/env python3
"""
Build the golden fixtures used by the Agri v3 regression tests.

The fixtures are committed to the repository so that the test suite is
self-contained. This script only needs to be re-run when a new reference
trajectory has to be added or refreshed.

Real trajectories are copied from paths given on the command line. Their WGS84
origin is already rounded to two decimals by the editor (roughly one kilometre
of uncertainty), so no field or customer location can be derived from them.

Usage:
    python scripts/build_golden_fixtures.py \
        --real-mission /path/to/Parking-test1.json \
        --reference /path/to/json_agri_format_parser/json/default.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

GOLDEN_DIR = Path(__file__).resolve().parent.parent / "tests" / "golden"

# Number of sections kept from the large reference mission. Enough to cover the
# four-column layout and both section types without committing 500 kB.
REFERENCE_SECTION_COUNT = 6

ORIGIN_DECIMALS = 2


def write_fixture(name: str, payload: dict[str, Any]) -> None:
    path = GOLDEN_DIR / name
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {path.relative_to(GOLDEN_DIR.parent.parent)}")


def assert_origin_is_coarse(payload: dict[str, Any], source: Path) -> None:
    """Refuse to commit a fixture that would leak a precise location."""
    coordinates = payload.get("origin", {}).get("coordinates", {})
    for axis in ("lat", "lon"):
        value = coordinates.get(axis)
        if value is None:
            raise SystemExit(f"{source}: missing origin.{axis}")
        if round(value, ORIGIN_DECIMALS) != value:
            raise SystemExit(
                f"{source}: origin.{axis}={value} is more precise than "
                f"{ORIGIN_DECIMALS} decimals; round it before committing"
            )


def build_real_mission(source: Path) -> None:
    payload = json.loads(source.read_text(encoding="utf-8"))
    assert_origin_is_coarse(payload, source)
    payload.pop("filename", None)
    write_fixture("real_mission_5col.v3.json", payload)


def build_reference_excerpt(source: Path) -> None:
    payload = json.loads(source.read_text(encoding="utf-8"))
    assert_origin_is_coarse(payload, source)
    payload.pop("filename", None)
    payload["points"] = payload.get("points", [])[:REFERENCE_SECTION_COUNT]
    write_fixture("real_mission_4col_excerpt.v3.json", payload)


def build_synthetic() -> None:
    origin = {"type": "WGS84", "coordinates": {"lat": 45.85, "lon": 3.17, "alt": 317.5}}
    columns = ["x", "y", "speed", "working_zone", "punctual"]

    # Smallest document the schema accepts: no geofencing, one straight section.
    write_fixture(
        "synthetic_minimal.v3.json",
        {
            "version": "3",
            "file_type": "mission_order",
            "vehicle_id": "v1",
            "origin": origin,
            "points": [
                {
                    "section_type": "row_path",
                    "columns": columns,
                    "values": [
                        [0.0, 0.0, 0.5, 1, {}],
                        [0.0, 1.0, 0.5, 1, {}],
                        [0.0, 2.0, 0.5, 1, {}],
                    ],
                }
            ],
            "metadata": {},
        },
    )

    # A section reduced to a single point: degenerate geometry that must not crash.
    write_fixture(
        "synthetic_single_point.v3.json",
        {
            "version": "3",
            "file_type": "draft",
            "vehicle_id": "v1",
            "origin": origin,
            "points": [
                {
                    "section_type": "row_path",
                    "columns": columns,
                    "values": [[0.0, 0.0, 0.5, 1, {}]],
                }
            ],
            "metadata": {},
        },
    )

    # An empty section: allowed by the schema, must not be silently dropped.
    write_fixture(
        "synthetic_empty_section.v3.json",
        {
            "version": "3",
            "file_type": "draft",
            "vehicle_id": "v1",
            "origin": origin,
            "points": [
                {"section_type": "row_path", "columns": columns, "values": []},
            ],
            "metadata": {},
        },
    )

    # Every section type in one document, plus a geofence and a transit section
    # (working_zone = 0), which is what the navigation stack uses to switch gains.
    write_fixture(
        "synthetic_all_section_types.v3.json",
        {
            "version": "3",
            "file_type": "mission_order",
            "vehicle_id": "v1",
            "origin": origin,
            "points": [
                {
                    "section_type": "row_line",
                    "columns": columns,
                    "values": [[0.0, 0.0, 0.5, 1, {}], [0.0, 10.0, 0.5, 1, {}]],
                },
                {
                    "section_type": "turn_path",
                    "columns": columns,
                    "values": [[0.0, 10.0, 0.3, 0, {}], [1.5, 11.5, 0.3, 0, {}]],
                },
                {
                    "section_type": "turn_square",
                    "columns": columns,
                    "values": [[1.5, 11.5, 0.3, 0, {}], [3.0, 10.0, 0.3, 0, {}]],
                },
                {
                    "section_type": "row_path",
                    "columns": columns,
                    "values": [[3.0, 10.0, 0.5, 1, {}], [3.0, 0.0, 0.5, 1, {}]],
                },
            ],
            "geofencing": {
                "columns": ["x", "y"],
                "values": [[-5.0, -5.0], [-5.0, 15.0], [8.0, 15.0], [8.0, -5.0]],
            },
            "metadata": {},
        },
    )

    # Legacy editor format: `sections[]` with wrapped values, migrated on read by
    # TrajectoryRepository._migrate_trajectory_format.
    write_fixture(
        "legacy_sections_format.json",
        {
            "version": "3",
            "fileType": {"value": "mission_order"},
            "vehicleId": "v1",
            "origin": origin,
            "sections": [
                {
                    "sectionType": {"value": "row_path"},
                    "columns": ["x", "y", "speed", "working_zone", "punctual"],
                    "points": [
                        {
                            "x": {"value": 0.0},
                            "y": {"value": 0.0},
                            "speed": {"value": 0.5},
                            "working_zone": {"value": 1},
                        },
                        {
                            "x": {"value": 0.0},
                            "y": {"value": 1.0},
                            "speed": {"value": 0.5},
                            "working_zone": {"value": 1},
                        },
                    ],
                }
            ],
            "metadata": {},
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--real-mission", type=Path, help="real 5-column mission order")
    parser.add_argument("--reference", type=Path, help="large 4-column reference mission")
    args = parser.parse_args()

    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)

    build_synthetic()
    if args.real_mission:
        build_real_mission(args.real_mission)
    if args.reference:
        build_reference_excerpt(args.reference)


if __name__ == "__main__":
    main()
