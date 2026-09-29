"""Minimal ESRI Shapefile reader (SHP + DBF), standard library only.

Studio deliberately ships without GDAL: vendor exports arrive as a handful of
small files, and the parts we need are in the public ESRI white paper. Only the
shape types seen in agricultural exports are decoded, and only X/Y is read —
the Z and M arrays of the ``*Z`` / ``*M`` variants are skipped rather than
guessed at. Anything else raises :class:`ShapefileError`.
"""

from __future__ import annotations

import struct
import zipfile
from dataclasses import dataclass
from datetime import date
from io import BytesIO
from typing import Any

#: Guard against a zip bomb: real vendor archives are tens of kilobytes.
MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024

SHAPE_TYPE_NAMES: dict[int, str] = {
    0: "Null",
    1: "Point",
    3: "PolyLine",
    5: "Polygon",
    8: "MultiPoint",
    11: "PointZ",
    13: "PolyLineZ",
    15: "PolygonZ",
    18: "MultiPointZ",
    21: "PointM",
    23: "PolyLineM",
    25: "PolygonM",
}

_POINT_TYPES = frozenset({1, 11, 21})
_POLYLINE_TYPES = frozenset({3, 13, 23})
_POLYGON_TYPES = frozenset({5, 15, 25})
_MULTIPOINT_TYPES = frozenset({8, 18})

#: DBF language driver byte → codec. Vendor consoles write Windows code pages.
_DBF_CODECS: dict[int, str] = {
    0x01: "cp437",
    0x02: "cp850",
    0x03: "cp1252",
    0x57: "cp1252",
    0x58: "cp1252",
    0x59: "cp1252",
    0x64: "cp852",
    0x65: "cp866",
    0x6A: "cp737",
    0x87: "cp852",
    0xC8: "cp1250",
    0xC9: "cp1251",
}


class ShapefileError(ValueError):
    """The bytes are not a shapefile we can read."""


@dataclass(frozen=True)
class ShapefileRecord:
    number: int
    geometry: dict[str, Any] | None
    attributes: dict[str, Any]


@dataclass(frozen=True)
class ShapefileLayer:
    #: Member stem inside the archive, e.g. ``Avize Retraite_lpLines``.
    name: str
    shape_type: int
    fields: tuple[str, ...]
    records: tuple[ShapefileRecord, ...]

    @property
    def shape_type_name(self) -> str:
        return SHAPE_TYPE_NAMES.get(self.shape_type, f"Unknown({self.shape_type})")

    def column(self, name: str) -> list[Any]:
        return [record.attributes.get(name) for record in self.records]


def _closed_ring(ring: list[list[float]]) -> list[list[float]]:
    """ESRI rings are meant to be closed; Raven's are not. Close them."""
    if len(ring) < 3:
        return ring
    if ring[0] != ring[-1]:
        return [*ring, list(ring[0])]
    return ring


def _signed_area(ring: list[list[float]]) -> float:
    total = 0.0
    for index in range(len(ring) - 1):
        x1, y1 = ring[index][0], ring[index][1]
        x2, y2 = ring[index + 1][0], ring[index + 1][1]
        total += x1 * y2 - x2 * y1
    return total / 2.0


def _polygon_geometry(parts: list[list[list[float]]]) -> dict[str, Any] | None:
    """Group rings into polygons. Clockwise (negative area) rings are outer."""
    polygons: list[list[list[list[float]]]] = []
    for part in parts:
        ring = _closed_ring(part)
        if len(ring) < 4:
            continue
        if _signed_area(ring) < 0 or not polygons:
            polygons.append([ring])
        else:
            polygons[-1].append(ring)
    if not polygons:
        return None
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}
    return {"type": "MultiPolygon", "coordinates": polygons}


def _polyline_geometry(parts: list[list[list[float]]]) -> dict[str, Any] | None:
    usable = [part for part in parts if len(part) >= 2]
    if not usable:
        return None
    if len(usable) == 1:
        return {"type": "LineString", "coordinates": usable[0]}
    return {"type": "MultiLineString", "coordinates": usable}


def _read_points(body: bytes, offset: int, count: int) -> list[list[float]]:
    needed = offset + 16 * count
    if count < 0 or needed > len(body):
        raise ShapefileError("truncated point array")
    points: list[list[float]] = []
    for index in range(count):
        x, y = struct.unpack_from("<2d", body, offset + 16 * index)
        points.append([x, y])
    return points


def _split_parts(points: list[list[float]], starts: list[int]) -> list[list[list[float]]]:
    parts: list[list[list[float]]] = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(points)
        if 0 <= start <= end <= len(points):
            parts.append(points[start:end])
    return parts


def _geometry_from_record(body: bytes) -> dict[str, Any] | None:
    if len(body) < 4:
        return None
    (shape_type,) = struct.unpack_from("<i", body, 0)
    if shape_type == 0:
        return None
    if shape_type in _POINT_TYPES:
        if len(body) < 20:
            raise ShapefileError("truncated point record")
        x, y = struct.unpack_from("<2d", body, 4)
        return {"type": "Point", "coordinates": [x, y]}
    if shape_type in _MULTIPOINT_TYPES:
        (count,) = struct.unpack_from("<i", body, 36)
        points = _read_points(body, 40, count)
        if not points:
            return None
        return {"type": "MultiPoint", "coordinates": points}
    if shape_type in _POLYLINE_TYPES or shape_type in _POLYGON_TYPES:
        part_count, point_count = struct.unpack_from("<2i", body, 36)
        if part_count < 0 or 44 + 4 * part_count > len(body):
            raise ShapefileError("truncated part index")
        starts = list(struct.unpack_from(f"<{part_count}i", body, 44)) if part_count else [0]
        points = _read_points(body, 44 + 4 * part_count, point_count)
        parts = _split_parts(points, starts)
        if shape_type in _POLYGON_TYPES:
            return _polygon_geometry(parts)
        return _polyline_geometry(parts)
    raise ShapefileError(f"unsupported shape type {shape_type}")


def _read_shp(data: bytes) -> tuple[int, list[tuple[int, dict[str, Any] | None]]]:
    if len(data) < 100:
        raise ShapefileError("file is too short to be a shapefile")
    (file_code,) = struct.unpack_from(">i", data, 0)
    if file_code != 9994:
        raise ShapefileError("missing shapefile signature")
    (header_shape_type,) = struct.unpack_from("<i", data, 32)
    shapes: list[tuple[int, dict[str, Any] | None]] = []
    offset = 100
    while offset + 8 <= len(data):
        number, word_length = struct.unpack_from(">2i", data, offset)
        length = word_length * 2
        if length <= 0 or offset + 8 + length > len(data):
            break
        shapes.append((number, _geometry_from_record(data[offset + 8 : offset + 8 + length])))
        offset += 8 + length
    return header_shape_type, shapes


def _dbf_value(kind: str, raw: str) -> Any:
    text = raw.strip()
    if not text:
        return None
    if kind in {"N", "F", "Y"}:
        try:
            number = float(text)
        except ValueError:
            return text
        return int(number) if kind == "N" and number.is_integer() else number
    if kind == "L":
        return text.upper() in {"Y", "T"} if text.upper() in {"Y", "T", "N", "F"} else None
    if kind == "D" and len(text) == 8 and text.isdigit():
        try:
            return date(int(text[0:4]), int(text[4:6]), int(text[6:8])).isoformat()
        except ValueError:
            return text
    return text


def _read_dbf(data: bytes) -> tuple[tuple[str, ...], list[dict[str, Any]]]:
    if len(data) < 32:
        raise ShapefileError("DBF header is too short")
    record_count, header_length, record_length = struct.unpack_from("<IHH", data, 4)
    codec = _DBF_CODECS.get(data[29], "cp1252")
    descriptors: list[tuple[str, str, int]] = []
    offset = 32
    while offset + 32 <= header_length and data[offset] != 0x0D:
        chunk = data[offset : offset + 32]
        name = chunk[0:11].split(b"\x00")[0].decode(codec, "replace").strip()
        descriptors.append((name, chr(chunk[11]), chunk[16]))
        offset += 32
    names = tuple(name for name, _kind, _length in descriptors)
    rows: list[dict[str, Any]] = []
    cursor = header_length
    for _index in range(record_count):
        if cursor + record_length > len(data):
            break
        raw_record = data[cursor : cursor + record_length]
        cursor += record_length
        if raw_record[0:1] == b"*":  # tombstone
            continue
        position = 1
        row: dict[str, Any] = {}
        for name, kind, length in descriptors:
            cell = raw_record[position : position + length].decode(codec, "replace")
            row[name] = _dbf_value(kind, cell)
            position += length
        rows.append(row)
    return names, rows


def read_shapefile(name: str, shp: bytes, dbf: bytes | None = None) -> ShapefileLayer:
    """One SHP (plus its optional DBF) as a layer of GeoJSON geometries."""
    shape_type, shapes = _read_shp(shp)
    fields: tuple[str, ...] = ()
    rows: list[dict[str, Any]] = []
    if dbf:
        fields, rows = _read_dbf(dbf)
    records = tuple(
        ShapefileRecord(
            number=number,
            geometry=geometry,
            attributes=rows[index] if index < len(rows) else {},
        )
        for index, (number, geometry) in enumerate(shapes)
    )
    return ShapefileLayer(name=name, shape_type=shape_type, fields=fields, records=records)


def _archive_members(archive: zipfile.ZipFile) -> dict[str, dict[str, str]]:
    """Group archive entries by member stem: ``{stem: {"shp": path, ...}}``."""
    grouped: dict[str, dict[str, str]] = {}
    for info in archive.infolist():
        if info.is_dir():
            continue
        path = info.filename
        base = path.rsplit("/", 1)[-1]
        if base.startswith(".") or "__MACOSX" in path:
            continue
        if "." not in base:
            continue
        stem, _dot, extension = base.rpartition(".")
        extension = extension.lower()
        if extension not in {"shp", "dbf", "prj", "shx", "cpg"}:
            continue
        grouped.setdefault(stem, {})[extension] = path
    return grouped


def read_shapefile_zip(data: bytes) -> list[ShapefileLayer]:
    """Every SHP member of a zipped shapefile set, in archive order."""
    try:
        archive = zipfile.ZipFile(BytesIO(data))
    except (zipfile.BadZipFile, OSError) as reason:
        raise ShapefileError(f"unreadable archive: {reason}") from reason
    with archive:
        total = sum(info.file_size for info in archive.infolist())
        if total > MAX_UNCOMPRESSED_BYTES:
            raise ShapefileError("archive expands beyond the accepted size")
        layers: list[ShapefileLayer] = []
        for stem, members in _archive_members(archive).items():
            if "shp" not in members:
                continue
            shp = archive.read(members["shp"])
            dbf = archive.read(members["dbf"]) if "dbf" in members else None
            layers.append(read_shapefile(stem, shp, dbf))
        if not layers:
            raise ShapefileError("no .shp member in the archive")
        return layers


def archive_member_names(data: bytes) -> list[str]:
    """Stems of the SHP members of an archive, for the import report."""
    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            grouped = _archive_members(archive)
    except (zipfile.BadZipFile, OSError):
        return []
    return sorted(stem for stem, members in grouped.items() if "shp" in members)


def looks_like_shapefile_zip(data: bytes) -> bool:
    return bool(data[:2] == b"PK" and archive_member_names(data))


def looks_like_shapefile(data: bytes) -> bool:
    if len(data) < 100:
        return False
    return struct.unpack_from(">i", data, 0)[0] == 9994
