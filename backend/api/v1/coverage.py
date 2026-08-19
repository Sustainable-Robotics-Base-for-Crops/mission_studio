"""POST /api/v1/coverage/plan — polygon + working width → Agri row_line."""

from __future__ import annotations

from fastapi import APIRouter, Request

from backend.api.http import json_from_handler
from backend.coverage.service import engine_status, plan
from backend.runtime import EditorRuntime


def build_coverage_router(runtime: EditorRuntime) -> APIRouter:
    router = APIRouter()

    @router.get("/coverage/engine")
    def coverage_engine():
        return json_from_handler(200, engine_status())

    @router.post("/coverage/plan")
    async def coverage_plan(request: Request):
        raw = await request.json()
        if not isinstance(raw, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        try:
            result = plan(raw, fields_repo=runtime.fields)
        except KeyError as reason:
            return json_from_handler(404, {"error": f"not found: {reason}"})
        except ValueError as reason:
            return json_from_handler(400, {"error": str(reason)})
        return json_from_handler(200, result)

    return router
