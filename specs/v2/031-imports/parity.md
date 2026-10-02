# Parité — imports (031-imports)

**Sources lues.** `docs/PRD_EcoleDigitale_SaaS.md` §56-57 ; legacy : recherche de toute fonction d'import (`grep -i` xlsx / exceljs / csv / bulk / multipart dans `apps/api/src/routes` et `services`) ; `docs/inventory/imhotep-removal-inventory.md` (exceljs). Spécifications amont qui annoncent 031 : 004 (`enrollStudentsBulk`), 008 (`createStudent` : `externalRef`, `validateOnly`), 009 (`externalRef` du personnel), 010 (E-09, E-10), 011 (API en lot des notes), 017 (R17 : minutes entières), 004 §Q-17 (matricules existants).

**Légende des statuts.** `conservé` = comportement repris ; `amélioré` = repris en corrigeant un défaut ; `nouveau` = absent du legacy ; `hors module -> NNN` = relève d'une autre spec ; `abandonné` = non repris, avec justification.

## 1. Constat du legacy

Le legacy n'a **aucune fonction d'import** de fichier. Seules traces : `POST /enrollments/bulk` (`routes/professional.ts`, inscription en lot d'élèves DÉJÀ créés, JSON) et un export Excel (`exceljs`, Imhotep, supprimé). La reprise de données de production n'est pas un objectif (décision D8 du plan : reset possible) : 031 sert l'onboarding et la saisie en masse, pas la migration de lignes.

## 2. Inventaire fonctionnel

| ID | Comportement | Source | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| I-01 | Inscrire plusieurs élèves déjà créés dans une classe | `routes/professional.ts` `/enrollments/bulk` | hors module -> 004 | `academic.enrollStudentsBulk` | l'importeur d'élèves inscrit à la création (colonne « Classe ») par `enrollStudent`, ligne à ligne, avec rapport |
| I-02 | Importer des élèves depuis Excel / CSV | (absent) | nouveau | importeur `students` | PRD §57 ; idempotent par matricule d'origine (`externalRef`) |
| I-03 | Importer parents / tuteurs et liens | (absent) | nouveau | importeur `guardians` | un tuteur de plusieurs enfants n'est créé qu'une fois |
| I-04 | Importer enseignants / personnel | (absent) | nouveau | importeur `staff` | ni tarif ni salaire (hors périmètre de `people`) |
| I-05 | Importer des classes | (absent) | nouveau | importeur `classrooms` | programme et niveau par code (référentiels d'`academic`) |
| I-06 | Importer des matières et noeuds de curriculum | (absent) ; 004 A-174 (« lot par transaction de l'import 031 ») | nouveau | importeur `curriculum` | version en brouillon seulement ; coefficients et crédits repris tels quels |
| I-07 | Importer des notes (ABS / ABJ / DISP) | (absent) ; 011 §import | nouveau | importeur `grades` | **aucun calcul** ; `saveGrades` contrôle barème et décimales |
| I-08 | Importer des soldes d'ouverture | (absent) | nouveau | importeur `opening_balances` | montants entiers XOF ; MFA ; factures et avoirs de reprise |
| I-09 | Assistant en 7 étapes (Upload, Mapping, Validation, Erreurs, Preview, Import, Rapport) | PRD §57 | nouveau | cadre générique | un seul parcours pour tous les importeurs |
| I-10 | Mapping automatique des colonnes et modèles enregistrés | (absent) | nouveau | `domain/mapping.ts`, `imports.mapping_templates` | proposition à >= 80 % d'en-têtes retrouvés |
| I-11 | Rapport d'erreurs téléchargeable | (absent) | nouveau | CSV / XLSX neutralisés | injection de formule neutralisée (OWASP) |
| I-12 | Onboarding : étapes « Importer élèves / enseignants » | PRD §56 ; `tenancy` | amélioré | `tenancy.onboarding-on-import-completed` | complétion par événement, idempotente |
| I-13 | Reprise des matricules existants | 004 O-17 / Q-17 ; 008 §Q-17 | amélioré | colonne « Matricule d'origine » -> `externalRef` | le matricule de la plateforme (sans trou) est attribué par `people` ; l'ancien reste la référence du fichier |
| I-14 | Durée en heures décimales -> minutes entières | 010 E-09 ; 017 R17 | hors module -> 017 / 032 | — | aucun importeur d'horaires en v1 (non demandé) |
| I-15 | Justificatif de reprise pour les absences legacy | 010 E-10 | hors module -> 010 | — | aucun importeur d'assiduité en v1 |

## 3. Défauts à ne pas reproduire (constatés dans les imports habituels)

| Défaut classique | Traitement v2 |
|---|---|
| Fichier lu en entier en mémoire, sans plafond | Lecture en flux, plafonds (lignes, colonnes, taille, cellule, archive) |
| Type déduit du nom ou du `Content-Type` | Type réel contrôlé sur les octets ; incohérence refusée |
| Zip-bomb / entités XML | Annuaire du ZIP inspecté, décompression comptée, DTD refusées |
| Formules évaluées, macros exécutées | Valeur en cache, jamais de recalcul ; macros ignorées |
| Injection de formule dans les exports d'erreurs | Neutralisation de toute valeur commençant par `=`, `+`, `-`, `@`, tabulation, retour chariot |
| Import synchrone dans la requête HTTP | Worker, lots, reprise, annulation |
| « Tout ou rien » simulé par des suppressions | Une transaction ; rien n'est écrit en cas d'échec |
| Doublons à chaque rejeu | Clé naturelle + `externalRef` / clé d'idempotence + table `entity_refs` |
| SQL direct dans les tables des autres modules | Ports -> API publique -> règles, audit et événements du module cible |
| Permission unique « admin » | `imports.*` ET permissions du module cible ; MFA pour les soldes |
| Montants décimaux arrondis en silence | Entiers XOF ; `1500,5` refusé (`imports.amount_not_integer`) |
| Dates ambiguës (`03/04/12`) devinées | Année à deux chiffres refusée ; formats explicites |

## 4. Synthèse chiffrée

15 lignes : 8 nouveaux, 2 améliorés, 3 hors module, 0 abandonné, 2 renvoyés (I-14, I-15).
