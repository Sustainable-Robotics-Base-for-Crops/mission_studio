"""POST/GET /api/v1/jobs."""

from __future__ import annotations

from fastapi import APIRouter, Request

from backend.api.http import json_from_handler
from backend.runtime import EditorRuntime


def build_jobs_router(runtime: EditorRuntime) -> APIRouter:
    router = APIRouter()

    def _queue():
        if runtime.job_queue is None:
            return None
        return runtime.job_queue

    @router.post("/jobs")
    async def create_job(request: Request):
        queue = _queue()
        if queue is None:
            return json_from_handler(503, {"error": "job queue unavailable"})
        raw = await request.json()
        if not isinstance(raw, dict):
            return json_from_handler(400, {"error": "JSON object expected"})
        kind = str(raw.get("kind") or "").strip()
        if not kind:
            return json_from_handler(400, {"error": "kind is required"})
        payload = raw.get("payload") if isinstance(raw.get("payload"), dict) else {}
        job = queue.enqueue(kind, payload)
        return json_from_handler(202, job)

    @router.get("/jobs")
    def list_jobs():
        queue = _queue()
        if queue is None:
            return json_from_handler(503, {"error": "job queue unavailable"})
        return json_from_handler(200, {"jobs": queue.list()})

    @router.get("/jobs/{job_id}")
    def get_job(job_id: str):
        queue = _queue()
        if queue is None:
            return json_from_handler(503, {"error": "job queue unavailable"})
        job = queue.get(job_id)
        if job is None:
            return json_from_handler(404, {"error": "job not found"})
        return json_from_handler(200, job)

    return router
