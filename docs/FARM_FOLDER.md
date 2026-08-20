# Dossier de ferme

Le logiciel travaille sur **un dossier de ferme à la fois**. Ce dossier est portable : le
même arborescence sert au bureau et, plus tard, au robot. Changer de dossier, c’est
changer de ferme.

```
<FARM_ROOT>/
  farm.json
  parcel_map/          GeoJSON des parcelles (le nom suit le file_type Agri)
  mission_order/       missions à exécuter (JSON Agri)
  work_performed/      traces de travail déjà réalisées (JSON Agri)
  equipment/           fichiers srbc.equipment/1 + PNG d’icône optionnel
  .studio/             index régénérable — on peut le supprimer sans perdre de données
```

Le détail de `farm.json`, du nommage des missions et de `.studio/` sera complété avec le
lot L13. Cette page documente d’abord le **format d’import de matériel**.

## Format `srbc.equipment/1`

Un fichier = **un véhicule ou un outil**. Les combinaisons véhicule + outil se construisent
dans l’onglet Matériel : ce sont des associations, pas du matériel.

ISOXML, URDF et AEF ont été écartés : ils décrivent des tâches, des maillages robotiques
ou de l’ISOBUS, pas un gabarit d’outil qu’un fabricant peut écrire à la main.

```json
{
    "schema": "srbc.equipment/1",
    "kind": "implement",
    "id": "bineuse-180",
    "name": "Bineuse 180",
    "manufacturer": "Exemple SAS",
    "hitch_mode": "mounted",
    "length_m": 1.2,
    "width_m": 1.8,
    "working_width_m": 1.65,
    "drawbar_length_m": null,
    "mass_kg": 210,
    "icon": "bineuse-180.png"
}
```

Placez le JSON dans `equipment/`. Un PNG **du même nom** (`bineuse-180.png`) peut
accompagner le fichier : c’est l’icône. L’image n’est pas embarquée dans le catalogue
interne ; elle reste un fichier à côté du JSON.

### Champs

| Champ                 | Véhicule                          | Outil                        | Notes                                                                           |
| --------------------- | --------------------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| `schema`              | obligatoire, `"srbc.equipment/1"` | idem                         | Toute autre valeur est rejetée avec le nom du champ.                            |
| `kind`                | `"vehicle"`                       | `"implement"`                | Pas de `"combination"`.                                                         |
| `id`                  | identifiant stable                | idem                         | Réutilisé à l’import si le catalogue l’accepte.                                 |
| `name`                | affiché                           | affiché                      |                                                                                 |
| `manufacturer`        | optionnel                         | optionnel                    | Conservé dans le fichier, pas dans le jumeau interne.                           |
| `kinematics`          | `"skid_steer"` ou `"ackermann"`   | —                            | Obligatoire pour un véhicule.                                                   |
| `hitch_mode`          | —                                 | `"mounted"` ou `"trailed"`   | Porté → outil `tool` ; traîné → `trailer`.                                      |
| `length_m`, `width_m` | hors-tout, mètres                 | hors-tout (largeur physique) | Strictement positifs.                                                           |
| `working_width_m`     | `null`                            | bande travaillée             | Obligatoire pour un outil.                                                      |
| `drawbar_length_m`    | `null`                            | timon, ou `null`             | Utile surtout si `trailed`.                                                     |
| `mass_kg`             | optionnel                         | optionnel dans le JSON       | Le jumeau véhicule porte la masse ; l’outil ne la stocke pas encore en interne. |
| `icon`                | nom de fichier PNG                | idem                         | Optionnel.                                                                      |

Un fichier invalide doit dire **quel champ** corriger (schéma, `kind`, nombre, enum),
jamais un simple « erreur de parsing ».
