"""Field catalogue HTTP API."""

from __future__ import annotations

from fastapi import APIRouter, Request

from backend.api.http import json_from_handler
from backend.fields.geojson import export_geojson, import_geojson
from backend.runtime import EditorRuntime


def build_fields_router(runtime: EditorRuntime) -> APIRouter:
    router = APIRouter()

    def repo():
        return runtime.fields

    def missing():
        return json_from_handler(503, {"error": "field catalogue unavailable"})

    @router.get("/fields")
    def list_fields():
        if repo() is None:
            return missing()
        return json_from_handler(200, {"fields": repo().list_fields()})

    @router.post("/fields")
    async def create_field(request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict) or not body.get("name") or not body.get("geometry"):
            return json_from_handler(400, {"error": "name and geometry are required"})
        field = repo().create_field(
            name=str(body["name"]),
            geometry=body["geometry"],
            campaign=body.get("campaign"),
            provenance=body.get("provenance") if isinstance(body.get("provenance"), dict) else {},
            author=body.get("author"),
        )
        return json_from_handler(201, field)

    @router.post("/fields/import")
    async def import_field(request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        fmt = str(body.get("format") or "geojson").strip().lower()
        if fmt != "geojson":
            return json_from_handler(
                400,
                {"error": "only GeoJSON import in this cut (KML, Shapefile, GPKG later)"},
            )
        geojson = body.get("geojson") or body.get("featureCollection")
        if not isinstance(geojson, dict):
            return json_from_handler(400, {"error": "geojson object is required"})
        report = import_geojson(
            repo(), geojson, name=body.get("name"), author=body.get("author")
        )
        status = 201 if report.get("ok") else 400
        return json_from_handler(status, report)

    @router.get("/fields/{field_id}")
    def get_field(field_id: str):
        if repo() is None:
            return missing()
        field = repo().get_field(field_id)
        if field is None:
            return json_from_handler(404, {"error": "field not found"})
        return json_from_handler(200, field)

    @router.patch("/fields/{field_id}")
    async def patch_field(field_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        field = repo().update_field(field_id, body, author=body.get("author"))
        if field is None:
            return json_from_handler(404, {"error": "field not found"})
        return json_from_handler(200, field)

    @router.delete("/fields/{field_id}")
    def delete_field(field_id: str):
        if repo() is None:
            return missing()
        if not repo().delete_field(field_id):
            return json_from_handler(404, {"error": "field not found"})
        return json_from_handler(200, {"ok": True})

    @router.get("/fields/{field_id}/export")
    def export_field(field_id: str):
        if repo() is None:
            return missing()
        field = repo().get_field(field_id)
        if field is None:
            return json_from_handler(404, {"error": "field not found"})
        return json_from_handler(200, export_geojson(field))

    @router.post("/fields/{field_id}/zones")
    async def add_zone(field_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict) or not body.get("kind") or not body.get("geometry"):
            return json_from_handler(400, {"error": "kind and geometry are required"})
        try:
            zone = repo().add_zone(
                field_id,
                str(body["kind"]),
                body["geometry"],
                name=body.get("name"),
                provenance=body.get("provenance") if isinstance(body.get("provenance"), dict) else {},
            )
        except KeyError:
            return json_from_handler(404, {"error": "field not found"})
        except ValueError as exc:
            return json_from_handler(400, {"error": str(exc)})
        return json_from_handler(201, zone)

    @router.patch("/fields/{field_id}/zones/{zone_id}")
    async def patch_zone(field_id: str, zone_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        try:
            zone = repo().update_zone(field_id, zone_id, body, author=body.get("author"))
        except ValueError as exc:
            return json_from_handler(400, {"error": str(exc)})
        if zone is None:
            return json_from_handler(404, {"error": "zone not found"})
        return json_from_handler(200, zone)

    @router.delete("/fields/{field_id}/zones/{zone_id}")
    def delete_zone(field_id: str, zone_id: str):
        if repo() is None:
            return missing()
        if not repo().delete_zone(field_id, zone_id):
            return json_from_handler(404, {"error": "zone not found"})
        return json_from_handler(200, {"ok": True})

    @router.post("/fields/{field_id}/landmarks")
    async def add_landmark(field_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict) or not body.get("geometry"):
            return json_from_handler(400, {"error": "geometry is required"})
        radius_raw = body.get("radius_m")
        try:
            landmark = repo().add_landmark(
                field_id,
                kind=str(body.get("kind") or "point"),
                geometry=body["geometry"],
                name=body.get("name"),
                radius_m=None if radius_raw is None or radius_raw == "" else float(radius_raw),
                provenance=body.get("provenance") if isinstance(body.get("provenance"), dict) else {},
            )
        except KeyError:
            return json_from_handler(404, {"error": "field not found"})
        except ValueError as exc:
            return json_from_handler(400, {"error": str(exc)})
        return json_from_handler(201, landmark)

    @router.patch("/fields/{field_id}/landmarks/{landmark_id}")
    async def patch_landmark(field_id: str, landmark_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        landmark = repo().update_landmark(field_id, landmark_id, body)
        if landmark is None:
            return json_from_handler(404, {"error": "landmark not found"})
        return json_from_handler(200, landmark)

    @router.delete("/fields/{field_id}/landmarks/{landmark_id}")
    def delete_landmark(field_id: str, landmark_id: str):
        if repo() is None:
            return missing()
        if not repo().delete_landmark(field_id, landmark_id):
            return json_from_handler(404, {"error": "landmark not found"})
        return json_from_handler(200, {"ok": True})

    @router.post("/fields/{field_id}/obstacles")
    async def add_obstacle(field_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict) or not body.get("geometry"):
            return json_from_handler(400, {"error": "geometry is required"})
        try:
            obstacle = repo().add_obstacle(
                field_id,
                body["geometry"],
                category=str(body.get("category") or "unspecified"),
                name=body.get("name"),
                margin_m=float(body.get("margin_m") or 0),
                height_m=body.get("height_m"),
                valid_from=body.get("valid_from"),
                valid_until=body.get("valid_until"),
                crossable=bool(body.get("crossable")),
                provenance=body.get("provenance") if isinstance(body.get("provenance"), dict) else {},
            )
        except KeyError:
            return json_from_handler(404, {"error": "field not found"})
        return json_from_handler(201, obstacle)

    @router.patch("/fields/{field_id}/obstacles/{obstacle_id}")
    async def patch_obstacle(field_id: str, obstacle_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        obstacle = repo().update_obstacle(field_id, obstacle_id, body, author=body.get("author"))
        if obstacle is None:
            return json_from_handler(404, {"error": "obstacle not found"})
        return json_from_handler(200, obstacle)

    @router.delete("/fields/{field_id}/obstacles/{obstacle_id}")
    def delete_obstacle(field_id: str, obstacle_id: str):
        if repo() is None:
            return missing()
        if not repo().delete_obstacle(field_id, obstacle_id):
            return json_from_handler(404, {"error": "obstacle not found"})
        return json_from_handler(200, {"ok": True})

    @router.post("/fields/{field_id}/guidance-lines")
    async def add_line(field_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict) or not body.get("geometry"):
            return json_from_handler(400, {"error": "geometry is required"})
        try:
            line = repo().add_guidance_line(
                field_id,
                body["geometry"],
                name=body.get("name"),
                provenance=body.get("provenance") if isinstance(body.get("provenance"), dict) else {},
            )
        except KeyError:
            return json_from_handler(404, {"error": "field not found"})
        except ValueError as exc:
            return json_from_handler(400, {"error": str(exc)})
        return json_from_handler(201, line)

    @router.patch("/fields/{field_id}/guidance-lines/{line_id}")
    async def patch_line(field_id: str, line_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        try:
            line = repo().update_guidance_line(field_id, line_id, body, author=body.get("author"))
        except ValueError as exc:
            return json_from_handler(400, {"error": str(exc)})
        if line is None:
            return json_from_handler(404, {"error": "guidance line not found"})
        return json_from_handler(200, line)

    @router.delete("/fields/{field_id}/guidance-lines/{line_id}")
    def delete_line(field_id: str, line_id: str):
        if repo() is None:
            return missing()
        if not repo().delete_guidance_line(field_id, line_id):
            return json_from_handler(404, {"error": "guidance line not found"})
        return json_from_handler(200, {"ok": True})

    @router.post("/fields/{field_id}/row-sets")
    async def add_row_set(field_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        try:
            spacing = float(body.get("spacing_m") if body.get("spacing_m") is not None else 2.5)
            axis_raw = body.get("axis_line_id")
            axis_line_id = str(axis_raw).strip() if axis_raw else None
            width_raw = body.get("width_m")
            row_set = repo().create_row_set(
                field_id,
                rows=body.get("rows") if isinstance(body.get("rows"), list) else [],
                name=body.get("name"),
                spacing_m=spacing,
                axis_line_id=axis_line_id or None,
                kind=str(body.get("kind") or "rows"),
                width_m=float(width_raw) if width_raw is not None and width_raw != "" else None,
                preferred_direction=body.get("preferred_direction"),
                provenance=body.get("provenance") if isinstance(body.get("provenance"), dict) else {},
            )
        except KeyError:
            return json_from_handler(404, {"error": "field not found"})
        except ValueError as exc:
            return json_from_handler(400, {"error": str(exc)})
        return json_from_handler(201, row_set)

    @router.delete("/fields/{field_id}/row-sets/{set_id}")
    def delete_row_set(field_id: str, set_id: str):
        if repo() is None:
            return missing()
        if not repo().delete_row_set(field_id, set_id):
            return json_from_handler(404, {"error": "row set not found"})
        return json_from_handler(200, {"ok": True})

    @router.post("/fields/{field_id}/row-sets/{set_id}/rows")
    async def add_row(field_id: str, set_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict) or not body.get("geometry"):
            return json_from_handler(400, {"error": "geometry is required"})
        number_raw = body.get("number")
        try:
            item = repo().add_row(
                field_id,
                set_id,
                body["geometry"],
                number=int(number_raw) if number_raw is not None and number_raw != "" else None,
                name=body.get("name"),
                author=body.get("author"),
            )
        except ValueError as exc:
            return json_from_handler(400, {"error": str(exc)})
        if item is None:
            return json_from_handler(404, {"error": "row set not found"})
        return json_from_handler(201, item)

    @router.patch("/fields/{field_id}/rows/{row_id}")
    async def patch_row(field_id: str, row_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        try:
            item = repo().update_row(field_id, row_id, body, author=body.get("author"))
        except ValueError as exc:
            return json_from_handler(400, {"error": str(exc)})
        if item is None:
            return json_from_handler(404, {"error": "row not found"})
        return json_from_handler(200, item)

    @router.delete("/fields/{field_id}/rows/{row_id}")
    def delete_row(field_id: str, row_id: str):
        if repo() is None:
            return missing()
        if not repo().delete_row(field_id, row_id):
            return json_from_handler(404, {"error": "row not found"})
        return json_from_handler(200, {"ok": True})

    @router.post("/fields/{field_id}/traffic-ways")
    async def add_traffic_way(field_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict) or not body.get("geometry"):
            return json_from_handler(400, {"error": "geometry is required"})
        speed_raw = body.get("speed_mps")
        try:
            way = repo().add_traffic_way(
                field_id,
                body["geometry"],
                name=body.get("name"),
                kind=str(body.get("kind") or "path"),
                oneway=bool(body.get("oneway")),
                speed_mps=None if speed_raw is None or speed_raw == "" else float(speed_raw),
                width_m=body.get("width_m"),
                provenance=body.get("provenance") if isinstance(body.get("provenance"), dict) else {},
            )
        except KeyError:
            return json_from_handler(404, {"error": "field not found"})
        except ValueError as exc:
            return json_from_handler(400, {"error": str(exc)})
        return json_from_handler(201, way)

    @router.patch("/fields/{field_id}/traffic-ways/{way_id}")
    async def patch_traffic_way(field_id: str, way_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        try:
            way = repo().update_traffic_way(field_id, way_id, body, author=body.get("author"))
        except ValueError as exc:
            return json_from_handler(400, {"error": str(exc)})
        if way is None:
            return json_from_handler(404, {"error": "traffic way not found"})
        return json_from_handler(200, way)

    @router.delete("/fields/{field_id}/traffic-ways/{way_id}")
    def delete_traffic_way(field_id: str, way_id: str):
        if repo() is None:
            return missing()
        if not repo().delete_traffic_way(field_id, way_id):
            return json_from_handler(404, {"error": "traffic way not found"})
        return json_from_handler(200, {"ok": True})

    @router.post("/fields/{field_id}/traffic-nodes")
    async def add_traffic_node(field_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict) or not body.get("geometry"):
            return json_from_handler(400, {"error": "geometry is required"})
        try:
            node = repo().add_traffic_node(
                field_id,
                body["geometry"],
                name=body.get("name"),
                kind=str(body.get("kind") or "gate"),
                provenance=body.get("provenance") if isinstance(body.get("provenance"), dict) else {},
            )
        except KeyError:
            return json_from_handler(404, {"error": "field not found"})
        except ValueError as exc:
            return json_from_handler(400, {"error": str(exc)})
        return json_from_handler(201, node)

    @router.patch("/fields/{field_id}/traffic-nodes/{node_id}")
    async def patch_traffic_node(field_id: str, node_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        if not isinstance(body, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        try:
            node = repo().update_traffic_node(field_id, node_id, body, author=body.get("author"))
        except ValueError as exc:
            return json_from_handler(400, {"error": str(exc)})
        if node is None:
            return json_from_handler(404, {"error": "traffic node not found"})
        return json_from_handler(200, node)

    @router.delete("/fields/{field_id}/traffic-nodes/{node_id}")
    def delete_traffic_node(field_id: str, node_id: str):
        if repo() is None:
            return missing()
        if not repo().delete_traffic_node(field_id, node_id):
            return json_from_handler(404, {"error": "traffic node not found"})
        return json_from_handler(200, {"ok": True})

    @router.get("/fields/{field_id}/versions")
    def list_versions(field_id: str):
        if repo() is None:
            return missing()
        if repo().get_field(field_id, with_children=False) is None:
            return json_from_handler(404, {"error": "field not found"})
        return json_from_handler(200, {"versions": repo().list_versions(field_id)})

    @router.get("/fields/{field_id}/versions/{from_version}/diff/{to_version}")
    def diff_versions(field_id: str, from_version: int, to_version: int):
        if repo() is None:
            return missing()
        try:
            diff = repo().diff_versions(field_id, from_version, to_version)
        except KeyError:
            return json_from_handler(404, {"error": "version not found"})
        return json_from_handler(200, diff)

    @router.post("/fields/{field_id}/missions")
    async def link_mission(field_id: str, request: Request):
        if repo() is None:
            return missing()
        body = await request.json()
        path = str((body or {}).get("path") or "").strip()
        if not path:
            return json_from_handler(400, {"error": "path is required"})
        try:
            link = repo().link_mission(field_id, path)
        except KeyError:
            return json_from_handler(404, {"error": "field not found"})
        return json_from_handler(201, link)

    @router.get("/fields/{field_id}/impact")
    def impact(field_id: str):
        if repo() is None:
            return missing()
        if repo().get_field(field_id, with_children=False) is None:
            return json_from_handler(404, {"error": "field not found"})
        return json_from_handler(200, repo().impact(field_id))

    return router
