"""L13 — farm persistence, root resolution and recent farms (CdC technique §2.7)."""

from __future__ import annotations

import json
import os

import pytest

from backend.farm.layout import FARM_FILE, ensure_farm, read_farm_json
from backend.farm.repository import RECENT_LIMIT, FarmRepository


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """A repository whose application state lives in the temporary folder."""
    monkeypatch.delenv("FARM_ROOT", raising=False)
    return FarmRepository(app_state_path=str(tmp_path / "state" / "app.json"))


def _field_geojson(coordinates):
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"kind": "field", "name": "Parcelle"},
                "geometry": {"type": "Polygon", "coordinates": [coordinates]},
            }
        ],
    }


def _square(lon: float, lat: float, side_deg: float):
    return [
        [lon, lat],
        [lon + side_deg, lat],
        [lon + side_deg, lat + side_deg],
        [lon, lat + side_deg],
        [lon, lat],
    ]


# -- application state -------------------------------------------------------


def test_app_state_defaults_when_the_file_is_absent(repo):
    assert repo.read_app_state() == {"current_root": None, "recent_roots": []}


def test_app_state_defaults_when_the_file_is_corrupted(repo, tmp_path):
    path = repo.app_state_path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("{ not json")

    assert repo.read_app_state()["current_root"] is None


def test_app_state_ignores_unknown_keys(repo):
    repo.write_app_state({"current_root": "/tmp/farm", "recent_roots": [], "secret": "x"})

    with open(repo.app_state_path, "r", encoding="utf-8") as handle:
        stored = json.load(handle)

    assert set(stored) == {"current_root", "recent_roots"}


# -- root resolution ---------------------------------------------------------


def test_resolve_root_prefers_the_environment(repo, tmp_path, monkeypatch):
    remembered = str(tmp_path / "remembered")
    repo.write_app_state({"current_root": remembered, "recent_roots": [remembered]})
    monkeypatch.setenv("FARM_ROOT", str(tmp_path / "from-env"))

    assert repo.resolve_root() == str(tmp_path / "from-env")


def test_resolve_root_falls_back_on_the_remembered_farm(repo, tmp_path):
    remembered = str(tmp_path / "remembered")
    repo.write_app_state({"current_root": remembered, "recent_roots": [remembered]})

    assert repo.resolve_root() == remembered


def test_resolve_root_returns_none_without_any_farm(repo):
    assert repo.resolve_root() is None
    assert repo.read_farm() is None


def test_resolve_root_ignores_a_blank_environment_value(repo, monkeypatch):
    monkeypatch.setenv("FARM_ROOT", "   ")

    assert repo.resolve_root() is None


# -- opening farms -----------------------------------------------------------


def test_open_farm_initialises_and_becomes_current(repo, tmp_path):
    root = str(tmp_path / "Ferme XY")

    farm = repo.open_farm(root, "Ferme XY")

    assert farm["name"] == "Ferme XY"
    assert repo.resolve_root() == root
    assert os.path.isfile(os.path.join(root, FARM_FILE))
    assert repo.read_farm()["name"] == "Ferme XY"


def test_open_farm_rejects_a_blank_root(repo):
    with pytest.raises(ValueError):
        repo.open_farm("  ")


def test_create_farm_requires_an_empty_folder(repo, tmp_path):
    root = tmp_path / "new-farm"
    root.mkdir()
    (root / "notes.txt").write_text("keep me", encoding="utf-8")

    with pytest.raises(ValueError, match="empty folder"):
        repo.create_farm(str(root), "Ferme Nouvelle")

    assert not (root / FARM_FILE).exists()


def test_create_then_open_existing_farm(repo, tmp_path):
    root = str(tmp_path / "new-farm")

    created = repo.create_farm(root, "Ferme Nouvelle")
    reopened = repo.open_existing_farm(root)

    assert created["name"] == "Ferme Nouvelle"
    assert reopened["name"] == "Ferme Nouvelle"
    assert repo.resolve_root() == root


def test_open_existing_rejects_a_plain_folder(repo, tmp_path):
    root = tmp_path / "plain"
    root.mkdir()

    with pytest.raises(ValueError, match="not a farm"):
        repo.open_existing_farm(str(root))


def test_recent_farms_are_capped_deduplicated_and_ordered(repo, tmp_path):
    roots = [str(tmp_path / f"farm-{index}") for index in range(RECENT_LIMIT + 2)]
    for root in roots:
        repo.open_farm(root)
    repo.open_farm(roots[0])

    recent = repo.recent_roots()

    assert len(recent) == RECENT_LIMIT
    assert recent[0] == roots[0]
    assert len(set(recent)) == len(recent)


def test_switching_farms_changes_what_is_read(repo, tmp_path):
    repo.open_farm(str(tmp_path / "a"), "Ferme A")
    repo.open_farm(str(tmp_path / "b"), "Ferme B")

    assert repo.read_farm()["name"] == "Ferme B"

    repo.open_farm(str(tmp_path / "a"))

    assert repo.read_farm()["name"] == "Ferme A"


# -- writing settings --------------------------------------------------------


def test_write_farm_applies_a_patch(repo, tmp_path):
    repo.open_farm(str(tmp_path / "farm"), "Ferme XY")

    updated = repo.write_farm(
        {
            "farm_type": "vineyard",
            "ui_mode": "advanced",
            "field_geofence_inset_cm": 0,
        }
    )

    assert updated["farm_type"] == "vineyard"
    assert updated["ui_mode"] == "advanced"
    assert updated["field_geofence_inset_cm"] == 0
    assert updated["name"] == "Ferme XY"


def test_write_farm_merges_a_partial_start_view(repo, tmp_path):
    repo.open_farm(str(tmp_path / "farm"))

    updated = repo.write_farm({"start_view": {"zoom": 17}})

    assert updated["start_view"]["zoom"] == 17
    assert "lat" in updated["start_view"] and "lon" in updated["start_view"]


def test_write_farm_keeps_creation_and_refreshes_update_timestamps(repo, tmp_path):
    created = repo.open_farm(str(tmp_path / "farm"))["created_at"]

    updated = repo.write_farm({"created_at": "1999-01-01T00:00:00Z", "name": "Renommée"})

    assert updated["created_at"] == created
    assert updated["updated_at"] >= created


def test_write_farm_ignores_a_client_supplied_schema(repo, tmp_path):
    repo.open_farm(str(tmp_path / "farm"))

    updated = repo.write_farm({"schema": "srbc.farm/99"})

    assert updated["schema"] == "srbc.farm/1"


def test_write_farm_rejects_an_invalid_patch(repo, tmp_path):
    repo.open_farm(str(tmp_path / "farm"))

    with pytest.raises(ValueError, match="farm_type"):
        repo.write_farm({"farm_type": "orchard"})


def test_write_farm_leaves_the_file_untouched_when_rejected(repo, tmp_path):
    root = str(tmp_path / "farm")
    repo.open_farm(root, "Ferme XY")

    with pytest.raises(ValueError):
        repo.write_farm({"language": "kl"})

    assert read_farm_json(root)["language"] == "fr"


def test_write_farm_without_a_farm_explains_what_to_do(repo):
    with pytest.raises(ValueError, match="open one"):
        repo.write_farm({"name": "Ferme XY"})


# -- counters ----------------------------------------------------------------


def test_counts_are_zero_without_a_farm(repo):
    assert repo.counts() == {
        "fields": 0,
        "missions": 0,
        "work_performed": 0,
        "equipment": 0,
        "hectares": None,
    }


def test_counts_only_look_at_the_expected_extensions(repo, tmp_path):
    root = tmp_path / "farm"
    repo.open_farm(str(root))
    (root / "parcel_map" / "a.geojson").write_text(
        json.dumps(_field_geojson(_square(1.0, 46.0, 0.01))), encoding="utf-8"
    )
    (root / "parcel_map" / "notes.txt").write_text("ignored", encoding="utf-8")
    (root / "mission_order" / "m1.json").write_text("{}", encoding="utf-8")
    (root / "mission_order" / "m2.json").write_text("{}", encoding="utf-8")
    (root / "work_performed" / "log.json").write_text("{}", encoding="utf-8")
    (root / "equipment" / "srbc.json").write_text("{}", encoding="utf-8")
    (root / "equipment" / "srbc.png").write_bytes(b"\x89PNG")

    counts = repo.counts()

    assert counts["fields"] == 1
    assert counts["missions"] == 2
    assert counts["work_performed"] == 1
    assert counts["equipment"] == 1


def test_hectares_sum_field_polygons(repo, tmp_path):
    root = tmp_path / "farm"
    repo.open_farm(str(root))
    for index in range(2):
        (root / "parcel_map" / f"p{index}.geojson").write_text(
            json.dumps(_field_geojson(_square(1.0 + index, 46.0, 0.01))), encoding="utf-8"
        )

    hectares = repo.counts()["hectares"]

    assert hectares is not None
    assert hectares > 0


def test_hectares_is_none_when_nothing_is_measurable(repo, tmp_path):
    root = tmp_path / "farm"
    repo.open_farm(str(root))
    (root / "parcel_map" / "broken.geojson").write_text("{ not json", encoding="utf-8")

    counts = repo.counts()

    assert counts["fields"] == 1
    assert counts["hectares"] is None


def test_counts_survive_a_missing_folder(repo, tmp_path):
    root = tmp_path / "farm"
    ensure_farm(str(root))
    repo.open_farm(str(root))
    os.rmdir(root / "equipment")

    assert repo.counts()["equipment"] == 0
