"""The Studio bundle keeps a stable name, so it must never be served from cache blindly."""

from backend.config.static_assets import studio_asset_headers


def test_bundle_is_revalidated():
    for name in ("studio.js", "studio.css"):
        headers = studio_asset_headers(name)
        assert headers is not None
        assert "no-cache" in headers["Cache-Control"]


def test_hashed_neighbours_keep_default_caching():
    assert studio_asset_headers("inter-latin-wght-normal.woff2") is None
    assert studio_asset_headers("index.html") is None
