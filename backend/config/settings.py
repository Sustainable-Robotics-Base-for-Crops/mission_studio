"""
Minimal public configuration (without auth/cloud secrets).
"""

from __future__ import annotations

import os
from dotenv import load_dotenv


class Settings:
    """
    Public core settings.
    """

    PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    REPO_ROOT = os.path.dirname(PROJECT_ROOT)

    # First load the global .env (repo root), then the local .env (with priority).
    # This avoids "losing" PLUGINS_DIR when the server is started from the local directory.
    load_dotenv(os.path.join(REPO_ROOT, ".env"))
    load_dotenv(os.path.join(PROJECT_ROOT, ".env"), override=True)

    WEB_ROOT = os.path.join(PROJECT_ROOT, "public")
    TEMPLATES_DIR = os.path.join(PROJECT_ROOT, "backend", "templates")
    UPLOADS_DIR = os.path.join(PROJECT_ROOT, "backend", "uploads")
    DATA_DIR = os.path.join(PROJECT_ROOT, "backend", "data")

    SERVER_PORT = int(os.getenv("PORT", "3000"))
    SERVER_HOST = os.getenv("HOST", "localhost")
    SERVER_DEBUG = os.getenv("DEBUG", "false").lower() == "true"

    # Logo displayed in the application header. The path can be a
    # local file relative to the repo root, an absolute path, or a URL.
    APP_LOGO_PATH = os.getenv("APP_LOGO_PATH", "").strip()

    # Map configuration (tile provider and optional API key).
    MAP_TILE_PROVIDER = os.getenv("MAP_TILE_PROVIDER", "esri").strip().lower()
    MAP_TILE_API_KEY = os.getenv("MAP_TILE_API_KEY", "").strip()
    MAP_TILE_URL = os.getenv("MAP_TILE_URL", "").strip()
    MAP_TILE_ATTRIBUTION = os.getenv("MAP_TILE_ATTRIBUTION", "").strip()
    MAP_TILE_MAX_ZOOM = int(os.getenv("MAP_TILE_MAX_ZOOM", "22"))
    MAP_TILE_MAX_NATIVE_ZOOM = int(os.getenv("MAP_TILE_MAX_NATIVE_ZOOM", "19"))
    MAP_TILE_GOOGLE_MAP_TYPE = os.getenv("MAP_TILE_GOOGLE_MAP_TYPE", "satellite").strip().lower()
    MAP_TILE_GOOGLE_LANGUAGE = os.getenv("MAP_TILE_GOOGLE_LANGUAGE", "fr-FR").strip()
    MAP_TILE_GOOGLE_REGION = os.getenv("MAP_TILE_GOOGLE_REGION", "FR").strip().upper()

    # Geocoding configuration used by the location search field.
    MAP_SEARCH_PROVIDER = os.getenv("MAP_SEARCH_PROVIDER", "nominatim").strip().lower()
    MAP_SEARCH_API_KEY = os.getenv("MAP_SEARCH_API_KEY", "").strip()
    MAP_SEARCH_URL = os.getenv("MAP_SEARCH_URL", "").strip()
    MAP_SEARCH_LIMIT = int(os.getenv("MAP_SEARCH_LIMIT", "5"))
    MAP_SEARCH_COUNTRY_CODES = os.getenv("MAP_SEARCH_COUNTRY_CODES", "").strip().lower()

    # Optional folder for external plugins. The public core assumes no private path:
    # each deployment explicitly chooses its directory via PLUGINS_DIR.
    _plugins_dir_env_raw = os.getenv("PLUGINS_DIR")
    _plugins_dir_env = (_plugins_dir_env_raw or "").strip()
    if _plugins_dir_env_raw is None or _plugins_dir_env.lower() in {"", "none", "false", "disabled"}:
        # Variable explicitly disabled.
        PLUGINS_DIR = ""
    else:
        PLUGINS_DIR = _plugins_dir_env

    @classmethod
    def ensure_directories(cls) -> None:
        os.makedirs(cls.UPLOADS_DIR, exist_ok=True)

    @classmethod
    def sqlite_path(cls) -> str:
        """Studio SQLite file. Overridable with SQLITE_PATH (tests, alt data dir)."""
        raw = (os.getenv("SQLITE_PATH") or "").strip()
        if raw:
            return raw
        return os.path.join(cls.DATA_DIR, "studio.sqlite")

    @classmethod
    def get_server_config(cls) -> dict:
        return {"port": cls.SERVER_PORT, "host": cls.SERVER_HOST, "debug": cls.SERVER_DEBUG}

    @classmethod
    def get_app_logo_url(cls) -> str:
        """
        Return the URL to inject into the template for the logo.
        """
        logo_path = cls.APP_LOGO_PATH
        if not logo_path:
            return ""
        if logo_path.startswith(("http://", "https://", "/")):
            return logo_path
        return "/app-logo"

    @classmethod
    def get_app_logo_file_path(cls) -> str:
        """
        Return the file path of the configured logo.
        """
        if os.path.isabs(cls.APP_LOGO_PATH):
            return cls.APP_LOGO_PATH
        return os.path.join(cls.REPO_ROOT, cls.APP_LOGO_PATH)

    @classmethod
    def get_map_config(cls) -> dict:
        """
        Return the tile provider configuration to be exposed to the frontend.
        """
        return {
            "provider": cls.MAP_TILE_PROVIDER,
            "apiKey": cls.MAP_TILE_API_KEY,
            "url": cls.MAP_TILE_URL,
            "attribution": cls.MAP_TILE_ATTRIBUTION,
            "maxZoom": cls.MAP_TILE_MAX_ZOOM,
            "maxNativeZoom": cls.MAP_TILE_MAX_NATIVE_ZOOM,
            "googleMapType": cls.MAP_TILE_GOOGLE_MAP_TYPE,
            "googleLanguage": cls.MAP_TILE_GOOGLE_LANGUAGE,
            "googleRegion": cls.MAP_TILE_GOOGLE_REGION,
        }
