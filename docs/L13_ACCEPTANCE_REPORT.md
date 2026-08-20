# Rapport de recette — lot L13

Date : 20 août 2026  
Base auditée : `main` à partir de `3b928a8`, complétée localement par la documentation
T13.18.

## Résultat

Les **13 critères sont vérifiés**. Les critères relatifs au nombre d’onglets s’entendent
en mode avancé : le mode basique en masque volontairement certains conformément au §8.

| # | État | Vérification |
|---:|---|---|
| 1 | **Vérifié** | `MODULES` contient six entrées dans l’ordre Accueil, Mission, Parcelle, Matériel, Simulation, Administration. Le rail conserve Aide, Synchronisation et Profil en bas. Couverture : `studio-shell.test.ts`. |
| 2 | **Vérifié** | `/publication → /missions`, `/rapports → /simulation`, `/integrations → /materiel`, y compris avec slash final. Couverture : `studio-shell.test.ts`. |
| 3 | **Vérifié** | Les panneaux de module n’embarquent plus une seconde navigation globale. Les listes restantes sont contextuelles au module (missions, parcelles, véhicules/outils). Contrôle statique dans `home-dashboard.test.tsx`. |
| 4 | **Vérifié** | L’accueil présente hectares, heures réalisées, missions prêtes et combinaisons, plus Reprendre, alertes et actions rapides. Sans journal robot, les heures valent `—`, jamais `0`. Couverture : `home-dashboard.test.tsx`. |
| 5 | **Vérifié** | En mode avancé, Mission expose Créer, Éditer, Charger, Méta-mission, Comparer et Publier ; Méta-mission et Comparer sont visibles et désactivés. En mode basique, Éditer est masqué par décision §8. Couverture : `mission-panel.test.tsx`, `ui-mode.test.tsx`. |
| 6 | **Vérifié** | En mode avancé, Parcelle expose quatre onglets avec Naviguer par défaut. Sélectionner une parcelle demande un ajustement de carte à son emprise. Les onglets 3 et 4 sont masqués en mode basique. Couverture : `fields-panel.test.tsx`, `ui-mode.test.tsx`. |
| 7 | **Vérifié** | L’inspecteur interroge les missions de la parcelle, distingue ordre et travail réalisé et charge le fichier choisi dans l’éditeur. Couverture : `field-missions.test.tsx` et API `test_l13_farm_api.py`. |
| 8 | **Vérifié** | Simulation expose Configurer, Résultats et Rapport. Le détail des groupes de contrôle vit dans `SimulationPanel`; le tiroir bas ne conserve que résumé, timeline et lien vers les résultats. Couverture : `simulation-panel.test.tsx`. |
| 9 | **Vérifié** | Administration ouvre une ferme existante ou en crée une dans un dossier vide, puis recharge ferme, parcelles, matériel, publications et missions sans rechargement de page. Couverture : `admin-panel.test.tsx`, `test_l13_farm_api.py`. |
| 10 | **Vérifié** | `farm.json.ui_mode` pilote réellement les transformations, l’arbre de mission, l’onglet Éditer, l’édition ODD et les onglets Parcelle 3/4. Les outils de création restent visibles et un lien mène à Administration. Couverture : `ui-mode.test.tsx`. |
| 11 | **Vérifié** | L’index est dérivé. Le test supprime `.studio/`, reconstruit puis compare toutes les lignes indexées ; le résultat est identique. Couverture : `test_l13_farm_index.py::test_deleting_the_studio_folder_rebuilds_an_identical_state`. |
| 12 | **Vérifié** | Le modèle accepte `work_performed`, l’API lit ces fichiers, les explorateurs les listent et un clic les charge. Couverture : `test_trajectory_model.py`, `test_l13_farm_api.py`, `field-missions.test.tsx`, `simulation-panel.test.tsx`. |
| 13 | **Vérifié** | `./scripts/check.sh` est vert. Le smoke test démarre le serveur legacy sans `BACKEND_FASTAPI`, vérifie `/app`, ses ressources et `/api/trajectories`, puis vérifie séparément `/studio`. |

## Compteurs de la recette finale

- Python : **368 réussis**, **3 ignorés** (371 collectés).
- JavaScript / TypeScript : **371 réussis** dans **39 fichiers**.
- Ruff, Prettier, ESLint, TypeScript et build Vite : réussis.
- Smoke legacy : `/app` répond 200, charge `TrajectoryEditor.js` et ne charge pas le
  bundle V2 par défaut.
- Smoke Studio : `/studio`, ses ressources et le catalogue du design system répondent
  correctement.

## Hors lot confirmé

La recette n’ouvre pas les développements explicitement reportés : méta-missions,
comparaison multi-missions, synchronisation robot, compte/abonnement, assistant LLM,
îlots, imports KML/Shapefile/GeoPackage, visuels 3D, thème sombre peint, flotte
multi-robots et actions à la plante.
