"""File types shown in the import picker.

Several dialects can share one type. The operator chooses GeoJSON or ISO XML,
and the studio picks the dialect that actually matches the bytes. Vendor names
stay out of this list.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ImportFormat:
    id: str
    #: i18n key, translated in the dialog.
    label_key: str
    #: Dialect ids, most specific first. The last one is the fallback that refuses.
    adapters: tuple[str, ...]
    extensions: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "label_key": self.label_key,
            "extensions": list(self.extensions),
        }


FORMATS: tuple[ImportFormat, ...] = (
    ImportFormat(
        "geojson",
        "imports.formatName.geojson",
        ("naio_workmap", "geojson_generic"),
        (".geojson", ".json"),
    ),
    ImportFormat(
        "shapefile",
        "imports.formatName.shapefile",
        ("raven_shapefile", "shapefile_generic"),
        (".zip", ".shp"),
    ),
    ImportFormat(
        "isoxml",
        "imports.formatName.isoxml",
        ("isoxml",),
        (".xml", ".zip"),
    ),
    ImportFormat(
        "field_dossier",
        "imports.formatName.fieldDossier",
        ("field_dossier",),
        (".zip", ".kml", ".txt"),
    ),
    ImportFormat(
        "binary_map",
        "imports.formatName.binaryMap",
        ("binary_map",),
        (".zip",),
    ),
    ImportFormat(
        "work_performed",
        "imports.formatName.workPerformed",
        ("work_performed",),
        (".json", ".zip"),
    ),
)

_BY_ID = {item.id: item for item in FORMATS}


def format_descriptors() -> list[dict[str, object]]:
    return [item.to_dict() for item in FORMATS]


def format_of(adapter_id: str) -> str | None:
    for item in FORMATS:
        if adapter_id in item.adapters:
            return item.id
    return None


def format_by_id(format_id: str) -> ImportFormat | None:
    return _BY_ID.get(format_id)
