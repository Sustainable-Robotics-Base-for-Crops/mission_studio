---
title: "Audit Mission Studio SRBC — fonctionnement, livrables, écart à l'ambition"
version: "1.0"
date: "2026-08-24"
status: "Audit de reprise — état du produit et de la documentation"
depot: "code GIT/GITHUB/Sustainable-Robotics-Base-for-Crops/mission_studio"
commit_pousse: "20738f7 — Document the L13 farm folder… (20/08/2026)"
working_tree: "Parcellaire 23–24/08 commité dans ce dépôt (arbre géométrie, landmarks, historique)"
lang: "fr"
---

# Audit Mission Studio SRBC — 24 août 2026

> Copie de sauvegarde GitHub. Les CdC et roadmaps (`Feature_SRBC_edit_Traj.md`,
> L13, bilan L0–L12b) restent dans le workspace Agent CTO,
> `Robot_SRBC/Ecosysteme_logiciel/Editeur de trajectoire/`. Les liens relatifs
> ci-dessous pointent vers ce dossier local, pas vers ce dépôt.

Ce document est le **point d’entrée actuel** du projet éditeur / Mission Studio.
Il décrit le logiciel tel qu’un utilisateur le voit, ce qu’il produit réellement,
l’écart avec l’ambition des 17–20 août 2026, et le tri des fichiers de ce dossier.

| Document | Rôle désormais |
|---|---|
| **Ce fichier** | État produit + docs, au 24/08/2026 |
| [`BILAN_MISSION_STUDIO_L0-L12b.md`](BILAN_MISSION_STUDIO_L0-L12b.md) | Instantané **avant** L13 (19/08) — archive utile, ne plus le traiter comme l’état courant |
| [`Feature_SRBC_edit_Traj.md`](Feature_SRBC_edit_Traj.md) | Cahier des charges produit (ambition, P0–P2) — **pas** un statut d’implémentation |
| [`ROADMAP_DEV_trajectory_editor.md`](ROADMAP_DEV_trajectory_editor.md) | Lots L0–L12 et ADR — historique d’exécution |
| [`CDC_TECHNIQUE_REAGENCEMENT.md`](CDC_TECHNIQUE_REAGENCEMENT.md) | Spec L13 (dossier ferme, rail, onglets) |
| [`ROADMAP_REAGENCEMENT_L13.md`](ROADMAP_REAGENCEMENT_L13.md) | Tâches T13.01–T13.18 + notes du 23/08 |

> **Sécurité produit.** Mission Studio prépare et valide sur **données déclarées**.
> Il ne remplace ni l’analyse de risques machine–outil, ni ISO 18497, ni un essai
> terrain. Aucune de ses validations n’autorise un mouvement de robot.

**Lancer le logiciel (Mac) :**

```bash
cd "code GIT/GITHUB/Sustainable-Robotics-Base-for-Crops/mission_studio"
source .venv/bin/activate
npm run build
BACKEND_FASTAPI=true python server.py
# http://localhost:3000/studio   ← Mission Studio
# http://localhost:3000/app      ← éditeur compact historique (Leaflet)
```

Sans `BACKEND_FASTAPI=true`, le catalogue parcellaire, le matériel SQLite, le dossier
de ferme et la publication versionnée **ne sont pas** disponibles. `/studio` a alors
l’apparence du poste, mais pas le métier.

---

## 0. Verdict en une page

Mission Studio n’est plus un simple tracer de polylignes. C’est un **poste de
préparation de missions** : ferme sur disque, parcellaire, jumeau 2D, assistant de
couverture, édition expert, simulation géométrique, publication figée, packs
vigne / maraîchage / plein champ.

La **première impression** (charte claire, Lucide, carte MapLibre, rail métier)
est au niveau visé John Deere / Sabanto. La **couche métier** est réelle, mais
plusieurs boutons importants sont encore **visibles et inactifs** (imports
fichier, méta-mission, comparer des missions). La chaîne jusqu’au robot s’arrête
à un **fichier JSON Agri v3** : pas de handoff tablette, pas de logs d’exécution
remplis, pas de sync.

| Dimension | Niveau de finition (jugement) |
|---|---|
| Charte / coquille `/studio` | **Élevé** — conforme à l’ambition UX de surface |
| Flux quotidien (ferme → mission → simuler → publier) | **Moyen–élevé** — utilisable, encore rugueux |
| Parité éditeur géométrique historique | **Élevé** sur `/studio`, `/app` encore en parallèle |
| Couverture / jumeau / simulation | **Moyen** — moteurs là, limites honnêtes (repli parallèle, ODD déclaré, pas de physique) |
| Ouverture SIG / import tiers | **Faible** — GeoJSON catalogue ; ISO XML / Shapefile / GPKG **non branchés** |
| Continuité robot (tablette, exécuté, sync) | **Faible** — hors périmètre encore, mais l’UI en parle déjà |
| Ambition CdC P0 « produit prêt champ » | **Non atteint** — critères §10 du CdC (10 min sans formation, WCAG AA prouvé, test 3 filières, handoff mobile) pas tous tenus |

**Git (fait vérifié le 24/08) :** `origin/main` s’arrête au commit `20738f7`
(20/08, doc L13). Le disque local contient une **refonte parcellaire non
commitée** (arbre de géométrie, landmarks, undo serveur, imports d’onglets
retirés). L’audit ci-dessous décrit le **code sur disque**, plus riche que le
dernier commit poussé.

---

## 1. Fonctionnement — point de vue utilisateur

### 1.1 À quoi ça sert

On prépare **hors champ** le travail du robot : où est la parcelle, avec quelle
machine et quel outil, quel trajet (passes, fourrières, demi-tours), puis on
**rejoue** le trajet à l’écran et on **fige** une version. Le robot ne « discute »
pas avec Studio : il reçoit (plus tard, via la tablette) un **fichier de mission**
JSON Agri v3.

Deux portes d’entrée existent encore :

| URL | Public visé | Carte |
|---|---|---|
| `/studio` | agriculteur / chef de culture / préparateur | MapLibre, 6 modules |
| `/app` | historique compact, WebView iOS, OSS `trajectory_editor` | Leaflet |

Le produit visé est **`/studio`**. `/app` est conservé pour non-régression et
tablette ; on n’y empile plus les lots Studio.

### 1.2 Le dossier de ferme (idée centrale L13)

Tout ce qui « existe » pour l’exploitation tient dans **un dossier** choisi dans
Administration. Changer de dossier = changer de ferme. C’est la même arborescence
que le robot est censé retrouver :

```text
<FARM_ROOT>/
├── farm.json                 identité, langue, mode basique/avancé, vue de départ
├── parcel_map/               une FeatureCollection GeoJSON par parcelle
├── mission_order/            missions Agri v3 (à plat, noms parlants)
├── work_performed/           journaux Agri v3 (quand le robot les renverra)
├── equipment/                véhicules / outils JSON + PNG optionnel
└── .studio/                  index SQLite régénérable (pas une source de vérité)
```

SQLite (`backend/data/studio.sqlite` + `.studio/index.sqlite`) est un **index**.
Les fichiers sont la vérité. `backend/uploads/` reste le repli de `/app`.

### 1.3 Ordre de travail qui marche

1. **Administration** — ouvrir ou créer une ferme, type d’exploitation
   (maraîchage, vigne, plein champ, élevage, mixte), langue, mode **basique** ou
   **avancé**.
2. **Matériel** — véhicule SRBC (préréglage OEM) + outil porté ou traîné +
   **combinaison**. La largeur utile n’est pas la largeur physique.
3. **Parcelle** — dessiner ou (plus tard) importer ; zones, rangs, obstacles,
   chemins, repères.
4. **Mission** — assistant 7 étapes **ou** partir de zéro **ou** recharger une
   mission du dossier ; ajuster sur la carte.
5. **Simulation** — choisir mission + combinaison, lancer, lire les bloqueurs.
6. **Publier** (onglet Mission) — version immuable `vN` + checksum, export JSON.

En **mode basique**, l’onglet Éditer mission, l’arbre expert, les transformations
(offset, rotation, duplication) et l’édition manuelle de l’ODD sont masqués. Un
lien « passer en mode avancé » mène à Administration.

### 1.4 Les six modules du rail

Ordre voulu par le donneur d’ordre (20/08) : **Accueil → Mission → Parcelle →
Matériel → Simulation → Administration**. En bas du rail : Aide, nuage (hors
ligne), compte — les deux derniers **annoncent** sync et abonnement, non
implémentés.

Les anciens modules Publication / Rapports / Intégrations **ne sont plus dans le
rail**. Les URL `/studio/publication`, `/rapports`, `/integrations` redirigent
vers Mission, Simulation, Matériel.

---

## 2. Fonctionnalités et mode d’emploi

### 2.1 Accueil

Tableau de bord d’exploitation, pas un second menu.

- Nom de ferme, type, chemin du dossier, pastille sync **toujours « hors ligne »**.
- Quatre chiffres : hectares cartographiés, nombre de missions, combinaisons
  matériel, **heures de travail → tiret `—`** (pas de journaux robot).
- Missions récentes et missions « à revalider » (non simulées ou invalidées).
- Clic d’une mission → charge le document et ouvre le module Mission.
- Sans ferme : appel à aller dans Administration.

### 2.2 Mission

Onglets du panneau gauche (état disque 24/08, après simplification 23/08) :

| Onglet | État | Usage |
|---|---|---|
| **Explorer** | actif | Créer depuis zéro, depuis une parcelle, assistant 7 étapes ; liste des fichiers `mission_order/` ; **import fichier tiers désactivé** |
| **Éditer** | actif si une mission est chargée ; masqué en mode basique tant qu’il n’y a pas de document | Outils carte, arbre de sections, packs, métadonnées (matériel, ODD, brief) |
| **Méta-mission** | **visible, désactivé** | Enchaîner plusieurs missions — prévu, pas codé |
| **Comparer** | **visible, désactivé** | Superposer plusieurs missions — prévu, pas codé (ne pas confondre avec Comparer *variantes de couverture* dans la barre) |
| **Publier** | actif si document | Publier vN, enregistrer, enregistrer sous, dupliquer, exporter JSON Agri |

**Assistant 7 étapes :** objectif (binage, semis…) → parcelle → machine /
combinaison → recette → stratégie de couverture → logistique → génération.
Le brief est stocké dans `metadata.srbc_mission_brief`.

**Outils carte (mode avancé, mission chargée) :**

| Outil | Ce que l’utilisateur fait | Effet |
|---|---|---|
| Tracer une ligne | clics, Entrée | section `row_line` (sommets, **pas** densifié à 0,1 m) |
| Remplir la parcelle | polygone ou parcelle catalogue + espacement | rangs + éventuellement fourrières / pivots via API couverture |
| Polygone | géofence, zone, découpe selon le panneau | limite ou clip des rangs |
| Zone de travail | polygone | `working_zone` 0/1 (gris / bleu) |
| Sélection / lasso | clic ou polygone | halo jaune, inspecteur |
| Déplacer / tourner / dupliquer / rallonger / offset | inspecteur ou glisser | géométrie sans densifier les `row_line` |
| Connecter demi-tours | dialogue | U, carré, serpentin, corkscrew, boucle → `turn_*` |
| Connecter extrémités | relier des bouts de rang | transit |
| Règle | 2 points | mesure hors JSON |
| Vitesse globale | dialogue | tous les points, 0–50 m/s |
| Annuler / rétablir | Cmd+Z / Shift+Cmd+Z | pile de commandes |
| Cadenas / œil | arbre | verrou session ; masquage carte (pas dans Agri) |

Autosave ~800 ms vers le dossier ferme (missions) / catalogue.

**Packs (L12b) :** plein champ (saut de passes, apply-N parcelles), vigne (plage
de rangs, numéros), maraîchage (génération de planches), teach-and-repeat
(trace → lissage → `row_path`).

### 2.3 Parcelle

Deux onglets (CDC mis à jour le 23/08 ; le rapport de recette du 20/08 parlait
encore de quatre onglets — **obsolète**) :

| Onglet | Usage |
|---|---|
| **Explorer** | liste des parcelles + surface ; créer depuis la carte ; **import fichier désactivé** |
| **Éditer** | outils de tracé + **arbre de géométrie** (zones, obstacles, rangs, guidage, circulation, repères) ; export GeoJSON ; **import calque désactivé** |

Clic parcelle → zoom sur l’emprise. Inspecteur droit : identité, géométrie,
impact versions (« N missions concernées »), **missions générées et travaux
réalisés** rattachés à la parcelle (clic → charge la mission).

Outils d’édition parcellaire (WIP local 23/08) : polygone parcelle / zone /
géofence, polyligne (rang, planche, guidage, chemin), lasso, règle (distance,
cercle, polygone, point GPS), **repères** persistés sans invalider les missions,
exclusion (zone interdite) depuis la géofence, suppression avec undo (Ctrl+Z)
plutôt qu’une confirmation, sauf cascade sur une parcelle entière.

Types de zones dans le catalogue : cultivable, traversable, interdite, autonomie,
tournière, GNSS dégradé — **déclarés par l’opérateur**, pas mesurés.

### 2.4 Matériel

Trois listes : **combinaisons**, **véhicules**, **outils**.

- Preset OEM SRBC (chenilles, pivot sur place).
- Outil **porté** (ex. bineuse) vs **traîné** (timon, hitch).
- Largeur utile ≠ gabarit ; enveloppe collision et balayage de pivot en 2D sur la
  carte.
- Ajout par fenêtre : saisie manuelle **ou** fichier `srbc.equipment/1` + PNG.
- Intégrations constructeurs : **pas de module dédié** ; l’import d’équipement
  vit ici.

Dette connue : essieu / timon à peaufiner pour coller au suiveur de trajectoire
robot ; pas de 3D.

### 2.5 Simulation

Trois onglets :

1. **Configurer** — mission (courante ou fichier du dossier), combinaison, ODD,
   lancer.
2. **Résultats** — contrôles (bloqueur / avertissement / skip honnête), clic →
   pose sur la carte.
3. **Rapport** — KPI couverture, manque, recouvrement, temps travail / manœuvre /
   transit, distance. Exécuté, dose, énergie, attente : **vides**.

Le **tiroir bas** de la carte : résumé + timeline 1×–20× + lecture. Le détail des
contrôles est dans l’onglet Résultats, plus dans un panneau bas surchargé.

Moteur : **cinématique navigateur** (enveloppe AABB vs géofence, rayon
Ackermann, pivot skid-steer). Pas Gazebo, pas glissement, pas MNT, pas météo
live. Un « manque » de couverture **n’est jamais un bloqueur** (vigne, planches).

Publication **refusée** s’il reste un bloqueur ou si la simulation est périmée
après une modification.

### 2.6 Administration

- Nom et type de ferme.
- Dossier : ouvrir (exige `farm.json`), créer dans un dossier **vide**, fermes
  récentes (5), réindexer `.studio/`.
- Vue de départ = « utiliser la vue carte actuelle ».
- Langue (7 langues historiques ; les **nouvelles** clés L13 sont FR+EN).
- Thème clair / sombre (sombre **pas réellement peint** au niveau CdC UX).
- Mode basique / avancé.
- Inset géofence parcelle (cm), seuils de couleur de vitesse.

### 2.7 Ce qu’il ne faut pas croire

| Apparence | Réalité |
|---|---|
| Heures sur l’accueil | Toujours `—` |
| Nuage / sync | Toujours hors ligne |
| Compte / Aide LLM | Placeholders |
| Pente, météo, RTK | Uniquement si saisis |
| États « reçu / prévol / activée » | Lecture seule, non branchés machine |
| Rapports « exécuté » | Vides sans `work_performed` |
| Fields2Cover | Souvent **repli parallèle** si la lib n’est pas compilée |
| `/app` | Autre produit, densifie encore en `row_path` 0,1 m |

---

## 3. Ce que le logiciel produit exactement

### 3.1 Fichier de mission — JSON Agri v3

C’est **le** livrable robot. Consommé par `json_agri_format_parser` →
`nav_replay` / `nav_line_matcher` (`row_line`) / `nav_path_matcher` (`row_path`) /
`nav_turn` (`turn_*`) / `geofencing`.

Structure tabulaire (schéma `Agri.json`, **pas de v4**) :

- `version`: `"3"`
- `file_type`: `mission_order` (ou `draft`, `work_performed`)
- `vehicle_id`, `origin` WGS84 (lat/lon ~2 décimales)
- `points[]` : sections avec `section_type`, `columns`, `values` (x, y mètres
  locaux, speed m/s, working_zone 0/1, punctual optionnel)
- `geofencing` : polygone métrique
- `metadata` : objet libre — **tout l’enrichissement Studio** y vit

| Clé `metadata` | Contenu |
|---|---|
| `srbc_mission_brief` | nom, parcelle (`field_id`), opération, priorité |
| `srbc_equipment` | snapshot véhicule / outil / combinaison |
| `srbc_odd` | profil d’emploi déclaré |
| `srbc_coverage` | moteur, nombre de passes, stratégie |
| `srbc_crop_pack` | pack cultural |
| `srbc_working_zone_rings` | polygones WZ affichés |
| `srbc_geofence_exclusions` | îlots exclus |
| `srbc_simulation` | attestation (empreinte, date) |
| `srbc_publication` | `vN`, checksum SHA-256 |

Le nom de fichier dans le dossier ferme
`AAAA-MM-JJ_<parcelle>_<operation>.json` est un **confort**. La parcelle réelle
se lit dans le brief.

Studio privilégie `row_line` (2 sommets, pour `nav_line_matcher`). Les courbes et
traces teach-and-repeat restent `row_path` densifié 0,1 m. `/app` legacy produit
surtout du `row_path`.

### 3.2 Parcelle — GeoJSON

Un fichier `parcel_map/<id>.geojson` : FeatureCollection. Propriété
`srbc_kind` : `field`, `zone`, `obstacle`, `guidance_line`, `row`, `bed`,
`traffic_way`, `traffic_node`, `landmark`.

Le dossier s’appelle `parcel_map` (vocabulaire Agri) mais le contenu **n’est pas**
un document Agri. Le robot / un SIG peut lire le GeoJSON ; la nav actuelle
consomme surtout le **mission_order**.

### 3.3 Matériel — `srbc.equipment/1`

JSON véhicule ou outil dans `equipment/`, PNG homonyme optionnel. Catalogue aussi
indexé en SQLite. Seed : `srbc-001`, bineuse, combinaisons.

### 3.4 Publication

Enregistrement immuable côté serveur (snapshot + SHA-256 + numéro de version).
Tampon dans `metadata.srbc_publication`. **Pas** de signature hors SHA-256, **pas**
d’OAuth, **pas** de transfert iOS réel. Les états machine restent cosmétique.

### 3.5 `farm.json`

Schéma `srbc.farm/1` : nom, `farm_type`, `start_view`, langue, thème, `ui_mode`,
unités, inset géofence, seuils vitesse.

### 3.6 Ce qui n’est **pas** produit

- Fichier ISOXML / shapefile en sortie.
- Carte de préconisation / dose.
- Log d’exécution (entrée seulement, quand on en aura).
- Paquet « envoyer au robot » gRPC (chaîne privée tablette, hors Studio).
- Mission multi-robots.

---

## 4. Comparaison à l’ambition initiale

Sources d’ambition, dans l’ordre de légitimité :

1. Promesse produit ([`Feature_SRBC_edit_Traj.md`](Feature_SRBC_edit_Traj.md) §1) :
   intention métier → géométrie → jumeau → simulation → validation → publication
   mobile, au niveau UX Deere / Sabanto / TraXwise.
2. Benchmark marché [`BenchMark_CdCF_editeur_missions_agricoles_autonomes.md`](BenchMark_CdCF_editeur_missions_agricoles_autonomes.md)
   (`MAP-*` … `UX-*`).
3. UX normative [`benchmark_ux_pack/cahier_des_charges_ux_editeur_missions_agricoles.md`](benchmark_ux_pack/cahier_des_charges_ux_editeur_missions_agricoles.md).
4. Recadrage donneur d’ordre 20/08 ([`Remarque_Utilisatuer_20aout26.md`](Remarque_Utilisatuer_20aout26.md))
   → L13 dossier ferme + rail 6 modules.

### 4.1 Promesse produit (chaîne)

| Maillon | Ambition | État 24/08 |
|---|---|---|
| Intention métier | vocabulaire paysan, assistant | **Oui** (7 étapes, packs) |
| Géométrie | sans dessiner chaque rang | **Oui** (couverture + édition) ; îlots / F2C complets **partiels** |
| Jumeau | véhicule + outil + point de travail | **2D partiel** ; point outil (TIARA) **non** |
| Simulation | cinématique + bloqueurs | **Oui** sur déclaré ; physique **non** |
| Validation | aucune pub avec bloqueur | **Oui** côté UI |
| Publication mobile | version identifiable par l’app | **Checksum Studio seulement** ; handoff **non** |
| Web ≠ cockpit | pas de téléop navigateur | **Respecté** |

### 4.2 Priorités P0 du CdC

| # | Capacité | Lot | Finition |
|---|---|---|---|
| P0.1 | Design system + coquille 4 zones | L1–L2 | **Livré** ; WCAG 2.2 AA **non démontré** de bout en bout |
| P0.2 | MapLibre + symbologie | L3 | **Livré** |
| P0.3 | Domaine + undo/redo + autosave | L4 | **Livré** sur `/studio` ; `/app` undo sans redo |
| P0.4 | Typologie de zones (SC) | L5 | **Catalogue oui** ; règle « la mission ne sort pas de sa zone » **partielle** (simu géofence, pas toutes les typologies) |
| P0.5 | Parcellaire versionné + SIG | L5 | Versions / impact **oui** ; import **GeoJSON** ; KML/SHP/GPKG **non** |
| P0.6 | Jumeau SRBC | L7 | **L7a** 2D ; 3D / signalement fin **non** |
| P0.7 | Moteur de couverture | L8 | 3 orientations, fourrières ; **repli parallèle** si pas Fields2Cover |
| P0.8 | Assistant 7 étapes | L8 | **Livré** ; modèles saisonniers / prescription **non** |
| P0.9 | Éditeur expert | L9 | Arbre, dnd, inspecteur **oui** ; Comparer missions **stub** |
| P0.10 | Simu bloquante (SC) | L10 | **Livré** sur déclaré ; MNT / météo / RTK live **non** |
| P0.11 | Publication + handoff | L11 | Version + SHA-256 **oui** ; mobile **non** |
| P0.12 | Fourrières / pivots chenilles | L8 | **Partiel** (pivot carré, largeur fourrière souvent 0 par défaut) |
| P0.13 | WCAG 2.2 AA | L2+ | Tokens / focus **oui** ; audit AA pages métier **non clos** |

### 4.3 P1 — « leader robot léger »

| # | Capacité | État |
|---|---|---|
| P1.1 | Rangs numérotés, plage 12–37 | **Présent** (pack vigne + L6) |
| P1.2 | Planches | **Présent** (générateur) |
| P1.3 | Comparateur variantes | **Couverture 2–3 orientations** ; pas un comparateur multicritère riche |
| P1.4 | Obstacles + contournement couverture | Obstacles **dessinés** ; contournement F2C **limité** |
| P1.5 | Teach-and-repeat | **Présent** (trace → RDP → row_path) |
| P1.6 | Graphe de circulation | **Première coupe** (voies / nœuds) |
| P1.7 | Éligibilité autonomie (SC) | **ODD déclaré**, pas un diagnostic parcelle autonome |
| P1.8 | Corridors transit outil inactif | **Partiel** (working_zone 0) |
| P1.9 | Bibliothèque de modèles de mission | **Non** (assistant, pas une lib saisonnière) |
| P1.10 | Rapports prévu / autorisé / exécuté | **UI oui** ; exécuté **vide** |
| P1.11 | Scénarios d’aléas | **Non** (skips honnêtes) |
| P1.12 | Semis → entretien | **Non** |
| P1.13 | Tablette-first | Cibles 48 px visées ; perf grosses traj **non mesurée** ici |
| P1.14 | Provenance géométries | **Partiel** (versions catalogue) |
| P1.15 | Import trajectoire tierce | **Bouton inerte** (22–23/08) |

P2 (offset-point outil, plante, flotte, Gz Sim, perception, SDK) : **hors coupe**,
volontairement. Gadgets G.* : non commencés, c’est correct.

### 4.4 Layout UX visé vs réel

Ambition : rail 64 + contexte 304 + carte ≥ 50 % + inspecteur 360 + timeline 240.
**Réel :** coquille 4 zones livrée ; timeline devenue **tiroir réduit** (demande
L13) — écart volontaire, meilleur que le CdC UX d’août sur ce point.

Charte : fond `#F4F7F3`, primaire `#166534`, Inter, Lucide — **en place** sur
`/studio`. `/app` garde le thème sombre héritage Android.

### 4.5 Recadrage L13 (20–23 août) vs code

| Demande donneur d’ordre | État |
|---|---|
| Rail 6 modules, ordre Mission avant Parcelle | **Fait** |
| Accueil = KPI exploitation | **Fait** (heures en `—`) |
| Publication / rapports / intégrations hors rail | **Fait** |
| Dossier ferme portable = vérité | **Fait** (backend + Admin) |
| Une seule mission sur la carte | **Fait** |
| Méta-mission / comparer : plus tard, onglets visibles | **Fait** (disabled) |
| Parcelle : naviguer vs éditer ; îlots reportés | **Fait** (2 onglets) ; îlots **non** |
| Inspecteur : missions de la parcelle | **Fait** |
| Simu : config / résultats / rapport ; tiroir minimal | **Fait** |
| Matériel : popup ajout + fichier JSON | **Fait** |
| Import parcelle / calque / ISO XML | **Boutons désactivés** — reste à faire |
| Mode basique / avancé | **Fait** |
| Sync robot, compte, aide LLM | **Hors lot**, placeholders |

Recette L13 du 20/08 (`mission_studio/docs/L13_ACCEPTANCE_REPORT.md`) : 13/13
**à cette date**, avec **4 onglets parcelle**. Le CDC a ensuite **réduit à 2
onglets** (23/08). Le rapport de recette **n’a pas été réécrit** : il ne décrit
plus l’UI actuelle. Les 13 critères du CDC **actuel** restent globalement tenus,
sauf la nuance « Éditer grisé sans sélection » à revalider sur le WIP local.

### 4.6 Effort annoncé vs réalisé

Le CdC (17/08) estimait **8–12 mois-personne** pour la cible marché. Entre le
17 et le 24 août, L0–L13 ont été poussés à une vitesse d’agent : **largeur
fonctionnelle énorme**, **profondeur inégale**. C’est un prototype métier
avancé, pas encore un produit champ « 10 minutes sans formation + 3 filières
testées » (§10 du CdC).

---

## 5. Inventaire du dossier « Editeur de trajectoire »

Chemin :
`Robot_SRBC/Ecosysteme_logiciel/Editeur de trajectoire/`

### 5.1 Fichiers à garder et à lire (ordre recommandé)

| Fichier | Statut | Action |
|---|---|---|
| **`AUDIT_MISSION_STUDIO_2026-08-24.md`** (ce fichier) | **Actif** | Point d’entrée |
| `Feature_SRBC_edit_Traj.md` | **Actif** — CdC produit | Compléter les pastilles P0/P1 quand une capa passe de partiel à clos ; ne pas y copier l’état Git |
| `CDC_TECHNIQUE_REAGENCEMENT.md` | **Actif** — spec L13 | Tenir à jour §5 Parcelle (déjà 2 onglets) ; ajouter un lien vers cet audit |
| `ROADMAP_REAGENCEMENT_L13.md` | **Actif** — exécution | Mettre l’en-tête d’avancement au 24/08 (phases A–D livrées, imports hors lot, WIP non commité) |
| `Remarque_Utilisatuer_20aout26.md` | **Source brute** | Ne pas réécrire ; orthographe du nom conservée |
| `benchmark_ux_pack/cahier_des_charges_ux_editeur_missions_agricoles.md` | **Norme UI** | Toujours valable pour tokens / WCAG / perf |
| `BenchMark_CdCF_editeur_missions_agricoles_autonomes.md` | **Référence marché** | Utile pour les IDs MAP/EQP/SIM ; pas un backlog d’implémentation |

### 5.2 Archives — utiles, plus le statut courant

| Fichier | Statut | Action |
|---|---|---|
| `BILAN_MISSION_STUDIO_L0-L12b.md` | **Archive 19/08** | Garder : meilleure intro utilisateur *d’alors* + bilan technique L0–L12b. Bandeau « remplacé pour l’état courant » |
| `ROADMAP_DEV_trajectory_editor.md` | **Archive vivante** | Garder les ADR et lots L0–L12. §15 (avancement) **périmé** dès L13 : pointer cet audit. Ne plus y ajouter de lots comme si c’était le plan unique |
| `mission_studio/docs/L13_ACCEPTANCE_REPORT.md` | **Recette 20/08** | Garder comme preuve de recette ; **compléter** une note « parcelle passée à 2 onglets le 23/08 » |

### 5.3 Sources utilisateur hors Markdown

| Fichier | Statut | Action |
|---|---|---|
| `REMARQUES_UTILISATEUR_MISSION_STUDIO_L0-L12b.docx` | Source 20/08 (Word) | Garder ; le `.md` `Remarque_Utilisatuer_20aout26.md` en est la transcription de travail. Si divergence, **le Word / la remarque md 20aout** font foi pour L13 |
| `REMARQUES_UTILISATEUR_22aout.docx` | Source 22/08 | **À transcrire en `.md`** dans ce dossier (comme le 20/08) pour que les agents la lisent. En l’état, seul Word — risque d’oubli |

### 5.4 Benchmark visuel — garder

| Élément | Statut |
|---|---|
| `benchmark_ux_pack/benchmark_captures/01` … `10_*.png` | Références Deere, Sabanto, AgXeed, etc. — **garder** |
| `benchmark_ux_pack/benchmark_ux_10_logiciels_agricoles.png` | Planche synthèse — **garder** |
| `Concurent/TRAXWISE-Agxeed-brochure.pdf` | Brochure concurrent — **garder** (typo du dossier `Concurent` : optionnel de renommer en `Concurrent` plus tard, casse les liens) |

### 5.5 Ce qui manque dans ce dossier (à compléter)

| Manque | Pourquoi |
|---|---|
| Transcription `.md` du Word du **22/08** | Les retours parcellaire / import y sont ; L13 roadmap les cite déjà en partie |
| Journal « WIP non commité » | Le disque ≠ `20738f7` : un commit (quand vous le demanderez) + 5 lignes dans `ROADMAP_REAGENCEMENT_L13.md` |
| Guide utilisateur **paysan** 4–6 pages | Le bilan A et cet audit sont trop denses ; une notice `/studio` n’est pas dans ce dossier (il existait une notice PDF pour `/app`) |
| Matrice P0/P1 **datée 24/08** | Désormais ici §4 ; le CdC Feature a des notes 18–19/08 à ne pas laisser croire « tout est P0 vert » |
| Lien skill Cursor | `.cursor/skills/trajectory-editor/SKILL.md` pointe encore `caf17f1` et « prochaine T13.10 » — **périmé** |

### 5.6 Docs **dans le dépôt** `mission_studio/docs/` (hors ce dossier, mais couple)

| Fichier | Statut |
|---|---|
| `FARM_FOLDER.md` | **Actif** — dossier ferme |
| `ARCHITECTURE.md` | Actif, à relire après le WIP parcellaire |
| `AGRI_FORMAT_EVOLUTION.md` | Actif — interdit v4, `metadata.srbc_*` |
| `COVERAGE.md` | Actif |
| `DESIGN_SYSTEM.md` | Actif |
| `PARCELLAIRE_CARTE.md` | Actif — symbologie |
| `PLUGINS.md` | Actif — contrats GitLab |
| `L13_ACCEPTANCE_REPORT.md` | Recette 20/08, voir §5.2 |

Ces fichiers **ne sont pas** dans « Editeur de trajectoire ». Un clone GitHub
seul a l’archi code ; un clone workspace Agent CTO seul a le CdC. Les deux
doivent rester croisés.

### 5.7 Fichiers à ne pas traiter comme backlog

- Captures PNG : illustration, pas spec.
- Brochure TraXwise : concurrent, pas CdC SRBC.
- `ROADMAP_DEV` §6 branches `feat/*` : **non suivies** (tout est allé sur `main`
  par commits atomiques). Ne pas « rattraper » ces branches.

---

## 6. Dette technique et suite raisonnable

### 6.1 À ne pas rouvrir

ADR 01–10 (React, MapLibre, FastAPI, SQLite index, simu TS, strangler, Agri v3 +
metadata). Décisions L13 D13-01 à D13-06 (fichiers = vérité, une ferme, pas de
migration `uploads/`, îlots reportés).

### 6.2 Prochaines briques **utiles au champ** (hors gadgets)

1. **Committer** le WIP parcellaire (arbre, landmarks, undo) — le produit réel
   n’est pas sur `origin/main`.
2. **P1.15 / CDC §12** — import GeoJSON (nouvelle parcelle) puis calque d’édition ;
   Shapefile / GPKG ensuite.
3. Handoff réel tablette (checksum déjà là) — hors Studio pur, chaîne iOS privée.
4. Remplir `work_performed/` depuis les logs robot → heures accueil + colonne
   exécuté.
5. Fields2Cover compilé (Ubuntu) pour quitter le repli parallèle.
6. Atelier UX-T01 palette d’outils (productivité, pas de nouvelles géométries).
7. Notice utilisateur courte + test 10 minutes (critère CdC n°1).

### 6.3 Compteurs tests (disque 24/08)

| Suite | Collecté |
|---|---|
| Python | ~384 |
| Vitest | ~479 |

La recette L13 du 20/08 : 368 py / 371 js. La hausse vient surtout du parcellaire
WIP. Relancer `./scripts/check.sh` avant tout commit.

### 6.4 Pièges toujours vrais

- `.env` chargé avec `override=True` : `PORT=` n’override pas le fichier.
- `work_performed` : débloqué en L13 pour le chargement ; rester vigilant au
  `Trajectory.validate()` historique.
- Flags `FEAT_*` souvent à `false` **sans** masquer l’UI Studio : ne pas s’y fier
  comme coupe-circuit.
- Python 3.9 système insuffisant ; 3.12 Homebrew.

---

## 7. Synthèse pour y voir clair

```text
Ambition 17/08     CdC Feature + UX pack + benchmark 10 logiciels
        │
        ▼
Lots L0–L12b       BILAN 19/08 (archive) — moteurs métier dans /studio
        │
        ▼
Recadrage 20/08    Remarques utilisateur → CDC + ROADMAP L13
        │
        ▼
L13 livré 20/08    Recette 13/13 puis ajustements 23/08 (2 onglets parcelle)
        │
        ▼
Aujourd’hui 24/08  CET AUDIT — produit utilisable en préparation ;
                   imports / robot / 3 filières testées encore ouverts ;
                   working tree plus avancé que origin/main
```

**En une phrase :** Mission Studio est déjà un **préparateur de missions SRBC**
crédible à l’écran et sur disque (Agri v3 + GeoJSON + ferme) ; il n’est **pas**
encore le jumeau Operations Center / TraXwise (SIG complet, mobile, exécuté,
flotte), et ce n’était plus l’objectif du lot L13.

Quand vous reprendrez le développement, lire **ce fichier**, puis le CDC L13 §12
(imports), puis le code `mission_studio/` — pas le bilan du 19/08 comme vérité
courante.
