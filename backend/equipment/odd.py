"""Declared ODD JSON stored on combinations (lot L10c)."""

from __future__ import annotations

from typing import Any

WEATHER = ("any", "dry", "no_rain", "no_wind", "clear")
VISIBILITY = ("day", "day_night", "any")
CROP = ("any", "open_field", "vine", "orchard", "vegetables")
LOCALIZATION = ("rtk_required", "gnss_ok", "degraded_ok")


def default_odd(*, approved: bool = False) -> dict[str, Any]:
    return {
        "approved": approved,
        "max_slope_pct": 15 if approved else None,
        "weather": "any",
        "visibility": "day",
        "crop": "any",
        "localization": "rtk_required",
        "connectivity_required": False,
        "soil_note": "",
    }


def oem_odd() -> dict[str, Any]:
    """Declared SRBC envelope — no live weather / DEM."""
    return default_odd(approved=True)


def parse_odd(raw: Any) -> dict[str, Any]:
    record: dict[str, Any] = raw if isinstance(raw, dict) else {}
    slope = record.get("max_slope_pct")
    try:
        slope_n = float(slope) if slope is not None and slope != "" else None
    except (TypeError, ValueError):
        slope_n = None
    if slope_n is not None and slope_n < 0:
        slope_n = None
    weather = record.get("weather")
    visibility = record.get("visibility")
    crop = record.get("crop")
    localization = record.get("localization")
    return {
        "approved": record.get("approved") is True,
        "max_slope_pct": slope_n,
        "weather": weather if weather in WEATHER else "any",
        "visibility": visibility if visibility in VISIBILITY else "day",
        "crop": crop if crop in CROP else "any",
        "localization": localization if localization in LOCALIZATION else "rtk_required",
        "connectivity_required": record.get("connectivity_required") is True,
        "soil_note": str(record.get("soil_note") or ""),
    }
