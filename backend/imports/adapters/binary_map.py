"""Binary field archive: polygon rings plus straight guidance read from the catalogue.

A setup archive stores each ring as little-endian longitude/latitude pairs in a
``.fdShape`` member (20 bytes per vertex: two doubles and a 4-byte pad). Straight
guidance is taken from the catalogue text (two endpoints). A curve whose only
readable geometry is those two endpoints is imported as that segment, and the
report says so.
"""

from __future__ import annotations

import struct
import xml.etree.ElementTree as ET
from typing import Any
from xml.etree.ElementTree import Element

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
    id="binary_map",
    label="Binary map archive",
    vendor="binary_map",
    extensions=(".zip",),
    format_id="binary_map",
    kinds=("boundary", "guidance_line"),
)

#: Marker at byte 16 of a shape member this reader understands.
_SHAPE_MARK = 513


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _files(source: ImportSource) -> list[tuple[str, bytes]]:
    if not is_zip(source.data):
        return []
    return [(path, payload) for path, _base, payload in named(members(source.data))]


def _is_shape(path: str, payload: bytes) -> bool:
    if not path.lower().endswith(".fdshape"):
        return False
    if len(payload) < 64:
        return False
    mark = struct.unpack_from("<I", payload, 16)[0]
    return mark == _SHAPE_MARK


def detect(source: ImportSource) -> Detection | None:
    files = _files(source)
    shapes = sum(1 for path, payload in files if _is_shape(path, payload))
    if shapes == 0:
        return None
    return Detection(
        adapter_id=DESCRIPTOR.id,
        confidence=0.93,
        reason_key="imports.reason.binaryMap",
        reason_params={"count": shapes},
    )


def _rings(payload: bytes) -> list[list[list[float]]]:
    if not _is_shape("", payload) and not (
        len(payload) >= 64 and struct.unpack_from("<I", payload, 16)[0] == _SHAPE_MARK
    ):
        return []
    ring_count = struct.unpack_from("<Q", payload, 32)[0]
    if ring_count < 1 or ring_count > 64:
        return []
    cursor = 48
    rings: list[list[list[float]]] = []
    for _ in range(ring_count):
        if cursor + 16 > len(payload):
            break
        _kind, count = struct.unpack_from("<QQ", payload, cursor)
        cursor += 16
        if count < 3 or count > 100_000 or cursor + count * 20 > len(payload):
            break
        ring: list[list[float]] = []
        valid = True
        for _point in range(count):
            lon, lat = struct.unpack_from("<dd", payload, cursor)
            cursor += 20
            if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
                valid = False
                break
            ring.append([lon, lat])
        if not valid or len(ring) < 3:
            continue
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        rings.append(ring)
    return rings


def _float_attr(element: Element, name: str) -> float | None:
    raw = element.attrib.get(name)
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _pair_from(element: Element) -> list[float] | None:
    lat = _float_attr(element, "latitude")
    lon = _float_attr(element, "longitude")
    if lat is None or lon is None:
        lat = None
        lon = None
        for child in element.iter():
            if _local(child.tag) in {"vrLatitude", "Latitude"} and lat is None:
                lat = _float_attr(child, "value")
            if _local(child.tag) in {"vrLongitude", "Longitude"} and lon is None:
                lon = _float_attr(child, "value")
    if lat is None or lon is None:
        return None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None
    return [lon, lat]


def _catalogue_lines(payload: bytes) -> list[tuple[str, list[list[float]], bool]]:
    """``(name, [start, end], chord_only)`` from a catalogue document."""
    try:
        root = ET.fromstring(payload)
    except ET.ParseError:
        return []
    lines: list[tuple[str, list[list[float]], bool]] = []
    for element in root.iter():
        name = _local(element.tag)
        if name not in {"ABLine", "ABCurve"}:
            continue
        endpoints: list[list[float]] = []
        for child in element.iter():
            child_name = _local(child.tag)
            if child_name not in {"APoint", "BPoint"}:
                continue
            point = _pair_from(child)
            if point is not None:
                endpoints.append(point)
        if len(endpoints) >= 2 and endpoints[0] != endpoints[1]:
            label = element.attrib.get("name") or name
            lines.append((label, endpoints[:2], name == "ABCurve"))
    return lines


def _field_name(files: list[tuple[str, bytes]], folder: str) -> str:
    for path, payload in files:
        if folder not in path or not path.lower().endswith("spatialcatalog"):
            continue
        try:
            root = ET.fromstring(payload)
        except ET.ParseError:
            continue
        for element in root.iter():
            if _local(element.tag) == "Field" and element.attrib.get("name"):
                return str(element.attrib["name"])
    return folder or "field"


def _folder(path: str) -> str:
    parts = [part for part in path.split("/") if part]
    # …/Fields/<bucket>/<uuid>/Boundary….fdShape → the uuid directory.
    if len(parts) >= 2:
        return parts[-2]
    return parts[0] if parts else "field"


def parse(source: ImportSource) -> ImportResult:
    files = _files(source)
    if not any(_is_shape(path, payload) for path, payload in files):
        raise ImportRefused("imports.error.notBinaryMap")
    features: list[dict[str, Any]] = []
    folders: dict[str, str] = {}
    for path, payload in files:
        base = path.rsplit("/", 1)[-1]
        if not _is_shape(path, payload) or not base.lower().startswith("boundary"):
            continue
        rings = _rings(payload)
        if not rings:
            continue
        folder = _folder(path)
        group_name = folders.setdefault(folder, _field_name(files, folder))
        exterior, *holes = rings
        features.append(
            imported_feature(
                {"type": "Polygon", "coordinates": [exterior, *holes]},
                "boundary",
                descriptor=DESCRIPTOR,
                label=group_name,
                extra={"group_id": folder, "group_name": group_name},
            )
        )
    curve_chords = 0
    single_folder = next(iter(folders)) if len(folders) == 1 else None
    for path, payload in files:
        if "spatialcatalog" not in path.lower():
            continue
        folder = _folder(path)
        group_id = single_folder or (folder if folder in folders else "guidance")
        group_name = folders.get(group_id) or folders.get(folder) or group_id
        for label, endpoints, chord in _catalogue_lines(payload):
            if chord:
                curve_chords += 1
            features.append(
                imported_feature(
                    {"type": "LineString", "coordinates": endpoints},
                    "guidance_line",
                    descriptor=DESCRIPTOR,
                    label=label,
                    extra={"group_id": group_id, "group_name": group_name},
                )
            )
    if not features:
        raise ImportRefused("imports.error.noGeometry")
    notices: list[Notice] = []
    group_ids = {feature["properties"]["srbc_import"]["group_id"] for feature in features}
    if len(group_ids) > 1:
        notices.append(Notice("imports.notice.severalFields", {"count": len(group_ids)}))
    if curve_chords:
        notices.append(Notice("imports.notice.curveChord", {"count": curve_chords}))
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
