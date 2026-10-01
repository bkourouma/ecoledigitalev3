/**
 * Abonnés du module `assess` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - `assess.seed-assessment-types`  `tenancy.tenant.provisioned` -> types d'évaluation du modèle de pack (idempotent,
 *    non destructif : un type existant n'est jamais écrasé).
 *
 * Le nom d'événement et la forme du payload de `tenancy` sont ceux du producteur (`packs[]`, voir `packOfTenantProvisioned`
 * et `apps/api/test/events-contracts/assess.test.ts`). Les abonnés sont
 * idempotents (`idempotent()` : marque « traité » dans la transaction de l'effet).
 */
import { defineSubscriber, idempotent, type EventHandlerContext, type SubscriberDefinition } from "@ecoledigitale/worker/sdk";
import { audit, configureAuditFromEnv } from "../audit";
import { createAssessDeps, type AssessDeps } from "./application/deps";
import { onTenantProvisioned, packOfTenantProvisioned } from "./application/consumers";
import { ConsumedEvents } from "./domain/events";

let auditConfigured = false;

function defaultDepsOf(ctx: EventHandlerContext): AssessDeps {
  if (!auditConfigured) {
    configureAuditFromEnv(audit, process.env, { logger: ctx.logger });
    auditConfigured = true;
  }
  return createAssessDeps({
    db: ctx.tenantDb,
    logger: ctx.logger,
    audit: { record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) },
  });
}

export function buildSubscribers(depsOf: (ctx: EventHandlerContext) => AssessDeps): SubscriberDefinition[] {
  return [
    defineSubscriber({
      name: "assess.seed-assessment-types",
      pattern: ConsumedEvents.TENANT_PROVISIONED,
      retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
      handler: idempotent("assess.seed-assessment-types", async (event, ctx) => {
        const r = await onTenantProvisioned(depsOf(ctx), ctx.db.ctx, { pack: packOfTenantProvisioned(event.payload) });
        if (!r.ok) throw r.error;
        ctx.logger.info({ created: r.value.created }, "assess : types d'évaluation du pack instanciés");
      }),
    }),
  ];
}

export default buildSubscribers(defaultDepsOf);
