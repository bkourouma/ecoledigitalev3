/**
 * Cas d'usage d'ÉCRITURE du module (rares) : réglages d'affichage et demande de reconstruction. Dans UNE transaction :
 * écriture -> événement d'outbox -> audit (en dernier : un échec d'audit annule tout).
 */
import { PgOutboxWriter } from "@ecoledigitale/database";
import { ValidationError, createDomainEvent, err, newId, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AnalyticsSettingsData, AnalyticsSettingsUpdate } from "@ecoledigitale/contracts/src/v2/analytics";
import { AnalyticsEvents, type RebuildPayload } from "../domain/events";
import { selectSettings, upsertSettings } from "../infrastructure/read-repository";
import { enqueueRequest } from "../infrastructure/requests-repository";
import { inTx } from "./deps";
import type { AnalyticsDeps } from "./ports";
import { loadThresholds } from "./scope";

export async function getSettings(deps: AnalyticsDeps, ctx: RequestContext): Promise<Result<AnalyticsSettingsData, AppError>> {
  return await inTx(deps, ctx, async (tx) => {
    const t = await loadThresholds(tx);
    return ok({
      collectionGoodBps: t.collectionGoodBps,
      collectionWarningBps: t.collectionWarningBps,
      attendanceGoodBps: t.attendanceGoodBps,
      attendanceWarningBps: t.attendanceWarningBps,
      staleAfterSeconds: t.staleAfterSeconds,
      source: t.source,
    });
  }, { readOnly: true });
}

export async function updateSettings(deps: AnalyticsDeps, ctx: RequestContext, update: AnalyticsSettingsUpdate): Promise<Result<AnalyticsSettingsData, AppError>> {
  return await inTx(deps, ctx, async (tx) => {
    const before = await loadThresholds(tx);
    const merged = {
      collectionGoodBps: update.collectionGoodBps ?? before.collectionGoodBps,
      collectionWarningBps: update.collectionWarningBps ?? before.collectionWarningBps,
      attendanceGoodBps: update.attendanceGoodBps ?? before.attendanceGoodBps,
      attendanceWarningBps: update.attendanceWarningBps ?? before.attendanceWarningBps,
      staleAfterSeconds: update.staleAfterSeconds ?? before.staleAfterSeconds,
    };
    if (merged.collectionWarningBps > merged.collectionGoodBps) {
      return err(new ValidationError("Le seuil d'alerte du recouvrement dépasse son seuil de réussite.", [{ path: ["collectionWarningBps"], message: "Seuil d'alerte supérieur au seuil de réussite.", code: "thresholds_inverted" }]));
    }
    if (merged.attendanceWarningBps > merged.attendanceGoodBps) {
      return err(new ValidationError("Le seuil d'alerte de la présence dépasse son seuil de réussite.", [{ path: ["attendanceWarningBps"], message: "Seuil d'alerte supérieur au seuil de réussite.", code: "thresholds_inverted" }]));
    }
    const previousRow = await selectSettings(tx);
    await upsertSettings(tx, { tenantId: ctx.tenantId, userId: ctx.userId, now: deps.clock.now(), values: merged });
    await deps.audit.record(tx, {
      action: "analytics.settings.update",
      entity: "settings",
      entityId: ctx.tenantId,
      before: previousRow ?? { source: "DEFAULT" },
      after: merged,
      severity: "notice",
    });
    return ok({ ...merged, source: "TENANT" as const });
  });
}

/** Met la reconstruction en file (exécutée par le worker : `analytics.process-refreshes`). Coalescée. */
export async function requestRebuild(deps: AnalyticsDeps, ctx: RequestContext, input: { reason?: string | undefined }): Promise<Result<{ requested: true; requestId: string | null; queued: boolean }, AppError>> {
  return await inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const id = newId();
    const created = await enqueueRequest(tx, { id, tenantId: ctx.tenantId, kind: "REBUILD", scopeKey: "*", cause: { event: "analytics.rebuild.requested", id: ctx.userId, at: now.toISOString() }, now, notBefore: now });
    if (created) {
      const payload: RebuildPayload = { v: 1, requestedBy: ctx.userId, reason: input.reason ?? null, kinds: ["ALL"] };
      await new PgOutboxWriter(tx).append([createDomainEvent({ type: AnalyticsEvents.REBUILD_REQUESTED, ctx, clock: deps.clock, aggregateType: "analytics.rebuild", aggregateId: id, payload })]);
    }
    await deps.audit.record(tx, { action: "analytics.rebuild.request", entity: "rebuild", entityId: created ? id : null, reason: input.reason ?? null, metadata: { alreadyQueued: !created }, severity: "notice" });
    return ok({ requested: true as const, requestId: created ? id : null, queued: created });
  });
}
