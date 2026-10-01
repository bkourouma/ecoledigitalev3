/**
 * Consommateur de `tenancy.tenant.provisioned` : démarre un abonnement d'essai
 * pour un tenant neuf, avec les packs choisis au provisioning.
 *
 * Idempotent (l'outbox livre AU MOINS UNE FOIS, ADR-004) : si le tenant a déjà un
 * abonnement, quel qu'il soit, rien n'est fait. Sans ce consommateur, un tenant neuf
 * n'a que les features CORE — c'est le comportement sûr par défaut.
 */
import {
  createSystemContext,
  type AppError,
  type DomainEvent,
  type Result,
  ValidationError,
  err,
} from "@ecoledigitale/kernel";
import { TenancyTenantProvisionedPayloadSchema } from "@ecoledigitale/contracts/src/v2/tenancy";
import type { SubscriptionStatus } from "@ecoledigitale/contracts/src/v2/entitlements";
import type { SubscriptionRecord } from "../domain/entities";
import { subscriptionChangedEvent } from "../domain/events";
import { publishEvents } from "../infrastructure/events";
import { getCurrentSubscription, insertSubscription } from "../infrastructure/subscriptions-repository";
import { parseWith, resolveDeps, runResult, type EntitlementsDeps } from "./support";

export interface TrialPolicy {
  /** Plan de l'essai (défaut `STARTER`). */
  planKey?: string;
  /** Durée de l'essai en jours (défaut 30). */
  trialDays?: number;
}

const DAY_MS = 86_400_000;

export async function onTenantProvisioned(
  deps: EntitlementsDeps,
  event: Pick<DomainEvent, "type" | "tenantId" | "payload">,
  policy: TrialPolicy = {},
): Promise<Result<{ created: boolean; subscription: SubscriptionRecord | null }, AppError>> {
  const d = resolveDeps(deps);
  if (event.type !== "tenancy.tenant.provisioned") {
    return err(ValidationError.field("type", `Événement inattendu : ${event.type}.`, "entitlements.unexpected_event"));
  }
  const parsed = parseWith(TenancyTenantProvisionedPayloadSchema, event.payload);
  if (!parsed.ok) return parsed;
  const payload = parsed.value;
  const ctx = createSystemContext(event.tenantId);

  const res = await runResult(d.db, ctx, async (tx) => {
    const existing = await getCurrentSubscription(tx, ctx.tenantId);
    if (existing) return { created: false, subscription: existing };

    const now = d.clock.now();
    const status: SubscriptionStatus = "TRIALING";
    const sub = await insertSubscription(
      tx,
      {
        id: d.newId(),
        tenantId: ctx.tenantId,
        planKey: policy.planKey ?? "STARTER",
        packs: [...new Set(payload.packs)],
        status,
        startsAt: now,
        endsAt: new Date(now.getTime() + (policy.trialDays ?? 30) * DAY_MS),
        learnerTierMax: null,
      },
      now,
    );
    await publishEvents(tx, [
      subscriptionChangedEvent(
        { ctx, clock: d.clock },
        {
          subscriptionId: sub.id,
          current: {
            planKey: sub.planKey,
            packs: sub.packs as Array<"PRIMARY" | "SECONDARY" | "HIGHER" | "VIRTUAL">,
            status: sub.status,
            startsAt: sub.startsAt.toISOString(),
            endsAt: sub.endsAt ? sub.endsAt.toISOString() : null,
            learnerTierMax: sub.learnerTierMax,
          },
          previous: null,
        },
      ),
    ]);
    await d.audit?.record(tx, {
      action: "entitlements.subscription.trial_started",
      resource: "subscription",
      resourceId: sub.id,
      after: { planKey: sub.planKey, packs: sub.packs },
      ctx,
    });
    return { created: true, subscription: sub };
  });

  if (res.ok && res.value.created) d.cache?.invalidate(ctx.tenantId);
  return res;
}
