"""Plain GeoJSON, whoever wrote it.

The fallback adapter. It qualifies a figure only when the document says so with
``srbc_kind`` (survey pole exports do); everything else becomes a landmark
rather than a guess, which is the rule the parcel importer already follows for
figures of unknown nature.
"""

from __future__ import annotations

from typing import Any

from backend.fields.geometry import polygon_area_m2
from backend.imports import geo
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
    id="geojson_generic",
    label="GeoJSON",
    vendor="generic",
    extensions=(".geojson", ".json"),
    format_id="geojson",
    kinds=("boundary", "row", "guidance_line", "obstacle", "landmark"),
)

SUPPORTED_GEOMETRIES = frozenset(
    {
        "Point",
        "MultiPoint",
        "LineString",
        "MultiLineString",
        "Polygon",
        "MultiPolygon",
    }
)

#: Only an explicit declaration promotes a figure above "landmark".
DECLARED_KINDS: dict[str, str] = {
    "field": "boundary",
    "parcelle": "boundary",
    "boundary": "boundary",
    "row": "row",
    "rang": "row",
    "bed": "row",
    "planche": "row",
    "guidance_line": "guidance_line",
    "guidance": "guidance_line",
    "ligne_guidage": "guidance_line",
    "obstacle": "obstacle",
}


def features_of(document: Any) -> list[dict[str, Any]] | None:
    if not isinstance(document, dict):
        return None
    if document.get("type") == "Feature":
        return [document]
    if document.get("type") != "FeatureCollection":
        return None
    raw = document.get("features")
    return [item for item in raw if isinstance(item, dict)] if isinstance(raw, list) else None


def usable_geometry(feature: dict[str, Any]) -> dict[str, Any] | None:
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        return None
    kind = geometry.get("type")
    if not isinstance(kind, str) or kind not in SUPPORTED_GEOMETRIES:
        return None
    if geometry.get("coordinates") is None:
        return None
    return {"type": kind, "coordinates": geometry["coordinates"]}


def properties_of(feature: dict[str, Any]) -> dict[str, Any]:
    properties = feature.get("properties")
    return dict(properties) if isinstance(properties, dict) else {}


def declared_kind(properties: dict[str, Any]) -> str:
    raw = properties.get("srbc_kind") or properties.get("kind") or ""
    return DECLARED_KINDS.get(str(raw).strip().lower(), "landmark")


def label_of(properties: dict[str, Any], fallback: str) -> str:
    for key in ("name", "label", "title"):
        value = properties.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return fallback


def geometry_metrics(features: list[dict[str, Any]]) -> list[Metric]:
    length = sum(geo.geometry_length_m(feature.get("geometry")) for feature in features)
    area = 0.0
    for feature in features:
        surface = polygon_area_m2(feature.get("geometry"))
        if surface:
            area += surface
    metrics = [Metric("imports.metric.features", len(features))]
    if length > 0:
        metrics.append(Metric("imports.metric.totalLength", geo.rounded(length, 1), "m"))
    if area > 0:
        metrics.append(Metric("imports.metric.totalArea", geo.rounded(area, 1), "m²"))
    return metrics


def _detect(source: ImportSource) -> Detection | None:
    features = features_of(source.document())
    if not features:
        return None
    return Detection(
        adapter_id=DESCRIPTOR.id,
        confidence=0.35,
        reason_key="imports.reason.geojson",
        reason_params={"count": len(features)},
    )


def _parse(source: ImportSource) -> ImportResult:
    raw_features = features_of(source.document())
    if raw_features is None:
        raise ImportRefused("imports.error.notGeoJSON")
    features: list[dict[str, Any]] = []
    skipped = 0
    unqualified = 0
    for index, raw in enumerate(raw_features, start=1):
        geometry = usable_geometry(raw)
        if geometry is None:
            skipped += 1
            continue
        properties = properties_of(raw)
        kind = declared_kind(properties)
        if kind == "landmark":
            unqualified += 1
        features.append(
            imported_feature(
                geometry,
                kind,
                descriptor=DESCRIPTOR,
                label=label_of(properties, f"#{index}"),
                source_properties=properties or None,
            )
        )
    if not features:
        raise ImportRefused("imports.error.noGeometry")
    notices = []
    if unqualified:
        notices.append(Notice("imports.notice.unqualified", {"count": unqualified}))
    if skipped:
        notices.append(Notice("imports.notice.skipped", {"count": skipped}))
    return ImportResult(
        collection=collection_of(features),
        report=build_report(
            DESCRIPTOR,
            features,
            metrics=geometry_metrics(features),
            notices=notices,
        ),
    )


ADAPTER = Adapter(descriptor=DESCRIPTOR, detect=_detect, parse=_parse)
