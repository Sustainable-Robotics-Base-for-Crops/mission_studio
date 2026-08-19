"""Equipment catalogue HTTP API (lot L7a)."""

from __future__ import annotations

from fastapi import APIRouter, Request

from backend.api.http import json_from_handler
from backend.runtime import EditorRuntime


def build_equipment_router(runtime: EditorRuntime) -> APIRouter:
    router = APIRouter()

    def repo():
        return runtime.equipment

    def missing():
        return json_from_handler(503, {"error": "equipment catalogue unavailable"})

    def bad_request(reason: Exception):
        return json_from_handler(400, {"error": str(reason)})

    @router.get("/equipment")
    def catalogue():
        if repo() is None:
            return missing()
        return json_from_handler(200, repo().catalogue())

    @router.get("/equipment/vehicles")
    def list_vehicles():
        if repo() is None:
            return missing()
        return json_from_handler(200, {"vehicles": repo().list_vehicles()})

    @router.post("/equipment/vehicles")
    async def create_vehicle(request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        try:
            return json_from_handler(201, repo().create_vehicle(body))
        except ValueError as reason:
            return bad_request(reason)

    @router.get("/equipment/vehicles/{vehicle_id}")
    def get_vehicle(vehicle_id: str):
        if repo() is None:
            return missing()
        vehicle = repo().get_vehicle(vehicle_id)
        if vehicle is None:
            return json_from_handler(404, {"error": "vehicle not found"})
        return json_from_handler(200, vehicle)

    @router.patch("/equipment/vehicles/{vehicle_id}")
    async def patch_vehicle(vehicle_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        try:
            vehicle = repo().patch_vehicle(vehicle_id, body)
        except ValueError as reason:
            return bad_request(reason)
        if vehicle is None:
            return json_from_handler(404, {"error": "vehicle not found"})
        return json_from_handler(200, vehicle)

    @router.delete("/equipment/vehicles/{vehicle_id}")
    def delete_vehicle(vehicle_id: str):
        if repo() is None:
            return missing()
        try:
            deleted = repo().delete_vehicle(vehicle_id)
        except ValueError as reason:
            return bad_request(reason)
        if not deleted:
            return json_from_handler(404, {"error": "vehicle not found"})
        return json_from_handler(200, {"ok": True})

    @router.get("/equipment/implements")
    def list_implements():
        if repo() is None:
            return missing()
        return json_from_handler(200, {"implements": repo().list_implements()})

    @router.post("/equipment/implements")
    async def create_implement(request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        try:
            return json_from_handler(201, repo().create_implement(body))
        except ValueError as reason:
            return bad_request(reason)

    @router.patch("/equipment/implements/{implement_id}")
    async def patch_implement(implement_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        try:
            item = repo().patch_implement(implement_id, body)
        except ValueError as reason:
            return bad_request(reason)
        if item is None:
            return json_from_handler(404, {"error": "implement not found"})
        return json_from_handler(200, item)

    @router.delete("/equipment/implements/{implement_id}")
    def delete_implement(implement_id: str):
        if repo() is None:
            return missing()
        try:
            deleted = repo().delete_implement(implement_id)
        except ValueError as reason:
            return bad_request(reason)
        if not deleted:
            return json_from_handler(404, {"error": "implement not found"})
        return json_from_handler(200, {"ok": True})

    @router.get("/equipment/combinations")
    def list_combinations():
        if repo() is None:
            return missing()
        return json_from_handler(200, {"combinations": repo().list_combinations()})

    @router.post("/equipment/combinations")
    async def create_combination(request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        try:
            return json_from_handler(201, repo().create_combination(body))
        except ValueError as reason:
            return bad_request(reason)

    @router.get("/equipment/combinations/{combination_id}")
    def get_combination(combination_id: str):
        if repo() is None:
            return missing()
        try:
            resolved = repo().resolved_combination(combination_id)
        except ValueError as reason:
            return bad_request(reason)
        if resolved is None:
            return json_from_handler(404, {"error": "combination not found"})
        return json_from_handler(200, resolved)

    @router.patch("/equipment/combinations/{combination_id}")
    async def patch_combination(combination_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        try:
            item = repo().patch_combination(combination_id, body)
        except ValueError as reason:
            return bad_request(reason)
        if item is None:
            return json_from_handler(404, {"error": "combination not found"})
        return json_from_handler(200, item)

    @router.delete("/equipment/combinations/{combination_id}")
    def delete_combination(combination_id: str):
        if repo() is None:
            return missing()
        try:
            deleted = repo().delete_combination(combination_id)
        except ValueError as reason:
            return bad_request(reason)
        if not deleted:
            return json_from_handler(404, {"error": "combination not found"})
        return json_from_handler(200, {"ok": True})

    return router
