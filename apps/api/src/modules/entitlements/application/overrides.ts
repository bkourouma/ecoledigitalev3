/**
 * Surcharges de feature d'un tenant (GRANT / DENY) : motif obligatoire,
 * expiration facultative, une surcharge par (tenant, feature).
 * Opération SENSIBLE (permission `entitlements.manage`) : toujours auditée.
 */
import {
  NotFoundError,
  ValidationError,
  type AppError,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import { SetFeatureOverrideSchema, FeatureKeySchema } from "@ecoledigitale/contracts/src/v2/entitlements";
import { getTenantStatus } from "../../tenancy";
import type { OverrideRecord } from "../domain/entities";
import { overrideChangedEvent } from "../domain/events";
import { listFeatures } from "../infrastructure/catalog-repository";
import { publishEvents } from "../infrastructure/events";
import { deleteOverride, getOverride, listOverrides, upsertOverride } from "../infrastructure/overrides-repository";
import { parseWith, resolveDeps, runResult, type EntitlementsDeps } from "./support";

export async function listFeatureOverrides(
  deps: EntitlementsDeps,
  ctx: RequestContext,
): Promise<Result<OverrideRecord[], AppError>> {
  const d = resolveDeps(deps);
  return runResult(d.db, ctx, (tx) => listOverrides(tx, ctx.tenantId), { readOnly: true });
}

export async function setFeatureOverride(
  deps: EntitlementsDeps,
  ctx: RequestContext,
  featureKey: string,
  rawInput: unknown,
): Promise<Result<OverrideRecord, AppError>> {
  const d = resolveDeps(deps);
  const key = parseWith(FeatureKeySchema, featureKey);
  if (!key.ok) return key;
  const parsed = parseWith(SetFeatureOverrideSchema, rawInput);
  if (!parsed.ok) return parsed;
  const input = parsed.value;

  const res = await runResult(d.db, ctx, async (tx) => {
    if (!(await getTenantStatus(tx, ctx.tenantId))) {
      throw NotFoundError.of("Organisation", ctx.tenantId, { code: "entitlements.tenant_not_found" });
    }
    const feature = (await listFeatures(tx)).find((f) => f.key === key.value);
    if (!feature || feature.retired) {
      throw NotFoundError.of("Feature", key.value, { code: "entitlements.feature_not_found" });
    }

    const now = d.clock.now();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      throw ValidationError.field("expiresAt", "La date d'expiration doit être dans le futur.", "entitlements.override_expiry_past");
    }

    const before = await getOverride(tx, key.value);
    const after = await upsertOverride(
      tx,
      {
        id: d.newId(),
        tenantId: ctx.tenantId,
        featureKey: key.value,
        effect: input.effect,
        reason: input.reason,
        expiresAt,
        createdBy: ctx.userId,
      },
      now,
    );

    await publishEvents(tx, [
      overrideChangedEvent(
        { ctx, clock: d.clock },
        {
          featureKey: after.featureKey,
          effect: after.effect,
          previousEffect: before?.effect ?? null,
          reason: after.reason,
          expiresAt: after.expiresAt ? after.expiresAt.toISOString() : null,
        },
      ),
    ]);
    await d.audit?.record(tx, {
      action: "entitlements.override.set",
      resource: "feature_override",
      resourceId: key.value,
      before: before ? { effect: before.effect, reason: before.reason, expiresAt: before.expiresAt } : null,
      after: { effect: after.effect, reason: after.reason, expiresAt: after.expiresAt },
      ctx,
    });
    return after;
  });

  if (res.ok) d.cache?.invalidate(ctx.tenantId);
  return res;
}

export async function removeFeatureOverride(
  deps: EntitlementsDeps,
  ctx: RequestContext,
  featureKey: string,
): Promise<Result<OverrideRecord, AppError>> {
  const d = resolveDeps(deps);
  const key = parseWith(FeatureKeySchema, featureKey);
  if (!key.ok) return key;

  const res = await runResult(d.db, ctx, async (tx) => {
    const removed = await deleteOverride(tx, key.value);
    if (!removed) throw NotFoundError.of("Surcharge", key.value, { code: "entitlements.override_not_found" });

    await publishEvents(tx, [
      overrideChangedEvent(
        { ctx, clock: d.clock },
        { featureKey: removed.featureKey, effect: null, previousEffect: removed.effect, reason: null, expiresAt: null },
      ),
    ]);
    await d.audit?.record(tx, {
      action: "entitlements.override.remove",
      resource: "feature_override",
      resourceId: key.value,
      before: { effect: removed.effect, reason: removed.reason, expiresAt: removed.expiresAt },
      ctx,
    });
    return removed;
  });

  if (res.ok) d.cache?.invalidate(ctx.tenantId);
  return res;
}
