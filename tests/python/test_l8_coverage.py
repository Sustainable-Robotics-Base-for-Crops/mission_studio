"""L8 coverage: Fields2Cover adapter, parallel fallback, fourrières, Agri row_line."""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.coverage.agri import swaths_to_sections
from backend.coverage.geometry import METERS_PER_DEGREE, first_edge_heading
from backend.coverage.parallel import generate_swaths
from backend.coverage.service import engine_status, plan

ORIGIN_LAT = 45.85
ORIGIN_LON = 3.17


def _square_ring(size_m: float = 20.0) -> list[dict[str, float]]:
    d_lat = size_m / METERS_PER_DEGREE
    d_lng = size_m / (METERS_PER_DEGREE * math.cos(math.radians(ORIGIN_LAT)))
    return [
        {"lat": ORIGIN_LAT, "lng": ORIGIN_LON},
        {"lat": ORIGIN_LAT, "lng": ORIGIN_LON + d_lng},
        {"lat": ORIGIN_LAT + d_lat, "lng": ORIGIN_LON + d_lng},
        {"lat": ORIGIN_LAT + d_lat, "lng": ORIGIN_LON},
    ]


def _client() -> TestClient:
    return TestClient(create_app())


def test_parallel_sweep_covers_a_square():
    outer = [(0.0, 0.0), (20.0, 0.0), (20.0, 20.0), (0.0, 20.0)]
    heading = first_edge_heading(outer)
    swaths = generate_swaths(outer, 5.0, heading)
    assert len(swaths) == 4
    sections = swaths_to_sections(swaths)
    assert all(item["section_type"] == "row_line" for item in sections)
    assert all(len(item["values"]) == 2 for item in sections)
    assert sections[0]["values"][0][3] == 1


def test_plan_square_via_api_with_variants():
    with _client() as client:
        engine = client.get("/api/v1/coverage/engine").json()
        assert engine["engine"] in {"fields2cover", "parallel_fallback"}
        health = client.get("/api/v1/health").json()
        assert health["coverage"]["engine"] == engine["engine"]
        created = client.post(
            "/api/v1/coverage/plan",
            json={
                "ring": _square_ring(),
                "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
                "working_width_m": 5,
                "vehicle_width_m": 0.6,
                "strategy": "boustrophedon",
                "variants": True,
            },
        )
        assert created.status_code == 200, created.text
        body = created.json()
        assert body["engine"] in {"fields2cover", "parallel_fallback"}
        assert body["metrics"]["swath_count"] >= 3
        assert len(body["sections"]) == body["metrics"]["swath_count"]
        assert body["sections"][0]["section_type"] == "row_line"
        assert len(body["srbc_coverage"]["variants"]) == 3
        names = [item["strategy"] for item in body["srbc_coverage"]["variants"]]
        assert names == ["boustrophedon", "perpendicular", "best_nswath"]
        assert len(body["variants"][0]["sections"]) == body["variants"][0]["swath_count"]
        assert body["headland_sections"] == []
        assert "sections" not in body["srbc_coverage"]["variants"][0]


def test_headland_inset_and_contour_laps():
    from backend.coverage.headland import headland_paths, inset_ring, signed_area

    square = [(0.0, 0.0), (20.0, 0.0), (20.0, 20.0), (0.0, 20.0)]
    inset = inset_ring(square, 2.0)
    assert inset is not None
    assert abs(signed_area(inset)) == pytest.approx(256.0, abs=1.0)
    interior, contours = headland_paths(square, 2.4, 1.2)
    assert interior is not None
    assert len(contours) == 2
    with _client() as client:
        planned = client.post(
            "/api/v1/coverage/plan",
            json={
                "ring": _square_ring(40),
                "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
                "working_width_m": 2,
                "headland_width_m": 4,
                "strategy": "boustrophedon",
            },
        )
        assert planned.status_code == 200, planned.text
        body = planned.json()
        assert body["metrics"]["headland_laps"] >= 1
        assert body["headland_sections"][0]["section_type"] == "row_path"
        assert len(body["headland_sections"][0]["values"]) > 4


def test_plan_rejects_bad_width():
    with _client() as client:
        response = client.post(
            "/api/v1/coverage/plan",
            json={"ring": _square_ring(), "working_width_m": 0},
        )
        assert response.status_code == 400


def test_plan_from_catalogue_row_set():
    with _client() as client:
        field = client.post(
            "/api/v1/fields",
            json={
                "name": "Vigne",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [ORIGIN_LON, ORIGIN_LAT],
                            [ORIGIN_LON + 0.001, ORIGIN_LAT],
                            [ORIGIN_LON + 0.001, ORIGIN_LAT + 0.001],
                            [ORIGIN_LON, ORIGIN_LAT + 0.001],
                            [ORIGIN_LON, ORIGIN_LAT],
                        ]
                    ],
                },
            },
        )
        field_id = field.json()["id"]
        row_set = client.post(
            f"/api/v1/fields/{field_id}/row-sets",
            json={
                "name": "Rangs",
                "spacing_m": 2.5,
                "rows": [
                    {
                        "number": 1,
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [
                                [ORIGIN_LON, ORIGIN_LAT + 0.0002],
                                [ORIGIN_LON + 0.001, ORIGIN_LAT + 0.0002],
                            ],
                        },
                    },
                    {
                        "number": 2,
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [
                                [ORIGIN_LON, ORIGIN_LAT + 0.0006],
                                [ORIGIN_LON + 0.001, ORIGIN_LAT + 0.0006],
                            ],
                        },
                    },
                ],
            },
        )
        assert row_set.status_code == 201
        planned = client.post(
            "/api/v1/coverage/plan",
            json={
                "field_id": field_id,
                "row_set_id": row_set.json()["id"],
                "working_width_m": 1.2,
                "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
            },
        )
        assert planned.status_code == 200, planned.text
        body = planned.json()
        assert body["engine"] == "row_set"
        assert len(body["sections"]) == 2
        assert body["srbc_coverage"]["row_set_id"] == row_set.json()["id"]


def test_engine_status_lists_strategies():
    status = engine_status()
    assert "boustrophedon" in status["strategies"]
    assert "best_nswath" in status["strategies"]
    planned = plan(
        {
            "ring": _square_ring(),
            "working_width_m": 1.2,
            "strategy": "perpendicular",
        }
    )
    assert planned["srbc_coverage"]["strategy"] == "perpendicular"
    assert planned["metrics"]["swath_count"] >= 1


def test_geofence_margin_insets_without_headland_laps():
    planned = plan(
        {
            "ring": _square_ring(20.0),
            "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
            "working_width_m": 5,
            "geofence_margin_m": 2,
            "strategy": "boustrophedon",
        }
    )
    assert planned["headland_sections"] == []
    assert planned["srbc_coverage"]["geofence_margin_m"] == 2
    xs = [float(row[0]) for section in planned["sections"] for row in section["values"]]
    assert min(xs) >= 1.5
    assert max(xs) <= 18.5
