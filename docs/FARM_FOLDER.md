# Dossier de ferme Mission Studio

Mission Studio travaille sur **une ferme à la fois**. Sa source de vérité est un dossier
portable, lisible sans le logiciel et destiné à être copié tel quel entre le poste de
préparation et le robot. Changer de dossier revient à changer de ferme.

## Arborescence

```text
<FARM_ROOT>/
├── farm.json
├── parcel_map/
│   └── <parcelle>.geojson
├── mission_order/
│   └── AAAA-MM-JJ_<parcelle>_<operation>.json
├── work_performed/
│   └── AAAA-MM-JJ_<parcelle>_<operation>.json
├── equipment/
│   ├── <materiel>.json
│   └── <materiel>.png
└── .studio/
    ├── index.sqlite
    └── cache/
```

| Entrée | Contenu et responsabilité |
|---|---|
| `farm.json` | Identité de la ferme et préférences d’interface. |
| `parcel_map/` | Une `FeatureCollection` GeoJSON par parcelle : emprise, zones, obstacles, rangs, guidage et circulation. |
| `mission_order/` | Ordres de mission JSON Agri v3, à plat, directement consommables par la chaîne robot. |
| `work_performed/` | Travaux réalisés JSON Agri v3 renvoyés par le robot. |
| `equipment/` | Descriptions simples de véhicules et d’outils au format `srbc.equipment/1`, avec PNG optionnel. |
| `.studio/` | Index et cache dérivés. Ce dossier peut être supprimé sans perdre de donnée métier. |

### Pourquoi `parcel_map/` contient-il du GeoJSON ?

`parcel_map` est le nom du `file_type` historique Agri et permet au robot de retrouver
le dossier sans table de traduction. Une parcelle Mission Studio porte toutefois plus
d’informations qu’un document Agri — zones typées, obstacles, rangs, lignes de guidage
et graphe de circulation. GeoJSON est mieux adapté, lisible par les SIG et réimportable.
Cette asymétrie de nom et de format est donc intentionnelle.

## Créer ou ouvrir une ferme

Dans **Administration**, choisir un dossier avec le sélecteur natif :

- **Ouvrir la ferme** exige un `farm.json` valide ;
- **Créer la ferme ici** exige un dossier neuf ou vide et un nom de ferme.

La création ajoute toute l’arborescence ci-dessus. Elle refuse un dossier non vide afin
de ne jamais déposer des fichiers Mission Studio au milieu de données existantes.

La racine courante est résolue dans cet ordre :

1. variable d’environnement `FARM_ROOT`, si elle est définie ;
2. `backend/data/app.json`, qui conserve la racine courante et cinq fermes récentes ;
3. aucune ferme ouverte.

`app.json` est un état d’amorçage local, pas une donnée portable de la ferme.

## Schéma `farm.json`

```json
{
  "schema": "srbc.farm/1",
  "name": "Ferme XY",
  "farm_type": "market_garden",
  "start_view": { "lat": 45.7772, "lon": 3.087, "zoom": 16 },
  "language": "fr",
  "theme": "light",
  "ui_mode": "basic",
  "units": "metric",
  "field_geofence_inset_cm": 25,
  "speed_color_low_kmh": 0.5,
  "speed_color_mid_kmh": 1.75,
  "speed_color_high_kmh": 3,
  "created_at": "2026-08-20T10:00:00Z",
  "updated_at": "2026-08-20T10:00:00Z"
}
```

| Champ | Valeurs | Effet |
|---|---|---|
| `schema` | `srbc.farm/1` | Version du contrat. |
| `name` | texte non vide | Nom présenté dans Mission Studio. |
| `farm_type` | `market_garden`, `vineyard`, `open_field`, `livestock`, `mixed` | Pack cultural proposé par défaut. |
| `start_view` | latitude `[-90, 90]`, longitude `[-180, 180]`, zoom `[0, 24]` | Vue initiale de la carte. |
| `language` | `fr`, `en`, `it`, `es`, `pl`, `nl`, `de` | Langue initiale ; hors FR/EN, l’interface retombe actuellement sur le français. |
| `theme` | `light`, `dark` | Préférence stockée ; le thème sombre peint reste hors L13. |
| `ui_mode` | `basic`, `advanced` | Masque ou affiche les outils experts. |
| `units` | `metric` | Seul système pris en charge actuellement. |
| `field_geofence_inset_cm` | nombre ≥ 0, défaut `25` | Retrait appliqué aux nouvelles géo-clôtures créées depuis une parcelle ; `0` suit exactement la limite. |
| `speed_color_low_kmh` | nombre ≥ 0, défaut `0,5` | Seuil bas du dégradé de vitesse (Cambridge blue et en-dessous). |
| `speed_color_mid_kmh` | nombre ≥ 0, défaut `1,75` | Seuil médian (Air Force blue). |
| `speed_color_high_kmh` | nombre ≥ 0, défaut `3` | Seuil haut (Yale blue et au-dessus). Les trois doivent respecter bas ≤ médian ≤ haut. |
| `created_at`, `updated_at` | ISO 8601 UTC | Dates gérées par le serveur. |

Correspondance du type de ferme au pack : `market_garden → market_garden`,
`vineyard → vineyard`, et `open_field | livestock | mixed → open_field`.

## Formats des parcelles et missions

### `parcel_map/*.geojson`

Chaque fichier est une `FeatureCollection` WGS84. Il doit rester importable dans un
outil SIG standard. Le catalogue parcellaire reconstruit ses objets à partir des
géométries et propriétés de cette collection.

### `mission_order/*.json`

Un fichier est un document JSON Agri v3 avec `file_type: "mission_order"`. Les missions
restent à la racine de `mission_order/` : aucun sous-dossier par véhicule ou parcelle.

Convention :

```text
AAAA-MM-JJ_<parcelle-slug>_<operation-slug>.json
```

- la date est la date de création ;
- les slugs sont en minuscules, sans accent ni espace, séparés par des tirets ;
- une collision ajoute `-2`, puis `-3`, avant `.json` ;
- le nom facilite la lecture mais ne fait pas foi.

Le rattachement réel se lit dans :

```text
metadata.srbc_mission_brief.field_id
metadata.srbc_mission_brief.operation
metadata.srbc_mission_brief.campaign
```

### `work_performed/*.json`

Le contrat est le même avec `file_type: "work_performed"`. Si le travail dérive d’un
ordre connu, conserver le même nom de fichier afin de faciliter le rapprochement
prévu/réalisé. Mission Studio sait charger ces documents sans les convertir.

## Format matériel `srbc.equipment/1`

Un fichier décrit **un véhicule ou un outil**. Une combinaison véhicule–outil est une
association créée dans l’interface et ne constitue pas un troisième type de fichier.

Exemple d’outil :

```json
{
  "schema": "srbc.equipment/1",
  "kind": "implement",
  "id": "bineuse-180",
  "name": "Bineuse 180",
  "manufacturer": "Exemple SAS",
  "kinematics": null,
  "hitch_mode": "mounted",
  "length_m": 1.2,
  "width_m": 1.8,
  "working_width_m": 1.65,
  "drawbar_length_m": null,
  "mass_kg": 210,
  "icon": "bineuse-180.png"
}
```

| Champ | Véhicule | Outil | Contraintes |
|---|---|---|---|
| `schema` | obligatoire | obligatoire | Exactement `srbc.equipment/1`. |
| `kind` | `vehicle` | `implement` | Aucune combinaison dans ce format. |
| `id`, `name` | obligatoires | obligatoires | Chaînes non vides ; `id` doit rester stable. |
| `manufacturer` | optionnel | optionnel | Texte libre ou `null`. |
| `kinematics` | `skid_steer` ou `ackermann` | `null` | Obligatoire pour un véhicule. |
| `hitch_mode` | `null` | `mounted` ou `trailed` | Obligatoire pour un outil. |
| `length_m`, `width_m` | obligatoires | obligatoires | Nombres strictement positifs en mètres. |
| `working_width_m` | `null` | obligatoire | Nombre strictement positif en mètres. |
| `drawbar_length_m` | `null` | optionnel | Nombre positif ou nul ; utile pour un outil traîné. |
| `mass_kg` | optionnel | optionnel dans le fichier | Nombre positif ou nul. |
| `icon` | optionnel | optionnel | Nom d’un PNG placé à côté du JSON. |

Le PNG peut porter le nom déclaré par `icon` ou le même radical que le JSON. Les erreurs
d’import indiquent chaque champ à corriger.

## `.studio/` est régénérable

Les fichiers métier sont la vérité. `.studio/index.sqlite` (schéma interne 1) ne contient
qu’un inventaire, des checksums et des métadonnées de mission accélérant les recherches.

Il est permis de :

1. arrêter Mission Studio ;
2. supprimer entièrement `<FARM_ROOT>/.studio/` ;
3. relancer puis choisir **Reconstruire l’index** dans Administration.

Le résultat fonctionnel doit être identique. Ne sauvegardez jamais une donnée métier
uniquement dans `.studio/`.

Attention : `.studio/index.sqlite` n’est pas `backend/data/studio.sqlite`. Cette seconde
base (schéma 7) appartient au catalogue et à la file de tâches de l’application ; elle
n’est ni portable avec la ferme ni source de vérité pour son dossier.

État du projet : [`PROJECT_STATUS.md`](PROJECT_STATUS.md).
Recette L13 du 20/08 : [`L13_ACCEPTANCE_REPORT.md`](L13_ACCEPTANCE_REPORT.md) (parcelle alors à 4 onglets).
