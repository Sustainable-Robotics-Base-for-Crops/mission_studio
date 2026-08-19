"""HTTP surface for L5 jobs and the field catalogue."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from backend.api.app import create_app


def _client() -> TestClient:
    return TestClient(create_app())


def test_health_reports_sqlite_and_jobs():
    with _client() as client:
        body = client.get("/api/v1/health").json()
        assert body["sqlite"] is True
        assert body["jobs"] is True


def test_echo_job_completes_via_worker():
    with _client() as client:
        created = client.post("/api/v1/jobs", json={"kind": "echo", "payload": {"n": 3}})
        assert created.status_code == 202
        job_id = created.json()["id"]
        body = None
        for _ in range(40):
            body = client.get(f"/api/v1/jobs/{job_id}").json()
            if body["status"] in {"succeeded", "failed"}:
                break
            time.sleep(0.05)
        assert body is not None
        assert body["status"] == "succeeded"
        assert body["result"] == {"n": 3}


def test_field_crud_zone_and_impact_banner():
    with _client() as client:
        created = client.post(
            "/api/v1/fields",
            json={
                "name": "Les Graves",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
                },
            },
        )
        assert created.status_code == 201
        field_id = created.json()["id"]
        linked = client.post(
            f"/api/v1/fields/{field_id}/missions",
            json={"path": "mission_order/v1/a.json"},
        )
        assert linked.status_code == 201
        zone = client.post(
            f"/api/v1/fields/{field_id}/zones",
            json={
                "kind": "autonomy",
                "geometry": created.json()["geometry"],
                "name": "ODD",
            },
        )
        assert zone.status_code == 201
        impact = client.get(f"/api/v1/fields/{field_id}/impact").json()
        assert impact["invalidated_count"] == 1
        assert impact["banner"].startswith("Simulation invalidée")
        versions = client.get(f"/api/v1/fields/{field_id}/versions").json()["versions"]
        assert len(versions) >= 2
        diff = client.get(f"/api/v1/fields/{field_id}/versions/1/diff/2").json()
        assert diff["zones_to"] == 1
        exported = client.get(f"/api/v1/fields/{field_id}/export")
        assert exported.status_code == 200
        assert exported.json()["type"] == "FeatureCollection"


def test_import_rejects_non_geojson_format():
    with _client() as client:
        response = client.post(
            "/api/v1/fields/import",
            json={"format": "shapefile", "geojson": {}},
        )
        assert response.status_code == 400
        assert "GeoJSON" in response.json()["error"]


def test_field_list_patch_children_and_delete():
    with _client() as client:
        created = client.post(
            "/api/v1/fields",
            json={
                "name": "Les Graves",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
                },
            },
        )
        field_id = created.json()["id"]
        geometry = created.json()["geometry"]
        listed = client.get("/api/v1/fields")
        assert listed.status_code == 200
        assert any(item["id"] == field_id for item in listed.json()["fields"])
        patched = client.patch(
            f"/api/v1/fields/{field_id}",
            json={"name": "Graves 2", "campaign": "2026"},
        )
        assert patched.status_code == 200
        assert patched.json()["name"] == "Graves 2"
        obstacle = client.post(
            f"/api/v1/fields/{field_id}/obstacles",
            json={
                "geometry": {"type": "Point", "coordinates": [0.0005, 0.0005]},
                "category": "tree",
            },
        )
        assert obstacle.status_code == 201
        patched_obs = client.patch(
            f"/api/v1/fields/{field_id}/obstacles/{obstacle.json()['id']}",
            json={"name": "Chêne", "margin_m": 1.5},
        )
        assert patched_obs.status_code == 200
        assert patched_obs.json()["name"] == "Chêne"
        assert patched_obs.json()["margin_m"] == 1.5
        deleted_obs = client.delete(f"/api/v1/fields/{field_id}/obstacles/{obstacle.json()['id']}")
        assert deleted_obs.status_code == 200
        line = client.post(
            f"/api/v1/fields/{field_id}/guidance-lines",
            json={
                "name": "A1",
                "geometry": {"type": "LineString", "coordinates": [[0, 0], [0.001, 0.001]]},
            },
        )
        assert line.status_code == 201
        patched_line = client.patch(
            f"/api/v1/fields/{field_id}/guidance-lines/{line.json()['id']}",
            json={"name": "AB-Nord"},
        )
        assert patched_line.status_code == 200
        assert patched_line.json()["name"] == "AB-Nord"
        deleted_line = client.delete(
            f"/api/v1/fields/{field_id}/guidance-lines/{line.json()['id']}"
        )
        assert deleted_line.status_code == 200
        zone = client.post(
            f"/api/v1/fields/{field_id}/zones",
            json={"kind": "interdit", "geometry": geometry},
        )
        assert zone.status_code == 400
        zone = client.post(
            f"/api/v1/fields/{field_id}/zones",
            json={"kind": "interdite", "geometry": geometry},
        )
        assert zone.status_code == 201
        assert zone.json()["kind"] == "forbidden"
        renamed = client.patch(
            f"/api/v1/fields/{field_id}/zones/{zone.json()['id']}",
            json={"name": "Haie", "kind": "workable"},
        )
        assert renamed.status_code == 200
        assert renamed.json()["name"] == "Haie"
        assert renamed.json()["kind"] == "workable"
        deleted_zone = client.delete(f"/api/v1/fields/{field_id}/zones/{zone.json()['id']}")
        assert deleted_zone.status_code == 200
        imported = client.post(
            "/api/v1/fields/import",
            json={
                "format": "geojson",
                "geojson": {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {"name": "Import", "srbc_kind": "field"},
                            "geometry": geometry,
                        }
                    ],
                },
            },
        )
        assert imported.status_code == 201
        assert imported.json()["ok"] is True
        missing_job = client.get("/api/v1/jobs/does-not-exist")
        assert missing_job.status_code == 404
        jobs = client.get("/api/v1/jobs")
        assert jobs.status_code == 200
        assert "jobs" in jobs.json()
        deleted = client.delete(f"/api/v1/fields/{field_id}")
        assert deleted.status_code == 200
        assert client.get(f"/api/v1/fields/{field_id}").status_code == 404


def test_jobs_and_fields_unavailable_without_sqlite():
    from backend.runtime import EditorRuntime

    with TestClient(create_app(EditorRuntime.build())) as client:
        health = client.get("/api/v1/health").json()
        assert health["sqlite"] is False
        assert client.post("/api/v1/jobs", json={"kind": "echo"}).status_code == 503
        assert client.get("/api/v1/fields").status_code == 503
