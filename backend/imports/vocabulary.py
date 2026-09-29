"""Shared vocabulary for third-party file imports.

An adapter normalises a vendor file into GeoJSON features tagged with an import
kind. Drawing those features as a session overlay is all that happens today.
``PROMOTION_TARGETS`` records what each kind is *allowed to become* when a later
lot turns a layer into catalogue or mission objects, so an adapter written now
already states what it really recognised instead of leaving the question open.
"""

from __future__ import annotations

#: What an adapter claims a figure is. Anything it cannot qualify stays a
#: landmark, like the surplus polygon of a parcel import (CdC technique §12).
IMPORT_KINDS: tuple[str, ...] = (
    "boundary",
    "row",
    "guidance_line",
    "obstacle",
    "track",
    "coverage_cell",
    "landmark",
)

#: Destination of a future promotion, or ``None`` when the figure has no
#: individual meaning. ``coverage_cell`` is promoted collectively: four hundred
#: as-applied footprints make one performed-work document, not four hundred
#: objects an operator would edit.
PROMOTION_TARGETS: dict[str, str | None] = {
    "boundary": "catalogue.field",
    "row": "catalogue.row",
    "guidance_line": "catalogue.guidance_line",
    "obstacle": "catalogue.obstacle",
    "track": "mission.row_path",
    "coverage_cell": "agri.work_performed",
    "landmark": "catalogue.landmark",
}

#: Promotions that consume every feature of the kind at once.
COLLECTIVE_PROMOTIONS: frozenset[str] = frozenset({"coverage_cell", "track"})


def promotion_target(kind: str) -> str | None:
    return PROMOTION_TARGETS.get(kind)


def is_collective(kind: str) -> bool:
    return kind in COLLECTIVE_PROMOTIONS
