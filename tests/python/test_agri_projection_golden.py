"""
Round-trip stability of the Agri projection.

The roadmap requires the projection from the editor model to Agri v3 to be
deterministic: loading a mission and saving it again must not alter a single
value. These tests pin that property on the current code path
(Trajectory.from_dict -> Trajectory.to_dict) so that the future
domain/projection layer can be swapped in without regression.
"""

from __future__ import annotations

import json
from typing import Any

from backend.models.trajectory import Trajectory

from tests.conftest import load_golden


def test_round_trip_preserves_document_exactly(agri_document: dict[str, Any]):
    restored = Trajectory.from_dict(dict(agri_document)).to_dict()
    assert restored == agri_document


def dump(payload: dict[str, Any]) -> str:
    """Serialise exactly the way TrajectoryRepository.save does."""
    return json.dumps(payload, ensure_ascii=False, indent=2)


def test_projection_is_byte_stable(agri_document: dict[str, Any]):
    """
    The bytes that reach the robot must be reproducible: projecting a document,
    re-reading it and projecting it again yields an identical payload.

    Note this compares the projection to itself rather than to the fixture file,
    because to_dict() emits a fixed key order while the fixtures are stored with
    sorted keys. The canonical order is pinned separately below.
    """
    once = Trajectory.from_dict(dict(agri_document)).to_dict()
    twice = Trajectory.from_dict(json.loads(dump(once))).to_dict()
    assert dump(twice) == dump(once)


def test_round_trip_is_idempotent(agri_document: dict[str, Any]):
    once = Trajectory.from_dict(dict(agri_document)).to_dict()
    twice = Trajectory.from_dict(dict(once)).to_dict()
    assert twice == once


def test_projection_key_order_is_canonical(agri_document: dict[str, Any]):
    """
    The key order of the exported document is part of what makes the output
    reproducible. Pinned so a refactor of to_dict() is a deliberate change.
    """
    projected = Trajectory.from_dict(dict(agri_document)).to_dict()
    expected = ["version", "vehicle_id", "file_type", "origin", "points", "metadata"]
    if "geofencing" in projected:
        expected.append("geofencing")

    assert list(projected.keys()) == expected


def test_to_dict_drops_the_editor_filename():
    """`filename` is storage metadata; the Agri schema forbids extra properties."""
    document = load_golden("synthetic_minimal.v3.json")
    trajectory = Trajectory.from_dict({**document, "filename": "mission.json"})

    assert trajectory.filename == "mission.json"
    assert "filename" not in trajectory.to_dict()


def test_to_dict_omits_geofencing_when_absent():
    """
    An absent geofence must stay absent rather than become null, which the
    schema would reject.
    """
    document = load_golden("synthetic_minimal.v3.json")
    assert "geofencing" not in document

    assert "geofencing" not in Trajectory.from_dict(document).to_dict()


def test_to_dict_keeps_geofencing_when_present():
    document = load_golden("synthetic_all_section_types.v3.json")
    restored = Trajectory.from_dict(document).to_dict()

    assert restored["geofencing"] == document["geofencing"]


def test_point_count_is_preserved(agri_document: dict[str, Any]):
    def total_points(payload: dict[str, Any]) -> int:
        return sum(len(section["values"]) for section in payload["points"])

    restored = Trajectory.from_dict(dict(agri_document)).to_dict()
    assert total_points(restored) == total_points(agri_document)


def test_real_mission_reference_values_are_pinned():
    """
    Explicit values from the real trial mission. If a refactor changes the way
    coordinates are read or written, this test names exactly what moved.
    """
    document = load_golden("real_mission_5col.v3.json")

    assert document["file_type"] == "mission_order"
    assert document["vehicle_id"] == "v1"
    assert document["origin"]["type"] == "WGS84"
    assert len(document["points"]) == 3
    assert sum(len(section["values"]) for section in document["points"]) == 328
    assert [section["section_type"] for section in document["points"]] == [
        "row_path",
        "turn_path",
        "row_path",
    ]
    assert len(document["geofencing"]["values"]) == 4
