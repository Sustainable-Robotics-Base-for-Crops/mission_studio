"""D13-01 — parcel_map/ is the field catalogue; SQLite is a cache of the current farm."""

from __future__ import annotations

import json
import os

from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.db import Database
from backend.farm.catalogue import (
    rebuild_fields_from_parcel_map,
    write_field_file,
)
from backend.farm.layout import ensure_farm
from backend.fields.geojson import export_geojson
from backend.fields.repository import FieldRepository

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


def _repo(path) -> FieldRepository:
    return FieldRepository(Database(str(path)))


def test_rebuild_drops_ghost_fields_and_keeps_file_ids(tmp_path):
    root = str(tmp_path / "ferme")
    ensure_farm(root, "Ferme TEST")
    source = _repo(tmp_path / "source.sqlite")
    field = source.create_field("Santenay", SQUARE, field_id="field-santenay")
    write_field_file(root, field)

    cache = _repo(tmp_path / "cache.sqlite")
    ghost = cache.create_field("Enclos", SQUARE)
    report = rebuild_fields_from_parcel_map(cache, root)

    assert report["imported"] == 1
    assert report["errors"] == []
    listed = cache.list_fields()
    assert [item["id"] for item in listed] == ["field-santenay"]
    assert listed[0]["name"] == "Santenay"
    assert cache.get_field(ghost["id"]) is None


def test_rebuild_empty_parcel_map_clears_the_cache(tmp_path):
    root = str(tmp_path / "ferme")
    ensure_farm(root, "Vide")
    cache = _repo(tmp_path / "cache.sqlite")
    cache.create_field("Fantôme", SQUARE)

    report = rebuild_fields_from_parcel_map(cache, root)

    assert report["imported"] == 0
    assert cache.list_fields() == []


def test_write_then_rebuild_roundtrip(tmp_path):
    root = str(tmp_path / "ferme")
    ensure_farm(root, "Ronde")
    live = _repo(tmp_path / "live.sqlite")
    created = live.create_field("JP Onzon", SQUARE, campaign="2026", field_id="jp-onzon")
    dest = write_field_file(root, created)

    assert os.path.isfile(dest)
    with open(dest, encoding="utf-8") as handle:
        document = json.load(handle)
    assert document["features"][0]["properties"]["id"] == "jp-onzon"
    assert document["features"][0]["properties"]["srbc_kind"] == "field"

    other = _repo(tmp_path / "other.sqlite")
    rebuild_fields_from_parcel_map(other, root)
    restored = other.get_field("jp-onzon")
    assert restored is not None
    assert restored["name"] == "JP Onzon"
    assert restored["campaign"] == "2026"
    assert export_geojson(restored)["features"][0]["properties"]["id"] == "jp-onzon"


def test_api_new_farm_hides_previous_catalogue_and_writes_parcel_map(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_STATE_PATH", str(tmp_path / "state" / "app.json"))
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "studio.sqlite"))
    client = TestClient(create_app())

    first = str(tmp_path / "ferme-a")
    second = str(tmp_path / "ferme-b")
    client.post("/api/v1/farm/create", json={"root": first, "name": "Ferme A"})
    created = client.post(
        "/api/v1/fields",
        json={"name": "Santenay", "geometry": SQUARE},
    )
    assert created.status_code == 201
    field_id = created.json()["id"]
    parcel_files = [name for name in os.listdir(os.path.join(first, "parcel_map")) if name.endswith(".geojson")]
    assert len(parcel_files) == 1
    assert field_id in parcel_files[0]

    client.post("/api/v1/farm/create", json={"root": second, "name": "Ferme B"})
    listed = client.get("/api/v1/fields")
    assert listed.status_code == 200
    assert listed.json()["fields"] == []
    assert [name for name in os.listdir(os.path.join(second, "parcel_map")) if name.endswith(".geojson")] == []

    client.post("/api/v1/farm/open-existing", json={"root": first})
    restored = client.get("/api/v1/fields").json()["fields"]
    assert [item["id"] for item in restored] == [field_id]
    assert restored[0]["name"] == "Santenay"


def test_delete_field_removes_the_geojson(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_STATE_PATH", str(tmp_path / "state" / "app.json"))
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "studio.sqlite"))
    client = TestClient(create_app())
    root = str(tmp_path / "ferme")
    client.post("/api/v1/farm/create", json={"root": root, "name": "Ferme"})
    field_id = client.post("/api/v1/fields", json={"name": "Nord", "geometry": SQUARE}).json()["id"]
    assert any(name.endswith(".geojson") for name in os.listdir(os.path.join(root, "parcel_map")))

    deleted = client.delete(f"/api/v1/fields/{field_id}")
    assert deleted.status_code == 200
    assert [name for name in os.listdir(os.path.join(root, "parcel_map")) if name.endswith(".geojson")] == []
