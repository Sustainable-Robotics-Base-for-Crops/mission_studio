"""L13 — the farm index is derived, never authoritative (decision D13-01)."""

from __future__ import annotations

import json
import os
import shutil
import sqlite3

import pytest

from backend.db import SCHEMA_VERSION as STUDIO_SCHEMA_VERSION
from backend.farm.index import (
    INDEX_SCHEMA_VERSION,
    missions_for_field,
    open_index,
    reindex,
)
from backend.farm.layout import STUDIO_DIR, ensure_farm, index_path


def _mission(field_id: str, operation: str = "semis", simulated: bool = False) -> dict:
    metadata: dict = {
        "srbc_mission_brief": {
            "field_id": field_id,
            "operation": operation,
            "campaign": "2026",
        }
    }
    if simulated:
        metadata["srbc_simulation"] = {"fingerprint": "abc"}
    return {
        "version": "3",
        "vehicle_id": "v1",
        "file_type": "mission_order",
        "origin": {"type": "WGS84", "coordinates": {"lat": 45.85, "lon": 3.17}},
        "points": [],
        "metadata": metadata,
    }


def _field_geojson(name: str) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"kind": "field", "name": name},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [[1.0, 46.0], [1.01, 46.0], [1.01, 46.01], [1.0, 46.01], [1.0, 46.0]]
                    ],
                },
            }
        ],
    }


@pytest.fixture
def farm(tmp_path):
    """A farm with two fields, three missions and one performed work."""
    root = str(tmp_path / "Ferme XY")
    ensure_farm(root, "Ferme XY")

    for name in ("parcelle-04", "vigne-haut"):
        with open(
            os.path.join(root, "parcel_map", f"{name}.geojson"), "w", encoding="utf-8"
        ) as handle:
            json.dump(_field_geojson(name), handle)

    missions = {
        "2026-08-20_parcelle-04_semis.json": _mission("field-4", "semis", simulated=True),
        "2026-08-21_parcelle-04_binage.json": _mission("field-4", "binage"),
        "2026-08-22_vigne-haut_binage.json": _mission("field-9", "binage"),
    }
    for name, document in missions.items():
        with open(os.path.join(root, "mission_order", name), "w", encoding="utf-8") as handle:
            json.dump(document, handle)

    with open(
        os.path.join(root, "work_performed", "2026-08-20_parcelle-04_semis.json"),
        "w",
        encoding="utf-8",
    ) as handle:
        json.dump({**_mission("field-4", "semis"), "file_type": "work_performed"}, handle)

    return root


def _rows(root: str, table: str) -> list[sqlite3.Row]:
    connection = open_index(root)
    try:
        return connection.execute(f"SELECT * FROM {table}").fetchall()
    finally:
        connection.close()


# -- schema ------------------------------------------------------------------


def test_open_index_creates_the_database_inside_the_farm(farm):
    open_index(farm).close()

    assert os.path.isfile(index_path(farm))
    assert index_path(farm).startswith(os.path.join(farm, STUDIO_DIR))


def test_the_farm_index_is_separate_from_the_studio_database(farm):
    connection = open_index(farm)
    try:
        version = connection.execute(
            "SELECT value FROM index_meta WHERE key = 'schema_version'"
        ).fetchone()["value"]
        tables = {
            row["name"]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    finally:
        connection.close()

    assert int(version) == INDEX_SCHEMA_VERSION
    assert INDEX_SCHEMA_VERSION != STUDIO_SCHEMA_VERSION
    assert "fields" not in tables, "the farm index must not shadow the studio catalogue"
    assert {"farm_files", "farm_missions"} <= tables


# -- rebuilding --------------------------------------------------------------


def test_reindex_counts_every_folder(farm):
    result = reindex(farm)

    assert result["counts"] == {
        "parcel_map": 2,
        "mission_order": 3,
        "work_performed": 1,
        "equipment": 0,
    }
    assert result["errors"] == 0
    assert len(_rows(farm, "farm_files")) == 6
    assert len(_rows(farm, "farm_missions")) == 4


def test_reindex_is_idempotent(farm):
    first = reindex(farm)
    rows_first = [dict(row) for row in _rows(farm, "farm_missions")]

    second = reindex(farm)

    assert second["counts"] == first["counts"]
    assert [dict(row) for row in _rows(farm, "farm_missions")] == rows_first


def test_deleting_the_studio_folder_rebuilds_an_identical_state(farm):
    reindex(farm)
    before = [dict(row) for row in _rows(farm, "farm_files")]

    shutil.rmtree(os.path.join(farm, STUDIO_DIR))
    assert not os.path.exists(index_path(farm))
    reindex(farm)

    assert [dict(row) for row in _rows(farm, "farm_files")] == before


def test_reindex_drops_files_that_disappeared(farm):
    reindex(farm)
    os.remove(os.path.join(farm, "mission_order", "2026-08-22_vigne-haut_binage.json"))

    result = reindex(farm)

    assert result["counts"]["mission_order"] == 2
    paths = {row["path"] for row in _rows(farm, "farm_files")}
    assert "mission_order/2026-08-22_vigne-haut_binage.json" not in paths


def test_reindex_records_the_simulation_state(farm):
    reindex(farm)

    rows = {row["path"]: row for row in _rows(farm, "farm_missions")}

    assert rows["mission_order/2026-08-20_parcelle-04_semis.json"]["simulated"] == 1
    assert rows["mission_order/2026-08-21_parcelle-04_binage.json"]["simulated"] == 0


def test_a_mission_and_its_performed_work_share_a_name_without_colliding(farm):
    """
    Naming convention of CdC §2.3: performed work carries the name of the mission it
    came from. Only the folder tells them apart, so the index must key on the path.
    """
    reindex(farm)

    shared = [
        row["path"]
        for row in _rows(farm, "farm_missions")
        if row["name"] == "2026-08-20_parcelle-04_semis.json"
    ]

    assert sorted(shared) == [
        "mission_order/2026-08-20_parcelle-04_semis.json",
        "work_performed/2026-08-20_parcelle-04_semis.json",
    ]


def test_a_corrupted_mission_is_counted_as_an_error_and_still_indexed(farm):
    with open(os.path.join(farm, "mission_order", "broken.json"), "w", encoding="utf-8") as handle:
        handle.write("{ not json")

    result = reindex(farm)

    assert result["errors"] == 1
    assert result["counts"]["mission_order"] == 4
    paths = {row["path"] for row in _rows(farm, "farm_files")}
    assert "mission_order/broken.json" in paths


def test_reindex_on_an_empty_farm_reports_zeros(tmp_path):
    root = str(tmp_path / "empty")
    ensure_farm(root)

    result = reindex(root)

    assert set(result["counts"].values()) == {0}
    assert result["errors"] == 0


# -- querying ----------------------------------------------------------------


def test_missions_for_field_filters_and_includes_performed_work(farm):
    reindex(farm)

    matches = missions_for_field(farm, "field-4")

    assert len(matches) == 3
    assert {match["kind"] for match in matches} == {"mission_order", "work_performed"}
    assert all(match["field_id"] == "field-4" for match in matches)


def test_missions_for_field_is_newest_first(farm):
    reindex(farm)

    modified = [match["modified"] for match in missions_for_field(farm, "field-4")]

    assert modified == sorted(modified, reverse=True)


def test_missions_for_field_ignores_an_unknown_field(farm):
    reindex(farm)

    assert missions_for_field(farm, "field-404") == []
    assert missions_for_field(farm, "") == []


def test_missions_for_field_works_before_any_reindex(farm):
    """The files are the truth: an answer must not require someone to reindex first."""
    assert not os.path.exists(index_path(farm))

    matches = missions_for_field(farm, "field-9")

    assert [match["operation"] for match in matches] == ["binage"]
