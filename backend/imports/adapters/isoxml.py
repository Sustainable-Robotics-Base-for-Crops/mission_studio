"""ISO 11783-10 task data: field limits and guidance patterns.

One reader for every dialect of the same XML. A single ``TASKDATA`` file and a
zip of external files (``PFD00000.XML`` and the like) both work. A task file
with no ring and no line is refused: nothing is invented to fill the gap.

Points use attribute ``C`` as latitude and ``D`` as longitude, in degrees.
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
    id="isoxml",
    label="ISO XML",
    vendor="isoxml",
    extensions=(".xml", ".zip"),
    format_id="isoxml",
    kinds=("boundary", "guidance_line", "obstacle"),
)

#: Polygon type (attribute ``B``) that is an obstacle rather than a field limit.
_OBSTACLE_POLYGON = "6"
#: A heading pattern has one point and a bearing. The drawn length crosses the
#: partfield; it is a direction, not a measured row.
_HEADING_MIN_M = 40.0
_HEADING_MAX_M = 400.0


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _parse_xml(payload: bytes) -> Element | None:
    try:
        return ET.fromstring(payload)
    except ET.ParseError:
        return None


def _documents(source: ImportSource) -> list[Element]:
    documents: list[Element] = []
    if is_zip(source.data):
        for _path, _base, payload in named(members(source.data)):
            if not _base.lower().endswith(".xml"):
                continue
            root = _parse_xml(payload)
            if root is not None:
                documents.append(root)
        return documents
    if source.suffix in {".xml", ".txt"} or source.data.lstrip().startswith(b"<"):
        root = _parse_xml(source.data)
        if root is not None:
            documents.append(root)
    return documents


def _looks_like(documents: list[Element]) -> bool:
    for root in documents:
        name = _local(root.tag)
        if name in {"ISO11783_TaskData", "XFC"}:
            return True
        if root.find(".//") is not None and any(
            _local(child.tag) == "PFD" for child in root.iter()
        ):
            return True
    return False


def _partfields(documents: list[Element]) -> list[Element]:
    found: list[Element] = []
    for root in documents:
        for element in root.iter():
            if _local(element.tag) == "PFD":
                found.append(element)
    return found


def _point(element: Element) -> list[float] | None:
    if _local(element.tag) != "PNT":
        return None
    try:
        lat = float(element.attrib["C"])
        lon = float(element.attrib["D"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None
    return [lon, lat]


def _linestring(element: Element) -> list[list[float]]:
    return [point for child in list(element) if (point := _point(child)) is not None]


def _close(ring: list[list[float]]) -> list[list[float]]:
    if len(ring) >= 3 and ring[0] != ring[-1]:
        return [*ring, ring[0]]
    return ring


def _polygons(partfield: Element) -> list[tuple[str, dict[str, Any], str | None]]:
    """``(kind, geometry, label)`` for every polygon of one partfield."""
    figures: list[tuple[str, dict[str, Any], str | None]] = []
    for polygon in partfield.iter():
        if _local(polygon.tag) != "PLN":
            continue
        kind = "obstacle" if polygon.attrib.get("B") == _OBSTACLE_POLYGON else "boundary"
        label = polygon.attrib.get("E") or None
        exterior: list[list[float]] | None = None
        holes: list[list[list[float]]] = []

        def flush(polygon_kind: str = kind, polygon_label: str | None = label) -> None:
            nonlocal exterior, holes
            if exterior is None:
                return
            figures.append(
                (
                    polygon_kind,
                    {"type": "Polygon", "coordinates": [exterior, *holes]},
                    polygon_label or None,
                )
            )
            exterior = None
            holes = []

        for linestring in polygon:
            if _local(linestring.tag) != "LSG":
                continue
            ring = _close(_linestring(linestring))
            if len(ring) < 4:
                continue
            if linestring.attrib.get("A") == "2" and exterior is not None:
                holes.append(ring)
            else:
                flush()
                exterior = ring
        flush()
    return figures


def _guidance(partfield: Element) -> tuple[list[tuple[dict[str, Any], str | None, str]], int]:
    """Lines, plus how many of them are heading patterns (length not measured)."""
    lines: list[tuple[dict[str, Any], str | None, str]] = []
    headings = 0
    bounds = _bounds(partfield)
    for pattern in partfield.iter():
        if _local(pattern.tag) != "GPN":
            continue
        label = pattern.attrib.get("B") or None
        pattern_type = pattern.attrib.get("C") or ""
        collected: list[list[list[float]]] = []
        for linestring in pattern.iter():
            if _local(linestring.tag) != "LSG":
                continue
            points = _linestring(linestring)
            if len(points) >= 2:
                collected.append(points)
            elif len(points) == 1 and pattern_type == "2":
                heading = _float(pattern.attrib.get("G"))
                if heading is None:
                    continue
                segment = _heading_line(points[0], heading, bounds)
                collected.append(segment)
                headings += 1
        for points in collected:
            lines.append(({"type": "LineString", "coordinates": points}, label, pattern_type))
    return lines, headings


def _float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _bounds(partfield: Element) -> tuple[float, float, float, float] | None:
    lons: list[float] = []
    lats: list[float] = []
    for element in partfield.iter():
        point = _point(element)
        if point is None:
            continue
        lons.append(point[0])
        lats.append(point[1])
    if len(lons) < 2:
        return None
    return min(lons), min(lats), max(lons), max(lats)


def _heading_line(
    origin: list[float],
    heading_deg: float,
    bounds: tuple[float, float, float, float] | None,
) -> list[list[float]]:
    half = _HEADING_MIN_M
    if bounds is not None:
        west, south, east, north = bounds
        diagonal = geo.distance_m([west, south], [east, north])
        half = min(_HEADING_MAX_M, max(_HEADING_MIN_M, diagonal / 2.0))
    rad = math.radians(heading_deg)
    north_m = math.cos(rad) * half
    east_m = math.sin(rad) * half
    lat = origin[1]
    cos_lat = max(0.2, math.cos(math.radians(lat)))

    def shift(sign: float) -> list[float]:
        dlat = sign * north_m / geo.EARTH_RADIUS_M * (180.0 / math.pi)
        dlon = sign * east_m / (geo.EARTH_RADIUS_M * cos_lat) * (180.0 / math.pi)
        return [origin[0] + dlon, origin[1] + dlat]

    return [shift(-1.0), shift(1.0)]


def detect(source: ImportSource) -> Detection | None:
    documents = _documents(source)
    if not _looks_like(documents):
        return None
    count = len(_partfields(documents))
    return Detection(
        adapter_id=DESCRIPTOR.id,
        confidence=0.9,
        reason_key="imports.reason.isoxml",
        reason_params={"count": count},
    )


def parse(source: ImportSource) -> ImportResult:
    documents = _documents(source)
    if not _looks_like(documents):
        raise ImportRefused("imports.error.notIsoxml")
    features: list[dict[str, Any]] = []
    headings = 0
    for index, partfield in enumerate(_partfields(documents), start=1):
        group_id = str(partfield.attrib.get("A") or index)
        group_name = str(partfield.attrib.get("C") or group_id)
        extra = {"group_id": group_id, "group_name": group_name}
        for kind, geometry, label in _polygons(partfield):
            features.append(
                imported_feature(
                    geometry,
                    kind,
                    descriptor=DESCRIPTOR,
                    label=label or group_name,
                    extra=extra,
                )
            )
        lines, heading_count = _guidance(partfield)
        headings += heading_count
        for geometry, label, pattern_type in lines:
            features.append(
                imported_feature(
                    geometry,
                    "guidance_line",
                    descriptor=DESCRIPTOR,
                    label=label or group_name,
                    source_properties={"pattern": pattern_type} if pattern_type else None,
                    extra=extra,
                )
            )
    if not features:
        raise ImportRefused("imports.error.noGeometry")
    notices: list[Notice] = []
    groups = {feature["properties"]["srbc_import"]["group_id"] for feature in features}
    if len(groups) > 1:
        notices.append(Notice("imports.notice.severalFields", {"count": len(groups)}))
    if headings:
        notices.append(Notice("imports.notice.headingPattern", {"count": headings}))
    if not any(
        (feature.get("properties") or {}).get("srbc_import", {}).get("kind") == "boundary"
        for feature in features
    ):
        notices.append(Notice("imports.notice.noBoundary"))
    metrics = [
        Metric("imports.metric.features", len(features)),
        Metric(
            "imports.metric.guidanceLines",
            sum(
                1
                for feature in features
                if (feature.get("properties") or {}).get("srbc_import", {}).get("kind")
                == "guidance_line"
            ),
        ),
    ]
    return ImportResult(
        collection=collection_of(features),
        report=build_report(DESCRIPTOR, features, metrics=metrics, notices=notices),
    )


ADAPTER = Adapter(descriptor=DESCRIPTOR, detect=detect, parse=parse)
