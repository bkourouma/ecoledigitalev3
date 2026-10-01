/**
 * Abonnés du module `rbac` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - `rbac.instantiate-system-roles`   `tenancy.tenant.provisioned` -> rôles système du tenant (idempotent,
 *    sérialisé par verrou consultatif avec la console plateforme qui les instancie de façon synchrone et avec la
 *    synchronisation de démarrage de l'API).
 *  - `rbac.reconcile-roles-on-reactivation`  `tenancy.tenant.status_changed` vers `active` -> les rôles système sont
 *    re-résolus : la synchronisation de démarrage ne traite que les tenants ACTIFS, un tenant suspendu pendant une
 *    évolution du catalogue de permissions les retrouverait sinon périmés.
 *  - `rbac.invalidate-permission-cache`  `rbac.role.changed`, `rbac.assignment.changed` et
 *    `tenancy.tenant.status_changed` -> diffusion aux instances de l'API (Redis, `platform/event-fanout.ts`) qui
 *    vident leur cache de droits (`subscribeCacheInvalidation`). Le worker ne garde aucun cache de droits.
 */
import { defineSubscriber, idempotent } from "@ecoledigitale/worker/sdk";
import { publishEventFanout } from "../../platform/event-fanout";
import { instantiateSystemRoles } from "./application/instantiate-system-roles";
import { RBAC_ASSIGNMENT_CHANGED, RBAC_ROLE_CHANGED } from "./domain/events";

export default [
  defineSubscriber({
    name: "rbac.instantiate-system-roles",
    pattern: "tenancy.tenant.provisioned",
    retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
    concurrency: 4,
    handler: idempotent("rbac.instantiate-system-roles", async (_event, ctx, tx) => {
      const report = await instantiateSystemRoles(tx, ctx.tenantId, { logger: ctx.logger });
      ctx.logger.info({ created: report.created.length, existing: report.existing.length }, "rbac : rôles système instanciés");
    }),
  }),
  defineSubscriber({
    name: "rbac.reconcile-roles-on-reactivation",
    pattern: "tenancy.tenant.status_changed",
    retry: { attempts: 5, backoffMs: 1_000, maxBackoffMs: 60_000 },
    handler: idempotent("rbac.reconcile-roles-on-reactivation", async (event, ctx, tx) => {
      const status = (event.payload as { status?: unknown } | null)?.status;
      if (status !== "active") return;
      await instantiateSystemRoles(tx, ctx.tenantId, { logger: ctx.logger });
    }),
  }),
  ...[RBAC_ROLE_CHANGED, RBAC_ASSIGNMENT_CHANGED, "tenancy.tenant.status_changed"].map((type) =>
    defineSubscriber({
      name: `rbac.invalidate-permission-cache.${type.replace(/^[a-z]+\./, "").replace(/[^a-z0-9]+/g, "-")}`,
      pattern: type,
      retry: { attempts: 5, backoffMs: 500, maxBackoffMs: 30_000 },
      handler: async (event, ctx) => {
        const published = await publishEventFanout(event);
        if (!published) ctx.logger.info({ eventType: event.type }, "rbac : REDIS_URL absent, invalidation locale seulement");
      },
    }),
  ),
];
