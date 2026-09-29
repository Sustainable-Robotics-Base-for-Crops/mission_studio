"""Raven Industries (CNH) shapefile export: as-applied coverage and last-pass lines.

What was actually driven, not what was planned. A job export holds two members:

``<field>_0``
    One quadrilateral per GNSS sample, as wide as the working width. Attributes
    ``timeStamp``, ``cog``, ``sogMPerSec``, ``elevM``, ``actualRate``,
    ``targetRate``, ``pressure``, ``gpsMode``, ``product``, ``guid``,
    ``equipId``.
``<field>_lpLines``
    The last-pass lines of the same job, attribute ``swathWidth``.

Neither member is a field limit: a lace of four hundred two-square-metre cells
must never be mistaken for a boundary.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from backend.fields.geometry import polygon_area_m2
from backend.imports import geo
from backend.imports.adapters.shapefile_generic import (
    attributes_of,
    is_shapefile_source,
    layers_of,
)
from backend.imports.shapefile import ShapefileLayer
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
    id="raven_shapefile",
    label="Raven Shapefile (as-applied)",
    vendor="raven",
    extensions=(".zip", ".shp"),
    format_id="shapefile",
    kinds=("coverage_cell", "guidance_line", "track", "landmark"),
)

#: Attribute names that only a Raven job export carries.
COVERAGE_FIELDS = frozenset({"sogMPerSec", "actualRate", "targetRate", "equipId"})
GUIDANCE_FIELDS = frozenset({"swathWidth"})
GUIDANCE_SUFFIX = "_lplines"

#: Raven writes a US 12-hour stamp; other consoles are less predictable.
TIMESTAMP_FORMATS = (
    "%m/%d/%Y %I:%M:%S %p",
    "%m/%d/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
)

#: ESRI polygon shape types: as-applied footprints, as opposed to a pose trace.
POLYGON_SHAPE_TYPES = frozenset({5, 15, 25})


def _layer_kind(layer: ShapefileLayer) -> str:
    fields = set(layer.fields)
    if layer.name.lower().endswith(GUIDANCE_SUFFIX) or fields & GUIDANCE_FIELDS:
        return "guidance_line"
    if fields & COVERAGE_FIELDS:
        return "coverage_cell" if layer.shape_type in POLYGON_SHAPE_TYPES else "track"
    return "landmark"


def _is_raven(layers: list[ShapefileLayer]) -> bool:
    vendor_kinds = {"coverage_cell", "guidance_line", "track"}
    return any(_layer_kind(layer) in vendor_kinds for layer in layers)


def _numbers(layers: list[ShapefileLayer], name: str) -> list[float]:
    values: list[float] = []
    for layer in layers:
        for value in layer.column(name):
            if isinstance(value, (int, float)):
                values.append(float(value))
    return values


def _strings(layers: list[ShapefileLayer], name: str) -> list[str]:
    values: list[str] = []
    for layer in layers:
        for value in layer.column(name):
            if isinstance(value, str) and value.strip():
                values.append(value.strip())
    return values


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    for pattern in TIMESTAMP_FORMATS:
        try:
            return datetime.strptime(text, pattern)
        except ValueError:
            continue
    return None


def _run_window(layers: list[ShapefileLayer]) -> tuple[datetime, datetime] | None:
    stamps = []
    for layer in layers:
        for value in layer.column("timeStamp"):
            moment = _parse_timestamp(value)
            if moment is not None:
                stamps.append(moment)
    if not stamps:
        return None
    return min(stamps), max(stamps)


def _covered_area_m2(features: list[dict[str, Any]]) -> float:
    total = 0.0
    for feature in features:
        marker = feature["properties"]["srbc_import"]
        if marker.get("kind") != "coverage_cell":
            continue
        surface = polygon_area_m2(feature.get("geometry"))
        if surface:
            total += surface
    return total


def _detect(source: ImportSource) -> Detection | None:
    if not is_shapefile_source(source):
        return None
    try:
        layers = layers_of(source)
    except ImportRefused:
        return None
    if not _is_raven(layers):
        return None
    return Detection(
        adapter_id=DESCRIPTOR.id,
        confidence=0.95,
        reason_key="imports.reason.ravenSignature",
        reason_params={"count": len(layers)},
    )


def _metrics(layers: list[ShapefileLayer], features: list[dict[str, Any]]) -> list[Metric]:
    kinds = [feature["properties"]["srbc_import"].get("kind") for feature in features]
    guidance = [
        feature
        for feature in features
        if feature["properties"]["srbc_import"]["kind"] == "guidance_line"
    ]
    metrics = [
        Metric("imports.metric.features", len(features)),
        Metric("imports.metric.coverageCells", kinds.count("coverage_cell")),
    ]
    area = _covered_area_m2(features)
    if area > 0:
        metrics.append(Metric("imports.metric.coveredArea", geo.rounded(area, 1), "m²"))
    swaths = _numbers(layers, "swathWidth")
    swath = geo.median(swaths)
    if swath:
        metrics.append(Metric("imports.metric.swathWidth", geo.rounded(swath, 2), "m"))
    guidance_count = kinds.count("guidance_line")
    if guidance_count:
        metrics.append(Metric("imports.metric.guidanceLines", guidance_count))
        length = sum(geo.geometry_length_m(feature.get("geometry")) for feature in guidance)
        if length > 0:
            metrics.append(Metric("imports.metric.totalLength", geo.rounded(length, 1), "m"))
    window = _run_window(layers)
    if window:
        metrics.append(Metric("imports.metric.runStartedAt", window[0].isoformat()))
        metrics.append(
            Metric(
                "imports.metric.duration",
                geo.rounded((window[1] - window[0]).total_seconds(), 0),
                "s",
            )
        )
    speeds = _numbers(layers, "sogMPerSec")
    if speeds:
        metrics.append(
            Metric("imports.metric.meanSpeed", geo.rounded(sum(speeds) / len(speeds), 2), "m/s")
        )
        metrics.append(Metric("imports.metric.maxSpeed", geo.rounded(max(speeds), 2), "m/s"))
    elevations = _numbers(layers, "elevM")
    if elevations:
        spread = geo.rounded(max(elevations) - min(elevations), 2)
        metrics.append(Metric("imports.metric.elevationRange", spread, "m"))
    products = sorted(set(_strings(layers, "product")))
    if products:
        metrics.append(Metric("imports.metric.product", ", ".join(products)))
    jobs = sorted(set(_strings(layers, "guid")))
    if jobs:
        label = jobs[0] if len(jobs) == 1 else str(len(jobs))
        metrics.append(Metric("imports.metric.jobId", label))
    machines = sorted(set(_strings(layers, "equipId")))
    if machines:
        metrics.append(Metric("imports.metric.machineId", machines[0]))
    return metrics


def _notices(layers: list[ShapefileLayer], features: list[dict[str, Any]]) -> list[Notice]:
    kinds = [feature["properties"]["srbc_import"].get("kind") for feature in features]
    notices = [Notice("imports.notice.noBoundary")]
    if kinds.count("coverage_cell"):
        notices.append(Notice("imports.notice.ravenCoverageNotBoundary"))
    rates = _numbers(layers, "actualRate") + _numbers(layers, "targetRate")
    if rates and not any(rate for rate in rates):
        notices.append(Notice("imports.notice.ravenNoRate"))
    if not _strings(layers, "gpsMode"):
        notices.append(Notice("imports.notice.ravenNoGpsMode"))
    if not _run_window(layers) and any("timeStamp" in layer.fields for layer in layers):
        notices.append(Notice("imports.notice.ravenNoTimestamp"))
    return notices


def _parse(source: ImportSource) -> ImportResult:
    layers = layers_of(source)
    if not _is_raven(layers):
        raise ImportRefused("imports.error.notRaven")
    features: list[dict[str, Any]] = []
    for layer in layers:
        kind = _layer_kind(layer)
        for record in layer.records:
            if record.geometry is None:
                continue
            # Naming four hundred as-applied cells would only add noise.
            label = f"{layer.name} #{record.number}" if kind != "coverage_cell" else None
            features.append(
                imported_feature(
                    record.geometry,
                    kind,
                    descriptor=DESCRIPTOR,
                    label=label,
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
            metrics=_metrics(layers, features),
            notices=_notices(layers, features),
            members=[layer.name for layer in layers],
        ),
    )


ADAPTER = Adapter(descriptor=DESCRIPTOR, detect=_detect, parse=_parse)
