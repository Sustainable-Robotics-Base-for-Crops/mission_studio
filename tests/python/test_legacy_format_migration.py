"""
Migration of the pre-v3 editor format.

Files saved by earlier versions of the editor use a `sections[]` layout with
wrapped values. The repository migrates them on read. Missions produced years
ago must keep opening, so this behaviour is pinned before the domain refactor.
"""

from __future__ import annotations

import json
from typing import Any

from backend.repositories.trajectory_repository import TrajectoryRepository

from tests.conftest import LEGACY_FIXTURE, load_golden


class InMemoryBackend:
    """Minimal storage backend standing in for LocalStorageBackend."""

    def __init__(self, files: dict[str, str] | None = None):
        self.files: dict[str, str] = files or {}
        self.deleted: list[str] = []

    def save(self, filepath: str, content: str) -> bool:
        self.files[filepath] = content
        return True

    def load(self, filepath: str) -> str | None:
        return self.files.get(filepath)

    def delete(self, filepath: str) -> bool:
        if filepath in self.files:
            del self.files[filepath]
            self.deleted.append(filepath)
            return True
        return False

    def list(self, metadata_only: bool = False) -> list[dict[str, Any]]:
        return [{"fullPath": path, "filename": path.split("/")[-1]} for path in self.files]


def make_repository(
    documents: dict[str, dict[str, Any]],
) -> tuple[TrajectoryRepository, InMemoryBackend]:
    backend = InMemoryBackend(
        {path: json.dumps(payload, ensure_ascii=False) for path, payload in documents.items()}
    )
    return TrajectoryRepository({"local": backend}), backend


class TestLegacyMigration:
    def test_legacy_document_is_migrated_on_load(self):
        legacy = load_golden(LEGACY_FIXTURE)
        repository, _ = make_repository({"mission_order/v1/legacy.json": legacy})

        trajectory = repository.load("mission_order/v1/legacy.json")

        assert trajectory is not None
        assert trajectory.file_type == "mission_order"
        assert trajectory.vehicle_id == "v1"
        assert len(trajectory.points) == 1

    def test_wrapped_values_are_flattened_into_rows(self):
        legacy = load_golden(LEGACY_FIXTURE)
        repository, _ = make_repository({"mission_order/v1/legacy.json": legacy})

        trajectory = repository.load("mission_order/v1/legacy.json")
        section = trajectory.points[0]

        assert section["section_type"] == "row_path"
        assert section["columns"] == ["x", "y", "speed", "working_zone", "punctual"]
        assert section["values"] == [
            [0.0, 0.0, 0.5, 1, {}],
            [0.0, 1.0, 0.5, 1, {}],
        ]

    def test_migrated_document_conforms_to_agri_schema(self, agri_schema):
        from jsonschema import Draft202012Validator

        legacy = load_golden(LEGACY_FIXTURE)
        repository, _ = make_repository({"mission_order/v1/legacy.json": legacy})

        trajectory = repository.load("mission_order/v1/legacy.json")
        document = trajectory.to_dict()
        document.pop("geofencing", None)

        errors = list(Draft202012Validator(agri_schema).iter_errors(document))
        assert not errors, [error.message for error in errors]

    def test_camel_case_keys_are_migrated(self):
        repository, _ = make_repository(
            {
                "draft/v1/camel.json": {
                    "version": "3",
                    "fileType": {"value": "draft"},
                    "vehicleId": "v7",
                    "origin": {
                        "type": "WGS84",
                        "coordinates": {"lat": 45.85, "lon": 3.17, "alt": 0.0},
                    },
                    "points": [],
                }
            }
        )

        trajectory = repository.load("draft/v1/camel.json")

        assert trajectory.vehicle_id == "v7"
        assert trajectory.file_type == "draft"

    def test_missing_columns_are_filled_with_defaults(self):
        """A legacy point without speed yields 0.0, and punctual yields {}."""
        repository, _ = make_repository(
            {
                "draft/v1/sparse.json": {
                    "version": "3",
                    "file_type": "draft",
                    "vehicle_id": "v1",
                    "origin": {
                        "type": "WGS84",
                        "coordinates": {"lat": 45.85, "lon": 3.17, "alt": 0.0},
                    },
                    "sections": [
                        {
                            "sectionType": {"value": "row_path"},
                            "columns": ["x", "y", "speed", "punctual"],
                            "points": [{"x": {"value": 1.0}, "y": {"value": 2.0}}],
                        }
                    ],
                }
            }
        )

        trajectory = repository.load("draft/v1/sparse.json")

        assert trajectory.points[0]["values"] == [[1.0, 2.0, 0.0, {}]]


class TestModernDocumentsAreUntouched:
    def test_v3_document_is_loaded_without_migration(self, agri_document):
        repository, _ = make_repository({"mission_order/v1/mission.json": agri_document})

        trajectory = repository.load("mission_order/v1/mission.json")

        assert trajectory is not None
        assert trajectory.to_dict() == agri_document

    def test_url_encoded_path_is_decoded(self):
        document = load_golden("synthetic_minimal.v3.json")
        repository, _ = make_repository({"mission_order/v1/my mission.json": document})

        assert repository.load("mission_order/v1/my%20mission.json") is not None


class TestLoadFailures:
    def test_invalid_json_returns_none(self):
        backend = InMemoryBackend({"draft/v1/broken.json": "{ not json"})
        repository = TrajectoryRepository({"local": backend})

        assert repository.load("draft/v1/broken.json") is None

    def test_business_invalid_document_returns_none(self):
        """An out-of-range origin must not be served to the editor."""
        repository, _ = make_repository(
            {
                "draft/v1/bad_origin.json": {
                    "version": "3",
                    "file_type": "draft",
                    "vehicle_id": "v1",
                    "origin": {
                        "type": "WGS84",
                        "coordinates": {"lat": 999.0, "lon": 3.17, "alt": 0.0},
                    },
                    "points": [],
                }
            }
        )

        assert repository.load("draft/v1/bad_origin.json") is None

    def test_absent_file_returns_none(self):
        repository, _ = make_repository({})
        assert repository.load("draft/v1/absent.json") is None


class TestSavePath:
    def test_save_uses_file_type_then_vehicle_then_filename(self):
        from backend.models.trajectory import Trajectory

        repository, backend = make_repository({})
        trajectory = Trajectory.from_dict(
            {**load_golden("synthetic_minimal.v3.json"), "filename": "mission.json"}
        )

        result = repository.save(trajectory, user_id="anonymous")

        assert result["success"] is True
        assert result["path"] == "mission_order/v1/mission.json"
        assert "mission_order/v1/mission.json" in backend.files

    def test_saved_content_carries_no_filename(self):
        from backend.models.trajectory import Trajectory

        repository, backend = make_repository({})
        trajectory = Trajectory.from_dict(
            {**load_golden("synthetic_minimal.v3.json"), "filename": "mission.json"}
        )
        repository.save(trajectory, user_id="anonymous")

        saved = json.loads(backend.files["mission_order/v1/mission.json"])
        assert "filename" not in saved

    def test_save_then_load_is_lossless(self):
        from backend.models.trajectory import Trajectory

        repository, _ = make_repository({})
        source = load_golden("synthetic_all_section_types.v3.json")
        trajectory = Trajectory.from_dict({**source, "filename": "mission.json"})
        repository.save(trajectory, user_id="anonymous")

        reloaded = repository.load("mission_order/v1/mission.json")

        assert reloaded is not None
        assert reloaded.to_dict() == source


class TestListing:
    def test_files_are_grouped_by_type_and_vehicle(self):
        document = load_golden("synthetic_minimal.v3.json")
        repository, _ = make_repository(
            {
                "mission_order/v1/a.json": document,
                "mission_order/v1/b.json": document,
                "draft/v2/c.json": document,
            }
        )

        groups = {group["type"]: group for group in repository.list()}

        assert set(groups) == {"mission_order", "draft"}
        assert len(groups["mission_order"]["vehicles"]["v1"]) == 2
        assert len(groups["draft"]["vehicles"]["v2"]) == 1

    def test_legacy_two_segment_path_is_normalised_to_draft(self):
        """Objects stored as vehicle/file remain listable under the draft group."""
        document = load_golden("synthetic_minimal.v3.json")
        repository, _ = make_repository({"v1/orphan.json": document})

        groups = {group["type"]: group for group in repository.list()}

        assert "draft" in groups
        assert "v1" in groups["draft"]["vehicles"]
