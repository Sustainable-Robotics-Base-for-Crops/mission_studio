"""
The robot contract: every document the editor produces must be accepted by the
Agri JSON Schema consumed by json_agri_format_parser.

These tests are the safety net that allows the editor internals to be
refactored without silently breaking navigation.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from tests.conftest import SIBLING_SCHEMA, VENDORED_SCHEMA, load_golden

EXPECTED_SECTION_TYPES = {"row_path", "row_line", "turn_path", "turn_square"}


def test_vendored_schema_matches_sibling_checkout():
    """
    The vendored schema exists so CI can run standalone. If the parser repository
    is checked out next to this one, both copies must be identical: a drift here
    means the editor is validating against an outdated contract.
    """
    if not SIBLING_SCHEMA.exists():
        pytest.skip("json_agri_format_parser not checked out next to this repository")

    vendored = json.loads(VENDORED_SCHEMA.read_text(encoding="utf-8"))
    upstream = json.loads(SIBLING_SCHEMA.read_text(encoding="utf-8"))
    assert vendored == upstream, (
        "tests/schema/Agri.json is out of date; refresh it from "
        "json_agri_format_parser/schema/Agri.json and re-run the suite"
    )


def test_schema_itself_is_valid(agri_schema: dict[str, Any]):
    Draft202012Validator.check_schema(agri_schema)


def test_golden_fixture_conforms_to_schema(
    agri_schema: dict[str, Any], agri_document: dict[str, Any], agri_fixture_name: str
):
    validator = Draft202012Validator(agri_schema)
    errors = sorted(validator.iter_errors(agri_document), key=lambda error: list(error.path))
    formatted = [
        f"{'/'.join(str(part) for part in error.path) or '<root>'}: {error.message}"
        for error in errors
    ]
    assert not errors, f"{agri_fixture_name} violates Agri v3: {formatted}"


def test_golden_fixture_declares_version_3(agri_document: dict[str, Any]):
    assert agri_document["version"] == "3"


def test_golden_fixture_carries_no_editor_filename(agri_document: dict[str, Any]):
    """`filename` is editor storage metadata and is forbidden by the Agri schema."""
    assert "filename" not in agri_document


def test_golden_fixture_never_uses_null_geofencing(agri_document: dict[str, Any]):
    """
    A geofence is optional, but it must be absent rather than null: the schema
    requires an object, and the parser builds a PolygonStamped from it.
    """
    assert agri_document.get("geofencing", "absent") is not None


def test_section_types_are_known_to_the_navigation_stack(agri_document: dict[str, Any]):
    """
    The schema accepts any string for section_type. The navigation stack does not:
    only these four values have a meaning downstream.
    """
    for section in agri_document["points"]:
        section_type = section.get("section_type")
        if section_type is not None:
            assert section_type in EXPECTED_SECTION_TYPES


def test_every_row_matches_its_column_count(agri_document: dict[str, Any]):
    """Structural invariant the schema cannot express: rows are column-aligned."""
    for index, section in enumerate(agri_document["points"]):
        column_count = len(section["columns"])
        for row_index, row in enumerate(section["values"]):
            assert len(row) == column_count, (
                f"section {index} row {row_index}: {len(row)} values " f"for {column_count} columns"
            )


def test_geofence_uses_planar_coordinates_only(agri_document: dict[str, Any]):
    """The parser reads x and y from the geofence and ignores anything else."""
    geofence = agri_document.get("geofencing")
    if geofence is None:
        pytest.skip("fixture has no geofence")

    assert geofence["columns"][:2] == ["x", "y"]
    assert len(geofence["values"]) >= 3, "a polygon needs at least three vertices"


@pytest.mark.parametrize(
    ("fixture_name", "expected_columns"),
    [
        ("real_mission_5col.v3.json", ["x", "y", "speed", "working_zone", "punctual"]),
        ("real_mission_4col_excerpt.v3.json", ["x", "y", "speed", "working_zone"]),
    ],
)
def test_real_missions_pin_both_column_layouts(fixture_name: str, expected_columns: list[str]):
    """
    Both column layouts are in the wild: the five-column one produced by the
    current editor, and the four-column one of the reference mission. Neither
    may stop being supported.
    """
    document = load_golden(fixture_name)
    for section in document["points"]:
        assert section["columns"] == expected_columns


def test_working_zone_is_binary(agri_document: dict[str, Any]):
    """
    working_zone drives the gain switch in nav_path_follow
    (in_working_zone / out_working_zone). Only 0 and 1 are meaningful.
    """
    for section in agri_document["points"]:
        if "working_zone" not in section["columns"]:
            continue
        index = section["columns"].index("working_zone")
        for row in section["values"]:
            assert row[index] in (0, 1), f"unexpected working_zone value {row[index]!r}"


def test_speed_stays_within_vehicle_bounds(agri_document: dict[str, Any]):
    """Speeds are metres per second, bounded by SPEED_MIN / SPEED_MAX."""
    from backend.constants import SPEED_MAX, SPEED_MIN

    for section in agri_document["points"]:
        if "speed" not in section["columns"]:
            continue
        index = section["columns"].index("speed")
        for row in section["values"]:
            assert SPEED_MIN <= row[index] <= SPEED_MAX
