"""Local async job queue (optimisation / simulation later; echo first)."""

from __future__ import annotations

import json
import logging
import threading
import uuid
from typing import Any, Callable

from backend.db import Database, utc_now

logger = logging.getLogger("trajectory_editor")

JobHandler = Callable[[dict[str, Any]], dict[str, Any]]

KNOWN_KINDS = {"echo", "coverage"}


def handle_echo(payload: dict[str, Any]) -> dict[str, Any]:
    return dict(payload)


def handle_coverage(payload: dict[str, Any]) -> dict[str, Any]:
    from backend.coverage.service import plan

    return plan(payload)


HANDLERS: dict[str, JobHandler] = {"echo": handle_echo, "coverage": handle_coverage}


def _row_to_job(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "status": row["status"],
        "payload": json.loads(row["payload"] or "{}"),
        "result": json.loads(row["result"]) if row["result"] else None,
        "error": row["error"],
        "progress": row["progress"],
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
    }


class JobQueue:
    def __init__(self, database: Database):
        self.db = database
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def enqueue(self, kind: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        job_id = uuid.uuid4().hex
        self.db.execute(
            """
            INSERT INTO jobs (id, kind, status, payload, created_at)
            VALUES (?, ?, 'queued', ?, ?)
            """,
            (job_id, kind, json.dumps(payload or {}, ensure_ascii=False), utc_now()),
        )
        return self.get(job_id)  # type: ignore[return-value]

    def get(self, job_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return _row_to_job(row) if row else None

    def list(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [_row_to_job(row) for row in rows]

    def process_one(self) -> bool:
        row = self.db.execute(
            "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1"
        ).fetchone()
        if row is None:
            return False
        job_id = row["id"]
        kind = row["kind"]
        payload = json.loads(row["payload"] or "{}")
        self.db.execute(
            "UPDATE jobs SET status = 'running', started_at = ?, progress = 0.1 WHERE id = ?",
            (utc_now(), job_id),
        )
        handler = HANDLERS.get(kind)
        try:
            if handler is None:
                raise ValueError(f"unknown job kind: {kind}")
            result = handler(payload)
            self.db.execute(
                """
                UPDATE jobs SET status = 'succeeded', result = ?, error = NULL,
                    progress = 1, finished_at = ? WHERE id = ?
                """,
                (json.dumps(result, ensure_ascii=False), utc_now(), job_id),
            )
        except Exception as exc:
            logger.exception("job %s (%s) failed", job_id, kind)
            self.db.execute(
                """
                UPDATE jobs SET status = 'failed', error = ?, progress = 1, finished_at = ?
                WHERE id = ?
                """,
                (str(exc), utc_now(), job_id),
            )
        return True

    def start_worker(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="job-worker", daemon=True)
        self._thread.start()

    def stop_worker(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None

    def _loop(self) -> None:
        while not self._stop.is_set():
            processed = self.process_one()
            if not processed:
                self._stop.wait(0.05)
