"""OEM SRBC preset. Footprint = production geofencing rectangle (verified)."""

from __future__ import annotations

import json

from backend.db import Database, utc_now

# Verified production footprint: srbc_config/config/nav/geofencing.yaml
OEM_VEHICLE_ID = "srbc-001"
OEM_IMPLEMENT_ID = "hoe-120"
OEM_COMBINATION_ID = "srbc-hoe"
OEM_TRAILER_ID = "trailer-140"
OEM_TRAILER_COMBINATION_ID = "srbc-trailer"

_OEM_SOURCES = json.dumps(
    {
        "length_m": "oem",
        "width_m": "oem",
        "kinematics": "oem",
        "mass_kg": "oem",
        "max_speed_mps": "oem",
        "min_turn_radius_m": "oem",
        "wheelbase_m": "oem",
        "nav_ref_x_m": "oem",
        "nav_ref_y_m": "oem",
        "hitch_x_m": "oem",
        "can_reverse": "oem",
    },
    ensure_ascii=False,
)

_IMPLEMENT_SOURCES = json.dumps(
    {
        "physical_width_m": "oem",
        "working_width_m": "oem",
        "length_m": "oem",
        "kind": "oem",
    },
    ensure_ascii=False,
)


_TRAILER_SOURCES = json.dumps(
    {
        "physical_width_m": "oem",
        "working_width_m": "oem",
        "length_m": "oem",
        "kind": "oem",
        "drawbar_length_m": "oem",
    },
    ensure_ascii=False,
)


def seed_oem_if_empty(database: Database) -> None:
    row = database.execute("SELECT COUNT(*) AS n FROM vehicles").fetchone()
    if row is not None and int(row["n"]) > 0:
        ensure_oem_trailer(database)
        return
    now = utc_now()
    database.execute(
        """
        INSERT INTO vehicles (
            id, name, kinematics, length_m, width_m, height_m, wheelbase_m,
            track_width_m, front_overhang_m, rear_overhang_m, mass_kg,
            max_speed_mps, min_turn_radius_m, can_reverse, nav_ref_x_m,
            nav_ref_y_m, hitch_x_m, hitch_y_m, ground_clearance_m, sources,
            origin, created_at, updated_at
        ) VALUES (
            ?, ?, 'skid_steer', 1.10, 0.60, NULL, 1.0,
            NULL, NULL, NULL, 250,
            1.0, 0, 1, 0, 0, -0.55, 0, NULL, ?,
            'oem', ?, ?
        )
        """,
        (OEM_VEHICLE_ID, "SRBC", _OEM_SOURCES, now, now),
    )
    database.execute(
        """
        INSERT INTO implements (
            id, name, kind, physical_width_m, working_width_m, length_m,
            offset_x_m, offset_y_m, work_point_x_m, work_point_y_m, sections,
            sources, origin, created_at, updated_at, drawbar_length_m
        ) VALUES (
            ?, ?, 'tool', 1.20, 1.20, 0.35,
            -0.40, 0, -0.40, 0, NULL,
            ?, 'oem', ?, ?, NULL
        )
        """,
        (OEM_IMPLEMENT_ID, "Binage 1,20 m", _IMPLEMENT_SOURCES, now, now),
    )
    database.execute(
        """
        INSERT INTO combinations (
            id, name, vehicle_id, implement_id, origin, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'oem', ?, ?)
        """,
        (OEM_COMBINATION_ID, "SRBC + binage", OEM_VEHICLE_ID, OEM_IMPLEMENT_ID, now, now),
    )
    ensure_oem_trailer(database)


def ensure_oem_trailer(database: Database) -> None:
    now = utc_now()
    existing = database.execute(
        "SELECT id FROM implements WHERE id = ?", (OEM_TRAILER_ID,)
    ).fetchone()
    if existing is None:
        database.execute(
            """
            INSERT INTO implements (
                id, name, kind, physical_width_m, working_width_m, length_m,
                offset_x_m, offset_y_m, work_point_x_m, work_point_y_m, sections,
                sources, origin, created_at, updated_at, drawbar_length_m
            ) VALUES (
                ?, ?, 'trailer', 1.40, 1.40, 1.80,
                0, 0, 0, 0, NULL,
                ?, 'oem', ?, ?, 1.50
            )
            """,
            (OEM_TRAILER_ID, "Remorque 1,40 m", _TRAILER_SOURCES, now, now),
        )
    combo = database.execute(
        "SELECT id FROM combinations WHERE id = ?", (OEM_TRAILER_COMBINATION_ID,)
    ).fetchone()
    if combo is not None:
        return
    vehicle = database.execute(
        "SELECT id FROM vehicles WHERE id = ?", (OEM_VEHICLE_ID,)
    ).fetchone()
    if vehicle is None:
        return
    database.execute(
        """
        INSERT INTO combinations (
            id, name, vehicle_id, implement_id, origin, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'oem', ?, ?)
        """,
        (
            OEM_TRAILER_COMBINATION_ID,
            "SRBC + remorque",
            OEM_VEHICLE_ID,
            OEM_TRAILER_ID,
            now,
            now,
        ),
    )
