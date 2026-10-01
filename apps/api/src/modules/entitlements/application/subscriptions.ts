/**
 * Abonnement d'un tenant (plan, packs souscrits, période, statut, tranche d'apprenants).
 *
 * `setSubscription` a une sémantique « PUT » : s'il existe un abonnement vivant
 * (TRIALING / ACTIVE / PAST_DUE) il est mis à jour — les champs optionnels
 * absents sont CONSERVÉS — sinon un nouvel abonnement est créé (l'historique
 * CANCELED / EXPIRED reste). Terminer un abonnement = le passer à CANCELED ou EXPIRED.
 *
 * L'autorisation (qui peut changer un abonnement) appartient à l'appelant :
 * console plateforme derrière `SuperAdminAuthorizer`. Ce n'est PAS une action de tenant.
 */
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type AppError,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import { isUniqueViolation } from "@ecoledigitale/database";
import { SetSubscriptionSchema } from "@ecoledigitale/contracts/src/v2/entitlements";
import { getTenantStatus } from "../../tenancy";
import type { SubscriptionRecord } from "../domain/entities";
import { subscriptionChangedEvent } from "../domain/events";
import { getPlan, listPacks } from "../infrastructure/catalog-repository";
import { publishEvents } from "../infrastructure/events";
import {
  getCurrentSubscription,
  getLiveSubscription,
  insertSubscription,
  updateSubscription,
} from "../infrastructure/subscriptions-repository";
import { parseWith, resolveDeps, runResult, type EntitlementsDeps } from "./support";

const LIVE = new Set(["TRIALING", "ACTIVE", "PAST_DUE"]);

const snapshot = (s: SubscriptionRecord) => ({
  planKey: s.planKey,
  packs: s.packs as Array<"PRIMARY" | "SECONDARY" | "HIGHER" | "VIRTUAL">,
  status: s.status,
  startsAt: s.startsAt.toISOString(),
  endsAt: s.endsAt ? s.endsAt.toISOString() : null,
  learnerTierMax: s.learnerTierMax,
});

/** Abonnement courant (vivant, à défaut le plus récent) ou `null`. */
export async function getSubscription(
  deps: EntitlementsDeps,
  ctx: RequestContext,
): Promise<Result<SubscriptionRecord | null, AppError>> {
  const d = resolveDeps(deps);
  return runResult(d.db, ctx, (tx) => getCurrentSubscription(tx, ctx.tenantId), { readOnly: true });
}

export async function setSubscription(
  deps: EntitlementsDeps,
  ctx: RequestContext,
  rawInput: unknown,
): Promise<Result<SubscriptionRecord, AppError>> {
  const d = resolveDeps(deps);
  const parsed = parseWith(SetSubscriptionSchema, rawInput);
  if (!parsed.ok) return parsed;
  const input = parsed.value;

  const res = await runResult(d.db, ctx, async (tx) => {
    if (!(await getTenantStatus(tx, ctx.tenantId))) {
      throw NotFoundError.of("Organisation", ctx.tenantId, { code: "entitlements.tenant_not_found" });
    }

    const plan = await getPlan(tx, input.planKey);
    if (!plan) throw NotFoundError.of("Plan", input.planKey, { code: "entitlements.plan_not_found" });
    if (!plan.active && LIVE.has(input.status)) {
      throw new ConflictError(`Le plan « ${input.planKey} » n'est plus commercialisé.`, { code: "entitlements.plan_inactive" });
    }

    const knownPacks = new Set((await listPacks(tx)).filter((p) => p.active).map((p) => p.key));
    const packs = [...new Set(input.packs)];
    const unknown = packs.filter((p) => !knownPacks.has(p));
    if (unknown.length > 0) {
      throw ValidationError.field("packs", `Packs inconnus ou inactifs : ${unknown.join(", ")}.`, "entitlements.pack_not_found");
    }

    const now = d.clock.now();
    const live = await getLiveSubscription(tx, ctx.tenantId);
    if (!live && !LIVE.has(input.status)) {
      throw new ConflictError("Aucun abonnement en cours à terminer.", { code: "entitlements.no_live_subscription" });
    }

    const startsAt = input.startsAt ? new Date(input.startsAt) : (live?.startsAt ?? now);
    const endsAt = input.endsAt === undefined ? (live?.endsAt ?? null) : input.endsAt === null ? null : new Date(input.endsAt);
    const learnerTierMax = input.learnerTierMax === undefined ? (live?.learnerTierMax ?? null) : input.learnerTierMax;
    if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw ValidationError.field("endsAt", "La fin de l'abonnement doit être postérieure à son début.", "entitlements.period_invalid");
    }

    const fields = { planKey: input.planKey, packs, status: input.status, startsAt, endsAt, learnerTierMax };
    let after: SubscriptionRecord;
    try {
      after = live
        ? await updateSubscription(tx, live.id, fields, now)
        : await insertSubscription(tx, { ...fields, id: d.newId(), tenantId: ctx.tenantId }, now);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictError("Un abonnement en cours existe déjà pour cette organisation.", { code: "entitlements.subscription_conflict" });
      }
      throw e;
    }

    await publishEvents(tx, [
      subscriptionChangedEvent(
        { ctx, clock: d.clock },
        { subscriptionId: after.id, current: snapshot(after), previous: live ? snapshot(live) : null },
      ),
    ]);
    await d.audit?.record(tx, {
      action: "entitlements.subscription.set",
      resource: "subscription",
      resourceId: after.id,
      before: live ? snapshot(live) : null,
      after: snapshot(after),
      ctx,
    });
    return after;
  });

  if (res.ok) d.cache?.invalidate(ctx.tenantId);
  return res;
}
