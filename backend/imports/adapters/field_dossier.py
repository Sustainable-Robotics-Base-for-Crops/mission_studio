"""Field dossier: text limits and tracks, plus a KML twin of the same field.

The text files store easting and northing in metres from a ``StartFix`` origin
(latitude, longitude). A KML already carries WGS84 and needs no origin. A zip
may hold several fields; each directory becomes one parcel the operator picks.
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from typing import Any
from xml.etree.ElementTree import Element

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
    id="field_dossier",
    label="Field dossier",
    vendor="field_dossier",
    extensions=(".zip", ".kml", ".txt"),
    format_id="field_dossier",
    kinds=("boundary", "guidance_line"),
)

_SECTION_KIND = {
    "$boundary": "boundary",
    "$tracklines": "guidance_line",
    "$curvelines": "guidance_line",
}


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _files(source: ImportSource) -> list[tuple[str, bytes]]:
    if is_zip(source.data):
        return [(path, payload) for path, _base, payload in named(members(source.data))]
    return [(source.filename, source.data)]


def _is_text_dossier(payload: bytes) -> bool:
    text = _text(payload)
    if text is None:
        return False
    head = text.lstrip()[:400].lower()
    return any(marker in head or marker in text.lower() for marker in ("$boundary", "$fielddir", "$tracklines", "$curvelines"))


def _is_kml(payload: bytes) -> bool:
    text = _text(payload)
    return bool(text and "<kml" in text.lower()[:800])


def _text(payload: bytes) -> str | None:
    for codec in ("utf-8-sig", "cp1252"):
        try:
            return payload.decode(codec)
        except UnicodeDecodeError:
            continue
    return None


def detect(source: ImportSource) -> Detection | None:
    files = _files(source)
    hits = 0
    for path, payload in files:
        base = path.rsplit("/", 1)[-1].lower()
        if base.endswith(".kml") and _is_kml(payload):
            hits += 1
        elif base.endswith(".txt") and _is_text_dossier(payload):
            hits += 1
        elif _is_kml(payload) or _is_text_dossier(payload):
            hits += 1
    if hits == 0:
        return None
    return Detection(
        adapter_id=DESCRIPTOR.id,
        confidence=0.95 if hits else 0.0,
        reason_key="imports.reason.fieldDossier",
        reason_params={"count": hits},
    )


def _origin(text: str) -> tuple[float, float] | None:
    lines = [line.strip() for line in text.splitlines()]
    for index, line in enumerate(lines):
        if line.lower() != "startfix":
            continue
        if index + 1 >= len(lines):
            return None
        parts = lines[index + 1].split(",")
        if len(parts) < 2:
            return None
        try:
            lat = float(parts[0])
            lon = float(parts[1])
        except ValueError:
            return None
        if -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0:
            return lat, lon
    return None


def _to_wgs(east: float, north: float, origin: tuple[float, float]) -> list[float]:
    lat0, lon0 = origin
    lat = lat0 + (north / geo.EARTH_RADIUS_M) * (180.0 / math.pi)
    lon = lon0 + (east / (geo.EARTH_RADIUS_M * max(0.2, math.cos(math.radians(lat0))))) * (
        180.0 / math.pi
    )
    return [lon, lat]


def _counted_groups(text: str) -> list[tuple[str, list[tuple[float, float]]]]:
    """Sections introduced by ``$Boundary`` / ``$TrackLines``, then a point count."""
    lines = text.splitlines()
    section = ""
    groups: list[tuple[str, list[tuple[float, float]]]] = []
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if line.startswith("$"):
            section = line.lower()
            index += 1
            continue
        if section in _SECTION_KIND and line.isdigit():
            count = int(line)
            points: list[tuple[float, float]] = []
            cursor = index + 1
            valid = count >= 2
            for _ in range(count):
                if cursor >= len(lines):
                    valid = False
                    break
                parts = lines[cursor].strip().split(",")
                if len(parts) < 2:
                    valid = False
                    break
                try:
                    points.append((float(parts[0]), float(parts[1])))
                except ValueError:
                    valid = False
                    break
                cursor += 1
            if valid and len(points) == count:
                groups.append((section, points))
                index = cursor
                continue
        index += 1
    return groups


def _kml_figures(payload: bytes) -> list[tuple[str, dict[str, Any], str | None]]:
    try:
        root = ET.fromstring(payload)
    except ET.ParseError:
        return []
    figures: list[tuple[str, dict[str, Any], str | None]] = []
    for placemark in root.iter():
        if _local(placemark.tag) != "Placemark":
            continue
        label = None
        for child in list(placemark):
            if _local(child.tag) == "name" and child.text:
                label = child.text.strip() or None
        for polygon in placemark.iter():
            if _local(polygon.tag) != "Polygon":
                continue
            ring = _kml_ring(polygon)
            if len(ring) >= 4:
                figures.append(("boundary", {"type": "Polygon", "coordinates": [ring]}, label))
        for line in placemark.iter():
            if _local(line.tag) != "LineString":
                continue
            coordinates = _kml_coordinates(line)
            if len(coordinates) >= 2:
                figures.append(
                    ("guidance_line", {"type": "LineString", "coordinates": coordinates}, label)
                )
    return figures


def _kml_ring(polygon: Element) -> list[list[float]]:
    for element in polygon.iter():
        if _local(element.tag) == "coordinates" and element.text:
            ring = _parse_kml_coordinates(element.text)
            if len(ring) >= 4:
                if ring[0] != ring[-1]:
                    ring = [*ring, ring[0]]
                return ring
    return []


def _kml_coordinates(line: Element) -> list[list[float]]:
    for element in line.iter():
        if _local(element.tag) == "coordinates" and element.text:
            return _parse_kml_coordinates(element.text)
    return []


def _parse_kml_coordinates(text: str) -> list[list[float]]:
    points: list[list[float]] = []
    for token in text.replace("\n", " ").split():
        parts = token.split(",")
        if len(parts) < 2:
            continue
        try:
            lon = float(parts[0])
            lat = float(parts[1])
        except ValueError:
            continue
        if -180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0:
            points.append([lon, lat])
    return points


def _group_of(path: str, filename: str) -> tuple[str, str]:
    parts = [part for part in path.replace("\\", "/").split("/") if part]
    if len(parts) >= 2:
        return parts[-2], parts[-2]
    stem = filename.rsplit(".", 1)[0] or filename
    return stem, stem


def parse(source: ImportSource) -> ImportResult:
    files = _files(source)
    if not any(_is_kml(payload) or _is_text_dossier(payload) for _path, payload in files):
        raise ImportRefused("imports.error.notFieldDossier")
    origins: dict[str, tuple[float, float]] = {}
    for path, payload in files:
        if not path.lower().endswith("field.txt"):
            continue
        text = _text(payload)
        origin = _origin(text) if text else None
        if origin is None:
            continue
        group_id, _name = _group_of(path, source.filename)
        origins[group_id] = origin
    features: list[dict[str, Any]] = []
    missing_origin = False
    text_groups: set[str] = set()
    for path, payload in files:
        base = path.rsplit("/", 1)[-1].lower()
        if not base.endswith(".txt") or not _is_text_dossier(payload):
            continue
        text = _text(payload)
        if not text:
            continue
        group_id, group_name = _group_of(path, source.filename)
        origin = origins.get(group_id) or (next(iter(origins.values())) if len(origins) == 1 else None)
        for section, points in _counted_groups(text):
            kind = _SECTION_KIND[section]
            if origin is None:
                missing_origin = True
                continue
            coordinates = [_to_wgs(east, north, origin) for east, north in points]
            if kind == "boundary":
                if coordinates[0] != coordinates[-1]:
                    coordinates = [*coordinates, coordinates[0]]
                if len(coordinates) < 4:
                    continue
                geometry: dict[str, Any] = {"type": "Polygon", "coordinates": [coordinates]}
            else:
                if len(coordinates) < 2:
                    continue
                geometry = {"type": "LineString", "coordinates": coordinates}
            text_groups.add(group_id)
            features.append(
                imported_feature(
                    geometry,
                    kind,
                    descriptor=DESCRIPTOR,
                    label=group_name,
                    extra={"group_id": group_id, "group_name": group_name},
                )
            )
    for path, payload in files:
        if not _is_kml(payload):
            continue
        group_id, group_name = _group_of(path, source.filename)
        # The text dossier already placed this field; the KML repeats it.
        if group_id in text_groups:
            continue
        for kind, geometry, label in _kml_figures(payload):
            features.append(
                imported_feature(
                    geometry,
                    kind,
                    descriptor=DESCRIPTOR,
                    label=label or group_name,
                    extra={"group_id": group_id, "group_name": group_name},
                )
            )
    if not features:
        if missing_origin:
            raise ImportRefused("imports.error.noOrigin")
        raise ImportRefused("imports.error.noGeometry")
    notices: list[Notice] = []
    group_ids = {feature["properties"]["srbc_import"]["group_id"] for feature in features}
    if len(group_ids) > 1:
        notices.append(Notice("imports.notice.severalFields", {"count": len(group_ids)}))
    if not any(
        feature["properties"]["srbc_import"]["kind"] == "boundary" for feature in features
    ):
        notices.append(Notice("imports.notice.noBoundary"))
    return ImportResult(
        collection=collection_of(features),
        report=build_report(
            DESCRIPTOR,
            features,
            metrics=[Metric("imports.metric.features", len(features))],
            notices=notices,
        ),
    )


ADAPTER = Adapter(descriptor=DESCRIPTOR, detect=detect, parse=parse)
