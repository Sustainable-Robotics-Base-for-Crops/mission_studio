"""
Configurable geocoding service for place search.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from ..config.settings import Settings

logger = logging.getLogger("trajectory_editor")


class GeocodingService:
    """
    Queries a geocoding provider configured by environment variables.

    The backend acts as a proxy to keep API keys on the server side and to avoid
    CORS inconsistencies between providers.
    """

    def __init__(self, settings: type[Settings] = Settings):
        self.provider = settings.MAP_SEARCH_PROVIDER
        self.api_key = settings.MAP_SEARCH_API_KEY
        self.custom_url = settings.MAP_SEARCH_URL
        self.limit = settings.MAP_SEARCH_LIMIT
        self.country_codes = settings.MAP_SEARCH_COUNTRY_CODES

    def search(self, query: str) -> list[dict[str, Any]]:
        """
        Search for places worldwide or in configured countries.
        """
        cleaned_query = (query or "").strip()
        if len(cleaned_query) < 2:
            return []

        if self.provider in {"nominatim", "osm", "openstreetmap"}:
            return self._search_nominatim(cleaned_query)
        if self.provider == "photon":
            return self._search_photon(cleaned_query)
        if self.provider == "google":
            return self._search_google(cleaned_query)

        logger.warning("Unknown geocoding provider (%s), falling back to Nominatim", self.provider)
        return self._search_nominatim(cleaned_query)

    def _fetch_json(self, url: str, headers: dict[str, str] | None = None) -> Any:
        """
        Retrieve a JSON response, setting an explicit User-Agent.
        """
        request_headers = {
            "Accept": "application/json",
            "User-Agent": "SABI Trajectory Editor/1.0",
            **(headers or {}),
        }
        request = Request(url, headers=request_headers)
        try:
            with urlopen(request, timeout=8) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            raise ValueError(f"HTTP geocoding error {exc.code}: {error_body}") from exc
        except URLError as exc:
            raise ValueError(f"Geocoding service unavailable: {exc.reason}") from exc

    def _search_nominatim(self, query: str) -> list[dict[str, Any]]:
        """
        Search via Nominatim/OpenStreetMap.
        """
        base_url = self.custom_url or "https://nominatim.openstreetmap.org/search"
        params = {
            "format": "jsonv2",
            "q": query,
            "limit": str(self.limit),
            "addressdetails": "1",
        }
        if self.country_codes:
            params["countrycodes"] = self.country_codes

        rows = self._fetch_json(f"{base_url}?{urlencode(params)}")
        return [
            {
                "label": row.get("display_name", ""),
                "lat": float(row["lat"]),
                "lon": float(row["lon"]),
                "type": row.get("type") or row.get("class") or "",
                "provider": "nominatim",
            }
            for row in rows
            if row.get("lat") is not None and row.get("lon") is not None
        ]

    def _search_photon(self, query: str) -> list[dict[str, Any]]:
        """
        Search via Photon, an OpenStreetMap-based geocoder.
        """
        base_url = self.custom_url or "https://photon.komoot.io/api/"
        params = {
            "q": query,
            "limit": str(self.limit),
        }
        data = self._fetch_json(f"{base_url}?{urlencode(params)}")
        results = []
        for feature in data.get("features", []):
            coords = feature.get("geometry", {}).get("coordinates", [])
            props = feature.get("properties", {})
            if len(coords) < 2:
                continue
            label_parts = [
                props.get("name"),
                props.get("street"),
                props.get("city"),
                props.get("state"),
                props.get("country"),
            ]
            label = ", ".join(str(part) for part in label_parts if part)
            results.append({
                "label": label or props.get("osm_value", "Unnamed result"),
                "lat": float(coords[1]),
                "lon": float(coords[0]),
                "type": props.get("osm_value", ""),
                "provider": "photon",
            })
        return results

    def _search_google(self, query: str) -> list[dict[str, Any]]:
        """
        Search via Google Geocoding API.
        """
        if not self.api_key:
            raise ValueError("MAP_SEARCH_API_KEY is required for MAP_SEARCH_PROVIDER=google")

        base_url = self.custom_url or "https://maps.googleapis.com/maps/api/geocode/json"
        params = {
            "address": query,
            "key": self.api_key,
        }
        data = self._fetch_json(f"{base_url}?{urlencode(params)}")
        status = data.get("status")
        if status not in {"OK", "ZERO_RESULTS"}:
            raise ValueError(f"Google Geocoding error: {status} - {data.get('error_message', '')}")

        results = []
        for row in data.get("results", [])[: self.limit]:
            location = row.get("geometry", {}).get("location", {})
            if "lat" not in location or "lng" not in location:
                continue
            results.append({
                "label": row.get("formatted_address", ""),
                "lat": float(location["lat"]),
                "lon": float(location["lng"]),
                "type": ",".join(row.get("types", [])),
                "provider": "google",
            })
        return results
