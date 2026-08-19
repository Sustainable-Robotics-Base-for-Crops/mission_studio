"""Lot L11 — versioned publications, checksum, immutability."""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.db import Database
from backend.publications import PublicationRepository, checksum_of

DOC = {
    "version": "3",
    "vehicle_id": "v1",
    "file_type": "mission_order",
    "origin": {"type": "WGS84", "coordinates": {"lat": 45.85, "lon": 3.17}},
    "points": [
        {
            "section_type": "row_line",
            "columns": ["x", "y", "speed", "working_zone", "punctual"],
            "values": [[0, 0, 0.5, 1, {}], [10, 0, 0.5, 1, {}]],
        }
    ],
    "geofencing": {"columns": ["x", "y"], "values": [[-1, -1], [12, -1], [12, 4], [-1, 4]]},
    "metadata": {},
}

SIM_OK = {
    "passCount": 4,
    "warnCount": 0,
    "blockCount": 0,
    "length_m": 10,
    "duration_s": 20,
    "fingerprint": "abc",
}


def _repo(tmp_path) -> PublicationRepository:
    return PublicationRepository(Database(str(tmp_path / "pub.sqlite")))


def test_checksum_ignores_publication_stamp():
    digest, size = checksum_of(DOC)
    stamped = {
        **DOC,
        "metadata": {"srbc_publication": {"id": "x", "version": 1, "checksum": "nope"}},
    }
    again, size2 = checksum_of(stamped)
    assert digest == again
    assert size == size2
    assert len(digest) == 64


def test_publish_increments_version_and_obsoletes_previous(tmp_path):
    repo = _repo(tmp_path)
    first = repo.create(
        {
            "source_path": "mission_order/v1/a.json",
            "document": DOC,
            "simulation": SIM_OK,
            "stale": False,
            "approver": "alexandre",
            "expires_at": "2026-11-17",
            "vehicle_id": "v1",
        }
    )
    assert first["version"] == 1
    assert first["status"] == "published"
    assert first["approver"] == "alexandre"
    assert first["snapshot"]["metadata"]["srbc_publication"]["checksum"] == first["checksum"]
    assert first["mobile"]["activated_at"] is None
    second = repo.create(
        {
            "source_path": "mission_order/v1/a.json",
            "document": DOC,
            "simulation": SIM_OK,
            "stale": False,
        }
    )
    assert second["version"] == 2
    listed = repo.list_publications("mission_order/v1/a.json")
    assert [item["version"] for item in listed] == [2, 1]
    assert listed[0]["status"] == "published"
    assert listed[1]["status"] == "obsolete"


def test_reject_blockers_stale_and_empty(tmp_path):
    repo = _repo(tmp_path)
    try:
        repo.create(
            {
                "source_path": "mission_order/v1/a.json",
                "document": DOC,
                "simulation": {**SIM_OK, "blockCount": 1},
            }
        )
        raise AssertionError("expected blockers to fail")
    except ValueError as reason:
        assert "block" in str(reason).lower()
    try:
        repo.create(
            {
                "source_path": "mission_order/v1/a.json",
                "document": DOC,
                "simulation": SIM_OK,
                "stale": True,
            }
        )
        raise AssertionError("expected stale to fail")
    except ValueError as reason:
        assert "stale" in str(reason).lower()


def test_publications_http_surface():
    with TestClient(create_app()) as client:
        listed = client.get("/api/v1/publications")
        assert listed.status_code == 200
        created = client.post(
            "/api/v1/publications",
            json={
                "source_path": "mission_order/v1/http.json",
                "document": DOC,
                "simulation": SIM_OK,
                "approver": "local",
            },
        )
        assert created.status_code == 201
        body = created.json()
        assert body["version"] == 1
        fetched = client.get(f"/api/v1/publications/{body['id']}")
        assert fetched.status_code == 200
        assert fetched.json()["checksum"] == body["checksum"]
        blocked = client.post(
            "/api/v1/publications",
            json={
                "source_path": "mission_order/v1/http.json",
                "document": DOC,
                "simulation": {**SIM_OK, "blockCount": 2},
            },
        )
        assert blocked.status_code == 400
