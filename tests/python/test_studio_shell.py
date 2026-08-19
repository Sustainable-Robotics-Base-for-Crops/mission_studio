"""The Mission Studio shell is opt-in; /app stays the legacy editor by default."""

from __future__ import annotations

from backend.config.settings import Settings
from backend.services.html_generation_service import HtmlGenerationService


class _OpenPermissions:
    def get_ui_config(self, _user_id):
        return {"ui": {}}


def _service() -> HtmlGenerationService:
    return HtmlGenerationService(
        permission_provider=_OpenPermissions(),
        templates_dirs=[Settings.TEMPLATES_DIR],
        template_slots={},
    )


LEGACY_MARKERS = [
    'id="app"',
    'id="map"',
    "pluginHeaderActions",
    "trajectoryEditorMapConfig",
    "trajectoryEditorUiConfig",
    "window.setLanguage",
    "js/core/plugins.js",
    "js/core/i18n.js",
]

STUDIO_MARKERS = [
    'id="root"',
    "pluginHeaderActions",
    "trajectoryEditorMapConfig",
    "trajectoryEditorUiConfig",
    "window.setLanguage",
    "js/core/plugins.js",
    "js/core/i18n.js",
    "/studio/assets/studio.js",
    "srbcFeatureFlags",
]


def test_legacy_html_keeps_the_native_and_plugin_contract():
    html = _service().generate_html("anonymous")
    for marker in LEGACY_MARKERS:
        assert marker in html, f"missing {marker!r} on the legacy page"
    assert "/studio/assets/studio.js" not in html
    assert 'id="root"' not in html


def test_studio_html_keeps_the_same_plugin_and_native_contract():
    html = _service().generate_studio_html("anonymous")
    for marker in STUDIO_MARKERS:
        assert marker in html, f"missing {marker!r} on the studio page"
    assert html.count('id="pluginHeaderActions"') == 1


def test_studio_html_declares_the_v2_flag_without_enabling_other_flags():
    html = _service().generate_studio_html("anonymous")
    assert '"UI_SHELL_V2": true' in html
    assert '"FEAT_ISOBUS": false' in html
    assert '"MAP_ENGINE": "leaflet"' in html
