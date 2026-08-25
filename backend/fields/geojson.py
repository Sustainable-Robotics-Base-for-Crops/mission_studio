"""GeoJSON FeatureCollection import / export for the field catalogue."""

from __future__ import annotations

from typing import Any

from backend.fields.geometry import provenance_qualified
from backend.fields.repository import FieldRepository
from backend.fields.types import (
    TRAFFIC_WAY_KINDS,
    ZONE_ALIASES,
    ZONE_KINDS,
    canonical_traffic_node_kind,
    canonical_zone_kind,
)

KIND_ALIASES = {
    "field": "field",
    "parcelle": "field",
    "zone": "zone",
    "obstacle": "obstacle",
    "guidance": "guidance_line",
    "guidance_line": "guidance_line",
    "ligne_guidage": "guidance_line",
    "row": "row",
    "rows": "row",
    "rang": "row",
    "bed": "bed",
    "beds": "bed",
    "planche": "bed",
    "traffic_way": "traffic_way",
    "chemin": "traffic_way",
    "path": "traffic_way",
    "traffic_node": "traffic_node",
    "gate": "traffic_node",
    "porte": "traffic_node",
    "service": "traffic_node",
    "stop": "traffic_node",
    "arret": "traffic_node",
    "arrêt": "traffic_node",
    "landmark": "landmark",
    "reperes": "landmark",
    "repères": "landmark",
    "intersection": "traffic_node",
}


def _features(document: dict[str, Any]) -> list[dict[str, Any]]:
    if document.get("type") == "Feature":
        return [document]
    if document.get("type") == "FeatureCollection":
        return [item for item in document.get("features") or [] if isinstance(item, dict)]
    return []


def _kind(properties: dict[str, Any], geometry_type: str) -> str | None:
    raw = str(properties.get("srbc_kind") or properties.get("kind") or "").strip().lower()
    if raw in KIND_ALIASES:
        return KIND_ALIASES[raw]
    if raw in ZONE_KINDS or raw in ZONE_ALIASES:
        return "zone"
    if raw in {"measure", "circle"} or properties.get("landmark_kind"):
        return "landmark"
    if geometry_type == "Polygon":
        zone_raw = str(properties.get("zone_kind") or properties.get("zoneKind") or "").strip()
        if zone_raw:
            return "zone"
        return "field"
    if geometry_type in {"LineString", "MultiLineString"}:
        return "guidance_line"
    if geometry_type in {"Point", "MultiPoint"}:
        return "obstacle"
    return None


def import_geojson(
    repository: FieldRepository,
    document: dict[str, Any],
    name: str | None = None,
    author: str | None = None,
) -> dict[str, Any]:
    features = _features(document)
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    field = None
    created = {
        "zones": 0,
        "obstacles": 0,
        "guidance_lines": 0,
        "rows": 0,
        "traffic_ways": 0,
        "traffic_nodes": 0,
        "landmarks": 0,
    }

    pending: list[tuple[int, dict[str, Any], dict[str, Any], str]] = []
    for index, feature in enumerate(features):
        geometry = feature.get("geometry")
        properties = feature.get("properties") or {}
        if not isinstance(geometry, dict) or not geometry.get("type"):
            errors.append({"index": index, "reason": "missing geometry"})
            continue
        geometry_type = str(geometry["type"])
        if geometry_type.startswith("Multi"):
            errors.append({"index": index, "reason": f"unsupported geometry type {geometry_type}"})
            continue
        kind = _kind(properties, geometry_type)
        if kind is None:
            errors.append({"index": index, "reason": f"cannot classify {geometry_type}"})
            continue
        pending.append((index, geometry, properties, kind))

    field_items = [item for item in pending if item[3] == "field"]
    if not field_items:
        errors.append({"index": None, "reason": "no field polygon in the collection"})
        return {"ok": False, "errors": errors, "warnings": warnings, "created": created}

    _index, geometry, properties, _kind_name = field_items[0]
    provenance = (
        properties.get("provenance") if isinstance(properties.get("provenance"), dict) else {}
    )
    if not provenance_qualified(provenance):
        warnings.append(
            {
                "index": field_items[0][0],
                "reason": "missing provenance; not qualified for autonomy",
            }
        )
    field_name = name or properties.get("name") or "Imported field"
    raw_id = properties.get("id")
    preserved_id = raw_id.strip() if isinstance(raw_id, str) and raw_id.strip() else None
    field = repository.create_field(
        name=str(field_name),
        geometry=geometry,
        campaign=properties.get("campaign"),
        provenance=provenance,
        author=author,
        field_id=preserved_id,
    )
    extra_fields = field_items[1:]
    for index, geometry, properties, _kind_name in extra_fields:
        repository.add_landmark(
            field["id"],
            kind="polygon",
            geometry=geometry,
            name=properties.get("name"),
            provenance=(
                properties.get("provenance")
                if isinstance(properties.get("provenance"), dict)
                else {}
            ),
        )
        created["landmarks"] += 1
        warnings.append({"index": index, "reason": "extra polygon stored as landmark"})

    pending_rows: list[tuple[int, dict[str, Any], dict[str, Any], str]] = []
    for index, geometry, properties, kind in pending:
        if kind == "field":
            continue
        provenance = (
            properties.get("provenance") if isinstance(properties.get("provenance"), dict) else {}
        )
        if not provenance_qualified(provenance):
            warnings.append(
                {"index": index, "reason": "missing provenance; not qualified for autonomy"}
            )
        try:
            if kind == "zone":
                zone_kind = canonical_zone_kind(
                    str(properties.get("zone_kind") or properties.get("kind") or "workable")
                )
                if zone_kind not in ZONE_KINDS:
                    errors.append({"index": index, "reason": f"unknown zone kind: {zone_kind}"})
                    continue
                repository.add_zone(
                    field["id"],
                    zone_kind,
                    geometry,
                    name=properties.get("name"),
                    provenance=provenance,
                    author=author,
                )
                created["zones"] += 1
            elif kind == "obstacle":
                repository.add_obstacle(
                    field["id"],
                    geometry,
                    category=str(properties.get("category") or "unspecified"),
                    name=properties.get("name"),
                    margin_m=float(properties.get("margin_m") or 0),
                    height_m=(
                        float(properties["height_m"])
                        if properties.get("height_m") is not None
                        else None
                    ),
                    valid_from=properties.get("valid_from"),
                    valid_until=properties.get("valid_until"),
                    crossable=bool(properties.get("crossable")),
                    provenance=provenance,
                    author=author,
                )
                created["obstacles"] += 1
            elif kind == "guidance_line":
                repository.add_guidance_line(
                    field["id"],
                    geometry,
                    name=properties.get("name"),
                    provenance=provenance,
                    author=author,
                )
                created["guidance_lines"] += 1
            elif kind == "row":
                pending_rows.append((index, geometry, properties, "rows"))
            elif kind == "bed":
                pending_rows.append((index, geometry, properties, "beds"))
            elif kind == "traffic_way":
                way_kind = str(properties.get("way_kind") or properties.get("kind") or "path")
                if way_kind not in TRAFFIC_WAY_KINDS:
                    way_kind = "path"
                repository.add_traffic_way(
                    field["id"],
                    geometry,
                    name=properties.get("name"),
                    kind=way_kind,
                    oneway=bool(properties.get("oneway")),
                    speed_mps=(
                        float(properties["speed_mps"])
                        if properties.get("speed_mps") is not None
                        and properties.get("speed_mps") != ""
                        else None
                    ),
                    width_m=properties.get("width_m"),
                    provenance=provenance,
                    author=author,
                )
                created["traffic_ways"] += 1
            elif kind == "traffic_node":
                repository.add_traffic_node(
                    field["id"],
                    geometry,
                    name=properties.get("name"),
                    kind=canonical_traffic_node_kind(
                        str(properties.get("node_kind") or properties.get("kind") or "gate")
                    ),
                    provenance=provenance,
                    author=author,
                )
                created["traffic_nodes"] += 1
            elif kind == "landmark":
                landmark_kind = str(properties.get("landmark_kind") or properties.get("kind") or "")
                if landmark_kind not in {"measure", "circle", "polygon", "point"}:
                    geom_type = str(geometry.get("type") or "")
                    if geom_type == "Point":
                        landmark_kind = "point"
                    elif geom_type == "LineString":
                        landmark_kind = "measure"
                    else:
                        landmark_kind = "polygon"
                repository.add_landmark(
                    field["id"],
                    kind=landmark_kind,
                    geometry=geometry,
                    name=properties.get("name"),
                    radius_m=properties.get("radius_m"),
                    provenance=provenance,
                )
                created["landmarks"] += 1
        except (ValueError, KeyError, TypeError) as exc:
            errors.append({"index": index, "reason": str(exc)})

    if pending_rows:
        grouped: dict[str, list[tuple[int, dict[str, Any], dict[str, Any], str]]] = {}
        for item in pending_rows:
            grouped.setdefault(item[3], []).append(item)
        try:
            for set_kind, items in grouped.items():
                repository.create_row_set(
                    field["id"],
                    rows=[
                        {
                            "number": int(properties.get("number") or (index + 1)),
                            "name": properties.get("name"),
                            "geometry": geometry,
                        }
                        for index, (_feature_index, geometry, properties, _set_kind) in enumerate(
                            items
                        )
                    ],
                    name="Imported beds" if set_kind == "beds" else "Imported rows",
                    kind=set_kind,
                    spacing_m=2.5,
                    author=author,
                )
            created["rows"] = len(pending_rows)
        except (ValueError, KeyError, TypeError) as exc:
            errors.append({"index": None, "reason": str(exc)})

    return {
        "ok": True,
        "field": repository.get_field(field["id"]),
        "created": created,
        "errors": errors,
        "warnings": warnings,
    }


def export_geojson(field: dict[str, Any]) -> dict[str, Any]:
    features: list[dict[str, Any]] = [
        {
            "type": "Feature",
            "properties": {
                "srbc_kind": "field",
                "kind": "field",
                "name": field.get("name"),
                "id": field.get("id"),
                "campaign": field.get("campaign"),
                "provenance": field.get("provenance"),
                "qualified_for_autonomy": field.get("qualified_for_autonomy"),
            },
            "geometry": field.get("geometry"),
        }
    ]
    for zone in field.get("zones") or []:
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "srbc_kind": "zone",
                    "zone_kind": zone.get("kind"),
                    "name": zone.get("name"),
                    "id": zone.get("id"),
                },
                "geometry": zone.get("geometry"),
            }
        )
    for obstacle in field.get("obstacles") or []:
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "srbc_kind": "obstacle",
                    "category": obstacle.get("category"),
                    "name": obstacle.get("name"),
                    "id": obstacle.get("id"),
                    "crossable": obstacle.get("crossable"),
                },
                "geometry": obstacle.get("geometry"),
            }
        )
    for line in field.get("guidance_lines") or []:
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "srbc_kind": "guidance_line",
                    "name": line.get("name"),
                    "id": line.get("id"),
                },
                "geometry": line.get("geometry"),
            }
        )
    for row_set in field.get("row_sets") or []:
        for item in row_set.get("rows") or []:
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "srbc_kind": "bed" if (row_set.get("kind") == "beds") else "row",
                        "name": item.get("name"),
                        "id": item.get("id"),
                        "number": item.get("number"),
                        "row_set_id": row_set.get("id"),
                    },
                    "geometry": item.get("geometry"),
                }
            )
    for way in field.get("traffic_ways") or []:
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "srbc_kind": "traffic_way",
                    "name": way.get("name"),
                    "id": way.get("id"),
                    "kind": way.get("kind"),
                    "oneway": way.get("oneway"),
                    "speed_mps": way.get("speed_mps"),
                    "width_m": way.get("width_m"),
                },
                "geometry": way.get("geometry"),
            }
        )
    for node in field.get("traffic_nodes") or []:
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "srbc_kind": "traffic_node",
                    "name": node.get("name"),
                    "id": node.get("id"),
                    "kind": node.get("kind"),
                },
                "geometry": node.get("geometry"),
            }
        )
    for landmark in field.get("landmarks") or []:
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "srbc_kind": "landmark",
                    "landmark_kind": landmark.get("kind"),
                    "name": landmark.get("name"),
                    "id": landmark.get("id"),
                    "radius_m": landmark.get("radius_m"),
                },
                "geometry": landmark.get("geometry"),
            }
        )
    return {"type": "FeatureCollection", "features": features}
