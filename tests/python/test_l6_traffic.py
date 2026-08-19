"""L6c catalogue traffic ways and nodes (MAP-013 first cut)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend.api.app import create_app


SQUARE = {
    "type": "Polygon",
    "coordinates": [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
}
PATH = {"type": "LineString", "coordinates": [[0, 0.0002], [0.001, 0.0002]]}
GATE = {"type": "Point", "coordinates": [0.0004, 0.0001]}


def _client() -> TestClient:
    return TestClient(create_app())


def test_traffic_way_and_node_crud_via_api():
    with _client() as client:
        created = client.post("/api/v1/fields", json={"name": "Site", "geometry": SQUARE})
        field_id = created.json()["id"]
        bad_way = client.post(
            f"/api/v1/fields/{field_id}/traffic-ways",
            json={"name": "Allée", "geometry": GATE},
        )
        assert bad_way.status_code == 400
        way = client.post(
            f"/api/v1/fields/{field_id}/traffic-ways",
            json={"name": "Allée principale", "geometry": PATH, "oneway": True, "speed_mps": 1.2},
        )
        assert way.status_code == 201
        assert way.json()["oneway"] is True
        assert way.json()["speed_mps"] == 1.2
        assert way.json()["kind"] == "path"
        bad_node = client.post(
            f"/api/v1/fields/{field_id}/traffic-nodes",
            json={"name": "Porte", "geometry": PATH},
        )
        assert bad_node.status_code == 400
        node = client.post(
            f"/api/v1/fields/{field_id}/traffic-nodes",
            json={"name": "Porte nord", "kind": "porte", "geometry": GATE},
        )
        assert node.status_code == 201
        assert node.json()["kind"] == "gate"
        field = client.get(f"/api/v1/fields/{field_id}").json()
        assert len(field["traffic_ways"]) == 1
        assert len(field["traffic_nodes"]) == 1
        exported = client.get(f"/api/v1/fields/{field_id}/export").json()
        kinds = [feature["properties"]["srbc_kind"] for feature in exported["features"]]
        assert kinds.count("traffic_way") == 1
        assert kinds.count("traffic_node") == 1
        patched_way = client.patch(
            f"/api/v1/fields/{field_id}/traffic-ways/{way.json()['id']}",
            json={"name": "Allée sud", "oneway": False},
        )
        assert patched_way.status_code == 200
        assert patched_way.json()["name"] == "Allée sud"
        assert patched_way.json()["oneway"] is False
        patched_node = client.patch(
            f"/api/v1/fields/{field_id}/traffic-nodes/{node.json()['id']}",
            json={"kind": "service", "name": "Cuve"},
        )
        assert patched_node.json()["kind"] == "service"
        deleted_way = client.delete(f"/api/v1/fields/{field_id}/traffic-ways/{way.json()['id']}")
        deleted_node = client.delete(f"/api/v1/fields/{field_id}/traffic-nodes/{node.json()['id']}")
        assert deleted_way.status_code == 200
        assert deleted_node.status_code == 200
        after = client.get(f"/api/v1/fields/{field_id}").json()
        assert after["traffic_ways"] == []
        assert after["traffic_nodes"] == []


def test_traffic_geojson_roundtrip():
    with _client() as client:
        imported = client.post(
            "/api/v1/fields/import",
            json={
                "geojson": {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {"srbc_kind": "field", "name": "Import traffic"},
                            "geometry": SQUARE,
                        },
                        {
                            "type": "Feature",
                            "properties": {"srbc_kind": "chemin", "name": "Chemin"},
                            "geometry": PATH,
                        },
                        {
                            "type": "Feature",
                            "properties": {"srbc_kind": "porte", "name": "Porte"},
                            "geometry": GATE,
                        },
                    ],
                }
            },
        )
        assert imported.status_code == 201
        body = imported.json()
        assert body["ok"] is True
        assert body["created"]["traffic_ways"] == 1
        assert body["created"]["traffic_nodes"] == 1
        field = body["field"]
        assert field["traffic_nodes"][0]["kind"] == "gate"
