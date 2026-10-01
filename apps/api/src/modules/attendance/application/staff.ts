/**
 * Présence quotidienne du personnel et congés (PRD §33). Une ligne par (membre, jour) — ou par (membre, occurrence).
 *
 *  - `ON_LEAVE` exige un congé APPROUVÉ ; un jour de congé approuvé impose `ON_LEAVE` (correction explicite possible) ;
 *  - deux congés APPROUVÉS d'un même membre ne se chevauchent pas (contrainte d'exclusion de la base) ;
 *  - l'approbation publie `attendance.staff_leave.approved` (017 : séances à remplacer ; 032 : congés payés) ; elle ne
 *    modifie JAMAIS le statut du membre du personnel (décision explicite côté 009) ;
 *  - décisions sur les congés et approbations : sensibles, auditées dans la même transaction.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { pgErrorCode } from "@ecoledigitale/database";
import { AttendanceCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { AttendanceEvents } from "../domain/events";
import { approvedLeaveDaysWithin, assertLeaveTransition, resolveStaffStatus, validateLeaveWindow } from "../domain/staff";
import { indexStatuses } from "../domain/status";
import type { IsoDate, LeaveStatus, Uuid } from "../domain/types";
import { getLeaveType, listStatuses } from "../infrastructure/reference-repository";
import {
  decideLeave,
  findApprovedLeaveOn,
  findStaffRecord,
  findStaffRecordByClientId,
  getLeave,
  insertLeave,
  listApprovedLeavesWithin,
  listLeaves,
  listStaffRecords as repoListStaffRecords,
  summarizeStaff,
  upsertStaffRecord,
} from "../infrastructure/staff-repository";
import type { StaffLeave, StaffRecord } from "../infrastructure/rows";
import { EventBuffer, actorOf, inTx, todayOf, type AttendanceDeps, type CallerCaps } from "./deps";
import { ensureReferenceData } from "./reference";

// ---------------------------------------------------------------------------
// Présence
// ---------------------------------------------------------------------------

async function ownStaffId(deps: AttendanceDeps, ctx: RequestContext): Promise<Uuid | null> {
  return ctx.userId ? deps.ports.people.getStaffIdForUser(ctx, ctx.userId) : null;
}

/** Autorisation : `staff.record` agit sur tout le personnel ; `own.record` seulement sur soi-même. */
async function authorizeStaff(deps: AttendanceDeps, ctx: RequestContext, caps: CallerCaps, staffId: Uuid, kind: "record" | "leave"): Promise<Result<true, AppError>> {
  if (caps.staffRecord) return ok(true);
  const own = await ownStaffId(deps, ctx);
  const allowed = kind === "record" ? caps.ownRecord === true : caps.leaveRequest === true;
  if (allowed && own !== null && own === staffId) return ok(true);
  return err(forbidden(AttendanceCode.FORBIDDEN, "Vous ne pouvez agir que sur votre propre présence."));
}

export interface MarkStaffInput {
  readonly staffId: Uuid;
  readonly workDate: IsoDate;
  readonly statusCode: string;
  readonly occurrenceId?: Uuid | undefined;
  readonly checkInAt?: Date | undefined;
  readonly checkOutAt?: Date | undefined;
  readonly minutesLate?: number | undefined;
  readonly note?: string | undefined;
  readonly overrideLeave?: boolean | undefined;
  readonly clientId?: Uuid | undefined;
  readonly source?: StaffRecord["source"];
  readonly caps?: CallerCaps;
}

export interface MarkStaffResult {
  readonly record: StaffRecord;
  readonly replayed: boolean;
}

/** `markStaffAttendance` : idempotent par (membre, jour[, occurrence]) et par `clientId`. */
export async function markStaffAttendance(deps: AttendanceDeps, ctx: RequestContext, input: MarkStaffInput): Promise<Result<MarkStaffResult, AppError>> {
  const caps = input.caps ?? {};
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "Utilisateur identifié requis."));
  const auth = await authorizeStaff(deps, ctx, caps, input.staffId, "record");
  if (!auth.ok) return auth;
  const staff = await deps.ports.people.getStaffById(ctx, input.staffId);
  if (!staff || !staff.active) return err(notFound(AttendanceCode.STAFF_NOT_FOUND, "Membre du personnel actif", input.staffId));
  if (input.checkInAt && input.checkOutAt && input.checkOutAt < input.checkInAt) {
    return err(validation(AttendanceCode.INVALID_INPUT, "Le départ précède l'arrivée.", "checkOutAt"));
  }

  return inTx<MarkStaffResult>(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    await ensureReferenceData(deps, ctx, tx);
    if (input.clientId) {
      const known = await findStaffRecordByClientId(tx, input.clientId);
      if (known) return ok({ record: known, replayed: true });
    }
    const defs = indexStatuses(await listStatuses(tx, "STAFF"), "STAFF");
    const def = defs.get(input.statusCode);
    if (!def) return err(validation(AttendanceCode.STATUS_UNKNOWN, `Statut de présence inconnu : ${input.statusCode}.`, "statusCode"));
    if (!def.active) return err(validation(AttendanceCode.STATUS_INACTIVE, `Le statut ${input.statusCode} est désactivé.`, "statusCode"));
    if (input.minutesLate !== undefined && !def.countsAsLate) {
      return err(validation(AttendanceCode.MINUTES_INVALID, "Les minutes de retard ne s'appliquent qu'à un statut de retard.", "minutesLate"));
    }

    const leave = await findApprovedLeaveOn(tx, input.staffId, input.workDate);
    const status = resolveStaffStatus({
      requested: input.statusCode, workDate: input.workDate, overrideLeave: input.overrideLeave === true,
      approvedLeave: leave ? { id: leave.id, startsOn: leave.startsOn, endsOn: leave.endsOn } : null,
    });
    if (!status.ok) return status;

    const previous = await findStaffRecord(tx, input.staffId, input.workDate, input.occurrenceId ?? null);
    const record = await upsertStaffRecord(tx, {
      id: deps.newId(), tenantId: ctx.tenantId, staffId: input.staffId, workDate: input.workDate, occurrenceId: input.occurrenceId ?? null,
      statusCode: status.value.statusCode, checkInAt: input.checkInAt ?? null, checkOutAt: input.checkOutAt ?? null, minutesLate: input.minutesLate ?? null,
      leaveId: status.value.leaveId, note: input.note?.trim() || null, source: input.source ?? (caps.staffRecord ? "MANUAL" : "SELF"), markedBy: actor,
      markedAt: deps.clock.now(), clientId: input.clientId ?? null,
    });
    if (def.countsAsAbsence && previous?.statusCode !== record.statusCode) {
      events.add(
        AttendanceEvents.STAFF_ABSENCE_RECORDED,
        { v: 1, recordId: record.id, staffId: record.staffId, workDate: record.workDate, statusCode: record.statusCode, occurrenceId: record.occurrenceId },
        { type: "staff_record", id: record.id },
      );
    }
    await events.flush(tx);
    return ok({ record, replayed: false });
  });
}

export interface CheckInInput {
  readonly staffId?: Uuid | undefined;
  readonly workDate?: IsoDate | undefined;
  readonly statusCode?: "PRESENT" | "LATE" | undefined;
  readonly minutesLate?: number | undefined;
  readonly at?: Date | undefined;
  readonly clientId?: Uuid | undefined;
  readonly caps?: CallerCaps;
}

/** `checkInStaff` : arrivée du jour (le serveur horodate si l'appareil ne fournit pas l'heure). Idempotent : la première arrivée est conservée. */
export async function checkInStaff(deps: AttendanceDeps, ctx: RequestContext, input: CheckInInput): Promise<Result<MarkStaffResult, AppError>> {
  const staffId = input.staffId ?? (await ownStaffId(deps, ctx));
  if (!staffId) return err(forbidden(AttendanceCode.FORBIDDEN, "Aucun profil de personnel n'est lié à votre compte."));
  const workDate = input.workDate ?? todayOf(deps);
  const existing = await deps.db.run(ctx, (tx) => findStaffRecord(tx, staffId, workDate, null), { readOnly: true });
  if (existing?.checkInAt) return ok({ record: existing, replayed: true });
  return markStaffAttendance(deps, ctx, {
    staffId, workDate, statusCode: input.statusCode ?? "PRESENT", checkInAt: input.at ?? deps.clock.now(), minutesLate: input.minutesLate, clientId: input.clientId, caps: input.caps,
  });
}

/** `checkOutStaff` : départ du jour ; exige une présence enregistrée et ne précède jamais l'arrivée. */
export async function checkOutStaff(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: { staffId?: Uuid | undefined; workDate?: IsoDate | undefined; at?: Date | undefined; caps?: CallerCaps },
): Promise<Result<MarkStaffResult, AppError>> {
  const staffId = input.staffId ?? (await ownStaffId(deps, ctx));
  if (!staffId) return err(forbidden(AttendanceCode.FORBIDDEN, "Aucun profil de personnel n'est lié à votre compte."));
  const workDate = input.workDate ?? todayOf(deps);
  const existing = await deps.db.run(ctx, (tx) => findStaffRecord(tx, staffId, workDate, null), { readOnly: true });
  if (!existing) return err(conflict(AttendanceCode.CHECKOUT_WITHOUT_CHECKIN, "Aucune arrivée n'est enregistrée pour ce jour.", { staffId, workDate }));
  if (existing.checkOutAt) return ok({ record: existing, replayed: true });
  return markStaffAttendance(deps, ctx, {
    staffId, workDate, statusCode: existing.statusCode, checkInAt: existing.checkInAt ?? undefined, checkOutAt: input.at ?? deps.clock.now(), minutesLate: existing.minutesLate ?? undefined,
    overrideLeave: existing.leaveId !== null ? undefined : true, caps: input.caps,
  });
}

export async function listStaffRecords(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: { staffId?: Uuid | undefined; from: IsoDate; to: IsoDate; statusCode?: string | undefined; limit?: number | undefined; cursor?: string | undefined; caps?: CallerCaps },
): Promise<Result<{ items: StaffRecord[]; nextCursor: string | null }, AppError>> {
  const broad = input.caps?.staffRead === true || input.caps?.staffRecord === true;
  const own = broad ? null : await ownStaffId(deps, ctx);
  if (!broad && !own) return ok({ items: [], nextCursor: null });
  return inTx(deps, ctx, async (tx) => ok(await repoListStaffRecords(tx, { ...input, staffId: broad ? input.staffId : (own as Uuid) })), { readOnly: true });
}

export interface StaffSummaryRow {
  readonly staffId: Uuid;
  readonly days: number;
  readonly byStatus: Record<string, number>;
  readonly lateMinutes: number;
  readonly approvedLeaveDays: number;
}

/** `getStaffAttendanceSummary` : comptages bruts par membre (jours par statut, minutes de retard, jours de congé approuvés). */
export async function getStaffAttendanceSummary(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: { from: IsoDate; to: IsoDate; staffId?: Uuid | undefined; caps?: CallerCaps },
): Promise<Result<{ from: IsoDate; to: IsoDate; rows: StaffSummaryRow[] }, AppError>> {
  const broad = input.caps?.staffRead === true;
  const own = broad ? null : await ownStaffId(deps, ctx);
  if (!broad && !own) return err(forbidden(AttendanceCode.FORBIDDEN, "Consulter la présence du personnel exige la permission dédiée."));
  const staffId = broad ? input.staffId : (own as Uuid);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const [lines, leaves] = await Promise.all([summarizeStaff(tx, input.from, input.to, staffId), listApprovedLeavesWithin(tx, input.from, input.to, staffId)]);
      const rows = new Map<Uuid, { days: number; byStatus: Record<string, number>; lateMinutes: number; leaves: StaffLeave[] }>();
      const row = (id: Uuid) => {
        const cur = rows.get(id) ?? { days: 0, byStatus: {}, lateMinutes: 0, leaves: [] };
        rows.set(id, cur);
        return cur;
      };
      for (const l of lines) {
        const r = row(l.staffId);
        r.days += l.days;
        r.byStatus[l.statusCode] = (r.byStatus[l.statusCode] ?? 0) + l.days;
        r.lateMinutes += l.lateMinutes;
      }
      for (const l of leaves) row(l.staffId).leaves.push(l);
      return ok({
        from: input.from,
        to: input.to,
        rows: [...rows.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([id, r]) => ({ staffId: id, days: r.days, byStatus: r.byStatus, lateMinutes: r.lateMinutes, approvedLeaveDays: approvedLeaveDaysWithin(r.leaves, input.from, input.to) })),
      });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Congés
// ---------------------------------------------------------------------------

export interface RequestLeaveInput {
  readonly staffId?: Uuid | undefined;
  readonly leaveTypeCode: string;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate;
  readonly halfDayStart?: boolean | undefined;
  readonly halfDayEnd?: boolean | undefined;
  readonly reason?: string | undefined;
  readonly documentRef?: Uuid | undefined;
  readonly caps?: CallerCaps;
}

/** `requestStaffLeave` : le membre demande son congé ; la RH peut le saisir pour un membre (`staff.record`). */
export async function requestStaffLeave(deps: AttendanceDeps, ctx: RequestContext, input: RequestLeaveInput): Promise<Result<StaffLeave, AppError>> {
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "Utilisateur identifié requis."));
  const staffId = input.staffId ?? (await ownStaffId(deps, ctx));
  if (!staffId) return err(forbidden(AttendanceCode.FORBIDDEN, "Aucun profil de personnel n'est lié à votre compte."));
  const caps = input.caps ?? {};
  const auth = await authorizeStaff(deps, ctx, caps, staffId, "leave");
  if (!auth.ok) return auth;
  const window = validateLeaveWindow({ startsOn: input.startsOn, endsOn: input.endsOn });
  if (!window.ok) return window;
  const staff = await deps.ports.people.getStaffById(ctx, staffId);
  if (!staff || !staff.active) return err(notFound(AttendanceCode.STAFF_NOT_FOUND, "Membre du personnel actif", staffId));

  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    await ensureReferenceData(deps, ctx, tx);
    const type = await getLeaveType(tx, input.leaveTypeCode);
    if (!type || !type.active) return err(validation(AttendanceCode.LEAVE_TYPE_UNKNOWN, `Type de congé inconnu ou désactivé : ${input.leaveTypeCode}.`, "leaveTypeCode"));
    const leave = await insertLeave(tx, {
      id: deps.newId(), tenantId: ctx.tenantId, staffId, leaveTypeCode: input.leaveTypeCode, startsOn: input.startsOn, endsOn: input.endsOn,
      halfDayStart: input.halfDayStart ?? false, halfDayEnd: input.halfDayEnd ?? false, reason: input.reason?.trim() || null, requestedBy: actor,
      requestedAt: deps.clock.now(), documentRef: input.documentRef ?? null,
    });
    events.add(
      AttendanceEvents.LEAVE_REQUESTED,
      { v: 1, leaveId: leave.id, staffId, startsOn: leave.startsOn, endsOn: leave.endsOn },
      { type: "staff_leave", id: leave.id },
    );
    events.audit({ action: "attendance.staff_leave.requested", resourceType: "staff_leave", resourceId: leave.id, metadata: { staffId, leaveTypeCode: leave.leaveTypeCode } });
    await events.flush(tx);
    return ok(leave);
  });
}

/** `approveStaffLeave` (`attendance.leave.decide`, sensible) : deux congés approuvés ne se chevauchent pas. */
export async function approveStaffLeave(deps: AttendanceDeps, ctx: RequestContext, input: { leaveId: Uuid; note?: string | undefined; caps?: CallerCaps }): Promise<Result<StaffLeave, AppError>> {
  if (!input.caps?.leaveDecide) return err(forbidden(AttendanceCode.FORBIDDEN, "Approuver un congé exige la permission de décision."));
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "Utilisateur identifié requis."));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const leave = await getLeave(tx, input.leaveId, true);
    if (!leave) return err(notFound(AttendanceCode.LEAVE_NOT_FOUND, "Congé", input.leaveId));
    const transition = assertLeaveTransition(leave.status, "APPROVED");
    if (!transition.ok) return transition;
    const type = await getLeaveType(tx, leave.leaveTypeCode);
    if (type?.requiresAttachment && !leave.documentRef) {
      return err(validation(AttendanceCode.ATTACHMENT_REQUIRED, "Ce type de congé exige un justificatif avant l'approbation.", "documentRef", { leaveTypeCode: leave.leaveTypeCode }));
    }
    let approved: StaffLeave;
    try {
      approved = await tx.transaction((stx) => decideLeave(stx, leave.id, { status: "APPROVED", decidedBy: actor, decidedAt: deps.clock.now(), decisionNote: input.note?.trim() || null }));
    } catch (e) {
      if (pgErrorCode(e) === "23P01") {
        return err(conflict(AttendanceCode.LEAVE_OVERLAP, "Ce membre a déjà un congé approuvé qui recoupe ces dates.", { staffId: leave.staffId }));
      }
      throw e;
    }
    events.add(
      AttendanceEvents.LEAVE_APPROVED,
      { v: 1, leaveId: approved.id, staffId: approved.staffId, leaveTypeCode: approved.leaveTypeCode, startsOn: approved.startsOn, endsOn: approved.endsOn },
      { type: "staff_leave", id: approved.id },
    );
    events.audit({
      action: "attendance.staff_leave.approved", resourceType: "staff_leave", resourceId: approved.id, sensitive: true, reason: input.note ?? null,
      after: { staffId: approved.staffId, startsOn: approved.startsOn, endsOn: approved.endsOn },
    });
    await events.flush(tx);
    return ok(approved);
  });
}

/** `rejectStaffLeave` : note obligatoire. */
export async function rejectStaffLeave(deps: AttendanceDeps, ctx: RequestContext, input: { leaveId: Uuid; note: string; caps?: CallerCaps }): Promise<Result<StaffLeave, AppError>> {
  if (!input.caps?.leaveDecide) return err(forbidden(AttendanceCode.FORBIDDEN, "Refuser un congé exige la permission de décision."));
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "Utilisateur identifié requis."));
  const note = input.note.trim();
  if (note.length < 3) return err(validation(AttendanceCode.REASON_REQUIRED, "Une note de refus est obligatoire.", "note"));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const leave = await getLeave(tx, input.leaveId, true);
    if (!leave) return err(notFound(AttendanceCode.LEAVE_NOT_FOUND, "Congé", input.leaveId));
    const transition = assertLeaveTransition(leave.status, "REJECTED");
    if (!transition.ok) return transition;
    const rejected = await decideLeave(tx, leave.id, { status: "REJECTED", decidedBy: actor, decidedAt: deps.clock.now(), decisionNote: note });
    events.add(
      AttendanceEvents.LEAVE_REJECTED,
      { v: 1, leaveId: rejected.id, staffId: rejected.staffId, startsOn: rejected.startsOn, endsOn: rejected.endsOn },
      { type: "staff_leave", id: rejected.id },
    );
    events.audit({ action: "attendance.staff_leave.rejected", resourceType: "staff_leave", resourceId: rejected.id, sensitive: true, reason: note });
    await events.flush(tx);
    return ok(rejected);
  });
}

/** `cancelStaffLeave` : le demandeur retire sa demande en attente ; l'annulation d'un congé APPROUVÉ exige la décision RH. */
export async function cancelStaffLeave(deps: AttendanceDeps, ctx: RequestContext, input: { leaveId: Uuid; note?: string | undefined; caps?: CallerCaps }): Promise<Result<StaffLeave, AppError>> {
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "Utilisateur identifié requis."));
  const caps = input.caps ?? {};
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const leave = await getLeave(tx, input.leaveId, true);
    if (!leave) return err(notFound(AttendanceCode.LEAVE_NOT_FOUND, "Congé", input.leaveId));
    const wasApproved = leave.status === "APPROVED";
    const allowed = caps.leaveDecide === true || (!wasApproved && (leave.requestedBy === actor || caps.staffRecord === true));
    if (!allowed) return err(forbidden(AttendanceCode.FORBIDDEN, "Vous ne pouvez pas annuler ce congé."));
    const transition = assertLeaveTransition(leave.status as LeaveStatus, "CANCELLED");
    if (!transition.ok) return transition;
    const cancelled = await decideLeave(tx, leave.id, {
      status: "CANCELLED", decidedBy: wasApproved ? actor : leave.decidedBy, decidedAt: wasApproved ? deps.clock.now() : leave.decidedAt, decisionNote: input.note?.trim() || leave.decisionNote,
    });
    events.add(
      AttendanceEvents.LEAVE_CANCELLED,
      { v: 1, leaveId: cancelled.id, staffId: cancelled.staffId, startsOn: cancelled.startsOn, endsOn: cancelled.endsOn, wasApproved },
      { type: "staff_leave", id: cancelled.id },
    );
    events.audit({ action: "attendance.staff_leave.cancelled", resourceType: "staff_leave", resourceId: cancelled.id, sensitive: wasApproved, reason: input.note ?? null, metadata: { wasApproved } });
    await events.flush(tx);
    return ok(cancelled);
  });
}

/** `listStaffLeaves` : sans `staff.read` / `leave.decide`, seulement les congés du membre connecté. */
export async function listStaffLeaves(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: { staffId?: Uuid | undefined; status?: LeaveStatus | undefined; from?: IsoDate | undefined; to?: IsoDate | undefined; limit?: number | undefined; cursor?: string | undefined; caps?: CallerCaps },
): Promise<Result<{ items: StaffLeave[]; nextCursor: string | null }, AppError>> {
  const caps = input.caps ?? {};
  const broad = caps.staffRead === true || caps.leaveDecide === true || caps.staffRecord === true;
  const own = broad ? null : await ownStaffId(deps, ctx);
  if (!broad && !own) return ok({ items: [], nextCursor: null });
  return inTx(deps, ctx, async (tx) => ok(await listLeaves(tx, { ...input, staffId: broad ? input.staffId : (own as Uuid) })), { readOnly: true });
}
