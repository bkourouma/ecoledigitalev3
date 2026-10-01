/**
 * Réactions aux événements des autres modules (spec 017 §11). Chaque fonction est IDEMPOTENTE par
 * construction (un rejeu ne change rien : constat déjà posé, séance déjà signalée ou annulée) ; elle
 * s'exécute sous un contexte SYSTÈME du tenant de l'événement.
 *
 * ⚠ Les noms et charges des événements d'autres modules sont des HYPOTHÈSES DE TRAVAIL
 * (specs/v2/011-assessments-grades/interfaces-publiees.md §3) à aligner avec leurs producteurs :
 *
 *   attendance.session.submitted         { occurrenceId }                      → constat HELD
 *   attendance.staff_leave.approved      { staffId, startsOn, endsOn }         → séances à remplacer
 *   people.staff.status_changed          { staffId, status }                   → LEFT / SUSPENDED : à remplacer
 *   people.teaching_assignment.ended     { staffId, classroomId }              → à remplacer
 *   academic.offering.cancelled          { offeringId }                        → annulation en cascade
 *   academic.classroom.cancelled         { classroomId }                       → annulation en cascade
 *   academic.year.closed                 { academicYearId }                    → emplois du temps archivés
 *   tenancy.tenant.provisioned           —                                     → référentiels de pack
 */
import { ABIDJAN_TZ, createSystemContext, isUuid, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { SchedulingEvents } from "../domain/events";
import { addDays, isIsoDate, localToInstant } from "../domain/time";
import type { ReplacementReason } from "../domain/types";
import * as occRepo from "../infrastructure/occurrence-repo";
import * as q from "../infrastructure/read-queries";
import { listSettingsInstitutions } from "../infrastructure/reference-repo";
import * as tt from "../infrastructure/timetable-repo";
import { EventBuffer, inTx, setChangeReason, type SchedulingDeps } from "./deps";
import { cancelOccurrence, holdOccurrence } from "./occurrences";
import { seedReferenceData } from "./reference";
import { OCCURRENCE_AGGREGATE } from "./support";
import { archiveTimetable } from "./timetables";

const asString = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const asUuid = (v: unknown): string | null => (isUuid(v) ? v : null);

export interface ConsumeReport {
  /** Séances touchées (constatées, signalées, annulées, emplois du temps archivés…). */
  affected: number;
  ignored?: string;
}

const ignored = (reason: string): Result<ConsumeReport, AppError> => ok({ affected: 0, ignored: reason });

const systemCtx = (tenantId: string): RequestContext => createSystemContext(tenantId);

/** `attendance.session.submitted` : l'appel soumis constate la séance (source ATTENDANCE). */
export async function onAttendanceSessionSubmitted(deps: SchedulingDeps, tenantId: string, payload: unknown): Promise<Result<ConsumeReport, AppError>> {
  const occurrenceId = asUuid((payload as { occurrenceId?: unknown } | null)?.occurrenceId);
  if (!occurrenceId) return ignored("occurrenceId absent (l'événement d'appel doit porter la séance)");
  const r = await holdOccurrence(deps, systemCtx(tenantId), { occurrenceId, source: "ATTENDANCE" });
  if (!r.ok) {
    if (r.error.kind === "not_found") return ignored("séance inconnue");
    return r;
  }
  return ok({ affected: r.value.alreadyHeld || r.value.ignoredCancelled ? 0 : 1 });
}

async function flagReplacement(deps: SchedulingDeps, tenantId: string, rows: readonly { occurrenceId: string }[], reason: ReplacementReason, extra: Record<string, unknown>): Promise<Result<ConsumeReport, AppError>> {
  const ids = [...new Set(rows.map((r) => r.occurrenceId))];
  if (ids.length === 0) return ok({ affected: 0 });
  const ctx = systemCtx(tenantId);
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const now = deps.clock.now();
    let affected = 0;
    for (const id of ids) {
      const occ = await occRepo.getOccurrence(tx, id, { forUpdate: true });
      // Idempotent : déjà signalée, annulée, validée ou constatée → rien à faire.
      if (!occ || occ.needsReplacement || occ.status !== "PLANNED" || occ.validatedAt !== null) continue;
      await occRepo.setNeedsReplacement(tx, [id], reason, now);
      const staff = (await occRepo.listStaffByOccurrence(tx, [id])).get(id) ?? [];
      buf.add(
        SchedulingEvents.occurrenceReplacementNeeded,
        { v: 1, occurrenceId: id, reason: reason.toLowerCase(), occursOn: occ.occursOn, classroomId: occ.classroomId, staffIds: staff.map((s) => s.staffId), ...extra },
        { type: OCCURRENCE_AGGREGATE, id },
      );
      affected += 1;
    }
    await buf.flush(tx);
    return ok({ affected });
  });
}

/** `attendance.staff_leave.approved` : les séances futures PLANNED de l'intéressé pendant le congé sont signalées. */
export async function onStaffLeaveApproved(deps: SchedulingDeps, tenantId: string, payload: unknown): Promise<Result<ConsumeReport, AppError>> {
  const p = (payload ?? {}) as { staffId?: unknown; startsOn?: unknown; endsOn?: unknown };
  const staffId = asUuid(p.staffId);
  const startsOn = asString(p.startsOn);
  const endsOn = asString(p.endsOn);
  if (!staffId || !startsOn || !endsOn || !isIsoDate(startsOn) || !isIsoDate(endsOn) || endsOn < startsOn) return ignored("charge invalide (staffId, startsOn, endsOn)");
  const ctx = systemCtx(tenantId);
  const rows = await inTx(
    deps,
    ctx,
    async (tx) => {
      // Les bornes du congé sont des dates civiles de l'établissement : on les ramène à des instants dans son fuseau.
      const institutions = await listSettingsInstitutions(tx);
      const tz = institutions[0]?.timezone ?? ABIDJAN_TZ;
      const from = localToInstant(startsOn, 0, tz);
      const to = localToInstant(addDays(endsOn, 1), 0, tz);
      return ok(await q.futurePlannedForStaff(tx, [staffId], from.getTime() > deps.clock.now().getTime() ? from : deps.clock.now(), to));
    },
    { readOnly: true },
  );
  if (!rows.ok) return rows;
  return flagReplacement(deps, tenantId, rows.value, "STAFF_LEAVE", { staffId, leave: { startsOn, endsOn } });
}

/** `people.staff.status_changed` vers LEFT ou SUSPENDED : toutes ses séances futures PLANNED sont signalées. */
export async function onStaffStatusChanged(deps: SchedulingDeps, tenantId: string, payload: unknown): Promise<Result<ConsumeReport, AppError>> {
  const p = (payload ?? {}) as { staffId?: unknown; status?: unknown };
  const staffId = asUuid(p.staffId);
  const status = asString(p.status)?.toUpperCase();
  if (!staffId || !status) return ignored("charge invalide (staffId, status)");
  if (status !== "LEFT" && status !== "SUSPENDED") return ignored(`statut ${status} sans effet sur le planning`);
  const ctx = systemCtx(tenantId);
  const rows = await inTx(deps, ctx, async (tx) => ok(await q.futurePlannedForStaff(tx, [staffId], deps.clock.now(), null)), { readOnly: true });
  if (!rows.ok) return rows;
  return flagReplacement(deps, tenantId, rows.value, status === "LEFT" ? "STAFF_LEFT" : "STAFF_SUSPENDED", { staffId });
}

/** `people.teaching_assignment.ended` : ses séances futures dans cette classe sont signalées. */
export async function onTeachingAssignmentEnded(deps: SchedulingDeps, tenantId: string, payload: unknown): Promise<Result<ConsumeReport, AppError>> {
  const p = (payload ?? {}) as { staffId?: unknown; classroomId?: unknown };
  const staffId = asUuid(p.staffId);
  const classroomId = asUuid(p.classroomId);
  if (!staffId || !classroomId) return ignored("charge invalide (staffId, classroomId)");
  const ctx = systemCtx(tenantId);
  const rows = await inTx(deps, ctx, async (tx) => ok(await q.futurePlannedForStaff(tx, [staffId], deps.clock.now(), null, classroomId)), { readOnly: true });
  if (!rows.ok) return rows;
  return flagReplacement(deps, tenantId, rows.value, "ASSIGNMENT_ENDED", { staffId, classroomId });
}

async function cancelFuture(deps: SchedulingDeps, tenantId: string, target: { offeringId?: string; classroomId?: string }, reason: string): Promise<Result<ConsumeReport, AppError>> {
  const ctx = systemCtx(tenantId);
  const ids = await inTx(deps, ctx, async (tx) => ok(await q.futurePlannedByTarget(tx, target, deps.clock.now())), { readOnly: true });
  if (!ids.ok) return ids;
  let affected = 0;
  for (const occurrenceId of ids.value) {
    const r = await cancelOccurrence(deps, ctx, { occurrenceId, reason });
    if (r.ok && !r.value.alreadyCancelled) affected += 1;
    // Une séance devenue validée/verrouillée entre-temps n'est pas annulée (gel) : on passe.
  }
  return ok({ affected });
}

/** `academic.offering.cancelled` : les séances futures non validées de l'offre sont annulées. */
export async function onOfferingCancelled(deps: SchedulingDeps, tenantId: string, payload: unknown): Promise<Result<ConsumeReport, AppError>> {
  const offeringId = asUuid((payload as { offeringId?: unknown } | null)?.offeringId);
  if (!offeringId) return ignored("offeringId absent");
  return cancelFuture(deps, tenantId, { offeringId }, "Offre annulée");
}

/** `academic.classroom.cancelled` : les séances futures non validées de la classe sont annulées. */
export async function onClassroomCancelled(deps: SchedulingDeps, tenantId: string, payload: unknown): Promise<Result<ConsumeReport, AppError>> {
  const classroomId = asUuid((payload as { classroomId?: unknown } | null)?.classroomId);
  if (!classroomId) return ignored("classroomId absent");
  return cancelFuture(deps, tenantId, { classroomId }, "Classe annulée");
}

/** `academic.year.closed` : les emplois du temps de l'année sont archivés (les séances passées restent). */
export async function onYearClosed(deps: SchedulingDeps, tenantId: string, payload: unknown): Promise<Result<ConsumeReport, AppError>> {
  const academicYearId = asUuid((payload as { academicYearId?: unknown } | null)?.academicYearId);
  if (!academicYearId) return ignored("academicYearId absent");
  const ctx = systemCtx(tenantId);
  const list = await inTx(deps, ctx, async (tx) => ok((await tt.listTimetables(tx, { academicYearId })).filter((t) => t.status !== "ARCHIVED")), { readOnly: true });
  if (!list.ok) return list;
  let affected = 0;
  for (const t of list.value) {
    const r = await archiveTimetable(deps, ctx, { timetableId: t.id });
    if (r.ok) affected += 1;
  }
  return ok({ affected });
}

/** `tenancy.tenant.provisioned` : types de salle et d'événement du pack (idempotent). */
export async function onTenantProvisioned(deps: SchedulingDeps, tenantId: string): Promise<Result<ConsumeReport, AppError>> {
  const ctx = systemCtx(tenantId);
  return inTx(deps, ctx, async (tx) => {
    const r = await seedReferenceData(tx, tenantId, deps);
    await setChangeReason(tx, null);
    return ok({ affected: r.roomTypes + r.eventKinds });
  });
}
