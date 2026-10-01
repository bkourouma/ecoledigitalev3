# Inventaire d'impact (tâche 0.6 du plan)

> Dossier généré. Source : `scripts/inventory/` (Node ≥ 18, aucune dépendance, **lecture seule**, aucune connexion à une base). Plan : `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §4 (Phase 2), §5, tâche 0.6.

## Contenu

| Fichier | Sert à | Produit par |
|---|---|---|
| `tables-usage-matrix.md` / `.json` | pour chaque table : migration d'origine, `tenant_id`, domaine, module cible, fichiers API/web qui la citent (JSON : liste complète dans `refs`) | `build-tables-matrix.mjs` |
| `imhotep-removal-inventory.md` / `.json` | suppression d'Imhotep : A (sans risque) / B (à découpler) / C (à conserver), ordre de suppression | `imhotep-deps.mjs` + `build-imhotep-doc.mjs` (+ `imhotep-notes.mjs`, écrit à la main) |
| `legacy-dependents-by-slice.md` | tranches 2.1 à 2.8 : fichiers qui changent, taille S/M/L, couplages dangereux | `build-slice-dependents.mjs` (+ `slice-notes.mjs`, écrit à la main) |
| `README.md` | ce fichier | `build-readme.mjs` |

## Relancer

```bash
node scripts/inventory/run-all.mjs            # régénère les 4 documents et les 2 JSON
node scripts/inventory/run-all.mjs --check    # n'écrit rien ; code retour 1 si un fichier du dossier est périmé

# étape par étape
node scripts/inventory/build-tables-matrix.mjs     # 1. matrice des tables (prérequis des autres)
node scripts/inventory/imhotep-deps.mjs            # 2. dépendances entrantes vers Imhotep (JSON)
node scripts/inventory/build-imhotep-doc.mjs       # 3. imhotep-removal-inventory.md
node scripts/inventory/build-slice-dependents.mjs  # 4. legacy-dependents-by-slice.md
node scripts/inventory/build-readme.mjs            # 5. ce README

# suivi de la suppression d'Imhotep (après chaque étape de l'ordre de suppression)
node scripts/inventory/imhotep-residue.mjs --list
node scripts/inventory/imhotep-residue.mjs --group tables --expect 0   # code retour 1 si des résidus subsistent
```

Reclasser une table (domaine, module cible, tranche) : éditer `scripts/inventory/inventory.config.mjs` (`TABLE_RULES` ou `OVERRIDES`). Déplacer un fichier entre « A » et « B » : éditer `imhotep.config.mjs` (graines / partagés) ou `imhotep-notes.mjs`. Les sorties changent à chaque commit du dépôt : relancer avant de s'y fier.

## Méthode en bref

- **Tables** : les 156 migrations de `infra/scripts/migrations` sont rejouées dans l'ordre « préfixe numérique puis nom » (les 8 fichiers `*_rollback.sql` / `validate_*` ne sont pas rejoués) en suivant `CREATE TABLE`, `ALTER TABLE … RENAME`, `DROP TABLE`, `ADD/DROP COLUMN tenant_id`, RLS ; l'**état final** compte (plusieurs tables sont supprimées par `0051`/`0055` puis recréées par `0056`). La boucle `DO $$` de `0055_unified_multitenancy.sql` (ajout de `tenant_id` + RLS à toutes les tables existantes) est modélisée explicitement. Sont ajoutés : la chaîne `apps/api/prisma/migrations` (celle que `deploy.sh` exécute), `schema.prisma`, le DDL exécuté depuis le code (`CREATE TABLE IF NOT EXISTS` dans des routes) et les tables citées seulement par des scripts de rollback.
- **Références** : tous les `.ts/.tsx/.js/.mjs/.cjs/.sql` du dépôt (hors `node_modules`, builds, migrations, `docs/`, `specs/`). Un nom de table avec `_` compte pour toute occurrence en mot entier ; un nom d'un seul mot (`users`, `classes`…) ne compte qu'en contexte SQL en MAJUSCULES (`FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES…`) ou via `getTableName(tenant, 'x')`.
- **Web** : le web ne fait pas de SQL. La colonne « web via API » relie table → fichiers API → routes HTTP d'entrée (graphe d'imports + préfixes de `index.ts`) → fichiers web qui contiennent `/api/v1/<préfixe>`. C'est une **borne haute**.

## Résumé chiffré

- **204 tables** dans la matrice : 155 `active`, 34 `prisma-only`, 2 `runtime-ddl`, 13 `rollback-only`. `active` = présente dans l'état final des migrations SQL ; `prisma-only` = connue de la seule chaîne Prisma (23 sans aucune référence dans le code) ; `runtime-ddl` = créée par du code ; `rollback-only` = citée par un script de rollback sans `CREATE` versionné (tables `rso_*`). 32 autres tables ont été créées puis supprimées.
- **Fichiers analysés** : 1705 (api 342, public 92, web 1014, repo-scripts 131, packages 106, tests-root 20). Routes API enregistrées : 96 ; fichiers de routes **non enregistrés** (code mort) : `assignment-instances.ts`, `session-instances.ts`, `sessions.update.ts`, `student-dashboard.ts`.

### Tables par domaine

| Domaine | Tables | dont `prisma-only` / `rollback-only` / `runtime-ddl` | Sans `tenant_id` requis |
|---|--:|---|--:|
| académique-classique | 43 | 3 / 0 / 0 | 0 |
| professionnel | 32 | 0 / 0 / 0 | 0 |
| finance-legacy | 7 | 0 / 0 / 0 | 0 |
| finance-pro | 3 | 0 / 0 / 0 | 0 |
| remuneration | 9 | 2 / 0 / 0 | 0 |
| imhotep | 43 | 22 / 0 / 0 | 6 |
| rso | 27 | 0 / 13 / 0 | 13 |
| owner | 3 | 0 / 0 / 0 | 0 |
| messagerie | 23 | 7 / 0 / 2 | 0 |
| auth/rbac | 9 | 0 / 0 / 0 | 3 |
| audit | 3 | 0 / 0 / 0 | 1 |
| autre | 2 | 0 / 0 / 0 | 1 |
| **Total** | **204** | 34 / 13 / 2 | **24** |

Les domaines ajoutés par rapport à la liste demandée : `remuneration` (paie des enseignants, spec 031, tranche 2.7). `owner` ne contient que les 3 tables de prospection/commissions (l'espace owner n'a pas de table propre : il lit celles des autres domaines).

### Tables sans `tenant_id`

**24 tables sans `tenant_id` NOT NULL** (sur 204) :

- **Colonne absente (9)** : `accounts`, `inscriptions_public`, `live_session_webhook_events`, `public_users`, `super_admin_audit_logs`, `super_admin_users`, `tenants`, `user_sessions`, `verification_tokens`. Légitimes : `tenants`, `super_admin_*` ; à justifier : `live_session_webhook_events` ; les cinq tables du portail public Imhotep (`accounts`, `user_sessions`, `verification_tokens`, `public_users`, `inscriptions_public`) sont globales par construction (disparaissent avec D7).
- **Colonne nullable (2)** : `roles`, `token_blacklist` — tables globales à portée mixte (`0055` : rôles globaux, blacklist de jetons super-admin).
- **Inconnu (13)** : `rso_activites`, `rso_activites_medias`, `rso_activites_pfso_access`, `rso_activity_logs`, `rso_annees`, `rso_documents_exports`, `rso_installation_responsables`, `rso_permissions`, `rso_quotas_utilisateurs`, `rso_recommandations`, `rso_types_activites`, `rso_user_sessions`, `rso_users` — aucun `CREATE TABLE` dans le dépôt (les fichiers `0021_rso_phase1.sql`… ne sont pas versionnés) ; impossible de dire si elles portent `tenant_id`.
- **`tenant_id` présent mais aucune RLS posée par les migrations (8 tables actives)** : `app_whatsapp_delivery_log`, `formateur_indisponibilites`, `formateurs`, `notifications_formateurs`, `session_attendance`, `session_formateurs`, `sessions_professionnelles`, `support_session_associations` — sept d'entre elles sont les tables Imhotep recréées par `0056_restore` APRÈS la boucle RLS de `0055`. À relativiser : l'API se connecte en propriétaire/super-utilisateur, donc la RLS n'isole rien (plan §2 ; en-tête de `0130_rls_professional_bulletins.sql`).

### Les 10 tables les plus couplées

Score = fichiers API d'exécution qui la citent + fichiers web qui la citent + fichiers web appelant les routes qui l'atteignent (borne haute).

| # | Table | Domaine | Module cible | Score | API direct | Web via API | Occurrences API+web |
|--:|---|---|---|--:|--:|--:|--:|
| 1 | `users` | auth/rbac | iam | 341 | 104 | 237 | 445 |
| 2 | `student_profiles` | académique-classique | students-guardians | 279 | 65 | 213 | 291 |
| 3 | `classes` | académique-classique | academic-core | 236 | 50 | 186 | 159 |
| 4 | `student_enrollments` | académique-classique | students-guardians | 220 | 40 | 179 | 151 |
| 5 | `teachers` | académique-classique | teachers-staff | 216 | 56 | 160 | 188 |
| 6 | `courses` | académique-classique | academic-core | 187 | 43 | 144 | 125 |
| 7 | `programmes` | académique-classique | academic-core | 184 | 45 | 139 | 143 |
| 8 | `class_courses` | académique-classique | academic-core | 163 | 31 | 131 | 106 |
| 9 | `teacher_assignments` | académique-classique | teachers-staff | 135 | 20 | 114 | 72 |
| 10 | `academic_years` | académique-classique | academic-core | 134 | 27 | 104 | 98 |

Les dix sont des tables « racines » (utilisateurs, élèves, enseignants, classes, programmes, cours, inscriptions, années) : elles sont citées par des dizaines de fichiers de routes et de services de tous les domaines, ce qui chiffre le coût de l'unification (D2) : toute modification de leur forme touche de ~25 à ~100 fichiers API.

### Imhotep, en chiffres

- 376 fichiers « A » (api 41, public 92, web 191, packages 37, repo-scripts 15 ; 71828 lignes) ; 24 importations entrantes (dont 22 dans deux fichiers d'accroche) ; 0 clé étrangère entrante depuis le cœur ; 26 tables + 17 zombies `_aspci`.
- Voir `imhotep-removal-inventory.md` pour la classification complète et l'ordre de suppression.

## Lire avec précaution

- **Le schéma réel de production n'est pas reconstructible depuis les migrations seules** : la chaîne Prisma crée des tables du cœur absentes de `infra/scripts/migrations` (9 tables utilisées par le code : `bilan_types`, `course_assignments`, `teaching_hours`, `admin_*_messages`, `teacher_student_messages`, `parent_school_conversation*`, `student_period_attendance_summaries`) et le déploiement n'exécute que Prisma. Pour D8 (reset) et la tranche 2.0, partir d'un `pg_dump --schema-only` de la base réelle, pas de ces fichiers.
- Le matching des noms est textuel : les mentions en commentaire comptent, les noms construits dynamiquement échappent (sauf `getTableName`). Les domaines et modules cibles viennent de règles (`inventory.config.mjs`), pas d'une lecture fichier par fichier : vérifier les cas limites dans `tables-usage-matrix.md`.
- `imhotep-removal-inventory.md` §5 répond point par point aux vérifications demandées par le plan §5.2 ; `legacy-dependents-by-slice.md` donne par tranche les couplages dangereux avec `fichier:ligne`.
