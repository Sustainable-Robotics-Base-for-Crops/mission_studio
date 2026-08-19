"""L5a FastAPI transport: same contracts as http.server, behind BACKEND_FASTAPI."""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.config.flags import is_enabled, registry
from backend.runtime import EditorRuntime


def test_fastapi_flag_defaults_to_false(monkeypatch):
    monkeypatch.delenv("BACKEND_FASTAPI", raising=False)
    assert is_enabled("BACKEND_FASTAPI", default=False) is False
    assert registry()["BACKEND_FASTAPI"] is False


def test_health_and_legacy_shells():
    client = TestClient(create_app())
    health = client.get("/api/v1/health")
    assert health.status_code == 200
    body = health.json()
    assert body["ok"] is True
    assert body["backend"] == "fastapi"

    app_page = client.get("/app")
    assert app_page.status_code == 200
    assert "TrajectoryEditor.js" in app_page.text
    assert "/studio/assets/studio.js" not in app_page.text

    studio = client.get("/studio")
    assert studio.status_code == 200
    assert 'id="root"' in studio.text
    assert "pluginHeaderActions" in studio.text

    listed = client.get("/api/trajectories")
    assert listed.status_code == 200
    assert isinstance(listed.json(), list)


def test_validate_endpoint_accepts_json_body():
    client = TestClient(create_app())
    response = client.post("/api/trajectories/validate", json={})
    assert response.status_code in {200, 400}
    body = response.json()
    assert "valid" in body or "error" in body


def test_geocoding_empty_query_returns_results_array():
    client = TestClient(create_app())
    response = client.get("/api/geocoding/search", params={"q": ""})
    assert response.status_code == 200
    assert response.json() == {"results": []}


def test_plugin_register_route_is_mounted_before_auth():
    runtime = EditorRuntime.build()

    def ping(_headers, _address):
        return (200, {"pong": True})

    runtime.context.register_route("GET", "/api/ping-l5a", ping)
    client = TestClient(create_app(runtime))
    response = client.get("/api/ping-l5a")
    assert response.status_code == 200
    assert response.json() == {"pong": True}


def test_plugin_set_cookie_becomes_header():
    runtime = EditorRuntime.build()

    def login(_payload, _headers, _address):
        return (200, {"ok": True, "setCookie": "session=abc; Path=/"})

    runtime.context.register_route("POST", "/api/auth/session", login)
    client = TestClient(create_app(runtime))
    response = client.post("/api/auth/session", json={})
    assert response.status_code == 200
    assert "session=abc" in response.headers.get("set-cookie", "")
    assert "setCookie" not in response.json()
