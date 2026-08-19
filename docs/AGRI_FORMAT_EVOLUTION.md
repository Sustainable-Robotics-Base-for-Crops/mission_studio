# JSON Agri — évolution (lot LS)

Décisions datées du **18/08/2026**. Ce document est la source de vérité pour
ce qui entre dans un `mission_order` / `parcel_map`, et à quel moment.
Il **ne modifie pas** le schéma `Agri.json`.

Principe :

> Ce que le robot **applique aujourd’hui** reste le contrat v3 exécutable
> (trajectoire tabulaire + `working_zone` 0/1 + géofence).
> Ce qui sert à **préparer, valider, auditer, pré-remplir la tablette** va
> dans `metadata` (objet libre). Un champ n’est **normé dans le schéma**
> que lorsqu’un nœud ROS le lit vraiment.

---

## 1. Décision

| Question | Décision |
|---|---|
| Faut-il une Agri v4 maintenant ? | **Non.** `version` reste `"3"`. |
| Peut-on ajouter des clés à la racine (`vehicle`, `tool`, `fault_policy`) ? | **Non.** Le schéma a `additionalProperties: false`. |
| Où vivent jumeau, consignes, lien parcelle ? | `metadata`, convention `srbc_*` ci-dessous. |
| Nouvelle colonne de points (hauteur d’outil, paramètre fin) ? | **Plus tard**, quand un consommateur ROS existe. |

Le format tabulaire (un point = `x`, `y`, `speed`, `working_zone`, …) **reste
le bon modèle** pour la géométrie et « ça travaille / ça ne travaille pas ».

---

## 2. État actuel (faits)

Schéma : `json_agri_format_parser/schema/Agri.json` (vendored aussi sous
`tests/schema/Agri.json`). Racine autorisée : `version`, `file_type`,
`vehicle_id`, `origin`, `points`, `geofencing`, `metadata`.

| Fait | Détail |
|---|---|
| `json_agri_format_parser` | Publie `trajectory` (`nav_msgs/Path`) et `geofencing`. **Ignore `metadata`.** Ne lit que les colonnes `x` / `y` pour le path. |
| `working_zone` | 0 ou 1. Bascule les gains `in_working_zone` / `out_working_zone` de `nav_path_follow`. Sur la machine actuelle, cela correspond aux butées vérin **haute** (0) et **basse** (1). |
| `file_type` | `draft` \| `mission_order` \| `parcel_map`. `parcel_map` n’est aujourd’hui qu’un type de fichier **même grammaire** qu’une mission + un polygone `geofencing`. Ce n’est pas une carte de ferme. |
| Catalogue Studio (L5) | SQLite `Field` / `Zone` / `Obstacle` / `GuidanceLine` — **référentiel d’édition**, distinct de l’export robot Agri. |
| Colonnes extra | Le schéma autorise n’importe quel nom dans `columns[]`. Le parser path les ignore. Une colonne non lue = promesse non tenue. |

`vehicle_id` est une **chaîne d’identification**, pas un jumeau (pas de
longueur, largeur, cinématique, outil).

---

## 3. Trois objets, trois rôles

```
Ferme (contenant)
  ├── objets partagés : routes, mares, arbres hors champ, stations, attente…
  └── Parcelle(s)     : limite culturale, autonomie, rangs pérennes, obstacles dans le champ
        └── Mission   : trajectoire tabulaire + metadata (préconisations Studio)
```

| Objet | Source de vérité (édition) | Export robot | Rôle |
|---|---|---|---|
| **Ferme** | Catalogue Studio (somme des parcelles + objets pérennes) | Plus tard : **dossier versionné** sur la CM5 (quelques Mo de vecteurs) | Carte de domaine réutilisable |
| **Parcelle** | `Field` SQLite (+ zones, obstacles, lignes) | Incluse dans le dossier ferme | Unité agronomique |
| **Mission** | Fichier Agri `mission_order` | **Aujourd’hui** : le seul contrat exécuté | Trajectoire + géofence + préconisations |

Le `mission_order` **ne recopie pas** la ferme. Il **référence** la carte :

- `metadata.srbc_parcel_map_id`
- `metadata.srbc_parcel_map_version`

Vides si la mission a été dessinée sans carte.

Édition Studio (navigateur du module parcellaire) :

- clic **ferme** → charger l’ensemble, cadrer la ferme ;
- clic **parcelle** dans l’arbre → ne charger que celle-là, cadrer dessus.

C’est une **portée de vue**, pas deux formats.

---

## 4. Phases runtime

| Horizon | À bord du robot | Ce qui est exécuté |
|---|---|---|
| **Prochains mois** | `mission_order` + `geofencing` | Suivi de trajectoire comme aujourd’hui. `metadata` ignoré par le parser ; la **tablette** peut s’en servir pour pré-remplir. |
| **Ensuite** | Ferme entière (dossier synchronisé, robot éventuellement éteint pendant l’édition Studio) | Tablette / politiques : stations, zones d’attente, circulation autonome, etc. Le suivi reste le `mission_order` jusqu’à ce qu’un nœud consomme la carte. |

Synchro ferme : identifiant unique + version. Conflits / protocole (USB,
plugin cloud, …) : hors spec actuelle. Pas de rasters ni de bags dans ce
dossier (vecteurs seulement).

---

## 5. `mission_order` — convention `metadata.srbc_*`

Tout ce bloc est **indicatif**. Au lancement tablette : **pré-remplissage**.
L’opérateur peut tout changer. Ce ne sont pas des verrous machine.

Libellé produit : *préconisations Mission Studio*, jamais « le robot fera X »
tant qu’aucun nœud ROS ne l’applique.

### 5.1 Jumeau de validation (photo figée)

Combinaison **pour laquelle** la mission a été simulée / validée dans Studio
(pas la machine live) :

- véhicule : longueur, largeur, cinématique `skid_steer` (chenilles SRBC) ou
  `ackermann` ;
- outil ou remorque : largeur, type, point d’attelage si articulé.

Un refus « mauvais outil attelé » n’existe **que** le jour où un nœud compare
cette photo à la machine réelle.

### 5.1b Couverture (L8a)

`metadata.srbc_coverage` : photo du planificateur (moteur, stratégie, largeur
utile, cap, métriques, variantes). **Indicatif.** L’exécutable reste `points[]`
en `row_line`. Moteur : `fields2cover` | `parallel_fallback` | `row_set`.

### 5.1c Brief assistant (L8c)

`metadata.srbc_mission_brief` : objectif, parcelle, combinaison, recette,
stratégie, notes logistique. **Indicatif** (pré-remplissage tablette). Le
robot n’en lit rien.

### 5.2 Vérins

- **Exécuté** : `working_zone` 0/1 (butee haute / basse), inchangé.
- **Indicatif** : hauteurs en mm (`high_mm`, `low_mm`) dans `metadata` pour
  pré-remplir la tablette.
- **Plus tard** : colonne de points si réglage plus fin qu’une butée, ou
  paramètre propre à un outil actif — seulement avec consommateur ROS.

### 5.3 Suivi

Algorithme et gains **a priori**. La tablette peut les modifier en mission.

### 5.4 Politiques d’incident (préconisations)

Bornées, jamais implicites. Cibles = **objets de la carte** (id), pas des
coordonnées recopiées dans la mission.

| Événement | Action type |
|---|---|
| Batterie faible | Rejoindre un objet `charging_station` (polygone) |
| Mission terminée | Rejoindre un objet `waiting_area` (ou autre id) |
| Forte déviation de trajectoire | Un seul mode parmi `stop` \| `slow` \| `rejoin_at_all_costs` |

Si la carte n’a pas l’objet, le champ reste vide : la tablette ne pré-remplit
pas cette politique.

### 5.5 Exemple (v3 valide)

```json
{
  "version": "3",
  "file_type": "mission_order",
  "vehicle_id": "srbc-001",
  "origin": {
    "type": "WGS84",
    "coordinates": { "lat": 45.85, "lon": 3.17, "alt": 0 }
  },
  "points": [],
  "geofencing": { "columns": ["x", "y"], "values": [] },
  "metadata": {
    "srbc_mission_id": "les-graves-binage-2026-08",
    "srbc_mission_version": 1,
    "srbc_parcel_map_id": "ferme-dupont",
    "srbc_parcel_map_version": 4,
    "srbc_equipment": {
      "vehicle": {
        "id": "srbc-001",
        "length_m": 1.8,
        "width_m": 1.1,
        "kinematics": "skid_steer"
      },
      "implement": {
        "id": "binage-120",
        "kind": "tool",
        "width_m": 1.2
      },
      "trailer": null,
      "validated_at": "2026-08-18T12:00:00Z"
    },
    "srbc_recommendations": {
      "cylinders": { "high_mm": 280, "low_mm": 40 },
      "controller": {
        "algorithm": "classic",
        "gains": {}
      },
      "fault_policy": {
        "low_battery": {
          "action": "go_to",
          "target_kind": "charging_station",
          "target_id": "cour-nord"
        },
        "mission_complete": {
          "action": "go_to",
          "target_kind": "waiting_area",
          "target_id": "entree-graves"
        },
        "path_deviation": { "mode": "slow" }
      }
    }
  }
}
```

`kinematics` : `skid_steer` \| `ackermann`.  
`implement` : outil **porté** (`kind: tool`) — bineuse, semoir.  
`trailer` : outil **traîné** (`kind: trailer`) — remorque, covercrop sur roues.
Un seul des deux est rempli. Pour une remorque, le hitch (articulation) et
`drawbar_length_m` (longueur du timon, attelage → essieu) vont dans `trailer`,
pas dans la trajectoire.  
`path_deviation.mode` : `stop` \| `slow` \| `rejoin_at_all_costs`.

Les clés absentes = « pas de préconisation », pas une valeur par défaut
cachée.

---

## 6. Carte — objets de service

Les stations **ne sont pas** des attributs du `mission_order`. Elles vivent
sur la **ferme / parcelle**.

Forme : **polygone** (emprise au sol). Un point GPS ne suffit pas : la
surface peut avoir plus tard un **sens d’entrée / circulation**.

Kinds prévus (liste ouverte, à typographier dans le catalogue Studio) :

| Kind | Exemples |
|---|---|
| `charging_station` | Station de recharge |
| `waiting_area` | Zone d’attente robot |
| `refill_crates` | Ravitaillement cagettes |
| `refill_product` | Ravitaillement produit |
| `access` | Entrée / sortie de parcelle (si besoin) |

Portée : **ferme** (une station pour plusieurs parcelles) ou **parcelle**
(point d’entrée d’îlot). Les deux existent.

Objets pérennes de ferme (hors service) : routes, arbres, mares, obstacles
dans le champ, emprise vigne / verger / rangs permanents. Les **rangs
pérennes** sont de la carte ; la **trajectoire de la semaine** est le
`mission_order`.

Grammaire d’export `parcel_map` (sections typées vs bloc `layers`) : **non
figée**. Le catalogue SQLite L5 est le modèle d’édition. L’export robot du
dossier ferme se spécifie au moment de la synchro, en réutilisant de
préférence la structure `section` Agri (colonnes + values) pour ne pas
inventer une deuxième grammaire.

---

## 7. Quand passer en v4 (ou v3.1) ?

**Pas maintenant.** Critère unique : un nœud ROS (ou la tablette en
consommation **contraignante**) lit le champ.

Ordre probable, le jour venu :

1. Tablette : lecture `metadata.srbc_recommendations` pour pré-remplir
   (aucun changement schéma).
2. `nav_cylinders` / tablette : mm de vérin si on sort du 0/1.
3. `nav_path_follow` / `nav_arbitration` : profil de suivi, politique de
   déviation **exécutée**.
4. Carte à bord : géofences multiples, stations, circulation — **après**
   la phase « mission_order + une géofence ».

Jusque-là, enrichir `metadata` et le catalogue Studio ne casse pas les
missions déjà sur les robots.

---

## 8. Ce que ce document n’est pas

- Pas un changement de `Agri.json`.
- Pas l’inspecteur parcellaire 5 onglets ni l’import KML / Shapefile.
- Pas le protocole de synchro ferme ↔ CM5.
- Pas une garantie que les politiques d’incident s’exécutent.

Toute PR qui ajoute une clé **racine** Agri, qui densifie une promesse
runtime sans consommateur, ou qui recopie la ferme dans le `mission_order`,
contredit cette spec.
