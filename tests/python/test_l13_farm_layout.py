"""L13 — farm working folder layout (CdC technique §2)."""

from __future__ import annotations

import json
import os

import pytest

from backend.farm.layout import (
    CROP_PACK_BY_FARM_TYPE,
    FARM_DIRS,
    FARM_FILE,
    FARM_SCHEMA,
    FARM_TYPES,
    STUDIO_DIR,
    crop_pack_for,
    default_farm_json,
    ensure_farm,
    is_farm,
    read_farm_json,
    safe_farm_path,
    validate_farm_json,
    write_farm_json,
)


def test_default_farm_json_is_valid():
    document = default_farm_json("Ferme XY")
    assert validate_farm_json(document) == []
    assert document["field_geofence_inset_cm"] == 25
    assert document["speed_color_low_kmh"] == 0.5
    assert document["speed_color_mid_kmh"] == 1.75
    assert document["speed_color_high_kmh"] == 3.0


def test_default_farm_json_falls_back_on_a_blank_name():
    assert default_farm_json("   ")["name"].strip()


def test_ensure_farm_creates_the_whole_layout(tmp_path):
    root = str(tmp_path / "Ferme XY")

    farm = ensure_farm(root, "Ferme XY")

    assert farm["schema"] == FARM_SCHEMA
    assert farm["name"] == "Ferme XY"
    for folder in FARM_DIRS:
        assert os.path.isdir(os.path.join(root, folder)), folder
    assert os.path.isdir(os.path.join(root, STUDIO_DIR))
    assert os.path.isfile(os.path.join(root, FARM_FILE))


def test_ensure_farm_is_idempotent_and_never_overwrites(tmp_path):
    root = str(tmp_path / "farm")
    first = ensure_farm(root, "Première")

    second = ensure_farm(root, "Deuxième")

    assert second["name"] == "Première"
    assert second["created_at"] == first["created_at"]


def test_ensure_farm_recreates_a_deleted_folder(tmp_path):
    root = str(tmp_path / "farm")
    ensure_farm(root)
    os.rmdir(os.path.join(root, "mission_order"))

    ensure_farm(root)

    assert os.path.isdir(os.path.join(root, "mission_order"))


def test_ensure_farm_rejects_an_empty_root():
    with pytest.raises(ValueError):
        ensure_farm("   ")


def test_a_folder_without_farm_json_is_not_a_farm(tmp_path):
    plain = tmp_path / "just-a-folder"
    plain.mkdir()

    assert is_farm(str(plain)) is False
    assert is_farm(None) is False
    assert read_farm_json(str(plain)) is None


def test_read_farm_json_survives_a_corrupted_file(tmp_path):
    root = str(tmp_path / "farm")
    ensure_farm(root)
    with open(os.path.join(root, FARM_FILE), "w", encoding="utf-8") as handle:
        handle.write("{ not json")

    assert read_farm_json(root) is None


@pytest.mark.parametrize(
    "patch, expected_fragment",
    [
        ({"schema": "srbc.farm/2"}, "schema"),
        ({"name": "  "}, "name"),
        ({"farm_type": "orchard"}, "farm_type"),
        ({"language": "kl"}, "language"),
        ({"theme": "solarized"}, "theme"),
        ({"ui_mode": "expert"}, "ui_mode"),
        ({"units": "imperial"}, "units"),
        ({"field_geofence_inset_cm": -1}, "field_geofence_inset_cm"),
        ({"field_geofence_inset_cm": "25"}, "field_geofence_inset_cm"),
        ({"field_geofence_inset_cm": True}, "field_geofence_inset_cm"),
        ({"speed_color_low_kmh": -1}, "speed_color_low_kmh"),
        ({"speed_color_mid_kmh": True}, "speed_color_mid_kmh"),
        (
            {"speed_color_low_kmh": 3, "speed_color_mid_kmh": 1.75, "speed_color_high_kmh": 0.5},
            "speed colour thresholds",
        ),
        ({"start_view": {"lat": 46.6, "lon": 1.9}}, "start_view.zoom"),
        ({"start_view": {"lat": 200, "lon": 1.9, "zoom": 6}}, "start_view.lat"),
        ({"start_view": {"lat": 46.6, "lon": "1.9", "zoom": 6}}, "start_view.lon"),
        ({"start_view": "somewhere"}, "start_view"),
    ],
)
def test_validate_farm_json_reports_what_to_fix(patch, expected_fragment):
    document = default_farm_json("Ferme XY")
    document.update(patch)

    problems = validate_farm_json(document)

    assert problems
    assert any(expected_fragment in problem for problem in problems)


def test_validate_farm_json_rejects_a_non_object():
    assert validate_farm_json(["not", "an", "object"])


def test_validate_farm_json_accepts_zero_and_legacy_documents_without_inset():
    document = default_farm_json("Ferme XY")
    document["field_geofence_inset_cm"] = 0
    assert validate_farm_json(document) == []

    del document["field_geofence_inset_cm"]
    assert validate_farm_json(document) == []


def test_validate_farm_json_rejects_a_boolean_coordinate():
    document = default_farm_json("Ferme XY")
    document["start_view"] = {"lat": True, "lon": 1.9, "zoom": 6}

    assert any("start_view.lat" in problem for problem in validate_farm_json(document))


def test_write_farm_json_refuses_an_invalid_document(tmp_path):
    root = str(tmp_path / "farm")
    ensure_farm(root)
    broken = default_farm_json("Ferme XY")
    broken["farm_type"] = "orchard"

    with pytest.raises(ValueError, match="farm_type"):
        write_farm_json(root, broken)


def test_write_farm_json_produces_readable_utf8(tmp_path):
    root = str(tmp_path / "farm")
    write_farm_json(root, default_farm_json("Ferme des Prés"))

    raw = open(os.path.join(root, FARM_FILE), "r", encoding="utf-8").read()

    assert "Ferme des Prés" in raw
    assert json.loads(raw)["name"] == "Ferme des Prés"


def test_every_farm_type_maps_to_a_crop_pack():
    assert set(CROP_PACK_BY_FARM_TYPE) == set(FARM_TYPES)
    assert crop_pack_for("vineyard") == "vineyard"
    assert crop_pack_for("livestock") == "open_field"
    assert crop_pack_for("unknown") == "open_field"


def test_safe_farm_path_accepts_a_path_inside_the_farm(tmp_path):
    root = str(tmp_path / "farm")
    ensure_farm(root)

    resolved = safe_farm_path(root, "mission_order/2026-08-20_parcelle-04_semis.json")

    assert resolved.startswith(root + os.sep)
    assert resolved.endswith("2026-08-20_parcelle-04_semis.json")


@pytest.mark.parametrize(
    "hostile",
    [
        "../evade.json",
        "mission_order/../../evade.json",
        "mission_order/..\\..\\evade.json",
        "/etc/passwd",
        "~/secrets.json",
        "",
        "   ",
    ],
)
def test_safe_farm_path_rejects_escapes(tmp_path, hostile):
    root = str(tmp_path / "farm")
    ensure_farm(root)

    with pytest.raises(ValueError):
        safe_farm_path(root, hostile)


def test_safe_farm_path_rejects_a_symlink_pointing_outside(tmp_path):
    root = tmp_path / "farm"
    ensure_farm(str(root))
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secrets.json").write_text("{}", encoding="utf-8")
    os.symlink(str(outside), str(root / "mission_order" / "leak"))

    with pytest.raises(ValueError):
        safe_farm_path(str(root), "mission_order/leak/secrets.json")
