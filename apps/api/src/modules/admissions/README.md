# Module `admtmp` — Admtmp

Squelette généré par `pnpm module:new admtmp`. Conforme à `docs/architecture/module-conventions.md` et au contrat d'assemblage
(`docs/architecture/platform-assembly.md`). Pas à pas : `docs/architecture/new-module-guide.md`.

**À remplacer** : l'entité d'exemple `item` (table `admtmp.items`, routes `/items`, événement `admtmp.item.created`) par le vrai modèle du module,
puis écrire ici ce que le module fait réellement (domaine, règles, tables, routes, événements).

- Schéma Postgres : `admtmp` — migrations `2600-2699` (plage réservée, inscrite dans le tableau de `module-conventions.md`).
- Packs : `CORE` (à ajuster dans `manifest.ts`).

## Arborescence

```
manifest.ts          permissions, features, menus, événements (source de vérité)
index.ts             API publique : SEUL point d'import pour les autres modules
migrations/          2600_admtmp_init.sql (schéma, table de tenant, RLS, droits)
domain/              règles pures (aucun import pg/fastify) : item.ts, events.ts
application/         cas d'usage (deps, ctx, input) => Result ; ports.ts (audit)
infrastructure/      SQL via le Tx de TenantDb
http/                plugin.ts : export default async (app, runtime) [+ setup facultatif] ; schemas.ts (Zod)
subscribers.ts       abonnés du worker (exemple commenté)
jobs.ts              jobs planifiés du worker (exemple commenté)
test/                unitaires (sans base), intégration (TEST_DATABASE_URL), support/
../isolation-allowlist.admtmp.ts   tables globales justifiées (vide)
```

## Contrat d'assemblage utilisé

| Besoin | Mécanisme |
|---|---|
| Routes | `export default async function (app, runtime)`, sans préfixe ; le registre applique `/api/v1/admtmp` |
| Permissions | `runtime.requirePermission("admtmp.item.read")` en `preHandler` ; clés déclarées dans `manifest.ts` |
| Features | `runtime.entitlements.requireFeature("admtmp.<feature>")` ; déclarées dans `manifest.ts` |
| Audit | `runtime.auditPort.record(tx, …)` dans la transaction du use case, EN DERNIER (port `AuditPort`) |
| Événements | `PgOutboxWriter(tx).append([...])` dans la même transaction ; payload `{ v: 1, … }` |
| Contexte | `runtime.resolveContext(request)` |
| Données | `runtime.tenantDb.run(ctx, fn)` uniquement (RLS) |

## Permissions

| Clé | Rôle |
|---|---|
| `admtmp.item.read` | consulter les éléments |
| `admtmp.item.create` | créer un élément |

## Événements publiés

| Type | Payload |
|---|---|
| `admtmp.item.created` | `{ v: 1, itemId }` |

## Tests

```bash
pnpm --filter @ecoledigitale/api exec vitest run src/modules/admtmp          # unitaires (+ intégration ignorée sans base)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/admtmp/test   # intégration
pnpm check:boundaries && pnpm --filter @ecoledigitale/api type-check:v2 && pnpm test:isolation
```

## Avant la revue

Cochez la checklist de `docs/architecture/new-module-guide.md` (README réécrit, plus d'« item » d'exemple, schémas Zod déplacés vers `packages/contracts`,
migrations dans la plage, abonnés/jobs réels ou fichiers vides conservés, worker reconstruit).
