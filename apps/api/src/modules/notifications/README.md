# Module `notifications` — Notifications

Squelette généré par `pnpm module:new notifications`. Conforme à `docs/architecture/module-conventions.md` et au contrat d'assemblage
(`docs/architecture/platform-assembly.md`). Pas à pas : `docs/architecture/new-module-guide.md`.

**À remplacer** : l'entité d'exemple `item` (table `notifications.items`, routes `/items`, événement `notifications.item.created`) par le vrai modèle du module,
puis écrire ici ce que le module fait réellement (domaine, règles, tables, routes, événements).

- Schéma Postgres : `notifications` — migrations `1800-1899` (plage réservée, inscrite dans le tableau de `module-conventions.md`).
- Packs : `CORE` (à ajuster dans `manifest.ts`).

## Arborescence

```
manifest.ts          permissions, features, menus, événements (source de vérité)
index.ts             API publique : SEUL point d'import pour les autres modules
migrations/          1800_notifications_init.sql (schéma, table de tenant, RLS, droits)
domain/              règles pures (aucun import pg/fastify) : item.ts, events.ts
application/         cas d'usage (deps, ctx, input) => Result ; ports.ts (audit)
infrastructure/      SQL via le Tx de TenantDb
http/                plugin.ts : export default async (app, runtime) [+ setup facultatif] ; schemas.ts (Zod)
subscribers.ts       abonnés du worker (exemple commenté)
jobs.ts              jobs planifiés du worker (exemple commenté)
test/                unitaires (sans base), intégration (TEST_DATABASE_URL), support/
../isolation-allowlist.notifications.ts   tables globales justifiées (vide)
```

## Contrat d'assemblage utilisé

| Besoin | Mécanisme |
|---|---|
| Routes | `export default async function (app, runtime)`, sans préfixe ; le registre applique `/api/v1/notifications` |
| Permissions | `runtime.requirePermission("notifications.item.read")` en `preHandler` ; clés déclarées dans `manifest.ts` |
| Features | `runtime.entitlements.requireFeature("notifications.<feature>")` ; déclarées dans `manifest.ts` |
| Audit | `runtime.auditPort.record(tx, …)` dans la transaction du use case, EN DERNIER (port `AuditPort`) |
| Événements | `PgOutboxWriter(tx).append([...])` dans la même transaction ; payload `{ v: 1, … }` |
| Contexte | `runtime.resolveContext(request)` |
| Données | `runtime.tenantDb.run(ctx, fn)` uniquement (RLS) |

## Permissions

| Clé | Rôle |
|---|---|
| `notifications.item.read` | consulter les éléments |
| `notifications.item.create` | créer un élément |

## Événements publiés

| Type | Payload |
|---|---|
| `notifications.item.created` | `{ v: 1, itemId }` |

## Tests

```bash
pnpm --filter @ecoledigitale/api exec vitest run src/modules/notifications          # unitaires (+ intégration ignorée sans base)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/notifications/test   # intégration
pnpm check:boundaries && pnpm --filter @ecoledigitale/api type-check:v2 && pnpm test:isolation
```

## Avant la revue

Cochez la checklist de `docs/architecture/new-module-guide.md` (README réécrit, plus d'« item » d'exemple, schémas Zod déplacés vers `packages/contracts`,
migrations dans la plage, abonnés/jobs réels ou fichiers vides conservés, worker reconstruit).
