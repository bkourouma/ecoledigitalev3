/**
 * Abonnés du module `entitlements` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - `entitlements.start-trial`       `tenancy.tenant.provisioned` -> abonnement d'essai (`onTenantProvisioned`).
 *    Idempotent par construction (un tenant qui a déjà un abonnement, quel qu'il soit, n'est pas touché) : la
 *    console plateforme crée l'essai de façon synchrone, ce consommateur couvre les provisionnements qui n'ont
 *    pas pu le faire (autre chemin que la console, reprise après incident). Pas de `idempotent()` : le use case
 *    ouvre sa propre transaction sous `TenantDb` (une transaction imbriquée d'identité différente est refusée).
 *    Politique : `ENTITLEMENTS_TRIAL_PLAN` (défaut STARTER) et `ENTITLEMENTS_TRIAL_DAYS` (défaut 30).
 *  - `entitlements.invalidate-cache`  abonnement/surcharge modifiés, tenant provisionné ou changé de statut ->
 *    diffusion aux instances de l'API (Redis, `platform/event-fanout.ts`) qui invalident leur cache de droits.
 */
import { defineSubscriber } from "@ecoledigitale/worker/sdk";
import { publishEventFanout } from "../../platform/event-fanout";
import { onTenantProvisioned } from "./application/on-tenant-provisioned";
import { INVALIDATING_EVENT_TYPES } from "./domain/events";

function trialPolicy(): { planKey: string; trialDays: number } {
  const days = Number.parseInt(process.env.ENTITLEMENTS_TRIAL_DAYS ?? "", 10);
  return {
    planKey: process.env.ENTITLEMENTS_TRIAL_PLAN?.trim() || "STARTER",
    trialDays: Number.isInteger(days) && days >= 1 && days <= 365 ? days : 30,
  };
}

export default [
  defineSubscriber({
    name: "entitlements.start-trial",
    pattern: "tenancy.tenant.provisioned",
    retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
    concurrency: 4,
    handler: async (event, ctx) => {
      const result = await onTenantProvisioned({ db: ctx.tenantDb }, event, trialPolicy());
      if (!result.ok) throw result.error;
      ctx.logger.info(
        { created: result.value.created },
        result.value.created ? "entitlements : abonnement d'essai créé" : "entitlements : abonnement déjà présent",
      );
    },
  }),
  ...[...INVALIDATING_EVENT_TYPES].sort().map((type) =>
    defineSubscriber({
      name: `entitlements.invalidate-cache.${type.replace(/^[a-z]+\./, "").replace(/[^a-z0-9]+/g, "-")}`,
      pattern: type,
      retry: { attempts: 5, backoffMs: 500, maxBackoffMs: 30_000 },
      handler: async (event, ctx) => {
        const published = await publishEventFanout(event);
        if (!published) ctx.logger.info({ eventType: event.type }, "entitlements : REDIS_URL absent, invalidation locale seulement");
      },
    }),
  ),
];
