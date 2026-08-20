"""/api/v1/farm (lot L13). The farm folder is the source of truth; this exposes it."""

from __future__ import annotations

from fastapi import APIRouter, Request

from backend.api.http import json_from_handler
from backend.farm.index import reindex
from backend.farm.layout import crop_pack_for, is_farm
from backend.farm.tree import list_tree
from backend.runtime import EditorRuntime


def build_farm_router(runtime: EditorRuntime) -> APIRouter:
    router = APIRouter()

    def repo():
        return runtime.farm

    def no_farm():
        return json_from_handler(
            409, {"error": "no farm is open; open one from Administration first"}
        )

    def bad_request(reason: Exception):
        return json_from_handler(400, {"error": str(reason)})

    def snapshot() -> dict:
        farm = repo().read_farm()
        return {
            "farm": farm,
            "root": repo().resolve_root(),
            "counts": repo().counts(),
            "recent": repo().recent_roots(),
            "cropPack": crop_pack_for(farm.get("farm_type", "")) if farm else None,
        }

    @router.get("/farm")
    def read_farm():
        """No farm configured is a legitimate state, not an error."""
        return json_from_handler(200, snapshot())

    @router.put("/farm")
    async def update_farm(request: Request):
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        try:
            repo().write_farm(body)
        except ValueError as reason:
            return bad_request(reason)
        return json_from_handler(200, snapshot())

    @router.post("/farm/open")
    async def open_farm(request: Request):
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        root = body.get("root")
        if not isinstance(root, str) or not root.strip():
            return json_from_handler(400, {"error": "root must be a non-empty path"})
        name = body.get("name") if isinstance(body.get("name"), str) else None
        try:
            repo().open_farm(root, name)
        except (ValueError, OSError) as reason:
            return bad_request(reason)
        return json_from_handler(200, snapshot())

    @router.get("/farm/tree")
    def farm_tree(kind: str | None = None):
        root = repo().resolve_root()
        if not root or not is_farm(root):
            return no_farm()
        try:
            return json_from_handler(200, {"root": root, "tree": list_tree(root, kind)})
        except ValueError as reason:
            return bad_request(reason)

    @router.post("/farm/reindex")
    def farm_reindex():
        root = repo().resolve_root()
        if not root or not is_farm(root):
            return no_farm()
        return json_from_handler(200, {"ok": True, **reindex(root)})

    return router
