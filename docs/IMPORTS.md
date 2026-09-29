# Third-party file imports (L14)

A grower arrives with files from the machines already on the farm: a Naïo work
map, a Raven job export, a plain GeoJSON from a surveyor. Mission Studio reads
them, says what it understood, and draws them as an overlay to trace over.

**Phase one, shipped: an overlay and nothing else.** No field, no row, no
mission is created from an imported file. The layer is session-only, exactly
like a survey pole import: reloading the studio starts from an empty list and
nothing is written to the farm folder.

## Architecture

```
ImportFileButton (Mission / Parcellaire)
  → useFileImport            analyse, let the operator override, confirm
      → POST /api/v1/imports/preview?filename=…&adapter=…     (raw body)
          → backend/imports/registry     every dialect that claims the file
          → backend/imports/adapters/*   the chosen one normalises it
      → local GeoJSON fallback when /api/v1 is absent (legacy http.server)
  → useImportedLayers.addCollection      session overlay, MAP_STYLE.imported
```

The extension does not identify the file type, which is why the dialog has a
picker: GeoJSON, Shapefile, ISO XML, a field folder (text + KML) or a binary
map archive. Dialects inside one type (a work map versus a plain GeoJSON, a job
export versus a plain shapefile) are chosen automatically and are not listed.
The picker stays even when the chosen type refuses the file.

Between the picker and the figures, the dialog draws what the chosen dialect
read (`imports/ImportPreviewMap.tsx`): the geometries only, on a white
background. Scroll and drag zoom the frame. While smoothing is on, the
original trace stays as a dashed line under the result. Above 1 200 figures
the drawing keeps every n-th one and says so.

Parsing lives in Python. Shapefiles are binary, vendor archives hold several
members, and the studio already has FastAPI: pushing `shapefile-js` and
`jszip` into the bundle to redo that work in the browser would buy nothing.

## API

| Method | Path | Role |
|---|---|---|
| GET | `/api/v1/imports/adapters` | `{ adapters, max_bytes }` |
| POST | `/api/v1/imports/preview` | raw upload → candidates, report, collection |

The upload travels as the request body, not as a multipart form, so the core
needs no `python-multipart`. Limits: 8 MB per file, 20 000 figures per layer;
both are refused outright rather than truncated.

A refusal is `422` with a translatable key, never a sentence:

```json
{ "error": "imports.error.notRaven", "params": {} }
```

## Adapters shipped

| id | Vendor | Reads | Emits |
|---|---|---|---|
| `naio_workmap` | Naïo Technologies | WorkMap v4 GeoJSON | `row` |
| `raven_shapefile` | Raven (CNH) | job export `_0` + `_lpLines` | `coverage_cell`, `guidance_line` |
| `geojson_generic` | — | any FeatureCollection | declared kind, else `landmark` |
| `shapefile_generic` | — | any SHP or zipped set | `landmark` |
| `isoxml` | — | ISO 11783-10 XML or zip | `boundary`, `guidance_line` |
| `field_dossier` | — | text field folder or KML | `boundary`, `guidance_line` |
| `binary_map` | — | zip of binary shape rings | `boundary`, `guidance_line` |
| `work_performed` | — | Agri JSON work performed | `track` |

Vendor dialects outrank the generic readers of the same extension, so a Naïo
file is read as a work map unless the operator says otherwise.

### What the adapters refuse to guess

A figure whose nature is not declared becomes a **landmark**, the same rule the
parcel importer follows. In particular:

- Neither vendor file carries a field limit, and both reports say so.
- Raven as-applied footprints describe work performed, not a boundary. Four
  hundred two-square-metre cells are not a parcel outline.
- A Naïo work map declares no owner in the layer: the `metadata.owner` email is
  dropped before the features reach the browser.

## Adding a dialect

1. Write `backend/imports/adapters/<vendor>_<format>.py` exposing `ADAPTER`,
   built from a `descriptor`, a `detect` and a `parse` (see
   `backend/imports/types.py`).
2. `detect` returns `None` when the file is not yours, or a `Detection` with a
   confidence: `0.9+` for a vendor signature, `~0.35` for a generic reader.
3. `parse` returns normalised features through `imported_feature(...)`, with an
   import kind from `backend/imports/vocabulary.py`. Vendor properties are kept
   verbatim under `srbc_import.source`; nothing is lost.
4. Report metrics and notices carry **i18n keys**, never prose. Add the French
   and English strings to `frontend/src/i18n/adapter.ts`.
5. Register the adapter in `backend/imports/registry.py`, ahead of the generic
   reader it specialises.
6. Add fixtures to `tests/python/test_imports_adapters.py`. Real vendor files
   live in a local gitignored folder, so tests build their own bytes.

## Phase two — creating objects from an imported file

The same dialog now offers two outcomes. **Add as an overlay** is unchanged.
**Convert the objects** writes a new mission (from the Mission menu), a new
parcel (from “create a parcel from a file”), or extra objects on the parcel
being edited. The operator picks whole families, one parcel when the file
holds several, and a smoothing factor from 0 % (shape kept, one point every
10 cm) to 100 % (Douglas-Peucker, 50 cm lateral tolerance). The recommended
setting is 40 % (20 cm). The preview is a zoomable map so the operator can
compare the original trace with the smoothed one.

The picker lists file types, not manufacturers: GeoJSON, Shapefile, ISO XML,
field folder (text + KML), map archive (binary shapes), and Agri work performed
(JSON). A work map and a job shapefile stay automatic dialects of GeoJSON and
Shapefile.

### Promotion targets

| Import kind | Target | Granularity |
|---|---|---|
| `boundary` | `catalogue.field` | one field per ring |
| `row` | `catalogue.row` | one row per line, inside a row set |
| `guidance_line` | `catalogue.guidance_line` | one line each |
| `obstacle` | `catalogue.obstacle` | one obstacle each |
| `landmark` | `catalogue.landmark` | one landmark each |
| `track` | `mission.row_path` | collective: one trajectory |
| `coverage_cell` | `agri.work_performed` | collective: one performed-work document |

### Intended behaviour

- **Two levels, as requested.** "Create the objects" adds selected figures to
  an existing field. "Create the field/mission" bootstraps the container first,
  then fills it. Both start from the layer already on screen, so the operator
  sees what they are promoting.
- **Selection before creation.** A promotion is a diff the operator approves
  kind by kind ("6 rangs", "8 lignes de guidage"), never a blind bulk import.
- **Provenance is mandatory.** Promoted objects must carry
  `provenance = {source: "import", method: "<adapter>", ...}`. Nothing imported
  can be `qualified_for_autonomy` without a declared accuracy: a vendor file
  states no `h_accuracy_m`, so the field stays unqualified until surveyed.
- **Geometry is cleaned, and the cleaning is declared.** A Naïo row starts with
  a sub-metre lead-in segment that is not part of the axis; the report already
  measures it (`imports.metric.leadIn`). Promotion has to drop it and say so.
- **A field limit is never invented.** No adapter emits `boundary` today, so
  "create the field" needs either a boundary in the file, or an explicit
  operator drawing. Deriving a parcel from a coverage lace is out of scope.
- **Collective promotions write one document.** Coverage cells become a single
  `work_performed` Agri file with `metadata.srbc_import`, not one object each.

### Open questions for that lot

- Where does a promoted row set land when the farm folder has no matching
  field: a new field, or a staging area?
- Does a second import of the same job update the previous promotion, or
  create a duplicate? The Raven `guid` and the Naïo `uuid` are kept in the
  report precisely so that this can be decided.
