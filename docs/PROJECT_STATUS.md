# Project status — October 2026

**Mission Studio works for field trials and personal use. It is not yet ready
for mass distribution.**

> **En bref (FR).** La chaîne complète fonctionne : ferme, parcelles, matériel,
> couverture, édition, simulation, publication d'un fichier JSON Agri v3 lu par
> le robot SRBC. Elle est couverte par des tests automatiques. Il reste à
> parfaire plusieurs fonctionnalités et, surtout, à mener un déploiement plus
> large auprès d'agriculteurs pour valider l'IHM, l'expérience utilisateur,
> l'offre commerciale (upsell) et le parcours métier, avant une diffusion
> massive.

## What works today

| Area | State |
|---|---|
| Farm folder | Portable folder (`farm.json`, `parcel_map/`, `mission_order/`, `work_performed/`, `equipment/`), see [`FARM_FOLDER.md`](FARM_FOLDER.md). Kept on the user's device: a real folder (Chrome / Edge), the browser store elsewhere, zip import and export. |
| Parcels | Drawing, editing, row and bed numbering, GeoJSON import. |
| Third-party files | Overlay import of Naïo, Raven, ISO XML, Shapefile, KML and GeoJSON files, see [`IMPORTS.md`](IMPORTS.md). Objects are not yet created from an imported file. |
| Equipment | 2D twin of the SRBC with mounted and trailed tools, combinations. |
| Coverage | Parallel passes with three compared headings and headlands; [Fields2Cover](https://github.com/Fields2Cover/Fields2Cover) when installed, see [`COVERAGE.md`](COVERAGE.md). |
| Expert editor | Mission tree, sections, turns, working zones, geofence, speed, undo / redo, autosave. |
| Simulation | Geometric check on declared data: footprint versus geofence, turning radius, gaps and overlaps, operating domain (ODD) rules. |
| Publication | Immutable versions with a SHA-256 checksum, exported as JSON Agri v3 for the robot navigation stack. |
| Crop packs | Open field, vineyard, market gardening; teach-and-repeat from a recorded track. |
| Quality | 434 Python tests and 563 JavaScript tests, run in CI on every push. |

## What still has to be polished

- **Inactive controls.** Meta-mission and multi-mission comparison are visible
  but disabled. Some internal labels and file jargon are still shown.
- **Robot loop.** Studio stops at the mission file: no direct handoff to the
  robot tablet, and no execution logs yet, so "executed" reports and worked
  hours stay empty.
- **Imports, phase two.** Creating parcels, rows and guidance lines from an
  imported file is specified in [`IMPORTS.md`](IMPORTS.md), not built.
- **Hosting.** The public-server mode (no state on the server, rate limits,
  upload caps, restricted CORS) is not done. Run Mission Studio locally.
- **First visit.** No sample farm and no guided tour yet.
- **Simulation depth.** Declared data only: no terrain model, live weather or
  RTK quality, no vehicle dynamics.
- **Accessibility and performance.** WCAG 2.2 AA is targeted but not audited
  end to end; tablet performance with large missions is not measured.
- **Legacy editor.** The compact editor (`/app`) still ships alongside the
  studio and has not been moved onto the new domain code.

## What a wider deployment must validate

The software was shaped with a small number of users. Before mass
distribution, a wider deployment on real farms has to answer:

1. **Interface (HMI).** Can a farmer find each tool without help, on a laptop
   and on a tablet, in the field?
2. **User experience.** Can a first mission be prepared in about ten minutes
   without training? Where do users hesitate or give up?
3. **Business workflow.** Does the order farm, parcel, equipment, mission,
   simulation, publication match how vineyards, market gardens and open-field
   farms actually plan their work?
4. **Upsell.** Which services on top of the open software (support, cloud
   sync, fleet supervision, advanced planning) are farmers ready to pay for?
5. **Feature set.** Which of the features above are used, which are missing,
   which should be removed?

Field feedback is the most useful contribution: open an issue describing the
farm, the crop, the machine and what blocked you.
