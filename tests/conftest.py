"""Shared pytest fixtures for the trajectory editor test suite."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

TESTS_DIR = Path(__file__).resolve().parent
GOLDEN_DIR = TESTS_DIR / "golden"
VENDORED_SCHEMA = TESTS_DIR / "schema" / "Agri.json"

# Sibling checkout of the parser repository. Present on a developer machine,
# absent in a standalone CI checkout, hence the vendored copy above.
SIBLING_SCHEMA = TESTS_DIR.parent.parent / "json_agri_format_parser" / "schema" / "Agri.json"

# Fixtures that must be accepted as-is by the Agri v3 schema.
AGRI_V3_FIXTURES = [
    "real_mission_5col.v3.json",
    "real_mission_4col_excerpt.v3.json",
    "synthetic_minimal.v3.json",
    "synthetic_single_point.v3.json",
    "synthetic_empty_section.v3.json",
    "synthetic_all_section_types.v3.json",
]

# Fixture using the pre-v3 editor layout, migrated on read by the repository.
LEGACY_FIXTURE = "legacy_sections_format.json"


def load_golden(name: str) -> dict[str, Any]:
    """Load a golden fixture by file name."""
    return json.loads((GOLDEN_DIR / name).read_text(encoding="utf-8"))


@pytest.fixture(params=AGRI_V3_FIXTURES)
def agri_fixture_name(request: pytest.FixtureRequest) -> str:
    """Parametrised name of every schema-conformant golden fixture."""
    return request.param


@pytest.fixture
def agri_document(agri_fixture_name: str) -> dict[str, Any]:
    """Parametrised content of every schema-conformant golden fixture."""
    return load_golden(agri_fixture_name)


@pytest.fixture
def agri_schema() -> dict[str, Any]:
    """The vendored Agri JSON Schema."""
    return json.loads(VENDORED_SCHEMA.read_text(encoding="utf-8"))


@pytest.fixture
def agri_schema_path() -> Path:
    """Path to the vendored Agri JSON Schema."""
    return VENDORED_SCHEMA


@pytest.fixture(autouse=True)
def reset_validation_service_cache():
    """
    Reset the ValidationService schema cache around every test.

    The service caches its validator in class attributes, so a test that
    configures AGRI_SCHEMA_PATH would otherwise leak into the next one.
    """
    from backend.services.validation_service import ValidationService

    def clear() -> None:
        ValidationService._agri_schema_validator = None
        ValidationService._agri_schema_checked = False

    clear()
    yield
    clear()


@pytest.fixture(autouse=True)
def isolate_sqlite(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep L5 SQLite out of the repo tree during tests."""
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "studio.sqlite"))
