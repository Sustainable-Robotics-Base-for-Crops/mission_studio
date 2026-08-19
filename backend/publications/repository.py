"""Immutable mission publications (lot L11). SQLite, not Agri v3 schema."""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from backend.db import Database, utc_now

MOBILE_KEYS = ("synced_at", "downloaded_at", "received_at", "preflight_at", "activated_at")


def canonical_bytes(document: dict[str, Any]) -> bytes:
    stripped = dict(document)
    metadata = stripped.get("metadata")
    if isinstance(metadata, dict):
        metadata = dict(metadata)
        metadata.pop("srbc_publication", None)
        stripped["metadata"] = metadata
    return json.dumps(stripped, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )


def checksum_of(document: dict[str, Any]) -> tuple[str, int]:
    raw = canonical_bytes(document)
    return hashlib.sha256(raw).hexdigest(), len(raw)


def _load(raw: str | None, default: Any):
    if not raw:
        return default
    return json.loads(raw)


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _row(row: Any, *, include_snapshot: bool) -> dict[str, Any]:
    packet = _load(row["packet"] if "packet" in row.keys() else "{}", {})
    record = {
        "id": row["id"],
        "source_path": row["source_path"],
        "version": int(row["version"]),
        "status": row["status"],
        "checksum": row["checksum"],
        "byte_size": int(row["byte_size"]),
        "simulation": _load(row["simulation"], {}),
        "approver": row["approver"],
        "published_at": row["published_at"],
        "expires_at": row["expires_at"],
        "vehicle_id": packet.get("vehicle_id"),
        "field_id": packet.get("field_id"),
        "combination_id": packet.get("combination_id"),
        "mobile": {key: row[key] if key in row.keys() else None for key in MOBILE_KEYS},
    }
    if include_snapshot:
        record["snapshot"] = _load(row["snapshot"], {})
        record["packet"] = packet
    return record


class PublicationRepository:
    def __init__(self, database: Database):
        self._db = database

    def list_publications(self, source_path: str | None = None) -> list[dict[str, Any]]:
        if source_path:
            rows = self._db.execute(
                """
                SELECT * FROM publications
                WHERE source_path = ?
                ORDER BY version DESC
                """,
                (source_path,),
            ).fetchall()
        else:
            rows = self._db.execute(
                "SELECT * FROM publications ORDER BY published_at DESC, version DESC"
            ).fetchall()
        return [_row(row, include_snapshot=False) for row in rows]

    def get(self, publication_id: str) -> dict[str, Any] | None:
        row = self._db.execute(
            "SELECT * FROM publications WHERE id = ?", (publication_id,)
        ).fetchone()
        return None if row is None else _row(row, include_snapshot=True)

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        document = payload.get("document")
        if not isinstance(document, dict):
            raise ValueError("document is required")
        points = document.get("points")
        if not isinstance(points, list) or len(points) == 0:
            raise ValueError("document has no sections")
        if payload.get("stale") is True:
            raise ValueError("simulation is stale — re-run Simuler")
        simulation = payload.get("simulation") if isinstance(payload.get("simulation"), dict) else {}
        block_count = int(simulation.get("blockCount") or simulation.get("block_count") or 0)
        if block_count > 0:
            raise ValueError("publication blocked while simulation blockers remain")
        source_path = str(payload.get("source_path") or "").strip()
        if not source_path:
            raise ValueError("source_path is required")
        checksum, byte_size = checksum_of(document)
        latest = self._db.execute(
            "SELECT MAX(version) AS v FROM publications WHERE source_path = ?",
            (source_path,),
        ).fetchone()
        version = int(latest["v"] or 0) + 1 if latest is not None else 1
        publication_id = str(payload.get("id") or uuid.uuid4())
        now = utc_now()
        approver = str(payload.get("approver") or "local").strip() or "local"
        expires_at = payload.get("expires_at")
        expires_at = str(expires_at).strip() if expires_at else None
        stamp = {
            "id": publication_id,
            "version": version,
            "checksum": checksum,
            "published_at": now,
            "expires_at": expires_at,
        }
        metadata = document.get("metadata") if isinstance(document.get("metadata"), dict) else {}
        snapshot = dict(document)
        snapshot["metadata"] = {**metadata, "srbc_publication": stamp}
        packet = {
            "vehicle_id": payload.get("vehicle_id") or document.get("vehicle_id"),
            "field_id": payload.get("field_id"),
            "combination_id": payload.get("combination_id"),
        }
        self._db.execute(
            """
            UPDATE publications SET status = 'obsolete'
            WHERE source_path = ? AND status = 'published'
            """,
            (source_path,),
        )
        self._db.execute(
            """
            INSERT INTO publications (
                id, source_path, version, status, checksum, byte_size, snapshot,
                simulation, packet, published_at, expires_at, approver
            ) VALUES (?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                publication_id,
                source_path,
                version,
                checksum,
                byte_size,
                _dump(snapshot),
                _dump(simulation),
                _dump(packet),
                now,
                expires_at,
                approver,
            ),
        )
        created = self.get(publication_id)
        if created is None:
            raise RuntimeError("publication insert failed")
        return created
