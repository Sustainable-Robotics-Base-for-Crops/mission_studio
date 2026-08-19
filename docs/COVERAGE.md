# Coverage engine (L8)

JSON Agri remains the public contract. Fields2Cover is an optional **planner**
behind FastAPI. The robot (`json_agri_format_parser` → `nav_*`) never depends
on Fields2Cover.

## Architecture

```
Studio /api/v1/coverage/plan
  → backend/coverage (Apache-2.0)
      ├─ Fields2Cover 2.x if `import fields2cover` succeeds (BSD-3)
      ├─ parallel sweep fallback (same geometry as Studio domain/coverage.ts)
      ├─ headland inset + contour laps (no GEOS)
      └─ row_set complement (L6 permanent rows — never a boustrophedon on vines)
  → Agri v3
      ├─ interior: row_line (2 vertices, working_zone 1)
      └─ fourrières: densified row_path
  → metadata.srbc_coverage (metrics only — variant geometries stay in the HTTP body)
```

No WASM. No Dubins / F2C path planner in this cut: turns stay Studio
`turn_square` / `turn_path` (`nav_turn`). Headlands default to **0 m**
(L8a behaviour). Pivot chenilles after fill is optional (on by default
for skid-steer).

The **Missions** module (`/studio/missions`) runs the 7-step assistant
(CdCF §8.5). Generate calls this API from the catalogue polygon (or
`row_set_id`) and writes `metadata.srbc_mission_brief` plus the coverage
geometry. `/app` is unchanged.

## API

| Method | Path | Role |
|---|---|---|
| GET | `/api/v1/coverage/engine` | `{ engine, fields2cover, strategies }` |
| POST | `/api/v1/coverage/plan` | polygon or `field_id`+`row_set_id` → sections |

Body (polygon):

```json
{
  "ring": [{"lat": 45.85, "lng": 3.17}, "..."],
  "origin": {"lat": 45.85, "lon": 3.17},
  "working_width_m": 1.2,
  "vehicle_width_m": 0.6,
  "headland_width_m": 4,
  "strategy": "boustrophedon",
  "variants": true
}
```

`strategy`: `boustrophedon` | `perpendicular` | `best_nswath` | `snake`.

When `variants` is true the response includes three interior plans
(`variants[].sections`) plus shared `headland_sections`. Persist only
`srbc_coverage` (counts / lengths / heading) — do not copy variant
geometries into Agri metadata.

Vineyard / beds: pass `field_id` + `row_set_id` instead of a ring. That walks
the catalogue rows; it does **not** run Fields2Cover; `headland_sections` is
empty (permanent rows already exist).

## Install Fields2Cover (optional)

The library is **not on PyPI**. Upstream only documents Ubuntu 18.04–22.04
builds (CMake + SWIG + GDAL + GEOS + OR-Tools). After `sudo make install`:

```bash
python -c "import fields2cover"
```

Until that import works, the API uses `parallel_fallback` (convex / simple
polygons, **holes ignored**). Islands need Fields2Cover 2.x. Concave insets
that fail fall back to covering the full polygon (note in `srbc_coverage`).

Do not vendor F2C into `srbc.repos` navigation packages.

## Licence

See `NOTICE`. Wrapper Apache-2.0; Fields2Cover BSD-3-Clause; GEOS LGPL-2.1
via dynamic link only.
