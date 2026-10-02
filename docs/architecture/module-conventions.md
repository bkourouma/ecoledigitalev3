# Conventions des modules backend (contrat commun Phase 1)

Référence : ADR-001, ADR-002, ADR-004, ADR-006, ADR-007. Ce document est **normatif** pour tout nouveau module sous `apps/api/src/modules/`.

## Arborescence

```
apps/api/src/modules/<key>/
├── manifest.ts          export default defineModule({...})  (@ecoledigitale/kernel)
├── index.ts             API publique : seul point d'import autorisé pour les autres modules
├── migrations/          NNNN_nom.sql — appliquées par @ecoledigitale/database, schéma Postgres = <key>
├── domain/              entités, règles pures, événements (aucun import pg/fastify)
├── application/         use cases : fonctions `(deps, ctx, input) => Promise<Result<T,E>>`
├── infrastructure/      repositories SQL (via Tx de TenantDb), adaptateurs
├── http/                `plugin.ts` : plugin Fastify (préfixe /api/v1/<key>), schémas Zod de packages/contracts
└── __tests__/ | test/   Vitest (unitaires purs) + intégration (TEST_DATABASE_URL)
```

## Règles

1. **Un module = un schéma Postgres** du même nom (`CREATE SCHEMA <key>`). Aucune requête SQL ne touche le schéma d'un autre module : on appelle son `index.ts` ou on consomme ses événements. Les seules FK inter-schémas autorisées visent `kernel.tenants(id)`.
2. **Toute table métier** : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)`, puis `SELECT kernel.enable_tenant_rls('<key>.<table>')` dans la même migration, puis `GRANT SELECT, INSERT, UPDATE[, DELETE] ON ... TO app_user`. Une table globale doit être déclarée dans l'allowlist du test d'isolation avec une justification.
3. **Accès DB** uniquement via `TenantDb.run(ctx, fn)` / `SystemDb` (`@ecoledigitale/database`). Jamais de `pool.query` direct dans un module.
4. **Erreurs** : types de `@ecoledigitale/kernel` (`NotFoundError`…) ; pas de `throw new Error` pour les cas métier. Les use cases renvoient `Result`.
5. **Montants** : `Money` du kernel, entiers. **Dates** : UTC en base, `Clock` injecté. **Ids** : `newId()` (UUID v7).
6. **Événements** : publiés dans la même transaction via `PgOutboxWriter(tx)` ; noms `<module>.<entité>.<verbe-passé>` (ex. `finance.payment.completed`). Le payload est un objet JSON versionné `{ v: 1, ... }`.
7. **Permissions** : déclarées dans `manifest.ts` (`ressource.action`), jamais de contrôle de rôle codé en dur. Le contrôle se fait par `requirePermission('...')` fourni par le module `rbac`.
8. **Audit** : toute opération sensible appelle `audit.record(tx, {...})` (module `audit`) dans la même transaction.
9. **Routes** : plugin Fastify exporté par défaut de `http/plugin.ts` **avec la signature `(app, runtime)`**, où `runtime` est le `ModuleRuntime` de `apps/api/src/platform/runtime.ts` (`tenantDb`, `systemDb`, `clock`, `logger`, `manifests`, `requirePermission`, `auditPort`, `entitlements`, `resolveContext`, `rateLimiter`, `superAdminAuthorizer`…). Les routes sont déclarées **sans préfixe** : le registre applique `/api/v1/<key>`. Un module qui doit décorer l'instance racine (`app.rbac`, `app.iam`, `app.entitlements`) exporte en plus `setup(app, runtime)`, appelé par le registre avant le contexte encapsulé. Une route qui s'appelle sans contexte tenant (login, webhook signé, console opérateur) déclare `config: { public: true }` ; l'authentification legacy la laisse alors passer. Voir `docs/architecture/platform-assembly.md`. Schémas Zod issus de `packages/contracts` (ajoutez vos schémas dans `packages/contracts/src/v2/<key>.ts` et réexportez-les depuis `packages/contracts/src/v2/index.ts`).
10. **Code et libellés** : identifiants de code en anglais, messages utilisateur en français.
11. **Aucune constante réglementaire ou de seuil académique** dans un module : elle appartient à un RuleSet (`packages/rules-engine`).
12. **Tests** : Vitest. Les tests d'intégration lisent `TEST_DATABASE_URL` et s'ignorent proprement sans elle ; utiliser `packages/database/scripts/with-postgres.mjs` pour un Postgres éphémère.

## Découverte et chargement

Le registre (`apps/api/src/modules/registry.ts`, agent « platform-api ») découvre automatiquement les dossiers `modules/*/manifest.ts` — **aucun fichier central à modifier pour ajouter un module**. Les migrations de chaque module sont appliquées dans l'ordre topologique de `dependsOn`.

## Coexistence avec le code legacy (jusqu'au reset de la Phase 2)

- L'API legacy continue de tourner sur le schéma `public` avec `DATABASE_URL`. Les modules v2 utilisent un pool distinct `V2_DATABASE_URL` (rôle de connexion héritant de `app_user`, jamais superuser).
- `kernel.tenants` est la source de vérité des modules v2. Pendant la coexistence, elle est alimentée à sens unique depuis `public.tenants` (mêmes UUID) au démarrage et à la création d'un tenant legacy.
- Le contexte (`RequestContext`) est construit depuis l'authentification legacy existante (JWT) tant que le module `iam` n'a pas pris le relais ; la forme du jeton (`userId`, `tenantId`, `roles`, `activeRole`) est conservée.

## Numérotation des migrations (décision du lead)

Les versions du runner (`schema_migrations.version`) sont **globales à tous les dossiers**. Chaque module reçoit une plage réservée de 100 numéros ; un fichier hors de sa plage est refusé en revue.

| Plage | Propriétaire |
|-------|--------------|
| 0001-0099 | `packages/database` (baseline : rôles, kernel, outbox) |
| 0100-0149 | `tenancy` |
| 0150-0199 | `entitlements` |
| 0200-0299 | `rbac` |
| 0300-0399 | `audit` |
| 0400-0499 | `iam` |
| 0500-0599 | `finance` |
| 0600-0699 | `apps/worker` |
| 0700-0799 | `academic` |
| 0800-0899 | `people` |
| 0900-0949 | `attendance` |
| 0950-0999 | `scheduling` |
| 1000-1099 | `rules` |
| 1100-1199 | `assess` |
| 1200-1299 | `results` |
| 1300-1399 | `reportcards` |
| 1400-1499 | `higher` |
| 1500-1599 | `payroll` |
| 1600-1699 | `analytics` |
| 1700-1799 | `messaging` |
| 1800+ | modules suivants, attribués dans l'ordre de création (compléter ce tableau) |

Un nouveau module prend la prochaine plage libre et l'inscrit ici dans la même PR. `pnpm module:new <clé>` le fait pour vous : il lit ce tableau (ligne ouverte `NNNN+`), réserve 100 numéros (`--range 1800` pour imposer le début), nomme la migration initiale dans la plage (`1800_<clé>_init.sql`), insère la ligne du module et décale la ligne ouverte. Voir `docs/architecture/new-module-guide.md`.

Note : le script `db:v2:migrate` suit les versions par dossier (`schema_migrations_<module>`), donc une collision n'est pas bloquante techniquement ; les plages gardent les numéros lisibles et évitent toute ambiguïté dans les journaux.
