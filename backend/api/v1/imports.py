"""/api/v1/imports — recognise a third-party file and preview it as a layer.

The body is the raw upload, not a multipart form: the studio posts the ``File``
as-is, which keeps the core free of a multipart dependency.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from backend.api.http import json_from_handler
from backend.imports import MAX_BYTES, ImportRefused, descriptors, format_descriptors, preview


def build_imports_router() -> APIRouter:
    router = APIRouter()

    @router.get("/imports/adapters")
    def list_adapters():
        return json_from_handler(
            200,
            {"adapters": descriptors(), "formats": format_descriptors(), "max_bytes": MAX_BYTES},
        )

    @router.post("/imports/preview")
    async def preview_import(
        request: Request, filename: str = "", adapter: str = "", format: str = ""
    ):
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > MAX_BYTES:
            return json_from_handler(
                413,
                ImportRefused(
                    "imports.error.tooLarge", {"limit_mb": MAX_BYTES // (1024 * 1024)}
                ).to_dict(),
            )
        data = await request.body()
        try:
            return json_from_handler(
                200, preview(filename, data, adapter or None, format or None)
            )
        except ImportRefused as reason:
            return json_from_handler(422, reason.to_dict())

    return router
