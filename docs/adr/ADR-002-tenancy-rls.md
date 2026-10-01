# ADR-002 — Multi-tenancy et Row-Level Security

- **Statut :** Accepté
- **Date :** 2026-10-01
- **Références :** plan D3, D8, section 3.4 ; PRD « multi-tenant dès le premier jour » ; ADR-001, ADR-006

## Contexte

Le RLS existe aujourd'hui dans la base mais n'isole rien en pratique :

- l'API se connecte avec un super-utilisateur Postgres, qui contourne même `FORCE ROW LEVEL SECURITY` ;
- deux styles de policy coexistent (`app.tenant_id` et `app.current_tenant_id`) ;
- le contexte de tenant est posé par monkey-patching de `pg.query`, au niveau de la session et non de la transaction, ce qui est fragile avec un pool de connexions ;
- l'isolation réelle repose sur des `WHERE tenant_id = $1` écrits à la main.

Le tenant est par ailleurs plat : ni organisation, ni établissement, ni campus. Le PRD exige un isolement strict entre tenants et une hiérarchie multi-établissements.

## Décision

**1. Deux rôles Postgres.**
- `migrator` : propriétaire des objets, exécute le DDL et les migrations.
- `app_user` : `NOBYPASSRLS`, jamais propriétaire, droits DML uniquement. L'API et le worker ne se connectent qu'avec ce rôle. Le démarrage échoue si le rôle de connexion est super-utilisateur ou possède `BYPASSRLS`.

**2. `TenantDb`.** Tout accès SQL passe par `TenantDb.run(ctx, fn)` (dans `packages/database`) : ouverture d'une transaction, `SET LOCAL app.tenant_id = <uuid>` (via `set_config(..., true)`), exécution de `fn` avec un client transactionnel, commit ou rollback. `SET LOCAL` est limité à la transaction, donc sans fuite entre requêtes sur un pool. Aucun accès à `pg.Pool` en dehors de cet objet (règle dependency-cruiser).

Pour les traitements sans tenant (jobs transverses, console super-admin), un `SystemDb` explicite, nommé et audité remplace le repli silencieux en super-utilisateur.

**3. Une seule policy, générée.** Toute table portant des données de tenant est créée puis passée par la fonction SQL `enable_tenant_rls('schema.table')`, qui applique `ENABLE` + `FORCE ROW LEVEL SECURITY`, crée l'unique policy `USING` / `WITH CHECK` sur `tenant_id = current_setting('app.tenant_id')::uuid` et l'index sur `tenant_id`. Une seule variable de session : `app.tenant_id`. Si elle est absente, la policy ne renvoie aucune ligne.

**4. Hiérarchie.** `Tenant` (= Organisation, 1:1) → `Institution` (pack, pays, système éducatif) → `Campus`. `tenant_id` reste la seule clé d'isolation RLS ; `institution_id` et `campus_id` sont des dimensions de périmètre filtrées par les droits (RBAC par périmètre), pas par RLS. Un `CountryProfile` (devise, locale, fuseau, indicatif, système éducatif) est stocké en table.

**5. Test d'isolation générique (bloquant en CI).** Pour chaque table du catalogue qui n'est pas dans une liste blanche explicite de tables globales : (a) elle a `tenant_id NOT NULL`, RLS activé et forcé ; (b) en tant que tenant A, on ne lit, n'insère, ne modifie ni ne supprime aucune ligne de B. Ajouter une table sans RLS fait échouer la CI.

## Conséquences

- L'isolation devient une propriété de la base, plus de l'attention du développeur : un `WHERE tenant_id` oublié ne fuit plus.
- Chaque requête métier paie une transaction courte ; acceptable, et utile pour la cohérence. Les lectures lourdes peuvent utiliser un client en lecture seule dans la même discipline.
- Les environnements de développement doivent créer les deux rôles ; les scripts d'initialisation et le compose sont à adapter.
- Le multi-tenant d'un utilisateur (un parent dans plusieurs établissements) n'est pas réglé ici ; il relève de la spec 002.
- Le fournisseur de base géré doit autoriser deux rôles distincts et `FORCE ROW LEVEL SECURITY` ; à vérifier avant la mise en production.

## Alternatives rejetées

- **Filtrage applicatif seul** (`WHERE tenant_id`) : état actuel ; une omission suffit pour fuiter.
- **Une base ou un schéma par tenant** : isolation forte, mais migrations multipliées par le nombre de tenants, provisioning lourd, statistiques cross-tenant difficiles ; peu adapté à de nombreux petits établissements.
- **Conserver `SET` de session avec un wrapper de `pg.query`** : non sûr avec un pool et des requêtes concurrentes ; remplacé par `SET LOCAL` en transaction.
- **Une policy écrite à la main par table** : divergence garantie (déjà deux styles aujourd'hui) ; on génère.
- **Hiérarchie d'isolation à trois niveaux dans le RLS** : complexifie chaque policy ; le périmètre établissement/campus se traite au niveau des droits.
