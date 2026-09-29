"""Preview an upload: which file type matches, what was found, and the layer.

The picker lists file types (GeoJSON, ISO XML, …). Calling preview again with
``format_id`` is how the operator overrides a wrong guess. ``adapter_id``
remains for tests that force one dialect inside a type.
"""

from __future__ import annotations

from typing import Any

from backend.imports.formats import format_by_id, format_descriptors, format_of
from backend.imports.registry import descriptors, detect, parse
from backend.imports.types import ImportRefused, ImportSource

#: Vendor exports are tens of kilobytes; anything larger is a mistake.
MAX_BYTES = 8 * 1024 * 1024

#: An overlay the browser can still draw. Refused rather than truncated: a
#: silently shortened layer would be read as the whole job.
MAX_FEATURES = 20_000


def _adapter_for_format(source: ImportSource, format_id: str, found: list[Any]) -> str:
    spec = format_by_id(format_id)
    if spec is None:
        raise ImportRefused("imports.error.unknownFormat", {"format": format_id})
    for detection in found:
        if detection.adapter_id in spec.adapters:
            return detection.adapter_id
    return spec.adapters[-1]


def preview(
    filename: str,
    data: bytes,
    adapter_id: str | None = None,
    format_id: str | None = None,
) -> dict[str, Any]:
    if not data:
        raise ImportRefused("imports.error.empty")
    if len(data) > MAX_BYTES:
        raise ImportRefused(
            "imports.error.tooLarge",
            {"limit_mb": MAX_BYTES // (1024 * 1024)},
        )
    source = ImportSource(filename=filename or "import", data=data)
    candidates = detect(source)
    if format_id:
        chosen = _adapter_for_format(source, format_id, candidates)
    else:
        chosen = adapter_id or (candidates[0].adapter_id if candidates else None)
    if not chosen:
        raise ImportRefused("imports.error.unrecognised")
    result = parse(source, chosen)
    if result.report.feature_count > MAX_FEATURES:
        raise ImportRefused(
            "imports.error.tooManyFeatures",
            {"count": result.report.feature_count, "limit": MAX_FEATURES},
        )
    return {
        "source": {"filename": source.filename, "bytes": len(data)},
        "adapters": descriptors(),
        "formats": format_descriptors(),
        "format": format_of(chosen),
        "candidates": [candidate.to_dict() for candidate in candidates],
        "adapter": chosen,
        "report": result.report.to_dict(),
        "collection": result.collection,
    }
