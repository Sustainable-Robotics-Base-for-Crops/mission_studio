"""L13 — /api/v1/farm (CdC technique §2.8)."""

from __future__ import annotations

import json
import os

import pytest
from fastapi.testclient import TestClient

from backend.api.app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A client whose farm state is isolated from the developer's own."""
    monkeypatch.delenv("FARM_ROOT", raising=False)
    monkeypatch.setenv("APP_STATE_PATH", str(tmp_path / "state" / "app.json"))
    return TestClient(create_app())


@pytest.fixture
def farm_root(tmp_path):
    return str(tmp_path / "Ferme XY")


def _mission(field_id: str = "field-1", simulated: bool = False) -> dict:
    metadata: dict = {
        "srbc_mission_brief": {
            "field_id": field_id,
            "operation": "semis",
            "campaign": "2026",
        }
    }
    if simulated:
        metadata["srbc_simulation"] = {"fingerprint": "abc", "blockCount": 0}
    return {
        "version": "3",
        "vehicle_id": "v1",
        "file_type": "mission_order",
        "origin": {"type": "WGS84", "coordinates": {"lat": 45.85, "lon": 3.17}},
        "points": [],
        "metadata": metadata,
    }


def _write(path: str, payload: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)


# -- health ------------------------------------------------------------------


def test_health_reports_whether_a_farm_is_open(client, farm_root):
    assert client.get("/api/v1/health").json()["farm"] is False

    client.post("/api/v1/farm/open", json={"root": farm_root})

    assert client.get("/api/v1/health").json()["farm"] is True


# -- reading -----------------------------------------------------------------


def test_get_farm_without_a_farm_is_not_an_error(client):
    response = client.get("/api/v1/farm")

    assert response.status_code == 200
    body = response.json()
    assert body["farm"] is None
    assert body["root"] is None
    assert body["recent"] == []
    assert body["counts"]["missions"] == 0
    assert body["counts"]["hectares"] is None


def test_open_then_get_returns_the_farm(client, farm_root):
    opened = client.post("/api/v1/farm/open", json={"root": farm_root, "name": "Ferme XY"})

    assert opened.status_code == 200
    body = client.get("/api/v1/farm").json()
    assert body["farm"]["name"] == "Ferme XY"
    assert body["root"] == farm_root
    assert body["recent"] == [farm_root]
    assert body["cropPack"] == "market_garden"


def test_open_requires_a_root(client):
    response = client.post("/api/v1/farm/open", json={"name": "Ferme XY"})

    assert response.status_code == 400
    assert "root" in response.json()["error"]


def test_open_rejects_a_non_object_body(client):
    response = client.post("/api/v1/farm/open", json=["Ferme XY"])

    assert response.status_code == 400


# -- writing settings --------------------------------------------------------


def test_put_farm_applies_the_patch_and_recomputes_the_crop_pack(client, farm_root):
    client.post("/api/v1/farm/open", json={"root": farm_root})

    response = client.put("/api/v1/farm", json={"farm_type": "vineyard"})

    assert response.status_code == 200
    body = response.json()
    assert body["farm"]["farm_type"] == "vineyard"
    assert body["cropPack"] == "vineyard"


def test_put_farm_rejects_an_invalid_value_and_says_what_to_fix(client, farm_root):
    client.post("/api/v1/farm/open", json={"root": farm_root})

    response = client.put("/api/v1/farm", json={"farm_type": "orchard"})

    assert response.status_code == 400
    assert "farm_type" in response.json()["error"]


def test_put_farm_without_a_farm_explains_the_next_step(client):
    response = client.put("/api/v1/farm", json={"name": "Ferme XY"})

    assert response.status_code == 400
    assert "open one" in response.json()["error"]


# -- tree --------------------------------------------------------------------


def test_tree_without_a_farm_is_a_conflict(client):
    response = client.get("/api/v1/farm/tree")

    assert response.status_code == 409
    assert "no farm" in response.json()["error"]


def test_tree_lists_the_four_folders(client, farm_root):
    client.post("/api/v1/farm/open", json={"root": farm_root})

    tree = client.get("/api/v1/farm/tree").json()["tree"]

    assert set(tree) == {"parcel_map", "mission_order", "work_performed", "equipment"}
    assert all(entries == [] for entries in tree.values())


def test_tree_reads_mission_context_from_the_metadata(client, farm_root):
    client.post("/api/v1/farm/open", json={"root": farm_root})
    _write(
        os.path.join(farm_root, "mission_order", "2026-08-20_parcelle-04_semis.json"),
        _mission(field_id="field-4", simulated=True),
    )

    entries = client.get("/api/v1/farm/tree", params={"kind": "mission_order"}).json()["tree"]

    assert list(entries) == ["mission_order"]
    entry = entries["mission_order"][0]
    assert entry["name"] == "2026-08-20_parcelle-04_semis.json"
    assert entry["path"] == "mission_order/2026-08-20_parcelle-04_semis.json"
    assert entry["field_id"] == "field-4"
    assert entry["operation"] == "semis"
    assert entry["simulated"] is True


def test_tree_keeps_a_corrupted_mission_visible(client, farm_root):
    client.post("/api/v1/farm/open", json={"root": farm_root})
    path = os.path.join(farm_root, "mission_order", "broken.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("{ not json")

    entry = client.get("/api/v1/farm/tree").json()["tree"]["mission_order"][0]

    assert entry["name"] == "broken.json"
    assert entry["unreadable"] is True
    assert entry["field_id"] is None


def test_tree_ignores_unexpected_extensions(client, farm_root):
    client.post("/api/v1/farm/open", json={"root": farm_root})
    with open(os.path.join(farm_root, "mission_order", "notes.txt"), "w", encoding="utf-8") as f:
        f.write("ignored")

    assert client.get("/api/v1/farm/tree").json()["tree"]["mission_order"] == []


def test_tree_rejects_an_unknown_kind(client, farm_root):
    client.post("/api/v1/farm/open", json={"root": farm_root})

    response = client.get("/api/v1/farm/tree", params={"kind": "secrets"})

    assert response.status_code == 400
    assert "secrets" in response.json()["error"]


# -- reindex -----------------------------------------------------------------


def test_reindex_without_a_farm_is_a_conflict(client):
    assert client.post("/api/v1/farm/reindex").status_code == 409


def test_reindex_reports_its_counters(client, farm_root):
    client.post("/api/v1/farm/open", json={"root": farm_root})
    _write(os.path.join(farm_root, "mission_order", "m1.json"), _mission())

    body = client.post("/api/v1/farm/reindex").json()

    assert body["ok"] is True
    assert body["counts"]["mission_order"] == 1
    assert body["errors"] == 0
