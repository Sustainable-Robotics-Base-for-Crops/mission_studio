"""Typed field catalogue (CdCF §8.2). Agri v3 remains the robot export, not this store."""

from __future__ import annotations

ZONE_KINDS = (
    "agronomic_boundary",
    "workable",
    "traversable",
    "forbidden",
    "autonomy",
    "headland",
    "gnss_degraded",
)

ZONE_ALIASES = {
    "agronomic_boundary": "agronomic_boundary",
    "limite_agronomique": "agronomic_boundary",
    "workable": "workable",
    "travaillable": "workable",
    "traversable": "traversable",
    "forbidden": "forbidden",
    "interdite": "forbidden",
    "autonomy": "autonomy",
    "autonomie": "autonomy",
    "headland": "headland",
    "tournier": "headland",
    "tourniere": "headland",
    "tournière": "headland",
    "gnss_degraded": "gnss_degraded",
    "gnss_degrade": "gnss_degraded",
    "gnss degrade": "gnss_degraded",
    "gnss dégradé": "gnss_degraded",
}

FEATURE_KINDS = (
    "field",
    "zone",
    "obstacle",
    "guidance_line",
    "row",
    "bed",
    "traffic_way",
    "traffic_node",
)

TRAFFIC_WAY_KINDS = ("path",)
TRAFFIC_NODE_KINDS = ("gate", "service", "stop", "intersection")
TRAFFIC_NODE_ALIASES = {
    "gate": "gate",
    "porte": "gate",
    "service": "service",
    "stop": "stop",
    "arret": "stop",
    "arrêt": "stop",
    "intersection": "intersection",
}


def canonical_traffic_node_kind(raw: str) -> str:
    token = raw.strip().lower()
    if token in {"traffic_node", "node", ""}:
        return "gate"
    return TRAFFIC_NODE_ALIASES.get(token, token)


def canonical_zone_kind(raw: str) -> str:
    """Map FR/EN aliases to a CdCF §8.2 kind, or return the stripped token."""
    token = raw.strip().lower()
    if token in {"zone", ""}:
        return "workable"
    return ZONE_ALIASES.get(token, token)
