"""Agri JSON work performed: the path the robot actually drove.

Points are easting and northing in metres from a WGS84 origin, the same
convention as the studio (x east, y north). A zip may hold several logs;
each file is one parcel the operator picks before converting.
"""

from __future__ import annotations

import json
import math
from typing import Any

from backend.imports import geo
from backend.imports.archive import is_zip, members, named
from backend.imports.types import (
    Adapter,
    AdapterDescriptor,
    Detection,
    ImportRefused,
    ImportResult,
    ImportSource,
    Metric,
    Notice,
    build_report,
    collection_of,
    imported_feature,
)

DESCRIPTOR = AdapterDescriptor(
    id="work_performed",
    label="Work performed",
    vendor="agri",
    extensions=(".json", ".zip"),
    format_id="work_performed",
    kinds=("track",),
)

#: Same metre-per-degree constant as ``frontend/src/domain/geometry.ts``.
_METERS_PER_DEGREE = 111320.0


def _loads(payload: bytes) -> dict[str, Any] | None:
    try:
        document = json.loads(payload)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return document if isinstance(document, dict) else None


def _documents(source: ImportSource) -> list[tuple[str, dict[str, Any]]]:
    found: list[tuple[str, dict[str, Any]]] = []
    if is_zip(source.data):
        for path, base, payload in named(members(source.data)):
            if not base.lower().endswith(".json"):
                continue
            document = _loads(payload)
            if document is not None and document.get("file_type") == "work_performed":
                found.append((path, document))
        return found
    document = _loads(source.data)
    if document is not None and document.get("file_type") == "work_performed":
        found.append((source.filename or "work_performed.json", document))
    return found


def _origin(document: dict[str, Any]) -> tuple[float, float] | None:
    origin = document.get("origin")
    if not isinstance(origin, dict):
        return None
    coordinates = origin.get("coordinates")
    if not isinstance(coordinates, dict):
        return None
    try:
        lat = float(coordinates["lat"])
        lon = float(coordinates["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    if not math.isfinite(lat) or not math.isfinite(lon):
        return None
    return lat, lon


def _to_lonlat(lat0: float, lon0: float, east: float, north: float) -> list[float]:
    lat = lat0 + north / _METERS_PER_DEGREE
    lon = lon0 + east / (_METERS_PER_DEGREE * math.cos(math.radians(lat0)))
    return [lon, lat]


def _column(columns: list[Any], name: str) -> int | None:
    try:
        return columns.index(name)
    except ValueError:
        return None


def _line(section: dict[str, Any], lat0: float, lon0: float) -> list[list[float]]:
    columns = section.get("columns")
    values = section.get("values")
    if not isinstance(columns, list) or not isinstance(values, list):
        return []
    east_index = _column(columns, "x")
    north_index = _column(columns, "y")
    if east_index is None or north_index is None:
        return []
    coordinates: list[list[float]] = []
    for row in values:
        if not isinstance(row, list) or len(row) <= max(east_index, north_index):
            continue
        try:
            east = float(row[east_index])
            north = float(row[north_index])
        except (TypeError, ValueError):
            continue
        if not math.isfinite(east) or not math.isfinite(north):
            continue
        point = _to_lonlat(lat0, lon0, east, north)
        if coordinates and coordinates[-1] == point:
            continue
        coordinates.append(point)
    return coordinates if len(coordinates) >= 2 else []


def _stem(path: str) -> str:
    base = path.rsplit("/", 1)[-1]
    return base.rsplit(".", 1)[0] or base


def _metric_value(document: dict[str, Any], suffix: str) -> float | None:
    metadata = document.get("metadata")
    metrics = metadata.get("metrics") if isinstance(metadata, dict) else None
    if not isinstance(metrics, list):
        return None
    for metric in metrics:
        if not isinstance(metric, dict):
            continue
        identifier = metric.get("metric_id")
        if isinstance(identifier, str) and identifier.startswith(suffix):
            try:
                value = float(metric["value"])
            except (KeyError, TypeError, ValueError):
                return None
            return value if math.isfinite(value) else None
    return None


def _features(documents: list[tuple[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    for path, document in documents:
        origin = _origin(document)
        if origin is None:
            continue
        lat0, lon0 = origin
        group_id = _stem(path)
        vehicle = document.get("vehicle_id")
        group_name = (
            f"{vehicle} — {group_id}" if isinstance(vehicle, str) and vehicle.strip() else group_id
        )
        sections = document.get("points")
        if not isinstance(sections, list):
            continue
        for index, section in enumerate(sections, start=1):
            if not isinstance(section, dict):
                continue
            coordinates = _line(section, lat0, lon0)
            if not coordinates:
                continue
            section_type = section.get("section_type")
            label = section_type if isinstance(section_type, str) and section_type else group_name
            features.append(
                imported_feature(
                    {"type": "LineString", "coordinates": coordinates},
                    "track",
                    descriptor=DESCRIPTOR,
                    label=f"{label} #{index}" if len(sections) > 1 else label,
                    extra={"group_id": group_id, "group_name": group_name},
                )
            )
    return features


def _detect(source: ImportSource) -> Detection | None:
    documents = _documents(source)
    if not documents or not _features(documents):
        return None
    return Detection(
        adapter_id=DESCRIPTOR.id,
        confidence=0.97,
        reason_key="imports.reason.workPerformed",
        reason_params={"count": len(documents)},
    )


def _parse(source: ImportSource) -> ImportResult:
    documents = _documents(source)
    if not documents:
        raise ImportRefused("imports.error.notWorkPerformed")
    if any(_origin(document) is None for _path, document in documents):
        raise ImportRefused("imports.error.noOrigin")
    features = _features(documents)
    if not features:
        raise ImportRefused("imports.error.noGeometry")
    length = sum(geo.geometry_length_m(feature.get("geometry")) for feature in features)
    metrics = [
        Metric("imports.metric.features", len(features)),
        Metric("imports.metric.totalLength", geo.rounded(length, 1), "m"),
    ]
    if len(documents) == 1:
        _path, document = documents[0]
        duration = _metric_value(document, "agri.service.duration_s/")
        if duration is not None:
            metrics.append(Metric("imports.metric.duration", geo.rounded(duration, 0), "s"))
        vehicle = document.get("vehicle_id")
        if isinstance(vehicle, str) and vehicle.strip():
            metrics.append(Metric("imports.metric.machineId", vehicle.strip()))
    return ImportResult(
        collection=collection_of(features),
        report=build_report(
            DESCRIPTOR,
            features,
            metrics=metrics,
            notices=[Notice("imports.notice.workPerformed")],
            members=[path for path, _document in documents],
        ),
    )


ADAPTER = Adapter(descriptor=DESCRIPTOR, detect=_detect, parse=_parse)
