/**
 * Récapitulatifs : recalcul DÉRIVÉ (idempotent), lecture avec surcharge tracée, tableau de classe, alertes.
 *
 * Le recalcul est SYNCHRONE dans la transaction de l'opération qui change les pointages (soumission, validation,
 * réouverture, décision de justificatif…) : le récapitulatif est donc toujours cohérent avec les pointages, sans
 * attendre un consommateur asynchrone. Les consommateurs d'événements et le job `attendance.recompute-summaries`
 * rejouent le même calcul en filet de sécurité (idempotent : rejouer ne change aucune valeur).
 *
 * Aucun seuil : les règles d'alerte viennent du port `AlertPolicyPort` (paramètres d'établissement / RuleSet).
 */
import { err, isAppError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { evaluateAlerts, type AlertState } from "../domain/alerts";
import { AttendanceCode, notFound } from "../domain/errors";
import { AttendanceEvents } from "../domain/events";
import { effectiveSummary, sameCounts, validateOverride } from "../domain/summary";
import { EMPTY_SUMMARY, type IsoDate, type SummaryCounts, type SummaryOverride, type Uuid } from "../domain/types";
import {
  computeOnTheFly,
  getAlertStates,
  getLiveOverrides,
  getStoredSummaries,
  listEnrollmentsWithRecords,
  listStaleSummaries,
  listStoredForEnrollments,
  recomputeForPeriod,
  removeOverride,
  replaceOverride,
  saveAlertState,
  type StoredSummary,
} from "../infrastructure/summaries-repository";
import { actorOf, inTx, todayOf, EventBuffer, type AttendanceDeps } from "./deps";
import type { PeriodInfo } from "./ports";

export interface SummaryView {
  readonly enrollmentId: Uuid;
  readonly periodId: Uuid;
  readonly studentId: Uuid | null;
  readonly windowFrom: IsoDate | null;
  readonly windowTo: IsoDate | null;
  readonly derived: SummaryCounts;
  readonly override: Pick<SummaryOverride, "absentMinutes" | "excusedMinutes" | "reason" | "setBy" | "setAt"> | null;
  readonly effective: SummaryCounts;
  readonly overridden: boolean;
  readonly computedAt: Date | null;
}

const viewOf = (
  enrollmentId: Uuid,
  periodId: Uuid,
  stored: StoredSummary | undefined,
  override: SummaryOverride | undefined,
  fallbackWindow?: { from: IsoDate; to: IsoDate },
  fallbackCounts?: SummaryCounts,
): SummaryView => {
  const derived = stored?.counts ?? fallbackCounts ?? EMPTY_SUMMARY;
  return {
    enrollmentId,
    periodId,
    studentId: stored?.studentId ?? null,
    windowFrom: stored?.windowFrom ?? fallbackWindow?.from ?? null,
    windowTo: stored?.windowTo ?? fallbackWindow?.to ?? null,
    derived,
    override: override ? { absentMinutes: override.absentMinutes, excusedMinutes: override.excusedMinutes, reason: override.reason, setBy: override.setBy, setAt: override.setAt } : null,
    effective: effectiveSummary(derived, override ?? null),
    overridden: override !== undefined,
    computedAt: stored?.computedAt ?? null,
  };
};

const isPortUnavailable = (e: unknown): boolean => isAppError(e) && e.code === AttendanceCode.PORT_UNAVAILABLE;

// ---------------------------------------------------------------------------
// Recalcul
// ---------------------------------------------------------------------------

interface Window {
  readonly periodId: Uuid;
  readonly from: IsoDate;
  readonly to: IsoDate;
}

export interface RecomputeInput {
  readonly enrollmentIds: readonly Uuid[];
  /** Année des séances modifiées : permet de CRÉER les récapitulatifs des périodes qui contiennent `dates`. */
  readonly academicYearId?: Uuid | undefined;
  readonly dates?: readonly IsoDate[] | undefined;
  /** Cause tracée dans l'événement `attendance.summary.recomputed`. */
  readonly cause: string;
}

/**
 * Recalcule les récapitulatifs des inscriptions : lignes existantes (fenêtres déjà connues, sans port) PUIS périodes
 * qui contiennent les dates modifiées (si le port des périodes est branché). Publie `attendance.summary.recomputed`
 * pour chaque couple dont la valeur a CHANGÉ et évalue les règles d'alerte.
 */
export async function recomputeAffected(
  deps: AttendanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  input: RecomputeInput,
): Promise<number> {
  const enrollmentIds = [...new Set(input.enrollmentIds)];
  if (enrollmentIds.length === 0) return 0;

  const windows = new Map<Uuid, Window>();
  for (const s of await listStoredForEnrollments(tx, enrollmentIds)) windows.set(s.periodId, { periodId: s.periodId, from: s.windowFrom, to: s.windowTo });

  if (input.academicYearId && input.dates && input.dates.length > 0) {
    try {
      for (const date of new Set(input.dates)) {
        for (const p of await deps.ports.periods.listPeriodsCovering(ctx, { academicYearId: input.academicYearId, date })) {
          if (!windows.has(p.periodId)) windows.set(p.periodId, { periodId: p.periodId, from: p.startsOn, to: p.endsOn });
        }
      }
    } catch (e) {
      if (!isPortUnavailable(e)) throw e;
      deps.logger.warn({ tenantId: ctx.tenantId }, "attendance : port des périodes indisponible, seuls les récapitulatifs existants sont recalculés");
    }
  }

  let changed = 0;
  for (const w of windows.values()) changed += await recomputeWindow(deps, ctx, tx, events, enrollmentIds, w, input.cause);
  return changed;
}

async function recomputeWindow(
  deps: AttendanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  enrollmentIds: readonly Uuid[],
  w: Window,
  cause: string,
): Promise<number> {
  const before = new Map((await getStoredSummaries(tx, enrollmentIds, w.periodId)).map((s) => [s.enrollmentId, s]));
  // Ordre de verrouillage déterministe (inscriptions triées) : deux recalculs concurrents ne s'interbloquent pas.
  const after = [...(await recomputeForPeriod(tx, ctx.tenantId, enrollmentIds, { periodId: w.periodId, from: w.from, to: w.to }))].sort((a, b) =>
    a.enrollmentId < b.enrollmentId ? -1 : a.enrollmentId > b.enrollmentId ? 1 : 0,
  );
  const overrides = await getLiveOverrides(tx, after.map((a) => a.enrollmentId), w.periodId);

  const changedRows = after.filter((a) => {
    const prev = before.get(a.enrollmentId);
    return !prev || !sameCounts(prev.counts, a.counts) || prev.windowFrom !== a.windowFrom || prev.windowTo !== a.windowTo;
  });
  for (const row of changedRows) {
    events.add(
      AttendanceEvents.SUMMARY_RECOMPUTED,
      { v: 1, enrollmentId: row.enrollmentId, periodId: row.periodId, studentId: row.studentId, overridden: overrides.has(row.enrollmentId), cause },
      { type: "period_summary", id: `${row.enrollmentId}:${row.periodId}` },
    );
  }
  // Les alertes dépendent du récapitulatif EFFECTIF : évaluées pour tout ce qui a changé (la surcharge ne change pas le dérivé).
  await evaluateAlertRules(deps, ctx, tx, events, changedRows, overrides, w.periodId);
  return changedRows.length;
}

async function evaluateAlertRules(
  deps: AttendanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  rows: readonly StoredSummary[],
  overrides: ReadonlyMap<Uuid, SummaryOverride>,
  periodId: Uuid,
): Promise<void> {
  if (rows.length === 0) return;
  const rules = await deps.ports.alertPolicy.getRules(tx, ctx);
  const states = await getAlertStates(tx, rows.map((r) => r.enrollmentId), periodId);
  if (rules.length === 0 && states.size === 0) return;
  const now = deps.clock.now();
  for (const row of rows) {
    const summary = effectiveSummary(row.counts, overrides.get(row.enrollmentId) ?? null);
    const previous: AlertState[] = states.get(row.enrollmentId) ?? [];
    for (const t of evaluateAlerts(rules, summary, previous)) {
      await saveAlertState(tx, {
        tenantId: ctx.tenantId, enrollmentId: row.enrollmentId, periodId, studentId: row.studentId, ruleCode: t.ruleCode,
        metric: t.metric, threshold: t.threshold, value: t.value, kind: t.kind, at: now,
      });
      if (t.kind === "UPDATE") continue;
      events.add(
        t.kind === "TRIGGER" ? AttendanceEvents.ALERT_TRIGGERED : AttendanceEvents.ALERT_CLEARED,
        { v: 1, ruleCode: t.ruleCode, metric: t.metric, threshold: t.threshold, value: t.value, enrollmentId: row.enrollmentId, studentId: row.studentId, periodId },
        { type: "period_summary", id: `${row.enrollmentId}:${periodId}` },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export interface GetSummaryInput {
  readonly enrollmentId: Uuid;
  readonly periodId: Uuid;
}

/** Récapitulatif d'une inscription : dérivé, surcharge éventuelle et valeur EFFECTIVE. Aucune écriture. */
export async function getAttendanceSummary(deps: AttendanceDeps, ctx: RequestContext, input: GetSummaryInput): Promise<Result<SummaryView, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const [stored] = await getStoredSummaries(tx, [input.enrollmentId], input.periodId);
      const override = (await getLiveOverrides(tx, [input.enrollmentId], input.periodId)).get(input.enrollmentId);
      if (stored) return ok(viewOf(input.enrollmentId, input.periodId, stored, override));
      // Pas encore de ligne : calcul À LA VOLÉE si la période est connue (un GET n'écrit jamais).
      const period = await deps.ports.periods.getPeriod(ctx, input.periodId).catch((e: unknown) => {
        if (isPortUnavailable(e)) return null;
        throw e;
      });
      if (!period) return ok(viewOf(input.enrollmentId, input.periodId, undefined, override));
      const counts = await computeOnTheFly(tx, input.enrollmentId, period.startsOn, period.endsOn);
      return ok(viewOf(input.enrollmentId, input.periodId, undefined, override, { from: period.startsOn, to: period.endsOn }, counts));
    },
    { readOnly: true },
  );
}

export interface ClassroomSummaryInput {
  readonly classroomId: Uuid;
  readonly periodId: Uuid;
}

/** Tableau de toute la classe pour une période, en un nombre constant de requêtes. */
export async function getClassroomAttendanceSummary(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: ClassroomSummaryInput,
): Promise<Result<{ classroomId: Uuid; periodId: Uuid; rows: SummaryView[] }, AppError>> {
  const period = await deps.ports.periods.getPeriod(ctx, input.periodId);
  if (!period) return err(notFound(AttendanceCode.PERIOD_NOT_FOUND, "Période", input.periodId));
  const today = todayOf(deps);
  const onDate = today < period.startsOn ? period.startsOn : today > period.endsOn ? period.endsOn : today;
  const roster = await deps.ports.roster.getRoster(ctx, { classroomId: input.classroomId, onDate });
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const ids = roster.map((r) => r.enrollmentId);
      const stored = new Map((await getStoredSummaries(tx, ids, input.periodId)).map((s) => [s.enrollmentId, s]));
      const overrides = await getLiveOverrides(tx, ids, input.periodId);
      const rows = roster.map((r) => {
        const view = viewOf(r.enrollmentId, input.periodId, stored.get(r.enrollmentId), overrides.get(r.enrollmentId), { from: period.startsOn, to: period.endsOn });
        return view.studentId ? view : { ...view, studentId: r.studentId };
      });
      return ok({ classroomId: input.classroomId, periodId: input.periodId, rows });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Surcharge tracée
// ---------------------------------------------------------------------------

export interface SetOverrideInput {
  readonly enrollmentId: Uuid;
  readonly periodId: Uuid;
  readonly absentMinutes: number;
  readonly excusedMinutes: number;
  readonly reason: string;
}

/**
 * Pose (ou remplace) la surcharge d'un récapitulatif : motif >= 5 caractères, `excused <= absent`, auteur et date
 * tracés ; l'ancienne surcharge est retirée mais conservée. Sensible : auditée dans la même transaction.
 */
export async function setSummaryOverride(deps: AttendanceDeps, ctx: RequestContext, input: SetOverrideInput): Promise<Result<SummaryView, AppError>> {
  const checked = validateOverride(input);
  if (!checked.ok) return checked;
  const actor = actorOf(ctx);
  if (!actor) return err(notFound(AttendanceCode.FORBIDDEN, "Utilisateur"));
  const period = await deps.ports.periods.getPeriod(ctx, input.periodId).catch((e: unknown) => {
    if (isPortUnavailable(e)) return undefined;
    throw e;
  });
  if (period === null) return err(notFound(AttendanceCode.PERIOD_NOT_FOUND, "Période", input.periodId));

  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const { override, replaced } = await replaceOverride(tx, {
      id: deps.newId(), tenantId: ctx.tenantId, enrollmentId: input.enrollmentId, periodId: input.periodId,
      absentMinutes: checked.value.absentMinutes, excusedMinutes: checked.value.excusedMinutes, reason: checked.value.reason, setBy: actor, at: deps.clock.now(),
    });
    const [stored] = await getStoredSummaries(tx, [input.enrollmentId], input.periodId);
    events.add(
      AttendanceEvents.SUMMARY_RECOMPUTED,
      { v: 1, enrollmentId: input.enrollmentId, periodId: input.periodId, studentId: stored?.studentId ?? null, overridden: true, cause: "OVERRIDE_SET" },
      { type: "period_summary", id: `${input.enrollmentId}:${input.periodId}` },
    );
    events.audit({
      action: "attendance.summary_override.set",
      resourceType: "summary_override",
      resourceId: override.id,
      sensitive: true,
      reason: override.reason,
      before: replaced ? { absentMinutes: replaced.absentMinutes, excusedMinutes: replaced.excusedMinutes } : null,
      after: { enrollmentId: input.enrollmentId, periodId: input.periodId, absentMinutes: override.absentMinutes, excusedMinutes: override.excusedMinutes },
    });
    if (stored) await evaluateAlertRules(deps, ctx, tx, events, [stored], new Map([[input.enrollmentId, override]]), input.periodId);
    await events.flush(tx);
    return ok(viewOf(input.enrollmentId, input.periodId, stored, override));
  });
}

export interface RemoveOverrideInput {
  readonly enrollmentId: Uuid;
  readonly periodId: Uuid;
  readonly reason?: string | undefined;
}

/** Retire la surcharge vivante (l'historique est conservé) : le dérivé redevient la valeur effective. */
export async function removeSummaryOverride(deps: AttendanceDeps, ctx: RequestContext, input: RemoveOverrideInput): Promise<Result<SummaryView, AppError>> {
  const actor = actorOf(ctx);
  if (!actor) return err(notFound(AttendanceCode.FORBIDDEN, "Utilisateur"));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const removed = await removeOverride(tx, input.enrollmentId, input.periodId, actor, deps.clock.now());
    if (!removed) return err(notFound(AttendanceCode.OVERRIDE_NOT_FOUND, "Surcharge", `${input.enrollmentId}:${input.periodId}`));
    const [stored] = await getStoredSummaries(tx, [input.enrollmentId], input.periodId);
    events.add(
      AttendanceEvents.SUMMARY_RECOMPUTED,
      { v: 1, enrollmentId: input.enrollmentId, periodId: input.periodId, studentId: stored?.studentId ?? null, overridden: false, cause: "OVERRIDE_REMOVED" },
      { type: "period_summary", id: `${input.enrollmentId}:${input.periodId}` },
    );
    events.audit({
      action: "attendance.summary_override.removed",
      resourceType: "summary_override",
      resourceId: removed.id,
      sensitive: true,
      reason: input.reason ?? null,
      before: { absentMinutes: removed.absentMinutes, excusedMinutes: removed.excusedMinutes, reason: removed.reason },
    });
    if (stored) await evaluateAlertRules(deps, ctx, tx, events, [stored], new Map(), input.periodId);
    await events.flush(tx);
    return ok(viewOf(input.enrollmentId, input.periodId, stored, undefined));
  });
}

// ---------------------------------------------------------------------------
// Reconstruction explicite (exploitation) et rafraîchissement des récapitulatifs périmés (job)
// ---------------------------------------------------------------------------

export interface RecomputeSummariesInput {
  readonly enrollmentId?: Uuid | undefined;
  readonly periodId?: Uuid | undefined;
  readonly classroomIds?: readonly Uuid[] | undefined;
}

export interface RecomputeReport {
  readonly enrollments: number;
  readonly periods: number;
  readonly changed: number;
}

/**
 * `recomputeSummaries({ enrollmentId?, periodId? })` : reconstruction à la demande. Par période : toutes les inscriptions
 * qui ont des pointages dans sa fenêtre ; par inscription : toutes ses périodes connues et celles de ses séances.
 */
export async function recomputeSummaries(deps: AttendanceDeps, ctx: RequestContext, input: RecomputeSummariesInput): Promise<Result<RecomputeReport, AppError>> {
  let period: PeriodInfo | null = null;
  if (input.periodId) {
    period = await deps.ports.periods.getPeriod(ctx, input.periodId);
    if (!period) return err(notFound(AttendanceCode.PERIOD_NOT_FOUND, "Période", input.periodId));
  }
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    let changed = 0;
    let enrollments = 0;
    let periods = 0;
    if (period) {
      const withRecords = await listEnrollmentsWithRecords(tx, period.startsOn, period.endsOn, input.classroomIds);
      const ids = input.enrollmentId ? withRecords.filter((e) => e === input.enrollmentId) : withRecords;
      enrollments = ids.length;
      periods = 1;
      for (let i = 0; i < ids.length; i += 500) {
        changed += await recomputeWindow(deps, ctx, tx, events, ids.slice(i, i + 500), { periodId: period.periodId, from: period.startsOn, to: period.endsOn }, "RECOMPUTE");
      }
    } else if (input.enrollmentId) {
      const dates = await tx.many<{ academic_year_id: Uuid; session_date: string }>(
        `SELECT DISTINCT s.academic_year_id, s.session_date::text AS session_date
           FROM attendance.student_records r JOIN attendance.sessions s ON s.tenant_id = r.tenant_id AND s.id = r.session_id
          WHERE r.enrollment_id = $1`,
        [input.enrollmentId],
      );
      enrollments = 1;
      const byYear = new Map<Uuid, IsoDate[]>();
      for (const d of dates) byYear.set(d.academic_year_id, [...(byYear.get(d.academic_year_id) ?? []), d.session_date]);
      if (byYear.size === 0) changed += await recomputeAffected(deps, ctx, tx, events, { enrollmentIds: [input.enrollmentId], cause: "RECOMPUTE" });
      for (const [year, ds] of byYear) {
        changed += await recomputeAffected(deps, ctx, tx, events, { enrollmentIds: [input.enrollmentId], academicYearId: year, dates: ds, cause: "RECOMPUTE" });
      }
      periods = (await listStoredForEnrollments(tx, [input.enrollmentId])).length;
    }
    await events.flush(tx);
    return ok({ enrollments, periods, changed });
  });
}

/** Rafraîchit les récapitulatifs dont un pointage ou une séance a changé depuis le dernier calcul (sans port : fenêtres mémorisées). */
export async function refreshStaleSummaries(deps: AttendanceDeps, ctx: RequestContext, options: { limit?: number } = {}): Promise<Result<{ refreshed: number; changed: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const stale = await listStaleSummaries(tx, options.limit ?? 5000);
    const byWindow = new Map<string, { w: Window; ids: Uuid[] }>();
    for (const s of stale) {
      const key = `${s.periodId}|${s.windowFrom}|${s.windowTo}`;
      const entry = byWindow.get(key) ?? { w: { periodId: s.periodId, from: s.windowFrom, to: s.windowTo }, ids: [] };
      entry.ids.push(s.enrollmentId);
      byWindow.set(key, entry);
    }
    let changed = 0;
    for (const { w, ids } of byWindow.values()) changed += await recomputeWindow(deps, ctx, tx, events, ids, w, "STALE_REFRESH");
    await events.flush(tx);
    return ok({ refreshed: stale.length, changed });
  });
}
