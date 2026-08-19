"""Behaviour of the Trajectory model, including its known inconsistencies."""

from __future__ import annotations

import pytest

from backend.constants import SUPPORTED_TRAJECTORY_VERSIONS
from backend.models.trajectory import Trajectory

from tests.conftest import load_golden


def make_trajectory(**overrides) -> Trajectory:
    document = load_golden("synthetic_minimal.v3.json")
    return Trajectory.from_dict({**document, "filename": "mission.json", **overrides})


def test_golden_fixtures_validate(agri_document, agri_fixture_name):
    trajectory = Trajectory.from_dict({**agri_document, "filename": "mission.json"})
    assert trajectory.validate() == [], f"{agri_fixture_name} rejected by the model"


def test_from_dict_applies_defaults_for_an_empty_document():
    trajectory = Trajectory.from_dict({})

    assert trajectory.version == "3"
    assert trajectory.filename == "new_trajectory.json"
    assert trajectory.vehicle_id == "v1"
    assert trajectory.file_type == "draft"
    assert trajectory.origin["type"] == "WGS84"
    assert trajectory.points == []
    assert trajectory.metadata == {}
    assert trajectory.geofencing is None


def test_missing_filename_is_rejected():
    trajectory = make_trajectory(filename="")
    assert "The 'filename' field is required" in trajectory.validate()


@pytest.mark.parametrize("file_type", ["draft", "mission_order", "parcel_map"])
def test_accepted_file_types(file_type: str):
    assert make_trajectory(file_type=file_type).validate() == []


def test_work_performed_is_rejected_by_the_model_but_allowed_by_the_upload_schema():
    """
    Known inconsistency, documented rather than fixed here.

    Trajectory.validate() allows draft / mission_order / parcel_map, while
    ValidationService.TRAJECTORY_SCHEMA also lists work_performed. A file of that
    type therefore passes upload validation and is then rejected on load.
    Resolving it is a decision for the LS lot (Agri format evolution).
    """
    from backend.services.validation_service import ValidationService

    errors = make_trajectory(file_type="work_performed").validate()
    assert any("work_performed" in error for error in errors)

    upload_enum = ValidationService.TRAJECTORY_SCHEMA["properties"]["file_type"]["enum"]
    assert "work_performed" in upload_enum


def test_model_only_accepts_version_3_unlike_the_content_validator():
    """
    Second known inconsistency: constants declare 2.0 and 2.1 as supported,
    the model does not. Pinned so a future unification is a deliberate change.
    """
    assert SUPPORTED_TRAJECTORY_VERSIONS == ["3", "2.1", "2.0"]

    errors = make_trajectory(version="2.1").validate()
    assert any("not supported" in error for error in errors)


@pytest.mark.parametrize(
    ("lat", "lon", "expected_error"),
    [
        (91.0, 3.17, "Invalid latitude"),
        (-91.0, 3.17, "Invalid latitude"),
        (45.85, 181.0, "Invalid longitude"),
        (45.85, -181.0, "Invalid longitude"),
    ],
)
def test_out_of_range_origin_is_rejected(lat: float, lon: float, expected_error: str):
    trajectory = make_trajectory(
        origin={"type": "WGS84", "coordinates": {"lat": lat, "lon": lon, "alt": 0.0}}
    )
    assert any(expected_error in error for error in trajectory.validate())


def test_origin_without_coordinates_is_rejected():
    trajectory = make_trajectory(origin={"type": "WGS84"})
    assert "Origin must contain coordinates" in trajectory.validate()


def test_boundary_coordinates_are_accepted():
    trajectory = make_trajectory(
        origin={"type": "WGS84", "coordinates": {"lat": 90, "lon": 180, "alt": 0.0}}
    )
    assert trajectory.validate() == []
