"""Zip members shared by the ISO XML, field-dossier and binary-map readers."""

from __future__ import annotations

import io
import zipfile
from collections.abc import Iterator


def is_zip(data: bytes) -> bool:
    return len(data) >= 4 and data[:2] == b"PK"


def members(data: bytes) -> dict[str, bytes]:
    """Basename → bytes. Skips directories and macOS resource forks."""
    found: dict[str, bytes] = {}
    if not is_zip(data):
        return found
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return found
    with archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = info.filename.replace("\\", "/")
            base = name.rsplit("/", 1)[-1]
            if not base or base.startswith("._") or name.startswith("__MACOSX/"):
                continue
            found[name] = archive.read(info)
    return found


def named(entries: dict[str, bytes]) -> Iterator[tuple[str, str, bytes]]:
    """``(full path, basename, bytes)`` for every member."""
    for path, payload in entries.items():
        yield path, path.rsplit("/", 1)[-1], payload
