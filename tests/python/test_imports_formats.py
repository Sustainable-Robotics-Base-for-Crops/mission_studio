"""ISO XML, field dossier, binary map archives and work performed, plus the picker."""

import io
import json
import struct
import zipfile

from backend.imports import detect, format_descriptors, preview
from backend.imports.types import ImportSource


def _zip(members: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, payload in members.items():
            archive.writestr(name, payload)
    return buffer.getvalue()


def _isoxml(name: str = "Blt", points: int = 4) -> bytes:
    ring = []
    for index in range(points):
        lat = 48.12 + index * 0.001
        lon = 15.14 + (index % 2) * 0.001
        ring.append(f'<PNT A="2" C="{lat:.6f}" D="{lon:.6f}"/>')
    ring.append(ring[0])
    return f"""<?xml version="1.0"?>
<ISO11783_TaskData VersionMajor="4" VersionMinor="2">
  <PFD A="PFD-1" C="{name}">
    <PLN A="1">
      <LSG A="1">{"".join(ring)}</LSG>
    </PLN>
    <GGP A="GGP-1">
      <GPN A="GPN-1" B="swath" C="1">
        <LSG A="5">
          <PNT A="6" C="48.120000" D="15.140000"/>
          <PNT A="7" C="48.123000" D="15.141000"/>
        </LSG>
      </GPN>
    </GGP>
  </PFD>
</ISO11783_TaskData>
""".encode()


def test_the_picker_lists_file_types_and_not_manufacturers():
    labels = [item["label_key"] for item in format_descriptors()]
    assert labels == [
        "imports.formatName.geojson",
        "imports.formatName.shapefile",
        "imports.formatName.isoxml",
        "imports.formatName.fieldDossier",
        "imports.formatName.binaryMap",
        "imports.formatName.workPerformed",
    ]
    joined = " ".join(labels)
    for brand in ("naio", "raven", "deere", "topcon", "fendt", "claas"):
        assert brand not in joined


def test_isoxml_reads_a_boundary_and_a_guidance_line():
    result = preview("TASKDATA.XML", _isoxml())
    assert result["format"] == "isoxml"
    assert result["report"]["kinds"]["boundary"] == 1
    assert result["report"]["kinds"]["guidance_line"] == 1
    assert result["report"]["groups"][0]["name"] == "Blt"


def test_isoxml_follows_external_partfield_files():
    root = b"""<?xml version="1.0"?><ISO11783_TaskData>
      <XFR A="PFD00000" B="1"/>
    </ISO11783_TaskData>"""
    external = b"""<?xml version="1.0"?><XFC>
      <PFD A="PFD1" C="TESTFELD">
        <PLN A="1"><LSG A="1">
          <PNT A="2" C="48.1" D="15.1"/>
          <PNT A="2" C="48.2" D="15.1"/>
          <PNT A="2" C="48.2" D="15.2"/>
          <PNT A="2" C="48.1" D="15.1"/>
        </LSG></PLN>
      </PFD>
    </XFC>"""
    result = preview("task.zip", _zip({"TASKDATA.XML": root, "PFD00000.XML": external}))
    assert result["format"] == "isoxml"
    assert result["report"]["groups"][0]["name"] == "TESTFELD"
    assert result["report"]["kinds"]["boundary"] == 1


def test_isoxml_with_two_partfields_asks_the_operator_to_choose():
    document = b"""<?xml version="1.0"?><ISO11783_TaskData>
      <PFD A="A" C="North">
        <PLN A="1"><LSG A="1">
          <PNT C="48.1" D="15.1"/><PNT C="48.2" D="15.1"/><PNT C="48.2" D="15.2"/><PNT C="48.1" D="15.1"/>
        </LSG></PLN>
      </PFD>
      <PFD A="B" C="South">
        <PLN A="1"><LSG A="1">
          <PNT C="47.1" D="14.1"/><PNT C="47.2" D="14.1"/><PNT C="47.2" D="14.2"/><PNT C="47.1" D="14.1"/>
        </LSG></PLN>
      </PFD>
    </ISO11783_TaskData>"""
    result = preview("TASKDATA.XML", document)
    assert [group["name"] for group in result["report"]["groups"]] == ["North", "South"]
    assert any(
        notice["key"] == "imports.notice.severalFields" for notice in result["report"]["notices"]
    )


def test_isoxml_without_geometry_is_refused():
    document = b"""<?xml version="1.0"?>
    <ISO11783_TaskData><PFD A="PFD-1" C="empty" D="0"/></ISO11783_TaskData>"""
    try:
        preview("TASKDATA.XML", document)
    except Exception as reason:
        assert reason.key == "imports.error.noGeometry"
    else:
        raise AssertionError("an empty task file must be refused")


def test_field_dossier_places_local_metres_on_the_origin():
    field = b"StartFix\n48.0,2.0\n"
    boundary = b"$Boundary\nFalse\n4\n0,0,0\n100,0,0\n100,50,0\n0,50,0\n"
    result = preview(
        "plot.zip",
        _zip({"Field.txt": field, "Boundary.txt": boundary}),
    )
    assert result["format"] == "field_dossier"
    ring = result["collection"]["features"][0]["geometry"]["coordinates"][0]
    assert ring[0][0] == 2.0
    assert ring[0][1] == 48.0
    assert ring[1][0] > 2.0


def test_field_dossier_reads_kml_when_there_is_no_text_boundary():
    kml = b"""<?xml version="1.0"?>
    <kml><Document><Placemark><name>Square</name>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>
        2,48,0 2.001,48,0 2.001,48.001,0 2,48,0
      </coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark></Document></kml>"""
    result = preview("Field.kml", kml)
    assert result["format"] == "field_dossier"
    assert result["report"]["kinds"]["boundary"] == 1


def _shape(rings: list[list[tuple[float, float]]]) -> bytes:
    header = bytearray(48)
    struct.pack_into("<I", header, 16, 513)
    struct.pack_into("<Q", header, 32, len(rings))
    body = b""
    for ring in rings:
        body += struct.pack("<QQ", 1, len(ring))
        for lon, lat in ring:
            body += struct.pack("<ddI", lon, lat, 0)
    return bytes(header) + body


def test_binary_map_reads_a_ring_and_a_straight_guidance_line():
    ring = [
        (2.0, 48.0),
        (2.01, 48.0),
        (2.01, 48.01),
        (2.0, 48.01),
        (2.0, 48.0),
    ]
    catalog = b"""<?xml version="1.0"?>
    <SpatialCatalog>
      <Field name="North plot"/>
      <ABLine name="ab straight">
        <APoint latitude="48.001" longitude="2.001"/>
        <BPoint latitude="48.008" longitude="2.001"/>
      </ABLine>
    </SpatialCatalog>"""
    result = preview(
        "setup.zip",
        _zip(
            {
                "Fields/abc/Boundaryabc.fdShape": _shape([ring]),
                "Fields/abc/ImportExport.SpatialCatalog": catalog,
            }
        ),
    )
    assert result["format"] == "binary_map"
    assert result["report"]["kinds"]["boundary"] == 1
    assert result["report"]["kinds"]["guidance_line"] == 1
    assert result["report"]["groups"][0]["name"] == "North plot"


def test_forcing_geojson_on_isoxml_refuses_instead_of_guessing():
    try:
        preview("TASKDATA.XML", _isoxml(), format_id="geojson")
    except Exception as reason:
        assert reason.key == "imports.error.notGeoJSON"
    else:
        raise AssertionError("the GeoJSON reader must refuse ISO XML")


def test_a_plain_text_file_is_still_unrecognised():
    assert detect(ImportSource("notes.txt", b"hello field")) == []


def _work_performed(east_north: list[tuple[float, float]], vehicle: str = "srbc-17") -> bytes:
    return json.dumps(
        {
            "version": "3",
            "file_type": "work_performed",
            "vehicle_id": vehicle,
            "origin": {"type": "WGS84", "coordinates": {"lat": 46.5, "lon": 2.8, "alt": 0}},
            "points": [
                {
                    "section_type": "row_path",
                    "columns": ["t_ms", "x", "y"],
                    "values": [
                        [index * 500, east, north] for index, (east, north) in enumerate(east_north)
                    ],
                }
            ],
            "metadata": {
                "metrics": [
                    {
                        "metric_id": "agri.service.duration_s/1",
                        "value": 40,
                        "unit": "s",
                    }
                ]
            },
        }
    ).encode()


def test_work_performed_converts_local_metres_to_a_track():
    result = preview("bout.json", _work_performed([(0, 0), (10, 0), (20, 0)]))
    assert result["format"] == "work_performed"
    assert result["report"]["kinds"] == {"track": 1}
    line = result["collection"]["features"][0]["geometry"]["coordinates"]
    assert abs(line[0][0] - 2.8) < 1e-6
    assert abs(line[0][1] - 46.5) < 1e-6
    assert line[-1][0] > line[0][0]
    machine = next(
        item for item in result["report"]["metrics"] if item["key"].endswith("machineId")
    )
    assert machine["value"] == "srbc-17"


def test_work_performed_zip_keeps_one_group_per_file():
    result = preview(
        "day.zip",
        _zip(
            {
                "a.json": _work_performed([(0, 0), (5, 0)]),
                "b.json": _work_performed([(0, 1), (5, 1)], vehicle="srbc-18"),
            }
        ),
    )
    assert result["format"] == "work_performed"
    assert len(result["report"]["groups"]) == 2


def test_forcing_work_performed_on_plain_geojson_refuses():
    payload = b'{"type":"FeatureCollection","features":[]}'
    try:
        preview("plain.json", payload, format_id="work_performed")
    except Exception as reason:
        assert reason.key == "imports.error.notWorkPerformed"
    else:
        raise AssertionError("a GeoJSON is not a work performed log")
