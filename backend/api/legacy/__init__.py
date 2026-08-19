"""Historical /api/trajectories and /api/geocoding/search contracts."""

from __future__ import annotations

import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from backend.api.http import (
    client_address,
    handler_headers,
    json_from_handler,
    query_lists,
)
from backend.runtime import EditorRuntime


def _json_dict(raw: bytes) -> dict:
    if not raw:
        return {}
    parsed = json.loads(raw.decode("utf-8"))
    return parsed if isinstance(parsed, dict) else {}


def build_legacy_router(runtime: EditorRuntime) -> APIRouter:
    router = APIRouter()

    def require_api_user(request: Request) -> tuple[JSONResponse | None, str | None]:
        headers = handler_headers(request)
        is_authenticated, user_id = runtime.auth_middleware.check_auth(
            headers, client_address(request), request.url.path
        )
        if not is_authenticated:
            return (
                json_from_handler(401, {"error": "Authentication required"}),
                None,
            )
        return (None, user_id)

    @router.get("/api/trajectories")
    def list_trajectories(request: Request) -> JSONResponse:
        denied, user_id = require_api_user(request)
        if denied is not None:
            return denied
        code, data = runtime.trajectory_controller.list_trajectories(
            user_id, query_lists(request)
        )
        return json_from_handler(code, data)

    @router.get("/api/trajectories/{filepath:path}")
    def load_trajectory(filepath: str, request: Request) -> JSONResponse:
        denied, user_id = require_api_user(request)
        if denied is not None:
            return denied
        code, data = runtime.trajectory_controller.load_trajectory(
            filepath, user_id, query_lists(request)
        )
        return json_from_handler(code, data)

    @router.post("/api/trajectories/validate")
    async def validate_trajectory(request: Request) -> JSONResponse:
        denied, _user_id = require_api_user(request)
        if denied is not None:
            return denied
        code, data = runtime.trajectory_controller.validate_trajectory(
            _json_dict(await request.body())
        )
        return json_from_handler(code, data)

    @router.post("/api/trajectories")
    async def save_trajectory(request: Request) -> JSONResponse:
        denied, user_id = require_api_user(request)
        if denied is not None:
            return denied
        code, data = runtime.trajectory_controller.save_trajectory(
            request_data=_json_dict(await request.body()),
            user_id=user_id or "anonymous",
            headers=handler_headers(request),
        )
        return json_from_handler(code, data)

    @router.put("/api/trajectories/{filepath:path}")
    async def replace_trajectory(filepath: str, request: Request) -> JSONResponse:
        denied, user_id = require_api_user(request)
        if denied is not None:
            return denied
        payload = _json_dict(await request.body())
        payload["filename"] = filepath
        code, data = runtime.trajectory_controller.save_trajectory(
            request_data=payload,
            user_id=user_id or "anonymous",
            headers=handler_headers(request),
        )
        return json_from_handler(code, data)

    @router.delete("/api/trajectories/{filepath:path}")
    def delete_trajectory(filepath: str, request: Request) -> JSONResponse:
        denied, user_id = require_api_user(request)
        if denied is not None:
            return denied
        code, data = runtime.trajectory_controller.delete_trajectory(filepath, user_id)
        return json_from_handler(code, data)

    @router.get("/api/geocoding/search")
    def geocoding_search(request: Request) -> JSONResponse:
        denied, _user_id = require_api_user(request)
        if denied is not None:
            return denied
        query = query_lists(request).get("q", [""])[0]
        try:
            results = runtime.geocoding_service.search(query)
            return json_from_handler(200, {"results": results})
        except ValueError as exc:
            return json_from_handler(400, {"error": str(exc), "results": []})

    return router
