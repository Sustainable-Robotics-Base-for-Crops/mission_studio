"""Naïo Technologies WorkMap (GeoJSON with a vendor ``metadata`` block).

A work map, not a log: it carries the rows the robot must follow, with the
entry and exit constraints of each row end. The file has no field limit, so the
layer is a reference to draw over, never a parcel on its own.

Observed in the wild: ``metadata.type = "WorkMap"``, ``version 4``, features of
``type: "Crop"`` whose ``trace_type`` is ``OverCrops``, each a three-vertex
LineString that starts with a short lead-in before the row axis.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.imports import geo
from backend.imports.adapters.geojson_generic import (
    features_of,
    label_of,
    properties_of,
    usable_geometry,
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
    id="naio_workmap",
    label="Naïo WorkMap",
    vendor="naio",
    extensions=(".geojson", ".json"),
    format_id="geojson",
    kinds=("row", "boundary", "obstacle", "landmark"),
)

#: ``properties.type`` of a WorkMap feature → import kind.
FEATURE_KINDS: dict[str, str] = {
    "crop": "row",
    "field": "boundary",
    "parcel": "boundary",
    "plot": "boundary",
    "obstacle": "obstacle",
}

#: A lead-in shorter than this is an approach segment, not part of the row.
LEAD_IN_MAX_M = 2.0

#: Personal data: the studio never copies an operator identity into a layer.
DROPPED_METADATA = ("owner",)


def _work_map_metadata(document: Any) -> dict[str, Any] | None:
    if not isinstance(document, dict):
        return None
    metadata = document.get("metadata")
    return metadata if isinstance(metadata, dict) else None


def _is_work_map(document: Any) -> bool:
    metadata = _work_map_metadata(document)
    return bool(metadata and str(metadata.get("type") or "").lower() == "workmap")


def _has_crop_traces(document: Any) -> bool:
    features = features_of(document) or []
    for feature in features:
        properties = properties_of(feature)
        if "trace_type" in properties and str(properties.get("type") or "").lower() == "crop":
            return True
    return False


def _iso_from_millis(value: Any) -> str | None:
    if not isinstance(value, (int, float)):
        return None
    try:
        moment = datetime.fromtimestamp(float(value) / 1000.0, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None
    return moment.isoformat().replace("+00:00", "Z")


def _row_spacings(rows: list[dict[str, Any]]) -> list[float]:
    """Distance between the start points of consecutive rows, in file order."""
    starts = []
    for feature in rows:
        ends = geo.first_last(feature.get("geometry"))
        if ends:
            starts.append(ends[0])
    return [geo.distance_m(starts[index - 1], starts[index]) for index in range(1, len(starts))]


def _lead_in_lengths(rows: list[dict[str, Any]]) -> list[float]:
    lengths = []
    for feature in rows:
        parts = geo.line_parts(feature.get("geometry"))
        if parts and len(parts[0]) >= 3:
            lengths.append(geo.distance_m(parts[0][0], parts[0][1]))
    return lengths


def _bearings(rows: list[dict[str, Any]]) -> list[float]:
    bearings = []
    for feature in rows:
        ends = geo.first_last(feature.get("geometry"))
        if not ends:
            continue
        bearing = geo.bearing_deg(ends[0], ends[1])
        if bearing is not None:
            bearings.append(bearing)
    return bearings


def _count_crop_holes(features: list[dict[str, Any]]) -> int:
    total = 0
    for feature in features:
        holes = properties_of(feature).get("crop_holes")
        if isinstance(holes, list):
            total += len(holes)
    return total


def _detect(source: ImportSource) -> Detection | None:
    document = source.document()
    if _is_work_map(document):
        metadata = _work_map_metadata(document) or {}
        return Detection(
            adapter_id=DESCRIPTOR.id,
            confidence=0.95,
            reason_key="imports.reason.naioWorkMap",
            reason_params={"version": metadata.get("version")},
        )
    if _has_crop_traces(document):
        return Detection(
            adapter_id=DESCRIPTOR.id,
            confidence=0.7,
            reason_key="imports.reason.naioCropTraces",
        )
    return None


def _metrics(
    metadata: dict[str, Any],
    rows: list[dict[str, Any]],
    features: list[dict[str, Any]],
) -> list[Metric]:
    metrics = [
        Metric("imports.metric.features", len(features)),
        Metric("imports.metric.rows", len(rows)),
    ]
    total = sum(geo.geometry_length_m(feature.get("geometry")) for feature in rows)
    if total > 0:
        metrics.append(Metric("imports.metric.totalLength", geo.rounded(total, 1), "m"))
        metrics.append(
            Metric("imports.metric.meanRowLength", geo.rounded(total / len(rows), 1), "m")
        )
    spacing = geo.median(_row_spacings(rows))
    if spacing:
        metrics.append(Metric("imports.metric.rowSpacing", geo.rounded(spacing, 2), "m"))
    bearing = geo.median(_bearings(rows))
    if bearing is not None:
        metrics.append(Metric("imports.metric.rowBearing", geo.rounded(bearing, 1), "°"))
    lead_in = geo.median(_lead_in_lengths(rows))
    if lead_in is not None and lead_in <= LEAD_IN_MAX_M:
        metrics.append(Metric("imports.metric.leadIn", geo.rounded(lead_in, 2), "m"))
    version = metadata.get("version")
    if version is not None:
        metrics.append(Metric("imports.metric.formatVersion", str(version)))
    generated = _iso_from_millis(metadata.get("timestamp"))
    if generated:
        metrics.append(Metric("imports.metric.generatedAt", generated))
    uuid = metadata.get("uuid")
    if isinstance(uuid, str) and uuid:
        metrics.append(Metric("imports.metric.sourceId", uuid))
    return metrics


def _notices(
    metadata: dict[str, Any],
    rows: list[dict[str, Any]],
    raw_features: list[dict[str, Any]],
    kinds: set[str],
) -> list[Notice]:
    notices: list[Notice] = []
    if "boundary" not in kinds:
        notices.append(Notice("imports.notice.noBoundary"))
    if any(metadata.get(key) for key in DROPPED_METADATA):
        notices.append(Notice("imports.notice.ownerDropped"))
    if rows and metadata.get("mandatory_row_order") in (None, [], ""):
        notices.append(Notice("imports.notice.naioFreeRowOrder"))
    holes = _count_crop_holes(raw_features)
    if holes:
        notices.append(Notice("imports.notice.naioCropHoles", {"count": holes}))
    return notices


def _parse(source: ImportSource) -> ImportResult:
    document = source.document()
    raw_features = features_of(document)
    if raw_features is None:
        raise ImportRefused("imports.error.notGeoJSON")
    if not _is_work_map(document) and not _has_crop_traces(document):
        raise ImportRefused("imports.error.notNaioWorkMap")
    metadata = _work_map_metadata(document) or {}

    features: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    skipped = 0
    for index, raw in enumerate(raw_features, start=1):
        geometry = usable_geometry(raw)
        if geometry is None:
            skipped += 1
            continue
        properties = properties_of(raw)
        declared = str(properties.get("type") or "").strip().lower()
        kind = FEATURE_KINDS.get(declared, "landmark")
        if kind == "row" and geometry["type"] not in {"LineString", "MultiLineString"}:
            kind = "landmark"
        identifier = raw.get("id")
        fallback = f"#{identifier}" if identifier is not None else f"#{index}"
        feature = imported_feature(
            geometry,
            kind,
            descriptor=DESCRIPTOR,
            label=label_of(properties, fallback),
            source_properties=properties or None,
            extra={"source_id": identifier} if identifier is not None else None,
        )
        features.append(feature)
        if kind == "row":
            rows.append(feature)
    if not features:
        raise ImportRefused("imports.error.noGeometry")

    kinds = {
        str((feature["properties"]["srbc_import"]).get("kind") or "landmark")
        for feature in features
    }
    notices = _notices(metadata, rows, raw_features, kinds)
    if skipped:
        notices.append(Notice("imports.notice.skipped", {"count": skipped}))
    return ImportResult(
        collection=collection_of(features),
        report=build_report(
            DESCRIPTOR,
            features,
            metrics=_metrics(metadata, rows, features),
            notices=notices,
        ),
    )


ADAPTER = Adapter(descriptor=DESCRIPTOR, detect=_detect, parse=_parse)
