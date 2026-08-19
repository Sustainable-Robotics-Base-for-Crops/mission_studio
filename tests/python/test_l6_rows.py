"""L6 catalogue row sets (permanent numbered rows)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.db import Database
from backend.fields.repository import FieldRepository


SQUARE = {
    "type": "Polygon",
    "coordinates": [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
}
LINE_A = {"type": "LineString", "coordinates": [[0, 0.0002], [0.001, 0.0002]]}
LINE_B = {"type": "LineString", "coordinates": [[0, 0.0006], [0.001, 0.0006]]}


def _client() -> TestClient:
    return TestClient(create_app())


def test_row_set_create_patch_delete_via_api():
    with _client() as client:
        created = client.post(
            "/api/v1/fields",
            json={"name": "Vigne", "geometry": SQUARE},
        )
        field_id = created.json()["id"]
        axis = client.post(
            f"/api/v1/fields/{field_id}/guidance-lines",
            json={
                "name": "AB",
                "geometry": {"type": "LineString", "coordinates": [[0, 0], [0.001, 0]]},
            },
        )
        assert axis.status_code == 201
        empty = client.post(
            f"/api/v1/fields/{field_id}/row-sets",
            json={"name": "Rangs", "spacing_m": 2.5, "rows": []},
        )
        assert empty.status_code == 400
        row_set = client.post(
            f"/api/v1/fields/{field_id}/row-sets",
            json={
                "name": "Rangs",
                "spacing_m": 2.5,
                "axis_line_id": axis.json()["id"],
                "rows": [
                    {"number": 1, "name": "Rang 1", "geometry": LINE_A},
                    {"number": 2, "name": "Rang 2", "geometry": LINE_B},
                ],
            },
        )
        assert row_set.status_code == 201
        body = row_set.json()
        assert body["spacing_m"] == 2.5
        assert body["axis_line_id"] == axis.json()["id"]
        assert len(body["rows"]) == 2
        field = client.get(f"/api/v1/fields/{field_id}").json()
        assert len(field["row_sets"]) == 1
        assert len(field["row_sets"][0]["rows"]) == 2
        exported = client.get(f"/api/v1/fields/{field_id}/export").json()
        kinds = [feature["properties"]["srbc_kind"] for feature in exported["features"]]
        assert kinds.count("row") == 2
        row_id = body["rows"][0]["id"]
        patched = client.patch(
            f"/api/v1/fields/{field_id}/rows/{row_id}",
            json={"name": "Rang A"},
        )
        assert patched.status_code == 200
        assert patched.json()["name"] == "Rang A"
        deleted_row = client.delete(f"/api/v1/fields/{field_id}/rows/{row_id}")
        assert deleted_row.status_code == 200
        remaining = client.get(f"/api/v1/fields/{field_id}").json()
        assert len(remaining["row_sets"][0]["rows"]) == 1
        deleted_set = client.delete(f"/api/v1/fields/{field_id}/row-sets/{body['id']}")
        assert deleted_set.status_code == 200
        after = client.get(f"/api/v1/fields/{field_id}").json()
        assert after["row_sets"] == []


def test_bed_set_accepts_polygon_geometry():
    with _client() as client:
        created = client.post("/api/v1/fields", json={"name": "Maraichage", "geometry": SQUARE})
        field_id = created.json()["id"]
        bed = {
            "type": "Polygon",
            "coordinates": [[[0, 0], [0.001, 0], [0.001, 0.0002], [0, 0.0002], [0, 0]]],
        }
        row_set = client.post(
            f"/api/v1/fields/{field_id}/row-sets",
            json={
                "name": "Planches",
                "kind": "beds",
                "spacing_m": 1.6,
                "width_m": 1.2,
                "rows": [{"number": 1, "name": "Planche 1", "geometry": bed}],
            },
        )
        assert row_set.status_code == 201
        assert row_set.json()["kind"] == "beds"
        assert row_set.json()["rows"][0]["geometry"]["type"] == "Polygon"
        exported = client.get(f"/api/v1/fields/{field_id}/export").json()
        kinds = [feature["properties"]["srbc_kind"] for feature in exported["features"]]
        assert "bed" in kinds


def test_row_set_rejects_unknown_axis(tmp_path):
    repo = FieldRepository(Database(str(tmp_path / "rows.sqlite")))
    field = repo.create_field("Nord", SQUARE)
    try:
        repo.create_row_set(
            field["id"],
            rows=[{"number": 1, "geometry": LINE_A}],
            spacing_m=2.5,
            axis_line_id="missing",
        )
    except ValueError as exc:
        assert "axis_line_id" in str(exc)
    else:
        raise AssertionError("expected ValueError")
