"""Versioned API: health, jobs, field catalogue, coverage, farm folder."""

from __future__ import annotations

from fastapi import APIRouter

from backend.api.http import Utf8JSONResponse
from backend.api.v1.coverage import build_coverage_router
from backend.api.v1.equipment import build_equipment_router
from backend.api.v1.farm import build_farm_router
from backend.api.v1.fields import build_fields_router
from backend.api.v1.jobs import build_jobs_router
from backend.api.v1.publications import build_publications_router
from backend.coverage.service import engine_status
from backend.farm.layout import is_farm
from backend.runtime import EditorRuntime


def build_v1_router(runtime: EditorRuntime) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    @router.get("/health")
    def health() -> Utf8JSONResponse:
        return Utf8JSONResponse(
            {
                "ok": True,
                "backend": "fastapi",
                "sqlite": runtime.database is not None,
                "jobs": runtime.job_queue is not None,
                "coverage": engine_status(),
                "farm": is_farm(runtime.farm.resolve_root()),
            }
        )

    router.include_router(build_jobs_router(runtime))
    router.include_router(build_fields_router(runtime))
    router.include_router(build_equipment_router(runtime))
    router.include_router(build_coverage_router(runtime))
    router.include_router(build_publications_router(runtime))
    router.include_router(build_farm_router(runtime))
    return router
