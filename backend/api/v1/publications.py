"""POST/GET /api/v1/publications (lot L11). Consumable by the iOS app."""

from __future__ import annotations

from fastapi import APIRouter, Request

from backend.api.http import json_from_handler
from backend.runtime import EditorRuntime


def build_publications_router(runtime: EditorRuntime) -> APIRouter:
    router = APIRouter()

    def repo():
        return runtime.publications

    def missing():
        return json_from_handler(503, {"error": "publication store unavailable"})

    def bad_request(reason: Exception):
        return json_from_handler(400, {"error": str(reason)})

    @router.get("/publications")
    def list_publications(source_path: str | None = None):
        if repo() is None:
            return missing()
        return json_from_handler(
            200, {"publications": repo().list_publications(source_path=source_path)}
        )

    @router.post("/publications")
    async def create_publication(request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        try:
            return json_from_handler(201, repo().create(body))
        except ValueError as reason:
            return bad_request(reason)

    @router.get("/publications/{publication_id}")
    def get_publication(publication_id: str):
        if repo() is None:
            return missing()
        item = repo().get(publication_id)
        if item is None:
            return json_from_handler(404, {"error": "publication not found"})
        return json_from_handler(200, item)

    return router
