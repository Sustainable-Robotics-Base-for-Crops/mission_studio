"""
Behaviour of ValidationService.

Save is the only path that validates against the Agri schema, so these tests
guard the last barrier before a document reaches storage and then the robot.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.constants import MAX_FILE_SIZE
from backend.services.validation_service import ValidationService

from tests.conftest import load_golden


@pytest.fixture
def with_agri_schema(monkeypatch: pytest.MonkeyPatch, agri_schema_path: Path):
    monkeypatch.setenv("AGRI_SCHEMA_PATH", str(agri_schema_path))
    return agri_schema_path


class TestAgriDocumentPreparation:
    def test_filename_is_stripped(self):
        document = ValidationService._as_agri_document(
            {**load_golden("synthetic_minimal.v3.json"), "filename": "mission.json"}
        )
        assert "filename" not in document

    def test_null_geofencing_is_removed(self):
        document = ValidationService._as_agri_document(
            {**load_golden("synthetic_minimal.v3.json"), "geofencing": None}
        )
        assert "geofencing" not in document

    def test_real_geofencing_is_kept(self):
        source = load_golden("synthetic_all_section_types.v3.json")
        document = ValidationService._as_agri_document(source)
        assert document["geofencing"] == source["geofencing"]

    def test_non_object_payload_is_rejected(self):
        with pytest.raises(ValueError, match="must be a JSON object"):
            ValidationService._as_agri_document(["not", "an", "object"])


class TestAgriSchemaValidation:
    def test_golden_fixtures_pass(self, with_agri_schema, agri_document, agri_fixture_name):
        ValidationService.validate_agri_schema(agri_document)

    def test_unknown_top_level_property_is_rejected(self, with_agri_schema):
        """The Agri schema sets additionalProperties: false."""
        document = {**load_golden("synthetic_minimal.v3.json"), "unexpected": 1}
        with pytest.raises(ValueError, match="Invalid Agri schema"):
            ValidationService.validate_agri_schema(document)

    def test_missing_required_field_is_rejected(self, with_agri_schema):
        document = load_golden("synthetic_minimal.v3.json")
        del document["origin"]
        with pytest.raises(ValueError, match="Invalid Agri schema"):
            ValidationService.validate_agri_schema(document)

    def test_numeric_version_is_rejected(self, with_agri_schema):
        """version is a string in Agri v3; the integer 3 is not valid."""
        document = {**load_golden("synthetic_minimal.v3.json"), "version": 3}
        with pytest.raises(ValueError, match="Invalid Agri schema"):
            ValidationService.validate_agri_schema(document)

    def test_validation_is_skipped_when_unconfigured(self, monkeypatch: pytest.MonkeyPatch):
        """
        The public core deliberately treats the schema as opt-in: a deployment
        without AGRI_SCHEMA_PATH must not fail to save.
        """
        monkeypatch.delenv("AGRI_SCHEMA_PATH", raising=False)
        ValidationService.validate_agri_schema({"anything": True})

    @pytest.mark.parametrize("disabled", ["", "none", "false", "disabled", "  "])
    def test_validation_can_be_explicitly_disabled(
        self, monkeypatch: pytest.MonkeyPatch, disabled: str
    ):
        monkeypatch.setenv("AGRI_SCHEMA_PATH", disabled)
        ValidationService.validate_agri_schema({"anything": True})

    def test_missing_schema_file_disables_validation_instead_of_blocking(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ):
        monkeypatch.setenv("AGRI_SCHEMA_PATH", str(tmp_path / "absent.json"))
        ValidationService.validate_agri_schema({"anything": True})

    def test_malformed_schema_file_disables_validation_instead_of_blocking(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ):
        broken = tmp_path / "broken.json"
        broken.write_text("{ not json", encoding="utf-8")
        monkeypatch.setenv("AGRI_SCHEMA_PATH", str(broken))
        ValidationService.validate_agri_schema({"anything": True})


class TestContentValidation:
    def test_golden_fixtures_pass(self, agri_document, agri_fixture_name):
        ValidationService.validate_trajectory_content(agri_document)

    def test_missing_version_is_rejected(self):
        document = load_golden("synthetic_minimal.v3.json")
        del document["version"]
        with pytest.raises(ValueError, match="Mandatory field 'version' missing"):
            ValidationService.validate_trajectory_content(document)

    def test_unsupported_version_is_rejected(self):
        document = {**load_golden("synthetic_minimal.v3.json"), "version": "9"}
        with pytest.raises(ValueError, match="not supported"):
            ValidationService.validate_trajectory_content(document)

    def test_embedded_html_is_rejected(self):
        document = load_golden("synthetic_minimal.v3.json")
        document["metadata"] = {"note": "<script>alert(1)</script>"}
        with pytest.raises(ValueError, match="HTML/scripts content forbidden"):
            ValidationService.validate_trajectory_content(document)

    def test_external_url_in_metadata_is_rejected(self):
        document = load_golden("synthetic_minimal.v3.json")
        document["metadata"] = {"source": "https://example.org/mission.json"}
        with pytest.raises(ValueError):
            ValidationService.validate_trajectory_content(document)


class TestNumericBounds:
    def test_golden_fixtures_pass(self, agri_document, agri_fixture_name):
        ValidationService.validate_numeric_bounds(agri_document)

    @pytest.mark.parametrize("speed", [-1.0, 50.1, 1000.0])
    def test_out_of_range_speed_is_rejected(self, speed: float):
        document = load_golden("synthetic_minimal.v3.json")
        document["points"][0]["values"][0][2] = speed
        with pytest.raises(ValueError, match="Invalid speed"):
            ValidationService.validate_numeric_bounds(document)

    def test_row_shorter_than_its_columns_is_rejected(self):
        document = load_golden("synthetic_minimal.v3.json")
        document["points"][0]["values"][0] = [0.0, 0.0]
        with pytest.raises(ValueError, match="Number of values incompatible with columns"):
            ValidationService.validate_numeric_bounds(document)

    @pytest.mark.parametrize(
        ("lat", "lon", "alt", "message"),
        [
            (91.0, 3.17, 0.0, "Invalid latitude"),
            (45.85, 181.0, 0.0, "Invalid longitude"),
            (45.85, 3.17, 20000.0, "Invalid altitude"),
            (45.85, 3.17, -2000.0, "Invalid altitude"),
        ],
    )
    def test_out_of_range_origin_is_rejected(
        self, lat: float, lon: float, alt: float, message: str
    ):
        document = load_golden("synthetic_minimal.v3.json")
        document["origin"] = {"type": "WGS84", "coordinates": {"lat": lat, "lon": lon, "alt": alt}}
        with pytest.raises(ValueError, match=message):
            ValidationService.validate_numeric_bounds(document)


class TestPathSanitisation:
    @pytest.mark.parametrize(
        "path",
        [
            "mission_order/v1/mission.json",
            "draft/v1/test_public.json",
            "a/b/c-d_e.json",
        ],
    )
    def test_legitimate_paths_are_accepted(self, path: str):
        assert ValidationService.sanitize_path(path) == path

    @pytest.mark.parametrize(
        "path",
        [
            "../../etc/passwd",
            "mission_order/../../secret.json",
            "/etc/passwd",
            "%2e%2e/secret.json",
            "mission//order.json",
            "mission\\\\order.json",
            "mission order.json",
            "mission;rm.json",
            "",
        ],
    )
    def test_dangerous_paths_are_rejected(self, path: str):
        with pytest.raises(ValueError):
            ValidationService.sanitize_path(path)


class TestUploadValidation:
    def test_json_upload_is_accepted(self):
        assert (
            ValidationService.validate_file_upload("mission.json", "application/json", 1024)
            == "mission.json"
        )

    def test_non_json_extension_is_rejected(self):
        with pytest.raises(ValueError, match="Only .json files"):
            ValidationService.validate_file_upload("mission.txt", "application/json", 1024)

    def test_wrong_mime_type_is_rejected(self):
        with pytest.raises(ValueError, match="Invalid MIME type"):
            ValidationService.validate_file_upload("mission.json", "text/html", 1024)

    def test_empty_mime_type_is_tolerated(self):
        """Some native WebView clients do not set a content type."""
        assert ValidationService.validate_file_upload("mission.json", "", 1024) == "mission.json"

    def test_oversized_file_is_rejected(self):
        with pytest.raises(ValueError, match="File too large"):
            ValidationService.validate_file_upload(
                "mission.json", "application/json", MAX_FILE_SIZE + 1
            )

    def test_size_limit_is_100_mb(self):
        """
        The limit is 100 MB, while the error message computed from MAX_FILE_SIZE
        historically read 5 MB in the docstring. Pinned to avoid a silent change.
        """
        assert MAX_FILE_SIZE == 100 * 1024 * 1024


class TestJsonParsing:
    def test_valid_json_is_parsed(self):
        assert ValidationService.validate_json('{"a": 1}') == {"a": 1}

    def test_invalid_json_raises_value_error(self):
        with pytest.raises(ValueError, match="Invalid JSON"):
            ValidationService.validate_json("{ not json")
