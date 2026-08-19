# Architecture — Mission Studio

Strangler fig around the public core. The legacy editor stays the default until
the v2 shell reaches functional parity (end of L9).

```
UI (React, /studio) → domain TS (from L4) → Agri v3 projection
UI (legacy, /app)   → TrajectoryEditor.js  → Agri v3
                          ↑
               API /api/trajectories (http.server, or FastAPI if BACKEND_FASTAPI)
```

`BACKEND_FASTAPI` (default false) switches only the HTTP transport. Same
`EditorRuntime`, same plugin `register_route`, same `/api/trajectories*`.
When FastAPI is on, `EditorRuntime` also opens SQLite (`backend/data/studio.sqlite`,
overridable with `SQLITE_PATH`) and starts the job worker. `http.server` does
not create that file.

Versioned surface (`/api/v1/`):

| Path | Role |
| ---- | ---- |
| `GET /health` | `{ok, backend, sqlite, jobs}` |
| `POST/GET /jobs`, `GET /jobs/{id}` | Local queue; kind `echo` only in this cut |
| `/fields*` | Catalogue `Field` / `Zone` / `Obstacle` / `GuidanceLine`, versions, impact, GeoJSON import/export |
| `/equipment*` | Catalogue `Vehicle` / `Implement` / `Combination` (L7a), enveloppe, `srbc_equipment` |

Agri v3 files under `backend/uploads/` stay the robot export. The field catalogue is a separate store. Format evolution (no v4): `docs/AGRI_FORMAT_EVOLUTION.md`.

## Two shells

| URL              | When                          | What                                                 |
| ---------------- | ----------------------------- | ---------------------------------------------------- |
| `/app`           | default (`UI_SHELL_V2=false`) | Legacy Jinja + Leaflet editor. iOS WebView contract. |
| `/app?ui=v2`     | explicit query                | Mission Studio shell, no `.env` change required      |
| `/app?ui=legacy` | explicit query                | Force legacy even if `UI_SHELL_V2=true`              |
| `/studio`        | always                        | Mission Studio shell (SPA, basename `/studio`)       |

Query parameters win over the environment because `Settings` loads `.env` with
`override=True`.

## Invariants preserved by both shells

- `#pluginHeaderActions`
- `window.custom_plugins` (`js/core/plugins.js`)
- Jinja slots `plugin_head_scripts`, `plugin_body_pre`, `plugin_header_extra_buttons`, `plugin_body_scripts`
- `window.setLanguage(lang)` + `js/core/i18n.js`
- `trajectoryEditorMapConfig` / `trajectoryEditorUiConfig`

The v2 app bar relocates `#pluginHeaderActions` into the header without
destroying the node, so plugin-injected buttons keep their listeners.

## Frontend

Source: `frontend/`. Build: `npm run build` → `public/studio/assets/studio.{js,css}`
plus self-hosted Inter under `public/studio/assets/fonts/` (gitignored).
Dev: `npm run dev` (Vite on 5173, API proxied to 3000).

Design system (L2): tokens and primitives in `frontend/src/design-system/`,
catalogue at `/studio/design-system`, mapping in `docs/DESIGN_SYSTEM.md`.

Map canvas (L3 first cut): `frontend/src/map/`. `/studio` always mounts a
MapLibre adapter (`createMapLibreEngine`) behind the `MapEngine` interface.
`/app` stays on Leaflet. The `MAP_ENGINE` flag remains `"leaflet"` so existing
Python tests and the legacy shell are unchanged.

| Piece                | Role                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `agri-to-geojson.ts` | Agri v3 → GeoJSON, same planar origin as `GeometryUtils.localToLatLng` |
| `styles.ts`          | CdCF §5.2 tokens, Carto Positron / Esri / OpenTopoMap                  |
| `maplibre-engine.ts` | Raster basemaps, mission sources, satellite halo, draft vertices       |
| `LayersPopover.tsx`  | 320 px layer picker (trajectories, parcels, zones, obstacles live; rest greyed) |
| `EditToolbar.tsx`    | Select (`MousePointer2` / `Lasso`), line, fill parcel, geofence, working zone, cut, reverse/delete, undo/redo |

Studio can mutate a mission: draw line / fill parcel → `row_line` (vertices only,
no 0.1 m densify), geofence polygon, `working_zone` 0/1, delete-points-in-polygon,
select sections (click or polygon; reverse / delete). Autosave writes
`/api/trajectories`. `/app` still densifies `row_path`.

Domain (L4):

| Module                                | Role                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `frontend/src/domain/geometry.ts`     | Port of `GeometryUtils.js` + `pointInPolygon`, 0.1 m densify, lateral offset                   |
| `frontend/src/domain/agri.ts`         | Agri v3 document types, clone, reverse, reorder, caps 50k / 1M                                 |
| `frontend/src/domain/section.ts`      | Densify `row_line`, extend, split after delete, move, rotate, offset duplicate, draw-line path |
| `frontend/src/domain/coverage.ts`     | Parallel rows (legacy sweep) as `row_line` for Studio fill-parcel                              |
| `frontend/src/domain/working-zone.ts` | `working_zone` 0/1 inside a local polygon                                                      |
| `frontend/src/domain/turns.ts`        | U-turn / square / corkscrew / loop; Studio keeps rows as `row_line`                            |
| `frontend/src/domain/speed.ts`        | Unique speed read + apply to every point with a `speed` column                                 |
| `frontend/src/domain/selection.ts`    | Click / polygon hit-test (vertex or segment), reverse, delete selected                         |
| `frontend/src/store/commands.ts`      | Undo **and** redo, 100 snapshots, 800 ms autosave helper                                       |

`/app` still uses `TrajectoryEditor.js`. Studio fill-parcel uses `row_line`; `/app` still densifies.

## Flags

See `backend/config/flags.py` and the roadmap §9. A flag at `false` must have
no observable effect.
