"""Contracts every import adapter implements, and the wire format of a preview.

The dictionaries produced by ``to_dict`` are the whole API surface of an import:
keeping them here means a new adapter cannot invent a second payload shape.
Human-readable text is *not* built here — metrics and notices carry i18n keys so
the studio translates them, exactly like the rest of the interface.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from backend.imports.vocabulary import is_collective, promotion_target

_UNPARSED = object()


class ImportRefused(ValueError):
    """The file cannot be imported; ``key`` is the message the studio shows."""

    def __init__(self, key: str, params: dict[str, Any] | None = None) -> None:
        super().__init__(key)
        self.key = key
        self.params = params or {}

    def to_dict(self) -> dict[str, Any]:
        return {"error": self.key, "params": self.params}


@dataclass
class ImportSource:
    """The uploaded bytes, decoded lazily and at most once per representation."""

    filename: str
    data: bytes
    _document: Any = field(default=_UNPARSED, repr=False, compare=False)

    @property
    def suffix(self) -> str:
        base = self.filename.rsplit("/", 1)[-1]
        if "." not in base:
            return ""
        return "." + base.rpartition(".")[2].lower()

    @property
    def stem(self) -> str:
        base = self.filename.rsplit("/", 1)[-1]
        return base.rpartition(".")[0] or base

    def text(self) -> str | None:
        for codec in ("utf-8-sig", "cp1252"):
            try:
                return self.data.decode(codec)
            except UnicodeDecodeError:
                continue
        return None

    def document(self) -> Any:
        """The parsed JSON document, or ``None`` when the bytes are not JSON."""
        if self._document is _UNPARSED:
            text = self.text()
            try:
                self._document = json.loads(text) if text else None
            except (json.JSONDecodeError, ValueError):
                self._document = None
        return self._document


@dataclass(frozen=True)
class AdapterDescriptor:
    """Identity of an adapter.

    The dialog lists ``format_id`` (GeoJSON, ISO XML, …), never the vendor.
    ``label`` stays an internal name for logs and tests.
    """

    id: str
    label: str
    vendor: str
    extensions: tuple[str, ...]
    #: File type shown in the picker. Several adapters may share one format.
    format_id: str
    #: Import kinds this adapter can emit.
    kinds: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "vendor": self.vendor,
            "extensions": list(self.extensions),
            "format_id": self.format_id,
            "kinds": list(self.kinds),
        }


@dataclass(frozen=True)
class Detection:
    """Why an adapter thinks the file is its own, and how strongly."""

    adapter_id: str
    confidence: float
    reason_key: str
    reason_params: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "adapter": self.adapter_id,
            "confidence": round(self.confidence, 3),
            "reason": self.reason_key,
            "params": self.reason_params,
        }


@dataclass(frozen=True)
class Metric:
    """One preview figure: ``key`` is an i18n key, never a sentence."""

    key: str
    value: float | int | str | None
    unit: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"key": self.key, "value": self.value, "unit": self.unit}


@dataclass(frozen=True)
class Notice:
    """Something the operator must know before trusting the layer."""

    key: str
    params: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"key": self.key, "params": self.params}


@dataclass(frozen=True)
class ImportReport:
    descriptor: AdapterDescriptor
    feature_count: int
    kinds: dict[str, int]
    geometry_types: dict[str, int]
    metrics: tuple[Metric, ...] = ()
    notices: tuple[Notice, ...] = ()
    #: Shapefile member stems, or other sub-parts the archive contained.
    members: tuple[str, ...] = ()
    #: Named parts of one file (one partfield each). Empty when the file is a single plot.
    groups: tuple[dict[str, Any], ...] = ()

    def promotions(self) -> list[dict[str, Any]]:
        """What a later lot could build from this layer, kind by kind."""
        entries = []
        for kind, count in self.kinds.items():
            target = promotion_target(kind)
            if not target:
                continue
            entries.append(
                {
                    "kind": kind,
                    "target": target,
                    "count": count,
                    "collective": is_collective(kind),
                }
            )
        return sorted(entries, key=lambda entry: (-entry["count"], entry["kind"]))

    def to_dict(self) -> dict[str, Any]:
        return {
            "adapter": self.descriptor.id,
            "label": self.descriptor.label,
            "vendor": self.descriptor.vendor,
            "feature_count": self.feature_count,
            "kinds": dict(self.kinds),
            "geometry_types": dict(self.geometry_types),
            "metrics": [metric.to_dict() for metric in self.metrics],
            "notices": [notice.to_dict() for notice in self.notices],
            "members": list(self.members),
            "groups": [dict(group) for group in self.groups],
            "promotions": self.promotions(),
        }


@dataclass(frozen=True)
class ImportResult:
    collection: dict[str, Any]
    report: ImportReport


@dataclass(frozen=True)
class Adapter:
    """An adapter is its identity plus two pure functions.

    ``detect`` returns ``None`` when the file is not its business; ``parse``
    raises :class:`ImportRefused` when the operator forced the wrong format.
    """

    descriptor: AdapterDescriptor
    detect: Callable[[ImportSource], Detection | None]
    parse: Callable[[ImportSource], ImportResult]

    @property
    def id(self) -> str:
        return self.descriptor.id


def imported_feature(
    geometry: dict[str, Any],
    kind: str,
    *,
    descriptor: AdapterDescriptor,
    label: str | None = None,
    source_properties: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A normalised overlay feature.

    Vendor properties are preserved verbatim under ``srbc_import.source`` so no
    information is lost, while the studio only has to read ``srbc_import``.
    ``srbc_kind`` is deliberately absent: these figures are not catalogue
    objects yet, and claiming otherwise would mislead the parcel importer.
    """
    payload: dict[str, Any] = {
        "adapter": descriptor.id,
        "vendor": descriptor.vendor,
        "kind": kind,
        "promotion": promotion_target(kind),
    }
    if label:
        payload["label"] = label
    if source_properties:
        payload["source"] = source_properties
    if extra:
        payload.update(extra)
    return {
        "type": "Feature",
        "properties": {"srbc_import": payload},
        "geometry": geometry,
    }


def groups_of(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One entry per ``group_id``, in first-seen order."""
    order: list[str] = []
    names: dict[str, str] = {}
    counts: dict[str, int] = {}
    for feature in features:
        properties = feature.get("properties") or {}
        marker = properties.get("srbc_import") or {}
        group_id = marker.get("group_id")
        if not group_id:
            continue
        key = str(group_id)
        if key not in counts:
            order.append(key)
            names[key] = str(marker.get("group_name") or key)
        counts[key] = counts.get(key, 0) + 1
    return [
        {"id": key, "name": names[key], "feature_count": counts[key]}
        for key in order
    ]


def build_report(
    descriptor: AdapterDescriptor,
    features: list[dict[str, Any]],
    *,
    metrics: list[Metric] | None = None,
    notices: list[Notice] | None = None,
    members: list[str] | None = None,
    groups: list[dict[str, Any]] | None = None,
) -> ImportReport:
    kinds: dict[str, int] = {}
    geometry_types: dict[str, int] = {}
    for feature in features:
        properties = feature.get("properties") or {}
        marker = properties.get("srbc_import") or {}
        kind = str(marker.get("kind") or "landmark")
        kinds[kind] = kinds.get(kind, 0) + 1
        geometry = feature.get("geometry") or {}
        name = str(geometry.get("type") or "Unknown")
        geometry_types[name] = geometry_types.get(name, 0) + 1
    return ImportReport(
        descriptor=descriptor,
        feature_count=len(features),
        kinds=kinds,
        geometry_types=geometry_types,
        metrics=tuple(metrics or ()),
        notices=tuple(notices or ()),
        members=tuple(members or ()),
        groups=tuple(groups if groups is not None else groups_of(features)),
    )


def collection_of(features: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": features}
