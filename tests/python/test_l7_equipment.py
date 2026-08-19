"""Equipment catalogue (L7a): OEM seed, envelopes, Agri metadata projection."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.db import Database
from backend.equipment import (
    OEM_COMBINATION_ID,
    OEM_TRAILER_COMBINATION_ID,
    OEM_TRAILER_ID,
    OEM_VEHICLE_ID,
    EquipmentRepository,
    combination_envelope,
    project_srbc_equipment,
)


def _repo(tmp_path) -> EquipmentRepository:
    return EquipmentRepository(Database(str(tmp_path / "eq.sqlite")))


def test_oem_seed_and_skid_pivot_envelope(tmp_path):
    repo = _repo(tmp_path)
    vehicles = repo.list_vehicles()
    assert any(item["id"] == OEM_VEHICLE_ID for item in vehicles)
    srbc = repo.get_vehicle(OEM_VEHICLE_ID)
    assert srbc is not None
    assert srbc["kinematics"] == "skid_steer"
    assert srbc["length_m"] == 1.1
    assert srbc["width_m"] == 0.6
    assert srbc["origin"] == "oem"
    resolved = repo.resolved_combination(OEM_COMBINATION_ID)
    assert resolved is not None
    envelope = resolved["envelope"]
    assert envelope["min_turn_radius_m"] == 0
    assert envelope["swept_radius_m"] > 0.5
    meta = resolved["srbc_equipment"]
    assert meta["vehicle"]["kinematics"] == "skid_steer"
    assert meta["implement"]["width_m"] == 1.2
    assert meta["trailer"] is None


def test_oem_trailer_articulated_envelope(tmp_path):
    repo = _repo(tmp_path)
    trailer = repo.get_implement(OEM_TRAILER_ID)
    assert trailer is not None
    assert trailer["kind"] == "trailer"
    assert trailer["drawbar_length_m"] == 1.5
    resolved = repo.resolved_combination(OEM_TRAILER_COMBINATION_ID)
    assert resolved is not None
    envelope = resolved["envelope"]
    assert envelope["hitch_mode"] == "trailed"
    assert envelope["hitch"]["x"] == pytest.approx(-0.55)
    assert envelope["axle"]["x"] == pytest.approx(-2.05)
    assert envelope["trailer_swing_radius_m"] > 2
    meta = resolved["srbc_equipment"]
    assert meta["implement"] is None
    assert meta["trailer"]["kind"] == "trailer"
    assert meta["trailer"]["drawbar_length_m"] == 1.5
    assert meta["trailer"]["hitch"]["x"] == pytest.approx(-0.55)


def test_ensure_oem_trailer_on_already_seeded_db(tmp_path):
    repo = _repo(tmp_path)
    repo._db.execute("DELETE FROM combinations WHERE id = ?", (OEM_TRAILER_COMBINATION_ID,))
    repo._db.execute("DELETE FROM implements WHERE id = ?", (OEM_TRAILER_ID,))
    from backend.equipment.seed import seed_oem_if_empty

    seed_oem_if_empty(repo._db)
    assert repo.get_implement(OEM_TRAILER_ID) is not None
    assert repo.resolved_combination(OEM_TRAILER_COMBINATION_ID) is not None


def test_patch_marks_oem_field_modified(tmp_path):
    repo = _repo(tmp_path)
    patched = repo.patch_vehicle(OEM_VEHICLE_ID, {"width_m": 0.7})
    assert patched is not None
    assert patched["width_m"] == 0.7
    assert patched["sources"]["width_m"] == "modified"
    assert patched["origin"] == "oem"


def test_oem_vehicle_cannot_be_deleted(tmp_path):
    repo = _repo(tmp_path)
    with pytest.raises(ValueError, match="OEM"):
        repo.delete_vehicle(OEM_VEHICLE_ID)


def test_local_vehicle_envelope_and_projection(tmp_path):
    repo = _repo(tmp_path)
    vehicle = repo.create_vehicle(
        {"name": "Ackermann test", "kinematics": "ackermann", "length_m": 2, "width_m": 1}
    )
    envelope = combination_envelope(vehicle, None)
    assert envelope["min_turn_radius_m"] == 2
    meta = project_srbc_equipment(vehicle, None)
    assert meta["implement"] is None
    assert meta["vehicle"]["id"] == vehicle["id"]


def test_equipment_http_surface():
    with TestClient(create_app()) as client:
        catalogue = client.get("/api/v1/equipment")
        assert catalogue.status_code == 200
        body = catalogue.json()
        assert any(item["id"] == OEM_VEHICLE_ID for item in body["vehicles"])
        patched = client.patch(
            f"/api/v1/equipment/vehicles/{OEM_VEHICLE_ID}",
            json={"length_m": 1.2},
        )
        assert patched.status_code == 200
        assert patched.json()["sources"]["length_m"] == "modified"
        forbidden = client.delete(f"/api/v1/equipment/vehicles/{OEM_VEHICLE_ID}")
        assert forbidden.status_code == 400
        resolved = client.get(f"/api/v1/equipment/combinations/{OEM_COMBINATION_ID}")
        assert resolved.status_code == 200
        assert resolved.json()["srbc_equipment"]["vehicle"]["width_m"] == 0.6
        trailers = [item for item in body["implements"] if item["id"] == "trailer-140"]
        assert len(trailers) == 1
        assert trailers[0]["kind"] == "trailer"
        assert trailers[0]["drawbar_length_m"] == 1.5
