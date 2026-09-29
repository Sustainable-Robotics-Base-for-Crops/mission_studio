"""Third-party file imports: shapefile reader, vendor dialects, preview service.

Fixtures are built here on purpose. The real vendor files live in a local,
gitignored folder, so the suite has to stay self-contained: these builders write
the same structures those files carry (Naïo WorkMap v4, Raven ``_0`` /
``_lpLines`` shapefile pair).
"""

from __future__ import annotations

import json
import struct
import zipfile
from io import BytesIO

import pytest

from backend.imports import ImportRefused, preview
from backend.imports.registry import descriptors, detect
from backend.imports.service import MAX_BYTES
from backend.imports.shapefile import ShapefileError, read_shapefile, read_shapefile_zip
from backend.imports.types import ImportSource

# -- fixture builders --------------------------------------------------------


def _shp(shape_type: int, records: list[list[list[list[float]]]]) -> bytes:
    """A minimal SHP. ``records`` is a list of parts, each part a ring/line."""
    body = b""
    for number, parts in enumerate(records, start=1):
        points = [point for part in parts for point in part]
        starts: list[int] = []
        cursor = 0
        for part in parts:
            starts.append(cursor)
            cursor += len(part)
        content = struct.pack("<i", shape_type)
        content += struct.pack("<4d", 0.0, 0.0, 0.0, 0.0)
        content += struct.pack("<2i", len(parts), len(points))
        content += struct.pack(f"<{len(starts)}i", *starts)
        for point in points:
            content += struct.pack("<2d", point[0], point[1])
        body += struct.pack(">2i", number, len(content) // 2) + content
    header = struct.pack(">i", 9994) + b"\x00" * 20
    header += struct.pack(">i", (100 + len(body)) // 2)
    header += struct.pack("<2i", 1000, shape_type)
    header += struct.pack("<8d", 0, 0, 0, 0, 0, 0, 0, 0)
    return header + body


def _dbf(fields: list[tuple[str, str, int]], rows: list[list[str]]) -> bytes:
    record_length = 1 + sum(length for _name, _kind, length in fields)
    header_length = 32 + 32 * len(fields) + 1
    header = bytes([0x03]) + bytes([26, 1, 1])
    header += struct.pack("<IHH", len(rows), header_length, record_length)
    header += b"\x00" * 17 + bytes([0x57]) + b"\x00" * 2
    for name, kind, length in fields:
        header += name.encode("cp1252")[:11].ljust(11, b"\x00")
        header += kind.encode("ascii")
        header += b"\x00" * 4
        header += bytes([length, 4])
        header += b"\x00" * 14
    header += b"\x0d"
    body = b""
    for row in rows:
        body += b" "
        for (_name, _kind, length), value in zip(fields, row, strict=True):
            body += value.encode("cp1252")[:length].ljust(length, b" ")
    return header + body + b"\x1a"


def _zip(members: dict[str, bytes]) -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, payload in members.items():
            archive.writestr(name, payload)
    return buffer.getvalue()


def naio_work_map(rows: int = 3, spacing: float = 0.000018) -> bytes:
    """Rows running east, each a lead-in plus the axis, like the real export."""
    features = []
    for index in range(rows):
        lat = 43.61624 - index * spacing
        features.append(
            {
                "type": "Feature",
                "id": index + 1,
                "properties": {
                    "type": "Crop",
                    "crop_holes": [],
                    "trace_type": "OverCrops",
                    "direct_way": {"enabled": True, "can_enter_left": True},
                    "reversed_way": {"enabled": True, "can_enter_left": True},
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [6.750292, lat],
                        [6.750296, lat],
                        [6.751370, lat - 0.000003],
                    ],
                },
            }
        )
    return json.dumps(
        {
            "metadata": {
                "name": "101-106-traces.geojson",
                "timestamp": 1782378889294,
                "type": "WorkMap",
                "owner": "grower@example.invalid",
                "description": "",
                "uuid": "e68c19ca-7736-496b-a887-5a0fc6fb1bd7",
                "version": 4,
                "mandatory_row_order": None,
            },
            "features": features,
            "type": "FeatureCollection",
        }
    ).encode("utf-8")


def raven_job(cells: int = 3, lines: int = 2) -> bytes:
    coverage_fields = [
        ("timeStamp", "C", 25),
        ("actualRate", "N", 9),
        ("targetRate", "N", 9),
        ("cog", "N", 9),
        ("sogMPerSec", "N", 9),
        ("elevM", "N", 9),
        ("gpsMode", "C", 20),
        ("product", "C", 40),
        ("guid", "C", 38),
        ("equipId", "C", 40),
    ]
    coverage_rows = []
    quads = []
    for index in range(cells):
        lat = 48.97298 - index * 0.00001
        # Four distinct vertices, deliberately left open: Raven does the same.
        quads.append(
            [
                [
                    [4.019891, lat],
                    [4.019892, lat - 0.000007],
                    [4.019862, lat - 0.000007],
                    [4.019861, lat],
                ]
            ]
        )
        coverage_rows.append(
            [
                f"4/8/2026 1:14:5{index} PM",
                "   0.0000",
                "   0.0000",
                " 179.2498",
                "   1.1000",
                " 164.0495",
                " " * 20,
                "Couverture 1",
                "{5c20cd4c-6975-4c82-ad08-bd08e2ae1edc}",
                "{6a9788ff-6129-4ef1-a505-3c264ea3a463}",
            ]
        )
    line_parts = []
    for index in range(lines):
        lon = 4.019877 + index * 0.00005
        line_parts.append([[[lon, 48.972958], [lon + 0.000037, 48.972116]]])
    return _zip(
        {
            "Avize Retraite_0.shp": _shp(5, quads),
            "Avize Retraite_0.dbf": _dbf(coverage_fields, coverage_rows),
            "Avize Retraite_0.prj": b'GEOGCS["GCS_WGS1984"]',
            "Avize Retraite_lpLines.shp": _shp(3, line_parts),
            "Avize Retraite_lpLines.dbf": _dbf([("swathWidth", "N", 9)], [["   2.2000"]] * lines),
        }
    )


def _metrics(report: dict) -> dict[str, object]:
    return {metric["key"]: metric["value"] for metric in report["metrics"]}


def _notices(report: dict) -> set[str]:
    return {notice["key"] for notice in report["notices"]}


# -- shapefile reader --------------------------------------------------------


def test_reader_closes_an_open_esri_ring():
    layer = read_shapefile("cells", _shp(5, [[[[0.0, 0.0], [0.0, 1.0], [1.0, 1.0]]]]))
    ring = layer.records[0].geometry["coordinates"][0]
    assert layer.records[0].geometry["type"] == "Polygon"
    assert ring[0] == ring[-1]
    assert len(ring) == 4


def test_reader_types_dbf_columns():
    data = _zip(
        {
            "a.shp": _shp(1, [[[[3.0, 45.0]]]]),
            "a.dbf": _dbf([("name", "C", 10), ("width", "N", 9)], [["Row 1", "   2.2000"]]),
        }
    )
    layer = read_shapefile_zip(data)[0]
    assert layer.records[0].attributes == {"name": "Row 1", "width": 2.2}
    assert layer.shape_type_name == "Point"


def test_reader_rejects_bytes_that_are_not_a_shapefile():
    with pytest.raises(ShapefileError):
        read_shapefile("x", b"not a shapefile at all" * 10)


def test_reader_ignores_macos_resource_forks():
    data = _zip(
        {
            "a.shp": _shp(1, [[[[3.0, 45.0]]]]),
            "__MACOSX/._a.shp": b"junk",
            ".DS_Store": b"junk",
        }
    )
    assert [layer.name for layer in read_shapefile_zip(data)] == ["a"]


# -- detection ---------------------------------------------------------------


def test_every_registered_adapter_is_listed_once():
    ids = [descriptor["id"] for descriptor in descriptors()]
    assert ids == sorted(set(ids), key=ids.index)
    assert {
        "naio_workmap",
        "raven_shapefile",
        "geojson_generic",
        "shapefile_generic",
        "isoxml",
        "field_dossier",
        "binary_map",
        "work_performed",
    } == set(ids)


def test_vendor_dialects_outrank_the_generic_reader_of_the_same_extension():
    naio = detect(ImportSource("traces.geojson", naio_work_map()))
    raven = detect(ImportSource("job.zip", raven_job()))
    assert [candidate.adapter_id for candidate in naio] == ["naio_workmap", "geojson_generic"]
    assert [candidate.adapter_id for candidate in raven] == [
        "raven_shapefile",
        "shapefile_generic",
    ]


def test_a_plain_collection_is_only_claimed_by_the_generic_reader():
    document = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"srbc_kind": "landmark", "name": "P1"},
                    "geometry": {"type": "Point", "coordinates": [3.17, 45.85]},
                }
            ],
        }
    ).encode("utf-8")
    assert [c.adapter_id for c in detect(ImportSource("survey.geojson", document))] == [
        "geojson_generic"
    ]


def test_detection_stays_silent_on_unknown_bytes():
    assert detect(ImportSource("photo.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)) == []


# -- Naïo WorkMap ------------------------------------------------------------


def test_naio_rows_become_rows_and_keep_their_vendor_properties():
    result = preview("traces.geojson", naio_work_map(rows=3))
    report = result["report"]
    assert result["adapter"] == "naio_workmap"
    assert report["kinds"] == {"row": 3}
    marker = result["collection"]["features"][0]["properties"]["srbc_import"]
    assert marker["kind"] == "row"
    assert marker["vendor"] == "naio"
    assert marker["promotion"] == "catalogue.row"
    assert marker["source"]["trace_type"] == "OverCrops"
    assert marker["source"]["direct_way"]["enabled"] is True


def test_naio_report_measures_spacing_bearing_and_lead_in():
    metrics = _metrics(preview("traces.geojson", naio_work_map(rows=4))["report"])
    assert metrics["imports.metric.rows"] == 4
    assert 1.5 < float(metrics["imports.metric.rowSpacing"]) < 2.5
    assert 80.0 < float(metrics["imports.metric.rowBearing"]) < 100.0
    assert float(metrics["imports.metric.leadIn"]) < 1.0
    assert metrics["imports.metric.formatVersion"] == "4"
    assert metrics["imports.metric.generatedAt"].startswith("2026-06-25T")


def test_naio_layer_never_carries_the_owner_email():
    result = preview("traces.geojson", naio_work_map())
    assert "imports.notice.ownerDropped" in _notices(result["report"])
    assert "example.invalid" not in json.dumps(result["collection"])


def test_naio_warns_that_the_file_holds_no_field_limit():
    notices = _notices(preview("traces.geojson", naio_work_map())["report"])
    assert "imports.notice.noBoundary" in notices
    assert "imports.notice.naioFreeRowOrder" in notices


def test_naio_counts_declared_row_interruptions():
    document = json.loads(naio_work_map(rows=2))
    document["features"][0]["properties"]["crop_holes"] = [{"start": 1}, {"start": 2}]
    report = preview("traces.geojson", json.dumps(document).encode("utf-8"))["report"]
    assert {"key": "imports.notice.naioCropHoles", "params": {"count": 2}} in report["notices"]


def test_forcing_the_generic_reader_downgrades_rows_to_landmarks():
    report = preview("traces.geojson", naio_work_map(rows=3), "geojson_generic")["report"]
    assert report["kinds"] == {"landmark": 3}


def test_naio_refuses_a_document_that_is_not_a_work_map():
    plain = json.dumps({"type": "FeatureCollection", "features": []}).encode("utf-8")
    with pytest.raises(ImportRefused) as refusal:
        preview("x.geojson", plain, "naio_workmap")
    assert refusal.value.key == "imports.error.notNaioWorkMap"


# -- Raven shapefile ---------------------------------------------------------


def test_raven_splits_coverage_footprints_from_last_pass_lines():
    result = preview("job.zip", raven_job(cells=3, lines=2))
    report = result["report"]
    assert result["adapter"] == "raven_shapefile"
    assert report["kinds"] == {"coverage_cell": 3, "guidance_line": 2}
    assert report["members"] == ["Avize Retraite_0", "Avize Retraite_lpLines"]
    kinds = {
        feature["properties"]["srbc_import"]["kind"]: feature["geometry"]["type"]
        for feature in result["collection"]["features"]
    }
    assert kinds == {"coverage_cell": "Polygon", "guidance_line": "LineString"}


def test_raven_report_reads_swath_speed_and_duration():
    metrics = _metrics(preview("job.zip", raven_job(cells=3, lines=2))["report"])
    assert metrics["imports.metric.coverageCells"] == 3
    assert metrics["imports.metric.swathWidth"] == 2.2
    assert metrics["imports.metric.meanSpeed"] == 1.1
    assert metrics["imports.metric.duration"] == 2.0
    assert metrics["imports.metric.product"] == "Couverture 1"
    assert metrics["imports.metric.runStartedAt"].startswith("2026-04-08T13:14:5")


def test_raven_says_coverage_is_not_a_boundary_and_admits_missing_gnss_quality():
    notices = _notices(preview("job.zip", raven_job())["report"])
    assert "imports.notice.ravenCoverageNotBoundary" in notices
    assert "imports.notice.ravenNoRate" in notices
    assert "imports.notice.ravenNoGpsMode" in notices
    assert "imports.notice.noBoundary" in notices


def test_raven_keeps_the_job_and_machine_identifiers_out_of_vehicle_id():
    result = preview("job.zip", raven_job())
    metrics = _metrics(result["report"])
    assert metrics["imports.metric.jobId"].startswith("{5c20cd4c")
    assert metrics["imports.metric.machineId"].startswith("{6a9788ff")


def test_a_shapefile_without_the_raven_signature_falls_back_to_landmarks():
    data = _zip(
        {
            "parcelle.shp": _shp(5, [[[[3.0, 45.0], [3.001, 45.0], [3.001, 45.001]]]]),
            "parcelle.dbf": _dbf([("nom", "C", 10)], [["Nord"]]),
        }
    )
    assert [c.adapter_id for c in detect(ImportSource("p.zip", data))] == ["shapefile_generic"]
    report = preview("p.zip", data)["report"]
    assert report["kinds"] == {"landmark": 1}
    assert "imports.notice.unqualified" in _notices(report)
    with pytest.raises(ImportRefused) as refusal:
        preview("p.zip", data, "raven_shapefile")
    assert refusal.value.key == "imports.error.notRaven"


# -- promotion plan (phase two) ---------------------------------------------


def test_promotions_name_what_a_later_lot_could_build():
    naio = preview("traces.geojson", naio_work_map(rows=6))["report"]["promotions"]
    assert naio == [{"kind": "row", "target": "catalogue.row", "count": 6, "collective": False}]
    raven = preview("job.zip", raven_job(cells=5, lines=2))["report"]["promotions"]
    assert raven == [
        {
            "kind": "coverage_cell",
            "target": "agri.work_performed",
            "count": 5,
            "collective": True,
        },
        {
            "kind": "guidance_line",
            "target": "catalogue.guidance_line",
            "count": 2,
            "collective": False,
        },
    ]


# -- service guards ----------------------------------------------------------


def test_preview_refuses_empty_oversized_and_unrecognised_uploads():
    with pytest.raises(ImportRefused) as empty:
        preview("a.geojson", b"")
    assert empty.value.key == "imports.error.empty"

    with pytest.raises(ImportRefused) as large:
        preview("a.geojson", b"x" * (MAX_BYTES + 1))
    assert large.value.key == "imports.error.tooLarge"

    with pytest.raises(ImportRefused) as unknown:
        preview("a.txt", b"plain text, no geometry anywhere")
    assert unknown.value.key == "imports.error.unrecognised"


def test_preview_refuses_an_unknown_adapter_id():
    with pytest.raises(ImportRefused) as refusal:
        preview("traces.geojson", naio_work_map(), "john_deere_setup")
    assert refusal.value.key == "imports.error.unknownAdapter"


def test_preview_lists_the_candidates_so_the_operator_can_override():
    result = preview("traces.geojson", naio_work_map())
    assert [candidate["adapter"] for candidate in result["candidates"]] == [
        "naio_workmap",
        "geojson_generic",
    ]
    assert result["candidates"][0]["reason"] == "imports.reason.naioWorkMap"
    assert result["candidates"][0]["params"] == {"version": 4}
    assert result["source"]["filename"] == "traces.geojson"
    assert {descriptor["id"] for descriptor in result["adapters"]} >= {"naio_workmap"}
