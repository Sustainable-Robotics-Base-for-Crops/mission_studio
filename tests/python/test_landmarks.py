"""Landmark traces of the parcellaire ruler."""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.db import Database
from backend.fields.geojson import import_geojson
from backend.fields.repository import FieldRepository


SQUARE = {
    "type": "Polygon",
    "coordinates": [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
}
LINE = {"type": "LineString", "coordinates": [[0, 0.0002], [0.001, 0.0002]]}
POINT = {"type": "Point", "coordinates": [0.0004, 0.0001]}
OTHER = {
    "type": "Polygon",
    "coordinates": [[[0.002, 0], [0.003, 0], [0.003, 0.001], [0.002, 0.001], [0.002, 0]]],
}


def _client() -> TestClient:
    return TestClient(create_app())


def test_landmark_crud_does_not_touch_the_field_version():
    with _client() as client:
        created = client.post("/api/v1/fields", json={"name": "Site", "geometry": SQUARE})
        field_id = created.json()["id"]
        version = created.json()["version"]
        measure = client.post(
            f"/api/v1/fields/{field_id}/landmarks",
            json={"kind": "measure", "name": "Règle A", "geometry": LINE},
        )
        assert measure.status_code == 201
        assert measure.json()["kind"] == "measure"
        point = client.post(
            f"/api/v1/fields/{field_id}/landmarks",
            json={"kind": "point", "name": "Piquet", "geometry": POINT},
        )
        assert point.status_code == 201
        field = client.get(f"/api/v1/fields/{field_id}").json()
        assert field["version"] == version
        assert len(field["landmarks"]) == 2
        exported = client.get(f"/api/v1/fields/{field_id}/export").json()
        kinds = [feature["properties"]["srbc_kind"] for feature in exported["features"]]
        assert kinds.count("landmark") == 2
        renamed = client.patch(
            f"/api/v1/fields/{field_id}/landmarks/{point.json()['id']}",
            json={"name": "Borne nord"},
        )
        assert renamed.json()["name"] == "Borne nord"
        deleted = client.delete(f"/api/v1/fields/{field_id}/landmarks/{measure.json()['id']}")
        assert deleted.status_code == 200
        after = client.get(f"/api/v1/fields/{field_id}").json()
        assert len(after["landmarks"]) == 1
        assert after["landmarks"][0]["name"] == "Borne nord"


def test_unknown_extra_polygons_import_as_landmarks(tmp_path):
    repo = FieldRepository(Database(str(tmp_path / "fields.sqlite")))
    report = import_geojson(
        repo,
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"srbc_kind": "field", "name": "A"},
                    "geometry": SQUARE,
                },
                {
                    "type": "Feature",
                    "properties": {"name": "Figure inconnue"},
                    "geometry": OTHER,
                },
                {
                    "type": "Feature",
                    "properties": {"landmark_kind": "point", "name": "Piquet"},
                    "geometry": POINT,
                },
            ],
        },
    )
    assert report["ok"] is True
    assert report["created"]["landmarks"] == 2
    kinds = {item["kind"] for item in report["field"]["landmarks"]}
    assert kinds == {"polygon", "point"}
