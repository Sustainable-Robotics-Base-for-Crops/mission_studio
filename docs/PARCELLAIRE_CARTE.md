# Parcellaire — symbologie et calques (Studio)

Norme : CdCF UX §5.2 / §5.3 / §4 (jamais une couleur seule).
Code : `frontend/src/map/catalogue-style.ts` + overlay SVG `svg-cat-*` (un chemin par objet).
Les couches MapLibre `catalogue-*` restent une source GeoJSON (fit / futur pick), pas le rendu visible.

## Objets et calques

| Objet SQLite | `properties.kind` | Calque `Couches` | Rôle |
|---|---|---|---|
| `Field` | `field` | **Parcelles / géofence** | Limite culturale. Contour prioritaire, fill très léger. |
| `Zone` | `agronomic_boundary` | **Zones** | Limite agronomique interne. Contour seul. |
| `Zone` | `workable` | **Zones** | Outil actif. Vert `#15803D`, fill 12 %. |
| `Zone` | `traversable` | **Zones** | Passage sans travail. `#64748B`, fill 10 %, trait pointillé. |
| `Zone` | `autonomy` | **Zones** | ODD / autonomie. Cyan `#0E7490`, fill 10 %. |
| `Zone` | `forbidden` | **Zones** | Ni travail ni transit. `#B91C1C`, fill 12 % + hachures. |
| `Zone` | `headland` | **Zones** | Tournière. Ambre `#B45309`, fill 10 %. |
| `Obstacle` | `obstacle` | **Obstacles** | Rouge foncé `#7F1D1D`, fill 18 %. |
| `Row` | `row` | **Rangs / planches** | Brun `#78350F`, 1.5 px, pas de fill (vigne). |
| `Bed` | `bed` | **Rangs / planches** | Ocre `#B45309`, fill 22 %, contour brun (maraîchage). |
| `GuidanceLine` | `guidance_line` | **Guidage** | Gris bleuté `#5B7C99`, 1.5 px, pas de fill. |
| `TrafficWay` | `traffic_way` | **Circulation** | Teal `#0F766E`, 2 px, pointillé `[4, 3]`. |
| `TrafficNode` | `traffic_node` | **Circulation** | Disque teal `#0F766E` (porte / service / arrêt / intersection). |

Un objet n’apparaît que si **son** calque est allumé. Désactiver « Zones »
masque toutes les zones, pas les parcelles. Même règle pour les obstacles,
les rangs et le guidage. Désactiver « Circulation » masque chemins et points.

Les calques encore en lot (enveloppes, pentes, …) restent grisés.

## Hiérarchie visuelle

1. Parcelle = cadre (vert foncé, fill ≤ 6 %).
2. Zones = surfaces colorées **à l’intérieur** (jamais le même vert que la parcelle).
3. Obstacle = plus saturé, au-dessus des zones.
4. Rangs permanents = traits bruns ; planches = bandes ocre (fill), au-dessus des polygones de zone.
5. Ligne de guidage = trait seul, **au-dessus des rangs** (gris bleuté, 1.5 px).
6. Circulation = chemins teal pointillés et points (portes / services), **au-dessus du guidage**.
7. Sélection = halo jaune Studio (même langage que les sections de mission).
8. Satellite : halo blanc 1–2 px sur les contours.

Couleur **et** motif : pointillés (traversable), hachures (interdit). Le type
reste aussi dans l’inspecteur / la légende du popover.

## Libellés carte

Calque **Libellés** (`labels`) dans Couches, **allumé par défaut**. Ce n’est pas
une exigence MAP-xxx dédiée : le CdCF UX §4.3 prévoit seulement le token
« Caption carte » (12/16 px, graisse 500) ; le nom vivait jusqu’ici dans
l’inspecteur. Un opérateur de flotte / charges a besoin du nom **sur** la carte.

Règles :

- Un libellé n’apparaît que si **le calque de l’objet est aussi allumé**
  (éteindre « Rangs / planches » masque aussi « Rang 12 »). Éteindre « Libellés »
  masque tous les textes, pas les géométries.
- Parcelle, chemin, porte/service, zone ou obstacle **nommés**, ligne AB nommée :
  le `name` utilisateur. Un fallback de type (`gate`, `path`, `guidance`) n’est
  **pas** affiché.
- Rang / planche : `name` s’il existe (générateur : « Rang 12 », « Planche 3 »),
  sinon le numéro. Affichés seulement à partir du zoom **18** pour ne pas noyer
  une parcelle de 80–200 rangs.
- Style : Caption carte, halo blanc (lisible sur satellite), `pointer-events: none`.
- Collision MapLibre `symbol` : plus tard si les textes se marchent dessus.

## Carte — règles d’édition

- Valider un polygone **ou une ligne AB** **ne recadre pas** la vue.
- Guidage (onglet) : polyligne ≥ 2 points, rattachée à la parcelle sélectionnée.
  Nom = famille MAP-010 (une ligne nommée ; regroupement ultérieur).
- Un objet validé reste visible tout de suite (pas d’effacement du brouillon
  avant qu’il soit dans le catalogue).
- **Réédition** : bouton **Modifier le tracé** dans l’inspecteur (chemin CdCF :
  pas de double-clic obligatoire). Raccourcis : double-clic dans l’arbre, ou
  double-clic carte avec l’outil sélection. Sommets déplaçables, clic sur un
  segment pour en insérer un, coche pour enregistrer (PATCH géométrie), Échap
  annule. L’objet catalogue est masqué pendant l’édition pour éviter le doublon.
- Clic carte : une ligne (guidage, rang **ou** chemin) ou un point de circulation
  à moins de ~12 m gagne (le plus proche) ; sinon le **plus petit** polygone
  contenant le point (obstacle > zone > parcelle). L’inspecteur affiche **son**
  type, pas toujours « Parcelle ».
- Onglet **Rangs / planches** : pas de tracé polygone. **Rangs** = LineString depuis
  AB + entraxe. **Planches** = polygones largeur + passe-pied, bouton **18 planches type**.
  Ce n’est **pas** une mission Agri (`row_line`) — L8 plus tard.
- Onglet **Circulation du site** : chemins (LineString) et points nommés
  (porte / service / arrêt / intersection). Première coupe MAP-013 : géométrie
  persistée, pas encore de graphe (sens/vitesses = métadonnées, pas de
  connectivité par gabarit).
- Les onglets Zones / Obstacles / Guidage / Rangs / Circulation listent les objets de la parcelle sélectionnée.
- Les zones et obstacles de **toutes** les parcelles restent affichés, pas
  seulement ceux de la parcelle sélectionnée.
- Le catalogue reste sur la carte en quittant Parcellaire (Missions, etc.) :
  **visible, lecture seule**. Pas de sélection, pas de double-clic, pas de
  modification de tracé. Un brouillon d’édition en cours est abandonné
  (pas de PATCH). Halo et outils d’édition : uniquement `/parcellaire`.
- Un seul chemin SVG pour tout le catalogue est interdit (fill evenodd =
  trou / clignotement). Rendu = **un path SVG par objet**, couleurs §5.2,
  masqué si son calque Couches est éteint.

## Popover Couches

Œil + nom + pastille de légende. `zones`, `obstacles`, `rows`, `guidance`,
`traffic` et `labels` sont actifs.
Default : parcelles, zones, obstacles, rangs, guidage, circulation, libellés et
trajectoires **allumés**.
