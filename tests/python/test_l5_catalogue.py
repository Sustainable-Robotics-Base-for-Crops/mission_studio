"""L5 field catalogue and job queue (SQLite), independent of FastAPI."""

from __future__ import annotations

from backend.db import Database
from backend.fields.geojson import export_geojson, import_geojson
from backend.fields.geometry import polygon_area_m2, provenance_qualified
from backend.fields.repository import FieldRepository
from backend.jobs import JobQueue

SQUARE = {
    "type": "Polygon",
    "coordinates": [
        [
            [3.17, 45.85],
            [3.171, 45.85],
            [3.171, 45.851],
            [3.17, 45.851],
            [3.17, 45.85],
        ]
    ],
}

LINE = {"type": "LineString", "coordinates": [[3.17, 45.85], [3.171, 45.851]]}
POINT = {"type": "Point", "coordinates": [3.1705, 45.8505]}


def _repo(tmp_path) -> FieldRepository:
    return FieldRepository(Database(str(tmp_path / "cat.sqlite")))


def test_provenance_requires_source_method_and_accuracy():
    assert provenance_qualified({}) is False
    assert provenance_qualified({"source": "survey", "method": "RTK", "h_accuracy_m": 0.03}) is True


def test_polygon_area_is_positive():
    area = polygon_area_m2(SQUARE)
    assert area is not None and area > 1000


def test_create_field_snapshots_and_rejects_unqualified_geometry(tmp_path):
    repo = _repo(tmp_path)
    field = repo.create_field("Nord", SQUARE)
    assert field["qualified_for_autonomy"] is False
    assert field["version"] == 1
    assert len(repo.list_versions(field["id"])) == 1


def test_zone_kinds_and_version_diff(tmp_path):
    repo = _repo(tmp_path)
    field = repo.create_field("Nord", SQUARE)
    repo.add_zone(field["id"], "autonomy", SQUARE, name="ODD")
    versions = repo.list_versions(field["id"])
    assert [item["version"] for item in versions] == [1, 2]
    diff = repo.diff_versions(field["id"], 1, 2)
    assert diff["geometry_changed"] is True
    assert diff["zones_from"] == 0
    assert diff["zones_to"] == 1


def test_french_zone_alias_is_canonicalized(tmp_path):
    repo = _repo(tmp_path)
    field = repo.create_field("Nord", SQUARE)
    zone = repo.add_zone(field["id"], "autonomie", SQUARE, name="ODD")
    assert zone["kind"] == "autonomy"


def test_gnss_degraded_zone_kind(tmp_path):
    repo = _repo(tmp_path)
    field = repo.create_field("Nord", SQUARE)
    zone = repo.add_zone(field["id"], "gnss dégradé", SQUARE, name="Coulée")
    assert zone["kind"] == "gnss_degraded"


def test_unknown_zone_kind_is_rejected(tmp_path):
    repo = _repo(tmp_path)
    field = repo.create_field("Nord", SQUARE)
    try:
        repo.add_zone(field["id"], "banana", SQUARE)
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "banana" in str(exc)


def test_qualified_provenance_and_patch_delete(tmp_path):
    repo = _repo(tmp_path)
    field = repo.create_field(
        "Nord",
        SQUARE,
        provenance={"source": "survey", "method": "RTK", "h_accuracy_m": 0.03},
    )
    assert field["qualified_for_autonomy"] is True
    updated = repo.update_field(field["id"], {"name": "Nord 2", "campaign": "2026"})
    assert updated is not None
    assert updated["name"] == "Nord 2"
    assert updated["campaign"] == "2026"
    assert repo.delete_field(field["id"]) is True
    assert repo.get_field(field["id"]) is None


def test_field_change_invalidates_linked_missions(tmp_path):
    repo = _repo(tmp_path)
    field = repo.create_field("Nord", SQUARE)
    repo.link_mission(field["id"], "mission_order/v1/demo.json")
    assert repo.impact(field["id"])["invalidated_count"] == 0
    repo.add_obstacle(field["id"], POINT, category="pole", margin_m=1.5)
    impact = repo.impact(field["id"])
    assert impact["invalidated_count"] == 1
    assert "1 mission" in (impact["banner"] or "")


def test_geojson_import_export_roundtrip(tmp_path):
    repo = _repo(tmp_path)
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "A", "srbc_kind": "field"},
                "geometry": SQUARE,
            },
            {
                "type": "Feature",
                "properties": {"srbc_kind": "zone", "zone_kind": "autonomie", "name": "ODD"},
                "geometry": SQUARE,
            },
            {
                "type": "Feature",
                "properties": {"srbc_kind": "guidance_line", "name": "A1"},
                "geometry": LINE,
            },
            {
                "type": "Feature",
                "properties": {"srbc_kind": "obstacle", "category": "tree"},
                "geometry": POINT,
            },
        ],
    }
    report = import_geojson(repo, collection)
    assert report["ok"] is True
    assert report["created"] == {
        "zones": 1,
        "obstacles": 1,
        "guidance_lines": 1,
        "rows": 0,
        "traffic_ways": 0,
        "traffic_nodes": 0,
        "landmarks": 0,
    }
    exported = export_geojson(report["field"])
    kinds = [feature["properties"]["srbc_kind"] for feature in exported["features"]]
    assert kinds == ["field", "zone", "obstacle", "guidance_line"]


def test_echo_job_runs_inline(tmp_path):
    queue = JobQueue(Database(str(tmp_path / "jobs.sqlite")))
    job = queue.enqueue("echo", {"hello": "world"})
    assert job["status"] == "queued"
    assert queue.process_one() is True
    done = queue.get(job["id"])
    assert done["status"] == "succeeded"
    assert done["result"] == {"hello": "world"}


def test_unknown_job_kind_fails(tmp_path):
    queue = JobQueue(Database(str(tmp_path / "jobs.sqlite")))
    job = queue.enqueue("optimize", {})
    queue.process_one()
    done = queue.get(job["id"])
    assert done["status"] == "failed"
    assert "unknown job kind" in done["error"]
