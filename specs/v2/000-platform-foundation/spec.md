# Feature Specification: Fondation de la plateforme (000-platform-foundation)

**Feature Branch**: `000-platform-foundation`

**Created**: 2026-10-01

**Status**: Squelette — à relire et compléter avant `/speckit.plan`

**Sources**: `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §3.1–3.4, §3.9, §3.15, §4 (Phase 0 et Phase 1 piste A, étapes 1, 2 et 8), §7. Décisions D3, D8 et D9. Les décisions D1–D9 du plan §1 font foi.

> Les passages marqués **[À trancher]** renvoient à un point ouvert du plan (§8) ou à un ADR non encore rédigé. Aucune valeur n'est inventée pour les combler.

## 1. Objectifs

Poser les fondations techniques sur lesquelles toutes les specs v2 reposent, et les rendre **vérifiables automatiquement** (garde-fous de CI) plutôt que déclaratives :

1. Un **modular monolith** : squelette `apps/api/src/modules/*`, `packages/kernel`, registre de modules alimenté par des manifestes.
2. Une **base v2 réellement isolée par tenant** : deux rôles Postgres (`migrator`, `app_user` sans `BYPASSRLS`), `TenantDb.run(ctx, fn)`, `enable_tenant_rls()`, runner de migrations à checksum.
3. Une **infrastructure asynchrone** : `apps/worker`, Redis, outbox transactionnelle `domain_events`.
4. Une **observabilité et une CI de base** : logs structurés, `health`/`ready`, pipeline typecheck + lint + tests + build, déploiement conditionné au vert.
5. Les **principes du plan §3.1 transformés en tests bloquants** (isolation tenant, frontières de modules, absence de règle académique codée en dur, contrats Zod avant routes, audit, couverture des calculs, feature flags).

## 2. Périmètre

### Inclus

- `packages/kernel` : contexte de requête, erreurs / `Result`, bus d'événements, identifiants (UUID), `money` (entiers), `clock`, `logger`.
- `packages/database` : runner de migrations SQL à checksum, `TenantDb`, `SystemDb` explicite et audité, helpers RLS.
- Squelette `modules/*` (`index.ts`, `manifest.ts`, `domain/`, `application/`, `infrastructure/`, `http/`) et registre de modules (permissions, menus, features, packs, événements publiés/consommés).
- Règles `dependency-cruiser` et lints de garde-fou.
- `apps/worker` + Redis (ajout au compose) + outbox + relais vers BullMQ ; retrait progressif des `setInterval` du process API.
- Logs `pino` (`request_id`, `tenant_id`, `user_id`), OpenTelemetry (API + worker), endpoints `health` et `ready`.
- Validation d'environnement par Zod : démarrage refusé sans secrets obligatoires.
- Workflow GitHub Actions : install, typecheck, lint, tests unitaires, tests d'intégration sur Postgres jetable, build ; déploiement uniquement si tout est vert.
- Conventions : UUID partout, montants en entiers, horodatages en UTC (affichage `Africa/Abidjan`), `CountryProfile` en table (le contenu est porté par 003).

### Exclu (renvoyé à d'autres specs)

| Sujet | Spec |
|-------|------|
| Plans, packs, entitlements, console super-admin, provisioning | 001-saas-core |
| Sessions, refresh, MFA, rate limiting, RBAC, rôles et périmètres | 002-auth-rbac |
| Hiérarchie tenant → établissement → campus, `CountryProfile` (contenu) | 003-organization-campus |
| Module `audit` générique (append-only, avant/après) et revue de sécurité | 030-security-audit |
| Route groups web, `TenantProvider`, client API typé, sidebar générée, i18n, PWA | 033-web-foundation |
| Modèle Finance (Fee, Invoice, Payment…) | 014-finance, 015-payments |
| Migration du cœur académique existant | 004 et suivantes (Phase 2) |

### Hors périmètre du plan

Microservices ; NestJS et Prisma (décision D3) ; sauvegarde, reset de base et suppression d'Imhotep (tâches 0.7 et 5.2 du plan, soumises à confirmation explicite au moment de l'exécution).

## 3. Acteurs

| Acteur | Rôle vis-à-vis de cette spec |
|--------|------------------------------|
| Développeur / développeuse | Écrit les modules selon la structure imposée ; s'appuie sur les garde-fous de CI |
| Relecteur | Vérifie la conformité aux principes (constitution, section « Principes EcoleDigitale SaaS ») |
| Pipeline CI | Exécute les contrôles bloquants (§7 du plan) |
| Opérateur / DevOps | Déploie, surveille (`health`/`ready`, logs, traces), restaure |
| Super-admin plateforme | Utilise `SystemDb` pour les opérations transverses, toujours auditées |
| Module métier (consommateur) | Utilise `TenantDb`, le bus d'événements et le registre de modules |

## 4. User Stories et critères d'acceptation

### US1 — Isolation réelle des tenants en base (priorité P1)

En tant que développeur, je veux que l'accès SQL passe exclusivement par `TenantDb` sous un rôle sans privilège de contournement, afin qu'un oubli de `WHERE tenant_id` ne puisse jamais fuiter des données.

- **AC1.1** L'API se connecte uniquement avec `app_user` (`NOBYPASSRLS`, non propriétaire des tables). Un test vérifie `rolbypassrls = false` et `rolsuper = false` pour la connexion de l'API.
- **AC1.2** `TenantDb.run(ctx, fn)` ouvre une transaction, exécute `SET LOCAL app.tenant_id = <uuid>`, et fournit un client. Hors transaction, `current_setting('app.tenant_id', true)` est vide.
- **AC1.3** `enable_tenant_rls('schema.table')` pose `ENABLE` + `FORCE` ROW LEVEL SECURITY, **une seule** policy, et un index sur `tenant_id`.
- **AC1.4** Test d'isolation générique : pour 100 % des tables hors liste blanche, connecté comme tenant A, aucune lecture, mise à jour ou suppression de ligne du tenant B n'est possible, et un `INSERT` avec le `tenant_id` de B est refusé. Le test échoue si une nouvelle table n'est ni conforme ni en liste blanche.
- **AC1.5** Toute table hors liste blanche a `tenant_id NOT NULL`. La liste blanche (tables globales) est un fichier versionné ; tout ajout est revu.
- **AC1.6** Il n'existe plus de monkey-patching de `pg.query` ni de fallback silencieux en super-utilisateur dans le code des nouveaux modules (vérifié par lint).

### US2 — Squelette de module et frontières (priorité P1)

En tant que développeur, je veux créer un module à partir d'une structure imposée, afin que les dépendances restent contrôlées.

- **AC2.1** Un module contient `index.ts`, `manifest.ts`, `domain/`, `application/`, `infrastructure/`, `http/` ; un script de génération produit ce squelette en une commande.
- **AC2.2** `dependency-cruiser` échoue en CI si un module importe autre chose que l'`index.ts` public d'un autre module, si une route importe un repository, ou si `domain/` importe `infrastructure/`.
- **AC2.3** Aucune requête SQL dans `http/` : contrôlé par règle de lint.
- **AC2.4** Le registre de modules agrège les manifestes ; un test échoue si un module n'a pas de manifeste valide (clé, packs, permissions, features, menus, événements).
- **AC2.5** Chaque module possède son schéma Postgres ; aucune requête SQL directe vers le schéma d'un autre module (contrôle par lint ou test sur les noms de schéma).

### US3 — Migrations reproductibles (priorité P1)

En tant qu'opérateur, je veux appliquer les migrations de façon déterministe et détecter toute modification d'une migration déjà appliquée.

- **AC3.1** Le runner applique les fichiers SQL dans l'ordre, dans une transaction par fichier, avec enregistrement du checksum.
- **AC3.2** Modifier une migration déjà appliquée fait échouer le runner avec un message en français nommant le fichier.
- **AC3.3** Les migrations s'exécutent avec le rôle `migrator` ; `app_user` ne peut pas exécuter de DDL (test).
- **AC3.4** Une base vide + toutes les migrations v2 aboutit au même schéma que l'application incrémentale (test d'intégration).
- **AC3.5** Le script de déploiement ne dépend plus de Prisma ni de `_prisma_migrations` pour le schéma v2. **[À trancher]** : moment exact de la suppression de Prisma (liée à la suppression d'Imhotep, décision D7).

### US4 — Événements fiables et jobs asynchrones (priorité P2)

En tant que module métier, je veux publier un événement dans la même transaction que ma donnée, afin qu'il soit livré au moins une fois sans incohérence.

- **AC4.1** `domain_events` est écrite dans la transaction de la donnée ; si la transaction est annulée, aucun événement n'est publié (test).
- **AC4.2** Un relais pousse les événements vers BullMQ ; un événement n'est marqué traité qu'après succès du consommateur ; les consommateurs sont idempotents (clé d'événement).
- **AC4.3** `apps/worker` démarre avec Redis du compose ; l'arrêt de Redis n'empêche pas l'API de répondre (les événements s'accumulent dans l'outbox).
- **AC4.4** Aucun nouveau `setInterval` dans le process API ; les tâches planifiées sont des jobs répétables.
- **AC4.5** Les jobs utilisent `SystemDb`, dont chaque ouverture est journalisée avec le motif.

### US5 — Observabilité et exploitation (priorité P2)

En tant qu'opérateur, je veux diagnostiquer un incident à partir d'un `request_id`.

- **AC5.1** Chaque ligne de log de l'API et du worker contient `request_id`, `tenant_id` (quand connu) et `user_id` (quand connu), au format JSON `pino`.
- **AC5.2** `GET /health` répond 200 si le process est vivant ; `GET /ready` répond 200 uniquement si Postgres et Redis répondent, 503 sinon.
- **AC5.3** Une requête API produit une trace OpenTelemetry reliée au job du worker qu'elle déclenche.
- **AC5.4** Démarrage refusé, avec message explicite, si `JWT_SECRET`, `NEXTAUTH_SECRET` ou une chaîne de connexion obligatoire est absente ; aucune valeur par défaut de secret dans le code (validation Zod de l'environnement).

### US6 — CI bloquante (priorité P1)

En tant que responsable technique, je veux que `main` ne soit déployé que si les garde-fous passent.

- **AC6.1** Le workflow exécute : install, typecheck, lint, tests unitaires, tests d'intégration sur Postgres jetable, build ; le déploiement dépend de leur succès.
- **AC6.2** Les contrôles de §5 (garde-fous) sont tous bloquants : isolation tenant, `dependency-cruiser`, lint des constantes de seuils académiques, présence de contrat Zod, présence d'audit sur opération sensible, couverture, `requireFeature`.
- **AC6.3** La CI échoue sur un secret détecté dans le dépôt (scan de secrets).
- **AC6.4** Le temps total de la CI sur une PR courante est mesuré et publié ; objectif à fixer. **[À trancher]**

## 5. Règles métier (principes du plan §3.1 rendus vérifiables)

| # | Principe | Garde-fou automatisé (bloquant) |
|---|----------|----------------------------------|
| R1 | Multi-tenant dès le premier jour | Test CI : toute table hors liste blanche a `tenant_id NOT NULL` + RLS forcé ; test d'isolation tenant A/B |
| R2 | Aucune règle académique codée en dur | Lint : interdiction de constantes de seuils dans `modules/**` hors `rules-engine` |
| R3 | Modular monolith | `dependency-cruiser` : un module n'importe que l'`index.ts` public d'un autre module |
| R4 | API first | Contrats Zod dans `packages/contracts` avant toute route ; client typé généré |
| R5 | Audit des opérations sensibles | Décorateur / use case obligatoire sur notes, finance, rôles ; test qui échoue si absent |
| R6 | Tests obligatoires sur calculs | Seuil de couverture sur `rules-engine` et `finance` ; golden tests |
| R7 | Feature flags / entitlements | Toute route de pack est gardée par `requireFeature(...)` |

Règles complémentaires (plan §3.3, §3.4, §3.9) :

- R8 : route → use case → repository ; aucune requête SQL dans une route.
- R9 : deux rôles Postgres ; l'API n'utilise jamais `migrator`.
- R10 : UUID partout ; montants en **entiers** (XOF sans sous-unité) ; horodatages en UTC.
- R11 : pas de secret dans le dépôt ; démarrage refusé sans secrets.
- R12 : les jobs passent par `SystemDb`, jamais par un repli silencieux en super-administrateur.

## 6. Modèle de données

Schémas et objets créés par cette spec (les tables métier appartiennent aux autres specs) :

| Objet | Contenu | Remarques |
|-------|---------|-----------|
| Rôles `migrator`, `app_user` | DDL / accès applicatif | `app_user` : `NOBYPASSRLS`, jamais propriétaire |
| Fonction `enable_tenant_rls(regclass)` | `ENABLE` + `FORCE` RLS, policy unique, index `tenant_id` | Seule policy autorisée (fin des deux styles `app.tenant_id` / `app.current_tenant_id`) |
| Réglage `app.tenant_id` | `SET LOCAL` par transaction | Posé uniquement par `TenantDb` |
| Table de migrations | `filename`, `checksum`, `applied_at`, `applied_by` | Remplace `_prisma_migrations` pour v2 |
| `domain_events` (outbox) | `id` UUID, `tenant_id`, `type`, `payload` JSONB, `occurred_at`, `processed_at`, `attempts`, `error` | Écrite dans la transaction de la donnée |
| Liste blanche des tables globales | Fichier versionné | Lue par le test d'isolation |

**[À trancher]** (ADR-005) : typage SQL — génération des types depuis le schéma (`kysely-codegen`) ou types de ligne écrits à la main ; décision à prendre sur un spike d'une demi-journée. Le schéma `audit` et la table `audit_log` relèvent de 030-security-audit.

## 7. Endpoints

| Méthode | Chemin | Description | Authentification |
|---------|--------|-------------|------------------|
| GET | `/health` | Process vivant | Aucune |
| GET | `/ready` | Dépendances (Postgres, Redis) | Aucune |

Aucune autre route métier n'est créée par cette spec. Toute route nouvelle des autres specs : contrat Zod dans `packages/contracts` d'abord (R4).

## 8. Écrans

Aucun écran applicatif. Livrables visibles : rapport de CI (statut des garde-fous), journal des logs et traces, résultats du test d'isolation. Les écrans de la console super-admin relèvent de 001-saas-core.

## 9. Permissions

Aucune permission métier créée ici. Cette spec définit le **mécanisme** : le manifeste d'un module déclare ses permissions `resource.action` ; le registre les agrège ; `requirePermission(...)` est fourni par 002-auth-rbac. Le registre expose une API de lecture interne seulement.

## 10. Événements

| Événement | Producteur | Consommateurs prévus |
|-----------|------------|----------------------|
| `platform.event.dead-lettered` | worker | exploitation / alerte |
| `platform.job.failed` | worker | exploitation / alerte |

Le contrat de l'enveloppe d'événement (identifiant, type, `tenant_id`, `occurred_at`, `payload`, version) est défini ici ; les événements métier sont déclarés par chaque module dans son `manifest.ts`.

## 11. Tests

- **Isolation tenant** (bloquant) : test générique sur toutes les tables, avec liste blanche explicite.
- **Frontières de modules** (bloquant) : `dependency-cruiser`.
- **Intégration** : Postgres jetable (Testcontainers) — migrations, `TenantDb`, outbox, rôles.
- **Unitaires** (Vitest) : `kernel` (Result, money, clock, ids), validation d'environnement, enveloppe d'événements.
- **Audit** : le test qui échoue si une opération sensible n'écrit pas dans `audit_log` est livré ici comme mécanisme, activé module par module.
- **Sécurité** : scan de secrets et de dépendances.
- **Couverture** : seuils sur `rules-engine` et `finance` configurés dès cette spec. **[À trancher]** : valeurs des seuils.

## 12. Cas limites

- Table créée sans `enable_tenant_rls()` : la CI échoue, la migration ne passe pas.
- Table réellement globale (référentiels) : ajout à la liste blanche, avec justification en revue.
- Transaction `TenantDb` sans tenant (appel système) : refusée ; seul `SystemDb` est autorisé, avec motif.
- Pool de connexions réutilisé : `SET LOCAL` expire en fin de transaction, aucune fuite entre requêtes (test).
- Redis indisponible : l'API répond, `/ready` renvoie 503, l'outbox conserve les événements, le relais reprend sans doublon.
- Événement livré deux fois : le consommateur est idempotent.
- Migration modifiée après application : échec explicite (AC3.2).
- Démarrage avec secret manquant ou valeur par défaut connue : échec explicite.
- Anciennes tables et code (v1) coexistant avec v2 pendant la Phase 2 : le test d'isolation s'applique aux schémas v2 ; la couverture de l'ancien code est traitée par tranche (plan §4, Phase 2). **[À trancher]** : périmètre exact du test d'isolation sur les tables héritées.

## 13. Dépendances

- **En amont** : décisions D1–D9 validées ; tâches 0.2 (Spec Kit `specs/v2`, faite avec cette spec), 0.3 (ADR-001, 002, 004, 005, 006, 007), 0.4 (sécurité immédiate), 0.5 (CI de base), 0.7 (sauvegarde avant toute suppression).
- **En aval** : toutes les specs v2. 001, 002, 003, 030 et 033 s'appuient directement sur ce socle.
- **Technique** : PostgreSQL 14+, Redis (à ajouter au compose), BullMQ, `pino`, OpenTelemetry, `dependency-cruiser`, Vitest, Testcontainers.
- **Points ouverts du plan (§8)** concernant cette spec : capacité de l'équipe (n°1), source des textes réglementaires (n°5, hors 000).

## 14. Critères de sortie (mesurables)

La spec est terminée lorsque :

1. Le test d'isolation générique passe en CI avec **deux tenants de test (A et B)** et zéro fuite en lecture comme en écriture.
2. `dependency-cruiser` et les lints de garde-fou tournent en CI et sont bloquants ; une violation volontaire de test les fait échouer.
3. La base v2 se construit de zéro avec `migrator`, et l'API démarre avec `app_user` uniquement.
4. Un événement publié dans une transaction est consommé par le worker ; annulé avec la transaction, il n'est pas publié.
5. `/health` et `/ready` répondent comme attendu, et un `request_id` retrouve la requête dans les logs de l'API et du worker.
6. L'API refuse de démarrer sans secrets obligatoires ; le scan de secrets est vert.
7. Le workflow de CI conditionne le déploiement au vert.
