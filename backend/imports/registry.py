"""The list of known import dialects.

Adding a format is one module in ``adapters/`` plus one line here. Order sets
the tie-break when two adapters answer with the same confidence, so vendor
dialects come before the generic readers they specialise.
"""

from __future__ import annotations

from backend.imports.adapters import (
    binary_map,
    field_dossier,
    geojson_generic,
    isoxml,
    naio_workmap,
    raven_shapefile,
    shapefile_generic,
    work_performed,
)
from backend.imports.types import (
    Adapter,
    Detection,
    ImportRefused,
    ImportResult,
    ImportSource,
)

ADAPTERS: tuple[Adapter, ...] = (
    naio_workmap.ADAPTER,
    raven_shapefile.ADAPTER,
    isoxml.ADAPTER,
    field_dossier.ADAPTER,
    binary_map.ADAPTER,
    work_performed.ADAPTER,
    geojson_generic.ADAPTER,
    shapefile_generic.ADAPTER,
)

_BY_ID = {adapter.id: adapter for adapter in ADAPTERS}


def descriptors() -> list[dict[str, object]]:
    return [adapter.descriptor.to_dict() for adapter in ADAPTERS]


def adapter(adapter_id: str) -> Adapter:
    found = _BY_ID.get(adapter_id)
    if found is None:
        raise ImportRefused("imports.error.unknownAdapter", {"adapter": adapter_id})
    return found


def detect(source: ImportSource) -> list[Detection]:
    """Every adapter that recognises the file, most confident first.

    A detector that raises is a bug in that adapter, not a rejected file: the
    remaining candidates still deserve their chance, so the error is swallowed
    here and shows up as an absent candidate.
    """
    found: list[tuple[int, Detection]] = []
    for rank, candidate in enumerate(ADAPTERS):
        try:
            detection = candidate.detect(source)
        except (ValueError, TypeError, KeyError, IndexError, OSError):
            detection = None
        if detection is not None:
            found.append((rank, detection))
    found.sort(key=lambda entry: (-entry[1].confidence, entry[0]))
    return [detection for _rank, detection in found]


def parse(source: ImportSource, adapter_id: str) -> ImportResult:
    return adapter(adapter_id).parse(source)
