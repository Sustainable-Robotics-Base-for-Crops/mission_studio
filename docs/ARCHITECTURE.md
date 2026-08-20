# Architecture — Mission Studio

Mission Studio enveloppe le cœur public historique sans le remplacer. Le shell React
est disponible sous `/studio`, tandis que `/app` conserve l’éditeur legacy et son
contrat WebView.

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

## Le dossier de ferme est la source de vérité

Depuis L13, le produit ouvre une ferme portable :

```text
<FARM_ROOT>/
  farm.json
  parcel_map/
  mission_order/
  work_performed/
  equipment/
  .studio/
```

Les fichiers sous `parcel_map/`, `mission_order/`, `work_performed/` et `equipment/`
sont les données métier. L’application ne doit jamais exiger une base SQLite pour
retrouver une ferme complète. La racine courante est amorcée par `FARM_ROOT`, puis par
`backend/data/app.json`.

Deux bases SQLite distinctes coexistent :

| Base | Schéma | Rôle | Portable avec la ferme |
|---|---:|---|---|
| `<FARM_ROOT>/.studio/index.sqlite` | 1 | Index dérivé des fichiers, checksums et métadonnées de mission | Oui, mais supprimable et régénérable |
| `backend/data/studio.sqlite` (`SQLITE_PATH`) | 7 | Catalogue applicatif, versions, matériel, publications et file de tâches | Non |

Supprimer `.studio/` ne supprime aucune donnée métier. `POST /api/v1/farm/reindex`
recrée l’index à partir des fichiers. Les lectures critiques savent retomber sur les
fichiers lorsque l’index n’existe pas.

Le contrat détaillé destiné aux intégrateurs est dans `docs/FARM_FOLDER.md`.

Versioned surface (`/api/v1/`):

| Path | Rôle |
|---|---|
| `GET /health` | État du backend, de SQLite, des jobs et de la ferme courante. |
| `POST/GET /jobs`, `GET /jobs/{id}` | File locale de travaux. |
| `/fields*` | Catalogue `Field` / `Zone` / `Obstacle` / `GuidanceLine`, versions, impact et GeoJSON. |
| `/equipment*` | Catalogue `Vehicle` / `Implement` / `Combination`, enveloppe et projection `srbc_equipment`. |
| `GET /farm` | Snapshot : `farm.json`, racine, compteurs, fermes récentes et pack cultural. |
| `PUT /farm` | Mise à jour validée des préférences de `farm.json`. |
| `POST /farm/create` | Création sûre dans un dossier neuf ou vide. |
| `POST /farm/open-existing` | Ouverture stricte d’un dossier contenant déjà `farm.json`. |
| `POST /farm/open` | Compatibilité : ouverture ou initialisation historique. |
| `POST /farm/pick-folder` | Sélecteur natif du dossier sur le poste serveur local. |
| `GET /farm/tree` | Inventaire des quatre dossiers métier. |
| `GET/PUT /farm/file` | Lecture d’un ordre ou travail réalisé ; écriture d’un ordre de mission. |
| `GET /farm/missions?field_id=…` | Missions et travaux d’une parcelle. |
| `POST /farm/reindex` | Reconstruction de `.studio/index.sqlite`. |

`backend/uploads/` reste le repli de l’éditeur legacy `/app`. Mission Studio utilise le
dossier de ferme ; aucune migration automatique des uploads n’est effectuée. L’évolution
du format (sans v4) est décrite dans `docs/AGRI_FORMAT_EVOLUTION.md`.

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
