"""/api/v1/imports — adapter list and preview over HTTP."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.imports.service import MAX_BYTES
from tests.python.test_imports_adapters import naio_work_map, raven_job


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("FARM_ROOT", raising=False)
    monkeypatch.setenv("APP_STATE_PATH", str(tmp_path / "state" / "app.json"))
    return TestClient(create_app())


def _preview(client: TestClient, filename: str, payload: bytes, adapter: str = ""):
    query = f"?filename={filename}" + (f"&adapter={adapter}" if adapter else "")
    return client.post(
        f"/api/v1/imports/preview{query}",
        content=payload,
        headers={"Content-Type": "application/octet-stream"},
    )


def test_adapters_are_listed_with_their_extensions(client):
    body = client.get("/api/v1/imports/adapters").json()
    adapters = {adapter["id"]: adapter for adapter in body["adapters"]}
    assert body["max_bytes"] == MAX_BYTES
    assert adapters["naio_workmap"]["vendor"] == "naio"
    assert ".geojson" in adapters["naio_workmap"]["extensions"]
    assert ".zip" in adapters["raven_shapefile"]["extensions"]


def test_preview_returns_candidates_report_and_collection(client):
    response = _preview(client, "traces.geojson", naio_work_map(rows=3))
    assert response.status_code == 200
    body = response.json()
    assert body["adapter"] == "naio_workmap"
    assert body["report"]["kinds"] == {"row": 3}
    assert body["collection"]["type"] == "FeatureCollection"
    assert len(body["collection"]["features"]) == 3


def test_preview_honours_a_forced_dialect(client):
    body = _preview(client, "traces.geojson", naio_work_map(rows=2), "geojson_generic").json()
    assert body["adapter"] == "geojson_generic"
    assert body["report"]["kinds"] == {"landmark": 2}


def test_preview_reads_a_zipped_shapefile_over_http(client):
    body = _preview(client, "job.zip", raven_job(cells=2, lines=1)).json()
    assert body["adapter"] == "raven_shapefile"
    assert body["report"]["kinds"] == {"coverage_cell": 2, "guidance_line": 1}
    assert body["report"]["promotions"][0]["target"] == "agri.work_performed"


def test_an_unrecognised_file_is_a_422_with_a_translatable_key(client):
    response = _preview(client, "notes.txt", b"nothing geographic in here")
    assert response.status_code == 422
    assert response.json()["error"] == "imports.error.unrecognised"


def test_a_forced_unknown_dialect_is_reported_with_its_id(client):
    response = _preview(client, "traces.geojson", naio_work_map(), "trimble_ab")
    assert response.status_code == 422
    body = response.json()
    assert body["error"] == "imports.error.unknownAdapter"
    assert body["params"] == {"adapter": "trimble_ab"}


def test_an_oversized_upload_is_refused_before_being_read(client):
    response = _preview(client, "big.zip", b"x" * (MAX_BYTES + 1))
    assert response.status_code == 413
    assert response.json()["error"] == "imports.error.tooLarge"


def test_accents_survive_the_json_response(client):
    body = _preview(client, "traces.geojson", naio_work_map()).json()
    assert body["report"]["label"] == "Naïo WorkMap"
