# Design system — Mission Studio

Normative source: the SRBC UX specification for agricultural mission editors
(§4, kept outside this repository). The live catalogue is `/studio/design-system`. Tokens live in
`frontend/src/design-system/tokens.ts` and `tokens.css`.

This system applies to the React shell (`/studio`). The Leaflet editor
(`/app`) keeps its Material / Volcam look until a later theme flag.

## Tokens (exact)

| Token | Hex |
|---|---|
| `--bg-app` | `#F4F7F3` |
| `--surface` | `#FFFFFF` |
| `--surface-subtle` | `#F8FAF8` |
| `--surface-selected` | `#EAF7EE` |
| `--border` | `#D8E1D9` |
| `--border-strong` | `#AEBBAF` |
| `--text-primary` | `#17211B` |
| `--text-secondary` | `#526059` |
| `--text-muted` | `#758078` |
| `--primary-700` | `#166534` |
| `--primary-800` | `#14532D` |
| `--primary-900` | `#0F3D24` |
| `--primary-100` | `#DCFCE7` |
| `--focus` | `#2563EB` |
| planned | `#2563EB` |
| selected | `#7C3AED` |
| valid | `#15803D` |
| transit | `#64748B` |
| warning | `#B45309` |
| danger | `#B91C1C` |
| autonomy | `#0E7490` |

Spacing: 4 / 8 / 12 / 16 / 24 / 32 / 48 px. Radii: 8 (control) / 10 (panel) /
12 (modal) / 999 (status chips only). Focus ring: 2 px, offset 2 px, `--focus`.

## Type

Self-hosted **Inter Variable** (`@fontsource-variable/inter`, no Google CDN).
H1 24/32 600 · H2 20/28 600 · H3 16/24 600 · Body 14/20 · Label/Caption 12/16 500.
Numeric values use `font-variant-numeric: tabular-nums`.

## Icons

Lucide **0.544.0** (exact pin, not a range). `stroke-width: 2`. Sizes 20 / 18 / 16.
Mapping: `ICON_BY_FUNCTION` in `frontend/src/design-system/icons.ts` (CdCF §4.7).
Never distinguish a critical state by colour alone: icon + label (and a pattern
on the map, later).

**Exception produit — Matériel :** le CdCF prescrit `Tractor`, trop thermique.
Studio utilise `Machine` (roues égales + mât capteur). Fichier :
`frontend/src/design-system/Machine.tsx`.

## Primitives

Button (primary / secondary / ghost / destructive with confirm step), Input
(label above, unit, source, optional **i** help dialog, error + `CircleAlert`),
Select, Dialog, Popover, Accordion, Tabs, Tooltip (400 ms), Toast (5 s),
persistent Banner, status Chip.

Tactile (`pointer: coarse`): control height 48 px, hit targets ≥ 44 px.
`prefers-reduced-motion` disables transitions.

## Legacy Leaflet → Mission Studio

The current `/app` theme is defined in `public/css/base/variables.css`.
Do not copy those values into the v2 shell.

| Legacy | Usage today | Studio token |
|---|---|---|
| `#2B2B2B` `--trajectory-dark-gray` | chrome, headers | `--text-primary` `#17211B` |
| `#424242` `--trajectory-gray` | secondary chrome | `--text-secondary` `#526059` |
| `#D49154` `--trajectory-primary` (Volcam orange) | brand, search, CTAs | **retired as brand** — actions use `--primary-700` `#166534` ; remaining amber meaning is `--color-warning` `#B45309` (tournière, attention) |
| `#4CAF50` `--trajectory-green` | Material green | `--color-valid` `#15803D` (written status, not colour alone) |
| `#2196F3` `--trajectory-blue` | Material blue | `--color-planned` `#2563EB` |
| `#FF9800` `--trajectory-orange` | Material orange | `--color-warning` `#B45309` |
| `#F44336` `--trajectory-red` | Material red | `--color-danger` `#B91C1C` |
| `#ECF0F1` / `#BDC3C7` | light text on dark UI | `--text-primary` / `--text-muted` on a light canvas |
| Google Material Icons (`<i class="material-icons">`) | sidebar, dialogs, lists | Lucide §4.7 (`House`, `Route`, `Undo2`, …) |
| `Inter` loaded from a system/CDN stack | body | `@fontsource-variable/inter` bundled under `public/studio/assets/fonts/` |

The Leaflet editor must keep Material Icons until its own lot rewrites those
templates. Mixing the two palettes on `/studio` is a defect.
