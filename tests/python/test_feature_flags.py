"""Feature flags: defaults must produce no observable change."""

from __future__ import annotations

import pytest

from backend.config.flags import is_enabled, registry, wants_ui_shell_v2


def test_ui_shell_v2_defaults_to_false(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("UI_SHELL_V2", raising=False)
    assert wants_ui_shell_v2() is False
    assert is_enabled("UI_SHELL_V2") is False


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on"])
def test_ui_shell_v2_env_truthy(monkeypatch: pytest.MonkeyPatch, value: str):
    monkeypatch.setenv("UI_SHELL_V2", value)
    assert wants_ui_shell_v2() is True


@pytest.mark.parametrize("value", ["0", "false", "no", "off", "none", "disabled", ""])
def test_ui_shell_v2_env_falsy(monkeypatch: pytest.MonkeyPatch, value: str):
    monkeypatch.setenv("UI_SHELL_V2", value)
    assert wants_ui_shell_v2() is False


@pytest.mark.parametrize("ui", ["v2", "studio", "V2"])
def test_query_param_enables_v2_even_when_env_is_off(monkeypatch: pytest.MonkeyPatch, ui: str):
    monkeypatch.setenv("UI_SHELL_V2", "false")
    assert wants_ui_shell_v2({"ui": [ui]}) is True


@pytest.mark.parametrize("ui", ["v1", "legacy"])
def test_query_param_forces_legacy_even_when_env_is_on(monkeypatch: pytest.MonkeyPatch, ui: str):
    monkeypatch.setenv("UI_SHELL_V2", "true")
    assert wants_ui_shell_v2({"ui": [ui]}) is False


def test_registry_defaults_match_the_roadmap(monkeypatch: pytest.MonkeyPatch):
    for name in (
        "UI_SHELL_V2",
        "UI_THEME_V2",
        "BACKEND_FASTAPI",
        "FEAT_COVERAGE_ENGINE",
        "FEAT_SIMULATION",
        "FEAT_PUBLICATION",
        "FEAT_ISOBUS",
        "FEAT_SECTION_CONTROL",
        "FEAT_MULTI_ORG_RBAC",
        "FEAT_FLEET",
        "FEAT_PLANT_LAYER",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("MAP_ENGINE", raising=False)

    flags = registry()
    assert flags["MAP_ENGINE"] == "leaflet"
    for name, value in flags.items():
        if name == "MAP_ENGINE":
            continue
        assert value is False, f"{name} must default to false"
