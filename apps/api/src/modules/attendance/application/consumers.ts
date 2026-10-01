/**
 * Logique des consommateurs d'événements (appelée par `subscribers.ts`) et des jobs (`jobs.ts`). Chaque fonction est
 * idempotente et tourne sous un contexte `system` ; elle n'utilise AUCUN port d'un autre module (le worker n'en a pas) :
 * seules les données du module servent (fenêtres de période mémorisées dans `period_summaries`).
 */
import { createSystemContext, isUuid, ok, unwrap, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb } from "@ecoledigitale/database";
import { AttendanceCode } from "../domain/errors";
import type { Uuid } from "../domain/types";
import { listStoredForPeriod } from "../infrastructure/summaries-repository";
import { findSessionByOccurrence } from "../infrastructure/sessions-repository";
import { EventBuffer, inTx, type AttendanceDeps } from "./deps";
import { instantiateAttendancePack } from "./reference";
import { cancelSessionInTx } from "./sessions";
import { recomputeAffected, refreshStaleSummaries } from "./summaries";

// ---------------------------------------------------------------------------
// Lecteurs purs des charges consommées (alignés sur les schémas des producteurs ; testés par
// `apps/api/test/events-contracts/attendance.test.ts`)
// ---------------------------------------------------------------------------

function uuidField(payload: unknown, key: string): Uuid | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === "string" && isUuid(v) ? v : undefined;
}

/** `scheduling.occurrence.cancelled` : la séance annulée (`occurrenceId`). */
export const readCancelledOccurrenceId = (payload: unknown): Uuid | undefined => uuidField(payload, "occurrenceId");

/** `academic.enrollment.withdrawn|cancelled|transferred` : l'inscription concernée (`enrollmentId`). */
export const readChangedEnrollmentId = (payload: unknown): Uuid | undefined => uuidField(payload, "enrollmentId");

/** `academic.period.closed|reopened` : la période concernée (`periodId`). */
export const readChangedPeriodId = (payload: unknown): Uuid | undefined => uuidField(payload, "periodId");

/** `tenancy.tenant.provisioned` : établissements créés (`institutionIds`) ; `institutionId` reste toléré pour un événement unitaire. */
export function readProvisionedInstitutionIds(payload: unknown): Uuid[] {
  const p = (payload && typeof payload === "object" ? payload : {}) as { institutionId?: unknown; institutionIds?: unknown };
  return [
    ...(typeof p.institutionId === "string" && isUuid(p.institutionId) ? [p.institutionId] : []),
    ...(Array.isArray(p.institutionIds) ? p.institutionIds.filter((x): x is string => typeof x === "string" && isUuid(x)) : []),
  ];
}

/**
 * `scheduling.occurrence.cancelled` : l'appel non validé est annulé ; un appel déjà VALIDÉ est annulé par réouverture
 * automatique et motivée (`occurrence_cancelled`), tracée dans l'audit (acteur système). Sans appel : sans effet.
 */
export async function onOccurrenceCancelled(deps: AttendanceDeps, ctx: RequestContext, input: { occurrenceId: Uuid }): Promise<Result<{ cancelled: boolean }, AppError>> {
  return inTx<{ cancelled: boolean }>(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const session = await findSessionByOccurrence(tx, input.occurrenceId);
    if (!session) return ok({ cancelled: false });
    const result = await cancelSessionInTx(deps, ctx, tx, events, {
      sessionId: session.id, reason: "occurrence_cancelled : la séance planifiée a été annulée", cause: "OCCURRENCE_CANCELLED",
    });
    if (!result.ok) return result;
    await events.flush(tx);
    return ok({ cancelled: true });
  });
}

/** `academic.enrollment.withdrawn|cancelled|transferred` : les récapitulatifs de l'inscription sont recalculés (pointages passés conservés). */
export async function onEnrollmentChanged(deps: AttendanceDeps, ctx: RequestContext, input: { enrollmentId: Uuid }): Promise<Result<{ changed: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const changed = await recomputeAffected(deps, ctx, tx, events, { enrollmentIds: [input.enrollmentId], cause: "ENROLLMENT_CHANGED" });
    await events.flush(tx);
    return ok({ changed });
  });
}

/**
 * `academic.period.closed|reopened` : les récapitulatifs déjà calculés de la période sont rejoués. Le module ne verrouille
 * PAS l'assiduité à la clôture (une excuse acceptée après coup s'applique et republie `summary.recomputed`) : un bulletin
 * déjà figé reste un instantané, c'est aux consommateurs (013) de décider de le régénérer.
 */
export async function onPeriodChanged(deps: AttendanceDeps, ctx: RequestContext, input: { periodId: Uuid }): Promise<Result<{ changed: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const stored = await listStoredForPeriod(tx, input.periodId);
    let changed = 0;
    for (let i = 0; i < stored.length; i += 500) {
      changed += await recomputeAffected(deps, ctx, tx, events, { enrollmentIds: stored.slice(i, i + 500).map((s) => s.enrollmentId), cause: "PERIOD_CHANGED" });
    }
    await events.flush(tx);
    return ok({ changed });
  });
}

/** `tenancy.tenant.provisioned` : amorçage des référentiels du pack (idempotent, non destructif). */
export async function onTenantProvisioned(deps: AttendanceDeps, ctx: RequestContext, input: { institutionIds?: readonly Uuid[] } = {}): Promise<Result<{ statuses: number }, AppError>> {
  const seeded = await instantiateAttendancePack(deps, ctx, { institutionIds: input.institutionIds ?? [] });
  if (!seeded.ok) return seeded;
  return ok({ statuses: seeded.value.statuses });
}

/** Erreurs métier à ignorer par un consommateur (rien à faire ; rejouer ne servirait à rien). */
export const isBenignConsumerError = (e: AppError): boolean => e.code === AttendanceCode.SESSION_NOT_FOUND || e.code === AttendanceCode.PORT_UNAVAILABLE;

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/**
 * Job `attendance.recompute-summaries` : rafraîchit, tenant par tenant, les récapitulatifs dont un pointage ou une séance
 * a changé depuis le dernier calcul (filet de sécurité : le recalcul normal est synchrone). Idempotent.
 */
export async function recomputeAllTenants(
  deps: AttendanceDeps,
  systemDb: SystemDb,
  options: { limitPerTenant?: number } = {},
): Promise<ForEachTenantReport<{ refreshed: number; changed: number }>> {
  return systemDb.forEachTenant("attendance-recompute-summaries", async (_tx, tenant) => {
    const ctx = createSystemContext(tenant.id);
    return unwrap(await refreshStaleSummaries(deps, ctx, options.limitPerTenant ? { limit: options.limitPerTenant } : {}));
  });
}

