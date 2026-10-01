# Créer un nouveau module backend — pas à pas

Ce guide accompagne `pnpm module:new`. Il complète `module-conventions.md` (les règles, normatives) et `platform-assembly.md` (ce qui se passe entre les modules). Le générateur produit un squelette qui **passe tel quel** toutes les barrières de la plateforme ; votre travail consiste à remplacer l'exemple (`item`) par le vrai modèle sans casser ces barrières.

Barrières (toutes bloquantes en CI) : `pnpm check:boundaries`, `tsc` (`type-check:v2`), tests du module, `pnpm test:isolation`, chargement par le registre.

## 1. Générer

```bash
pnpm install
pnpm module:new facturation            # plage de migrations = prochaine plage libre du tableau de module-conventions.md
pnpm module:new facturation --range 1700   # impose le début de la plage (multiple de 100, >= 1600, libre)
```

La clé est le nom du dossier, du schéma Postgres, des permissions (`facturation.*`) et des événements (`facturation.*`) : minuscules, chiffres et `_`, 2 à 30 caractères, commençant par une lettre. Les clés `kernel`, `public`, `pg_*`… sont réservées.

Le générateur :

1. crée `apps/api/src/modules/<clé>/` (voir §2) et `apps/api/src/modules/isolation-allowlist.<clé>.ts` ;
2. réserve 100 numéros de migration, nomme la migration initiale `<NNNN>_<clé>_init.sql` dans cette plage ;
3. **ajoute la ligne de plage** au tableau de `docs/architecture/module-conventions.md` (et décale la ligne ouverte `NNNN+`) : committez ce changement avec le module ;
4. refuse d'écraser un module existant, une plage prise ou une migration déjà numérotée dans cette plage — sans rien écrire.

Aucun fichier central à modifier : le registre découvre `modules/*/manifest.ts`, le worker `subscribers.ts` / `jobs.ts`, le test d'isolation `isolation-allowlist.<clé>.ts`.

> Vérifiez immédiatement que tout est vert avant de modifier quoi que ce soit (§6) : si une barrière échoue ensuite, c'est votre changement qui en est la cause.

## 2. Ce qui est généré

| Fichier | Rôle |
|---|---|
| `manifest.ts` | permissions, features, menus, événements publiés/consommés (source de vérité) |
| `index.ts` | API publique : le **seul** fichier que les autres modules ont le droit d'importer |
| `migrations/<NNNN>_<clé>_init.sql` | schéma, table de tenant d'exemple, RLS, droits `app_user` |
| `domain/` | règles pures (`item.ts`), événements (`events.ts`) : aucun import `pg` / `fastify` / infrastructure |
| `application/` | cas d'usage `(deps, ctx, input) => Result` (`items.ts`) et ports (`ports.ts`, dont `AuditPort`) |
| `infrastructure/` | SQL via le `Tx` de `TenantDb` (`item-repository.ts`) |
| `http/plugin.ts` | `export default async function (app, runtime)` — routes **sans préfixe** ; `setup(app, runtime)` facultatif (commenté) |
| `http/schemas.ts` | schémas Zod des entrées HTTP |
| `subscribers.ts`, `jobs.ts` | abonnés / jobs du worker : `export default []` + exemple commenté |
| `test/<clé>.test.ts` | unitaires sans base : manifeste, domaine, use case (doublures), plugin chargé **par le registre** |
| `test/<clé>.integration.test.ts` | Postgres réel : `assertTenantIsolation`, isolation A/B, outbox, rollback si l'audit échoue |
| `test/support/` | `fakes.ts` (TenantDb/Tx/audit factices), `db.ts` (base jetable + rôle `app_user`) |
| `README.md` | fiche du module à réécrire |
| `../isolation-allowlist.<clé>.ts` | tables **globales** justifiées — vide : toutes les tables du squelette sont des tables de tenant |

Contrat d'assemblage appliqué par le squelette (voir `platform/runtime.ts`) :

| Besoin | Mécanisme |
|---|---|
| Routes | `export default async function (app, runtime: ModuleRuntime)`, sans préfixe ; le registre applique `/api/v1/<clé>`, le gestionnaire d'erreurs du kernel et la garde « contexte présent » (401) |
| Permissions | `preHandler: runtime.requirePermission("<clé>.<ressource>.<action>")` (jamais de rôle codé en dur) |
| Features | `runtime.entitlements.requireFeature("<clé>.<feature>")` ou `isFeatureEnabled(ctx, key)` |
| Audit | `runtime.auditPort.record(tx, …)` — injecté dans les `deps` du use case, appelé **en dernier** dans la transaction |
| Événements | `new PgOutboxWriter(tx).append([createDomainEvent(...)])`, même transaction, payload `{ v: 1, … }` |
| Contexte et données | `runtime.resolveContext(request)` ; `runtime.tenantDb.run(ctx, fn)` uniquement |
| Décorateur partagé avec d'autres modules | `export function setup(app, runtime)` : posé sur l'instance **racine**, sinon invisible des autres modules |
| Route publique (login, webhook signé) | `{ config: { public: true } }` et authentification propre à la route |

## 3. Adapter le manifeste

`manifest.ts` est validé par `defineModule` / `resolveModuleOrder` : une erreur empêche l'API de démarrer.

- **`packs`** : `CORE` = toujours actif. Sinon la liste des packs (`PRIMARY`, `SECONDARY`, `HIGHER`, `VIRTUAL`) qui incluent le module.
- **`dependsOn`** : seulement si vous importez l'`index.ts` d'un autre module (ordre de chargement et de migration). `runtime.requirePermission`, `auditPort`, `entitlements` ne demandent **aucune** dépendance.
- **`permissions`** : `ressource.action` ou `ressource.sous.action` (minuscules, chiffres, `_`), préfixées par la clé du module, uniques globalement. `sensitive: true` exige la MFA et impose l'audit (remboursement, suppression…). Conventions de portée des données : `<ressource>.self.*` (élève), `.child.*` (parent), `.own.*` (personnel), cf. `rbac/templates/system-roles.ts`.
- **`features`** : fonctionnalités vendables (`<clé>.<nom-en-kebab>`), avec les `packs` qui les incluent par défaut. Contrôlées par les entitlements (plan / pack / surcharge).
- **`menus`** : entrées de navigation `{ key, label, href, permission, feature?, portal, icon?, order? }`. La `permission` doit appartenir au module ; la `feature` aussi.
- **`events.publishes`** : alimenté depuis `domain/events.ts` ; noms `<module>.<entité>.<verbe-passé>`. **`consumes`** : documentation des événements d'autres modules que vos abonnés écoutent.

### Où se propagent permissions, features et menus

| Déclaré dans `manifest.ts` | Pris en compte | Reste à faire à la main |
|---|---|---|
| `permissions` | au démarrage de l'API (`syncRbac`) : catalogue des permissions, rôles système des tenants actifs | accorder la permission aux rôles utiles : modèles de `rbac/templates/system-roles.ts` (`owner`/`directeur` ont `*`). Modification **du module rbac** : PR dédiée, revue par son propriétaire |
| `features` | au démarrage (`syncFeatureCatalog`) : catalogue des features ; accordées par pack/plan | rattacher la feature à un plan (console plateforme `PUT /api/v1/platform/plans/:key/features`) si elle n'est pas dans un pack du tenant |
| `menus` | `GET /api/v1/rbac/me/navigation` : filtré par permission **et** feature du tenant | créer la page web correspondant au `href` (`apps/web`) |
| `events.publishes` | relayés par le worker (outbox → BullMQ) | écrire les abonnés qui les consomment |

## 4. Écrire les migrations

- Plage réservée : celle du tableau de `module-conventions.md` (100 numéros). Un fichier hors plage est refusé en revue. Nommage `NNNN_nom_en_minuscules.sql`.
- **Un fichier appliqué ne se modifie jamais** (checksum) : corrigez par la migration suivante (`1601_…`). Tant que le module n'est appliqué nulle part, vous pouvez réécrire `…_init.sql`.
- Toute table métier : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)`, puis `SELECT kernel.enable_tenant_rls('<clé>.<table>');`, puis `GRANT SELECT, INSERT, UPDATE[, DELETE] ON … TO app_user;`.
- Aucune clé étrangère vers le schéma d'un autre module (seul `kernel.tenants`). Entre vos propres tables, préférez des clés **composites** `(tenant_id, id)` : une ligne ne peut pas pointer la ligne d'un autre tenant.
- Montants en `bigint` (unités mineures) + devise ; dates `timestamptz` en UTC ; ids `uuid`.
- Pas de `BEGIN`/`COMMIT` (le runner ouvre une transaction par fichier ; `-- no-transaction` en en-tête pour les cas rares).
- **Table globale** (référentiel identique pour tous les tenants, sans `tenant_id`) : déclarez-la dans `modules/isolation-allowlist.<clé>.ts` avec une justification d'au moins 20 caractères. Une entrée qui ne correspond à aucune table est une erreur (liste périmée). Pour une table à `CHECK` exotique, exportez `fixtures` (valeurs imposées pour fabriquer une ligne de test).
- Appliquer en local : `pnpm db:v2:migrate` (voir `platform-assembly.md` §9 : Postgres jetable, `V2_MIGRATOR_URL`).

## 5. Écrire le module

1. **Domaine** (`domain/`) : types, règles pures, événements. Aucune constante réglementaire ou seuil académique : elle appartient à un RuleSet (`packages/rules-engine`).
2. **Infrastructure** (`infrastructure/`) : une fonction par requête, SQL paramétré (`$1`…), `Tx` reçu en paramètre. Les `bigint` reviennent en chaîne : castez `::text` et reconstruisez un `Money`.
3. **Application** (`application/`) : une fonction par cas d'usage, `Result<T, AppError>`. Dans **une** transaction (`tenantDb.run`) : écriture → événement d'outbox → `audit.record` (en dernier). Les ports (audit, annuaires d'autres modules) se décrivent structurellement dans `ports.ts`.
4. **HTTP** (`http/plugin.ts`) : valider l'entrée (Zod), appeler le use case, convertir `Result` en réponse (`if (!result.ok) throw result.error`). Routes sans préfixe. Garde par route : `preHandler: runtime.requirePermission(...)`. Route visant une ressource précise : passer son périmètre, `requirePermission(perm, { scope })`. Feature : `[runtime.requirePermission(...), runtime.entitlements.requireFeature("<clé>.<feature>")]`.
5. **Contrats partagés** : déplacez les schémas Zod destinés au front dans `packages/contracts/src/v2/<clé>.ts` et réexportez-les depuis `packages/contracts/src/v2/index.ts` (convention n°9).
6. **API publique** (`index.ts`) : n'exportez que ce que les autres modules doivent appeler. Les autres modules passent par ce fichier ou par vos événements — jamais par le schéma SQL.
7. **Abonnés** (`subscribers.ts`) : décommentez l'exemple. Nom stable et unique (clé d'idempotence), `idempotent(...)`, motif exact ou `module.*`. Jobs (`jobs.ts`) : `defineScheduledJob`, `perTenant: true` pour un traitement par tenant. **En production le worker embarque les modules** : `pnpm --filter @ecoledigitale/worker build` après tout changement d'abonné ou de job.
8. **README** : réécrivez-le (ce que fait le module, tables, routes, permissions, événements, jobs).

## 6. Tester

```bash
# Frontières entre modules
pnpm check:boundaries

# Types
pnpm --filter @ecoledigitale/api type-check:v2

# Tests du module (unitaires ; l'intégration est ignorée sans TEST_DATABASE_URL)
pnpm --filter @ecoledigitale/api exec vitest run src/modules/<clé>

# Intégration + isolation dans un Postgres jetable (Docker ; le conteneur est supprimé à la fin)
set ED_PG_IMAGE=postgres:17-alpine          # PowerShell : $env:ED_PG_IMAGE = "postgres:17-alpine"
node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/<clé>
pnpm test:isolation

# Toute la suite v2 (inclut le test du générateur)
pnpm test:v2
```

Ce que les tests générés prouvent : le manifeste est valide ; le plugin se charge **par le registre** avec la signature `(app, runtime)`, sous `/api/v1/<clé>`, avec 401 sans contexte et 403 sans permission ; le use case écrit ligne → événement → audit dans cet ordre, et annule tout si l'audit échoue ; `assertTenantIsolation` valide la RLS de chaque table (structure + comportement A/B). Quand vous ajoutez une table, ajoutez-la à ces tests (le test d'isolation global échoue de toute façon si une table n'a pas `tenant_id` + RLS forcée et n'est pas justifiée).

Le générateur lui-même est testé par `apps/api/test/scaffold.test.ts` (contenu, plages, tableau), `scaffold-gates.test.ts` (génère un module jetable dans l'arbre réel et exécute `check:boundaries`, `tsc`, les tests du module et le test d'isolation global — le module est supprimé ensuite), `boundaries.test.ts`, `isolation/scaffold-isolation.integration.test.ts` et `integration/platform-e2e.integration.test.ts` (plateforme complète, audit réel). Si vous changez les gabarits (`apps/api/src/platform/module-scaffold-templates.ts`), ces tests doivent rester verts **sans** modification du squelette généré.

## 7. Checklist de revue

- [ ] `pnpm check:boundaries`, `type-check:v2`, `pnpm test:v2`, `pnpm test:isolation` verts (CI : jobs `boundaries`, `v2-modules`, isolation).
- [ ] Plus aucune trace de l'exemple `item` (tables, routes, événements, tests, README) — sauf si c'est le vrai modèle.
- [ ] Clé = dossier = schéma = préfixe des permissions et des événements.
- [ ] Migrations dans la plage ; ligne de plage présente dans `module-conventions.md` ; aucun fichier appliqué modifié.
- [ ] Chaque table : `tenant_id`, RLS (`enable_tenant_rls`), `GRANT … TO app_user` ; aucune FK vers un autre schéma que `kernel.tenants` ; tables globales justifiées dans `isolation-allowlist.<clé>.ts`.
- [ ] Aucun accès SQL hors `infrastructure/` ; aucun `pool.query` ; aucun `new Date()` (horloge injectée) ; ids `newId()`.
- [ ] Chaque route protégée par `requirePermission` d'une permission **du manifeste** (scope pour les routes par ressource) ; routes publiques justifiées (`config.public`).
- [ ] Opérations sensibles auditées (`auditPort.record` dans la transaction, en dernier) ; permissions sensibles marquées `sensitive`.
- [ ] Événements : `<module>.<entité>.<verbe-passé>`, payload `{ v: 1, … }`, écrits dans la même transaction ; déclarés dans `events.publishes`.
- [ ] Features / menus déclarés si le module est vendable par option ; pages web correspondantes ; rôles système mis à jour (PR rbac) si nécessaire.
- [ ] Abonnés idempotents et jobs idempotents ; worker reconstruit (`pnpm --filter @ecoledigitale/worker build`) ; fichiers `subscribers.ts` / `jobs.ts` conservés (vides si inutiles).
- [ ] Schémas partagés dans `packages/contracts/src/v2/<clé>.ts` ; messages utilisateur en français, identifiants en anglais.
- [ ] Aucune constante réglementaire / seuil académique dans le module (RuleSet du `rules-engine`).
- [ ] Tests : unitaires du domaine et des use cases, intégration (isolation A/B, rollback, outbox, audit), plugin chargé par le registre.
- [ ] README du module réécrit ; `platform-assembly.md` mis à jour si le module ajoute un abonné, un job ou une variable d'environnement.

## 8. Dépannage

| Symptôme | Cause probable |
|---|---|
| `Le dossier modules/<x>/ n'a pas de manifest.ts` | dossier non-module dans `modules/` : préfixez-le par `_` ou ajoutez le manifeste |
| `la clé doit être égale au nom du dossier` | `key` du manifeste ≠ nom du dossier |
| `Permission "…" déclarée par … et …` | clé de permission déjà prise : préfixez par la clé du module |
| `le menu "…" référence la permission inconnue` | déclarez d'abord la permission dans le même manifeste |
| 500 `rbac.not_configured` | module rbac non chargé (test d'assemblage isolé) : décorez `app.rbac` ou chargez rbac |
| 401 sur toutes les routes | pas de `request.ctx` : jeton absent, ou route à déclarer `config: { public: true }` |
| 403 `Action non autorisée` | l'utilisateur n'a pas la permission : assignation de rôle manquante (aucune assignation RBAC pour un jeton legacy) |
| Violation `modules-only-via-index` | import d'un fichier interne d'un autre module : passez par son `index.ts` |
| Violation `domain-is-pure` / `no-pg-outside-infrastructure` | import de `pg`, `fastify` ou de l'infrastructure depuis le domaine ; SQL hors `infrastructure/` |
| Test d'isolation : table sans RLS / sans `tenant_id` | oubli de `enable_tenant_rls` ou table globale à justifier dans l'allowlist |
| Abonné jamais appelé en production | worker non reconstruit après l'ajout du module |
