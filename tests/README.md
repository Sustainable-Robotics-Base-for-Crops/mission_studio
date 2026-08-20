# Tests — safety net for the Agri v3 contract

This suite exists for one reason: the editor produces the file the robot
executes. Before the internals are refactored, the behaviour that reaches
`json_agri_format_parser` has to be pinned so that a regression is loud
instead of silent.

## Running everything

```bash
./scripts/check.sh            # Python + JavaScript + smoke
./scripts/check.sh python     # ruff, pytest, smoke
./scripts/check.sh js         # eslint, prettier, vitest
```

## First-time setup

```bash
# Python 3.12 is required (the code uses `str | None` syntax)
/opt/homebrew/bin/python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt

# Node 22 for the JavaScript tests
npm install
```

## Individual commands

```bash
.venv/bin/python -m pytest                              # Python tests
.venv/bin/python -m pytest --cov=backend                # with coverage
.venv/bin/python scripts/smoke_server.py                # server boots and serves
npx vitest                                              # JavaScript, watch mode
npx vitest run                                          # JavaScript, once
.venv/bin/python -m ruff check .                        # Python lint
npx eslint .                                            # JavaScript lint
```

## What is covered

| Test file                                | Guards                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `python/test_agri_schema_conformance.py` | Every fixture is accepted by the Agri v3 schema; section types known to the navigation stack; column alignment; binary `working_zone`; speed bounds; geofence shape |
| `python/test_agri_projection_golden.py`  | The projection to Agri v3 is deterministic, idempotent and byte-stable, with a pinned canonical key order                                                           |
| `python/test_trajectory_model.py`        | Model defaults, accepted file types and versions, origin bounds, plus the two known inconsistencies                                                                 |
| `python/test_validation_service.py`      | Save-time schema enforcement, opt-in behaviour, content and numeric validation, path traversal, upload limits                                                       |
| `python/test_legacy_format_migration.py` | Pre-v3 `sections[]` files still open; save path layout; save/load round trip; listing structure                                                                     |
| `js/domain-geometry.test.ts`             | L4 `geometry.ts` bit-for-bit vs `GeometryUtils.js`                                                                                                                  |
| `js/domain-section.test.ts`              | L4 sections / working-zone / speed vs `TrajectoryEditor.js`                                                                                                         |
| `js/domain-draft.test.ts`                | Draw-line append, origin 2 decimals, densify 0.1 m                                                                                                                  |
| `js/command-stack.test.ts`               | Undo/redo 100 snapshots, autosave 800 ms                                                                                                                            |
| `js/studio-shell.test.ts`                | 9 rail entries, Lucide mapping, breakpoints, palette filter                                                                                                         |
| `js/i18n-adapter.test.ts`                | FR/EN shell catalogue, fallback to the key                                                                                                                          |
| `js/design-system.test.tsx`              | CdCF palette, Lucide pin 0.544.0, axe-core on `/design-system`                                                                                                      |
| `python/test_feature_flags.py`           | `UI_SHELL_V2` default false, query overrides env                                                                                                                    |
| `python/test_studio_shell.py`            | both HTML shells keep plugin and native anchors                                                                                                                     |
| `scripts/smoke_server.py`                | `/app` legacy, `/studio`, `/studio/design-system` and `/app?ui=v2`                                                                                                  |

## Golden fixtures

In `tests/golden/`. Regenerate with:

```bash
.venv/bin/python scripts/build_golden_fixtures.py \
    --real-mission /path/to/a/real/mission.json \
    --reference ../json_agri_format_parser/json/default.json
```

| Fixture                               | Origin                                              | Why it exists                                                         |
| ------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| `real_mission_5col.v3.json`           | Field trial, 3 sections, 328 points                 | The five-column layout with `punctual` that the editor produces today |
| `real_mission_4col_excerpt.v3.json`   | Excerpt of the parser reference mission, 6 sections | The four-column layout without `punctual`, still in the wild          |
| `synthetic_minimal.v3.json`           | Written by the script                               | Smallest document the schema accepts, no geofence                     |
| `synthetic_single_point.v3.json`      | Written by the script                               | Degenerate geometry: a section reduced to one point                   |
| `synthetic_empty_section.v3.json`     | Written by the script                               | Empty section, must not be silently dropped                           |
| `synthetic_all_section_types.v3.json` | Written by the script                               | All four section types, a transit section and a geofence              |
| `legacy_sections_format.json`         | Written by the script                               | Pre-v3 layout, migrated on read                                       |

The generator refuses to write a real trajectory whose WGS84 origin is more
precise than two decimals, so a committed fixture cannot disclose a field
location.

## Agri schema

`tests/schema/Agri.json` is a copy of
`../json_agri_format_parser/schema/Agri.json`, so the suite runs without the
sibling repository checked out. When that repository _is_ present,
`test_vendored_schema_matches_sibling_checkout` fails if the two have diverged —
refresh the copy and re-run.

## Scope of the linters

`ruff check` runs on the whole repository with a narrow rule set: real defects
only. Cosmetic and modernisation families (`W`, `UP`, `C4`) and
`ruff format` are limited to `tests/` and `scripts/`, because reformatting the
pre-existing application would bury a review under a cosmetic rewrite. Both are
widened during the domain refactor, when those files are rewritten anyway.

`eslint` covers `tests/js/` and `frontend/src/`. The 11k lines under
`public/js` stay excluded until L4.

## Findings recorded, not fixed

Behaviours discovered while writing these tests. They are pinned by a test so
that changing them later is a deliberate act, not an accident.

| Finding                                                                                     | Where                                                              | Note                                                                                                                                         |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Versions `2.0` and `2.1` are declared supported but rejected by the model                   | `constants.SUPPORTED_TRAJECTORY_VERSIONS` vs `Trajectory.validate` | Same                                                                                                                                         |
| The upload size limit is 100 MB while the error message historically said 5 MB              | `constants.MAX_FILE_SIZE`                                          | Cosmetic                                                                                                                                     |
| The local `.env` is loaded with `override=True`, so it wins over real environment variables | `backend/config/settings.py`                                       | Blocks environment-based configuration in containers and CI; `scripts/smoke_server.py` works around it by passing the port to `run_server()` |
| Six dead imports and one unchained exception raise                                          | `pyproject.toml` per-file-ignores                                  | Listed there with their removal scheduled for the refactor                                                                                   |
