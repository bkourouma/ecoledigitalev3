/**
 * Abonnés du module `assess` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - `assess.seed-assessment-types`  `tenancy.tenant.provisioned` -> types d'évaluation du modèle de pack (idempotent,
 *    non destructif : un type existant n'est jamais écrasé).
 *
 * Le nom d'événement et la forme du payload de `tenancy` sont lus avec tolérance (`packs[]` ou `pack`). Les abonnés sont
 * idempotents (`idempotent()` : marque « traité » dans la transaction de l'effet).
 */
import { defineSubscriber, idempotent, type EventHandlerContext, type SubscriberDefinition } from "@ecoledigitale/worker/sdk";
import { audit, configureAuditFromEnv } from "../audit";
import { createAssessDeps, type AssessDeps } from "./application/deps";
import { onTenantProvisioned } from "./application/consumers";
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

function packOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { pack?: unknown; packs?: unknown };
  if (Array.isArray(p.packs)) {
    const packs = p.packs.filter((x): x is string => typeof x === "string");
    if (packs.includes("HIGHER")) return "HIGHER";
    return packs[0] ?? null;
  }
  return typeof p.pack === "string" ? p.pack : null;
}

export function buildSubscribers(depsOf: (ctx: EventHandlerContext) => AssessDeps): SubscriberDefinition[] {
  return [
    defineSubscriber({
      name: "assess.seed-assessment-types",
      pattern: ConsumedEvents.TENANT_PROVISIONED,
      retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
      handler: idempotent("assess.seed-assessment-types", async (event, ctx) => {
        const r = await onTenantProvisioned(depsOf(ctx), ctx.db.ctx, { pack: packOf(event.payload) });
        if (!r.ok) throw r.error;
        ctx.logger.info({ created: r.value.created }, "assess : types d'évaluation du pack instanciés");
      }),
    }),
  ];
}

export default buildSubscribers(defaultDepsOf);
