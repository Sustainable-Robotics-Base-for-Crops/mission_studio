"""ESRI Shapefile from any source: a zipped set, or a bare ``.shp``.

The fallback for shapefiles, and the shared entry point vendor shapefile
adapters reuse. Nothing is qualified here: an agricultural export puts field
limits, guidance lines and as-applied footprints in the very same geometry
types, so every figure lands as a landmark until an adapter recognises the
vendor's attribute names.
"""

from __future__ import annotations

from typing import Any

from backend.fields.geometry import polygon_area_m2
from backend.imports import geo
from backend.imports.shapefile import (
    ShapefileError,
    ShapefileLayer,
    archive_member_names,
    looks_like_shapefile,
    looks_like_shapefile_zip,
    read_shapefile,
    read_shapefile_zip,
)
from backend.imports.types import (
    Adapter,
    AdapterDescriptor,
    Detection,
    ImportRefused,
    ImportResult,
    ImportSource,
    Metric,
    Notice,
    build_report,
    collection_of,
    imported_feature,
)

DESCRIPTOR = AdapterDescriptor(
    id="shapefile_generic",
    label="Shapefile (ESRI)",
    vendor="generic",
    extensions=(".zip", ".shp"),
    format_id="shapefile",
    kinds=("landmark",),
)


def is_shapefile_source(source: ImportSource) -> bool:
    return looks_like_shapefile_zip(source.data) or looks_like_shapefile(source.data)


def layers_of(source: ImportSource) -> list[ShapefileLayer]:
    """Every SHP layer of the upload, whether it arrived zipped or bare."""
    try:
        if looks_like_shapefile_zip(source.data):
            return read_shapefile_zip(source.data)
        if looks_like_shapefile(source.data):
            return [read_shapefile(source.stem, source.data)]
    except ShapefileError as reason:
        raise ImportRefused("imports.error.unreadableShapefile", {"reason": str(reason)}) from (
            reason
        )
    raise ImportRefused("imports.error.notShapefile")


def member_names(source: ImportSource) -> list[str]:
    if looks_like_shapefile_zip(source.data):
        return archive_member_names(source.data)
    return [source.stem]


def attributes_of(record: Any) -> dict[str, Any] | None:
    attributes = {
        key: value for key, value in (record.attributes or {}).items() if value is not None
    }
    return attributes or None


def layer_metrics(layers: list[ShapefileLayer], features: list[dict[str, Any]]) -> list[Metric]:
    metrics = [
        Metric("imports.metric.features", len(features)),
        Metric("imports.metric.layers", len(layers)),
    ]
    length = sum(geo.geometry_length_m(feature.get("geometry")) for feature in features)
    if length > 0:
        metrics.append(Metric("imports.metric.totalLength", geo.rounded(length, 1), "m"))
    area = 0.0
    for feature in features:
        surface = polygon_area_m2(feature.get("geometry"))
        if surface:
            area += surface
    if area > 0:
        metrics.append(Metric("imports.metric.totalArea", geo.rounded(area, 1), "m²"))
    return metrics


def _detect(source: ImportSource) -> Detection | None:
    if not is_shapefile_source(source):
        return None
    members = member_names(source)
    return Detection(
        adapter_id=DESCRIPTOR.id,
        confidence=0.35,
        reason_key="imports.reason.shapefile",
        reason_params={"count": len(members)},
    )


def _parse(source: ImportSource) -> ImportResult:
    layers = layers_of(source)
    features: list[dict[str, Any]] = []
    for layer in layers:
        for record in layer.records:
            if record.geometry is None:
                continue
            features.append(
                imported_feature(
                    record.geometry,
                    "landmark",
                    descriptor=DESCRIPTOR,
                    label=f"{layer.name} #{record.number}",
                    source_properties=attributes_of(record),
                    extra={"source_layer": layer.name},
                )
            )
    if not features:
        raise ImportRefused("imports.error.noGeometry")
    return ImportResult(
        collection=collection_of(features),
        report=build_report(
            DESCRIPTOR,
            features,
            metrics=layer_metrics(layers, features),
            notices=[
                Notice("imports.notice.unqualified", {"count": len(features)}),
                Notice("imports.notice.noBoundary"),
            ],
            members=[layer.name for layer in layers],
        ),
    )


ADAPTER = Adapter(descriptor=DESCRIPTOR, detect=_detect, parse=_parse)
